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

// Only the 2026-Q2 quarter records the specific ShortIds added/updated in each merge (per request).
const Q2_QUARTER = '2026-Q2';

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

// Lightweight roster (username + role + displayName + avatar) for any logged-in user — used by the
// dashboard for the purple-ticket policy check and to show avatars/display names next to people.
app.get('/api/user-roles', requireRole('user'), async (req, res) => {
  try {
    const users = await getCollection(COLLECTIONS.users);
    const list = await users.find({}, { projection: { username: 1, role: 1, displayName: 1, avatar: 1 } }).toArray();
    res.json(list.map(u => ({ username: u.username, role: u.role, displayName: u.displayName || '', avatar: u.avatar || '' })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load user roles.' });
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
            liveQuarter: q, pastQuarterMerge: false,
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
        let added = 0, updated = 0;
        const addedIds = [], updatedIds = [];
        for (const t of arr) {
          if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
          const id = String(t.ShortId || '').trim(); if (!id) continue;
          if (map.has(id)) { updated++; updatedIds.push(id); } else { added++; addedIds.push(id); }
          map.set(id, t); // uploaded (new) version wins
        }
        const merged = Array.from(map.values());
        const qSummary = { added, updated, preserved: dbBefore - updated, uploaded: arr.length, total: merged.length };
        const meta = { publishedBy: req.user.username, publishedAt, count: merged.length, changeSummary: qSummary };
        const payload = { updatedAt: publishedAt, count: merged.length, tickets: merged };
        await coll.updateOne({ _id: q }, { $set: { data: payload, meta } }, { upsert: true });
        written.push({ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false, merged: true });
        // Non-live (past) quarter data-log entry with ITS OWN change summary.
        try {
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
        liveQuarter: liveQ, pastQuarterMerge: false,
        written: [{ quarter: liveQ, label: quarterLabel(liveQ), count: mergedLive.length, isLive: true }],
        changeSummary: body.changeSummary || null,
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
      let added = 0, updated = 0; const addedIds = [], updatedIds = [];
      for (const t of arr) {
        if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
        const id = String(t.ShortId || '').trim(); if (!id) continue;
        if (qmap.has(id)) { updated++; updatedIds.push(id); } else { added++; addedIds.push(id); }
        qmap.set(id, t);
      }
      const merged = Array.from(qmap.values());
      const qSummary = { added, updated, preserved: dbBefore - updated, uploaded: arr.length, total: merged.length };
      await coll.updateOne({ _id: q }, { $set: { data: { updatedAt: publishedAt, count: merged.length, tickets: merged }, meta: { publishedBy: req.user.username, publishedAt, count: merged.length, changeSummary: qSummary } } }, { upsert: true });
      written.push({ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false, merged: true });
      try {
        const logDoc = { user: req.user.username, role: req.user.role, at: publishedAt, liveQuarter: q, pastQuarterMerge: true, written: [{ quarter: q, label: quarterLabel(q), count: merged.length, isLive: false }], changeSummary: qSummary, totalTickets: merged.length };
        if (q === Q2_QUARTER) logDoc.changedTickets = { added: addedIds, updated: updatedIds };
        await logColl.insertOne(logDoc);
      } catch (logErr) { /* never block */ }
    }

    res.json({ ok: true, liveQuarter: liveQ, written, applied, removed: removedCount });
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

    let added = 0, updated = 0, skippedNoId = 0;
    const addedIds = [], updatedIds = [];
    for (const t of data.tickets) {
      if (!t.ShortId && t.IssueId) t.ShortId = t.IssueId;
      const id = String(t.ShortId || '').trim();
      if (!id) { skippedNoId++; continue; }
      if (map.has(id)) { updated++; updatedIds.push(id); } else { added++; addedIds.push(id); }
      map.set(id, t); // uploaded (new) version wins
    }
    const merged = Array.from(map.values());
    const publishedAt = new Date().toISOString();
    const changeSummary = {
      added,                          // tickets not previously in this quarter
      updated,                        // existing tickets overwritten by the upload
      preserved: dbBefore - updated,  // existing tickets kept (not in the upload)
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
    const entries = await logColl.find({}).sort({ at: -1 }).limit(200).toArray();
    res.json(entries.map(e => ({
      id: String(e._id),
      user: e.user,
      role: e.role,
      at: e.at,
      liveQuarter: e.liveQuarter,
      pastQuarterMerge: !!e.pastQuarterMerge,
      written: e.written || [],
      changeSummary: e.changeSummary || null,
      changedTickets: e.changedTickets || null,
      totalTickets: e.totalTickets,
    })));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('PHD API listening on port ' + PORT));
