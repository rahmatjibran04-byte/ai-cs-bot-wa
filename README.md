# AI Customer Service Bot — WhatsApp (WABA + n8n)

Template bot customer service WhatsApp yang bisa dipakai ulang untuk toko, klinik, atau salon mana pun. Satu file konfigurasi = satu bisnis baru.

> ⚠️ **DEMO/CONTOH — bukan order/klien nyata.** Toko contoh "Kopi Senja" adalah toko **fiktif** (Pekanbaru). Semua produk, harga, nomor telepon, dan percakapan di repo ini adalah data contoh untuk demonstrasi. Jangan mengklaimnya sebagai klien atau order nyata.

## Fitur

| Fitur | Keterangan |
|---|---|
| Katalog & harga | Daftar produk dari Google Sheets (fallback: file lokal) |
| Jawab FAQ | 20 topik knowledge base, pencocokan kata kunci |
| Order via chat | Alur: produk → jumlah → nama → alamat → pembayaran → konfirmasi |
| Nomor order | Format `#KS-XXXX` (prefix bisa diganti per toko) |
| Ongkir otomatis | Gratis ongkir Pekanbaru di atas Rp100.000, normal Rp10.000 |
| Catat order | Ke Google Sheets (tab `Orders`) atau `data/orders.csv` (demo) |
| Rekap harian | Total order, sudah/belum bayar, omzet → dikirim ke WA owner |
| Follow-up "belum bayar" | Pesan pengingat otomatis ke pelanggan |
| Eskalasi admin | Kata kunci "admin/manusia/komplain" → serahkan ke manusia + notifikasi owner |
| Memori per nomor | Riwayat percakapan disimpan per nomor pelanggan (di n8n: Window Buffer Memory) |

## Struktur

```
ai-cs-bot-wa/
├── config/kopi-senja.json   # SATU file per toko: produk, FAQ, aturan harga
├── data/                    # fallback CSV lokal (produk, FAQ, orders)
│   ├── products.csv
│   ├── faq.csv
│   └── orders.csv
├── src/
│   ├── bot.js               # inti logika bot (murni, tanpa I/O jaringan)
│   ├── store.js             # adapter data: Google Sheets ↔ CSV lokal
│   ├── server.js            # webhook WABA (Express) + API simulator
│   └── simulator.js         # simulator CLI
├── n8n/
│   └── kopi-senja-workflow.json   # workflow n8n siap import
├── scripts/
│   └── daily-recap.js       # rekap harian + follow-up (dry-run default)
├── test/
│   ├── test.js              # smoke test otomatis (node:test)
│   └── conversation.txt     # skrip percakapan contoh
├── simulator.html           # simulator web (chat UI)
└── README.md
```

## Cara pakai (demo, tanpa akun apa pun)

```bash
npm install
npm test            # smoke test — harus 100% lolos
npm run simulator   # CLI interaktif (atau: node src/simulator.js --script test/conversation.txt)
npm start           # server di http://localhost:3000 — buka untuk simulator web
```

Coba di simulator:

```
halo
katalog
harga arabika gayo
order kopi susu gula aren 2
Budi Santoso
Jl. Merdeka No. 5, Pekanbaru
QRIS
ya
```

Hasil yang diharapkan: nomor order `#KS-0001`, subtotal Rp70.000, ongkir Rp10.000, **total Rp80.000**, status `BELUM BAYAR`.

Rekap harian (dry-run, tidak mengirim apa pun):

```bash
npm run recap
```

## Cara isi Google Sheets

Buat satu spreadsheet dengan 3 tab (header persis seperti ini):

**Tab `Produk`** — `id | name | category | price | stock | description`

**Tab `FAQ`** — `topic | question | keywords | answer`
Kolom `keywords` dipisah titik koma (`;`), contoh: `jam buka;jam operasional;buka jam`.

**Tab `Orders`** — `number | date | phone | customer_name | items | subtotal | shipping | total | payment | status | address`
Tab ini diisi otomatis oleh bot; jangan edit manual kecuali mengoreksi status.

Aktifkan dengan ENV:

```bash
export SHEETS_ID="<id spreadsheet>"
export GOOGLE_APPLICATION_CREDENTIALS="/path/service-account.json"
```

Service account harus diberi akses **Editor** ke spreadsheet (Share → tambah email service account). Bila `SHEETS_ID` tidak disetel, bot otomatis memakai data lokal (`config/*.json` + `data/orders.csv`) — cocok untuk demo.

## Cara deploy gratis

### Opsi A — Node.js langsung (disarankan untuk template ini)

Gratis di **Render** (Web Service, free tier) atau **Railway** (trial credit). Langkah:

1. Push repo ini ke GitHub.
2. Di Render: New → Web Service → pilih repo → Build Command `npm install` → Start Command `npm start`.
3. Isi Environment Variables (lihat `.env` di bawah). Free tier Render "tidur" setelah 15 menit tanpa traffic — cukup untuk demo/klien kecil; untuk produksi, upgrade ke paket berbayar atau pakai VPS.

### Opsi B — n8n (sesuai permintaan buyer Fastwork)

1. Buat akun n8n (self-host gratis di VPS, atau n8n Cloud trial).
2. Import `n8n/kopi-senja-workflow.json` (Workflows → Import from file).
3. Buat 3 kredensial di n8n: **WhatsApp Business Cloud API**, **Google Sheets (OAuth2)**, **OpenAI**.
4. Isi variabel ENV di n8n: `SHEETS_ID`, `WABA_PHONE_NUMBER_ID`, `OWNER_PHONE`, `STORE_NAME`.
5. Aktifkan workflow (tombol Active). Node "Cron: Rekap Harian 21.00" mengurus rekap + follow-up.

Catatan jujur: n8n self-host butuh VPS (~Rp60–150rb/bln); n8n Cloud berbayar setelah trial. Biaya server/API/Meta **ditanggung klien**, bukan penjual template.

### Langkah daftar WABA (WhatsApp Business API resmi) — JANGAN daftarkan apa pun sebelum klien setuju

1. Buat aplikasi di [Meta for Developers](https://developers.facebook.com/) → tambah produk **WhatsApp**.
2. Verifikasi bisnis (Business Manager) — butuh dokumen legal usaha klien.
3. Daftarkan nomor WA bisnis → dapatkan **Phone Number ID** + **token akses**.
4. Di dashboard WhatsApp → Webhooks → daftarkan URL server (`https://<domain>/webhook`) + **Verify Token** (bebas pilih, samakan dengan `WABA_VERIFY_TOKEN`).
5. Tambah nomor pelanggan uji, lalu kirim pesan pertama.

⚠️ **Jangan pakai jalur tidak resmi (QR/wa-web.js) untuk klien berbayar** — nomor bisa diblokir Meta sewaktu-waktu. Template ini hanya memakai jalur resmi (Cloud API).

### Variabel lingkungan (.env)

```bash
# WAJIB untuk produksi (kosongkan = mode DEMO, tidak ada pesan terkirim)
WABA_VERIFY_TOKEN=kata-sandi-verify-token-anda
WABA_TOKEN=<token akses Cloud API>
WABA_PHONE_NUMBER_ID=<phone number id>
OWNER_PHONE=6281234567890        # nomor owner toko (format 628xxx)

# OPSIONAL — Google Sheets (tanpa ini, pakai data lokal)
SHEETS_ID=<id spreadsheet>
GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json

# OPSIONAL
PORT=3000
CONFIG_PATH=config/kopi-senja.json
SIM_PHONE=6281230000000         # nomor "pelanggan" di simulator
```

**Jangan pernah commit file `.env`, token, atau `service-account.json` ke repo.** `.gitignore` sudah menutupinya.

## Cara ganti toko (pakai ulang untuk toko/klinik lain)

1. Salin `config/kopi-senja.json` → `config/<nama-toko>.json`.
2. Isi: nama toko, alamat, jam buka, produk (boleh berapa pun), FAQ (tambah topik baru: `topic`, `question`, `keywords`, `answer`), `freeShippingThreshold`, `shippingFeePekanbaru`, `orderPrefix`, `paymentMethods`, `ownerPhone`.
3. Jalankan dengan `CONFIG_PATH=config/<nama-toko>.json npm start`.
4. Untuk klinik/salon: ganti "produk" dengan "layanan + tarif", tambah FAQ jadwal dokter, dan ubah alur order menjadi alur booking (pilih layanan → tanggal → jam). Kerangka botnya sama.

## Batasan (jujur)

- **Bukan AI generatif penuh.** Jawaban FAQ dan order memakai pencocokan kata kunci deterministik (akurat untuk harga/stok, tapi kaku untuk bahasa gaul/typo berat). Lapisan AI (OpenAI) hanya ada di workflow n8n sebagai penerjemah bahasa alami — jawaban harga/stok tetap harus dari data Sheets, bukan dari model.
- **Bahasa Indonesia informal** (COD, tawar-menawar, singkatan daerah) sering membingungkan bot — solusinya eskalasi ke admin manusia, bukan memaksa bot menjawab.
- **Ongkir luar kota** di template ini flat Rp25.000 — untuk produksi, hitung via API RajaOngkir/ekspedisi.
- **Pembayaran belum terverifikasi otomatis** — bukti transfer dicek manual oleh owner/admin. Integrasi payment gateway (Xendit/Midtrans) di luar cakupan template ini.
- **Free tier Render tidur** setelah 15 menit idle — webhook pertama setelah tidur bisa lambat (cold start ~30–60 detik).
- **Tanpa akun Meta/n8n/Google, bot hanya berjalan di simulator** — itu disengaja: demo bisa jalan tanpa biaya dan tanpa risiko pemblokiran.

## Harga pasar (referensi, dari riset Fastwork Jobboard)

- Job buyer "AI Customer Service berbasis WhatsApp (n8n)": budget **Rp1.500.000**, 21 bidder, syarat wajib **video demo**.
- Bot pesanan+rekap generik dijual Rp200.000; SaaS Rp70.000–99.000/bln. Template ini menang di **custom + demo + garansi + rawat**, bukan di harga termurah.
- Saran harga jual: setup Rp1.000.000–1.500.000 + rawat Rp99.000–150.000/bln (biaya server/API ditanggung klien).

## Lisensi

MIT — bebas dipakai, diubah, dan dijual sebagai jasa setup. Data toko contoh ("Kopi Senja") bersifat fiktif.
