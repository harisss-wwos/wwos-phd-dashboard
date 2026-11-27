// Tests for incident-log-import.js (the whole-log import parser), run with
//   node --test incident-log-import.test.js
// Self-contained on purpose: every log below is an inline string taken from the real agent formats,
// so the suite survives a clean clone (the eight-fixture corpus lives under the gitignored
// .agents/tasks/incident-log-import/ and has its own runner). The parser is a browser IIFE with a
// module.exports branch, so it loads here without a DOM; incident-log-editor.js supplies the injected
// `api` and issue-types-data.js is read in a node:vm sandbox for the three closed catalogues. No
// network, no DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const IMP = require('./incident-log-import.js');
const ED = require('./incident-log-editor.js');

// The catalogues the parser must never step outside: window.IZ_CATS (issue types, published by
// issue-types.html), RC_RESOLUTIONS (the 12 allowed resolutions), RC_ROOT_CAUSES.
function catalogues() {
  const sandbox = { window: {} };
  // The file's browser-only tail touches `document`; the three lists are assigned before that runs.
  try { vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'issue-types-data.js'), 'utf8'), sandbox, { timeout: 2000 }); } catch (e) { /* keep what was assigned */ }
  const w = sandbox.window, issues = [];
  (w.IZ_CATS || []).forEach(c => (c.types || []).forEach(t => issues.push(t.type)));
  return { issues, res: w.RC_RESOLUTIONS || [], rootCauses: w.RC_ROOT_CAUSES || [] };
}
const CAT = catalogues();
const OPT = Object.assign({ api: ED }, CAT);
const parse = log => IMP.parse(log, OPT);
const review = r => IMP.review(r, { api: ED });
const blanks = r => review(r).blank.map(b => b.field);
const SIM = 'SIM \u2014 ';

test('the three catalogues are readable (the parser is handed them, never a copy)', () => {
  assert.equal(CAT.res.length, 12);
  assert.ok(CAT.rootCauses.length > 40);
  assert.ok(CAT.issues.indexOf('Verbal abuse') >= 0);
});

// ---- dates: three written formats, one normalised MM/DD/YY, and the incident date only ----
test("a DDMON'YY, an ISO and an MM/DD/YYYY incident date all normalise to MM/DD/YY", () => {
  const ddmon = parse("Determination:\nThe material allegation is Substantiated.\n\nPHD Findings:\nA DSP DA was delivering at a CX residence in Germany on 26NOV'26.\n");
  assert.equal(ddmon.sim.fields.Date, '11/26/26');

  const iso = parse('SIM Title: US Customer Incident Escalation - Sev 5 - Verbal abuse\n\nSIM Root Cause Details:\nIssue: Verbal abuse\nDate: 2026-11-16\n');
  assert.equal(iso.sim.fields.Date, '11/16/26');

  const us = parse('PHD Notes:\n- Incident Date: 11/26/2026\n- No prior incidents for the customer.\n');
  assert.equal(us.sim.fields.Date, '11/26/26');
});

test('an outreach-only date is not the incident date: Date stays blank and is flagged', () => {
  const r = parse('Determination:\nThe report is Inconclusive.\n\nPHD Findings:\nLMIR called the CX, left a voicemail and sent an email on 11/26/2026.\n');
  assert.equal(r.sim.fields.Date, undefined);
  assert.ok(blanks(r).indexOf(SIM + 'Date') >= 0);
  assert.ok(r.dateCandidates.some(c => c.role === 'outreach' && c.value === '11/26/26'));
});

// ---- links ----
test('an EMT URL truncated at "&tabV" still yields the incidentId and the rebuilt canonical link', () => {
  const r = parse('Related Links:\nPHD SIM: https://t.corp.amazon.com/V2472379142/overview\nSource Ticket: https://t.corp.amazon.com/063e4007-675d-4060-86fb-122802237d95\nEMT: https://app.emt.amazon.dev/incidents/incidentId?accountId=account_amazongsoc&incidentId=1827866&tabV\n');
  assert.equal(r.emtId, '1827866');
  assert.equal(r.emtLink, ED.IL_EMT_URL_PRE + '1827866' + ED.IL_EMT_URL_POST);
  assert.match(r.emtLink, /&tabV=&tabValue=Overview$/);
  // The PHD SIM is the t.corp ticket id, never the Source Ticket's UUID.
  assert.equal(r.phdSimLink, 'https://t.corp.amazon.com/issues/V2472379142');
});

test('"Address Exclusion SIM raised:" is never read as the PHD SIM', () => {
  const r = parse('PHD Notes:\n- First time incident.\n\nAddress Exclusion SIM raised: https://sim.amazon.com/issues/V2466329846\n');
  assert.equal(r.phdSimLink, '');
  assert.ok(blanks(r).indexOf('PHD Related Link') >= 0);
});

// ---- resolutions ----
test('"PHD Resolution: Customer Reassurance (Primary)." yields exactly "Customer Reassurance"', () => {
  const r = parse('Root Cause:\n\nCX Unfamiliar with Delivery Process\n\nPHD Resolution:\n\nCustomer Reassurance (Primary).\n');
  assert.equal(r.res, 'Customer Reassurance');
  assert.equal(r.sim.fields.Res, 'Customer Reassurance');
  assert.deepEqual(r.additionalResolutions, []);
  assert.equal(r.rootCause.value, 'CX Unfamiliar with Delivery Process');
});

test('a compound flofalgu resolution in one unbroken paragraph splits into primary + additional', () => {
  const para = 'The PHD Team has concluded a full assessment of the incident and has implemented the following actions: '
    + 'Resolution: Delivery Instruction + Customer Reassurance Determination: Incident as reported: A Flex DP out of SVA4 '
    + 'reported that the CX came outside and yelled at the DP. Why this resolution: The account holder was cooperative, so the '
    + 'proportionate customer-side resolution is Customer Reassurance. Re-trigger: If there is any repeat incident at this address, reassess.\n';
  const r = parse(para);
  assert.equal(r.format, 'flofalgu');
  // "Delivery Instruction" is not one of the 12 allowed resolutions: nothing is invented for it.
  assert.equal(r.res, '');
  assert.deepEqual(r.resUnmapped, ['Delivery Instruction']);
  assert.deepEqual(r.additionalResolutions, ['Customer Reassurance']);
  assert.equal(r.simValues.SID, 'SVA4');
  assert.equal(r.sim.fields.Driv, 'Flex DP');
  const un = review(r).unmapped;
  assert.ok(un.some(u => u.field === 'PHD Resolution' && u.raw === 'Delivery Instruction'));
});

test('"Parcel Box" maps to "Parcel Box Installation" and a lower-case value still matches', () => {
  const r = parse('Resolution: Parcel Box + Customer reassurance\n');
  assert.equal(r.res, 'Parcel Box Installation');
  assert.deepEqual(r.additionalResolutions, ['Customer Reassurance']);
  assert.deepEqual(r.resUnmapped, []);
});

test("arunkzn's prose resolution is read, and mellanej's additional mitigations keep only allowed values", () => {
  const a = parse('PHD Notes:\n- First time incident.\n- Since the customer provided verbal reassurances, resolving the SIM as customer reassurance.\n');
  assert.equal(a.res, 'Customer Reassurance');
  const m = parse('Resolution:\n- Primary Mitigation Actioned: Delivery Hint\n- Additional Mitigations Actioned: Customer Reassurance, Driver Misconduct Reported\n');
  assert.equal(m.res, 'Delivery Hint');
  assert.deepEqual(m.additionalResolutions, ['Customer Reassurance']);
  assert.deepEqual(m.resUnmapped, ['Driver Misconduct Reported']);   // not in the 12: reported, not mapped
});

// ---- SIM Root Cause Details fields ----
test('a Canadian postcode survives intact', () => {
  const r = parse('SIM Root Cause Details:\nIssue: Verbal abuse\nZip: V4R 2J6\nDate: 11/15/26\n');
  assert.equal(r.sim.fields.Zip, 'V4R 2J6');
});

test('"Unit Place ID (USC4860112935)" lands in UPID and "Address ID (1147468311203)" does not', () => {
  const r = parse('ADDITIONAL INFORMATION\n\n- PHD Communications to LMIR: PHD requested a critical GeoPin update for both the Unit Place ID (USC4860112935) and Address ID (1147468311203) with updated Road Entry Point coordinates.\n');
  assert.equal(r.sim.fields.UPID, 'USC4860112935');
  Object.keys(r.sim.fields).forEach(k => assert.notEqual(String(r.sim.fields[k]), '1147468311203'));
});

test('the historical incident count is read from any of the prose phrasings', () => {
  assert.equal(parse('PHD Findings:\nThe confirmed historical incident count at the address is 0.\n').sim.fields.Cnt, '0');
  assert.equal(parse('Risk Assessment:\nzero confirmed historical incidents are on record.\n').sim.fields.Cnt, '0');
  assert.equal(parse('PHD Notes:\n- First time incident.\n').sim.fields.Cnt, '0');
});

// ---- the canonical format still imports whole ----
test('the canonical harisss log fills all ten SIM fields, the links and the questionnaire', () => {
  const log = [
    'SIM Title: US Customer Incident Escalation - Account ID: A14WM8TT7J4YTQ - Sev 5 - Verbal abuse',
    'PHD Related Link: https://t.corp.amazon.com/issues/V2459642680',
    'EMT Link: https://app.emt.amazon.dev/incidents/incidentId?accountId=account_amazongsoc&incidentId=1798060&tabV=&tabValue=Overview',
    'Root Cause: Driving Behavior - Other',
    '',
    'SIM Root Cause Details:',
    'Issue: Verbal abuse', 'SID: WET1', 'Driv: DSP DA', 'Date: 11/15/26', 'TID: A12N3FXQOLGVDA',
    'Zip: 39365-7802', 'Cnt: 0', 'CID: A14WM8TT7J4YTQ', 'UPID: USC4877729422', 'Res: Driver Follow-up',
    '',
    'PHD Investigation for mitigation:',
    '- Does current ticket have any duplicate: No',
    '- Is POI the CX: Yes',
    '- Cortex Driver Trace added to SIM & EMT: Yes',
    '- CLEAR history of POI (Any violent/related charges exists?): No',
    '- Netradyne footage exists: No',
    '',
    'PHD Findings:',
    "- 15NOV'26: During a delivery, the CX cursed at the DA.",
    '',
    'PHD Resolution: Driver Follow-up',
    '',
    'PHD notes:',
    '- PHD has classified this as an isolated incident.',
    '',
    'Primary Case Tag:',
    '#contradictory-statement-no-proof',
  ].join('\n');
  const r = parse(log);
  assert.equal(r.format, 'harisss');
  assert.deepEqual(r.sim.fields, { Issue: 'Verbal abuse', SID: 'WET1', Driv: 'DSP DA', Date: '11/15/26',
    TID: 'A12N3FXQOLGVDA', Zip: '39365-7802', Cnt: '0', CID: 'A14WM8TT7J4YTQ', UPID: 'USC4877729422', Res: 'Driver Follow-up' });
  assert.equal(r.rootCause.value, 'Driving Behavior - Other');
  assert.equal(r.phdSimLink, 'https://t.corp.amazon.com/issues/V2459642680');
  assert.equal(r.emtId, '1798060');
  assert.equal(r.severity, '5');
  assert.equal(r.res, 'Driver Follow-up');
  assert.deepEqual(r.invest, { dup: 'No', poi: 'Yes', cortex: 'Yes', clear: 'No', netra: 'No', histCx: '0' });
  assert.deepEqual(r.tags, ['#contradictory-statement-no-proof']);
  assert.ok(r.findings.indexOf('cursed at the DA') > 0);
  assert.equal(review(r).multi.warning, '');
});

// ---- hashtags ----
test('ilCaseTags returns one copyable token per tag, in order, and the no-tag literal', () => {
  assert.deepEqual(IMP.ilCaseTags('Primary Case Tag:\n\n#contradictory-statement-no-proof\n'), ['#contradictory-statement-no-proof']);
  assert.deepEqual(IMP.ilCaseTags('**Primary Case Tag:**\n#unsuccessful-outreach\n#language-barrier\n'), ['#unsuccessful-outreach', '#language-barrier']);
  assert.deepEqual(IMP.ilCaseTags('Primary Case Tag: No Hashtag Applicable'), ['No Hashtag Applicable']);
  assert.deepEqual(IMP.ilCaseTags('PHD Findings:\n- the CX used #hashtag-like text\n'), []);
});

// ---- never guess ----
test('an investigation question with no supporting evidence stays blank instead of defaulting', () => {
  const r = parse('Determination:\nThe report is Inconclusive because the only account documented is the DA\u2019s.\n');
  assert.deepEqual(r.invest, {});
  const blank = blanks(r);
  ['Does current ticket have any duplicate', 'Is POI the CX', 'Cortex Driver Trace added to SIM & EMT',
    'Netradyne footage exists', 'Delivery instructions present', 'AUSTIN Investigation Findings']
    .forEach(q => assert.ok(blank.indexOf(q) >= 0, 'not flagged blank: ' + q));
});

test('an Issue type is read, never inferred, and an unlisted one is reported', () => {
  const prose = parse('PHD Findings:\nThe CX directed verbal abuse at the DA.\n');
  assert.equal(prose.sim.fields.Issue, undefined);       // "verbal abuse" in prose is not an Issue type
  assert.ok(blanks(prose).indexOf(SIM + 'Issue') >= 0);

  const bad = parse('SIM Root Cause Details:\nIssue: Shouting match\nDate: 11/15/26\n');
  assert.equal(bad.sim.fields.Issue, undefined);         // left blank, never mapped onto a neighbour
  assert.equal(bad.issue.raw, 'Shouting match');
  assert.ok(review(bad).unmapped.some(u => u.field === SIM + 'Issue' && u.raw === 'Shouting match'));
});

test('a free-prose Root Cause is reported, not mapped onto a catalogue neighbour', () => {
  const r = parse('Root Cause:\n\nAddress-mapping confusion at a shared driveway left the DP searching near a neighboring property.\n');
  assert.equal(r.rootCause.value, '');
  assert.ok(r.rootCause.raw.indexOf('Address-mapping confusion') === 0);
  assert.ok(review(r).unmapped.some(u => u.field === 'Root Cause'));
});

// ---- an agent log with no SIM Root Cause Details at all ----
test("arunkzn's log imports what it states and flags the rest, dropping the Created / Last modified trailer", () => {
  const log = [
    'PHD Notes:',
    '',
    '- Delivery instructions noted: "Leave at mailbox, LEAVE THE PACKAGE SOMEWHERE CLOSE WITH A PHOTO"',
    '- No prior incidents for the customer.',
    '- As per the cortex, the driver went to the customer house.',
    '- Cant check CLEAR and NETRADYNE as it is AU org.',
    '- Since it is the first time incident and the customer provided verbal reassurances, resolving the SIM as customer reassurance.',
    '',
    'Created: November 20, 2026 04:51 PM by arunkzn@',
    'Last modified: November 20, 2026 04:51 PM by arunkzn@',
  ].join('\n');
  const r = parse(log);
  assert.equal(r.format, 'arunkzn');
  assert.equal(r.res, 'Customer Reassurance');
  assert.equal(r.sim.fields.Cnt, '0');
  assert.equal(r.invest.cortex, 'Yes');
  assert.equal(r.invest.di, 'Yes');
  assert.equal(r.sim.fields.Issue, undefined);
  const blank = blanks(r);
  [SIM + 'Issue', SIM + 'SID', SIM + 'Date', SIM + 'TID', SIM + 'Zip', SIM + 'CID', SIM + 'UPID', 'PHD Related Link', 'EMT Link']
    .forEach(f => assert.ok(blank.indexOf(f) >= 0, 'not flagged blank: ' + f));
  // The trailer is metadata: it is never parsed as content.
  assert.equal(IMP.normalise(log).indexOf('arunkzn@'), -1);
  assert.equal((r.notes + r.reference).indexOf('arunkzn@'), -1);
});

// ---- several incidents in one paste ----
test('two concatenated incidents are both reported and only the first is applied', () => {
  const one = "Determination:\nThe allegation is Substantiated.\n\nPHD Findings:\nA DSP DA was delivering on 26NOV'26.\n\nRoot Cause:\n\nNot following delivery instructions\n\nPHD Resolution:\n\nCustomer Reassurance (Primary).\n";
  const two = "Determination:\nThe allegation is Inconclusive.\n\nPHD Findings:\nA Flex DP was delivering on 28NOV'26.\n\nRoot Cause:\n\nLanguage Barrier\n\nPHD Resolution:\n\nDriver Follow-up (Primary).\n";
  const r = parse(one + '\n' + two);
  assert.equal(r.blocks, 2);
  assert.equal(r.incidents.length, 2);
  assert.equal(r.sim.fields.Date, '11/26/26');            // the first incident only
  assert.equal(r.rootCause.value, 'Not following delivery instructions');
  assert.equal(r.res, 'Customer Reassurance');
  assert.match(review(r).multi.warning, /2 incidents were pasted/);
});

// ---- the review report ----
test('review() groups the import into filled / blank / unmapped plus the tags', () => {
  const r = parse('SIM Root Cause Details:\nIssue: Verbal abuse\nDate: 11/15/26\nRes: Driver Education\n\nPrimary Case Tag:\n#language-barrier\n');
  const rv = review(r);
  assert.ok(rv.filled.some(f => f.field === SIM + 'Issue' && f.value === 'Verbal abuse'));
  assert.ok(rv.filled.some(f => f.field === SIM + 'Date' && f.value === '11/15/26'));
  assert.ok(rv.blank.some(b => b.field === SIM + 'Res'));
  assert.ok(rv.unmapped.some(u => u.field === 'PHD Resolution' && u.raw === 'Driver Education'));
  assert.deepEqual(rv.tags, ['#language-barrier']);
  rv.filled.forEach(f => assert.equal(typeof f.source, 'string'));
});

// ---- detection and the parts list ----
test('detect() scores the seven formats and falls back to generic without gating extraction', () => {
  assert.equal(IMP.detect('').format, 'generic');
  assert.equal(IMP.detect('SIM Root Cause Details:\nPHD Investigation for mitigation:').format, 'harisss');
  assert.equal(IMP.detect('OVERVIEW\n\u2500\u2500\u2500\u2500\nEvidence Checklist:').format, 'mellanej');
  assert.equal(IMP.detect('Determination:\nTreatment Rationale:\nEMT Incident Report:').format, 'nobregak');
  assert.equal(IMP.detect('PHD note:\nPHD ticket id : x\nMatrix Pathway: Low').format, 'punithsd');
  // A log that scores generic still parses: the label union does the work.
  const g = parse('Issue: Verbal abuse\nDate: 11/15/26\nRes: Customer Reassurance\n');
  assert.equal(g.format, 'generic');
  assert.equal(g.sim.fields.Issue, 'Verbal abuse');
  assert.equal(g.sim.fields.Res, 'Customer Reassurance');
});

test('withApi() binds the editor once and parse() then needs no api argument', () => {
  const bound = IMP.withApi(ED);
  const r = bound.parse('SIM Root Cause Details:\nIssue: Verbal abuse\nDate: 11/15/26\n', CAT);
  assert.equal(r.sim.fields.Issue, 'Verbal abuse');
  assert.equal(bound.review(r).blank.length > 0, true);
});

// ---- the shared cross-agent prompt (.agents/tasks/incident-log-import/agent-prompt.md) ----
// The worked example at the end of that document, verbatim. The prompt's own output must import
// clean: if this ever stops parsing with an empty blank list and an empty unmapped list, the
// document is telling the seven agents to write something the importer cannot read.
const AGENT_PROMPT_EXAMPLE = [
  'SIM Title: US Customer Incident Escalation - Account ID: A14WM8TT7J4YTQ - Sev 5 - Verbal abuse',
  'Root Cause: Driving Behavior - Other',
  'PHD Related Link: https://t.corp.amazon.com/issues/V2459642680',
  'EMT Link: https://app.emt.amazon.dev/incidents/incidentId?accountId=account_amazongsoc&incidentId=1798060&tabV=&tabValue=Overview',
  '',
  'SIM Root Cause Details:',
  'Issue: Verbal abuse',
  'SID: WET1',
  'Driv: DSP DA',
  'Date: 11/15/26',
  'TID: A12N3FXQOLGVDA',
  'Zip: 39365-7802',
  'Cnt: 0',
  'CID: A14WM8TT7J4YTQ',
  'UPID: USC4877729422',
  'Res: Driver Follow-up',
  '',
  'PHD Investigation for mitigation:',
  '- Does current ticket have any duplicate: No',
  '- Is POI the CX: Yes',
  '- CX Account suspension requested from GSOC?: No',
  '- Negative Delivery Feedbacks reported in SIM against the Transporter: 0',
  '- Historical incidents against CX in SIM [If CX is POI]: 0',
  '- Location Historical incidents in SIM records (UPID): 0',
  '- Cortex Driver Trace added to SIM & EMT: Yes',
  '- Location Historical incidents in EMT records (Physical address): 0',
  '- CLEAR history of POI (Any violent/related charges exists?): No',
  '- Station request made: No',
  '- Netradyne footage exists: No',
  '- Additional packages delivered after incident?: No',
  '- Delivery instructions present: Yes',
  '- Delivery instructions updated after incident?: No',
  '- AUSTIN Investigation Findings: No',
  '',
  'PHD Findings:',
  "- A DSP DA out of WET1 was delivering at a CX residence on 15NOV'26.",
  '- The CX came out of the residence and shouted at the DA about the parking position of the van.',
  '- No physical contact occurred, no weapon was involved and the DA left the area safely.',
  '- Cortex driver trace and heat map place the DA at the delivery location at the reported time.',
  '',
  'PHD Resolution: Driver Follow-up',
  '',
  'PHD notes:',
  '- The DA was coached on parking and on disengaging from a verbal escalation.',
  "- The CX confirmed on 15NOV'26 that future deliveries may continue to the address.",
  '',
  'Determination:',
  'The material allegation that the CX shouted at the DA is Substantiated.',
  '',
  'Evidence Details:',
  'Cortex driver trace and heat map substantiate the incident location and time.',
  'Netradyne footage was checked, and no video of the incident was found.',
  'All substantiated evidence has been attached to the PHD SIM ticket and EMT.',
  '',
  'Risk Assessment:',
  'Likelihood of Repeat: LOW.',
  'Likelihood of Impact: LOW.',
  'Matrix pathway: LOW Repeat + LOW Impact = Low / Accept',
  'Treatment Rationale: Driver coaching is the least restrictive effective action.',
  '',
  'Primary Case Tag:',
  '#contradictory-statement-no-proof',
  ''
].join('\n');

test("the shared prompt's worked example imports clean: nothing blank, nothing unmapped", () => {
  const r = parse(AGENT_PROMPT_EXAMPLE);
  const rv = review(r);
  assert.deepEqual(rv.blank, []);
  assert.deepEqual(rv.unmapped, []);

  assert.equal(r.format, 'harisss');
  assert.equal(r.blocks, 1);
  // The five fixed opening sections.
  assert.equal(r.rootCause.value, 'Driving Behavior - Other');
  assert.equal(r.phdSimLink, 'https://t.corp.amazon.com/issues/V2459642680');
  assert.equal(r.emtId, '1798060');
  assert.equal(r.emtLink, ED.IL_EMT_URL_PRE + '1798060' + ED.IL_EMT_URL_POST);
  assert.equal(r.severity, '5');
  // All ten SIM Root Cause Details keys, in the fixed order, every one from a closed catalogue.
  assert.deepEqual(r.sim.fields, {
    Issue: 'Verbal abuse', SID: 'WET1', Driv: 'DSP DA', Date: '11/15/26', TID: 'A12N3FXQOLGVDA',
    Zip: '39365-7802', Cnt: '0', CID: 'A14WM8TT7J4YTQ', UPID: 'USC4877729422', Res: 'Driver Follow-up'
  });
  assert.ok(CAT.issues.indexOf(r.sim.fields.Issue) >= 0);
  assert.ok(CAT.rootCauses.indexOf(r.rootCause.value) >= 0);
  assert.ok(CAT.res.indexOf(r.res) >= 0);
  // All fifteen investigation questions answered, none guessed.
  IMP.IL_IMP_INVEST_KEYS.forEach(k => assert.ok(r.invest[k] !== undefined && r.invest[k] !== '', 'unanswered: ' + k));
  // The optional sections the importer understands, plus the copyable tag.
  assert.ok(r.findings && r.determination && r.evidence && r.risk && r.notes && r.reference);
  assert.match(r.risk, /Matrix pathway/);
  assert.deepEqual(r.tags, ['#contradictory-statement-no-proof']);
});

test('normalise() strips box drawing, bullets and non-breaking spaces without losing content', () => {
  const n = IMP.normalise('OVERVIEW\n\u2500\u2500\u2500\u2500\u2500\u2500\n\n    \u2022 Primary Mitigation Actioned:\u00a0Delivery Hint\n\n\n\n    \u2022 POI Identified: Yes\n');
  assert.equal(n.indexOf('\u2500'), -1);
  assert.equal(n.indexOf('\u2022'), -1);
  assert.equal(n.indexOf('\u00a0'), -1);
  assert.match(n, /- Primary Mitigation Actioned: Delivery Hint/);
  assert.equal(/\n{3,}/.test(n), false);
});
