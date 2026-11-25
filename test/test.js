/**
 * Smoke test otomatis — jalankan: npm test
 * Skenario: sapaan → katalog → tanya harga → FAQ → order lengkap
 * (produk → nama → alamat → pembayaran → konfirmasi) → rekap harian.
 * Mengassert harga, total, nomor order, dan isi rekap.
 * Menggunakan store in-memory supaya data/orders.csv demo tidak tercemar.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { Bot } = require('../src/bot');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'kopi-senja.json'), 'utf8'),
);

function makeStore() {
  const products = config.products.map((p) => ({ ...p }));
  const orders = [];
  return {
    listProducts: () => products,
    listFaq: () => config.faq,
    listOrders: () => orders,
    lastOrder: null,
    async createOrder(data) {
      const order = {
        number: `#${config.store.orderPrefix}-${String(orders.length + 1).padStart(4, '0')}`,
        dateKey: new Date().toISOString().slice(0, 10),
        ...data,
      };
      orders.push(order);
      this.lastOrder = order;
      return order;
    },
  };
}

const PHONE = '6281200000001';

test('config demo lengkap: 10 produk, 20 FAQ', () => {
  assert.equal(config.products.length, 10);
  assert.equal(config.faq.length, 20);
  assert.equal(config.store.name, 'Kopi Senja');
  assert.equal(config.products[0].name, 'Kopi Arabika Gayo 250g');
  assert.equal(config.products[0].price, 65000);
  assert.equal(config.products[0].stock, 24);
});

test('sapaan + katalog menampilkan harga', async () => {
  const bot = new Bot(config, makeStore());
  const hi = await bot.handleMessage(PHONE, 'halo');
  assert.match(hi.reply, /Kopi Senja/);
  const cat = await bot.handleMessage(PHONE, 'katalog');
  assert.match(cat.reply, /Kopi Arabika Gayo 250g/);
  assert.match(cat.reply, /Rp65\.000/);
  assert.match(cat.reply, /Paket Ngopi di Rumah/);
  assert.match(cat.reply, /Rp139\.000/);
});

test('tanya harga & stok satu produk', async () => {
  const bot = new Bot(config, makeStore());
  const r = await bot.handleMessage(PHONE, 'harga arabika gayo');
  assert.match(r.reply, /Rp65\.000/);
  assert.match(r.reply, /Stok: 24/);
});

test('FAQ: jam buka dan ongkir', async () => {
  const bot = new Bot(config, makeStore());
  const jam = await bot.handleMessage(PHONE, 'jam berapa toko buka?');
  assert.match(jam.reply, /08\.00–21\.00/);
  const ongkir = await bot.handleMessage(PHONE, 'berapa ongkir pekanbaru?');
  assert.match(ongkir.reply, /Rp10\.000/);
  assert.match(ongkir.reply, /Rp100\.000/);
});

test('alur order lengkap: 2x Kopi Susu Gula Aren, ongkir normal', async () => {
  const bot = new Bot(config, makeStore());
  let r = await bot.handleMessage(PHONE, 'order kopi susu gula aren 2');
  assert.match(r.reply, /Rp70\.000/); // 2 x 35.000
  r = await bot.handleMessage(PHONE, 'Budi Santoso');
  assert.match(r.reply, /alamat/i);
  r = await bot.handleMessage(PHONE, 'Jl. Merdeka No. 5, Pekanbaru');
  assert.match(r.reply, /QRIS/);
  r = await bot.handleMessage(PHONE, 'QRIS');
  assert.match(r.reply, /Total: Rp80\.000/); // 70.000 + ongkir 10.000
  r = await bot.handleMessage(PHONE, 'ya');
  assert.match(r.reply, /#KS-0001/);
  assert.match(r.reply, /Total: Rp80\.000/);
  assert.equal(r.order.number, '#KS-0001');
  assert.equal(r.order.total, 80000);
  assert.equal(r.order.status, 'BELUM BAYAR');
});

test('gratis ongkir di atas Rp100.000', async () => {
  const bot = new Bot(config, makeStore());
  await bot.handleMessage(PHONE, 'order paket ngopi di rumah 1');
  await bot.handleMessage(PHONE, 'Siti');
  await bot.handleMessage(PHONE, 'Jl. Sudirman No. 1, Pekanbaru');
  const r = await bot.handleMessage(PHONE, 'transfer BCA');
  assert.match(r.reply, /GRATIS/);
  assert.match(r.reply, /Total: Rp139\.000/);
});

test('stok tidak cukup ditolak dengan sopan', async () => {
  const bot = new Bot(config, makeStore());
  const r = await bot.handleMessage(PHONE, 'order french press 20');
  assert.match(r.reply, /stok.*tinggal 8/i);
});

test('eskalasi ke admin manusia', async () => {
  const bot = new Bot(config, makeStore());
  const r = await bot.handleMessage(PHONE, 'saya mau bicara dengan admin');
  assert.equal(r.escalate, true);
  assert.match(r.reply, /admin manusia/i);
});

test('pesan tak dikenal dijawab sopan + tawaran admin', async () => {
  const bot = new Bot(config, makeStore());
  const r = await bot.handleMessage(PHONE, 'xyzqwerty tidak jelas');
  assert.match(r.reply, /admin/);
});

test('rekap harian berisi order + total + status belum bayar', async () => {
  const bot = new Bot(config, makeStore());
  await bot.handleMessage(PHONE, 'order kopi tubruk senja 1');
  await bot.handleMessage(PHONE, 'Andi');
  await bot.handleMessage(PHONE, 'Jl. Senja No. 12, Pekanbaru');
  await bot.handleMessage(PHONE, 'COD');
  await bot.handleMessage(PHONE, 'ya');
  const recap = bot.dailyRecap();
  assert.match(recap.text, /#KS-0001/);
  assert.match(recap.text, /Rp42\.000/); // 32.000 + ongkir 10.000
  assert.match(recap.text, /Belum bayar: 1/);
  assert.equal(recap.unpaid.length, 1);
  const followUp = bot.unpaidFollowUp(recap.unpaid[0]);
  assert.match(followUp, /#KS-0001/);
  assert.match(followUp, /Rp42\.000/);
});

test('batal order membersihkan sesi', async () => {
  const bot = new Bot(config, makeStore());
  await bot.handleMessage(PHONE, 'order cold brew 1');
  await bot.handleMessage(PHONE, 'Rina');
  await bot.handleMessage(PHONE, 'Jl. A, Pekanbaru');
  await bot.handleMessage(PHONE, 'QRIS');
  const r = await bot.handleMessage(PHONE, 'batal');
  assert.match(r.reply, /dibatalkan/);
  const status = await bot.handleMessage(PHONE, 'cek status pesanan saya');
  assert.match(status.reply, /Belum ada pesanan/);
});
