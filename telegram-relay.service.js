// ╔══════════════════════════════════════════════════════╗
// ║     TELEGRAM RELAY SERVICE                           ║
// ║     autoReconnect:false, AUTH_KEY_DUPLICATED guard   ║
// ╚══════════════════════════════════════════════════════╝

const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");
const { NewMessage }     = require("telegram/events");
const fs                 = require("fs");
const path               = require("path");
const bridge             = require("../bridge.js");

// ─────────────────────────────────────────────
//  SESSION LOADER
// ─────────────────────────────────────────────

function loadSession() {
  // Prioritas 1: env var
  if (process.env.TG_SESSION && process.env.TG_SESSION.trim().length > 10) {
    return process.env.TG_SESSION.trim();
  }
  // Prioritas 2: file tg_session.txt
  const sessionFile = path.join(__dirname, "tg_session.txt");
  if (fs.existsSync(sessionFile)) {
    const s = fs.readFileSync(sessionFile, "utf-8").trim();
    if (s && s.length > 10) return s;
  }
  return "";
}

// ─────────────────────────────────────────────
//  URL UTILS (dipertahankan dari source asli)
// ─────────────────────────────────────────────

function extractUrls(msg) {
  const text = msg.text || msg.message || "";
  const urls = [];

  const plainMatches = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)];
  for (const m of plainMatches) {
    urls.push(m[0].replace(/[*"'`\u201c\u201d\u2018\u2019)\]>.,]+$/, ""));
  }

  if (msg.entities) {
    for (const ent of msg.entities) {
      if (ent.url) {
        urls.push(ent.url);
      } else if (ent.className === "MessageEntityUrl" || ent._ === "messageEntityUrl") {
        const raw = text.slice(ent.offset, ent.offset + ent.length);
        if (/^https?:\/\//.test(raw)) urls.push(raw);
      }
    }
  }

  return [...new Set(urls)];
}

function isNewUrl(url, originalUrl) {
  try {
    const a = new URL(url).hostname.replace(/^www\./, "");
    const b = new URL(originalUrl).hostname.replace(/^www\./, "");
    return a !== b;
  } catch {
    return url !== originalUrl;
  }
}

// ─────────────────────────────────────────────
//  PENDING MAP
// ─────────────────────────────────────────────

const pendingMap = new Map();

function removePending(requestId) {
  const entry = pendingMap.get(requestId);
  if (entry?._cleanupTimer) clearTimeout(entry._cleanupTimer);
  pendingMap.delete(requestId);
  console.log(`🗑️  pendingMap hapus: ${requestId} (sisa: ${pendingMap.size})`);
}

bridge.emitter.on("session-expired", ({ requestId }) => {
  if (pendingMap.has(requestId)) {
    console.log(`🧹 Cleanup pendingMap karena timeout: ${requestId}`);
    removePending(requestId);
  }
});

// ─────────────────────────────────────────────
//  TELEGRAM CLIENT
// ─────────────────────────────────────────────

let client       = null;
let _started     = false;

async function start() {
  // Single-start guard
  if (_started) {
    console.warn("⚠️  TelegramRelayService.start() dipanggil lebih dari sekali — diabaikan.");
    return;
  }
  _started = true;

  const apiId   = parseInt(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;

  if (!apiId || !apiHash) {
    console.error("❌ STOP: TG_API_ID atau TG_API_HASH belum diisi di .env");
    bridge.setRelayReady(false);
    return;
  }

  const sessionStr = loadSession();
  if (!sessionStr) {
    console.error("❌ STOP: TG_SESSION kosong. Isi di .env atau taruh tg_session.txt di folder telegram/");
    bridge.setRelayReady(false);
    return;
  }

  client = new TelegramClient(
    new StringSession(sessionStr),
    apiId,
    apiHash,
    {
      connectionRetries : 3,
      retryDelay        : 5000,
      autoReconnect     : false,   // WAJIB false — cegah retry saat AUTH_KEY_DUPLICATED
      autoReconnectDelay: 0,
    }
  );

  console.log("🔐 Menghubungkan Telegram...");

  try {
    await client.connect();
    const me = await client.getMe();
    console.log(`✅ Telegram terhubung: @${me.username || me.firstName}`);
    bridge.setRelayReady(true);
    setupMessageHandler();
    setupBypassListener();
  } catch (e) {
    if (e.message?.includes("AUTH_KEY_DUPLICATED")) {
      console.error("❌ FATAL: AUTH_KEY_DUPLICATED");
      console.error("   Ada instance lain yang memakai session Telegram yang sama.");
      console.error("   Matikan semua instance lain, lalu restart SATU instance saja.");
      console.error("   Server tetap jalan tapi request akan dapat 503.");
      bridge.setRelayReady(false);
      return; // BERHENTI — jangan retry
    }

    if (e.message?.includes("SESSION_REVOKED") || e.message?.includes("AUTH_KEY_UNREGISTERED")) {
      console.error("❌ FATAL: Session Telegram sudah tidak valid / sudah di-revoke.");
      console.error("   Generate session baru dengan node generate-session.js");
      bridge.setRelayReady(false);
      return;
    }

    console.error("❌ Telegram connect error:", e.message);
    bridge.setRelayReady(false);
    // Tidak retry otomatis
  }
}

// ─────────────────────────────────────────────
//  BYPASS LISTENER (dari queue via bridge)
// ─────────────────────────────────────────────

function setupBypassListener() {
  bridge.emitter.on("bypass-request", async ({ requestId, url }) => {
    const _cleanupTimer = setTimeout(() => {
      console.log(`⏰ pendingMap auto-cleanup: ${requestId}`);
      pendingMap.delete(requestId);
    }, 150_000);

    pendingMap.set(requestId, {
      url,
      timestamp: Date.now(),
      _cleanupTimer,
    });

    try {
      const target = process.env.TG_BOT_TARGET || "Nick_Bypass_Bot";
      console.log(`📨 Kirim ke @${target}: ${url}`);
      await client.sendMessage(target, { message: url });
    } catch (e) {
      console.error("❌ Gagal kirim ke Telegram:", e.message);
      bridge.rejectBypass(requestId, "Gagal mengirim ke Telegram bot");
      removePending(requestId);
    }
  });
}

// ─────────────────────────────────────────────
//  MESSAGE HANDLER (balasan dari bot)
// ─────────────────────────────────────────────

function setupMessageHandler() {
  const target = (process.env.TG_BOT_TARGET || "Nick_Bypass_Bot").toLowerCase();

  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg) return;

    // Hanya proses pesan dari bot target
    try {
      const sender   = await msg.getSender();
      const username = (sender?.username || "").toLowerCase();
      if (username !== target) return;
    } catch { return; }

    const text = msg.text || msg.message || "";
    console.log(`📩 TG [${msg.id}]:`, (text || "[media]").slice(0, 120));

    if (pendingMap.size === 0) {
      console.log("📩 TG: Tidak ada pending request, diabaikan.");
      return;
    }

    // Ambil request paling lama (FIFO) — aman karena concurrency:1
    const sorted  = [...pendingMap.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    let matched   = null;
    for (const [rid, data] of sorted) {
      if (bridge.getSession(rid)) { matched = [rid, data]; break; }
    }

    if (!matched) {
      console.log("📩 TG: Semua session sudah expired, bersihkan pendingMap.");
      for (const [rid] of sorted) removePending(rid);
      return;
    }

    const [requestId, data] = matched;

    // ── Deteksi "No Script Found" ───────────────────────────
    if (/no script found/i.test(text)) {
      const linkMatch  = text.match(/No Script Found for:\s*(https?:\/\/\S+)/i);
      const linkFound  = linkMatch?.[1] || data.url;
      const friendlyError =
        `⚠️ No Script Found for:\n${linkFound}\n\n` +
        `Script belum tersedia untuk link ini.`;
      console.log(`⚠️  No Script Found (${requestId}): ${linkFound}`);
      bridge.rejectBypass(requestId, friendlyError);
      removePending(requestId);
      return;
    }

    // ── Deteksi URL hasil ───────────────────────────────────
    const urls       = extractUrls(msg);
    const hasKeyword = /original[\s_-]*link|bypass(?:ed)?[\s_-]*(?:link)?|✅|selesai|berhasil|result|sukses|success/i.test(text);
    const newUrls    = urls.filter(u => isNewUrl(u, data.url));
    const hasNewUrl  = newUrls.length > 0;

    // Cek button inline
    const hasInlineUrl = (msg.replyMarkup?.rows || [])
      .flatMap(r => r.buttons || [])
      .some(b => b.url && isNewUrl(b.url, data.url));

    if (hasInlineUrl) {
      const btnUrl = msg.replyMarkup.rows
        .flatMap(r => r.buttons)
        .find(b => b.url && isNewUrl(b.url, data.url))?.url;
      if (btnUrl) { urls.push(btnUrl); newUrls.push(btnUrl); }
    }

    console.log(`🔍 hasKeyword:${hasKeyword} hasNewUrl:${hasNewUrl} newUrls:[${newUrls.join(",")}]`);

    if (!hasKeyword && !hasNewUrl) {
      console.log("📩 TG: Bukan pesan hasil, skip.");
      return;
    }

    // ── Susun hasil ─────────────────────────────────────────
    const cleanUrl = u => u.replace(/[*"'`\u201c\u201d\u2018\u2019)\]>.,]+$/, "");
    const allUrls  = urls.map(cleanUrl);

    const original = text.match(/original[\s_-]*link\s*[:\u2014\-]?\s*(https?:\/\/\S+)/i)?.[1]
      || allUrls[0] || data.url || "-";

    const bypassed = text.match(/bypass(?:ed)?[\s_-]*(?:link)?\s*[:\u2014\-]?\s*(https?:\/\/\S+)/i)?.[1]
      || newUrls[0] || allUrls[allUrls.length - 1] || "-";

    const timeRaw = text.match(/time[\s_-]*(?:taken)?\s*[:\u2014\-]?\s*(\d+[\d.,]*\s*(?:s|ms|sec|second|seconds|detik)?)/i)?.[1]
      || text.match(/(\d+[\d.,]*\s*(?:s|ms|sec|second|seconds|detik))/i)?.[1]
      || null;
    const time = timeRaw ? timeRaw.replace(/\*+/g, "").trim() : "beberapa detik";

    console.log(`✅ Sukses (${requestId}): ori=${original} byp=${bypassed} time=${time}`);
    bridge.resolveBypass(requestId, { original, bypassed, time });
    removePending(requestId);

  }, new NewMessage({}));
}

module.exports = { start };
