const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const SLIPS = path.join(DATA, 'slips');
const DB = path.join(DATA, 'orders.json');

fs.mkdirSync(SLIPS, { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '[]');

app.use(express.json({ limit: '10mb' }));

function read() { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) { return []; } }
function write(d) { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }

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
    status: o.pay === 'card' ? 'paid' : 'pending',
    name: o.name || '', phone: o.phone || '', email: o.email || '', addr: o.addr || '',
    ref: o.ref || '', ship: o.ship || 'post', pickup: o.pickup || null,
    pay: o.pay || 'bank', items: Array.isArray(o.items) ? o.items : [], total: Number(o.total) || 0,
    transfer: o.transfer || null, slipUrl,
    famMembers: Array.isArray(o.famMembers) ? o.famMembers : [],
    payEmail: o.payEmail || '', tax: o.tax || null
  };
  list.unshift(rec);
  write(list);
  res.json({ ok: true, id });
});

// ---- list orders (for Operations dashboard) ----
app.get('/api/orders', (req, res) => res.json(read()));

// ---- update status (confirm / reject) ----
app.patch('/api/orders/:id', (req, res) => {
  const list = read();
  const o = list.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ ok: false });
  if (req.body && req.body.status) o.status = req.body.status;
  write(list);
  res.json({ ok: true, order: o });
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
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>ใบกำกับภาษี ' + esc(o.invoiceNo || '') + '</title>'
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
    + '<div class="top"><div class="co"><div class="brand">clover<svg viewBox="0 0 100 100"><path fill-rule="evenodd" fill="currentColor" d="M8,8 Q50,50 92,8 Q50,50 92,92 Q50,50 8,92 Q50,50 8,8 Z M27,27 Q50,50 73,27 Q50,50 73,73 Q50,50 27,73 Q50,50 27,27 Z"/></svg></div>'
    + '<h1>บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด</h1><div class="en">CLOVERX (THAILAND) CO., LTD. (สำนักงานใหญ่)</div>'
    + '<p>762/84 หมู่บ้านเดอะปาล์ม (ภัสสร 37) ซอยพัฒนาการ 38 แขวงสวนหลวง เขตสวนหลวง กรุงเทพมหานคร 10250<br>โทร. 065-514-6576 · info@cloverxth.com</p>'
    + '<p>เลขประจำตัวผู้เสียภาษี: 0105568236410</p></div>'
    + '<div class="doc"><h2>ใบเสร็จรับเงิน / ใบกำกับภาษี</h2><div class="sub">RECEIPT / TAX INVOICE (ต้นฉบับ)</div>'
    + '<div class="meta"><div><b>เลขที่</b> ' + esc(o.invoiceNo || '') + '</div><div><b>วันที่</b> ' + esc(dateStr) + '</div><div><b>อ้างอิง</b> ' + esc(o.id) + '</div></div></div></div>'
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
  if (!o.invoiceNo) { o.invoiceNo = nextInvoiceNo(); o.invoiceAt = new Date().toISOString(); write(list); }
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
