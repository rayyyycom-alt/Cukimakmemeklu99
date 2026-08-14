// ╔══════════════════════════════════════════════════════╗
// ║           BRIDGE - bridge.js                         ║
// ║   Jembatan Queue ↔ Telegram Relay                    ║
// ╚══════════════════════════════════════════════════════╝

const { EventEmitter } = require("events");

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

// Session store: { requestId: { url, resolve, reject, timer } }
const sessions = {};

// Relay ready state — diset oleh telegram-relay.service.js
let _relayReady = false;

function setRelayReady(ready) {
  _relayReady = ready;
  console.log(`🔌 Relay state: ${ready ? "✅ READY" : "❌ NOT READY"}`);
}

function isRelayReady() {
  return _relayReady;
}

// ─────────────────────────────────────────────
//  REQUEST BYPASS
// ─────────────────────────────────────────────

async function requestBypass(requestId, url) {
  const timeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS) || 120_000;

  return new Promise((resolve, reject) => {
    sessions[requestId] = {
      url,
      resolve,
      reject,
      timer: setTimeout(() => {
        delete sessions[requestId];
        reject(new Error("TIMEOUT"));
        emitter.emit("session-expired", { requestId });
        console.log(`⏰ Session expired: ${requestId}`);
      }, timeoutMs),
    };

    emitter.emit("bypass-request", { requestId, url });
  });
}

// ─────────────────────────────────────────────
//  RESOLVE / REJECT
// ─────────────────────────────────────────────

function resolveBypass(requestId, result) {
  const sess = sessions[requestId];
  if (!sess) {
    console.log(`⚠️  resolveBypass: ${requestId} sudah tidak ada (mungkin expired)`);
    return;
  }
  clearTimeout(sess.timer);
  sess.resolve(result);
  delete sessions[requestId];
}

function rejectBypass(requestId, errMsg) {
  const sess = sessions[requestId];
  if (!sess) return;
  clearTimeout(sess.timer);
  sess.reject(new Error(errMsg));
  delete sessions[requestId];
}

function getSession(requestId) {
  return sessions[requestId] || null;
}

function getActiveSessions() {
  return Object.keys(sessions).length;
}

// ─────────────────────────────────────────────
//  BRIDGE SESSION EXPIRED → cleanup
// ─────────────────────────────────────────────

emitter.on("session-expired", ({ requestId }) => {
  if (sessions[requestId]) {
    delete sessions[requestId];
    console.log(`🧹 Cleanup session expired: ${requestId}`);
  }
});

module.exports = {
  emitter,
  requestBypass,
  resolveBypass,
  rejectBypass,
  getSession,
  getActiveSessions,
  setRelayReady,
  isRelayReady,
};
