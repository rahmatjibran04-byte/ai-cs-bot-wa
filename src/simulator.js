#!/usr/bin/env node
/**
 * ai-cs-bot-wa — simulator CLI.
 * Jalankan logika bot tanpa akun Meta apa pun:
 *   node src/simulator.js            (mode interaktif)
 *   echo "katalog" | node src/simulator.js
 *   node src/simulator.js --script test/conversation.txt
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { Bot } = require('./bot');
const { createStore } = require('./store');

const CONFIG_PATH = process.env.CONFIG_PATH ||
  path.join(__dirname, '..', 'config', 'kopi-senja.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

async function main() {
  const store = createStore(config);
  const bot = new Bot(config, store);
  const phone = process.env.SIM_PHONE || '6281230000000';
  const scriptFile = process.argv.find((a) => a === '--script')
    ? process.argv[process.argv.indexOf('--script') + 1]
    : null;

  console.log(`\n=== Simulator ${config.store.name} (DEMO — bukan WA nyata) ===`);
  console.log('Ketik pesan pelanggan. Perintah khusus: /reset, /rekap, /keluar\n');

  const handle = async (text) => {
    if (text === '/reset') { bot.resetSession(phone); console.log('— sesi direset —'); return; }
    if (text === '/rekap') { console.log('\n' + bot.dailyRecap().text + '\n'); return; }
    const { reply, escalate, order } = await bot.handleMessage(phone, text);
    console.log(`\n🤖 Bot: ${reply}`);
    if (escalate) console.log('   [🔔 eskalasi ke admin manusia]');
    if (order) console.log(`   [🧾 order ${order.number} tercatat]`);
    console.log('');
  };

  if (scriptFile) {
    const lines = fs.readFileSync(scriptFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      console.log(`👤 Pelanggan: ${line}`);
      await handle(line);
    }
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '👤 Anda: ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (text === '/keluar' || text === '/exit') { rl.close(); return; }
    if (text) await handle(text);
    rl.prompt();
  });
  rl.on('close', () => { console.log('\nSimulator selesai.'); process.exit(0); });
}

main().catch((err) => { console.error(err); process.exit(1); });
