# REZA Bypass Backend

Backend Node.js untuk REZA Bypass — menghubungkan website ke Telegram bot via GramJS userbot.

---

## ⚠️ PERINGATAN PENTING — SINGLE INSTANCE

**Deploy HARUS sebagai single instance (VM/Hobby), BUKAN autoscale.**

Satu `TG_SESSION` tidak boleh dipakai oleh lebih dari satu process bersamaan.
Jika autoscale, akan muncul error `AUTH_KEY_DUPLICATED` dan semua request gagal.

Di Railway: gunakan plan **Hobby** dan pastikan hanya ada 1 replica.

---

## Instalasi

```bash
npm install
```

---

## Konfigurasi

Copy `.env.example` jadi `.env`:

```bash
cp .env.example .env
```

Isi variabel berikut:

```env
TG_API_ID=36182131
TG_API_HASH=7a5d482100d8cd691c5f74b8ee761258
TG_SESSION=1BQAN...   # dari tg_session.txt
TG_PHONE=+6288705391751
TG_PASSWORD=           # kosong jika tidak pakai 2FA
TG_BOT_TARGET=Nick_Bypass_Bot
HTTP_PORT=3000
```

---

## Generate Session Baru

Jika session expired atau belum punya:

```bash
node generate-session.js
```

Ikuti instruksi, lalu copy hasilnya ke `TG_SESSION` di `.env`.

---

## Jalankan

```bash
# Development
node index.js

# Production
npm start
```

---

## Deploy ke Railway

1. Push repo ini ke GitHub
2. Railway → New Project → GitHub Repository
3. Set env vars (sama seperti di .env)
4. Start command: `node index.js`
5. Pastikan **1 replica saja** (jangan autoscale)

---

## API

### GET /v1/api/status
Cek status backend dan relay Telegram.

### GET /v1/api/process/url?url=LINK
Submit URL untuk diproses.

Response 202 (processing):
```json
{ "success": true, "status": "processing", "requestId": "REQ-XXXXXXXX" }
```

### GET /v1/api/process/status/:requestId
Poll status request.

Response sukses:
```json
{
  "success": true,
  "status": "success",
  "requestId": "REQ-XXXXXXXX",
  "originalUrl": "https://example.com",
  "resultUrl": "https://result.com/...",
  "time": "2.3 detik"
}
```

---

## Troubleshooting

**AUTH_KEY_DUPLICATED**
→ Ada lebih dari 1 instance jalan. Matikan semua, restart 1 instance saja.

**503 Relay belum siap**
→ Telegram belum connect. Cek log untuk detail error.

**Session expired / SESSION_REVOKED**
→ Jalankan `node generate-session.js` untuk generate session baru.

**Queue penuh (503)**
→ Terlalu banyak request. Tunggu beberapa saat.
