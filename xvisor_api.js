/* X-VISOR exam backend — file-store, server-side shuffle + scoring (keys never sent to client) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

module.exports = function (app, DATA, opts) {
  opts = opts || {};
  const isStaff = (req) => { try { return !!(opts.isStaff && opts.isStaff(req)); } catch (e) { return false; } };
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
  // รวมการเขียน Postgres: ยิงทีละครั้งต่อ collection และรวมคำตอบที่เข้ามาถี่ ๆ ใน 800ms เป็นการเขียนครั้งเดียว
  // (เดิมเขียนทั้งก้อนทุกคำตอบ → ช่วงทุกคนส่งพร้อมกันตอนหมดเวลา เซิร์ฟเวอร์ค้าง)
  const _pgBusy = {}, _pgAgain = {}, _pgTimer = {};
  const pgPersist = (coll) => {
    if (!pool || (typeof _xvDown !== 'undefined' && _xvDown)) return;
    if (_pgBusy[coll] || _pgTimer[coll]) { _pgAgain[coll] = true; return; }
    _pgTimer[coll] = setTimeout(() => {
      _pgTimer[coll] = null; _pgBusy[coll] = true; _pgAgain[coll] = false;
      let data; try { data = JSON.stringify(mem[coll]); } catch (e) { _pgBusy[coll] = false; return; }
      pool.query('INSERT INTO xv_store(coll,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(coll) DO UPDATE SET data=$2, updated_at=now()', [coll, data])
        .catch(e => console.error('[x-visor] PG persist ' + coll + ' failed:', e.message))
        .finally(() => { _pgBusy[coll] = false; if (_pgAgain[coll]) { _pgAgain[coll] = false; pgPersist(coll); } });
    }, 3000);   // เขียนทั้งก้อนไม่เกินทุก 3 วิ (ไฟล์บนดิสก์เป็นตัวสำรองอีกชั้น)
  };
  // hydrate the in-memory store from files at boot (PG mode overwrites this once PG is ready).
  // in-memory becomes the authoritative read source → GETs no longer re-read+parse the whole file each call.
  COLLS.forEach(c => {
    const f = fileOf[c];
    let d = rd(f, null);
    if (d === null && fs.existsSync(f)) {           // ไฟล์เสีย → อย่าเริ่มว่างเปล่าเงียบ ๆ: ลองไฟล์ชั่วคราว แล้วเก็บไฟล์เสียไว้ตรวจ
      const t = rd(f + '.tmp', null);
      try { fs.copyFileSync(f, f + '.corrupt-' + Date.now()); } catch (e) {}
      console.error('[x-visor] ' + c + ' file unreadable — ' + (t ? 'recovered from .tmp' : 'starting empty (backup kept)'));
      d = t;
    }
    mem[c] = Array.isArray(d) ? d : [];
  });
  const readColl = (coll) => mem[coll] || [];
  // durable file mirror — debounced & ASYNC so a burst of writes (e.g. answers) never blocks the event loop
  // with a synchronous full-file rewrite. Postgres (when on) is the primary durable store; file is the backup.
  const _fileDirty = {}, _fileTimer = {}, FILE_DEBOUNCE = 1200;
  // เขียนไฟล์แบบปลอดภัย: เขียนลงไฟล์ชั่วคราวก่อนแล้ว rename (กันไฟล์ครึ่ง ๆ กลาง ๆ ถ้าเขียนซ้อนกัน/เครื่องดับ) · ทีละครั้งต่อไฟล์
  const _fileBusy = {}; let _tmpN = 0;
  const tmpName = (f) => f + '.' + process.pid + '.' + (++_tmpN) + '.tmp';   // ชื่อไฟล์ชั่วคราวไม่ซ้ำกัน กันเขียนซ้อนทับกันเอง
  const writeFileAtomicSync = (f, data) => { const tmp = tmpName(f); fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };
  const flushColl = (coll) => {
    if (!_fileDirty[coll]) return;
    if (_fileBusy[coll]) { if (!_fileTimer[coll]) _fileTimer[coll] = setTimeout(() => { _fileTimer[coll] = null; flushColl(coll); }, 300); return; }
    _fileDirty[coll] = false; _fileBusy[coll] = true;
    const f = fileOf[coll], tmp = tmpName(f);
    let data; try { data = JSON.stringify(mem[coll]); } catch (e) { _fileBusy[coll] = false; _fileDirty[coll] = true; return; }
    fs.writeFile(tmp, data, (err) => {
      if (!err) { try { fs.renameSync(tmp, f); } catch (e) { _fileDirty[coll] = true; } }
      else { _fileDirty[coll] = true; try { fs.unlinkSync(tmp); } catch (e) {} }   // เขียนไม่สำเร็จ → ลองใหม่รอบถัดไป
      _fileBusy[coll] = false;
      if (_fileDirty[coll] && !_fileTimer[coll]) _fileTimer[coll] = setTimeout(() => { _fileTimer[coll] = null; flushColl(coll); }, 300);
    });
  };
  const flushAllColls = () => { COLLS.forEach(c => { if (_fileTimer[c]) { clearTimeout(_fileTimer[c]); _fileTimer[c] = null; } if (_fileDirty[c]) { _fileDirty[c] = false; try { writeFileAtomicSync(fileOf[c], JSON.stringify(mem[c])); } catch (e) {} } }); };
  // เขียนลงไฟล์ทันทีแบบ sync (ใช้ตอนต้องคงทนก่อนตอบ ok เช่น submit) — กันข้อมูลหายถ้า process ตายในหน้าต่าง debounce
  const flushCollSync = (coll) => { if (_fileTimer[coll]) { clearTimeout(_fileTimer[coll]); _fileTimer[coll] = null; } _fileDirty[coll] = false; try { writeFileAtomicSync(fileOf[coll], JSON.stringify(mem[coll])); } catch (e) {} };
  // เขียนลงไฟล์ภายใน 0.3 วิ: ถ้ามีรอบเขียนนัดไว้ช้ากว่านั้น เลื่อนให้เร็วขึ้น (ไม่เลื่อนออกไปอีก กันรอไม่จบตอนมีคนส่งถี่ ๆ)
  const _fileDue = {};
  const flushSoon = (coll) => { _fileDirty[coll] = true; const due = Date.now() + 300;
    if (_fileTimer[coll] && (_fileDue[coll] || Infinity) <= due) return;
    if (_fileTimer[coll]) clearTimeout(_fileTimer[coll]);
    _fileDue[coll] = due; _fileTimer[coll] = setTimeout(() => { _fileTimer[coll] = null; _fileDue[coll] = 0; flushColl(coll); }, 300); };
  const writeColl = (coll, all) => {
    mem[coll] = all;                           // authoritative in-memory (read-after-write stays consistent)
    if (pool && pgReady) pgPersist(coll);      // durable in Postgres (async, queued)
    _fileDirty[coll] = true;                    // durable file mirror — debounced + async (non-blocking)
    if (!_fileTimer[coll]) { _fileDue[coll] = Date.now() + FILE_DEBOUNCE; _fileTimer[coll] = setTimeout(() => { _fileTimer[coll] = null; _fileDue[coll] = 0; flushColl(coll); }, FILE_DEBOUNCE); }
  };
  // รีสตาร์ท/redeploy: เขียนข้อมูลลงไฟล์ทันที แล้วปิดตัวเองภายใน 2.5 วิ (เดิมไม่ปิด → เครื่องเก่ากับใหม่ทำงานซ้อนกันจนเขียนทับกัน)
  let _xvDown = false;
  const xvShutdown = () => {
    if (_xvDown) return; _xvDown = true;
    try { flushAllColls(); } catch (e) {}
    const jobs = [];
    if (pool) { COLLS.forEach(c => { if (_pgTimer[c]) { clearTimeout(_pgTimer[c]); _pgTimer[c] = null; }
      try { jobs.push(pool.query('INSERT INTO xv_store(coll,data,updated_at) VALUES($1,$2,now()) ON CONFLICT(coll) DO UPDATE SET data=$2, updated_at=now()', [c, JSON.stringify(mem[c])]).catch(() => {})); } catch (e) {} }); }
    const done = () => process.exit(0);
    Promise.all(jobs).then(() => setTimeout(done, 200), done); setTimeout(done, 2500);
  };
  process.on('SIGTERM', xvShutdown); process.on('SIGINT', xvShutdown); process.on('beforeExit', flushAllColls);
  // กัน crash แบบไม่ graceful (uncaught/rejection) แล้วคำตอบที่ตอบรับไปหาย — เขียนลงไฟล์ก่อนออก แล้วให้ตัว supervisor รีสตาร์ท
  process.on('uncaughtException', (e) => { try { flushAllColls(); } catch (_) {} console.error('[x-visor] uncaughtException:', e && (e.stack || e.message || e)); process.exit(1); });
  process.on('unhandledRejection', (e) => { try { flushAllColls(); } catch (_) {} console.error('[x-visor] unhandledRejection:', e && (e.message || e)); });
  // กวาดปิด session ที่หมดเวลาแต่ผู้สอบไม่ได้กดส่ง/ปิดแท็บไป — เดิมตัดเวลาเฉพาะตอนมี request จึงอาจค้าง in_progress ตลอดกาล
  setInterval(() => { if (_xvDown) return; try { const all = readS(); let changed = false; for (const s of all) { if (s && s.status === 'in_progress' && xvExpired(s)) { score(s, true); s.autoExpired = true; changed = true; } } if (changed) writeS(all); } catch (e) {} }, 45000);
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
            for (const f of (Array.isArray(fileData) ? fileData : [])) { if (f && f.id && !seen.has(f.id)) { data.push(f); seen.add(f.id); recovered++; } }
            for (const f of (mem[coll] || [])) { if (f && f.id && !seen.has(f.id)) { data.push(f); seen.add(f.id); recovered++; } }   // รายการที่สร้างระหว่างรอโหลด Postgres
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
    examType: (typeof examTypeOf === 'function') ? examTypeOf(r) : 'X-Visor',
    setId: r.setId || '', setName: (function () { if (!r.setId) return ''; const s = (readColl('qsets') || []).find(x => x.id === r.setId); return s ? s.name : ''; })(),
    examOpenedAt: r.examOpenedAt || null, examDeadlineAt: r.examDeadlineAt || null, examLiveToday: (typeof xvExamLive === 'function') ? xvExamLive(r) : false,
    examRemaining: (r.status === 'open' && r.examDeadlineAt) ? Math.max(0, Math.ceil((r.examDeadlineAt - Date.now()) / 1000)) : null
  }, roundSeats(r));
  // save a data-url image to disk, return its public path (or '' if none/invalid)
  const saveRegImage = (dataUrl, tag) => {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    let m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m && tag === 'slip') { const pm = dataUrl.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/); if (pm && Buffer.from(pm[1].slice(0, 8), 'base64').toString('latin1').indexOf('%PDF') === 0) m = [null, 'pdf', pm[1]]; }   // สลิปแบบ PDF (ตาม Figma)
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
      const amtOk = (sD.amount != null && !isNaN(sD.amount)) && Math.abs(sD.amount - fee) <= 1;
      const want = esDigits(process.env.EASYSLIP_RECV_ACCOUNT || '2311711191'); const last4 = want.slice(-4); const recvDigits = esDigits(sD.recvNum);
      const acctOk = !!(recvDigits && recvDigits.length >= 4 && want && (want.indexOf(recvDigits) >= 0 || recvDigits.indexOf(last4) >= 0));
      const esNorm = s => String(s || '').replace(/[\s().\-]/g, '').replace(/[​‎‏ ]/g, '').normalize('NFC');
      const rn = esNorm(sD.recvName); const nk = esNorm(process.env.EASYSLIP_RECV_NAME || 'โคลเวอร์เอ็กซ์'); const core = esNorm(process.env.EASYSLIP_RECV_NAMECORE || 'โคลเวอร์');
      const nameOk = !!(rn && ((nk && (rn.indexOf(nk) >= 0 || nk.indexOf(rn) >= 0)) || (core && rn.indexOf(core) >= 0)));
      const dup = !!(sD.ref && all.some(y => y.id !== x.id && y.easyslip && y.easyslip.ref && y.easyslip.ref === sD.ref));
      x.easyslip.amtOk = amtOk; x.easyslip.acctOk = acctOk; x.easyslip.nameOk = nameOk; x.easyslip.dup = dup;
      const pass = amtOk && acctOk && !dup;   // ต้องเป็นบัญชีรับเงินของบริษัท (ชื่อคล้าย "โคลเวอร์" อย่างเดียวไม่พอ)
      const wasConfirmed = SEAT_TAKEN.indexOf(x.status) >= 0;
      const rd0 = findR(x.roundId); const seatsNow = rd0 ? roundSeats(rd0) : { full: false };
      if (pass && x.status === 'PAYMENT_REVIEW' && !seatsNow.full && process.env.EASYSLIP_AUTOCONFIRM !== '0') { x.status = 'CONFIRMED'; x.confirmedAt = Date.now(); x.easyslip.result = 'confirmed'; }
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
    if (isStaff(req)) return true;   // พนักงานที่ล็อกอินแล้ว ทำรายการได้เสมอ (ไม่ต้องใส่คีย์)
    const need = process.env.ADMIN_KEY || '';
    if (!need) return isStaff(req);   // ยังไม่ตั้งคีย์ → อนุญาตเฉพาะพนักงานที่ล็อกอิน (หน้า Operations) ไม่เปิดให้คนนอก
    const ip = xvClientIp(req), now = Date.now(); let f = _xvFail[ip];
    if (f && f.until > now) return false;   // โดนล็อกชั่วคราวจากการเดาคีย์ผิดถี่
    const k = (req.query && req.query.key) || (req.body && req.body.key) || req.headers['x-admin-key'] || '';
    if (k && k === need) { if (_xvFail[ip]) _xvFail[ip].n = 0; return true; }
    f = _xvFail[ip] || { n: 0, until: 0 }; f.n++; if (f.n >= 8) { f.until = now + 600000; f.n = 0; } _xvFail[ip] = f;
    return false;
  };
  // ป้องกันทุก POST ใต้ /api/xv/admin (การแก้ไข/ยืนยัน/รอบสอบ/นำเข้าข้อสอบ ฯลฯ) — GET (อ่าน) ปล่อยผ่าน
  app.use('/api/xv/admin', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !adminWrite(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    // การอ่านข้อมูลหลังบ้าน (มีเลขบัตร ปชช. / สลิป / รูปบัตร) ต้องเป็นพนักงานที่ล็อกอิน หรือมี ADMIN_KEY (PDPA)
    if ((req.method === 'GET' || req.method === 'HEAD') && !readOk(req)) return res.status(403).json({ ok: false, error: 'staff_login_required' });
    next();
  });
  function readOk(req) {
    if (isStaff(req)) return true;
    const need = process.env.ADMIN_KEY || ''; if (!need) return false;
    const k = (req.query && req.query.key) || req.headers['x-admin-key'] || '';
    return !!k && k === need;
  }
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
  // ประเภทข้อสอบ: X-Lead (สอบเลื่อนระดับ) หรือ X-Visor — ดูจากหัวข้อรอบ + ชื่อชุดข้อสอบ (ตรรกะเดียวกับหลังบ้าน)
  const examTypeOf = (round) => {
    if (!round) return 'X-Visor';
    let setName = '';
    try { if (round.setId) { const st = getSet(round.setId); setName = (st && st.name) || ''; } } catch (e) {}
    const t = ((round.topic || '') + ' ' + setName).toLowerCase();
    return /x[\s-]?lead/.test(t) ? 'X-Lead' : 'X-Visor';
  };
  const sessExamType = (s) => (s && s.examType) || (s && examTypeOf(findR(s.roundId))) || 'X-Visor';

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
    // หมดเวลา (กติกา CloverX 23 ก.ย. 2569):
    //  - รอบแรกหมดเวลา → ส่งคำตอบที่ทำไว้ (ข้อที่ไม่ตอบ = ผิด) แล้วพาร์ตที่ไม่ผ่านไปสอบซ่อมตามสิทธิ์
    //  - สอบซ่อม (รวมรอบพิเศษ) หมดเวลาแล้วยังมีพาร์ตไม่ผ่าน → หมดสิทธิ์สอบทันที แม้สิทธิ์ซ่อมยังเหลือ
    else if (expired && s.phase === 'remedial') { s.status = 'ended_failed'; s.timedOut = true; s.remedialQueue = []; s.remedialActive = null; }
    else { s.status = 'remedial_required'; s.remedialQueue = failed.map(r => r.part).sort((a, b) => a - b); s.remedialActive = null; }
    if (expired) s.timedOut = true;
    s.paused = false;
    s.submittedAt = Date.now();
    // บันทึกประวัติการส่งรายครั้ง (สำหรับรายงาน "ประวัติรายครั้ง") — 1 record ต่อการส่ง 1 ครั้ง
    try {
      s.attemptLog = s.attemptLog || [];
      const kind = (s.phase === 'remedial') ? (s.reopenPending ? 'special' : 'remedial') : 'first';
      const ev = { at: Date.now(), kind: kind, no: (s.attemptLog || []).filter(e => e.kind === kind).length + 1, parts: parts.slice(), perPart: {}, wrong: {}, pauseUsed: s.pauseUsed || 0, scoreEdited: false, expired: !!expired };
      if (kind === 'special') { ev.reason = s.reopenReason || ''; ev.by = s.reopenedBy || 'staff'; }
      s.reopenPending = false;
      let evTot = 0; parts.forEach(p => { const rr = s.results.find(x => x.part === p); const sc = rr ? (rr.score || 0) : 0; ev.perPart[p] = sc; ev.wrong[p] = rr ? (rr.wrongIds || []).slice() : []; evTot += sc; });
      ev.total = evTot; ev.full = parts.length * QPP; ev.pass = parts.every(p => (ev.perPart[p] || 0) >= PASS);
      ev.remedialAfter = (s.remedialQueue || []).slice();
      s.attemptLog.push(ev);
    } catch (e) {}
  }
  const pubAttempts = (s) => (s.attemptLog || []).filter(e => e.kind !== 'reopen').map(e => ({ kind: e.kind, no: e.no || null, at: e.at, parts: (e.parts || []).slice(), perPart: e.perPart || {}, total: e.total, full: e.full, pass: !!e.pass, forced: !!e.forced, expired: !!e.expired }));
  const pubResults = (s) => s.results.map(r => ({ part: r.part, score: r.score, status: r.status, attempts: r.attempts }));

  // live progress ของผู้ที่กำลังสอบ (in_progress) — คำนวณจากคำตอบที่ส่งมาแล้วเทียบกับเฉลยฝั่งเซิร์ฟเวอร์
  // ส่งออกเฉพาะ "จำนวน" (ตอบแล้ว/ถูก/ผิด ต่อพาร์ท + รวม + พาร์ท/ข้อปัจจุบัน) ไม่ส่งเฉลยหรือความถูก-ผิดรายข้อ
  function xvLiveProgress(s) {
    const activeP = activeParts(s);
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
  const XV_GRACE_MS = 30000; // เผื่อความหน่วงเครือข่าย 10 วินาที ก่อนตัดเวลาจริง
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
  const xvPh9 = (v) => { const d = xvDigits(v); return d.length > 9 ? d.slice(-9) : d; };   // 081… กับ +6681… = คนเดียวกัน
  const xvBkkDate = (ms) => new Date((ms || Date.now()) + 7 * 3600 * 1000).toISOString().slice(0, 10);
  // ห้องสอบเปิดจริง = ทีมงานกด "เปิดสอบ/เริ่มจับเวลา" ในวันนี้ (เวลาไทย)
  // (สถานะ open อย่างเดียวแปลว่า "เปิดรับสมัคร" ได้ด้วย — ถ้าเปิดไว้ตั้งแต่ก่อนวันสอบ นาฬิกาห้องจะหมดไปแล้ว ผู้สอบเข้าไม่ได้)
  const xvExamLive = (r) => !!(r && r.status === 'open' && r.examOpenedAt && xvBkkDate(r.examOpenedAt) === xvBkkDate());
  const xvFinishedPayload = (s) => ({ ok: false, error: 'already_taken', attempts: pubAttempts(s), roundCode: (findR(s.roundId) || {}).code || '', status: s.status, sessionId: s.id, token: s.token, code: s.code, mode: (s.candidate || {}).mode, phase: s.phase, results: pubResults(s), remedialQueue: s.remedialQueue || [], staffVerified: !!s.staffVerified && s.status !== 'disqualified', examType: sessExamType(s) });

  /* ---------------- candidate endpoints ---------------- */
  app.post('/api/xv/start', (req, res) => {
    const b = req.body || {};
    if (!b.firstName || !b.lastName || !b.phone) return res.status(400).json({ ok: false, error: 'missing_fields' });
    // resolve round (accept roundId or round code); gate closed rounds
    let round = null;
    if (b.roundId) round = findR(b.roundId);
    if (!round && b.roundCode) round = findRByCode(b.roundCode);
    if (!round) return res.status(400).json({ ok: false, error: 'no_round' });   // ต้องเข้าจากลิงก์/QR ของรอบเท่านั้น
    const all = readS();
    // กันเปิดสอบซ้ำ/หลาย session ต่อคนต่อรอบ — ตรวจ "ก่อน" สถานะรอบ เพื่อให้คนที่สอบค้าง/สอบจบแล้วกลับเข้าหน้าเดิมได้เสมอ
    if (round) {
      const ph = xvPh9(b.phone);
      const prev = ph ? all.filter(x => x.roundId === round.id && xvPh9((x.candidate || {}).phone) === ph).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null;
      if (prev) {
        xvAutoExpire(prev); // เผื่อ session เดิมหมดเวลาไปแล้ว
        if (prev.status === 'in_progress') {
          // มี session ค้างอยู่ → กลับเข้าสอบเดิม (กัน refresh แล้วรีเซ็ตเวลา/สร้างชุดใหม่)
          const rp = activeParts(prev);
          writeS(all);
          return res.json({
            ok: true, resumed: true, sessionId: prev.id, token: prev.token, code: prev.code,
            mode: prev.candidate.mode, phase: prev.phase, parts: rp, durationSec: TOTAL,
            remaining: xvRemaining(prev), answers: prev.answers || {}, paper: clientPaper(prev.paper, rp),
            examType: sessExamType(prev)
          });
        }
        // สอบจบไปแล้ว (รอตรวจ/ผ่าน/ต้องสอบซ่อม/ตก/ตัดสิทธิ์) → ห้ามสอบซ้ำในรอบเดิม แต่ส่งข้อมูล session เดิมกลับไป
        // ให้หน้าเว็บพาไปหน้าที่ถูกต้อง (ผลสอบ / สอบซ่อม / รอยืนยัน) แทนการติดล็อก "สอบไปแล้ว"
        writeS(all);
        return res.status(409).json(xvFinishedPayload(prev));
      }
    }
    if (round.status !== 'open') return res.status(403).json({ ok: false, error: 'round_closed' });
    if (!xvExamLive(round)) return res.status(403).json({ ok: false, error: 'not_started' });
    // pick the question set assigned to this round (falls back to the default/first set)
    const B = getSet(round ? round.setId : null);
    if (!B.bank || Object.keys(B.bank).length < 5) return res.status(400).json({ ok: false, error: 'no_questions' });
    const paper = buildPaper(B, PARTS);
    const now = Date.now();
    // นาฬิการวมของห้อง (รอบสอบแรก): เวลาผูกกับ "รอบ" — เริ่มนับตั้งแต่ทีมงานกดเปิดสอบ ทุกคนหมดเวลาพร้อมกัน
    // คนเข้าสอบสายจะเหลือเวลาน้อยกว่า 120 นาที · ถ้ารอบยังไม่ตั้งนาฬิกา (รอบเก่า) fallback = 120 นาทีต่อคน
    const roomDeadline = (round && round.examDeadlineAt) ? round.examDeadlineAt : null;
    if (roomDeadline && now > roomDeadline - 60000) return res.status(403).json({ ok: false, error: 'exam_time_ended' });   // เหลือไม่ถึง 1 นาที ไม่ให้เริ่ม (กันได้ 0 วินาทีแล้วตกทันที)
    const deadlineAt = roomDeadline || (now + TOTAL * 1000);
    const remainSec = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
    const s = {
      id: genId(), token: crypto.randomBytes(12).toString('hex'),
      // โหมดสอบยึดจาก "รอบ" ฝั่งเซิร์ฟเวอร์เสมอ (กันผู้สอบปลอม mode:onsite บนรอบออนไลน์ เพื่อข้ามการตรวจ/หยุดเวลา) — ถ้าไม่มีรอบจึงค่อย fallback body
      candidate: { firstName: String(b.firstName).slice(0, 60), lastName: String(b.lastName).slice(0, 60), phone: String(b.phone).slice(0, 30), mode: (round && (round.mode === 'onsite' || round.mode === 'online')) ? round.mode : (b.mode === 'onsite' ? 'onsite' : 'online') },
      code: (function () { let c; do { c = 'XV' + String(100000 + crypto.randomInt(900000)); } while (all.some(x => x.code === c)); return c; })(),
      setId: B.id || null,
      roundId: round ? round.id : null, roundNo: round ? round.no : null,
      phase: 'first', paper, answers: {}, results: [], status: 'in_progress',
      startedAt: now, deadlineAt: deadlineAt, roomClock: !!roomDeadline, paused: false, pausedAt: null,
      remaining: remainSec, pauseUsed: 0, staffVerified: false, createdAt: now,
      examType: round ? examTypeOf(round) : 'X-Visor'
    };
    all.push(s); writeS(all);
    res.json({ ok: true, sessionId: s.id, token: s.token, code: s.code, mode: s.candidate.mode, phase: 'first', parts: PARTS, durationSec: remainSec, paper: clientPaper(paper, PARTS), examType: s.examType });
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
    if (xvExpired(s)) return res.json({ ok: false, expired: true, status: s.status, remaining: 0 }); // ไม่ตัดคะแนนที่นี่ — ให้ /submit รวมคำตอบชุดเต็มก่อน (ตัวกวาด 45 วิ ตัดให้ถ้าไม่มีใครส่ง)
    // ตรวจขอบเขต part/q ให้ตรงกับตอน submit (mergeAnswers) — กันเขียนคีย์นอกพาร์ต/นอกช่วง และกันคำตอบ phase เก่ารั่วข้ามรอบ
    if (b.part != null && b.q != null && (b.choice === null || (b.choice >= 0 && b.choice < 4))) {
      const _p = +b.part, _q = +b.q;
      if (activeParts(s).indexOf(_p) >= 0 && _q >= 0 && _q < QPP) s.answers[_p + '-' + _q] = b.choice;
    }
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
      // รวมคำตอบชุดเต็ม "ก่อน" คิดเรื่องหมดเวลาเสมอ — เพื่อกู้ข้อที่ตอบแล้วแต่ยังซิงก์ไม่ทัน (เน็ตช้า+ใกล้หมดเวลา)
      // การ merge ไม่ทำให้ได้เวลาเพิ่ม (แค่ยืนยันคำตอบที่เลือกไว้แล้ว) และ mergeAnswers ตรวจ scope/range อยู่แล้ว จึงปลอดภัยแม้หมดเวลา
      if (Date.now() <= xvDeadline(s) + XV_GRACE_MS) mergeAnswers(s, b.answers);   // รับคำตอบที่ค้างส่งได้ไม่เกินช่วงผ่อนผัน 30 วิ
      // ส่งตอนหมดเวลา (หน้าเว็บส่งให้เองเมื่อเวลาเหลือ 0) = นับเป็นหมดเวลา ตามกติกา "หมดเวลาแล้วยังมีพาร์ทไม่ผ่าน = ไม่ผ่าน"
      // ช่วงผ่อนผัน 30 วิ มีไว้รับคำตอบที่ส่งช้าเพราะเน็ตเท่านั้น ไม่ได้ให้เวลาสอบเพิ่ม
      const expired = xvExpired(s) || (!s.paused && Date.now() >= xvDeadline(s) - 1000);
      score(s, expired); writeS(all);
      flushSoon('sessions'); // เขียนลงไฟล์ภายใน ~0.3 วิ (เดิมเขียนทั้งไฟล์แบบ sync ทุกครั้ง → ตอนทุกคนส่งพร้อมกัน เซิร์ฟเวอร์ค้างเป็นสิบวินาที)
    }
    res.json({ ok: true, status: s.status, results: pubResults(s), attempts: pubAttempts(s), remedialQueue: s.remedialQueue || [], total: s.results.reduce((a, r) => a + (r.score || 0), 0), examType: sessExamType(s) });
  });

  // ทีมงานบังคับตรวจคะแนน (เผื่อลูกค้าทำครบแต่กดส่งไม่ได้) — ตรวจคำตอบที่มีตอนนี้เหมือนลูกค้ากดส่งเอง
  // ข้อที่ยังไม่ตอบ = ผิด · ผ่าน=ผ่าน · ตกบางพาร์ต=เข้าสอบซ่อมตาม logic ปกติ · ไม่ถือว่าหมดเวลา
  app.post('/api/xv/admin/session/:id/force-grade', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {}; const all = readS(); const s = all.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: 'not_found' });
    if (s.status !== 'in_progress') return res.status(409).json({ ok: false, error: 'not_in_progress', status: s.status });
    if (!String(b.reason || '').trim()) return res.status(400).json({ ok: false, error: 'reason_required' });
    const before = s.status;
    // พาร์ตที่ทีมงานเลือกตรวจ (บันทึกไว้ตรวจสอบย้อนหลัง) — การให้คะแนนใช้ตัวตรวจปกติ: ตรวจทุกพาร์ตในขอบเขตจากคำตอบที่มี
    // (ข้อไม่ตอบ = ผิด) แล้วจบการสอบทันที · พาร์ตที่ไม่ได้ทำจึงนับเป็นไม่ผ่าน เข้าสู่ผ่าน/ซ่อมตาม logic ปกติ
    const active = activeParts(s);
    let sel = Array.isArray(b.parts) ? b.parts.map(Number).filter(p => active.indexOf(p) >= 0) : active.slice();
    if (!sel.length) sel = active.slice();
    score(s, false);
    s.forcedGrade = { by: String(b.actor || 'staff').slice(0, 60), at: Date.now(), parts: sel, reason: String(b.reason || '').slice(0, 200) };
    const lastEv = (s.attemptLog || [])[(s.attemptLog || []).length - 1]; if (lastEv) { lastEv.forced = true; lastEv.reason = s.forcedGrade.reason; lastEv.by = s.forcedGrade.by; }
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
    res.json({ ok: true, parts: sel, durationSec: TOTAL, paper: clientPaper(s.paper, sel), examType: sessExamType(s) });
  });

  app.get('/api/xv/session/:id', (req, res) => {
    const all = readS(); const s = findS(all, req.params.id, req.query.token);
    if (!s) return res.status(404).json({ ok: false });
    // ถ้าหมดเวลาแต่ยังไม่ได้ส่ง (เช่นปิดแท็บทิ้งไว้) → ตัดข้อสอบอัตโนมัติเมื่อมีการเรียกดู
    if (xvAutoExpire(s)) writeS(all);
    const parts = activeParts(s);
    const out = { ok: true, attempts: pubAttempts(s), roundCode: (findR(s.roundId) || {}).code || '', mode: s.candidate.mode, phase: s.phase, status: s.status, parts, remaining: (s.status === 'in_progress' ? xvRemaining(s) : (s.remaining || 0)), pauseUsed: s.pauseUsed, results: pubResults(s), remedialQueue: s.remedialQueue || [], staffVerified: !!s.staffVerified && s.status !== 'disqualified', examType: sessExamType(s) };
    if (req.query.lite !== '1') { out.answers = s.answers; out.paper = clientPaper(s.paper, parts); }   // โพลระหว่างสอบใช้ lite=1 (ไม่ต้องส่งข้อสอบ 100 ข้อทุก 6 วิ)
    res.json(out);
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
    if (!s.staffVerified || s.status === 'disqualified') return res.json({ ok: false, error: 'not_verified' });
    res.json({ ok: true, results: s.results.map(r => ({ part: r.part, score: r.score, wrongIds: r.wrongIds || [], questions: (r.wrongIds || []).map(n => s.paper[r.part][n - 1].q) })) });
  });

  // public: resolve a round by code (for the candidate share link) — no keys/PII
  app.get('/api/xv/round/:code', (req, res) => {
    const r = findRByCode(req.params.code);
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, round: { id: r.id, code: r.code, no: r.no, date: r.date, topic: r.topic, status: r.status, open: xvExamLive(r), regOpen: r.status === 'open', mode: r.mode || 'online', venue: r.venue || '', timeslot: r.timeslot || '', examType: examTypeOf(r) } });
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
      if (byKey[k]) { Object.assign(byKey[k], entry); updated++; } else { entry.id = 'rst' + genId(); byKey[k] = entry; cur.push(entry); added++; } // มี id ให้ roster เพื่อให้ crash-recovery (file→PG) กู้แถวได้
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
    if (d === 'disqualified') { s.statusBeforeDq = s.status; s.status = 'disqualified'; s.proctorDecision = 'disqualified'; s.disqualifiedAt = Date.now(); s.staffVerified = false; }
    else if (d === 'normal') { if (s.status === 'disqualified') { s.status = s.statusBeforeDq || 'ended_failed'; if (s.status === 'verified' || s.status === 'submitted') s.staffVerified = true; s.undoDqAt = Date.now(); } s.proctorDecision = 'normal'; }
    else return res.status(400).json({ ok: false, error: 'bad_decision' });
    writeS(all);
    logAudit(d === 'disqualified' ? 'disqualify' : 'proctor_normal', 'session', s.id, s.code || '', null, s.status, d === 'disqualified' ? 'ทีมงานยุติการสอบ (ตัดสิทธิ์)' : 'ทีมงานตัดสินว่าปกติ', String((req.body && req.body.actor) || 'staff').slice(0, 60));
    res.json({ ok: true, status: s.status });
  });

  // สรุปผลรอบ: คนที่หมดเวลาแล้วแต่ยังค้าง "กำลังสอบ" → ตรวจคะแนนให้ · คนที่ "ต้องสอบซ่อม" แต่ไม่ได้สอบซ่อม → ไม่ผ่าน (เปิดรอบพิเศษให้ภายหลังได้)
  app.post('/api/xv/admin/rounds/:id/finalize', (req, res) => {
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 200);
    if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });
    const actor = String((req.body && req.body.actor) || 'staff').slice(0, 60);
    const all = readS(); let graded = 0, closed = 0, still = 0; const now = Date.now();
    all.forEach(s => {
      if (s.roundId !== req.params.id) return;
      if (s.status === 'in_progress') {
        if (now > xvDeadline(s)) { score(s, true); s.autoExpired = true; s.finalizedBy = actor; graded++;
          if (s.status === 'remedial_required') { s.status = 'ended_failed'; s.remedialQueue = []; s.finalizedAt = now; s.finalizeReason = reason; closed++; } }
        else still++;
      } else if (s.status === 'remedial_required') {
        s.status = 'ended_failed'; s.remedialQueue = []; s.finalizedBy = actor; s.finalizedAt = now; s.finalizeReason = reason; closed++;
      }
    });
    writeS(all);
    logAudit('round_finalize', 'round', req.params.id, '', null, null, 'สรุปผลรอบ: ตรวจคะแนน ' + graded + ' คน, ปิดคนไม่สอบซ่อม ' + closed + ' คน · ' + reason, actor);
    res.json({ ok: true, graded, closed, stillInExam: still });
  });

  // ยืนยันผลหลายคนพร้อมกัน (สอบออนไลน์ที่ผ่านครบและรอยืนยัน)
  app.post('/api/xv/admin/sessions/verify-bulk', (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ ok: false, error: 'no_ids' });
    const all = readS(); let n = 0; const now = Date.now();
    all.forEach(s => { if (ids.indexOf(s.id) >= 0 && s.status === 'awaiting_verify') { s.staffVerified = true; s.status = 'verified'; s.verifiedAt = now; n++; } });
    writeS(all); logAudit('verify_bulk', 'session', '', '', null, 'verified', 'ยืนยันผลพร้อมกัน ' + n + ' รายการ', String((req.body && req.body.actor) || 'staff').slice(0, 60));
    res.json({ ok: true, verified: n });
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
    PARTS.forEach(p => { if (!s.results.find(r => r.part === p)) s.results.push({ part: p, score: 0, attempts: 1, status: 'failed', wrongIds: [] }); });   // พาร์ตที่ยังไม่มีคะแนน = ไม่ผ่าน
    s.results.sort((a, b) => a.part - b.part);
    if (s.status === 'disqualified') { s.proctorDecision = 'normal'; s.dqLiftedBy = actor; s.dqLiftedAt = Date.now(); }   // ทีมงานแก้คะแนนคนที่ถูกตัดสิทธิ์ = ยกเลิกการตัดสิทธิ์ (มีเหตุผลกำกับ)
    // คำนวณสถานะรวมใหม่ (ตามตรรกะ score() แต่ไม่เพิ่มจำนวนครั้งสอบ/ไม่ยุ่งกับนาฬิกา)
    const failed = s.results.filter(r => r.status === 'failed');
    const exhausted = failed.filter(r => (r.attempts || 1) >= MAXATT);
    if (exhausted.length) s.status = 'ended_failed';
    else if (failed.length === 0) {
      if (s.candidate && s.candidate.mode === 'onsite') { s.status = 'submitted'; s.staffVerified = true; if (!s.verifiedAt) s.verifiedAt = Date.now(); }
      else if (before.status === 'verified') { s.status = 'verified'; }   // ออนไลน์ที่ปล่อยผลแล้ว → คงสถานะผ่าน
      else { s.status = 'awaiting_verify'; }
    } else { s.status = 'remedial_required'; s.remedialQueue = failed.map(r => r.part).sort((a, b) => a - b); }
    if (s.status !== 'verified' && s.status !== 'submitted') s.staffVerified = false;
    s.scoreEdited = true; s.scoreEditedAt = Date.now(); s.scoreEditedBy = actor; s.scoreEditReason = reason;
    try {
      s.attemptLog = s.attemptLog || [];
      const parts = edits.map(e => parseInt(e.part, 10)).filter(p => p >= 1 && p <= PARTS.length);
      const ev = { at: Date.now(), kind: 'edit', no: (s.attemptLog || []).filter(e => e.kind === 'edit').length + 1, parts: parts.slice(), perPart: {}, pauseUsed: s.pauseUsed || 0, scoreEdited: true, reason: reason, by: actor, fromStatus: before.status };
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
    if (s.status === 'in_progress') return res.status(409).json({ ok: false, error: 'in_progress' });   // กำลังสอบอยู่: ให้ตรวจคะแนนก่อน
    if (!String(b.reason || '').trim()) return res.status(400).json({ ok: false, error: 'reason_required' });
    // พาร์ตที่ "ไม่ผ่าน" (คะแนน < เกณฑ์) และยังไม่หมดสิทธิ์ (ทำมาแล้วน้อยกว่า MAXATT ครั้ง)
    // ทีมงาน (admin) เปิดพาร์ตที่ "ไม่ผ่าน" ให้ทำใหม่ได้ — รวมกรณีใช้สิทธิ์ซ่อมครบแล้ว (เผื่อระบบมีปัญหา/คำตอบไม่ถูกบันทึก) · admin-only + บันทึก audit
    const failedParts = PARTS.filter(p => { const r = (s.results || []).find(x => x.part === p); return !r || (r.score || 0) < PASS; });   // รวมพาร์ตที่ยังไม่มีคะแนน (เช่น ถูกตัดสิทธิ์กลางคัน)
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
    s.reopenPending = true; s.reopenReason = reason; s.staffVerified = false;
    if (before === 'disqualified') { s.proctorDecision = 'normal'; s.dqLiftedBy = s.reopenedBy; s.dqLiftedAt = now; }
    s.attemptLog = s.attemptLog || []; s.attemptLog.push({ at: now, kind: 'reopen', parts: sel.slice(), reason: reason, by: s.reopenedBy, fromStatus: before });
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
    // สร้างรอบแบบเปิดสอบทันที = เริ่มนาฬิกาสอบ 120 นาทีตอนสร้าง (แบบเดิม) · นาฬิกาสอบเริ่มเมื่อทีมงานกด "เริ่มจับเวลาสอบ" ในวันสอบ
    if (b.startClock) r.status = 'open';
    if (r.status === 'open' && (b.startClock || !r.date || r.date === xvBkkDate())) { r.examOpenedAt = Date.now(); r.examDeadlineAt = r.examOpenedAt + TOTAL * 1000; }   // เปิดรอบของวันนี้ = เริ่มจับเวลา (รอบวันอื่น = เปิดรับสมัครเฉย ๆ)
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
    // กดเปิดสอบ (closed → open) หรือกด "เริ่มจับเวลาสอบ" (startClock ตอนรอบเปิดรับสมัครอยู่แล้ว) = เริ่มนาฬิการวมของห้อง 120 นาที
    if (b.startClock) r.status = 'open';
    if (r.status === 'open' && (b.startClock || (!wasOpen && b.status === 'open' && (!r.date || r.date === xvBkkDate())))) {   // กดเปิดสอบ = เริ่มจับเวลาทันที (แบบเดิม)
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
    logAudit('round_update', 'round', r.id, 'ครั้งที่ ' + r.no, null, r.status, ((b.startClock || (!wasOpen && b.status === 'open' && (!r.date || r.date === xvBkkDate()))) ? 'เปิดสอบ (เริ่มจับเวลา)' : (b.status === 'open') ? 'เปิดรอบ' : (b.status === 'closed' ? 'ปิดสอบ' : 'แก้ไขข้อมูลรอบ')), 'staff');
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
  // รับสมัครได้เมื่อรอบเปิด + ยังไม่เลยวันปิดรับ (เวลาไทย) + ยังไม่ถึงเวลาเริ่มสอบของวันสอบ
  const regOpenForReg = (r) => {
    if (r.status !== 'open') return false;
    const now = bkkNow();
    if (r.regCloseAt && now.date > r.regCloseAt) return false;
    if (r.date && (now.date > r.date || (now.date === r.date && now.min >= roundStartMin(r)))) return false;
    return true;
  };
  const phEq = (a, b) => { const x = xvPh9(a), y = xvPh9(b); return x.length >= 9 && x === y; };   // 081… = +6681… = 81…
  // public: rounds available to register for (optionally filtered by mode)
  app.get('/api/xv/reg/rounds', (req, res) => {
    const mode = req.query.mode === 'onsite' ? 'onsite' : (req.query.mode === 'online' ? 'online' : null);
    const list = readR().filter(r => regOpenForReg(r) && (!mode || (r.mode || 'online') === mode))
      .map(pubRound).sort((a, b) => (a.date < b.date ? -1 : 1));
    res.json({ ok: true, rounds: list });
  });
  // serve an uploaded slip / id-card image
  app.get('/api/xv/reg/file/:fn', (req, res) => {
    if (!readOk(req)) return res.status(403).end();
    res.set('Cache-Control', 'private, no-store');
    const fn = path.basename(String(req.params.fn));
    const p = path.join(REGUP, fn);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });
  // public: create a registration
  app.post('/api/xv/register', (req, res) => {
    const b = req.body || {};
    const need = ['firstName', 'lastName', 'phone', 'email', 'roundId'];   // เลขบัตรไม่บังคับ (ฟอร์มใหม่ตาม Figma)
    // X-Lead: ผู้ที่เคยสมัคร X-Visor ไม่ต้องกรอกซ้ำ — เติมชื่อ/อีเมลจากใบสมัครเดิมด้วยเบอร์โทร
    if (!b.firstName || !b.lastName || !b.email) {
      const prevReg = findPrevByPhone(b.phone);
      if (prevReg) { const c = prevReg.candidate || {}; b.firstName = b.firstName || c.firstName; b.lastName = b.lastName || c.lastName; b.email = b.email || c.email;
        if (!b.nationalId && c.nationalId) b.nationalId = c.nationalId; }
    }
    for (const k of need) if (!b[k] || !String(b[k]).trim()) return res.status(400).json({ ok: false, error: 'missing_' + k });
    if (b.nationalId && !/^\d{13}$/.test(String(b.nationalId).replace(/\D/g, ''))) return res.status(400).json({ ok: false, error: 'bad_national_id' });
    if (!b.consentTerms || !b.consentPdpa) return res.status(400).json({ ok: false, error: 'consent_required' });
    const round = findR(b.roundId);
    if (!round) return res.status(404).json({ ok: false, error: 'round_not_found' });
    if (!regOpenForReg(round)) return res.status(403).json({ ok: false, error: 'round_closed' });
    const nid = String(b.nationalId || '').replace(/\D/g, '');
    if (xvPh9(b.phone).length < 9) return res.status(400).json({ ok: false, error: 'bad_phone' });
    const all = readReg();
    // duplicate guard: เบอร์เดียวกัน (หรือเลขบัตรเดียวกัน) ในรอบเดียวกัน ที่ยังไม่ยกเลิก → ส่งเลขที่เดิมกลับไป (กันเน็ตหลุดแล้วกดซ้ำหาเลขไม่เจอ)
    const dupReg = all.find(x => x.candidate && x.roundId === round.id && ['CANCELLED', 'REJECTED', 'REFUNDED'].indexOf(x.status) < 0 && (phEq(x.candidate.phone, b.phone) || (nid && x.candidate.nationalId === nid)));
    if (dupReg) {
      const sameEmail = String((dupReg.candidate || {}).email || '').trim().toLowerCase() === String(b.email || '').trim().toLowerCase();
      if (!sameEmail) return res.status(409).json({ ok: false, error: 'already_registered' });
      return res.status(409).json({ ok: false, error: 'already_registered', regNo: dupReg.regNo, status: dupReg.status, mode: dupReg.mode, round: { no: round.no, date: round.date, mode: round.mode, venue: round.venue, timeslot: round.timeslot } });
    }
    // capacity guard (re-read fresh)
    const seats = roundSeats(round);
    if (seats.full) {
      if (!round.waitlist) return res.status(409).json({ ok: false, error: 'round_full' });
    }
    const slipUrl = saveRegImage(b.slipImage, 'slip');
    const idCardUrl = saveRegImage(b.idCardImage, 'idcard');
    if (slipUrl === 'TOO_BIG' || idCardUrl === 'TOO_BIG') return res.status(400).json({ ok: false, error: 'image_too_big' });
    if (b.slipImage && !slipUrl) return res.status(400).json({ ok: false, error: 'bad_slip_format' });   // เช่น HEIC ที่เบราว์เซอร์แปลงไม่ได้ — อย่ารับใบสมัครโดยไม่มีสลิป
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
  // หาใบสมัครล่าสุดของเบอร์นี้ (ใช้เติมข้อมูลตอนสมัคร X-Lead)
  function findPrevByPhone(phone) {
    if (xvPh9(phone).length < 9) return null;
    const rank = (x) => (PAID_ST.indexOf(x.status) >= 0 ? 2 : 0) + (examTypeOf(findR(x.roundId) || {}) === 'X-Visor' ? 1 : 0);   // เลือกใบสมัคร X-Visor ที่ชำระแล้วก่อน
    const list = readReg().filter(x => phEq((x.candidate || {}).phone, phone) && ['CANCELLED', 'REJECTED', 'REFUNDED'].indexOf(x.status) < 0)
      .sort((a, b) => (rank(b) - rank(a)) || ((b.createdAt || 0) - (a.createdAt || 0)));
    return list[0] || null;
  }
  const maskName = (s) => { s = String(s || '').trim(); if (!s) return ''; const a = Array.from(s); return a.length <= 2 ? a[0] + '*' : a.slice(0, 2).join('') + '***'; };
  const maskEmail = (e) => { e = String(e || ''); const i = e.indexOf('@'); if (i < 1) return ''; return e.slice(0, Math.min(2, i)) + '***' + e.slice(i); };
  // ผู้สมัคร X-Lead: ตรวจสิทธิ์และดึงข้อมูลจากการสมัคร X-Visor เดิมด้วยเบอร์โทร
  app.get('/api/xv/reg/xlead-lookup', (req, res) => {
    const ph = String(req.query.phone || '');
    const prev = findPrevByPhone(ph);
    if (!prev) return res.json({ ok: false, error: 'not_found' });
    const c = prev.candidate || {};
    const passed = readS().some(x => phEq((x.candidate || {}).phone, ph) && x.status === 'verified' && sessExamType(x) === 'X-Visor');
    // PDPA: ส่งชื่อแบบปิดบังบางส่วน (ระบบเติมชื่อจริงให้เองตอนสมัคร)
    res.json({ ok: true, firstName: maskName(c.firstName), lastName: maskName(c.lastName), masked: true, emailMasked: maskEmail(c.email), coachTeam: prev.coachTeam || '', referrer: prev.referrer || '', passedXVisor: passed });
  });
  // ทีมงาน: แก้ไขข้อมูลผู้สมัคร (เพิ่ม/ลบ/เปลี่ยนได้ทุกช่อง) — บันทึกก่อน/หลังใน Audit
  app.post('/api/xv/admin/registrations/:id/edit', (req, res) => {
    const all = readReg(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {}; r.candidate = r.candidate || {}; r.address = r.address || {};
    const before = JSON.stringify({ c: r.candidate, a: r.address, coach: r.coachTeam, ref: r.referrer, tax: r.taxEmail });
    const cf = { firstName: 60, lastName: 60, phone: 30, email: 120, nationalId: 13 };
    Object.keys(cf).forEach(k => { if (b[k] != null) r.candidate[k] = String(b[k]).trim().slice(0, cf[k]); });
    ['line1', 'subdistrict', 'district', 'province', 'postal'].forEach(k => { if (b[k] != null) r.address[k] = String(b[k]).trim().slice(0, 200); });
    if (b.coachTeam != null) r.coachTeam = String(b.coachTeam).trim().slice(0, 80);
    if (b.referrer != null) r.referrer = String(b.referrer).trim().slice(0, 80);
    if (b.taxEmail != null) r.taxEmail = String(b.taxEmail).trim().slice(0, 120);
    if (b.note != null) r.staffNote = String(b.note).slice(0, 500);
    writeReg(all);
    logAudit('reg_edit', 'registration', r.id, r.regNo, null, null, 'แก้ไขข้อมูลผู้สมัคร' + (b.reason ? (': ' + String(b.reason).slice(0, 120)) : ''), 'staff');
    res.json({ ok: true, registration: r, before: before });
  });
  // ประวัติการดำเนินการของใบสมัคร (สำหรับหน้าสถานะของผู้สมัคร) ใหม่สุดอยู่บน
  function regTimeline(r) {
    const t = [], c = r.createdAt || null;
    t.push({ k: 'reg', at: c, t: 'ลงทะเบียนสำเร็จ' });
    if (r.payment && r.payment.slipUrl) t.push({ k: 'slip', at: c, t: 'ส่งหลักฐานการชำระเงินแล้ว' });
    if (r.status === 'PAYMENT_REVIEW') t.push({ k: 'review', at: null, t: 'กำลังตรวจสอบสลิป' });
    if (r.status === 'WAITLISTED') t.push({ k: 'wait', at: null, t: 'อยู่ในรายชื่อสำรอง' });
    if (PAID_ST.indexOf(r.status) >= 0) t.push({ k: 'paid', at: r.confirmedAt || null, t: 'ยืนยันการชำระเงินสำเร็จ' });
    const a = attendPub(r); if (a) t.push({ k: 'attend', at: a.at, t: a.method === 'stamp' ? 'สแตมป์ยืนยันการเข้าร่วมแล้ว' : 'เช็กอินแล้ว' });
    if (r.status === 'REJECTED') t.push({ k: 'bad', at: null, t: 'สลิปไม่ผ่านการตรวจสอบ' });
    if (r.status === 'CANCELLED') t.push({ k: 'bad', at: null, t: 'ยกเลิกการสมัครแล้ว' });
    if (r.status === 'REFUNDED' || r.status === 'PARTIALLY_REFUNDED') t.push({ k: 'bad', at: null, t: 'คืนเงินแล้ว' });
    return t.reverse();
  }
  app.get('/api/xv/reg/status', (req, res) => {
    const regNo = String(req.query.regNo || '').trim().toUpperCase();
    const phone = String(req.query.phone || '');
    if (!regNo || !phone) return res.status(400).json({ ok: false, error: 'missing_fields' });
    const r = readReg().find(x => (x.regNo || '').toUpperCase() === regNo);
    if (!r || !phEq((r.candidate || {}).phone, phone)) return res.status(404).json({ ok: false, error: 'not_found' });
    const nm = ((r.candidate.firstName || '') + ' ' + (r.candidate.lastName || '')).trim();
    const round = findR(r.roundId);
    res.json({
      ok: true, regNo: r.regNo, status: r.status, mode: r.mode,
      name: ((maskName(r.candidate.firstName) + ' ' + maskName(r.candidate.lastName)).trim()) || '-',
      round: round ? { no: round.no, date: round.date, mode: round.mode, venue: round.venue, timeslot: round.timeslot } : null,
      createdAt: r.createdAt,
      examType: round ? examTypeOf(round) : 'X-Visor', coachTeam: r.coachTeam || '',
      attendance: attendPub(r), timeline: regTimeline(r)
    });
  });
  /* ================= ยืนยันการเข้าร่วมสอบ: QR ส่วนบุคคล (On Site) + สแตมป์ (Online) =================
     - QR ออกหลังชำระเงินผ่านเท่านั้น · ข้างในเป็นรหัสสุ่ม (ไม่มีข้อมูลส่วนบุคคล)
     - เปิดสแกน/สแตมป์ 06:00 น. ของวันสอบ ถึงเวลาเริ่มสอบ (อ่านจาก timeslot, ไม่มีใช้ 09:30) — เวลาไทยจากเซิร์ฟเวอร์
     - On Site มาหลังเวลาเริ่มสอบ = หมดสิทธิ์ · ลิงก์ Zoom แอดมินส่งทาง LINE */
  const PAID_ST = ['CONFIRMED', 'CHECKED_IN', 'EXAM_STARTED', 'COMPLETED', 'TRANSFERRED_TO_EXAM'];
  const ATTEND_OPEN_MIN = 6 * 60;
  const bkkNow = (ms) => { const d = new Date((ms || Date.now()) + 7 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), hhmm: d.toISOString().slice(11, 19) }; };
  const roundStartMin = (round) => { const m = String((round && round.timeslot) || '').match(/(\d{1,2})[:.](\d{2})/); if (m) { const v = (+m[1]) * 60 + (+m[2]); if (v > 0 && v < 1440) return v; } return 9 * 60 + 30; };
  const minToHHMM = (v) => ('0' + Math.floor(v / 60)).slice(-2) + ':' + ('0' + (v % 60)).slice(-2);
  const regName = (r) => (((r.candidate || {}).firstName || '') + ' ' + ((r.candidate || {}).lastName || '')).trim();
  const ensureTicket = (r) => { if (!r.ticket) { r.ticket = crypto.randomBytes(12).toString('base64url'); r.ticketAt = Date.now(); return true; } return false; };
  const ticketPayload = (r) => 'XV1.' + r.ticket;
  // ช่วงเวลาที่ยืนยันเข้าร่วมได้ของรอบ (เทียบเวลาไทยตอนนี้)
  const attendWindow = (round, atMs) => {
    const now = bkkNow(atMs); const start = roundStartMin(round); const day = String((round && round.date) || '');
    let state = 'open';
    if (!day || now.date < day || (now.date === day && now.min < ATTEND_OPEN_MIN)) state = 'not_yet';
    else if (now.date > day || now.min >= start) state = 'closed';
    return { state: state, date: day, opensAt: minToHHMM(ATTEND_OPEN_MIN), startsAt: minToHHMM(start), now: now.hhmm, minutesLeft: state === 'open' ? (start - now.min) : 0 };
  };
  const findRegOwned = (regNo, phone) => {
    regNo = String(regNo || '').trim().toUpperCase(); phone = String(phone || '');
    if (!regNo || !phone) return null;
    const all = readReg(); const r = all.find(x => (x.regNo || '').toUpperCase() === regNo);
    if (!r || !phEq((r.candidate || {}).phone, phone)) return null;
    return { all: all, r: r };
  };
  // ถ้าแอดมินกดเช็กอินเองจากหลังบ้าน (ระบบเดิม) ก็นับว่ายืนยันเข้าร่วมแล้ว
  const attendPub = (r) => r.attendance ? { at: r.attendance.at, method: r.attendance.method } : (r.status === 'CHECKED_IN' && r.checkedInAt ? { at: r.checkedInAt, method: 'manual' } : null);
  // ผู้สมัคร: ขอบัตร QR ของตัวเอง (ต้องชำระเงินผ่านแล้ว)
  app.get('/api/xv/reg/ticket', (req, res) => {
    const f = findRegOwned(req.query.regNo, req.query.phone);
    if (!f) return res.status(404).json({ ok: false, error: 'not_found' });
    const r = f.r;
    if (PAID_ST.indexOf(r.status) < 0) return res.json({ ok: false, error: 'not_paid', status: r.status });
    if (ensureTicket(r)) writeReg(f.all);
    const round = findR(r.roundId) || {};
    res.json({ ok: true, regNo: r.regNo, status: r.status, payload: ticketPayload(r), name: regName(r), coachTeam: r.coachTeam || '', mode: r.mode,
      examType: examTypeOf(round), round: { no: round.no, date: round.date, mode: round.mode, venue: round.venue, timeslot: round.timeslot, topic: round.topic },
      attendance: attendPub(r), window: attendWindow(round), serverNow: Date.now() });
  });
  // ผู้สมัคร Online: สแตมป์ยืนยันการเข้าร่วม (06:00 ถึงเวลาเริ่มสอบของวันสอบ) — ไม่ใช่การเข้าห้องสอบ
  app.post('/api/xv/reg/attend', (req, res) => {
    const b = req.body || {}; const f = findRegOwned(b.regNo, b.phone);
    if (!f) return res.status(404).json({ ok: false, error: 'not_found' });
    const r = f.r; const round = findR(r.roundId) || {};
    if (PAID_ST.indexOf(r.status) < 0) return res.status(403).json({ ok: false, error: 'not_paid' });
    if ((r.mode || round.mode) === 'onsite') return res.status(400).json({ ok: false, error: 'onsite_use_qr' });
    if (attendPub(r)) return res.json({ ok: true, already: true, attendance: attendPub(r) });
    const w = attendWindow(round);
    if (w.state !== 'open') return res.status(403).json({ ok: false, error: w.state === 'not_yet' ? 'not_open_yet' : 'closed', window: w, serverNow: Date.now() });
    r.attendance = { at: Date.now(), method: 'stamp' };
    writeReg(f.all);
    logAudit('attend_stamp', 'registration', r.id, r.regNo, null, 'ATTENDING', 'ผู้สมัครสแตมป์ยืนยันการเข้าร่วม (Online) เวลา ' + bkkNow().hhmm, 'customer');
    res.json({ ok: true, attendance: attendPub(r) });
  });
  // ทีมงาน: สแกน QR / พิมพ์เลขที่ผู้สมัคร เพื่อเช็กอิน On Site (ต้องล็อกอินพนักงาน หรือ ADMIN_KEY)
  app.post('/api/xv/checkin', (req, res) => {
    if (!isStaff(req) && !adminWrite(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const b = req.body || {}; const code = String(b.code || '').trim();
    if (!code) return res.status(400).json({ ok: false, error: 'missing_code' });
    const all = readReg();
    let r = null;
    if (/^XV1\./.test(code)) r = all.find(x => x.ticket && ('XV1.' + x.ticket) === code);
    else if (/^CXM1\./.test(code)) {   // QR สมาชิกจากแอป → หาใบสมัครของวันนี้ของสมาชิกคนนั้น
      const mem = opts.memberByQr ? opts.memberByQr(code) : null;
      if (!mem) return res.json({ ok: false, result: 'invalid' });
      const today = bkkNow().date;
      const mine = all.filter(x => phEq((x.candidate || {}).phone, mem.phone) && ['CANCELLED', 'REJECTED', 'REFUNDED'].indexOf(x.status) < 0)
        .map(x => ({ x: x, rd: findR(x.roundId) || {} }))
        .filter(o => o.rd.date === today && (!b.roundId || o.x.roundId === b.roundId));
      const pick = mine.find(o => PAID_ST.indexOf(o.x.status) >= 0 && (o.x.mode || o.rd.mode) === 'onsite') || mine.find(o => PAID_ST.indexOf(o.x.status) >= 0) || mine[0];
      if (!pick) return res.json({ ok: false, result: 'no_registration', name: mem.name });
      r = pick.x;
    }
    else r = all.find(x => (x.regNo || '').toUpperCase() === code.toUpperCase());
    if (!r) return res.json({ ok: false, result: 'invalid' });
    const round = findR(r.roundId) || {};
    const info = { regNo: r.regNo, name: regName(r), coachTeam: r.coachTeam || '', mode: r.mode, round: { id: round.id, no: round.no, date: round.date, timeslot: round.timeslot, venue: round.venue } };
    if (PAID_ST.indexOf(r.status) < 0) return res.json(Object.assign({ ok: false, result: 'not_paid', status: r.status }, info));
    if (b.roundId && b.roundId !== r.roundId) return res.json(Object.assign({ ok: false, result: 'wrong_round' }, info));
    if (attendPub(r)) return res.json(Object.assign({ ok: true, result: 'duplicate', attendance: attendPub(r) }, info));
    // สแกนตอนเน็ตหลุด: เครื่องทีมงานส่งเวลาที่สแกนจริงมาด้วย (ยอมรับย้อนหลังไม่เกิน 3 ชม.)
    const nowMs = Date.now(); let atMs = Number(b.at) || 0;
    if (!(atMs > nowMs - 3 * 3600 * 1000 && atMs <= nowMs + 60000)) atMs = nowMs;
    atMs = Math.min(atMs, nowMs);
    const w = attendWindow(round, atMs);
    if (w.date !== bkkNow(atMs).date) return res.json(Object.assign({ ok: false, result: 'wrong_day', window: w }, info));
    if (w.state === 'not_yet') return res.json(Object.assign({ ok: false, result: 'not_open_yet', window: w }, info));
    if (w.state === 'closed') return res.json(Object.assign({ ok: false, result: 'late', window: w }, info));
    r.attendance = { at: atMs, recvAt: nowMs, method: 'scan', by: String((opts.staffName && opts.staffName(req)) || b.by || 'admin-key').slice(0, 60), queued: atMs < nowMs - 30000 || undefined };
    if (r.status === 'CONFIRMED') { r.status = 'CHECKED_IN'; r.checkedInAt = atMs; }
    writeReg(all);
    logAudit('checkin_scan', 'registration', r.id, r.regNo, 'CONFIRMED', r.status, 'เช็กอิน On Site ด้วย QR เวลา ' + bkkNow(atMs).hhmm, 'staff');
    res.json(Object.assign({ ok: true, result: 'checked_in', attendance: attendPub(r) }, info));
  });
  // ทีมงาน: ยกเลิกเช็กอินที่สแกนผิด (ภายใน 1 นาที)
  app.post('/api/xv/checkin/undo', (req, res) => {
    if (!isStaff(req) && !adminWrite(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const regNo = String((req.body || {}).regNo || '').toUpperCase(); const all = readReg();
    const r = all.find(x => (x.regNo || '').toUpperCase() === regNo);
    if (!r || !r.attendance || r.attendance.method !== 'scan') return res.status(404).json({ ok: false });
    if (Date.now() - (r.attendance.recvAt || r.attendance.at) > 60000) return res.status(400).json({ ok: false, error: 'too_late' });
    r.attendance = null; if (r.status === 'CHECKED_IN') { r.status = 'CONFIRMED'; delete r.checkedInAt; } writeReg(all);
    logAudit('checkin_undo', 'registration', r.id, r.regNo, 'CHECKED_IN', r.status, 'ยกเลิกเช็กอินที่สแกนผิด', 'staff');
    res.json({ ok: true });
  });
  // ทีมงาน: สรุปการยืนยันเข้าร่วม (ลงทะเบียน / ชำระแล้ว / ยืนยันแล้ว แยกตามทีมโค้ช) — ใช้กับ Dashboard ภายหลัง
  app.get('/api/xv/attendance', (req, res) => {
    if (!isStaff(req) && !adminWrite(req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const today = bkkNow().date;
    const rounds = readR().filter(x => req.query.roundId ? x.id === req.query.roundId : x.date === today);
    const regs = readReg();
    const out = rounds.map(round => {
      const list = regs.filter(x => x.roundId === round.id && ['CANCELLED', 'REJECTED', 'REFUNDED'].indexOf(x.status) < 0);
      const paid = list.filter(x => PAID_ST.indexOf(x.status) >= 0);
      const byCoach = {};
      paid.forEach(x => { const k = x.coachTeam || '-'; byCoach[k] = byCoach[k] || { paid: 0, confirmed: 0 }; byCoach[k].paid++; if (attendPub(x)) byCoach[k].confirmed++; });
      return { round: { id: round.id, no: round.no, date: round.date, mode: round.mode, timeslot: round.timeslot, venue: round.venue || '', examType: examTypeOf(round) }, window: attendWindow(round),
        registered: list.length, paid: paid.length, confirmed: paid.filter(x => attendPub(x)).length, byCoach: byCoach,
        people: paid.map(x => ({ regNo: x.regNo, name: regName(x), coachTeam: x.coachTeam || '', attendance: attendPub(x) })) };
    });
    res.json({ ok: true, today: today, rounds: out });
  });

  // ทีมงาน/ผู้บริหาร: Dashboard ภาพรวม E-xam (นับตาม "วันสอบของรอบ") — ?from=YYYY-MM-DD&to=&type=X-Visor|X-Lead&mode=online|onsite
  const COACHES = ['ซิง', 'นุ่น', 'จา', 'ต๊ะ'];
  const coachOf = (r) => { const c = String(r.coachTeam || '').replace(/^(ทีม)?\s*(โค้ช)?\s*/, '').trim(); return COACHES.indexOf(c) >= 0 ? c : 'อื่น ๆ'; };
  const maskPhone = (p) => { p = String(p || '').replace(/\D/g, ''); return p.length >= 7 ? p.slice(0, 3) + '-XXX-' + p.slice(-4) : p; };
  app.get('/api/xv/admin/dashboard', (req, res) => {
    const q = req.query || {}; const today = bkkNow().date;
    const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
    const from = okDate(q.from) ? q.from : ''; const to = okDate(q.to) ? q.to : '';
    const type = q.type === 'X-Lead' || q.type === 'X-Visor' ? q.type : ''; const mode = q.mode === 'online' || q.mode === 'onsite' ? q.mode : '';
    const rounds = readR(); const rById = {}; rounds.forEach(r => { rById[r.id] = r; });
    const regs = readReg(); const sess = readS();
    const satKey = {}; sess.forEach(x => { if (x.roundId) satKey[x.roundId + '|' + String((x.candidate || {}).phone || '').replace(/\D/g, '')] = x; });
    const inScope = (r, f, t) => { const rd = rById[r.roundId]; if (!rd) return false; const d = rd.date || '';
      if (f && d < f) return false; if (t && d > t) return false;
      if (type && examTypeOf(rd) !== type) return false; if (mode && (r.mode || rd.mode) !== mode) return false; return true; };
    const isPaid = (r) => PAID_ST.indexOf(r.status) >= 0 || r.status === 'PARTIALLY_REFUNDED';
    const heldRound = (rd) => rd && rd.date && (rd.date < today || (rd.date === today && attendWindow(rd).state === 'closed'));
    const sat = (r) => !!satKey[r.roundId + '|' + String((r.candidate || {}).phone || '').replace(/\D/g, '')];
    const paid = regs.filter(r => isPaid(r) && inScope(r, from, to));
    const tOf = (r) => examTypeOf(rById[r.roundId]);
    const held = paid.filter(r => heldRound(rById[r.roundId]));
    const cnt = (list, fn) => list.filter(fn).length;
    // เทียบช่วงก่อนหน้า (ความยาวเท่ากัน) — เฉพาะเมื่อเลือกช่วงวันที่
    let prev = null;
    if (from && to) { const d0 = new Date(from + 'T00:00:00Z'), d1 = new Date(to + 'T00:00:00Z'); const len = Math.round((d1 - d0) / 86400000) + 1;
      const pf = new Date(d0 - len * 86400000).toISOString().slice(0, 10), pt = new Date(d0 - 86400000).toISOString().slice(0, 10);
      prev = { from: pf, to: pt, paid: regs.filter(r => isPaid(r) && inScope(r, pf, pt)).length }; }
    const split = (list) => ({ total: list.length, xvisor: cnt(list, r => tOf(r) === 'X-Visor'), xlead: cnt(list, r => tOf(r) === 'X-Lead') });
    const byMode = {}; ['online', 'onsite'].forEach(m => { const l = paid.filter(r => (r.mode || (rById[r.roundId] || {}).mode) === m); const h = l.filter(r => heldRound(rById[r.roundId]));
      byMode[m] = Object.assign(split(l), { held: h.length, confirmed: cnt(h, r => !!attendPub(r)), sat: cnt(h, sat) }); });
    const byCoach = {}; COACHES.concat(['อื่น ๆ']).forEach(c => { byCoach[c] = { xvisor: 0, xlead: 0, paid: 0, held: 0, confirmed: 0, sat: 0 }; });
    paid.forEach(r => { const b = byCoach[coachOf(r)]; b.paid++; if (tOf(r) === 'X-Lead') b.xlead++; else b.xvisor++;
      if (heldRound(rById[r.roundId])) { b.held++; if (attendPub(r)) b.confirmed++; if (sat(r)) b.sat++; } });
    // 6 เดือนล่าสุด (ถึงเดือนของ to หรือเดือนนี้)
    const endM = (to || today).slice(0, 7); const months = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(endM + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
    const monthly = months.map(m => { const l = regs.filter(r => isPaid(r) && inScope(r, m + '-01', m + '-31')); const h = l.filter(r => heldRound(rById[r.roundId]));
      return { month: m, paid: l.length, held: h.length, confirmed: cnt(h, r => !!attendPub(r)), sat: cnt(h, sat) }; });
    // ผลสอบ (session ของรอบในช่วง)
    const sIn = sess.filter(x => { const rd = rById[x.roundId]; if (!rd) return false; if (from && rd.date < from) return false; if (to && rd.date > to) return false;
      if (type && examTypeOf(rd) !== type) return false; if (mode && rd.mode !== mode) return false; return true; });
    const results = { total: sIn.length }; ['verified', 'awaiting_verify', 'submitted', 'remedial_required', 'ended_failed', 'disqualified', 'in_progress'].forEach(k => { results[k] = cnt(sIn, x => x.status === k); });
    // วันนี้
    const todayRounds = rounds.filter(r => r.date === today).map(rd => { const l = regs.filter(r => r.roundId === rd.id && isPaid(r));
      return { round: { id: rd.id, no: rd.no, mode: rd.mode, timeslot: rd.timeslot, venue: rd.venue, examType: examTypeOf(rd) }, window: attendWindow(rd),
        paid: l.length, confirmed: cnt(l, r => !!attendPub(r)), sat: cnt(l, sat),
        waiting: l.filter(r => !attendPub(r)).map(r => ({ regNo: r.regNo, name: regName(r), coach: coachOf(r), phone: maskPhone((r.candidate || {}).phone) })) }; });
    const in3 = new Date(Date.now() + 7 * 3600000 + 3 * 86400000).toISOString().slice(0, 10);
    const tasks = { slips: cnt(regs, r => r.status === 'PAYMENT_REVIEW'), unpaid: cnt(regs, r => r.status === 'PENDING_PAYMENT'),
      verify: cnt(sess, x => x.status === 'awaiting_verify'), closing: rounds.filter(r => r.status === 'open' && r.regCloseAt && r.regCloseAt >= today && r.regCloseAt <= in3).length };
    const recent = paid.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 10).map(r => { const rd = rById[r.roundId] || {};
      return { regNo: r.regNo, name: regName(r), examType: examTypeOf(rd), mode: r.mode || rd.mode, coach: coachOf(r), coachRaw: r.coachTeam || '', referrer: r.referrer || '',
        createdAt: r.createdAt, roundNo: rd.no, roundDate: rd.date, status: r.status, attendance: attendPub(r) }; });
    res.json({ ok: true, today, from, to, type, mode, prev,
      paid: split(paid), held: Object.assign(split(held), { confirmed: cnt(held, r => !!attendPub(r)), sat: cnt(held, sat),
        confirmedX: cnt(held, r => !!attendPub(r) && tOf(r) === 'X-Visor'), confirmedL: cnt(held, r => !!attendPub(r) && tOf(r) === 'X-Lead') }),
      byMode, byCoach, monthly, results, todayRounds, tasks, recent, recentTotal: paid.length });
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
    if (r.ticket) { r.ticket = null; ensureTicket(r); } r.attendance = null; // ย้ายรอบ = ออก QR ใหม่ ของเก่าใช้ไม่ได้
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

  // ให้แอปสมาชิก (member_api) อ่านข้อมูลการสมัคร/ผลสอบได้ (อ่านอย่างเดียว)
  if (opts) opts.expose = { readReg: readReg, readR: readR, readS: readS, findR: findR, examTypeOf: examTypeOf, sessExamType: sessExamType,
    examLive: function (r) { return xvExamLive(r); }, pubResults: function (x) { return pubResults(x); }, pubAttempts: function (x) { return pubAttempts(x); }, remaining: function (x) { return xvRemaining(x); },
    openRegRounds: function () { return readR().filter(regOpenForReg).map(function (r) { return Object.assign(pubRound(r), { examType: examTypeOf(r) }); }); } };
  console.log('[x-visor] exam API mounted');
};
