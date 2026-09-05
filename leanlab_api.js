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

  // ---- Lean Lab event config (Season 1) ----
  const EVENT = {
    season: 1,
    fee: 3900,
    minAge: 18,
    startLaterLabel: '8 พ.ย. 2569',      // choice "เริ่มวันที่ 08/11/69"
    bank: { bankName: 'กสิกรไทย (KBank)', accountNo: '231-1-71119-1', accountName: 'บริษัท โคลเวอร์เอ็กซ์ (ไทยแลนด์) จำกัด' }
  };

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
  app.post('/api/leanlab/auth/register', function (req, res) {
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

  app.post('/api/leanlab/auth/login', function (req, res) {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    const m = readM().find(function (x) { return (x.email || '').toLowerCase() === email; });
    if (!m || !m.pwHash || !verifyPw(pw, m.pwHash)) return res.status(401).json({ ok: false, error: 'bad_credentials' });
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
      googleLogin: false
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
  function publicReg(r) {
    if (!r) return null;
    return { id: r.id, name: r.name, age: r.age, gender: r.gender, heightCm: r.heightCm, startChoice: r.startChoice, baseline: r.baseline || null, fee: r.fee, pay: r.pay, slipUrl: r.slipUrl || null, status: r.status, createdAt: r.createdAt };
  }

  app.get('/api/leanlab/event', function (req, res) {
    res.json({ season: EVENT.season, fee: EVENT.fee, minAge: EVENT.minAge, startLaterLabel: EVENT.startLaterLabel, bank: EVENT.bank });
  });

  app.get('/api/leanlab/register/me', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var r = readR().find(function (x) { return x.memberId === m.id; });
    res.json({ ok: true, registration: publicReg(r) });
  });

  app.post('/api/leanlab/register', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var b = req.body || {};
    var name = String(b.name || '').trim();
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
      if (!photoUrl) return res.status(400).json({ ok: false, error: 'bad_photo' });
      baseline = { weightKg: weightKg, fatPct: fatPct, vFat: vFat, muscleKg: muscleKg, waterPct: waterPct, beforePhotoUrl: photoUrl };
    }
    var l = readR();
    var r = l.find(function (x) { return x.memberId === m.id; });
    if (r && r.status === 'confirmed') return res.status(409).json({ ok: false, error: 'already_registered', registration: publicReg(r) });
    if (!r) { r = { id: genRid(), memberId: m.id, season: EVENT.season, createdAt: new Date().toISOString() }; l.push(r); }
    r.name = name.slice(0, 80); r.dob = dob; r.age = age; r.gender = gender; r.heightCm = heightCm;
    r.startChoice = choice; r.baseline = baseline; r.fee = EVENT.fee; r.pay = 'bank';
    r.email = m.email || ''; r.phone = m.phone || '';
    if (!r.slipUrl) r.status = 'awaiting_payment';
    r.updatedAt = new Date().toISOString();
    writeR(l);
    // sync member name if empty
    var ml = readM(); var mm = ml.find(function (x) { return x.id === m.id; }); if (mm && !mm.name) { mm.name = name.slice(0, 80); writeM(ml); }
    res.json({ ok: true, registration: publicReg(r), bank: EVENT.bank });
  });

  app.post('/api/leanlab/register/slip', function (req, res) {
    var m = currentMember(req); if (!m) return res.status(401).json({ ok: false, error: 'not_logged_in' });
    var b = req.body || {};
    var l = readR(); var r = l.find(function (x) { return x.memberId === m.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'no_registration' });
    if (!(typeof b.slip === 'string' && /^data:image\//.test(b.slip))) return res.status(400).json({ ok: false, error: 'bad_slip' });
    var url = saveImg(b.slip, 'slip-' + m.id); if (!url) return res.status(400).json({ ok: false, error: 'save_failed' });
    r.slipUrl = url; r.status = 'pending_review'; r.slipAt = new Date().toISOString();
    writeR(l);
    res.json({ ok: true, registration: publicReg(r) });
  });

  app.get('/api/leanlab/file/:fn', function (req, res) {
    var fn = path.basename(req.params.fn); var p = path.join(UP, fn);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });

  // ---- Back-office (Support dept manages Lean Lab) ----
  function adminReg(r, byId) {
    var mem = byId[r.memberId] || {};
    return {
      id: r.id, memberId: r.memberId, name: r.name || mem.name || '', email: r.email || mem.email || '', phone: r.phone || mem.phone || '',
      age: r.age, gender: r.gender, heightCm: r.heightCm, startChoice: r.startChoice, baseline: r.baseline || null,
      fee: r.fee, pay: r.pay, slipUrl: r.slipUrl || null, status: r.status, createdAt: r.createdAt, slipAt: r.slipAt || null
    };
  }
  app.get('/api/leanlab/admin/registrations', function (req, res) {
    var regs = readR(); var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    var list = regs.map(function (r) { return adminReg(r, byId); }).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    var counts = { total: list.length, awaiting_payment: 0, pending_review: 0, confirmed: 0, rejected: 0, revenue: 0 };
    list.forEach(function (r) { if (counts[r.status] != null) counts[r.status]++; if (r.status === 'confirmed') counts.revenue += (Number(r.fee) || 0); });
    res.json({ ok: true, registrations: list, counts: counts, members: readM().length });
  });
  app.post('/api/leanlab/admin/registration/:id', function (req, res) {
    var b = req.body || {}; var st = b.status;
    if (['confirmed', 'rejected', 'pending_review', 'awaiting_payment'].indexOf(st) < 0) return res.status(400).json({ ok: false, error: 'bad_status' });
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    r.status = st; r.reviewedAt = new Date().toISOString();
    writeR(l);
    var byId = {}; readM().forEach(function (m) { byId[m.id] = m; });
    res.json({ ok: true, registration: adminReg(r, byId) });
  });
  // ลบผู้สมัคร (ลบทั้งใบสมัคร + บัญชีสมาชิก ถ้า withMember=1) — ใช้เคลียร์ข้อมูลทดสอบ/ยกเลิก
  app.post('/api/leanlab/admin/registration/:id/delete', function (req, res) {
    var l = readR(); var r = l.find(function (x) { return x.id === req.params.id; });
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    var mid = r.memberId;
    var nl = l.filter(function (x) { return x.id !== req.params.id; }); writeR(nl);
    if ((req.body && req.body.withMember) && mid) {
      var ml = readM().filter(function (m) { return m.id !== mid; }); writeM(ml);
    }
    res.json({ ok: true, deleted: req.params.id });
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
