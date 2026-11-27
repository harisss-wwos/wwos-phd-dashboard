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

// ---- the owner's FINAL shared prompt shape (spec change, 27 Nov) ----
// Eleven sections, "Incident Findings:" instead of "PHD Findings:", no Determination and no
// "PHD notes:" (PHD Mitigation carries what used to go there), the two "Outreaches to …" items
// appended to the investigation list, the new "- Likelihood: Low," risk shape with no tier line, and
// the investigation AFTER the findings. Kept in sync with
// .agents/tasks/incident-log-import/fixtures/new-prompt.txt and with agent-prompt.md: if one is
// edited, edit all three.
const FINAL_PROMPT_EXAMPLE = [
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
  'Incident Findings:',
  "- A DSP DA out of WET1 was delivering at a CX residence on 15NOV'26.",
  '- The CX came out of the residence and shouted at the DA about the parking position of the van.',
  '- No physical contact occurred, no weapon was involved and the DA left the area safely.',
  '- Cortex driver trace and heat map place the DA at the delivery location at the reported time.',
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
  '- Outreaches to CX/POI:',
  "    - 15NOV'26: called the CX, who confirmed that future deliveries may continue to the address.",
  '- Outreaches to DA:',
  "    - 15NOV'26: driver follow-up action item raised with the DSP for the parking position.",
  '',
  'Risk Assessment:',
  '- Likelihood: Low,',
  '    - The account has 22 prior orders with no earlier incident at this address.',
  '- Impact: Low,',
  '    - Verbal only, with no weapon, no physical contact and no injury.',
  '',
  'PHD Mitigation:',
  "- Driver coaching was actioned with the DSP on 15NOV'26.",
  '- Secondary Root Causes: None',
  '- Source Ticket: https://t.corp.amazon.com/063e4007-675d-4060-86fb-122802237d95',
  '- Risk tier: Low / Accept',
  '',
  'PHD Resolution: Driver Follow-up',
  '',
  'Primary Case Tag:',
  '#contradictory-statement-no-proof',
  ''
].join('\n');

test("the final prompt's example imports clean: nothing blank, nothing unmapped", () => {
  const r = parse(FINAL_PROMPT_EXAMPLE);
  const rv = review(r);
  assert.deepEqual(rv.blank, []);
  assert.deepEqual(rv.unmapped, []);
  assert.deepEqual(rv.warnings, []);
  assert.equal(rv.multi.warning, '');
  assert.equal(r.blocks, 1);
  assert.deepEqual(r.sim.fields, {
    Issue: 'Verbal abuse', SID: 'WET1', Driv: 'DSP DA', Date: '11/15/26', TID: 'A12N3FXQOLGVDA',
    Zip: '39365-7802', Cnt: '0', CID: 'A14WM8TT7J4YTQ', UPID: 'USC4877729422', Res: 'Driver Follow-up'
  });
  assert.equal(r.rootCause.value, 'Driving Behavior - Other');
  assert.equal(r.res, 'Driver Follow-up');
  assert.equal(r.severity, '5');
  assert.equal(r.emtId, '1798060');
  assert.equal(r.phdSimLink, 'https://t.corp.amazon.com/issues/V2459642680');
  IMP.IL_IMP_INVEST_KEYS.forEach(k => assert.ok(r.invest[k] !== undefined && r.invest[k] !== '', 'unanswered: ' + k));
  assert.deepEqual(r.tags, ['#contradictory-statement-no-proof']);
});

test('"Incident Findings:" is a full synonym of "PHD Findings:"', () => {
  const body = "\n- A DSP DA was delivering at a CX residence on 26NOV'26.\n- The CX shouted at the DA.\n";
  const neu = parse('Incident Findings:' + body);
  const old = parse('PHD Findings:' + body);
  assert.equal(neu.findings, old.findings);
  assert.ok(neu.findings.indexOf('shouted at the DA') > 0);
  assert.equal(neu.sim.fields.Date, '11/26/26');            // the narrative is read, not dropped
  assert.ok(neu.known > 0);
});

test('"PHD Mitigation:" is read as a section, and its named metadata lines go to the reference', () => {
  const r = parse(FINAL_PROMPT_EXAMPLE);
  assert.match(r.notes, /\*\*PHD Mitigation:\*\*/);
  assert.ok(r.notes.indexOf('Driver coaching was actioned') > 0);
  assert.ok(r.notes.indexOf('Risk tier: Low / Accept') > 0);
  assert.match(r.reference, /\*\*Secondary Root Causes:\*\*/);
  assert.match(r.reference, /\*\*Source Ticket:\*\*/);
  assert.equal(r.phdSimLink, 'https://t.corp.amazon.com/issues/V2459642680');   // never the Source Ticket
});

test('a log with no Determination and no PHD notes is not reported as missing them', () => {
  const blank = blanks(parse(FINAL_PROMPT_EXAMPLE));
  ['Determination', 'PHD notes', 'Evidence Details'].forEach(f =>
    assert.equal(blank.indexOf(f), -1, 'demanded anyway: ' + f));
});

test('the new Risk Assessment shape is kept whole, tier line or not', () => {
  const r = parse(FINAL_PROMPT_EXAMPLE);
  assert.match(r.risk, /- Likelihood: Low,/);
  assert.match(r.risk, /- Impact: Low,/);
  assert.ok(r.risk.indexOf('no earlier incident at this address') > 0);
  assert.equal(/Matrix pathway/i.test(r.risk), false);
  // The legacy forms still read into the same field.
  const legacy = parse('Risk Assessment:\nLikelihood of Repeat: LOW.\nLikelihood of Impact: LOW.\nMatrix pathway: LOW Repeat + LOW Impact = Low / Accept\n');
  assert.match(legacy.risk, /Matrix pathway/);
  assert.match(legacy.risk, /Likelihood of Repeat/);
});

test('the two outreach items are kept under their own label and never dropped', () => {
  const r = parse(FINAL_PROMPT_EXAMPLE);
  assert.match(r.reference, /\*\*Outreaches to CX\/POI:\*\*/);
  assert.match(r.reference, /\*\*Outreaches to DA:\*\*/);
  assert.ok(r.reference.indexOf('called the CX, who confirmed') > 0);
  assert.ok(r.reference.indexOf('driver follow-up action item raised') > 0);
  assert.equal(r.outreach.who, 'DA');
  assert.ok(r.outreach.cx.indexOf('called the CX') > 0);
  assert.ok(r.outreach.transporter.indexOf('action item raised') > 0);
  assert.equal(r.outreachMismatch, '');
  // All four spellings land in the one field.
  ['Outreaches to DA', 'Outreaches to DP', 'Outreaches to Transporter'].forEach(lbl => {
    const one = parse('SIM Root Cause Details:\nIssue: Verbal abuse\n\nPHD Investigation for mitigation:\n- ' + lbl + ': No outreaches performed\n');
    assert.equal(one.outreach.transporter, 'No outreaches performed', lbl);
  });
});

test('an outreach label that disagrees with "Driv:" is imported as written and the clash is reported', () => {
  const r = parse('SIM Root Cause Details:\nIssue: Verbal abuse\nDriv: Flex DP\n\nPHD Investigation for mitigation:\n- Outreaches to DA: No outreaches performed to DSP DA\n');
  assert.equal(r.outreach.transporter, 'No outreaches performed to DSP DA');   // kept, not dropped
  assert.match(r.outreachMismatch, /Outreaches to DA/);
  assert.match(r.outreachMismatch, /Flex DP/);
  assert.ok(review(r).warnings.some(w => /Outreaches to DA/.test(w)));
});

test('a "NEEDS HUMAN CHOICE" line is reported as a gap, once', () => {
  const r = parse('SIM Root Cause Details:\nIssue: Verbal abuse\nDate: 11/15/26\n\nPHD Mitigation:\n- NEEDS HUMAN CHOICE: PHD Resolution\n- NEEDS HUMAN CHOICE: Dog Risk Level\n');
  const rv = review(r);
  const res = rv.blank.filter(b => b.field === 'PHD Resolution');
  assert.equal(res.length, 1);
  assert.match(res[0].why, /NEEDS HUMAN CHOICE/);
  const dog = rv.blank.filter(b => b.field === 'Dog Risk Level');
  assert.equal(dog.length, 1);
  assert.equal(dog[0].why, 'the log marks it NEEDS HUMAN CHOICE');
});

test('nothing keys off section order: the final shape reordered imports the same fields', () => {
  const sections = FINAL_PROMPT_EXAMPLE.split('\n\n');
  const head = sections.slice(0, 2);                       // the title block and SIM Root Cause Details
  const rest = sections.slice(2).reverse();                // every other section, back to front
  const r = parse(head.concat(rest).join('\n\n'));
  const straight = parse(FINAL_PROMPT_EXAMPLE);
  assert.deepEqual(r.sim.fields, straight.sim.fields);
  assert.equal(r.rootCause.value, straight.rootCause.value);
  assert.equal(r.res, straight.res);
  assert.deepEqual(r.invest, straight.invest);
  assert.equal(r.blocks, 1);
  assert.deepEqual(review(r).blank, []);
  assert.deepEqual(review(r).unmapped, []);
});

test('a paste that cannot be split but shows two agent shapes warns instead of merging silently', () => {
  const flofalgu = ['Resolution: Customer Reassurance', '',
    'Incident as reported:', "A DSP DA out of WMO4 saw the CX's dog running loose.", '',
    'Why this resolution:', 'The CX secured the dog and gave written reassurance.'].join('\n');
  const r = parse(flofalgu + '\n\n' + HARISSS_LOG);
  assert.equal(r.blocks, 1);                               // no shared heading, no trailer to cut at
  assert.deepEqual(r.families, ['harisss', 'flofalgu']);
  assert.match(review(r).multi.warning, /Two agent formats appear in this paste/);
  // A single log of either shape says nothing of the sort.
  assert.equal(review(parse(flofalgu)).multi.warning, '');
  assert.equal(review(parse(HARISSS_LOG)).multi.warning, '');
});

// ---- text before the opening heading ----
// A preamble (a greeting, an "Incident 1:" header, a section written out of order) is not an
// incident: it stays with the first block, so the paste is still ONE incident and the whole log is
// imported, instead of a phantom first block that carries only the preamble.
test('text before the opening heading stays with the first block and is not a second incident', () => {
  const r = parse('Hi team, sharing the log below for the import.\nIncident 1:\n\n' + AGENT_PROMPT_EXAMPLE);
  assert.equal(r.blocks, 1);
  assert.equal(r.incidents.length, 1);
  assert.equal(review(r).multi.warning, '');
  assert.deepEqual(r.sim.fields, {
    Issue: 'Verbal abuse', SID: 'WET1', Driv: 'DSP DA', Date: '11/15/26', TID: 'A12N3FXQOLGVDA',
    Zip: '39365-7802', Cnt: '0', CID: 'A14WM8TT7J4YTQ', UPID: 'USC4877729422', Res: 'Driver Follow-up'
  });
  assert.equal(r.rootCause.value, 'Driving Behavior - Other');
  assert.equal(r.res, 'Driver Follow-up');
  assert.equal(r.emtId, '1798060');
  assert.equal(r.severity, '5');
  assert.deepEqual(r.tags, ['#contradictory-statement-no-proof']);
  IMP.IL_IMP_INVEST_KEYS.forEach(k => assert.ok(r.invest[k] !== undefined && r.invest[k] !== '', 'unanswered: ' + k));
  assert.ok(r.findings && r.notes && r.determination && r.evidence && r.risk);
});

test('a section written before the opening heading does not split the log in two', () => {
  const r = parse(["PHD Findings:\n- A DSP DA was delivering at a CX residence on 26NOV'26.",
    'Determination:\nThe material allegation that the CX blocked the vehicle is Substantiated.',
    'Root Cause:\n\nNot following delivery instructions',
    'PHD Resolution:\n\nCustomer Reassurance (Primary).'].join('\n\n') + '\n');
  assert.equal(r.blocks, 1);
  assert.equal(review(r).multi.warning, '');
  assert.equal(r.sim.fields.Date, '11/26/26');
  assert.equal(r.rootCause.value, 'Not following delivery instructions');
  assert.equal(r.res, 'Customer Reassurance');
  assert.ok(r.findings.indexOf('DSP DA') >= 0);
});

// ---- why a field is blank ----
// A value the agent stated that the catalogue rejects is the one case the owner must act on: it is
// reported as rejected, never as a field the log is silent about.
test('an off-catalogue value reads as rejected in the blank group, not as unstated', () => {
  const r = parse('Root Cause: Being very rude\n\nSIM Root Cause Details:\nIssue: Shouting at the driver\nRes: Driver Education\n');
  const rv = review(r);
  const why = f => (rv.blank.filter(b => b.field === f)[0] || {}).why;
  [SIM + 'Issue', SIM + 'Res', 'Root Cause', 'PHD Resolution'].forEach(f =>
    assert.equal(why(f), 'the pasted value is not an allowed option', f));
  assert.equal(why(SIM + 'SID'), 'the log does not state it');
  assert.ok(rv.unmapped.some(u => u.field === SIM + 'Issue' && u.raw === 'Shouting at the driver'));
  assert.ok(rv.unmapped.some(u => u.field === 'Root Cause' && u.raw === 'Being very rude'));
  assert.ok(rv.unmapped.some(u => u.field === 'PHD Resolution' && u.raw === 'Driver Education'));
});

test('an unstated historical count is marked as a default, a stated zero is not', () => {
  const a = review(parse('SIM Root Cause Details:\nIssue: Verbal abuse\nDate: 11/15/26\n')).filled.filter(f => f.field === SIM + 'Cnt')[0];
  assert.equal(a.value, '0');
  assert.match(a.source, /defaulted/);
  assert.equal(a.assumed, true);          // the flag the panel renders open instead of collapsed
  const b = review(parse('SIM Root Cause Details:\nIssue: Verbal abuse\nCnt: 0\n')).filled.filter(f => f.field === SIM + 'Cnt')[0];
  assert.equal(b.value, '0');
  assert.equal(/defaulted/.test(b.source), false);
  assert.equal(b.assumed, undefined);
});

test('a Created / Last modified trailer is dropped on the label alone, with no alias on the line', () => {
  const n = IMP.normalise('PHD Notes:\n- The CX was reassured.\nCreated: 11/20/2026\nLast modified: 11/21/2026\n');
  assert.equal(n.indexOf('11/20/2026'), -1);
  assert.equal(n.indexOf('11/21/2026'), -1);
  const r = parse('PHD Notes:\n- The CX was reassured.\nCreated: 11/20/2026\n');
  assert.equal((r.notes + r.reference).indexOf('11/20/2026'), -1);
});

// ---- two incidents from DIFFERENT agents in one paste ----
// The likely real paste is two agents' formats back to back, and then the detected format's own
// opening heading appears only once: the boundary has to come from any format's heading repeating.
const HARISSS_LOG = [
  'SIM Title: US Customer Incident Escalation - Sev 5 - Verbal abuse',
  'PHD Related Link: https://t.corp.amazon.com/issues/V2459642680',
  'Root Cause: Driving Behavior - Other',
  '',
  'SIM Root Cause Details:',
  'Issue: Verbal abuse', 'SID: WET1', 'Driv: DSP DA', 'Date: 11/15/26', 'Res: Driver Follow-up',
  '',
  'PHD Findings:',
  "- 15NOV'26: the CX shouted at the DA about the parking position of the van.",
  '',
  'PHD Resolution: Driver Follow-up',
].join('\n');
const NOBREGAK_LOG = [
  'Determination:',
  'The material allegation that the CX blocked the vehicle is Substantiated.',
  '',
  'PHD Findings:',
  "A Flex DP was delivering at a CX residence on 26NOV'26.",
  '',
  'Root Cause:',
  '',
  'Not following delivery instructions',
  '',
  'PHD Resolution:',
  '',
  'Customer Reassurance (Primary).',
].join('\n');

test('two incidents written in two different formats are split, warned about and never blended', () => {
  const r = parse(HARISSS_LOG + '\n\n' + NOBREGAK_LOG);
  assert.equal(r.blocks, 2);
  assert.equal(r.incidents.length, 2);
  assert.match(review(r).multi.warning, /2 incidents were pasted/);
  // Every field comes from the FIRST incident; nothing leaks in from the second.
  assert.equal(r.sim.fields.Driv, 'DSP DA');
  assert.equal(r.sim.fields.Date, '11/15/26');
  assert.equal(r.sim.fields.SID, 'WET1');
  assert.equal(r.rootCause.value, 'Driving Behavior - Other');
  assert.equal(r.res, 'Driver Follow-up');
});

test('the same two formats in the other order split too, and then the first one wins', () => {
  const r = parse(NOBREGAK_LOG + '\n\n' + HARISSS_LOG);
  assert.equal(r.blocks, 2);
  assert.match(review(r).multi.warning, /2 incidents were pasted/);
  assert.equal(r.sim.fields.Driv, 'Flex DP');
  assert.equal(r.sim.fields.Date, '11/26/26');
  assert.equal(r.rootCause.value, 'Not following delivery instructions');
  assert.equal(r.res, 'Customer Reassurance');
  assert.equal(r.sim.fields.SID, undefined);          // WET1 belongs to the second incident
});

test('two prose logs with no opening sentence are still two incidents', () => {
  const log = ['Resolution: Customer Reassurance',
    '',
    'Incident as reported:',
    "A DSP DA out of WMO4 arrived to deliver and saw the CX's dog running loose.",
    '',
    'Why this resolution:',
    'The CX secured the dog on request and gave written reassurance of driver safety.'].join('\n');
  const r = parse(log + '\n\n' + log);
  assert.equal(r.blocks, 2);
  assert.match(review(r).multi.warning, /2 incidents were pasted/);
});

test('a log closed by a Created / Last modified trailer ends there: what follows is a second incident', () => {
  const first = ['PHD Notes:',
    '- No prior incidents for the customer.',
    '- Since it is the first time incident, resolving the SIM as customer reassurance.',
    '',
    'Created: November 20, 2026 04:51 PM by arunkzn@',
    'Last modified: November 20, 2026 04:51 PM by arunkzn@'].join('\n');
  const r = parse(first + '\n\n' + NOBREGAK_LOG);
  assert.equal(r.blocks, 2);
  assert.match(review(r).multi.warning, /2 incidents were pasted/);
  assert.equal(r.res, 'Customer Reassurance');          // the first incident's own prose resolution
  assert.equal(r.rootCause.value, '');                  // it states none; the second one's is not borrowed
  assert.equal(r.sim.fields.Date, undefined);
});

test('a "Created:" line in the body is content, and only the stamped trailer is dropped', () => {
  const log = ['PHD Notes:',
    'Created: a new delivery instruction was added by the CX on 11/18/2026.',
    '- The CX was reassured.',
    '',
    'Created: November 20, 2026 04:51 PM by arunkzn@'].join('\n');
  const n = IMP.normalise(log);
  assert.ok(n.indexOf('a new delivery instruction') > 0);
  assert.equal(n.indexOf('arunkzn@'), -1);
  assert.equal(parse(log).blocks, 1);                   // and it is not a second incident either
});

// ---- the agent's own wording, when the catalogue rejects it ----
test('an off-catalogue Root Cause stays out of the field but its wording is kept in the reference', () => {
  const r = parse('Root Cause:\n\nAddress-mapping confusion at a shared driveway left the DP searching near a neighbouring property.\n\nPHD Resolution: Customer Reassurance\n');
  assert.equal(r.rootCause.value, '');
  assert.match(r.reference, /\*\*Root Cause as written \(not an allowed value\):\*\*/);
  assert.ok(r.reference.indexOf('Address-mapping confusion') > 0);
  assert.ok(review(r).unmapped.some(u => u.field === 'Root Cause'));
});

test('a Root Cause that is in the catalogue is not copied into the reference', () => {
  const r = parse('Root Cause: Driving Behavior - Other\n\nPHD Resolution: Driver Follow-up\n');
  assert.equal(r.rootCause.value, 'Driving Behavior - Other');
  assert.equal(/Root Cause as written/.test(r.reference), false);
});

// ---- the review asks only what the questionnaire asks ----
test('a Flex DP import is not asked the questions the editor hides for Flex DP', () => {
  const flex = 'SIM Root Cause Details:\nIssue: Verbal abuse\nDriv: Flex DP\nDate: 11/15/26\n\nPHD Findings:\n- Netradyne is not applicable for this transporter type.\n';
  const rv = review(parse(flex));
  ['Netradyne footage exists', 'Station request made', 'AUSTIN Investigation Findings'].forEach(q => {
    assert.equal(rv.blank.filter(b => b.field === q).length, 0, 'asked anyway: ' + q);
    assert.equal(rv.unmapped.filter(u => u.field === q).length, 0, 'reported anyway: ' + q);
  });
  // The same log for a DSP DA asks them — and reports the Netradyne sentence ONCE, as unmapped.
  const dsp = review(parse(flex.replace('Flex DP', 'DSP DA')));
  ['Station request made', 'AUSTIN Investigation Findings'].forEach(q =>
    assert.ok(dsp.blank.some(b => b.field === q), 'not asked: ' + q));
  assert.equal(dsp.blank.filter(b => b.field === 'Netradyne footage exists').length, 0);
  assert.equal(dsp.unmapped.filter(u => u.field === 'Netradyne footage exists').length, 1);
});

test('a non-US/CA ticket is not asked the CLEAR question the editor hides there', () => {
  const r = parse('SIM Root Cause Details:\nIssue: Verbal abuse\nDriv: DSP DA\nDate: 11/15/26\n');
  const clear = b => /^CLEAR history of POI/.test(b.field);
  assert.ok(IMP.review(r, { api: ED }).blank.some(clear));
  assert.equal(IMP.review(r, { api: ED, ro: { usca: false } }).blank.filter(clear).length, 0);
});

// ---- the one hardcoded mapping is a candidate, not an exemption ----
test('"Parcel Box" is mapped only when the mapping target is in the injected catalogue', () => {
  assert.equal(IMP.mapResolution('Parcel Box', { res: CAT.res }).primary, 'Parcel Box Installation');
  const trimmed = CAT.res.filter(v => v !== 'Parcel Box Installation');
  const out = IMP.mapResolution('Parcel Box', { res: trimmed });
  assert.equal(out.primary, '');
  assert.deepEqual(out.unmapped, ['Parcel Box']);
});

test('normalise() strips box drawing, bullets and non-breaking spaces without losing content', () => {
  const n = IMP.normalise('OVERVIEW\n\u2500\u2500\u2500\u2500\u2500\u2500\n\n    \u2022 Primary Mitigation Actioned:\u00a0Delivery Hint\n\n\n\n    \u2022 POI Identified: Yes\n');
  assert.equal(n.indexOf('\u2500'), -1);
  assert.equal(n.indexOf('\u2022'), -1);
  assert.equal(n.indexOf('\u00a0'), -1);
  assert.match(n, /- Primary Mitigation Actioned: Delivery Hint/);
  assert.equal(/\n{3,}/.test(n), false);
});
