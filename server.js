const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SLIPS = path.join(DATA, 'slips');
const DB = path.join(DATA, 'orders.json');

fs.mkdirSync(SLIPS, { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '[]');

// ================= STRIPE WEBHOOK (จับคู่การชำระเงินแบบเรียลไทม์) =================
// ต้องลงทะเบียน "ก่อน" express.json() เพราะการตรวจลายเซ็นต้องใช้ raw body
// เปิดใช้งานเมื่อกำหนด ENV: STRIPE_WEBHOOK_SECRET (จาก Stripe Dashboard → Webhooks)
// ตรวจลายเซ็นด้วย HMAC-SHA256 ตามมาตรฐาน Stripe โดยไม่ต้องพึ่งไลบรารี stripe
function stripeVerify(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  String(sigHeader).split(',').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > 0) { const k = kv.slice(0, i).trim(); const v = kv.slice(i + 1).trim(); (parts[k] = parts[k] || []).push(v); }
  });
  const t = parts.t && parts.t[0];
  const v1 = parts.v1 || [];
  if (!t || !v1.length) return false;
  // ป้องกัน replay: ยอมรับ timestamp ภายใน 5 นาที
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > 300) return false;
  const signed = t + '.' + rawBody.toString('utf8');
  const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  const eb = Buffer.from(expected);
  return v1.some(function (sig) {
    try { const sb = Buffer.from(sig); return sb.length === eb.length && crypto.timingSafeEqual(sb, eb); } catch (e) { return false; }
  });
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), function (req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send('stripe webhook not configured');
  if (!stripeVerify(req.body, req.headers['stripe-signature'], secret)) return res.status(400).send('invalid signature');
  let evt;
  try { evt = JSON.parse(req.body.toString('utf8')); } catch (e) { return res.status(400).send('invalid payload'); }

  const type = evt.type;
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    const s = (evt.data && evt.data.object) || {};
    const oid = s.client_reference_id;
    // ชำระผ่านบัตรจะ paid ทันที; หากเป็นวิธีชำระแบบ async ที่ยังไม่ paid ให้รอ event async_payment_succeeded
    const settled = (s.payment_status === 'paid' || s.payment_status === 'no_payment_required' || type === 'checkout.session.async_payment_succeeded');
    if (oid && settled) {
      const list = read();
      const o = list.find(function (x) { return x.id === oid; });
      if (o) {
        const was = o.status;
        o.status = 'paid';
        o.stripe = {
          sessionId: s.id || null,
          paymentIntent: s.payment_intent || null,
          amount: (s.amount_total != null ? s.amount_total / 100 : null),
          currency: s.currency || null,
          at: new Date().toISOString()
        };
        if (s.customer_details && s.customer_details.email && !o.email) o.email = s.customer_details.email;
        if (!o.invoiceNo) { o.invoiceNo = nextInvoiceNo(); o.invoiceAt = new Date().toISOString(); }
        write(list);
        console.log('[stripe] order ' + oid + ' paid via webhook (' + was + '→paid), pi=' + (s.payment_intent || '-'));
        if (o.email && !o.emailedReceiptAt && emailConfigured()) {
          const base = process.env.PUBLIC_BASE_URL || ('https://' + req.headers.host);
          sendReceiptEmail(o, base).then(function (ok) {
            if (ok) { const l = read(); const x = l.find(function (y) { return y.id === o.id; }); if (x) { x.emailedReceiptAt = new Date().toISOString(); write(l); } }
          });
        }
      } else {
        console.log('[stripe] webhook: order not found for client_reference_id=' + oid);
      }
    }
  }
  // คืนเงิน — Stripe ส่ง charge.refunded เมื่อมีการคืนเงิน (จับคู่ด้วย payment_intent)
  if (type === 'charge.refunded') {
    const c = (evt.data && evt.data.object) || {};
    const pi = c.payment_intent || null;
    if (pi) {
      const list = read();
      const o = list.find(function (x) { return x.stripe && x.stripe.paymentIntent === pi; });
      if (o) {
        o.status = 'refunded';
        o.refund = { at: new Date().toISOString(), amount: (c.amount_refunded != null ? c.amount_refunded / 100 : null), full: (c.amount_refunded === c.amount) };
        write(list);
        console.log('[stripe] order ' + o.id + ' refunded via webhook, pi=' + pi);
      }
    }
  }
  // ยกเลิก — ลูกค้าไม่ชำระจน checkout session หมดอายุ
  if (type === 'checkout.session.expired') {
    const s = (evt.data && evt.data.object) || {};
    const oid = s.client_reference_id;
    if (oid) {
      const list = read();
      const o = list.find(function (x) { return x.id === oid; });
      if (o && o.status === 'pending') { o.status = 'cancelled'; o.cancelledAt = new Date().toISOString(); write(list); console.log('[stripe] order ' + oid + ' cancelled (checkout expired)'); }
    }
  }
  // ชำระไม่สำเร็จ
  if (type === 'payment_intent.payment_failed') {
    const piObj = (evt.data && evt.data.object) || {};
    const list = read();
    const o = list.find(function (x) { return x.stripe && x.stripe.paymentIntent === piObj.id; });
    if (o && o.status === 'pending') { o.status = 'failed'; o.failedAt = new Date().toISOString(); write(list); console.log('[stripe] order ' + o.id + ' payment_failed'); }
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '10mb' }));

function read() { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) { return []; } }
function write(d) { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }

// ================= AUTO-EMAIL RECEIPT (ฟรี ผ่าน Resend/Brevo) =================
// เปิดใช้งานเมื่อกำหนด ENV ใน Railway: EMAIL_API_KEY (จำเป็น), EMAIL_PROVIDER=resend|brevo (ค่าเริ่มต้น resend),
// EMAIL_FROM=CloverX <receipt@cloverxth.com>, PUBLIC_BASE_URL=https://<โดเมนจริง> (ถ้าไม่ตั้งจะเดาจาก request)
function emailConfigured() { return !!process.env.EMAIL_API_KEY; }
function parseFrom(from) {
  var m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || 'CloverX', email: m[2] } : { name: 'CloverX', email: String(from) };
}
function receiptEmailHTML(o, link) {
  var total = (Number(o.total) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var items = (o.items || []).map(function (it) { return '<li>' + String(it.nm) + (it.fam ? ' (ครอบครัว)' : '') + '</li>'; }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111">'
    + '<h2 style="color:#2563EB;margin:0 0 4px">CloverX</h2>'
    + '<p style="color:#374151">เรียนคุณ ' + String(o.name || 'ลูกค้า') + ',</p>'
    + '<p style="color:#374151">ขอบคุณสำหรับคำสั่งซื้อ <b>' + String(o.id) + '</b> ทางเราได้รับการชำระเงินเรียบร้อยแล้ว</p>'
    + '<ul style="color:#374151">' + items + '</ul>'
    + '<p style="color:#111;font-weight:700">ยอดรวมทั้งสิ้น: ฿' + total + '</p>'
    + '<p style="margin:22px 0"><a href="' + link + '" style="background:#2563EB;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">ดู/ ดาวน์โหลดใบเสร็จ · ใบกำกับภาษี</a></p>'
    + '<p style="color:#9ca3af;font-size:12px">หากปุ่มไม่ทำงาน เปิดลิงก์นี้: ' + link + '</p>'
    + '<hr style="border:none;border-top:1px solid #e5e7eb"><p style="color:#9ca3af;font-size:12px">บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด · เลขประจำตัวผู้เสียภาษี 0105568236410 · www.cloverxth.com</p></div>';
}
function sendReceiptEmail(o, base) {
  return new Promise(function (resolve) {
    if (!emailConfigured() || !o.email) { resolve(false); return; }
    var provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
    var from = process.env.EMAIL_FROM || 'CloverX <onboarding@resend.dev>';
    var link = base + '/invoice/' + encodeURIComponent(o.id);
    var subject = 'ใบเสร็จ/ใบกำกับภาษี คำสั่งซื้อ ' + o.id + ' · CloverX';
    var html = receiptEmailHTML(o, link);
    var host, urlPath, headers, payload;
    if (provider === 'brevo') {
      host = 'api.brevo.com'; urlPath = '/v3/smtp/email';
      headers = { 'api-key': process.env.EMAIL_API_KEY, 'content-type': 'application/json' };
      payload = JSON.stringify({ sender: parseFrom(from), to: [{ email: o.email }], subject: subject, htmlContent: html });
    } else {
      host = 'api.resend.com'; urlPath = '/emails';
      headers = { 'Authorization': 'Bearer ' + process.env.EMAIL_API_KEY, 'content-type': 'application/json' };
      payload = JSON.stringify({ from: from, to: [o.email], subject: subject, html: html });
    }
    var r = https.request({ hostname: host, path: urlPath, method: 'POST', headers: headers }, function (resp) {
      var b = ''; resp.on('data', function (d) { b += d; });
      resp.on('end', function () { var ok = resp.statusCode >= 200 && resp.statusCode < 300; if (!ok) console.log('[email] fail', resp.statusCode, b.slice(0, 200)); resolve(ok); });
    });
    r.on('error', function (e) { console.log('[email] error', e.message); resolve(false); });
    r.write(payload); r.end();
  });
}

// ================= STRIPE CHECKOUT SESSION (ลิงก์ชำระเงินรวมยอดอัตโนมัติ) =================
// เปิดใช้งานเมื่อกำหนด ENV: STRIPE_SECRET_KEY (sk_live_... หรือ sk_test_...)
// สร้างลิงก์ชำระเงิน Stripe รวมทุกชิ้นในออเดอร์เป็นลิงก์เดียว + ผูก client_reference_id = เลขออเดอร์
// เพื่อให้ webhook จับคู่การชำระเงินแบบเรียลไทม์ได้ (ไม่ต้องแยกลิงก์ตามสินค้าอีก)
function stripeConfigured() { return !!process.env.STRIPE_SECRET_KEY; }
function createCheckoutSession(o, base) {
  return new Promise(function (resolve) {
    if (!stripeConfigured()) { resolve(null); return; }
    var items = (o.items || []).filter(function (it) { return (Number(it.price) || 0) > 0; });
    if (!items.length) { resolve(null); return; }
    var params = [];
    params.push(['mode', 'payment']);
    params.push(['client_reference_id', o.id]);
    params.push(['success_url', base + '/preorder?paid=' + encodeURIComponent(o.id)]);
    params.push(['cancel_url', base + '/preorder']);
    params.push(['metadata[order_id]', o.id]);
    if (o.email) params.push(['customer_email', o.email]);
    else if (o.payEmail) params.push(['customer_email', o.payEmail]);
    items.forEach(function (it, i) {
      var name = String(it.nm || 'CloverX') + (it.fam ? ' (ครอบครัว)' : '');
      params.push(['line_items[' + i + '][price_data][currency]', 'thb']);
      params.push(['line_items[' + i + '][price_data][product_data][name]', name]);
      params.push(['line_items[' + i + '][price_data][unit_amount]', String(Math.round((Number(it.price) || 0) * 100))]);
      params.push(['line_items[' + i + '][quantity]', '1']);
    });
    var body = params.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
    var req = https.request({
      hostname: 'api.stripe.com', path: '/v1/checkout/sessions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, function (resp) {
      var b = ''; resp.on('data', function (d) { b += d; });
      resp.on('end', function () {
        try {
          var j = JSON.parse(b);
          if (resp.statusCode >= 200 && resp.statusCode < 300 && j.url) { resolve({ url: j.url, id: j.id }); }
          else { console.log('[stripe] checkout session fail', resp.statusCode, b.slice(0, 200)); resolve(null); }
        } catch (e) { console.log('[stripe] checkout parse error', e.message); resolve(null); }
      });
    });
    req.on('error', function (e) { console.log('[stripe] checkout error', e.message); resolve(null); });
    req.write(body); req.end();
  });
}

// ---- create an order (from customer Pre-Order page) ----
app.post('/api/orders', (req, res) => {
  const o = req.body || {};
  const list = read();
  const seq = (list.length ? Math.max.apply(null, list.map(x => x.seq || 0)) : 0) + 1;
  const id = 'PO-' + String(1000000 + seq).slice(-6);

  let slipUrl = null;
  if (typeof o.slip === 'string' && /^data:image\//.test(o.slip)) {
    const m = o.slip.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (m) {
      const ext = m[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const fn = id + '.' + ext;
      try { fs.writeFileSync(path.join(SLIPS, fn), Buffer.from(m[2], 'base64')); slipUrl = '/api/slips/' + fn; } catch (e) {}
    }
  }

  const rec = {
    seq, id, at: new Date().toISOString(),
    // บัตรเครดิต: เริ่มที่ 'pending' รอ Stripe ยืนยันจริงผ่าน webhook แล้วค่อยเปลี่ยนเป็น 'paid' อัตโนมัติ
    // (ตัวแทนยังยืนยันเองจากหน้า Operations ได้ หาก webhook ยังไม่ตั้งค่า)
    status: 'pending',
    name: o.name || '', phone: o.phone || '', email: o.email || '', addr: o.addr || '',
    ref: o.ref || '', ship: o.ship || 'post', pickup: o.pickup || null,
    pay: o.pay || 'bank', items: Array.isArray(o.items) ? o.items : [], total: Number(o.total) || 0,
    transfer: o.transfer || null, slipUrl,
    famMembers: Array.isArray(o.famMembers) ? o.famMembers : [],
    payEmail: o.payEmail || '', tax: o.tax || null
  };
  list.unshift(rec);
  write(list);

  // บัตรเครดิต: สร้างลิงก์ชำระเงิน Stripe รวมยอดทั้งออเดอร์ (ทุกชิ้น) เป็นลิงก์เดียวอัตโนมัติ
  if (rec.pay === 'card' && stripeConfigured()) {
    const base = process.env.PUBLIC_BASE_URL || (((req.headers['x-forwarded-proto'] || 'https')) + '://' + req.headers.host);
    createCheckoutSession(rec, base).then(function (s) {
      if (s) {
        const l = read(); const x = l.find(function (y) { return y.id === rec.id; });
        if (x) { x.stripe = Object.assign({}, x.stripe, { checkoutSessionId: s.id, checkoutUrl: s.url }); write(l); }
        res.json({ ok: true, id: rec.id, payUrl: s.url });
      } else {
        res.json({ ok: true, id: rec.id }); // สร้างลิงก์ไม่สำเร็จ → ยังบันทึกออเดอร์ปกติ
      }
    });
  } else {
    res.json({ ok: true, id: rec.id });
  }
});

// ---- PDPA masking: หน้าเว็บ/รายงานต้องไม่มีเบอร์เต็ม อีเมล ที่อยู่เต็ม ----
function maskName(n){ n=String(n||'').trim(); if(!n)return 'ลูกค้า'; var p=n.split(/\s+/); return p[0]+(p.length>1?(' '+p[p.length-1].charAt(0)+'.'):''); }
function last4(p){ p=String(p||'').replace(/\D/g,''); return p?p.slice(-4):''; }
var TH_PROV=["กรุงเทพมหานคร","กรุงเทพ","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา","ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก","นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"];
function provinceOf(a){ a=String(a||''); for(var i=0;i<TH_PROV.length;i++){ if(a.indexOf(TH_PROV[i])>=0)return TH_PROV[i]==='กรุงเทพ'?'กรุงเทพมหานคร':TH_PROV[i]; } return 'ไม่ระบุ'; }
function maskOrder(o){
  return {
    id:o.id, seq:o.seq, at:o.at, status:o.status,
    name:maskName(o.name), phone:last4(o.phone), addr:provinceOf(o.addr),
    ref:o.ref||'', pay:o.pay||'bank', items:Array.isArray(o.items)?o.items:[], total:Number(o.total)||0,
    invoiceNo:o.invoiceNo||null, imported:!!o.imported
  };
}
// ---- list orders — ค่าเริ่มต้นมาสก์ PII (PDPA); ต้องมี ?key=ADMIN_KEY จึงจะเห็นข้อมูลเต็ม (สำหรับจัดส่ง/ยืนยัน) ----
app.get('/api/orders', (req, res) => {
  const full = process.env.ADMIN_KEY && req.query.key === process.env.ADMIN_KEY;
  const data = read();
  res.json(full ? data : data.map(maskOrder));
});

// ---- ADMIN: import orders (guarded by ADMIN_KEY) — mode=append (default) หรือ replace ----
app.post('/api/admin/import', (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  const incoming = Array.isArray(req.body) ? req.body : (req.body && Array.isArray(req.body.orders) ? req.body.orders : null);
  if (!incoming) return res.status(400).json({ ok: false, error: 'expected array of orders' });
  const mode = req.query.mode === 'replace' ? 'replace' : 'append';
  let list = mode === 'replace' ? [] : read();
  const existing = {}; list.forEach(function (o) { existing[o.id] = true; });
  let baseSeq = list.length ? Math.max.apply(null, list.map(function (x) { return x.seq || 0; })) : 0;
  let added = 0, skipped = 0;
  incoming.forEach(function (o) {
    if (!o || !o.id) { skipped++; return; }
    if (existing[o.id]) { skipped++; return; }
    baseSeq++;
    list.push(Object.assign({}, o, { seq: o.seq || baseSeq, imported: true, at: o.at || new Date().toISOString() }));
    existing[o.id] = true; added++;
  });
  write(list);
  res.json({ ok: true, added: added, skipped: skipped, total: list.length, mode: mode });
});

// ---- update status (confirm / reject) ----
app.patch('/api/orders/:id', (req, res) => {
  const list = read();
  const o = list.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ ok: false });
  if (req.body && req.body.status) o.status = req.body.status;
  const nowPaid = (o.status === 'confirmed' || o.status === 'paid');
  // ยืนยันชำระเงินแล้ว → ออกเลขที่ใบกำกับภาษี
  if (nowPaid && !o.invoiceNo) { o.invoiceNo = nextInvoiceNo(); o.invoiceAt = new Date().toISOString(); }
  write(list);
  res.json({ ok: true, order: o });
  // ส่งใบเสร็จทางอีเมลอัตโนมัติ (ครั้งเดียว) เมื่อยืนยันการชำระเงินแล้ว — ทำงานเมื่อกำหนด EMAIL_API_KEY
  if (nowPaid && o.email && !o.emailedReceiptAt && emailConfigured()) {
    const base = process.env.PUBLIC_BASE_URL || (((req.headers['x-forwarded-proto'] || 'https')) + '://' + req.headers.host);
    sendReceiptEmail(o, base).then(function (ok) {
      if (ok) { const l = read(); const x = l.find(y => y.id === o.id); if (x) { x.emailedReceiptAt = new Date().toISOString(); write(l); } }
    });
  }
});

// ---- ADMIN: reset all orders + invoice counter (guarded by ADMIN_KEY) ----
app.post('/api/admin/reset', (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  const n = read().length;
  write([]);
  try { fs.writeFileSync(CNT, JSON.stringify({})); } catch (e) {}
  res.json({ ok: true, cleared: n, message: 'orders and invoice counter reset' });
});

// ---- serve slip images ----
app.get('/api/slips/:fn', (req, res) => {
  const p = path.join(SLIPS, path.basename(req.params.fn));
  if (!fs.existsSync(p)) return res.status(404).end();
  res.sendFile(p);
});

// ================= RECEIPT / TAX INVOICE =================
const CNT = path.join(DATA, 'counter.json');
function nextInvoiceNo() {
  let c = { invoice: 0 };
  try { c = JSON.parse(fs.readFileSync(CNT, 'utf8')); } catch (e) {}
  c.invoice = (c.invoice || 0) + 1;
  try { fs.writeFileSync(CNT, JSON.stringify(c)); } catch (e) {}
  const d = new Date();
  const ym = '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2);
  return 'IV-' + ym + '-' + ('0000' + c.invoice).slice(-4);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function bahtText(num) {
  num = Math.round((num + Number.EPSILON) * 100) / 100;
  var baht = Math.floor(num), satang = Math.round((num - baht) * 100);
  var digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function group(g) {
    var s = String(g), len = s.length, res = '';
    for (var i = 0; i < len; i++) {
      var d = +s.charAt(i), p = len - 1 - i;
      if (d === 0) continue;
      if (p === 0 && d === 1 && len > 1) res += 'เอ็ด';
      else if (p === 1 && d === 1) res += 'สิบ';
      else if (p === 1 && d === 2) res += 'ยี่สิบ';
      else res += digits[d] + places[p];
    }
    return res;
  }
  function readNum(n) { if (n === 0) return 'ศูนย์'; var res = '', m = Math.floor(n / 1000000), r = n % 1000000; if (m > 0) res += readNum(m) + 'ล้าน'; if (r > 0) res += group(r); return res; }
  var txt = readNum(baht) + 'บาท';
  txt += satang > 0 ? (group(satang) + 'สตางค์') : 'ถ้วน';
  return txt;
}
var THB2 = function (n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

function invoiceHTML(o) {
  var d = o.invoiceAt ? new Date(o.invoiceAt) : new Date();
  var dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  var buyerName = (o.tax && o.tax.name) ? o.tax.name : (o.name || '-');
  var buyerAddr = (o.tax && o.tax.addr) ? o.tax.addr : (o.addr || '-');
  var buyerTax = (o.tax && o.tax.taxId) ? o.tax.taxId : '';
  var total = Number(o.total) || 0;
  var base = Math.round((total / 1.07) * 100) / 100;
  var vat = Math.round((total - base) * 100) / 100;
  var rows = (o.items || []).map(function (it, i) {
    var lineBase = Math.round((Number(it.price) / 1.07) * 100) / 100;
    return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(it.nm) + (it.fam ? ' <span class="fam">(ครอบครัว)</span>' : '') + '</td><td class="c">1</td><td class="r">' + THB2(lineBase) + '</td><td class="r">' + THB2(lineBase) + '</td></tr>';
  }).join('');
  var payLabel = o.pay === 'card' ? 'บัตรเครดิต/เดบิต (Stripe)' : 'โอนเงินผ่านธนาคาร';
  var official = !!o.invoiceNo;
  var docTitle = official ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี' : 'ใบยืนยันคำสั่งซื้อ';
  var docSub = official ? 'RECEIPT / TAX INVOICE (ต้นฉบับ)' : 'ORDER CONFIRMATION · ยังไม่ใช่ใบกำกับภาษี';
  var noStr = official ? esc(o.invoiceNo) : 'รอออกหลังยืนยันชำระเงิน';
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + docTitle + ' ' + esc(o.invoiceNo || o.id) + '</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Noto Sans Thai",sans-serif;color:#111827;background:#eef2f8;padding:24px;line-height:1.5}'
    + '.sheet{background:#fff;max-width:800px;margin:0 auto;padding:40px 44px;box-shadow:0 10px 40px -20px rgba(0,0,0,.4);border-radius:8px}'
    + '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:2px solid #111827;padding-bottom:18px}'
    + '.co h1{font-size:1.4rem;letter-spacing:.02em}.co .en{color:#6b7280;font-size:.82rem}.co p{font-size:.82rem;color:#374151;margin-top:6px;max-width:44ch}'
    + '.brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:1.5rem}.brand svg{width:26px;height:26px;color:#2563EB}'
    + '.doc{text-align:right;flex:none}.doc h2{font-size:1.15rem;color:#2563EB}.doc .sub{font-size:.78rem;color:#6b7280}.doc .meta{margin-top:10px;font-size:.85rem}'
    + '.doc .meta b{display:inline-block;min-width:64px;color:#6b7280;font-weight:500}'
    + '.parties{display:flex;gap:24px;margin:20px 0}.box{flex:1;background:#f7f9fc;border:1px solid #e5e9f0;border-radius:10px;padding:14px 16px}'
    + '.box h3{font-size:.78rem;color:#6b7280;font-weight:600;margin-bottom:6px}.box .nm{font-weight:700}.box p{font-size:.85rem;color:#374151;margin-top:3px}'
    + 'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:.88rem}'
    + 'th{background:#111827;color:#fff;font-weight:600;padding:9px 10px;text-align:left;font-size:.8rem}th.c,td.c{text-align:center}th.r,td.r{text-align:right}'
    + 'td{padding:9px 10px;border-bottom:1px solid #eef1f6}.fam{color:#6b7280;font-size:.85em}'
    + '.tot{margin-top:14px;margin-left:auto;width:300px;font-size:.9rem}.tot .r{display:flex;justify-content:space-between;padding:5px 0}'
    + '.tot .grand{border-top:2px solid #111827;margin-top:6px;padding-top:8px;font-weight:800;font-size:1.05rem}'
    + '.words{background:#EAF1FF;border:1px solid #d3e2ff;border-radius:8px;padding:10px 14px;margin-top:14px;font-weight:700;color:#123A9E;text-align:center}'
    + '.pay{margin-top:14px;font-size:.85rem;color:#374151}'
    + '.sign{display:flex;justify-content:space-between;margin-top:48px;gap:30px}.sign .s{flex:1;text-align:center;font-size:.82rem;color:#374151}.sign .line{border-top:1px dotted #9aa3b2;margin:0 10px 6px;padding-top:8px}'
    + '.foot{margin-top:26px;border-top:1px solid #e5e9f0;padding-top:12px;font-size:.72rem;color:#9aa3b2;text-align:center}'
    + '.printbar{max-width:800px;margin:0 auto 16px;text-align:right}.btn{background:#2563EB;color:#fff;border:0;border-radius:10px;padding:11px 20px;font-family:inherit;font-weight:700;cursor:pointer;font-size:.9rem}'
    + '@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none;padding:24px}.printbar{display:none}}'
    + '</style></head><body>'
    + '<div class="printbar"><button class="btn" onclick="window.print()">🖨️ พิมพ์ / บันทึก PDF</button></div>'
    + '<div class="sheet">'
    + '<div class="top"><div class="co">'
    + '<h1>บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด</h1><div class="en">CLOVERX (THAILAND) CO., LTD. (สำนักงานใหญ่)</div>'
    + '<p>762/84 หมู่บ้านเดอะปาล์ม (ภัสสร 37) ซอยพัฒนาการ 38 แขวงสวนหลวง เขตสวนหลวง กรุงเทพมหานคร 10250<br>โทร. 065-514-6576 · info@cloverxth.com</p>'
    + '<p>เลขประจำตัวผู้เสียภาษี: 0105568236410</p></div>'
    + '<div class="doc"><h2>' + docTitle + '</h2><div class="sub">' + docSub + '</div>'
    + '<div class="meta"><div><b>เลขที่</b> ' + noStr + '</div><div><b>วันที่</b> ' + esc(dateStr) + '</div><div><b>อ้างอิง</b> ' + esc(o.id) + '</div></div></div></div>'
    + (official ? '' : '<div style="background:#FFF7E6;border:1px solid #F5D48A;color:#8A5A00;border-radius:8px;padding:10px 14px;margin:16px 0 0;font-size:.82rem;font-weight:600">⏳ เอกสารนี้เป็นการยืนยันคำสั่งซื้อ ยังไม่ใช่ใบกำกับภาษี — ใบกำกับภาษี/ใบเสร็จฉบับสมบูรณ์จะออกให้อัตโนมัติเมื่อยืนยันการชำระเงินเรียบร้อยแล้ว</div>')
    + '<div class="parties"><div class="box"><h3>ลูกค้า / CUSTOMER</h3><div class="nm">' + esc(buyerName) + '</div>'
    + (buyerTax ? '<p>เลขประจำตัวผู้เสียภาษี: ' + esc(buyerTax) + '</p>' : '')
    + '<p>' + esc(buyerAddr) + '</p>' + (o.phone ? '<p>โทร. ' + esc(o.phone) + '</p>' : '') + '</div>'
    + '<div class="box"><h3>การชำระเงิน / PAYMENT</h3><div class="nm">' + payLabel + '</div>'
    + (o.transfer ? '<p>โอนวันที่ ' + esc(o.transfer.date || '') + ' ' + esc(o.transfer.time || '') + '</p>' : '')
    + (o.payEmail ? '<p>อีเมลชำระเงิน: ' + esc(o.payEmail) + '</p>' : '')
    + '<p>สถานะ: ' + (o.status === 'confirmed' ? 'ยืนยันแล้ว' : (o.status === 'paid' ? 'ชำระผ่านบัตร' : 'รอตรวจสอบ')) + '</p></div></div>'
    + '<table><thead><tr><th class="c" style="width:40px">#</th><th>รายการ</th><th class="c" style="width:60px">จำนวน</th><th class="r" style="width:110px">ราคา/หน่วย</th><th class="r" style="width:120px">จำนวนเงิน</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<div class="tot"><div class="r"><span>มูลค่าสินค้า (ก่อน VAT)</span><span>' + THB2(base) + '</span></div>'
    + '<div class="r"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>' + THB2(vat) + '</span></div>'
    + '<div class="r grand"><span>รวมทั้งสิ้น</span><span>฿' + THB2(total) + '</span></div></div>'
    + '<div class="words">(' + bahtText(total) + ')</div>'
    + '<div class="sign"><div class="s"><div class="line">&nbsp;</div>ผู้รับเงิน / ผู้มีอำนาจลงนาม</div><div class="s"><div class="line">&nbsp;</div>ผู้รับสินค้า / ลูกค้า</div></div>'
    + '<div class="foot">เอกสารนี้ออกโดยระบบอัตโนมัติของ CloverX · ราคารวมภาษีมูลค่าเพิ่มแล้ว · www.cloverxth.com</div>'
    + '</div></body></html>';
}

// issue (assign number if needed) + render printable invoice
app.get('/invoice/:id', (req, res) => {
  const list = read();
  const o = list.find(x => x.id === req.params.id);
  if (!o) return res.status(404).send('ไม่พบคำสั่งซื้อ');
  // ออกเลขที่ใบกำกับภาษี (running number) เฉพาะเมื่อชำระเงินยืนยันแล้วเท่านั้น เพื่อรักษาลำดับเลขที่ให้ถูกต้อง
  const paid = (o.status === 'confirmed' || o.status === 'paid');
  if (paid && !o.invoiceNo) { o.invoiceNo = nextInvoiceNo(); o.invoiceAt = new Date().toISOString(); write(list); }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(invoiceHTML(o));
});
// JSON: check/assign invoice number (used by Operations button)
app.post('/api/orders/:id/invoice', (req, res) => {
  const list = read();
  const o = list.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ ok: false });
  if (!o.invoiceNo) { o.invoiceNo = nextInvoiceNo(); o.invoiceAt = new Date().toISOString(); write(list); }
  res.json({ ok: true, invoiceNo: o.invoiceNo });
});

// ---- static site (index.html, center.html, operations.html, preorder.html) ----
app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log('CloverX site + API on ' + PORT));
