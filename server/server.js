// WWOS-GSOC PHD dashboard API — auth, user management, and live-data storage on MongoDB Atlas.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const { getDb, getCollection, COLLECTIONS } = require('./db');
const {
  VALID_ROLES, rank,
  hashPassword, verifyPassword,
  issueToken, attachUser, requireRole,
} = require('./auth');
const { quarterOf, currentQuarter, quarterRange, quarterLabel } = require('./quarters');

// Only the 2026-Q2 quarter records the specific ShortIds added/updated in each merge (per request).
const Q2_QUARTER = '2026-Q2';

// Fields that count as a real "change" when merging an uploaded ticket into a quarter doc. Used so a
// re-uploaded past-quarter ticket with no actual difference is treated as preserved, not "updated".
const MERGE_DIFF_FIELDS = ['Title', 'Status', 'Severity', 'AssigneeIdentity', 'ResolvedDate', 'Age', 'ClosureCode', 'ResolvedByIdentity', 'RootCause', 'RootCauseDetails', 'LastUpdatedDate'];
function ticketChanged(incoming, existing) {
  if (!existing) return true;
  return MERGE_DIFF_FIELDS.some(f => String(incoming[f] == null ? '' : incoming[f]) !== String(existing[f] == null ? '' : existing[f]));
}

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
// Valid per-user timezone preferences. IST = Asia/Kolkata, MST = America/Denver.
const VALID_TZ = ['IST', 'MST'];
const DEFAULT_TZ = 'IST';
function normTz(tz) { tz = String(tz || '').trim().toUpperCase(); return VALID_TZ.includes(tz) ? tz : DEFAULT_TZ; }

app.get('/api/me', requireRole('user'), async (req, res) => {
  let timezone = DEFAULT_TZ;
  try {
    const users = await getCollection(COLLECTIONS.users);
    const u = await users.findOne({ username: req.user.username }, { projection: { timezone: 1 } });
    if (u && u.timezone) timezone = normTz(u.timezone);
  } catch (e) { /* fall back to default */ }
  res.json({ username: req.user.username, role: req.user.role, timezone });
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
    // Owner-visible activity log — record WHO changed their password and WHEN (never the password itself).
    try {
      const logColl = await getCollection(COLLECTIONS.activityLog);
      await logColl.insertOne({ type: 'password_changed', user: user.username, role: user.role, at: new Date().toISOString() });
    } catch (logErr) { /* logging must never block the password change */ }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not change password.' });
  }
});

// Lightweight roster (username + role + displayName) for any logged-in user — used by the
// dashboard for the purple-ticket policy check and display names. Avatars are fetched separately
// (see /api/user-avatars) so this stays small.
app.get('/api/user-roles', requireRole('user'), async (req, res) => {
  try {
    const users = await getCollection(COLLECTIONS.users);
    // Slim: NO avatar (base64 images bloat this to hundreds of KB). Avatars load lazily via
    // /api/user-avatars only when the UI actually needs them (drill-down popups).
    const list = await users.find({}, { projection: { username: 1, role: 1, displayName: 1 } }).toArray();
    res.json(list.map(u => ({ username: u.username, role: u.role, displayName: u.displayName || '' })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load user roles.' });
  }
});

// Avatars only (username -> base64), for the users who have one. Fetched lazily/in the background
// so the roster load stays small. Logged-in only.
app.get('/api/user-avatars', requireRole('user'), async (req, res) => {
  try {
    const users = await getCollection(COLLECTIONS.users);
    const list = await users.find({ avatar: { $exists: true, $ne: '' } }, { projection: { username: 1, avatar: 1 } }).toArray();
    const out = {};
    list.forEach(u => { if (u.avatar) out[u.username] = u.avatar; });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'Could not load user avatars.' });
  }
});

// Max stored avatar size (base64 string length). Client resizes to ~128px JPEG (~5-25KB); cap generously.
const MAX_AVATAR_LEN = 200000; // ~200KB base64

// Get my own profile (displayName + avatar).
app.get('/api/me/profile', requireRole('user'), async (req, res) => {
  try {
    const users = await getCollection(COLLECTIONS.users);
    const u = await users.findOne({ username: req.user.username }, { projection: { username: 1, role: 1, displayName: 1, avatar: 1 } });
    if (!u) return res.status(404).json({ error: 'User not found.' });
    res.json({ username: u.username, role: u.role, displayName: u.displayName || '', avatar: u.avatar || '' });
  } catch (e) {
    res.status(500).json({ error: 'Could not load profile.' });
  }
});

// Update MY profile only (self-only): displayName and/or avatar. Server-side validates avatar.
app.post('/api/me/profile', requireRole('user'), async (req, res) => {
  try {
    const body = req.body || {};
    const set = {};
    if (body.displayName !== undefined) {
      const dn = String(body.displayName || '').trim();
      if (dn.length > 40) return res.status(400).json({ error: 'Display name must be 40 characters or fewer.' });
      set.displayName = dn;
    }
    if (body.avatar !== undefined) {
      const av = String(body.avatar || '');
      if (av) {
        if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(av)) {
          return res.status(400).json({ error: 'Unsupported image. Please upload a different image (PNG, JPG, GIF, or WebP).' });
        }
        if (av.length > MAX_AVATAR_LEN) {
          return res.status(400).json({ error: 'Image is too large even after resizing. Please upload a smaller / different image.' });
        }
      }
      set.avatar = av; // '' clears the avatar
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update.' });
    set.updatedAt = new Date().toISOString();
    const users = await getCollection(COLLECTIONS.users);
    await users.updateOne({ username: req.user.username }, { $set: set });
    const u = await users.findOne({ username: req.user.username }, { projection: { username: 1, role: 1, displayName: 1, avatar: 1 } });
    res.json({ username: u.username, role: u.role, displayName: u.displayName || '', avatar: u.avatar || '' });
  } catch (e) {
    res.status(500).json({ error: 'Could not update profile.' });
  }
});

// ---- User management (owner only) ----
app.get('/api/users', requireRole('owner'), async (req, res) => {
  const users = await getCollection(COLLECTIONS.users);
  const list = await users.find({}, { projection: { passwordHash: 0 } }).sort({ role: -1, username: 1 }).toArray();
  res.json(list.map(u => ({ id: String(u._id), username: u.username, role: u.role, timezone: normTz(u.timezone), displayName: u.displayName || '', avatar: u.avatar || '' })));
});

app.post('/api/users', requireRole('owner'), async (req, res) => {
  try {
    let { username, password, role, timezone } = req.body || {};
    username = String(username || '').trim().toLowerCase();
    role = String(role || 'user');
    const tz = normTz(timezone);
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (role === 'owner') return res.status(403).json({ error: 'Cannot create another owner.' });
    const users = await getCollection(COLLECTIONS.users);
    if (await users.findOne({ username })) return res.status(409).json({ error: 'Username already exists.' });
    const doc = { username, passwordHash: await hashPassword(password), role, timezone: tz, createdAt: new Date() };
    const r = await users.insertOne(doc);
    res.status(201).json({ id: String(r.insertedId), username, role, timezone: tz });
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

// Change a user's preferred timezone (owner only). Body: { timezone: 'IST' | 'MST' }.
app.patch('/api/users/:id/timezone', requireRole('owner'), async (req, res) => {
  try {
    const timezone = normTz((req.body || {}).timezone);
    const users = await getCollection(COLLECTIONS.users);
    const target = await users.findOne({ _id: new ObjectId(req.params.id) });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    await users.updateOne({ _id: target._id }, { $set: { timezone, updatedAt: new Date() } });
    res.json({ id: String(target._id), username: target.username, timezone });
  } catch (e) {
    res.status(500).json({ error: 'Could not change timezone.' });
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

// Reset a user's password to "<username>@123" (owner only). Cannot reset the owner's own password.
app.post('/api/users/:id/reset-password', requireRole('owner'), async (req, res) => {
  try {
    const users = await getCollection(COLLECTIONS.users);
    const target = await users.findOne({ _id: new ObjectId(req.params.id) });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.role === 'owner') return res.status(403).json({ error: "Cannot reset the owner's password." });
    const newPassword = target.username + '@123';
    await users.updateOne({ _id: target._id }, { $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() } });
    // Log the reset (never the password): who was reset, by whom, when.
    try {
      const logColl = await getCollection(COLLECTIONS.activityLog);
      await logColl.insertOne({
        type: 'password_reset', user: target.username, role: target.role,
        by: req.user.username, at: new Date().toISOString(),
      });
    } catch (logErr) { /* never block the reset */ }
    res.json({ ok: true, username: target.username });
  } catch (e) {
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

// Per-user blurb-copy breakdown (owner only): which user copied which blurb, how many times.
app.get('/api/blurb-copies', requireRole('owner'), async (req, res) => {
  try {
    const copies = await getCollection(COLLECTIONS.blurbCopies);
    const rows = await copies.find({}).sort({ count: -1 }).toArray();
    res.json(rows.map(r => ({
      user: r.user,
      role: r.role || '',
      blurbId: r.blurbId,
      blurbTitle: r.blurbTitle || '',
      count: r.count || 0,
      lastAt: r.lastAt || null,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load blurb copy activity.' });
  }
});

// Per-user hashtag-copy breakdown (owner only).
app.get('/api/hashtag-copies', requireRole('owner'), async (req, res) => {
  try {
    const copies = await getCollection(COLLECTIONS.hashtagCopies);
    const rows = await copies.find({}).sort({ count: -1 }).toArray();
    res.json(rows.map(r => ({ user: r.user, role: r.role || '', hashtagId: r.hashtagId, tag: r.tag || '', count: r.count || 0, lastAt: r.lastAt || null })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load hashtag copy activity.' });
  }
});

// Per-user paging-copy breakdown (owner only).
app.get('/api/paging-copies', requireRole('owner'), async (req, res) => {
  try {
    const copies = await getCollection(COLLECTIONS.pagingCopies);
    const rows = await copies.find({}).sort({ count: -1 }).toArray();
    res.json(rows.map(r => ({ user: r.user, role: r.role || '', pagingId: r.pagingId, label: r.label || '', email: r.email || '', count: r.count || 0, lastAt: r.lastAt || null })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load paging copy activity.' });
  }
});

// Account activity log (owner only): password changes etc. Never contains secrets. Newest first.
app.get('/api/activity-log', requireRole('owner'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.activityLog);
    const rows = await logColl.find({}).sort({ at: -1 }).limit(500).toArray();
    res.json(rows.map(e => ({ id: String(e._id), type: e.type || 'activity', user: e.user, role: e.role || '', by: e.by || null, at: e.at })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load activity log.' });
  }
});

// ---- Database health (owner only) ----
// Returns overall DB size + per-collection stats + a per-quarter ticket breakdown. Read-only.
app.get('/api/db-health', requireRole('owner'), async (req, res) => {
  try {
    const db = await getDb();
    const dbStats = await db.command({ dbStats: 1, scale: 1 });
    const cols = await db.listCollections().toArray();
    const collections = [];
    for (const c of cols) {
      try {
        const cs = await db.command({ collStats: c.name, scale: 1 });
        collections.push({
          name: c.name,
          count: cs.count || 0,
          dataSize: cs.size || 0,
          storageSize: cs.storageSize || 0,
          indexSize: cs.totalIndexSize || 0,
          indexes: cs.nindexes || 0,
          avgObjSize: cs.avgObjSize || 0,
        });
      } catch (e) { collections.push({ name: c.name, count: 0, error: true }); }
    }
    collections.sort((a, b) => (b.storageSize || 0) - (a.storageSize || 0));
    // Per-quarter ticket counts (the largest documents; watch the 16MB/doc Mongo limit).
    const quarters = [];
    try {
      const qColl = await getCollection(COLLECTIONS.quarters);
      const qDocs = await qColl.find({}).toArray();
      const DOC_LIMIT = 16 * 1024 * 1024;
      for (const doc of qDocs) {
        const tickets = (doc.data && Array.isArray(doc.data.tickets)) ? doc.data.tickets.length : 0;
        // Approximate document size (JSON byte length) to gauge headroom against the 16MB cap.
        let approxBytes = 0;
        try { approxBytes = Buffer.byteLength(JSON.stringify(doc)); } catch (e) {}
        quarters.push({
          id: doc._id,
          tickets,
          approxBytes,
          docLimitPct: +((approxBytes / DOC_LIMIT) * 100).toFixed(1),
          publishedAt: (doc.meta && doc.meta.publishedAt) || null,
          updatedAt: (doc.data && doc.data.updatedAt) || null,
        });
      }
    } catch (e) { /* quarters optional */ }
    let usersCount = 0;
    try { usersCount = await (await getCollection(COLLECTIONS.users)).countDocuments(); } catch (e) {}
    res.json({
      db: db.databaseName,
      generatedAt: new Date().toISOString(),
      tier: { name: 'MongoDB Atlas M0 (free)', limitBytes: 512 * 1024 * 1024 },
      totals: {
        collections: dbStats.collections || collections.length,
        objects: dbStats.objects || 0,
        dataSize: dbStats.dataSize || 0,
        storageSize: dbStats.storageSize || 0,
        indexSize: dbStats.indexSize || 0,
        totalSize: (dbStats.dataSize || 0) + (dbStats.indexSize || 0),
      },
      usersCount,
      collections,
      quarters,
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load database health.' });
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
    // Only pull the tiny meta fields — NEVER the (multi-MB) data.tickets arrays. Using an
    // inclusion projection guarantees the ticket payload is never shipped, no matter how it's
    // nested. (The old { tickets: 0 } excluded a top-level field that doesn't exist — tickets
    // live at data.tickets — so it returned every quarter's full ticket array = ~minutes/502.)
    const docs = await coll.find({}, { projection: { 'meta.count': 1, 'meta.publishedAt': 1 } }).toArray();
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

// Cheap version check: ONLY the current live quarter's id + label + publishedAt (one findOne,
// no ticket payload, no other quarters). This is what the live dashboard's cache uses to decide
// "is my data current?" — so it never needs the full /api/quarters catalog on load.
app.get('/api/live-version', async (req, res) => {
  try {
    const qid = currentQuarter();
    const coll = await getCollection(COLLECTIONS.quarters);
    const doc = await coll.findOne({ _id: qid }, { projection: { 'meta.publishedAt': 1, 'meta.count': 1, 'data.updatedAt': 1 } });
    res.json({
      quarter: qid,
      label: quarterLabel(qid),
      publishedAt: (doc && doc.meta && doc.meta.publishedAt) || (doc && doc.data && doc.data.updatedAt) || null,
      count: (doc && doc.meta && doc.meta.count) != null ? doc.meta.count : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not read live version.' });
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
// Routes tickets by CreateDate: the live-quarter bucket REPLACES the live doc (client already
// merged locally). Non-live buckets are MERGED by ShortId into their own quarter doc (uploaded
// wins, existing preserved). Each quarter touched gets its OWN data-log entry. The client shows
// the per-quarter breakdown + Upload/Cancel before calling this, so no server-side 409 is needed.
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

    const coll = await getCollection(COLLECTIONS.quarters);
    const logColl = await getCollection(COLLECTIONS.dataLog);
    const written = [];
    const publishedAt = new Date().toISOString();

    // Write each quarter bucket to its own doc.
    //  - LIVE quarter: the client already merged the new file into the full live dataset locally,
    //    so this bucket IS the complete live dataset -> REPLACE the live quarter doc.
    //  - NON-LIVE quarters (e.g. Q2 tickets in a Q3-live upload): these are only the rows from the
    //    uploaded file, so MERGE them by ShortId into the existing quarter doc (uploaded wins,
    //    existing preserved). Each quarter gets its OWN data-log entry.
    for (const [q, arr] of Object.entries(byQuarter)) {
      const isLive = (q === liveQ);
      if (isLive) {
        const meta = { publishedBy: req.user.username, publishedAt, count: arr.length };
        const payload = { updatedAt: publishedAt, count: arr.length, tickets: arr };
        await coll.updateOne({ _id: q }, { $set: { data: payload, meta } }, { upsert: true });
        written.push({ quarter: q, label: quarterLabel(q), count: arr.length, isLive: true });
        // Live-quarter data-log entry (uses the client's browser merge report).
        try {
          await logColl.insertOne({
            user: req.user.username, role: req.user.role, at: publishedAt,
            liveQuarter: q, pastQuarterMerge: false, publishedAt,
            written: [{ quarter: q, label: quarterLabel(q), count: arr.length, isLive: true }],
            changeSummary: body.changeSummary || null,
            totalTickets: arr.length,
          });
        } catch (logErr) { /* never block publish */ }
      } else {
        // Merge by ShortId into the existing non-live quarter doc.
        const existingDoc = await coll.findOne({ _id: q });
        const existingTickets = (existingDoc && existingDoc.data && existingDoc.data.tickets) || [];
        const map = new Map();
        existingTickets.forEach(t => { const id = String(t.ShortId || t.IssueId || '').trim(); if (id) map.set(id, t); });
        const dbBefore = map.size;
        let added = 0, updated = 0, unchanged = 0;
        const addedIds = [], updatedIds = [];
        for (const t of arr) {
          if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
          const id = String(t.ShortId || '').trim(); if (!id) continue;
          const existing = map.get(id);
          if (!existing) { added++; addedIds.push(id); map.set(id, t); }
          else if (ticketChanged(t, existing)) { updated++; updatedIds.push(id); map.set(id, t); } // real change -> uploaded wins
          else { unchanged++; } // identical -> keep stored, don't log as updated
        }
        const merged = Array.from(map.values());
        const qSummary = { added, updated, unchanged, preserved: dbBefore - updated, uploaded: arr.length, total: merged.length };
        const meta = { publishedBy: req.user.username, publishedAt, count: merged.length, changeSummary: qSummary };
        const payload = { updatedAt: publishedAt, count: merged.length, tickets: merged };
        await coll.updateOne({ _id: q }, { $set: { data: payload, meta } }, { upsert: true });
        written.push({ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false, merged: true });
        // Non-live (past) quarter data-log entry — only when something actually changed.
        if (added > 0 || updated > 0) try {
          const logDoc = {
            user: req.user.username, role: req.user.role, at: publishedAt,
            liveQuarter: q, pastQuarterMerge: true,
            written: [{ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false }],
            changeSummary: qSummary,
            totalTickets: merged.length,
          };
          // Only for 2026-Q2: record which ShortIds were added/updated.
          if (q === Q2_QUARTER) logDoc.changedTickets = { added: addedIds, updated: updatedIds };
          await logColl.insertOne(logDoc);
        } catch (logErr) { /* never block publish */ }
      }
    }

    res.json({ ok: true, liveQuarter: liveQ, written, undated });
    // Refresh the precomputed dashboard rollup so /api/dash/* stays instant (best-effort).
    recomputeRollup(liveQ).catch(e => console.error('rollup recompute after publish failed:', e && e.message));
  } catch (e) {
    res.status(500).json({ error: 'Could not publish quarter data.' });
  }
});

// DELTA publish (admin+): apply ONLY the changed/new live-quarter tickets to the live quarter doc
// by ShortId, instead of replacing the entire dataset. Much smaller payload + faster write.
// Body: { changed: [ ...live tickets ], removed: [ shortId ], nonLive: [ ...rows ], changeSummary }.
// If the live quarter doc doesn't exist yet, respond 409 so the client falls back to full replace.
app.post('/api/live-quarter/patch', requireRole('admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const changed = Array.isArray(body.changed) ? body.changed : [];
    const removed = Array.isArray(body.removed) ? body.removed.map(String) : [];
    const nonLive = Array.isArray(body.nonLive) ? body.nonLive : [];
    // Uploaded-file metadata (captured client-side), stored on the data-log entry. Sanitised.
    const fileMeta = {
      fileName: String(body.fileName || '').slice(0, 260),
      fileSize: Number.isFinite(+body.fileSize) && +body.fileSize > 0 ? Math.round(+body.fileSize) : 0,
      fileType: String(body.fileType || '').slice(0, 120),
    };
    const liveQ = currentQuarter();
    const coll = await getCollection(COLLECTIONS.quarters);
    const logColl = await getCollection(COLLECTIONS.dataLog);
    const publishedAt = new Date().toISOString();

    // Live quarter must already exist for a delta; otherwise tell client to do a full replace.
    const liveDoc = await coll.findOne({ _id: liveQ });
    if (!liveDoc || !liveDoc.data || !Array.isArray(liveDoc.data.tickets)) {
      return res.status(409).json({ error: 'No live dataset to patch — do a full publish.', needFull: true });
    }

    // Apply the delta by ShortId onto the existing live tickets.
    const map = new Map();
    liveDoc.data.tickets.forEach(t => { const id = String(t.ShortId || t.IssueId || '').trim(); if (id) map.set(id, t); });
    let applied = 0;
    for (const t of changed) {
      if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
      const id = String(t.ShortId || '').trim(); if (!id) continue;
      map.set(id, t); applied++;
    }
    let removedCount = 0;
    for (const id of removed) { if (map.delete(String(id).trim())) removedCount++; }

    const mergedLive = Array.from(map.values());
    const meta = { publishedBy: req.user.username, publishedAt, count: mergedLive.length };
    const payload = { updatedAt: publishedAt, count: mergedLive.length, tickets: mergedLive };
    await coll.updateOne({ _id: liveQ }, { $set: { data: payload, meta } }, { upsert: true });

    const written = [{ quarter: liveQ, label: quarterLabel(liveQ), count: mergedLive.length, isLive: true }];
    // Live-quarter data-log entry (browser merge report).
    try {
      await logColl.insertOne({
        user: req.user.username, role: req.user.role, at: publishedAt,
        liveQuarter: liveQ, pastQuarterMerge: false, publishedAt,
        written: [{ quarter: liveQ, label: quarterLabel(liveQ), count: mergedLive.length, isLive: true }],
        changeSummary: body.changeSummary || null,
        fileName: fileMeta.fileName, fileSize: fileMeta.fileSize, fileType: fileMeta.fileType,
        totalTickets: mergedLive.length,
      });
    } catch (logErr) { /* never block */ }

    // Merge any non-live rows into their own quarter docs (same rules as the full endpoint).
    const byQuarter = {};
    for (const t of nonLive) {
      const q = quarterOf(t.CreateDate) || liveQ;
      if (q === liveQ) continue; // safety: don't route live rows here
      (byQuarter[q] = byQuarter[q] || []).push(t);
    }
    for (const [q, arr] of Object.entries(byQuarter)) {
      const existingDoc = await coll.findOne({ _id: q });
      const existingTickets = (existingDoc && existingDoc.data && existingDoc.data.tickets) || [];
      const qmap = new Map();
      existingTickets.forEach(t => { const id = String(t.ShortId || t.IssueId || '').trim(); if (id) qmap.set(id, t); });
      const dbBefore = qmap.size;
      let added = 0, updated = 0, unchanged = 0; const addedIds = [], updatedIds = [];
      for (const t of arr) {
        if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
        const id = String(t.ShortId || '').trim(); if (!id) continue;
        const existing = qmap.get(id);
        if (!existing) { added++; addedIds.push(id); qmap.set(id, t); }
        else if (ticketChanged(t, existing)) { updated++; updatedIds.push(id); qmap.set(id, t); } // real change only
        else { unchanged++; } // identical -> preserved, not logged as updated
      }
      const merged = Array.from(qmap.values());
      const qSummary = { added, updated, unchanged, preserved: dbBefore - updated, uploaded: arr.length, total: merged.length };
      await coll.updateOne({ _id: q }, { $set: { data: { updatedAt: publishedAt, count: merged.length, tickets: merged }, meta: { publishedBy: req.user.username, publishedAt, count: merged.length, changeSummary: qSummary } } }, { upsert: true });
      written.push({ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false, merged: true });
      if (added > 0 || updated > 0) try {
        const logDoc = { user: req.user.username, role: req.user.role, at: publishedAt, liveQuarter: q, pastQuarterMerge: true, written: [{ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false }], changeSummary: qSummary, totalTickets: merged.length };
        if (q === Q2_QUARTER) logDoc.changedTickets = { added: addedIds, updated: updatedIds };
        await logColl.insertOne(logDoc);
      } catch (logErr) { /* never block */ }
    }

    res.json({ ok: true, liveQuarter: liveQ, written, applied, removed: removedCount });
    // Refresh the precomputed dashboard rollup so /api/dash/* stays instant (best-effort).
    recomputeRollup(liveQ).catch(e => console.error('rollup recompute after patch failed:', e && e.message));
  } catch (e) {
    res.status(500).json({ error: 'Could not apply the delta publish.' });
  }
});

// Merge an uploaded ticket set INTO a specific PAST (non-live) quarter, by ShortId (admin+).
// Newly uploaded tickets win on conflict; existing tickets not in the upload are preserved.
// Records a data-log entry. Body: { data: { tickets: [...] } }.
app.post('/api/quarter/:qid/merge', requireRole('admin'), async (req, res) => {
  try {
    const qid = req.params.qid;
    if (!/^\d{4}-Q[1-4]$/.test(qid)) return res.status(400).json({ error: 'Invalid quarter id.' });
    if (qid === currentQuarter()) {
      return res.status(400).json({ error: 'This is the live quarter — use the live dashboard upload instead.' });
    }
    const body = req.body || {};
    const data = body.data;
    if (!data || !Array.isArray(data.tickets)) return res.status(400).json({ error: 'No tickets provided.' });

    const coll = await getCollection(COLLECTIONS.quarters);
    const existingDoc = await coll.findOne({ _id: qid });
    const existingTickets = (existingDoc && existingDoc.data && existingDoc.data.tickets) || [];

    // Merge by ShortId: start with existing, then apply uploaded (uploaded wins).
    const map = new Map();
    existingTickets.forEach(t => { const id = String(t.ShortId || t.IssueId || '').trim(); if (id) map.set(id, t); });
    const dbBefore = map.size;

    let added = 0, updated = 0, unchanged = 0, skippedNoId = 0;
    const addedIds = [], updatedIds = [];
    for (const t of data.tickets) {
      if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
      const id = String(t.ShortId || '').trim();
      if (!id) { skippedNoId++; continue; }
      const existing = map.get(id);
      if (!existing) { added++; addedIds.push(id); map.set(id, t); }
      else if (ticketChanged(t, existing)) { updated++; updatedIds.push(id); map.set(id, t); } // real change only
      else { unchanged++; } // identical -> preserved, not logged as updated
    }
    const merged = Array.from(map.values());
    const publishedAt = new Date().toISOString();
    const changeSummary = {
      added,                          // tickets not previously in this quarter
      updated,                        // existing tickets with a real field change
      unchanged,                      // uploaded but identical -> not overwritten
      preserved: dbBefore - updated,  // existing tickets kept (not changed / not in the upload)
      uploaded: data.tickets.length,
      total: merged.length,
    };

    const meta = { publishedBy: req.user.username, publishedAt, count: merged.length, changeSummary };
    const payload = { updatedAt: publishedAt, count: merged.length, tickets: merged };
    await coll.updateOne({ _id: qid }, { $set: { data: payload, meta } }, { upsert: true });

    // Audit-log entry (mirrors the live-quarter publish log shape; marks this as a past-quarter merge).
    try {
      const logColl = await getCollection(COLLECTIONS.dataLog);
      const logDoc = {
        user: req.user.username,
        role: req.user.role,
        at: publishedAt,
        liveQuarter: qid,             // the quarter this action targeted
        pastQuarterMerge: true,       // flag so the data log can label it
        written: [{ quarter: qid, label: quarterLabel(qid), count: merged.length, isLive: false }],
        changeSummary,
        totalTickets: merged.length,
      };
      // Only for 2026-Q2: record which ShortIds were added/updated.
      if (qid === Q2_QUARTER) logDoc.changedTickets = { added: addedIds, updated: updatedIds };
      await logColl.insertOne(logDoc);
    } catch (logErr) { /* logging must never block a successful merge */ }

    res.json({ ok: true, quarter: qid, label: quarterLabel(qid), changeSummary });
  } catch (e) {
    res.status(500).json({ error: 'Could not merge quarter data.' });
  }
});

// Audit log of uploads/publishes (logged-in users only). Newest first.
app.get('/api/data-log', requireRole('user'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.dataLog);
    // Day-windowed pagination: return only entries from the most-recent N DISTINCT upload days
    // (in the requesting user's timezone). The client asks for more days via ?days=N ("Load more").
    // Keeps the payload small instead of shipping the whole history every time.
    let days = parseInt(req.query.days, 10);
    if (!Number.isFinite(days) || days < 1) days = 3;
    if (days > 3650) days = 3650; // sanity cap

    // Resolve the user's timezone (IST/MST) so day boundaries match what they see.
    let tz = DEFAULT_TZ;
    try {
      const users = await getCollection(COLLECTIONS.users);
      const u = await users.findOne({ username: req.user.username }, { projection: { timezone: 1 } });
      if (u && u.timezone) tz = normTz(u.timezone);
    } catch (e) { /* default tz */ }
    const zone = tz === 'MST' ? 'America/Denver' : 'Asia/Kolkata';
    const dayKey = (iso) => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: zone }); } catch (e) { return null; } };

    // Pull newest-first; walk until we've collected `days` distinct day-keys, then note if more remain.
    const all = await logColl.find({}).sort({ at: -1 }).toArray();
    const seenDays = new Set();
    const kept = [];
    let hasMore = false;
    for (const e of all) {
      const dk = dayKey(e.at);
      if (dk && !seenDays.has(dk)) {
        if (seenDays.size >= days) { hasMore = true; break; } // this entry starts a day beyond the window
        seenDays.add(dk);
      }
      kept.push(e);
    }

    res.json({
      days,
      daysReturned: seenDays.size,
      hasMore,
      entries: kept.map(e => ({
        id: String(e._id),
        user: e.user,
        role: e.role,
        at: e.at,
        liveQuarter: e.liveQuarter,
        pastQuarterMerge: !!e.pastQuarterMerge,
        publishedAt: e.publishedAt || null,
        written: e.written || [],
        changeSummary: e.changeSummary || null,
        changedTickets: e.changedTickets || null,
        fileName: e.fileName || '',
        fileSize: e.fileSize || 0,
        fileType: e.fileType || '',
        totalTickets: e.totalTickets,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load data log.' });
  }
});

// Delete a data-log entry (owner only).
app.delete('/api/data-log/:id', requireRole('owner'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.dataLog);
    const r = await logColl.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Log entry not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete the log entry.' });
  }
});

// ---- Common Blurbs ----
// Public: list all blurbs (ordered).
app.get('/api/blurbs', async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.blurbs);
    // Base order (manual order) first so it acts as the tie-breaker, then sort by copyCount desc.
    const list = await coll.find({}).sort({ order: 1, createdAt: 1 }).toArray();
    list.sort((a, b) => (b.copyCount || 0) - (a.copyCount || 0)); // stable: ties keep manual order
    res.json(list.map(b => ({
      id: String(b._id),
      title: b.title,
      text: b.text,
      copyCount: b.copyCount || 0,
      updatedBy: b.updatedBy || b.createdBy || null,
      updatedAt: b.updatedAt || b.createdAt || null,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load blurbs.' });
  }
});

// Record a copy of a blurb (logged-in only). Atomically increments the shared global count AND
// upserts a per-user tally (user + blurbId) for the owner-visible breakdown. Returns the new count.
// ---- Copy-count persistence across delete + re-add ----
// Copy counts live on the item doc (copyCount) + per-user tallies keyed by the item _id. A plain
// edit keeps the same _id (count preserved), but delete+re-add makes a NEW _id, orphaning the count.
// To preserve it, on delete we stash the count + per-user tallies keyed by a stable content
// signature; on (re-)create we restore them onto the new doc if a matching stash exists.
// Content signatures (case-normalized): blurb=title|text, hashtag=tag, paging=code.
function copySig(kind, doc) {
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  if (kind === 'blurb') return norm(doc.title) + '\u0001' + norm(doc.text);
  if (kind === 'hashtag') return norm(doc.tag);
  if (kind === 'paging') return norm(doc.code);
  return '';
}
// On delete: move the item's copyCount + its per-user tally rows into the archive (keyed kind+sig).
// If an archive already exists for that sig, keep the larger count and merge tallies.
async function archiveCopyCount(kind, sig, copyCount, tallyCollName, idField, id) {
  if (!sig) return;
  try {
    const tallyColl = await getCollection(tallyCollName);
    const tallies = await tallyColl.find({ [idField]: String(id) }).toArray();
    const archive = await getCollection(COLLECTIONS.copyCountArchive);
    const existing = await archive.findOne({ kind, sig });
    const mergedTallies = (existing && Array.isArray(existing.tallies)) ? existing.tallies.slice() : [];
    // Merge new tallies into any existing archived ones (sum per user).
    tallies.forEach((t) => {
      const prev = mergedTallies.find((x) => x.user === t.user);
      if (prev) { prev.count = (prev.count || 0) + (t.count || 0); if ((t.lastAt || '') > (prev.lastAt || '')) prev.lastAt = t.lastAt; }
      else mergedTallies.push({ user: t.user, role: t.role || '', count: t.count || 0, lastAt: t.lastAt || null });
    });
    const bestCount = Math.max(copyCount || 0, (existing && existing.copyCount) || 0);
    await archive.updateOne({ kind, sig }, { $set: { kind, sig, copyCount: bestCount, tallies: mergedTallies, at: new Date().toISOString() } }, { upsert: true });
    // Remove the now-stale per-user tally rows for the deleted item.
    await tallyColl.deleteMany({ [idField]: String(id) });
  } catch (e) { /* archiving must never block the delete */ }
}
// On create: if an archived count matches this content, restore copyCount onto the new doc and
// re-create the per-user tally rows pointing at the new _id; then clear the archive entry.
// Returns the restored copyCount (0 if none).
async function restoreCopyCount(kind, sig, itemCollName, tallyCollName, idField, newId, tallySetFields) {
  if (!sig) return 0;
  try {
    const archive = await getCollection(COLLECTIONS.copyCountArchive);
    const stash = await archive.findOne({ kind, sig });
    if (!stash) return 0;
    const itemColl = await getCollection(itemCollName);
    await itemColl.updateOne({ _id: newId }, { $set: { copyCount: stash.copyCount || 0 } });
    if (Array.isArray(stash.tallies) && stash.tallies.length) {
      const tallyColl = await getCollection(tallyCollName);
      for (const t of stash.tallies) {
        await tallyColl.updateOne(
          { user: t.user, [idField]: String(newId) },
          { $set: Object.assign({ count: t.count || 0, role: t.role || '', lastAt: t.lastAt || null }, tallySetFields || {}) },
          { upsert: true }
        );
      }
    }
    await archive.deleteOne({ _id: stash._id });
    return stash.copyCount || 0;
  } catch (e) { return 0; }
}

app.post('/api/blurbs/:id/copy', requireRole('user'), async (req, res) => {
  try {
    let _id;
    try { _id = new ObjectId(req.params.id); } catch (e) { return res.status(400).json({ error: 'Invalid blurb id.' }); }
    const coll = await getCollection(COLLECTIONS.blurbs);
    const updated = await coll.findOneAndUpdate(
      { _id },
      { $inc: { copyCount: 1 } },
      { returnDocument: 'after' }
    );
    const doc = updated && (updated.value || updated); // driver compatibility
    if (!doc || !doc._id) return res.status(404).json({ error: 'Blurb not found.' });
    // Per-user tally (universal, one shared counter per user+blurb).
    try {
      const copies = await getCollection(COLLECTIONS.blurbCopies);
      await copies.updateOne(
        { user: req.user.username, blurbId: String(_id) },
        { $inc: { count: 1 }, $set: { blurbTitle: doc.title || '', role: req.user.role, lastAt: new Date().toISOString() } },
        { upsert: true }
      );
    } catch (tallyErr) { /* never block the copy count */ }
    res.json({ ok: true, id: String(_id), copyCount: doc.copyCount || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Could not record copy.' });
  }
});

// Create a blurb (admin+). Records a blurb-log entry.
app.post('/api/blurbs', requireRole('admin'), async (req, res) => {
  try {
    let { title, text } = req.body || {};
    title = String(title || '').trim();
    text = String(text || '');
    if (!title || !text.trim()) return res.status(400).json({ error: 'Title and blurb text are required.' });
    const coll = await getCollection(COLLECTIONS.blurbs);
    const now = new Date().toISOString();
    // place new blurbs at the end
    const last = await coll.find({}).sort({ order: -1 }).limit(1).toArray();
    const order = last.length && typeof last[0].order === 'number' ? last[0].order + 1 : 1;
    const doc = { title, text, createdBy: req.user.username, createdAt: now, updatedBy: req.user.username, updatedAt: now, order };
    const r = await coll.insertOne(doc);
    // Restore any copy count stashed when a blurb with identical title+text was previously deleted.
    await restoreCopyCount('blurb', copySig('blurb', { title, text }), COLLECTIONS.blurbs, COLLECTIONS.blurbCopies, 'blurbId', r.insertedId, { blurbTitle: title });
    try {
      const logColl = await getCollection(COLLECTIONS.blurbLog);
      await logColl.insertOne({ action: 'create', blurbId: String(r.insertedId), title, user: req.user.username, role: req.user.role, at: now, after: { title, text } });
    } catch (logErr) { /* never block */ }
    res.status(201).json({ id: String(r.insertedId), title, text });
  } catch (e) {
    res.status(500).json({ error: 'Could not create blurb.' });
  }
});

// Edit a blurb (admin+). Records a blurb-log entry with before/after.
app.put('/api/blurbs/:id', requireRole('admin'), async (req, res) => {
  try {
    let { title, text } = req.body || {};
    title = String(title || '').trim();
    text = String(text || '');
    if (!title || !text.trim()) return res.status(400).json({ error: 'Title and blurb text are required.' });
    const coll = await getCollection(COLLECTIONS.blurbs);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Blurb not found.' });
    const now = new Date().toISOString();
    await coll.updateOne({ _id: existing._id }, { $set: { title, text, updatedBy: req.user.username, updatedAt: now } });
    try {
      const logColl = await getCollection(COLLECTIONS.blurbLog);
      await logColl.insertOne({
        action: 'edit', blurbId: String(existing._id), title, user: req.user.username, role: req.user.role, at: now,
        before: { title: existing.title, text: existing.text }, after: { title, text },
      });
    } catch (logErr) { /* never block */ }
    res.json({ id: String(existing._id), title, text });
  } catch (e) {
    res.status(500).json({ error: 'Could not update blurb.' });
  }
});

// Delete a blurb (admin+). Records a blurb-log entry.
app.delete('/api/blurbs/:id', requireRole('admin'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.blurbs);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Blurb not found.' });
    // Stash the copy count so a later re-add of the same blurb restores it.
    await archiveCopyCount('blurb', copySig('blurb', existing), existing.copyCount || 0, COLLECTIONS.blurbCopies, 'blurbId', existing._id);
    await coll.deleteOne({ _id: existing._id });
    try {
      const logColl = await getCollection(COLLECTIONS.blurbLog);
      await logColl.insertOne({
        action: 'delete', blurbId: String(existing._id), title: existing.title,
        user: req.user.username, role: req.user.role, at: new Date().toISOString(),
        before: { title: existing.title, text: existing.text },
      });
    } catch (logErr) { /* never block */ }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete blurb.' });
  }
});

// Blurb audit log (logged-in users only). Newest first.
app.get('/api/blurb-log', requireRole('user'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.blurbLog);
    const entries = await logColl.find({}).sort({ at: -1 }).limit(300).toArray();
    res.json(entries.map(e => ({
      id: String(e._id),
      action: e.action,
      blurbId: e.blurbId,
      title: e.title,
      user: e.user,
      role: e.role,
      at: e.at,
      before: e.before || null,
      after: e.after || null,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load blurb log.' });
  }
});

// Delete a blurb-log entry (owner only).
app.delete('/api/blurb-log/:id', requireRole('owner'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.blurbLog);
    const r = await logColl.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Log entry not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete log entry.' });
  }
});

// ---- Hashtags ----
// Public: list all hashtags (ordered).
app.get('/api/hashtags', async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.hashtags);
    const list = await coll.find({}).sort({ order: 1, createdAt: 1 }).toArray();
    list.sort((a, b) => (b.copyCount || 0) - (a.copyCount || 0)); // most-copied first; ties keep manual order
    res.json(list.map(h => ({
      id: String(h._id),
      tag: h.tag,
      desc: h.desc,
      copyCount: h.copyCount || 0,
      updatedBy: h.updatedBy || h.createdBy || null,
      updatedAt: h.updatedAt || h.createdAt || null,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load hashtags.' });
  }
});

// Record a copy of a hashtag (logged-in only). Atomically increments the shared global count AND
// upserts a per-user tally. Returns the new count.
app.post('/api/hashtags/:id/copy', requireRole('user'), async (req, res) => {
  try {
    let _id;
    try { _id = new ObjectId(req.params.id); } catch (e) { return res.status(400).json({ error: 'Invalid hashtag id.' }); }
    const coll = await getCollection(COLLECTIONS.hashtags);
    const updated = await coll.findOneAndUpdate({ _id }, { $inc: { copyCount: 1 } }, { returnDocument: 'after' });
    const doc = updated && (updated.value || updated);
    if (!doc || !doc._id) return res.status(404).json({ error: 'Hashtag not found.' });
    try {
      const copies = await getCollection(COLLECTIONS.hashtagCopies);
      await copies.updateOne(
        { user: req.user.username, hashtagId: String(_id) },
        { $inc: { count: 1 }, $set: { tag: doc.tag || '', role: req.user.role, lastAt: new Date().toISOString() } },
        { upsert: true }
      );
    } catch (tallyErr) { /* never block */ }
    res.json({ ok: true, id: String(_id), copyCount: doc.copyCount || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Could not record copy.' });
  }
});

// Create a hashtag (admin+). Records a hashtag-log entry.
app.post('/api/hashtags', requireRole('admin'), async (req, res) => {
  try {
    let { tag, desc } = req.body || {};
    tag = String(tag || '').trim().replace(/^#/, ''); // store without leading '#'
    desc = String(desc || '');
    if (!tag || !desc.trim()) return res.status(400).json({ error: 'Hashtag and description are required.' });
    const coll = await getCollection(COLLECTIONS.hashtags);
    const now = new Date().toISOString();
    const last = await coll.find({}).sort({ order: -1 }).limit(1).toArray();
    const order = last.length && typeof last[0].order === 'number' ? last[0].order + 1 : 1;
    const doc = { tag, desc, createdBy: req.user.username, createdAt: now, updatedBy: req.user.username, updatedAt: now, order };
    const r = await coll.insertOne(doc);
    // Restore any copy count stashed when a hashtag with the same tag was previously deleted.
    await restoreCopyCount('hashtag', copySig('hashtag', { tag }), COLLECTIONS.hashtags, COLLECTIONS.hashtagCopies, 'hashtagId', r.insertedId, { tag });
    try {
      const logColl = await getCollection(COLLECTIONS.hashtagLog);
      await logColl.insertOne({ action: 'create', hashtagId: String(r.insertedId), tag, user: req.user.username, role: req.user.role, at: now, after: { tag, desc } });
    } catch (logErr) { /* never block */ }
    res.status(201).json({ id: String(r.insertedId), tag, desc });
  } catch (e) {
    res.status(500).json({ error: 'Could not create hashtag.' });
  }
});

// Edit a hashtag (admin+). Records a hashtag-log entry with before/after.
app.put('/api/hashtags/:id', requireRole('admin'), async (req, res) => {
  try {
    let { tag, desc } = req.body || {};
    tag = String(tag || '').trim().replace(/^#/, '');
    desc = String(desc || '');
    if (!tag || !desc.trim()) return res.status(400).json({ error: 'Hashtag and description are required.' });
    const coll = await getCollection(COLLECTIONS.hashtags);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Hashtag not found.' });
    const now = new Date().toISOString();
    await coll.updateOne({ _id: existing._id }, { $set: { tag, desc, updatedBy: req.user.username, updatedAt: now } });
    try {
      const logColl = await getCollection(COLLECTIONS.hashtagLog);
      await logColl.insertOne({
        action: 'edit', hashtagId: String(existing._id), tag, user: req.user.username, role: req.user.role, at: now,
        before: { tag: existing.tag, desc: existing.desc }, after: { tag, desc },
      });
    } catch (logErr) { /* never block */ }
    res.json({ id: String(existing._id), tag, desc });
  } catch (e) {
    res.status(500).json({ error: 'Could not update hashtag.' });
  }
});

// Delete a hashtag (admin+). Records a hashtag-log entry.
app.delete('/api/hashtags/:id', requireRole('admin'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.hashtags);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Hashtag not found.' });
    // Stash the copy count so a later re-add of the same tag restores it.
    await archiveCopyCount('hashtag', copySig('hashtag', existing), existing.copyCount || 0, COLLECTIONS.hashtagCopies, 'hashtagId', existing._id);
    await coll.deleteOne({ _id: existing._id });
    try {
      const logColl = await getCollection(COLLECTIONS.hashtagLog);
      await logColl.insertOne({
        action: 'delete', hashtagId: String(existing._id), tag: existing.tag,
        user: req.user.username, role: req.user.role, at: new Date().toISOString(),
        before: { tag: existing.tag, desc: existing.desc },
      });
    } catch (logErr) { /* never block */ }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete hashtag.' });
  }
});

// Hashtag audit log (logged-in users only). Newest first.
app.get('/api/hashtag-log', requireRole('user'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.hashtagLog);
    const entries = await logColl.find({}).sort({ at: -1 }).limit(300).toArray();
    res.json(entries.map(e => ({
      id: String(e._id), action: e.action, hashtagId: e.hashtagId, tag: e.tag,
      user: e.user, role: e.role, at: e.at, before: e.before || null, after: e.after || null,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load hashtag log.' });
  }
});

// Delete a hashtag-log entry (owner only).
app.delete('/api/hashtag-log/:id', requireRole('owner'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.hashtagLog);
    const r = await logColl.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Log entry not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete log entry.' });
  }
});

// ---- Paging contacts ---- (no edit/delete by design)
// Public: list all paging contacts (ordered).
app.get('/api/paging', async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.paging);
    const list = await coll.find({}).sort({ order: 1, createdAt: 1 }).toArray();
    list.sort((a, b) => (b.copyCount || 0) - (a.copyCount || 0)); // most-copied first; ties keep manual order
    res.json(list.map(p => ({ id: String(p._id), country: p.country, code: p.code, email: p.email, copyCount: p.copyCount || 0 })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load paging contacts.' });
  }
});

// Record a copy of a paging contact's email (logged-in only). Atomically increments the shared
// global count AND upserts a per-user tally. Returns the new count.
app.post('/api/paging/:id/copy', requireRole('user'), async (req, res) => {
  try {
    let _id;
    try { _id = new ObjectId(req.params.id); } catch (e) { return res.status(400).json({ error: 'Invalid paging id.' }); }
    const coll = await getCollection(COLLECTIONS.paging);
    const updated = await coll.findOneAndUpdate({ _id }, { $inc: { copyCount: 1 } }, { returnDocument: 'after' });
    const doc = updated && (updated.value || updated);
    if (!doc || !doc._id) return res.status(404).json({ error: 'Paging contact not found.' });
    try {
      const copies = await getCollection(COLLECTIONS.pagingCopies);
      const label = [doc.country, doc.code].filter(Boolean).join(' · ');
      await copies.updateOne(
        { user: req.user.username, pagingId: String(_id) },
        { $inc: { count: 1 }, $set: { label, email: doc.email || '', role: req.user.role, lastAt: new Date().toISOString() } },
        { upsert: true }
      );
    } catch (tallyErr) { /* never block */ }
    res.json({ ok: true, id: String(_id), copyCount: doc.copyCount || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Could not record copy.' });
  }
});

// Add a paging contact (admin+). All three fields required. Records a paging-log entry.
app.post('/api/paging', requireRole('admin'), async (req, res) => {
  try {
    let { country, code, email } = req.body || {};
    country = String(country || '').trim();
    code = String(code || '').trim().toUpperCase();
    email = String(email || '').trim();
    if (!country || !code || !email) return res.status(400).json({ error: 'Country, code, and email are all required.' });
    const coll = await getCollection(COLLECTIONS.paging);
    if (await coll.findOne({ code })) return res.status(409).json({ error: 'A contact with code "' + code + '" already exists.' });
    const now = new Date().toISOString();
    const last = await coll.find({}).sort({ order: -1 }).limit(1).toArray();
    const order = last.length && typeof last[0].order === 'number' ? last[0].order + 1 : 1;
    const r = await coll.insertOne({ country, code, email, createdBy: req.user.username, createdAt: now, order });
    // Restore any copy count stashed when a paging contact with the same code was previously deleted.
    await restoreCopyCount('paging', copySig('paging', { code }), COLLECTIONS.paging, COLLECTIONS.pagingCopies, 'pagingId', r.insertedId, { label: [country, code].filter(Boolean).join(' \u00b7 '), email });
    try {
      const logColl = await getCollection(COLLECTIONS.pagingLog);
      await logColl.insertOne({ action: 'create', pagingId: String(r.insertedId), country, code, user: req.user.username, role: req.user.role, at: now, after: { country, code, email } });
    } catch (logErr) { /* never block */ }
    res.status(201).json({ id: String(r.insertedId), country, code, email });
  } catch (e) {
    res.status(500).json({ error: 'Could not add paging contact.' });
  }
});

// Edit a paging contact (admin+). Records a paging-log entry with before/after.
app.put('/api/paging/:id', requireRole('admin'), async (req, res) => {
  try {
    let { country, code, email } = req.body || {};
    country = String(country || '').trim();
    code = String(code || '').trim().toUpperCase();
    email = String(email || '').trim();
    if (!country || !code || !email) return res.status(400).json({ error: 'Country, code, and email are all required.' });
    const coll = await getCollection(COLLECTIONS.paging);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Paging contact not found.' });
    // Another contact using the new code?
    const dup = await coll.findOne({ code, _id: { $ne: existing._id } });
    if (dup) return res.status(409).json({ error: 'A contact with code "' + code + '" already exists.' });
    const now = new Date().toISOString();
    await coll.updateOne({ _id: existing._id }, { $set: { country, code, email, updatedBy: req.user.username, updatedAt: now } });
    try {
      const logColl = await getCollection(COLLECTIONS.pagingLog);
      await logColl.insertOne({
        action: 'edit', pagingId: String(existing._id), country, code, user: req.user.username, role: req.user.role, at: now,
        before: { country: existing.country, code: existing.code, email: existing.email },
        after: { country, code, email },
      });
    } catch (logErr) { /* never block */ }
    res.json({ id: String(existing._id), country, code, email });
  } catch (e) {
    res.status(500).json({ error: 'Could not update paging contact.' });
  }
});

// Delete a paging contact (admin+). Records a paging-log entry.
app.delete('/api/paging/:id', requireRole('admin'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.paging);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Paging contact not found.' });
    // Stash the copy count so a later re-add of the same code restores it.
    await archiveCopyCount('paging', copySig('paging', existing), existing.copyCount || 0, COLLECTIONS.pagingCopies, 'pagingId', existing._id);
    await coll.deleteOne({ _id: existing._id });
    try {
      const logColl = await getCollection(COLLECTIONS.pagingLog);
      await logColl.insertOne({
        action: 'delete', pagingId: String(existing._id), country: existing.country, code: existing.code,
        user: req.user.username, role: req.user.role, at: new Date().toISOString(),
        before: { country: existing.country, code: existing.code, email: existing.email },
      });
    } catch (logErr) { /* never block */ }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete paging contact.' });
  }
});

// Paging audit log (logged-in users only). Newest first.
app.get('/api/paging-log', requireRole('user'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.pagingLog);
    const entries = await logColl.find({}).sort({ at: -1 }).limit(300).toArray();
    res.json(entries.map(e => ({
      id: String(e._id), action: e.action, pagingId: e.pagingId,
      country: e.country, code: e.code, user: e.user, role: e.role, at: e.at,
      before: e.before || null, after: e.after || null,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load paging log.' });
  }
});

// Delete a paging-log entry (owner only).
app.delete('/api/paging-log/:id', requireRole('owner'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.pagingLog);
    const r = await logColl.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Log entry not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete log entry.' });
  }
});

// ---- My Tickets (per-assignee) ----
const OPEN_STATUSES = ['Assigned', 'Work In Progress', 'Pending', 'Researching'];
const SLA_HOURS = 240;

// Helper: find a ticket in the current live quarter by ShortId. Returns the raw ticket or null.
async function findLiveTicket(shortId) {
  const coll = await getCollection(COLLECTIONS.quarters);
  const doc = await coll.findOne({ _id: currentQuarter() });
  const tickets = (doc && doc.data && doc.data.tickets) || [];
  return tickets.find(t => String(t.ShortId || t.IssueId || '') === String(shortId)) || null;
}

// Search any ticket across ALL quarters by ShortId (admin+). Used by the "Unique cases" page.
app.get('/api/ticket-search', requireRole('admin'), async (req, res) => {
  try {
    const shortId = String((req.query.shortId || '')).trim();
    if (!shortId) return res.status(400).json({ error: 'A ticket ShortId is required.' });
    const coll = await getCollection(COLLECTIONS.quarters);
    // Pull every quarter's tickets (small enough — a handful of quarters).
    const docs = await coll.find({}).toArray();
    let hit = null, hitQuarter = null;
    const target = shortId.toLowerCase();
    for (const d of docs) {
      const tickets = (d.data && d.data.tickets) || [];
      const found = tickets.find(t => String(t.ShortId || t.IssueId || '').toLowerCase() === target);
      if (found) { hit = found; hitQuarter = d._id; break; }
    }
    if (!hit) return res.json({ found: false, shortId });
    // Country: prefer the Country field. Otherwise take a SHORT leading token of the Title
    // (e.g. "US - ..." or "India Customer ..."). Ignore over-long matches (likely not a country).
    let country = String(hit.Country || '').trim();
    if (!country) {
      const title = String(hit.Title || '').trim();
      const dash = /^([A-Za-z][A-Za-z .]{0,18}?)\s*[-:]/.exec(title); // up to first - or :
      if (dash && dash[1].trim().length <= 18) {
        country = dash[1].trim();
      } else {
        const word = /^([A-Za-z]{2,})\b/.exec(title); // else just the first word
        country = word ? word[1] : '';
      }
    }
    res.json({
      found: true,
      quarter: hitQuarter,
      shortId: hit.ShortId || hit.IssueId || shortId,
      url: hit.IssueUrl || (hit.ShortId ? ('https://t.corp.amazon.com/issues/' + hit.ShortId) : ''),
      title: hit.Title || '',
      status: hit.Status || '',
      requester: hit.RequesterIdentity || '',
      createDate: hit.CreateDate || '',
      resolvedDate: hit.ResolvedDate || '',
      assignee: hit.AssigneeIdentity || '',
      country,
      slaHours: SLA_HOURS,
      important: await getImportantMarking(hit.ShortId || hit.IssueId || shortId),
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not search for the ticket.' });
  }
});

// Helper: fetch the "important" marking for a ticket (or null).
async function getImportantMarking(shortId) {
  try {
    const coll = await getCollection(COLLECTIONS.importantCases);
    const doc = await coll.findOne({ shortId: String(shortId) });
    if (!doc) return null;
    return { info: doc.info || '', links: doc.links || [], markedBy: doc.markedBy || '', at: doc.at || null, updatedAt: doc.updatedAt || null };
  } catch (e) { return null; }
}

// List ALL marked "important" tickets (admin+), newest first. For the leadership Unique Cases page.
// Joins each ticket's title/status from the quarter data when available.
app.get('/api/important-cases', requireRole('admin'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.importantCases);
    const rows = await coll.find({}).sort({ updatedAt: -1, at: -1 }).toArray();
    // Build a ShortId -> {title,status} lookup across all quarters (once).
    const qColl = await getCollection(COLLECTIONS.quarters);
    const docs = await qColl.find({}).toArray();
    const info = {};
    for (const d of docs) {
      const tickets = (d.data && d.data.tickets) || [];
      for (const t of tickets) {
        const sid = String(t.ShortId || t.IssueId || '');
        if (sid && !info[sid]) info[sid] = { title: t.Title || '', status: t.Status || '', url: t.IssueUrl || ('https://t.corp.amazon.com/issues/' + sid) };
      }
    }
    res.json(rows.map(r => {
      const meta = info[r.shortId] || {};
      return {
        shortId: r.shortId,
        quarter: r.quarter || '',
        title: meta.title || '',
        status: meta.status || '',
        url: meta.url || ('https://t.corp.amazon.com/issues/' + r.shortId),
        info: r.info || '',
        links: r.links || [],
        markedBy: r.markedBy || '',
        role: r.role || '',
        at: r.at || null,
        updatedAt: r.updatedAt || null,
      };
    }));
  } catch (e) {
    res.status(500).json({ error: 'Could not load unique cases.' });
  }
});

// Get the important marking for a ticket (admin+).
app.get('/api/important-cases/:shortId', requireRole('admin'), async (req, res) => {
  try {
    const marking = await getImportantMarking(String(req.params.shortId));
    res.json({ shortId: String(req.params.shortId), important: marking });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the marking.' });
  }
});

// Create/update the "important" marking for a ticket (admin+). Upsert by shortId.
// Body: { quarter, info, links: [ "https://..." ] }.
app.post('/api/important-cases/:shortId', requireRole('admin'), async (req, res) => {
  try {
    const shortId = String(req.params.shortId).trim();
    if (!shortId) return res.status(400).json({ error: 'A ticket ShortId is required.' });
    const body = req.body || {};
    const info = String(body.info || '').trim();
    if (info.length > 5000) return res.status(400).json({ error: 'Info must be 5000 characters or fewer.' });
    // Clean + de-dupe the link list; keep non-empty strings, cap count/length.
    let links = Array.isArray(body.links) ? body.links : [];
    links = links.map(l => String(l || '').trim()).filter(Boolean).slice(0, 50).map(l => l.slice(0, 2000));
    const now = new Date().toISOString();
    const coll = await getCollection(COLLECTIONS.importantCases);
    const existed = await coll.findOne({ shortId });
    // Editing an existing marking is restricted to the person who originally marked it.
    if (existed && String(existed.markedBy || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'Only ' + (existed.markedBy || 'the marker') + ' can edit this marking.' });
    }
    await coll.updateOne(
      { shortId },
      {
        $set: { shortId, quarter: String(body.quarter || ''), info, links, markedBy: req.user.username, role: req.user.role, updatedAt: now },
        $setOnInsert: { at: now },
      },
      { upsert: true }
    );
    // Log this mark/update action for the Unique Cases change log.
    try {
      const logColl = await getCollection(COLLECTIONS.importantCasesLog);
      await logColl.insertOne({
        action: existed ? 'update' : 'mark',
        shortId, quarter: String(body.quarter || ''),
        info, links,
        user: req.user.username, role: req.user.role, at: now,
      });
    } catch (logErr) { /* never block the marking */ }
    const marking = await getImportantMarking(shortId);
    res.json({ ok: true, shortId, important: marking });
  } catch (e) {
    res.status(500).json({ error: 'Could not save the marking.' });
  }
});

// Unmark a ticket (admin+). Only the person who marked it may remove it. Logs an 'unmark' action.
app.delete('/api/important-cases/:shortId', requireRole('admin'), async (req, res) => {
  try {
    const shortId = String(req.params.shortId).trim();
    const coll = await getCollection(COLLECTIONS.importantCases);
    const existing = await coll.findOne({ shortId });
    if (!existing) return res.status(404).json({ error: 'Marking not found.' });
    if (String(existing.markedBy || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'Only ' + (existing.markedBy || 'the marker') + ' can unmark this ticket.' });
    }
    await coll.deleteOne({ shortId });
    try {
      const logColl = await getCollection(COLLECTIONS.importantCasesLog);
      await logColl.insertOne({
        action: 'unmark', shortId, quarter: existing.quarter || '',
        info: existing.info || '', links: existing.links || [],
        user: req.user.username, role: req.user.role, at: new Date().toISOString(),
      });
    } catch (logErr) { /* never block */ }
    res.json({ ok: true, shortId });
  } catch (e) {
    res.status(500).json({ error: 'Could not unmark the ticket.' });
  }
});

// Unique Cases change log (admin+): every mark/update action, newest first.
app.get('/api/unique-cases-log', requireRole('admin'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.importantCasesLog);
    const rows = await logColl.find({}).sort({ at: -1 }).limit(500).toArray();
    res.json(rows.map(e => ({
      id: String(e._id), action: e.action || 'mark', shortId: e.shortId, quarter: e.quarter || '',
      info: e.info || '', links: e.links || [], user: e.user, role: e.role || '', at: e.at,
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the unique cases log.' });
  }
});

// Delete a unique-cases-log entry (owner only).
app.delete('/api/unique-cases-log/:id', requireRole('owner'), async (req, res) => {
  try {
    const logColl = await getCollection(COLLECTIONS.importantCasesLog);
    const r = await logColl.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!r.deletedCount) return res.status(404).json({ error: 'Log entry not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete the log entry.' });
  }
});

// GET my open tickets in the current live quarter (assigned to the logged-in user).
app.get('/api/my-tickets', requireRole('user'), async (req, res) => {
  try {
    const me = req.user.username;
    const coll = await getCollection(COLLECTIONS.quarters);
    const doc = await coll.findOne({ _id: currentQuarter() });
    const tickets = (doc && doc.data && doc.data.tickets) || [];
    const mine = tickets.filter(t =>
      String(t.AssigneeIdentity || '').toLowerCase() === String(me).toLowerCase() &&
      OPEN_STATUSES.includes(t.Status)
    );
    const out = mine.map(t => {
      const created = t.CreateDate || '';
      let deadline = null;
      const cd = new Date(created);
      if (!isNaN(cd)) deadline = new Date(cd.getTime() + SLA_HOURS * 3600 * 1000).toISOString();
      return {
        shortId: t.ShortId || t.IssueId || '',
        url: t.IssueUrl || (t.ShortId ? ('https://t.corp.amazon.com/issues/' + t.ShortId) : ''),
        title: t.Title || '',
        status: t.Status || '',
        createDate: created,
        deadline,
      };
    }).sort((a, b) => new Date(a.createDate) - new Date(b.createDate)); // oldest first
    res.json({ quarter: currentQuarter(), slaHours: SLA_HOURS, tickets: out });
  } catch (e) {
    res.status(500).json({ error: 'Could not load your tickets.' });
  }
});

// Record when a ticket last had app-side activity (a comment or incident-log add/edit/delete).
// This is OUR OWN reference timestamp — distinct from the CSV-imported LastUpdated* fields.
// Stored in a small keyed-by-shortId collection so it survives quarter re-publishes.
async function recordTicketActivity(shortId, user, type) {
  try {
    if (!shortId) return;
    const coll = await getCollection(COLLECTIONS.ticketActivity);
    await coll.updateOne(
      { _id: String(shortId) },
      { $set: { lastActivityAt: new Date().toISOString(), lastActivityBy: String(user || ''), lastActivityType: String(type || '') } },
      { upsert: true }
    );
  } catch (e) { /* activity tracking must never block the primary write */ }
}

// Batch: latest app-activity timestamp for a set of ShortIds (logged-in).
// Body: { shortIds: [...] } -> { shortId: { at, by, type } } for tickets that have any activity.
app.post('/api/tickets/activity', requireRole('user'), async (req, res) => {
  try {
    let ids = (req.body && req.body.shortIds) || [];
    if (!Array.isArray(ids)) ids = [];
    ids = ids.map(String).slice(0, 1000);
    if (!ids.length) return res.json({});
    const coll = await getCollection(COLLECTIONS.ticketActivity);
    const rows = await coll.find({ _id: { $in: ids } }).toArray();
    const out = {};
    for (const r of rows) out[r._id] = { at: r.lastActivityAt, by: r.lastActivityBy || '', type: r.lastActivityType || '' };
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'Could not load ticket activity.' });
  }
});

// GET the comment log for a ticket (logged-in). Oldest first (append-only history).
app.get('/api/tickets/:shortId/comments', requireRole('user'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.comments);
    const list = await coll.find({ shortId: String(req.params.shortId) }).sort({ at: 1 }).toArray();
    res.json(list.map(c => ({ id: String(c._id), text: c.text, user: c.user, role: c.role, at: c.at })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load comments.' });
  }
});

// Latest comment per ticket for a batch of ShortIds (logged-in). Body: { shortIds: [...] }.
// Returns { shortId: { text, user, at } } for tickets that have at least one comment.
app.post('/api/comments/latest', requireRole('user'), async (req, res) => {
  try {
    let ids = (req.body && req.body.shortIds) || [];
    if (!Array.isArray(ids)) ids = [];
    ids = ids.map(String).slice(0, 1000); // cap
    if (!ids.length) return res.json({});
    const coll = await getCollection(COLLECTIONS.comments);
    // newest first, then keep the first seen per shortId (= latest); also tally the count.
    const rows = await coll.find({ shortId: { $in: ids } }).sort({ at: -1 }).toArray();
    const out = {};
    for (const c of rows) {
      if (!out[c.shortId]) out[c.shortId] = { text: c.text, user: c.user, at: c.at, count: 0 };
      out[c.shortId].count++;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'Could not load latest comments.' });
  }
});

// POST a comment on a ticket (assignee-only, append-only). No edit/delete endpoints exist.
app.post('/api/tickets/:shortId/comments', requireRole('user'), async (req, res) => {
  try {
    const shortId = String(req.params.shortId);
    let { text } = req.body || {};
    text = String(text || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required.' });
    if (text.length > 2000) return res.status(400).json({ error: 'Comment must be 2000 characters or fewer.' });
    // The ticket must exist in the live quarter AND be assigned to the requester.
    const ticket = await findLiveTicket(shortId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found in the live quarter.' });
    if (String(ticket.AssigneeIdentity || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'You can only comment on tickets assigned to you.' });
    }
    const now = new Date().toISOString();
    const coll = await getCollection(COLLECTIONS.comments);
    const r = await coll.insertOne({ shortId, text, user: req.user.username, role: req.user.role, at: now });
    await recordTicketActivity(shortId, req.user.username, 'comment');
    res.status(201).json({ id: String(r.insertedId), text, user: req.user.username, role: req.user.role, at: now });
  } catch (e) {
    res.status(500).json({ error: 'Could not add comment.' });
  }
});

// ---- Incident logs (My Tickets: final mitigation + hashtags per ticket) ----
// Add an incident log entry for a ticket (assignee-only, append-only). Stored for later use.
app.post('/api/tickets/:shortId/incident-log', requireRole('user'), async (req, res) => {
  try {
    const shortId = String(req.params.shortId);
    let { text } = req.body || {};
    text = String(text || '').trim();
    if (!text) return res.status(400).json({ error: 'Incident log text is required.' });
    if (text.length > 5000) return res.status(400).json({ error: 'Incident log must be 5000 characters or fewer.' });
    // The ticket must exist in the live quarter AND be assigned to the requester.
    const ticket = await findLiveTicket(shortId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found in the live quarter.' });
    if (String(ticket.AssigneeIdentity || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'You can only add incident logs to tickets assigned to you.' });
    }
    const now = new Date().toISOString();
    const coll = await getCollection(COLLECTIONS.incidentLogs);
    const r = await coll.insertOne({ shortId, text, user: req.user.username, role: req.user.role, at: now });
    await recordTicketActivity(shortId, req.user.username, 'incident-log');
    res.status(201).json({ id: String(r.insertedId), text, user: req.user.username, role: req.user.role, at: now });
  } catch (e) {
    res.status(500).json({ error: 'Could not add incident log.' });
  }
});

// GET the incident-log history for a ticket (logged-in). Oldest first.
app.get('/api/tickets/:shortId/incident-log', requireRole('user'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.incidentLogs);
    const list = await coll.find({ shortId: String(req.params.shortId) }).sort({ at: 1 }).toArray();
    res.json(list.map(x => ({ id: String(x._id), text: x.text, user: x.user, role: x.role, at: x.at, mine: String(x.user||'').toLowerCase() === String(req.user.username).toLowerCase() })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load incident logs.' });
  }
});

// Edit an incident-log entry (author only).
app.put('/api/incident-log/:id', requireRole('user'), async (req, res) => {
  try {
    let text = String((req.body || {}).text || '').trim();
    if (!text) return res.status(400).json({ error: 'Incident log text is required.' });
    if (text.length > 5000) return res.status(400).json({ error: 'Incident log must be 5000 characters or fewer.' });
    const coll = await getCollection(COLLECTIONS.incidentLogs);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Incident log not found.' });
    if (String(existing.user || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'You can only edit your own incident logs.' });
    }
    await coll.updateOne({ _id: existing._id }, { $set: { text, editedAt: new Date().toISOString() } });
    await recordTicketActivity(existing.shortId, req.user.username, 'incident-log-edit');
    res.json({ ok: true, id: String(existing._id), text });
  } catch (e) {
    res.status(500).json({ error: 'Could not update the incident log.' });
  }
});

// Delete an incident-log entry (author only).
app.delete('/api/incident-log/:id', requireRole('user'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.incidentLogs);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Incident log not found.' });
    if (String(existing.user || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'You can only delete your own incident logs.' });
    }
    await coll.deleteOne({ _id: existing._id });
    await recordTicketActivity(existing.shortId, req.user.username, 'incident-log-delete');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete the incident log.' });
  }
});

// ---- Help requests (editor "ask for help") ----
// Create a help request on a ticket (editor only; must be assigned to them). Multiple allowed.
app.post('/api/help', requireRole('editor'), async (req, res) => {
  try {
    const body = req.body || {};
    const shortId = String(body.shortId || '').trim();
    const doubt = String(body.doubt || '').trim();
    if (!shortId || !doubt) return res.status(400).json({ error: 'Ticket and your question are required.' });
    if (doubt.length > 2000) return res.status(400).json({ error: 'Question must be 2000 characters or fewer.' });
    // Verify the ticket is in the live quarter and assigned to the requester.
    const ticket = await findLiveTicket(shortId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found in the live quarter.' });
    if (String(ticket.AssigneeIdentity || '').toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'You can only ask for help on tickets assigned to you.' });
    }
    const coll = await getCollection(COLLECTIONS.helpRequests);
    // Only one OPEN request per ticket at a time. Must resolve ("Help received") before asking again.
    const openExisting = await coll.findOne({ shortId, status: 'open' });
    if (openExisting) {
      return res.status(409).json({ error: 'There is already an open help request on this ticket. Click "Help received" to close it before asking a new question.' });
    }
    const now = new Date().toISOString();
    const doc = { shortId, ticketUrl: ticket.IssueUrl || (ticket.ShortId ? ('https://t.corp.amazon.com/issues/' + ticket.ShortId) : ''), requester: req.user.username, role: req.user.role, doubt, status: 'open', createdAt: now, replies: [] };
    const r = await coll.insertOne(doc);
    res.status(201).json({ id: String(r.insertedId), ...doc });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit help request.' });
  }
});

// All OPEN help requests (any logged-in user can view — powers the alert popup).
app.get('/api/help/open', requireRole('user'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.helpRequests);
    const list = await coll.find({ status: 'open' }).sort({ createdAt: -1 }).toArray();
    res.json(list.map(h => ({ id: String(h._id), shortId: h.shortId, ticketUrl: h.ticketUrl || '', requester: h.requester, doubt: h.doubt, createdAt: h.createdAt, replies: h.replies || [] })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load help requests.' });
  }
});

// FULL help-request history (any logged-in user) — powers the Help Activity page. Newest first.
app.get('/api/help/all', requireRole('user'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.helpRequests);
    const list = await coll.find({}).sort({ createdAt: -1 }).toArray();
    res.json(list.map(h => ({
      id: String(h._id), shortId: h.shortId, ticketUrl: h.ticketUrl || '',
      requester: h.requester, doubt: h.doubt, status: h.status,
      createdAt: h.createdAt, resolvedAt: h.resolvedAt || null,
      replies: (h.replies || []).map(rp => ({ by: rp.by, role: rp.role, text: rp.text, at: rp.at })),
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load help activity.' });
  }
});

// My help requests (requester = me), open + resolved, with replies — for the My Tickets page.
app.get('/api/help/mine', requireRole('user'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.helpRequests);
    const list = await coll.find({ requester: req.user.username }).sort({ createdAt: -1 }).toArray();
    res.json(list.map(h => ({ id: String(h._id), shortId: h.shortId, doubt: h.doubt, status: h.status, createdAt: h.createdAt, resolvedAt: h.resolvedAt || null, replies: h.replies || [] })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your help requests.' });
  }
});

// Reply to a help request (admin/owner only). Append-only.
app.post('/api/help/:id/reply', requireRole('admin'), async (req, res) => {
  try {
    const text = String((req.body || {}).text || '').trim();
    if (!text) return res.status(400).json({ error: 'Reply text is required.' });
    if (text.length > 4000) return res.status(400).json({ error: 'Reply must be 4000 characters or fewer.' });
    const coll = await getCollection(COLLECTIONS.helpRequests);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Help request not found.' });
    const reply = { by: req.user.username, role: req.user.role, text, at: new Date().toISOString() };
    await coll.updateOne({ _id: existing._id }, { $push: { replies: reply } });
    res.status(201).json(reply);
  } catch (e) {
    res.status(500).json({ error: 'Could not add reply.' });
  }
});

// Mark a help request resolved ("help received") — requester only. Kept for history.
app.post('/api/help/:id/resolve', requireRole('editor'), async (req, res) => {
  try {
    const coll = await getCollection(COLLECTIONS.helpRequests);
    const existing = await coll.findOne({ _id: new ObjectId(req.params.id) });
    if (!existing) return res.status(404).json({ error: 'Help request not found.' });
    if (String(existing.requester).toLowerCase() !== String(req.user.username).toLowerCase()) {
      return res.status(403).json({ error: 'You can only resolve your own help requests.' });
    }
    await coll.updateOne({ _id: existing._id }, { $set: { status: 'resolved', resolvedAt: new Date().toISOString(), resolvedBy: req.user.username } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not resolve help request.' });
  }
});

// ---- Analytics helpers ----
const OPEN_SET = ['Assigned', 'Work In Progress', 'Pending', 'Researching'];
const IMMEDIATE_AUTO = ['Immediately Resolved', 'Automatically Closed'];
function isResolved(t) { return t.Status === 'Resolved' || t.Status === 'Closed'; }
function hiCount(t) {
  const m = String(t.RootCauseDetails || '').match(/\bCnt\s*[:\s]\s*(\d+)/i) || String(t.RootCauseDetails || '').match(/Historical Incident\s*:?\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}
// Ticket color from age (open tickets only). Mirrors app.js: green<=96,yellow<=168,red<=240,black>240; purple=reopened/has ResolvedDate.
function ticketColor(t, now) {
  const hasResolvedDate = t.ResolvedDate && String(t.ResolvedDate).trim() !== '';
  if (t._reopened || hasResolvedDate) return 'purple';
  const cd = new Date(t.CreateDate); if (isNaN(cd)) return 'green';
  const ageH = (now - cd) / 36e5;
  if (ageH <= 96) return 'green';
  if (ageH <= 168) return 'yellow';
  if (ageH <= 240) return 'red';
  return 'black';
}
async function liveTickets() {
  const coll = await getCollection(COLLECTIONS.quarters);
  const doc = await coll.findOne({ _id: currentQuarter() });
  return (doc && doc.data && doc.data.tickets) || [];
}

// Agent analytics (admin+). Per-user stats grouped into leads (owner/admin/manager) and editors.
app.get('/api/agent-analytics', requireRole('admin'), async (req, res) => {
  try {
    const tickets = await liveTickets();
    const now = Date.now();
    const t12 = now - 12 * 36e5, t24 = now - 24 * 36e5;

    // Roles for the seeded accounts.
    const users = await getCollection(COLLECTIONS.users);
    const uList = await users.find({}, { projection: { username: 1, role: 1 } }).toArray();

    // Which tickets have >=1 comment (for editor "touched" metric).
    const commentsColl = await getCollection(COLLECTIONS.comments);
    const commentedIds = new Set((await commentsColl.distinct('shortId')).map(String));

    function statsFor(username) {
      const u = username.toLowerCase();
      const mine = tickets.filter(t => String(t.AssigneeIdentity || '').toLowerCase() === u);
      const resolvedByMe = tickets.filter(t => String(t.ResolvedByIdentity || '').toLowerCase() === u);
      const colors = { green: 0, yellow: 0, red: 0, black: 0, purple: 0 };
      let open = 0;
      mine.forEach(t => { if (!isResolved(t)) { open++; colors[ticketColor(t, now)]++; } });
      const resolvedSuccessful = resolvedByMe.filter(t => (t.ClosureCode || '') === 'Successful').length;
      const immediateAuto = resolvedByMe.filter(t => IMMEDIATE_AUTO.includes(t.ClosureCode || '')).length;
      const inRange = (t, from) => { const rd = new Date(t.ResolvedDate); return !isNaN(rd) && rd.getTime() >= from && rd.getTime() <= now; };
      const resolved12 = resolvedByMe.filter(t => inRange(t, t12)).length;
      const resolved24 = resolvedByMe.filter(t => inRange(t, t24)).length;
      const resolvedInQuarter = resolvedByMe.filter(isResolved).length;
      // editor "touched": distinct tickets assigned to them with >=1 comment
      const touched = mine.filter(t => commentedIds.has(String(t.ShortId || t.IssueId || ''))).length;
      return { username, open, resolvedSuccessful, immediateAuto, resolved12, resolved24, colors, resolvedInQuarter, touched };
    }

    const leads = [], editors = [];
    uList.forEach(u => {
      // Managers are excluded from Agent Analytics entirely.
      if (u.role === 'manager') return;
      // Owner/admin -> leads; editor -> editors.
      const s = statsFor(u.username);
      s.role = u.role;
      if (u.role === 'editor') editors.push(s); else leads.push(s);
    });
    leads.sort((a, b) => b.resolvedInQuarter - a.resolvedInQuarter);
    editors.sort((a, b) => b.resolvedInQuarter - a.resolvedInQuarter);
    res.json({ quarter: currentQuarter(), leads, editors });
  } catch (e) {
    res.status(500).json({ error: 'Could not compute agent analytics.' });
  }
});

// An editor's live "bucket" (admin+): their still-open tickets in the live quarter, with all comments.
app.get('/api/agent-bucket', requireRole('admin'), async (req, res) => {
  try {
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ error: 'A username is required.' });
    const tickets = await liveTickets();
    const now = Date.now();
    const mine = tickets.filter(t =>
      String(t.AssigneeIdentity || '').toLowerCase() === username &&
      OPEN_STATUSES.includes(t.Status)
    );
    // Gather all comments for these tickets in one query.
    const ids = mine.map(t => String(t.ShortId || t.IssueId || '')).filter(Boolean);
    const commentsColl = await getCollection(COLLECTIONS.comments);
    const commentRows = ids.length ? await commentsColl.find({ shortId: { $in: ids } }).sort({ at: 1 }).toArray() : [];
    const byTicket = {};
    commentRows.forEach(c => { (byTicket[c.shortId] = byTicket[c.shortId] || []).push({ text: c.text, user: c.user, role: c.role, at: c.at }); });

    const out = mine.map(t => {
      const shortId = String(t.ShortId || t.IssueId || '');
      const created = t.CreateDate || '';
      const cd = new Date(created);
      let ageHours = null, deadline = null;
      if (!isNaN(cd)) {
        ageHours = Math.max(0, (now - cd.getTime()) / 36e5);
        deadline = new Date(cd.getTime() + SLA_HOURS * 3600 * 1000).toISOString();
      }
      return {
        shortId,
        url: t.IssueUrl || (shortId ? ('https://t.corp.amazon.com/issues/' + shortId) : ''),
        title: t.Title || '',
        status: t.Status || '',
        createDate: created,
        ageHours,
        deadline,
        comments: byTicket[shortId] || [],
      };
    }).sort((a, b) => new Date(a.createDate) - new Date(b.createDate)); // oldest first

    res.json({ username, slaHours: SLA_HOURS, count: out.length, tickets: out });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the agent bucket.' });
  }
});

// Last 24 hours (admin+).
app.get('/api/last24', requireRole('admin'), async (req, res) => {
  try {
    const tickets = await liveTickets();
    const now = Date.now();
    const t24 = now - 24 * 36e5;
    const inLast24 = (dateStr) => { const d = new Date(dateStr); return !isNaN(d) && d.getTime() >= t24 && d.getTime() <= now; };

    const created24 = tickets.filter(t => inLast24(t.CreateDate)).length;
    const resolvedLast24 = tickets.filter(t => inLast24(t.ResolvedDate));
    const resolved24 = resolvedLast24.length;
    // SLA% of last-24h resolutions (<=240h from creation)
    let within = 0, slaBase = 0;
    resolvedLast24.forEach(t => { const cd = new Date(t.CreateDate), rd = new Date(t.ResolvedDate); if (!isNaN(cd) && !isNaN(rd)) { const h = (rd - cd) / 36e5; if (h >= 0) { slaBase++; if (h <= 240) within++; } } });
    const slaPct24 = slaBase ? +(within / slaBase * 100).toFixed(1) : null;
    // HI (Cnt) > 0 resolved in last 24h
    const hi24 = resolvedLast24.filter(t => hiCount(t) > 0).length;
    // Immediately Resolved / Automatically Closed in last 24h, split by resolver:
    // AUTO-SIM (ResolvedByIdentity contains 'AutoSIM') vs agents (everyone else).
    const immediateAutoTickets = resolvedLast24.filter(t => IMMEDIATE_AUTO.includes(t.ClosureCode || ''));
    const immediateAutoAutoSim24 = immediateAutoTickets.filter(t => String(t.ResolvedByIdentity || '').includes('AutoSIM')).length;
    const immediateAutoAgents24 = immediateAutoTickets.length - immediateAutoAutoSim24;
    // open tickets crossing 240h in the next 24h (age currently 216-240h)
    const crossing = tickets.filter(t => {
      if (isResolved(t)) return false;
      const cd = new Date(t.CreateDate); if (isNaN(cd)) return false;
      const ageH = (now - cd.getTime()) / 36e5;
      return ageH >= 216 && ageH < 240;
    }).length;

    // Help activity in the last 24h: requests asked and replies given.
    let helpActivity = [];
    try {
      const helpColl = await getCollection(COLLECTIONS.helpRequests);
      const all = await helpColl.find({}).toArray();
      all.forEach(h => {
        const askedRecent = h.createdAt && new Date(h.createdAt).getTime() >= t24;
        const recentReplies = (h.replies || []).filter(rp => rp.at && new Date(rp.at).getTime() >= t24);
        if (askedRecent || recentReplies.length) {
          helpActivity.push({
            shortId: h.shortId, ticketUrl: h.ticketUrl || '', requester: h.requester, doubt: h.doubt, status: h.status,
            createdAt: h.createdAt, resolvedAt: h.resolvedAt || null, askedRecent: !!askedRecent,
            repliedBy: [...new Set((h.replies || []).map(rp => rp.by))],
            recentReplyCount: recentReplies.length,
            replies: (h.replies || []).map(rp => ({ by: rp.by, role: rp.role, text: rp.text, at: rp.at })),
          });
        }
      });
      helpActivity.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) { /* ignore */ }

    res.json({ quarter: currentQuarter(), created24, resolved24, slaPct24, slaBase, hi24, immediateAutoAgents24, immediateAutoAutoSim24, crossing240Next24: crossing, helpActivity });
  } catch (e) {
    res.status(500).json({ error: 'Could not compute last-24h analytics.' });
  }
});

// ============================================================================
// CHUNKED DASHBOARD ENDPOINTS
// Instead of shipping the whole live-quarter tickets array to every visitor, these
// endpoints each read the live quarter server-side and return ONE small precomputed
// slice of the dashboard. The client fetches the summary on load and each chart card
// lazily on first expand, caching every chunk version-first (busts on a new publish).
// The math MIRRORS app.js computeMetrics() so the numbers match the full-array render.
// ============================================================================

// --- shared date/number helpers (mirror app.js) ---
function _hBetween(d1, d2) { return Math.abs(d2 - d1) / 36e5; }
function _avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function _num(v) { const d = new Date(v); return isNaN(d) ? null : d; }
// The "reference now" for age classification. app.js uses the real clock (new Date()).
function _now() { return new Date(); }
// The dashboard's max CreateDate (used for the 7-day window + weekly buckets).
function _maxCreate(tickets) {
  let mx = 0;
  tickets.forEach(t => { const d = _num(t.CreateDate); if (d && d.getTime() > mx) mx = d.getTime(); });
  return mx ? new Date(mx) : new Date();
}
// Live-quarter tickets + the doc's publishedAt (the cache version).
async function liveTicketsWithMeta() {
  const coll = await getCollection(COLLECTIONS.quarters);
  const doc = await coll.findOne({ _id: currentQuarter() });
  const tickets = (doc && doc.data && doc.data.tickets) || [];
  const publishedAt = (doc && doc.meta && doc.meta.publishedAt) || (doc && doc.data && doc.data.updatedAt) || null;
  return { tickets, publishedAt };
}

// ============================================================================
// FAST PATH: compute each chunk INSIDE Atlas via an aggregation pipeline.
// The quarter doc embeds ~8k tickets (several MB); a findOne ships the whole blob
// to the server on every request (~60s on the free tier). Instead we $unwind the
// tickets array in the database and return only small aggregates (a few hundred
// bytes), so nothing large ever crosses the wire. Each chunk gets its own pipeline.
// ============================================================================

// Just the live-quarter version stamp (tiny — no tickets shipped).
async function liveMeta() {
  const coll = await getCollection(COLLECTIONS.quarters);
  const doc = await coll.findOne({ _id: currentQuarter() }, { projection: { 'meta.publishedAt': 1, 'data.updatedAt': 1 } });
  return { publishedAt: (doc && doc.meta && doc.meta.publishedAt) || (doc && doc.data && doc.data.updatedAt) || null };
}

// Run an aggregation over a quarter's tickets. `stages` are applied AFTER the initial
// match + unwind, receiving each unwound ticket as the root document under `t`.
// `qid` defaults to the current live quarter.
async function aggLive(stages, qid) {
  const coll = await getCollection(COLLECTIONS.quarters);
  qid = qid || currentQuarter();
  const pipeline = [
    { $match: { _id: qid } },
    { $project: { t: '$data.tickets' } },
    { $unwind: '$t' },
  ].concat(stages);
  return coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
}

// Safely convert a (possibly empty/invalid) string field to a Date; null if unparseable.
// $toDate throws on bad input, so we use $convert with onError/onNull -> null.
function _safeDate(field) {
  return { $convert: { input: field, to: 'date', onError: null, onNull: null } };
}

// Reusable pipeline expressions (mirror app.js). All operate on fields of `$t`.
const AGG = {
  // resolution hours = (ResolvedDate - CreateDate) / 3.6e6, only when both parse (else null).
  resHours: {
    $let: {
      vars: { rd: { $convert: { input: '$t.ResolvedDate', to: 'date', onError: null, onNull: null } }, cd: { $convert: { input: '$t.CreateDate', to: 'date', onError: null, onNull: null } } },
      in: { $cond: [{ $and: [{ $ne: ['$$rd', null] }, { $ne: ['$$cd', null] }] }, { $divide: [{ $subtract: ['$$rd', '$$cd'] }, 3600000] }, null] },
    },
  },
  isResolved: { $in: ['$t.Status', ['Resolved', 'Closed']] },
  isAutoSim: { $regexMatch: { input: { $ifNull: ['$t.ResolvedByIdentity', ''] }, regex: 'AutoSIM' } },
  // HI count: parse "Cnt: N" or "Historical Incident: N" from RootCauseDetails.
  hiCountExpr: {
    $let: {
      vars: { m: { $regexFind: { input: { $ifNull: ['$t.RootCauseDetails', ''] }, regex: /(?:\bCnt\s*[:\s]\s*|Historical Incident\s*:?\s*)(\d+)/i } } },
      in: { $cond: [{ $ne: ['$$m', null] }, { $toInt: { $arrayElemAt: ['$$m.captures', 0] } }, 0] },
    },
  },
  isPet: { $regexMatch: { input: { $toLower: { $ifNull: ['$t.RootCause', ''] } }, regex: 'unsecured animal' } },
};

const pct1 = (n, d) => d ? +((n / d) * 100).toFixed(1) : 0; // one-decimal percentage helper

// ---- Summary (9 KPIs) — computed entirely in Atlas ----
async function dashSummary(qid) {
  const rows = await aggLive([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        resolved: { $sum: { $cond: [{ $in: ['$t.Status', ['Resolved', 'Closed']] }, 1, 0] } },
        unresolved: { $sum: { $cond: [{ $in: ['$t.Status', ['Assigned', 'Pending', 'Work In Progress', 'Researching']] }, 1, 0] } },
        autosim: { $sum: { $cond: [AGG.isAutoSim, 1, 0] } },
        // Resolution-time stats: only Status==Resolved with valid hours >= 0
        rtSum: { $sum: { $cond: [{ $and: [{ $eq: ['$t.Status', 'Resolved'] }, { $gte: [AGG.resHours, 0] }] }, AGG.resHours, 0] } },
        rtCount: { $sum: { $cond: [{ $and: [{ $eq: ['$t.Status', 'Resolved'] }, { $gte: [AGG.resHours, 0] }] }, 1, 0] } },
        slaWithin: { $sum: { $cond: [{ $and: [{ $eq: ['$t.Status', 'Resolved'] }, { $gte: [AGG.resHours, 0] }, { $lte: [AGG.resHours, 240] }] }, 1, 0] } },
        // Repeat incidents (HI>0), split pet vs non-pet
        hi: { $sum: { $cond: [{ $gt: [AGG.hiCountExpr, 0] }, 1, 0] } },
        hiPet: { $sum: { $cond: [{ $and: [{ $gt: [AGG.hiCountExpr, 0] }, AGG.isPet] }, 1, 0] } },
      },
    },
  ], qid);
  const r = rows[0] || {};
  const T = r.total || 0, res = r.resolved || 0, inQ = r.unresolved || 0;
  const avgR = r.rtCount ? (r.rtSum / r.rtCount) : 0;
  const hi = r.hi || 0, pet = r.hiPet || 0, nonPet = hi - pet;
  const petPct = pct1(pet, hi), nonPetPct = pct1(nonPet, hi);
  return {
    total: T, resolved: res, unresolved: inQ,
    resolvedPct: pct1(res, T), unresolvedPct: pct1(inQ, T),
    avgResolutionHrs: +avgR.toFixed(0), avgResolutionPct: +((avgR / 240) * 100).toFixed(1),
    slaPct: pct1(r.slaWithin || 0, r.rtCount || 0), slaCompliant: r.slaWithin || 0, slaBase: r.rtCount || 0,
    autosim: r.autosim || 0, autosimPct: pct1(r.autosim || 0, T),
    repeatIncidents: hi, hiPet: pet, hiNonPet: nonPet, hiPetPct: petPct, hiNonPetPct: nonPetPct, hiGap: +(petPct - nonPetPct).toFixed(1),
  };
}

// ---- Ticket Age Classification (open tickets only) — computed in Atlas ----
async function dashAge(qid) {
  const now = new Date();
  // Age in hours from CreateDate to now; if CreateDate is unparseable, treat age as 0 (green-ish),
  // mirroring app.js where an invalid date yields ageHrs computed against an Invalid Date -> falls to green path.
  const ageHrs = { $let: { vars: { cd: _safeDate('$t.CreateDate') }, in: { $cond: [{ $ne: ['$$cd', null] }, { $divide: [{ $subtract: [now, '$$cd'] }, 3600000] }, 0] } } };
  const hasResolved = { $ne: [{ $trim: { input: { $ifNull: ['$t.ResolvedDate', ''] } } }, ''] };
  const rows = await aggLive([
    { $match: { 't.Status': { $nin: ['Resolved', 'Closed'] } } },
    {
      $group: {
        _id: null,
        purple: { $sum: { $cond: [{ $or: [{ $eq: ['$t._reopened', true] }, hasResolved] }, 1, 0] } },
        green: { $sum: { $cond: [{ $and: [{ $not: [{ $or: [{ $eq: ['$t._reopened', true] }, hasResolved] }] }, { $lte: [ageHrs, 96] }] }, 1, 0] } },
        yellow: { $sum: { $cond: [{ $and: [{ $not: [{ $or: [{ $eq: ['$t._reopened', true] }, hasResolved] }] }, { $gt: [ageHrs, 96] }, { $lte: [ageHrs, 168] }] }, 1, 0] } },
        red: { $sum: { $cond: [{ $and: [{ $not: [{ $or: [{ $eq: ['$t._reopened', true] }, hasResolved] }] }, { $gt: [ageHrs, 168] }, { $lte: [ageHrs, 240] }] }, 1, 0] } },
        black: { $sum: { $cond: [{ $and: [{ $not: [{ $or: [{ $eq: ['$t._reopened', true] }, hasResolved] }] }, { $gt: [ageHrs, 240] }] }, 1, 0] } },
      },
    },
  ], qid);
  const r = rows[0] || {};
  return { green: r.green || 0, yellow: r.yellow || 0, red: r.red || 0, black: r.black || 0, purple: r.purple || 0 };
}

// ---- Ticket Age Classification WITH per-color ticket detail (open tickets only) ----
// Returns { green:[...], yellow:[...], red:[...], black:[...], purple:[...] } where each ticket
// is a slim { ShortId, AssigneeIdentity, CreateDate, Status, Title } — enough for the color popups,
// agent drill-down, blink logic, and CSV export. Classification mirrors dashAge/app.js.
async function dashAgeDetail(qid) {
  const now = new Date();
  const ageHrs = { $let: { vars: { cd: _safeDate('$t.CreateDate') }, in: { $cond: [{ $ne: ['$$cd', null] }, { $divide: [{ $subtract: [now, '$$cd'] }, 3600000] }, 0] } } };
  const hasResolved = { $ne: [{ $trim: { input: { $ifNull: ['$t.ResolvedDate', ''] } } }, ''] };
  const isPurple = { $or: [{ $eq: ['$t._reopened', true] }, hasResolved] };
  const rows = await aggLive([
    { $match: { 't.Status': { $nin: ['Resolved', 'Closed'] } } },
    { $project: {
      ShortId: { $ifNull: ['$t.ShortId', '$t.IssueId'] },
      AssigneeIdentity: { $ifNull: ['$t.AssigneeIdentity', ''] },
      CreateDate: '$t.CreateDate',
      Status: '$t.Status',
      Title: { $ifNull: ['$t.Title', ''] },
      color: { $switch: { branches: [
        { case: isPurple, then: 'purple' },
        { case: { $lte: [ageHrs, 96] }, then: 'green' },
        { case: { $lte: [ageHrs, 168] }, then: 'yellow' },
        { case: { $lte: [ageHrs, 240] }, then: 'red' },
      ], default: 'black' } },
    } },
    { $group: { _id: '$color', tickets: { $push: { ShortId: '$ShortId', AssigneeIdentity: '$AssigneeIdentity', CreateDate: '$CreateDate', Status: '$Status', Title: '$Title' } } } },
  ], qid);
  const out = { green: [], yellow: [], red: [], black: [], purple: [] };
  rows.forEach(r => { if (out[r._id]) out[r._id] = r.tickets; });
  return out;
}

// ---- Queue Status (counts + % by status) — computed in Atlas ----
async function dashQueue(qid) {
  const rows = await aggLive([{ $group: { _id: '$t.Status', n: { $sum: 1 } } }], qid);
  const s = {}; let T = 0;
  rows.forEach(r => { s[r._id] = r.n; T += r.n; });
  const order = ['Assigned', 'Work In Progress', 'Researching', 'Pending', 'Resolved', 'Closed'];
  const counts = {}, pct = {};
  order.forEach(k => { counts[k] = s[k] || 0; pct[k] = pct1(counts[k], T); });
  return { total: T, counts, pct };
}

// ---- Daily Tickets (Last 7 Days) — buckets computed server-side off maxCreate ----
async function dashDaily7(qid) {
  // Need the max CreateDate first (tiny aggregation), then count per day in Atlas.
  const mx = await aggLive([{ $group: { _id: null, m: { $max: _safeDate('$t.CreateDate') } } }], qid);
  const maxDate = (mx[0] && mx[0].m) ? new Date(mx[0].m) : new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) { const ds = new Date(maxDate); ds.setDate(ds.getDate() - i); ds.setHours(0, 0, 0, 0); const de = new Date(ds); de.setDate(de.getDate() + 1); days.push({ ds, de }); }
  const rows = await aggLive([
    { $project: { cd: _safeDate('$t.CreateDate'), rd: _safeDate('$t.ResolvedDate') } },
    { $project: {
      ci: { $switch: { branches: days.map((d, i) => ({ case: { $and: [{ $ne: ['$cd', null] }, { $gte: ['$cd', d.ds] }, { $lt: ['$cd', d.de] }] }, then: i })), default: -1 } },
      ri: { $switch: { branches: days.map((d, i) => ({ case: { $and: [{ $ne: ['$rd', null] }, { $gte: ['$rd', d.ds] }, { $lt: ['$rd', d.de] }] }, then: i })), default: -1 } },
    } },
    { $facet: {
      created: [{ $match: { ci: { $gte: 0 } } }, { $group: { _id: '$ci', n: { $sum: 1 } } }],
      resolved: [{ $match: { ri: { $gte: 0 } } }, { $group: { _id: '$ri', n: { $sum: 1 } } }],
    } },
  ], qid);
  const f = rows[0] || { created: [], resolved: [] };
  const created = new Array(7).fill(0), resolved = new Array(7).fill(0);
  (f.created || []).forEach(x => { created[x._id] = x.n; });
  (f.resolved || []).forEach(x => { resolved[x._id] = x.n; });
  return { labels: days.map(d => d.ds.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })), created, resolved };
}

// ---- Weekly Volume (created + resolved) — week label built in Atlas to match app.js ----
// app.js week = ceil((dayOfYear + jan4.getDay()) / 7). We reproduce it with $dayOfYear + jan4 weekday.
function _weekExpr(dateField) {
  return {
    $let: {
      vars: { d: { $convert: { input: dateField, to: 'date', onError: null, onNull: null } } },
      in: {
        $cond: [{ $eq: ['$$d', null] }, null, {
          $let: {
            vars: {
              doy: { $dayOfYear: '$$d' },
              jan4dow: { $subtract: [{ $dayOfWeek: { $dateFromParts: { year: { $year: '$$d' }, month: 1, day: 4 } } }, 1] }, // 0=Sun..6=Sat (app.js getDay())
            },
            in: { $ceil: { $divide: [{ $add: ['$$doy', '$$jan4dow'] }, 7] } },
          },
        }],
      },
    },
  };
}
async function dashWeekly(qid) {
  const rows = await aggLive([
    { $facet: {
      created: [{ $match: { 't.CreateDate': { $ne: null, $ne: '' } } }, { $group: { _id: _weekExpr('$t.CreateDate'), n: { $sum: 1 } } }],
      resolved: [{ $match: { 't.ResolvedDate': { $ne: null, $ne: '' } } }, { $group: { _id: _weekExpr('$t.ResolvedDate'), n: { $sum: 1 } } }],
    } },
  ], qid);
  const f = rows[0] || { created: [], resolved: [] };
  const wb = {}, wbR = {};
  (f.created || []).forEach(x => { if (x._id != null) wb['W' + x._id] = x.n; });
  (f.resolved || []).forEach(x => { if (x._id != null) wbR['W' + x._id] = x.n; });
  const labels = Object.keys(wb).sort();
  return { labels, created: labels.map(k => wb[k]), resolved: labels.map(k => wbR[k] || 0) };
}

// ---- SLA Compliance per Week (<=240h), 13 buckets from quarter start ----
async function dashSlaWeekly(qid) {
  const mx = await aggLive([{ $group: { _id: null, m: { $max: _safeDate('$t.CreateDate') } } }], qid);
  const maxDate = (mx[0] && mx[0].m) ? new Date(mx[0].m) : new Date();
  const qStart = new Date(maxDate.getFullYear(), Math.floor(maxDate.getMonth() / 3) * 3, 1);
  const isoWeekNum = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - ys) / 864e5 + 1) / 7); };
  const weekIndexOf = (d) => { const days = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - qStart) / 864e5); if (days < 0) return -1; const idx = Math.floor(days / 7); return idx > 12 ? -1 : idx; };
  const currentWeekIdx = weekIndexOf(maxDate);
  // week index by resolved-date, computed in Atlas via day-difference from qStart.
  const rows = await aggLive([
    { $project: { rd: _safeDate('$t.ResolvedDate'), h: AGG.resHours } },
    { $match: { rd: { $ne: null }, h: { $ne: null, $gte: 0 } } },
    { $project: { wi: { $floor: { $divide: [{ $floor: { $divide: [{ $subtract: [{ $dateTrunc: { date: '$rd', unit: 'day' } }, qStart] }, 86400000] } }, 7] } }, h: '$h' } },
    { $match: { wi: { $gte: 0, $lte: 12 } } },
    { $group: { _id: '$wi', resolved: { $sum: 1 }, within: { $sum: { $cond: [{ $lte: ['$h', 240] }, 1, 0] } } } },
  ], qid);
  const resolvedWk = new Array(13).fill(0), withinWk = new Array(13).fill(0);
  rows.forEach(r => { if (r._id >= 0 && r._id < 13) { resolvedWk[r._id] = r.resolved; withinWk[r._id] = r.within; } });
  const out = [];
  for (let i = 0; i < 13; i++) {
    const dt = new Date(qStart.getFullYear(), qStart.getMonth(), qStart.getDate() + i * 7);
    const label = 'W' + String(isoWeekNum(dt)).padStart(2, '0');
    const inRange = (currentWeekIdx < 0) || (i <= currentWeekIdx);
    const p = (inRange && resolvedWk[i]) ? +(withinWk[i] / resolvedWk[i] * 100).toFixed(1) : null;
    out.push({ week: label, resolved: inRange ? resolvedWk[i] : 0, within: inRange ? withinWk[i] : 0, pct: p });
  }
  return { weeks: out };
}

// Incident-type expression (mirrors app.js _incidentType) built as a Mongo $switch.
const AGG_INCIDENT_TYPE = {
  $let: {
    vars: { rc: { $trim: { input: { $replaceAll: { input: { $ifNull: ['$t.RootCause', ''] }, find: '- ', replacement: '' } } } } }, // approximate leading "- " strip
    in: {
      $switch: {
        branches: [
          { case: { $lte: [{ $strLenCP: '$$rc' }, 1] }, then: 'No Root Cause' },
          { case: AGG.isPet, then: {
            $switch: {
              branches: [
                { case: { $and: [{ $in: [{ $trim: { input: { $ifNull: ['$t.ClosureCode', ''] } } }, ['Immediately Resolved', 'Automatically Closed']] }, { $ne: [{ $trim: { input: { $ifNull: ['$t.AssigneeIdentity', ''] } } }, ''] }] }, then: 'First Time Pet Incident (Immediately Resolved / No Action Taken)' },
                { case: { $ne: [{ $trim: { input: { $ifNull: ['$t.RootCauseDetails', ''] } } }, ''] }, then: 'Pet Incident (HI>0)' },
              ],
              default: 'Pet Incident (Resolved by AUTO-SIM)',
            },
          } },
        ],
        default: { $substrCP: ['$$rc', 0, 80] },
      },
    },
  },
};
// ---- Incident Types — grouped in Atlas ----
async function dashIncidents(qid) {
  const rows = await aggLive([{ $group: { _id: AGG_INCIDENT_TYPE, count: { $sum: 1 } } }, { $sort: { count: -1 } }], qid);
  const T = rows.reduce((s, r) => s + r.count, 0);
  return { total: T, types: rows.map(r => ({ type: r._id, count: r.count, pct: pct1(r.count, T) })) };
}

// ---- Historical Incidents (Cnt > 0), pet vs non-pet + root-cause breakdown — grouped in Atlas ----
async function dashHi(qid) {
  const rcExpr = { $let: { vars: { rc: { $trim: { input: { $replaceAll: { input: { $ifNull: ['$t.RootCause', ''] }, find: '- ', replacement: '' } } } } }, in: { $cond: [{ $eq: ['$$rc', ''] }, 'Unknown', '$$rc'] } } };
  const rows = await aggLive([
    { $project: { hi: AGG.hiCountExpr, isPet: AGG.isPet, rc: rcExpr } },
    { $match: { hi: { $gt: 0 } } },
    { $group: { _id: { rc: '$rc', isPet: '$isPet' }, count: { $sum: 1 } } },
  ], qid);
  let total = 0, pet = 0, nonPet = 0; const petMap = {}, nonPetMap = {};
  rows.forEach(r => {
    total += r.count;
    if (r._id.isPet) { pet += r.count; petMap[r._id.rc] = (petMap[r._id.rc] || 0) + r.count; }
    else { nonPet += r.count; nonPetMap[r._id.rc] = (nonPetMap[r._id.rc] || 0) + r.count; }
  });
  const toList = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([rootCause, count]) => ({ rootCause, count }));
  return {
    total, pet, nonPet,
    petPct: pct1(pet, total), nonPetPct: pct1(nonPet, total),
    petBreakdown: toList(petMap), nonPetBreakdown: toList(nonPetMap),
  };
}

const DASH_CHUNKS = {
  summary: dashSummary, age: dashAge, 'age-detail': dashAgeDetail, queue: dashQueue, daily7: dashDaily7,
  weekly: dashWeekly, 'sla-weekly': dashSlaWeekly, incidents: dashIncidents, hi: dashHi,
};

// ============================================================================
// MATERIALIZED ROLLUP: precompute all 8 chunks once per publish and store them in a
// single tiny doc { _id: quarter, publishedAt, chunks:{...} }. Reads then become a
// single findOne (~ms) instead of re-aggregating 8k tickets on every request.
// ============================================================================

// Recompute every chunk for a quarter and upsert the rollup doc. Best-effort: on error
// it throws so callers can log, but publish flows must never block on it.
async function recomputeRollup(qid) {
  qid = qid || currentQuarter();
  // Skip time-sensitive chunks (age/age-detail) — they always compute live, so caching them is pointless.
  const names = Object.keys(DASH_CHUNKS).filter(n => !ALWAYS_LIVE_CHUNKS.has(n));
  // Run all chunk aggregations for this quarter (in parallel).
  const results = await Promise.all(names.map(n => DASH_CHUNKS[n](qid)));
  const chunks = {};
  names.forEach((n, i) => { chunks[n] = results[i]; });
  const meta = await liveMetaFor(qid);
  const rollColl = await getCollection(COLLECTIONS.dashRollups);
  await rollColl.updateOne(
    { _id: qid },
    { $set: { publishedAt: meta.publishedAt, computedAt: new Date().toISOString(), chunks } },
    { upsert: true }
  );
  return { quarter: qid, publishedAt: meta.publishedAt };
}

// Version stamp for a specific quarter (tiny projection).
async function liveMetaFor(qid) {
  const coll = await getCollection(COLLECTIONS.quarters);
  const doc = await coll.findOne({ _id: qid }, { projection: { 'meta.publishedAt': 1, 'data.updatedAt': 1 } });
  return { publishedAt: (doc && doc.meta && doc.meta.publishedAt) || (doc && doc.data && doc.data.updatedAt) || null };
}

// Register all chunk endpoints (public read). Serves from the precomputed rollup when it's
// current; otherwise falls back to a live aggregation and kicks off a background recompute.
// Age chunks depend on the CURRENT clock (a ticket's colour changes as hours pass), so they are
// NOT served from the (publish-time) rollup — they always compute live. Everything else is cacheable.
const ALWAYS_LIVE_CHUNKS = new Set(['age', 'age-detail']);
Object.keys(DASH_CHUNKS).forEach(name => {
  app.get('/api/dash/' + name, async (req, res) => {
    const qid = currentQuarter();
    try {
      const meta = await liveMeta();
      if (!ALWAYS_LIVE_CHUNKS.has(name)) {
        const rollColl = await getCollection(COLLECTIONS.dashRollups);
        const roll = await rollColl.findOne({ _id: qid });
        // Rollup is current (matches the live publishedAt) and has this chunk -> serve it instantly.
        if (roll && roll.chunks && roll.chunks[name] && (roll.publishedAt || null) === (meta.publishedAt || null)) {
          return res.json(Object.assign({ quarter: qid, label: quarterLabel(qid), publishedAt: meta.publishedAt, cached: true }, roll.chunks[name]));
        }
      }
      // Always-live chunk, or missing/stale rollup -> compute live now.
      const slice = await DASH_CHUNKS[name](qid);
      res.json(Object.assign({ quarter: qid, label: quarterLabel(qid), publishedAt: meta.publishedAt, cached: false }, slice));
      // Refresh the (cacheable) rollup in the background when we had to compute a cacheable chunk live.
      if (!ALWAYS_LIVE_CHUNKS.has(name)) recomputeRollup(qid).catch(e => console.error('rollup recompute (bg) failed:', e && e.message));
    } catch (e) {
      res.status(500).json({ error: 'Could not compute dashboard chunk: ' + name });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('PHD API listening on port ' + PORT);
  // Backfill the current live quarter's dashboard rollup on boot if it's missing/stale, so the
  // first visitor after a (re)deploy gets instant chunks without waiting for the next upload.
  (async () => {
    try {
      const qid = currentQuarter();
      const [meta, rollColl] = await Promise.all([liveMetaFor(qid), getCollection(COLLECTIONS.dashRollups)]);
      const roll = await rollColl.findOne({ _id: qid }, { projection: { publishedAt: 1 } });
      if (!roll || (roll.publishedAt || null) !== (meta.publishedAt || null)) {
        await recomputeRollup(qid);
        console.log('Dashboard rollup backfilled for ' + qid);
      }
    } catch (e) { console.error('rollup backfill failed:', e && e.message); }
  })();
});
