#!/usr/bin/env node
/**
 * ai-cs-bot-wa — rekap harian + follow-up "belum bayar".
 *
 * Dipakai:  node scripts/daily-recap.js [--date YYYY-MM-DD] [--send]
 * Default: DRY-RUN — hanya mencetak pesan yang AKAN dikirim.
 * Opsi --send benar-benar mengirim via Cloud API (butuh ENV WABA_TOKEN,
 * WABA_PHONE_NUMBER_ID, OWNER_PHONE). Jangan jalankan --send tanpa izin.
 *
 * Di produksi, jalankan ini sebagai cron n8n (node "Cron: Rekap Harian 21.00"
 * di n8n/kopi-senja-workflow.json) atau cron server jam 21.00 WIB.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { Bot } = require('../src/bot');
const { createStore } = require('../src/store');

const CONFIG_PATH = process.env.CONFIG_PATH ||
  path.join(__dirname, '..', 'config', 'kopi-senja.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

async function sendWhatsApp(to, text) {
  const token = process.env.WABA_TOKEN;
  const phoneId = process.env.WABA_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('ENV WABA_TOKEN / WABA_PHONE_NUMBER_ID belum disetel');
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
    }),
  });
  if (!res.ok) throw new Error(`Cloud API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const dateIdx = args.indexOf('--date');
  const dateKey = dateIdx >= 0 ? args[dateIdx + 1] : undefined;

  const store = createStore(config);
  if (store.ready) await store.ready; // tunggu Sheets bila dipakai
  const bot = new Bot(config, store);
  const recap = bot.dailyRecap(dateKey);

  console.log(`=== Rekap harian ${config.store.name} (DEMO: ${send ? 'KIRIM' : 'dry-run'}) ===\n`);
  console.log(recap.text);
  console.log(`\n--- Follow-up "belum bayar" (${recap.unpaid.length} order) ---`);
  for (const o of recap.unpaid) {
    console.log(`\n[ke ${o.phone} — ${o.number}]`);
    console.log(bot.unpaidFollowUp(o));
  }
  if (!recap.unpaid.length) console.log('Tidak ada order belum bayar.');

  if (!send) {
    console.log('\n(dry-run — tidak ada pesan yang dikirim. Tambah --send untuk mengirim.)');
    return;
  }
  const owner = process.env.OWNER_PHONE || config.store.ownerPhone;
  await sendWhatsApp(owner, recap.text);
  for (const o of recap.unpaid) {
    await sendWhatsApp(o.phone, bot.unpaidFollowUp(o));
  }
  console.log('\nRekap + follow-up terkirim.');
}

main().catch((err) => { console.error('Gagal:', err.message); process.exit(1); });
