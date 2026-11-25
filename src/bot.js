/**
 * ai-cs-bot-wa — inti logika bot customer service WhatsApp.
 * Murni (tanpa I/O jaringan): bisa dipakai oleh webhook WABA (server.js),
 * workflow n8n (sebagai referensi perilaku), maupun simulator lokal.
 * Satu instance Bot = satu toko (config). Memori percakapan disimpan
 * per nomor pelanggan (Map) — sama seperti node Memory di n8n.
 */

'use strict';

const DEFAULT_ESCALATION_KEYWORDS = [
  'admin', 'manusia', 'cs', 'komplain', 'bicara dengan', 'hubungi',
  'orang', 'bantuan manusia', 'mau ngomong sama orang',
];

/** Normalisasi teks untuk pencocokan: huruf kecil, tanpa tanda baca. */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Rp65.000" */
function formatRupiah(n) {
  return 'Rp' + Number(n).toLocaleString('id-ID');
}

class Bot {
  /**
   * @param {object} config - isi config/<toko>.json
   * @param {object} store  - adapter data (lihat src/store.js): wajib
   *   menyediakan findProduct, listProducts, findFaq, createOrder, listOrders.
   */
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.sessions = new Map(); // nomor -> { state, cart, orderDraft }
    this.escalationKeywords =
      config.escalationKeywords || DEFAULT_ESCALATION_KEYWORDS;
  }

  // ------------------------------------------------------------ sesi
  getSession(phone) {
    if (!this.sessions.has(phone)) {
      this.sessions.set(phone, { state: 'idle', cart: [], draft: null });
    }
    return this.sessions.get(phone);
  }

  resetSession(phone) {
    this.sessions.delete(phone);
  }

  // ------------------------------------------------------------ util toko
  formatCatalog() {
    const lines = this.store.listProducts().map((p) => {
      const stok = p.stock > 0 ? `stok ${p.stock}` : 'HABIS';
      return `${p.id}. ${p.name} — ${formatRupiah(p.price)} (${stok})`;
    });
    return (
      `☕ *Katalog ${this.config.store.name}*\n\n` +
      lines.join('\n') +
      `\n\nBalas dengan nama produk untuk detail, contoh: "harga arabika gayo"\n` +
      `atau langsung order, contoh: "order kopi susu 2".`
    );
  }

  formatProduct(p) {
    const stok = p.stock > 0 ? `Stok: ${p.stock}` : 'Stok: HABIS';
    return (
      `*${p.name}*\n${p.description}\n` +
      `Harga: ${formatRupiah(p.price)} • ${stok}\n\n` +
      `Mau order? Ketik: order ${p.name.toLowerCase()} 1`
    );
  }

  /** Cari produk dari teks bebas (cocokkan nama/kata kunci). */
  matchProduct(text) {
    const norm = normalize(text);
    return this.store.listProducts().find((p) => {
      const nameWords = normalize(p.name).split(' ');
      // cocok bila ≥2 kata penting dari nama produk muncul di teks,
      // atau kata kunci khas produk muncul (mis. "gayo", "cold brew").
      const hits = nameWords.filter(
        (w) => w.length > 3 && norm.includes(w),
      ).length;
      const shortHits = nameWords.filter(
        (w) => w.length <= 3 && new RegExp(`\\b${w}\\b`).test(norm),
      ).length;
      return hits + shortHits >= 2 || hits >= 1 && nameWords.length <= 2;
    });
  }

  matchFaq(text) {
    const norm = normalize(text);
    const words = new Set(norm.split(' '));
    let best = null;
    let bestScore = 0;
    for (const faq of this.store.listFaq()) {
      let score = 0;
      for (const kw of faq.keywords) {
        const kwNorm = normalize(kw);
        // Frasa persis (mis. "jam buka") bernilai paling tinggi;
        // bila tidak persis, cocok bila SEMUA kata kuncinya muncul
        // (tahan terhadap urutan kata: "jam berapa toko buka?").
        if (norm.includes(kwNorm)) score += kwNorm.split(' ').length * 2;
        else if (kwNorm.split(' ').every((w) => words.has(w))) {
          score += kwNorm.split(' ').length;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = faq;
      }
    }
    return bestScore > 0 ? best : null;
  }

  // ------------------------------------------------------------ order
  /** Parse "order <produk> <jumlah?>". Kembalikan { product, qty } atau null. */
  parseOrderIntent(text) {
    const norm = normalize(text);
    const m = norm.match(/^(order|pesan|beli|mau)\b(.*)$/);
    if (!m) return null;
    const rest = m[2].trim();
    const qtyMatch = rest.match(/\b(\d+)\s*$/);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
    const productText = qtyMatch ? rest.slice(0, qtyMatch.index).trim() : rest;
    const product = this.matchProduct(productText);
    if (!product) return { product: null, qty, raw: productText };
    return { product, qty, raw: productText };
  }

  computeTotals(items) {
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const free = subtotal >= this.config.store.freeShippingThreshold;
    const shipping = free ? 0 : this.config.store.shippingFeePekanbaru;
    return { subtotal, shipping, free, total: subtotal + shipping };
  }

  async confirmOrder(session, phone) {
    const totals = this.computeTotals(session.cart);
    const order = await this.store.createOrder({
      phone,
      items: session.cart.map((it) => ({
        name: it.name,
        qty: it.qty,
        price: it.price,
      })),
      ...totals,
      status: 'BELUM BAYAR',
      payment: session.draft.payment,
      customerName: session.draft.name,
      address: session.draft.address,
    });
    session.cart = [];
    session.draft = null;
    session.state = 'idle';
    const lines = order.items
      .map((it) => `• ${it.name} x${it.qty} — ${formatRupiah(it.price * it.qty)}`)
      .join('\n');
    return (
      `✅ *Pesanan diterima!*\n\n` +
      `Nomor order: *${order.number}*\n${lines}\n` +
      `Subtotal: ${formatRupiah(order.subtotal)}\n` +
      `Ongkir: ${order.shipping === 0 ? 'GRATIS 🎉' : formatRupiah(order.shipping)}\n` +
      `*Total: ${formatRupiah(order.total)}*\n\n` +
      `Pembayaran: ${order.payment}\n` +
      `Nama: ${order.customerName}\nAlamat: ${order.address}\n\n` +
      `Silakan lakukan pembayaran, lalu kirim bukti transfer ke chat ini. ` +
      `Kami kabari lagi begitu pesanan dikirim. Terima kasih! ☕`
    );
  }

  // ------------------------------------------------------------ pesan masuk
  /**
   * Proses satu pesan masuk. Kembalikan { reply, escalate, order? }.
   * `escalate: true` berarti bot menyerahkan ke admin manusia.
   */
  async handleMessage(phone, text) {
    const session = this.getSession(phone);
    const raw = (text || '').trim();
    const norm = normalize(raw);

    // --- eskalasi ke admin manusia (selalu didahulukan) ---
    if (this.escalationKeywords.some((k) => norm.includes(normalize(k)))) {
      session.state = 'idle';
      return {
        reply:
          `Baik, saya sambungkan ke admin manusia kami. ` +
          `Mohon tunggu sebentar ya — admin ${this.config.store.name} ` +
          `biasanya membalas dalam 5–15 menit di jam buka (${this.config.store.hours}). 🙏`,
        escalate: true,
      };
    }

    // --- alur order (state machine) ---
    if (session.state === 'awaiting_name') {
      session.draft.name = raw;
      session.state = 'awaiting_address';
      return { reply: 'Terima kasih, Kak! Sekarang alamat pengiriman lengkapnya (jalan, RT/RW, kota)?' };
    }
    if (session.state === 'awaiting_address') {
      session.draft.address = raw;
      session.state = 'awaiting_payment';
      const methods = this.config.store.paymentMethods.join(', ');
      return { reply: `Alamat dicatat. 📍\n\nPilih metode pembayaran:\n• ${methods.replace(/, /g, '\n• ')}\n\nBalas dengan salah satunya, contoh: "QRIS".` };
    }
    if (session.state === 'awaiting_payment') {
      const method = this.config.store.paymentMethods.find((m) =>
        norm.includes(normalize(m.split(' ')[0])),
      );
      if (!method) {
        return { reply: `Maaf, metode itu belum tersedia. Pilih salah satu: ${this.config.store.paymentMethods.join(', ')}.` };
      }
      session.draft.payment = method;
      session.state = 'awaiting_confirm';
      const totals = this.computeTotals(session.cart);
      const lines = session.cart
        .map((it) => `• ${it.name} x${it.qty} — ${formatRupiah(it.price * it.qty)}`)
        .join('\n');
      return {
        reply:
          `Mohon cek pesanan Anda:\n\n${lines}\n` +
          `Subtotal: ${formatRupiah(totals.subtotal)}\n` +
          `Ongkir: ${totals.shipping === 0 ? 'GRATIS 🎉' : formatRupiah(totals.shipping)}\n` +
          `*Total: ${formatRupiah(totals.total)}*\n` +
          `Pembayaran: ${method}\nNama: ${session.draft.name}\nAlamat: ${session.draft.address}\n\n` +
          `Balas *ya* untuk konfirmasi, atau *batal* untuk membatalkan.`,
      };
    }
    if (session.state === 'awaiting_confirm') {
      if (/^(ya|iya|benar|betul|ok|oke|confirm|lanjut)$/.test(norm)) {
        const reply = await this.confirmOrder(session, phone);
        const order = this.store.lastOrder;
        return { reply, order };
      }
      if (/^(batal|cancel|tidak|gak|nggak)$/.test(norm)) {
        session.cart = [];
        session.draft = null;
        session.state = 'idle';
        return { reply: 'Baik, pesanan dibatalkan. Tidak ada yang dicatat. Kalau berubah pikiran, ketik *katalog* ya. 😊' };
      }
      return { reply: 'Balas *ya* untuk konfirmasi pesanan, atau *batal* untuk membatalkan.' };
    }

    // --- sapaan / bantuan ---
    if (/^(halo|hai|hi|hello|pagi|siang|sore|malam|assalamualaikum|selamat pagi|selamat siang|selamat sore|selamat malam|menu|bantuan|help|start|mulai)\b/.test(norm)) {
      return { reply: this.config.greeting };
    }

    // --- katalog ---
    if (/\bkatalog\b|\bdaftar produk\b|\bproduk apa saja\b|\bmenu\b/.test(norm)) {
      return { reply: this.formatCatalog() };
    }

    // --- intent order ---
    if (/^(order|pesan|beli|mau)\b/.test(norm)) {
      const parsed = this.parseOrderIntent(raw);
      if (!parsed || !parsed.product) {
        return {
          reply:
            `Maaf, produknya belum saya kenali. 😅 Ketik *katalog* untuk melihat semua produk, ` +
            `lalu order dengan contoh: "order arabika gayo 2".`,
        };
      }
      if (parsed.product.stock < parsed.qty) {
        return {
          reply:
            `Mohon maaf, stok ${parsed.product.name} tinggal ${parsed.product.stock}, ` +
            `tidak cukup untuk ${parsed.qty}. Mau dikurangi jumlahnya atau pilih produk lain?`,
        };
      }
      session.cart = [{ name: parsed.product.name, price: parsed.product.price, qty: parsed.qty }];
      session.draft = { productId: parsed.product.id };
      session.state = 'awaiting_name';
      const totals = this.computeTotals(session.cart);
      return {
        reply:
          `Siap! ${parsed.product.name} x${parsed.qty} — ${formatRupiah(totals.subtotal)}.\n\n` +
          `Boleh tahu nama Kakak (untuk label pengiriman)?`,
      };
    }

    // --- tanya harga / stok produk tertentu ---
    if (/\bharga\b|\bstok\b|\bberapa\b/.test(norm)) {
      const product = this.matchProduct(raw);
      if (product) return { reply: this.formatProduct(product) };
    }
    {
      const product = this.matchProduct(raw);
      if (product && norm.length < 60) return { reply: this.formatProduct(product) };
    }

    // --- status order ---
    if (/status|cek order|pesanan saya|lacak/.test(norm)) {
      const orders = this.store.listOrders().filter((o) => o.phone === phone);
      if (!orders.length) {
        return { reply: 'Belum ada pesanan dari nomor ini. Ketik *katalog* untuk mulai order. 😊' };
      }
      const last = orders[orders.length - 1];
      return {
        reply:
          `Pesanan terakhir Anda: *${last.number}* — ${formatRupiah(last.total)} — status: *${last.status}*.\n` +
          `Ada pertanyaan soal pesanan ini? Ketik *admin* untuk bicara dengan manusia.`,
      };
    }

    // --- FAQ dari knowledge base ---
    const faq = this.matchFaq(raw);
    if (faq) return { reply: faq.answer };

    // --- tidak dipahami -> balas sopan + tawaran eskalasi ---
    return { reply: this.config.unknownReply };
  }

  // ------------------------------------------------------------ rekap & follow-up
  /** Rekap harian untuk owner: dipakai cron n8n / scripts/daily-recap.js. */
  dailyRecap(dateKey) {
    const orders = this.store.listOrders();
    const today = dateKey || new Date().toISOString().slice(0, 10);
    const list = orders.filter((o) => o.dateKey === today);
    const unpaid = list.filter((o) => o.status === 'BELUM BAYAR');
    const paid = list.filter((o) => o.status !== 'BELUM BAYAR');
    const revenue = paid.reduce((s, o) => s + o.total, 0);
    const lines = [
      `📊 *Rekap Harian ${this.config.store.name} — ${today}*`,
      ``,
      `Total order: ${list.length}`,
      `Sudah bayar: ${paid.length} (${formatRupiah(revenue)})`,
      `Belum bayar: ${unpaid.length}`,
      ``,
    ];
    for (const o of list) {
      lines.push(`• ${o.number} — ${o.customerName || o.phone} — ${formatRupiah(o.total)} — ${o.status}`);
    }
    if (!list.length) lines.push('Belum ada order hari ini.');
    return { text: lines.join('\n'), orders: list, unpaid, paid, revenue };
  }

  /** Pesan follow-up untuk satu order yang belum bayar. */
  unpaidFollowUp(order) {
    return (
      `Halo Kak ${order.customerName || ''}! 👋\n\n` +
      `Kami dari *${this.config.store.name}* mengingatkan pesanan *${order.number}* ` +
      `(${formatRupiah(order.total)}) belum dibayar. ` +
      `Pesanan akan kami tahan sampai akhir hari ini. ` +
      `Bila sudah transfer, silakan kirim bukti pembayarannya ke chat ini ya. Terima kasih! ☕`
    );
  }
}

module.exports = { Bot, normalize, formatRupiah };
