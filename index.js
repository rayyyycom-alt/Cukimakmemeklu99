require("dotenv").config();

const express   = require("express");
const chalk     = require("chalk");
const cors      = require("cors");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");

let servicesStarted = false;

async function startServices() {
  if (servicesStarted) return;
  servicesStarted = true;
  try {
    const relay = require("./telegram/telegram-relay.service.js");
    await relay.start();
  } catch (e) {
    console.error("❌ Telegram relay error:", e.message);
  }
}

function startHttpServer() {
  const app = express();

  // Railway inject PORT otomatis — HARUS pakai process.env.PORT
  const port = process.env.PORT || process.env.HTTP_PORT || 3000;

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
  app.use(express.json({ limit: "10kb" }));

  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    max     : parseInt(process.env.RATE_LIMIT_MAX) || 20,
    handler : (_req, res) => res.status(429).json({
      success: false, status: "rate_limited",
      error  : "Terlalu banyak request. Coba lagi nanti.",
    }),
  });
  app.use("/v1/api", limiter);
  app.use("/api/v1/api", limiter);

  app.use((req, _res, next) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    next();
  });

  const processRouter = require("./routes/process.route.js");
  app.use("/v1/api", processRouter);
  app.use("/api/v1/api", processRouter);

  // Health check root — Railway butuh ini
  app.get("/", (_req, res) => {
    res.json({ success: true, name: "REZA Bypass Backend", status: "online" });
  });

  app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));
  app.use((err, _req, res, _next) => {
    console.error("Express error:", err.message);
    res.status(500).json({ success: false, error: "Internal server error" });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`\n✅ REZA Backend jalan di port ${port}`);
    console.log(`   GET  /v1/api/status`);
    console.log(`   GET  /v1/api/process/url?url=LINK`);
    console.log(`   GET  /v1/api/process/status/:id\n`);
  });
}

process.on("uncaughtException",  e => console.error("Uncaught:",  e.message));
process.on("unhandledRejection", e => console.error("Unhandled:", e?.message || e));

(async () => {
  console.log("\n╔══════════════════════════════════╗");
  console.log("║     REZA BYPASS BACKEND          ║");
  console.log("╚══════════════════════════════════╝\n");
  startHttpServer();
  await startServices();
})();
