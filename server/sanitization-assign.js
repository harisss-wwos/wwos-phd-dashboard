// Sanitization assignments (ticket-sanitization.html, owner-only): harisss hands low-score tickets to
// a contractor to sanitize, then the next data uploads verify them. One collection
// (COLLECTIONS.sanitizationAssignments), one doc per assign action:
//   { _id, assignee, assignedBy, assignedAt, score (null for a closure-code assignment), closureCode?, group?, count,
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
// TRACKER OUTCOME (Sanitization Tracker, contractorView / rowOf / handleMine): the per-ticket outcome
// there comes from the persisted validation record of the latest upload (COLLECTIONS.sanitizationValidations,
// written by server/sanitization-validate-store.js), NOT from rule A on the SIM closure code. Only a
// ticket whose closure claim the latest upload has already seen is validated, and only a record of that
// upload counts (dataStamp = the current stamp): a ticket the contractor has not marked yet is never
// flagged, it simply stays in their Tickets to sanitize queue. A current record with at least one failure
// puts the ticket in 'error-detected': owner-only rows, listed in the Error detected section, counted
// in neither totals.cleared nor totals.needsCorrection, so they add nothing to the agent's sanitized
// total until the owner reviews them (handleDetectedReview: Accept the whole ticket as a sanitized
// error, or send it back for Rework). A ticket the owner accepted
// (COLLECTIONS.sanitizationErrorAccepts) and a marked ticket the latest upload did not flag count as
// sanitized. Rule A (verifyClaim) stays in this module for the assignment page (liveVerification /
// sectionCounts), the scores page and handleMark: evalTicket keeps its old behaviour when no
// validation context is passed to it.
// A ticket is LOCKED (not available to assign) while it is in an active assignment and not verified
// as passing; failed tickets stay with that contractor until the owner revokes.
// Assignments made before the ClosureCode point keep their stored scoreAtAssign (out of 10 then);
// it is shown as stored.
// Kept in its own module (pure functions + handlers taking deps) so it can be unit-tested without a DB.
// Owner-approved error tickets (COLLECTIONS.sanitizationExcluded, see handleErrorReview) are taken
// out of the score report before it gets here (sanitization-score.js applyApproved: excludedReason
// 'approved error'), so they are never available / picked, and verification counts them as excluded
// (neither passed nor failed). On the TRACKER (contractorView rows / totals, sectionCounts) an approved
// error of an assignment counts as SANITIZED: section 4 with approvedError { by, at, reason, note }.
// TEST / NON-PHD tickets (ticket-rules.js; report.ruleExcluded) are never in the report's tickets, so
// they are never available / picked either, and liveTickets drops them from every assignment that
// already holds them (no row, no section / card / performance count, no verification).
'use strict';
const { isOwner, CRITERIA, MAX_SCORE, APPROVED_REASON, ticketCleared, closureKey, closureGroupOf, GROUP_BLANK, CODE_SUCCESSFUL, CODE_IR, CODE_DUP, CODE_AUTO } = require('./sanitization-score');
const ticketRules = require('./ticket-rules');
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
      rule: new Map((report.ruleExcluded || []).map(t => [t.shortId, t.reason])),
    };
    _idx.set(report, ix);
  }
  return ix;
}
// TEST / NON-PHD tickets (ticket-rules.js, shared with the Incident Explorer) are dropped from every
// assignment as if they were never in it: no row, no card / section / performance count, no
// verification. Decided by the current title (report.ruleExcluded) or, for a ticket the report does
// not have at all, by the title stored in the assignment. ix may be null (stored title only).
function ruleOut(t, ix) {
  if (!t || !t.shortId) return false;
  if (ix && ix.rule.has(t.shortId)) return true;
  if (ix && (ix.byId.has(t.shortId) || ix.excluded.has(t.shortId))) return false;
  return !!ticketRules.excludeReason(t.title);
}
const liveTickets = (a, ix) => (a && a.tickets || []).filter(t => t && t.shortId && !ruleOut(t, ix));
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
  liveTickets(a, ix).forEach(t => {
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
    .filter(t => t.score === score && t.shortId && !locked.has(t.shortId) && !ticketCleared(t))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => qk(a.t).localeCompare(qk(b.t)) || (a.i - b.i))
    .map(x => x.t);
}
// { score: available count } for 0..MAX_SCORE. Tickets that already pass rule A (ticketCleared: the
// scores page's "Tickets with clear data") are never available, whatever their raw score.
function availableCounts(report, locked) {
  const out = {};
  for (let i = 0; i <= MAX_SCORE; i++) out[i] = 0;
  (report.tickets || []).forEach(t => { if (t.shortId && !locked.has(t.shortId) && out[t.score] != null && !ticketCleared(t)) out[t.score]++; });
  return out;
}

// ---- Closure-code groups (the scores page's assign groups; score is not used) ----
// Tickets still to sanitize (!ticketCleared) grouped by SIM ClosureCode (closureGroupOf):
// -> [{ id, label, n, available }]: n = every such ticket, available = not locked (as availableCounts).
// Order: Successful, Immediately Resolved, Automatically Closed, then the other codes by n desc, then
// label; 'No closure code' last. Empty groups are left out.
const GROUP_FIXED = [CODE_SUCCESSFUL, CODE_IR, CODE_AUTO].map(closureKey);
function closureGroups(report, locked) {
  const by = new Map();
  ((report && report.tickets) || []).forEach(t => {
    if (ticketCleared(t)) return;
    const g = closureGroupOf(t.cc);
    if (!by.has(g.id)) by.set(g.id, { id: g.id, label: g.label, n: 0, available: 0 });
    const r = by.get(g.id);
    r.n++;
    if (t.shortId && !(locked && locked.has(t.shortId))) r.available++;
  });
  const rank = g => (g.id === GROUP_BLANK ? 1e9 : (GROUP_FIXED.indexOf(g.id) >= 0 ? GROUP_FIXED.indexOf(g.id) : 100));
  return Array.from(by.values()).filter(g => g.n > 0)
    .sort((a, b) => (rank(a) - rank(b)) || (b.n - a.n) || a.label.localeCompare(b.label));
}
// Available tickets of one closure-code group, in pick order: created quarter oldest -> newest (no
// quarter last), then oldest resolved first (ro), then shortId.
function availableInGroup(report, id, locked) {
  const qk = t => (/^\d{4}-Q[1-4]$/.test(t.cq || '') ? t.cq : '~');
  const ro = t => (typeof t.ro === 'number' ? t.ro : Infinity);
  return ((report && report.tickets) || [])
    .filter(t => !ticketCleared(t) && closureGroupOf(t.cc).id === id && t.shortId && !(locked && locked.has(t.shortId)))
    .sort((a, b) => qk(a).localeCompare(qk(b)) || (ro(a) - ro(b)) || a.shortId.localeCompare(b.shortId));
}

// Scores page row "Approved errors & agent-marked duplicates" (GET /api/sanitization-score):
//   approvedErrors - owner-approved error tickets (COLLECTIONS.sanitizationExcluded): login = the agent
//                    who marked it Error, markedAt = that Error mark's time (the mark is kept on approval).
//   duplicates     - tickets an agent marked Duplicate (sanitizationMarks status 'duplicate'); simDup =
//                    the current data shows ClosureCode Duplicate; pending = no upload after the mark yet.
//   agents         - [{ login, errors, duplicates }] most first.
//   simDuplicates  - tickets left out of scoring because SIM itself says Duplicate (for comparison).
// Title / url / SIM code come from the score report BEFORE applyApproved (base), else from the
// assignments' stored tickets. scope: 'scored' | the exclusion reason | 'not-found' (not in the data).
function markedTickets(base, approved, marks, assignments, stamp) {
  const ix = base ? reportIndex(base) : { byId: new Map(), excluded: new Map(), rule: new Map() };
  const meta = new Map();
  (assignments || []).forEach(a => (a && a.tickets || []).forEach(t => { if (t && t.shortId && !meta.has(t.shortId)) meta.set(t.shortId, t); }));
  const mk = markMap(marks);
  const info = sid => {
    const cur = ix.byId.get(sid), why = cur ? null : ix.excluded.get(sid), t = meta.get(sid) || {};
    return { shortId: sid, url: (cur && cur.url) || t.url || 'https://t.corp.amazon.com/issues/' + encodeURIComponent(sid),
      title: (cur && cur.title) || t.title || '', cc: cur ? (cur.cc || '') : (why === DUP_REASON ? CODE_DUP : ''),
      scope: cur ? 'scored' : (why || ix.rule.get(sid) || 'not-found') };
  };
  const newest = (x, y) => String(y.markedAt || '').localeCompare(String(x.markedAt || '')) || x.shortId.localeCompare(y.shortId);
  const approvedErrors = (approved || []).filter(d => d && d.shortId).map(d => {
    const login = normLogin(d.login), m = mk.get(markKey(login, d.shortId));
    return { ...info(d.shortId), login, markedAt: (m && m.at) || null, reason: d.reason || (m && m.reason) || '',
      approvedBy: d.approvedBy || '', approvedAt: d.approvedAt || null, note: d.note || '' };
  }).sort(newest);
  const duplicates = [];
  mk.forEach(m => {
    if (!m || m.status !== 'duplicate' || !m.shortId) return;
    if (ruleOut(meta.get(m.shortId) || { shortId: m.shortId }, ix)) return;   // TEST / NON-PHD ticket: not listed
    const it = info(m.shortId);
    duplicates.push({ ...it, login: normLogin(m.login), markedAt: m.at || null, simDup: closureKey(it.cc) === closureKey(CODE_DUP), pending: claimPending(m, stamp) });
  });
  duplicates.sort(newest);
  const by = new Map();
  const add = (login, k) => { const l = login || '(unknown)'; if (!by.has(l)) by.set(l, { login: l, errors: 0, duplicates: 0 }); by.get(l)[k]++; };
  approvedErrors.forEach(r => add(r.login, 'errors'));
  duplicates.forEach(r => add(r.login, 'duplicates'));
  const agents = Array.from(by.values()).sort((a, b) => (b.errors + b.duplicates) - (a.errors + a.duplicates) || a.login.localeCompare(b.login));
  return { approvedErrors, duplicates, agents, simDuplicates: (base && base.excludedBy && base.excludedBy[DUP_REASON]) || 0 };
}

// Strict input check: exactly one of closureCode (a closure-code group id, closureGroupOf; matched
// case-insensitively, '(blank)' = no closure code) or score (legacy, 0..MAX_SCORE-1).
// -> { ok, value:{ closureCode? | score?, count, assignee } } | { ok:false, status, error }.
const CLOSURE_MAX = 120;
function validateAssign(body, contractors) {
  const b = body || {};
  const bad = error => ({ ok: false, status: 400, error });
  const hasScore = b.score !== undefined && b.score !== null, hasCode = b.closureCode !== undefined && b.closureCode !== null;
  if (hasScore === hasCode) return bad('Send either score or closureCode.');
  let closureCode = null;
  if (hasCode) {
    const s = typeof b.closureCode === 'string' ? b.closureCode.trim() : '';
    if (!s || s.length > CLOSURE_MAX) return bad('closureCode must be a closure-code group.');
    closureCode = s === GROUP_BLANK ? GROUP_BLANK : closureKey(s);
  } else if (typeof b.score !== 'number' || !Number.isInteger(b.score) || b.score < 0 || b.score > MAX_SCORE - 1) return bad('score must be a whole number from 0 to ' + (MAX_SCORE - 1) + '.');
  if (typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 1 || b.count > COUNT_MAX) return bad('count must be a whole number from 1 to ' + COUNT_MAX + '.');
  const assignee = typeof b.assignee === 'string' ? normLogin(b.assignee) : '';
  if (!assignee || !(contractors || []).some(c => c.login === assignee)) return bad('assignee must be one of the contractors.');
  return { ok: true, value: hasCode ? { closureCode, count: b.count, assignee } : { score: b.score, count: b.count, assignee } };
}

// One assignment at a time per process, so two quick POSTs cannot pick the same tickets.
let _chain = Promise.resolve();
function serial(fn) { const p = _chain.then(fn, fn); _chain = p.catch(() => {}); return p; }

// POST /api/sanitization-assign { closureCode, count, assignee } (or the legacy { score, count, assignee }).
// Returns { status, body }. The SERVER picks the tickets: the group's first `count` available tickets
// (availableInGroup; legacy: the score section's, availableInSection). A closure-code doc stores
// score: null, closureCode: <group label>, group: <group id>.
// deps: { coll, user:{username}, report, stamp, contractors, marks?, now? }
function handleAssign(body, deps) {
  if (!deps.user || !isOwner(deps.user.username)) return Promise.resolve({ status: 403, body: { error: OWNER_ONLY } });
  const v = validateAssign(body, deps.contractors);
  if (!v.ok) return Promise.resolve({ status: v.status, body: { error: v.error } });
  return serial(async () => {
    const { count, assignee } = v.value, byCode = v.value.closureCode != null;
    const score = byCode ? null : v.value.score;
    const now = deps.now ? deps.now() : new Date();
    const coll = deps.coll;
    const active = await coll.find({ status: 'active' }).toArray();
    const locked = lockedMap(active, deps.report, deps.stamp, now, deps.marks);
    const avail = byCode ? availableInGroup(deps.report, v.value.closureCode, locked) : availableInSection(deps.report, score, locked);
    const group = byCode ? (closureGroups(deps.report, null).find(g => g.id === v.value.closureCode) || null) : null;
    const label = byCode ? (group ? group.label : v.value.closureCode) : null;
    if (avail.length < count) {
      return { status: 409, body: { error: 'Only ' + avail.length + ' tickets with ' + (byCode ? 'closure code ' + label : score + ' points') + ' are available.', available: avail.length } };
    }
    const at = now.toISOString();
    const doc = {
      assignee, assignedBy: normLogin(deps.user.username), assignedAt: at, score,
      ...(byCode ? { closureCode: label, group: v.value.closureCode } : {}), count,
      tickets: avail.slice(0, count).map(t => ({
        shortId: t.shortId, url: t.url || '', title: String(t.title || '').slice(0, 300), cq: t.cq || '',
        scoreAtAssign: t.score, missingAtAssign: missingKeys(t.checks),
      })),
      status: 'active', verification: null, history: [],
    };
    const ins = await coll.insertOne(doc);
    return { status: 200, body: { ok: true, id: String(ins && ins.insertedId), assignee, ...(byCode ? { closureCode: label } : { score }), count,
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
// errors (error marks with the owner) | sanitized (verified pass, or an owner-approved error) |
// other (excluded / not found). No deadline: nothing here depends on the date.
function sectionCounts(a, report, stamp, marks) {
  const c = { toSanitize: 0, tempCleared: 0, errors: 0, sanitized: 0, other: 0 };
  const ix = report ? reportIndex(report) : { byId: new Map(), excluded: new Map(), rule: new Map() }, mk = markMap(marks);
  liveTickets(a, ix).forEach(t => {
    const cur = ix.byId.get(t.shortId), why = cur ? null : ix.excluded.get(t.shortId);
    if (why === APPROVED_REASON) { c.sanitized++; return; }   // owner-approved error: sanitized on the tracker
    const ev = evalTicket(cur, why, mk.get(markKey(a.assignee, t.shortId)), stamp);
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
  const docs = await coll.find({}, { projection: { history: 0 } }).sort({ assignedAt: -1 }).toArray();   // history is never read
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

  const rix = deps.report ? reportIndex(deps.report) : null;   // TEST / NON-PHD tickets are left out (liveTickets)
  const assignments = docs.map(a => {
    const v = live.get(a), sum = summarize(a, v, counts.get(a) || null);
    const res = v ? new Map(v.results.map(r => [r.shortId, r])) : new Map();
    const kept = liveTickets(a, rix);
    return {
      id: String(a._id), assignee: a.assignee, assignedBy: a.assignedBy, assignedAt: a.assignedAt,
      score: a.score, closureCode: a.closureCode || null, count: kept.length === (a.tickets || []).length ? a.count : kept.length, status: a.status, revokedAt: a.revokedAt || null, revokedBy: a.revokedBy || null,
      tickets: kept.map(t => {
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
    const n = liveTickets(a, rix).length;
    p.assignments++; p.ticketsAssigned += n;
    p.pending += n - (v ? v.results.length : 0);
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
//   'needs-correction' -> 1 Tickets to sanitize (unmarked, or sent back by the owner for Rework)
//   'awaiting'         -> 2 Temporarily cleared (a claim waiting for a newer upload)
//   'error-detected'   -> 3 Errors the latest upload detected, awaiting the owner's review (owner only)
//   'error-ticket'     -> 4 Error tickets that need approval (owner only)
//   'cleared'          -> 5 Tickets sanitized successfully (validated with nothing left open)
//   'not-found' | 'excluded' (listed under the sections).
// BEFORE the upload that validates a ticket (unmarked / returned / legacy 'completed', and pending
// claims) nothing of the uploaded data is checked: passedNow = the raw score out of 11, missingNow =
// the failing Title / RCD checks (informational), no defects (reason 'open').
// AFTER an upload that has seen the ticket's claim, its validation record decides (validationOf /
// valStatus, see the header; an unmarked ticket and a record from an earlier upload decide nothing):
// un-approved failures left -> 'error-detected', with `validation` { closureCode, scope, detectedAt,
// failures, fields } on the row, missingNow = the failing item labels and passedNow / requiredNow
// null (the view's score pill falls back to the raw scoreNow); every item approved -> 'cleared'; no
// record (the upload flagged nothing) with a verified claim -> 'cleared'. A ticket the owner sent
// back for Rework (mark 'returned', newer than detectedAt) is in Tickets to sanitize with the
// owner's note. Every row carries `validation` (null while the ticket has no record). scoreNow stays
// the raw 0..11. `verified` = the ticket's claim has been verified; totals.pending counts the tickets
// not verified yet. Rule A (verifyClaim, verifiedFailed, the 'mark' / 'closure' / 'ir' reasons) is
// not applied here any more.
// Marks (COLLECTIONS.sanitizationMarks, one doc per (login, shortId), never deleted; previous states
// in `history`):
//   'successful' | 'immediate' | 'duplicate' - the agent's CLAIM of how the ticket is now closed in SIM.
//   'error'     - does NOT expire with an upload: the ticket stays 'error-ticket' (whatever its score)
//                 until the owner approves it (handleErrorReview 'approve' -> excluded everywhere) or
//                 sends it back ('return').
//   'returned'  - sent back by the owner: as unmarked, with `returned: { note, at, by }` on the row
//                 until the contractor marks it again, except that rule A can never clear it (see
//                 evalTicket: a Rework always leaves the ticket in Tickets to sanitize).
//   'completed' - legacy (before the claims): carries NO claim, the ticket counts as unmarked;
//                 `legacyCompleted` lets the UI say "Previously marked Completed".
// Tickets the owner approved as errors (approvedIds / excludedReason 'approved error') count as
// 'cleared' (sanitized) with approvedError { by, at, reason, note }.
// Order: needs-correction (failed verifications first, then passed / required ascending, then oldest
// assigned first), awaiting / error-ticket (most recently marked first), cleared (most recently
// assigned first), then excluded / not-found (most recently assigned first).
const STATUS_RANK = { 'needs-correction': 0, awaiting: 1, 'error-detected': 2, 'error-ticket': 3, cleared: 4, excluded: 5, 'not-found': 6 };
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
// Time of the last action on a mark: a 'returned' mark is stamped with returnedAt (the owner's Rework),
// every other state with `at`.
const markTime = m => (!m ? NaN : timeOf(m.status === 'returned' ? (m.returnedAt || m.at) : m.at));
// True when the mark was acted on after the validation record was written (detectedAt), so the mark
// decides the section again: Rework sends the ticket back, a new claim waits for the next upload.
const markedAfter = (m, detectedAt) => { const t = markTime(m); return !!detectedAt && !isNaN(t) && t > timeOf(detectedAt); };
// Tracker outcome from the validation record (val = the row's `validation`): 'error-detected' while a
// failure is still listed and nobody has acted since the detection, 'cleared' for a record that lists
// none, null when the record decides nothing and the mark rules apply instead. An ACCEPTED ticket
// never gets here: rowOf returns its 'cleared' row before evalTicket. The record decides only for a
// ticket whose closure claim the latest upload has already seen (verifiedClaim, the same gate the
// validation hook applies when it writes: sanitization-validate-store.js claimedIds), so an assigned
// ticket the contractor has not sanitized yet stays in their Tickets to sanitize queue, and a Rework
// (a 'returned' mark) or a new claim hands the ticket back to the mark rules.
function valStatus(val, m, stamp) {
  if (!val || !verifiedClaim(m, stamp)) return null;
  if (!val.failures.length) return 'cleared';
  return markedAfter(m, val.detectedAt) ? null : 'error-detected';
}
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
  } else if (cur.grp === 'auto-closed') {
    // Automatically Closed on an Immediately Resolved eligible title: accepted, only the title checks count.
    d = 'The re-uploaded data shows Automatically Closed (accepted for this issue type): fix the title checks.'; reason = 'missing';
  } else {
    d = 'SIM closure code ' + simTxt + ' could not be checked.'; reason = 'closure';
  }
  return { cleared: false, defects: [d], reason, note: null };
}
// Section of one assigned ticket: cur = report ticket, why = exclusion reason, m = its mark doc.
// vx = the TRACKER's validation context { validation } (rowOf always passes it; the assignment page
// (liveVerification / sectionCounts) and handleMark pass nothing and keep the rule A behaviour).
// -> null (approved / other exclusion / not found: the caller decides) or
//    { status, passed, required, defects, missing, closureCode, target, group, reason, mark, verifiedMark,
//      verifiedFailed, note, legacyCompleted, validation }.
function evalTicket(cur, why, m, stamp, vx) {
  if (!cur && why !== DUP_REASON) return null;
  const raw = cur && typeof cur.score === 'number' ? cur.score : null;
  // Before verification: the raw score out of 11 and the Title / RCD chips; no closure-code check.
  const out = { passed: raw, required: raw == null ? null : MAX_SCORE, defects: [], missing: infoChips(cur),
    closureCode: cur ? (cur.cc || '') : CODE_DUP, target: null, group: null, reason: null, mark: null, verifiedMark: null,
    verifiedFailed: false, note: null, legacyCompleted: !!(m && m.status === 'completed'), validation: null };
  if (m && m.status === 'error') { out.status = 'error-ticket'; out.mark = markOut(m); return out; }
  if (vx) {
    // TRACKER: the validation record of the latest upload decides, not rule A.
    out.validation = vx.validation || null;
    const vs = valStatus(out.validation, m, stamp);
    if (vs) {
      out.passed = null; out.required = null; out.missing = vs === 'error-detected' ? out.validation.failures.map(f => f.label) : [];
      out.status = vs;
      if (m && CLAIMS[m.status]) out.verifiedMark = markOut(m);   // the claim the upload has already seen
      if (vs === 'cleared') out.note = 'The latest upload left no error open on this ticket';
      return out;
    }
    if (m && CLAIMS[m.status]) {
      if (claimPending(m, stamp)) { out.status = 'awaiting'; out.mark = markOut(m); return out; }
      // A claim a newer upload has seen with nothing flagged for it: sanitized.
      out.passed = null; out.required = null; out.missing = [];
      out.status = 'cleared'; out.verifiedMark = markOut(m);
      out.note = 'Marked ' + CLAIMS[m.status] + '; the latest upload detected no errors';
      return out;
    }
    // Unmarked / returned / legacy 'completed' with no record: the informational tail below.
  } else if (m && CLAIMS[m.status]) {
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
  // Unmarked but already passing rule A on the current SIM data (e.g. 11/11 Successful, an eligible
  // Immediately Resolved with all title checks, or Duplicate): sanitized - no mark needed.
  // NEVER for a ticket the owner sent back for Rework: rule A asks less than the upload's checks (an
  // 'Automatically Closed' ticket with a clean title passes it while the engine flags the code), so
  // without this a reworked ticket would come back 'cleared', the owner's note would never be shown
  // and the contractor would never be told (handleDetectedReview 'rework'). A 'returned' mark stays in
  // Tickets to sanitize with that note until the contractor marks the ticket again.
  const ruleAPass = (m && m.status === 'returned') ? false
    : (cur ? (!(cur.def && cur.def.length) && typeof cur.pass === 'number' && cur.pass === cur.need) : why === DUP_REASON);
  if (ruleAPass) {
    out.status = 'cleared';
    out.passed = cur ? cur.pass : null; out.required = cur ? cur.need : null; out.missing = [];
    out.target = cur ? (cur.tgt || null) : CODE_DUP; out.group = cur ? (cur.grp || null) : 'duplicate';
    out.note = 'Passes all checks on the current SIM data';
    return out;
  }
  out.status = 'needs-correction'; out.reason = 'open';
  // A full 11/11 that still fails rule A (e.g. Immediately Resolved with an in-scope issue type):
  // show rule A's requirement and defect so the row does not look finished.
  if (cur && raw === MAX_SCORE) {
    out.passed = cur.pass; out.required = cur.need; out.missing = missingChips(cur);
    out.target = cur.tgt || null; out.group = cur.grp || null;
    out.defects = (cur.def || []).slice();
  }
  return out;
}
// Approved errors lookup: Map shortId -> approval doc (or null) from a Map, a Set / array of shortIds,
// or an array of approval docs ({ shortId, approvedBy, approvedAt, reason, note }).
function apprMap(x) {
  if (x instanceof Map) return x;
  const m = new Map();
  Array.from(x || []).forEach(d => { if (typeof d === 'string') m.set(d, null); else if (d && d.shortId) m.set(d.shortId, d); });
  return m;
}
// Two data stamps are the same upload (ISO strings; a non-date value is compared as text).
const sameStamp = (a, b) => { const x = timeOf(a), y = timeOf(b); return (!isNaN(x) && !isNaN(y)) ? x === y : String(a) === String(b); };
// Validation records (COLLECTIONS.sanitizationValidations, one doc per flagged ticket) -> Map
// shortId -> doc, from a Map or an array of docs.
function valMap(validations) {
  if (validations instanceof Map) return validations;
  const m = new Map();
  (validations || []).forEach(d => { const id = d && (d.shortId || d._id); if (id) m.set(String(id), d); });
  return m;
}
// Owner-accepted sanitized errors (COLLECTIONS.sanitizationErrorAccepts, _id = the shortId) -> Map
// shortId -> the accept doc, from a Map, a Set / array of shortIds or an array of docs
// ({ shortId, acceptedBy, acceptedAt, note }).
function acceptMap(x) {
  if (x instanceof Map) return x;
  const m = new Map();
  Array.from(x || []).forEach(d => {
    if (typeof d === 'string') { if (d) m.set(d, null); return; }
    const id = d && (d.shortId || d._id);
    if (id) m.set(String(id), d);
  });
  return m;
}
// The row's `validation` from the ticket's record: the failures the latest upload detected, plus what
// the Error detected section shows (the uploaded closure code, what was checked, when, and the ten
// stored fields).
// null when the ticket has no record (it was never validated, or the upload flagged nothing), and null
// for a record of an EARLIER upload (dataStamp !== the current data stamp): the latest upload produced
// no result for that ticket - its assignment was revoked, it left the Resolved / Closed scope, or it
// was skipped - so the record (and its detectedAt) is out of date and decides nothing.
function validationOf(doc, stamp) {
  if (!doc) return null;
  if (stamp && doc.dataStamp && !sameStamp(doc.dataStamp, stamp)) return null;
  const failures = (doc.failures || []).filter(f => f && f.key);
  return { closureCode: doc.closureCode || '', scope: doc.scope || '', detectedAt: doc.detectedAt || null,
    failures, fields: doc.fields || null };
}
// approvedIds: see apprMap (the approval docs give the 'Approved error' row its by / at / reason).
// validations / accepts: the validation records and the tickets the owner accepted as sanitized errors
// (see valMap / acceptMap); without them every row's `validation` is null and the mark rules decide alone.
function contractorView(assignments, login, report, stamp, marks, approvedIds, validations, accepts) {
  const me = normLogin(login);
  const ix = report ? reportIndex(report) : { byId: new Map(), excluded: new Map(), rule: new Map() };
  const appr = apprMap(approvedIds);
  const vals = valMap(validations), acc = acceptMap(accepts);
  const mk = new Map((marks || []).filter(m => m && normLogin(m.login) === me && m.shortId).map(m => [m.shortId, m]));
  const docs = (assignments || [])
    .filter(a => a && a.status === 'active' && normLogin(a.assignee) === me)
    .sort((a, b) => String(b.assignedAt || '').localeCompare(String(a.assignedAt || '')));
  const seen = new Set(), tickets = [];
  docs.forEach(a => {
    liveTickets(a, ix).forEach(t => {   // TEST / NON-PHD tickets: no row, not counted
      if (seen.has(t.shortId)) return;
      seen.add(t.shortId);
      const row = rowOf(a, t, ix, mk.get(t.shortId), stamp, appr, validationOf(vals.get(t.shortId), stamp), acc.has(t.shortId) ? (acc.get(t.shortId) || {}) : null);
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
      // Errors the latest upload detected, awaiting the owner's review: in NEITHER cleared nor
      // needsCorrection, so they add nothing to the agent's sanitization total until the owner
      // accepts the ticket or sends it back (handleDetectedReview).
      errorDetected: count('error-detected'),
      // Same bucket under its old name, for a browser still running sanitization-view.js?v=18.
      errorDeducted: count('error-detected'),
      notFound: count('not-found'), excluded: count('excluded'), pending: tickets.filter(t => !t.verified).length,
      legacyCompleted: tickets.filter(t => t.legacyCompleted).length },
  };
}
// One contractor-view row (assignment a, its ticket t, report index ix, mark doc m, approvals appr =
// Map shortId -> approval doc, val = the ticket's `validation` from validationOf or null, acc = the
// ticket's accept doc from COLLECTIONS.sanitizationErrorAccepts or null). An owner-approved error is a
// 'cleared' row with approvedError; a ticket the owner ACCEPTED as a sanitized error is a 'cleared'
// row with acceptedError and no validation, whatever record is still lying around for it.
function rowOf(a, t, ix, m, stamp, appr, val, acc) {
  const cur = ix.byId.get(t.shortId), why = cur ? null : ix.excluded.get(t.shortId);
  if (acc) {
    return {
      shortId: t.shortId, url: t.url || (cur && cur.url) || '', title: (cur && cur.title) || t.title || '',
      assignedAt: a.assignedAt || null,
      scoreAtAssign: typeof t.scoreAtAssign === 'number' ? t.scoreAtAssign : null,
      scoreNow: cur && typeof cur.score === 'number' ? cur.score : null,
      passedNow: null, requiredNow: null, clearedNow: true, defects: [], missingNow: [],
      group: null, target: null, reason: null, closureCode: acc.closureCode || (cur ? (cur.cc || '') : null), status: 'cleared',
      excludedReason: null, verified: true, verifiedFailed: false,
      note: 'Accepted by ' + (acc.acceptedBy || 'the owner') + ' as a sanitized error',
      mark: null, verifiedMark: (m && CLAIMS[m.status]) ? markOut(m) : null,
      legacyCompleted: false, returned: null, validation: null,
      acceptedError: { by: acc.acceptedBy || '', at: acc.acceptedAt || null, note: acc.note || '' },
    };
  }
  if ((appr && appr.has(t.shortId)) || why === APPROVED_REASON) {
    const d = (appr && appr.get(t.shortId)) || {};
    return {
      shortId: t.shortId, url: t.url || (cur && cur.url) || '', title: (cur && cur.title) || t.title || '',
      assignedAt: a.assignedAt || null,
      scoreAtAssign: typeof t.scoreAtAssign === 'number' ? t.scoreAtAssign : null, scoreNow: null,
      passedNow: null, requiredNow: null, clearedNow: true, defects: [], missingNow: [],
      group: null, target: null, reason: null, closureCode: null, status: 'cleared',
      excludedReason: null, verified: true, verifiedFailed: false, note: null,
      mark: null, verifiedMark: (m && m.status === 'error') ? markOut(m) : null,
      legacyCompleted: false, returned: null, validation: val || null,
      approvedError: { by: d.approvedBy || '', at: d.approvedAt || null, reason: d.reason || (m && m.status === 'error' ? m.reason || '' : ''), note: d.note || '' },
    };
  }
  const ev = evalTicket(cur, why, m, stamp, { validation: val || null });
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
    // The latest upload's validation record (null = no record): what the owner reviews per item.
    validation: (ev && ev.validation) || val || null,
  };
}

// GET /api/my-sanitization[?login=]. Returns { status, body }. Never writes.
//   owner AND contractors get the same data: without ?login -> { owner, viewer, contractors:[{login,
//   displayName, assigned, cleared, needsCorrection, pending, notFound, excluded, ...}] }; with
//   ?login=<contractor> that contractor's view (+ canMark: owner, or the contractor's own view);
//   anyone else -> 403. The (expensive) data is loaded only after the access check.
// deps: { user, contractors, load: async () => ({ docs (active assignments), report, stamp, marks?,
//   approved?, validations? (COLLECTIONS.sanitizationValidations docs), accepts?
//   (COLLECTIONS.sanitizationErrorAccepts docs) }) }
async function handleMine(query, deps) {
  const me = normLogin(deps.user && deps.user.username);
  const list = deps.contractors || [];
  const owner = !!me && isOwner(me);
  const findC = l => list.find(c => c.login === l);
  // canViewAll (set by the route for the BLR / AZA / WFH teams) may read every contractor's view;
  // marking and error review stay gated by canMark / canReview below.
  const canViewAll = owner || !!deps.canViewAll;
  if (!me || (!canViewAll && !findC(me))) return { status: 403, body: { error: 'My sanitization is available only to the PHD teams.' } };
  const want = normLogin(query && query.login);
  if (want && !findC(want)) return { status: 404, body: { error: 'Unknown contractor.' } };
  const { docs, report, stamp, marks, approved, validations, accepts } = await deps.load();
  const apprIds = apprMap(approved);
  const vals = valMap(validations), acc = acceptMap(accepts);
  if (!want) {
    return { status: 200, body: { owner, viewer: me, dataAsOf: stamp || null, maxScore: MAX_SCORE, contractors: list.map(c => ({ login: c.login, displayName: c.displayName || '', ...contractorView(docs, c.login, report, stamp, marks, apprIds, vals, acc).totals })) } };
  }
  const v = contractorView(docs, want, report, stamp, marks, apprIds, vals, acc);
  // Error tickets and the errors the latest upload detected are owner-only HERE (the Error detected
  // section has its own endpoint, handleErrors, where a contractor sees their own rows): everyone else
  // gets only their counts (totals.errorTickets / totals.errorDetected), no rows.
  if (!owner) v.tickets = v.tickets.filter(t => t.status !== 'error-ticket' && t.status !== 'error-detected');
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

// ---- Detected-error review (owner only, ONE ticket at a time) ----
const OWNER_VALIDATION = 'Only harisss can review detected errors.';
// POST /api/sanitization-validation/review { shortId, action:'accept'|'rework', note, login? }: the
// owner's two actions on ONE 'error-detected' ticket, both WHOLE-TICKET. Deliberately NOT bulk (unlike
// handleErrorReview): a shortIds list or an array of ids is rejected.
//   accept ("Accept Sanitized error"): one doc per ticket is upserted into
//     COLLECTIONS.sanitizationErrorAccepts { _id:<shortId>, shortId, acceptedBy, acceptedAt, note,
//     closureCode, failures (what was detected when it was accepted) }, and the ticket's
//     COLLECTIONS.sanitizationValidations doc is DELETED so nothing stale lingers in the current stamp
//     window. The acceptance is permanent: the ticket counts as sanitized ('cleared' with
//     acceptedError) and no later upload validates it again (sanitization-validate.js opts.accepted).
//   rework: the contractor's mark becomes { status:'returned', ownerNote, returnedAt, returnedBy } (the
//     shape handleErrorReview's 'return' branch writes), so the ticket is back in their Tickets to
//     sanitize queue; ownerNote names every failing item ('label: message', <= REASON_MAX) and nothing
//     else. The validation record is left in place: the next upload refreshes or clears it.
// login = whose mark is sent back (the tracker view the owner is acting in); otherwise the ticket's
// newest mark decides. It is resolved and checked against the contractor list BEFORE any write, so a
// Rework never half-happens and never writes a mark for a non-contractor.
// deps: { user, contractors, validationColl, acceptColl, marksColl, now? }
async function handleDetectedReview(body, deps) {
  const me = normLogin(deps.user && deps.user.username);
  if (!me || !isOwner(me)) return { status: 403, body: { error: OWNER_VALIDATION } };
  const b = body || {};
  const bad = error => ({ status: 400, body: { error } });
  if (b.shortIds != null || Array.isArray(b.shortId)) return bad('Review one ticket at a time: shortId must be a single ticket.');
  const shortId = typeof b.shortId === 'string' ? b.shortId.trim() : '';
  if (!SID_RE.test(shortId)) return bad('Invalid ticket.');
  const action = b.action;
  if (action !== 'accept' && action !== 'rework') return bad("action must be 'accept' or 'rework'.");
  if (b.note != null && typeof b.note !== 'string') return bad('note must be text.');
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > REASON_MAX) return bad('The note can be at most ' + REASON_MAX + ' characters.');
  const asked = typeof b.login === 'string' ? normLogin(b.login) : '';
  const doc = await deps.validationColl.findOne({ _id: shortId });
  const failures = ((doc && doc.failures) || []).filter(f => f && f.key);
  if (!failures.length) return { status: 409, body: { error: 'This ticket has no detected errors.' } };
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  if (action === 'accept') {
    await deps.acceptColl.updateOne({ _id: shortId },
      { $set: { shortId, acceptedBy: me, acceptedAt: at, note, closureCode: doc.closureCode || '', failures } }, { upsert: true });
    // The record of the current upload would otherwise keep the ticket in the Error detected section.
    await deps.validationColl.deleteOne({ _id: shortId });
    return { status: 200, body: { ok: true, shortId, action, items: failures.map(f => f.key), ownerNote: null, login: null, at, by: me } };
  }
  const marks = await deps.marksColl.find({ shortId }).toArray();
  const when = m => { const t = markTime(m); return isNaN(t) ? -Infinity : t; };
  const newest = (marks || []).filter(m => m && m.login).sort((x, y) => when(y) - when(x))[0];
  const login = asked || normLogin(newest && newest.login);
  if (!login) return { status: 409, body: { error: 'This ticket has no contractor to send it back to.' } };
  // The mark goes to a CONTRACTOR, the same gate handleMark applies: a posted `login` that is not one
  // would leave a stray mark nobody's tracker ever reads.
  if (!(deps.contractors || []).some(c => c && c.login === login)) return { status: 404, body: { error: 'Unknown contractor.' } };
  const ownerNote = failures.map(f => f.label + ': ' + f.message).join(' ').slice(0, REASON_MAX);
  await deps.marksColl.updateOne({ login, shortId },
    { $set: { login, shortId, status: 'returned', ownerNote, returnedAt: at, returnedBy: me } }, { upsert: true });
  return { status: 200, body: { ok: true, shortId, action, items: failures.map(f => f.key), ownerNote, login, at, by: me } };
}

// GET /api/sanitization-errors[?login=] — the top-level "Error detected" section of the Sanitization
// Tracker: every ticket the latest upload flagged and nobody has reviewed yet, as flat rows the browser
// groups by detection day and then by agent (sanitization-view.js errorSectionHtml).
// Access is handleMine's gate: the owner and the view-all teams (deps.canViewAll) see every agent, a
// contractor sees only their own rows, anyone else 403. The two buttons are owner-only: canReview.
// deps: { user, contractors, canViewAll?, load: async () => ({ docs, report, stamp, marks?, approved?,
//   validations?, accepts? }) } — the same load() handleMine takes. Never writes.
async function handleErrors(query, deps) {
  const me = normLogin(deps.user && deps.user.username);
  const list = deps.contractors || [];
  const owner = !!me && isOwner(me);
  const findC = l => list.find(c => c.login === l);
  const canViewAll = owner || !!deps.canViewAll;
  if (!me || (!canViewAll && !findC(me))) return { status: 403, body: { error: 'My sanitization is available only to the PHD teams.' } };
  const want = normLogin(query && query.login);
  if (want && !findC(want)) return { status: 404, body: { error: 'Unknown contractor.' } };
  if (want && !canViewAll && want !== me) return { status: 403, body: { error: 'You can see only your own tickets.' } };
  const { docs, report, stamp, marks, approved, validations, accepts } = await deps.load();
  const apprIds = apprMap(approved);
  const vals = valMap(validations), acc = acceptMap(accepts);
  const mine = want ? [findC(want)] : (canViewAll ? list : [findC(me)]);
  const tickets = [];
  mine.forEach(c => {
    contractorView(docs, c.login, report, stamp, marks, apprIds, vals, acc).tickets
      .filter(t => t.status === 'error-detected')
      .forEach(t => tickets.push({
        shortId: t.shortId, url: t.url || '', title: t.title || '', login: c.login, displayName: c.displayName || '',
        closureCode: (t.validation && t.validation.closureCode) || t.closureCode || '',
        detectedAt: (t.validation && t.validation.detectedAt) || null,
        missing: ((t.validation && t.validation.failures) || []).map(f => ({ key: f.key, label: f.label, message: f.message })),
      }));
  });
  // Newest detection first, then by agent and ticket, so the browser's grouping is stable.
  tickets.sort((x, y) => String(y.detectedAt || '').localeCompare(String(x.detectedAt || ''))
    || x.login.localeCompare(y.login) || x.shortId.localeCompare(y.shortId));
  return { status: 200, body: { owner, viewer: me, canReview: owner, dataAsOf: stamp || null, tickets } };
}

// GET /api/my-sanitization/approvals[?login=] — the top-level "Error tickets that need approval"
// section of the Sanitization Tracker (sanitization-view.js approvalSectionHtml) and the owner's
// approvals pop-up: every ticket a contractor marked Error with a reason that the owner has not
// approved yet, grouped BY AGENT. There is no upload date to group by - a contractor marks a ticket
// whenever they hit one - and only agents with a ticket waiting are listed.
// Access is handleErrors' gate: the owner and the view-all teams (deps.canViewAll) see every agent, a
// contractor only their own rows, anyone else 403. Approve / Send back are owner-only: canReview.
// The rows come from contractorView's 'error-ticket' bucket, the same one the agent's "Errors
// awaiting approval" tile counts, so the section total and the tiles always agree.
// deps: { user, contractors, canViewAll?, load: async () => ({ docs, report, stamp, marks?, approved?,
//   validations?, accepts? }) } — the same load() handleMine takes. Never writes.
async function handleApprovals(query, deps) {
  const me = normLogin(deps.user && deps.user.username);
  const list = deps.contractors || [];
  const owner = !!me && isOwner(me);
  const findC = l => list.find(c => c.login === l);
  const canViewAll = owner || !!deps.canViewAll;
  if (!me || (!canViewAll && !findC(me))) return { status: 403, body: { error: 'My sanitization is available only to the PHD teams.' } };
  const want = normLogin(query && query.login);
  if (want && !findC(want)) return { status: 404, body: { error: 'Unknown contractor.' } };
  if (want && !canViewAll && want !== me) return { status: 403, body: { error: 'You can see only your own tickets.' } };
  const { docs, report, stamp, marks, approved, validations, accepts } = await deps.load();
  const apprIds = apprMap(approved);
  const vals = valMap(validations), acc = acceptMap(accepts);
  const mine = want ? [findC(want)] : (canViewAll ? list : [findC(me)]);
  const agents = [];
  mine.forEach(c => {
    const tickets = contractorView(docs, c.login, report, stamp, marks, apprIds, vals, acc).tickets
      .filter(t => t.status === 'error-ticket')
      .map(t => ({
        shortId: t.shortId, url: t.url || '', title: t.title || '',
        note: (t.mark && t.mark.reason) || '', at: (t.mark && t.mark.at) || null,
      }))
      // Most recently marked first, so the newest reason is the one the owner reads first.
      .sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')) || x.shortId.localeCompare(y.shortId));
    if (tickets.length) agents.push({ login: c.login, displayName: c.displayName || '', tickets });
  });
  agents.sort((a, b) => a.login.localeCompare(b.login));
  return { status: 200, body: { owner, viewer: me, canReview: owner, dataAsOf: stamp || null, agents, total: agents.reduce((n, a) => n + a.tickets.length, 0) } };
}

module.exports = {
  COUNT_MAX, REASON_MAX, REVIEW_MAX, contractorsOf, liveVerification, lockedMap, availableInSection, availableCounts, markedTickets,
  closureGroups, availableInGroup,
  validateAssign, handleAssign, handleRevoke, handleGet, statusOf, sectionCounts, contractorView, handleMine, handleMark, markValid,
  handleErrorReview, handleRestore, handleDetectedReview, handleErrors, handleApprovals, missingChips, passedResult, chipFor, missingRequired,
  CLAIMS, NEED_REASONS, claimPending, verifiedClaim, verifyClaim, evalTicket, rowOf, markMap,
};
