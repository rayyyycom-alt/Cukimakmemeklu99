// ╔══════════════════════════════════════════════════════╗
// ║           REZA BYPASS BACKEND - index.js             ║
// ║   Entry point: Website → Queue → TG Userbot → Bot    ║
// ╚══════════════════════════════════════════════════════╝

require("dotenv").config();

const express  = require("express");
const chalk    = require("chalk");
const cors     = require("cors");
const helmet   = require("helmet");
const rateLimit = require("express-rate-limit");

// ─────────────────────────────────────────────
//  SINGLE START GUARD
// ─────────────────────────────────────────────
let servicesStarted = false;

async function startServices() {
  if (servicesStarted) {
    console.warn("⚠️  startServices dipanggil lebih dari sekali — diabaikan.");
    return;
  }
  servicesStarted = true;

  try {
    const relay = require("./telegram/telegram-relay.service.js");
    await relay.start();
  } catch (e) {
    console.error(chalk.red("❌ Telegram relay error:"), e.message);
    // JANGAN set servicesStarted = false
    // JANGAN retry otomatis
    // Server tetap jalan, request akan dapat 503
  }
}

// ─────────────────────────────────────────────
//  HTTP SERVER
// ─────────────────────────────────────────────

function startHttpServer() {
  const app  = express();
  const port = process.env.HTTP_PORT || 3000;

  // Security headers
  app.use(helmet());

  // CORS
  const corsOrigin = process.env.CORS_ORIGIN || "*";
  app.use(cors({ origin: corsOrigin }));

  // Body parser
  app.use(express.json({ limit: "10kb" }));

  // Rate limit
  const limiter = rateLimit({
    windowMs : parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
    max      : parseInt(process.env.RATE_LIMIT_MAX) || 20,
    standardHeaders: true,
    legacyHeaders  : false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        status : "rate_limited",
        error  : "Terlalu banyak request. Coba lagi nanti.",
      });
    },
  });
  app.use("/v1/api", limiter);
  app.use("/api/v1/api", limiter);

  // Request logger
  app.use((req, _res, next) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    next();
  });

  // Routes
  const processRouter = require("./routes/process.route.js");
  app.use("/v1/api", processRouter);
  app.use("/api/v1/api", processRouter); // compat layer

  // 404
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error("Express error:", err.message);
    res.status(500).json({ success: false, error: "Internal server error" });
  });

  app.listen(port, () => {
    console.log(chalk.green(`\n✅ REZA Backend jalan di port ${port}`));
    console.log(chalk.cyan(`   GET  /v1/api/process/url?url=LINK`));
    console.log(chalk.cyan(`   GET  /v1/api/process/status/:id`));
    console.log(chalk.cyan(`   GET  /v1/api/status\n`));
  });
}

// ─────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────

process.on("uncaughtException",  e => console.error("Uncaught:",  e.message));
process.on("unhandledRejection", e => console.error("Unhandled:", e?.message || e));

(async () => {
  console.log(chalk.blue("\n╔══════════════════════════════════════════╗"));
  console.log(chalk.blue("║         REZA BYPASS BACKEND               ║"));
  console.log(chalk.blue("║  Website → Queue → TG Userbot → Bot       ║"));
  console.log(chalk.blue("╚══════════════════════════════════════════╝\n"));

  startHttpServer();
  await startServices();
})();
