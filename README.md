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

## Video demo

`demo/demo-bot-wa-kopi-senja.mp4` (64 detik, 720×1280) — rekaman simulator web: sapaan → katalog → tanya harga → order → konfirmasi → rekap. Alur di video sama persis dengan simulator (`npm start` lalu buka http://localhost:3000) dan dengan skrip `test/conversation.txt`.

### Varian klinik gigi (contoh kedua)

Template yang sama mendukung varian **klinik/salon**: ganti "produk" dengan "layanan + tarif" dan "order" dengan "booking" — lihat `config/klinik-gigi.json` (contoh fiktif: Klinik Gigi Senyum Sehat, Pekanbaru — 6 layanan, jadwal 2 dokter). Jadwal dokter dan daftar layanan bisa diambil dari Google Sheets (tab `Layanan` dan `JadwalDokter`, sama seperti tab `Produk`), bot menawarkan slot kosong, mencatat booking ke Sheets dengan nomor booking (`#KG-XXXX`), mengirim konfirmasi, dan mengirim pengingat H-1 via WhatsApp. Video demonya: `demo-klinik/demo-bot-booking-klinik.mp4` (64 detik, 720×1280) — pasien booking scaling Rabu 10.00 dengan drg. Maya sampai konfirmasi booking.

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
3. Buat 4 kredensial di n8n: **WhatsApp Business Cloud API**, **WhatsApp Trigger (OAuth)** — tipe berbeda dari yang pertama, khusus node trigger — **Google Sheets (OAuth2)**, **OpenAI**. Ganti placeholder ID di workflow (`ISI-ID-KREDENSIAL-WABA`, `ISI-ID-KREDENSIAL-WABA-TRIGGER`, `ISI-ID-KREDENSIAL-SHEETS`, `ISI-ID-KREDENSIAL-OPENAI`) dengan kredensial asli.
4. Isi variabel ENV di n8n: `SHEETS_ID`, `WABA_PHONE_NUMBER_ID`, `OWNER_PHONE`, `STORE_NAME`, `OPENAI_ENABLED` (`true` = pakai AI Agent; `false` = jawaban deterministik tanpa AI — lihat "Setup Produksi (n8n)").
5. Aktifkan workflow (tombol Active). Node "Cron: Rekap Harian 21.00" sudah tersambung ke rantai rekap + follow-up "belum bayar" (baca "Setup Produksi (n8n)" untuk keterbatasannya).

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

# OPSIONAL — n8n (hanya dipakai workflow n8n, bukan server.js)
OPENAI_ENABLED=true           # false = AI Agent dimatikan, bot memakai jawaban deterministik
BOT_SERVER_URL=https://<domain-vps>   # alamat server Node.js pendamping (src/server.js), bila dipakai

# OPSIONAL
PORT=3000
CONFIG_PATH=config/kopi-senja.json
SIM_PHONE=6281230000000         # nomor "pelanggan" di simulator
```

**Jangan pernah commit file `.env`, token, atau `service-account.json` ke repo.** `.gitignore` sudah menutupinya.

## Setup Produksi (n8n)

Workflow `n8n/kopi-senja-workflow.json` (28 node) sudah diperbaiki dari hasil audit — semua node tersambung, tidak ada lagi node yatim. Uji strukturnya secara lokal tanpa akun apa pun: `node --test test/workflow-test.js` (26 test, harus 100% lolos).

### Node baru + alurnya

**Alur pesan masuk:** WhatsApp Trigger → Parse Pesan Masuk → Pesan Teks? → Minta Admin? → Katalog (Sheets) → FAQ (Sheets) → AI Agent Aktif? → AI Agent (OpenAI) / Jawaban Deterministik (tanpa AI) → Bersihkan Balasan → Order Terkonfirmasi? → (ya) Baca Orders → Buat Nomor Order → Catat Order ke Sheets → Siapkan Balasan Order → Balas via Cloud API → Respond 200 ke Meta. Cabang eskalasi (Eskalasi: WA ke Admin) dan cabang pesan non-teks (Balas: Pesan Non-Teks) juga bermuara ke node Respond 200 yang sama — satu node boleh punya banyak input, jadi tidak ada node Respond 200 kedua.

**Alur order:** bila pelanggan mengonfirmasi order, AI Agent mengakhiri balasannya dengan baris marker (lihat di bawah). Node "Bersihkan Balasan" menghapus baris itu dari teks yang dikirim ke pelanggan dan mem-parse-nya menjadi data order; "Order Terkonfirmasi?" bercabang dari situ. "Baca Orders" membaca semua baris tab Orders, "Buat Nomor Order" menghitung jumlah baris + 1 menjadi nomor `#KS-000N` (pad 4, prefix `KS` tetap seperti `src/store.js`), lalu "Catat Order ke Sheets" meng-append ke tab Orders dengan mapping kolom lengkap (number, date, phone, customer_name, items, subtotal, shipping, total, payment, status, address).

**Rantai rekap (cron 21.00 WIB):** Cron → Baca Orders (Rekap) → Hitung Rekap Harian (port `dailyRecap()` + `unpaidFollowUp()` dari `src/bot.js`) → Kirim Rekap ke Owner (`$env.OWNER_PHONE`) → Uraikan Order Belum Bayar → Split: Order Belum Bayar (satu item per order) → Follow-up Belum Bayar (teks per item: sapa nama, nomor order, total, minta bukti bayar).

**Node adapter (tambahan yang tidak ada di rencana awal, alasannya di notes node):** "Siapkan Balasan Order" — node Sheets append mengembalikan hasil API Sheets, bukan item masukannya, jadi field `reply` akan hilang bila "Catat Order" langsung disambung ke "Balas"; node ini meneruskan lagi balasan dari "Buat Nomor Order". "Uraikan Order Belum Bayar" — SplitInBatches hanya membagi *item*, bukan array di dalam satu item, jadi daftar `unpaid` harus diuraikan dulu menjadi satu item per order.

### Format marker ORDER_CONFIRMED

Satu baris di akhir balasan AI, field dipisah ` | `, angka tanpa `Rp`/titik:

```
ORDER_CONFIRMED | <items: "Nama produk xQty; ..."> | <subtotal angka> | <ongkir angka> | <total angka> | <nama> | <alamat> | <pembayaran>
```

Contoh: `ORDER_CONFIRMED | Kopi Susu Gula Aren 1L x2 | 70000 | 10000 | 80000 | Budi Santoso | Jl. Merdeka No. 5, Pekanbaru | QRIS`. Baris ini dihapus otomatis sebelum balasan dikirim ke pelanggan. Di teks balasan yang terlihat pelanggan, AI menulis nomor order sebagai placeholder `{{ORDER_NUMBER}}` (ditulis sebagai "placeholder ORDER_NUMBER yang diapit kurung kurawal ganda" di prompt — supaya tidak bentrok dengan sintaks ekspresi n8n); node "Buat Nomor Order" menggantinya dengan nomor asli. Catatan: kolom `items` di tab Orders pada jalur n8n berisi string `"Nama produk xQty; ..."` dari marker, sedangkan jalur `server.js` menyimpan array JSON — isinya sama, formatnya beda.

### Cara isi kredensial placeholder + ENV

Di dalam file workflow, keempat ID kredensial masih placeholder — **jangan isi nilai asli di file ini**:

| Placeholder | Kredensial n8n yang harus dibuat | Dipakai node |
|---|---|---|
| `ISI-ID-KREDENSIAL-WABA` | WhatsApp Business Cloud API | Balas, Eskalasi, Kirim Rekap, Follow-up |
| `ISI-ID-KREDENSIAL-WABA-TRIGGER` | WhatsApp Trigger (OAuth) — tipe berbeda dari WABA API | WhatsApp Trigger |
| `ISI-ID-KREDENSIAL-SHEETS` | Google Sheets OAuth2 | 5 node Sheets |
| `ISI-ID-KREDENSIAL-OPENAI` | OpenAI | AI Agent |

Setelah import, buat keempat kredensial di n8n lalu ganti placeholder dengan ID kredensial asli di tiap node (atau pilih kredensialnya dari dropdown node). ENV di n8n (Variables): `SHEETS_ID`, `WABA_PHONE_NUMBER_ID`, `OWNER_PHONE`, `STORE_NAME`, `OPENAI_ENABLED`, dan `BOT_SERVER_URL` bila server Node.js pendamping dipakai. Sticky note "Checklist Setup" di dalam workflow merangkum daftar yang sama. Node trigger memakai `updates: ["messages"]` (skema terverifikasi dari dokumentasi n8n + contoh workflow komunitas) — aplikasi Meta **wajib di-subscribe ke WABA** (cek via `subscribed_apps` di Graph API); tanpa itu pesan nyata tidak sampai ke n8n meski test event dari dashboard Meta berhasil. Bila trigger resmi belum bisa dipakai (akun WABA belum siap), ganti sementara dengan node Webhook generik path `kopi-senja-wa` — node Parse tetap kompatibel dengan kedua bentuk payload.

### Mode fallback tanpa OpenAI

Set `OPENAI_ENABLED=false` di ENV n8n: node "AI Agent Aktif?" mengalihkan semua pesan ke "Jawaban Deterministik (tanpa AI)" — port ringkas `src/bot.js` (sapaan, katalog, harga/stok produk, FAQ via pencocokan kata kunci, panduan order, balasan tidak dikenal) memakai data Sheets yang sudah diambil. **Batas mode ini:** order multi-langkah **tidak bisa dikonfirmasi otomatis** — bot memandu order (produk, jumlah, ongkir) lalu meminta pelanggan membalas nama/alamat/pembayaran dan mengetik `admin` agar admin manusia mengonfirmasi dan mengirim nomor order. Logika deterministik **lengkap** (state machine order + rekap) ada di `src/server.js` (`POST /api/simulate`, `GET /api/recap`) dan itulah fallback penuh bila AI Agent tidak aktif. Top-up OpenAI $5 butuh kartu internasional dan dicatat sebagai blocker — jadi fallback tanpa OpenAI harus tetap jalan.

### Keterbatasan yang diketahui (jujur)

- **Belum diuji import live ke n8n.** Struktur JSON + logika Code node sudah diuji lokal (`test/workflow-test.js`, 26 test), tapi import sungguhan, eksekusi end-to-end, node WhatsApp Trigger resmi, dan lookup Sheets yang sebenarnya belum bisa diverifikasi tanpa instance n8n live dan akun Meta.
- **Follow-up di luar jendela 24 jam butuh template message Meta yang disetujui** — teks bebas bisa ditolak Meta bila pelanggan terakhir chat > 24 jam lalu. Untuk follow-up lewat 24 jam, ganti node "Follow-up Belum Bayar" dengan pengiriman template message.
- **Race condition nomor urut:** bila 2 order masuk bersamaan, keduanya bisa membaca jumlah baris Orders yang sama dan mendapat nomor yang sama. Untuk volume toko kecil risikonya rendah; untuk volume besar pakai atomic counter (mis. sel khusus di Sheets / kolom counter yang di-lock).
- **Respond 200 + WhatsApp Trigger:** node Respond 200 dipertahankan di ketiga cabang (balasan, eskalasi, non-teks) sesuai desain; bila saat import live ternyata trigger resmi sudah menjawab 200 sendiri dan node ini error, hapus node Respond 200 — verifikasi saat uji live.
- **Perbaikan prompt AI:** prompt lama memakai `$json.text` untuk pesan pelanggan — setelah lookup FAQ, `$json` berisi baris FAQ, bukan pesan pelanggan. Prompt baru memakai `{{ $('Parse Pesan Masuk').first().json.text }}`.
- **Node "Baca Orders" memakai `alwaysOutputData`:** bila tab Orders masih kosong, node tetap mengeluarkan satu item kosong supaya "Buat Nomor Order" tetap jalan (tanpa ini rantai berhenti karena Code node tidak menerima item).

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
- **Workflow n8n belum diuji import live** — struktur + Code node teruji lokal (`test/workflow-test.js`), tapi import ke n8n, trigger WhatsApp resmi, dan eksekusi end-to-end butuh instance n8n + akun Meta (lihat "Setup Produksi (n8n)" untuk daftar keterbatasan lengkap: template message 24 jam, race nomor urut).

## Harga pasar (referensi, dari riset Fastwork Jobboard)

- Job buyer "AI Customer Service berbasis WhatsApp (n8n)": budget **Rp1.500.000**, 21 bidder, syarat wajib **video demo**.
- Bot pesanan+rekap generik dijual Rp200.000; SaaS Rp70.000–99.000/bln. Template ini menang di **custom + demo + garansi + rawat**, bukan di harga termurah.
- Saran harga jual: setup Rp1.000.000–1.500.000 + rawat Rp99.000–150.000/bln (biaya server/API ditanggung klien).

## Lisensi

MIT — bebas dipakai, diubah, dan dijual sebagai jasa setup. Data toko contoh ("Kopi Senja") bersifat fiktif.
