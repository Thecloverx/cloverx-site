// ============================================================================
// leanlab_api.js — Lean Lab membership & auth (email + LINE + Google)
// สถาปัตยกรรมตาม RoutineX Impact: Node.js `crypto` ล้วน ไม่พึ่งบริการภายนอกที่มีค่าใช้จ่าย
//   - อีเมล + รหัสผ่าน  → session { pid, exp }
//   - LINE Login (OAuth2)→ หา/สร้างสมาชิกจาก lineId แล้ว session { pid, exp }
//   - Google (OAuth2)    → หา/สร้างสมาชิกจาก googleId/อีเมล แล้ว session { pid, exp }
// แยก namespace เฉพาะ Lean Lab: cookie `ll_sess`, route /api/leanlab/* และ /auth/leanlab/*
// ต่อยอด register แยกจากการกรอกโปรไฟล์ (needsProfile) เหมือน RoutineX
// ============================================================================
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

module.exports = function (app, DATA_DIR) {
  const DIR = path.join(DATA_DIR, 'leanlab');
  const MEMBERS = path.join(DIR, 'members.json');
  const REGS = path.join(DIR, 'registrations.json');
  const UP = path.join(DIR, 'uploads');
  try { fs.mkdirSync(UP, { recursive: true }); } catch (e) {}
  if (!fs.existsSync(MEMBERS)) { try { fs.writeFileSync(MEMBERS, '[]'); } catch (e) {} }
  if (!fs.existsSync(REGS)) { try { fs.writeFileSync(REGS, '[]'); } catch (e) {} }
  const SETTINGS = path.join(DIR, 'settings.json');
  function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) || {}; } catch (e) { return {}; } }
  function writeSettings(s) { try { fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); } catch (e) {} }
  // โหมด "ปิดการตรวจสอบชั่วคราว" — ลูกค้าชำระเงินแล้วยืนยันอัตโนมัติ ไม่ต้องรอแอดมิน (เปิด/ปิดผ่าน admin settings)
  function noReviewOn() { return !!readSettings().noReview; }

  // ---- แจ้งเตือนเข้า Lark (มาตรฐาน CloverX Bridge) ----
  // ค่าลับทั้งหมดอ่านจาก Railway Variables เท่านั้น (ห้ามเก็บในซอร์ส/ไฟล์ตั้งค่า)
  //   ห้องเงิน "REPORT - GIVE ME MONEY": LARK_PAY_WEBHOOK_URL (+ LARK_PAY_BOT_SECRET)
  //   ห้องหลัก:                          LARK_WEBHOOK_URL      (+ LARK_BOT_SECRET)
  // เรื่องเงิน → ห้องเงิน; ถ้ายังไม่ได้ตั้งห้องเงิน → ตกมาห้องหลักอัตโนมัติ (แจ้งเตือนไม่มีทางหาย)
  function larkTarget(to) {
    if (to === 'pay') {
      var payUrl = process.env.LARK_PAY_WEBHOOK_URL || '';
      if (payUrl) return { url: payUrl, secret: process.env.LARK_PAY_BOT_SECRET || '' };
    }
    return { url: process.env.LARK_WEBHOOK_URL || '', secret: process.env.LARK_BOT_SECRET || '' };
  }
  function larkSign(ts, secret) {
    var key = ts + '\n' + secret;   // HMAC-SHA256: key = timestamp\nsecret, data = ว่างเปล่า
    return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(Buffer.alloc(0)).digest('base64');
  }
  // fire-and-forget: Lark ล่ม/ไม่ได้ตั้ง webhook ต้องไม่ทำให้งานหลักล้ม (ไม่ throw)
  function larkSend(payload, opts) {
    try {
      var t = larkTarget(opts && opts.to);
      if (!t.url) return;   // ยังไม่ได้ตั้ง webhook → เงียบ ไม่ throw
      var body = Object.assign({}, payload);
      if (t.secret) { var ts = Math.floor(Date.now() / 1000).toString(); body.timestamp = ts; body.sign = larkSign(ts, t.secret); }
      var u = new URL(t.url);
      var data = JSON.stringify(body);
      var req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, function (resp) {
        var d = ''; resp.on('data', function (c) { d += c; });
        resp.on('end', function () { try { var j = JSON.parse(d); if (!(j.code === 0 || j.StatusCode === 0 || j.code == null)) console.log('[lean-lab] lark resp: ' + d.slice(0, 160)); } catch (e) {} });
      });
      req.on('error', function (e) { console.log('[lean-lab] lark error: ' + e.message); });
      req.setTimeout(15000, function () { try { req.destroy(); } catch (e) {} });
      req.write(data); req.end();
    } catch (e) { console.log('[lean-lab] lark exception: ' + e.message); }
  }
  // การ์ดมาตรฐาน { title, lines[], color, note } — header สีธีม + lines รวมด้วย \n เป็น lark_md
  function larkCard(o) {
    o = o || {};
    var color = ['blue', 'green', 'orange', 'red', 'grey'].indexOf(o.color) >= 0 ? o.color : 'blue';
    var elements = [{ tag: 'div', text: { tag: 'lark_md', content: (o.lines || []).join('\n') } }];
    if (o.note) { elements.push({ tag: 'hr' }); elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: o.note }] }); }
    return { msg_type: 'interactive', card: { config: { wide_screen_mode: true }, header: { template: color, title: { tag: 'plain_text', content: o.title || '' } }, elements: elements } };
  }
  function larkConfigured() { return !!(process.env.LARK_PAY_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL); }
  // แจ้ง "ชำระเงินสำเร็จ" เข้าห้องเงิน (green) — รูปแบบบรรทัด **ป้าย** ค่า, เลขอ้างอิงใน backtick
  function notifyLarkPaid(r, force) {
    if (!r || (!force && !larkConfigured())) return;
    var payMap = { card: '💳 บัตรเครดิต', installment: '💳 ผ่อนบัตร (6 งวด)', bank: '🏦 โอนธนาคาร' };
    var pay = payMap[r.pay] || r.pay || '-';
    var amt = '฿' + Number(r.fee || 0).toLocaleString('en-US');
    var when = '';
    try { when = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { when = new Date().toISOString(); }
    var lines = [
      '**ลูกค้า** ' + (r.name || '-') + (r.phone ? (' · `' + r.phone + '`') : ''),
      '**ยอด** ' + amt + ' · ' + pay,
      '**อ้างอิง** `' + (r.po || '-') + '`',
      '**ทีมโค้ช** ' + (r.coach || '-') + ' · **ผู้แนะนำ** ' + (r.referrer || '-')
    ];
    if (r.email) lines.push('**อีเมล** ' + r.email);
    larkSend(larkCard({ title: '🎉 ชำระเงินสำเร็จ · Lean Lab', color: 'green', lines: lines, note: '⏰ ' + when }), { to: 'pay' });
  }

  // ================= ระบบรายงานสรุป Lean Lab เข้า Lark (4 รอบ/วัน + กดส่งเอง) =================
  var REPORT_TIERS = [
    { key: 't0', label: 'เซต 1', price: 44940 },
    { key: 't1', label: 'เซต 2', price: 39950 },
    { key: 't2', label: 'เซต 3', price: 37450 },
    { key: 't3', label: 'เซต 4', price: 32460 }
  ];
  function money(n) { return '฿' + Number(n || 0).toLocaleString('en-US'); }
  // กฎเดียวกับหน้า Dashboard: ผู้แนะนำที่จริง ๆ เป็น "โค้ช" → นับเป็นโค้ช (ให้ตัวเลข Report ตรงกับ Dashboard)
  var LL_COACH_ALIAS = { 'ปริญ จารุกุลวนิช': 'โค้ชซิง', 'ณรนา ภัทรธรจิรโภคิน': 'โค้ชต๊ะ', 'ชีวาวัชญ์ จรัสนิรัติศัย': 'โค้ชจา', 'Sukanya Thirakomen Kanogart': 'โค้ชนุ่น' };
  function llAliasCoach(name) {
    var s = String(name || '').replace(/\s+/g, ' ').trim(); if (!s || s === '-') return '';
    if (LL_COACH_ALIAS[s]) return LL_COACH_ALIAS[s];
    var first = s.split(' ')[0];
    for (var k in LL_COACH_ALIAS) { if (first && first === k.split(' ')[0]) return LL_COACH_ALIAS[k]; }
    for (var kk in LL_COACH_ALIAS) { if (s === LL_COACH_ALIAS[kk]) return LL_COACH_ALIAS[kk]; }
    return '';
  }
  // คืนค่า coach/referrer ที่ผ่านกฎแล้ว: ถ้า referrer เป็นชื่อโค้ช → ย้ายไปเป็น coach, ล้าง referrer
  function llEffCR(r) {
    var coach = String(r.coach || '').trim(), ref = String(r.referrer || '').trim();
    var refCoach = llAliasCoach(ref);
    if (refCoach) return { coach: (coach || refCoach), referrer: '' };
    return { coach: coach, referrer: (ref === '-' ? '' : ref) };
  }
  // รวมสถิติจากใบสมัครที่ "ยืนยันแล้ว" — นับเงินที่เก็บได้จริง (ผ่อน = งวดที่จ่าย × ต่อเดือน)
  function buildReportData() {
    var regs = readR().filter(function (r) { return r.status === 'confirmed'; });
    var d = { totalPaid: 0, buyers: regs.length, startNow: 0, startLater: 0,
      setCount: { t0: 0, t1: 0, t2: 0, t3: 0, special: 0, base: 0 },
      setAmt: { t0: 0, t1: 0, t2: 0, t3: 0, special: 0, base: 0 }, coach: {}, ref: {} };
    regs.forEach(function (r) {
      if (r.startChoice === 'now') d.startNow++; else if (r.startChoice === 'later') d.startLater++;
      var key, val = 0;
      if (r.promoPlan === 'special' || r.pay === 'installment') {
        key = 'special';
        var per = (r.installment && r.installment.perMonth) || 7490, paid = (r.installment && r.installment.paidCount) || 0;
        val = per * paid;
      } else if (r.promoPlan === 'full' && r.promoTier && d.setCount.hasOwnProperty(r.promoTier)) {
        key = r.promoTier;
        var tt = REPORT_TIERS.filter(function (t) { return t.key === r.promoTier; })[0];
        val = (tt && tt.price) || r.fee || 0;
      } else { key = 'base'; val = r.fee || EVENT.fee; }
      d.setCount[key]++; d.setAmt[key] += val; d.totalPaid += val;
      // กฎเดียวกับ Dashboard: มีผู้แนะนำ (คนธรรมดา) → ยอดเข้าผู้แนะนำ · ไม่มีผู้แนะนำ → ยอดเข้าโค้ช (ไม่นับซ้ำทั้งสองฝั่ง)
      var eff = llEffCR(r);
      if (eff.referrer) { d.ref[eff.referrer] = d.ref[eff.referrer] || { c: 0, v: 0 }; d.ref[eff.referrer].c++; d.ref[eff.referrer].v += val; }
      else if (eff.coach) { d.coach[eff.coach] = d.coach[eff.coach] || { c: 0, v: 0 }; d.coach[eff.coach].c++; d.coach[eff.coach].v += val; }
    });
    d.coachRank = Object.keys(d.coach).map(function (k) { return { name: k, c: d.coach[k].c, v: d.coach[k].v }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    d.refRank = Object.keys(d.ref).map(function (k) { return { name: k, c: d.ref[k].c, v: d.ref[k].v }; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 5);
    return d;
  }
  function reportLines(d, roundLabel) {
    var dateStr = ''; try { dateStr = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { dateStr = new Date().toISOString().slice(0, 10); }
    var L = [];
    L.push('**🗓️ ณ วันที่** ' + dateStr + ' · **รอบ** ' + roundLabel);
    L.push('**💰 ยอดชำระแล้วทั้งหมด** ' + money(d.totalPaid));
    L.push('**👥 จำนวนผู้สั่งซื้อ** ' + d.buyers + ' คน');
    if (d.startNow > 0 || d.startLater > 0) {
      L.push(''); L.push('**🚀 รูปแบบการเข้าร่วม**');
      if (d.startNow > 0) L.push('• เริ่มเลย ณ ตอนนี้ · ' + d.startNow + ' คน');
      if (d.startLater > 0) L.push('• เริ่มวันที่ ' + EVENT.startLaterLabel + ' · ' + d.startLater + ' คน');
    }
    L.push(''); L.push('**📦 รายการสั่งซื้อ** (เฉพาะเซตที่มียอด)');
    REPORT_TIERS.forEach(function (t) { if (d.setCount[t.key] > 0) L.push('• ' + t.label + ' · ' + money(t.price) + ' → ' + money(d.setAmt[t.key]) + ' · ' + d.setCount[t.key] + ' คน'); });
    if (d.setCount.special > 0) L.push('• เซต 5 · ทยอยจ่าย ฿7,490 × 6 · ' + d.setCount.special + ' คน');
    if (d.setCount.base > 0) L.push('• ค่า Lean Lab · ฿3,900 → ' + money(d.setAmt.base) + ' · ' + d.setCount.base + ' คน');
    if (d.coachRank.length) { L.push(''); L.push('**🏋️ โค้ชผู้แนะนำ** (เรียงตามยอด)'); d.coachRank.forEach(function (x, i) { L.push((i + 1) + '. ' + x.name + ' · ' + money(x.v) + ' · ' + x.c + ' คน'); }); }
    if (d.refRank.length) { L.push(''); L.push('**🙋 ผู้แนะนำ** (เรียงตามยอด)'); d.refRank.forEach(function (x, i) { L.push((i + 1) + '. ' + x.name + ' · ' + x.c + ' คน'); }); }
    return L;
  }
  function larkReportCard(roundLabel) {
    return larkCard({ title: '📊 รายงานผล Lean Lab', color: 'blue', lines: reportLines(buildReportData(), roundLabel), note: '⏰ รายงานอัตโนมัติ 4 รอบ/วัน · 09:00 / 12:00 / 17:00 / 20:00 น. (เวลาไทย) · ดึงข้อมูลสด' });
  }
  // ---- อัปโหลดรูปเข้า Lark ผ่าน Custom App แล้วส่งเป็นข้อความรูปผ่าน webhook ----
  var _larkTok = { v: null, exp: 0 }, _dashSnap = null;   // _dashSnap = ภาพแดชบอร์ดล่าสุดจากเบราว์เซอร์
  function larkAppReady() { return !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET); }
  function larkTenantToken(cb) {
    if (!larkAppReady()) { cb(null); return; }
    if (_larkTok.v && Date.now() < _larkTok.exp) { cb(_larkTok.v); return; }
    var body = JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET });
    var req = https.request({ hostname: 'open.larksuite.com', path: '/open-apis/auth/v3/tenant_access_token/internal', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, function (resp) {
      var dt = ''; resp.on('data', function (c) { dt += c; });
      resp.on('end', function () { try { var j = JSON.parse(dt); if (j.tenant_access_token) { _larkTok.v = j.tenant_access_token; _larkTok.exp = Date.now() + (((j.expire || 7000) - 300) * 1000); cb(j.tenant_access_token); } else { console.log('[lean-lab] lark token fail ' + dt.slice(0, 120)); cb(null); } } catch (e) { cb(null); } });
    });
    req.on('error', function (e) { console.log('[lean-lab] lark token err ' + e.message); cb(null); });
    req.setTimeout(15000, function () { try { req.destroy(); } catch (e) {} });
    req.write(body); req.end();
  }
  function larkUploadImage(buf, cb) {
    larkTenantToken(function (tok) {
      if (!tok) { cb(null); return; }
      var boundary = '----LL' + Date.now();
      var pre = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image_type"\r\n\r\nmessage\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="dashboard.png"\r\nContent-Type: image/png\r\n\r\n', 'utf8');
      var post = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
      var body = Buffer.concat([pre, buf, post]);
      var req = https.request({ hostname: 'open.larksuite.com', path: '/open-apis/im/v1/images', method: 'POST', headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } }, function (resp) {
        var dt = ''; resp.on('data', function (c) { dt += c; });
        resp.on('end', function () { try { var j = JSON.parse(dt); cb((j.data && j.data.image_key) || null); } catch (e) { cb(null); } });
      });
      req.on('error', function (e) { console.log('[lean-lab] lark img err ' + e.message); cb(null); });
      req.setTimeout(20000, function () { try { req.destroy(); } catch (e) {} });
      req.write(body); req.end();
    });
  }
  // ส่งรายงาน: การ์ดข้อความก่อน แล้วตามด้วยภาพแดชบอร์ด (ถ้ามี) — fire-and-forget
  function sendLeanLabReport(roundLabel, imgBuf) {
    larkSend(larkReportCard(roundLabel));
    if (imgBuf && imgBuf.length && larkAppReady()) {
      larkUploadImage(imgBuf, function (key) { if (key) larkSend({ msg_type: 'image', content: { image_key: key } }); });
    }
  }
  // ตัวจับเวลา 4 รอบ/วัน (เวลาไทย) — ตรวจทุก 30 วิ, กันส่งซ้ำในรอบเดียวกัน
  var REPORT_TIMES = ['09:00', '12:00', '17:00', '20:00'], _lastReportKey = '';
  function reportTick() {
    try {
      if (process.env.LEANLAB_REPORT_ENABLED === 'false') return;
      if (!larkConfigured()) return;
      var th = new Date(Date.now() + 7 * 3600000);   // UTC+7
      var hh = ('0' + th.getUTCHours()).slice(-2), mm = ('0' + th.getUTCMinutes()).slice(-2), hhmm = hh + ':' + mm;
      if (REPORT_TIMES.indexOf(hhmm) < 0) return;
      var key = th.getUTCFullYear() + '-' + th.getUTCMonth() + '-' + th.getUTCDate() + '_' + hhmm;
      if (_lastReportKey === key) return;
      _lastReportKey = key;
      console.log('[lean-lab] auto report ' + hhmm);
      sendLeanLabReport('รอบ ' + hhmm + ' น.', _dashSnap);
    } catch (e) { console.log('[lean-lab] reportTick err ' + e.message); }
  }
  setInterval(reportTick, 30000);

  // ---- Lean Lab event config (Season 1) ----
  const EVENT = {
    season: 1,
    fee: 3900,
    minAge: 18,
    startLaterLabel: '8 พ.ย. 2569',      // choice "เริ่มวันที่ 08/11/69"
    promoQuota: 100,                     // โปรโมชั่นพิเศษ: 100 สิทธิ์ (นับเฉพาะที่ยืนยัน+ชำระแล้ว)
    bank: { bankName: 'กสิกรไทย (KBank)', accountNo: '231-1-71119-1', accountName: 'บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด' }
  };

  // ---- Promotion packages (Grand Slam Offer) ----
  const PROMO = {
    full: {
      key: 'full', name: 'Grand Slam Offer', valueTotal: 12180,
      items: ['Lean Lab Event', 'Shaker', 'Tumbler', 'Protein', 'Xircle Band', 'Xircle Scale'],
      conditions: ['ซื้อ RoutineX แบบเซต 6 เดือน (บริษัทจัดส่งเดือนละ 1 เซต)', 'ชำระเงินเพียงครั้งเดียว (ไม่เข้าร่วมบริการผ่อนชำระ)', 'หักยอดจากที่สั่งซื้อ Pre-Order และ Order ปกติได้', 'รายการ Protein ไม่เข้าร่วมโปรโมชั่นทุกกรณี'],
      tiers: [
        { key: 't0', amount: 44940, label: 'ยังไม่ PreOrder สินค้าใด ๆ', needProof: false },
        { key: 't1', amount: 39950, label: 'เคยซื้อ Xircle Band + Xircle Scale', needProof: true },
        { key: 't2', amount: 37450, label: 'เคยซื้อ RoutineX 1 Set', needProof: true },
        { key: 't3', amount: 32460, label: 'เคยซื้อ Xircle Band + Xircle Scale + RoutineX', needProof: true }
      ]
    },
    special: {
      key: 'special', name: 'Special Option', valueTotal: 44940, available: true,
      items: ['Lean Lab Event', 'Shaker', 'Tumbler'],
      conditions: ['ซื้อ RoutineX แบบเซต 6 เดือน (บริษัทจัดส่งเดือนละ 1 เซต)', 'ชำระเงินแบบผ่อนกับบริษัท (แบ่งจ่าย 6 เดือน)', 'ผ่อนผ่านบัตรเครดิต/เดบิต — งวดแรกตัดทันที งวดที่ 2-6 ตัดทุกวันที่ที่เลือก', 'รายการ Protein ไม่เข้าร่วมโปรโมชั่นทุกกรณี'],
      installment: { months: 6, perMonth: 7490, total: 44940 }
    }
  };
  function fullTier(k) { return PROMO.full.tiers.filter(function (t) { return t.key === k; })[0] || null; }

  // SESSION_SECRET: ควรตั้งใน env เพื่อไม่ให้ session หลุดตอน deploy/restart
  const SECRET = process.env.SESSION_SECRET || process.env.LEANLAB_SESSION_SECRET
    || crypto.randomBytes(32).toString('hex');
  if (!process.env.SESSION_SECRET && !process.env.LEANLAB_SESSION_SECRET) {
    console.warn('[lean-lab] SESSION_SECRET ไม่ได้ตั้ง — ใช้ค่าสุ่มชั่วคราว (สมาชิกจะถูกล็อกเอาต์เมื่อรีสตาร์ท). แนะนำให้ตั้ง SESSION_SECRET ใน Railway');
  }
  const COOKIE = 'll_sess';
  const OAUTH_COOKIE = 'll_oauth';
  const NINETY_DAYS = 90 * 24 * 3600 * 1000;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ---------- rate limiting / anti-abuse (in-memory) ----------
  function clientIp(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.connection && req.connection.remoteAddress || 'x'); }
  // ตัวระบุผู้ใช้สำหรับ rate-limit: ถ้าล็อกอินแล้วใช้ member id (กันปัญหา CGNAT/5G ที่หลายคนใช้ IP เดียวกัน
  // แล้วโดนบล็อกข้ามกัน) — ถ้ายังไม่ล็อกอินค่อย fallback เป็น IP
  function rlWho(req) { try { var m = currentMember(req); if (m && m.id) return 'm:' + m.id; } catch (e) { } return 'ip:' + clientIp(req); }
  var _rl = {};
  // จำกัดจำนวนครั้งต่อผู้ใช้ (member id ถ้าล็อกอิน มิฉะนั้น IP) ต่อหน้าต่างเวลา — คืน true ถ้ายังไม่เกิน
  function rlOk(bucket, req, max, windowMs) {
    var key = bucket + ':' + rlWho(req), now = Date.now(), b = _rl[key];
    if (!b || now > b.reset) { _rl[key] = { n: 1, reset: now + windowMs }; return true; }
    b.n++; return b.n <= max;
  }
  // middleware ช่วย: ถ้าเกินโควตา → 429
  function limit(bucket, max, windowMs) {
    return function (req, res, next) {
      if (rlOk(bucket, req, max, windowMs)) return next();
      res.status(429).json({ ok: false, error: 'too_many_requests', message: 'ทำรายการถี่เกินไป กรุณาลองใหม่อีกครั้งในภายหลัง' });
    };
  }
  // กัน brute-force รหัสแอดมิน: ล็อก IP ชั่วคราวเมื่อใส่รหัสผิดหลายครั้ง
  var _adminFail = {};

  // ---------- store ----------
  function readM() { try { return JSON.parse(fs.readFileSync(MEMBERS, 'utf8')) || []; } catch (e) { return []; } }
  function writeM(l) { try { fs.writeFileSync(MEMBERS, JSON.stringify(l, null, 2)); } catch (e) {} }
  function genId() { return 'LL-' + crypto.randomBytes(5).toString('hex').toUpperCase(); }

  // ---------- password (scrypt + salt) ----------
  function hashPw(pw) {
    const salt = crypto.randomBytes(16);
    const dk = crypto.scryptSync(String(pw), salt, 32);
    return salt.toString('hex') + ':' + dk.toString('hex');
  }
  function verifyPw(pw, stored) {
    try {
      const parts = String(stored).split(':');
      const salt = Buffer.from(parts[0], 'hex');
      const expected = Buffer.from(parts[1], 'hex');
      const dk = crypto.scryptSync(String(pw), salt, expected.length);
      return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
    } catch (e) { return false; }
  }

  // ---------- session (signed + stateless, HMAC-SHA256) ----------
  function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64urlDec(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Buffer.from(s, 'base64'); }
  function sign(obj) {
    const p = b64url(JSON.stringify(obj));
    const sig = crypto.createHmac('sha256', SECRET).update(p).digest();
    return p + '.' + b64url(sig);
  }
  function verifyToken(tok) {
    if (!tok || String(tok).indexOf('.') < 0) return null;
    const i = tok.indexOf('.'); const p = tok.slice(0, i); const sig = tok.slice(i + 1);
    const expected = b64url(crypto.createHmac('sha256', SECRET).update(p).digest());
    const a = Buffer.from(sig || ''); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let obj; try { obj = JSON.parse(b64urlDec(p).toString('utf8')); } catch (e) { return null; }
    if (!obj || !obj.exp || Date.now() > obj.exp) return null;
    return obj;
  }

  // ---------- cookies (dependency-free) ----------
  function parseCookies(req) {
    const h = req.headers.cookie || ''; const o = {};
    h.split(';').forEach(function (kv) { const i = kv.indexOf('='); if (i > 0) { try { o[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim()); } catch (e) {} } });
    return o;
  }
  function appendCookie(res, c) {
    const prev = res.getHeader('Set-Cookie');
    if (!prev) res.setHeader('Set-Cookie', c);
    else res.setHeader('Set-Cookie', [].concat(prev, c));
  }
  function setCookie(res, name, val, maxAgeMs) {
    const parts = [name + '=' + encodeURIComponent(val), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
    if (maxAgeMs != null) parts.push('Max-Age=' + Math.floor(maxAgeMs / 1000));
    appendCookie(res, parts.join('; '));
  }
  function clearCookie(res, name) { appendCookie(res, name + '=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0'); }

  function setSession(res, payload) { payload.exp = Date.now() + NINETY_DAYS; setCookie(res, COOKIE, sign(payload), NINETY_DAYS); }
  function currentMember(req) {
    const c = parseCookies(req); const s = verifyToken(c[COOKIE]);
    if (!s || !s.pid) return null;
    return readM().find(function (m) { return m.id === s.pid; }) || null;
  }
  function baseUrl(req) {
    return process.env.PUBLIC_BASE_URL || (((req.headers['x-forwarded-proto'] || 'https')) + '://' + req.headers.host);
  }
  function publicMember(m) {
    if (!m) return null;
    return {
      id: m.id, email: m.email || '', name: m.name || '', phone: m.phone || '', picture: m.picture || '',
      provider: m.provider || (m.pwHash ? 'email' : (m.lineId ? 'line' : (m.googleId ? 'google' : 'unknown'))),
      needsProfile: !m.name
    };
  }
  function findOrCreate(key, val, profile) {
    const l = readM();
    let m = l.find(function (x) { return x[key] === val; });
    if (!m && profile.email) m = l.find(function (x) { return (x.email || '').toLowerCase() === String(profile.email).toLowerCase(); });
    if (!m) {
      m = { id: genId(), email: profile.email || '', name: profile.name || '', phone: '', picture: profile.picture || '', provider: profile.provider, createdAt: new Date().toISOString() };
      m[key] = val; l.push(m);
    } else {
      m[key] = val;
      if (!m.name && profile.name) m.name = profile.name;
      if (!m.picture && profile.picture) m.picture = profile.picture;
      if (!m.email && profile.email) m.email = profile.email;
    }
    writeM(l);
    return m;
  }
  function httpsReq(opts, body) {
    return new Promise(function (resolve) {
      const r = https.request(opts, function (resp) { let d = ''; resp.on('data', function (c) { d += c; }); resp.on('end', function () { resolve({ status: resp.statusCode, body: d }); }); });
      r.on('error', function () { resolve({ status: 0, body: '' }); });
      if (body) r.write(body);
      r.end();
    });
  }
  const lineConfigured = function () { return !!(process.env.LINE_CHANNEL_ID && process.env.LINE_CHANNEL_SECRET); };
  const googleConfigured = function () { return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); };

  // ============================ EMAIL AUTH ============================
  app.post('/api/leanlab/auth/register', limit('auth', 60, 300000), function (req, res) {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });
    if (pw.length < 6) return res.status(400).json({ ok: false, error: 'weak_password' });
    const l = readM();
    if (l.some(function (m) { return (m.email || '').toLowerCase() === email; })) return res.status(409).json({ ok: false, error: 'email_taken' });
    const m = { id: genId(), email: email, pwHash: hashPw(pw), name: '', phone: '', provider: 'email', createdAt: new Date().toISOString() };
    l.push(m); writeM(l);
    setSession(res, { pid: m.id });
    res.json({ ok: true, needsProfile: true, member: publicMember(m) });
  });

  // สมัครแบบฟอร์มเดียว ไม่ต้องรหัสผ่าน — มีอีเมลอยู่แล้วก็ใช้บัญชีเดิม (resume)
  app.post('/api/leanlab/auth/join', limit('auth', 60, 300000), function (req, res) {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const phone = String(b.phone || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });
    const l = readM();
    let m = l.find(function (x) { return (x.email || '').toLowerCase() === email; });
    if (!m) {
      m = { id: genId(), email: email, pwHash: null, name: name.slice(0, 80), phone: phone.slice(0, 30), provider: 'email', createdAt: new Date().toISOString() };
      l.push(m);
    } else {
      if (name) m.name = name.slice(0, 80);
      if (phone) m.phone = phone.slice(0, 30);
    }
    writeM(l);
    setSession(res, { pid: m.id });
    res.json({ ok: true, member: publicMember(m) });
  });

  app.post('/api/leanlab/auth/login', limit('login', 40, 300000), function (req, res) {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || b.password || '').trim();
    const digits = function (s) { return String(s || '').replace(/\D/g, ''); };
    const m = readM().find(function (x) { return (x.email || '').toLowerCase() === email; });
    if (!m) return res.status(401).json({ ok: false, error: 'bad_credentials' });
    // เบอร์โทรใช้เป็นรหัสผ่าน (เทียบเฉพาะตัวเลข) — รองรับบัญชีเก่าที่มี pwHash ด้วย
    const ok = (m.pwHash && verifyPw(phone, m.pwHash)) || (digits(m.phone) && digits(m.phone) === digits(phone));
    if (!ok) return res.status(401).json({ ok: false, error: 'bad_credentials' });
    setSession(res, { pid: m.id });
    res.json({ ok: true, member: publicMember(m), needsProfile: !m.name });
  });

  app.post('/api/leanlab/auth/logout', function (req, res) { clearCookie(res, COOKIE); res.json({ ok: true }); });

  app.get('/api/leanlab/me', function (req, res) {
    const m = currentMember(req);
    res.json({ loggedIn: !!m, member: publicMember(m), needsProfile: m ? !m.name : false });
  });

  // กรอก/แก้ค่าตั้งต้น (ชื่อ/เบอร์) — แยกจากการสมัคร
  app.post('/api/leanlab/people', function (req, res) {
    const cur = currentMember(req);
    if (!cur) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    const b = req.body || {};
    const l = readM(); const x = l.find(function (y) { return y.id === cur.id; });
    if (!x) return res.status(404).json({ ok: false, error: 'not_found' });
    if (typeof b.name === 'string') x.name = b.name.trim().slice(0, 80);
    if (typeof b.phone === 'string') x.phone = b.phone.trim().slice(0, 30);
    writeM(l);
    res.json({ ok: true, member: publicMember(x) });
  });

  app.get('/api/leanlab/config', function (req, res) {
    res.json({
      lineLogin: !!(lineConfigured() || process.env.LINE_DEV_FAKE === '1'),
      liffId: process.env.LEANLAB_LIFF_ID || process.env.LINE_LIFF_ID || '',
      googleLogin: false,
      card: !!process.env.STRIPE_SECRET_KEY
    });
  });

  // ============================ LEAN LAB EVENT REGISTRATION ============================
  function calcAge(dobStr) {
    var d = new Date(dobStr); if (isNaN(d.getTime())) return null;
    var t = new Date(); var a = t.getFullYear() - d.getFullYear();
    var m = t.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
    return a;
  }
  function saveImg(dataUrl, prefix) {
    var m = String(dataUrl || '').match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (!m) return null;
    var ext = (m[1] === 'jpeg' ? 'jpg' : m[1].replace(/[^a-z0-9]/gi, '')) || 'png';
    var fn = prefix + '-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    try { fs.writeFileSync(path.join(UP, fn), Buffer.from(m[2], 'base64')); return '/api/leanlab/file/' + fn; } catch (e) { return null; }
  }
  function readR() { try { return JSON.parse(fs.readFileSync(REGS, 'utf8')) || []; } catch (e) { return []; } }
  function writeR(l) { try { fs.writeFileSync(REGS, JSON.stringify(l, null, 2)); } catch (e) {} }
  function genRid() { return 'LLR-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }
  // เลขคำสั่งซื้อ (PO) แบบสุ่ม: LL-XXXXXX (ตัวอักษร/ตัวเลข ไม่ซ้ำกับที่มีอยู่)
  function nextPO() {
    var used = {}; readR().forEach(function (r) { if (r.po) used[r.po] = 1; });
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด 0/O/1/I ที่สับสน
    for (var attempt = 0; attempt < 60; attempt++) {
      var s = 'LL-';
      var buf = crypto.randomBytes(6);
      for (var i = 0; i < 6; i++) s += chars[buf[i] % chars.length];
      if (!used[s]) return s;
    }
    return 'LL-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  }
  function assignPO(r) { if (r && !r.po) r.po = nextPO(); return r ? r.po : null; }
  function publicReg(r) {
    if (!r) return null;
    return {
      id: r.id, name: r.name, dob: r.dob || null, age: r.age, gender: r.gender, heightCm: r.heightCm, startChoice: r.startChoice, baseline: r.baseline || null,
      coach: r.coach || '', coachOther: r.coachOther || '', referrer: r.referrer || '',
      address: r.address || '', postcode: r.postcode || '', addrDetail: r.addrDetail || '', geo: r.geo || null,
      fee: r.fee, pay: r.pay, promo: !!r.promo, promoPlan: r.promoPlan || null, promoTier: r.promoTier || null,
      promoAmount: r.promoAmount || null, promoVerify: r.promoVerify || null, promoProofUrl: r.promoProofUrl || null, autoVerified: !!r.autoVerified,
      installment: r.installment ? { months: r.installment.months, perMonth: r.installment.perMonth, day: r.installment.day, paidCount: r.installment.paidCount || 0, status: r.installment.status || null } : null,
      slipUrl: r.slipUrl || null, status: r.status, createdAt: r.createdAt, po: r.po || null
    };
  }
  // โปรโมชั่นพิเศษ: นับ "สิทธิ์ที่ใช้แล้ว" เฉพาะผู้ที่เลือกโปรโมชั่น + ยืนยัน/ชำระเงินแล้ว (confirmed)
  function promoStats() {
    var used = readR().filter(function (r) { return r.promo && r.status === 'confirmed'; }).length;
    var quota = EVENT.promoQuota;
    return { quota: quota, used: used, left: Math.max(0, quota - used), full: used >= quota };
  }
  app.get('/api/leanlab/promo', function (req, res) { res.json(Object.assign({ ok: true }, promoStats())); });
  app.post('/api/leanlab/register/promo', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var claim = !!(req.body && req.body.claim);
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    if (claim) {
      var st = promoStats();
      if (st.full && !r.promo) return res.status(409).json(Object.assign({ ok: false, error: 'promo_full' }, st));
      r.promo = true;
    } else {
      // เลือกจ่ายปกติ → ล้างสถานะโปรโมชั่นทั้งหมดกลับเป็นค่าเริ่มต้น (กันหน้าจอเด้งไปหน้าผ่อน/แนบหลักฐาน)
      // ล้างเฉพาะตอนที่ยังไม่ได้แนบสลิป/ยังไม่ยืนยัน — ถ้าจ่ายแล้วห้ามแตะ
      r.promo = false;
      if (['awaiting_payment', 'promo_select', 'promo_review', 'promo_rejected'].indexOf(r.status) >= 0) {
        r.promoPlan = null; r.promoTier = null; r.promoAmount = null; r.promoVerify = null;
        r.installment = null; r.autoVerified = false; r.autoVerifyInfo = null;
        r.fee = EVENT.fee; r.pay = 'bank'; r.status = 'awaiting_payment';
      }
    }
    r.updatedAt = new Date().toISOString();
    writeR(l);
    res.json(Object.assign({ ok: true, registration: publicReg(r) }, promoStats()));
  });

  // รายละเอียดแพ็กเกจโปรโมชั่น (Full / Special)
  app.get('/api/leanlab/promo/plans', function (req, res) { res.json({ ok: true, plans: PROMO }); });

  // เลือกแพ็กเกจ + ระดับราคา (Full Option)
  app.post('/api/leanlab/register/promo/plan', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    if (b.plan === 'special') return res.status(400).json({ ok: false, error: 'special_not_available' });
    if (b.plan !== 'full') return res.status(400).json({ ok: false, error: 'bad_plan' });
    var t = fullTier(b.tier); if (!t) return res.status(400).json({ ok: false, error: 'bad_tier' });
    r.promo = true; r.promoPlan = 'full'; r.promoTier = t.key; r.promoAmount = t.amount; r.fee = t.amount; r.pay = 'bank';
    if (t.needProof) {
      r.promoVerify = 'awaiting_proof'; r.status = 'promo_select';   // รอลูกค้าแนบหลักฐาน
    } else {
      r.promoVerify = 'not_required'; r.status = 'awaiting_payment'; // 44,940 → จ่ายได้เลย
    }
    r.updatedAt = new Date().toISOString();
    writeR(l);
    res.json({ ok: true, registration: publicReg(r), needProof: !!t.needProof });
  });

  // เลือกแพ็กเกจ Special Option (ผ่อน 6 งวด) — วันตัดบัตร = วันที่ชำระงวดแรก (กำหนดตอน checkout ไม่ต้องเลือกเอง)
  app.post('/api/leanlab/register/promo/special', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    if (!PROMO.special.available) return res.status(400).json({ ok: false, error: 'special_not_available' });
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    var ins = PROMO.special.installment;
    r.promo = true; r.promoPlan = 'special'; r.promoTier = 'special'; r.promoAmount = ins.total;
    r.fee = ins.perMonth; r.pay = 'installment'; r.promoVerify = 'not_required';
    r.installment = { months: ins.months, perMonth: ins.perMonth, total: ins.total, day: null, paidCount: 0, status: 'pending' };
    r.status = 'awaiting_payment';
    r.updatedAt = new Date().toISOString();
    writeR(l);
    res.json({ ok: true, registration: publicReg(r) });
  });

  // ---- ตรวจสิทธิ์ส่วนลดอัตโนมัติจากข้อมูลพรีออเดอร์จริง (ลดงานแอดมิน) ----
  function readOrders() { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8')) || []; } catch (e) { return []; } }
  var ORDER_PAID = ['paid', 'PAID', 'confirmed', 'CONFIRMED'];
  // รวมสินค้าที่ลูกค้า (เบอร์/อีเมลนี้) เคยซื้อจากออเดอร์พรีออเดอร์ที่ "ชำระเงินแล้ว"
  function ownedFromPreorder(phone, email) {
    var pd = String(phone || '').replace(/\D/g, ''), em = String(email || '').trim().toLowerCase();
    var owned = { band: false, scale: false, routinex: false, matchedOrders: [] };
    if (!pd && !em) return owned;
    readOrders().forEach(function (o) {
      if (ORDER_PAID.indexOf(o.status) < 0) return;   // เฉพาะออเดอร์ที่จ่ายจริง
      var op = String(o.phone || '').replace(/\D/g, ''), oe = String(o.email || '').trim().toLowerCase();
      if (!((pd && op && op === pd) || (em && oe && oe === em))) return;   // แมตช์เบอร์หรืออีเมล
      owned.matchedOrders.push(o.id);
      (o.items || []).forEach(function (it) {
        var nm = String(it.nm || '').toLowerCase();
        if (nm.indexOf('triple') >= 0) { owned.band = owned.scale = owned.routinex = true; }
        if (nm.indexOf('duo') >= 0) { owned.band = owned.scale = true; }
        if (nm.indexOf('routinex') >= 0) owned.routinex = true;
        if (nm.indexOf('band') >= 0) owned.band = true;
        if (nm.indexOf('scale') >= 0) owned.scale = true;
      });
    });
    return owned;
  }
  function tierQualifies(tierKey, o) {
    if (tierKey === 't1') return !!(o.band && o.scale);                 // Band + Scale
    if (tierKey === 't2') return !!o.routinex;                          // RoutineX
    if (tierKey === 't3') return !!(o.band && o.scale && o.routinex);   // ครบทั้งสาม
    return false;
  }

  // แนบหลักฐานการซื้อ → ตรวจกับพรีออเดอร์จริงอัตโนมัติ; ถ้าตรง → อนุมัติทันที มิฉะนั้นส่งแอดมินตรวจ
  app.post('/api/leanlab/register/promo/proof', limit('proof', 15, 300000), function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r || r.promoPlan !== 'full') return res.status(404).json({ ok: false, error: 'no_registration' });
    if (!(typeof b.proof === 'string' && /^data:image\//.test(b.proof))) return res.status(400).json({ ok: false, error: 'bad_proof' });
    var url = saveImg(b.proof, 'proof-' + m.id); if (!url) return res.status(400).json({ ok: false, error: 'save_failed' });
    r.promoProofUrl = url; r.proofAt = new Date().toISOString();
    // ตรวจสิทธิ์อัตโนมัติจากพรีออเดอร์จริง (เบอร์/อีเมลตรง + ซื้อสินค้าครบตาม tier)
    var owned = ownedFromPreorder(r.phone || m.phone, r.email || m.email);
    if (tierQualifies(r.promoTier, owned)) {
      r.promoVerify = 'verified'; r.status = 'awaiting_payment'; r.autoVerified = true;
      r.autoVerifyInfo = { at: new Date().toISOString(), orders: owned.matchedOrders.slice(0, 10), owned: { band: owned.band, scale: owned.scale, routinex: owned.routinex } };
      r.reviewedAt = new Date().toISOString();
    } else if (noReviewOn()) {
      // ปิดการตรวจสอบชั่วคราว → ผ่านหลักฐานโปรฯ อัตโนมัติ ให้ลูกค้าไปชำระเงินต่อได้ (ทั้งโอนสลิป/บัตรเครดิต)
      r.promoVerify = 'verified'; r.status = 'awaiting_payment'; r.autoVerified = true;
      r.autoVerifyInfo = { at: new Date().toISOString(), noReview: true };
      r.reviewedAt = new Date().toISOString();
      console.log('[lean-lab] registration ' + r.id + ' promo proof auto-passed (no-review mode)');
    } else {
      r.promoVerify = 'pending'; r.status = 'promo_review'; r.autoVerified = false;   // ส่งแอดมินตรวจสลิปเหมือนเดิม
    }
    writeR(l);
    res.json({ ok: true, registration: publicReg(r), autoVerified: !!r.autoVerified });
  });

  app.get('/api/leanlab/event', function (req, res) {
    res.json({ season: EVENT.season, fee: EVENT.fee, minAge: EVENT.minAge, startLaterLabel: EVENT.startLaterLabel, bank: EVENT.bank });
  });

  app.get('/api/leanlab/register/me', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var r = readR().find(function (x) { return x.memberId === m.id && !x.archived; });
    res.json({ ok: true, registration: publicReg(r) });
  });

  // สั่งซื้อรายการใหม่ (1 บัญชีสั่งได้หลายครั้ง แบบ Shopee): เก็บใบที่ยืนยันแล้วเป็นประวัติ แล้วเปิดใบใหม่
  app.post('/api/leanlab/register/reorder', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.json({ ok: true, note: 'no_active' });                 // ไม่มีใบ active = พร้อมเริ่มใหม่อยู่แล้ว
    if (r.status !== 'confirmed') return res.status(409).json({ ok: false, error: 'order_in_progress', registration: publicReg(r) });
    r.archived = true; r.archivedAt = new Date().toISOString(); writeR(l);     // ใบเดิมกลายเป็นประวัติ (ยังนับในสถิติ/แอดมิน)
    res.json({ ok: true });
  });

  app.post('/api/leanlab/register', limit('register', 25, 300000), function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var b = req.body || {};
    var name = String(b.name || '').trim();
    var phone = String(b.phone || '').trim();
    var dob = String(b.dob || '').trim();
    var gender = String(b.gender || '').trim();
    var heightCm = Number(b.heightCm);
    var choice = (b.startChoice === 'now') ? 'now' : (b.startChoice === 'later' ? 'later' : '');
    if (name.length < 2) return res.status(400).json({ ok: false, error: 'bad_name' });
    var age = calcAge(dob);
    if (age == null) return res.status(400).json({ ok: false, error: 'bad_dob' });
    if (age < EVENT.minAge) return res.status(400).json({ ok: false, error: 'underage', minAge: EVENT.minAge });
    if (['ชาย', 'หญิง'].indexOf(gender) < 0) return res.status(400).json({ ok: false, error: 'bad_gender' });
    if (!(heightCm >= 100 && heightCm <= 250)) return res.status(400).json({ ok: false, error: 'bad_height' });
    if (!choice) return res.status(400).json({ ok: false, error: 'bad_choice' });
    var baseline = null;
    if (choice === 'now') {
      var weightKg = Number(b.weightKg), fatPct = Number(b.fatPct), vFat = Number(b.vFat), muscleKg = Number(b.muscleKg), waterPct = Number(b.waterPct);
      if (!(weightKg > 0) || !(fatPct >= 0) || !(vFat >= 0) || !(muscleKg >= 0) || !(waterPct >= 0)) return res.status(400).json({ ok: false, error: 'bad_measurements' });
      var photoUrl = null;
      if (typeof b.beforePhoto === 'string' && /^data:image\//.test(b.beforePhoto)) photoUrl = saveImg(b.beforePhoto, 'before-' + m.id);
      if (!photoUrl) { var _ex = readR().find(function (x) { return x.memberId === m.id && !x.archived; }); if (_ex && _ex.baseline && _ex.baseline.beforePhotoUrl) photoUrl = _ex.baseline.beforePhotoUrl; }  // แก้ไขภายหลัง: เก็บรูปเดิมไว้ถ้าไม่ได้แนบใหม่
      if (!photoUrl) return res.status(400).json({ ok: false, error: 'bad_photo' });
      baseline = { weightKg: weightKg, fatPct: fatPct, vFat: vFat, muscleKg: muscleKg, waterPct: waterPct, beforePhotoUrl: photoUrl };
    }
    var l = readR();
    var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (r && r.status === 'confirmed') return res.status(409).json({ ok: false, error: 'already_registered', registration: publicReg(r) });
    if (!r) { r = { id: genRid(), memberId: m.id, season: EVENT.season, createdAt: new Date().toISOString() }; l.push(r); }
    r.name = name.slice(0, 80); r.dob = dob; r.age = age; r.gender = gender; r.heightCm = heightCm;
    r.startChoice = choice; r.baseline = baseline; r.fee = EVENT.fee; r.pay = 'bank';
    // ทีมโค้ช + ผู้แนะนำ (บังคับกรอกจากหน้าสมัคร)
    var COACHES = ['โค้ชซิง', 'โค้ชนุ่น', 'โค้ชจา', 'โค้ชต๊ะ', 'อื่น ๆ'];
    var coachSel = String(b.coach || '').trim();
    var coachOther = String(b.coachOther || '').trim().slice(0, 60);
    if (COACHES.indexOf(coachSel) >= 0) {
      r.coach = (coachSel === 'อื่น ๆ') ? (coachOther || 'อื่น ๆ') : coachSel;
      r.coachOther = (coachSel === 'อื่น ๆ') ? coachOther : '';
    } else if (coachSel) { r.coach = coachSel.slice(0, 60); r.coachOther = ''; }
    if (typeof b.referrer === 'string' && b.referrer.trim()) r.referrer = b.referrer.trim().slice(0, 80);
    r.email = m.email || ''; r.phone = phone || m.phone || '';
    r.address = String(b.address || r.address || '').slice(0, 300);
    r.postcode = String(b.postcode || r.postcode || '').replace(/\D/g, '').slice(0, 5);
    if (!r.slipUrl) {
      r.status = 'awaiting_payment';
      // ยังไม่ได้แนบสลิป → ล้างสถานะโปรโมชั่นค้างเก่าให้ตรงกับ fee/pay ฐาน (กันข้อมูลค้าง/จอเด้ง)
      r.promo = false; r.promoPlan = null; r.promoTier = null; r.promoAmount = null;
      r.promoVerify = null; r.installment = null; r.autoVerified = false; r.autoVerifyInfo = null;
    }
    r.updatedAt = new Date().toISOString();
    writeR(l);
    // sync member name/phone
    var ml = readM(); var mm = ml.find(function (x) { return x.id === m.id; }); if (mm) { if (!mm.name) mm.name = name.slice(0, 80); if (phone) mm.phone = phone.slice(0, 30); writeM(ml); }
    res.json({ ok: true, registration: publicReg(r), bank: EVENT.bank });
  });

  app.post('/api/leanlab/register/slip', limit('slip', 15, 300000), function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    if (!(typeof b.slip === 'string' && /^data:image\//.test(b.slip))) return res.status(400).json({ ok: false, error: 'bad_slip' });
    if (typeof b.address === 'string' && b.address.trim()) r.address = b.address.trim().slice(0, 300);
    if (typeof b.postcode === 'string' && b.postcode) r.postcode = b.postcode.replace(/\D/g, '').slice(0, 5);
    if (typeof b.addrDetail === 'string') r.addrDetail = b.addrDetail.trim().slice(0, 200);
    if (Array.isArray(b.geo) && b.geo.length === 4) r.geo = b.geo.map(function (x) { return String(x).slice(0, 60); });
    var url = saveImg(b.slip, 'slip-' + m.id); if (!url) return res.status(400).json({ ok: false, error: 'save_failed' });
    r.slipUrl = url; r.slipAt = new Date().toISOString();
    if (noReviewOn()) {
      // ปิดการตรวจสอบชั่วคราว → ยืนยันการชำระเงินอัตโนมัติ (แอดมินมากระทบยอดสลิปย้อนหลังได้)
      r.status = 'confirmed'; assignPO(r); r.autoApproved = true; r.reviewedAt = new Date().toISOString();
      console.log('[lean-lab] registration ' + r.id + ' auto-confirmed (no-review mode, slip)');
    } else {
      r.status = 'pending_review';
    }
    writeR(l);
    res.json({ ok: true, registration: publicReg(r) });
  });

  app.get('/api/leanlab/file/:fn', function (req, res) {
    var fn = path.basename(req.params.fn); var p = path.join(UP, fn);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });

  // ---- Card payment via Stripe Checkout (สำหรับโปรโมชั่น Full Option) ----
  function stripeCfg() { return !!process.env.STRIPE_SECRET_KEY; }
  function createCard(reg, base) {
    return new Promise(function (resolve) {
      if (!stripeCfg()) { resolve(null); return; }
      var amount = Number(reg.fee) || 0;
      if (!(amount > 0)) { resolve(null); return; }
      var name = 'Lean Lab · Grand Slam Offer' + (reg.promoTier ? (' (' + reg.promoTier + ')') : '');
      var params = [];
      params.push(['mode', 'payment']);
      params.push(['client_reference_id', 'LL:' + reg.id]);
      params.push(['success_url', base + '/leanlab?paid=' + encodeURIComponent(reg.id)]);
      params.push(['cancel_url', base + '/leanlab']);
      params.push(['metadata[leanlab_reg]', reg.id]);
      if (reg.email) params.push(['customer_email', reg.email]);
      params.push(['line_items[0][price_data][currency]', 'thb']);
      params.push(['line_items[0][price_data][product_data][name]', name]);
      params.push(['line_items[0][price_data][unit_amount]', String(Math.round(amount * 100))]);
      params.push(['line_items[0][quantity]', '1']);
      var body = params.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
      var r = https.request({ hostname: 'api.stripe.com', path: '/v1/checkout/sessions', method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, function (resp) {
        var b = ''; resp.on('data', function (d) { b += d; });
        resp.on('end', function () { try { var j = JSON.parse(b); if (resp.statusCode >= 200 && resp.statusCode < 300 && j.url) resolve({ url: j.url, id: j.id }); else { console.log('[lean-lab] stripe fail', resp.statusCode, b.slice(0, 160)); resolve(null); } } catch (e) { resolve(null); } });
      });
      r.on('error', function () { resolve(null); }); r.write(body); r.end();
    });
  }
  app.post('/api/leanlab/register/pay/card', limit('pay', 15, 300000), function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    if (!stripeCfg()) return res.status(400).json({ ok: false, error: 'stripe_not_configured' });
    var b = req.body || {};
    var r = readR().find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    if (typeof b.address === 'string' && b.address.trim()) r.address = b.address.trim().slice(0, 300);
    if (typeof b.postcode === 'string' && b.postcode) r.postcode = b.postcode.replace(/\D/g, '').slice(0, 5);
    if (typeof b.addrDetail === 'string') r.addrDetail = b.addrDetail.trim().slice(0, 200);
    if (Array.isArray(b.geo) && b.geo.length === 4) r.geo = b.geo.map(function (x) { return String(x).slice(0, 60); });
    if (r.status === 'cancelled' && r.autoCancelled) { var lc = readR(); var rc = lc.find(function (x) { return x.id === r.id; }); if (rc) { rc.status = 'awaiting_payment'; rc.autoCancelled = false; rc.cancelReason = null; rc.updatedAt = new Date().toISOString(); writeR(lc); } r.status = 'awaiting_payment'; }
    if (r.status !== 'awaiting_payment') return res.status(400).json({ ok: false, error: 'not_ready' });
    createCard(r, baseUrl(req)).then(function (s) {
      if (!s || !s.url) return res.status(502).json({ ok: false, error: 'stripe_error' });
      var l = readR(); var x = l.find(function (y) { return y.id === r.id; }); if (x) { x.cardSessionId = s.id; x.address = r.address || x.address || ''; x.postcode = r.postcode || x.postcode || ''; x.addrDetail = r.addrDetail || x.addrDetail || ''; if (r.geo) x.geo = r.geo; writeR(l); }
      res.json({ ok: true, url: s.url });
    });
  });
  // เรียกจาก Stripe webhook (server.js) เมื่อชำระบัตรสำเร็จ → ยืนยันอัตโนมัติ
  app.locals.leanlabStripePaid = function (regId, s) {
    var l = readR(); var r = l.find(function (x) { return x.id === regId; });
    if (!r) return false;
    r.status = 'confirmed'; r.pay = 'card'; assignPO(r);
    r.stripe = { sessionId: (s && s.id) || null, paymentIntent: (s && s.payment_intent) || null, amount: (s && s.amount_total != null ? s.amount_total / 100 : null), at: new Date().toISOString() };
    r.reviewedAt = new Date().toISOString();
    writeR(l);
    console.log('[lean-lab] registration ' + regId + ' paid by card (webhook) → confirmed');
    return true;
  };

  // ---- Special Option: ผ่อนชำระผ่าน Stripe Subscription (6 งวด) ----
  // เรียก Stripe API แบบดิบ (form-encoded) — คืน object ที่ parse แล้ว หรือ null เมื่อพลาด
  function stripeApi(method, apiPath, params) {
    return new Promise(function (resolve) {
      if (!process.env.STRIPE_SECRET_KEY) { resolve(null); return; }
      var body = (params || []).map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
      var opt = { hostname: 'api.stripe.com', path: apiPath, method: method, headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
      var rq = https.request(opt, function (resp) {
        var b = ''; resp.on('data', function (d) { b += d; });
        resp.on('end', function () { try { var j = JSON.parse(b); if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(j); else { console.log('[lean-lab] stripe ' + method + ' ' + apiPath + ' fail', resp.statusCode, b.slice(0, 180)); resolve(null); } } catch (e) { resolve(null); } });
      });
      rq.on('error', function () { resolve(null); }); rq.write(body); rq.end();
    });
  }
  // วันตัดบัตรงวดถัดไป: วันที่ D ของเดือน (โซนเวลาไทย) ที่ห่างจากตอนนี้อย่างน้อย ~18 วัน
  function nextBillingTs(day) {
    var TZ = 7 * 3600 * 1000;                     // Asia/Bangkok = UTC+7
    var now = Date.now();
    for (var add = 0; add <= 2; add++) {
      var d = new Date(now + TZ);                  // เวลาไทยตอนนี้
      var y = d.getUTCFullYear(), mo = d.getUTCMonth() + add;
      // 03:00 UTC = 10:00 น. ตามเวลาไทย ของวันที่ D
      var ts = Date.UTC(y, mo, day, 3, 0, 0);
      if (ts >= now + 18 * 86400000) return Math.floor(ts / 1000);
    }
    return Math.floor((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 2, day, 3, 0, 0)) / 1000);
  }
  function createInstallment(reg, base) {
    var perMonth = (reg.installment && reg.installment.perMonth) || 7490;
    var params = [];
    params.push(['mode', 'subscription']);
    params.push(['client_reference_id', 'LLI:' + reg.id]);
    params.push(['success_url', base + '/leanlab?paid=' + encodeURIComponent(reg.id)]);
    params.push(['cancel_url', base + '/leanlab']);
    if (reg.email) params.push(['customer_email', reg.email]);
    params.push(['line_items[0][price_data][currency]', 'thb']);
    params.push(['line_items[0][price_data][recurring][interval]', 'month']);
    params.push(['line_items[0][price_data][product_data][name]', 'Lean Lab · Special Option (ผ่อน 6 งวด งวดละ ' + perMonth.toLocaleString('en-US') + ' บาท)']);
    params.push(['line_items[0][price_data][unit_amount]', String(Math.round(perMonth * 100))]);
    params.push(['line_items[0][quantity]', '1']);
    params.push(['subscription_data[metadata][leanlab_reg]', reg.id]);
    params.push(['subscription_data[metadata][leanlab_day]', String((reg.installment && reg.installment.day) || '')]);
    params.push(['subscription_data[metadata][leanlab_months]', String((reg.installment && reg.installment.months) || 6)]);
    return stripeApi('POST', '/v1/checkout/sessions', params).then(function (j) { return (j && j.url) ? { url: j.url, id: j.id } : null; });
  }
  app.post('/api/leanlab/register/pay/installment', limit('pay', 15, 300000), function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(400).json({ ok: false, error: 'stripe_not_configured' });
    var b = req.body || {};
    var r = readR().find(function (x) { return x.memberId === m.id && !x.archived; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    if (typeof b.address === 'string' && b.address.trim()) r.address = b.address.trim().slice(0, 300);
    if (typeof b.postcode === 'string' && b.postcode) r.postcode = b.postcode.replace(/\D/g, '').slice(0, 5);
    if (typeof b.addrDetail === 'string') r.addrDetail = b.addrDetail.trim().slice(0, 200);
    if (Array.isArray(b.geo) && b.geo.length === 4) r.geo = b.geo.map(function (x) { return String(x).slice(0, 60); });
    if (r.promoPlan !== 'special' || !r.installment) return res.status(400).json({ ok: false, error: 'not_special' });
    if (r.status === 'cancelled' && r.autoCancelled) { var lc = readR(); var rc = lc.find(function (x) { return x.id === r.id; }); if (rc) { rc.status = 'awaiting_payment'; rc.autoCancelled = false; rc.cancelReason = null; rc.updatedAt = new Date().toISOString(); writeR(lc); } r.status = 'awaiting_payment'; }
    if (r.status !== 'awaiting_payment') return res.status(400).json({ ok: false, error: 'not_ready' });
    createInstallment(r, baseUrl(req)).then(function (s) {
      if (!s || !s.url) return res.status(502).json({ ok: false, error: 'stripe_error' });
      var l = readR(); var x = l.find(function (y) { return y.id === r.id; }); if (x) { if (x.installment) x.installment.checkoutId = s.id; x.address = r.address || x.address || ''; x.postcode = r.postcode || x.postcode || ''; x.addrDetail = r.addrDetail || x.addrDetail || ''; if (r.geo) x.geo = r.geo; writeR(l); }
      res.json({ ok: true, url: s.url });
    });
  });
  // webhook: checkout.session.completed (subscription) → งวดแรกชำระแล้ว → ยืนยันสิทธิ์ + เลื่อนวันตัดบัตรงวดถัดไปเป็นวันที่ลูกค้าเลือก
  app.locals.leanlabInstallmentCheckout = function (regId, s) {
    var l = readR(); var r = l.find(function (x) { return x.id === regId; });
    if (!r || !r.installment) return false;
    var subId = (s && s.subscription) || null;
    r.installment.subId = subId;
    r.installment.customerId = (s && s.customer) || null;
    r.installment.paidCount = 1;                  // งวดแรกชำระตอน checkout
    r.installment.status = 'active';
    r.installment.firstPaidAt = new Date().toISOString();
    r.status = 'confirmed'; r.pay = 'installment'; assignPO(r);
    r.stripe = { checkoutId: (s && s.id) || null, subscriptionId: subId, at: new Date().toISOString() };
    r.reviewedAt = new Date().toISOString();
    writeR(l);
    // วันตัดบัตร = วันที่ชำระงวดแรก (เวลาไทย UTC+7) — Stripe จะตัดงวด 2-6 ตรงวันครบรอบเดือนของวันที่จ่ายเองอยู่แล้ว
    var thai = new Date(Date.now() + 7 * 3600 * 1000);
    r.installment.day = thai.getUTCDate();
    writeR(l);
    console.log('[lean-lab] installment ' + regId + ' first payment ok (webhook) → confirmed, sub=' + subId + ', billDay=' + r.installment.day);
    // ไม่เลื่อนวันตัดบัตรอีกต่อไป — ปล่อยให้ Stripe ตัดตามวันครบรอบของวันที่ชำระงวดแรก
    // ตั้ง cancel_at เป็นเพดานความปลอดภัย: หยุดตัดบัตรหลังงวดที่ 6 เสมอ แม้ webhook งวดถัดไปจะพลาด
    if (subId) {
      var months = r.installment.months || 6;
      var now = new Date();
      // งวดสุดท้าย (งวดที่ months) = วันชำระ + (months-1) เดือน; cancel หลังจากนั้น 2 วัน
      var cancelTs = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (months - 1), now.getUTCDate() + 2, now.getUTCHours(), now.getUTCMinutes(), 0) / 1000);
      stripeApi('POST', '/v1/subscriptions/' + encodeURIComponent(subId), [['cancel_at', String(cancelTs)]]).then(function (j) {
        var l2 = readR(); var r2 = l2.find(function (x) { return x.id === regId; });
        if (r2 && r2.installment) { r2.installment.cancelAtTs = cancelTs; writeR(l2); }
        console.log('[lean-lab] installment ' + regId + ' cancel_at @' + new Date(cancelTs * 1000).toISOString() + ' ' + (j ? 'ok' : 'FAILED'));
      });
    }
    return true;
  };
  // หา reg จาก subscription id
  function findRegBySub(subId) { var l = readR(); return { l: l, r: l.find(function (x) { return x.installment && x.installment.subId === subId; }) }; }
  // webhook: invoice.paid — นับเฉพาะรอบบิลถัดไป (subscription_cycle) เป็นงวด 2-6; ครบ 6 งวด → ยกเลิก subscription
  app.locals.leanlabInstallmentInvoicePaid = function (subId, inv) {
    var f = findRegBySub(subId); var r = f.r; if (!r || !r.installment) return false;
    var reason = (inv && inv.billing_reason) || '';
    if (reason === 'subscription_create') return false; // งวดแรกนับไปแล้วตอน checkout
    var invId = (inv && inv.id) || '';
    r.installment.seen = r.installment.seen || [];
    if (invId && r.installment.seen.indexOf(invId) >= 0) return false; // กัน event ซ้ำ
    if (invId) r.installment.seen.push(invId);
    r.installment.paidCount = (r.installment.paidCount || 0) + 1;
    r.installment.lastPaidAt = new Date().toISOString();
    if (r.installment.lastFail) delete r.installment.lastFail;
    var months = r.installment.months || 6;
    writeR(f.l);
    console.log('[lean-lab] installment ' + r.id + ' paid งวด ' + r.installment.paidCount + '/' + months);
    if (r.installment.paidCount >= months) {
      // ครบแล้ว → ยกเลิก subscription ไม่ให้ตัดต่อ
      stripeApi('DELETE', '/v1/subscriptions/' + encodeURIComponent(subId), []).then(function (j) {
        var l2 = readR(); var r2 = l2.find(function (x) { return x.id === r.id; });
        if (r2 && r2.installment) { r2.installment.status = 'completed'; r2.installment.completedAt = new Date().toISOString(); writeR(l2); }
        console.log('[lean-lab] installment ' + r.id + ' complete (6/6) → subscription cancelled ' + (j ? 'ok' : 'FAILED'));
      });
    }
    return true;
  };
  // webhook: invoice.payment_failed — บันทึกไว้ให้ทีมงานติดตาม (Stripe จะ retry ตาม dunning เอง)
  app.locals.leanlabInstallmentInvoiceFailed = function (subId, inv) {
    var f = findRegBySub(subId); var r = f.r; if (!r || !r.installment) return false;
    if ((inv && inv.billing_reason) === 'subscription_create') return false;
    r.installment.lastFail = { at: new Date().toISOString(), amount: (inv && inv.amount_due != null ? inv.amount_due / 100 : null), attempt: (inv && inv.attempt_count) || null };
    r.installment.status = 'past_due';
    writeR(f.l);
    console.log('[lean-lab] installment ' + r.id + ' payment FAILED (งวดถัดไป) attempt=' + ((inv && inv.attempt_count) || '?'));
    return true;
  };

  // ---- Back-office (Support dept manages Lean Lab) ----
  // ล็อกทุก endpoint หลังบ้านด้วย ADMIN_KEY (env) — ยังไม่ตั้ง env ใช้ค่าเริ่มต้น '@dev1234' (เปลี่ยนได้ภายหลังผ่าน Railway Variables)
  var LL_ADMIN_KEY = process.env.LEANLAB_ADMIN_KEY || '@dev1234';
  if (!process.env.LEANLAB_ADMIN_KEY) console.warn('[lean-lab] ⚠ LEANLAB_ADMIN_KEY not set — using weak default. Set a strong key in Railway env.');
  function adminGuard(req, res) {
    var ip = clientIp(req), f = _adminFail[ip];
    // ถูกล็อกอยู่ (ใส่รหัสผิดหลายครั้ง)
    if (f && f.until > Date.now()) { res.status(429).json({ ok: false, error: 'locked', message: 'ใส่รหัสผิดหลายครั้ง ถูกล็อกชั่วคราว กรุณารอสักครู่' }); return false; }
    var k = (req.query && req.query.key) || (req.body && req.body.key) || req.headers['x-admin-key'] || '';
    if (String(k) !== LL_ADMIN_KEY) {
      f = _adminFail[ip] || { n: 0, until: 0 }; f.n++;
      if (f.n >= 8) { f.until = Date.now() + 10 * 60 * 1000; f.n = 0; }   // ผิดครบ 8 ครั้ง → ล็อก 10 นาที
      _adminFail[ip] = f;
      res.status(403).json({ ok: false, error: 'forbidden' }); return false;
    }
    if (_adminFail[ip]) _adminFail[ip].n = 0;   // สำเร็จ → รีเซ็ต
    return true;
  }
  function adminReg(r, byId) {
    var mem = byId[r.memberId] || {};
    return {
      id: r.id, po: r.po || null, memberId: r.memberId, name: r.name || mem.name || '', email: r.email || mem.email || '', phone: r.phone || mem.phone || '',
      address: r.address || '', postcode: r.postcode || '',
      age: r.age, gender: r.gender, heightCm: r.heightCm, startChoice: r.startChoice, baseline: r.baseline || null,
      coach: r.coach || '', coachOther: r.coachOther || '', referrer: r.referrer || '',
      fee: r.fee, pay: r.pay, promo: !!r.promo, promoPlan: r.promoPlan || null, promoTier: r.promoTier || null,
      promoAmount: r.promoAmount || null, promoVerify: r.promoVerify || null, promoProofUrl: r.promoProofUrl || null,
      autoVerified: !!r.autoVerified, autoVerifyInfo: r.autoVerifyInfo || null,
      installment: r.installment ? { months: r.installment.months, perMonth: r.installment.perMonth, total: r.installment.total, day: r.installment.day, paidCount: r.installment.paidCount || 0, status: r.installment.status || null, subId: r.installment.subId || null, nextChargeTs: r.installment.nextChargeTs || null, lastFail: r.installment.lastFail || null } : null,
      slipUrl: r.slipUrl || null, status: r.status, createdAt: r.createdAt, slipAt: r.slipAt || null,
      cancelReason: r.cancelReason || null, rejectReason: r.rejectReason || null, refund: r.refund || null, autoCancelled: !!r.autoCancelled
    };
  }
  // ยกเลิกอัตโนมัติ: ใบสมัครที่รอชำระเงินเกิน 1 วัน (ยังไม่จ่าย) → cancelled
  function autoCancelSweep(l) {
    var now = Date.now(), changed = false;
    l.forEach(function (r) {
      if (r.status === 'awaiting_payment' && !r.slipUrl) {
        var t = new Date(r.updatedAt || r.createdAt || 0).getTime();
        if (t && now - t > 24 * 3600 * 1000) { r.status = 'cancelled'; r.autoCancelled = true; r.cancelReason = 'ไม่ชำระเงินภายใน 1 วัน (ระบบยกเลิกอัตโนมัติ)'; r.cancelledAt = new Date().toISOString(); changed = true; }
      }
    });
    return changed;
  }
  app.get('/api/leanlab/admin/registrations', function (req, res) {
    if (!adminGuard(req, res)) return;
    var regs = readR(); if (autoCancelSweep(regs)) writeR(regs);
    var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    var list = regs.map(function (r) { return adminReg(r, byId); }).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    var counts = { total: list.length, awaiting_payment: 0, pending_review: 0, confirmed: 0, rejected: 0, revenue: 0 };
    list.forEach(function (r) { if (counts[r.status] != null) counts[r.status]++; if (r.status === 'confirmed') counts.revenue += (Number(r.fee) || 0); });
    res.json({ ok: true, registrations: list, counts: counts, members: readM().length, promo: promoStats() });
  });
  // ตั้งค่าระบบ (เช่น ปิดการตรวจสอบชั่วคราว) — อ่าน/แก้ ด้วยคีย์แอดมิน
  // หมายเหตุ: webhook/ความลับของ Lark อ่านจาก Railway Variables เท่านั้น ไม่เก็บในไฟล์ตั้งค่านี้
  function larkStatus() {
    return {
      configured: larkConfigured(),
      payRoom: !!process.env.LARK_PAY_WEBHOOK_URL,     // มีห้องเงินแยกไหม
      mainRoom: !!process.env.LARK_WEBHOOK_URL,        // มีห้องหลักไหม
      signed: !!(process.env.LARK_PAY_BOT_SECRET || process.env.LARK_BOT_SECRET)
    };
  }
  app.get('/api/leanlab/admin/settings', function (req, res) {
    if (!adminGuard(req, res)) return;
    res.json({ ok: true, settings: readSettings(), lark: larkStatus() });
  });
  app.post('/api/leanlab/admin/settings', function (req, res) {
    if (!adminGuard(req, res)) return;
    var b = req.body || {}; var s = readSettings();
    if (typeof b.noReview === 'boolean') s.noReview = b.noReview;
    s.updatedAt = new Date().toISOString();
    writeSettings(s);
    console.log('[lean-lab] settings updated: noReview=' + (!!s.noReview));
    res.json({ ok: true, settings: s });
  });
  // ทดสอบส่งการ์ดตัวอย่างเข้าห้องเงิน Lark (ตรวจว่า webhook ใช้งานได้) — ไม่ได้ตั้งเลยตอบ 503
  app.post('/api/leanlab/admin/lark-test', function (req, res) {
    if (!adminGuard(req, res)) return;
    var st = larkStatus();
    if (!st.configured) return res.status(503).json({ ok: false, error: 'no_webhook', message: 'ยังไม่ได้ตั้ง LARK_PAY_WEBHOOK_URL หรือ LARK_WEBHOOK_URL ใน Railway' });
    notifyLarkPaid({ name: 'ทดสอบระบบ (Test)', po: 'LL-TEST01', fee: 39950, pay: 'bank', phone: '08x-xxx-xxxx', email: 'test@cloverxth.com', coach: 'โค้ชนุ่น', referrer: '-' }, true);
    res.json({ ok: true, sent: true, room: st.payRoom ? 'pay' : 'main' });
  });
  // ข้อมูลรายงานสรุป (ให้แดชบอร์ดดึงไปแสดงตัวเลขชุดเดียวกับรายงาน)
  app.get('/api/leanlab/admin/report-data', function (req, res) {
    if (!adminGuard(req, res)) return;
    res.json({ ok: true, data: buildReportData(), startLaterLabel: EVENT.startLaterLabel });
  });
  // แดชบอร์ดส่งภาพที่เรนเดอร์มาเก็บไว้ (ใช้แนบในรายงานอัตโนมัติ) — ไม่ส่งเข้า Lark
  app.post('/api/leanlab/admin/dashboard-snapshot', function (req, res) {
    if (!adminGuard(req, res)) return;
    var b = req.body || {};
    if (typeof b.image === 'string' && /^data:image\/png;base64,/.test(b.image)) {
      try { _dashSnap = Buffer.from(b.image.split(',')[1], 'base64'); } catch (e) {}
    }
    res.json({ ok: true, cached: !!_dashSnap });
  });
  // กดส่งรายงานเข้า Lark ตอนนี้ (ปุ่มบนแดชบอร์ด) — แนบภาพที่ส่งมา หรือใช้ภาพล่าสุดที่ cache ไว้
  app.post('/api/leanlab/admin/lark-report', function (req, res) {
    if (!adminGuard(req, res)) return;
    if (!larkConfigured()) return res.status(503).json({ ok: false, error: 'no_webhook', message: 'ยังไม่ได้ตั้ง webhook ใน Railway' });
    var b = req.body || {}, img = null;
    if (typeof b.image === 'string' && /^data:image\/png;base64,/.test(b.image)) { try { img = Buffer.from(b.image.split(',')[1], 'base64'); _dashSnap = img; } catch (e) {} }
    if (!img) img = _dashSnap;
    var when = ''; try { when = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }); } catch (e) { when = ''; }
    sendLeanLabReport('กดส่งเอง' + (when ? (' · ' + when + ' น.') : ''), img);
    res.json({ ok: true, sent: true, withImage: !!img });
  });
  app.post('/api/leanlab/admin/registration/:id', function (req, res) {
    if (!adminGuard(req, res)) return;
    var b = req.body || {}; var st = b.status;
    if (['confirmed', 'rejected', 'pending_review', 'awaiting_payment'].indexOf(st) < 0) return res.status(400).json({ ok: false, error: 'bad_status' });
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    var wasConfirmed = (r.status === 'confirmed');
    r.status = st; r.reviewedAt = new Date().toISOString();
    if (st === 'confirmed') assignPO(r);
    if (st === 'rejected') r.rejectReason = String(b.reason || '').slice(0, 200) || 'หลักฐานไม่ถูกต้อง';
    writeR(l);
    var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    res.json({ ok: true, registration: adminReg(r, byId) });
  });
  // ตรวจหลักฐานการซื้อของโปรโมชั่น (ระดับราคาที่มีส่วนลด)
  app.post('/api/leanlab/admin/registration/:id/promo-verify', function (req, res) {
    if (!adminGuard(req, res)) return;
    var result = (req.body || {}).result;
    if (['verified', 'rejected'].indexOf(result) < 0) return res.status(400).json({ ok: false, error: 'bad_result' });
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    r.promoVerify = result;
    r.status = (result === 'verified') ? 'awaiting_payment' : 'promo_rejected';
    if (result === 'rejected') r.rejectReason = String((req.body || {}).reason || '').slice(0, 200) || 'หลักฐานไม่ถูกต้อง';
    else r.rejectReason = null;
    r.reviewedAt = new Date().toISOString();
    writeR(l);
    var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    res.json({ ok: true, registration: adminReg(r, byId) });
  });
  // "ยกเลิก" = ส่งลูกค้ากลับไปหน้าชำระเงิน (ไม่ลบสมาชิกออกจากระบบ)
  // เคลียร์สลิป/หลักฐาน แล้วตั้งสถานะเป็น awaiting_payment เพื่อให้ลูกค้าชำระใหม่ได้
  app.post('/api/leanlab/admin/registration/:id/cancel', function (req, res) {
    if (!adminGuard(req, res)) return;
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    r.status = 'awaiting_payment';
    r.slipUrl = null; r.slip = null;
    r.cancelReason = null; r.cancelledAt = null; r.autoCancelled = false;
    // เก็บเหตุผลไว้แสดงให้ลูกค้าเห็นบนหน้าชำระเงิน (ถ้าระบุมา)
    var reason = String(b.reason || '').slice(0, 200);
    r.rejectReason = reason || null;
    r.reviewedAt = new Date().toISOString();
    writeR(l);
    var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    res.json({ ok: true, registration: adminReg(r, byId) });
  });
  // แก้ไขข้อมูลลูกค้า (ชื่อ / เบอร์โทร / อีเมล / ที่อยู่จัดส่ง)
  app.post('/api/leanlab/admin/registration/:id/edit', function (req, res) {
    if (!adminGuard(req, res)) return;
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    if (typeof b.email === 'string' && b.email.trim()) {
      var newEmail = b.email.trim().toLowerCase();
      if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ ok: false, error: 'bad_email' });
      var clash = readM().some(function (m) { return m.id !== r.memberId && String(m.email || '').toLowerCase() === newEmail; });
      if (clash) return res.status(409).json({ ok: false, error: 'email_taken' });
      r.email = newEmail;
    }
    if (typeof b.name === 'string' && b.name.trim().length >= 2) r.name = b.name.trim().slice(0, 80);
    if (typeof b.phone === 'string') r.phone = b.phone.trim().slice(0, 30);
    if (typeof b.address === 'string') r.address = b.address.trim().slice(0, 300);
    if (typeof b.postcode === 'string') r.postcode = b.postcode.replace(/\D/g, '').slice(0, 5);
    if (typeof b.coach === 'string') {
      var cs = b.coach.trim();
      if (cs === 'อื่น ๆ') { r.coach = (typeof b.coachOther === 'string' && b.coachOther.trim()) ? b.coachOther.trim().slice(0, 60) : 'อื่น ๆ'; r.coachOther = (typeof b.coachOther === 'string' ? b.coachOther.trim().slice(0, 60) : ''); }
      else { r.coach = cs.slice(0, 60); r.coachOther = ''; }
    }
    if (typeof b.referrer === 'string') r.referrer = b.referrer.trim().slice(0, 80);
    r.updatedAt = new Date().toISOString();
    writeR(l);
    if (r.memberId) { var ml = readM(); var mm = ml.find(function (m) { return m.id === r.memberId; }); if (mm) { mm.name = r.name; if (r.phone) mm.phone = r.phone; if (r.email) mm.email = r.email; writeM(ml); } }
    var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    res.json({ ok: true, registration: adminReg(r, byId) });
  });
  // คืนเงิน (บัตรเครดิต) — ชำระครั้งเดียว: เต็ม/บางส่วนผ่าน Stripe · แผนผ่อน: ยกเลิก subscription หยุดตัดงวดถัดไป (งวดที่จ่ายแล้วไม่คืน)
  app.post('/api/leanlab/admin/registration/:id/refund', function (req, res) {
    if (!adminGuard(req, res)) return;
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    function done(r2) { var byId = {}; readM().forEach(function (m) { byId[m.id] = m; }); res.json({ ok: true, registration: adminReg(r2, byId) }); }

    // ---- บันทึกว่าคืนเงิน/ยกเลิกแล้ว (ทำนอกระบบ) — ไม่แตะ Stripe เลย ----
    // ใช้เมื่อ staff คืนเงิน/ยกเลิกไปเองแล้วนอกระบบ (เช่นใน Stripe Dashboard) แค่ต้องการมาร์กสถานะให้ตรง
    if (b.mode === 'manual') {
      if (r.installment) { r.installment.status = 'cancelled'; r.installment.cancelledAt = new Date().toISOString(); }
      r.status = 'refunded';
      var mamt = Number(b.amount);
      r.refund = { mode: 'manual_external', amount: (mamt > 0 ? mamt : 0), note: (typeof b.note === 'string' ? b.note.slice(0, 200) : 'ทำนอกระบบโดยทีมงาน'), at: new Date().toISOString() };
      writeR(l);
      console.log('[lean-lab] ' + req.params.id + ' marked refunded/cancelled MANUALLY (no Stripe) by admin');
      return done(r);
    }

    // ---- แผนผ่อน: ยกเลิก subscription (หยุดตัดบัตรงวดถัดไป) — งวดที่จ่ายมาแล้วไม่คืน ----
    if (r.installment) {
      var subId = (r.installment && r.installment.subId) || (r.stripe && r.stripe.subscriptionId);
      if (!subId) return res.status(400).json({ ok: false, error: 'no_subscription' });
      var paidKept = (Number(r.installment.perMonth) || 0) * (Number(r.installment.paidCount) || 0);
      // subscription ปิดไปแล้ว (ครบ 6 งวด หรือยกเลิกไปแล้ว) → ไม่ต้องเรียก Stripe ซ้ำ แค่บันทึกสถานะ
      if (r.installment.status === 'completed' || r.installment.status === 'cancelled') {
        var lc = readR(); var rc = lc.find(function (x) { return x.id === req.params.id; });
        if (rc) { if (rc.installment) rc.installment.status = 'cancelled'; rc.status = 'refunded'; rc.refund = { mode: 'installment_cancel', subId: subId, paidKept: paidKept, paidCount: (rc.installment ? rc.installment.paidCount : 0), amount: 0, note: 'subscription_already_closed', at: new Date().toISOString() }; writeR(lc); }
        return done(rc);
      }
      stripeApi('DELETE', '/v1/subscriptions/' + encodeURIComponent(subId), []).then(function (j) {
        if (!j || !j.id) return res.status(502).json({ ok: false, error: 'stripe_error' });
        var l2 = readR(); var r2 = l2.find(function (x) { return x.id === req.params.id; });
        if (r2) {
          if (r2.installment) { r2.installment.status = 'cancelled'; r2.installment.cancelledAt = new Date().toISOString(); }
          r2.status = 'refunded';
          r2.refund = { mode: 'installment_cancel', subId: subId, paidKept: paidKept, paidCount: (r2.installment ? r2.installment.paidCount : 0), amount: 0, at: new Date().toISOString() };
          writeR(l2);
        }
        console.log('[lean-lab] installment ' + req.params.id + ' cancelled by admin (sub=' + subId + ', paidKept=' + paidKept + ' not refunded)');
        done(r2);
      });
      return;
    }

    // ---- ชำระครั้งเดียว (บัตร): คืนเต็ม/บางส่วนผ่าน Stripe ----
    var pi = r.stripe && r.stripe.paymentIntent;
    if (!pi) return res.status(400).json({ ok: false, error: 'no_card_payment' });
    var params = [['payment_intent', pi]];
    if (b.mode === 'partial') {
      var amt = Number(b.amount);
      if (!(amt > 0)) return res.status(400).json({ ok: false, error: 'bad_amount' });
      var maxAmt = (Number(r.promoAmount) || Number(r.fee) || 0);
      if (maxAmt > 0 && amt > maxAmt) return res.status(400).json({ ok: false, error: 'amount_too_high' });
      params.push(['amount', String(Math.round(amt * 100))]);
    }
    stripeApi('POST', '/v1/refunds', params).then(function (j) {
      if (!j || !j.id) return res.status(502).json({ ok: false, error: 'stripe_error' });
      var l2 = readR(); var r2 = l2.find(function (x) { return x.id === req.params.id; });
      if (r2) { r2.refund = { id: j.id, amount: (j.amount != null ? j.amount / 100 : null), mode: (b.mode === 'partial' ? 'partial' : 'full'), at: new Date().toISOString() }; if (b.mode !== 'partial') r2.status = 'refunded'; writeR(l2); }
      done(r2);
    });
  });
  // ลบผู้สมัคร (ลบทั้งใบสมัคร + บัญชีสมาชิก ถ้า withMember=1)
  app.post('/api/leanlab/admin/registration/:id/delete', function (req, res) {
    if (!adminGuard(req, res)) return;
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    var mid = r.memberId;
    var nl = l.filter(function (x) { return x.id !== req.params.id; }); writeR(nl);
    if ((req.body && req.body.withMember) && mid) {
      var ml = readM().filter(function (m) { return m.id !== mid; }); writeM(ml);
    }
    res.json({ ok: true, deleted: req.params.id });
  });
  // รีเซ็ตทั้งหมด: ลบสมาชิก + ใบสมัครทั้งหมด (สำรองไฟล์อัตโนมัติก่อนล้าง) — สำหรับทดสอบ
  app.post('/api/leanlab/admin/reset', function (req, res) {
    if (!adminGuard(req, res)) return;
    var members = readM(), regs = readR();
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { fs.writeFileSync(path.join(DIR, 'members.backup-' + stamp + '.json'), JSON.stringify(members, null, 2)); } catch (e) {}
    try { fs.writeFileSync(path.join(DIR, 'registrations.backup-' + stamp + '.json'), JSON.stringify(regs, null, 2)); } catch (e) {}
    writeM([]); writeR([]);
    res.json({ ok: true, cleared: { members: members.length, registrations: regs.length }, backup: stamp });
  });

  // ============================ LINE LOGIN (OAuth2) ============================
  app.get('/auth/leanlab/line/login', function (req, res) {
    // โหมด dev: ข้าม OAuth จริง เพื่อทดสอบ (เปิดเมื่อ LINE_DEV_FAKE=1 และยังไม่ได้ตั้ง channel จริง)
    if (process.env.LINE_DEV_FAKE === '1' && !lineConfigured()) {
      const m = findOrCreate('lineId', 'DEV-' + crypto.randomBytes(4).toString('hex'), { name: 'ผู้ใช้ LINE (ทดสอบ)', provider: 'line', picture: '' });
      setSession(res, { pid: m.id });
      return res.redirect('/leanlab');
    }
    if (!lineConfigured()) return res.redirect('/leanlab?err=line_not_configured');
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, OAUTH_COOKIE, 'line:' + state, 10 * 60 * 1000);
    const redirect = baseUrl(req) + '/auth/leanlab/line/callback';
    const u = 'https://access.line.me/oauth2/v2.1/authorize?response_type=code'
      + '&client_id=' + encodeURIComponent(process.env.LINE_CHANNEL_ID)
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&state=' + state + '&scope=' + encodeURIComponent('profile openid');
    res.redirect(u);
  });

  app.get('/auth/leanlab/line/callback', function (req, res) {
    const code = req.query.code, state = req.query.state;
    const c = parseCookies(req); clearCookie(res, OAUTH_COOKIE);
    if (!code || !state || c[OAUTH_COOKIE] !== 'line:' + state) return res.redirect('/leanlab?err=line_state');
    const redirect = baseUrl(req) + '/auth/leanlab/line/callback';
    const form = 'grant_type=authorization_code&code=' + encodeURIComponent(code)
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&client_id=' + encodeURIComponent(process.env.LINE_CHANNEL_ID)
      + '&client_secret=' + encodeURIComponent(process.env.LINE_CHANNEL_SECRET);
    httpsReq({ hostname: 'api.line.me', path: '/oauth2/v2.1/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) } }, form)
      .then(function (tok) {
        let tj; try { tj = JSON.parse(tok.body); } catch (e) { tj = null; }
        if (!tj || !tj.access_token) return res.redirect('/leanlab?err=line_token');
        return httpsReq({ hostname: 'api.line.me', path: '/v2/profile', method: 'GET', headers: { 'Authorization': 'Bearer ' + tj.access_token } })
          .then(function (prof) {
            let pj; try { pj = JSON.parse(prof.body); } catch (e) { pj = null; }
            if (!pj || !pj.userId) return res.redirect('/leanlab?err=line_profile');
            const m = findOrCreate('lineId', pj.userId, { name: pj.displayName || '', picture: pj.pictureUrl || '', provider: 'line' });
            setSession(res, { pid: m.id });
            res.redirect('/leanlab');
          });
      })
      .catch(function () { res.redirect('/leanlab?err=line_error'); });
  });

  // ============================ GOOGLE LOGIN (OAuth2) ============================
  app.get('/auth/leanlab/google/login', function (req, res) {
    if (!googleConfigured()) return res.redirect('/leanlab?err=google_not_configured');
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, OAUTH_COOKIE, 'google:' + state, 10 * 60 * 1000);
    const redirect = baseUrl(req) + '/auth/leanlab/google/callback';
    const u = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code'
      + '&client_id=' + encodeURIComponent(process.env.GOOGLE_CLIENT_ID)
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&state=' + state + '&scope=' + encodeURIComponent('openid email profile')
      + '&access_type=online&prompt=select_account';
    res.redirect(u);
  });

  app.get('/auth/leanlab/google/callback', function (req, res) {
    const code = req.query.code, state = req.query.state;
    const c = parseCookies(req); clearCookie(res, OAUTH_COOKIE);
    if (!code || !state || c[OAUTH_COOKIE] !== 'google:' + state) return res.redirect('/leanlab?err=google_state');
    const redirect = baseUrl(req) + '/auth/leanlab/google/callback';
    const form = 'grant_type=authorization_code&code=' + encodeURIComponent(code)
      + '&redirect_uri=' + encodeURIComponent(redirect)
      + '&client_id=' + encodeURIComponent(process.env.GOOGLE_CLIENT_ID)
      + '&client_secret=' + encodeURIComponent(process.env.GOOGLE_CLIENT_SECRET);
    httpsReq({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) } }, form)
      .then(function (tok) {
        let tj; try { tj = JSON.parse(tok.body); } catch (e) { tj = null; }
        if (!tj || !tj.access_token) return res.redirect('/leanlab?err=google_token');
        return httpsReq({ hostname: 'www.googleapis.com', path: '/oauth2/v2/userinfo', method: 'GET', headers: { 'Authorization': 'Bearer ' + tj.access_token } })
          .then(function (prof) {
            let pj; try { pj = JSON.parse(prof.body); } catch (e) { pj = null; }
            if (!pj || !pj.id) return res.redirect('/leanlab?err=google_profile');
            const m = findOrCreate('googleId', pj.id, { name: pj.name || '', email: pj.email || '', picture: pj.picture || '', provider: 'google' });
            setSession(res, { pid: m.id });
            res.redirect('/leanlab');
          });
      })
      .catch(function () { res.redirect('/leanlab?err=google_error'); });
  });

  console.log('[lean-lab] auth mounted (email' + (lineConfigured() || process.env.LINE_DEV_FAKE === '1' ? ' + line' : '') + (googleConfigured() ? ' + google' : '') + ')');
};
