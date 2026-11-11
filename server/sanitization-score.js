// Sanitization scores — pure scoring for GET /api/sanitization-score (ticket-sanitization.html,
// owner-only section). No DB I/O: server.js loads the Resolved / Closed ticket_docs of the chosen
// quarter(s), the issue-type list (issue-types-data.js, the same source as issue-types.html, via
// errors-in-resolved.js) and the PHD resolution names (phd_resolutions, as phd-resolutions.html),
// then calls buildScoreReport().
// Every ticket scores 0..11 (MAX_SCORE), one point per criterion (CRITERIA, in this order):
//   SIM Title (3)          country  known country code at the start (incident-log-editor.js ilTicketCountry
//                                   codes, any case, or an upper-case ISO 3166-1 alpha-2 code)
//                          severity Severity N / Sev N / Sev-N / Sev#N / SevN / Severity level N / Severity - N (N 1-5)
//                          type     the title contains a valid issue type (normalised, word-bounded)
//   Root Cause Details (7) issue    Issue: = a valid issue type (normalised exact match)
//                          sid      SID: alphanumeric, >= 4 characters, not a placeholder
//                          driv     Driv: exactly 'DSP DA', 'Flex DP' or 'Hub DA' (trimmed, case-sensitive)
//                          date     Date: a real calendar date with day, month and year (common formats)
//                          cnt      Cnt: numeric and < 10
//                          zip      Zip: found in the offline GeoNames index (zip-geo.js) or a postal-code pattern
//                          res      Res: = a PHD resolution (normalised exact match)
//   ClosureCode (1)        closure  ClosureCode (trimmed, any case) is Immediately Resolved, Successful or
//                                   Duplicate; anything else (blank too) fails. The check value shows
//                                   '<current> → <expected>': Automatically Closed -> Immediately Resolved,
//                                   every other code (and blank) -> Successful (the sanitization checklist).
// "Normalised" = lower-case, every run of non-alphanumerics -> one space, trimmed (so 'Verbal abuse'
// == 'Verbal Abuse' and 'w/ weapon' == 'w/weapon'). RootCauseDetails fields reuse the Pulse Check
// line regexes (pulse-check.js RCD_ISSUE_RE / RCD_RESOLUTION_RE / RCD_NEXT_KEYS / rcdPlain).
// Tickets whose Cnt: value is a number greater than 0 are EXCLUDED (counted, never scored or listed).
'use strict';
const { RCD_ISSUE_RE, RCD_RESOLUTION_RE, RCD_NEXT_KEYS, rcdPlain } = require('./pulse-check');
let zipGeo = null;
try { zipGeo = require('./zip-geo'); } catch (e) { zipGeo = null; }   // pattern-only when the index is unavailable

const ISSUE_URL_BASE = 'https://t.corp.amazon.com/issues/';
const OWNER = 'harisss';
function isOwner(username) { return String(username == null ? '' : username).trim().toLowerCase() === OWNER; }

const CRITERIA = [
  { key: 'country', group: 'title', label: 'Valid country code', chip: 'Title: no country code' },
  { key: 'severity', group: 'title', label: 'Severity present', chip: 'Title: no severity' },
  { key: 'type', group: 'title', label: 'Valid issue type', chip: 'Title: no issue type' },
  { key: 'issue', group: 'rcd', label: 'Issue: valid issue type', chip: 'RCD: Issue' },
  { key: 'sid', group: 'rcd', label: 'SID: valid station', chip: 'RCD: SID' },
  { key: 'driv', group: 'rcd', label: 'Driv: valid driver type', chip: 'RCD: Driv' },
  { key: 'date', group: 'rcd', label: 'Date: valid date', chip: 'RCD: Date' },
  { key: 'cnt', group: 'rcd', label: 'Cnt: numeric under 10, or N/A', chip: 'RCD: Cnt' },
  { key: 'zip', group: 'rcd', label: 'Zip: valid postal code', chip: 'RCD: Zip' },
  { key: 'res', group: 'rcd', label: 'Res: PHD resolution', chip: 'RCD: Res' },
  { key: 'closure', group: 'closure', label: 'ClosureCode is Immediately Resolved, Successful or Duplicate', chip: 'ClosureCode: not allowed' },
];
const MAX_SCORE = CRITERIA.length;
const VALUE_MAX = 120;

function str(v) { return v == null ? '' : String(v); }
function norm(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function clip(s) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX - 1) + '\u2026' : s; }

// ---- Country code (title) ----
// Same codes and title regex as incident-log-editor.js IL_COUNTRY_CODES / ilTicketCountry (title part).
const IL_COUNTRY_CODES = new Set(['US', 'UK', 'CA', 'IN', 'AU', 'MX', 'JP', 'DE', 'IT', 'FR', 'EG', 'ES', 'SA', 'BR', 'NL', 'ZA', 'PT', 'UAE', 'IE', 'SG', 'TR', 'PL', 'SE', 'BE', 'AT', 'CH', 'DK', 'NO', 'FI', 'GR', 'CZ', 'GB', 'NZ', 'AE']);
const ISO_ALPHA2 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
const TITLE_CC_RE = /^\s*[(\[]?\s*([A-Za-z]{2,3})\s*[)\]]?(?=[\s:\-\u2013\u2014|,.)\]]|$)/;
// -> the code (upper-case) or ''. ISO codes only in upper case, so a leading word like 'Re' or 'No' never counts.
function titleCountry(title) {
  const m = str(title).match(TITLE_CC_RE);
  if (!m) return '';
  const up = m[1].toUpperCase();
  if (IL_COUNTRY_CODES.has(up)) return up;
  if (m[1] === up && up.length === 2 && ISO_ALPHA2.has(up)) return up;
  return '';
}

// ---- Severity (title) ----
// Sev 3, Sev3, Sev-3, Sev#3, Sev #3, Sev: 3, Severity 3, Severity - 3, Severity level 3, Severity: Level #3 ...
const SEV_RE = /\bsev(?:erity)?\s*[:#\-\u2013\u2014=]?\s*(?:(?:level|lvl)\s*[:#\-\u2013\u2014=]?\s*)?#?\s*([1-5])(?![\d.])/i;
function titleSeverity(title) { const m = str(title).match(SEV_RE); return m ? m[0].replace(/\s+/g, ' ').trim() : ''; }

// ---- Lists (issue types / resolutions): prepared once per report ----
function prepList(names) {
  const seen = new Set(), out = [];
  (Array.isArray(names) ? names : []).forEach(n => {
    const name = str(n).trim(), key = norm(name);
    if (!key || seen.has(key)) return;
    seen.add(key); out.push({ name, key });
  });
  return out.sort((a, b) => b.key.length - a.key.length);   // longest first: a longer type wins inside a title
}
function findInText(text, list) {
  const hay = ' ' + norm(text) + ' ';
  for (const v of list) if (hay.indexOf(' ' + v.key + ' ') >= 0) return v.name;
  return '';
}
function matchExact(value, list) {
  const key = norm(value);
  if (!key) return '';
  for (const v of list) if (v.key === key) return v.name;
  return '';
}

// ---- RootCauseDetails fields ----
function fieldRe(keys) {
  return new RegExp('(?:^|\\s)(?:' + keys + ')[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
}
const RCD_RE = {
  issue: RCD_ISSUE_RE,
  sid: fieldRe('SID|Station\\s*ID'),
  driv: fieldRe('Driv|Driver\\s*Type'),
  date: fieldRe('Incident\\s*Date|Date\\s*of\\s*Incident|Date'),
  cnt: fieldRe('Cnt'),
  zip: fieldRe('Zip'),
  res: RCD_RESOLUTION_RE,
};
// -> trimmed value, or null when the line is absent.
function rcdValue(plain, key) {
  const m = plain.match(RCD_RE[key]);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}
const PLACEHOLDER_RE = /^(?:n\/?a|na|none|null|nil|unknown|unk|tbd|tba|not\s+applicable|not\s+available|-+|\u2013|\u2014|\.+|\?+|x+|0+)$/i;
function isPlaceholder(v) { return !str(v).trim() || PLACEHOLDER_RE.test(str(v).trim()); }

// SID: alphanumeric, >= 4 characters, not a placeholder.
function validSid(v) { return !isPlaceholder(v) && /^[A-Za-z0-9]{4,}$/.test(str(v).trim()); }

const DRIVER_TYPES = ['DSP DA', 'Flex DP', 'Hub DA'];
function validDriv(v) { return DRIVER_TYPES.indexOf(str(v).trim()) >= 0; }

// Cnt: leading number (same reading as page-zero cntOf / errors-in-resolved HI_CNT_RE) or NaN.
function cntNumber(v) {
  const m = str(v).trim().match(/^(\d+(?:\.\d+)?)(?![\d.])/);
  return m ? Number(m[1]) : NaN;
}

// ---- Date: day, month and year in a common format; must be a real calendar date. ----
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const ORD = '(?:st|nd|rd|th)?';
const DATE_RES = [
  { re: /(?:^|[^\d])(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/, f: m => [+m[1], +m[2], +m[3]] },                    // YYYY-MM-DD
  { re: /(?:^|[^\d])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/, f: m => mdy(+m[1], +m[2], m[3]) },              // MM/DD/YY(YY) or DD/MM/YYYY
  { re: new RegExp('(?:^|[^a-z\\d])(\\d{1,2})' + ORD + '[\\s\\-/.,]*(?:of\\s+)?' + MON + '[\\s\\-/.,]*(\\d{4}|\\d{2})(?!\\d)', 'i'), f: m => [yr(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]] },   // 29-Oct-2026 / 29 October 2026
  { re: new RegExp('(?:^|[^a-z])' + MON + '[\\s\\-/.,]*(\\d{1,2})' + ORD + '(?!\\d)[\\s\\-/.,]+(\\d{4}|\\d{2})(?!\\d)', 'i'), f: m => [yr(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]] },  // Oct 29, 2026
  { re: /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?!\d)/, f: m => [+m[1], +m[2], +m[3]] },                                   // YYYYMMDD
];
function yr(y) { y = str(y); return y.length === 2 ? 2000 + Number(y) : Number(y); }
// US order first; when the first number cannot be a month (> 12), read it as DD/MM.
function mdy(a, b, y) { return a > 12 && b <= 12 ? [yr(y), b, a] : [yr(y), a, b]; }
function realDate(y, mo, d) {
  if (!(y >= 1900 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
// -> 'YYYY-MM-DD' or ''.
function parseDate(v) {
  const s = str(v);
  if (!s.trim()) return '';
  for (const d of DATE_RES) {
    const m = s.match(d.re);
    if (!m) continue;
    const [y, mo, day] = d.f(m);
    if (realDate(y, mo, day)) return y + '-' + String(mo).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  return '';
}

// ---- Zip: GeoNames index first (zip-geo.js), postal-code patterns as the fallback. ----
const ZIP_PATTERNS = [
  /^\d{5}(?:[- ]?\d{4})?$/,                          // US 5 / 5-4
  /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/i,                   // CA A1A 1A1
  /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,           // UK
  /^(?=[A-Z0-9 -]*\d)[A-Z0-9](?:[A-Z0-9 -]{1,8})[A-Z0-9]$/i,   // generic 3-10 alphanumeric with a digit
];
// -> 'geo' | 'pattern' | ''.
function zipCheck(v, country) {
  const s = str(v).trim();
  if (isPlaceholder(s) || /^[0\s-]+$/.test(s)) return '';
  if (zipGeo && typeof zipGeo.geoOf === 'function') {
    const tries = country ? [country] : [];
    if (tries.indexOf('US') < 0) tries.push('US');
    for (const cc of tries) {
      const g = zipGeo.geoOf(cc, s);
      if (g && (g.state !== zipGeo.UNKNOWN || g.city !== zipGeo.UNKNOWN)) return 'geo';
    }
  }
  return ZIP_PATTERNS.some(re => re.test(s)) ? 'pattern' : '';
}

// ---- ClosureCode ----
// Allowed codes (compared trimmed, case-insensitive, inner whitespace collapsed); every other code
// needs changing in SIM: Automatically Closed -> Immediately Resolved, the rest (blank too) -> Successful.
const CLOSURE_ALLOWED = ['Immediately Resolved', 'Successful', 'Duplicate'];
const closureKey = s => str(s).trim().replace(/\s+/g, ' ').toLowerCase();
function closureExpected(code) { return closureKey(code) === 'automatically closed' ? 'Immediately Resolved' : 'Successful'; }
// -> [pass 0|1, value]: the code when allowed, else '<code or (blank)> → <expected>'.
function closureCheck(code) {
  const c = str(code).trim().replace(/\s+/g, ' ');
  if (CLOSURE_ALLOWED.some(a => a.toLowerCase() === c.toLowerCase())) return [1, clip(c)];
  return [0, clip((c || '(blank)') + ' \u2192 ' + closureExpected(c))];
}

// ---- Required checks per ticket: the closure-code rule (owner rule A) ----
// Allowed SIM closure codes: Successful, Immediately Resolved, Duplicate; anything else is a DEFECT.
// The raw 0..11 score (and the closure check above) is kept as is for the Sanitization scores page;
// this rule decides what a ticket must pass to be CLEARED (tracker) / perfect (Errors in Resolved):
//   Duplicate            -> grp 'duplicate'    no checks (cleared).
//   Immediately Resolved -> allowed only when the SIM Title's issue type (titleIssue: an exact,
//                           normalised match to the Issue Types list) is in the 'Out of Scope of PHD'
//                           category, or in the 'Pet' category except 'Attack w/pet' with title
//                           severity 3, 4 or 5 (irEligibility). Eligible -> grp 'immediate': only the
//                           3 SIM Title checks (RCD content is allowed, not checked). Not eligible ->
//                           grp 'ir-not-eligible': a defect + the 11 checks of Successful (ClosureCode
//                           fails until it is Successful).
//   Successful           -> grp 'successful'   all 11 (ClosureCode passes).
//   anything else, blank -> grp 'not-allowed'  defect 'Closure code <code> not allowed: ...' + the checks
//                           of the code it should become: the 3 title checks when the title is
//                           Immediately Resolved eligible, else the 11 checks of Successful.
// In the required set the 'closure' check passes only when the SIM code equals the target code.
// Pet detection is by the TITLE's issue type (category 'Pet'), not by a word rule.
const TITLE_KEYS = Object.freeze(['country', 'severity', 'type']);
const ALL_KEYS = Object.freeze(CRITERIA.map(c => c.key));
const CODE_SUCCESSFUL = 'Successful', CODE_IR = 'Immediately Resolved', CODE_DUP = 'Duplicate';
const CAT_OOS = 'out of scope of phd', CAT_PET = 'pet', TYPE_ATTACK_PET = 'attack w pet';
// Rule groups (the defect kinds the tracker / Errors in Resolved report on).
const RULE_GROUPS = Object.freeze(['duplicate', 'immediate', 'successful', 'ir-not-eligible', 'not-allowed']);
const cleanCode = s => str(s).trim().replace(/\s+/g, ' ');
// Severity number 1..5 from the title, or 0.
function titleSevNumber(title) { const m = str(title).match(SEV_RE); return m ? Number(m[1]) : 0; }
// info: { type (title issue type, '' when not in the list), cat (its category), sev (0..5) }
// -> { ok:true } | { ok:false, why:'<defect message>' }.
function irEligibility(info) {
  const type = str(info && info.type), cat = norm(info && info.cat), sev = Number(info && info.sev) || 0;
  if (!type) return { ok: false, why: 'Title issue type not in the list: fix the issue type' };
  if (cat === CAT_OOS) return { ok: true };
  if (cat === CAT_PET && norm(type) !== TYPE_ATTACK_PET) {
    if (sev >= 3 && sev <= 5) return { ok: true };
    if (sev) return { ok: false, why: 'Immediately Resolved not allowed for a pet incident with Sev ' + sev + ': needs Successful' };
    return { ok: false, why: 'Immediately Resolved not allowed for a pet incident without a title severity: add Sev 3-5 to the title or change to Successful' };
  }
  return { ok: false, why: 'Immediately Resolved not allowed for ' + type + ' (in scope): change the closure code to Successful, or correct the title' };
}
// -> { grp, target (the code the ticket must end with), keys:[required criterion keys], defects:[messages] }.
function closureRule(code, info) {
  const k = closureKey(code), elig = irEligibility(info);
  if (k === 'duplicate') return { grp: 'duplicate', target: CODE_DUP, keys: [], defects: [] };
  if (k === 'immediately resolved') {
    if (elig.ok) return { grp: 'immediate', target: CODE_IR, keys: TITLE_KEYS.slice(), defects: [] };
    return { grp: 'ir-not-eligible', target: CODE_SUCCESSFUL, keys: ALL_KEYS.slice(), defects: [elig.why] };
  }
  if (k === 'successful') return { grp: 'successful', target: CODE_SUCCESSFUL, keys: ALL_KEYS.slice(), defects: [] };
  return { grp: 'not-allowed', target: elig.ok ? CODE_IR : CODE_SUCCESSFUL, keys: (elig.ok ? TITLE_KEYS : ALL_KEYS).slice(),
    defects: ['Closure code ' + (cleanCode(code) || '(blank)') + ' not allowed: change to Successful or Immediately Resolved'] };
}
// Pass count of the required checks (checks in CRITERIA order) and the failing required keys. The
// 'closure' key passes only when the SIM code equals `target`.
function requiredResult(checks, keys, code, target) {
  const missing = [];
  let passed = 0;
  keys.forEach(k => {
    const i = ALL_KEYS.indexOf(k);
    const ok = k === 'closure' ? closureKey(code) === closureKey(target) : !!(checks[i] && checks[i][0]);
    if (ok) passed++; else missing.push(k);
  });
  return { passed, missing };
}
// Requirement of one ticket doc (rule A) given its checks and the prepared lists (ctx.types, ctx.cats).
function requiredChecks(t, checks, ctx) {
  const title = str(t && t.Title);
  const type = findInText(title, (ctx && ctx.types) || []);
  const cat = type && ctx && ctx.cats ? (ctx.cats.get(norm(type)) || '') : '';
  const rule = closureRule(t && t.ClosureCode, { type, cat, sev: titleSevNumber(title) });
  const rr = requiredResult(checks || [], rule.keys, t && t.ClosureCode, rule.target);
  return { ...rule, type, cat, passed: rr.passed, missing: rr.missing };
}
// A report ticket (buildScoreReport) is cleared when every required check passes and it has no defect.
function ticketCleared(t) { return !!t && typeof t.need === 'number' && t.pass === t.need && !(t.def && t.def.length); }
// Normalised category map { norm(type): category } from { type: category } (or a Map).
function prepCats(cats) {
  const m = new Map();
  const add = (k, v) => { const key = norm(k); if (key && !m.has(key)) m.set(key, str(v).trim()); };
  if (cats instanceof Map) cats.forEach((v, k) => add(k, v));
  else if (cats && typeof cats === 'object') Object.keys(cats).forEach(k => add(k, cats[k]));
  return m;
}

// ---- One ticket ----
// -> { excluded:true, cnt } (Cnt numeric > 0) or { score, checks:[[pass 0|1, value]...], group, target,
//    required (count), passedRequired, missingRequired:[keys], defects:[messages] } (checks in CRITERIA
//    order; group / target / required / defects = the closure-code rule, closureRule).
// Duplicate tickets stay excluded from the score report (the scores page distribution); the tracker
// verification counts an excluded 'duplicate' as cleared (sanitization-assign.js).
// Tickets left out of scoring (checked in this order; the first match is the reason):
//   appeal    - 'appeal' anywhere in the title
//   test      - a word starting with 'test' in the title (test, testing, test202; not 'protest'/'latest')
//   duplicate - ClosureCode 'Duplicate'
//   autosim   - Tags has pet_incident_auto_resolved AND ClosureCode Immediately Resolved / Automatically Closed
//   cnt       - RootCauseDetails Cnt: is a number > 0
const EXCLUDE_KEYS = ['appeal', 'test', 'duplicate', 'autosim', 'cnt'];
const AUTO_CLOSE_RE = /^\s*(immediately\s+resolved|automatically\s+(closed|resolved))\s*$/i;
function excludeReason(t, cnt) {
  const title = str(t.Title), cc = str(t.ClosureCode);
  if (/appeal/i.test(title)) return 'appeal';
  if (/\btest/i.test(title)) return 'test';
  if (/^\s*duplicate\s*$/i.test(cc)) return 'duplicate';
  const tags = Array.isArray(t.Tags) ? t.Tags.join(',') : str(t.Tags);
  if (/pet_incident_auto_resolved/i.test(tags) && AUTO_CLOSE_RE.test(cc)) return 'autosim';
  if (cnt > 0) return 'cnt';
  return '';
}
function scoreTicket(t, ctx) {
  const title = str(t.Title), plain = rcdPlain(t.RootCauseDetails);
  const v = {};
  Object.keys(RCD_RE).forEach(k => { v[k] = rcdValue(plain, k); });
  const cnt = cntNumber(v.cnt);
  const why = excludeReason(t, cnt);
  if (why) return { excluded: true, reason: why, cnt };
  const cc = titleCountry(title), sev = titleSeverity(title), tType = findInText(title, ctx.types);
  const issueMatch = v.issue == null ? '' : matchExact(v.issue, ctx.types);
  const resMatch = v.res == null ? '' : matchExact(v.res, ctx.resolutions);
  const date = v.date == null ? '' : parseDate(v.date);
  const zip = v.zip == null ? '' : zipCheck(v.zip, cc);
  // The value shown in the tooltip: the parsed value, or '' when the field is missing.
  const rv = k => (v[k] == null ? '' : clip(v[k]));
  const checks = [
    [cc ? 1 : 0, cc || clip(title.slice(0, 12))],
    [sev ? 1 : 0, sev],
    [tType ? 1 : 0, tType],
    [issueMatch ? 1 : 0, rv('issue')],
    [validSid(v.sid) ? 1 : 0, rv('sid')],
    [validDriv(v.driv) ? 1 : 0, rv('driv')],
    [date ? 1 : 0, date && rv('date') !== date ? rv('date') + ' \u2192 ' + date : rv('date')],
    // Cnt: a number under 10, or N/A (NA, n/a, N.A.) - N/A is not an error (owner rule).
    [(!isNaN(cnt) && cnt < 10) || /^\s*n\.?\s*\/?\s*a\.?\s*$/i.test(str(v.cnt)) ? 1 : 0, rv('cnt')],
    [zip ? 1 : 0, rv('zip')],
    [resMatch ? 1 : 0, rv('res')],
    closureCheck(t.ClosureCode),
  ];
  const req = requiredChecks(t, checks, ctx);
  return { score: checks.reduce((s, c) => s + c[0], 0), checks, group: req.grp, target: req.target,
    required: req.keys.length, passedRequired: req.passed, missingRequired: req.missing, defects: req.defects };
}

// ---- Report ----
function isoOf(v) {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? str(v).trim() : d.toISOString();
}
const timeOf = s => { const n = Date.parse(s); return isNaN(n) ? Infinity : n; };
// Calendar quarter of a date in US Pacific time (DST-aware via Intl, no fixed offset) -> 'YYYY-Qn' or ''.
const PT_YM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric' });
function pacificQuarter(v) {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  let y = 0, m = 0;
  PT_YM.formatToParts(d).forEach(p => { if (p.type === 'year') y = Number(p.value); else if (p.type === 'month') m = Number(p.value); });
  return y && m ? y + '-Q' + (Math.floor((m - 1) / 3) + 1) : '';
}
// rows: ticket_docs (any of ShortId, IssueId, Title, RootCauseDetails, Status, ResolvedDate / rd,
// IssueUrl, CreateDate). Only Status Resolved / Closed is scored. Each ticket carries cq = its
// CreateDate quarter in Pacific time (pacificQuarter).
// -> { total, excluded, buckets:{0..MAX_SCORE}, tickets } sorted by score asc, then oldest resolved first
// (the resolved date only orders the list; it is not part of the payload).
// typeCategories: { issue type: category } (issue-types-data.js IZ_CATS) for the closure-code rule.
function buildScoreReport(rows, issueTypes, resolutionNames, typeCategories) {
  const ctx = { types: prepList(issueTypes), resolutions: prepList(resolutionNames), cats: prepCats(typeCategories) };
  const buckets = {};
  for (let i = 0; i <= MAX_SCORE; i++) buckets[i] = 0;
  const tickets = [], at = new Map();   // ticket -> resolved time (sort key only)
  const excludedTickets = [];           // [{ shortId, reason }] (sanitization-assign verification; not in the GET payload)
  let excluded = 0;
  const excludedBy = {}; EXCLUDE_KEYS.forEach(k => { excludedBy[k] = 0; });
  (Array.isArray(rows) ? rows : []).forEach(d => {
    if (!d || !/^\s*(resolved|closed)\s*$/i.test(str(d.Status))) return;
    const r = scoreTicket(d, ctx);
    const id = str(d.ShortId || d.IssueId).trim(), url = str(d.IssueUrl).trim();
    if (r.excluded) { excluded++; excludedBy[r.reason]++; if (id) excludedTickets.push({ shortId: id, reason: r.reason }); return; }
    buckets[r.score]++;
    const t = {
      shortId: id, url: /^https?:\/\//i.test(url) ? url : (id ? ISSUE_URL_BASE + encodeURIComponent(id) : ''),
      title: str(d.Title).trim(), status: str(d.Status).trim(),
      score: r.score, checks: r.checks,
      // Closure-code rule (closureRule): grp = RULE_GROUPS key, tgt = the code it must end with,
      // need = required checks, pass = how many of them pass, miss = failing required keys,
      // def = defect messages (cleared when pass === need and no defect), cc = SIM ClosureCode.
      grp: r.group, tgt: r.target, need: r.required, pass: r.passedRequired, miss: r.missingRequired, def: r.defects,
      cc: clip(str(d.ClosureCode).trim().replace(/\s+/g, ' ')),
      cq: pacificQuarter(d.CreateDate),   // created quarter (Pacific), e.g. '2026-Q1'; '' when CreateDate is missing
      rbi: str(d.ResolvedByIdentity).trim(),   // raw resolver (Errors in Resolved groups by it, see resolved-errors.js)
    };
    at.set(t, timeOf(isoOf(d.rd != null ? d.rd : d.ResolvedDate)));
    tickets.push(t);
  });
  tickets.sort((a, b) => (a.score - b.score) || (at.get(a) - at.get(b)) || a.shortId.localeCompare(b.shortId));
  excludedBy[APPROVED_REASON] = 0;
  return { total: tickets.length, excluded, excludedBy, excludedTickets, buckets, tickets, typeCount: ctx.types.length, resolutionCount: ctx.resolutions.length };
}

// ---- Owner-approved error tickets (COLLECTIONS.sanitizationExcluded) ----
// The owner approved a contractor's "Error ticket" mark: the ticket leaves sanitization tracking
// everywhere (scores, available counts, picking, contractor views, verification). Applied on top of
// the cached report (approvals change independently of the data stamp): scored tickets whose shortId
// is approved move to excludedTickets with reason 'approved error' and are counted in
// excluded / excludedBy['approved error']; buckets and total are recomputed. Tickets already excluded
// for another reason keep that reason. Pure: returns a NEW report (the input is not changed), or the
// same report when nothing applies.
const APPROVED_REASON = 'approved error';
function applyApproved(report, ids) {
  const set = ids instanceof Set ? ids : new Set(ids || []);
  if (!report || !set.size || !(report.tickets || []).some(t => set.has(t.shortId))) return report;
  const keep = [], gone = [];
  report.tickets.forEach(t => (set.has(t.shortId) ? gone : keep).push(t));
  const buckets = {};
  for (let i = 0; i <= MAX_SCORE; i++) buckets[i] = 0;
  keep.forEach(t => { buckets[t.score]++; });
  const excludedBy = { ...(report.excludedBy || {}) };
  excludedBy[APPROVED_REASON] = (excludedBy[APPROVED_REASON] || 0) + gone.length;
  return {
    ...report, total: keep.length, tickets: keep, buckets,
    excluded: (report.excluded || 0) + gone.length, excludedBy,
    excludedTickets: (report.excludedTickets || []).concat(gone.map(t => ({ shortId: t.shortId, reason: APPROVED_REASON }))),
  };
}

module.exports = {
  OWNER, isOwner, CRITERIA, MAX_SCORE, DRIVER_TYPES,
  titleCountry, titleSeverity, parseDate, zipCheck, validSid, validDriv, cntNumber,
  scoreTicket, buildScoreReport, prepList, pacificQuarter, APPROVED_REASON, applyApproved,
  CLOSURE_ALLOWED, closureCheck, closureExpected, closureKey, excludeReason,
  RULE_GROUPS, TITLE_KEYS, CODE_SUCCESSFUL, CODE_IR, CODE_DUP, titleSevNumber, irEligibility, closureRule,
  requiredChecks, requiredResult, ticketCleared, prepCats,
};
