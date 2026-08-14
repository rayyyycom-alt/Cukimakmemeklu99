const express = require("express");
const router  = express.Router();

const { enqueue, getRequest, getQueueInfo } = require("../queue/request.queue.js");
const bridge = require("../bridge.js");

// ─────────────────────────────────────────────
//  URL VALIDATOR
// ─────────────────────────────────────────────

const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /metadata\.google\.internal/i,
  /169\.254\.169\.254/,
];

function validateUrl(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "URL wajib diisi" };
  if (raw.length > 2048) return { ok: false, error: "URL terlalu panjang (max 2048 karakter)" };

  let parsed;
  try { parsed = new URL(raw); } catch {
    return { ok: false, error: "URL tidak valid. Pastikan format lengkap (https://...)" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Hanya URL http:// atau https:// yang diterima" };
  }

  const host = parsed.hostname.toLowerCase();
  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(host)) return { ok: false, error: "URL tidak diizinkan" };
  }

  return { ok: true, url: parsed.href };
}

// ─────────────────────────────────────────────
//  GET /status
// ─────────────────────────────────────────────

router.get("/status", (_req, res) => {
  const u  = process.uptime();
  const h  = Math.floor(u / 3600);
  const mn = Math.floor((u % 3600) / 60);
  const s  = Math.floor(u % 60);

  res.json({
    success: true,
    status : "online",
    relay  : bridge.isRelayReady() ? "ready" : "disconnected",
    queue  : getQueueInfo(),
    uptime : `${h}j ${mn}m ${s}d`,
  });
});

// ─────────────────────────────────────────────
//  GET /process/url?url=LINK
// ─────────────────────────────────────────────

router.get("/process/url", async (req, res) => {
  const rawUrl = req.query.url;

  const validation = validateUrl(rawUrl);
  if (!validation.ok) {
    return res.status(400).json({ success: false, status: "failed", error: validation.error });
  }

  const result = enqueue(validation.url);

  if (result.code === 503) return res.status(503).json(result.body);
  if (result.code === 409) return res.status(409).json(result.body);

  // Return 202 langsung — client polling /status/:id
  return res.status(202).json(result.body);
});

// ─────────────────────────────────────────────
//  GET /process/status/:requestId
// ─────────────────────────────────────────────

router.get("/process/status/:requestId", (req, res) => {
  const { requestId } = req.params;

  if (!requestId || !requestId.startsWith("REQ-")) {
    return res.status(400).json({ success: false, error: "Request ID tidak valid" });
  }

  const entry = getRequest(requestId);
  if (!entry) {
    return res.status(404).json({
      success  : false,
      status   : "not_found",
      requestId,
      error    : "Request ID tidak ditemukan atau sudah expired",
    });
  }

  if (entry.status === "success") {
    return res.json({
      success    : true,
      status     : "success",
      requestId,
      originalUrl: entry.originalUrl,
      resultUrl  : entry.resultUrl,
      time       : entry.time,
    });
  }

  if (entry.status === "failed") {
    return res.status(502).json({
      success  : false,
      status   : "failed",
      requestId,
      error    : entry.error || "Processing failed",
    });
  }

  if (entry.status === "timeout") {
    return res.status(504).json({
      success  : false,
      status   : "timeout",
      requestId,
      error    : "Processing timed out",
    });
  }

  // queued / processing
  return res.status(202).json({
    success  : true,
    status   : entry.status,
    requestId,
  });
});

module.exports = router;
      
