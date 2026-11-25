'use strict';
// Shared data-quality rules for ticket TITLES (pure, no DB I/O). Used by the Ticket Sanitization
// tracker (sanitization-score.js buildScoreReport, sanitization-assign.js, server.js) and the Incident
// Explorer (incident-explorer.js buildExplorer, server.js ieCountryOf), so the two pages cannot drift.
// Read-time only: nothing is written to the database, so a rule change applies to old and future
// tickets alike and is undone by editing this file (and restarting the API).
//
// excludeReason(title) -> 'test' | 'non-phd' | ''   (rules 1 and 2)
//   A ticket with a reason is left out of BOTH pages, like an owner-approved error ticket: never
//   offered for sanitization, never counted in any card / score / list / map / export.
// malformedCountry(title, knownCodes) -> { code, rule } | null   (rule 3, Incident Explorer ONLY)
//   Recovers the country code of a title whose country prefix is malformed. The caller applies it
//   only when the ticket's country is otherwise Unknown and its Country field is empty.
//
// Matching is deliberately conservative (a false positive hides a real incident): word boundaries
// everywhere, so 'contest', 'protest', 'attest', 'latest', 'tested', 'testimony' never match.

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const key = s => norm(s).toLowerCase();

// ---- Rule 1: TEST tickets ----
// The user's example titles (matched exactly, case / whitespace-insensitive).
const TEST_EXAMPLES = [
  'Test', 'Test - please disregard', 'Marketplace - Potential Harm Appeal [Customer Id]--- TEST',
  'This is a test SIM', 'Test Issue', 'TEST Customer Incident Escalation - TESTING PERMISSIONS',
  'Test Ticket', 'Test TT', 'test', 'Test Ticket - Manual Lambda Test',
];
// Generalised patterns (any one is enough). `(?![a-z])` after 'test' = the word ends there (digits
// may follow: Test2, test202), so 'tested' / 'testing' / 'testimony' are not this word.
const TEST_RULES = [
  // T1 the title STARTS with the word test (after any punctuation): 'Test', 'Test Ticket', 'Test TT',
  //    'Test2', 'Test - please disregard', 'TEST: ...', '***TEST ENVIRONMENT***', '[[TEST-BRAZIL]]'.
  { id: 'T1 starts with the word "test"', re: /^[^A-Za-z0-9]*test\d*(?![a-z])/i },
  // T2 test used as a label: 'This is a test SIM', 'test SIM', 'Test Ticket', 'TEST ONLY',
  //    'TESTING ENVIRONMENT' (the word test/testing followed by sim / ticket / tt / environment / only).
  { id: 'T2 "this is a test" / "test SIM|ticket|TT|environment|only"', re: /\bthis is a test\b|\btest(?:ing)?\s+(?:sim|ticket|tt|environment|only)\b/i },
  // T3 TEST / TESTING written in capitals as a standalone word inside a normal (mixed-case) title:
  //    '--- TEST', 'TESTING PERMISSIONS', 'Pet Incident TEST TEST TEST'. Case-sensitive; a title with
  //    no lower-case letter at all is not judged by this rule (all-caps titles stay untouched).
  { id: 'T3 capital TEST/TESTING word in a mixed-case title', re: /(?:^|[^A-Za-z])TEST(?:ING)?(?![A-Za-z])/, mixedCaseOnly: true },
  // T4 placeholder account id: 'Account ID: test', 'Account ID: test202-', 'Account ID: TEST7'.
  { id: 'T4 "Account ID: test..." placeholder', re: /\baccount\s*id\s*[:#-]?\s*test(?![a-z])/i },
  // T5 numbered test: 'Blurb Test 1', 'E2E test #1', 'Test 15'.
  { id: 'T5 numbered "test 1" / "test #1"', re: /\btest\s*#\s*\d+\b|\btest\s+\d+\b/i },
  // T6 'Delete after testing'.
  { id: 'T6 "delete after testing"', re: /\bdelete\s+after\s+test(?:ing)?\b/i },
];

// ---- Rule 2: NON-PHD tickets ----
const NON_PHD_EXAMPLES = [
  'Driver Reported SLS and Payment Issue', 'Driver appealing SLS alert fro Delivery not Received',
  'Driver appealing SLS alert for Order Not Picked Up (ONP)', 'Driver appealing SLS alert for Undelivered package',
  'Driver appealing termination of contract for Order Not Picked (ONP)',
];
const NON_PHD_RULES = [
  // N1 a driver SLS matter: the word 'driver' followed (within the title) by the word 'SLS':
  //    'Driver appealing SLS alert for ...', 'UK/Driver appealing SLS alert ...', 'Driver Reported SLS and Payment Issue'.
  { id: 'N1 "driver ... SLS"', re: /\bdriver\b.*\bSLS\b/i },
  // N2 a driver appealing the termination of their contract: 'Driver appealing termination of contract for ...'.
  { id: 'N2 "driver appealing termination of contract"', re: /\bdriver\s+appeal(?:ing|s|ed)?\s+(?:the\s+|their\s+|his\s+|her\s+)?termination\s+of\s+(?:the\s+|their\s+|his\s+|her\s+)?contract\b/i },
];

const TEST_SET = new Set(TEST_EXAMPLES.map(key));
const NON_PHD_SET = new Set(NON_PHD_EXAMPLES.map(key));
const ruleHit = (rules, t) => rules.find(r => r.re.test(t) && (!r.mixedCaseOnly || /[a-z]/.test(t))) || null;

// Why a title is left out: { reason: 'test' | 'non-phd', rule } or null. Example lists first.
function classifyTitle(title) {
  const t = norm(title);
  if (!t) return null;
  const k = t.toLowerCase();
  if (TEST_SET.has(k)) return { reason: 'test', rule: 'example title' };
  if (NON_PHD_SET.has(k)) return { reason: 'non-phd', rule: 'example title' };
  let r = ruleHit(TEST_RULES, t);
  if (r) return { reason: 'test', rule: r.id };
  r = ruleHit(NON_PHD_RULES, t);
  if (r) return { reason: 'non-phd', rule: r.id };
  return null;
}
// 'test' | 'non-phd' | '' for a title.
function excludeReason(title) { const c = classifyTitle(title); return c ? c.reason : ''; }
// Same for a ticket doc (Title field).
function ticketExcludeReason(t) { return excludeReason(t && t.Title); }

// ---- Rule 3: malformed country prefix (Incident Explorer ONLY) ----
// Aliases a recovered token may use; every result must also be in the caller's known code list.
const COUNTRY_ALIAS = { USA: 'US' };
// US state / district codes. Read as a US state ONLY when US / USA follows ('LA US', 'TX e.x US'),
// never alone ('LA' is not Laos, 'IL' is not Israel, 'IN' is not India here).
const US_STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR').split(' '));
// The SIM template words that follow the country code ('US Customer Incident Escalation').
const TEMPLATE = '(?:Customer|Community\\s*Member)\\s+Incident\\s+Escalation';
// The template placeholder 'e.x' / 'ex.' / 'e.g.' some agents left in ('Country Code e.x US').
const EX = '(?:e\\.?\\s?[xg]\\.?\\s+)?';
const COUNTRY_RULES = [
  // C1 'Country Code US ...', 'Country Code e.x US ...', 'Country Code: US', 'Country Code AU - ...'.
  { id: 'C1 "Country Code [e.x] XX"', re: new RegExp('^\\W*country\\s*code\\s*[:\\-]?\\s*' + EX + '([A-Za-z]{2,3})(?![A-Za-z])', 'i') },
  // C2 a US state code before US / USA: 'DC US ...', 'LA US ...', 'FL  US ...', 'TX e.x US ...', 'IL e.x US'.
  { id: 'C2 "<US state> [e.x] US"', re: new RegExp('^\\W*([A-Z]{2})\\s*[,\\-]?\\s*' + EX + '(US|USA)(?![A-Za-z])'), state: true },
  // C3 code glued to the template word: 'USCommunity Member ...', 'UsCustomer ...', 'USCustomer ...'.
  { id: 'C3 code glued to "Customer/Community"', re: new RegExp('^\\W*([A-Za-z]{2,3})(?=' + TEMPLATE + ')') },
  // C4 code after leading punctuation / a phone prefix: '[USA] - ...', "'+1 USA ...", '[US Customer ...'
  //    (no closing bracket), '{IT} ...'. The code must be followed by a bracket, space, '-' or ':'.
  { id: 'C4 "[USA]" / "+1 USA" / "{XX}"', re: /^(?:[\s'"`\[\]({+*#]|\+?\d{1,3}\s)*?([A-Za-z]{2,3})(?=[\s\])}:\-|]|$)/, needsNoise: true },
  // C5 dotted / spaced U.S.: 'U.S. Customer ...', 'U.S.A. ...', 'U S Customer ...'.
  { id: 'C5 "U.S." / "U S"', re: /^\W*(U\.\s?S\.(?:\s?A\.)?|U\sS)(?=\s|$)/, fixed: 'US' },
];
// -> { code, rule } or null. knownCodes: Set / array of the page's country codes (server.js
// SLA_COUNTRY_CODES); a recovered code outside it is ignored.
function malformedCountry(title, knownCodes) {
  const t = norm(title);
  if (!t) return null;
  const known = knownCodes instanceof Set ? knownCodes : new Set(knownCodes || []);
  const ok = c => { const u = COUNTRY_ALIAS[c] || c; return known.has(u) ? u : ''; };
  for (const r of COUNTRY_RULES) {
    const m = t.match(r.re);
    if (!m) continue;
    if (r.fixed) { if (known.has(r.fixed)) return { code: r.fixed, rule: r.id }; continue; }
    if (r.state) { if (US_STATES.has(m[1]) && ok('US')) return { code: 'US', rule: r.id }; continue; }
    // C4 needs real leading noise (a plain 'XX ...' title is the normal format, handled by the caller).
    if (r.needsNoise && m.index === 0 && m[0].length === m[1].length) continue;
    const c = ok(m[1].toUpperCase());
    if (c) return { code: c, rule: r.id };
  }
  return null;
}

module.exports = {
  TEST_EXAMPLES, NON_PHD_EXAMPLES, TEST_RULES, NON_PHD_RULES, COUNTRY_RULES, US_STATES,
  classifyTitle, excludeReason, ticketExcludeReason, malformedCountry,
};
