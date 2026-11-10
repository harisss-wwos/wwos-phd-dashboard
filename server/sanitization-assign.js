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
// result is not cleared (every REQUIRED check passing, sanitization-score.js requiredChecks); failed
// tickets stay with that contractor until the owner revokes.
// Assignments made before the ClosureCode point keep their stored scoreAtAssign (out of 10 then);
// it is shown as stored.
// Kept in its own module (pure functions + handlers taking deps) so it can be unit-tested without a DB.
// Owner-approved error tickets (COLLECTIONS.sanitizationExcluded, see handleErrorReview) are taken
// out of the score report before it gets here (sanitization-score.js applyApproved: excludedReason
// 'approved error'), so they are never available / picked, and verification counts them as excluded
// (neither passed nor failed). contractorView drops them altogether.
'use strict';
const { isOwner, CRITERIA, MAX_SCORE, APPROVED_REASON, REQUIRED, REQUIRED_GROUPS, ticketCleared } = require('./sanitization-score');

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
// Missing chip of one criterion; with a required-check group (sanitization-score.js requiredChecks)
// the ClosureCode chip says what to change it to ('ClosureCode: change to Successful').
const chipFor = (key, grp) => {
  const c = CRITERIA.find(x => x.key === key) || { chip: key };
  const req = grp && REQUIRED[grp];
  return key === 'closure' && req && req.target ? 'ClosureCode: change to ' + req.target : c.chip;
};
// Missing chips for display. With grp: only the REQUIRED checks that fail (the tracker and Errors in
// Resolved). Without: every failing check; the ClosureCode chip carries '(<current> → <expected>)'.
const missingChips = (checks, grp) => {
  const req = grp && REQUIRED[grp];
  return CRITERIA.map((c, i) => {
    const ck = checks && checks[i];
    if (ck && ck[0]) return null;
    if (req) return req.keys.indexOf(c.key) >= 0 ? chipFor(c.key, grp) : null;
    return c.key === 'closure' && ck && ck[1] ? c.chip + ' (' + ck[1] + ')' : c.chip;
  }).filter(Boolean);
};
// Failing REQUIRED criterion keys of a report ticket.
const missingRequired = t => {
  const req = t && REQUIRED[t.grp];
  return req ? req.keys.filter(k => { const i = CRITERIA.findIndex(c => c.key === k); return !(t.checks && t.checks[i] && t.checks[i][0]); }) : missingKeys(t && t.checks);
};
// Verification result cleared: every required check passes (older snapshots without `cleared`: 11/11).
const resCleared = r => (typeof r.cleared === 'boolean' ? r.cleared : r.score === MAX_SCORE);

// Live verification of one assignment against the current report, or null when the data stamp is not
// newer than assignedAt (nothing uploaded since the assignment) or the assignment is not active.
function liveVerification(a, report, stamp, now) {
  if (!a || a.status !== 'active' || !report) return null;
  const st = timeOf(stamp), at = timeOf(a.assignedAt);
  if (isNaN(st) || isNaN(at) || st <= at) return null;
  const ix = reportIndex(report);
  const results = (a.tickets || []).map(t => {
    const cur = ix.byId.get(t.shortId);
    if (cur) return { shortId: t.shortId, score: cur.score, missing: missingRequired(cur), found: true, cleared: ticketCleared(cur), grp: cur.grp || null };
    const why = ix.excluded.get(t.shortId);
    if (why) return { shortId: t.shortId, score: null, missing: [], found: true, excludedReason: why };
    return { shortId: t.shortId, score: null, missing: [], found: false };
  });
  return { dataStamp: stamp, verifiedAt: (now || new Date()).toISOString(), results };
}
const passedResult = r => !!r && r.found && !r.excludedReason && resCleared(r);

// Map shortId -> assignee for every locked ticket (active assignment, live result not cleared).
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
    if (resCleared(r)) s.passed++; else s.failed++;
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
      if (resCleared(r)) p.passed++; else p.failed++;
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

  // Needs rework: Verified assignments with at least one ticket whose required checks do not all pass.
  const issues = [];
  docs.forEach(a => {
    const v = live.get(a);
    if (statusOf(a, v, now).key !== 'verified') return;
    const meta = new Map((a.tickets || []).map(t => [t.shortId, t]));
    const bad = v.results.filter(r => r.found && !r.excludedReason && !resCleared(r));
    if (!bad.length) return;
    issues.push({
      id: String(a._id), assignee: a.assignee, assignedAt: a.assignedAt, dueAt: a.dueAt, score: a.score, count: a.count,
      failedCount: bad.length, dataStamp: v.dataStamp,
      tickets: bad.map(r => { const t = meta.get(r.shortId) || {}; return { shortId: r.shortId, url: t.url || '', title: t.title || '', score: r.score, missing: r.missing.map(k => (r.grp ? chipFor(k, r.grp) : chipOf(k))) }; }),
    });
  });

  return { status: 200, body: { asOf: deps.stamp || null, dueDays: DUE_MS / 86400000, maxScore: MAX_SCORE, contractors, assignments, performance, issues } };
}

// ---- My sanitization (GET /api/my-sanitization; strictly read-only, never persists) ----
// One contractor's tickets across their ACTIVE assignments, scored live against the current report.
// A ticket in several active assignments is listed once (its most recent assignment wins).
// Ticket status: 'cleared' (every REQUIRED check passes, sanitization-score.js requiredChecks) |
// 'needs-correction' (a required check fails) | 'not-found' | 'excluded'. Each ticket carries
// passedNow / requiredNow (the pill), group (the Needs correction sub-section) and closureCode;
// scoreNow stays the raw 0..11 score. totals.needBy = needs-correction count per group.
// `verified` = data uploaded after the assignment (the same stamp rule as liveVerification);
// totals.pending counts the tickets not verified yet.
// Marks (COLLECTIONS.sanitizationMarks, one doc per (login, shortId)):
//   'completed' - TEMPORARY: a ticket below MAX_SCORE becomes 'temp-completed' while the mark's dataStamp
//                 equals the current data stamp. Once new data is uploaded the mark is stale and
//                 ignored (kept in the DB): the ticket is re-checked with its new score, and
//                 `staleMark` lets the UI say "Marked completed on <date> - re-checked with the new data".
//   'error'     - does NOT expire with an upload: the ticket stays 'error-ticket' (whatever its score)
//                 until the owner approves it (handleErrorReview 'approve' -> excluded everywhere) or
//                 sends it back ('return').
//   'returned'  - sent back by the owner: the ticket counts as needs correction (or cleared at MAX_SCORE)
//                 and carries `returned: { note, at, by }` until the contractor marks it again.
// Tickets the owner approved as errors (approvedIds / excludedReason 'approved error') are left out.
// Order: needs-correction (score ascending, then oldest assigned first), temp-completed / error-ticket
// (most recently marked first), cleared (most recently assigned first), then excluded / not-found
// (most recently assigned first).
const STATUS_RANK = { 'needs-correction': 0, 'temp-completed': 1, 'error-ticket': 2, cleared: 3, excluded: 4, 'not-found': 5 };
const MARK_STATUSES = { completed: 'temp-completed', error: 'error-ticket' };
const REASON_MAX = 500;
const REVIEW_MAX = 500;   // shortIds per error-review request
// 'completed' counts only while it was made against the current data stamp; 'error' never expires.
const markValid = (m, stamp) => !!m && !!MARK_STATUSES[m.status]
  && (m.status === 'error' || (!!stamp && m.dataStamp === stamp));
const markOut = m => ({ status: m.status, reason: m.reason || '', at: m.at || null, by: m.by || '' });
const returnedOut = m => ((m && m.status === 'returned') ? { note: m.ownerNote || '', at: m.returnedAt || null, by: m.returnedBy || '' } : null);
function contractorView(assignments, login, report, stamp, marks, approvedIds) {
  const me = normLogin(login);
  const ix = report ? reportIndex(report) : { byId: new Map(), excluded: new Map() };
  const st = timeOf(stamp);
  const appr = approvedIds instanceof Set ? approvedIds : new Set(approvedIds || []);
  const mk = new Map((marks || []).filter(m => m && normLogin(m.login) === me && m.shortId).map(m => [m.shortId, m]));
  const docs = (assignments || [])
    .filter(a => a && a.status === 'active' && normLogin(a.assignee) === me)
    .sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
  const seen = new Set(), tickets = [];
  docs.forEach(a => {
    const at = timeOf(a.assignedAt), verified = !isNaN(st) && !isNaN(at) && st > at;
    (a.tickets || []).forEach(t => {
      if (!t || !t.shortId || seen.has(t.shortId)) return;
      seen.add(t.shortId);
      const cur = ix.byId.get(t.shortId), why = cur ? null : ix.excluded.get(t.shortId);
      if (appr.has(t.shortId) || why === APPROVED_REASON) return;   // owner-approved error: not tracked
      const scoreNow = cur && typeof cur.score === 'number' ? cur.score : null;
      const clearedNow = cur ? ticketCleared(cur) : false;
      let status = cur ? (clearedNow ? 'cleared' : 'needs-correction') : (why ? 'excluded' : 'not-found');
      const m = mk.get(t.shortId), valid = markValid(m, stamp);
      if (valid && cur && (status === 'needs-correction' || m.status === 'error')) status = MARK_STATUSES[m.status];
      tickets.push({
        shortId: t.shortId, url: t.url || (cur && cur.url) || '', title: (cur && cur.title) || t.title || '',
        assignedAt: a.assignedAt || null, dueAt: a.dueAt || null,
        scoreAtAssign: typeof t.scoreAtAssign === 'number' ? t.scoreAtAssign : null, scoreNow,
        // Required-check rule: passed / required, cleared when equal; group = Needs correction sub-section.
        passedNow: cur && typeof cur.pass === 'number' ? cur.pass : null, requiredNow: cur && typeof cur.need === 'number' ? cur.need : null,
        clearedNow, group: (cur && cur.grp) || null, closureCode: cur ? (cur.cc || '') : null,
        missingNow: cur ? missingChips(cur.checks, cur.grp) : [], status, excludedReason: why || null, verified,
        mark: valid ? markOut(m) : null,
        staleMark: (!valid && m && MARK_STATUSES[m.status]) ? markOut(m) : null,
        returned: status === 'needs-correction' ? returnedOut(m) : null,
      });
    });
  });
  const atAsc = (x, y) => String(x.assignedAt || '').localeCompare(String(y.assignedAt || ''));
  const markDesc = (x, y) => String((y.mark && y.mark.at) || '').localeCompare(String((x.mark && x.mark.at) || ''));
  const grpRank = t => { const i = REQUIRED_GROUPS.indexOf(t.group); return i < 0 ? REQUIRED_GROUPS.length : i; };
  tickets.sort((x, y) => (STATUS_RANK[x.status] - STATUS_RANK[y.status])
    || (x.status === 'needs-correction' ? ((grpRank(x) - grpRank(y)) || ((x.passedNow - y.passedNow) || 0) || atAsc(x, y))
      : (x.mark ? markDesc(x, y) : atAsc(y, x)))
    || x.shortId.localeCompare(y.shortId));
  const count = s => tickets.filter(t => t.status === s).length;
  // Needs correction per closure-code group (the tracker's sub-sections).
  const needBy = {};
  REQUIRED_GROUPS.forEach(g => { needBy[g] = 0; });
  tickets.forEach(t => { if (t.status === 'needs-correction' && needBy[t.group] != null) needBy[t.group]++; });
  return {
    login: me, dataAsOf: stamp || null, maxScore: MAX_SCORE, tickets,
    totals: { assigned: tickets.length, cleared: count('cleared'), needsCorrection: count('needs-correction'), needBy,
      tempCompleted: count('temp-completed'), errorTickets: count('error-ticket'),
      notFound: count('not-found'), excluded: count('excluded'), pending: tickets.filter(t => !t.verified).length },
  };
}

// GET /api/my-sanitization[?login=]. Returns { status, body }. Never writes.
//   owner AND contractors get the same data: without ?login -> { owner, viewer, contractors:[{login,
//   displayName, assigned, cleared, needsCorrection, pending, notFound, excluded, ...}] }; with
//   ?login=<contractor> that contractor's view (+ canMark: owner, or the contractor's own view);
//   anyone else -> 403. The (expensive) data is loaded only after the access check.
// deps: { user, contractors, load: async () => ({ docs (active assignments), report, stamp, marks? }) }
async function handleMine(query, deps) {
  const me = normLogin(deps.user && deps.user.username);
  const list = deps.contractors || [];
  const owner = !!me && isOwner(me);
  const findC = l => list.find(c => c.login === l);
  if (!me || (!owner && !findC(me))) return { status: 403, body: { error: 'My sanitization is available only to contractors.' } };
  const want = normLogin(query && query.login);
  if (want && !findC(want)) return { status: 404, body: { error: 'Unknown contractor.' } };
  const { docs, report, stamp, marks, approved } = await deps.load();
  const apprIds = new Set((approved || []).map(d => d && d.shortId).filter(Boolean));
  if (!want) {
    return { status: 200, body: { owner, viewer: me, dataAsOf: stamp || null, maxScore: MAX_SCORE, contractors: list.map(c => ({ login: c.login, displayName: c.displayName || '', ...contractorView(docs, c.login, report, stamp, marks, apprIds).totals })) } };
  }
  const v = contractorView(docs, want, report, stamp, marks, apprIds);
  // Error tickets are owner-only: everyone else gets only their count (totals.errorTickets), no rows.
  if (!owner) v.tickets = v.tickets.filter(t => t.status !== 'error-ticket');
  const body = { owner, viewer: me, canMark: owner || want === me, canReview: owner, displayName: (findC(want) || {}).displayName || '', ...v };
  if (owner) {
    // Approved errors reported by this contractor (the Restore safety net), most recent first.
    const meta = new Map();
    (docs || []).forEach(a => (a && a.tickets || []).forEach(t => { if (t && t.shortId && !meta.has(t.shortId)) meta.set(t.shortId, t); }));
    body.approved = (approved || []).filter(d => d && d.shortId && normLogin(d.login) === want)
      .map(d => { const t = meta.get(d.shortId) || {}; return { shortId: d.shortId, url: t.url || '', title: t.title || '', approvedBy: d.approvedBy || '', approvedAt: d.approvedAt || null, reason: d.reason || '', note: d.note || '' }; })
      .sort((x, y) => String(y.approvedAt || '').localeCompare(String(x.approvedAt || '')) || x.shortId.localeCompare(y.shortId));
  }
  return { status: 200, body };
}

// POST /api/my-sanitization/mark { shortId, status:'completed'|'error'|'' (clear), reason, login? }.
// A contractor marks only tickets in their own ACTIVE sanitization assignments (any `login` other than
// their own -> 403); the owner may mark for any contractor via `login`. Only tickets currently below
// MAX_SCORE can be marked; 'error' needs a reason (1..500 characters). One doc per (login, shortId),
// upserted with the current data stamp; clearing (Undo) sets status '' (never deleted).
// deps: { user, contractors, coll (marks), load: async () => ({ docs, report, stamp }), now? }
async function handleMark(body, deps) {
  const b = body || {};
  const me = normLogin(deps.user && deps.user.username);
  const list = deps.contractors || [];
  const owner = !!me && isOwner(me);
  const isC = l => list.some(c => c.login === l);
  if (!me || (!owner && !isC(me))) return { status: 403, body: { error: 'Marking is available only to contractors.' } };
  const asked = typeof b.login === 'string' ? normLogin(b.login) : '';
  if (!owner && asked && asked !== me) return { status: 403, body: { error: 'You can mark only your own tickets.' } };
  const login = owner ? asked : me;
  if (!login) return { status: 400, body: { error: 'login is required.' } };
  if (!isC(login)) return { status: 404, body: { error: 'Unknown contractor.' } };
  const shortId = typeof b.shortId === 'string' ? b.shortId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shortId)) return { status: 400, body: { error: 'Invalid ticket.' } };
  const status = typeof b.status === 'string' ? b.status : null;
  if (status !== '' && !MARK_STATUSES[status]) return { status: 400, body: { error: "status must be 'completed', 'error' or ''." } };
  const reason = status === 'error' ? (typeof b.reason === 'string' ? b.reason.trim() : '') : '';
  if (status === 'error' && !reason) return { status: 400, body: { error: 'Please say why this is an error ticket.' } };
  if (reason.length > REASON_MAX) return { status: 400, body: { error: 'The reason can be at most ' + REASON_MAX + ' characters.' } };
  const { docs, report, stamp } = await deps.load();
  const mine = (docs || []).some(a => a && a.status === 'active' && normLogin(a.assignee) === login
    && (a.tickets || []).some(t => t && t.shortId === shortId));
  if (!mine) {
    return owner ? { status: 404, body: { error: 'This ticket is not in ' + login + '\u2019s active sanitization assignments.' } }
      : { status: 403, body: { error: 'You can mark only tickets in your own sanitization assignments.' } };
  }
  if (status) {
    const cur = report ? reportIndex(report).byId.get(shortId) : null;
    if (!cur || ticketCleared(cur)) return { status: 409, body: { error: 'Only tickets that still need correction can be marked.' } };
  }
  // A ticket sent to the owner for error review stays with the owner until approved or sent back.
  if (!owner) {
    const prev = await deps.coll.findOne({ login, shortId });
    if (prev && prev.status === 'error') return { status: 409, body: { error: 'This ticket is with the owner for error review.' } };
  }
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const doc = { login, shortId, status, reason, at, by: me, dataStamp: stamp || null };
  await deps.coll.updateOne({ login, shortId }, { $set: doc }, { upsert: true });
  return { status: 200, body: { ok: true, login, shortId, mark: status ? markOut(doc) : null, dataStamp: doc.dataStamp } };
}

// ---- Error review (owner only) ----
const OWNER_REVIEW = 'Only harisss can review error tickets.';
const SID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// POST /api/my-sanitization/error-review { shortIds:[...], action:'approve'|'return', note }.
// Only shortIds that currently have an 'error' mark are processed (the rest come back in `skipped`;
// none valid -> 409).
//   approve: upsert one doc per ticket into COLLECTIONS.sanitizationExcluded { shortId, approvedBy,
//            approvedAt, login (who reported it), reason (their reason), note (optional, <= 500) }:
//            permanent (not tied to the data stamp), the ticket leaves sanitization tracking
//            everywhere. The mark is left as it is, so Restore brings it back to Error tickets.
//   return:  the mark becomes { status:'returned', ownerNote: note (required, <= 500), returnedAt,
//            returnedBy }: back to the contractor's Needs correction with the owner's message.
// deps: { user, marksColl, exclColl, now? }
async function handleErrorReview(body, deps) {
  const me = normLogin(deps.user && deps.user.username);
  if (!me || !isOwner(me)) return { status: 403, body: { error: OWNER_REVIEW } };
  const b = body || {};
  const bad = error => ({ status: 400, body: { error } });
  if (!Array.isArray(b.shortIds) || !b.shortIds.length) return bad('shortIds must be a non-empty list.');
  if (b.shortIds.length > REVIEW_MAX) return bad('At most ' + REVIEW_MAX + ' tickets at a time.');
  const ids = Array.from(new Set(b.shortIds.map(s => (typeof s === 'string' ? s.trim() : ''))));
  if (ids.some(s => !SID_RE.test(s))) return bad('Invalid ticket.');
  const action = b.action;
  if (action !== 'approve' && action !== 'return') return bad("action must be 'approve' or 'return'.");
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (b.note != null && typeof b.note !== 'string') return bad('note must be text.');
  if (action === 'return' && !note) return bad('Please write a message for the contractor.');
  if (note.length > REASON_MAX) return bad('The message can be at most ' + REASON_MAX + ' characters.');
  const marks = await deps.marksColl.find({ shortId: { $in: ids }, status: 'error' }).toArray();
  const byId = new Map();
  marks.forEach(m => { const p = byId.get(m.shortId); if (!p || String(m.at || '') > String(p.at || '')) byId.set(m.shortId, m); });
  const done = ids.filter(s => byId.has(s)), skipped = ids.filter(s => !byId.has(s));
  if (!done.length) return { status: 409, body: { error: 'None of these tickets has an error mark.', skipped } };
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  if (action === 'approve') {
    await deps.exclColl.bulkWrite(done.map(s => {
      const m = byId.get(s);
      return { updateOne: { filter: { shortId: s }, update: { $set: { shortId: s, approvedBy: me, approvedAt: at, login: normLogin(m.login), reason: m.reason || '', note } }, upsert: true } };
    }), { ordered: false });
  } else {
    await deps.marksColl.bulkWrite(marks.filter(m => done.indexOf(m.shortId) >= 0).map(m => ({
      updateOne: { filter: { login: m.login, shortId: m.shortId, status: 'error' }, update: { $set: { status: 'returned', ownerNote: note, returnedAt: at, returnedBy: me } } },
    })), { ordered: false });
  }
  return { status: 200, body: { ok: true, action, done, skipped, at, by: me } };
}

// POST /api/my-sanitization/restore { shortId } (owner only): deletes the approval, so the ticket is
// tracked again (its error mark, if still there, puts it back in Error tickets).
// deps: { user, exclColl }
async function handleRestore(body, deps) {
  const me = normLogin(deps.user && deps.user.username);
  if (!me || !isOwner(me)) return { status: 403, body: { error: OWNER_REVIEW } };
  const shortId = typeof (body && body.shortId) === 'string' ? body.shortId.trim() : '';
  if (!SID_RE.test(shortId)) return { status: 400, body: { error: 'Invalid ticket.' } };
  const r = await deps.exclColl.deleteOne({ shortId });
  if (!r || !r.deletedCount) return { status: 404, body: { error: 'This ticket is not an approved error.' } };
  return { status: 200, body: { ok: true, shortId } };
}

module.exports = {
  DUE_MS, COUNT_MAX, REASON_MAX, REVIEW_MAX, contractorsOf, liveVerification, lockedMap, availableInSection, availableCounts,
  validateAssign, handleAssign, handleRevoke, handleGet, statusOf, contractorView, handleMine, handleMark, markValid,
  handleErrorReview, handleRestore, missingChips, passedResult, chipFor, missingRequired,
};
