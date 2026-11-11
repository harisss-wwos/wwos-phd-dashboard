// Sanitization assignments (ticket-sanitization.html, owner-only): harisss hands low-score tickets to
// a contractor to sanitize, then the next data uploads verify them. One collection
// (COLLECTIONS.sanitizationAssignments), one doc per assign action:
//   { _id, assignee, assignedBy, assignedAt, score, count,
//     tickets:[{ shortId, url, title, cq, scoreAtAssign, missingAtAssign:[criterion keys] }],
//     status:'active'|'revoked', revokedAt?, revokedBy?,
//     verification:{ dataStamp, verifiedAt, results:[{ shortId, score, missing:[keys], found, cleared, mark, ... }] } | null,
//     history:[previous verifications] }
// (Older docs also carry dueAt: there is NO deadline any more, it is never used or shown.)
// VERIFICATION (owner rule): a ticket is verified ONLY when the contractor has MARKED it with a closure
// claim (successful / immediate / duplicate, COLLECTIONS.sanitizationMarks) AND the data stamp (latest
// upload, eirDataStamp) is newer than that mark (claimPending false). Then rule A is applied to the
// SIM ClosureCode (sanitization-score.js closureRule): pass -> sanitized, fail -> back to "to
// sanitize" with the defect (the mark is consumed). Nothing else verifies a ticket: an upload after
// the assignment does not verify unmarked tickets, and before verification the closure code is not
// checked at all. Computed LIVE on every read; the owner's GET persists a snapshot of the verified
// tickets only when they changed (the old one moves to history). Never deleted.
// A ticket is LOCKED (not available to assign) while it is in an active assignment and not verified
// as passing; failed tickets stay with that contractor until the owner revokes.
// Assignments made before the ClosureCode point keep their stored scoreAtAssign (out of 10 then);
// it is shown as stored.
// Kept in its own module (pure functions + handlers taking deps) so it can be unit-tested without a DB.
// Owner-approved error tickets (COLLECTIONS.sanitizationExcluded, see handleErrorReview) are taken
// out of the score report before it gets here (sanitization-score.js applyApproved: excludedReason
// 'approved error'), so they are never available / picked, and verification counts them as excluded
// (neither passed nor failed). contractorView drops them altogether.
'use strict';
const { isOwner, CRITERIA, MAX_SCORE, APPROVED_REASON, ticketCleared, closureKey, CODE_SUCCESSFUL, CODE_IR, CODE_DUP } = require('./sanitization-score');
const DUP_REASON = 'duplicate';   // excludeReason of a SIM Duplicate: counts as cleared here (no checks)

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
// Missing chip of one criterion; with a target code (the closure-code rule, sanitization-score.js
// closureRule) the ClosureCode chip says what to change it to ('ClosureCode: change to Successful').
const chipFor = (key, target) => {
  const c = CRITERIA.find(x => x.key === key) || { chip: key };
  return key === 'closure' && target ? 'ClosureCode: change to ' + target : c.chip;
};
// Missing chips of a report ticket: only the REQUIRED checks that fail (t.miss / t.tgt; the tracker
// and Errors in Resolved), in CRITERIA order.
const missingChips = t => {
  const miss = (t && Array.isArray(t.miss)) ? t.miss : missingKeys(t && t.checks);
  return CRITERIA.filter(c => miss.indexOf(c.key) >= 0).map(c => chipFor(c.key, t && t.tgt));
};
// Failing REQUIRED criterion keys of a report ticket.
const missingRequired = t => ((t && Array.isArray(t.miss)) ? t.miss.slice() : missingKeys(t && t.checks));
// Verification result cleared: every required check passes (older snapshots without `cleared`: 11/11).
const resCleared = r => (typeof r.cleared === 'boolean' ? r.cleared : r.score === MAX_SCORE);

// Marks lookup: Map 'login|shortId' -> mark doc, from a marks array (or an already built Map).
const markKey = (login, sid) => normLogin(login) + '|' + sid;
function markMap(marks) {
  if (marks instanceof Map) return marks;
  const m = new Map();
  (marks || []).forEach(d => { if (d && d.shortId) m.set(markKey(d.login, d.shortId), d); });
  return m;
}
// A closure claim the latest upload is newer than (the ticket is verified against it).
const verifiedClaim = (m, stamp) => !!m && !!CLAIMS[m.status] && !claimPending(m, stamp);

// Live verification of one assignment against the current report: one result per VERIFIED ticket
// (a closure claim with a newer upload, verifiedClaim), or null when none is verified or the
// assignment is not active. marks: array / markMap of the marks.
function liveVerification(a, report, stamp, now, marks) {
  if (!a || a.status !== 'active' || !report) return null;
  const ix = reportIndex(report), mk = markMap(marks);
  const results = [];
  (a.tickets || []).forEach(t => {
    if (!t || !t.shortId) return;
    const m = mk.get(markKey(a.assignee, t.shortId));
    if (!verifiedClaim(m, stamp)) return;
    const cur = ix.byId.get(t.shortId), why = cur ? null : ix.excluded.get(t.shortId);
    const base = { shortId: t.shortId, mark: m.status, markedAt: m.at || null };
    if (!cur && why && why !== DUP_REASON) { results.push({ ...base, score: null, missing: [], found: true, excludedReason: why }); return; }
    if (!cur && !why) { results.push({ ...base, score: null, missing: [], found: false }); return; }
    const ev = evalTicket(cur, why, m, stamp);
    results.push({ ...base, score: cur ? cur.score : null, missing: cur ? missingRequired(cur) : [], found: true,
      cleared: ev.status === 'cleared', grp: ev.group, tgt: ev.target, cc: ev.closureCode, defects: ev.defects.slice(), note: ev.note || null });
  });
  if (!results.length) return null;
  return { dataStamp: stamp, verifiedAt: (now || new Date()).toISOString(), results };
}
const passedResult = r => !!r && r.found && !r.excludedReason && resCleared(r);

// Map shortId -> assignee for every locked ticket (active assignment, not verified as passing).
function lockedMap(assignments, report, stamp, now, marks) {
  const out = new Map(), mk = markMap(marks);
  (assignments || []).forEach(a => {
    if (!a || a.status !== 'active') return;
    const v = liveVerification(a, report, stamp, now, mk);
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
// deps: { coll, user:{username}, report, stamp, contractors, marks?, now? }
function handleAssign(body, deps) {
  if (!deps.user || !isOwner(deps.user.username)) return Promise.resolve({ status: 403, body: { error: OWNER_ONLY } });
  const v = validateAssign(body, deps.contractors);
  if (!v.ok) return Promise.resolve({ status: v.status, body: { error: v.error } });
  return serial(async () => {
    const { score, count, assignee } = v.value;
    const now = deps.now ? deps.now() : new Date();
    const coll = deps.coll;
    const active = await coll.find({ status: 'active' }).toArray();
    const avail = availableInSection(deps.report, score, lockedMap(active, deps.report, deps.stamp, now, deps.marks));
    if (avail.length < count) {
      return { status: 409, body: { error: 'Only ' + avail.length + ' tickets with ' + score + ' points are available.', available: avail.length } };
    }
    const at = now.toISOString();
    const doc = {
      assignee, assignedBy: normLogin(deps.user.username), assignedAt: at, score, count,
      tickets: avail.slice(0, count).map(t => ({
        shortId: t.shortId, url: t.url || '', title: String(t.title || '').slice(0, 300), cq: t.cq || '',
        scoreAtAssign: t.score, missingAtAssign: missingKeys(t.checks),
      })),
      status: 'active', verification: null, history: [],
    };
    const ins = await coll.insertOne(doc);
    return { status: 200, body: { ok: true, id: String(ins && ins.insertedId), assignee, score, count,
      tickets: doc.tickets.map(t => ({ shortId: t.shortId, url: t.url })), available: avail.length - count } };
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
// Tracker section counts of one assignment (the same per-ticket rule as the contractor view, evalTicket):
// toSanitize (unmarked + failed verification) | tempCleared (marked, waiting for a newer upload) |
// errors (error marks with the owner) | sanitized (verified pass) | other (excluded / not found /
// owner-approved errors). No deadline: nothing here depends on the date.
function sectionCounts(a, report, stamp, marks) {
  const c = { toSanitize: 0, tempCleared: 0, errors: 0, sanitized: 0, other: 0 };
  const ix = report ? reportIndex(report) : { byId: new Map(), excluded: new Map() }, mk = markMap(marks);
  (a.tickets || []).forEach(t => {
    if (!t || !t.shortId) return;
    const cur = ix.byId.get(t.shortId), why = cur ? null : ix.excluded.get(t.shortId);
    const ev = why === APPROVED_REASON ? null : evalTicket(cur, why, mk.get(markKey(a.assignee, t.shortId)), stamp);
    const st = ev ? ev.status : '';
    if (st === 'needs-correction') c.toSanitize++;
    else if (st === 'awaiting') c.tempCleared++;
    else if (st === 'error-ticket') c.errors++;
    else if (st === 'cleared') c.sanitized++;
    else c.other++;
  });
  return c;
}
// Status: Revoked | Sanitized (nothing left to sanitize, waiting or with the owner) | In progress.
function statusOf(a, counts) {
  if (a.status === 'revoked') return { key: 'revoked', label: 'Revoked' };
  if (counts && !(counts.toSanitize + counts.tempCleared + counts.errors)) return { key: 'done', label: 'Sanitized' };
  return { key: 'progress', label: 'In progress' };
}
function summarize(a, v, counts) {
  const st = statusOf(a, counts);
  const before = new Map((a.tickets || []).map(t => [t.shortId, t.scoreAtAssign]));
  const s = { status: st.key, statusLabel: st.label, ...(counts || { toSanitize: 0, tempCleared: 0, errors: 0, sanitized: 0, other: 0 }),
    verifiedCount: 0, passed: 0, failed: 0, notFound: 0, excluded: 0, avgBefore: null, avgAfter: null, dataStamp: v ? v.dataStamp : null };
  if (!v) return s;
  const b = [], af = [];
  v.results.forEach(r => {
    if (!r.found) { s.notFound++; return; }
    if (r.excludedReason) { s.excluded++; return; }
    s.verifiedCount++;
    if (resCleared(r)) s.passed++; else s.failed++;
    if (typeof r.score !== 'number') return;   // SIM Duplicate: cleared, no score
    if (typeof before.get(r.shortId) === 'number') b.push(before.get(r.shortId));
    af.push(r.score);
  });
  s.avgBefore = mean(b); s.avgAfter = mean(af);
  return s;
}
const chipOf = k => (CRITERIA.find(c => c.key === k) || { chip: k }).chip;

// Signature of a verification snapshot (which tickets were verified, against which mark, with which result).
const verSig = v => (v && Array.isArray(v.results) ? v.results.map(r => [r.shortId, r.mark || '', r.markedAt || '', resCleared(r) ? 1 : 0, r.found ? 1 : 0, r.excludedReason || ''].join(':')).sort().join(',') : '');

// GET /api/sanitization-assign. Returns { status, body }. Persists a verification snapshot (the
// VERIFIED tickets only, liveVerification) into an active assignment only when it differs from the
// stored one (data stamp or verified results; the previous snapshot is pushed onto history);
// deps.persist === false never writes.
// deps: { coll, user, report, stamp, contractors, marks?, now?, persist? }
async function handleGet(deps) {
  if (!deps.user || !isOwner(deps.user.username)) return { status: 403, body: { error: OWNER_ONLY } };
  const now = deps.now ? deps.now() : new Date();
  const coll = deps.coll, mk = markMap(deps.marks);
  const docs = await coll.find({}).sort({ assignedAt: -1 }).toArray();
  const live = new Map(), counts = new Map();
  for (const a of docs) {
    const v = liveVerification(a, deps.report, deps.stamp, now, mk);
    live.set(a, v);
    if (a.status === 'active') counts.set(a, sectionCounts(a, deps.report, deps.stamp, mk));
    if (!v || deps.persist === false) continue;
    const old = a.verification || null;
    if (old && old.dataStamp === v.dataStamp && verSig(old) === verSig(v)) continue;
    const upd = { $set: { verification: v } };
    if (old) upd.$push = { history: old };
    await coll.updateOne({ _id: a._id, status: 'active' }, upd);
  }
  const locked = lockedMap(docs, deps.report, deps.stamp, now, mk);
  const openBy = {};
  locked.forEach(login => { openBy[login] = (openBy[login] || 0) + 1; });
  const contractors = (deps.contractors || []).map(c => ({ ...c, open: openBy[c.login] || 0 }));

  const assignments = docs.map(a => {
    const v = live.get(a), sum = summarize(a, v, counts.get(a) || null);
    const res = v ? new Map(v.results.map(r => [r.shortId, r])) : new Map();
    return {
      id: String(a._id), assignee: a.assignee, assignedBy: a.assignedBy, assignedAt: a.assignedAt,
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
  // Only verified tickets (a closure mark with a newer upload) count; the rest of the tickets are pending.
  const perf = new Map();
  const row = login => {
    if (!perf.has(login)) perf.set(login, { login, displayName: '', assignments: 0, ticketsAssigned: 0, verified: 0, passed: 0, failed: 0, notFound: 0, pending: 0, _b: [], _a: [] });
    return perf.get(login);
  };
  contractors.forEach(c => { row(c.login).displayName = c.displayName; });
  docs.forEach(a => {
    if (a.status !== 'active') return;
    const p = row(a.assignee), v = live.get(a);
    p.assignments++; p.ticketsAssigned += (a.tickets || []).length;
    p.pending += (a.tickets || []).length - (v ? v.results.length : 0);
    if (!v) return;
    const before = new Map((a.tickets || []).map(t => [t.shortId, t.scoreAtAssign]));
    v.results.forEach(r => {
      if (!r.found || r.excludedReason) { p.notFound++; return; }
      p.verified++;
      if (resCleared(r)) p.passed++; else p.failed++;
      if (typeof r.score !== 'number') return;   // SIM Duplicate: cleared, no score
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

  // Needs rework: assignments with at least one verified ticket that failed (rule A on the SIM code).
  const issues = [];
  docs.forEach(a => {
    const v = live.get(a);
    if (!v) return;
    const meta = new Map((a.tickets || []).map(t => [t.shortId, t]));
    const bad = v.results.filter(r => r.found && !r.excludedReason && !resCleared(r));
    if (!bad.length) return;
    issues.push({
      id: String(a._id), assignee: a.assignee, assignedAt: a.assignedAt, score: a.score, count: a.count,
      failedCount: bad.length, dataStamp: v.dataStamp,
      tickets: bad.map(r => { const t = meta.get(r.shortId) || {}; return { shortId: r.shortId, url: t.url || '', title: t.title || '', score: r.score,
        missing: (r.defects || []).concat(r.missing.map(k => (r.grp ? chipFor(k, r.tgt) : chipOf(k)))) }; }),
    });
  });

  return { status: 200, body: { asOf: deps.stamp || null, maxScore: MAX_SCORE, contractors, assignments, performance, issues } };
}

// ---- My sanitization (GET /api/my-sanitization; strictly read-only, never persists) ----
// One contractor's tickets across their ACTIVE assignments, scored live against the current report.
// A ticket in several active assignments is listed once (its most recent assignment wins).
// Ticket status = the tracker section:
//   'needs-correction' -> 1 Tickets to sanitize (unmarked, or a claim that failed verification)
//   'awaiting'         -> 2 Temporarily cleared (a claim waiting for a newer upload)
//   'error-ticket'     -> 3 Error tickets that need approval (owner only)
//   'cleared'          -> 4 Tickets sanitized successfully (a claim verified as passing)
//   'not-found' | 'excluded' (listed under the sections).
// BEFORE verification (unmarked / returned / legacy 'completed', and pending claims) the closure code
// is NOT checked: passedNow = the raw score out of 11, missingNow = the failing Title / RCD checks
// (informational), no defects (reason 'open'). AT verification (a claim with a newer upload, see the
// header) rule A is applied to the SIM ClosureCode (verifyClaim): passedNow / requiredNow = the
// required checks of SIM's code, missingNow = the failing ones, defects = what to fix (reason 'mark'
// (claim differs from SIM) | 'closure' (code not allowed) | 'ir' (IR not eligible) | 'missing'),
// verifiedFailed true; a pass carries `note` ('Marked <X>, SIM shows <Y>') when the claim differs.
// A failed claim is consumed: the row has no `mark` (the agent marks it again after fixing), the
// claim stays in `verifiedMark`. scoreNow stays the raw 0..11. `verified` = the ticket's claim has
// been verified; totals.pending counts the tickets not verified yet.
// Marks (COLLECTIONS.sanitizationMarks, one doc per (login, shortId), never deleted; previous states
// in `history`):
//   'successful' | 'immediate' | 'duplicate' - the agent's CLAIM of how the ticket is now closed in SIM.
//   'error'     - does NOT expire with an upload: the ticket stays 'error-ticket' (whatever its score)
//                 until the owner approves it (handleErrorReview 'approve' -> excluded everywhere) or
//                 sends it back ('return').
//   'returned'  - sent back by the owner: as unmarked, with `returned: { note, at, by }` on the row
//                 until the contractor marks it again.
//   'completed' - legacy (before the claims): carries NO claim, the ticket counts as unmarked;
//                 `legacyCompleted` lets the UI say "Previously marked Completed".
// Tickets the owner approved as errors (approvedIds / excludedReason 'approved error') are left out.
// Order: needs-correction (failed verifications first, then passed / required ascending, then oldest
// assigned first), awaiting / error-ticket (most recently marked first), cleared (most recently
// assigned first), then excluded / not-found (most recently assigned first).
const STATUS_RANK = { 'needs-correction': 0, awaiting: 1, 'error-ticket': 2, cleared: 3, excluded: 4, 'not-found': 5 };
// Claim marks -> the SIM ClosureCode they claim.
const CLAIMS = Object.freeze({ successful: CODE_SUCCESSFUL, immediate: CODE_IR, duplicate: CODE_DUP });
const MARK_STATUSES = Object.freeze({ successful: 'awaiting', immediate: 'awaiting', duplicate: 'awaiting', error: 'error-ticket' });
const REASON_MAX = 500;
const REVIEW_MAX = 500;   // shortIds per error-review request
// A claim is pending while no newer data was uploaded after it (the mark's data stamp is still current,
// or the current stamp is not later than the mark).
const claimPending = (m, stamp) => !stamp || m.dataStamp === stamp || !(timeOf(stamp) > timeOf(m.at));
// The mark that drives the section: an 'error' mark, or a claim still pending. (Verified claims, the
// legacy 'completed', 'returned' and '' do not.)
const markValid = (m, stamp) => !!m && !!MARK_STATUSES[m.status] && (m.status === 'error' || claimPending(m, stamp));
const markOut = m => ({ status: m.status, reason: m.reason || '', at: m.at || null, by: m.by || '' });
const returnedOut = m => ((m && m.status === 'returned') ? { note: m.ownerNote || '', at: m.returnedAt || null, by: m.returnedBy || '' } : null);
// To-sanitize reason: 'open' (not verified yet) or, after a failed verification, 'mark' (the claim
// differs from SIM) | 'closure' (SIM code not allowed) | 'ir' (Immediately Resolved not eligible) |
// 'missing' (only missing checks).
const NEED_REASONS = Object.freeze(['open', 'mark', 'closure', 'ir', 'missing']);
// Title / RCD chips that fail (every criterion but ClosureCode): the informational list before verification.
const infoChips = cur => (cur ? CRITERIA.filter((c, i) => c.key !== 'closure' && !(cur.checks && cur.checks[i] && cur.checks[i][0])).map(c => c.chip) : []);
// Why a title is not Immediately Resolved eligible (report ticket irk, sanitization-score.js irEligibility).
function irWhy(cur) {
  const k = cur && cur.irk;
  if (k && k.kind === 'scope') return (k.type || 'The title issue type') + ' is in scope';
  if (k && k.kind === 'type') return 'the title issue type is not in the Issue Types list';
  if (k && k.kind === 'pet-sev') return 'a pet incident with Sev ' + k.sev + ' cannot be Immediately Resolved';
  if (k && k.kind === 'pet-nosev') return 'the title has no severity (a pet incident needs Sev 3\u20135)';
  return 'the title is not eligible for Immediately Resolved';
}
// Rule A on the SIM ClosureCode for a verified claim. cur = report ticket (null: a SIM Duplicate,
// excluded from the report), claim = the claimed code.
// -> { cleared, defects:[messages], reason, note ('Marked <X>, SIM shows <Y>' on a pass that differs) }.
function verifyClaim(cur, claim) {
  const sim = cur ? (cur.cc || '') : CODE_DUP, simTxt = sim || '(blank)';
  const mism = closureKey(sim) !== closureKey(claim);
  if (!cur || ticketCleared(cur)) return { cleared: true, defects: [], reason: null, note: mism ? 'Marked ' + claim + ', SIM shows ' + simTxt : null };
  const you = 'You marked it ' + claim + ', but the re-uploaded data shows ' + simTxt;
  const toClaim = claim === CODE_SUCCESSFUL ? CODE_SUCCESSFUL + ' (11 points)' : claim;
  let d, reason;
  if (cur.grp === 'not-allowed') {
    d = 'SIM closure code ' + simTxt + ' is not allowed: change it to Successful or Immediately Resolved.'; reason = 'closure';
  } else if (cur.grp === 'successful') {
    d = mism ? you + ': either get all 11 points, or change the SIM ticket closure code to ' + claim + '.'
      : 'The re-uploaded data shows Successful: get all 11 points.';
    reason = mism ? 'mark' : 'missing';
  } else if (cur.grp === 'ir-not-eligible') {
    d = mism ? you + ': ' + irWhy(cur) + ', so change the SIM closure code to Successful (11 points), or correct the title.'
      : 'You marked it Immediately Resolved, but ' + irWhy(cur) + ': change the SIM closure code to Successful (11 points), or correct the title.';
    reason = mism ? 'mark' : 'ir';
  } else if (cur.grp === 'immediate') {
    d = mism ? you + ': fix the title checks, or change the SIM closure code to ' + toClaim + '.'
      : 'The re-uploaded data shows Immediately Resolved: fix the title checks.';
    reason = mism ? 'mark' : 'missing';
  } else {
    d = 'SIM closure code ' + simTxt + ' could not be checked.'; reason = 'closure';
  }
  return { cleared: false, defects: [d], reason, note: null };
}
// Section of one assigned ticket: cur = report ticket, why = exclusion reason, m = its mark doc.
// -> null (approved / other exclusion / not found: the caller decides) or
//    { status, passed, required, defects, missing, closureCode, target, group, reason, mark, verifiedMark,
//      verifiedFailed, note, legacyCompleted }.
function evalTicket(cur, why, m, stamp) {
  if (!cur && why !== DUP_REASON) return null;
  const raw = cur && typeof cur.score === 'number' ? cur.score : null;
  // Before verification: the raw score out of 11 and the Title / RCD chips; no closure-code check.
  const out = { passed: raw, required: raw == null ? null : MAX_SCORE, defects: [], missing: infoChips(cur),
    closureCode: cur ? (cur.cc || '') : CODE_DUP, target: null, group: null, reason: null, mark: null, verifiedMark: null,
    verifiedFailed: false, note: null, legacyCompleted: !!(m && m.status === 'completed') };
  if (m && m.status === 'error') { out.status = 'error-ticket'; out.mark = markOut(m); return out; }
  if (m && CLAIMS[m.status]) {
    if (claimPending(m, stamp)) { out.status = 'awaiting'; out.mark = markOut(m); return out; }
    // Verified: rule A on SIM's code (its required checks, missing chips and target).
    const vr = verifyClaim(cur, CLAIMS[m.status]);
    out.passed = cur ? cur.pass : null; out.required = cur ? cur.need : null;
    out.missing = cur ? missingChips(cur) : [];
    out.target = cur ? (cur.tgt || null) : CODE_DUP; out.group = cur ? (cur.grp || null) : 'duplicate';
    out.verifiedMark = markOut(m); out.defects = vr.defects; out.note = vr.note;
    if (vr.cleared) { out.status = 'cleared'; return out; }
    out.status = 'needs-correction'; out.reason = vr.reason; out.verifiedFailed = true;
    return out;
  }
  out.status = 'needs-correction'; out.reason = 'open';
  return out;
}
function contractorView(assignments, login, report, stamp, marks, approvedIds) {
  const me = normLogin(login);
  const ix = report ? reportIndex(report) : { byId: new Map(), excluded: new Map() };
  const appr = approvedIds instanceof Set ? approvedIds : new Set(approvedIds || []);
  const mk = new Map((marks || []).filter(m => m && normLogin(m.login) === me && m.shortId).map(m => [m.shortId, m]));
  const docs = (assignments || [])
    .filter(a => a && a.status === 'active' && normLogin(a.assignee) === me)
    .sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
  const seen = new Set(), tickets = [];
  docs.forEach(a => {
    (a.tickets || []).forEach(t => {
      if (!t || !t.shortId || seen.has(t.shortId)) return;
      seen.add(t.shortId);
      const row = rowOf(a, t, ix, mk.get(t.shortId), stamp, appr);
      if (row) tickets.push(row);
    });
  });
  const ratio = t => (t.requiredNow > 0 ? t.passedNow / t.requiredNow : (t.defects && t.defects.length ? 0 : 1));
  const atAsc = (x, y) => String(x.assignedAt || '').localeCompare(String(y.assignedAt || ''));
  const markDesc = (x, y) => String((y.mark && y.mark.at) || '').localeCompare(String((x.mark && x.mark.at) || ''));
  tickets.sort((x, y) => (STATUS_RANK[x.status] - STATUS_RANK[y.status])
    || (x.status === 'needs-correction' ? (((y.verifiedFailed ? 1 : 0) - (x.verifiedFailed ? 1 : 0)) || (ratio(x) - ratio(y)) || ((x.passedNow - y.passedNow) || 0) || atAsc(x, y))
      : (x.mark ? markDesc(x, y) : atAsc(y, x)))
    || x.shortId.localeCompare(y.shortId));
  const count = s => tickets.filter(t => t.status === s).length;
  // To sanitize per reason (not verified yet / mark mismatch / closure code not allowed / IR not eligible / missing checks).
  const needBy = {};
  NEED_REASONS.forEach(g => { needBy[g] = 0; });
  tickets.forEach(t => { if (t.status === 'needs-correction' && needBy[t.reason] != null) needBy[t.reason]++; });
  return {
    login: me, dataAsOf: stamp || null, maxScore: MAX_SCORE, tickets,
    totals: { assigned: tickets.length, cleared: count('cleared'), needsCorrection: count('needs-correction'), needBy,
      awaiting: count('awaiting'), errorTickets: count('error-ticket'),
      notFound: count('not-found'), excluded: count('excluded'), pending: tickets.filter(t => !t.verified).length,
      legacyCompleted: tickets.filter(t => t.legacyCompleted).length },
  };
}
// One contractor-view row (assignment a, its ticket t, report index ix, mark doc m), or null for an
// owner-approved error (not tracked).
function rowOf(a, t, ix, m, stamp, appr) {
  const cur = ix.byId.get(t.shortId), why = cur ? null : ix.excluded.get(t.shortId);
  if ((appr && appr.has(t.shortId)) || why === APPROVED_REASON) return null;
  const ev = evalTicket(cur, why, m, stamp);
  const status = ev ? ev.status : (why ? 'excluded' : 'not-found');
  return {
    shortId: t.shortId, url: t.url || (cur && cur.url) || '', title: (cur && cur.title) || t.title || '',
    assignedAt: a.assignedAt || null,
    scoreAtAssign: typeof t.scoreAtAssign === 'number' ? t.scoreAtAssign : null,
    scoreNow: cur && typeof cur.score === 'number' ? cur.score : null,
    // Before verification: raw score / 11; verified: rule A's passed / required for SIM's code.
    passedNow: ev ? ev.passed : null, requiredNow: ev ? ev.required : null,
    clearedNow: status === 'cleared', defects: ev ? ev.defects : [], missingNow: ev ? ev.missing : [],
    group: ev ? ev.group : null, target: ev ? ev.target : null, reason: ev ? ev.reason : null,
    closureCode: ev ? ev.closureCode : null, status,
    excludedReason: (why && why !== DUP_REASON) ? why : null, verified: !!ev && !!ev.verifiedMark,
    verifiedFailed: !!(ev && ev.verifiedFailed), note: (ev && ev.note) || null,
    mark: ev && ev.mark ? ev.mark : null, verifiedMark: ev ? ev.verifiedMark : null,
    legacyCompleted: !!(m && m.status === 'completed'),
    returned: status === 'needs-correction' ? returnedOut(m) : null,
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

// POST /api/my-sanitization/mark { shortId, status:'successful'|'immediate'|'duplicate'|'error'|'' (clear),
// reason, login? }. A contractor marks only tickets in their own ACTIVE sanitization assignments (any
// `login` other than their own -> 403); the owner may mark for any contractor via `login`. Only tickets
// that are not cleared right now (evalTicket with the current mark) can be marked; 'error' needs a
// reason (1..500 characters). One doc per (login, shortId), upserted with the current data stamp (a
// claim stays 'awaiting' until a newer upload); clearing (Undo) sets status '' (never deleted). The
// response carries `ticket` = the row as the tracker shows it now (contractorView shape).
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
  if (status !== '' && !MARK_STATUSES[status]) return { status: 400, body: { error: "status must be 'successful', 'immediate', 'duplicate', 'error' or ''." } };
  const reason = status === 'error' ? (typeof b.reason === 'string' ? b.reason.trim() : '') : '';
  if (status === 'error' && !reason) return { status: 400, body: { error: 'Please say why this is an error ticket.' } };
  if (reason.length > REASON_MAX) return { status: 400, body: { error: 'The reason can be at most ' + REASON_MAX + ' characters.' } };
  const { docs, report, stamp } = await deps.load();
  // The most recent active assignment holding the ticket (the one contractorView shows).
  const asg = (docs || []).filter(a => a && a.status === 'active' && normLogin(a.assignee) === login
    && (a.tickets || []).some(t => t && t.shortId === shortId))
    .sort((x, y) => String(y.assignedAt || '').localeCompare(String(x.assignedAt || '')))[0];
  if (!asg) {
    return owner ? { status: 404, body: { error: 'This ticket is not in ' + login + '\u2019s active sanitization assignments.' } }
      : { status: 403, body: { error: 'You can mark only tickets in your own sanitization assignments.' } };
  }
  const ix = report ? reportIndex(report) : { byId: new Map(), excluded: new Map() };
  const prev = await deps.coll.findOne({ login, shortId });
  if (status) {
    const cur = ix.byId.get(shortId), why = cur ? null : ix.excluded.get(shortId);
    const ev = why === APPROVED_REASON ? null : evalTicket(cur, why, prev, stamp);
    if (!ev || ev.status === 'cleared') return { status: 409, body: { error: 'Only tickets that still need correction can be marked.' } };
  }
  // A ticket sent to the owner for error review stays with the owner until approved or sent back.
  if (!owner && prev && prev.status === 'error') return { status: 409, body: { error: 'This ticket is with the owner for error review.' } };
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const doc = { login, shortId, status, reason, at, by: me, dataStamp: stamp || null };
  const upd = { $set: doc };
  // Mark history: the previous state (incl. a claim consumed by a failed verification) is kept.
  if (prev && (prev.status || prev.at)) {
    const old = { status: prev.status || '', reason: prev.reason || '', at: prev.at || null, by: prev.by || '', dataStamp: prev.dataStamp || null, replacedAt: at, replacedBy: me };
    if (prev.status === 'returned') Object.assign(old, { ownerNote: prev.ownerNote || '', returnedAt: prev.returnedAt || null, returnedBy: prev.returnedBy || '' });
    if (CLAIMS[prev.status] && !claimPending(prev, stamp)) old.verifiedAgainst = stamp || null;
    upd.$push = { history: old };
  }
  await deps.coll.updateOne({ login, shortId }, upd, { upsert: true });
  const t = (asg.tickets || []).find(x => x && x.shortId === shortId);
  const ticket = rowOf(asg, t, ix, doc, stamp, null);
  return { status: 200, body: { ok: true, login, shortId, mark: status ? markOut(doc) : null, dataStamp: doc.dataStamp, ticket } };
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
  COUNT_MAX, REASON_MAX, REVIEW_MAX, contractorsOf, liveVerification, lockedMap, availableInSection, availableCounts,
  validateAssign, handleAssign, handleRevoke, handleGet, statusOf, sectionCounts, contractorView, handleMine, handleMark, markValid,
  handleErrorReview, handleRestore, missingChips, passedResult, chipFor, missingRequired,
  CLAIMS, NEED_REASONS, claimPending, verifiedClaim, verifyClaim, evalTicket, rowOf, markMap,
};
