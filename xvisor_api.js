/* X-VISOR exam backend — file-store, server-side shuffle + scoring (keys never sent to client) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function (app, DATA) {
  const XV = path.join(DATA, 'xvisor');
  if (!fs.existsSync(XV)) fs.mkdirSync(XV, { recursive: true });
  const QF = path.join(XV, 'questions.json');
  const QF_ROOT = path.join(DATA, '..', 'xvisor_questions.json'); // repo-root fallback (flat deploy)
  const SF = path.join(XV, 'sessions.json');

  const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wr = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
  const bank = () => {
    let b = rd(QF, null);
    if (!b || !b.bank || !Object.keys(b.bank).length) b = rd(QF_ROOT, null);
    return b && b.bank ? b : { names: {}, bank: {} };
  };
  const readS = () => rd(SF, []);
  const writeS = (s) => wr(SF, s);

  const PARTS = [1, 2, 3, 4, 5], QPP = 20, PASS = 16, MAXATT = 2, TOTAL = 120 * 60;
  const adminOk = (req) => process.env.ADMIN_KEY && (req.query.key === process.env.ADMIN_KEY || req.get('x-admin-key') === process.env.ADMIN_KEY);
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
    else if (failed.length === 0) s.status = 'awaiting_verify';
    else { s.status = 'remedial_required'; s.remedialQueue = failed.map(r => r.part).sort((a, b) => a - b); }
    s.submittedAt = Date.now();
  }
  const pubResults = (s) => s.results.map(r => ({ part: r.part, score: r.score, status: r.status, attempts: r.attempts }));

  /* ---------------- candidate endpoints ---------------- */
  app.post('/api/xv/start', (req, res) => {
    const b = req.body || {};
    if (!b.firstName || !b.lastName || !b.phone) return res.status(400).json({ ok: false, error: 'missing_fields' });
    const B = bank();
    if (!B.bank || Object.keys(B.bank).length < 5) return res.status(400).json({ ok: false, error: 'no_questions' });
    const paper = buildPaper(B, PARTS);
    const s = {
      id: genId(), token: crypto.randomBytes(12).toString('hex'),
      candidate: { firstName: String(b.firstName).slice(0, 60), lastName: String(b.lastName).slice(0, 60), phone: String(b.phone).slice(0, 30), mode: b.mode === 'onsite' ? 'onsite' : 'online' },
      code: 'XV' + (Date.now() % 1000000),
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

  /* ---------------- admin endpoints (ADMIN_KEY) ---------------- */
  app.get('/api/xv/admin/overview', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const by = f => all.filter(f).length;
    res.json({
      ok: true, total: all.length,
      inProgress: by(s => s.status === 'in_progress'),
      awaiting: by(s => s.status === 'awaiting_verify'),
      verified: by(s => s.status === 'verified'),
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
        results: pubResults(s), total: s.results.reduce((a, r) => a + (r.score || 0), 0),
        pauseUsed: s.pauseUsed, staffVerified: s.staffVerified, createdAt: s.createdAt, submittedAt: s.submittedAt, remaining: s.remaining
      }))
    });
  });

  app.get('/api/xv/admin/session/:id', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const s = readS().find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    const out = Object.assign({}, s); delete out.token; // keep paper with keys for admin review
    res.json({ ok: true, session: out });
  });

  app.post('/api/xv/admin/session/:id/verify', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const all = readS(); const s = all.find(x => x.id === req.params.id); if (!s) return res.status(404).json({ ok: false });
    if (s.status !== 'awaiting_verify') return res.status(400).json({ ok: false, error: 'not_awaiting' });
    s.staffVerified = true; s.status = 'verified'; s.verifiedAt = Date.now(); writeS(all);
    res.json({ ok: true });
  });

  app.post('/api/xv/admin/import-questions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const b = req.body || {}; const data = b.bank ? b : { names: {}, bank: b.questions || b };
    if (!data.bank || Object.keys(data.bank).length < 1) return res.status(400).json({ ok: false, error: 'expected {names,bank}' });
    wr(QF, data); res.json({ ok: true, parts: Object.keys(data.bank).length });
  });

  app.get('/api/xv/admin/questions', (req, res) => {
    if (!adminOk(req)) return res.status(403).json({ ok: false });
    const B = bank(); res.json({ ok: true, names: B.names, counts: Object.keys(B.bank).reduce((o, p) => (o[p] = B.bank[p].length, o), {}) });
  });

  console.log('[x-visor] exam API mounted (' + Object.keys(bank().bank || {}).length + ' parts loaded)');
};
