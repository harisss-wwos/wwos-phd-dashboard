// Page ZERO ("GLOBAL PHD Page 0 — <year>") — pure classification + aggregation for GET /api/page-zero.
// No DB access here: server.js reads the projected ticket docs and hands them to computePageZero().
// Everything is exported so it can be unit-tested in isolation.
'use strict';
const { issueFromRcd, resolutionFromRcd } = require('./pulse-check');

// ---------------------------------------------------------------------------------------------
// Issue taxonomy: category -> type names.
// KEEP IN SYNC with window.IZ_CATS in ../issue-types-data.js (9 categories, 28 types). Only the
// category and type names are needed here; definitions/colours stay in the front-end file.
// ---------------------------------------------------------------------------------------------
const IZ_CATEGORIES = [
  { category: 'Weapon & Robbery', types: ['Robbery w/ weapon', 'Robbery w/o weapon', 'Attack w/weapon', 'Weapon pointed at driver', 'Armed w/weapon', 'Weapon present w/ no threat', 'Shots fired'] },
  { category: 'Pet', types: ['Attack w/pet', 'Unsecured pet - bite/injury', 'Unsecured pet - evasion injury', 'Unsecured pet - no contact'] },
  { category: 'Physical / Severe Outcome', types: ['Fatality from assault', 'Physical altercation \u2013 No Injury', 'Physical altercation w/ Injury'] },
  { category: 'Threats', types: ['Threat of harm (verbal or written)'] },
  { category: 'Detention / Impeding', types: ['Kidnapping', 'Impeding egress'] },
  { category: 'Sexual', types: ['Sexual assault (physical)', 'Sexual harassment (verbal)', 'Indecent exposure'] },
  { category: 'Abuse, Intimidation & Discrimination', types: ['Name Calling', 'Intimidation', 'Verbal abuse', 'Signage/Paraphernalia'] },
  { category: 'Property', types: ['Vandalism'] },
  { category: 'Out of Scope of PHD', types: ['Accidental injury (no POI)', 'Property / vehicle damage only', 'Suspicious Following'] },
];
const CAT_PET = 'Pet';
const CAT_OOS = 'Out of Scope of PHD';
const SLA_HOURS = 240;   // same create->resolve threshold as /api/resolutions/monthly (SLA_THRESHOLD_HRS)

// Matching key: case-insensitive, whitespace/punctuation-insensitive. Bracketed notes such as the
// hashtag suffix " [#cx-reassurance ]" are dropped first. Only letters, digits and "/" survive, so
// "Attack w/ Pet" == "Attack w/pet", "Driver follow - up" == "Driver Follow-up",
// "Unsecured Animal(CX Pet)" == "Unsecured Animal (CX Pet)". ("w/" vs "w/o" stay distinct.)
function normKey(s) {
  return String(s == null ? '' : s)
    .replace(/\[[^\]]*\]?/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9/]/g, '');
}

const TYPE_INDEX = new Map();   // normKey(type) -> { category, type }
IZ_CATEGORIES.forEach(c => c.types.forEach(t => TYPE_INDEX.set(normKey(t), { category: c.category, type: t })));
const CATEGORY_NAMES = new Set(IZ_CATEGORIES.map(c => c.category));

// Legacy / free-text Issue spellings seen in live 2026 RootCauseDetails that are NOT taxonomy type
// names. Value = a taxonomy type name, or '@<Category>' when only the category is clear (the ticket
// then counts in category-level rows but not in type-level rows). Anything not listed here and not
// a taxonomy type name falls into row 11 "Issue not specified". Edit this table to extend coverage.
const ISSUE_ALIASES = {
  // Pet
  'Pet Incident': '@Pet', 'Pet attack': '@Pet', 'Repeat Pet Incident': '@Pet', 'Dog incident': '@Pet',
  'Unsecured Animal': '@Pet', 'Unsecured Animal (CX Pet)': '@Pet', 'Unsecured Animal (Non-CX Pet)': '@Pet',
  'Dog bite': 'Unsecured pet - bite/injury',
  'Unsecured Animal Attack (CX Pet)': 'Unsecured pet - bite/injury',
  'Unsecured Animal Attack (Non-CX Pet/ Other)': 'Unsecured pet - bite/injury',
  'Unsecured Animal Evasion (CX Pet)': 'Unsecured pet - evasion injury',
  'Unsecured Animal Evasion (Non-CX Pet/ Other)': 'Unsecured pet - evasion injury',
  // Physical / Severe Outcome
  'Attack w/o Weapon': '@Physical / Severe Outcome', 'Physical Altercation': '@Physical / Severe Outcome',
  'Assault': '@Physical / Severe Outcome', 'Physical assault': '@Physical / Severe Outcome',
  'Driver assaulted while making delivery': '@Physical / Severe Outcome',
  'Assault - No Injury': 'Physical altercation \u2013 No Injury', 'Assault w/o injury': 'Physical altercation \u2013 No Injury',
  'Assault no injury': 'Physical altercation \u2013 No Injury', 'Detrimental Behavior - Assault - No Injury': 'Physical altercation \u2013 No Injury',
  'Assault w/ injury': 'Physical altercation w/ Injury', 'Assault - Injury': 'Physical altercation w/ Injury',
  'Detrimental Behavior - Assault - Injury': 'Physical altercation w/ Injury',
  // Weapon & Robbery
  'Attack w/ Weapon': 'Attack w/weapon', 'Assault w/ weapon': 'Attack w/weapon',
  'Threat w/ Weapon': 'Armed w/weapon', 'Threat with weapon': 'Armed w/weapon', 'Weapon Present - Implied Threat': 'Armed w/weapon',
  'Gun brandished': 'Armed w/weapon', 'Weapon display': 'Armed w/weapon', 'Weapon display w/o use': 'Armed w/weapon',
  'Weapon Present': 'Weapon present w/ no threat', 'Weapon present (no threat, 1st incident)': 'Weapon present w/ no threat',
  'Weapon present (no threat': 'Weapon present w/ no threat',
  'Weapon pointed': 'Weapon pointed at driver',
  'Shooting': 'Shots fired', 'Shooting - No Injury': 'Shots fired', 'Detrimental Behavior - Shooting - No Injury': 'Shots fired',
  'Armed robbery': 'Robbery w/ weapon',
  'Robbery': 'Robbery w/o weapon', 'Theft/Robbery': 'Robbery w/o weapon', 'Attempted robbery': 'Robbery w/o weapon',
  // Threats
  'Threat w/o Weapon': 'Threat of harm (verbal or written)', 'Verbal Threat': 'Threat of harm (verbal or written)',
  'Verbal threats': 'Threat of harm (verbal or written)', 'Threat of harm': 'Threat of harm (verbal or written)',
  'Written threat': 'Threat of harm (verbal or written)', 'Threats - Verbal': 'Threat of harm (verbal or written)',
  'Threats verbal': 'Threat of harm (verbal or written)', 'Detrimental Behavior - Threats - Verbal': 'Threat of harm (verbal or written)',
  // Detention / Impeding
  'Impending egress': 'Impeding egress', 'Blocking driveway': 'Impeding egress',
  // Sexual
  'Sexual Harassment': 'Sexual harassment (verbal)', 'Inappropriate Sexual Comments': 'Sexual harassment (verbal)',
  // Abuse, Intimidation & Discrimination
  'Verbal Harassment': 'Verbal abuse', 'Verbal harrasment': 'Verbal abuse', 'Verbal harassement': 'Verbal abuse',
  'Harassment': 'Verbal abuse', 'Written Harassment': 'Verbal abuse', 'Verbal Altercation': 'Verbal abuse',
  'Yelling/Abusive Behavior': 'Verbal abuse', 'Yelling Abusive Behavior': 'Verbal abuse', 'Yelling & abusive behaviour': 'Verbal abuse', 'Abusive Behavior': 'Verbal abuse',
  'Abusive Behavior - Towards AMZN': 'Verbal abuse', 'Detrimental Behavior - Abusive Behavior': 'Verbal abuse',
  'Detrimental Behavior - Abusive Behavior - Towards AMZN': 'Verbal abuse', 'Bullying': 'Verbal abuse', 'Inappropriate notes': 'Verbal abuse',
  'Harassment/Intimidation': 'Intimidation', 'Harrasement Intimidation': 'Intimidation',
  // Discriminatory language aimed at the driver = 'Name Calling' in the taxonomy (row 8). These legacy
  // values ALSO count in row 10 via DISCRIMINATORY_LEGACY_ISSUES below.
  'Discriminatory Harassment': 'Name Calling', 'Inappropriate Racial Comments': 'Name Calling', 'Racist Notes': 'Name Calling',
};
// Legacy Issue values that are discrimination-specific; counted in row 10 alongside 'Signage/Paraphernalia'.
const DISCRIMINATORY_LEGACY_ISSUES = ['Discriminatory Harassment', 'Inappropriate Racial Comments', 'Racist Notes'];

const ALIAS_INDEX = new Map();   // normKey(alias) -> { category, type|null }
Object.keys(ISSUE_ALIASES).forEach(a => {
  const target = ISSUE_ALIASES[a];
  let hit;
  if (target.charAt(0) === '@') {
    const cat = target.slice(1);
    if (!CATEGORY_NAMES.has(cat)) throw new Error('page-zero: unknown alias category ' + cat);
    hit = { category: cat, type: null };
  } else {
    hit = TYPE_INDEX.get(normKey(target));
    if (!hit) throw new Error('page-zero: unknown alias type ' + target);
  }
  ALIAS_INDEX.set(normKey(a), hit);
});
const DISCRIM_KEYS = new Set(DISCRIMINATORY_LEGACY_ISSUES.map(normKey));

// Issue string -> { key, category, type, recognised }. 'Not specified' / unknown -> recognised:false.
function classifyIssue(issue) {
  const key = normKey(issue);
  const hit = key && key !== 'notspecified' ? (TYPE_INDEX.get(key) || ALIAS_INDEX.get(key) || null) : null;
  return hit ? { key, category: hit.category, type: hit.type, recognised: true } : { key, category: null, type: null, recognised: false };
}

// ---------------------------------------------------------------------------------------------
// Issue -> row mapping (rows 2-10). One place: edit here.
//   cats        every type of these categories (incl. category-only aliases)
//   exceptTypes ... except these types
//   types       plus these individual types
//   legacy      plus these exact (normalised) legacy Issue values
// ---------------------------------------------------------------------------------------------
const ISSUE_ROWS = {
  allAssaults: { cats: IZ_CATEGORIES.map(c => c.category).filter(c => c !== CAT_PET && c !== CAT_OOS) },
  dogs:        { cats: [CAT_PET] },
  physical:    { cats: ['Physical / Severe Outcome'], types: ['Attack w/weapon', 'Sexual assault (physical)'] },
  robberies:   { types: ['Robbery w/ weapon', 'Robbery w/o weapon'] },
  weapons:     { cats: ['Weapon & Robbery'], exceptTypes: ['Robbery w/o weapon'] },
  detention:   { cats: ['Detention / Impeding'] },
  verbal:      { cats: ['Threats'], types: ['Name Calling', 'Intimidation', 'Verbal abuse'] },
  sexual:      { cats: ['Sexual'] },
  // Only discrimination-specific type in the taxonomy, plus the legacy discrimination values.
  discrim:     { types: ['Signage/Paraphernalia'], legacy: DISCRIMINATORY_LEGACY_ISSUES },
};
function inIssueRow(rule, cls) {
  if (!cls || !cls.recognised) return false;
  if (rule.cats && rule.cats.indexOf(cls.category) >= 0 && !(rule.exceptTypes && cls.type && rule.exceptTypes.indexOf(cls.type) >= 0)) return true;
  if (rule.types && cls.type && rule.types.indexOf(cls.type) >= 0) return true;
  if (rule.legacy && rule.legacy.some(l => normKey(l) === cls.key)) return true;
  return false;
}
// Row keys (of ISSUE_ROWS) that a classified issue counts in.
function issueRowsOf(cls) { return Object.keys(ISSUE_ROWS).filter(k => inIssueRow(ISSUE_ROWS[k], cls)); }

// ---------------------------------------------------------------------------------------------
// Res (RootCauseDetails "Res:" line) -> mitigation rows 20-32. One place: edit here.
// Names are compared with normKey(), so case, spaces, hyphens, dots and "[#hashtag]" suffixes are
// ignored. A combined value ("Delivery Hint, Customer Reassurance", "Routing/Geopin update") is
// split on , ; & + / "and" "or" and every part that matches counts (once per row per ticket).
// ---------------------------------------------------------------------------------------------
const RES_ROWS = [
  { key: 'resAccountClosure', label: 'Account Closure', names: ['Account Closure', 'Account Closure (Permanent)', 'Customer Account Closure'] },
  { key: 'resAddressDeprio', label: 'Address Deprioritization', names: ['Address Deprioritization', 'Address Deprioritisation', 'Address Deprio', 'Address Depri'] },
  { key: 'resAddressExclusion', label: 'Address Exclusion', names: ['Address Exclusion'] },
  { key: 'resAreaExclusion', label: 'Area Exclusion', names: ['Area Exclusion'] },
  { key: 'resDeliveryHint', label: 'Delivery Hint', names: ['Delivery Hint', 'Delivery Hint Update'] },
  { key: 'resGeopin', label: 'Geopin Update', names: ['Geopin Update', 'Geopin', 'Geo Pin Update'] },
  { key: 'resParcelBox', label: 'Parcel Box Install', names: ['Parcel Box Install', 'Parcel Box Installation', 'Parcel Box'] },
  { key: 'resRouting', label: 'Routing Update', names: ['Routing Update', 'Geo-Routing Update', 'Routing'] },
  { key: 'resGeofence', label: 'GeoFence Update', names: ['GeoFence Update', 'GeoFence'] },
  { key: 'resOrderBlock', label: 'Physical Order Block', names: ['Physical Order Block'] },
  { key: 'resReassurance', label: 'Customer Reassurance', names: ['Customer Reassurance', 'Customer Reassurances', 'Customer Reassurance (Verbal)', 'Customer Reassurance (Neutral)', 'CX Reassurance', 'CX Reassurances', 'CX reassurance provided'] },
  { key: 'resDriverFollowup', label: 'Driver Follow-up', names: ['Driver Follow-up', 'Driver Followup', 'Driver follow up', 'Driver Follow-ups'] },
];
const RES_INSUFFICIENT = { key: 'resInsufficient', label: 'Insufficient information', names: ['Insufficient Information', 'Insufficient Info', 'Insufficient infromation'] };
const RES_INDEX = new Map();   // normKey(name) -> row key
RES_ROWS.concat([RES_INSUFFICIENT]).forEach(r => r.names.forEach(n => RES_INDEX.set(normKey(n), r.key)));
const MITIGATION_KEYS = new Set(RES_ROWS.map(r => r.key));
const RES_SPLIT_RE = /\s*(?:[,;&+/]|\band\b|\bor\b)\s*/i;

// Res string -> array of row keys (deduped, RES_ROWS order then insufficient). [] when nothing maps.
function resolutionRowsOf(res) {
  const raw = String(res == null ? '' : res).replace(/\[[^\]]*\]?/g, ' ');
  const whole = normKey(raw);
  if (!whole || whole === 'notspecified') return [];
  const out = new Set();
  if (RES_INDEX.has(whole)) out.add(RES_INDEX.get(whole));
  else raw.split(RES_SPLIT_RE).forEach(p => { const k = normKey(p); if (k && RES_INDEX.has(k)) out.add(RES_INDEX.get(k)); });
  return RES_ROWS.concat([RES_INSUFFICIENT]).map(r => r.key).filter(k => out.has(k));
}

// Repeat count: same rule as hiCountOf() in server.js ("Cnt: <n>", else "Historical Incident: <n>").
const HI_CNT_RE = /\bCnt\s*[:\s]\s*(\d+)/i;
const HI_HIST_RE = /Historical Incident\s*:?\s*(\d+)/i;
function cntOf(rcd) {
  const s = String(rcd || '');
  const m = s.match(HI_CNT_RE); if (m) return parseInt(m[1], 10) || 0;
  const m2 = s.match(HI_HIST_RE); if (m2) return parseInt(m2[1], 10) || 0;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Row definitions (display order). kind: count | pct | days.
//   count -> f   = accumulator field
//   pct   -> num/den fields, value = num/den*100 (1 dp), null when den is 0
//   days  -> num (sum of days) / den (ticket count), 1 dp
// Quarter / YTD columns sum the underlying fields first, then derive (never average a rate).
// ---------------------------------------------------------------------------------------------
const S_CORE = 'CORE INCIDENT METRICS', S_PERF = 'PERFORMANCE METRICS', S_MIT = 'MITIGATION ACTIONS DEPLOYED', S_SUP = 'SUPPLEMENTAL METRICS';
const ROWS = [
  { n: 1, key: 'created', label: 'PHD Incidents', section: S_CORE, kind: 'count', f: 'created' },
  { n: 2, key: 'allAssaults', label: 'All Assaults', section: S_CORE, kind: 'count', f: 'allAssaults' },
  { n: 3, key: 'dogs', label: 'All Dog Incidents', section: S_CORE, kind: 'count', f: 'dogs' },
  { n: 4, key: 'physical', label: 'All Physical Assaults', section: S_CORE, kind: 'count', f: 'physical' },
  { n: 5, key: 'robberies', label: 'Robberies', section: S_CORE, kind: 'count', f: 'robberies' },
  { n: 6, key: 'weapons', label: 'Weapon Incidents', section: S_CORE, kind: 'count', f: 'weapons' },
  { n: 7, key: 'detention', label: 'Kidnapping/Impeding Egress', section: S_CORE, kind: 'count', f: 'detention' },
  { n: 8, key: 'verbal', label: 'Verbal Threats/Harassment', section: S_CORE, kind: 'count', f: 'verbal' },
  { n: 9, key: 'sexual', label: 'Sexual Related Incidents', section: S_CORE, kind: 'count', f: 'sexual' },
  { n: 10, key: 'discrim', label: 'Discriminatory Harassment', section: S_CORE, kind: 'count', f: 'discrim' },
  { n: 11, key: 'notSpecified', label: 'Issue not specified', section: S_CORE, kind: 'count', f: 'notSpecified' },
  { n: 12, key: 'repeatPet', label: 'Repeat pet incidents', section: S_CORE, kind: 'count', f: 'repeatPet' },
  { n: 13, key: 'repeatNonPet', label: 'Repeat non-pet incidents', section: S_CORE, kind: 'count', f: 'repeatNonPet' },
  { n: 14, key: 'repeatPetRate', label: 'Repeat pet rate', section: S_CORE, kind: 'pct', num: 'repeatPet', den: 'dogs' },
  { n: 15, key: 'repeatNonPetRate', label: 'Repeat non-pet rate', section: S_CORE, kind: 'pct', num: 'repeatNonPet', den: 'allAssaults' },
  { n: 16, key: 'resolved', label: 'PHD Performance (Resolved)', section: S_PERF, kind: 'count', f: 'resolved' },
  { n: 17, key: 'avgAge', label: 'Average Ticket Age | Resolved tickets', section: S_PERF, kind: 'days', num: 'ageDaysSum', den: 'ageN' },
  { n: 18, key: 'resolutionPct', label: 'Incident Resolution (% of resolved)', section: S_PERF, kind: 'pct', num: 'successful', den: 'resolved' },
  { n: 19, key: 'mitigation', label: 'Mitigation implemented', section: S_MIT, kind: 'count', f: 'mitigation' },
].concat(RES_ROWS.map((r, i) => ({ n: 20 + i, key: r.key, label: r.label, section: S_MIT, kind: 'count', f: r.key })))
  .concat([
    { n: 32, key: RES_INSUFFICIENT.key, label: RES_INSUFFICIENT.label, section: S_MIT, kind: 'count', f: RES_INSUFFICIENT.key },
    { n: 33, key: 'petSla', label: 'PHD Dogs SLA Compliance', section: S_SUP, kind: 'pct', num: 'petSlaWithin', den: 'petSlaN' },
    { n: 34, key: 'assaultSla', label: 'PHD Assaults SLA Compliance', section: S_SUP, kind: 'pct', num: 'asSlaWithin', den: 'asSlaN' },
  ]);

const FIELDS = ['created', 'notSpecified', 'repeatPet', 'repeatNonPet', 'resolved', 'ageDaysSum', 'ageN', 'successful', 'mitigation',
  'petSlaN', 'petSlaWithin', 'asSlaN', 'asSlaWithin']
  .concat(Object.keys(ISSUE_ROWS), RES_ROWS.map(r => r.key), [RES_INSUFFICIENT.key]);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RESOLVED_STATUSES = ['Resolved', 'Closed'];   // same as /api/resolutions/monthly

const r1 = x => Math.round(x * 10) / 10;
const pctOf = (num, den) => (den > 0 ? r1(num / den * 100) : null);
function toDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Months of `year` that have started by `now` (UTC): 0..12.
function elapsedMonths(year, now) {
  const y = now.getUTCFullYear();
  return year < y ? 12 : year > y ? 0 : now.getUTCMonth() + 1;
}

// Column layout: 12 month keys, Q1..Q4, YTD -> month indexes (0-based) each column covers.
function columnsFor(year, now) {
  const last = elapsedMonths(year, now), yy = String(year).slice(-2);
  const months = MON.map((m, i) => ({ key: year + '-' + String(i + 1).padStart(2, '0'), label: m + "'" + yy, elapsed: i < last }));
  const cols = [];
  months.forEach((m, i) => cols.push({ key: m.key, idx: m.elapsed ? [i] : [] }));
  for (let q = 0; q < 4; q++) cols.push({ key: 'Q' + (q + 1), idx: [0, 1, 2].map(k => q * 3 + k).filter(i => i < last) });
  cols.push({ key: 'YTD', idx: Array.from({ length: last }, (_, i) => i) });
  return { months, cols };
}

// Derive one row's value from a summed bucket.
function rowValue(row, b) {
  if (row.kind === 'count') return b[row.f];
  if (row.kind === 'pct') return pctOf(b[row.num], b[row.den]);
  return b[row.den] > 0 ? r1(b[row.num] / b[row.den]) : null;   // days
}

// ---------------------------------------------------------------------------------------------
// INDICATIVE KRI (stand-in until a real KRI source exists; approved by the user).
//   Data      tickets CREATED (CreateDate, UTC month), one per ShortId. Site ID = RootCauseDetails
//             "SID:" value (upper-case, must match /^[A-Z0-9]{3,6}$/); Zipcode = "Zip:" value
//             (whitespace collapsed, upper-case). Blank / N/A / '-' are ignored.
//   Windows   Current = current UTC month to date; Last Month = previous UTC month; 2 Mo Ago = the
//             month before that. A window outside `year` is null ('—').
//   Score     KRI(month, entity) = round2(100 * incidents(entity, month) / max incidents of any
//             entity that month) -> the busiest site/zip of the month scores 100; 0 incidents -> 0.
//   Ranked    entities with >= KRI_MIN_INCIDENTS incidents in the Current month; top KRI_TOP by
//             Current KRI desc, then Current incidents desc, then id A->Z.
//   Changes   MoM = Current - Last; MoM % = MoM / Last * 100. QoQ = Current - 2 Mo Ago (as in the
//             user's sheet); QoQ % = QoQ / 2 Mo Ago * 100. % is null when the base is 0 / null.
//   Country   an entity's most frequent ticket country in the year (ties: known code first, A->Z).
// ---------------------------------------------------------------------------------------------
const KRI_MIN_INCIDENTS = 3;
const KRI_TOP = 5;
// KRI Level bands (sites only), checked top-down: first band with score >= min wins.
const KRI_LEVELS = [
  { min: 80, level: 'Critical' },
  { min: 60, level: 'Very High' },
  { min: 40, level: 'High' },
  { min: 20, level: 'Medium' },
  { min: -Infinity, level: 'Low' },
];
function kriLevelOf(score) {
  if (score == null || !isFinite(score)) return null;
  for (const b of KRI_LEVELS) if (score >= b.min) return b.level;
  return 'Low';
}
// Same "KEY: value up to newline or next known KEY:" approach as issueFromRcd / resolutionFromRcd
// in pulse-check.js (KEEP IN SYNC with RCD_NEXT_KEYS there; Issue added so a one-line blob that
// starts "SID: X Issue: Y" also stops). Markdown '**' is stripped first.
const KRI_NEXT_KEYS = 'I?ssue(?:\\s*Type)?|SID|Station\\s*ID|TID|Transporter\\s*ID|Driv|Driver\\s*Type|Date|Incident\\s*Date|TBA|Tracking\\s*ID|Cnt|Historical\\s*Incident|Zip|CID|AID|UPID|Res|Resolution|Tag';
const rcdKeyRe = key => new RegExp('(?:^|\\s)' + key + '[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + KRI_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
const RCD_SID_RE = rcdKeyRe('SID');
const RCD_ZIP_RE = rcdKeyRe('Zip');
const PLACEHOLDER_RE = /^(n\/?a|none|null|unknown|-+|\u2014)$/i;
function rcdValue(rcd, re) {
  const m = String(rcd == null ? '' : rcd).replace(/\*\*/g, '').match(re);
  const v = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return !v || PLACEHOLDER_RE.test(v) ? '' : v;
}
// Site ID from RootCauseDetails, or '' when absent / placeholder / not 3-6 letters+digits.
function sidFromRcd(rcd) {
  const v = rcdValue(rcd, RCD_SID_RE).toUpperCase();
  return /^[A-Z0-9]{3,6}$/.test(v) ? v : '';
}
// Zipcode from RootCauseDetails, or '' when absent / placeholder.
function zipFromRcd(rcd) { return rcdValue(rcd, RCD_ZIP_RE).toUpperCase(); }

const r2 = x => Math.round(x * 100) / 100;
// Window month (0-based index in `year`) k months before now's UTC month; null if outside `year`.
function kriWindow(year, now, k) {
  const abs = now.getUTCFullYear() * 12 + now.getUTCMonth() - k;
  const y = Math.floor(abs / 12), m = abs - y * 12;
  if (y !== year) return null;
  return { idx: m, key: y + '-' + String(m + 1).padStart(2, '0'), label: MON[m] + ' ' + y, short: MON[m], toDate: k === 0 };
}
// Most frequent country in a Map(country -> n); ties: a known code beats 'Unknown', then A->Z.
function topCountry(cm) {
  let best = 'Unknown', bn = -1;
  (cm ? Array.from(cm.entries()) : []).forEach(([c, n]) => {
    if (n > bn || (n === bn && ((best === 'Unknown' && c !== 'Unknown') || (c !== 'Unknown' && c < best)))) { best = c; bn = n; }
  });
  return best;
}
// perMonth: 12 Maps (entity -> incidents); countries: Map(entity -> Map(country -> n)).
function rankKri(perMonth, countries, win, withLevel) {
  const cur = win.current;
  if (!cur) return [];
  const maxOf = w => { if (!w) return 0; let mx = 0; perMonth[w.idx].forEach(n => { if (n > mx) mx = n; }); return mx; };
  const mx = { current: maxOf(win.current), last: maxOf(win.last), prev2: maxOf(win.prev2) };
  const score = (w, key, id) => {
    if (!w) return null;
    const n = perMonth[w.idx].get(id) || 0;
    return mx[key] > 0 ? r2(100 * n / mx[key]) : 0;
  };
  const list = [];
  perMonth[cur.idx].forEach((n, id) => {
    if (n < KRI_MIN_INCIDENTS) return;
    const current = score(win.current, 'current', id), last = score(win.last, 'last', id), prev2 = score(win.prev2, 'prev2', id);
    const mom = last == null ? null : r2(current - last);
    const qoq = prev2 == null ? null : r2(current - prev2);
    const e = { rank: 0, id, country: topCountry(countries.get(id)) };
    if (withLevel) e.level = kriLevelOf(current);
    Object.assign(e, {
      current, last, prev2, currentCount: n,
      mom, momPct: mom != null && last > 0 ? r1(mom / last * 100) : null,
      qoq, qoqPct: qoq != null && prev2 > 0 ? r1(qoq / prev2 * 100) : null,
    });
    list.push(e);
  });
  list.sort((a, b) => b.current - a.current || b.currentCount - a.currentCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return list.slice(0, KRI_TOP).map((e, i) => Object.assign(e, { rank: i + 1 }));
}

// tickets: [{ ShortId|IssueId, Status, ClosureCode, RootCauseDetails, Country, Title, cd: Date|string, rd: Date|string }]
// opts: { year, now, countryOf(ticket) -> code|'Unknown' } (server.js passes slaCountryOf).
// Returns { year, generatedAt, months, rows, kri }. Future months / fully-future quarters are null.
function computePageZero(tickets, opts) {
  const o = opts || {};
  const year = o.year || 2026, now = o.now || new Date();
  const countryOf = typeof o.countryOf === 'function' ? o.countryOf : (() => 'Unknown');
  const sitesPM = Array.from({ length: 12 }, () => new Map()), zipsPM = Array.from({ length: 12 }, () => new Map());
  const siteCty = new Map(), zipCty = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const bumpCty = (m, id, c) => { let cm = m.get(id); if (!cm) { cm = new Map(); m.set(id, cm); } bump(cm, c); };
  const Y0 = Date.UTC(year, 0, 1), Y1 = Date.UTC(year + 1, 0, 1);
  const acc = Array.from({ length: 12 }, () => { const a = {}; FIELDS.forEach(f => { a[f] = 0; }); return a; });
  const seen = new Set();
  (tickets || []).forEach(t => {
    // Cross-quarter dedupe: one count per ShortId (first doc wins), as /api/issue-types-report does.
    const sid = String(t.ShortId || t.IssueId || '');
    if (sid) { if (seen.has(sid)) return; seen.add(sid); }
    const cd = toDate(t.cd), rd = toDate(t.rd);
    const cls = classifyIssue(issueFromRcd(t.RootCauseDetails));
    const rows = issueRowsOf(cls);
    const inAssault = rows.indexOf('allAssaults') >= 0, isPet = rows.indexOf('dogs') >= 0;
    if (cd && cd.getTime() >= Y0 && cd.getTime() < Y1) {
      const a = acc[cd.getUTCMonth()];
      a.created++;
      rows.forEach(k => { a[k]++; });
      if (!cls.recognised) a.notSpecified++;
      if (cntOf(t.RootCauseDetails) > 0) {
        if (isPet) a.repeatPet++;
        else if (inAssault) a.repeatNonPet++;
      }
      const site = sidFromRcd(t.RootCauseDetails), zip = zipFromRcd(t.RootCauseDetails);
      if (site || zip) {
        const cty = countryOf(t) || 'Unknown';
        if (site) { bump(sitesPM[cd.getUTCMonth()], site); bumpCty(siteCty, site, cty); }
        if (zip) { bump(zipsPM[cd.getUTCMonth()], zip); bumpCty(zipCty, zip, cty); }
      }
    }
    if (rd && rd.getTime() >= Y0 && rd.getTime() < Y1 && RESOLVED_STATUSES.indexOf(t.Status) >= 0) {
      const a = acc[rd.getUTCMonth()];
      a.resolved++;
      if (String(t.ClosureCode || '').trim().toLowerCase() === 'successful') a.successful++;
      const hrs = cd ? (rd.getTime() - cd.getTime()) / 3600000 : null;
      if (hrs != null) { a.ageDaysSum += hrs / 24; a.ageN++; }
      const resKeys = resolutionRowsOf(resolutionFromRcd(t.RootCauseDetails));
      resKeys.forEach(k => { a[k]++; });
      if (resKeys.some(k => MITIGATION_KEYS.has(k))) a.mitigation++;
      if (hrs != null) {
        if (isPet) { a.petSlaN++; if (hrs <= SLA_HOURS) a.petSlaWithin++; }
        if (inAssault) { a.asSlaN++; if (hrs <= SLA_HOURS) a.asSlaWithin++; }
      }
    }
  });
  const { months, cols } = columnsFor(year, now);
  const sums = {};
  cols.forEach(c => {
    if (!c.idx.length) { sums[c.key] = null; return; }
    const b = {}; FIELDS.forEach(f => { b[f] = c.idx.reduce((s, i) => s + acc[i][f], 0); });
    sums[c.key] = b;
  });
  const rowsOut = ROWS.map(row => {
    const out = { n: row.n, key: row.key, label: row.label, section: row.section, kind: row.kind, values: {} };
    if (row.kind !== 'count') { out.num = {}; out.den = {}; }
    cols.forEach(c => {
      const b = sums[c.key];
      out.values[c.key] = b ? rowValue(row, b) : null;
      if (row.kind !== 'count') {
        out.num[c.key] = b ? (row.kind === 'days' ? r1(b[row.num]) : b[row.num]) : null;
        out.den[c.key] = b ? b[row.den] : null;
      }
    });
    return out;
  });
  const win = { current: kriWindow(year, now, 0), last: kriWindow(year, now, 1), prev2: kriWindow(year, now, 2) };
  const winOut = w => (w ? { key: w.key, label: w.label, short: w.short, toDate: w.toDate } : null);
  const kri = {
    windows: { current: winOut(win.current), last: winOut(win.last), prev2: winOut(win.prev2) },
    minIncidents: KRI_MIN_INCIDENTS,
    sites: rankKri(sitesPM, siteCty, win, true),
    zips: rankKri(zipsPM, zipCty, win, false),
  };
  return { year, generatedAt: now.toISOString(), months, rows: rowsOut, kri };
}

module.exports = {
  IZ_CATEGORIES, ISSUE_ALIASES, DISCRIMINATORY_LEGACY_ISSUES, ISSUE_ROWS, RES_ROWS, RES_INSUFFICIENT, ROWS, SLA_HOURS,
  KRI_MIN_INCIDENTS, KRI_TOP, KRI_LEVELS,
  normKey, classifyIssue, issueRowsOf, resolutionRowsOf, cntOf, columnsFor, elapsedMonths, computePageZero,
  sidFromRcd, zipFromRcd, kriLevelOf, kriWindow, topCountry,
};
