// Assignment Center: admins hand unassigned tickets to an agent ("dashboard assignment").
// One collection (COLLECTIONS.ticketAssignments) holds two kinds of docs:
//   kind:'log'    one per assign action { at, by, assignee, group, section, tickets:[{shortId,title}], count, key, replaced:[{shortId,from}] }
//   kind:'active' one per ticket, _id 'active:<shortId>' { shortId, assignee, by, at, status:'pending', group, section }
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

// API shape of a log entry.
function mapLog(d) {
  return { id: String(d._id), at: d.at, by: d.by, assignee: d.assignee, group: d.group, section: d.section,
    count: d.count, tickets: Array.isArray(d.tickets) ? d.tickets : [], replaced: Array.isArray(d.replaced) ? d.replaced : [] };
}

module.exports = { ASSIGN_GROUPS, ASSIGN_SECTIONS, ASSIGN_MAX, ASSIGN_DUP_MS, groupByName, isAssignAdmin, assignmentStatus, pendingMap, validateAssign, handleAssign, mapLog, activeId };
