/**
 * Test workflow n8n — jalankan: node --test test/workflow-test.js
 *
 * Menguji TANPA instance n8n / akun Meta / OpenAI:
 *  (1) struktur workflow: JSON valid, TIDAK ADA node yatim, koneksi mengacu
 *      ke node yang ada, kredensial placeholder lengkap, tidak ada lagi
 *      referensi `$json.orderNumber` yang tak pernah dihasilkan;
 *  (2) jsCode tiap Code node diekstrak dari JSON lalu dijalankan dengan
 *      input sampel (harness $input/$/$env meniru variabel n8n);
 *  (3) simulasi alur utama berurutan: pesan teks biasa + pesan gambar +
 *      alur konfirmasi order.
 *
 * Yang TIDAK bisa diuji di sini (butuh instance n8n live — lihat README):
 * import sungguhan ke n8n, eksekusi end-to-end, node WhatsApp Trigger
 * resmi, pengiriman WhatsApp, dan lookup Sheets yang sebenarnya.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const wf = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'n8n', 'kopi-senja-workflow.json'), 'utf8'),
);
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'kopi-senja.json'), 'utf8'),
);

const nodesByName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
const codeOf = (name) => nodesByName[name].parameters.jsCode;

// Produk + FAQ dalam bentuk baris Sheets (seperti yang dikembalikan node lookup).
const productRows = config.products.map((p) => ({ ...p }));
const faqRows = config.faq.map((f) => ({
  topic: f.topic,
  question: f.question,
  keywords: f.keywords.join('; '),
  answer: f.answer,
}));

/**
 * Harness peniru variabel n8n untuk jsCode Code node.
 * @param {string} jsCode - kode dari node
 * @param {object} opts - { input: [{json}], nodes: {nama: [{json}|json]}, env }
 */
function runCode(jsCode, { input = [{ json: {} }], nodes = {}, env = {} } = {}) {
  const wrap = (arr) => arr.map((it) => ({ json: it.json !== undefined ? it.json : it }));
  const $input = {
    all: () => wrap(input),
    first: () => wrap(input)[0] || { json: {} },
    last: () => wrap(input).slice(-1)[0] || { json: {} },
  };
  const $ = (name) => {
    const items = wrap(nodes[name] || []);
    return {
      first: () => items[0] || { json: {} },
      last: () => items.slice(-1)[0] || { json: {} },
      all: () => items,
      item: items[0] || { json: {} },
    };
  };
  const fn = new Function('$input', '$', '$env', jsCode); // eslint-disable-line no-new-func
  return fn($input, $, { STORE_NAME: 'Kopi Senja', ...env });
}

function metaPayload(text, { from = '6281200000001', id = 'wamid.TEST1', type = 'text' } = {}) {
  const msg = { from, id, type };
  if (type === 'text') msg.text = { body: text };
  return { entry: [{ changes: [{ value: { messages: [msg] } }] }] };
}

// ------------------------------------------------------------ struktur
test('struktur: JSON valid, 28 node, nama + id unik', () => {
  assert.equal(wf.nodes.length, 28);
  assert.equal(new Set(wf.nodes.map((n) => n.name)).size, 28);
  assert.equal(new Set(wf.nodes.map((n) => n.id)).size, 28);
  assert.equal(wf.name, 'Kopi Senja — AI Customer Service WA (DEMO)');
  assert.equal(wf.active, false);
});

test('struktur: tidak ada node yatim (sticky note dikecualikan)', () => {
  const names = new Set(wf.nodes.map((n) => n.name));
  const triggers = new Set(['WhatsApp Trigger', 'Cron: Rekap Harian 21.00']);
  const terminals = new Set(['Respond 200 ke Meta', 'Follow-up Belum Bayar']);
  // Node memori menempel via koneksi ai_memory (bukan main) — bukan yatim.
  const attached = new Set(['Memori per Nomor (Window Buffer)']);
  const hasInput = new Set();
  const hasOutput = new Set();
  for (const [src, conns] of Object.entries(wf.connections)) {
    assert.ok(names.has(src), `koneksi dari node tak dikenal: ${src}`);
    for (const outputs of Object.values(conns)) {
      for (const branch of outputs) {
        for (const t of branch) {
          assert.ok(names.has(t.node), `koneksi ke node tak dikenal: ${t.node}`);
          hasInput.add(t.node);
          hasOutput.add(src);
        }
      }
    }
  }
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.stickyNote') continue;
    if (!triggers.has(n.name) && !attached.has(n.name)) {
      assert.ok(hasInput.has(n.name), `node yatim (tanpa input): ${n.name}`);
    }
    if (!terminals.has(n.name)) {
      assert.ok(hasOutput.has(n.name), `node buntu (tanpa output): ${n.name}`);
    }
  }
});

test('struktur: rantai order + rekap tersambung ujung ke ujung', () => {
  const out = (name) => Object.values(wf.connections[name] || {})
    .flat(2).map((t) => t.node);
  assert.deepEqual(out('WhatsApp Trigger'), ['Parse Pesan Masuk']);
  assert.deepEqual(out('Pesan Teks?'), ['Minta Admin?', 'Balas: Pesan Non-Teks']);
  assert.deepEqual(out('Minta Admin?'), ['Eskalasi: WA ke Admin', 'Knowledge Base: Katalog (Sheets)']);
  assert.deepEqual(out('Eskalasi: WA ke Admin'), ['Respond 200 ke Meta']);
  assert.deepEqual(out('Balas: Pesan Non-Teks'), ['Respond 200 ke Meta']);
  assert.deepEqual(out('AI Agent Aktif?'), ['AI Agent (OpenAI)', 'Jawaban Deterministik (tanpa AI)']);
  assert.deepEqual(out('AI Agent (OpenAI)'), ['Bersihkan Balasan']);
  assert.deepEqual(out('Bersihkan Balasan'), ['Order Terkonfirmasi?']);
  assert.deepEqual(out('Order Terkonfirmasi?'), ['Baca Orders', 'Balas via Cloud API']);
  assert.deepEqual(out('Baca Orders'), ['Buat Nomor Order']);
  assert.deepEqual(out('Buat Nomor Order'), ['Catat Order ke Sheets']);
  assert.deepEqual(out('Catat Order ke Sheets'), ['Siapkan Balasan Order']);
  assert.deepEqual(out('Siapkan Balasan Order'), ['Balas via Cloud API']);
  assert.deepEqual(out('Cron: Rekap Harian 21.00'), ['Baca Orders (Rekap)']);
  assert.deepEqual(out('Baca Orders (Rekap)'), ['Hitung Rekap Harian']);
  assert.deepEqual(out('Hitung Rekap Harian'), ['Kirim Rekap ke Owner']);
  assert.deepEqual(out('Kirim Rekap ke Owner'), ['Uraikan Order Belum Bayar']);
  assert.deepEqual(out('Uraikan Order Belum Bayar'), ['Split: Order Belum Bayar']);
  assert.deepEqual(out('Split: Order Belum Bayar'), ['Follow-up Belum Bayar']);
});

test('struktur: tidak ada lagi referensi $json.orderNumber', () => {
  const raw = JSON.stringify(wf);
  assert.ok(!raw.includes('orderNumber'), 'masih ada referensi orderNumber!');
  // $json.output hanya boleh muncul di dalam jsCode "Bersihkan Balasan"
  // (membaca field output AI Agent) — bukan di parameter node mana pun.
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.code') continue;
    assert.ok(
      !JSON.stringify(n.parameters).includes('$json.output'),
      `parameter node ${n.name} masih memakai $json.output`,
    );
  }
  assert.equal(
    nodesByName['Balas via Cloud API'].parameters.textBody,
    '={{ $json.reply }}',
  );
});

test('struktur: trigger resmi + kredensial placeholder lengkap', () => {
  const trig = nodesByName['WhatsApp Trigger'];
  assert.equal(trig.type, 'n8n-nodes-base.whatsAppTrigger');
  assert.equal(trig.typeVersion, 1);
  assert.deepEqual(trig.parameters.updates, ['messages']);
  assert.equal(trig.credentials.whatsAppTriggerApi.id, 'ISI-ID-KREDENSIAL-WABA-TRIGGER');
  for (const name of ['Knowledge Base: Katalog (Sheets)', 'Knowledge Base: FAQ (Sheets)',
    'Baca Orders', 'Baca Orders (Rekap)', 'Catat Order ke Sheets']) {
    assert.equal(nodesByName[name].credentials.googleSheetsOAuth2.id, 'ISI-ID-KREDENSIAL-SHEETS', name);
    assert.equal(nodesByName[name].credentials.googleSheetsOAuth2.name, 'Google Sheets OAuth2', name);
  }
  assert.equal(nodesByName['AI Agent (OpenAI)'].credentials.openAiApi.id, 'ISI-ID-KREDENSIAL-OPENAI');
  for (const name of ['Balas via Cloud API', 'Eskalasi: WA ke Admin', 'Kirim Rekap ke Owner',
    'Follow-up Belum Bayar', 'Balas: Pesan Non-Teks']) {
    assert.equal(nodesByName[name].credentials.whatsAppApi.id, 'ISI-ID-KREDENSIAL-WABA', name);
  }
  const sticky = wf.nodes.find((n) => n.type === 'n8n-nodes-base.stickyNote');
  assert.ok(sticky, 'sticky note checklist tidak ada');
  assert.match(sticky.parameters.content, /OPENAI_ENABLED/);
  assert.match(sticky.parameters.content, /ISI-ID-KREDENSIAL-SHEETS/);
  assert.match(wf.meta.notes, /OPENAI_ENABLED/);
  assert.match(nodesByName['AI Agent (OpenAI)'].parameters.text, /ORDER_CONFIRMED/);
  assert.match(nodesByName['AI Agent (OpenAI)'].parameters.text, /Parse Pesan Masuk/);
});

test('struktur: mapping Catat Order sesuai header tab Orders', () => {
  const value = nodesByName['Catat Order ke Sheets'].parameters.columns.value;
  assert.deepEqual(
    Object.keys(value).sort(),
    ['address', 'customer_name', 'date', 'items', 'number', 'payment', 'phone',
      'shipping', 'status', 'subtotal', 'total'].sort(),
  );
  assert.equal(value.number, '={{ $json.order.number }}');
  assert.equal(value.status, '={{ $json.order.status }}');
});

test('struktur: guard IF memakai ekspresi aman', () => {
  const adminConds = nodesByName['Minta Admin?'].parameters.conditions.conditions;
  for (const c of adminConds) {
    assert.equal(c.leftValue, "={{ ($json.text || '').toLowerCase() }}");
  }
  const aiCond = nodesByName['AI Agent Aktif?'].parameters.conditions.conditions[0];
  assert.match(aiCond.leftValue, /OPENAI_ENABLED/);
});

// ------------------------------------------------------------ Parse
test('Parse: pesan teks via webhook generik (body.entry...)', () => {
  const out = runCode(codeOf('Parse Pesan Masuk'), {
    input: [{ json: { body: metaPayload('halo') } }],
  });
  assert.deepEqual(out, [{ json: {
    from: '6281200000001', text: 'halo', messageType: 'text',
    messageId: 'wamid.TEST1', nonText: false,
  } }]);
});

test('Parse: pesan teks via WhatsApp Trigger (entry... langsung)', () => {
  const out = runCode(codeOf('Parse Pesan Masuk'), {
    input: [{ json: metaPayload('katalog') }],
  });
  assert.equal(out[0].json.text, 'katalog');
  assert.equal(out[0].json.nonText, false);
});

test('Parse: pesan teks langsung {from,type,text}', () => {
  const out = runCode(codeOf('Parse Pesan Masuk'), {
    input: [{ json: { from: '62812', id: 'wamid.X', type: 'text', text: { body: 'harga arabika gayo' } } }],
  });
  assert.equal(out[0].json.text, 'harga arabika gayo');
});

test('Parse: gambar, stiker, voice note, video -> text kosong + nonText', () => {
  for (const type of ['image', 'sticker', 'audio', 'video', 'document']) {
    const out = runCode(codeOf('Parse Pesan Masuk'), {
      input: [{ json: { body: metaPayload('', { type }) } }],
    });
    assert.deepEqual(out, [{ json: {
      from: '6281200000001', text: '', messageType: type,
      messageId: 'wamid.TEST1', nonText: true,
    } }], `tipe ${type}`);
  }
});

test('Parse: payload kosong / rusak tidak melempar, kembalikan nonText', () => {
  for (const json of [{}, { body: {} }, { body: { entry: [] } }, { entry: [{ changes: [] }] }]) {
    const out = runCode(codeOf('Parse Pesan Masuk'), { input: [{ json }] });
    assert.equal(out[0].json.text, '');
    assert.equal(out[0].json.nonText, true);
  }
});

// ------------------------------------------------------------ Bersihkan Balasan
const AI_REPLY_WITH_MARKER =
  'Terima kasih, Kak Budi! Pesanan Anda dikonfirmasi. ✅\n'
  + 'Nomor order: {{ORDER_NUMBER}}\n'
  + 'Total Rp80.000 via QRIS.\n'
  + 'ORDER_CONFIRMED | Kopi Susu Gula Aren 1L x2 | 70000 | 10000 | 80000 | Budi Santoso | Jl. Merdeka No. 5, Pekanbaru | QRIS';

test('Bersihkan Balasan: marker diparse, barisnya dihapus dari balasan', () => {
  const out = runCode(codeOf('Bersihkan Balasan'), {
    input: [{ json: { output: AI_REPLY_WITH_MARKER } }],
  });
  assert.equal(out[0].json.orderMarker.items, 'Kopi Susu Gula Aren 1L x2');
  assert.equal(out[0].json.orderMarker.subtotal, 70000);
  assert.equal(out[0].json.orderMarker.shipping, 10000);
  assert.equal(out[0].json.orderMarker.total, 80000);
  assert.equal(out[0].json.orderMarker.customerName, 'Budi Santoso');
  assert.equal(out[0].json.orderMarker.address, 'Jl. Merdeka No. 5, Pekanbaru');
  assert.equal(out[0].json.orderMarker.payment, 'QRIS');
  assert.ok(!out[0].json.reply.includes('ORDER_CONFIRMED'));
  assert.ok(out[0].json.reply.includes('{{ORDER_NUMBER}}'));
  assert.ok(out[0].json.reply.includes('Total Rp80.000'));
});

test('Bersihkan Balasan: tanpa marker -> orderMarker null, balasan utuh', () => {
  const out = runCode(codeOf('Bersihkan Balasan'), {
    input: [{ json: { output: 'Halo! Ada yang bisa saya bantu?' } }],
  });
  assert.equal(out[0].json.orderMarker, null);
  assert.equal(out[0].json.reply, 'Halo! Ada yang bisa saya bantu?');
});

test('Bersihkan Balasan: marker rusak (field kurang) -> null, baris tetap dibuang', () => {
  const out = runCode(codeOf('Bersihkan Balasan'), {
    input: [{ json: { output: 'Baik.\nORDER_CONFIRMED | cuma dua field' } }],
  });
  assert.equal(out[0].json.orderMarker, null);
  assert.ok(!out[0].json.reply.includes('ORDER_CONFIRMED'));
});

// ------------------------------------------------------------ Buat Nomor Order
function orderNumberRun(rows, reply = 'Nomor order: {{ORDER_NUMBER}} — terima kasih!') {
  return runCode(codeOf('Buat Nomor Order'), {
    input: rows.map((r) => ({ json: r })),
    nodes: {
      'Bersihkan Balasan': [{ json: {
        reply,
        orderMarker: {
          items: 'Kopi Susu Gula Aren 1L x2', subtotal: 70000, shipping: 10000,
          total: 80000, customerName: 'Budi Santoso',
          address: 'Jl. Merdeka No. 5, Pekanbaru', payment: 'QRIS',
        },
      } }],
      'Parse Pesan Masuk': [{ json: { from: '6281200000001' } }],
    },
  });
}

test('Buat Nomor Order: 3 order lama -> #KS-0004, placeholder terganti', () => {
  const out = orderNumberRun([{ number: '#KS-0001' }, { number: '#KS-0002' }, { number: '#KS-0003' }]);
  assert.equal(out[0].json.order.number, '#KS-0004');
  assert.equal(out[0].json.order.status, 'BELUM BAYAR');
  assert.equal(out[0].json.order.phone, '6281200000001');
  assert.equal(out[0].json.order.total, 80000);
  assert.equal(out[0].json.order.payment, 'QRIS');
  assert.match(out[0].json.reply, /#KS-0004/);
  assert.ok(!out[0].json.reply.includes('{{ORDER_NUMBER}}'));
  assert.match(out[0].json.order.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('Buat Nomor Order: tab kosong -> #KS-0001 (input [] dan [{}])', () => {
  assert.equal(orderNumberRun([])[0].json.order.number, '#KS-0001');
  assert.equal(orderNumberRun([{}])[0].json.order.number, '#KS-0001');
});

test('Siapkan Balasan Order: meneruskan reply dari Buat Nomor Order', () => {
  const out = runCode(codeOf('Siapkan Balasan Order'), {
    input: [{ json: { spreadsheetId: 'x', updates: {} } }], // hasil API Sheets
    nodes: { 'Buat Nomor Order': [{ json: { reply: 'Nomor order: #KS-0004', order: {} } }] },
  });
  assert.equal(out[0].json.reply, 'Nomor order: #KS-0004');
  assert.equal(out[0].json.orderMarker, null);
});

// ------------------------------------------------------------ Hitung Rekap
function recapRun(rows) {
  return runCode(codeOf('Hitung Rekap Harian'), {
    input: rows.map((r) => ({ json: r })),
  });
}

test('Hitung Rekap Harian: campuran sudah/belum bayar, hanya order hari ini', () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rows = [
    { number: '#KS-0001', date: today, phone: '62811', customer_name: 'Andi', total: 42000, payment: 'COD', status: 'BELUM BAYAR' },
    { number: '#KS-0002', date: today, phone: '62812', customer_name: 'Siti', total: 139000, payment: 'QRIS', status: 'SUDAH BAYAR' },
    { number: '#KS-0003', date: today, phone: '62813', customer_name: 'Rina', total: 80000, payment: 'QRIS', status: 'BELUM BAYAR' },
    { number: '#KS-0000', date: yesterday, phone: '62810', customer_name: 'Lama', total: 999000, payment: 'QRIS', status: 'BELUM BAYAR' },
  ];
  const out = recapRun(rows)[0].json;
  assert.match(out.recapText, /Total order: 3/);
  assert.match(out.recapText, /Sudah bayar: 1 \(Rp139\.000\)/);
  assert.match(out.recapText, /Belum bayar: 2/);
  assert.match(out.recapText, /#KS-0001/);
  assert.ok(!out.recapText.includes('#KS-0000'), 'order kemarin ikut terhitung');
  assert.equal(out.unpaid.length, 2);
  assert.equal(out.unpaid[0].number, '#KS-0001');
  assert.equal(out.unpaid[0].phone, '62811');
  assert.match(out.unpaid[0].followUpText, /Halo Kak Andi/);
  assert.match(out.unpaid[0].followUpText, /#KS-0001/);
  assert.match(out.unpaid[0].followUpText, /Rp42\.000/);
  assert.match(out.unpaid[0].followUpText, /bukti pembayaran/);
});

test('Hitung Rekap Harian: tanpa order -> rekap kosong + unpaid []', () => {
  const out = recapRun([])[0].json;
  assert.match(out.recapText, /Total order: 0/);
  assert.match(out.recapText, /Belum ada order hari ini/);
  assert.deepEqual(out.unpaid, []);
});

test('Uraikan Order Belum Bayar: 1 item per order; kosong -> []', () => {
  const withUnpaid = runCode(codeOf('Uraikan Order Belum Bayar'), {
    input: [{ json: { recapText: 'x' } }],
    nodes: { 'Hitung Rekap Harian': [{ json: { unpaid: [
      { number: '#KS-0001', phone: '62811' },
      { number: '#KS-0003', phone: '62813' },
    ] } }] },
  });
  assert.equal(withUnpaid.length, 2);
  assert.equal(withUnpaid[1].json.number, '#KS-0003');
  const empty = runCode(codeOf('Uraikan Order Belum Bayar'), {
    input: [{ json: { recapText: 'x' } }],
    nodes: { 'Hitung Rekap Harian': [{ json: { unpaid: [] } }] },
  });
  assert.deepEqual(empty, []);
});

// ------------------------------------------------------------ Jawaban Deterministik
function deterministicRun(text) {
  return runCode(codeOf('Jawaban Deterministik (tanpa AI)'), {
    input: faqRows.map((f) => ({ json: f })),
    nodes: {
      'Parse Pesan Masuk': [{ json: { from: '6281200000001', text } }],
      'Knowledge Base: Katalog (Sheets)': productRows.map((p) => ({ json: p })),
      'Knowledge Base: FAQ (Sheets)': faqRows.map((f) => ({ json: f })),
    },
  })[0].json;
}

test('Jawaban Deterministik: sapaan, katalog, harga, FAQ, tak dikenal', () => {
  assert.match(deterministicRun('halo').reply, /Kopi Senja/);
  const cat = deterministicRun('katalog').reply;
  assert.match(cat, /Kopi Arabika Gayo 250g/);
  assert.match(cat, /Rp65\.000/);
  const harga = deterministicRun('harga arabika gayo').reply;
  assert.match(harga, /Rp65\.000/);
  assert.match(harga, /Stok: 24/);
  assert.match(deterministicRun('jam berapa toko buka?').reply, /08\.00–21\.00/);
  const unknown = deterministicRun('xyzqwerty tidak jelas').reply;
  assert.match(unknown, /admin/);
  assert.equal(deterministicRun('halo').orderMarker, null);
});

test('Jawaban Deterministik: intent order dikenali tapi diarahkan ke admin', () => {
  const r = deterministicRun('order kopi susu gula aren 2');
  assert.match(r.reply, /Rp70\.000/);
  assert.match(r.reply, /admin/);
  assert.match(r.reply, /tanpa AI/);
  assert.equal(r.orderMarker, null);
  const noStock = deterministicRun('order french press 20');
  assert.match(noStock.reply, /tinggal 8/);
  const noProduct = deterministicRun('order unicorn latte 1');
  assert.match(noProduct.reply, /belum saya kenali/);
});

// ------------------------------------------------------------ simulasi alur berurutan
test('simulasi: 1 pesan teks biasa (halo) -> Parse -> Deterministik -> balasan sapaan', () => {
  const parsed = runCode(codeOf('Parse Pesan Masuk'), {
    input: [{ json: { body: metaPayload('halo') } }],
  })[0].json;
  assert.equal(parsed.nonText, false);
  assert.ok(parsed.text !== '', 'IF Pesan Teks? harus TRUE');
  assert.ok(!/admin|manusia/.test(parsed.text.toLowerCase()), 'IF Minta Admin? harus FALSE');
  const answer = deterministicRun(parsed.text);
  assert.match(answer.reply, /Kopi Senja/);
  assert.equal(answer.orderMarker, null);
  // IF Order Terkonfirmasi? harus FALSE (orderMarker null) -> langsung Balas via Cloud API
  assert.equal(answer.orderMarker !== null, false);
});

test('simulasi: 1 pesan gambar -> Parse non-teks -> balasan non-teks (teks statis node)', () => {
  const parsed = runCode(codeOf('Parse Pesan Masuk'), {
    input: [{ json: { body: metaPayload('', { type: 'image' }) } }],
  })[0].json;
  assert.equal(parsed.nonText, true);
  assert.equal(parsed.text, '');
  // IF Pesan Teks? harus FALSE -> node Balas: Pesan Non-Teks
  assert.equal(parsed.text !== '', false);
  const nonTextNode = nodesByName['Balas: Pesan Non-Teks'];
  assert.match(nonTextNode.parameters.textBody, /hanya bisa membaca pesan teks/);
  assert.equal(
    nonTextNode.parameters.recipientPhoneNumber,
    "={{ $('Parse Pesan Masuk').item.json.from }}",
  );
  assert.equal(parsed.from, '6281200000001', 'pengirim tersedia untuk balasan');
});

test('simulasi: konfirmasi order AI -> Bersihkan -> Buat Nomor -> balasan berisi nomor asli', () => {
  const cleaned = runCode(codeOf('Bersihkan Balasan'), {
    input: [{ json: { output: AI_REPLY_WITH_MARKER } }],
  })[0].json;
  assert.ok(cleaned.orderMarker !== null, 'IF Order Terkonfirmasi? harus TRUE');
  const made = runCode(codeOf('Buat Nomor Order'), {
    input: [{ json: { number: '#KS-0001' } }, { json: { number: '#KS-0002' } }, { json: { number: '#KS-0003' } }],
    nodes: {
      'Bersihkan Balasan': [{ json: cleaned }],
      'Parse Pesan Masuk': [{ json: { from: '6281200000001' } }],
    },
  })[0].json;
  assert.equal(made.order.number, '#KS-0004');
  assert.match(made.reply, /#KS-0004/);
  assert.ok(!made.reply.includes('ORDER_CONFIRMED'), 'marker bocor ke pelanggan!');
  assert.ok(!made.reply.includes('{{ORDER_NUMBER}}'), 'placeholder belum terganti!');
});
