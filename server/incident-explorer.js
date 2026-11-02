// Incident Explorer (incident-explorer.html) — pure drill-down model for GET /api/incident-explorer/*.
// No DB I/O here: server.js reads the Page ZERO ticket selection (pageZeroDocs: one read-only scan) and
// the Rules-page regions, then calls buildExplorer() once per (year, latest upload, regions) and caches it.
//
// TICKET SET   tickets CREATED (CreateDate, UTC) in `year`, one per ShortId — the same dedupeTickets() +
//              created-in-year filter as Page ZERO row 01 — that were RESOLVED SUCCESSFULLY BY AN AGENT
//              (agentResolveExclusion() below returns null). Every count, tree node, ticket list and
//              export uses only these tickets. The other created tickets are only counted as CONTEXT:
//              per node `t` (all created) and `a` (all resolved), plus the root-level `excluded` tally.
// SUMMARY      `summary` = the fixed 'All regions' cards over EVERY created ticket (never path-filtered):
//              created, agent (isSuccessfulAgentResolve), autosim (isImmediateAutoSimResolve), rule
//              (isImmediateRuleResolve) — mutually exclusive — and `other` = resolved in none of them.
// LEVELS       Region › Country › State › City › SID › Issue type › Root cause › Resolution › Driver type —
//              ONE chain, the same for every region (Unmapped included). HIERARCHIES below reorders the same
//              levels into a second tree (?hierarchy=driver: Driver type first); both share one record set.
//   Region       the region (regions collection, edited on rules.html) whose `countries` list holds the
//                ticket's country. Tickets whose country is in no region (incl. 'Unknown') -> 'Unmapped'.
//   Country      opts.countryOf(t) (server.js slaCountryOf, as Page ZERO); missing -> 'Unknown'.
//   State, City  zip-geo.js geoOf(country, zipFromRcd) — an OFFLINE GeoNames postal-code lookup (admin1 name /
//                place name, per-country rules and the ambiguity rule are documented there and in
//                data/README.md). Missing / invalid / placeholder zip, a country with no dataset file or no
//                match -> 'Unknown' (state and / or city); the rest of the path is kept.
//   SID          sidFromRcd (page-zero.js); missing -> 'Not specified'. The zip itself (zipFromRcd, missing ->
//                'Not specified') is not a level; it is kept on every ticket row and in the CSV, and each City
//                node carries `z` = its distinct zips (for the page search).
//   Issue type   page-zero.js issueTypeOf(): one of the 28 taxonomy types or 'Issue not specified',
//                classified in the Page ZERO Core-row order (RCD Issue line -> Title -> none). The issue
//                SOURCE (ISSUE_SOURCES) is kept per ticket for the CSV 'Issue source' column only.
//   Root cause   the ticket's RootCause field: whitespace collapsed, trimmed, leading '-' removed; blank,
//                placeholders and Excel error tokens (#NAME?, #N/A, #VALUE!, ...) -> 'Not specified'.
//                Grouped case-insensitively; the label is the most frequent spelling.
//   Resolution   opts.resolutionLabelOf(t) (server.js perfResolutionGroupLabelOf(doc, true) = the
//                Resolutions page groups). Context-only tickets that are not resolved -> 'Not resolved yet'.
//   Driver type  page-zero.js driverTypeOf() (the Page ZERO 'Incidents by Driver Type' rule):
//                DSP DA / Flex DP / Hub DA / Others.
// Every node: { k: name, n: successful agent resolves, t: all created tickets (context), a: all resolved
// tickets (context), c: children, z: City nodes only — sorted distinct zips } — children sorted by n desc,
// ties A->Z. A node exists only when n > 0; `t` / `a` count every created ticket on the same path.
// At EVERY level the children's n add up to the node's n, so the region totals add up to the root.
// `geo` (payload) = the dataset description + per-country coverage of State / City over the ticket set.
'use strict';
const {
  dedupeTickets, issueTypeOf, sidFromRcd, zipFromRcd, driverTypeOf, DRIVER_ROWS, csvCell,
  RESOLVED_STATUSES, toDate,
} = require('./page-zero');
const { resolutionFromRcd } = require('./pulse-check');
const zipGeo = require('./zip-geo');

const LEVELS = ['Region', 'Country', 'State', 'City', 'SID', 'Issue type', 'Root cause', 'Resolution', 'Driver type'];
const PATH_FIELDS = ['region', 'country', 'state', 'city', 'sid', 'issue', 'rc', 'res', 'drv'];   // rec field per level
const FIELD_LEVEL = new Map(PATH_FIELDS.map((f, i) => [f, LEVELS[i]]));
// HIERARCHIES: the level ORDER of each tree (?hierarchy=, default 'geo'). The same per-ticket records,
// ticket set and level definitions feed every tree; only the order differs, so every tree has the same root.
//   geo     Region > Country > State > City > SID > Issue type > Root cause > Resolution > Driver type (the original)
//   driver  Driver type > Region > Country > State > City > SID > Issue type > Root cause > Resolution
const HIERARCHIES = {
  geo: PATH_FIELDS,
  driver: ['drv', 'region', 'country', 'state', 'city', 'sid', 'issue', 'rc', 'res'],
};
const DEFAULT_HIERARCHY = 'geo';
const HIERARCHY_KEYS = Object.keys(HIERARCHIES);
const HIERARCHY_TAG = { geo: 'Geo', driver: 'Driver' };   // export filename prefix part
const levelsOf = h => HIERARCHIES[h].map(f => FIELD_LEVEL.get(f));
const fieldsOf = h => HIERARCHIES[h || DEFAULT_HIERARCHY] || PATH_FIELDS;
const NOT_SPECIFIED = 'Not specified';
const NOT_RESOLVED = 'Not resolved yet';
const UNMAPPED = 'Unmapped';
const MAX_VALUE_LEN = 200;
const MAX_PAGE_SIZE = 100;
const ISSUE_URL_BASE = 'https://t.corp.amazon.com/issues/';
const DRIVER_SHORT = new Map(DRIVER_ROWS.map(r => [r.key, r.short]));

// ---- "Resolved successfully by an agent" — the ONE definition of the page's ticket set ----
// agentResolveExclusion(t) returns null when the ticket counts, else the FIRST rule (in this order) that
// excludes it — the keys of EXCLUSION_RULES (the root-level `excluded` tally uses the same keys):
//   open          Status is not Resolved / Closed (RESOLVED_STATUSES, as Page ZERO).
//   noResolver    ResolvedByIdentity is blank.
//   botResolver   the resolver is not a human login: the AutoSIM identity, an AWS role / STS identity
//                 (arn:, assumed-role, aws:sts) or a bot / automation / system account (BOT_RESOLVER_RE).
//   petAutoTag    Tags / Labels carry 'pet_incident_auto_resolved' (same match as server.js PET_OVR_TAG_RE),
//                 even when an agent later re-resolved it.
//   autoClosed    the resolution is 'Automatically Closed': ClosureCode, or the RCD 'Res:' line value.
//   duplicate     the resolution is 'Duplicate': ClosureCode, or the RCD 'Res:' line value.
// To adjust the definition, edit the regexes / sets below or the order of the checks.
const EXCLUSION_RULES = ['open', 'noResolver', 'botResolver', 'petAutoTag', 'autoClosed', 'duplicate'];
const BOT_RESOLVER_RE = /autosim|^arn:|assumed-role|aws:sts|bot|automation|system/i;
const PET_AUTO_TAG_RE = /pet[\s_-]*(incident[\s_-]*)?auto[\s_-]*resol/i;
const AUTO_CLOSED_KEY = 'automatically closed';
const DUPLICATE_KEY = 'duplicate';
const normKey = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const hasPetAutoTag = v => (Array.isArray(v) ? v.some(x => PET_AUTO_TAG_RE.test(String(x == null ? '' : x))) : PET_AUTO_TAG_RE.test(String(v == null ? '' : v)));
function agentResolveExclusion(t) {
  if (RESOLVED_STATUSES.indexOf(t.Status) < 0) return 'open';
  const by = String(t.ResolvedByIdentity == null ? '' : t.ResolvedByIdentity).trim();
  if (!by) return 'noResolver';
  if (BOT_RESOLVER_RE.test(by)) return 'botResolver';
  if (hasPetAutoTag(t.Tags) || hasPetAutoTag(t.Labels)) return 'petAutoTag';
  const closure = normKey(t.ClosureCode), resLine = normKey(resolutionFromRcd(t.RootCauseDetails));
  if (closure === AUTO_CLOSED_KEY || resLine === AUTO_CLOSED_KEY) return 'autoClosed';
  if (closure === DUPLICATE_KEY || resLine === DUPLICATE_KEY) return 'duplicate';
  return null;
}
function isSuccessfulAgentResolve(t) { return agentResolveExclusion(t) === null; }

// ---- "Resolved automatically AND immediately" — the fixed 'All regions' cards (c) and (d) ----
// Live 2026 data: the ONLY automated resolver is the AutoSIM identity (every other ResolvedByIdentity is a
// person's login), and every AutoSIM resolve carries the pet_incident_auto_resolved tag, so the tag alone
// cannot split them. AutoSIM closes a ticket with one of two closure codes, which is the split used here:
//   isImmediateAutoSimResolve(t)  AutoSIM resolved it itself as 'Immediately Resolved'.
//   isImmediateRuleResolve(t)     the auto-resolve rule (pet_incident_auto_resolved) closed it through
//                                 AutoSIM as 'Automatically Closed'.
// Both also need Status Resolved / Closed and ResolvedDate - CreateDate in [0, IMMEDIATE_RESOLVE_MS].
// AutoSIM resolves cluster at ~7-8 s after creation (p90 8 s); 15 min keeps the queue-delay tail and drops
// the few AutoSIM re-resolves that happen hours / days later. Neither helper can overlap the agent set
// (botResolver excludes AutoSIM there) nor each other (different closure codes).
const IMMEDIATE_RESOLVE_MS = 15 * 60 * 1000;
const AUTOSIM_RESOLVER_RE = /autosim/i;
const IMMEDIATELY_RESOLVED_KEY = 'immediately resolved';
function isImmediateAutoResolve(t) {
  if (RESOLVED_STATUSES.indexOf(t.Status) < 0) return false;
  if (!AUTOSIM_RESOLVER_RE.test(String(t.ResolvedByIdentity == null ? '' : t.ResolvedByIdentity))) return false;
  const cd = toDate(t.cd), rd = toDate(t.rd);
  if (!cd || !rd) return false;
  const gap = rd.getTime() - cd.getTime();
  return gap >= 0 && gap <= IMMEDIATE_RESOLVE_MS;
}
function isImmediateAutoSimResolve(t) { return isImmediateAutoResolve(t) && normKey(t.ClosureCode) === IMMEDIATELY_RESOLVED_KEY; }
function isImmediateRuleResolve(t) { return isImmediateAutoResolve(t) && normKey(t.ClosureCode) === AUTO_CLOSED_KEY; }

// Excel error tokens (#NAME?, #N/A, #VALUE!, #REF!, #DIV/0!, #NUM!, #NULL!, #SPILL!, #CALC!, ...) and placeholders.
const EXCEL_ERR_RE = /^#(?:N\/A|[A-Z][A-Z0-9_\/]*[!?])$/i;
const RC_PLACEHOLDER_RE = /^(?:n\/?a|none|null|nil|unknown|tbd)$/i;
function rootCauseOf(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().replace(/^-+\s*/, '').trim();
  return !s || EXCEL_ERR_RE.test(s) || RC_PLACEHOLDER_RE.test(s) ? NOT_SPECIFIED : s;
}
const byCountThenName = (a, b) => (b.n - a.n) || a.k.localeCompare(b.k, 'en', { sensitivity: 'base' }) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);

function newNode(k) { return { k, n: 0, t: 0, a: 0, m: new Map(), z: null }; }
function bump(node) { node.n++; }
function child(node, k) { let c = node.m.get(k); if (!c) { c = newNode(k); node.m.set(k, c); } return c; }
// Context pass: count a created ticket (any status) on every EXISTING node of its path (never creates nodes).
function bumpContext(node, rec) { node.t++; if (rec.resolved) node.a++; }
// Map-based build node -> plain JSON node (sorted children; leaves have no `c`).
function finalize(node, depth) {
  const out = { k: node.k, n: node.n, t: node.t, a: node.a };
  if (node.z) out.z = Array.from(node.z).sort();
  if (node.m.size) out.c = Array.from(node.m.values()).map(c => finalize(c, depth + 1)).sort(byCountThenName);
  return out;
}

// tickets: Page ZERO docs (+ IssueUrl, ResolvedByIdentity, RootCause, Tags, Labels). opts: { year, now, regions:[{ key, name,
// countries }], countryOf(t), resolutionLabelOf(t), resolverName(raw) }. Returns the cached model.
function buildExplorer(tickets, opts) {
  const o = opts || {};
  const year = o.year || 2026, now = o.now || new Date();
  const countryOf = typeof o.countryOf === 'function' ? o.countryOf : (() => 'Unknown');
  const resolutionLabelOf = typeof o.resolutionLabelOf === 'function' ? o.resolutionLabelOf : (() => NOT_SPECIFIED);
  const resolverName = typeof o.resolverName === 'function' ? o.resolverName : (s => String(s || ''));
  const geoOf = typeof o.geoOf === 'function' ? o.geoOf : zipGeo.geoOf;
  const regions = (Array.isArray(o.regions) ? o.regions : []).map(r => ({ name: String(r.name || r.key || ''), countries: (r.countries || []).map(c => String(c).toUpperCase()) }))
    .filter(r => r.name);
  const regionOf = new Map();
  regions.forEach(r => r.countries.forEach(c => { if (!regionOf.has(c)) regionOf.set(c, r.name); }));
  const Y0 = Date.UTC(year, 0, 1), Y1 = Date.UTC(year + 1, 0, 1);
  const rcSpell = new Map();   // root-cause key -> Map(spelling -> n), successful agent resolves only
  const all = [];              // every created-in-year ticket (context); `ok` = successful agent resolve
  const excluded = {}; EXCLUSION_RULES.forEach(k => { excluded[k] = 0; });
  // Fixed 'All regions' cards: the whole created-in-year set, never filtered by a tree path.
  // otherReasons = resolved tickets in none of agent / autosim / rule, by why they fell out.
  const summary = { created: 0, resolved: 0, agent: 0, autosim: 0, rule: 0, other: 0, otherReasons: {}, immediateMinutes: IMMEDIATE_RESOLVE_MS / 60000 };
  dedupeTickets(tickets).forEach(t => {
    const cd = toDate(t.cd);
    if (!cd || cd.getTime() < Y0 || cd.getTime() >= Y1) return;
    const id = String(t.ShortId || t.IssueId || '');
    const url = String(t.IssueUrl || '').trim();
    const rcd = t.RootCauseDetails;
    const cc = String(countryOf(t) || '').trim().toUpperCase();
    const country = !cc || cc === 'UNKNOWN' ? 'Unknown' : cc;
    const resolved = RESOLVED_STATUSES.indexOf(t.Status) >= 0;
    const it = issueTypeOf(t);
    const why = agentResolveExclusion(t), ok = why === null;
    if (!ok) excluded[why]++;
    summary.created++;
    if (resolved) {
      summary.resolved++;
      if (ok) summary.agent++;
      else if (isImmediateAutoSimResolve(t)) summary.autosim++;
      else if (isImmediateRuleResolve(t)) summary.rule++;
      else {
        summary.other++;
        // AutoSIM resolves that missed the window / closure codes get their own reason key.
        const r = why === 'botResolver' && AUTOSIM_RESOLVER_RE.test(String(t.ResolvedByIdentity || ''))
          ? (isImmediateAutoResolve(t) ? 'autoSimOtherClosure' : 'autoSimNotImmediate') : why;
        summary.otherReasons[r] = (summary.otherReasons[r] || 0) + 1;
      }
    }
    const rcLabel = rootCauseOf(t.RootCause), rcKey = rcLabel.toLowerCase();
    if (ok) {
      let sp = rcSpell.get(rcKey); if (!sp) rcSpell.set(rcKey, sp = new Map());
      sp.set(rcLabel, (sp.get(rcLabel) || 0) + 1);
    }
    const rd = toDate(t.rd);
    const zipRaw = zipFromRcd(rcd);
    const g = geoOf(country, zipRaw) || {};
    all.push({
      ok, rcLabel,
      id, url: /^https?:\/\//i.test(url) ? url : (id ? ISSUE_URL_BASE + encodeURIComponent(id) : ''),
      title: String(t.Title || '').trim(), cd: cd.getTime(), rd: rd ? rd.getTime() : null,
      status: String(t.Status || '').trim(), resolved,
      region: regionOf.get(country) || UNMAPPED, country,
      state: g.state || zipGeo.UNKNOWN, city: g.city || zipGeo.UNKNOWN,
      sid: sidFromRcd(rcd) || NOT_SPECIFIED, zip: zipRaw || NOT_SPECIFIED,
      issue: it.type, issueSource: it.source,
      rcKey, rc: '', res: resolved ? (String(resolutionLabelOf(t) || '').trim() || NOT_SPECIFIED) : NOT_RESOLVED,
      drv: DRIVER_SHORT.get(driverTypeOf(rcd).key) || 'Others',
      by: resolverName(t.ResolvedByIdentity) || '',
    });
  });
  // Root-cause label = the most frequent spelling of the key (ties: A->Z).
  const rcName = new Map();
  rcSpell.forEach((sp, key) => {
    let best = '', bn = -1;
    sp.forEach((n, s) => { if (n > bn || (n === bn && s < best)) { best = s; bn = n; } });
    rcName.set(key, best);
  });
  all.forEach(rec => {
    rec.rc = rcName.get(rec.rcKey) || rec.rcLabel;
    delete rec.rcKey; delete rec.rcLabel;
  });
  const recs = all.filter(rec => rec.ok);
  // One tree per hierarchy (level order), all from the same records.
  // 1) successful agent resolves only; 2) context: every created ticket on the nodes that exist.
  const buildTree = (fields, rootName) => {
    const root = newNode(rootName);
    recs.forEach(rec => {
      let node = root; bump(node);
      fields.forEach(f => {
        node = child(node, rec[f]); bump(node);
        if (f === 'city' && rec.zip !== NOT_SPECIFIED) (node.z || (node.z = new Set())).add(rec.zip);
      });
    });
    all.forEach(rec => {
      let node = root; bumpContext(node, rec);
      for (const f of fields) {
        node = node.m.get(rec[f]); if (!node) return;
        bumpContext(node, rec);
      }
    });
    return finalize(root, 0);
  };
  const trees = {};
  HIERARCHY_KEYS.forEach(h => { trees[h] = buildTree(HIERARCHIES[h], h === 'driver' ? 'All driver types' : 'All regions'); });
  // 3) Zip -> State / City coverage per ticket country (successful agent resolves only).
  const coverage = {};
  recs.forEach(rec => {
    const c = coverage[rec.country] || (coverage[rec.country] = { tickets: 0, state: 0, city: 0, unknownState: 0, unknownCity: 0 });
    c.tickets++;
    if (rec.state !== zipGeo.UNKNOWN) c.state++; else c.unknownState++;
    if (rec.city !== zipGeo.UNKNOWN) c.city++; else c.unknownCity++;
  });
  recs.forEach(rec => { delete rec.ok; });
  // Newest first (Created desc, then ticket id desc) — the order of every ticket list and export.
  recs.sort((a, b) => (b.cd - a.cd) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const unmapped = recs.filter(r => r.region === UNMAPPED);
  const unmappedCountries = {};
  unmapped.forEach(r => { unmappedCountries[r.country] = (unmappedCountries[r.country] || 0) + 1; });
  return {
    year, generatedAt: now.toISOString(), total: recs.length, created: all.length, excluded, summary,
    regions: regions.map(r => ({ name: r.name, countries: r.countries.slice() })),
    unmapped: { count: unmapped.length, countries: unmappedCountries },
    geo: Object.assign(zipGeo.geoMeta(), { coverage }),
    tree: trees[DEFAULT_HIERARCHY], trees, recs,
  };
}

// ---- Request helpers ----
// ?year= -> integer 2020..(now's UTC year), default 2026. -> { ok, value } | { ok:false, error }
function parseYear(raw, now) {
  if (raw == null || raw === '') return { ok: true, value: 2026 };
  const s = String(raw).trim(), max = (now || new Date()).getUTCFullYear();
  if (!/^\d{4}$/.test(s)) return { ok: false, error: 'year must be a 4-digit year.' };
  const y = Number(s);
  if (y < 2020 || y > Math.max(max, 2026)) return { ok: false, error: 'year must be between 2020 and ' + Math.max(max, 2026) + '.' };
  return { ok: true, value: y };
}
// ?path= -> URL-decoded JSON array of level values (0..9 strings, in LEVELS order).
function parsePath(raw) {
  if (raw == null || raw === '') return { ok: true, value: [] };
  if (typeof raw !== 'string' || raw.length > 2000) return { ok: false, error: 'path is too long.' };
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { return { ok: false, error: 'path must be a JSON array of strings.' }; }
  if (!Array.isArray(arr) || arr.length > LEVELS.length) return { ok: false, error: 'path must be a JSON array of at most ' + LEVELS.length + ' strings.' };
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string' || !arr[i].trim() || arr[i].length > MAX_VALUE_LEN) return { ok: false, error: 'path[' + i + '] must be a non-empty string of at most ' + MAX_VALUE_LEN + ' characters.' };
  }
  return { ok: true, value: arr };
}
// Positive integer query value with a default and a maximum.
function parsePosInt(raw, def, max, name) {
  if (raw == null || raw === '') return { ok: true, value: def };
  const s = String(raw).trim();
  if (!/^\d{1,6}$/.test(s) || Number(s) < 1) return { ok: false, error: name + ' must be a positive whole number.' };
  const n = Number(s);
  if (max && n > max) return { ok: false, error: name + ' must be at most ' + max + '.' };
  return { ok: true, value: n };
}
// Tree node for a path, or null.
function findNode(tree, path) {
  let node = tree;
  for (const k of path) {
    node = (node && node.c || []).find(c => c.k === k) || null;
    if (!node) return null;
  }
  return node;
}
// ?hierarchy= -> 'geo' (default, also when blank) | 'driver'.
function parseHierarchy(raw) {
  if (raw == null || raw === '') return { ok: true, value: DEFAULT_HIERARCHY };
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!Object.prototype.hasOwnProperty.call(HIERARCHIES, s)) return { ok: false, error: 'hierarchy must be one of: ' + HIERARCHY_KEYS.join(', ') + '.' };
  return { ok: true, value: s };
}
// Tree of a hierarchy (default geo).
function treeOf(model, hierarchy) { return (model.trees && model.trees[hierarchy || DEFAULT_HIERARCHY]) || model.tree; }
function matchesPath(rec, path, hierarchy) {
  const fields = fieldsOf(hierarchy);
  for (let i = 0; i < path.length; i++) if (rec[fields[i]] !== path[i]) return false;
  return true;
}
function ticketsAt(model, path, hierarchy) { return path.length ? model.recs.filter(r => matchesPath(r, path, hierarchy)) : model.recs; }
const iso = ms => (ms == null ? null : new Date(ms).toISOString());

// GET /tree payload (no ticket rows).
function treePayload(model, source, hierarchy) {
  const h = hierarchy || DEFAULT_HIERARCHY;
  return {
    year: model.year, generatedAt: model.generatedAt, source: source || null, total: model.total,
    created: model.created, excluded: model.excluded, summary: model.summary, hierarchy: h, levels: levelsOf(h),
    regions: model.regions, unmapped: model.unmapped, geo: model.geo, tree: treeOf(model, h),
  };
}
// GET /tickets payload: one page (Created desc).
function ticketsPage(model, path, page, pageSize, hierarchy) {
  const list = ticketsAt(model, path, hierarchy);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const p = Math.min(page, pages);
  const rows = list.slice((p - 1) * pageSize, p * pageSize).map(r => ({
    id: r.id, url: r.url, title: r.title, created: iso(r.cd), resolved: r.resolved ? iso(r.rd) : null,
    isResolved: r.resolved, status: r.status, state: r.state, city: r.city, zip: r.zip,
  }));
  return { year: model.year, hierarchy: hierarchy || DEFAULT_HIERARCHY, path, total: list.length, page: p, pageSize, pages, rows };
}
// GET /export: the FULL list for a path as CSV (UTF-8 BOM, CRLF, csvCell quoting + formula guard).
const CSV_HEADER = ['Ticket ID', 'Ticket URL', 'Title', 'Created', 'Resolved', 'Status', 'Region', 'Country', 'State', 'City', 'SID', 'Zip',
  'Issue type', 'Issue source', 'Root cause', 'Resolution', 'Driver type', 'Resolved By'];
function fileTag(s) { return String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'; }
function exportCsv(model, path, hierarchy) {
  const h = hierarchy || DEFAULT_HIERARCHY;
  const list = ticketsAt(model, path, h);
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  list.forEach(r => {
    lines.push([
      r.id, r.url, r.title, iso(r.cd), r.resolved ? (iso(r.rd) || '') : '', r.status, r.region, r.country,
      r.state, r.city, r.sid, r.zip, r.issue, r.issueSource, r.rc, r.res, r.drv, r.resolved ? r.by : '',
    ].map(csvCell).join(','));
  });
  const tags = path.length ? path.map(fileTag) : ['All'];
  return {
    filename: 'Incident_Explorer_' + HIERARCHY_TAG[h] + '_' + tags.join('_') + '_' + model.year + '.csv',
    count: list.length,
    csv: '\uFEFF' + lines.join('\r\n') + '\r\n',
  };
}

module.exports = {
  LEVELS, PATH_FIELDS, HIERARCHIES, DEFAULT_HIERARCHY, levelsOf, parseHierarchy, treeOf, NOT_SPECIFIED, NOT_RESOLVED, UNMAPPED, MAX_PAGE_SIZE, CSV_HEADER, EXCLUSION_RULES,
  IMMEDIATE_RESOLVE_MS, rootCauseOf, agentResolveExclusion, isSuccessfulAgentResolve, isImmediateAutoSimResolve, isImmediateRuleResolve, buildExplorer, parseYear, parsePath, parsePosInt, findNode, matchesPath, ticketsAt,
  treePayload, ticketsPage, exportCsv,
};
