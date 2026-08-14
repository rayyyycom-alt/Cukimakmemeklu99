// ─────────────────────────────────────────────
//  GENERATE SESSION TELEGRAM
//  Jalankan sekali: node generate-session.js
//  Lalu copy hasilnya ke .env TG_SESSION=...
// ─────────────────────────────────────────────

require("dotenv").config();

const { TelegramClient } = require("telegram");
const { StringSession }  = require("telegram/sessions");
const input              = require("input");

(async () => {
  const apiId   = parseInt(process.env.TG_API_ID);
  const apiHash = process.env.TG_API_HASH;

  if (!apiId || !apiHash) {
    console.error("❌ Set TG_API_ID dan TG_API_HASH di .env dulu");
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    { connectionRetries: 3, autoReconnect: false }
  );

  await client.start({
    phoneNumber: async () => {
      const ph = process.env.TG_PHONE;
      if (ph) return ph;
      return await input.text("Nomor Telegram (+62xxx): ");
    },
    phoneCode : async () => await input.text("Kode OTP: "),
    password  : async () => {
      const pw = process.env.TG_PASSWORD;
      if (pw) return pw;
      const p = await input.text("Password 2FA (Enter jika tidak ada): ");
      return p || undefined;
    },
    onError: e => { throw e; },
  });

  const session = client.session.save();
  console.log("\n✅ SESSION BERHASIL DIBUAT\n");
  console.log("Isi ke .env atau Railway env vars:");
  console.log(`TG_SESSION=${session}`);
  console.log("\nJaga kerahasiaannya!");

  await client.disconnect();
  process.exit(0);
})();
