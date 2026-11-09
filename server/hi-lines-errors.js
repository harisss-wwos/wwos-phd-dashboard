// HI lines check (hi-resolved.html, 4th section): GET /api/hi-lines-errors[?who=<login|others>].
// READ-ONLY, pure (no DB I/O). server.js passes the cached Errors in Resolved report (eirReport():
// the evaluated set + the built report) and this module groups its 'hi' section (B6 only, Resolved +
// Closed, all agents; errors-in-resolved.js SECTIONS) by resolver: one card per BLR / AZA team member
// (resolved-errors.js TEAM) + 'others' (anyone else, non-PHD resolvers and a blank resolver included).
// Checked = the section's tickets in scope; With errors = those failing B6 (Cnt = N > 0 but HI1..HIN
// not all present once with a valid issue type). Rows carry the parsed Cnt and the missing HI lines
// (checkHiLines `cnt` / `missing`), highest Cnt first, ties oldest resolved first.
'use strict';
const { TEAM, TEAM_SET, OTHERS, resolverLogin } = require('./resolved-errors');

const SECTION_KEY = 'hi';
const keyOf = login => { const l = resolverLogin(login); return TEAM_SET.has(l) ? l : OTHERS; };
const timeOf = s => { const n = Date.parse(s); return isNaN(n) ? Infinity : n; };

// One error row. `other` = the B6 problems that are not a missing line (extra / repeated HI lines,
// HI line without a valid issue type), so a ticket listed for those still says why.
function rowOf(t, others) {
  const r = (t.results && t.results.B6) || {};
  const missing = Array.isArray(r.missing) ? r.missing.slice() : [];
  const other = String(r.msg || '').split('; ').filter(m => m && m.indexOf('HI missing:') !== 0);
  const row = { shortId: t.id, url: t.url, title: t.title, cnt: Number(r.cnt) || 0, missing, other, resolvedAt: t.resolvedAt };
  if (others) row.resolvedBy = resolverLogin(t.resolver) || 'unknown';
  return row;
}
// Highest Cnt first; ties oldest resolved first, then ticket ID.
function byCntDesc(a, b) {
  return (b.cnt - a.cnt) || (timeOf(a.resolvedAt) - timeOf(b.resolvedAt)) || String(a.shortId).localeCompare(String(b.shortId));
}

// (evald, report) -> { cards, totals, byKey:{ key: [error rows] } }.
function group(evald, report) {
  const sec = ((report && report.sections) || []).find(s => s.key === SECTION_KEY) || { statuses: ['resolved', 'closed'], tickets: [] };
  const statuses = new Set(sec.statuses || []);
  const stats = new Map(), lists = new Map();
  TEAM.concat([{ login: OTHERS }]).forEach(m => { stats.set(m.login, { checked: 0, withErrors: 0 }); lists.set(m.login, []); });
  const totals = { checked: 0, resolved: 0, closed: 0, withErrors: 0, errors: 0, missingLines: 0 };
  ((evald && evald.tickets) || []).forEach(t => {
    const st = String(t.status || '').toLowerCase();
    if (!statuses.has(st)) return;
    stats.get(keyOf(t.resolver)).checked++;
    totals.checked++; totals[st]++;
  });
  (sec.tickets || []).forEach(t => {
    const k = keyOf(t.resolver), row = rowOf(t, k === OTHERS);
    stats.get(k).withErrors++;
    lists.get(k).push(row);
    totals.withErrors++; totals.errors += Number(t.errors) || 0; totals.missingLines += row.missing.length;
  });
  lists.forEach(l => l.sort(byCntDesc));
  const card = (key, label, grp) => {
    const s = stats.get(key), ok = s.checked - s.withErrors;
    return { key, label, group: grp, checked: s.checked, withErrors: s.withErrors, correctPct: s.checked ? Math.round(ok / s.checked * 100) : 0 };
  };
  const cards = TEAM.map(m => card(m.login, m.login, m.group)).concat([card(OTHERS, 'Others', null)]);
  return { cards, totals, byKey: lists };
}

// Grouping memoised per cached report object (eirReport caches it per data stamp / settings / PHD set).
let _memo = { report: null, out: null };
function groupedOf(evald, report) {
  if (_memo.report !== report) _memo = { report, out: group(evald, report) };
  return _memo.out;
}

// query: { who? }; deps: { load: async () => ({ evald, report }) }. Any logged-in user (the route gates).
async function handle(query, deps) {
  const who = query && query.who != null ? String(query.who).trim().toLowerCase() : '';
  if (who && who !== OTHERS && !TEAM_SET.has(who)) return { status: 400, body: { error: 'Unknown card.' } };
  const { evald, report } = await deps.load();
  const g = groupedOf(evald, report);
  const src = (report && report.source) || {};
  const sec = ((report && report.sections) || []).find(s => s.key === SECTION_KEY) || {};
  const base = { asOf: src.dataAsOf || (report && report.generatedAt) || null, from: src.from || null,
    enabled: !(sec.counts || []).some(c => c.code === 'B6' && c.enabled === false) };
  if (!who) return { status: 200, body: { ...base, totals: g.totals, cards: g.cards } };
  return { status: 200, body: { ...base, who, card: g.cards.find(c => c.key === who), tickets: g.byKey.get(who) } };
}

module.exports = { SECTION_KEY, group, handle, rowOf, byCntDesc };
