// Team leave calendar (calendar.html): GET /api/leave + POST /api/leave { login, date, on }.
// One collection (COLLECTIONS.teamLeave) holds one tiny doc per person per day
//   { _id: '<login>|<YYYY-MM-DD>', login, date, by, at }
// so marking is an idempotent upsert and unmarking a delete of a single _id — never an array that
// grows per person. The calendar spans 2026-12-01 .. 2027-03-31 (121 days) and the server owns that
// range: GET returns it together with the full day list, so no date outside it is ever reachable.
// ACCESS (the 15 accounts and nobody else): the 13 analysts come from ASSIGN_GROUPS in
// ./assignments (BLR + AZA + WFH — the same memberships as GRP_A1 / GRP_B / GRP_A2 in server.js,
// which are local consts there and cannot be required), plus the 2 managers listed in MANAGERS.
// MARKING: everyone marks themselves; harisss (the owner) marks anyone; a BLR or AZA member may
// also mark the two managers. Nobody else may mark anybody. There is no approval step — a mark can
// be removed by whoever may mark it, including for a date that has already passed.
// Pure (no DB I/O of its own): every dependency (user, coll, now) is injected by server.js.
'use strict';
const { ASSIGN_GROUPS } = require('./assignments');
const { isOwner } = require('./sanitization-score');   // OWNER = 'harisss'

const MANAGERS = ['ashamzon', 'wehnermi'];
const MAY_MARK_MANAGERS = ['BLR', 'AZA'];   // groups whose members may also mark the two managers
const RANGE_FROM = '2026-12-01';
const RANGE_TO = '2027-03-31';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const norm = s => String(s == null ? '' : s).trim().toLowerCase();
// login -> 'BLR' | 'AZA' | 'WFH' | 'MGR'. The analysts are derived; only the managers are written out.
const GROUP_OF = new Map();
ASSIGN_GROUPS.forEach(g => g.members.forEach(m => GROUP_OF.set(norm(m), g.name)));
MANAGERS.forEach(m => GROUP_OF.set(norm(m), 'MGR'));
const MEMBERS = Array.from(GROUP_OF.entries()).map(([login, group]) => ({ login, group }));

function hasAccess(login) { return GROUP_OF.has(norm(login)); }
function canMark(actor, target) {
  const a = norm(actor), t = norm(target);
  if (!hasAccess(a) || !hasAccess(t)) return false;   // outside the 15: never
  if (a === t) return true;                           // everyone marks themselves
  if (isOwner(a)) return true;                        // harisss marks anyone
  return MAY_MARK_MANAGERS.includes(GROUP_OF.get(a)) && MANAGERS.includes(t);
}
// The logins `actor` may mark, in MEMBERS order — the page uses it to hide controls, never to decide.
function canMarkList(actor) { return MEMBERS.filter(m => canMark(actor, m.login)).map(m => m.login); }

const iso = d => d.toISOString().slice(0, 10);
// The 121 days of the calendar, stepped as UTC dates (2026-12: 31, 2027-01: 31, 2027-02: 28 — 2027
// is not a leap year, 2027-03: 31).
function leaveDates() {
  const out = [], end = new Date(RANGE_TO + 'T00:00:00Z');
  for (let d = new Date(RANGE_FROM + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
  return out;
}
// Shape + real-calendar round-trip (so 2027-02-29 is rejected) + inclusive range compare. The date
// strings are fixed-width, so a lexicographic compare is a date compare.
function validDate(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d.getTime()) || iso(d) !== v) return false;
  return v >= RANGE_FROM && v <= RANGE_TO;
}
const leaveId = (login, date) => norm(login) + '|' + date;
const rowOf = d => ({ login: norm(d && d.login), date: String((d && d.date) || ''), by: norm(d && d.by), at: (d && d.at) || null });

// GET /api/leave. deps: { user:{username}, coll }. 403 outside the 15; every viewer with access sees
// the WHOLE team's leave (that is the point of the page).
async function handleGet(query, deps) {
  const me = norm(deps.user && deps.user.username);
  if (!hasAccess(me)) return { status: 403, body: { error: 'This calendar is for the PHD team.' } };
  const docs = await deps.coll.find({}).toArray();
  return { status: 200, body: {
    range: { from: RANGE_FROM, to: RANGE_TO },
    dates: leaveDates(),
    members: MEMBERS.map(m => ({ login: m.login, group: m.group })),
    me: { login: me, group: GROUP_OF.get(me), canMark: canMarkList(me) },
    leave: (docs || []).map(rowOf),
  } };
}

// POST /api/leave { login, date, on }. `on` is explicit rather than a server-side toggle: it is
// idempotent and cannot lose a double click. deps: { user:{username}, coll, now? }.
async function handleMark(body, deps) {
  const b = body || {};
  const actor = norm(deps.user && deps.user.username);
  const login = norm(typeof b.login === 'string' && b.login.trim() ? b.login : actor);
  if (!canMark(actor, login)) return { status: 403, body: { error: 'You can mark only your own leave.' } };
  const date = typeof b.date === 'string' ? b.date.trim() : '';
  if (!validDate(date)) return { status: 400, body: { error: 'Pick a date between ' + RANGE_FROM + ' and ' + RANGE_TO + '.' } };
  if (typeof b.on !== 'boolean') return { status: 400, body: { error: 'on must be true or false.' } };
  const _id = leaveId(login, date);
  if (b.on) {
    const at = (deps.now ? deps.now() : new Date()).toISOString();
    await deps.coll.updateOne({ _id }, { $set: { login, date, by: actor, at } }, { upsert: true });
  } else {
    await deps.coll.deleteOne({ _id });
  }
  return { status: 200, body: { ok: true, login, date, on: b.on } };
}

module.exports = { MANAGERS, MAY_MARK_MANAGERS, RANGE_FROM, RANGE_TO, GROUP_OF, MEMBERS, norm, hasAccess, canMark, canMarkList, leaveDates, validDate, leaveId, handleGet, handleMark };
