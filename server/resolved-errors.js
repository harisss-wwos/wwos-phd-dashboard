// Errors in Resolved (errors-in-resolved.html) + the top-bar alert-triangle chip:
// GET /api/resolved-errors[?who=<login|others>]. READ-ONLY, pure (no DB I/O): server.js passes the
// live 11-point sanitization score report (sanitization-score.js via sanReportFor + sanLiveReport:
// Resolved / Closed tickets created since 1 Jan 2026 Pacific, deduped by ShortId, with the same
// exclusions - appeal, test, duplicate, AUTO-SIM, Cnt > 0, approved error). A ticket "has errors"
// when the closure-code rule (sanitization-score.js closureRule; no marks here) gives it a defect or
// one of its REQUIRED checks fails: Successful = all 11; Immediately Resolved = the 3 title checks
// when the title's issue type is Out of Scope of PHD / an unsecured pet type with Sev 3-5, else a
// defect + 11; any other code = a defect + the checks of the code it should become. "perfect" = no
// defect and every required check passes (the same rule as the Sanitization Tracker). Each error row
// carries defects (messages) and missing (failing required checks).
// Tickets are grouped by RESOLVER (report ticket `rbi` = raw ResolvedByIdentity, normalised by
// resolverLogin): one card per team member (BLR + AZA from ASSIGN_GROUPS) + 'others' (anyone else,
// blank resolver included). Only the team members may read (403 otherwise).
'use strict';
const { ASSIGN_GROUPS } = require('./assignments');
const { MAX_SCORE, ticketCleared } = require('./sanitization-score');
const { missingChips } = require('./sanitization-assign');

const TEAM_GROUP_NAMES = ['BLR', 'AZA'];
const TEAM = [];
ASSIGN_GROUPS.filter(g => TEAM_GROUP_NAMES.includes(g.name)).forEach(g => g.members.forEach(login => TEAM.push({ login, group: g.name })));
const TEAM_SET = new Set(TEAM.map(t => t.login));
const OTHERS = 'others';

// Same normalisation as the rest of the app (perfResolverLogin): strip 'kerberos:' / '@ANT.AMAZON.COM', lower-case.
function resolverLogin(raw) {
  return String(raw == null ? '' : raw).trim().replace(/^kerberos:/i, '').replace(/@ANT\.AMAZON\.COM$/i, '').toLowerCase();
}
function isTeam(username) { return TEAM_SET.has(String(username == null ? '' : username).trim().toLowerCase()); }
const keyOf = t => { const l = resolverLogin(t && t.rbi); return TEAM_SET.has(l) ? l : OTHERS; };

// report -> { cards, byKey:{ key: [error tickets] } }. Report tickets are already sorted by score
// ascending, then oldest resolved first, so filtering keeps that order.
function group(report) {
  const stats = new Map(), lists = new Map();
  TEAM.concat([{ login: OTHERS, group: null }]).forEach(m => { stats.set(m.login, { resolved: 0, withErrors: 0 }); lists.set(m.login, []); });
  ((report && report.tickets) || []).forEach(t => {
    const k = keyOf(t), s = stats.get(k);
    s.resolved++;
    if (!ticketCleared(t)) {
      s.withErrors++;
      // score = passed REQUIRED checks out of `required`; rawScore = the 0..11 score.
      const row = { shortId: t.shortId, url: t.url, title: t.title, score: t.pass, required: t.need, rawScore: t.score,
        group: t.grp || null, target: t.tgt || null, closureCode: t.cc || '', defects: (t.def || []).slice(), missing: missingChips(t) };
      if (k === OTHERS) row.resolvedBy = resolverLogin(t.rbi);
      lists.get(k).push(row);
    }
  });
  // Lowest passed / required ratio first, then fewer passed; ties keep the report order (oldest resolved first).
  const ratio = r => (r.required ? r.score / r.required : 0);
  lists.forEach((l, key) => {
    lists.set(key, l.map((r, i) => ({ r, i })).sort((a, b) => (ratio(a.r) - ratio(b.r)) || (a.r.score - b.r.score) || (a.i - b.i)).map(x => x.r));
  });
  const card = (key, label, grp) => {
    const s = stats.get(key), perfect = s.resolved - s.withErrors;
    return { key, label, group: grp, resolved: s.resolved, withErrors: s.withErrors, perfect, passPct: s.resolved ? Math.round(perfect / s.resolved * 100) : 0 };
  };
  const cards = TEAM.map(m => card(m.login, m.login, m.group)).concat([card(OTHERS, 'Others', null)]);
  return { cards, byKey: lists };
}

// Grouping memoised per live report object (the report itself is cached per data stamp + approved set).
let _memo = { report: null, out: null };
function groupedOf(report) {
  if (_memo.report !== report) _memo = { report, out: group(report) };
  return _memo.out;
}

// query: { who? }; deps: { user:{username}, load: async () => ({ report, asOf }) } (load runs after the access check).
async function handle(query, deps) {
  const me = String((deps.user && deps.user.username) || '').trim().toLowerCase();
  if (!isTeam(me)) return { status: 403, body: { error: 'This page is for the BLR and AZA team.' } };
  const whoRaw = query && query.who != null ? String(query.who).trim().toLowerCase() : '';
  if (whoRaw && whoRaw !== OTHERS && !TEAM_SET.has(whoRaw)) return { status: 400, body: { error: 'Unknown card.' } };
  const { report, asOf } = await deps.load();
  const g = groupedOf(report);
  const base = { asOf: asOf || (report && report.computedAt) || null, maxScore: MAX_SCORE };
  if (!whoRaw) return { status: 200, body: { ...base, cards: g.cards } };
  const card = g.cards.find(c => c.key === whoRaw);
  return { status: 200, body: { ...base, who: whoRaw, card, tickets: g.byKey.get(whoRaw) } };
}

module.exports = { TEAM, TEAM_SET, OTHERS, resolverLogin, isTeam, group, handle };
