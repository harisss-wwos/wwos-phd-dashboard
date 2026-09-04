// WWOS-GSOC PHD dashboard API — auth, user management, and live-data storage on MongoDB Atlas.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const { getCollection, COLLECTIONS } = require('./db');
const {
  VALID_ROLES, rank,
  hashPassword, verifyPassword,
  issueToken, attachUser, requireRole,
} = require('./auth');
const { quarterOf, currentQuarter, quarterRange, quarterLabel } = require('./quarters');

const app = express();
app.use(express.json({ limit: '15mb' })); // live dataset can be sizeable

// CORS: allow the static site origins. Set ALLOWED_ORIGINS as comma-separated in env,
// otherwise default to the GitHub Pages site + localhost dev.
const DEFAULT_ORIGINS = [
  'https://harisss-wwos.github.io',
  'http://127.0.0.1:8082',
  'http://localhost:8082',
];
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const originList = allowed.length ? allowed : DEFAULT_ORIGINS;
app.use(cors({
  origin: (origin, cb) => {
    // allow same-origin / curl (no origin) and any in the list
    if (!origin || originList.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
}));

app.use(attachUser);

// ---- Health / wake ----
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Auth ----
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    const users = await getCollection(COLLECTIONS.users);
    const user = await users.findOne({ username: String(username).toLowerCase() });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = issueToken(user);
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ---- Profile ----
app.get('/api/me', requireRole('user'), async (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.post('/api/change-password', requireRole('user'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required.' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    const users = await getCollection(COLLECTIONS.users);
    const user = await users.findOne({ username: req.user.username });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    await users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not change password.' });
  }
});

// ---- User management (owner only) ----
app.get('/api/users', requireRole('owner'), async (req, res) => {
  const users = await getCollection(COLLECTIONS.users);
  const list = await users.find({}, { projection: { passwordHash: 0 } }).sort({ role: -1, username: 1 }).toArray();
  res.json(list.map(u => ({ id: String(u._id), username: u.username, role: u.role })));
});

app.post('/api/users', requireRole('owner'), async (req, res) => {
  try {
    let { username, password, role } = req.body || {};
    username = String(username || '').trim().toLowerCase();
    role = String(role || 'user');
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (role === 'owner') return res.status(403).json({ error: 'Cannot create another owner.' });
    const users = await getCollection(COLLECTIONS.users);
    if (await users.findOne({ username })) return res.status(409).json({ error: 'Username already exists.' });
    const doc = { username, passwordHash: await hashPassword(password), role, createdAt: new Date() };
    const r = await users.insertOne(doc);
    res.status(201).json({ id: String(r.insertedId), username, role });
  } catch (e) {
    res.status(500).json({ error: 'Could not create user.' });
  }
});

app.patch('/api/users/:id/role', requireRole('owner'), async (req, res) => {
  try {
    const role = String((req.body || {}).role || '');
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (role === 'owner') return res.status(403).json({ error: 'Cannot assign the owner role.' });
    const users = await getCollection(COLLECTIONS.users);
    const target = await users.findOne({ _id: new ObjectId(req.params.id) });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'Cannot change the owner.' });
    await users.updateOne({ _id: target._id }, { $set: { role, updatedAt: new Date() } });
    res.json({ id: String(target._id), username: target.username, role });
  } catch (e) {
    res.status(500).json({ error: 'Could not change role.' });
  }
});

app.delete('/api/users/:id', requireRole('owner'), async (req, res) => {
  try {
    const users = await getCollection(COLLECTIONS.users);
    const target = await users.findOne({ _id: new ObjectId(req.params.id) });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: 'Cannot delete the owner.' });
    await users.deleteOne({ _id: target._id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete user.' });
  }
});

// ---- Live data ----
// Public read: anyone can fetch the current shared live dataset.
app.get('/api/live-data', async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.liveData);
    const doc = await coll.findOne({ _id: 'current' });
    if (!doc) return res.json({ data: null, meta: null });
    res.json({ data: doc.data, meta: doc.meta || null });
  } catch (e) {
    res.status(500).json({ error: 'Could not load live data.' });
  }
});

// Publish: admin or owner only. Stores the merged dataset as the single "current" document.
app.post('/api/live-data', requireRole('admin'), async (req, res) => {
  try {
    const { data } = req.body || {};
    if (data == null) return res.status(400).json({ error: 'No data provided.' });
    const coll = await getCollection(COLLECTIONS.liveData);
    const meta = {
      publishedBy: req.user.username,
      publishedAt: new Date().toISOString(),
      count: Array.isArray(data) ? data.length : (data && data.tickets ? data.tickets.length : undefined),
    };
    await coll.updateOne(
      { _id: 'current' },
      { $set: { data, meta } },
      { upsert: true }
    );
    res.json({ ok: true, meta });
  } catch (e) {
    res.status(500).json({ error: 'Could not publish data.' });
  }
});

// ---- Quarter-based live data ----
// Which quarter is live right now (auto from server date), plus quarters present in DB.
app.get('/api/quarters', async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.quarters);
    const docs = await coll.find({}, { projection: { tickets: 0 } }).toArray();
    const live = currentQuarter();
    res.json({
      liveQuarter: live,
      liveLabel: quarterLabel(live),
      quarters: docs.map(d => ({
        id: d._id,
        label: quarterLabel(d._id),
        count: d.meta ? d.meta.count : undefined,
        publishedAt: d.meta ? d.meta.publishedAt : undefined,
        isLive: d._id === live,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not list quarters.' });
  }
});

// Public read: the current live quarter's dataset (tickets computed in the browser).
app.get('/api/live-quarter', async (req, res) => {
  try {
    const qid = currentQuarter();
    const range = quarterRange(qid);
    const coll = await getCollection(COLLECTIONS.quarters);
    const doc = await coll.findOne({ _id: qid });
    res.json({
      quarter: qid,
      label: quarterLabel(qid),
      range: range ? { start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString() } : null,
      isLive: true,
      data: doc ? doc.data : null,
      meta: doc ? doc.meta : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load live quarter.' });
  }
});

// Public read: any specific quarter's stored dataset (read-only display).
app.get('/api/quarter/:qid', async (req, res) => {
  try {
    const qid = req.params.qid;
    if (!/^\d{4}-Q[1-4]$/.test(qid)) return res.status(400).json({ error: 'Invalid quarter id.' });
    const coll = await getCollection(COLLECTIONS.quarters);
    const doc = await coll.findOne({ _id: qid });
    if (!doc) return res.json({ quarter: qid, label: quarterLabel(qid), data: null, meta: null, isLive: qid === currentQuarter() });
    res.json({ quarter: qid, label: quarterLabel(qid), data: doc.data, meta: doc.meta, isLive: qid === currentQuarter() });
  } catch (e) {
    res.status(500).json({ error: 'Could not load quarter.' });
  }
});

// Publish to the live quarter (admin+). Body: { data: { tickets: [...], updatedAt, count } }.
// Routes tickets by CreateDate: those in the live quarter update the live quarter doc.
// Tickets whose CreateDate falls in a NON-live quarter are reported back (crossQuarter) —
// they are only written to their own quarter doc if body.confirmCrossQuarter === true.
app.post('/api/live-quarter', requireRole('admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data;
    if (!data || !Array.isArray(data.tickets)) return res.status(400).json({ error: 'No tickets provided.' });
    const liveQ = currentQuarter();

    // Bucket incoming tickets by their CreateDate quarter.
    const byQuarter = {};
    let undated = 0;
    for (const t of data.tickets) {
      const q = quarterOf(t.CreateDate);
      if (!q) { undated++; (byQuarter[liveQ] = byQuarter[liveQ] || []).push(t); continue; }
      (byQuarter[q] = byQuarter[q] || []).push(t);
    }

    // Cross-quarter summary (anything not in the live quarter).
    const crossQuarter = Object.entries(byQuarter)
      .filter(([q]) => q !== liveQ)
      .map(([q, arr]) => ({ quarter: q, label: quarterLabel(q), count: arr.length }))
      .sort((a, b) => b.count - a.count);

    // If there are cross-quarter tickets and the client hasn't confirmed, do not write anything.
    if (crossQuarter.length && !body.confirmCrossQuarter) {
      return res.status(409).json({
        error: 'cross-quarter',
        liveQuarter: liveQ,
        liveLabel: quarterLabel(liveQ),
        crossQuarter,
        liveCount: (byQuarter[liveQ] || []).length,
      });
    }

    const coll = await getCollection(COLLECTIONS.quarters);
    const written = [];
    for (const [q, arr] of Object.entries(byQuarter)) {
      const meta = { publishedBy: req.user.username, publishedAt: new Date().toISOString(), count: arr.length };
      // Store the full dataset payload shape for this quarter (tickets + meta wrapper).
      const payload = { updatedAt: meta.publishedAt, count: arr.length, tickets: arr };
      await coll.updateOne({ _id: q }, { $set: { data: payload, meta } }, { upsert: true });
      written.push({ quarter: q, label: quarterLabel(q), count: arr.length, isLive: q === liveQ });
    }
    res.json({ ok: true, liveQuarter: liveQ, written, undated });
  } catch (e) {
    res.status(500).json({ error: 'Could not publish quarter data.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('PHD API listening on port ' + PORT));
