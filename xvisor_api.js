/* X-VISOR exam backend — file-store, server-side shuffle + scoring (keys never sent to client) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

module.exports = function (app, DATA) {
  const XV = path.join(DATA, 'xvisor');
  if (!fs.existsSync(XV)) fs.mkdirSync(XV, { recursive: true });
  const QF = path.join(XV, 'questions.json');
  const QF_ROOT = path.join(DATA, '..', 'xvisor_questions.json'); // repo-root fallback (flat deploy)
  const QF_APP = path.join(__dirname, 'xvisor_questions.json');   // app-dir fallback (works regardless of DATA_DIR / volume mount)
  const SF = path.join(XV, 'sessions.json');
  const RF = path.join(XV, 'rounds.json');
  const REGF = path.join(XV, 'registrations.json');
  const AUDITF = path.join(XV, 'audit.json'); // append-only admin action log
  const QSETF = path.join(XV, 'qsets.json'); // named question sets (each round picks one)
  const ROSTERF = path.join(XV, 'roster.json'); // imported "paid registrants" roster (exam-entry autofill)
  const FEEDBACKF = path.join(XV, 'feedback.json'); // bug reports / feedback from testers (public submit, no login)
  const ROSTER_SEED = path.join(__dirname, 'xvisor_roster_seed.json'); // bundled initial roster (works with no admin key)
  const REGUP = path.join(XV, 'reguploads'); // slip / id-card images
  if (!fs.existsSync(REGUP)) { try { fs.mkdirSync(REGUP, { recursive: true }); } catch (e) {} }

  const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wr = (f, d) => { try { fs.writeFileSync(f, JSON.stringify(d, null, 2)); } catch (e) {} };
  // legacy single-file question bank (used to seed the first set on first run)
  const bankFile = () => {
    let b = rd(QF, null);
    if (!b || !b.bank || !Object.keys(b.bank).length) b = rd(QF_ROOT, null);
    if (!b || !b.bank || !Object.keys(b.bank).length) b = rd(QF_APP, null);
    return b && b.bank ? b : { names: {}, bank: {} };
  };

  /* ---- storage layer: Postgres when DATABASE_URL is set, else JSON files ----
     The JSON file is ALWAYS written too (a durable backup + the fallback source read
     before Postgres finishes hydrating), so switching to or from Postgres never loses
     data. Each collection (sessions/rounds/registrations) is one JSONB blob row. */
  const fileOf = { sessions: SF, rounds: RF, registrations: REGF, audit: AUDITF, qsets: QSETF, roster: ROSTERF, feedback: FEEDBACKF };
  const COLLS = ['sessions', 'rounds', 'registrations', 'audit', 'qsets', 'roster', 'feedback'];
  const USE_PG = !!process.env.DATABASE_URL;
  const mem = { sessions: [], rounds: [], registrations: [], audit: [], qsets: [], roster: [], feedback: [] };
  let pool = null, pgReady = false;
  const persistQ = {};
  const pgPersist = (coll) => {
    if (!pool) return;
    const snap = mem[coll];
    persistQ[coll] = (persistQ[coll] || Promise.resolve()).then(() =>
      pool.query('INSERT INTO xv_store(coll,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(coll) DO UPDATE SET data=$2, updated_at=now()', [coll, JSON.stringify(snap)])
    ).catch(e => console.error('[x-visor] PG persist ' + coll + ' failed:', e.message));
  };
  // hydrate the in-memory store from files at boot (PG mode overwrites this once PG is ready).
  // in-memory becomes the authoritative read source → GETs no longer re-read+parse the whole file each call.
  COLLS.forEach(c => { try { const d = rd(fileOf[c], []); mem[c] = Array.isArray(d) ? d : []; } catch (e) { mem[c] = []; } });
  const readColl = (coll) => mem[coll] || [];
  // durable file mirror — debounced & ASYNC so a burst of writes (e.g. answers) never blocks the event loop
  // with a synchronous full-file rewrite. Postgres (when on) is the primary durable store; file is the backup.
  const _fileDirty = {}, _fileTimer = {}, FILE_DEBOUNCE = 1200;
  const flushColl = (coll) => {
    if (!_fileDirty[coll]) return; _fileDirty[coll] = false;
    try { fs.writeFile(fileOf[coll], JSON.stringify(mem[coll], null, 2), () => {}); } catch (e) {}
  };
  const flushAllColls = () => { COLLS.forEach(c => { if (_fileTimer[c]) { clearTimeout(_fileTimer[c]); _fileTimer[c] = null; } if (_fileDirty[c]) { _fileDirty[c] = false; try { fs.writeFileSync(fileOf[c], JSON.stringify(mem[c], null, 2)); } catch (e) {} } }); };
  const writeColl = (coll, all) => {
    mem[coll] = all;                           // authoritative in-memory (read-after-write stays consistent)
    if (pool && pgReady) pgPersist(coll);      // durable in Postgres (async, queued)
    _fileDirty[coll] = true;                    // durable file mirror — debounced + async (non-blocking)
    if (!_fileTimer[coll]) _fileTimer[coll] = setTimeout(() => { _fileTimer[coll] = null; flushColl(coll); }, FILE_DEBOUNCE);
  };
  process.on('SIGTERM', flushAllColls); process.on('SIGINT', flushAllColls); process.on('beforeExit', flushAllColls); // กัน redeploy/restart แล้วข้อมูลค้างในคิวหาย
  if (USE_PG) {
    try {
      const { Pool } = require('pg');
      pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false }, max: 5 });
      (async () => {
        await pool.query('CREATE TABLE IF NOT EXISTS xv_store (coll text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now())');
        for (const coll of COLLS) {
          const fileData = rd(fileOf[coll], []);
          const { rows } = await pool.query('SELECT data FROM xv_store WHERE coll=$1', [coll]);
          if (!rows.length) {                                 // first run → seed PG from any existing file data
            mem[coll] = Array.isArray(fileData) ? fileData : [];
            await pool.query('INSERT INTO xv_store(coll,data) VALUES($1,$2) ON CONFLICT(coll) DO NOTHING', [coll, JSON.stringify(mem[coll])]);
          } else {                                            // hydrate from PG, recover any file-only records (crash-window safety)
            let data = Array.isArray(rows[0].data) ? rows[0].data : [];
            const seen = new Set(data.map(x => x && x.id));
            let recovered = 0;
            for (const f of (Array.isArray(fileData) ? fileData : [])) { if (f && f.id && !seen.has(f.id)) { data.push(f); recovered++; } }
            mem[coll] = data;
            if (recovered) await pool.query('UPDATE xv_store SET data=$2, updated_at=now() WHERE coll=$1', [coll, JSON.stringify(data)]);
          }
          wr(fileOf[coll], mem[coll]);                        // keep file mirror in sync after hydrate
        }
        pgReady = true;
        console.log('[x-visor] Postgres store ready — ' + COLLS.map(c => c + ':' + mem[c].length).join(' '));
      })().catch(e => { console.error('[x-visor] PG init failed, using file store:', e.message); pool = null; pgReady = false; });
    } catch (e) { console.error('[x-visor] pg module unavailable, using file store:', e.message); pool = null; }
  }

  const readS = () => readColl('sessions');
  const writeS = (s) => writeColl('sessions', s);
  const readR = () => readColl('rounds');
  const writeR = (r) => writeColl('rounds', r);
  const findR = (id) => readR().find(x => x.id === id);
  const findRByCode = (code) => readR().find(x => String(x.code).toUpperCase() === String(code || '').toUpperCase());
  const roundCode = () => 'R' + crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. R7F3A9C
  const nextRoundNo = () => { const rs = readR(); return rs.length ? Math.max.apply(null, rs.map(r => r.no || 0)) + 1 : 1; };
  const readReg = () => readColl('registrations');
  const writeReg = (x) => writeColl('registrations', x);
  const readAudit = () => readColl('audit');
  // append-only audit log — records every admin action (who/when/what/before→after/reason)
  const logAudit = (action, recordType, recordId, ref, before, after, reason, actor) => {
    try {
      const all = readAudit();
      all.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), action, recordType, recordId, ref: ref || '', before: before == null ? null : before, after: after == null ? null : after, reason: reason || '', actor: actor || 'staff' });
      // keep the log bounded (most recent 3000 entries)
      writeColl('audit', all.length > 3000 ? all.slice(all.length - 3000) : all);
    } catch (e) { /* audit must never break the main action */ }
  };
  // waiting-list promotion: when a confirmed seat frees up, promote the earliest waitlisted person
  // back into the payment flow so they can pay for the seat. Seats count only CONFIRMED (business rule).
  const promoteWaitlist = (roundId) => {
    const round = readR().find(r => r.id === roundId); if (!round) return;
    const cap = parseInt(round.capacity, 10) || 0;
    const all = readReg();
    const confirmed = all.filter(x => x.roundId === roundId && SEAT_TAKEN.indexOf(x.status) >= 0).length;
    if (cap > 0 && confirmed >= cap) return; // still full
    const seatsFree = cap > 0 ? (cap - confirmed) : 999;
    const waiting = all.filter(x => x.roundId === roundId && x.status === 'WAITLISTED').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    let promoted = 0;
    for (const w of waiting) {
      if (promoted >= seatsFree) break;
      w.status = (w.payment && w.payment.slipUrl) ? 'PAYMENT_REVIEW' : 'PENDING_PAYMENT';
      w.promotedAt = Date.now();
      promoted++;
      logAudit('waitlist_promote', 'registration', w.id, w.regNo, 'WAITLISTED', w.status, 'ที่นั่งว่าง — เลื่อนจาก Waiting List อัตโนมัติ', 'system');
    }
    if (promoted) writeReg(all);
  };
  // registration number: RG + yymmdd + 4-run — human-readable, unique enough
  const nextRegNo = () => {
    const d = new Date(); const p = n => (n < 10 ? '0' : '') + n;
    const base = 'RG' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
    const today = readReg().filter(r => (r.regNo || '').indexOf(base) === 0).length;
    return base + p((today + 1) > 99 ? (today + 1) : (today + 1)).toString().padStart(3, '0');
  };
  // A seat counts as taken ONLY once payment is confirmed (business rule: reserve on paid).
  // Pending / review / waitlisted / cancelled / refunded do NOT hold a seat.
  const SEAT_TAKEN = ['CONFIRMED', 'CHECKED_IN', 'EXAM_STARTED', 'COMPLETED', 'TRANSFERRED_TO_EXAM'];
  const roundSeats = (r) => {
    const cap = parseInt(r.capacity, 10) || 0; // 0 = unlimited
    const all = readReg().filter(x => x.roundId === r.id);
    const used = all.filter(x => SEAT_TAKEN.indexOf(x.status) >= 0).length; // confirmed seats only
    const pending = all.filter(x => x.status === 'PENDING_PAYMENT' || x.status === 'PAYMENT_REVIEW').length;
    const waitlisted = all.filter(x => x.status === 'WAITLISTED').length;
    return { capacity: cap, used, pending, waitlisted, left: cap > 0 ? Math.max(0, cap - used) : null, full: cap > 0 && used >= cap };
  };
  const pubRound = (r) => Object.assign({
    id: r.id, code: r.code, no: r.no, date: r.date, topic: r.topic, status: r.status, createdAt: r.createdAt,
    mode: r.mode || 'online', fee: r.fee != null ? r.fee : 500, capacity: parseInt(r.capacity, 10) || 0,
    waitlist: !!r.waitlist, venue: r.venue || '', timeslot: r.timeslot || '', regCloseAt: r.regCloseAt || '',
    setId: r.setId || '', setName: (function () { if (!r.setId) return ''; const s = (readColl('qsets') || []).find(x => x.id === r.setId); return s ? s.name : ''; })(),
    examOpenedAt: r.examOpenedAt || null, examDeadlineAt: r.examDeadlineAt || null,
    examRemaining: (r.status === 'open' && r.examDeadlineAt) ? Math.max(0, Math.ceil((r.examDeadlineAt - Date.now()) / 1000)) : null
  }, roundSeats(r));
  // save a data-url image to disk, return its public path (or '' if none/invalid)
  const saveRegImage = (dataUrl, tag) => {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return '';
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) return 'TOO_BIG';
    const fn = tag + '_' + crypto.randomBytes(8).toString('hex') + '.' + ext;
    try { fs.writeFileSync(path.join(REGUP, fn), buf); } catch (e) { return ''; }
    return '/api/xv/reg/file/' + fn;
  };

  /* ---- EasySlip auto-verification for registration payments (opt-in via EASYSLIP_API_KEY) ---- */
  const esDigits = (x) => String(x == null ? '' : x).replace(/[^0-9]/g, '');
  const esConfigured = () => !!process.env.EASYSLIP_API_KEY;
  function esVerify(base64raw) {
    return new Promise((resolve) => {
      if (!esConfigured()) { resolve({ ok: false, error: 'not_configured' }); return; }
      const urlStr = process.env.EASYSLIP_VERIFY_URL || 'https://developer.easyslip.com/api/v1/verify';
      let u; try { u = new URL(urlStr); } catch (e) { resolve({ ok: false, error: 'bad_url' }); return; }
      const body = JSON.stringify({ image: base64raw });
      const rq = https.request({ hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.EASYSLIP_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (resp) => { let b = ''; resp.on('data', d => b += d); resp.on('end', () => { try { resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, http: resp.statusCode, body: JSON.parse(b) }); } catch (e) { resolve({ ok: false, error: 'parse', http: resp.statusCode }); } }); });
      rq.on('error', e => resolve({ ok: false, error: e.message }));
      rq.setTimeout(15000, () => { rq.destroy(); resolve({ ok: false, error: 'timeout' }); });
      rq.write(body); rq.end();
    });
  }
  function esExtract(j) {
    const d = (j && j.data) ? j.data : j; if (!d) return null;
    let amount = null;
    if (d.amount != null) amount = (typeof d.amount === 'object') ? Number(d.amount.amount != null ? d.amount.amount : (d.amount.local && d.amount.local.amount)) : Number(d.amount);
    const recv = d.receiver || {}, acc = recv.account || {};
    let recvName = ''; if (acc.name) recvName = acc.name.th || acc.name.en || (typeof acc.name === 'string' ? acc.name : '');
    const recvNum = (acc.bank && acc.bank.account) || acc.account || acc.number || (recv.bank && recv.bank.account) || '';
    const ref = d.transRef || d.transactionId || d.transaction_id || d.ref1 || d.payload || '';
    return { amount, recvName: String(recvName || ''), recvNum: String(recvNum || ''), ref: String(ref || '') };
  }
  // verify a registration's slip; auto-confirm when amount + (account or name) match and not duplicate
  function autoVerifyReg(regId, base64raw) {
    esVerify(base64raw).then((r) => {
      const all = readReg(); const x = all.find(y => y.id === regId); if (!x) return;
      x.easyslip = { at: Date.now(), ok: r.ok, http: r.http || null };
      if (!r.ok || !r.body) { x.easyslip.result = 'error'; x.easyslip.error = r.error || ('http ' + r.http); writeReg(all); return; }
      const sD = esExtract(r.body); if (!sD) { x.easyslip.result = 'no_data'; writeReg(all); return; }
      x.easyslip.amount = sD.amount; x.easyslip.recvName = sD.recvName; x.easyslip.recvNum = sD.recvNum; x.easyslip.ref = sD.ref;
      const fee = Number((x.payment && x.payment.fee) || 0);
      const amtOk = (sD.amount != null && !isNaN(sD.amount)) && Math.abs(sD.amount - fee) < 1;
      const want = esDigits(process.env.EASYSLIP_RECV_ACCOUNT || '2311711191'); const last4 = want.slice(-4); const recvDigits = esDigits(sD.recvNum);
      const acctOk = !!(recvDigits && recvDigits.length >= 4 && want && (want.indexOf(recvDigits) >= 0 || recvDigits.indexOf(last4) >= 0));
      const esNorm = s => String(s || '').replace(/[\s().\-]/g, '').replace(/[​‎‏ ]/g, '').normalize('NFC');
      const rn = esNorm(sD.recvName); const nk = esNorm(process.env.EASYSLIP_RECV_NAME || 'โคลเวอร์เอ็กซ์'); const core = esNorm(process.env.EASYSLIP_RECV_NAMECORE || 'โคลเวอร์');
      const nameOk = !!(rn && ((nk && (rn.indexOf(nk) >= 0 || nk.indexOf(rn) >= 0)) || (core && rn.indexOf(core) >= 0)));
      const dup = !!(sD.ref && all.some(y => y.id !== x.id && y.easyslip && y.easyslip.ref && y.easyslip.ref === sD.ref));
      x.easyslip.amtOk = amtOk; x.easyslip.acctOk = acctOk; x.easyslip.nameOk = nameOk; x.easyslip.dup = dup;
      const pass = amtOk && (acctOk || nameOk) && !dup;
      const wasConfirmed = SEAT_TAKEN.indexOf(x.status) >= 0;
      if (pass && process.env.EASYSLIP_AUTOCONFIRM !== '0') { x.status = 'CONFIRMED'; x.confirmedAt = Date.now(); x.easyslip.result = 'confirmed'; }
      else x.easyslip.result = pass ? 'verified' : (dup ? 'duplicate' : 'mismatch');
      writeReg(all);
      if (!wasConfirmed && x.status === 'CONFIRMED') logAudit('payment_auto_confirm', 'registration', x.id, x.regNo, 'PAYMENT_REVIEW', 'CONFIRMED', 'EasySlip ตรวจสลิปผ่าน (ยอด+บัญชีตรง) — ยืนยันอัตโนมัติ', 'system');
    }).catch(() => {});
  }

  const PARTS = [1, 2, 3, 4, 5], QPP = 20, PASS = 16, MAXATT = 3, TOTAL = 120 * 60; // MAXATT = total attempts/part (1 first + 2 remedial)
  // Exam admin endpoints are open (no Admin Key) — per CloverX request. Keep the operations URL private.
  // NOTE: the orders/Stripe/PII admin in server.js still uses ADMIN_KEY separately.
  const adminOk = (req) => true;   // การอ่าน (GET) ยังเปิด/มาสก์ตาม PDPA เหมือนเดิม
  // ---- ล็อกเฉพาะ "การแก้ไข" (POST) ของ admin ระบบสอบ: ต้องมี ADMIN_KEY ที่ถูกต้อง ----
  const xvClientIp = (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || (req.connection && req.connection.remoteAddress) || 'x');
  const _xvFail = {};
  const adminWrite = (req) => {
    const need = process.env.ADMIN_KEY || '';
    if (!need) return true;   // ยังไม่ตั้งคีย์ → คงพฤติกรรมเดิม (เปิด) กันระบบล็อกตัวเองในenv ที่ไม่ได้ตั้งคีย์
    const ip = xvClientIp(req), now = Date.now(); let f = _xvFail[ip];
    if (f && f.until > now) return false;   // โดนล็อกชั่วคราวจากการเดาคีย์ผิดถี่
    const k = (req.query && req.query.key) || (req.body && req.body.key) || req.headers['x-admin-key'] || '';
    if (k && k === need) { if (_xvFail[ip]) _xvFail[ip].n = 0; return true; }
    f = _xvFail[ip] || { n: 0, until: 0 }; f.n++; if (f.n >= 8) { f.until = now + 600000; f.n = 0; } _xvFail[ip] = f;
    return false;
  };
  // ป้องกันทุก POST ใต้ /api/xv/admin (การแก้ไข/ยืนยัน/รอบสอบ/นำเข้าข้อสอบ ฯลฯ) — GET (อ่าน) ปล่อยผ่าน
  app.use('/api/xv/admin', (req, res, next) => {
    if (req.method === 'POST' && !adminWrite(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    next();
  });
  const genId = () => crypto.randomBytes(9).toString('hex');

  /* ---------------- question SETS (each round picks one; keys stay server-side) ---------------- */
  const nextSetNo = () => { const s = readColl('qsets'); return s.length ? Math.max.apply(null, s.map(x => x.no || 0)) + 1 : 1; };
  // lazily create the first set from the legacy file bank so nothing is lost on upgrade
  const ensureSets = () => {
    let sets = readColl('qsets');
    if (!sets.length) {
      const b = bankFile();
      if (b.bank && Object.keys(b.bank).length) {
        sets = [{ id: genId(), no: 1, name: 'ชุดที่ 1 · ผู้เตรียมสอบเป็น X-Visor', names: b.names || {}, bank: b.bank, createdAt: Date.now() }];
        writeColl('qsets', sets);
      }
    }
    return sets;
  };
  const getSet = (setId) => {
    const sets = ensureSets();
    if (setId) { const s = sets.find(x => x.id === setId); if (s) return s; }
    if (sets.length) return sets[0]; // default = first set
    const b = bankFile(); return { id: 'legacy', no: 1, name: 'ชุดที่ 1', names: b.names || {}, bank: b.bank || {} };
  };
  const bank = () => getSet(null); // backward-compatible single-bank accessor (default set)
  const setCounts = (s) => { const c = {}; [1, 2, 3, 4, 5].forEach(p => { c[p] = (((s.bank && (s.bank[p] || s.bank[String(p)])) || []).length); }); return c; };
  const setTotal = (s) => [1, 2, 3, 4, 5].reduce((a, p) => a + (((s.bank && (s.bank[p] || s.bank[String(p)])) || []).length), 0);
  const setReady = (s) => { const c = setCounts(s); return [1, 2, 3, 4, 5].every(p => (c[p] || 0) > 0); };
  const pubSet = (s) => ({ id: s.id, no: s.no, name: s.name, names: s.names || {}, counts: setCounts(s), total: setTotal(s), ready: setReady(s), createdAt: s.createdAt });

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function buildPaper(B, parts) {
    const paper = {};
    parts.forEach(p => {
      const src = B.bank[p] || B.bank[String(p)] || [];
      const order = shuffle(src.map((_, i) => i)).slice(0, QPP); // ใช้ไม่เกิน 20 ข้อ/พาร์ท (กันชุดที่มีข้อเกิน)
      paper[p] = order.map(qi => { const it = src[qi]; const oi = shuffle([0, 1, 2, 3]); return { q: it.q, o: oi.map(k => it.o[k]), c: oi.indexOf(it.c) }; });
    });
    return paper;
  }
  // strip correct index for the client
  function clientPaper(paper, parts) { const out = {}; parts.forEach(p => { out[p] = (paper[p] || []).map(x => ({ q: x.q, o: x.o })); }); return out; }
  function findS(all, id, token) { return all.find(x => x.id === id && x.token === token); }
  // ตอนสอบซ่อม: ใช้ "พาร์ตที่กำลังซ่อมรอบนี้" (remedialActive) ถ้ามี — ผู้สอบ/ทีมงานเลือกซ่อมเฉพาะบางพาร์ตได้ · ไม่มี = ซ่อมทุกพาร์ตที่ค้าง
  function activeParts(s) { return s.phase === 'remedial' ? ((s.remedialActive && s.remedialActive.length) ? s.remedialActive.slice() : (s.remedialQueue || [])) : PARTS.slice(); }

  // expired=true เมื่อถูกตัดเพราะหมดเวลา 120 นาที → ถ้ายังมีพาร์ทไม่ผ่าน ให้ "ตก" ทันที (ไม่ได้สิทธิ์สอบซ่อมต่อ ต้องรอสอบรอบใหม่)
  function score(s, expired) {
    const parts = activeParts(s);
    parts.forEach(p => {
      let sc = 0; const wrong = [];
      const pp = s.paper[p] || s.paper[String(p)] || []; const lim = Math.min(QPP, pp.length); // กัน crash ถ้าชุดข้อไม่ครบ
      for (let q = 0; q < lim; q++) { if (pp[q] && s.answers[p + '-' + q] === pp[q].c) sc++; else wrong.push(q + 1); }
      let r = s.results.find(x => x.part === p);
      if (!r) { r = { part: p, attempts: 0 }; s.results.push(r); }
      r.score = sc; r.attempts = (r.attempts || 0) + 1; r.status = sc >= PASS ? 'passed' : 'failed'; r.wrongIds = wrong;
    });
    s.results.sort((a, b) => a.part - b.part);
    const failed = s.results.filter(r => r.status === 'failed');
    const exhausted = failed.filter(r => r.attempts >= MAXATT);
    if (exhausted.length) s.status = 'ended_failed';
    else if (failed.length === 0) {
      // On-Site: system only records scores — no staff verification step. Status is a terminal "submitted".
      // staffVerified stays true internally so the candidate can view their own score report in-app.
      // Online: candidate waits for staff to verify before results are released.
      if (s.candidate && s.candidate.mode === 'onsite') { s.status = 'submitted'; s.staffVerified = true; s.verifiedAt = Date.now(); }
      else s.status = 'awaiting_verify';
    }
    else if (expired) { s.status = 'ended_failed'; s.timedOut = true; s.remedialQueue = []; s.remedialActive = null; } // หมดเวลา + ยังมีพาร์ทไม่ผ่าน = ตกทุกกรณี
    else { s.status = 'remedial_required'; s.remedialQueue = failed.map(r => r.part).sort((a, b) => a - b); s.remedialActive = null; }
    s.paused = false;
    s.submittedAt = Date.now();
    // บันทึกประวัติการส่งรายครั้ง (สำหรับรายงาน "ประวัติรายครั้ง") — 1 record ต่อการส่ง 1 ครั้ง
    try {
      s.attemptLog = s.attemptLog || [];
      const ev = { at: Date.now(), kind: (s.phase === 'remedial' ? 'remedial' : 'first'), parts: parts.slice(), perPart: {}, wrong: {}, pauseUsed: s.pauseUsed || 0, scoreEdited: false, expired: !!expired };
      let evTot = 0; parts.forEach(p => { const rr = s.results.find(x => x.part === p); const sc = rr ? (rr.score || 0) : 0; ev.perPart[p] = sc; ev.wrong[p] = rr ? (rr.wrongIds || []).slice() : []; evTot += sc; });
      ev.total = evTot; ev.full = parts.length * QPP; ev.pass = parts.every(p => (ev.perPart[p] || 0) >= PASS);
      ev.remedialAfter = (s.remedialQueue || []).slice();
      s.attemptLog.push(ev);
    } catch (e) {}
  }
  const pubResults = (s) => s.results.map(r => ({ part: r.part, score: r.score, status: r.status, attempts: r.attempts }));

  // live progress ของผู้ที่กำลังสอบ (in_progress) — คำนวณจากคำตอบที่ส่งมาแล้วเทียบกับเฉลยฝั่งเซิร์ฟเวอร์
  // ส่งออกเฉพาะ "จำนวน" (ตอบแล้ว/ถูก/ผิด ต่อพาร์ท + รวม + พาร์ท/ข้อปัจจุบัน) ไม่ส่งเฉลยหรือความถูก-ผิดรายข้อ
  function xvLiveProgress(s) {
    const activeP = (s.phase === 'remedial') ? (s.remedialQueue || []) : PARTS;
    const perPart = []; let totalAnswered = 0, totalCorrect = 0, inScopeTotal = 0;
    PARTS.forEach(p => {
      const inScope = activeP.indexOf(p) >= 0;
      const paper = s.paper && s.paper[p];
      let ans = 0, cor = 0;
      if (inScope) {
        for (let q = 0; q < QPP; q++) {
          const a = s.answers ? s.answers[p + '-' + q] : undefined;
          if (a !== undefined && a !== null) { ans++; totalAnswered++; if (paper && paper[q] && a === paper[q].c) { cor++; totalCorrect++; } }
        }
        inScopeTotal += QPP;
      }
      perPart.push({ part: p, answered: ans, correct: cor, inScope: inScope });
    });
    const scope = perPart.filter(x => x.inScope);
    const partsDone = scope.filter(x => x.answered >= QPP).length;
    let curPart = null, curQ = null;
    for (const x of scope) { if (x.answered < QPP) { curPart = x.part; curQ = x.answered + 1; break; } }
    if (curPart === null && scope.length) { curPart = scope[scope.length - 1].part; curQ = QPP; }
    return { perPart, totalAnswered, totalCorrect, totalWrong: totalAnswered - totalCorrect, totalQ: inScopeTotal, partsDone, partsTotal: scope.length, curPart, curQ };
  }

  /* ---- server-side time enforcement (กันโกงเวลา: ไม่เชื่อค่าเวลาจากฝั่งลูกค้า) ---- */
  const XV_GRACE_MS = 10000; // เผื่อความหน่วงเครือข่าย 10 วินาที ก่อนตัดเวลาจริง
  function xvDeadline(s) { return s.deadlineAt || ((s.startedAt || Date.now()) + TOTAL * 1000); }
  // เวลาที่เหลือจริง คำนวณจากนาฬิกาเซิร์ฟเวอร์ (ถ้ากำลัง pause ใช้เวลา ณ ตอนหยุด)
  function xvRemaining(s) { const dl = xvDeadline(s); const ref = (s.paused && s.pausedAt) ? s.pausedAt : Date.now(); return Math.max(0, Math.ceil((dl - ref) / 1000)); }
  function xvExpired(s) { if (s.paused) return false; return Date.now() > xvDeadline(s) + XV_GRACE_MS; }
  // ซิงก์สถานะ pause ของ On-Site: ตอน resume ให้ขยาย deadline ตามเวลาที่หยุดไป (ออนไลน์ไม่มี pause = นาฬิกาเดินตรง)
  function xvSyncPause(s, paused) {
    const now = Date.now();
    if (paused && !s.paused) { s.paused = true; s.pausedAt = now; }
    else if (!paused && s.paused) { if (s.pausedAt) s.deadlineAt = xvDeadline(s) + (now - s.pausedAt); s.paused = false; s.pausedAt = null; }
  }
  // ตัดข้อสอบอัตโนมัติเมื่อหมดเวลา (แม้ลูกค้าจะเปิดค้างไว้/ไม่กดส่ง)
  function xvAutoExpire(s) { if (s && s.status === 'in_progress' && xvExpired(s)) { score(s, true); s.autoExpired = true; return true; } return false; }
  const xvDigits = (v) => String(v || '').replace(/\D/g, '');

  /* ---------------- candidate endpoints ---------------- */
  app.post('/api/xv/start', (req, res) => {
    const b = req.body || {};
    if (!b.firstName || !b.lastName || !b.phone) return res.status(400).json({ ok: false, error: 'missing_fields' });
    // resolve round (accept roundId or round code); gate closed rounds
    let round = null;
    if (b.roundId) round = findR(b.roundId);
    if (!round && b.roundCode) round = findRByCode(b.roundCode);
    if (round && round.status !== 'open') return res.status(403).json({ ok: false, error: 'round_closed' });
    const all = readS();
    // กันเปิดสอบซ้ำ/หลาย session ต่อคนต่อรอบ (เฉพาะรอบที่ระบุ)
    if (round) {
      const ph = xvDigits(b.phone);
      const prev = all.find(x => x.roundId === round.id && xvDigits((x.candidate || {}).phone) === ph);
      if (prev) {
        xvAutoExpire(prev); // เผื่อ session เดิมหมดเวลาไปแล้ว
        if (prev.status === 'in_progress') {
          // มี session ค้างอยู่ → กลับเข้าสอบเดิม (กัน refresh แล้วรีเซ็ตเวลา/สร้างชุดใหม่)
          const rp = activeParts(prev);
          writeS(all);
          return res.json({
            ok: true, resumed: true, sessionId: prev.id, token: prev.token, code: prev.code,
            mode: prev.candidate.mode, phase: prev.phase, parts: rp, durationSec: TOTAL,
            remaining: xvRemaining(prev), answers: prev.answers || {}, paper: clientPaper(prev.paper, rp)
          });
        }
        // สอบจบไปแล้ว (รอตรวจ/ผ่าน/ตก/ตัดสิทธิ์) → ห้ามสอบซ้ำในรอบเดิม
        writeS(all);
        return res.status(409).json({ ok: false, error: 'already_taken', status: prev.status });
      }
    }
    // pick the question set assigned to this round (falls back to the default/first set)
    const B = getSet(round ? round.setId : null);
    if (!B.bank || Object.keys(B.bank).length < 5) return res.status(400).json({ ok: false, error: 'no_questions' });
    const paper = buildPaper(B, PARTS);
    const now = Date.now();
    // นาฬิการวมของห้อง (รอบสอบแรก): เวลาผูกกับ "รอบ" — เริ่มนับตั้งแต่ทีมงานกดเปิดสอบ ทุกคนหมดเวลาพร้อมกัน
    // คนเข้าสอบสายจะเหลือเวลาน้อยกว่า 120 นาที · ถ้ารอบยังไม่ตั้งนาฬิกา (รอบเก่า) fallback = 120 นาทีต่อคน
    const roomDeadline = (round && round.examDeadlineAt) ? round.examDeadlineAt : null;
    if (roomDeadline && now > roomDeadline + XV_GRACE_MS) return res.status(403).json({ ok: false, error: 'exam_time_ended' });
    const deadlineAt = roomDeadline || (now + TOTAL * 1000);
    const remainSec = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
    const s = {
      id: genId(), token: crypto.randomBytes(12).toString('hex'),
      candidate: { firstName: String(b.firstName).slice(0, 60), lastName: String(b.lastName).slice(0, 60), phone: String(b.phone).slice(0, 30), mode: b.mode === 'onsite' ? 'onsite' : 'online' },
      code: 'XV' + (Date.now() % 1000000),
      setId: B.id || null,
      roundId: round ? round.id : null, roundNo: round ? round.no : null,
      phase: 'first', paper, answers: {}, results: [], status: 'in_progress',
      startedAt: now, deadlineAt: deadlineAt, roomClock: !!roomDeadline, paused: false, pausedAt: null,
      remaining: remainSec, pauseUsed: 0, staffVerified: false, createdAt: now
    };
    all.push(s); writeS(all);
    res.json({ ok: true, sessionId: s.id, token: s.token, code: s.code, mode: s.candidate.mode, phase: 'first', parts: PARTS, durationSec: remainSec, paper: clientPaper(paper, PARTS) });
  });

  app.post('/api/xv/answer', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'in_progress') return res.status(404).json({ ok: false });
    // ซิงก์ pause ของ On-Site ก่อน (มีผลต่อการคำนวณเวลา)
    // pause เป็นสิทธิ์ของ On-Site เท่านั้น — กันผู้สอบออนไลน์ส่ง paused:true มาหยุดนาฬิกาเอง (โกงเวลา)
    var _onsite = !!(s.candidate && s.candidate.mode === 'onsite');
    if (_onsite && typeof b.paused === 'boolean') xvSyncPause(s, b.paused);
    if (_onsite && typeof b.pauseUsed === 'number') s.pauseUsed = b.pauseUsed;
    // บังคับเวลาจากเซิร์ฟเวอร์: หมดเวลาแล้ว → ตัดข้อสอบทันที ไม่รับคำตอบเพิ่ม (ไม่เชื่อค่าเวลาจากลูกค้า)
    if (xvExpired(s)) { score(s, true); writeS(all); return res.json({ ok: true, expired: true, status: s.status, remaining: 0 }); }
    if (b.part && b.q != null && (b.choice === null || (b.choice >= 0 && b.choice < 4))) s.answers[b.part + '-' + b.q] = b.choice;
    s.remaining = xvRemaining(s); // เวลาที่เหลือคิดจากเซิร์ฟเวอร์เท่านั้น
    writeS(all); res.json({ ok: true, remaining: s.remaining });
  });

  // proctor: record anti-cheat behaviour events during the exam
  const PROC_TYPES = ['leave', 'blur', 'printscreen', 'copy', 'contextmenu', 'paste', 'cut', 'fullscreen_exit'];
  app.post('/api/xv/proctor', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'in_progress') return res.status(404).json({ ok: false });
    const type = PROC_TYPES.indexOf(b.type) >= 0 ? b.type : null;
    if (!type) return res.status(400).json({ ok: false, error: 'bad_type' });
    s.proctor = s.proctor || { leave: 0, blur: 0, printscreen: 0, copy: 0, contextmenu: 0, paste: 0, cut: 0, fullscreen_exit: 0, events: [] };
    s.proctor[type] = (s.proctor[type] || 0) + 1;
    s.proctor.events = s.proctor.events || [];
    s.proctor.events.push({ type, at: Date.now() });
    if (s.proctor.events.length > 60) s.proctor.events = s.proctor.events.slice(-60);
    writeS(all); res.json({ ok: true });
  });

  // เก็บภาพเว็บแคมระหว่างสอบ (proctoring) — เก็บล่าสุดสูงสุด 30 ภาพ/คน แล้วลบไฟล์เก่าทิ้ง
  app.post('/api/xv/proctor-photo', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'in_progress') return res.status(404).json({ ok: false });
    const url = saveRegImage(b.image, 'cam');
    if (!url || url === 'TOO_BIG') return res.status(400).json({ ok: false, error: 'bad_image' });
    s.proctorPhotos = s.proctorPhotos || [];
    s.proctorPhotos.push({ at: Date.now(), url: url });
    while (s.proctorPhotos.length > 30) {
      const old = s.proctorPhotos.shift();
      try { fs.unlinkSync(path.join(REGUP, path.basename(old.url))); } catch (e) {}
    }
    writeS(all); res.json({ ok: true, count: s.proctorPhotos.length });
  });

  // รวมคำตอบชุดเต็มจากลูกค้าเข้ากับที่เซิร์ฟเวอร์มี (กันข้อตกหล่นจากการซิงก์ระหว่างสอบ)
  // รับเฉพาะพาร์ต/ข้อในขอบเขต + ค่าตัวเลือก 0..3 หรือ null · ไม่ทับข้อที่ตอบไว้แล้วด้วยค่าว่าง
  function mergeAnswers(s, ans) {
    if (!ans || typeof ans !== 'object') return 0;
    const scope = activeParts(s); let merged = 0;
    Object.keys(ans).forEach(k => {
      const m = /^(\d+)-(\d+)$/.exec(k); if (!m) return;
      const p = +m[1], q = +m[2];
      if (scope.indexOf(p) < 0) return; if (!(q >= 0 && q < QPP)) return;
      const v = ans[k];
      if (v === null) { if (s.answers[k] === undefined) { s.answers[k] = null; merged++; } return; }
      if (v >= 0 && v < 4) { if (s.answers[k] !== v) { s.answers[k] = v; merged++; } }
    });
    return merged;
  }
  app.post('/api/xv/submit', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s) return res.status(404).json({ ok: false });
    // idempotent: ถ้าถูกตัด/ส่งไปแล้ว (เช่นเซิร์ฟเวอร์หมดเวลาก่อน) คืนผลเดิม ไม่ error
    if (s.status === 'in_progress') {
      const expired = xvExpired(s);
      // รวมคำตอบชุดเต็มก่อนตรวจ — ถ้ายังไม่หมดเวลา ให้เชื่อ snapshot จากลูกค้าเพื่อกันข้อที่ซิงก์ไม่ทัน
      if (!expired) mergeAnswers(s, b.answers);
      score(s, expired); writeS(all);
    }
    res.json({ ok: true, status: s.status, results: pubResults(s), remedialQueue: s.remedialQueue || [], total: s.results.reduce((a, r) => a + (r.score || 0), 0) });
  });

  // ทีมงานบังคับตรวจคะแนน (เผื่อลูกค้าทำครบแต่กดส่งไม่ได้) — ตรวจคำตอบที่มีตอนนี้เหมือนลูกค้ากดส่งเอง
  // ข้อที่ยังไม่ตอบ = ผิด · ผ่าน=ผ่าน · ตกบางพาร์ต=เข้าสอบซ่อมตาม logic ปกติ · ไม่ถือว่าหมดเวลา
  app.post('/api/xv/admin/session/:id/force-grade', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {}; const all = readS(); const s = all.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: 'not_found' });
    if (s.status !== 'in_progress') return res.status(409).json({ ok: false, error: 'not_in_progress', status: s.status });
    const before = s.status;
    // พาร์ตที่ทีมงานเลือกตรวจ (บันทึกไว้ตรวจสอบย้อนหลัง) — การให้คะแนนใช้ตัวตรวจปกติ: ตรวจทุกพาร์ตในขอบเขตจากคำตอบที่มี
    // (ข้อไม่ตอบ = ผิด) แล้วจบการสอบทันที · พาร์ตที่ไม่ได้ทำจึงนับเป็นไม่ผ่าน เข้าสู่ผ่าน/ซ่อมตาม logic ปกติ
    const active = activeParts(s);
    let sel = Array.isArray(b.parts) ? b.parts.map(Number).filter(p => active.indexOf(p) >= 0) : active.slice();
    if (!sel.length) sel = active.slice();
    score(s, false);
    s.forcedGrade = { by: String(b.actor || 'staff').slice(0, 60), at: Date.now(), parts: sel, reason: String(b.reason || '').slice(0, 200) };
    writeS(all);
    logAudit('force_grade', 'session', s.id, s.code || '', before, s.status, 'ทีมงานบังคับตรวจคะแนน (พาร์ต ' + sel.join(', ') + ')' + (b.reason ? (' · ' + b.reason) : ''), s.forcedGrade.by);
    res.json({ ok: true, status: s.status, results: pubResults(s), remedialQueue: s.remedialQueue || [], total: s.results.reduce((a, r) => a + (r.score || 0), 0) });
  });

  app.post('/api/xv/remedial/start', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'remedial_required') return res.status(400).json({ ok: false });
    const queue = (s.remedialQueue || []);
    // ผู้สอบเลือกเองได้ว่าจะซ่อมพาร์ตไหน (เฉพาะพาร์ตที่ไม่ผ่านเท่านั้น) · ไม่ส่ง parts มา = ซ่อมทุกพาร์ตที่ค้าง
    let sel = Array.isArray(b.parts) ? b.parts.map(Number).filter(p => queue.indexOf(p) >= 0) : queue.slice();
    sel = Array.from(new Set(sel)).sort((a, b) => a - b);
    if (!sel.length) sel = queue.slice();
    if (!sel.length) return res.status(400).json({ ok: false, error: 'no_parts' });
    const np = buildPaper(getSet(s.setId), sel);
    sel.forEach(p => { s.paper[p] = np[p]; for (let q = 0; q < QPP; q++) delete s.answers[p + '-' + q]; });
    const now = Date.now();
    // สอบซ่อม = นาฬิกาของใครของมัน เริ่มใหม่ 120 นาทีทันที (ไม่ผูกนาฬิการวมของห้อง)
    s.phase = 'remedial'; s.remedialActive = sel; s.status = 'in_progress'; s.remaining = TOTAL;
    s.startedAt = now; s.deadlineAt = now + TOTAL * 1000; s.roomClock = false; s.paused = false; s.pausedAt = null;
    writeS(all);
    res.json({ ok: true, parts: sel, durationSec: TOTAL, paper: clientPaper(s.paper, sel) });
  });

  app.get('/api/xv/session/:id', (req, res) => {
    const all = readS(); const s = findS(all, req.params.id, req.query.token);
    if (!s) return res.status(404).json({ ok: false });
    // ถ้าหมดเวลาแต่ยังไม่ได้ส่ง (เช่นปิดแท็บทิ้งไว้) → ตัดข้อสอบอัตโนมัติเมื่อมีการเรียกดู
    if (xvAutoExpire(s)) writeS(all);
    const parts = activeParts(s);
    res.json({ ok: true, mode: s.candidate.mode, phase: s.phase, status: s.status, parts, answers: s.answers, remaining: (s.status === 'in_progress' ? xvRemaining(s) : (s.remaining || 0)), pauseUsed: s.pauseUsed, results: pubResults(s), remedialQueue: s.remedialQueue || [], staffVerified: s.staffVerified, paper: clientPaper(s.paper, parts) });
  });

  /* -------- feedback / bug reports (สาธารณะ: ผู้เทสต์แจ้งปัญหาได้โดยไม่ต้องล็อกอิน) -------- */
  app.post('/api/xv/feedback', (req, res) => {
    const b = req.body || {}; const text = String(b.text || '').trim().slice(0, 3000);
    if (!text) return res.status(400).json({ ok: false, error: 'empty' });
    const c = (b.context && typeof b.context === 'object') ? b.context : {};
    const fb = {
      id: genId(), text,
      screen: String(c.screen || '').slice(0, 60), part: (c.part != null ? c.part : null), q: (c.q != null ? c.q : null),
      code: String(c.code || '').slice(0, 24), name: String(c.name || '').slice(0, 80), phone: String(c.phone || '').slice(0, 30),
      roundNo: (c.roundNo != null ? c.roundNo : null), mode: String(c.mode || '').slice(0, 12),
      ua: String(c.ua || '').slice(0, 320), vw: (c.vw != null ? c.vw : null), vh: (c.vh != null ? c.vh : null),
      url: String(c.url || '').slice(0, 320), kind: (b.kind === 'idea' ? 'idea' : 'bug'),
      status: 'open', createdAt: Date.now()
    };
    const all = readColl('feedback'); all.unshift(fb); writeColl('feedback', all.slice(0, 3000));
    res.json({ ok: true, id: fb.id });
  });
  app.get('/api/xv/admin/feedback', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readColl('feedback');
    res.json({ ok: true, feedback: all, openCount: all.filter(f => f.status === 'open').length });
  });
  app.post('/api/xv/admin/feedback/:id/toggle', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readColl('feedback'); const f = all.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({ ok: false });
    f.status = (f.status === 'open') ? 'resolved' : 'open'; writeColl('feedback', all);
    res.json({ ok: true, status: f.status });
  });
  app.post('/api/xv/admin/feedback/:id/delete', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readColl('feedback'); const i = all.findIndex(x => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ ok: false });
    all.splice(i, 1); writeColl('feedback', all); res.json({ ok: true });
  });

  // wrong-question review — only after staff verification
  app.get('/api/xv/review/:id', (req, res) => {
    const all = readS(); const s = findS(all, req.params.id, req.query.token);
    if (!s) return res.status(404).json({ ok: false });
    if (!s.staffVerified) return res.json({ ok: false, error: 'not_verified' });
    res.json({ ok: true, results: s.results.map(r => ({ part: r.part, score: r.score, wrongIds: r.wrongIds || [], questions: (r.wrongIds || []).map(n => s.paper[r.part][n - 1].q) })) });
  });

  // public: resolve a round by code (for the candidate share link) — no keys/PII
  app.get('/api/xv/round/:code', (req, res) => {
    const r = findRByCode(req.params.code);
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, round: { id: r.id, code: r.code, no: r.no, date: r.date, topic: r.topic, status: r.status, open: r.status === 'open', mode: r.mode || 'online', venue: r.venue || '', timeslot: r.timeslot || '' } });
  });

  /* ---------------- roster: imported "paid registrants" for exam-entry autofill ----------------
     - phone is the match key (digits only; also matched by last-9-digits to ignore 0/country-code)
     - "roster only" mode: this NEVER blocks anyone — it just prefills the name when the phone matches. */
  const xvPhoneKey = (s) => { const d = String(s == null ? '' : s).replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
  const rosterSeed = () => { const s = rd(ROSTER_SEED, null); return (s && Array.isArray(s.entries)) ? s.entries : []; };
  // merged view: imported roster (writable) layered over the bundled seed; imported wins on phone clash
  const rosterAll = () => {
    const out = {}; // key -> entry
    rosterSeed().forEach(e => { const k = xvPhoneKey(e.phone); if (k) out[k] = { name: e.name || '', phone: e.phone || '', coach: e.coach || '', team: e.team || '', round: e.round || '', source: 'seed' }; });
    (readColl('roster') || []).forEach(e => { const k = xvPhoneKey(e.phone); if (k) out[k] = { name: e.name || '', phone: e.phone || '', coach: e.coach || '', team: e.team || '', round: e.round || '', source: e.source || 'import' }; });
    return out;
  };
  const rosterFind = (phone) => { const k = xvPhoneKey(phone); return k ? (rosterAll()[k] || null) : null; };

  // public: look up a phone in the roster → prefill name (minimal fields only, no full PII dump)
  app.get('/api/xv/roster/lookup', (req, res) => {
    const hit = rosterFind(req.query.phone);
    if (!hit) return res.json({ ok: true, found: false });
    res.json({ ok: true, found: true, name: hit.name, round: hit.round || '', coach: hit.coach || '' });
  });

  // admin (read, open+masked per PDPA like other GETs): list the merged roster
  app.get('/api/xv/admin/roster', (req, res) => {
    const m = rosterAll();
    const list = Object.keys(m).map(k => m[k]).sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
    const imported = (readColl('roster') || []).length;
    res.json({ ok: true, total: list.length, imported: imported, seed: rosterSeed().length, entries: list });
  });

  // admin (ADMIN_KEY): import rows [{name, phone, coach?, team?, round?}] → merge into roster by phone
  app.post('/api/xv/admin/roster/import', (req, res) => {
    const b = req.body || {};
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: 'no_rows' });
    const cur = readColl('roster') || [];
    const byKey = {}; cur.forEach(e => { const k = xvPhoneKey(e.phone); if (k) byKey[k] = e; });
    let added = 0, updated = 0, skipped = 0;
    const now = Date.now();
    rows.forEach(r => {
      const name = String(r.name == null ? '' : r.name).trim().slice(0, 120);
      const phone = String(r.phone == null ? '' : r.phone).trim().slice(0, 40);
      const k = xvPhoneKey(phone);
      if (!name || !k) { skipped++; return; }
      const entry = { name: name, phone: phone, coach: String(r.coach || '').trim().slice(0, 80), team: String(r.team || '').trim().slice(0, 120), round: String(r.round || '').trim().slice(0, 160), source: String(b.source || 'excel').slice(0, 40), importedAt: now };
      if (byKey[k]) { Object.assign(byKey[k], entry); updated++; } else { byKey[k] = entry; cur.push(entry); added++; }
    });
    writeColl('roster', cur);
    res.json({ ok: true, added: added, updated: updated, skipped: skipped, total: cur.length });
  });

  // admin (ADMIN_KEY): clear the imported roster (bundled seed stays)
  app.post('/api/xv/admin/roster/clear', (req, res) => {
    writeColl('roster', []);
    res.json({ ok: true, cleared: true });
  });

  /* ---------------- admin endpoints (ADMIN_KEY) ---------------- */
  app.get('/api/xv/admin/overview', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); let ch = false; all.forEach(s => { if (xvAutoExpire(s)) ch = true; }); if (ch) writeS(all);
    const by = f => all.filter(f).length;
    res.json({
      ok: true, total: all.length,
      inProgress: by(s => s.status === 'in_progress'),
      awaiting: by(s => s.status === 'awaiting_verify'),
      verified: by(s => s.status === 'verified'),
      submitted: by(s => s.status === 'submitted'),
      remedial: by(s => s.status === 'remedial_required'),
      ended: by(s => s.status === 'ended_failed'),
      online: by(s => s.candidate.mode === 'online'),
      onsite: by(s => s.candidate.mode === 'onsite')
    });
  });

  app.get('/api/xv/admin/sessions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); let changed = false;
    all.forEach(s => { if (xvAutoExpire(s)) changed = true; }); // ตัดข้อสอบที่หมดเวลาแต่ถูกทิ้งไว้
    if (changed) writeS(all);
    res.json({
      ok: true, sessions: all.map(s => ({
        id: s.id, code: s.code, candidate: s.candidate, phase: s.phase, status: s.status,
        roundId: s.roundId || null, roundNo: s.roundNo || null,
        results: pubResults(s), total: s.results.reduce((a, r) => a + (r.score || 0), 0),
        pauseUsed: s.pauseUsed, paused: !!s.paused, staffVerified: s.staffVerified, archived: !!s.archived, archivedAt: s.archivedAt || null, archivedBy: s.archivedBy || null, createdAt: s.createdAt, submittedAt: s.submittedAt, remaining: (s.status === 'in_progress' ? xvRemaining(s) : (s.remaining || 0)), startedAt: s.startedAt, autoExpired: !!s.autoExpired,
        proctor: s.proctor ? { leave: s.proctor.leave || 0, blur: s.proctor.blur || 0, printscreen: s.proctor.printscreen || 0, copy: s.proctor.copy || 0, contextmenu: s.proctor.contextmenu || 0, paste: s.proctor.paste || 0, cut: s.proctor.cut || 0, fullscreen_exit: s.proctor.fullscreen_exit || 0 } : null,
        flags: s.proctor ? ((s.proctor.leave || 0) + (s.proctor.blur || 0) + (s.proctor.printscreen || 0) + (s.proctor.copy || 0) + (s.proctor.contextmenu || 0) + (s.proctor.paste || 0) + (s.proctor.cut || 0) + (s.proctor.fullscreen_exit || 0)) : 0,
        camPhotos: (s.proctorPhotos || []).length, /* ภาพเว็บแคมโหลดตอนกดดู (ลดขนาด payload ให้โหลดไว) */
        proctorDecision: s.proctorDecision || null,
        scoreEdited: !!s.scoreEdited, scoreEditedBy: s.scoreEditedBy || null, scoreEditReason: s.scoreEditReason || null,
        live: s.status === 'in_progress' ? xvLiveProgress(s) : null, pausedAt: s.pausedAt || null,
        attemptLog: s.attemptLog || []
      }))
    });
  });

  app.get('/api/xv/admin/session/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const s = readS().find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const out = Object.assign({}, s); delete out.token;
    // ระหว่างสอบ (in_progress): คำนวณ "ข้อที่ตอบผิด/ตอบแล้ว" รายพาร์ทให้ทีมงานดูสด ๆ (ทำจากเฉลยฝั่งเซิร์ฟเวอร์
    // ก่อน strip เฉลย) — ส่งเฉพาะเลขข้อ ไม่ส่งเฉลย · endpoint นี้เป็นของแอดมิน (ผ่าน adminOk แล้ว) จึงไม่รั่วถึงผู้สอบ
    if (s.status === 'in_progress') {
      const scope = activeParts(s); const lw = {}, la = {}, ld = {};
      scope.forEach(p => {
        const paper = s.paper && s.paper[p]; const wrong = []; let ans = 0;
        for (let q = 0; q < QPP; q++) {
          const a = s.answers ? s.answers[p + '-' + q] : undefined;
          if (a !== undefined && a !== null) { ans++; if (paper && paper[q] && a !== paper[q].c) wrong.push(q + 1); }
        }
        lw[p] = wrong; la[p] = ans; ld[p] = ans >= QPP;
      });
      out.liveWrong = lw; out.liveAnswered = la; out.liveDone = ld; out.liveScope = scope.slice();
    }
    // ห้ามส่งเฉลย (index คำตอบ c) ออกฝั่ง client เด็ดขาด — endpoint นี้ไม่มีการล็อก + ผู้สอบรู้ id ตัวเอง จึงต้อง strip เฉลยทิ้ง (กันข้อสอบรั่ว)
    if (out.paper) { const pp = {}; Object.keys(out.paper).forEach(p => { pp[p] = (out.paper[p] || []).map(x => ({ q: x.q, o: x.o })); }); out.paper = pp; }
    res.json({ ok: true, session: out });
  });

  // proctor decision: staff marks a flagged candidate normal, or disqualifies them (ends the exam)
  app.post('/api/xv/admin/session/:id/proctor-decision', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const s = all.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const d = req.body && req.body.decision;
    if (d === 'disqualified') { s.status = 'disqualified'; s.proctorDecision = 'disqualified'; s.disqualifiedAt = Date.now(); }
    else if (d === 'normal') { s.proctorDecision = 'normal'; }
    else return res.status(400).json({ ok: false, error: 'bad_decision' });
    writeS(all); res.json({ ok: true, status: s.status });
  });

  app.post('/api/xv/admin/session/:id/verify', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const s = all.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    if (s.status !== 'awaiting_verify') return res.status(400).json({ ok: false, error: 'not_awaiting' });
    s.staffVerified = true; s.status = 'verified'; s.verifiedAt = Date.now(); writeS(all);
    res.json({ ok: true });
  });

  // จัดเก็บ/กู้คืน ผลสอบ (ย้ายออกจากลิสต์หลักไปคลังจัดเก็บ — ไม่ลบข้อมูล) · รับหลายรายการพร้อมกัน
  app.post('/api/xv/admin/sessions/archive', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ ok: false, error: 'no_ids' });
    const value = (b.value === false) ? false : true;   // ค่าเริ่มต้น = จัดเก็บ; ส่ง value:false = กู้คืน
    const actor = String(b.actor || 'staff').slice(0, 60);
    const all = readS(); let n = 0;
    all.forEach(s => {
      if (ids.indexOf(s.id) < 0) return;
      if (s.status === 'in_progress') return;           // กันจัดเก็บคนที่ยังสอบอยู่
      if (value) { s.archived = true; s.archivedAt = Date.now(); s.archivedBy = actor; }
      else { s.archived = false; s.archivedAt = null; s.archivedBy = null; }
      n++;
    });
    writeS(all);
    res.json({ ok: true, updated: n, value });
  });

  // staff correction: แก้ไขคะแนนรายพาร์ทของผู้สอบ (กรณีระบบคำนวณผิด/ต้องปรับด้วยมือ)
  // ต้องมี ADMIN_KEY (ผ่าน middleware ด้านบน) + บังคับกรอกเหตุผล → บันทึกลง audit log (ใคร/เมื่อไหร่/ก่อน→หลัง/เหตุผล)
  app.post('/api/xv/admin/session/:id/score-edit', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const s = all.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false, error: 'not_found' });
    if (s.status === 'in_progress') return res.status(400).json({ ok: false, error: 'in_progress' }); // แก้ได้เฉพาะรายการที่จบแล้ว
    const b = req.body || {};
    const edits = Array.isArray(b.scores) ? b.scores : null; // [{part, score}]
    const reason = String(b.reason || '').trim().slice(0, 200);
    const actor = String(b.actor || '').trim().slice(0, 60) || 'staff';
    if (!edits || !edits.length) return res.status(400).json({ ok: false, error: 'no_scores' });
    if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });
    if (!Array.isArray(s.results)) s.results = [];
    const snap = () => ({ total: s.results.reduce((a, r) => a + (r.score || 0), 0), status: s.status, parts: s.results.map(r => ({ part: r.part, score: r.score, status: r.status })) });
    const before = snap();
    let applied = 0;
    edits.forEach(e => {
      const p = parseInt(e.part, 10), sc = parseInt(e.score, 10);
      if (!(p >= 1 && p <= PARTS.length)) return;
      if (!(sc >= 0 && sc <= QPP)) return;
      let r = s.results.find(x => x.part === p);
      if (!r) { r = { part: p, attempts: 1 }; s.results.push(r); }
      r.score = sc; r.status = sc >= PASS ? 'passed' : 'failed';
      applied++;
    });
    if (!applied) return res.status(400).json({ ok: false, error: 'bad_scores' });
    s.results.sort((a, b) => a.part - b.part);
    // คำนวณสถานะรวมใหม่ (ตามตรรกะ score() แต่ไม่เพิ่มจำนวนครั้งสอบ/ไม่ยุ่งกับนาฬิกา)
    const failed = s.results.filter(r => r.status === 'failed');
    const exhausted = failed.filter(r => (r.attempts || 1) >= MAXATT);
    if (exhausted.length) s.status = 'ended_failed';
    else if (failed.length === 0) {
      if (s.candidate && s.candidate.mode === 'onsite') { s.status = 'submitted'; s.staffVerified = true; if (!s.verifiedAt) s.verifiedAt = Date.now(); }
      else if (before.status === 'verified') { s.status = 'verified'; }   // ออนไลน์ที่ปล่อยผลแล้ว → คงสถานะผ่าน
      else { s.status = 'awaiting_verify'; }
    } else { s.status = 'remedial_required'; s.remedialQueue = failed.map(r => r.part).sort((a, b) => a - b); }
    s.scoreEdited = true; s.scoreEditedAt = Date.now(); s.scoreEditedBy = actor; s.scoreEditReason = reason;
    try {
      s.attemptLog = s.attemptLog || [];
      const parts = edits.map(e => parseInt(e.part, 10)).filter(p => p >= 1 && p <= PARTS.length);
      const ev = { at: Date.now(), kind: 'edit', parts: parts.slice(), perPart: {}, pauseUsed: s.pauseUsed || 0, scoreEdited: true };
      let evTot = 0; parts.forEach(p => { const rr = s.results.find(x => x.part === p); const sc = rr ? (rr.score || 0) : 0; ev.perPart[p] = sc; evTot += sc; });
      ev.total = evTot; ev.full = parts.length * QPP; ev.pass = parts.every(p => (ev.perPart[p] || 0) >= PASS); ev.remedialAfter = (s.remedialQueue || []).slice();
      s.attemptLog.push(ev);
    } catch (e) {}
    const after = snap();
    writeS(all);
    logAudit('score_edit', 'session', s.id, s.code || '', before, after, reason, actor);
    res.json({ ok: true, status: s.status, results: pubResults(s), total: after.total });
  });

  // ทีมงานเปิดพาร์ตให้ผู้สอบกลับไปทำใหม่ (กันเคสหลุด Browser / กดส่งคะแนนไม่ได้) — เปิดได้เฉพาะพาร์ตที่ไม่ผ่านและยังไม่หมดสิทธิ์
  app.post('/api/xv/admin/session/:id/reopen-parts', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {}; const all = readS(); const s = all.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: 'not_found' });
    // พาร์ตที่ "ไม่ผ่าน" (คะแนน < เกณฑ์) และยังไม่หมดสิทธิ์ (ทำมาแล้วน้อยกว่า MAXATT ครั้ง)
    // ทีมงาน (admin) เปิดพาร์ตที่ "ไม่ผ่าน" ให้ทำใหม่ได้ — รวมกรณีใช้สิทธิ์ซ่อมครบแล้ว (เผื่อระบบมีปัญหา/คำตอบไม่ถูกบันทึก) · admin-only + บันทึก audit
    const failedParts = (s.results || []).filter(r => (r.score || 0) < PASS).map(r => r.part).sort((a, b) => a - b);
    let sel = Array.isArray(b.parts) ? b.parts.map(Number).filter(p => failedParts.indexOf(p) >= 0) : [];
    sel = Array.from(new Set(sel)).sort((a, b) => a - b);
    if (!sel.length) return res.status(400).json({ ok: false, error: 'no_valid_parts', failedParts: failedParts });
    const reason = String(b.reason || '').trim().slice(0, 200);
    const np = buildPaper(getSet(s.setId), sel);
    sel.forEach(p => { s.paper[p] = np[p]; for (let q = 0; q < QPP; q++) delete s.answers[p + '-' + q]; });
    const now = Date.now(); const before = s.status;
    // เปิดเป็นรอบซ่อมของผู้สอบคนนี้ — นาฬิกาของใครของมัน เริ่มใหม่ 120 นาทีทันที
    s.phase = 'remedial'; s.remedialActive = sel; s.remedialQueue = failedParts.slice(); s.status = 'in_progress';
    s.startedAt = now; s.deadlineAt = now + TOTAL * 1000; s.roomClock = false; s.remaining = TOTAL;
    s.paused = false; s.pausedAt = null; s.autoExpired = false; s.timedOut = false; s.submittedAt = null;
    s.reopenedBy = String(b.actor || 'staff').slice(0, 60); s.reopenedAt = now; s.reopenParts = sel.slice();
    writeS(all);
    logAudit('reopen_parts', 'session', s.id, s.code || '', before, 'in_progress', 'ทีมงานเปิดพาร์ต ' + sel.join(', ') + ' ให้ทำใหม่' + (reason ? (' · ' + reason) : ''), s.reopenedBy);
    res.json({ ok: true, parts: sel, status: s.status });
  });

  // ลบ session (สำหรับลบรายการทดสอบ/รายการผิดพลาด — ต้องใช้รหัสแอดมิน ผ่าน middleware ด้านบน)
  app.post('/api/xv/admin/session/:id/delete', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const i = all.findIndex(x => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ ok: false, error: 'not_found' });
    const removed = all[i].id; all.splice(i, 1); writeS(all);
    res.json({ ok: true, deleted: removed });
  });

  /* -------- admin: exam ROUNDS (date-based windows over the master bank) -------- */
  // list rounds + how many candidates in each
  app.get('/api/xv/admin/rounds', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const sess = readS();
    const rounds = readR().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.no || 0) - (a.no || 0));
    res.json({
      ok: true, rounds: rounds.map(r => {
        const list = sess.filter(s => s.roundId === r.id);
        return Object.assign(pubRound(r), {
          candidates: list.length,
          inProgress: list.filter(s => s.status === 'in_progress').length,
          awaiting: list.filter(s => s.status === 'awaiting_verify').length,
          verified: list.filter(s => s.status === 'verified').length
        });
      })
    });
  });

  // create a round (points at the master bank — no question copy)
  app.post('/api/xv/admin/rounds', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {};
    const r = {
      id: genId(), code: roundCode(),
      no: (b.no != null && b.no !== '') ? (parseInt(b.no, 10) || nextRoundNo()) : nextRoundNo(),
      date: String(b.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      topic: String(b.topic || 'Certification').slice(0, 80),
      status: b.status === 'open' ? 'open' : 'closed',
      mode: b.mode === 'onsite' ? 'onsite' : 'online',
      fee: b.fee != null && b.fee !== '' ? (parseInt(b.fee, 10) || 0) : 500,
      capacity: parseInt(b.capacity, 10) || 0,
      waitlist: !!b.waitlist,
      setId: b.setId ? String(b.setId) : '',
      venue: String(b.venue || '').slice(0, 200),
      timeslot: String(b.timeslot || '').slice(0, 60),
      regCloseAt: String(b.regCloseAt || '').slice(0, 10),
      createdAt: Date.now()
    };
    // ถ้าสร้างแบบ "เปิดสอบทันที" → เริ่มนาฬิการวมของห้องเลย
    if (r.status === 'open') { r.examOpenedAt = Date.now(); r.examDeadlineAt = r.examOpenedAt + TOTAL * 1000; }
    const all = readR(); all.push(r); writeR(all);
    logAudit('round_create', 'round', r.id, 'ครั้งที่ ' + r.no, null, r.status, 'สร้างรอบ ' + r.date + ' (' + r.mode + ')', 'staff');
    res.json({ ok: true, round: pubRound(r) });
  });

  // update a round (date / no / topic / status) — used by edit AND open-close
  app.post('/api/xv/admin/rounds/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readR(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {};
    const wasOpen = r.status === 'open';
    if (b.date != null) r.date = String(b.date).slice(0, 10);
    if (b.no != null && b.no !== '') r.no = parseInt(b.no, 10) || r.no;
    if (b.topic != null) r.topic = String(b.topic).slice(0, 80);
    if (b.status === 'open' || b.status === 'closed') r.status = b.status;
    if (b.mode === 'online' || b.mode === 'onsite') r.mode = b.mode;
    if (b.fee != null && b.fee !== '') r.fee = parseInt(b.fee, 10) || 0;
    if (b.capacity != null && b.capacity !== '') r.capacity = parseInt(b.capacity, 10) || 0;
    if (b.waitlist != null) r.waitlist = !!b.waitlist;
    if (b.setId != null) r.setId = String(b.setId);
    if (b.venue != null) r.venue = String(b.venue).slice(0, 200);
    if (b.timeslot != null) r.timeslot = String(b.timeslot).slice(0, 60);
    if (b.regCloseAt != null) r.regCloseAt = String(b.regCloseAt).slice(0, 10);
    // กดเปิดสอบ (closed → open) = เริ่มนาฬิการวมของห้อง 120 นาทีใหม่ทุกครั้ง
    if (r.status === 'open' && !wasOpen) {
      r.examOpenedAt = Date.now();
      r.examDeadlineAt = r.examOpenedAt + TOTAL * 1000;
      // คนที่กำลังสอบด้วยนาฬิกาห้อง (รอบแรก) รีเซ็ตเวลาตามนาฬิกาห้องใหม่ด้วย
      const allS = readS(); let touched = false;
      allS.forEach(s => {
        if (s.roundId === r.id && s.status === 'in_progress' && s.roomClock && s.phase === 'first') {
          s.startedAt = r.examOpenedAt; s.deadlineAt = r.examDeadlineAt; s.remaining = TOTAL; s.paused = false; s.pausedAt = null;
          touched = true;
        }
      });
      if (touched) writeS(allS);
    }
    writeR(all);
    logAudit('round_update', 'round', r.id, 'ครั้งที่ ' + r.no, null, r.status, (b.status === 'open' ? 'เปิดสอบ (เริ่มจับเวลา)' : (b.status === 'closed' ? 'ปิดสอบ' : 'แก้ไขข้อมูลรอบ')), 'staff');
    res.json({ ok: true, round: pubRound(r) });
  });

  // duplicate a round's SETTINGS to a new round (new code + no; optional new date)
  app.post('/api/xv/admin/rounds/:id/duplicate', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readR(); const src = all.find(x => x.id === req.params.id); if (!src) return res.status(404).json({ ok: false });
    const b = req.body || {};
    const r = {
      id: genId(), code: roundCode(),
      no: (b.no != null && b.no !== '') ? (parseInt(b.no, 10) || nextRoundNo()) : nextRoundNo(),
      date: String(b.date || src.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
      topic: String(b.topic != null ? b.topic : src.topic).slice(0, 80),
      status: 'closed', createdAt: Date.now()
    };
    all.push(r); writeR(all);
    res.json({ ok: true, round: pubRound(r) });
  });

  // delete a round (does NOT touch questions; sessions keep their history but unlink)
  app.delete('/api/xv/admin/rounds/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readR(); const i = all.findIndex(x => x.id === req.params.id); if (i < 0) return res.status(404).json({ ok: false });
    all.splice(i, 1); writeR(all);
    res.json({ ok: true });
  });

  /* ---------------- REGISTRATION (public + admin) ---------------- */
  const REG_STATUS = ['DRAFT', 'PENDING_PAYMENT', 'PAYMENT_REVIEW', 'CONFIRMED', 'WAITLISTED', 'CANCELLED', 'REJECTED', 'CHECKED_IN', 'NO_SHOW', 'EXAM_STARTED', 'COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
  const regOpenForReg = (r) => {
    if (r.status !== 'open') return false;
    if (r.regCloseAt) { const today = new Date().toISOString().slice(0, 10); if (today > r.regCloseAt) return false; }
    return true;
  };
  // public: rounds available to register for (optionally filtered by mode)
  app.get('/api/xv/reg/rounds', (req, res) => {
    const mode = req.query.mode === 'onsite' ? 'onsite' : (req.query.mode === 'online' ? 'online' : null);
    const list = readR().filter(r => regOpenForReg(r) && (!mode || (r.mode || 'online') === mode))
      .map(pubRound).sort((a, b) => (a.date < b.date ? -1 : 1));
    res.json({ ok: true, rounds: list });
  });
  // serve an uploaded slip / id-card image
  app.get('/api/xv/reg/file/:fn', (req, res) => {
    const fn = path.basename(String(req.params.fn));
    const p = path.join(REGUP, fn);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });
  // public: create a registration
  app.post('/api/xv/register', (req, res) => {
    const b = req.body || {};
    const need = ['nationalId', 'firstName', 'lastName', 'phone', 'email', 'roundId'];
    for (const k of need) if (!b[k] || !String(b[k]).trim()) return res.status(400).json({ ok: false, error: 'missing_' + k });
    if (!/^\d{13}$/.test(String(b.nationalId).replace(/\D/g, ''))) return res.status(400).json({ ok: false, error: 'bad_national_id' });
    if (!b.consentTerms || !b.consentPdpa) return res.status(400).json({ ok: false, error: 'consent_required' });
    const round = findR(b.roundId);
    if (!round) return res.status(404).json({ ok: false, error: 'round_not_found' });
    if (!regOpenForReg(round)) return res.status(403).json({ ok: false, error: 'round_closed' });
    const nid = String(b.nationalId).replace(/\D/g, '');
    const all = readReg();
    // duplicate guard: same person + round, not cancelled
    if (all.some(x => x.candidate && x.candidate.nationalId === nid && x.roundId === round.id && x.status !== 'CANCELLED' && x.status !== 'REJECTED'))
      return res.status(409).json({ ok: false, error: 'already_registered' });
    // capacity guard (re-read fresh)
    const seats = roundSeats(round);
    if (seats.full) {
      if (!round.waitlist) return res.status(409).json({ ok: false, error: 'round_full' });
    }
    const slipUrl = saveRegImage(b.slipImage, 'slip');
    const idCardUrl = saveRegImage(b.idCardImage, 'idcard');
    if (slipUrl === 'TOO_BIG' || idCardUrl === 'TOO_BIG') return res.status(400).json({ ok: false, error: 'image_too_big' });
    const hasSlip = !!slipUrl;
    const reg = {
      id: genId(), regNo: nextRegNo(), createdAt: Date.now(),
      roundId: round.id, roundNo: round.no, roundCode: round.code, mode: round.mode || 'online',
      candidate: {
        nationalId: nid, firstName: String(b.firstName).slice(0, 60), lastName: String(b.lastName).slice(0, 60),
        phone: String(b.phone).slice(0, 30), email: String(b.email).slice(0, 120)
      },
      taxEmail: String(b.taxEmail || b.email || '').slice(0, 120),
      address: {
        line1: String(b.addrLine1 || '').slice(0, 200), subdistrict: String(b.subdistrict || '').slice(0, 80),
        district: String(b.district || '').slice(0, 80), province: String(b.province || '').slice(0, 80), postal: String(b.postal || '').slice(0, 10)
      },
      coachTeam: String(b.coachTeam || '').slice(0, 80),
      referrer: String(b.referrer || '').slice(0, 80),
      country: String(b.country || 'ประเทศไทย').slice(0, 60),
      usStateCity: String(b.usStateCity || '').slice(0, 80),
      payment: { transferDate: String(b.transferDate || '').slice(0, 10), transferTime: String(b.transferTime || '').slice(0, 20), slipUrl: slipUrl || '', fee: round.fee != null ? round.fee : 500 },
      idCardUrl: idCardUrl || '',
      consentTerms: true, consentPdpa: true,
      status: seats.full && round.waitlist ? 'WAITLISTED' : (hasSlip ? 'PAYMENT_REVIEW' : 'PENDING_PAYMENT')
    };
    all.push(reg); writeReg(all);
    logAudit('register', 'registration', reg.id, reg.regNo, null, reg.status, 'สมัครผ่านหน้าลงทะเบียน · ครั้งที่ ' + round.no + ' (' + (round.mode || 'online') + ')', 'customer');
    // fire EasySlip auto-verification (async) if a slip was attached and EasySlip is configured
    if (esConfigured() && b.slipImage) {
      const m = String(b.slipImage).match(/^data:image\/[^;]+;base64,(.+)$/);
      if (m) { try { autoVerifyReg(reg.id, m[1]); } catch (e) {} }
    }
    res.json({ ok: true, regNo: reg.regNo, id: reg.id, status: reg.status, mode: reg.mode, round: { no: round.no, date: round.date, mode: round.mode, venue: round.venue, timeslot: round.timeslot } });
  });
  // admin: re-run EasySlip verification on a registration's saved slip
  app.post('/api/xv/admin/registrations/:id/reverify', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const r = readReg().find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    if (!esConfigured()) return res.status(400).json({ ok: false, error: 'easyslip_not_configured' });
    const url = r.payment && r.payment.slipUrl; if (!url) return res.status(400).json({ ok: false, error: 'no_slip' });
    const fn = path.basename(String(url)); const p = path.join(REGUP, fn);
    fs.readFile(p, (err, buf) => { if (err) return res.status(404).json({ ok: false, error: 'slip_missing' }); try { autoVerifyReg(r.id, buf.toString('base64')); } catch (e) {} res.json({ ok: true, message: 'reverifying' }); });
  });
  // public: check a registration's status (regNo + phone to verify identity)
  app.get('/api/xv/reg/status', (req, res) => {
    const regNo = String(req.query.regNo || '').trim().toUpperCase();
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    if (!regNo || !phone) return res.status(400).json({ ok: false, error: 'missing_fields' });
    const r = readReg().find(x => (x.regNo || '').toUpperCase() === regNo);
    if (!r || String((r.candidate || {}).phone || '').replace(/\D/g, '') !== phone) return res.status(404).json({ ok: false, error: 'not_found' });
    const nm = ((r.candidate.firstName || '') + ' ' + (r.candidate.lastName || '')).trim();
    const round = findR(r.roundId);
    res.json({
      ok: true, regNo: r.regNo, status: r.status, mode: r.mode,
      name: nm.length > 1 ? (nm[0] + '****' + nm.slice(-1)) : nm,
      round: round ? { no: round.no, date: round.date, mode: round.mode, venue: round.venue, timeslot: round.timeslot } : null,
      createdAt: r.createdAt
    });
  });
  // admin: list registrations (optionally by mode / round)
  app.get('/api/xv/admin/registrations', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const mode = req.query.mode; const roundId = req.query.roundId;
    let list = readReg();
    if (mode === 'online' || mode === 'onsite') list = list.filter(r => (r.mode || 'online') === mode);
    if (roundId) list = list.filter(r => r.roundId === roundId);
    list = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ ok: true, registrations: list });
  });
  // admin: update a registration's status (confirm payment / cancel / check-in)
  app.post('/api/xv/admin/registrations/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readReg(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {};
    if (b.status && REG_STATUS.indexOf(b.status) >= 0) {
      const before = r.status;
      const freedSeat = SEAT_TAKEN.indexOf(before) >= 0 && SEAT_TAKEN.indexOf(b.status) < 0;
      r.status = b.status;
      if (b.status === 'CHECKED_IN') { r.checkedInAt = Date.now(); }
      if (b.status === 'CONFIRMED') { r.confirmedAt = Date.now(); }
      if (b.status === 'CANCELLED') { r.cancelledAt = Date.now(); }
      writeReg(all);
      logAudit('status', 'registration', r.id, r.regNo, before, b.status, b.reason || '', 'staff');
      if (freedSeat) promoteWaitlist(r.roundId);
    } else { writeReg(all); }
    res.json({ ok: true, registration: r });
  });
  // admin: refund a registration — payment is by bank transfer (EasySlip), so we only RECORD the
  // refund; the admin transfers the money back manually. Supports full or partial, reason, note.
  app.post('/api/xv/admin/registrations/:id/refund', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readReg(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {};
    const beforeStatus = r.status;
    const fee = Number((r.payment && r.payment.fee) || r.fee || 0);
    const already = Number(r.refundedTotal) || 0;
    const full = b.full !== false;
    let amount = full ? (fee - already) : Number(b.amount || 0);
    if (!(amount > 0)) return res.status(400).json({ ok: false, error: 'bad_amount' });
    if (amount > fee - already + 0.001) return res.status(400).json({ ok: false, error: 'amount_exceeds', max: fee - already });
    const rec = { amount: amount, full: full, category: b.category || '', subReason: b.subReason || '', note: b.note || '', at: Date.now(), method: 'bank_manual' };
    r.refunds = Array.isArray(r.refunds) ? r.refunds : [];
    r.refunds.push(rec); r.refund = rec;
    r.refundedTotal = already + amount;
    r.status = (r.refundedTotal >= fee - 0.001) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    r.refundedAt = Date.now();
    writeReg(all);
    logAudit('refund', 'registration', r.id, r.regNo, beforeStatus, r.status, '฿' + amount + (b.category ? (' · ' + b.category) : '') + (b.note ? (' · ' + b.note) : ''), 'staff');
    if (SEAT_TAKEN.indexOf(beforeStatus) >= 0) promoteWaitlist(r.roundId);
    res.json({ ok: true, method: 'bank_manual', registration: r });
  });
  // admin: move a registrant to a different round / mode (change schedule) — updates the SAME record,
  // records the change history + reason, recomputes fee difference, frees the source seat & promotes waitlist.
  app.post('/api/xv/admin/registrations/:id/move', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readReg(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {};
    const toRound = findR(b.toRoundId);
    if (!toRound) return res.status(404).json({ ok: false, error: 'target_round_not_found' });
    if (toRound.id === r.roundId) return res.status(400).json({ ok: false, error: 'same_round' });
    if (!b.reason || !String(b.reason).trim()) return res.status(400).json({ ok: false, error: 'reason_required' });
    // capacity guard on the TARGET (only matters when this registrant holds a confirmed seat)
    const holdsSeat = SEAT_TAKEN.indexOf(r.status) >= 0;
    if (holdsSeat) {
      const s = roundSeats(toRound);
      if (s.full && !toRound.waitlist) return res.status(409).json({ ok: false, error: 'target_full' });
    }
    const fromRoundId = r.roundId;
    const oldFee = Number((r.payment && r.payment.fee) || r.fee || 0);
    const newFee = Number(toRound.fee != null ? toRound.fee : 500);
    const fromSnap = { roundId: r.roundId, roundNo: r.roundNo, date: (r.round && r.round.date) || '', mode: r.mode };
    // apply the move to the same record
    r.roundId = toRound.id; r.roundNo = toRound.no; r.roundCode = toRound.code; r.mode = toRound.mode || 'online';
    r.round = { date: toRound.date, venue: toRound.venue || '', mode: toRound.mode || 'online' };
    if (r.payment) r.payment.fee = newFee; else r.payment = { fee: newFee };
    const feeDiff = newFee - oldFee;
    r.changes = Array.isArray(r.changes) ? r.changes : [];
    r.changes.push({ at: Date.now(), from: fromSnap, to: { roundId: toRound.id, roundNo: toRound.no, date: toRound.date, mode: toRound.mode || 'online' }, reason: String(b.reason).trim(), feeDiff: feeDiff });
    r.movedAt = Date.now();
    writeReg(all);
    logAudit('move', 'registration', r.id, r.regNo, 'ครั้งที่ ' + fromSnap.roundNo + ' (' + fromSnap.mode + ')', 'ครั้งที่ ' + toRound.no + ' (' + (toRound.mode || 'online') + ')', String(b.reason).trim() + (feeDiff ? (' · ส่วนต่างค่าสมัคร ' + (feeDiff > 0 ? '+' : '') + feeDiff + ' บาท') : ''), 'staff');
    if (holdsSeat) promoteWaitlist(fromRoundId); // source seat may have freed up
    res.json({ ok: true, registration: r, feeDiff: feeDiff });
  });
  // admin: audit log (recent admin actions) — optional ?recordId / ?limit
  app.get('/api/xv/admin/audit', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    let list = readAudit().slice();
    if (req.query.recordId) list = list.filter(a => a.recordId === req.query.recordId);
    list.sort((a, b) => (b.at || 0) - (a.at || 0));
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
    res.json({ ok: true, audit: list.slice(0, limit) });
  });

  // validate + clean an imported {names,bank}; returns {clean} or {errs}
  const cleanImport = (body) => {
    const data = body && body.bank ? body : { names: {}, bank: (body && body.questions) || body };
    if (!data.bank || Object.keys(data.bank).length < 1) return { errs: ['expected {names,bank}'] };
    const errs = [];
    Object.keys(data.bank).forEach(p => {
      const arr = data.bank[p];
      if (!Array.isArray(arr) || !arr.length) { errs.push('part ' + p + ' empty'); return; }
      if (arr.length !== QPP) { errs.push('part ' + p + ' ต้องมี ' + QPP + ' ข้อพอดี (พบ ' + arr.length + ')'); return; }
      arr.forEach((it, i) => {
        if (!it || typeof it.q !== 'string' || !it.q.trim()) errs.push('part ' + p + ' q' + (i + 1) + ': missing question');
        else if (!Array.isArray(it.o) || it.o.length !== 4 || it.o.some(o => typeof o !== 'string' || !o.trim())) errs.push('part ' + p + ' q' + (i + 1) + ': need 4 options');
        else if (!(Number.isInteger(it.c) && it.c >= 0 && it.c < 4)) errs.push('part ' + p + ' q' + (i + 1) + ': bad answer index');
      });
    });
    if (errs.length) return { errs };
    const clean = { names: {}, bank: {} };
    Object.keys(data.names || {}).forEach(p => { clean.names[p] = String(data.names[p]).slice(0, 120); });
    Object.keys(data.bank).forEach(p => { clean.bank[p] = data.bank[p].map(it => ({ q: String(it.q), o: it.o.map(String), c: it.c | 0 })); });
    return { clean };
  };

  // legacy import → writes into the DEFAULT set (keeps old callers working)
  app.post('/api/xv/admin/import-questions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const r = cleanImport(req.body);
    if (r.errs) return res.status(400).json({ ok: false, error: 'invalid_bank', details: r.errs.slice(0, 10) });
    const sets = ensureSets(); const target = sets[0];
    if (target) { target.names = r.clean.names; target.bank = r.clean.bank; writeColl('qsets', sets); }
    else { const s = { id: genId(), no: 1, name: 'ชุดที่ 1 · ผู้เตรียมสอบเป็น X-Visor', names: r.clean.names, bank: r.clean.bank, createdAt: Date.now() }; writeColl('qsets', [s]); }
    res.json({ ok: true, parts: Object.keys(r.clean.bank).length, questions: Object.keys(r.clean.bank).reduce((a, p) => a + r.clean.bank[p].length, 0) });
  });

  // list all question SETS (no answer keys) — for the admin คลังข้อสอบ list
  app.get('/api/xv/admin/qsets', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    res.json({ ok: true, sets: ensureSets().map(pubSet) });
  });
  // one set's detail: parts with names, counts, and question TEXT (options included, answer keys stripped)
  app.get('/api/xv/admin/qsets/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const s = ensureSets().find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const parts = [1, 2, 3, 4, 5].map(p => {
      const arr = (s.bank && (s.bank[p] || s.bank[String(p)])) || [];
      return { part: p, name: (s.names && (s.names[p] || s.names[String(p)])) || ('พาร์ท ' + p), count: arr.length, questions: arr.map(it => ({ q: it.q, o: it.o })) };
    });
    res.json({ ok: true, id: s.id, no: s.no, name: s.name, total: setTotal(s), ready: setReady(s), parts });
  });
  // create a new (empty) set
  app.post('/api/xv/admin/qsets', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {}; const sets = ensureSets();
    const s = { id: genId(), no: nextSetNo(), name: String(b.name || ('ชุดที่ ' + nextSetNo())).slice(0, 120), names: {}, bank: {}, createdAt: Date.now() };
    sets.push(s); writeColl('qsets', sets);
    logAudit('qset_create', 'qset', s.id, s.name, null, 'created', '', 'staff');
    res.json({ ok: true, set: pubSet(s) });
  });
  // rename a set
  app.post('/api/xv/admin/qsets/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const sets = ensureSets(); const s = sets.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const b = req.body || {}; if (b.name != null) s.name = String(b.name).slice(0, 120);
    writeColl('qsets', sets); res.json({ ok: true, set: pubSet(s) });
  });
  // import questions INTO a specific set (replaces that set's bank)
  app.post('/api/xv/admin/qsets/:id/import', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const sets = ensureSets(); const s = sets.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const r = cleanImport(req.body);
    if (r.errs) return res.status(400).json({ ok: false, error: 'invalid_bank', details: r.errs.slice(0, 10) });
    s.names = r.clean.names; s.bank = r.clean.bank; writeColl('qsets', sets);
    logAudit('qset_import', 'qset', s.id, s.name, null, setTotal(s) + ' ข้อ', '', 'staff');
    res.json({ ok: true, set: pubSet(s) });
  });
  // delete a set (keep at least one; block if a round still uses it)
  app.delete('/api/xv/admin/qsets/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const sets = ensureSets(); const s = sets.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    if (sets.length <= 1) return res.status(400).json({ ok: false, error: 'need_one_set' });
    if (readR().some(r => r.setId === s.id)) return res.status(409).json({ ok: false, error: 'set_in_use' });
    writeColl('qsets', sets.filter(x => x.id !== s.id));
    logAudit('qset_delete', 'qset', s.id, s.name, s.name, 'deleted', '', 'staff');
    res.json({ ok: true });
  });

  // default-set counts (backward compatible with the old Exam Session bank panel)
  app.get('/api/xv/admin/questions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const B = bank(); res.json({ ok: true, names: B.names, counts: setCounts(B) });
  });

  console.log('[x-visor] exam API mounted');
};
