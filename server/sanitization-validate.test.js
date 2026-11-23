// Tests for the sanitization validation engine + its persistence layer (node --test).
// In-memory fixtures and a fake collection object only: nothing here touches MongoDB Atlas, and the
// fake records every bulkWrite so the tests can prove no write ever targets ticket_docs.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const eng = require('./sanitization-validate');
const store = require('./sanitization-validate-store');

const TYPES = ['Verbal abuse', 'Attack w/pet', 'Theft', 'Dog bite'];
const CTX = { types: TYPES };
const GOOD_TITLE = 'US Customer Incident Escalation - Sev 5 - Verbal abuse';
const FULL_RCD = [
  'Issue: Verbal abuse', 'SID: DAB5', 'TID: A1V1CPQ92KVCZG', 'Driv: DSP DA', 'Date: 2026-01-15',
  'Cnt: 2', 'Zip: 90001', 'CID: C123', 'UPID: U456', 'Res: Coaching',
].join('\n');

const ticket = (o) => ({ ShortId: 'T1', Title: GOOD_TITLE, RootCauseDetails: FULL_RCD, ClosureCode: 'Successful', ...o });
const keys = (r) => r.failures.map(f => f.key).sort();

// ---- Engine: closure code selects the checks ----
test('Immediately Resolved checks the title only, whatever the Root Cause Details say', () => {
  const r = eng.validateTicket(ticket({ ClosureCode: 'Immediately Resolved', RootCauseDetails: 'Issue:\nCnt: abc' }), CTX);
  assert.equal(r.scope, 'title');
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.equal(r.fields.Issue, 'N/A');
});

test('Immediately Resolved with no country, no severity and no issue type fails all three title checks', () => {
  const r = eng.validateTicket(ticket({ ClosureCode: 'Immediately Resolved', Title: 'Escalation about a parcel' }), CTX);
  assert.equal(r.scope, 'title');
  assert.deepEqual(keys(r), ['country', 'severity', 'type']);
  assert.equal(r.failures.every(f => f.group === 'title' && f.label && f.message), true);
});

test('Successful with all ten fields passes and stores every value', () => {
  const r = eng.validateTicket(ticket(), CTX);
  assert.equal(r.scope, 'title+rcd');
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.fields).length, 10);
  assert.deepEqual(r.fields, { Issue: 'Verbal abuse', SID: 'DAB5', TID: 'A1V1CPQ92KVCZG', Driv: 'DSP DA',
    Date: '2026-01-15', Cnt: '2', Zip: '90001', CID: 'C123', UPID: 'U456', Res: 'Coaching' });
});

test('Successful with SID, TID, CID and UPID absent stores N/A and raises nothing', () => {
  const rcd = ['Issue: Theft', 'Driv: Hub DA', 'Date: 2026-01-15', 'Cnt: N/A', 'Zip: 90001', 'Res: Coaching'].join('\n');
  const r = eng.validateTicket(ticket({ RootCauseDetails: rcd }), CTX);
  assert.equal(r.ok, true);
  ['SID', 'TID', 'CID', 'UPID'].forEach(k => assert.equal(r.fields[k], 'N/A'));
});

test('Successful with an empty Issue and no Date / Res lines fails the three required fields', () => {
  const rcd = ['Issue:', 'SID: DAB5', 'Cnt: 1', 'Zip: 90001'].join('\n');
  const r = eng.validateTicket(ticket({ RootCauseDetails: rcd }), CTX);
  assert.deepEqual(keys(r), ['Date', 'Issue', 'Res']);
  assert.equal(r.failures.every(f => f.group === 'rcd'), true);
  assert.equal(r.fields.Issue, 'N/A');
});

test('Cnt must be a number or an N/A spelling', () => {
  const of = (v) => eng.validateTicket(ticket({ RootCauseDetails: FULL_RCD.replace('Cnt: 2', 'Cnt: ' + v) }), CTX);
  assert.deepEqual(keys(of('abc')), ['Cnt']);
  assert.equal(of('N/A').ok, true);
  assert.equal(of('3').ok, true);
  assert.equal(of('N/A').fields.Cnt, 'N/A');
});

test('labels are case-insensitive and the line order does not matter', () => {
  const shuffled = ['res: Coaching', 'cnt: 2', 'zip: 90001', 'date: 2026-01-15', 'upid: U456', 'cid: C123',
    'driv: DSP DA', 'tid: A1V1CPQ92KVCZG', 'sid: DAB5', 'issue: Verbal abuse'].join('\n');
  const r = eng.validateTicket(ticket({ RootCauseDetails: shuffled }), CTX);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, eng.parseRcdFields(FULL_RCD));
});

test('the long label forms of the real data parse into the same ten fields', () => {
  const rcd = ['Issue: Theft', 'Station ID: DAB5', 'Transporter ID: A1V1CPQ92KVCZG', 'Driver Type: Flex DP',
    'Date of Incident: 2026-02-02', 'Historical Incident: 4', 'Zip: 10001', 'AID: A-9', 'UPID: U-1',
    'Resolution: Warning'].join('\n');
  assert.deepEqual(eng.parseRcdFields(rcd), { Issue: 'Theft', SID: 'DAB5', TID: 'A1V1CPQ92KVCZG', Driv: 'Flex DP',
    Date: '2026-02-02', Cnt: '4', Zip: '10001', CID: 'A-9', UPID: 'U-1', Res: 'Warning' });
  assert.equal(eng.validateTicket(ticket({ RootCauseDetails: rcd }), CTX).ok, true);
});

test('Duplicate is not checked at all', () => {
  const r = eng.validateTicket(ticket({ ClosureCode: 'Duplicate', Title: 'no country, no severity', RootCauseDetails: '' }), CTX);
  assert.equal(r.scope, 'none');
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
});

test('a closure code outside the three documented values is left alone', () => {
  ['Automatically Closed', '', 'Successful with Problems', 'No Issue'].forEach(code => {
    const r = eng.validateTicket(ticket({ ClosureCode: code, Title: 'nothing valid here', RootCauseDetails: '' }), CTX);
    assert.equal(r.scope, 'none', code);
    assert.equal(r.ok, true, code);
    assert.deepEqual(r.failures, [], code);
  });
});

// ---- Engine: skips and approvals ----
test('a ticket the contractor marked Error gets no result', () => {
  const rows = [ticket({ ShortId: 'T1', Title: 'bad title' }), ticket({ ShortId: 'T2', Title: 'bad title' })];
  const out = eng.validateRows(rows, CTX, { markStatus: new Map([['T1', 'error']]) });
  assert.equal(out.has('T1'), false);
  assert.equal(out.get('T2').ok, false);
});

test('a ticket the owner approved as an error gets no result', () => {
  const out = eng.validateRows([ticket({ Title: 'bad title' })], CTX, { approvedError: [{ shortId: 'T1' }] });
  assert.equal(out.size, 0);
});

test('an approved field is never raised again while the un-approved ones still are', () => {
  const rcd = ['Issue: Theft', 'SID: DAB5', 'Cnt: abc', 'Zip: 90001', 'Res: Coaching'].join('\n');
  const rows = [ticket({ RootCauseDetails: rcd })];
  const all = eng.validateRows(rows, CTX, {});
  assert.deepEqual(keys(all.get('T1')), ['Cnt', 'Date']);
  const some = eng.validateRows(rows, CTX, { approvedFields: new Set([eng.approvalKey('T1', 'Cnt')]) });
  assert.deepEqual(keys(some.get('T1')), ['Date']);
  const none = eng.validateRows(rows, CTX, { approvedFields: new Set([eng.approvalKey('T1', 'Cnt'), eng.approvalKey('T1', 'Date')]) });
  assert.equal(none.get('T1').ok, true);
});

test('the rules are code-defined and ordered', () => {
  assert.deepEqual(eng.RULES.map(r => r.key), ['immediate', 'successful', 'duplicate', 'other', 'skipped']);
  assert.equal(eng.RULES.every(r => r.title && r.lines.length), true);
  assert.deepEqual(eng.RCD_FIELDS.slice(), ['Issue', 'SID', 'TID', 'Driv', 'Date', 'Cnt', 'Zip', 'CID', 'UPID', 'Res']);
  assert.deepEqual(eng.REQUIRED_FIELDS.slice(), ['Issue', 'Date', 'Res']);
});

// ---- Store ----
function fakeColl(name) {
  return { name: name || 'sanitization_validations', calls: [],
    async bulkWrite(ops, options) { this.calls.push({ ops, options }); return { ok: 1 }; } };
}
const asg = (tickets, status) => [{ status: status || 'active', assignee: 'urmahala', tickets: tickets.map(id => ({ shortId: id, title: 't ' + id })) }];
const allOps = (coll) => coll.calls.reduce((a, c) => a.concat(c.ops), []);
const upserts = (coll) => allOps(coll).filter(o => o.updateOne);
const deletes = (coll) => allOps(coll).filter(o => o.deleteMany);

test('planUpsert upserts a flagged ticket with all ten fields and deletes the clean ones', () => {
  const flagged = eng.validateTicket(ticket({ ShortId: 'BAD', Title: 'nothing valid' }), CTX);
  const clean = eng.validateTicket(ticket({ ShortId: 'OK' }), CTX);
  const ops = store.planUpsert([flagged, clean], '2026-03-01T10:00:00.000Z');
  assert.equal(ops.length, 2);
  const set = ops[0].updateOne.update.$set;
  assert.equal(ops[0].updateOne.filter._id, 'BAD');
  assert.equal(ops[0].updateOne.upsert, true);
  assert.equal(set._id, undefined);                       // _id comes from the filter, never from $set
  assert.equal(Object.keys(set.fields).length, 10);
  assert.equal(set.detectedAt, '2026-03-01T10:00:00.000Z');
  assert.equal(set.dataStamp, '2026-03-01T10:00:00.000Z');
  assert.equal(set.ok, false);
  assert.equal(set.scope, 'title+rcd');
  assert.deepEqual(ops[1].deleteMany.filter, { _id: { $in: ['OK'] } });
});

test('runValidation writes only the assigned tickets, flagged as upserts and clean as a delete', async () => {
  const coll = fakeColl();
  const rows = [ticket({ ShortId: 'BAD', Title: 'nothing valid' }), ticket({ ShortId: 'OK' }), ticket({ ShortId: 'NOT-ASSIGNED', Title: 'nothing valid' })];
  const out = await store.runValidation({ validationColl: coll, ticketRows: rows, assignments: asg(['BAD', 'OK']),
    marks: [], approved: [], approvedFields: new Set(), types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
  assert.deepEqual({ validated: out.validated, flagged: out.flagged, clean: out.clean }, { validated: 2, flagged: 1, clean: 1 });
  assert.equal(coll.calls.length, 1);
  assert.deepEqual(upserts(coll).map(o => o.updateOne.filter._id), ['BAD']);
  assert.deepEqual(deletes(coll).map(o => o.deleteMany.filter._id.$in), [['OK']]);
  assert.equal(JSON.stringify(coll.calls).indexOf('ticket_docs'), -1);   // never writes ticket_docs
});

test('runValidation leaves an Error-marked and an approved-error ticket alone', async () => {
  const coll = fakeColl();
  const rows = [ticket({ ShortId: 'ERR', Title: 'nothing valid' }), ticket({ ShortId: 'APV', Title: 'nothing valid' })];
  const out = await store.runValidation({ validationColl: coll, ticketRows: rows, assignments: asg(['ERR', 'APV']),
    marks: [{ shortId: 'ERR', login: 'urmahala', status: 'error', at: '2026-02-01T00:00:00.000Z' }],
    approved: [{ shortId: 'APV' }], types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
  assert.equal(out.validated, 0);
  assert.equal(out.ops, 0);
  assert.equal(coll.calls.length, 0);
});

test('a newer upload refreshes detectedAt on a ticket that is still flagged', async () => {
  const rows = [ticket({ ShortId: 'BAD', Title: 'nothing valid' })];
  const deps = { ticketRows: rows, assignments: asg(['BAD']), marks: [], approved: [], types: TYPES };
  const first = fakeColl(), second = fakeColl();
  await store.runValidation({ ...deps, validationColl: first, stamp: '2026-03-01T10:00:00.000Z' });
  await store.runValidation({ ...deps, validationColl: second, stamp: '2026-03-05T08:30:00.000Z' });
  assert.equal(upserts(first)[0].updateOne.update.$set.detectedAt, '2026-03-01T10:00:00.000Z');
  assert.equal(upserts(second)[0].updateOne.update.$set.detectedAt, '2026-03-05T08:30:00.000Z');
});

test('field approvals come from the approval docs _id and suppress that item only', async () => {
  const coll = fakeColl();
  const rcd = ['Issue: Theft', 'SID: DAB5', 'Cnt: abc', 'Zip: 90001', 'Res: Coaching', 'Date: 2026-01-15'].join('\n');
  const approvedFields = store.fieldApprovalSet([{ _id: 'BAD|Cnt' }, { shortId: 'BAD', field: 'Zip' }]);
  assert.deepEqual(Array.from(approvedFields).sort(), ['BAD|Cnt', 'BAD|Zip']);
  const out = await store.runValidation({ validationColl: coll, ticketRows: [ticket({ ShortId: 'BAD', RootCauseDetails: rcd })],
    assignments: asg(['BAD']), marks: [], approved: [], approvedFields, types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
  assert.deepEqual({ validated: out.validated, flagged: out.flagged }, { validated: 1, flagged: 0 });
  assert.deepEqual(deletes(coll).map(o => o.deleteMany.filter._id.$in), [['BAD']]);
});

test('only ACTIVE assignments are in scope and the newest mark decides', () => {
  assert.deepEqual(Array.from(store.assignedIds(asg(['A', 'B']))).sort(), ['A', 'B']);
  assert.equal(store.assignedIds(asg(['A'], 'revoked')).size, 0);
  const marks = [{ shortId: 'A', status: 'error', at: '2026-02-01T00:00:00.000Z' },
    { shortId: 'A', status: 'duplicate', at: '2026-02-09T00:00:00.000Z' }];
  assert.equal(store.markStatusMap(marks).get('A'), 'duplicate');
});
