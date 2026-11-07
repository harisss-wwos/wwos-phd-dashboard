// Sanitization assignments (ticket-sanitization.html, owner-only): harisss hands low-score tickets to
// a contractor to sanitize, then the next data uploads verify them. One collection
// (COLLECTIONS.sanitizationAssignments), one doc per assign action:
//   { _id, assignee, assignedBy, assignedAt, dueAt (assignedAt + 7 days), score, count,
//     tickets:[{ shortId, url, title, cq, scoreAtAssign, missingAtAssign:[criterion keys] }],
//     status:'active'|'revoked', revokedAt?, revokedBy?,
//     verification:{ dataStamp, verifiedAt, results:[{ shortId, score, missing:[keys], found, excludedReason? }] } | null,
//     history:[previous verifications] }
// Verification is computed LIVE on every read from the current score report (same data stamp as the
// scores, eirDataStamp) once that stamp is newer than assignedAt; the owner's GET persists a snapshot
// only when the stamp differs from the stored one (the old one moves to history). Never deleted.
// A ticket is LOCKED (not available to assign) while it is in an active assignment and its live
// result is not 10/10; failed tickets stay with that contractor until the owner revokes.
// Kept in its own module (pure functions + handlers taking deps) so it can be unit-tested without a DB.
'use strict';
const { isOwner, CRITERIA, MAX_SCORE } = require('./sanitization-score');

const DUE_MS = 7 * 24 * 60 * 60 * 1000;
const COUNT_MAX = 2000;
const OWNER_ONLY = 'Sanitization assignments are visible only to harisss.';
const normLogin = s => String(s == null ? '' : s).trim().toLowerCase();
const timeOf = s => { const n = Date.parse(s); return isNaN(n) ? NaN : n; };

// Contractors = the Assignment Center rule: analyst flag + role editor (users collection).
function contractorsOf(users) {
  return (users || [])
    .filter(u => u && u.analyst === true && normLogin(u.role) === 'editor' && normLogin(u.username))
    .map(u => ({ login: normLogin(u.username), displayName: u.displayName || '' }))
    .sort((a, b) => a.login.localeCompare(b.login));
}

// Per-report lookup (shortId -> scored ticket / exclusion reason), built once per cached report.
const _idx = new WeakMap();
function reportIndex(report) {
  let ix = _idx.get(report);
  if (!ix) {
    ix = {
      byId: new Map((report.tickets || []).map(t => [t.shortId, t])),
      excluded: new Map((report.excludedTickets || []).map(t => [t.shortId, t.reason])),
    };
    _idx.set(report, ix);
  }
  return ix;
}
const missingKeys = checks => CRITERIA.filter((c, i) => !(checks && checks[i] && checks[i][0])).map(c => c.key);

// Live verification of one assignment against the current report, or null when the data stamp is not
// newer than assignedAt (nothing uploaded since the assignment) or the assignment is not active.
function liveVerification(a, report, stamp, now) {
  if (!a || a.status !== 'active' || !report) return null;
  const st = timeOf(stamp), at = timeOf(a.assignedAt);
  if (isNaN(st) || isNaN(at) || st <= at) return null;
  const ix = reportIndex(report);
  const results = (a.tickets || []).map(t => {
    const cur = ix.byId.get(t.shortId);
    if (cur) return { shortId: t.shortId, score: cur.score, missing: missingKeys(cur.checks), found: true };
    const why = ix.excluded.get(t.shortId);
    if (why) return { shortId: t.shortId, score: null, missing: [], found: true, excludedReason: why };
    return { shortId: t.shortId, score: null, missing: [], found: false };
  });
  return { dataStamp: stamp, verifiedAt: (now || new Date()).toISOString(), results };
}
const passedResult = r => !!r && r.found && !r.excludedReason && r.score === MAX_SCORE;

// Map shortId -> assignee for every locked ticket (active assignment, live result not 10/10).
function lockedMap(assignments, report, stamp, now) {
  const out = new Map();
  (assignments || []).forEach(a => {
    if (!a || a.status !== 'active') return;
    const v = liveVerification(a, report, stamp, now);
    const res = v ? new Map(v.results.map(r => [r.shortId, r])) : null;
    (a.tickets || []).forEach(t => { if (!(res && passedResult(res.get(t.shortId)))) out.set(t.shortId, a.assignee); });
  });
  return out;
}

// Available tickets of one score section, in pick order: created quarter oldest -> newest (no quarter
// last), then the section's existing order (stable sort).
function availableInSection(report, score, locked) {
  const qk = t => (/^\d{4}-Q[1-4]$/.test(t.cq || '') ? t.cq : '~');
  return (report.tickets || [])
    .filter(t => t.score === score && t.shortId && !locked.has(t.shortId))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => qk(a.t).localeCompare(qk(b.t)) || (a.i - b.i))
    .map(x => x.t);
}
// { score: available count } for 0..MAX_SCORE.
function availableCounts(report, locked) {
  const out = {};
  for (let i = 0; i <= MAX_SCORE; i++) out[i] = 0;
  (report.tickets || []).forEach(t => { if (t.shortId && !locked.has(t.shortId) && out[t.score] != null) out[t.score]++; });
  return out;
}

// Strict input check. -> { ok, value:{score,count,assignee} } | { ok:false, status, error }.
function validateAssign(body, contractors) {
  const b = body || {};
  const bad = error => ({ ok: false, status: 400, error });
  if (typeof b.score !== 'number' || !Number.isInteger(b.score) || b.score < 0 || b.score > MAX_SCORE - 1) return bad('score must be a whole number from 0 to ' + (MAX_SCORE - 1) + '.');
  if (typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 1 || b.count > COUNT_MAX) return bad('count must be a whole number from 1 to ' + COUNT_MAX + '.');
  const assignee = typeof b.assignee === 'string' ? normLogin(b.assignee) : '';
  if (!assignee || !(contractors || []).some(c => c.login === assignee)) return bad('assignee must be one of the contractors.');
  return { ok: true, value: { score: b.score, count: b.count, assignee } };
}

// One assignment at a time per process, so two quick POSTs cannot pick the same tickets.
let _chain = Promise.resolve();
function serial(fn) { const p = _chain.then(fn, fn); _chain = p.catch(() => {}); return p; }

// POST /api/sanitization-assign { score, count, assignee }. Returns { status, body }.
// The SERVER picks the tickets: the section's first `count` available tickets (availableInSection).
// deps: { coll, user:{username}, report, stamp, contractors, now? }
function handleAssign(body, deps) {
  if (!deps.user || !isOwner(deps.user.username)) return Promise.resolve({ status: 403, body: { error: OWNER_ONLY } });
  const v = validateAssign(body, deps.contractors);
  if (!v.ok) return Promise.resolve({ status: v.status, body: { error: v.error } });
  return serial(async () => {
    const { score, count, assignee } = v.value;
    const now = deps.now ? deps.now() : new Date();
    const coll = deps.coll;
    const active = await coll.find({ status: 'active' }).toArray();
    const avail = availableInSection(deps.report, score, lockedMap(active, deps.report, deps.stamp, now));
    if (avail.length < count) {
      return { status: 409, body: { error: 'Only ' + avail.length + ' tickets with ' + score + ' points are available.', available: avail.length } };
    }
    const at = now.toISOString();
    const doc = {
      assignee, assignedBy: normLogin(deps.user.username), assignedAt: at,
      dueAt: new Date(now.getTime() + DUE_MS).toISOString(), score, count,
      tickets: avail.slice(0, count).map(t => ({
        shortId: t.shortId, url: t.url || '', title: String(t.title || '').slice(0, 300), cq: t.cq || '',
        scoreAtAssign: t.score, missingAtAssign: missingKeys(t.checks),
      })),
      status: 'active', verification: null, history: [],
    };
    const ins = await coll.insertOne(doc);
    return { status: 200, body: { ok: true, id: String(ins && ins.insertedId), assignee, score, count,
      dueAt: doc.dueAt, tickets: doc.tickets.map(t => ({ shortId: t.shortId, url: t.url })), available: avail.length - count } };
  });
}

// POST /api/sanitization-assign/revoke { id }: marks the assignment revoked (never deleted). Its
// tickets become available again. A second revoke is a no-op (alreadyRevoked).
// deps: { coll, user, toId (string -> _id or null), now? }
async function handleRevoke(body, deps) {
  if (!deps.user || !isOwner(deps.user.username)) return { status: 403, body: { error: OWNER_ONLY } };
  const raw = String((body && body.id) == null ? '' : body.id).trim();
  const id = raw ? deps.toId(raw) : null;
  if (id == null) return { status: 400, body: { error: 'Invalid assignment.' } };
  const coll = deps.coll;
  const doc = await coll.findOne({ _id: id });
  if (!doc) return { status: 404, body: { error: 'Assignment not found.' } };
  const already = d => ({ status: 200, body: { ok: true, alreadyRevoked: true, id: raw, revokedAt: d.revokedAt, revokedBy: d.revokedBy } });
  if (doc.status === 'revoked') return already(doc);
  const at = (deps.now ? deps.now() : new Date()).toISOString(), by = normLogin(deps.user.username);
  const r = await coll.updateOne({ _id: id, status: 'active' }, { $set: { status: 'revoked', revokedAt: at, revokedBy: by } });
  if (!r || !r.modifiedCount) return already((await coll.findOne({ _id: id })) || doc);
  return { status: 200, body: { ok: true, id: raw, assignee: doc.assignee, count: doc.count, revokedAt: at, revokedBy: by } };
}

// ---- Read side ----
const mean = xs => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 100) / 100 : null);
// Status: Revoked | In progress (before dueAt) | Verified (due, data newer than assignedAt) | Awaiting new data.
function statusOf(a, v, now) {
  if (a.status === 'revoked') return { key: 'revoked', label: 'Revoked' };
  if (now.getTime() < timeOf(a.dueAt)) return { key: 'progress', label: 'In progress' };
  return v ? { key: 'verified', label: 'Verified' } : { key: 'awaiting', label: 'Awaiting new data' };
}
function summarize(a, v, now) {
  const st = statusOf(a, v, now);
  const before = new Map((a.tickets || []).map(t => [t.shortId, t.scoreAtAssign]));
  const s = { status: st.key, statusLabel: st.label, verifiedCount: 0, passed: 0, failed: 0, notFound: 0, excluded: 0, avgBefore: null, avgAfter: null, dataStamp: v ? v.dataStamp : null };
  if (!v) return s;
  const b = [], af = [];
  v.results.forEach(r => {
    if (!r.found) { s.notFound++; return; }
    if (r.excludedReason) { s.excluded++; return; }
    s.verifiedCount++;
    if (r.score === MAX_SCORE) s.passed++; else s.failed++;
    if (typeof before.get(r.shortId) === 'number') b.push(before.get(r.shortId));
    af.push(r.score);
  });
  s.avgBefore = mean(b); s.avgAfter = mean(af);
  return s;
}
const chipOf = k => (CRITERIA.find(c => c.key === k) || { chip: k }).chip;

// GET /api/sanitization-assign. Returns { status, body }. Persists a verification snapshot into an
// active assignment only when the live data stamp differs from its stored verification's stamp
// (previous snapshot pushed onto history); deps.persist === false never writes.
// deps: { coll, user, report, stamp, contractors, now?, persist? }
async function handleGet(deps) {
  if (!deps.user || !isOwner(deps.user.username)) return { status: 403, body: { error: OWNER_ONLY } };
  const now = deps.now ? deps.now() : new Date();
  const coll = deps.coll;
  const docs = await coll.find({}).sort({ assignedAt: -1 }).toArray();
  const live = new Map();
  for (const a of docs) {
    const v = liveVerification(a, deps.report, deps.stamp, now);
    live.set(a, v);
    if (!v || deps.persist === false) continue;
    const old = a.verification || null;
    if (old && old.dataStamp === v.dataStamp) continue;
    const upd = { $set: { verification: v } };
    if (old) upd.$push = { history: old };
    await coll.updateOne({ _id: a._id, status: 'active' }, upd);
  }
  const locked = lockedMap(docs, deps.report, deps.stamp, now);
  const openBy = {};
  locked.forEach(login => { openBy[login] = (openBy[login] || 0) + 1; });
  const contractors = (deps.contractors || []).map(c => ({ ...c, open: openBy[c.login] || 0 }));

  const assignments = docs.map(a => {
    const v = live.get(a), sum = summarize(a, v, now);
    const res = v ? new Map(v.results.map(r => [r.shortId, r])) : new Map();
    return {
      id: String(a._id), assignee: a.assignee, assignedBy: a.assignedBy, assignedAt: a.assignedAt, dueAt: a.dueAt,
      score: a.score, count: a.count, status: a.status, revokedAt: a.revokedAt || null, revokedBy: a.revokedBy || null,
      tickets: (a.tickets || []).map(t => {
        const r = res.get(t.shortId);
        return { shortId: t.shortId, url: t.url, title: t.title, cq: t.cq, scoreAtAssign: t.scoreAtAssign,
          score: r ? r.score : null, found: r ? r.found : null, excludedReason: (r && r.excludedReason) || null };
      }),
      ...sum,
    };
  });

  // Performance: one row per contractor (plus anyone else with assignments); revoked work is left out.
  // Only Verified assignments count as verified; the rest of the tickets are pending.
  const perf = new Map();
  const row = login => {
    if (!perf.has(login)) perf.set(login, { login, displayName: '', assignments: 0, ticketsAssigned: 0, verified: 0, passed: 0, failed: 0, notFound: 0, pending: 0, _b: [], _a: [] });
    return perf.get(login);
  };
  contractors.forEach(c => { row(c.login).displayName = c.displayName; });
  docs.forEach(a => {
    if (a.status !== 'active') return;
    const p = row(a.assignee), v = live.get(a), st = statusOf(a, v, now);
    p.assignments++; p.ticketsAssigned += (a.tickets || []).length;
    if (st.key !== 'verified') { p.pending += (a.tickets || []).length; return; }
    const before = new Map((a.tickets || []).map(t => [t.shortId, t.scoreAtAssign]));
    v.results.forEach(r => {
      if (!r.found || r.excludedReason) { p.notFound++; return; }
      p.verified++;
      if (r.score === MAX_SCORE) p.passed++; else p.failed++;
      if (typeof before.get(r.shortId) === 'number') p._b.push(before.get(r.shortId));
      p._a.push(r.score);
    });
  });
  const performance = Array.from(perf.values()).map(p => {
    const avgScoreBefore = mean(p._b), avgScoreAfter = mean(p._a);
    const { _b, _a, ...rest } = p;
    return { ...rest, passRate: p.verified ? Math.round(p.passed / p.verified * 1000) / 10 : null, avgScoreBefore, avgScoreAfter,
      avgGain: avgScoreBefore != null && avgScoreAfter != null ? Math.round((avgScoreAfter - avgScoreBefore) * 100) / 100 : null };
  }).sort((a, b) => ((b.passRate == null ? -1 : b.passRate) - (a.passRate == null ? -1 : a.passRate)) || a.login.localeCompare(b.login));

  // Needs rework: Verified assignments with at least one ticket under 10/10.
  const issues = [];
  docs.forEach(a => {
    const v = live.get(a);
    if (statusOf(a, v, now).key !== 'verified') return;
    const meta = new Map((a.tickets || []).map(t => [t.shortId, t]));
    const bad = v.results.filter(r => r.found && !r.excludedReason && r.score !== MAX_SCORE);
    if (!bad.length) return;
    issues.push({
      id: String(a._id), assignee: a.assignee, assignedAt: a.assignedAt, dueAt: a.dueAt, score: a.score, count: a.count,
      failedCount: bad.length, dataStamp: v.dataStamp,
      tickets: bad.map(r => { const t = meta.get(r.shortId) || {}; return { shortId: r.shortId, url: t.url || '', title: t.title || '', score: r.score, missing: r.missing.map(chipOf) }; }),
    });
  });

  return { status: 200, body: { asOf: deps.stamp || null, dueDays: DUE_MS / 86400000, contractors, assignments, performance, issues } };
}

module.exports = {
  DUE_MS, COUNT_MAX, contractorsOf, liveVerification, lockedMap, availableInSection, availableCounts,
  validateAssign, handleAssign, handleRevoke, handleGet, statusOf,
};
