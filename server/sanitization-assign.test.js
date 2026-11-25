// Tests for the validation-driven tracker rows, the owner's whole-ticket Accept / Rework review and
// the Error detected section's endpoint (node --test).
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
  null, (o && o.validations) || [valDoc('BAD', [FAIL_RES, FAIL_CC])], (o && o.accepts) || []);
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

test('a ticket the owner accepted is a cleared row with acceptedError', () => {
  const v = view({ accepts: [{ _id: 'BAD', shortId: 'BAD', acceptedBy: OWNER, acceptedAt: '2026-03-03T12:00:00.000Z',
    note: 'checked in SIM', closureCode: 'Successful' }] });
  const t = row(v, 'BAD');
  assert.equal(t.status, 'cleared');
  assert.equal(t.clearedNow, true);
  assert.deepEqual(t.acceptedError, { by: OWNER, at: '2026-03-03T12:00:00.000Z', note: 'checked in SIM' });
  assert.equal(t.validation, null);                                // the stale record decides nothing
  assert.deepEqual(t.missingNow, []);
  assert.match(t.note, /Accepted by harisss/);
  assert.equal(v.totals.cleared, 2);
  assert.equal(v.totals.errorDetected, 0);
});

test('an accept doc given as a bare shortId still clears the ticket', () => {
  const v = view({ accepts: ['BAD'] });
  assert.equal(row(v, 'BAD').status, 'cleared');
  assert.deepEqual(row(v, 'BAD').acceptedError, { by: '', at: null, note: '' });
  assert.equal(v.totals.errorDetected, 0);
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

test('a Rework stays in Tickets to sanitize even when rule A would pass the ticket', () => {
  // The closure-code-only error: 'Automatically Closed' on an Immediately Resolved eligible title has
  // no defects and pass === need, so rule A passes it while the upload's checks flag the code. A
  // 'returned' mark must never reach that rule, or the Rework would read as sanitized and the owner's
  // note would never be shown.
  const auto = rt('AUTO', { cc: 'Automatically Closed', score: 11, pass: 3, need: 3, miss: [],
    tgt: 'Immediately Resolved', grp: 'auto-closed', def: [] });
  const report = { tickets: [auto], excludedTickets: [] };
  const asg = [{ _id: 'a3', status: 'active', assignee: AGENT, assignedAt: '2026-02-01T00:00:00.000Z', score: 11, count: 1,
    tickets: [{ shortId: 'AUTO', url: 'u/AUTO', title: 'AUTO title', cq: '2026-Q1', scoreAtAssign: 11 }] }];
  const FAIL_CODE = { key: 'closureCode', group: 'closure', label: 'Closure code',
    message: 'Automatically Closed is not Successful, Immediately Resolved or Duplicate.' };
  const returned = { login: AGENT, shortId: 'AUTO', status: 'returned', at: '2026-02-10T00:00:00.000Z',
    ownerNote: FAIL_CODE.label + ': ' + FAIL_CODE.message, returnedAt: '2026-03-02T09:00:00.000Z', returnedBy: OWNER };
  const val = { ...valDoc('AUTO', [FAIL_CODE]), closureCode: 'Automatically Closed' };
  // The record the Rework left in place, and (Accept's shape) no record at all: both stay with the agent.
  [[val], []].forEach((validations) => {
    const v = san.contractorView(asg, AGENT, report, STAMP, [returned], null, validations, []);
    const t = v.tickets[0];
    assert.equal(t.status, 'needs-correction');
    assert.equal(t.reason, 'open');
    assert.equal(t.clearedNow, false);
    assert.equal(t.returned.note, returned.ownerNote);
    assert.equal(t.returned.by, OWNER);
    assert.equal(v.totals.cleared, 0);
    assert.equal(v.totals.needsCorrection, 1);
    assert.equal(v.totals.errorDetected, 0);
  });
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
  marks: [claim('BAD'), claim('OK2')], approved: [], validations: [valDoc('BAD', [FAIL_RES, FAIL_CC])], accepts: [] }) });

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

// ---- handleDetectedReview (whole-ticket Accept / Rework) ----
function fakeColl(name, docs) {
  return {
    name, docs: (docs || []).slice(), writes: [],
    find(filter) { const self = this; return { toArray: async () => self.docs.filter(d => hit(d, filter)) }; },
    async findOne(filter) { return this.docs.find(d => hit(d, filter)) || null; },
    async bulkWrite(ops, options) { this.writes.push({ coll: this.name, bulkWrite: ops, options }); return { ok: 1 }; },
    async updateOne(filter, update, options) { this.writes.push({ coll: this.name, updateOne: { filter, update, options } }); return { ok: 1 }; },
    async deleteOne(filter) { this.writes.push({ coll: this.name, deleteOne: { filter } }); return { deletedCount: 1 }; },
  };
}
const hit = (d, f) => Object.keys(f || {}).every(k => String(d[k]) === String(f[k]));
function reviewDeps(o) {
  const d = o || {};
  return {
    user: { username: d.user || OWNER },
    contractors: d.contractors || CONTRACTORS,
    validationColl: fakeColl('sanitization_validations', d.validations || [valDoc('BAD', [FAIL_RES, FAIL_CC])]),
    acceptColl: fakeColl('sanitization_error_accepts', d.accepts || []),
    marksColl: fakeColl('sanitization_marks', d.marks || [claim('BAD')]),
    now: () => new Date('2026-03-03T12:00:00.000Z'),
  };
}
const allWrites = (deps) => deps.validationColl.writes.concat(deps.acceptColl.writes, deps.marksColl.writes);

test('Accept writes one accept doc, deletes the validation record and sends nothing back', async () => {
  const deps = reviewDeps();
  const out = await san.handleDetectedReview({ shortId: 'BAD', action: 'accept', note: 'checked in SIM' }, deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.action, 'accept');
  assert.deepEqual(out.body.items, ['Res', 'country']);
  assert.equal(out.body.ownerNote, null);
  assert.equal(out.body.login, null);
  assert.equal(deps.marksColl.writes.length, 0);                   // nothing is sent back
  assert.equal(deps.acceptColl.writes.length, 1);
  const w = deps.acceptColl.writes[0].updateOne;
  assert.deepEqual(w.filter, { _id: 'BAD' });
  assert.equal(w.options.upsert, true);
  assert.deepEqual(w.update.$set, { shortId: 'BAD', acceptedBy: OWNER, acceptedAt: '2026-03-03T12:00:00.000Z',
    note: 'checked in SIM', closureCode: 'Successful', failures: [FAIL_RES, FAIL_CC] });
  assert.equal(w.update.$set._id, undefined);                      // _id comes from the filter only
  assert.deepEqual(deps.validationColl.writes[0].deleteOne.filter, { _id: 'BAD' });
  assert.equal(deps.validationColl.writes.length, 1);
  assert.equal(JSON.stringify(allWrites(deps)).indexOf('ticket_docs'), -1);
});

test('Rework writes only the returned mark, naming every detected item', async () => {
  const deps = reviewDeps();
  const out = await san.handleDetectedReview({ shortId: 'BAD', action: 'rework' }, deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.action, 'rework');
  assert.deepEqual(out.body.items, ['Res', 'country']);
  assert.equal(out.body.login, AGENT);
  assert.equal(deps.acceptColl.writes.length, 0);
  assert.equal(deps.validationColl.writes.length, 0);              // the next upload refreshes the record
  assert.equal(deps.marksColl.writes.length, 1);
  const w = deps.marksColl.writes[0].updateOne;
  assert.deepEqual(w.filter, { login: AGENT, shortId: 'BAD' });
  assert.deepEqual(w.update.$set, { login: AGENT, shortId: 'BAD', status: 'returned',
    ownerNote: 'Sim Root Cause Details: Res: Res: has no value (it is required). Title: country code: The title does not start with a known country code.',
    returnedAt: '2026-03-03T12:00:00.000Z', returnedBy: OWNER });
  assert.equal(w.options.upsert, true);
  assert.equal(out.body.ownerNote, w.update.$set.ownerNote);
});

test('an unknown or missing action is rejected and nothing is written', async () => {
  const deps = reviewDeps();
  for (const body of [{ shortId: 'BAD' }, { shortId: 'BAD', action: 'approve' }, { shortId: 'BAD', action: '' }]) {
    const out = await san.handleDetectedReview(body, deps);
    assert.equal(out.status, 400);
    assert.match(out.body.error, /action must be/);
  }
  assert.equal(allWrites(deps).length, 0);
});

test('a bulk-shaped body is rejected', async () => {
  const deps = reviewDeps();
  for (const body of [{ shortIds: ['BAD'], action: 'accept' }, { shortId: ['BAD', 'OK2'], action: 'accept' }]) {
    const out = await san.handleDetectedReview(body, deps);
    assert.equal(out.status, 400);
    assert.match(out.body.error, /one ticket at a time/);
  }
  assert.equal(allWrites(deps).length, 0);
});

test('a non-owner gets 403', async () => {
  const deps = reviewDeps({ user: AGENT });
  const out = await san.handleDetectedReview({ shortId: 'BAD', action: 'accept' }, deps);
  assert.equal(out.status, 403);
  assert.equal(allWrites(deps).length, 0);
});

test('a ticket without a detected error, a bad id and a long note are refused', async () => {
  const deps = reviewDeps();
  const none = await san.handleDetectedReview({ shortId: 'OK2', action: 'accept' }, deps);
  assert.equal(none.status, 409);
  const badId = await san.handleDetectedReview({ shortId: 'not a ticket!', action: 'accept' }, deps);
  assert.equal(badId.status, 400);
  const longNote = await san.handleDetectedReview({ shortId: 'BAD', action: 'accept', note: 'x'.repeat(san.REASON_MAX + 1) }, deps);
  assert.equal(longNote.status, 400);
  assert.equal(allWrites(deps).length, 0);
});

test('a Rework on a ticket nobody marked uses the login the owner is viewing', async () => {
  const deps = reviewDeps({ marks: [] });
  const out = await san.handleDetectedReview({ shortId: 'BAD', action: 'rework', login: AGENT }, deps);
  assert.equal(out.status, 200);
  assert.deepEqual(deps.marksColl.writes[0].updateOne.filter, { login: AGENT, shortId: 'BAD' });
  const orphan = await san.handleDetectedReview({ shortId: 'BAD', action: 'rework' }, reviewDeps({ marks: [] }));
  assert.equal(orphan.status, 409);
  assert.equal(orphan.body.error.indexOf('send it back') >= 0, true);
});

test('a Rework for a login that is not a contractor writes nothing', async () => {
  const deps = reviewDeps({ marks: [] });
  const out = await san.handleDetectedReview({ shortId: 'BAD', action: 'rework', login: 'stranger' }, deps);
  assert.equal(out.status, 404);
  assert.equal(out.body.error, 'Unknown contractor.');
  assert.equal(allWrites(deps).length, 0);
});

test('the review writes nothing to ticket_docs', async () => {
  const accept = reviewDeps();
  await san.handleDetectedReview({ shortId: 'BAD', action: 'accept' }, accept);
  assert.deepEqual(allWrites(accept).map(w => w.coll).sort(), ['sanitization_error_accepts', 'sanitization_validations']);
  const rework = reviewDeps();
  await san.handleDetectedReview({ shortId: 'BAD', action: 'rework' }, rework);
  assert.deepEqual(allWrites(rework).map(w => w.coll), ['sanitization_marks']);
  assert.equal(JSON.stringify(allWrites(accept).concat(allWrites(rework))).indexOf('ticket_docs'), -1);
});

// ---- handleErrors: the top-level Error detected section ----
const AGENT2 = 'agent2';
const ERR_CONTRACTORS = [{ login: AGENT, displayName: 'Agent One' }, { login: AGENT2, displayName: 'Agent Two' }];
const ERR_ASG = ASG.concat([{ _id: 'a2', status: 'active', assignee: AGENT2, assignedAt: '2026-02-01T00:00:00.000Z', score: 9, count: 1,
  tickets: [{ shortId: 'BAD2', url: 'u/BAD2', title: 'BAD2 title', cq: '2026-Q1', scoreAtAssign: 9 }] }]);
const ERR_REPORT = { tickets: [rt('BAD'), rt('OK2'), rt('BAD2')], excludedTickets: [] };
const claim2 = (id) => ({ ...claim(id), login: AGENT2, by: AGENT2 });
function errDeps(o) {
  const d = o || {};
  return { contractors: ERR_CONTRACTORS, canViewAll: d.canViewAll,
    load: async () => ({ docs: ERR_ASG, report: ERR_REPORT, stamp: STAMP,
      marks: [claim('BAD'), claim('OK2'), claim2('BAD2')], approved: [],
      validations: d.validations || [valDoc('BAD', [FAIL_RES, FAIL_CC]), valDoc('BAD2', [FAIL_CC])], accepts: d.accepts || [] }) };
}

test('the owner sees every agent that has detected errors, with the failing items', async () => {
  const out = await san.handleErrors({}, { user: { username: OWNER }, ...errDeps() });
  assert.equal(out.status, 200);
  assert.equal(out.body.owner, true);
  assert.equal(out.body.canReview, true);
  assert.equal(out.body.dataAsOf, STAMP);
  assert.deepEqual(out.body.tickets.map(t => t.shortId), ['BAD', 'BAD2']);
  assert.deepEqual(out.body.tickets.map(t => t.login), [AGENT, AGENT2]);
  const t = out.body.tickets[0];
  assert.deepEqual(Object.keys(t).sort(), ['closureCode', 'detectedAt', 'displayName', 'login', 'missing', 'shortId', 'title', 'url']);
  assert.equal(t.closureCode, 'Successful');
  assert.equal(t.detectedAt, DETECTED);
  assert.equal(t.displayName, 'Agent One');
  assert.deepEqual(t.missing, [{ key: 'Res', label: FAIL_RES.label, message: FAIL_RES.message },
    { key: 'country', label: FAIL_CC.label, message: FAIL_CC.message }]);
});

test('a contractor sees only their own rows and cannot review', async () => {
  const out = await san.handleErrors({}, { user: { username: AGENT2 }, ...errDeps() });
  assert.equal(out.status, 200);
  assert.equal(out.body.canReview, false);
  assert.deepEqual(out.body.tickets.map(t => t.shortId), ['BAD2']);
  // ...and asking for somebody else's rows is refused.
  const other = await san.handleErrors({ login: AGENT }, { user: { username: AGENT2 }, ...errDeps() });
  assert.equal(other.status, 403);
});

test('a view-all login sees every agent but cannot review, and a stranger gets 403', async () => {
  const all = await san.handleErrors({}, { user: { username: 'viewer' }, ...errDeps({ canViewAll: true }) });
  assert.equal(all.status, 200);
  assert.equal(all.body.canReview, false);
  assert.deepEqual(all.body.tickets.map(t => t.shortId), ['BAD', 'BAD2']);
  const stranger = await san.handleErrors({}, { user: { username: 'nobody' }, ...errDeps() });
  assert.equal(stranger.status, 403);
  const unknown = await san.handleErrors({ login: 'ghost' }, { user: { username: OWNER }, ...errDeps() });
  assert.equal(unknown.status, 404);
});

test('an accepted ticket is no longer a detected error, and ?login= narrows the section', async () => {
  const accepted = await san.handleErrors({}, { user: { username: OWNER }, ...errDeps({ accepts: [{ _id: 'BAD', shortId: 'BAD', acceptedBy: OWNER }] }) });
  assert.deepEqual(accepted.body.tickets.map(t => t.shortId), ['BAD2']);
  const one = await san.handleErrors({ login: AGENT }, { user: { username: OWNER }, ...errDeps() });
  assert.deepEqual(one.body.tickets.map(t => t.shortId), ['BAD']);
  const none = await san.handleErrors({}, { user: { username: OWNER }, ...errDeps({ validations: [] }) });
  assert.deepEqual(none.body.tickets, []);
});

// ---- Closure-code groups (Sanitization scores page) ----
const score = require('./sanitization-score');
const gt = (id, cc, o) => ({ shortId: id, url: 'u/' + id, title: id + ' title', score: 5, cc, pass: 1, need: 11, miss: ['res'],
  tgt: 'Successful', grp: 'successful', def: [], checks: [], cq: '2026-Q1', ro: 0, ...o });
const GROUP_REPORT = { tickets: [
  gt('S1', 'Successful', { ro: 5, cq: '2026-Q2' }), gt('S2', 'successful ', { ro: 9, score: 0 }), gt('S3', 'Successful', { ro: 1, score: 10 }),
  gt('I1', 'Immediately Resolved', { ro: 3 }), gt('N1', 'No Issue', { ro: 2 }), gt('N2', 'No  issue', { ro: 4 }),
  gt('U1', 'Unsuccessful', { ro: 6 }), gt('B1', '', { ro: 7 }),
  gt('C1', 'Successful', { pass: 11, need: 11, miss: [] }),          // cleared: Sanitized tickets, not a group
] };

test('closureGroupOf: blank and case / space variants', () => {
  assert.deepEqual(score.closureGroupOf('  '), { id: '(blank)', label: 'No closure code' });
  assert.deepEqual(score.closureGroupOf(null), { id: '(blank)', label: 'No closure code' });
  assert.equal(score.closureGroupOf(' No   Issue ').id, 'no issue');
  assert.equal(score.closureGroupOf(' No   Issue ').label, 'No Issue');
  assert.equal(score.closureGroupOf('no issue').id, score.closureGroupOf('No Issue').id);
});

test('closureGroups: order, n / available, cleared tickets left out, sums with clearSplit', () => {
  const g = san.closureGroups(GROUP_REPORT, new Map([['S1', AGENT], ['N2', AGENT]]));
  assert.deepEqual(g.map(x => x.label), ['Successful', 'Immediately Resolved', 'No Issue', 'Unsuccessful', 'No closure code']);
  assert.deepEqual(g.map(x => x.n), [3, 1, 2, 1, 1]);
  assert.deepEqual(g.map(x => x.available), [2, 1, 1, 1, 1]);
  const sum = g.reduce((s, x) => s + x.n, 0);
  assert.equal(sum + score.clearSplit(GROUP_REPORT).clear.total, GROUP_REPORT.tickets.length);
});

test('availableInGroup: quarter then resolved order, score ignored, locked left out', () => {
  const ids = l => san.availableInGroup(GROUP_REPORT, 'successful', l).map(t => t.shortId);
  assert.deepEqual(ids(new Map()), ['S3', 'S2', 'S1']);              // 2026-Q1 by ro (1, 9), then 2026-Q2
  assert.deepEqual(ids(new Map([['S3', AGENT]])), ['S2', 'S1']);
  assert.deepEqual(san.availableInGroup(GROUP_REPORT, '(blank)', new Map()).map(t => t.shortId), ['B1']);
  assert.deepEqual(san.availableInGroup(GROUP_REPORT, 'nope', new Map()), []);
});

test('validateAssign: exactly one of closureCode or score', () => {
  const v = b => san.validateAssign({ count: 1, assignee: AGENT, ...b }, CONTRACTORS);
  assert.deepEqual(v({ closureCode: ' No Issue ' }).value, { closureCode: 'no issue', count: 1, assignee: AGENT });
  assert.equal(v({ closureCode: '(blank)' }).value.closureCode, '(blank)');
  assert.deepEqual(v({ score: 3 }).value, { score: 3, count: 1, assignee: AGENT });
  assert.equal(v({ score: 3, closureCode: 'successful' }).error, 'Send either score or closureCode.');
  assert.equal(v({}).error, 'Send either score or closureCode.');
  assert.equal(v({ closureCode: '  ' }).error, 'closureCode must be a closure-code group.');
  assert.equal(v({ closureCode: 'x'.repeat(121) }).error, 'closureCode must be a closure-code group.');
  assert.equal(v({ closureCode: 5 }).error, 'closureCode must be a closure-code group.');
  assert.equal(v({ score: 11 }).ok, false);
});

// In-memory assignment collection (find({status:'active'}) / insertOne); nothing touches MongoDB.
function fakeAsgColl() {
  const docs = [];
  return { docs, find: q => ({ toArray: async () => docs.filter(d => !q || !q.status || d.status === q.status) }),
    insertOne: async d => { const id = 'x' + docs.length; docs.push({ _id: id, ...d }); return { insertedId: id }; } };
}
test('handleAssign with closureCode picks the oldest, stores the group, 409 when short, no re-pick', async () => {
  const coll = fakeAsgColl();
  const deps = { coll, user: { username: OWNER }, report: GROUP_REPORT, stamp: STAMP, contractors: CONTRACTORS, marks: [] };
  const a = await san.handleAssign({ closureCode: 'Successful', count: 2, assignee: AGENT }, deps);
  assert.equal(a.status, 200);
  assert.equal(a.body.closureCode, 'Successful');
  assert.equal('score' in a.body, false);
  assert.deepEqual(a.body.tickets.map(t => t.shortId), ['S3', 'S2']);
  assert.equal(a.body.available, 1);
  assert.equal(coll.docs[0].score, null);
  assert.equal(coll.docs[0].closureCode, 'Successful');
  assert.equal(coll.docs[0].group, 'successful');
  assert.deepEqual(coll.docs[0].tickets.map(t => t.scoreAtAssign), [10, 0]);
  const b = await san.handleAssign({ closureCode: 'successful', count: 2, assignee: AGENT }, deps);
  assert.equal(b.status, 409);
  assert.equal(b.body.available, 1);
  assert.equal(b.body.error, 'Only 1 tickets with closure code Successful are available.');
  const c = await san.handleAssign({ closureCode: 'successful', count: 1, assignee: AGENT }, deps);
  assert.deepEqual(c.body.tickets.map(t => t.shortId), ['S1']);
  const d = await san.handleAssign({ closureCode: 'Nope', count: 1, assignee: AGENT }, deps);
  assert.equal(d.status, 409);
  assert.equal(d.body.available, 0);
  assert.equal(coll.docs.length, 2);
});

test('buildScoreReport: ro is a 0..n-1 rank by resolved time', () => {
  const doc = (id, rd) => ({ ShortId: id, Status: 'Resolved', Title: 'US Severity 3 - x', RootCauseDetails: '', ClosureCode: 'Successful', ResolvedDate: rd, CreateDate: '2026-01-05T00:00:00Z' });
  const rep = score.buildScoreReport([doc('A', '2026-02-03T00:00:00Z'), doc('B', '2026-02-01T00:00:00Z'), doc('C', null), doc('D', '2026-02-02T00:00:00Z')], [], [], {});
  const ro = Object.fromEntries(rep.tickets.map(t => [t.shortId, t.ro]));
  assert.deepEqual(ro, { B: 0, D: 1, A: 2, C: 3 });
});
