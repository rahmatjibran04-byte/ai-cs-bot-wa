/**
 * ai-cs-bot-wa — adapter data.
 *
 * Sumber data utama (bila dikonfigurasi): Google Sheets via service account.
 *   ENV: SHEETS_ID (id spreadsheet), GOOGLE_APPLICATION_CREDENTIALS
 *   (path file JSON service account). Tab yang dibaca:
 *   "Produk" (id, name, category, price, stock, description),
 *   "FAQ" (topic, question, keywords, answer),
 *   "Orders" (tempat mencatat order baru).
 *
 * Fallback (dipakai demo & bila Sheets tidak dikonfigurasi):
 *   config/<toko>.json untuk produk + FAQ, dan data/orders.csv
 *   untuk pencatatan order. Tidak ada akun Google yang dibutuhkan.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_CSV = path.join(DATA_DIR, 'orders.csv');
const CSV_HEADER = 'number,date,phone,customer_name,items,subtotal,shipping,total,payment,status,address\n';

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

class LocalStore {
  constructor(config) {
    this.config = config;
    this.products = config.products.map((p) => ({ ...p }));
    this.faq = config.faq.map((f) => ({ ...f }));
    this.orders = this.loadOrdersCsv();
    this.lastOrder = this.orders[this.orders.length - 1] || null;
  }

  loadOrdersCsv() {
    if (!fs.existsSync(ORDERS_CSV)) return [];
    const lines = fs.readFileSync(ORDERS_CSV, 'utf8').trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).filter(Boolean).map((line) => {
      const c = parseCsvLine(line);
      return {
        number: c[0],
        dateKey: (c[1] || '').slice(0, 10),
        phone: c[2],
        customerName: c[3],
        items: JSON.parse(c[4] || '[]'),
        subtotal: Number(c[5]),
        shipping: Number(c[6]),
        total: Number(c[7]),
        payment: c[8],
        status: c[9],
        address: c[10],
      };
    });
  }

  listProducts() { return this.products; }
  listFaq() { return this.faq; }
  listOrders() { return this.orders; }

  nextOrderNumber() {
    const prefix = this.config.store.orderPrefix || 'KS';
    const n = this.orders.length + 1;
    return `#${prefix}-${String(n).padStart(4, '0')}`;
  }

  async createOrder(data) {
    const order = {
      number: this.nextOrderNumber(),
      dateKey: new Date().toISOString().slice(0, 10),
      phone: data.phone,
      customerName: data.customerName || '',
      items: data.items,
      subtotal: data.subtotal,
      shipping: data.shipping,
      total: data.total,
      payment: data.payment || '',
      status: data.status || 'BELUM BAYAR',
      address: data.address || '',
    };
    // Kurangi stok (demo lokal; di Sheets ini dilakukan via update cell).
    for (const it of data.items) {
      const p = this.products.find((x) => x.name === it.name);
      if (p) p.stock = Math.max(0, p.stock - it.qty);
    }
    this.orders.push(order);
    this.lastOrder = order;
    if (!fs.existsSync(ORDERS_CSV)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(ORDERS_CSV, CSV_HEADER);
    }
    fs.appendFileSync(
      ORDERS_CSV,
      [
        order.number, order.dateKey, order.phone, order.customerName,
        JSON.stringify(order.items), order.subtotal, order.shipping,
        order.total, order.payment, order.status, order.address,
      ].map(csvEscape).join(',') + '\n',
    );
    return order;
  }

  async markPaid(orderNumber) {
    const o = this.orders.find((x) => x.number === orderNumber);
    if (o) o.status = 'SUDAH BAYAR';
    return o || null;
  }
}

/**
 * Google Sheets store — dipakai bila ENV SHEETS_ID tersedia.
 * Struktur tab "Produk", "FAQ", "Orders" harus sama seperti CSV/JSON lokal.
 * Bila googleapis tidak terinstall atau kredensial tidak ada, konstruktor
 * melempar dan pemanggil (server.js) jatuh ke LocalStore.
 */
class SheetsStore extends LocalStore {
  constructor(config) {
    super(config);
    this.sheetsId = process.env.SHEETS_ID;
    if (!this.sheetsId) throw new Error('SHEETS_ID belum disetel');
    // Lazy require: googleapis opsional — tanpa itu, LocalStore yang jalan.
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth });
    this.ready = this.loadFromSheets();
  }

  async loadFromSheets() {
    const res = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: this.sheetsId,
      ranges: ['Produk!A1:F100', 'FAQ!A1:E100', 'Orders!A1:K200'],
    });
    const [produk, faq, orders] = res.data.valueRanges.map((r) => r.values || []);
    if (produk && produk.length > 1) {
      this.products = produk.slice(1).map((row) => ({
        id: Number(row[0]), name: row[1], category: row[2],
        price: Number(row[3]), stock: Number(row[4]), description: row[5] || '',
      }));
    }
    if (faq && faq.length > 1) {
      this.faq = faq.slice(1).map((row) => ({
        topic: row[0], question: row[1],
        keywords: (row[2] || '').split(';').map((s) => s.trim()).filter(Boolean),
        answer: row[3] || '',
      }));
    }
    if (orders && orders.length > 1) {
      this.orders = orders.slice(1).map((c) => ({
        number: c[0], dateKey: (c[1] || '').slice(0, 10), phone: c[2],
        customerName: c[3], items: JSON.parse(c[4] || '[]'),
        subtotal: Number(c[5]), shipping: Number(c[6]), total: Number(c[7]),
        payment: c[8], status: c[9], address: c[10],
      }));
      this.lastOrder = this.orders[this.orders.length - 1] || null;
    }
  }

  async createOrder(data) {
    const order = await super.createOrder(data);
    // Catat juga ke tab Orders di Sheets (append).
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.sheetsId,
      range: 'Orders!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          order.number, order.dateKey, order.phone, order.customerName,
          JSON.stringify(order.items), order.subtotal, order.shipping,
          order.total, order.payment, order.status, order.address,
        ]],
      },
    });
    return order;
  }
}

/** Factory: Sheets bila ENV lengkap, LocalStore bila tidak. */
function createStore(config) {
  if (process.env.SHEETS_ID) {
    try {
      const s = new SheetsStore(config);
      console.log('[store] Google Sheets aktif:', process.env.SHEETS_ID);
      return s;
    } catch (err) {
      console.warn('[store] Sheets gagal, pakai data lokal:', err.message);
    }
  }
  console.log('[store] Mode lokal (config JSON + data/orders.csv).');
  return new LocalStore(config);
}

module.exports = { LocalStore, SheetsStore, createStore, ORDERS_CSV };
