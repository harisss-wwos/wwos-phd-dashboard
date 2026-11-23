// Tests for sanitization-view.js (the Sanitization Tracker ticket view), run with
//   node --test sanitization-view.test.js
// The file is a browser IIFE with a module.exports branch, so it loads here without a DOM. Everything
// is asserted against a synthetic GET /api/my-sanitization payload: no network, no DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const V = require('./sanitization-view.js');
const eng = require('./server/sanitization-validate.js');

const DETECTED = '2026-02-11T07:30:00.000Z';
const FAILURES = [
  { key: 'country', group: 'title', label: 'Title: country code', message: 'The title does not start with a known country code.' },
  { key: 'Res', group: 'rcd', label: 'Sim Root Cause Details: Res', message: 'Res: has no value (it is required).' },
];
const FIELDS = { Issue: 'Verbal abuse', SID: 'DAB5', TID: 'A1V1CPQ92KVCZG', Driv: 'DSP DA', Date: '02/11/26', Cnt: '0', Zip: '98109', CID: 'N/A', UPID: 'N/A', Res: 'N/A' };

// One 'error-detected' ticket, one sanitized, one to sanitize.
function ticket(o) {
  return Object.assign({ shortId: 'T0', url: 'https://sim/T0', title: 'Customer Incident Escalation - Verbal abuse', assignedAt: '2026-02-01T00:00:00.000Z',
    scoreNow: 7, passedNow: null, requiredNow: null, defects: [], missingNow: [], closureCode: 'Successful', status: 'needs-correction',
    verified: false, verifiedFailed: false, mark: null, verifiedMark: null, returned: null, validation: null }, o);
}
function payload(o) {
  const v = { login: 'chousoud', dataAsOf: DETECTED, maxScore: 11, tickets: [
    ticket({ shortId: 'BAD', status: 'error-detected', verified: true,
      validation: { closureCode: 'Successful', scope: 'title+rcd', detectedAt: DETECTED, failures: FAILURES, fields: FIELDS } }),
    ticket({ shortId: 'OK1', status: 'cleared', verified: true, scoreNow: 11, verifiedMark: { status: 'successful', at: DETECTED } }),
    ticket({ shortId: 'NEED', status: 'needs-correction', reason: 'missing', missingNow: ['Title: no severity'] }),
  ], approved: [] };
  return Object.assign(v, o || {});
}
const when = iso => (iso ? String(iso).slice(0, 10) : '');
const opts = o => Object.assign({ h: { when, ic: () => '', url: t => t.url } }, o || {});
const badTicket = () => payload().tickets[0];

test("sections() puts an 'error-detected' ticket in ded", () => {
  const s = V.sections(payload());
  assert.deepEqual(s.ded.map(t => t.shortId), ['BAD']);
  assert.deepEqual(s.need.map(t => t.shortId), ['NEED']);
  assert.deepEqual(s.ok.map(t => t.shortId), ['OK1']);
});

test('totalsOf() reports errorDetected and keeps it out of cleared and needsCorrection', () => {
  const T = V.totalsOf(payload());
  assert.equal(T.errorDetected, 1);
  assert.equal(T.cleared, 1);
  assert.equal(T.needsCorrection, 1);
  assert.equal(T.assigned, 3);
  assert.equal(T.needBy.missing, 1);   // only the to-sanitize row counts towards a reason
});

test('viewHtml with review:true lists the failing items, the detected timestamp and both actions', () => {
  const html = V.viewHtml(payload(), opts({ review: true, open: 'ded' }));
  assert.match(html, /Error detected/);
  assert.match(html, /stv-errdet/);
  FAILURES.forEach(f => assert.ok(html.includes(f.label), 'missing item label: ' + f.label));
  assert.ok(html.includes(when(DETECTED)), 'the formatted detectedAt is shown');
  assert.match(html, /data-stvfix="BAD"/);
  assert.match(html, /data-stvapv="BAD"/);
});

test('viewHtml with review:false shows the count but no error-detected row', () => {
  // A contractor's payload: the server sends the count in totals and withholds the rows.
  const v = payload();
  v.tickets = v.tickets.filter(t => t.status !== 'error-detected');
  v.totals = V.totalsOf(payload());
  const html = V.viewHtml(v, opts({ review: false }));
  assert.match(html, /Errors detected on the last upload<\/span>[\s\S]*?<dd><b>1<\/b>/);
  assert.equal(html.includes('stv-errdet'), false);
  assert.equal(html.includes('data-stvapv'), false);
  assert.equal(html.includes('data-stvfix'), false);
  // ...and the help text says so, instead of leaving the missing count unexplained.
  assert.match(html, /you see only the count, not the items/);
});

test('the browser copies of the rules still match the engine', () => {
  // The rule text lives in three hand-kept places: the engine (server/sanitization-validate.js RULES),
  // the checklist card (sanitization-checklist.js TS_RULES) and the section help texts here
  // (RULES_TEXT). The literal is read out of the browser file, so a rule change that is not mirrored
  // leaves the card or the help describing the old behaviour and fails here.
  const src = fs.readFileSync(path.join(__dirname, 'sanitization-checklist.js'), 'utf8');
  const m = src.match(/var TS_RULES\s*=\s*(\[[\s\S]*?\n\]);/);
  assert.ok(m, 'TS_RULES literal found in sanitization-checklist.js');
  // Back through JSON: the vm realm has its own Array / Object, which deepEqual refuses to match.
  const TS_RULES = JSON.parse(JSON.stringify(vm.runInNewContext(m[1])));
  assert.deepEqual(TS_RULES.map(r => r.key), eng.RULES.map(r => 'r-' + r.key));
  assert.deepEqual(TS_RULES.map(r => r.label), eng.RULES.map(r => r.title));
  assert.deepEqual(TS_RULES.map(r => r.lines), eng.RULES.map(r => r.lines.slice()));
  // RULES_TEXT says the same in one sentence: every closure code the rules name, the required fields,
  // the Cnt rule and the number of plain optional fields left.
  eng.RULES.filter(r => r.code).forEach(r => assert.ok(V.RULES_TEXT.includes(r.code), 'RULES_TEXT names ' + r.code));
  const req = eng.REQUIRED_FIELDS;
  assert.ok(V.RULES_TEXT.includes(req.slice(0, -1).join(', ') + ' and ' + req[req.length - 1]), 'RULES_TEXT names the required fields');
  assert.ok(V.RULES_TEXT.includes('N/A does not count'), 'RULES_TEXT says N/A does not count for them');
  assert.equal(eng.RCD_FIELDS.length - req.length - 1, 6);   // the optional fields without the Cnt rule
  assert.ok(V.RULES_TEXT.includes('the other six'), 'RULES_TEXT counts the plain optional fields');
  assert.deepEqual(V.RCD_KEYS, eng.RCD_FIELDS.slice());
});

test('apvFieldsHtml emits one checkbox per failing item and no select-all', () => {
  const html = V.apvFieldsHtml(badTicket(), opts());
  assert.equal((html.match(/type="checkbox"/g) || []).length, FAILURES.length);
  FAILURES.forEach(f => assert.ok(html.includes('data-stvapvf="' + f.key + '"'), 'checkbox for ' + f.key));
  assert.equal(html.includes('data-stvall'), false);
  assert.equal(html.includes('stv-bulk'), false);
  // The ten stored Sim Root Cause Details values are there for reference.
  V.RCD_KEYS.forEach(k => assert.ok(html.includes('<dt>' + k + '</dt>'), 'field ' + k));
});
