// Tests for the validation-driven tracker rows and the owner's per-item review (node --test).
// In-memory fixtures and fake collection objects only: nothing here touches MongoDB Atlas, and every
// fake records its writes so the tests can prove no operation targets ticket_docs.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const san = require('./sanitization-assign');

const STAMP = '2026-03-01T10:00:00.000Z';            // the latest upload
const DETECTED = STAMP;                              // detectedAt of a record written by that upload
const AGENT = 'agent1', OWNER = 'harisss';
const CONTRACTORS = [{ login: AGENT, displayName: 'Agent One' }];

// Report tickets: BAD does not pass rule A (pass < need), OK2 does not either, so nothing is cleared
// by the informational fall-back and the validation record alone decides.
const rt = (id, o) => ({ shortId: id, url: 'https://t.corp.amazon.com/issues/' + id, title: id + ' title',
  score: 9, cc: 'Successful', pass: 9, need: 11, miss: ['rcd_res'], tgt: 'Successful', grp: 'successful', def: [], ...o });
const REPORT = { tickets: [rt('BAD'), rt('OK2')], excludedTickets: [] };
const ASG = [{ _id: 'a1', status: 'active', assignee: AGENT, assignedAt: '2026-02-01T00:00:00.000Z', score: 9, count: 2,
  tickets: [{ shortId: 'BAD', url: 'u/BAD', title: 'BAD title', cq: '2026-Q1', scoreAtAssign: 9 },
    { shortId: 'OK2', url: 'u/OK2', title: 'OK2 title', cq: '2026-Q1', scoreAtAssign: 9 }] }];
// A claim the upload has already seen (at < STAMP), so it is verified, not pending.
const claim = (id, at) => ({ login: AGENT, shortId: id, status: 'successful', reason: '', at: at || '2026-02-10T00:00:00.000Z', by: AGENT, dataStamp: '2026-02-01T00:00:00.000Z' });
const FAIL_RES = { key: 'Res', group: 'rcd', label: 'Sim Root Cause Details: Res', message: 'Res: has no value (it is required).' };
const FAIL_CC = { key: 'country', group: 'title', label: 'Title: country code', message: 'The title does not start with a known country code.' };
const valDoc = (id, failures) => ({ _id: id, shortId: id, title: id + ' title', closureCode: 'Successful', scope: 'title+rcd',
  fields: { Issue: 'Theft', SID: 'DAB5', TID: 'N/A', Driv: 'N/A', Date: '2026-01-15', Cnt: 'N/A', Zip: '90001', CID: 'N/A', UPID: 'N/A', Res: 'N/A' },
  failures: failures, ok: false, detectedAt: DETECTED, dataStamp: DETECTED });

const view = (o) => san.contractorView(ASG, AGENT, REPORT, STAMP, (o && o.marks) || [claim('BAD'), claim('OK2')],
  null, (o && o.validations) || [valDoc('BAD', [FAIL_RES, FAIL_CC])], (o && o.approvedFields) || []);
const row = (v, id) => v.tickets.find(t => t.shortId === id);

// ---- contractorView / rowOf ----
test('a flagged ticket is error-detected and carries the un-approved failures', () => {
  const v = view();
  const t = row(v, 'BAD');
  assert.equal(t.status, 'error-detected');
  assert.equal(t.clearedNow, false);
  assert.equal(t.passedNow, null);
  assert.equal(t.requiredNow, null);
  assert.equal(t.scoreNow, 9);                                     // the raw score still travels
  assert.deepEqual(t.validation.failures.map(f => f.key), ['Res', 'country']);
  assert.deepEqual(t.missingNow, ['Sim Root Cause Details: Res', 'Title: country code']);
  assert.equal(t.validation.detectedAt, DETECTED);
  assert.equal(t.validation.closureCode, 'Successful');
  assert.equal(Object.keys(t.validation.fields).length, 10);
  assert.equal(t.verifiedFailed, false);                           // rule A is not applied here any more
  assert.deepEqual(t.defects, []);
});

test('an error-detected ticket counts in neither cleared nor needsCorrection', () => {
  const T = view().totals;
  assert.equal(T.errorDetected, 1);
  assert.equal(T.errorDeducted, 1);                                // same bucket, old name
  assert.equal(T.cleared, 1);                                      // OK2 only
  assert.equal(T.needsCorrection, 0);
  assert.equal(T.assigned, 2);
});

test('a marked ticket the upload did not flag is sanitized', () => {
  const t = row(view(), 'OK2');
  assert.equal(t.status, 'cleared');
  assert.equal(t.validation, null);
  assert.equal(t.verified, true);
  assert.match(t.note, /detected no errors/);
});

test('every failure approved makes the ticket cleared', () => {
  const v = view({ approvedFields: [{ _id: 'BAD|Res' }, { shortId: 'BAD', field: 'country' }] });
  const t = row(v, 'BAD');
  assert.equal(t.status, 'cleared');
  assert.equal(t.clearedNow, true);
  assert.deepEqual(t.validation.failures, []);
  assert.equal(v.totals.errorDetected, 0);
  assert.equal(v.totals.cleared, 2);
});

test('one approved item leaves the other one open', () => {
  const v = view({ approvedFields: [{ _id: 'BAD|country' }] });
  assert.deepEqual(row(v, 'BAD').validation.failures.map(f => f.key), ['Res']);
  assert.equal(v.totals.errorDetected, 1);
});

test('a ticket sent back for Rework is in Tickets to sanitize with the owner note', () => {
  const returned = { login: AGENT, shortId: 'BAD', status: 'returned', at: '2026-02-10T00:00:00.000Z',
    ownerNote: 'Sim Root Cause Details: Res: has no value (it is required).', returnedAt: '2026-03-02T09:00:00.000Z', returnedBy: OWNER };
  const v = view({ marks: [returned, claim('OK2')] });
  const t = row(v, 'BAD');
  assert.equal(t.status, 'needs-correction');
  assert.equal(t.reason, 'open');
  assert.equal(t.returned.note, returned.ownerNote);
  assert.equal(t.returned.by, OWNER);
  assert.equal(v.totals.errorDetected, 0);
  assert.equal(v.totals.needsCorrection, 1);
});

test('an Error mark keeps the ticket with the owner, whatever the record says', () => {
  const v = view({ marks: [{ login: AGENT, shortId: 'BAD', status: 'error', reason: 'wrong ticket', at: '2026-02-10T00:00:00.000Z' }] });
  assert.equal(row(v, 'BAD').status, 'error-ticket');
  assert.equal(v.totals.errorDetected, 0);
  assert.equal(v.totals.errorTickets, 1);
});

test('a flagged ticket the contractor has not marked stays in Tickets to sanitize', () => {
  // Nothing is written for an unclaimed ticket any more (sanitization-validate-store.js claimedIds);
  // a record left over from an earlier claim must not take the ticket to the owner either.
  const v = view({ marks: [claim('OK2')] });
  const t = row(v, 'BAD');
  assert.equal(t.status, 'needs-correction');
  assert.equal(t.reason, 'open');
  assert.equal(t.passedNow, 9);                                    // the informational raw score, as before
  assert.equal(v.totals.errorDetected, 0);
  assert.equal(v.totals.needsCorrection, 1);
  assert.equal(v.totals.needBy.open, 1);
});

test('a claim the upload has not seen yet keeps the ticket temporarily cleared', () => {
  const v = view({ marks: [claim('BAD', '2026-03-02T00:00:00.000Z'), claim('OK2')] });
  assert.equal(row(v, 'BAD').status, 'awaiting');
  assert.equal(v.totals.errorDetected, 0);
  assert.equal(v.totals.awaiting, 1);
});

test('a record from an earlier upload is out of date and decides nothing', () => {
  const old = { ...valDoc('BAD', [FAIL_RES, FAIL_CC]), detectedAt: '2026-02-05T10:00:00.000Z', dataStamp: '2026-02-05T10:00:00.000Z' };
  const v = view({ validations: [old] });
  const t = row(v, 'BAD');
  assert.equal(t.status, 'cleared');                               // the claim the latest upload saw, nothing flagged
  assert.equal(t.validation, null);                                // and no stale detectedAt on the row
  assert.equal(v.totals.errorDetected, 0);
});

test('without any validation record every row carries validation null', () => {
  const v = view({ validations: [] });
  assert.equal(v.tickets.length, 2);
  v.tickets.forEach(t => assert.equal(t.validation, null));
  assert.equal(v.totals.errorDetected, 0);
});

// ---- handleMine: the detected errors are owner-only ----
const mineDeps = () => ({ contractors: CONTRACTORS, load: async () => ({ docs: ASG, report: REPORT, stamp: STAMP,
  marks: [claim('BAD'), claim('OK2')], approved: [], validations: [valDoc('BAD', [FAIL_RES, FAIL_CC])], approvedFields: [] }) });

test('a contractor gets the detected-error count but no row', async () => {
  const out = await san.handleMine({ login: AGENT }, { user: { username: AGENT }, ...mineDeps() });
  assert.equal(out.status, 200);
  assert.equal(out.body.owner, false);
  assert.equal(out.body.totals.errorDetected, 1);
  assert.equal(out.body.tickets.some(t => t.status === 'error-detected'), false);
  assert.equal(out.body.tickets.length, 1);
});

test('the owner gets the detected-error rows', async () => {
  const out = await san.handleMine({ login: AGENT }, { user: { username: OWNER }, ...mineDeps() });
  assert.equal(out.status, 200);
  assert.equal(out.body.owner, true);
  assert.equal(out.body.tickets.filter(t => t.status === 'error-detected').length, 1);
  assert.equal(out.body.canReview, true);
});

test('the contractor list carries totals.errorDetected', async () => {
  const out = await san.handleMine({}, { user: { username: OWNER }, ...mineDeps() });
  assert.equal(out.status, 200);
  assert.equal(out.body.contractors[0].errorDetected, 1);
  assert.equal(out.body.contractors[0].cleared, 1);
});

// ---- handleValidationReview ----
function fakeColl(name, docs) {
  return {
    name, docs: (docs || []).slice(), writes: [],
    find(filter) { const self = this; return { toArray: async () => self.docs.filter(d => hit(d, filter)) }; },
    async findOne(filter) { return this.docs.find(d => hit(d, filter)) || null; },
    async bulkWrite(ops, options) { this.writes.push({ coll: this.name, bulkWrite: ops, options }); return { ok: 1 }; },
    async updateOne(filter, update, options) { this.writes.push({ coll: this.name, updateOne: { filter, update, options } }); return { ok: 1 }; },
  };
}
const hit = (d, f) => Object.keys(f || {}).every(k => String(d[k]) === String(f[k]));
function reviewDeps(o) {
  const d = o || {};
  return {
    user: { username: d.user || OWNER },
    validationColl: fakeColl('sanitization_validations', d.validations || [valDoc('BAD', [FAIL_RES, FAIL_CC])]),
    approvalColl: fakeColl('sanitization_field_approvals', d.approvals || []),
    marksColl: fakeColl('sanitization_marks', d.marks || [claim('BAD')]),
    now: () => new Date('2026-03-03T12:00:00.000Z'),
  };
}
const allWrites = (deps) => deps.validationColl.writes.concat(deps.approvalColl.writes, deps.marksColl.writes);

test('approving every failing item writes only the approval docs', async () => {
  const deps = reviewDeps();
  const out = await san.handleValidationReview({ shortId: 'BAD', approveFields: ['Res', 'country'], note: 'checked in SIM' }, deps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.approved, ['Res', 'country']);
  assert.deepEqual(out.body.rework, []);
  assert.equal(out.body.ownerNote, null);
  assert.equal(deps.marksColl.writes.length, 0);                   // nothing is sent back
  assert.equal(deps.approvalColl.writes.length, 1);
  const ops = deps.approvalColl.writes[0].bulkWrite;
  assert.deepEqual(ops.map(o => o.updateOne.filter._id), ['BAD|Res', 'BAD|country']);
  assert.deepEqual(ops[0].updateOne.update.$set, { shortId: 'BAD', field: 'Res', approvedBy: OWNER, approvedAt: '2026-03-03T12:00:00.000Z', note: 'checked in SIM' });
  assert.equal(ops[0].updateOne.update.$set._id, undefined);       // _id comes from the filter only
  assert.equal(ops[0].updateOne.upsert, true);
  assert.equal(JSON.stringify(allWrites(deps)).indexOf('ticket_docs'), -1);
});

test('a partial approval also sends the ticket back, naming only the items left open', async () => {
  const deps = reviewDeps();
  const out = await san.handleValidationReview({ shortId: 'BAD', approveFields: ['country'] }, deps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.rework, ['Res']);
  assert.equal(out.body.login, AGENT);
  assert.equal(deps.approvalColl.writes[0].bulkWrite.length, 1);
  assert.equal(deps.marksColl.writes.length, 1);
  const w = deps.marksColl.writes[0].updateOne;
  assert.deepEqual(w.filter, { login: AGENT, shortId: 'BAD' });
  assert.deepEqual(w.update.$set, { login: AGENT, shortId: 'BAD', status: 'returned',
    ownerNote: 'Sim Root Cause Details: Res: Res: has no value (it is required).',
    returnedAt: '2026-03-03T12:00:00.000Z', returnedBy: OWNER });
  assert.equal(w.options.upsert, true);
  assert.equal(w.update.$set.ownerNote.indexOf('country'), -1);    // nothing but the open items
  assert.equal(out.body.ownerNote, w.update.$set.ownerNote);
});

test('Rework with nothing approved returns the ticket with every open item', async () => {
  const deps = reviewDeps();
  const out = await san.handleValidationReview({ shortId: 'BAD', approveFields: [] }, deps);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.rework, ['Res', 'country']);
  assert.equal(deps.approvalColl.writes.length, 0);
  assert.match(deps.marksColl.writes[0].updateOne.update.$set.ownerNote, /Title: country code/);
});

test('an already approved item is not open any more', async () => {
  const deps = reviewDeps({ approvals: [{ _id: 'BAD|Res', shortId: 'BAD', field: 'Res' }] });
  const out = await san.handleValidationReview({ shortId: 'BAD', approveFields: ['Res'] }, deps);
  assert.equal(out.status, 400);
  assert.match(out.body.error, /Not an open detected error/);
  assert.equal(allWrites(deps).length, 0);
});

test('a bulk-shaped body is rejected', async () => {
  const deps = reviewDeps();
  for (const body of [{ shortIds: ['BAD'], approveFields: ['Res'] }, { shortId: ['BAD', 'OK2'], approveFields: ['Res'] }]) {
    const out = await san.handleValidationReview(body, deps);
    assert.equal(out.status, 400);
    assert.match(out.body.error, /one ticket at a time/);
  }
  assert.equal(allWrites(deps).length, 0);
});

test('a non-owner gets 403', async () => {
  const deps = reviewDeps({ user: AGENT });
  const out = await san.handleValidationReview({ shortId: 'BAD', approveFields: ['Res'] }, deps);
  assert.equal(out.status, 403);
  assert.equal(allWrites(deps).length, 0);
});

test('a ticket without a record, and an unknown item, are refused', async () => {
  const deps = reviewDeps();
  const none = await san.handleValidationReview({ shortId: 'OK2', approveFields: [] }, deps);
  assert.equal(none.status, 409);
  const unknown = await san.handleValidationReview({ shortId: 'BAD', approveFields: ['Zip'] }, deps);
  assert.equal(unknown.status, 400);
  const badId = await san.handleValidationReview({ shortId: 'not a ticket!', approveFields: [] }, deps);
  assert.equal(badId.status, 400);
  const longNote = await san.handleValidationReview({ shortId: 'BAD', approveFields: ['Res'], note: 'x'.repeat(san.REASON_MAX + 1) }, deps);
  assert.equal(longNote.status, 400);
  assert.equal(allWrites(deps).length, 0);
});

test('a Rework on a ticket nobody marked uses the login the owner is viewing', async () => {
  const deps = reviewDeps({ marks: [] });
  const out = await san.handleValidationReview({ shortId: 'BAD', approveFields: [], login: AGENT }, deps);
  assert.equal(out.status, 200);
  assert.deepEqual(deps.marksColl.writes[0].updateOne.filter, { login: AGENT, shortId: 'BAD' });
  const orphan = await san.handleValidationReview({ shortId: 'BAD', approveFields: [] }, reviewDeps({ marks: [] }));
  assert.equal(orphan.status, 409);
});

test('the review writes nothing to ticket_docs', async () => {
  const deps = reviewDeps();
  await san.handleValidationReview({ shortId: 'BAD', approveFields: ['country'] }, deps);
  const touched = allWrites(deps).map(w => w.coll);
  assert.deepEqual(touched.sort(), ['sanitization_field_approvals', 'sanitization_marks']);
  assert.equal(JSON.stringify(allWrites(deps)).indexOf('ticket_docs'), -1);
});
