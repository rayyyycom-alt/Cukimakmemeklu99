const bridge = require("../bridge.js");
const crypto = require("crypto");

const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY) || 1;
const MAX_QUEUE   = parseInt(process.env.QUEUE_MAX) || 10;
const TIMEOUT_MS  = parseInt(process.env.REQUEST_TIMEOUT_MS) || 120_000;

// Request registry: requestId → { status, originalUrl, resultUrl, error, createdAt }
const registry = new Map();

// Queue & active counter
let activeCount = 0;
const queue     = [];

// Duplicate protection: hash → timestamp
const recentHashes = new Map();
const DEDUP_WINDOW = 5_000; // 5 detik

function makeRequestId() {
  return "REQ-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function hashUrl(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
}

function isDuplicate(url) {
  const h   = hashUrl(url);
  const now = Date.now();
  if (recentHashes.has(h) && now - recentHashes.get(h) < DEDUP_WINDOW) return true;
  recentHashes.set(h, now);
  // Cleanup lama
  for (const [k, t] of recentHashes) {
    if (now - t > DEDUP_WINDOW * 2) recentHashes.delete(k);
  }
  return false;
}

function getQueueInfo() {
  return { active: activeCount, waiting: queue.length };
}

function getRequest(requestId) {
  return registry.get(requestId) || null;
}

// ─────────────────────────────────────────────
//  PROCESS NEXT
// ─────────────────────────────────────────────

function processNext() {
  if (activeCount >= CONCURRENCY || queue.length === 0) return;

  const { requestId, url, resolve } = queue.shift();
  activeCount++;

  const entry = registry.get(requestId);
  if (!entry) { activeCount--; processNext(); return; }

  entry.status = "processing";
  console.log(`⚡ [Queue] Processing: ${requestId} | ${url} | active:${activeCount} waiting:${queue.length}`);

  const timeoutTimer = setTimeout(() => {
    const e = registry.get(requestId);
    if (e && e.status === "processing") {
      e.status = "timeout";
      e.error  = "Processing timed out";
      console.log(`⏰ [Queue] Timeout: ${requestId}`);
    }
    activeCount--;
    processNext();
    resolve({ status: "timeout" });
  }, TIMEOUT_MS);

  bridge.requestBypass(requestId, url)
    .then(result => {
      clearTimeout(timeoutTimer);
      const e = registry.get(requestId);
      if (e) {
        e.status    = "success";
        e.resultUrl = result.bypassed;
        e.time      = result.time;
      }
      activeCount--;
      processNext();
      resolve({ status: "success", result });
    })
    .catch(err => {
      clearTimeout(timeoutTimer);
      const e = registry.get(requestId);
      if (e) {
        e.status = err.message === "TIMEOUT" ? "timeout" : "failed";
        e.error  = err.message;
      }
      activeCount--;
      processNext();
      resolve({ status: e?.status || "failed" });
    });
}

// ─────────────────────────────────────────────
//  ENQUEUE
// ─────────────────────────────────────────────

function enqueue(url) {
  // Cek relay siap
  if (!bridge.isRelayReady()) {
    return { code: 503, body: {
      success: false,
      status : "unavailable",
      error  : "Telegram relay belum siap. Coba beberapa saat lagi.",
    }};
  }

  // Dedup
  if (isDuplicate(url)) {
    return { code: 409, body: {
      success: false,
      status : "duplicate",
      error  : "Request URL yang sama sedang diproses. Tunggu sebentar.",
    }};
  }

  // Queue penuh
  if (queue.length >= MAX_QUEUE) {
    return { code: 503, body: {
      success: false,
      status : "queue_full",
      error  : "Server sedang sibuk. Coba lagi nanti.",
    }};
  }

  const requestId = makeRequestId();
  registry.set(requestId, {
    status     : "queued",
    originalUrl: url,
    resultUrl  : null,
    error      : null,
    createdAt  : Date.now(),
  });

  // Buat promise internal — tidak di-await di sini
  const promise = new Promise(resolve => {
    queue.push({ requestId, url, resolve });
  });

  // Trigger proses
  processNext();

  console.log(`📥 [Queue] Enqueued: ${requestId} | active:${activeCount} waiting:${queue.length}`);

  // Kalau langsung selesai dalam 100ms, return 200
  // Kalau tidak, return 202 + polling
  return { code: 202, requestId, promise, body: {
    success  : true,
    status   : "processing",
    requestId,
  }};
}

// Cleanup registry > 10 menit
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (now - entry.createdAt > 10 * 60 * 1000) {
      registry.delete(id);
    }
  }
}, 5 * 60 * 1000);

module.exports = { enqueue, getRequest, getQueueInfo, makeRequestId };
