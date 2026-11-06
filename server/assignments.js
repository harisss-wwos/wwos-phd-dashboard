// Assignment Center: admins hand unassigned tickets to an agent ("dashboard assignment").
// One collection (COLLECTIONS.ticketAssignments) holds two kinds of docs:
//   kind:'log'    one per assign action { at, by, assignee, group, section, tickets:[{shortId,title}], count, key, replaced:[{shortId,from}] }
//                 + after a revoke: { revokedAt, revokedBy, revokedCount, skipped:[shortId] }
//   kind:'log', action:'revoke'  one per revoke { at, by, assignee, group, section, tickets, count, revokes:<logId>, skipped }
//   kind:'active' one per ticket, _id 'active:<shortId>' { shortId, assignee, by, at, status:'pending'|'revoked', group, section, logId }
// An active assignment is closed on READ (never written back): it stays pending only while the
// ticket is still open AND its SIM assignee is not the assignee ('picked' / 'resolved' otherwise).
// Kept in its own module so validation + the pending rule can be unit-tested without a DB.

// Analyst groups by lower-case login.
// KEEP IN SYNC with USER_GROUPS in users.html (that page keeps its own copy with display colours).
const ASSIGN_GROUPS = [
  { name: 'BLR', members: ['harisss', 'punithsd', 'arunkzn', 'flofalgu'] },
  { name: 'AZA', members: ['mbozied', 'nobregak', 'mellanej'] },
  { name: 'WFH', members: ['tanviroo', 'urmahala', 'chousoud', 'obalasut', 'shaavhad', 'dbiswamb'] },
];
const ASSIGN_SECTIONS = ['Sev 1', 'Sev 2', 'Sev 3', 'Sev 4', 'Sev 5', 'No EMT'];
const ASSIGN_MAX = 100;
const ASSIGN_DUP_MS = 10 * 1000;
const SHORT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const activeId = sid => 'active:' + sid;

function groupByName(name) {
  const n = String(name || '').trim().toUpperCase();
  return ASSIGN_GROUPS.find(g => g.name === n) || null;
}
// Admin = analyst with role owner/admin (the Assignment Center "Admins").
function isAssignAdmin(user) {
  return !!user && user.analyst === true && ['owner', 'admin'].includes(String(user.role || '').toLowerCase());
}
// st = { assignees:[login...] } for a ticket that is still open, or null/undefined when it is not
// open any more (resolved / closed / gone).
function assignmentStatus(a, st) {
  if (!st) return 'resolved';
  const who = String((a && a.assignee) || '').toLowerCase();
  return (st.assignees || []).some(l => String(l || '').toLowerCase() === who) ? 'picked' : 'pending';
}
// activeDocs + states (Map shortId -> st) -> { shortId: { assignee, by, at } } for pending ones.
function pendingMap(activeDocs, states) {
  const out = {};
  (activeDocs || []).forEach(a => {
    if (!a || !a.shortId || a.status !== 'pending') return;
    if (assignmentStatus(a, states.get(a.shortId)) === 'pending') out[a.shortId] = { assignee: a.assignee, by: a.by, at: a.at };
  });
  return out;
}

// ctx: { unassigned: Map shortId -> row (current unassigned open list), analysts: Set of analyst logins }
function validateAssign(body, ctx) {
  const b = body || {};
  const bad = error => ({ ok: false, status: 400, error });
  if (!Array.isArray(b.tickets) || !b.tickets.length) return bad('Select at least one ticket.');
  if (b.tickets.length > ASSIGN_MAX) return bad('You can assign at most ' + ASSIGN_MAX + ' tickets at a time.');
  const tickets = b.tickets.map(t => String(t == null ? '' : t).trim());
  if (tickets.some(t => !SHORT_ID_RE.test(t))) return bad('Invalid ticket ID.');
  if (new Set(tickets).size !== tickets.length) return bad('Ticket IDs must be unique.');
  const g = groupByName(b.group);
  if (!g) return bad('Group must be one of ' + ASSIGN_GROUPS.map(x => x.name).join(', ') + '.');
  const assignee = String(b.assignee || '').trim().toLowerCase();
  if (!assignee || !g.members.includes(assignee) || !ctx.analysts.has(assignee)) {
    return bad('Assignee must be a registered analyst in the ' + g.name + ' group.');
  }
  const section = String(b.section || '').trim();
  if (!ASSIGN_SECTIONS.includes(section)) return bad('Unknown section.');
  const invalid = tickets.filter(t => !ctx.unassigned.has(t));
  if (invalid.length) {
    return { ok: false, status: 400, invalid,
      error: 'These tickets are no longer in the unassigned list: ' + invalid.join(', ') + '. Refresh and try again.' };
  }
  return { ok: true, value: { tickets, assignee, group: g.name, section } };
}

// The whole POST /api/assignment-center/assign flow. Returns { status, body }.
// deps: { coll (ticket_assignments), user (fresh users doc of the caller), unassigned, analysts, now? }
async function handleAssign(body, deps) {
  if (!isAssignAdmin(deps.user)) return { status: 403, body: { error: 'Only Assignment Center admins can assign tickets.' } };
  const v = validateAssign(body, deps);
  if (!v.ok) return { status: v.status, body: v.invalid ? { error: v.error, invalid: v.invalid } : { error: v.error } };
  const { tickets, assignee, group, section } = v.value;
  const by = String(deps.user.username || '').trim().toLowerCase();
  const now = deps.now ? deps.now() : new Date();
  const at = now.toISOString();
  const key = assignee + '|' + tickets.slice().sort().join(',');
  const coll = deps.coll;

  // Idempotency: an identical request (same by + assignee + ticket set) within 10 s is ignored.
  const last = await coll.find({ kind: 'log', by, key }).sort({ at: -1 }).limit(1).toArray();
  if (last[0] && (now.getTime() - new Date(last[0].at).getTime()) < ASSIGN_DUP_MS) {
    return { status: 200, body: { ok: true, duplicate: true, count: last[0].count, assignee, tickets: last[0].tickets.map(t => t.shortId) } };
  }

  const existing = await coll.find({ kind: 'active', _id: { $in: tickets.map(activeId) } }).toArray();
  const replaced = existing
    .filter(a => a.status === 'pending' && a.assignee && a.assignee !== assignee)
    .map(a => ({ shortId: a.shortId, from: a.assignee, fromBy: a.by }));
  const log = {
    kind: 'log', at, by, assignee, group, section,
    tickets: tickets.map(s => ({ shortId: s, title: String((deps.unassigned.get(s) || {}).title || '').slice(0, 300) })),
    count: tickets.length, key, replaced,
  };
  const ins = await coll.insertOne(log);
  for (const s of tickets) {
    await coll.updateOne({ _id: activeId(s) },
      { $set: { kind: 'active', shortId: s, assignee, by, at, status: 'pending', group, section, logId: ins && ins.insertedId } },
      { upsert: true });
  }
  return { status: 200, body: { ok: true, count: tickets.length, assignee, group, tickets, replaced } };
}

// Only the user who made an assignment (the log entry's `by`) may revoke it; nobody else, not
// admins and not the owner. Case-insensitive, trimmed.
const normLogin = s => String(s == null ? '' : s).trim().toLowerCase();
function canRevoke(entry, login) {
  const me = normLogin(login), by = normLogin(entry && entry.by);
  return !!me && !!by && me === by;
}
// First entry the caller may not revoke (whole request is rejected, no partial revoke), or null.
function revokeDenied(entries, login) {
  return (entries || []).find(e => !canRevoke(e, login)) || null;
}

// The whole POST /api/assignment-center/revoke { logId } flow. Returns { status, body }.
// Undoes every assignment made by one assign log entry. A ticket is only released when its active
// assignment is still the one that entry created (same assignee + logId, or same `at` for docs
// without a logId) AND it is still pending; anything else (re-assigned later, picked up, resolved)
// is reported as skipped. The entry is marked revoked (never deleted) and a NEW log entry
// { action:'revoke', revokes:<logId> } is written. A second revoke is a no-op (alreadyRevoked).
// Only the entry's assigner may revoke it (403 otherwise, see canRevoke).
// deps: { coll, user, toId (string -> _id or null), states: async shortIds -> Map shortId -> st, now? }
async function handleRevoke(body, deps) {
  if (!deps.user || !normLogin(deps.user.username)) return { status: 403, body: { ok: false, error: 'Sign in to revoke assignments.' } };
  const logId = String((body && body.logId) == null ? '' : body.logId).trim();
  const id = logId ? deps.toId(logId) : null;
  if (id == null) return { status: 400, body: { error: 'Invalid log entry.' } };
  const coll = deps.coll;
  const entry = await coll.findOne({ _id: id, kind: 'log' });
  if (!entry) return { status: 404, body: { error: 'Log entry not found.' } };
  if (entry.action === 'revoke') return { status: 400, body: { error: 'A revoke entry cannot be revoked.' } };
  const denied = revokeDenied([entry], deps.user.username);
  if (denied) return { status: 403, body: { ok: false, error: 'Only ' + (normLogin(denied.by) || 'the assigner') + ' can revoke this assignment.' } };
  const already = e => ({ status: 200, body: { ok: true, alreadyRevoked: true, logId, assignee: e.assignee,
    revokedAt: e.revokedAt, revokedBy: e.revokedBy, revokedCount: e.revokedCount || 0, skipped: e.skipped || [] } });
  if (entry.revokedAt) return already(entry);

  const by = String(deps.user.username || '').trim().toLowerCase();
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  // Claim the entry first so two concurrent revokes cannot both run.
  const claim = await coll.updateOne({ _id: id, kind: 'log', revokedAt: { $exists: false } }, { $set: { revokedAt: at, revokedBy: by } });
  if (!claim || !claim.modifiedCount) return already((await coll.findOne({ _id: id })) || entry);

  const tickets = (Array.isArray(entry.tickets) ? entry.tickets : []).filter(t => t && t.shortId);
  const sids = tickets.map(t => String(t.shortId));
  const active = new Map((await coll.find({ kind: 'active', _id: { $in: sids.map(activeId) } }).toArray()).map(a => [a.shortId, a]));
  const states = sids.length ? await deps.states(sids) : new Map();
  const revoked = [], skipped = [];
  for (const sid of sids) {
    const a = active.get(sid);
    const owned = !!a && a.status === 'pending' && a.assignee === entry.assignee &&
      (a.logId != null ? String(a.logId) === String(entry._id) : a.at === entry.at);
    if (!owned || assignmentStatus(a, states.get(sid)) !== 'pending') { skipped.push(sid); continue; }
    const r = await coll.updateOne({ _id: activeId(sid), status: 'pending', assignee: entry.assignee, at: a.at },
      { $set: { status: 'revoked', revokedAt: at, revokedBy: by } });
    if (r && r.modifiedCount) revoked.push(sid); else skipped.push(sid);
  }
  await coll.updateOne({ _id: id }, { $set: { revokedCount: revoked.length, skipped } });
  await coll.insertOne({
    kind: 'log', action: 'revoke', at, by, assignee: entry.assignee, group: entry.group, section: entry.section,
    tickets, count: revoked.length, revokes: String(entry._id), skipped,
  });
  return { status: 200, body: { ok: true, logId, assignee: entry.assignee, revokedCount: revoked.length, revoked, skipped } };
}

// API shape of a log entry. kind: 'assign' | 'revoke'.
function mapLog(d) {
  const out = { id: String(d._id), kind: d.action === 'revoke' ? 'revoke' : 'assign', at: d.at, by: d.by, assignee: d.assignee, group: d.group, section: d.section,
    count: d.count, tickets: Array.isArray(d.tickets) ? d.tickets : [], replaced: Array.isArray(d.replaced) ? d.replaced : [] };
  if (d.revokedAt) Object.assign(out, { revokedAt: d.revokedAt, revokedBy: d.revokedBy, revokedCount: d.revokedCount || 0 });
  if (d.revokedAt || d.action === 'revoke') out.skipped = Array.isArray(d.skipped) ? d.skipped : [];
  if (d.revokes) out.revokes = String(d.revokes);
  return out;
}

module.exports = { ASSIGN_GROUPS, ASSIGN_SECTIONS, ASSIGN_MAX, ASSIGN_DUP_MS, groupByName, isAssignAdmin, assignmentStatus, pendingMap, validateAssign, handleAssign, handleRevoke, canRevoke, revokeDenied, mapLog, activeId };
