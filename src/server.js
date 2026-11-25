/**
 * ai-cs-bot-wa — server webhook WhatsApp Business (Cloud API) + simulator.
 *
 * Endpoint WABA (resmi, Meta Cloud API):
 *   GET  /webhook        — verifikasi webhook (hub.mode / hub.verify_token)
 *   POST /webhook        — terima pesan masuk dari Meta, balas via Cloud API
 * Endpoint demo (tanpa akun Meta — untuk simulator & video demo):
 *   GET  /               — halaman simulator web
 *   POST /api/simulate   — { phone, message } -> { reply, escalate }
 *   GET  /api/recap      — rekap harian (dry-run, tanpa kirim WA)
 *
 * ENV yang dibutuhkan untuk mode produksi (lihat README):
 *   WABA_VERIFY_TOKEN, WABA_TOKEN (token akses permanen/sementara),
 *   WABA_PHONE_NUMBER_ID, OWNER_PHONE (nomor owner, format 628xxx),
 *   SHEETS_ID, GOOGLE_APPLICATION_CREDENTIALS (opsional).
 * Tanpa ENV di atas, server tetap jalan dalam mode DEMO (balasan dihitung
 * lokal, tidak ada pesan yang benar-benar terkirim).
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const { Bot } = require('./bot');
const { createStore } = require('./store');

const CONFIG_PATH = process.env.CONFIG_PATH ||
  path.join(__dirname, '..', 'config', 'kopi-senja.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const store = createStore(config);
const bot = new Bot(config, store);

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WABA_VERIFY_TOKEN || 'kopi-senja-demo-token';
const WABA_TOKEN = process.env.WABA_TOKEN || '';
const WABA_PHONE_NUMBER_ID = process.env.WABA_PHONE_NUMBER_ID || '';
const OWNER_PHONE = process.env.OWNER_PHONE || config.store.ownerPhone || '';

// ------------------------------------------------------------ WABA Cloud API
async function sendWhatsApp(to, text) {
  if (!WABA_TOKEN || !WABA_PHONE_NUMBER_ID) {
    console.log(`[demo] (tidak terkirim — mode demo) ke ${to}:\n${text}\n`);
    return { demo: true };
  }
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${WABA_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WABA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cloud API ${res.status}: ${err}`);
  }
  return res.json();
}

// ------------------------------------------------------------ webhook WABA
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  // Balas 200 cepat ke Meta, proses setelahnya (aturan Meta: < 20 detik).
  res.sendStatus(200);
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          if (msg.type !== 'text') continue;
          const from = msg.from;
          const text = msg.text?.body || '';
          const { reply, escalate, order } = await bot.handleMessage(from, text);
          await sendWhatsApp(from, reply);
          if (escalate) {
            await sendWhatsApp(
              OWNER_PHONE,
              `🔔 *Eskalasi admin* — pelanggan ${from} minta bicara dengan manusia.\nPesan terakhir: "${text}"`,
            );
          }
          if (order && OWNER_PHONE) {
            await sendWhatsApp(
              OWNER_PHONE,
              `🧾 *Order baru ${order.number}* — ${order.customerName} (${from})\n` +
              `Total ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(order.total)} — ${order.payment} — status: ${order.status}`,
            );
          }
        }
      }
    }
  } catch (err) {
    console.error('[webhook] error:', err.message);
  }
});

// ------------------------------------------------------------ simulator & rekap
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'simulator.html'));
});

app.post('/api/simulate', async (req, res) => {
  const { phone, message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message wajib diisi' });
  const result = await bot.handleMessage(phone || '6280000000000', message);
  res.json({ reply: result.reply, escalate: !!result.escalate, order: result.order || null });
});

app.get('/api/recap', (req, res) => {
  res.json(bot.dailyRecap(req.query.date));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    store: config.store.name,
    demo: !WABA_TOKEN,
    products: store.listProducts().length,
    faq: store.listFaq().length,
    orders: store.listOrders().length,
  });
});

app.listen(PORT, () => {
  console.log(`[server] ${config.store.name} — http://localhost:${PORT}`);
  console.log(`[server] Mode: ${WABA_TOKEN ? 'PRODUKSI (WABA)' : 'DEMO (tanpa akun Meta)'}`);
  console.log('[server] Simulator web: http://localhost:' + PORT + '/');
});

module.exports = app;
