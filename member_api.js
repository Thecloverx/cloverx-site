/* ============================================================================
 * CloverX Member App API  (หน้าแอปสมาชิก /app)
 * - สมัครสมาชิก / เข้าสู่ระบบด้วยอีเมล + เบอร์โทร (เบอร์โทร = รหัสผ่าน ตามที่บริษัทกำหนด)
 * - หน้าแรก: ระดับสมาชิก (PRE X-VISOR / X-VISOR / X-LEAD), การสอบที่กำลังจะมาถึง, คำสั่งซื้อล่าสุด
 * - คอนเทนต์: แบนเนอร์ ข่าวสาร (NEWS) คลิปอบรม (E-LEARNING) จัดการจากหลังบ้าน
 * - QR สมาชิก (CXM1.<token> ไม่มีข้อมูลส่วนบุคคล) ใช้ให้ทีมงานสแกนเช็กอินเข้าสอบ
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function (app, DATA, deps) {
  const MF = path.join(DATA, 'members.json');
  const SF = path.join(DATA, 'member_sessions.json');
  const CF = path.join(DATA, 'member_content.json');
  const IMG = path.resolve(DATA, 'member_img');
  try { fs.mkdirSync(IMG, { recursive: true }); } catch (e) {}
  const SESSION_TTL = 180 * 24 * 3600 * 1000;   // อยู่ในระบบได้ 180 วัน

  // ---------- storage (atomic write) ----------
  function readJ(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
  function writeJ(f, d) { const tmp = f + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, f); }
  const readM = () => readJ(MF, []);
  const writeM = (d) => writeJ(MF, d);
  const readSess = () => readJ(SF, {});
  const writeSess = (d) => writeJ(SF, d);
  const readC = () => { const c = readJ(CF, {}); return { banners: c.banners || [], news: c.news || [], lessons: c.lessons || [] }; };
  const writeC = (d) => writeJ(CF, d);

  // ---------- helpers ----------
  const dig = (s) => String(s || '').replace(/\D/g, '');
  const thPhone = (s) => { let d = dig(s); if (d.length === 11 && d.slice(0, 2) === '66') d = '0' + d.slice(2); if (d.length === 9 && /^[689]/.test(d)) d = '0' + d; return d; };
  const ph9 = (s) => thPhone(s).slice(-9);
  const cleanName = (s, n) => String(s == null ? '' : s).replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, n || 120);
  const cleanEmail = (s) => String(s || '').trim().toLowerCase().slice(0, 120);
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const genId = () => 'M' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const bkkDate = (ms) => new Date((ms || Date.now()) + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const secure = (req) => (req.headers['x-forwarded-proto'] || req.protocol) === 'https';

  function cookieTok(req) { const m = (req.headers.cookie || '').match(/(?:^|;\s*)cx_m=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  function setCookie(req, res, tok, maxAgeSec) {
    res.setHeader('Set-Cookie', 'cx_m=' + encodeURIComponent(tok) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeSec + (secure(req) ? '; Secure' : ''));
  }
  function currentMember(req) {
    const t = cookieTok(req); if (!t) return null;
    const s = readSess()[crypto.createHash('sha256').update(t).digest('hex')]; if (!s || s.exp < Date.now()) return null;
    const m = readM().find(x => x.id === s.id); if (!m || m.disabled) return null;
    return m;
  }
  function openSession(req, res, m) {
    const tok = crypto.randomBytes(24).toString('base64url');
    const all = readSess(); const now = Date.now();
    Object.keys(all).forEach(k => { if (all[k].exp < now) delete all[k]; });   // ล้าง session หมดอายุ
    all[crypto.createHash('sha256').update(tok).digest('hex')] = { id: m.id, at: now, exp: now + SESSION_TTL };
    writeSess(all); setCookie(req, res, tok, Math.floor(SESSION_TTL / 1000));
  }
  function pubMember(m) { return { id: m.id, firstName: m.firstName, lastName: m.lastName, name: (m.firstName + ' ' + m.lastName).trim(), email: m.email, phone: m.phone, avatar: m.avatar || '', createdAt: m.createdAt, qr: 'CXM1.' + m.qr, unlock: { xvisor: !!(m.unlock || {}).xvisor, lead: !!(m.unlock || {}).lead }, needConsent: !m.consentAt }; }
  function examAccess(m, tier) { const u = m.unlock || {}; return { xvisor: true, lead: !!u.lead || tier === 'X-VISOR' || tier === 'X-LEAD' }; }

  // ---------- rate limit (กันเดารหัส) ----------
  const RL = {};
  function limited(key, max, winMs) { const now = Date.now(); const a = (RL[key] || []).filter(t => now - t < winMs); a.push(now); RL[key] = a; return a.length > max; }
  const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  // ---------- ลูกค้าที่มีคำสั่งซื้อในระบบอยู่แล้ว เข้าสู่ระบบด้วยอีเมล + เบอร์ ได้เลยโดยไม่ต้องสมัคร ----------
  // login-alias.json: คีย์เป็นแฮชของ (อีเมล|เบอร์) ชื่อเข้ารหัสด้วยกุญแจที่ได้จากอีเมล+เบอร์ของลูกค้าเอง (ไม่มีข้อมูลส่วนบุคคลแบบอ่านได้)
  let LALIAS = {};
  try { LALIAS = (JSON.parse(fs.readFileSync(path.join(__dirname, 'login-alias.json'), 'utf8')) || {}).m || {}; } catch (e) { LALIAS = {}; }
  function aliasFor(email, phone) {
    const e = LALIAS[crypto.createHash('sha256').update('cxid1|' + email + '|' + phone).digest('hex')]; if (!e) return null;
    let name = '';
    try { const raw = Buffer.from(e.n, 'base64'), key = crypto.createHash('sha256').update('cxkey1|' + email + '|' + phone).digest();
      const d = crypto.createDecipheriv('aes-256-gcm', key, raw.slice(0, 12)); d.setAuthTag(raw.slice(12, 28)); name = Buffer.concat([d.update(raw.slice(28)), d.final()]).toString('utf8'); } catch (x) { name = ''; }
    return { orders: (e.o || []).slice(), name: name };
  }
  function orderIdentity(email, phone) {
    const a = aliasFor(email, phone); if (a) return a;
    const os = (deps.readOrders ? deps.readOrders() : []).filter(o => o && String(o.email || '').trim().toLowerCase() === email && thPhone(o.phone).length === 10 && ph9(o.phone) === ph9(phone));
    if (!os.length) return null; return { orders: os.map(o => o.id), name: String(os[0].name || '').trim() };
  }
  function splitName(n) { n = cleanName(n, 120); const i = n.indexOf(' '); return i > 0 ? [n.slice(0, i), n.slice(i + 1).trim()] : [n, '']; }

  // ---------- สมัครสมาชิก / เข้าสู่ระบบ ----------
  app.post('/api/m/register', (req, res) => {
    if (limited('reg:' + ip(req), 20, 3600 * 1000)) return res.status(429).json({ ok: false, error: 'too_many' });
    const b = req.body || {};
    const firstName = cleanName(b.firstName, 60), lastName = cleanName(b.lastName, 60), email = cleanEmail(b.email), phone = thPhone(b.phone);
    if (!firstName || !lastName) return res.status(400).json({ ok: false, error: 'missing_name' });
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'bad_email' });
    if (phone.length !== 10 || !/^0[689]/.test(phone)) return res.status(400).json({ ok: false, error: 'bad_phone' });
    if (!b.consent) return res.status(400).json({ ok: false, error: 'consent_required' });
    const all = readM();
    if (all.some(x => x.email === email)) return res.status(409).json({ ok: false, error: 'email_taken' });
    if (all.some(x => ph9(x.phone) === ph9(phone))) return res.status(409).json({ ok: false, error: 'phone_taken' });
    const m = { id: genId(), firstName, lastName, email, phone, qr: crypto.randomBytes(12).toString('base64url'), createdAt: Date.now(), consentAt: Date.now(), consentScope: ['terms', 'marketing', 'privacy'] };
    all.push(m); writeM(all);
    openSession(req, res, m);
    res.json({ ok: true, member: pubMember(m) });
  });
  app.post('/api/m/login', (req, res) => {
    const b = req.body || {}; const email = cleanEmail(b.email), phone = thPhone(b.phone);
    if (limited('login:' + ip(req), 30, 15 * 60 * 1000) || limited('login:' + email, 10, 15 * 60 * 1000)) return res.status(429).json({ ok: false, error: 'too_many' });
    if (!email || !phone) return res.status(400).json({ ok: false, error: 'missing' });
    let m = readM().find(x => x.email === email && ph9(x.phone) === ph9(phone));
    if (!m && validEmail(email) && phone.length === 10) {
      // ยังไม่มีบัญชี แต่มีคำสั่งซื้อด้วยอีเมล + เบอร์นี้ → สร้างบัญชีให้อัตโนมัติ (ต้องกดยอมรับเงื่อนไขในแอปก่อนใช้งาน)
      const idn = orderIdentity(email, phone), all = readM();
      if (idn && !all.some(x => x.email === email || ph9(x.phone) === ph9(phone))) {
        const nm = splitName(idn.name || email.split('@')[0]);
        m = { id: genId(), firstName: nm[0] || 'ลูกค้า', lastName: nm[1] || '', email, phone, qr: crypto.randomBytes(12).toString('base64url'), createdAt: Date.now(), consentAt: null, source: 'orders', linkedOrders: idn.orders };
        all.push(m); writeM(all);
      }
    }
    if (!m) return res.status(401).json({ ok: false, error: 'invalid' });
    if (m.disabled) return res.status(403).json({ ok: false, error: 'disabled' });
    const all = readM(); const x = all.find(y => y.id === m.id); if (x) { x.lastLoginAt = Date.now(); writeM(all); }
    openSession(req, res, m);
    res.json({ ok: true, member: pubMember(m) });
  });
  app.post('/api/m/consent', (req, res) => {
    const m = needMember(req, res); if (!m) return;
    if (!(req.body || {}).consent) return res.status(400).json({ ok: false, error: 'consent_required' });
    const all = readM(); const x = all.find(y => y.id === m.id); if (!x) return res.status(404).json({ ok: false });
    x.consentAt = Date.now(); x.consentScope = ['terms', 'marketing', 'privacy']; writeM(all); res.json({ ok: true, member: pubMember(x) });
  });
  app.post('/api/m/logout', (req, res) => {
    const t = cookieTok(req);
    if (t) { const all = readSess(); delete all[crypto.createHash('sha256').update(t).digest('hex')]; writeSess(all); }
    setCookie(req, res, '', 0); res.json({ ok: true });
  });

  // ---------- ข้อมูลของสมาชิก ----------
  const XV = () => (deps.xv && deps.xv()) || null;
  const PAID = ['CONFIRMED', 'CHECKED_IN', 'EXAM_STARTED', 'COMPLETED', 'TRANSFERRED_TO_EXAM'];
  const DEAD = ['CANCELLED', 'REJECTED', 'REFUNDED'];
  function memberRegs(m) {
    const x = XV(); if (!x) return [];
    return x.readReg().filter(r => ph9((r.candidate || {}).phone) === ph9(m.phone)).map(r => {
      const rd = x.findR(r.roundId) || {};
      const ses = x.readS().filter(s => s.roundId === r.roundId && ph9((s.candidate || {}).phone) === ph9(m.phone)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      return { regNo: r.regNo, status: r.status, mode: r.mode || rd.mode || 'online', createdAt: r.createdAt, examType: x.examTypeOf(rd),
        round: { id: rd.id, no: rd.no, date: rd.date, timeslot: rd.timeslot, venue: rd.venue, mode: rd.mode, topic: rd.topic, live: x.examLive ? !!x.examLive(rd) : false },
        attended: !!(r.attendance || r.status === 'CHECKED_IN'), attendance: r.attendance ? { at: r.attendance.at, method: r.attendance.method } : null,
        coachTeam: r.coachTeam || '', paid: PAID.indexOf(r.status) >= 0, session: ses ? { status: ses.status, phase: ses.phase } : null };
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  function memberTier(m) {
    const x = XV(); if (!x) return 'PRE X-VISOR';
    const ok = x.readS().filter(s => s.status === 'verified' || s.status === 'submitted').filter(s => ph9((s.candidate || {}).phone) === ph9(m.phone));
    if (ok.some(s => /lead/i.test(x.sessExamType(s)))) return 'X-LEAD';
    if (ok.length) return 'X-VISOR';
    return 'PRE X-VISOR';
  }
  function examResults(m) {
    const x = XV(); if (!x) return [];
    return x.readS().filter(s => ph9((s.candidate || {}).phone) === ph9(m.phone) && s.status !== 'in_progress')
      .map(s => { const rd = x.findR(s.roundId) || {}; return { examType: x.sessExamType(s), status: s.status, at: s.submittedAt || s.startedAt || s.createdAt || 0, passed: s.status === 'verified' || s.status === 'submitted',
        id: s.id, token: s.token, phase: s.phase, roundId: s.roundId, roundDate: rd.date || '', results: x.pubResults ? x.pubResults(s) : [], remedialQueue: s.remedialQueue || [], staffVerified: !!s.staffVerified && s.status !== 'disqualified' }; })
      .sort((a, b) => b.at - a.at);
  }
  // ห้องสอบที่ยังทำค้างอยู่ของสมาชิกคนนี้ (ให้แอปกลับเข้าห้องสอบต่อได้ แม้เปลี่ยนเครื่อง)
  function liveSession(m) {
    const x = XV(); if (!x) return null;
    const s = x.readS().filter(s => s.status === 'in_progress' && ph9((s.candidate || {}).phone) === ph9(m.phone)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (!s) return null; const rd = x.findR(s.roundId) || {};
    return { id: s.id, token: s.token, phase: s.phase, examType: x.sessExamType(s), roundCode: rd.code || '', roundId: s.roundId };
  }
  function memberOrders(m) {
    const name = m.firstName + ' ' + m.lastName;
    const linked = m.linkedOrders || [];
    return deps.readOrders().filter(o => o && (linked.indexOf(o.id) >= 0 || deps.ownsOrder(o, m.phone, m.email, name)))
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
      .map(o => ({ id: o.id, at: o.at, total: Number(o.total) || 0, status: o.status || '', pay: o.pay || '', ship: o.ship || '', tracking: o.tracking || o.trackingNo || '',
        items: (o.items || []).map(it => ({ nm: String(it.nm || it.name || ''), qty: Number(it.qty) || 1, price: Number(it.price) || 0, fam: !!it.fam })),
        hasSlip: !!o.slipUrl, slipCheck: (o.easyslip && o.easyslip.result) || '', note: o.note || '', addr: o.addr || '', name: o.name || '', phone: o.phone || '',
        log: (Array.isArray(o.statusLog) ? o.statusLog : []).map(x => ({ s: x.s, at: x.at })), confirmedAt: o.confirmedAt || '' }));
  }
  function upcoming(m) {
    const today = bkkDate();
    const mine = memberRegs(m).filter(r => r.round.date && r.round.date >= today && DEAD.indexOf(r.status) < 0)
      .sort((a, b) => (a.round.date < b.round.date ? -1 : 1));
    if (mine.length) return Object.assign({ kind: 'registered' }, mine[0]);
    const x = XV(); if (!x || !x.openRegRounds) return null;
    const r = x.openRegRounds().sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    return r ? { kind: 'open', examType: r.examType, round: { no: r.no, date: r.date, timeslot: r.timeslot, venue: r.venue, mode: r.mode }, mode: r.mode } : null;
  }
  function needMember(req, res) { const m = currentMember(req); if (!m) { res.status(401).json({ ok: false, error: 'login_required' }); return null; } return m; }

  app.get('/api/m/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const m = needMember(req, res); if (!m) return;
    const orders = memberOrders(m);
    res.json({ ok: true, member: Object.assign(pubMember(m), { tier: memberTier(m) }), upcoming: upcoming(m), latestOrder: orders[0] || null, orderCount: orders.length });
  });
  app.get('/api/m/orders', (req, res) => { res.set('Cache-Control', 'no-store'); const m = needMember(req, res); if (!m) return; res.json({ ok: true, orders: memberOrders(m) }); });
  app.get('/api/m/exams', (req, res) => {
    res.set('Cache-Control', 'no-store'); const m = needMember(req, res); if (!m) return;
    const tier = memberTier(m); res.json({ ok: true, tier: tier, access: examAccess(m, tier), registrations: memberRegs(m), results: examResults(m), live: liveSession(m), next: upcoming(m) });
  });

  // รูปโปรไฟล์ (ย่อขนาดจากเครื่องลูกค้าแล้ว) ชื่อไฟล์สุ่ม เดาไม่ได้
  app.post('/api/m/avatar', (req, res) => {
    const m = needMember(req, res); if (!m) return;
    const b = req.body || {}; const all = readM(); const x = all.find(y => y.id === m.id); if (!x) return res.status(404).json({ ok: false });
    const old = x.avatar || '';
    if (b.remove) x.avatar = '';
    else { const u = saveImg(b.image, 'a'); if (u === 'TOO_BIG') return res.status(400).json({ ok: false, error: 'image_too_big' }); if (!u) return res.status(400).json({ ok: false, error: 'bad_image' }); x.avatar = u; }
    writeM(all);
    if (old && old !== x.avatar) { try { fs.unlinkSync(path.join(IMG, path.basename(old))); } catch (e) {} }
    res.json({ ok: true, avatar: x.avatar });
  });

  // ความคืบหน้าการเรียน E-Learning (ต่อสมาชิก)
  app.get('/api/m/progress', (req, res) => { res.set('Cache-Control', 'no-store'); const m = needMember(req, res); if (!m) return; res.json({ ok: true, progress: m.progress || {} }); });
  app.post('/api/m/progress', (req, res) => {
    const m = needMember(req, res); if (!m) return;
    const b = req.body || {}; const id = String(b.id || '').slice(0, 40); if (!id) return res.status(400).json({ ok: false });
    const pct = Math.max(0, Math.min(100, Math.round(Number(b.pct) || 0))), pos = Math.max(0, Math.round(Number(b.pos) || 0));
    const all = readM(); const x = all.find(y => y.id === m.id); if (!x) return res.status(404).json({ ok: false });
    x.progress = x.progress || {}; const old = x.progress[id] || {};
    x.progress[id] = { pct: Math.max(pct, old.pct || 0), pos: pos, at: Date.now(), done: !!(old.done || pct >= 95) };
    writeM(all); res.json({ ok: true, progress: x.progress[id] });
  });

  // ---------- คอนเทนต์ (แบนเนอร์ / ข่าว / คลิปอบรม) ----------
  const pubItem = (x) => { const o = Object.assign({}, x); delete o.active; return o; };
  app.get('/api/m/content', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const c = readC(); const on = (a) => a.filter(x => x.active !== false).sort((p, q) => (q.pin ? 1 : 0) - (p.pin ? 1 : 0) || (q.at || 0) - (p.at || 0)).map(pubItem);
    res.json({ ok: true, banners: on(c.banners).sort((p, q) => (p.order || 0) - (q.order || 0)), news: on(c.news), lessons: on(c.lessons) });
  });
  app.get('/api/m/img/:fn', (req, res) => {
    const fn = path.basename(String(req.params.fn)); if (!/^[a-z0-9_-]+\.(jpg|png|webp)$/i.test(fn)) return res.status(404).end();
    const p = path.join(IMG, fn); if (!fs.existsSync(p)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400'); res.sendFile(p);
  });
  function saveImg(dataUrl, pre) {
    const m = String(dataUrl || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/); if (!m) return '';
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4 * 1024 * 1024) return 'TOO_BIG';
    const fn = (pre || 'c') + '_' + crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.writeFileSync(path.join(IMG, fn), buf); return '/api/m/img/' + fn;
  }
  const staff = (req, res) => deps.staffOrKey(req, res);
  const TYPES = { banners: 1, news: 1, lessons: 1 };
  app.get('/api/m/admin/content', (req, res) => { if (!staff(req, res)) return; res.set('Cache-Control', 'no-store'); res.json(Object.assign({ ok: true }, readC())); });
  app.post('/api/m/admin/content/:type', (req, res) => {
    if (!staff(req, res)) return; const type = req.params.type; if (!TYPES[type]) return res.status(400).json({ ok: false });
    const b = req.body || {}; const c = readC(); const list = c[type];
    let it = b.id ? list.find(x => x.id === b.id) : null;
    if (!it) { it = { id: type.slice(0, 1) + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), at: Date.now() }; list.push(it); }
    const s = (k, n) => { if (b[k] != null) it[k] = String(b[k]).slice(0, n); };
    s('title', 160); s('badge', 40); s('summary', 400); s('body', 8000); s('link', 400); s('youtube', 200); s('category', 60); s('duration', 20); s('instructor', 80); s('tag', 20);
    if (b.active != null) it.active = !!b.active; if (b.pin != null) it.pin = !!b.pin; if (b.order != null) it.order = parseInt(b.order, 10) || 0;
    if (b.image) { const u = saveImg(b.image); if (u === 'TOO_BIG') return res.status(400).json({ ok: false, error: 'image_too_big' }); if (u) it.img = u; }
    if (b.removeImage) it.img = '';
    if (type === 'lessons' && it.youtube) { const y = String(it.youtube).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/) || String(it.youtube).match(/^([A-Za-z0-9_-]{11})$/); it.ytId = y ? y[1] : ''; }
    if (!it.title && type !== 'banners') return res.status(400).json({ ok: false, error: 'missing_title' });
    it.updatedAt = Date.now(); writeC(c);
    res.json({ ok: true, item: it });
  });
  app.delete('/api/m/admin/content/:type/:id', (req, res) => {
    if (!staff(req, res)) return; const type = req.params.type; if (!TYPES[type]) return res.status(400).json({ ok: false });
    const c = readC(); const n = c[type].length; c[type] = c[type].filter(x => x.id !== req.params.id); writeC(c); res.json({ ok: true, removed: n - c[type].length });
  });

  // ---------- หลังบ้าน: สมาชิก ----------
  app.get('/api/m/admin/members', (req, res) => {
    if (!staff(req, res)) return; res.set('Cache-Control', 'no-store');
    res.json({ ok: true, members: readM().map(m => Object.assign(pubMember(m), { tier: memberTier(m), disabled: !!m.disabled, lastLoginAt: m.lastLoginAt || null })).sort((a, b) => b.createdAt - a.createdAt) });
  });
  app.post('/api/m/admin/members/:id', (req, res) => {
    if (!staff(req, res)) return; const all = readM(); const m = all.find(x => x.id === req.params.id); if (!m) return res.status(404).json({ ok: false });
    const b = req.body || {};
    if (b.firstName != null) m.firstName = cleanName(b.firstName, 60); if (b.lastName != null) m.lastName = cleanName(b.lastName, 60);
    if (b.email != null) { const e = cleanEmail(b.email); if (!validEmail(e)) return res.status(400).json({ ok: false, error: 'bad_email' }); if (all.some(x => x.id !== m.id && x.email === e)) return res.status(409).json({ ok: false, error: 'email_taken' }); m.email = e; }
    if (b.phone != null) { const p = thPhone(b.phone); if (p.length !== 10) return res.status(400).json({ ok: false, error: 'bad_phone' }); if (all.some(x => x.id !== m.id && ph9(x.phone) === ph9(p))) return res.status(409).json({ ok: false, error: 'phone_taken' }); m.phone = p; }
    if (b.disabled != null) m.disabled = !!b.disabled;
    if (b.unlockXvisor != null || b.unlockLead != null) { m.unlock = m.unlock || {}; if (b.unlockXvisor != null) m.unlock.xvisor = !!b.unlockXvisor; if (b.unlockLead != null) m.unlock.lead = !!b.unlockLead; }
    m.updatedAt = Date.now(); writeM(all); res.json({ ok: true, member: pubMember(m) });
  });
  app.delete('/api/m/admin/members/:id', (req, res) => {
    if (!staff(req, res)) return; const all = readM(); const n = all.length; writeM(all.filter(x => x.id !== req.params.id));
    const s = readSess(); Object.keys(s).forEach(k => { if (s[k].id === req.params.id) delete s[k]; }); writeSess(s);
    res.json({ ok: true, removed: n - readM().length });
  });


  // ---------- ร้านค้า Pre-Order ในแอป (ราคาและสต๊อกคิดที่เซิร์ฟเวอร์เท่านั้น) ----------
  const COLORS = { black: 'สีดำ', cream: 'สีครีม' };
  const CATALOG = [
    { id: 'triple', nm: 'TRIPLE SET', price: 12480, cat: 'set', colors: ['cream', 'black'], box: ['Xircle Band x1', 'Xircle Smart Scale x1', 'RoutineX Premium Daily Supplements (28 วัน) x1'] },
    { id: 'duo', nm: 'DUO SET', price: 4990, cat: 'set', colors: ['black', 'cream'], box: ['Xircle Band x1', 'Xircle Smart Scale x1'] },
    { id: 'band', nm: 'Xircle Band', price: 4590, cat: 'device', colors: ['black', 'cream'], box: ['Xircle Band x1'] },
    { id: 'scale', nm: 'Xircle Scale', price: 1290, cat: 'device', colors: [], box: ['Xircle Smart Scale x1'] },
    { id: 'routinex', nm: 'RoutineX', price: 7490, cat: 'supp', colors: [], box: ['RoutineX Premium Daily Supplements (28 วัน) x1'] },
    { id: 'polo', nm: '[POLO] เสื้อยืดโปโล X-Visor สีกรมท่า', price: 290, was: 590, cat: 'fashion', colors: [], soon: true },
    { id: 'fam-band', nm: 'Band ครอบครัว', price: 4360, was: 4590, cat: 'family', colors: ['black', 'cream'], fam: true, box: ['Xircle Band x1'] }
  ];
  const catById = (id) => CATALOG.find(p => p.id === id);
  function stockLeft(nm) { // จำนวนชุดที่ยังสั่งได้ (null = ไม่จำกัด)
    const sh = deps.shop; if (!sh) return null; const st = sh.stock(); const comp = sh.components(nm); let left = null;
    comp.forEach(k => { if (typeof st[k] === 'number') left = left == null ? st[k] : Math.min(left, st[k]); }); return left == null ? null : Math.max(0, left);
  }
  const itemName = (p, c) => p.nm + (c ? ' (' + COLORS[c] + ')' : '');
  app.get('/api/m/shop', (req, res) => {
    res.set('Cache-Control', 'no-store'); const sh = deps.shop; const set = sh ? sh.settings() : {};
    res.json({ ok: true, open: set.preorderOpen !== false, closedTitle: set.closedTitle || '', closedMsg: set.closedMsg || '', round: set.roundTitle || '', closeAt: set.roundCloseAt || '',
      products: CATALOG.map(p => ({ id: p.id, nm: p.nm, price: p.price, was: p.was || 0, cat: p.cat, fam: !!p.fam, soon: !!p.soon, box: p.box || [],
        colors: p.colors.map(c => ({ c: c, label: COLORS[c], left: stockLeft(itemName(p, c)) })), left: p.colors.length ? null : stockLeft(p.nm) })) });
  });
  app.post('/api/m/checkout', (req, res) => {
    const m = needMember(req, res); if (!m) return; const sh = deps.shop; if (!sh) return res.status(503).json({ ok: false });
    const b = req.body || {}; const lines = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
    const items = [], fam = [], seen = {};
    for (const l of lines) {
      const p = catById(String(l.id || '')); if (!p || p.soon) return res.status(400).json({ ok: false, error: 'bad_item' });
      const c = p.colors.length ? (p.colors.indexOf(l.c) >= 0 ? l.c : '') : ''; if (p.colors.length && !c) return res.status(400).json({ ok: false, error: 'pick_color' });
      const key = p.id + ':' + c; if (seen[key]) continue; seen[key] = 1;
      const nm = itemName(p, c); items.push({ nm: nm, price: p.price, fam: !!p.fam });
      if (p.fam) { const fn = String(l.famName || '').trim().slice(0, 80), fp = thPhone(l.famPhone || ''); if (!fn || fp.length !== 10) return res.status(400).json({ ok: false, error: 'fam_info' }); fam.push({ item: nm, name: fn, phone: fp }); }
    }
    if (!items.length) return res.status(400).json({ ok: false, error: 'empty' });
    if (items.some(i => i.fam) && !items.some(i => !i.fam && /TRIPLE|DUO|Band/i.test(i.nm))) return res.status(400).json({ ok: false, error: 'fam_needs_main' });
    const a = b.addr || {}; const rn = String(a.name || '').trim().slice(0, 120), rp = thPhone(a.phone || ''), line = String(a.line || '').trim().slice(0, 300);
    const geo = ['sub', 'dist', 'prov', 'zip'].map(k => String(a[k] || '').trim().slice(0, 60));
    if (!rn || rp.length !== 10 || !line || !geo[2] || !/^\d{5}$/.test(geo[3])) return res.status(400).json({ ok: false, error: 'bad_addr' });
    const team = String(b.team || '').trim().slice(0, 40), ref = String(b.ref || '').trim().slice(0, 80);
    if (!team || !ref) return res.status(400).json({ ok: false, error: 'need_ref' });
    const pay = b.pay === 'card' ? 'card' : 'bank';
    const full = line + (geo[0] ? ' ต.' + geo[0] : '') + (geo[1] ? ' อ.' + geo[1] : '') + ' จ.' + geo[2] + ' ' + geo[3];
    // จำที่อยู่ไว้ใช้ครั้งถัดไป
    const all = readM(); const x = all.find(y => y.id === m.id); if (x) { x.address = { name: rn, phone: rp, line: line, sub: geo[0], dist: geo[1], prov: geo[2], zip: geo[3] }; x.lastTeam = team; x.lastRef = ref; writeM(all); }
    const total = items.reduce((t, i) => t + i.price, 0);
    const o = { name: rn, phone: rp, email: m.email, addr: full, team: team, ref: ref, ship: 'post', pay: pay, items: items, total: total, famMembers: fam,
      payEmail: pay === 'card' ? m.email : '', note: String(b.note || '').slice(0, 300), source: 'app', _memberId: m.id };
    sh.placeOrder(o, req).then(r => res.status(r.code).json(r.body));
  });
  // คืนสินค้า/คืนเงิน: ใช้ตัวตนของสมาชิกที่ล็อกอินอยู่ ค้นหาคำสั่งซื้อ (รวมข้อมูลนำเข้าจากชีต) และคำขอคืนของตัวเอง
  app.get('/api/m/returns', (req, res) => {
    res.set('Cache-Control', 'no-store'); const m = needMember(req, res); if (!m) return;
    if (!deps.returns) return res.status(503).json({ ok: false });
    const name = (m.firstName + ' ' + m.lastName).trim(); const r = deps.returns(m.phone, m.email, name, m.linkedOrders || []);
    res.json(Object.assign({ ok: true, me: { phone: m.phone, email: m.email, name: name } }, r));
  });
  app.get('/api/m/address', (req, res) => { res.set('Cache-Control', 'no-store'); const m = needMember(req, res); if (!m) return; res.json({ ok: true, address: m.address || null, team: m.lastTeam || '', ref: m.lastRef || '' }); });
  app.post('/api/m/orders/:id/slip', (req, res) => {
    const m = needMember(req, res); if (!m) return; const sh = deps.shop; if (!sh) return res.status(503).json({ ok: false });
    const id = String(req.params.id || ''); const mine = memberOrders(m).find(o => o.id === id); if (!mine) return res.status(404).json({ ok: false, error: 'not_found' });
    const r = sh.attachSlip(id, (req.body || {}).image, req); res.status(r.ok ? 200 : 400).json(r);
  });

  // QR สมาชิก → ข้อมูลสมาชิก (ใช้ตอนทีมงานสแกนเช็กอิน)
  return {
    memberByQr: function (code) { const t = String(code || '').replace(/^CXM1\./, ''); if (!t) return null; const m = readM().find(x => x.qr === t && !x.disabled); return m ? { id: m.id, name: (m.firstName + ' ' + m.lastName).trim(), phone: m.phone, email: m.email } : null; },
    currentMember: currentMember,
    ownsOrderId: function (req, orderId) { const m = currentMember(req); if (!m || !orderId) return null; if ((m.linkedOrders || []).indexOf(orderId) >= 0) return m;
      const o = (deps.readOrders ? deps.readOrders() : []).find(x => x && x.id === orderId); return o && deps.ownsOrder(o, m.phone, m.email, (m.firstName + ' ' + m.lastName).trim()) ? m : null; }
  };
};
