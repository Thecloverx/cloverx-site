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
    transfer: o.transfer || null, slipUrl
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

// ---- static site (index.html, center.html, operations.html, preorder.html) ----
app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log('CloverX site + API on ' + PORT));
