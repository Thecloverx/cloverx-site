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
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  var fmt = function (iso) { if (!iso) return '-'; var d = new Date(iso); if (isNaN(d)) return String(iso); var b = new Date(d.getTime() + 7 * 3600 * 1000); return z(b.getUTCDate()) + '/' + z(b.getUTCMonth() + 1) + '/' + (b.getUTCFullYear() + 543) + ' ' + z(b.getUTCHours()) + ':' + z(b.getUTCMinutes()) + ' น.'; };
  var orderWhen = fmt(o.at);
  var payWhen = o.pay === 'card'
    ? (o.stripe && o.stripe.at ? fmt(o.stripe.at) : orderWhen)
    : (o.transfer && (o.transfer.date || o.transfer.time) ? ((o.transfer.date || '') + ' ' + (o.transfer.time || '')).trim() : fmt(o.confirmedAt || o.invoiceAt));
  var payLabel = o.pay === 'card' ? 'บัตรเครดิต/เดบิต' : 'โอนเงินผ่านธนาคาร';
  var total = (Number(o.total) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var items = (o.items || []).map(function (it) { return '<tr><td style="padding:5px 0;color:#374151">• ' + String(it.nm) + (it.fam ? ' (ครอบครัว)' : '') + '</td><td style="padding:5px 0;text-align:right;color:#374151;white-space:nowrap">฿' + (Number(it.price) || 0).toLocaleString('en-US') + '</td></tr>'; }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#111">'
    + '<div style="text-align:center;padding:10px 0 2px"><span style="font-size:26px;font-weight:800;color:#0b0e16;letter-spacing:.5px">CLOVER</span><span style="font-size:26px;font-weight:800;color:#3b82f6;margin-left:3px">X</span></div>'
    + '<div style="background:#12B981;color:#fff;border-radius:12px;padding:18px 20px;text-align:center;margin:12px 0 18px"><div style="font-size:20px;font-weight:800">✓ ชำระเงินสำเร็จ</div><div style="font-size:13px;opacity:.95;margin-top:2px">คำสั่งซื้อของคุณได้รับการยืนยันแล้ว</div></div>'
    + '<p style="color:#374151;margin:0 0 12px">เรียนคุณ ' + String(o.name || 'ลูกค้า') + ' ขอบคุณที่สั่งซื้อกับ CloverX ระบบได้รับการชำระเงินเรียบร้อยแล้ว รายละเอียดคำสั่งซื้อมีดังนี้</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;background:#f7f9fc;border:1px solid #e5e9f0;border-radius:10px;overflow:hidden">'
    + '<tr><td style="padding:10px 14px;color:#6b7280;width:46%">เลขที่คำสั่งซื้อ</td><td style="padding:10px 14px;font-weight:700">' + String(o.id) + '</td></tr>'
    + '<tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef1f6">วันและเวลาที่สั่งซื้อ</td><td style="padding:10px 14px;border-top:1px solid #eef1f6">' + orderWhen + '</td></tr>'
    + '<tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef1f6">วิธีชำระเงิน</td><td style="padding:10px 14px;border-top:1px solid #eef1f6">' + payLabel + '</td></tr>'
    + '<tr><td style="padding:10px 14px;color:#6b7280;border-top:1px solid #eef1f6">วันและเวลาที่ชำระเงิน</td><td style="padding:10px 14px;border-top:1px solid #eef1f6">' + payWhen + '</td></tr>'
    + '</table>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:14px"><tr><td colspan="2" style="padding:0 0 4px;font-weight:700;color:#111">รายการสินค้า</td></tr>' + items
    + '<tr><td style="padding:10px 0 0;border-top:2px solid #111;font-weight:800">ยอดเงินทั้งสิ้น</td><td style="padding:10px 0 0;border-top:2px solid #111;text-align:right;font-weight:800;font-size:16px;white-space:nowrap">฿' + total + '</td></tr></table>'
    + '<p style="margin:22px 0"><a href="' + link + '" style="background:#2f4a8f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">ดูใบรับเงินมัดจำ</a></p>'
    + '<p style="color:#9ca3af;font-size:12px">หากปุ่มไม่ทำงาน เปิดลิงก์นี้: ' + link + '</p>'
    + '<hr style="border:none;border-top:1px solid #e5e7eb"><p style="color:#9ca3af;font-size:12px">บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด · เลขประจำตัวผู้เสียภาษี 0105568236410 · www.cloverxth.com</p></div>';
}
function sendReceiptEmail(o, base) {
  return new Promise(function (resolve) {
    if (!emailConfigured() || !o.email) { resolve(false); return; }
    var provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
    var from = process.env.EMAIL_FROM || 'CloverX <onboarding@resend.dev>';
    var link = base + '/invoice/' + encodeURIComponent(o.id);
    var subject = 'ยืนยันชำระเงินสำเร็จ · คำสั่งซื้อ ' + o.id + ' · CloverX';
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
// ---- EasySlip auto-verification for bank-transfer slips (opt-in via EASYSLIP_API_KEY) ----
function easyslipConfigured() { return !!process.env.EASYSLIP_API_KEY; }
function esDigits(x) { return String(x == null ? '' : x).replace(/[^0-9]/g, ''); }
function verifyEasySlip(base64raw) {
  return new Promise(function (resolve) {
    if (!easyslipConfigured()) { resolve({ ok: false, error: 'not_configured' }); return; }
    var urlStr = process.env.EASYSLIP_VERIFY_URL || 'https://developer.easyslip.com/api/v1/verify';
    var u; try { u = new URL(urlStr); } catch (e) { resolve({ ok: false, error: 'bad_url' }); return; }
    var body = JSON.stringify({ image: base64raw });
    var rq = https.request({
      hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.EASYSLIP_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, function (resp) {
      var b = ''; resp.on('data', function (d) { b += d; });
      resp.on('end', function () {
        try { var j = JSON.parse(b); resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, http: resp.statusCode, body: j }); }
        catch (e) { resolve({ ok: false, error: 'parse', http: resp.statusCode, raw: b.slice(0, 300) }); }
      });
    });
    rq.on('error', function (e) { resolve({ ok: false, error: e.message }); });
    rq.setTimeout(15000, function () { rq.destroy(); resolve({ ok: false, error: 'timeout' }); });
    rq.write(body); rq.end();
  });
}
function esExtract(j) {
  var d = (j && j.data) ? j.data : j; if (!d) return null;
  var amount = null;
  if (d.amount != null) { amount = (typeof d.amount === 'object') ? Number(d.amount.amount != null ? d.amount.amount : (d.amount.local && d.amount.local.amount)) : Number(d.amount); }
  var recv = d.receiver || {}; var acc = recv.account || {};
  var recvName = '';
  if (acc.name) { recvName = acc.name.th || acc.name.en || (typeof acc.name === 'string' ? acc.name : ''); }
  var recvNum = (acc.bank && acc.bank.account) || acc.account || acc.number || (recv.bank && recv.bank.account) || '';
  var ref = d.transRef || d.transactionId || d.transaction_id || d.ref1 || d.payload || '';
  return { amount: amount, recvName: String(recvName || ''), recvNum: String(recvNum || ''), ref: String(ref || ''), raw: d };
}
function autoVerifyBank(orderId, base64raw, base) {
  verifyEasySlip(base64raw).then(function (r) {
    var l = read(); var x = l.find(function (y) { return y.id === orderId; }); if (!x) return;
    x.easyslip = { at: new Date().toISOString(), ok: r.ok, http: r.http || null };
    if (!r.ok || !r.body) { x.easyslip.result = 'error'; x.easyslip.error = r.error || ('http ' + r.http); write(l); return; }
    var sD = esExtract(r.body);
    if (!sD) { x.easyslip.result = 'no_data'; write(l); return; }
    x.easyslip.amount = sD.amount; x.easyslip.recvName = sD.recvName; x.easyslip.recvNum = sD.recvNum; x.easyslip.ref = sD.ref;
    var total = Number(x.total) || 0;
    var amtOk = (sD.amount != null && !isNaN(sD.amount)) && Math.abs(sD.amount - total) < 1;
    var want = esDigits(process.env.EASYSLIP_RECV_ACCOUNT || '2311711191');
    var last4 = want.slice(-4); var recvDigits = esDigits(sD.recvNum);
    // รองรับเลขบัญชีแบบปิดบัง (เช่น xxx-x-x1119-x โชว์แค่บางหลัก): ถือว่าตรงถ้าหลักที่โชว์เป็นส่วนหนึ่งของบัญชีจริง
    var acctOk = !!(recvDigits && recvDigits.length >= 4 && want && (want.indexOf(recvDigits) >= 0 || recvDigits.indexOf(last4) >= 0));
    // ชื่อผู้รับ: ตัดช่องว่าง/อักขระซ่อน แล้วเทียบแบบยืดหยุ่น (รองรับชื่อย่อ "บจก." + ชื่อถูกตัดท้าย) + คีย์เวิร์ดแบรนด์
    var esNorm = function (s) { return String(s || '').replace(/[\s​-‏ ().]/g, '').normalize('NFC'); };
    var rn = esNorm(sD.recvName);
    var nk = esNorm(process.env.EASYSLIP_RECV_NAME || 'โคลเวอร์เอ็กซ์');
    var core = esNorm(process.env.EASYSLIP_RECV_NAMECORE || 'โคลเวอร์');
    var nameOk = !!(rn && ((nk && (rn.indexOf(nk) >= 0 || nk.indexOf(rn) >= 0)) || (core && rn.indexOf(core) >= 0)));
    var dup = !!(sD.ref && l.some(function (y) { return y.id !== x.id && y.easyslip && y.easyslip.ref && y.easyslip.ref === sD.ref; }));
    var pass = amtOk && (acctOk || nameOk) && !dup;
    x.easyslip.amtOk = amtOk; x.easyslip.acctOk = acctOk; x.easyslip.nameOk = nameOk; x.easyslip.dup = dup;
    var autoOff = process.env.EASYSLIP_AUTOCONFIRM === '0';
    if (pass && !autoOff) {
      x.status = 'confirmed';
      if (!x.invoiceNo) { x.invoiceNo = nextInvoiceNo(); x.invoiceAt = new Date().toISOString(); }
      x.confirmedAt = new Date().toISOString();
      x.easyslip.result = 'confirmed';
      write(l);
      if (x.email && !x.emailedReceiptAt && emailConfigured()) {
        sendReceiptEmail(x, base).then(function (ok) { if (ok) { var l2 = read(); var x2 = l2.find(function (y) { return y.id === orderId; }); if (x2) { x2.emailedReceiptAt = new Date().toISOString(); write(l2); } } });
      }
    } else {
      x.easyslip.result = pass ? 'verified' : (dup ? 'duplicate' : 'mismatch');
      write(l);
    }
  });
}

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
    team: o.team || '', ref: o.ref || '', ship: o.ship || 'post', pickup: o.pickup || null,
    pay: o.pay || 'bank', items: Array.isArray(o.items) ? o.items : [], total: Number(o.total) || 0,
    transfer: o.transfer || null, slipUrl,
    famMembers: Array.isArray(o.famMembers) ? o.famMembers : [],
    payEmail: o.payEmail || '', tax: o.tax || null
  };
  list.unshift(rec);
  write(list);

  // โอนเงิน: ตรวจสลิปอัตโนมัติผ่าน EasySlip (ถ้าตั้งค่า EASYSLIP_API_KEY) แล้ว auto-confirm เมื่อยอด+บัญชีตรง
  if (rec.pay === 'bank' && easyslipConfigured() && typeof o.slip === 'string') {
    var _m = o.slip.match(/^data:image\/[^;]+;base64,(.*)$/);
    if (_m) { var _base = process.env.PUBLIC_BASE_URL || (((req.headers['x-forwarded-proto'] || 'https')) + '://' + req.headers.host); try { autoVerifyBank(rec.id, _m[1], _base); } catch (e) {} }
  }

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
// ยกเลิกอัตโนมัติ: ออเดอร์บัตรที่ลูกค้ายังไม่จ่าย (pending, ไม่มี paymentIntent) เกิน 3 วัน
function sweepExpiredCard(list) {
  var now = Date.now(), MS = 3 * 24 * 3600 * 1000, changed = false;
  list.forEach(function (o) {
    if (o.pay === 'card' && o.status === 'pending' && !(o.stripe && o.stripe.paymentIntent)) {
      var t = new Date(o.at).getTime();
      if (!isNaN(t) && (now - t) > MS) {
        o.status = 'cancelled';
        o.cancelledAt = new Date().toISOString();
        o.cancelReason = 'payment_timeout';
        changed = true;
        console.log('[sweep] order ' + o.id + ' auto-cancelled (card unpaid > 3 days)');
      }
    }
  });
  if (changed) write(list);
  return list;
}

app.get('/api/orders', (req, res) => {
  const full = true; // admin key removed (temporary)
  const data = sweepExpiredCard(read());
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

// ---- Stripe refund helper ----
function createRefund(pi, amountSatang, meta) {
  return new Promise(function (resolve) {
    if (!stripeConfigured()) { resolve({ ok: false, error: 'stripe_not_configured' }); return; }
    var params = [['payment_intent', pi]];
    if (amountSatang != null) params.push(['amount', String(amountSatang)]);
    params.push(['reason', 'requested_by_customer']);
    if (meta) { Object.keys(meta).forEach(function (k) { if (meta[k] != null && meta[k] !== '') params.push(['metadata[' + k + ']', String(meta[k])]); }); }
    var body = params.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
    var rq = https.request({
      hostname: 'api.stripe.com', path: '/v1/refunds', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, function (resp) {
      var b = ''; resp.on('data', function (d) { b += d; });
      resp.on('end', function () {
        try { var j = JSON.parse(b); if (resp.statusCode >= 200 && resp.statusCode < 300) { resolve({ ok: true, refund: j }); } else { resolve({ ok: false, error: (j.error && j.error.message) || ('http ' + resp.statusCode) }); } }
        catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
    rq.on('error', function (e) { resolve({ ok: false, error: e.message }); });
    rq.write(body); rq.end();
  });
}

// ---- ADMIN: refund an order (guarded by ADMIN_KEY) — full or partial via Stripe ----
app.post('/api/orders/:id/refund', (req, res) => {
  var body = req.body || {};
  const list = read();
  const o = list.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ ok: false, error: 'not_found' });
  const total = Number(o.total) || 0;
  const already = Number(o.refundedTotal) || 0;
  const full = !!body.full;
  const amount = full ? (total - already) : (Number(body.amount) || 0);
  if (amount <= 0) return res.status(400).json({ ok: false, error: 'invalid_amount' });
  if (already + amount > total + 0.001) return res.status(400).json({ ok: false, error: 'exceeds_total' });
  function record(method, stripeRefundId) {
    o.refunds = Array.isArray(o.refunds) ? o.refunds : [];
    const rec = { amount: amount, full: full, category: body.category || '', subReason: body.subReason || '', note: body.note || '', at: new Date().toISOString(), method: method, stripeRefundId: stripeRefundId || null };
    o.refunds.push(rec); o.refund = rec;
    o.refundedTotal = already + amount;
    o.status = (o.refundedTotal >= total - 0.001) ? 'refunded' : 'partially_refunded';
    write(list);
  }
  const pi = o.stripe && o.stripe.paymentIntent;
  if (o.pay === 'card' && pi) {
    createRefund(pi, Math.round(amount * 100), { order_id: o.id, category: body.category || '', sub: body.subReason || '', note: body.note || '' }).then(function (r) {
      if (r.ok) { record('stripe', r.refund && r.refund.id); res.json({ ok: true, method: 'stripe', order: o }); }
      else { res.status(502).json({ ok: false, error: r.error || 'stripe_refund_failed' }); }
    });
  } else {
    record('manual', null);
    res.json({ ok: true, method: 'manual', order: o });
  }
});

// ---- ADMIN: delete an order (guarded by ADMIN_KEY) ----
app.delete("/api/orders/:id", (req, res) => {
  const list = read();
  const i = list.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ ok: false, error: "not_found" });
  const removed = list.splice(i, 1)[0];
  write(list);
  res.json({ ok: true, id: removed.id });
});

// ---- ADMIN: reset all orders + invoice counter (guarded by ADMIN_KEY) ----
app.post('/api/admin/reset', (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  const n = read().length;
  write([]);
  try { fs.writeFileSync(CNT, JSON.stringify({})); } catch (e) {}
  res.json({ ok: true, cleared: n, message: 'orders and invoice counter reset' });
});

// ---- DIAGNOSTIC: email config + test send (guarded by ADMIN_KEY) — ชั่วคราวสำหรับตรวจสอบ ----
app.get('/api/admin/emailtest', function (req, res) {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  var cfg = { configured: emailConfigured(), provider: (process.env.EMAIL_PROVIDER || 'resend'), fromSet: !!process.env.EMAIL_FROM, from: (process.env.EMAIL_FROM || '(default) onboarding@resend.dev') };
  if (!cfg.configured) return res.json({ ok: false, cfg: cfg, error: 'EMAIL_API_KEY not set on server' });
  var to = req.query.to;
  if (!to) return res.json({ ok: true, cfg: cfg, note: 'add &to=email to send a real test email' });
  var provider = cfg.provider.toLowerCase();
  var from = process.env.EMAIL_FROM || 'CloverX <onboarding@resend.dev>';
  var subject = 'ทดสอบระบบอีเมล · CloverX';
  var html = '<p>ทดสอบการส่งอีเมลจากระบบ CloverX สำเร็จ ✓</p>';
  var host, urlPath, headers, payload;
  if (provider === 'brevo') { host = 'api.brevo.com'; urlPath = '/v3/smtp/email'; headers = { 'api-key': process.env.EMAIL_API_KEY, 'content-type': 'application/json' }; payload = JSON.stringify({ sender: parseFrom(from), to: [{ email: to }], subject: subject, htmlContent: html }); }
  else { host = 'api.resend.com'; urlPath = '/emails'; headers = { 'Authorization': 'Bearer ' + process.env.EMAIL_API_KEY, 'content-type': 'application/json' }; payload = JSON.stringify({ from: from, to: [to], subject: subject, html: html }); }
  var rq = https.request({ hostname: host, path: urlPath, method: 'POST', headers: headers }, function (resp) {
    var b = ''; resp.on('data', function (d) { b += d; });
    resp.on('end', function () { res.json({ ok: resp.statusCode >= 200 && resp.statusCode < 300, cfg: cfg, providerStatus: resp.statusCode, providerResponse: b.slice(0, 600), sentTo: to }); });
  });
  rq.on('error', function (e) { res.json({ ok: false, cfg: cfg, error: e.message }); });
  rq.write(payload); rq.end();
});

// ---- serve slip images ----
// ตรวจสลิปอีกครั้งด้วย EasySlip (ออเดอร์โอนที่แนบสลิปแล้วแต่ยังไม่ยืนยัน) — ใช้ตอนแก้ตรรกะจับคู่แล้วอยากเช็กซ้ำ
app.post('/api/orders/:id/reverify', (req, res) => {
  const list = read();
  const o = list.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ ok: false, error: 'not_found' });
  if (o.pay !== 'bank' || !o.slipUrl) return res.status(400).json({ ok: false, error: 'no_slip' });
  if (!easyslipConfigured()) return res.status(400).json({ ok: false, error: 'easyslip_not_configured' });
  const fn = path.basename(String(o.slipUrl));
  fs.readFile(path.join(SLIPS, fn), function (err, buf) {
    if (err) return res.status(404).json({ ok: false, error: 'slip_file_missing' });
    const base = process.env.PUBLIC_BASE_URL || (((req.headers['x-forwarded-proto'] || 'https')) + '://' + req.headers.host);
    try { autoVerifyBank(o.id, buf.toString('base64'), base); } catch (e) {}
    res.json({ ok: true, message: 'reverifying' });
  });
});

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
  return 'DR-' + ym + '-' + ('0000' + c.invoice).slice(-4);
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
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  var bkk = function (dt) { return new Date(dt.getTime() + 7 * 3600 * 1000); };
  var fmtDT = function (dt) { var b = bkk(dt); return z(b.getUTCDate()) + '/' + z(b.getUTCMonth() + 1) + '/' + (b.getUTCFullYear() + 543) + ' ' + z(b.getUTCHours()) + ':' + z(b.getUTCMinutes()); };
  var db = bkk(d); var dateStr = z(db.getUTCDate()) + '/' + z(db.getUTCMonth() + 1) + '/' + (db.getUTCFullYear() + 543);
  var buyerName = (o.tax && o.tax.name) ? o.tax.name : (o.name || '-');
  var buyerAddr = (o.tax && o.tax.addr) ? o.tax.addr : (o.addr || '-');
  var buyerTax = (o.tax && o.tax.taxId) ? o.tax.taxId : '';
  var total = Number(o.total) || 0;
  var paid = (o.status === 'confirmed' || o.status === 'paid');
  var isTransfer = (o.pay !== 'card');
  var payWhen = '';
  if (o.pay === 'card' && o.stripe && o.stripe.at) { payWhen = fmtDT(new Date(o.stripe.at)); }
  else if (o.transfer && (o.transfer.date || o.transfer.time)) { payWhen = esc(((o.transfer.date || '') + ' ' + (o.transfer.time || '')).trim()); }
  var refLine = o.pay === 'card' ? ('บัตรเครดิต/เดบิต · Stripe' + (o.stripe && o.stripe.paymentIntent ? (' · ' + esc(o.stripe.paymentIntent)) : '')) : 'ธนาคารกสิกรไทย (KBank)';
  var items = o.items || [];
  var rows = '';
  var minRows = 6;
  for (var i = 0; i < Math.max(items.length, minRows); i++) {
    if (i < items.length) {
      var it = items[i];
      rows += '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(it.nm) + (it.fam ? ' <span class="fam">(ครอบครัว)</span>' : '') + '</td><td class="r">' + THB2(Number(it.price) || 0) + '</td></tr>';
    } else {
      rows += '<tr><td class="c">' + (i + 1) + '</td><td>&nbsp;</td><td></td></tr>';
    }
  }
  var noStr = o.invoiceNo ? esc(o.invoiceNo) : (paid ? '-' : '(รอชำระเงินมัดจำ)');
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>ใบรับเงินมัดจำ ' + esc(o.invoiceNo || o.id) + '</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Noto Sans Thai",sans-serif;color:#1a2233;background:#eef2f8;padding:20px;line-height:1.45}'
    + '.sheet{background:#fff;max-width:760px;margin:0 auto;padding:34px 38px;box-shadow:0 10px 40px -20px rgba(0,0,0,.4);border-radius:8px}'
    + '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}'
    + '.co .logo{height:34px;margin-bottom:10px}.co h1{font-size:.98rem;font-weight:800}.co p{font-size:.78rem;color:#374151;margin-top:4px;line-height:1.55}'
    + '.doc{flex:none;width:272px}.doc .tt{background:#2f4a8f;color:#fff;text-align:center;border-radius:6px;padding:10px;font-weight:800;font-size:1.15rem}.doc .en{text-align:center;color:#2f4a8f;font-weight:700;font-size:.74rem;margin-top:3px;letter-spacing:.1em}'
    + '.doc .meta{margin-top:10px;border:1.5px solid #cfd8e8;border-radius:6px;overflow:hidden}.doc .meta .r{display:flex;font-size:.82rem}.doc .meta .r+.r{border-top:1px solid #e3e9f3}.doc .meta .k{width:104px;background:#eef3fb;padding:8px 10px;font-weight:700;color:#2f4a8f}.doc .meta .v{flex:1;padding:8px 10px}'
    + '.sec{border:1.5px solid #cfd8e8;border-radius:6px;margin-top:16px;overflow:hidden}.sec .hd{background:#eef3fb;color:#2f4a8f;font-weight:700;font-size:.82rem;padding:8px 12px;border-bottom:1.5px solid #cfd8e8}'
    + '.row{display:flex;font-size:.85rem;border-bottom:1px solid #e6ecf5}.row:last-child{border-bottom:0}.row .k{width:158px;background:#f7f9fc;padding:9px 12px;font-weight:700;border-right:1px solid #e6ecf5;flex:none}.row .v{flex:1;padding:9px 12px}'
    + 'table{width:100%;border-collapse:collapse;margin-top:16px;font-size:.86rem}'
    + 'th{background:#1f2b45;color:#fff;font-weight:700;padding:9px 10px;text-align:left;font-size:.8rem}th.c,td.c{text-align:center}th.r,td.r{text-align:right}'
    + 'table,th,td{border:1px solid #cfd8e8}td{padding:8px 10px}.fam{color:#6b7280;font-size:.85em}'
    + '.sum{display:flex;border:1px solid #cfd8e8;border-top:0}.sum .words{flex:1;padding:10px 12px;font-size:.8rem;color:#55627a}.sum .words b{color:#1f2b45;font-size:.92rem}.sum .tot{width:230px;border-left:1px solid #cfd8e8;display:flex;align-items:stretch}.sum .tot .k{background:#eef3fb;color:#2f4a8f;font-weight:800;padding:12px;text-align:center;width:118px;display:flex;align-items:center;justify-content:center;font-size:.84rem}.sum .tot .v{flex:1;text-align:right;padding:12px;font-weight:800;font-size:1.05rem;display:flex;align-items:center;justify-content:flex-end}'
    + '.pay{border:1.5px solid #cfd8e8;border-radius:6px;margin-top:16px;overflow:hidden}'
    + '.chk{display:inline-flex;align-items:center;gap:6px;margin-right:22px}.chk .b{width:14px;height:14px;border:1.5px solid #55627a;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#2f4a8f;font-weight:800}'
    + '.sign{display:flex;gap:30px;margin-top:38px}.sign .s{flex:1;text-align:center;font-size:.8rem;color:#374151}.sign .line{border-top:1px solid #9aa3b2;margin:26px 8px 8px}'
    + '.note{background:#FFF7E6;border:1px solid #F5D48A;color:#8A5A00;border-radius:6px;padding:9px 12px;margin-top:14px;font-size:.78rem;font-weight:600}'
    + '.printbar{max-width:760px;margin:0 auto 14px;text-align:right}.btn{background:#2f4a8f;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-family:inherit;font-weight:700;cursor:pointer;font-size:.88rem}'
    + '@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0;max-width:none;padding:16px}.printbar{display:none}}'
    + '</style></head><body>'
    + '<div class="printbar"><button class="btn" onclick="window.print()">🖨️ พิมพ์ / บันทึก PDF</button></div>'
    + '<div class="sheet">'
    + '<div class="top"><div class="co">'
    + '<img class="logo" src="data:image/png;base64,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" alt="CloverX">'
    + '<h1>บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด (สำนักงานใหญ่)</h1>'
    + '<p>762/84 หมู่บ้าน เดอะปาล์ม (ภัสสร 37) ซอยพัฒนาการ 38<br>แขวงสวนหลวง เขตสวนหลวง กรุงเทพมหานคร 10250<br>เลขประจำตัวผู้เสียภาษี <span style="white-space:nowrap">0105568236410</span><br>โทร. <span style="white-space:nowrap">065-514-6576</span></p></div>'
    + '<div class="doc"><div class="tt">ใบรับเงินมัดจำ</div><div class="en">DEPOSIT RECEIPT</div>'
    + '<div class="meta"><div class="r"><div class="k">เลขที่ / No.</div><div class="v">' + noStr + '</div></div><div class="r"><div class="k">วันที่ / Date</div><div class="v">' + esc(dateStr) + '</div></div></div></div></div>'
    + '<div class="sec"><div class="hd">ข้อมูลผู้วางมัดจำ / DEPOSITOR</div>'
    + '<div class="row"><div class="k">ชื่อ / Name</div><div class="v">' + esc(buyerName) + (o.phone ? ' · โทร. ' + esc(o.phone) : '') + '</div></div>'
    + '<div class="row"><div class="k">ที่อยู่ / Address</div><div class="v">' + esc(buyerAddr) + '</div></div>'
    + '<div class="row"><div class="k">เลขผู้เสียภาษี / Tax ID</div><div class="v">' + (buyerTax ? esc(buyerTax) : '-') + '</div></div></div>'
    + '<table><thead><tr><th class="c" style="width:58px">ลำดับ<br>No.</th><th>รายละเอียด / Description</th><th class="r" style="width:150px">จำนวนเงิน<br>Amount</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + '<div class="sum"><div class="words">จำนวนเงินตัวอักษร / Amount in words<br><b>(' + bahtText(total) + ')</b></div><div class="tot"><div class="k">จำนวนเงินทั้งสิ้น<br>Total</div><div class="v">' + THB2(total) + '</div></div></div>'
    + '<div class="pay"><div class="row"><div class="k">วิธีชำระ / Payment</div><div class="v"><span class="chk"><span class="b"></span> เงินสด / Cash</span><span class="chk"><span class="b">✓</span> เงินโอน / Transfer' + (o.pay === 'card' ? ' · บัตรเครดิต/เดบิต' : '') + '</span></div></div>'
    + '<div class="row"><div class="k">ธนาคาร / Ref.</div><div class="v">' + refLine + (payWhen ? ' · ชำระเมื่อ ' + payWhen : '') + '</div></div>'
    + '<div class="row"><div class="k">หมายเหตุ / Remark</div><div class="v">เงินมัดจำสำหรับคำสั่งจอง (Pre-Order) เลขที่ ' + esc(o.id) + '</div></div></div>'
    + (paid ? '' : '<div class="note">⏳ เอกสารนี้จะสมบูรณ์เมื่อได้รับชำระเงินมัดจำเรียบร้อยแล้ว</div>')
    + '<div class="sign"><div class="s"><div class="line"></div>ผู้วางเงิน / Payer<br>วันที่ ___/___/___</div><div class="s"><div class="line"></div>ได้รับชำระเงินไว้ถูกต้องแล้ว / Received<br>ผู้รับเงิน / Collector · วันที่ ___/___/___</div></div>'
    + '<div style="margin-top:22px;border-top:1px solid #e5e9f0;padding-top:10px;font-size:.7rem;color:#9aa3b2;text-align:center">เอกสารนี้ออกโดยระบบอัตโนมัติของ CloverX · www.cloverxth.com</div>'
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
