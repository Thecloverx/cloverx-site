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
  const SF = path.join(XV, 'sessions.json');
  const RF = path.join(XV, 'rounds.json');
  const REGF = path.join(XV, 'registrations.json');
  const REGUP = path.join(XV, 'reguploads'); // slip / id-card images
  if (!fs.existsSync(REGUP)) { try { fs.mkdirSync(REGUP, { recursive: true }); } catch (e) {} }

  const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wr = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
  const bank = () => {
    let b = rd(QF, null);
    if (!b || !b.bank || !Object.keys(b.bank).length) b = rd(QF_ROOT, null);
    return b && b.bank ? b : { names: {}, bank: {} };
  };
  const readS = () => rd(SF, []);
  const writeS = (s) => wr(SF, s);
  const readR = () => rd(RF, []);
  const writeR = (r) => wr(RF, r);
  const findR = (id) => readR().find(x => x.id === id);
  const findRByCode = (code) => readR().find(x => String(x.code).toUpperCase() === String(code || '').toUpperCase());
  const roundCode = () => 'R' + crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. R7F3A9C
  const nextRoundNo = () => { const rs = readR(); return rs.length ? Math.max.apply(null, rs.map(r => r.no || 0)) + 1 : 1; };
  const readReg = () => rd(REGF, []);
  const writeReg = (x) => wr(REGF, x);
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
    venue: r.venue || '', timeslot: r.timeslot || '', regCloseAt: r.regCloseAt || ''
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
      if (pass && process.env.EASYSLIP_AUTOCONFIRM !== '0') { x.status = 'CONFIRMED'; x.confirmedAt = Date.now(); x.easyslip.result = 'confirmed'; }
      else x.easyslip.result = pass ? 'verified' : (dup ? 'duplicate' : 'mismatch');
      writeReg(all);
    }).catch(() => {});
  }

  const PARTS = [1, 2, 3, 4, 5], QPP = 20, PASS = 16, MAXATT = 3, TOTAL = 120 * 60; // MAXATT = total attempts/part (1 first + 2 remedial)
  // Exam admin endpoints are open (no Admin Key) — per CloverX request. Keep the operations URL private.
  // NOTE: the orders/Stripe/PII admin in server.js still uses ADMIN_KEY separately.
  const adminOk = (req) => true;
  const genId = () => crypto.randomBytes(9).toString('hex');

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function buildPaper(B, parts) {
    const paper = {};
    parts.forEach(p => {
      const src = B.bank[p] || B.bank[String(p)] || [];
      const order = shuffle(src.map((_, i) => i));
      paper[p] = order.map(qi => { const it = src[qi]; const oi = shuffle([0, 1, 2, 3]); return { q: it.q, o: oi.map(k => it.o[k]), c: oi.indexOf(it.c) }; });
    });
    return paper;
  }
  // strip correct index for the client
  function clientPaper(paper, parts) { const out = {}; parts.forEach(p => { out[p] = (paper[p] || []).map(x => ({ q: x.q, o: x.o })); }); return out; }
  function findS(all, id, token) { return all.find(x => x.id === id && x.token === token); }
  function activeParts(s) { return s.phase === 'remedial' ? (s.remedialQueue || []) : PARTS.slice(); }

  function score(s) {
    const parts = activeParts(s);
    parts.forEach(p => {
      let sc = 0; const wrong = [];
      for (let q = 0; q < QPP; q++) { if (s.answers[p + '-' + q] === s.paper[p][q].c) sc++; else wrong.push(q + 1); }
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
    else { s.status = 'remedial_required'; s.remedialQueue = failed.map(r => r.part).sort((a, b) => a - b); }
    s.paused = false;
    s.submittedAt = Date.now();
  }
  const pubResults = (s) => s.results.map(r => ({ part: r.part, score: r.score, status: r.status, attempts: r.attempts }));

  /* ---------------- candidate endpoints ---------------- */
  app.post('/api/xv/start', (req, res) => {
    const b = req.body || {};
    if (!b.firstName || !b.lastName || !b.phone) return res.status(400).json({ ok: false, error: 'missing_fields' });
    const B = bank();
    if (!B.bank || Object.keys(B.bank).length < 5) return res.status(400).json({ ok: false, error: 'no_questions' });
    // resolve round (accept roundId or round code); gate closed rounds
    let round = null;
    if (b.roundId) round = findR(b.roundId);
    if (!round && b.roundCode) round = findRByCode(b.roundCode);
    if (round && round.status !== 'open') return res.status(403).json({ ok: false, error: 'round_closed' });
    const paper = buildPaper(B, PARTS);
    const s = {
      id: genId(), token: crypto.randomBytes(12).toString('hex'),
      candidate: { firstName: String(b.firstName).slice(0, 60), lastName: String(b.lastName).slice(0, 60), phone: String(b.phone).slice(0, 30), mode: b.mode === 'onsite' ? 'onsite' : 'online' },
      code: 'XV' + (Date.now() % 1000000),
      roundId: round ? round.id : null, roundNo: round ? round.no : null,
      phase: 'first', paper, answers: {}, results: [], status: 'in_progress',
      startedAt: Date.now(), remaining: TOTAL, pauseUsed: 0, staffVerified: false, createdAt: Date.now()
    };
    const all = readS(); all.push(s); writeS(all);
    res.json({ ok: true, sessionId: s.id, token: s.token, code: s.code, mode: s.candidate.mode, phase: 'first', parts: PARTS, durationSec: TOTAL, paper: clientPaper(paper, PARTS) });
  });

  app.post('/api/xv/answer', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'in_progress') return res.status(404).json({ ok: false });
    if (b.part && b.q != null && (b.choice === null || (b.choice >= 0 && b.choice < 4))) s.answers[b.part + '-' + b.q] = b.choice;
    if (typeof b.remaining === 'number') s.remaining = Math.max(0, b.remaining | 0);
    if (typeof b.pauseUsed === 'number') s.pauseUsed = b.pauseUsed;
    if (typeof b.paused === 'boolean') s.paused = b.paused; // On-Site pause state, for staff tracking
    writeS(all); res.json({ ok: true });
  });

  // proctor: record anti-cheat behaviour events during the exam
  const PROC_TYPES = ['leave', 'blur', 'printscreen', 'copy', 'contextmenu'];
  app.post('/api/xv/proctor', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'in_progress') return res.status(404).json({ ok: false });
    const type = PROC_TYPES.indexOf(b.type) >= 0 ? b.type : null;
    if (!type) return res.status(400).json({ ok: false, error: 'bad_type' });
    s.proctor = s.proctor || { leave: 0, blur: 0, printscreen: 0, copy: 0, contextmenu: 0, events: [] };
    s.proctor[type] = (s.proctor[type] || 0) + 1;
    s.proctor.events = s.proctor.events || [];
    s.proctor.events.push({ type, at: Date.now() });
    if (s.proctor.events.length > 60) s.proctor.events = s.proctor.events.slice(-60);
    writeS(all); res.json({ ok: true });
  });

  app.post('/api/xv/submit', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'in_progress') return res.status(404).json({ ok: false });
    score(s); writeS(all);
    res.json({ ok: true, status: s.status, results: pubResults(s), remedialQueue: s.remedialQueue || [], total: s.results.reduce((a, r) => a + (r.score || 0), 0) });
  });

  app.post('/api/xv/remedial/start', (req, res) => {
    const b = req.body || {}; const all = readS(); const s = findS(all, b.sessionId, b.token);
    if (!s || s.status !== 'remedial_required') return res.status(400).json({ ok: false });
    const np = buildPaper(bank(), s.remedialQueue);
    s.remedialQueue.forEach(p => { s.paper[p] = np[p]; for (let q = 0; q < QPP; q++) delete s.answers[p + '-' + q]; });
    s.phase = 'remedial'; s.status = 'in_progress'; s.remaining = TOTAL; s.startedAt = Date.now();
    writeS(all);
    res.json({ ok: true, parts: s.remedialQueue, durationSec: TOTAL, paper: clientPaper(s.paper, s.remedialQueue) });
  });

  app.get('/api/xv/session/:id', (req, res) => {
    const all = readS(); const s = findS(all, req.params.id, req.query.token);
    if (!s) return res.status(404).json({ ok: false });
    const parts = activeParts(s);
    res.json({ ok: true, mode: s.candidate.mode, phase: s.phase, status: s.status, parts, answers: s.answers, remaining: s.remaining, pauseUsed: s.pauseUsed, results: pubResults(s), remedialQueue: s.remedialQueue || [], staffVerified: s.staffVerified, paper: clientPaper(s.paper, parts) });
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
    res.json({ ok: true, round: { id: r.id, code: r.code, no: r.no, date: r.date, topic: r.topic, status: r.status, open: r.status === 'open' } });
  });

  /* ---------------- admin endpoints (ADMIN_KEY) ---------------- */
  app.get('/api/xv/admin/overview', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const by = f => all.filter(f).length;
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
    res.json({
      ok: true, sessions: readS().map(s => ({
        id: s.id, code: s.code, candidate: s.candidate, phase: s.phase, status: s.status,
        roundId: s.roundId || null, roundNo: s.roundNo || null,
        results: pubResults(s), total: s.results.reduce((a, r) => a + (r.score || 0), 0),
        pauseUsed: s.pauseUsed, paused: !!s.paused, staffVerified: s.staffVerified, createdAt: s.createdAt, submittedAt: s.submittedAt, remaining: s.remaining, startedAt: s.startedAt,
        proctor: s.proctor ? { leave: s.proctor.leave || 0, blur: s.proctor.blur || 0, printscreen: s.proctor.printscreen || 0, copy: s.proctor.copy || 0, contextmenu: s.proctor.contextmenu || 0 } : null,
        flags: s.proctor ? ((s.proctor.leave || 0) + (s.proctor.blur || 0) + (s.proctor.printscreen || 0) + (s.proctor.copy || 0) + (s.proctor.contextmenu || 0)) : 0,
        proctorDecision: s.proctorDecision || null
      }))
    });
  });

  app.get('/api/xv/admin/session/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const s = readS().find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const out = Object.assign({}, s); delete out.token; // keep paper with keys for admin review
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
      venue: String(b.venue || '').slice(0, 200),
      timeslot: String(b.timeslot || '').slice(0, 60),
      regCloseAt: String(b.regCloseAt || '').slice(0, 10),
      createdAt: Date.now()
    };
    const all = readR(); all.push(r); writeR(all);
    res.json({ ok: true, round: pubRound(r) });
  });

  // update a round (date / no / topic / status) — used by edit AND open-close
  app.post('/api/xv/admin/rounds/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readR(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {};
    if (b.date != null) r.date = String(b.date).slice(0, 10);
    if (b.no != null && b.no !== '') r.no = parseInt(b.no, 10) || r.no;
    if (b.topic != null) r.topic = String(b.topic).slice(0, 80);
    if (b.status === 'open' || b.status === 'closed') r.status = b.status;
    if (b.mode === 'online' || b.mode === 'onsite') r.mode = b.mode;
    if (b.fee != null && b.fee !== '') r.fee = parseInt(b.fee, 10) || 0;
    if (b.capacity != null && b.capacity !== '') r.capacity = parseInt(b.capacity, 10) || 0;
    if (b.venue != null) r.venue = String(b.venue).slice(0, 200);
    if (b.timeslot != null) r.timeslot = String(b.timeslot).slice(0, 60);
    if (b.regCloseAt != null) r.regCloseAt = String(b.regCloseAt).slice(0, 10);
    writeR(all); res.json({ ok: true, round: pubRound(r) });
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
      r.status = b.status;
      if (b.status === 'CHECKED_IN') { r.checkedInAt = Date.now(); }
      if (b.status === 'CONFIRMED') { r.confirmedAt = Date.now(); }
      if (b.status === 'CANCELLED') { r.cancelledAt = Date.now(); }
    }
    writeReg(all); res.json({ ok: true, registration: r });
  });
  // admin: refund a registration — payment is by bank transfer (EasySlip), so we only RECORD the
  // refund; the admin transfers the money back manually. Supports full or partial, reason, note.
  app.post('/api/xv/admin/registrations/:id/refund', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readReg(); const r = all.find(x => x.id === req.params.id); if (!r) return res.status(404).json({ ok: false });
    const b = req.body || {};
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
    writeReg(all); res.json({ ok: true, method: 'bank_manual', registration: r });
  });

  app.post('/api/xv/admin/import-questions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {}; const data = b.bank ? b : { names: {}, bank: b.questions || b };
    if (!data.bank || Object.keys(data.bank).length < 1) return res.status(400).json({ ok: false, error: 'expected {names,bank}' });
    // validate structure so a bad import can't corrupt the exam
    const errs = [];
    Object.keys(data.bank).forEach(p => {
      const arr = data.bank[p];
      if (!Array.isArray(arr) || !arr.length) { errs.push('part ' + p + ' empty'); return; }
      arr.forEach((it, i) => {
        if (!it || typeof it.q !== 'string' || !it.q.trim()) errs.push('part ' + p + ' q' + (i + 1) + ': missing question');
        else if (!Array.isArray(it.o) || it.o.length !== 4 || it.o.some(o => typeof o !== 'string' || !o.trim())) errs.push('part ' + p + ' q' + (i + 1) + ': need 4 options');
        else if (!(Number.isInteger(it.c) && it.c >= 0 && it.c < 4)) errs.push('part ' + p + ' q' + (i + 1) + ': bad answer index');
      });
    });
    if (errs.length) return res.status(400).json({ ok: false, error: 'invalid_bank', details: errs.slice(0, 10) });
    // keep only q/o/c per item; clamp names to strings
    const clean = { names: {}, bank: {} };
    Object.keys(data.names || {}).forEach(p => { clean.names[p] = String(data.names[p]).slice(0, 120); });
    Object.keys(data.bank).forEach(p => { clean.bank[p] = data.bank[p].map(it => ({ q: String(it.q), o: it.o.map(String), c: it.c | 0 })); });
    wr(QF, clean);
    res.json({ ok: true, parts: Object.keys(clean.bank).length, questions: Object.keys(clean.bank).reduce((a, p) => a + clean.bank[p].length, 0) });
  });

  app.get('/api/xv/admin/questions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const B = bank(); res.json({ ok: true, names: B.names, counts: Object.keys(B.bank).reduce((o, p) => (o[p] = B.bank[p].length, o), {}) });
  });

  console.log('[x-visor] exam API mounted (' + Object.keys(bank().bank || {}).length + ' parts loaded)');
};
