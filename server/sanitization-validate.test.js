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
  // No Root Cause Details, so its Issue line cannot stand in for the title's issue type.
  const r = eng.validateTicket(ticket({ ClosureCode: 'Immediately Resolved', Title: 'Escalation about a parcel', RootCauseDetails: '' }), CTX);
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

test('a required field written as N/A fails: N/A is only for the optional fields', () => {
  const line = { Issue: 'Issue: Verbal abuse', Date: 'Date: 2026-01-15', Res: 'Res: Coaching' };
  eng.REQUIRED_FIELDS.forEach(k => {
    ['N/A', 'n/a', ' N.A. '].forEach(spelling => {
      const r = eng.validateTicket(ticket({ RootCauseDetails: FULL_RCD.replace(line[k], k + ': ' + spelling) }), CTX);
      assert.deepEqual(keys(r), [k], k + ': ' + spelling);
      assert.match(r.failures[0].message, /required/);
    });
  });
  // The optional fields keep taking an N/A spelling.
  assert.equal(eng.validateTicket(ticket({ RootCauseDetails: FULL_RCD.replace('SID: DAB5', 'SID: n/a') }), CTX).ok, true);
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

// ---- Engine: a closure code outside the three is itself the error (owner rule, Nov 2026) ----
test('a closure code outside the three is an error naming that code, and nothing else is checked', () => {
  // The real spellings from the owner's data, plus the other codes the uploads carry.
  ['Automatically Closed', 'Automatically Resolved', 'No Issue', 'Successful with Problems', 'Unsuccessful'].forEach(code => {
    // A perfectly clean title and Root Cause Details: the code alone must still fail.
    const r = eng.validateTicket(ticket({ ClosureCode: code }), CTX);
    assert.equal(r.scope, 'code', code);
    assert.equal(r.ok, false, code);
    assert.deepEqual(keys(r), [eng.CODE_KEY], code);
    assert.equal(r.closureCode, code, code);
    assert.ok(r.failures[0].message.includes(code), 'the reason names ' + code);
    assert.ok(r.failures[0].message.includes(eng.ALLOWED_TEXT), 'the reason names the three allowed codes');
    assert.equal(r.failures[0].label, eng.CODE_LABEL, code);
  });
  // A bad title and empty Root Cause Details add nothing: the code has to be fixed first.
  const bad = eng.validateTicket(ticket({ ClosureCode: 'No Issue', Title: 'nothing valid here', RootCauseDetails: '' }), CTX);
  assert.deepEqual(keys(bad), [eng.CODE_KEY]);
});

test('a blank closure code is an error too, reported as (blank)', () => {
  ['', '   ', null].forEach(code => {
    const r = eng.validateTicket(ticket({ ClosureCode: code }), CTX);
    assert.equal(r.scope, 'code', String(code));
    assert.deepEqual(keys(r), [eng.CODE_KEY], String(code));
    assert.ok(r.failures[0].message.includes(eng.BLANK_CODE), 'the reason says ' + eng.BLANK_CODE);
  });
});

test('the three allowed codes are never reported as a closure-code error', () => {
  eng.ALLOWED_CODES.forEach(code => {
    const r = eng.validateTicket(ticket({ ClosureCode: code }), CTX);
    assert.notEqual(r.scope, 'code', code);
    assert.equal(r.failures.some(f => f.key === eng.CODE_KEY), false, code);
  });
  // Case and spacing do not matter (closureKey): still not a code error.
  assert.notEqual(eng.validateTicket(ticket({ ClosureCode: '  immediately   RESOLVED ' }), CTX).scope, 'code');
});

test('the closure-code error does not reach an unmarked or Error-marked ticket', () => {
  const rows = [ticket({ ShortId: 'OPEN', ClosureCode: 'No Issue' }), ticket({ ShortId: 'ERR', ClosureCode: 'No Issue' }),
    ticket({ ShortId: 'DONE', ClosureCode: 'No Issue' })];
  // OPEN was never marked, ERR was marked Error in the app: both stay out of Error detected entirely.
  const out = eng.validateRows(rows, CTX, { claimed: ['ERR', 'DONE'], markStatus: { ERR: 'error' } });
  assert.deepEqual(Array.from(out.keys()), ['DONE']);
  assert.deepEqual(keys(out.get('DONE')), [eng.CODE_KEY]);
  // ...and neither does an owner-approved error ticket.
  assert.equal(eng.validateRows(rows, CTX, { approvedError: ['OPEN', 'ERR', 'DONE'] }).size, 0);
});

// ---- Engine: the Sim Root Cause Details Issue field overrides the title's issue type ----
const NO_TYPE_TITLE = 'US Customer Incident Escalation - Sev 5 - something unrecognisable';

test('Successful: a valid Issue field means the title issue type is not reported', () => {
  const r = eng.validateTicket(ticket({ Title: NO_TYPE_TITLE }), CTX);   // FULL_RCD has Issue: Verbal abuse
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  // The country and severity checks still apply on their own.
  const bare = eng.validateTicket(ticket({ Title: 'something unrecognisable' }), CTX);
  assert.deepEqual(keys(bare), ['country', 'severity']);
});

test('Successful: an invalid or N/A Issue field leaves the title issue type reported', () => {
  ['Issue: not a real issue type', 'Issue: N/A', 'Issue:'].forEach(line => {
    const rcd = FULL_RCD.replace('Issue: Verbal abuse', line);
    const r = eng.validateTicket(ticket({ Title: NO_TYPE_TITLE, RootCauseDetails: rcd }), CTX);
    assert.ok(keys(r).indexOf('type') >= 0, 'title issue type reported for ' + line);
  });
  // No Root Cause Details at all: the title's issue type is reported (with the required fields).
  const none = eng.validateTicket(ticket({ Title: NO_TYPE_TITLE, RootCauseDetails: '' }), CTX);
  assert.deepEqual(keys(none), ['Date', 'Issue', 'Res', 'type']);
});

test('the Issue field override matches the catalogue exactly, not by substring', () => {
  const of = (issue) => eng.validateTicket(ticket({ Title: NO_TYPE_TITLE,
    RootCauseDetails: FULL_RCD.replace('Issue: Verbal abuse', 'Issue: ' + issue) }), CTX);
  assert.equal(of('attack  w/pet').ok, true);                            // normalised exact match
  assert.ok(keys(of('Theft of a parcel')).indexOf('type') >= 0);         // a type INSIDE a longer value does not count
});

test('Immediately Resolved: a valid Issue field also stands in for the title issue type', () => {
  // The owner's rule is stated for all pages, so it applies here too - and it raises no RCD failure,
  // because the Sim Root Cause Details fields themselves are still not checked for this code.
  const rcd = ['Issue: Theft', 'Cnt: abc'].join('\n');   // Cnt is nonsense: still not reported
  const r = eng.validateTicket(ticket({ ClosureCode: 'Immediately Resolved', Title: NO_TYPE_TITLE, RootCauseDetails: rcd }), CTX);
  assert.equal(r.scope, 'title');
  assert.equal(r.ok, true);
  // Without a valid Issue field the title issue type is reported, and still nothing from the RCD.
  const bad = eng.validateTicket(ticket({ ClosureCode: 'Immediately Resolved', Title: NO_TYPE_TITLE, RootCauseDetails: 'Issue: N/A\nCnt: abc' }), CTX);
  assert.deepEqual(keys(bad), ['type']);
});


// ---- Engine: the uploaded closure code alone selects the checks ----
test('the contractor mark never changes the checks: the uploaded closure code alone does', () => {
  // The owner's rule: an agent who marks everything Duplicate buys nothing. A ticket that is complete
  // for the code the upload carries passes quietly, whatever they marked.
  const complete = { ShortId: 'DUP', Title: GOOD_TITLE, RootCauseDetails: FULL_RCD };
  ['duplicate', 'successful', 'immediate'].forEach(mark => {
    ['Successful', 'Immediately Resolved'].forEach(code => {
      const out = eng.validateRows([{ ...complete, ClosureCode: code }], CTX, { claimed: ['DUP'], markStatus: { DUP: mark } });
      assert.equal(out.get('DUP').ok, true, mark + ' / ' + code);
      assert.equal(out.get('DUP').scope, code === 'Successful' ? 'title+rcd' : 'title', mark + ' / ' + code);
    });
  });
  // The same ticket missing a required field is flagged for an uploaded Successful...
  const noRes = { ...complete, RootCauseDetails: FULL_RCD.replace('Res: Coaching', '') };
  const dupMark = { claimed: ['DUP'], markStatus: { DUP: 'duplicate' } };
  const flagged = eng.validateRows([{ ...noRes, ClosureCode: 'Successful' }], CTX, dupMark);
  assert.deepEqual(keys(flagged.get('DUP')), ['Res']);
  // ...and not for an uploaded Immediately Resolved, which never looks at the RCD fields.
  assert.equal(eng.validateRows([{ ...noRes, ClosureCode: 'Immediately Resolved' }], CTX, dupMark).get('DUP').ok, true);
  // An uploaded Duplicate checks nothing, even for a ticket marked Successful.
  assert.equal(eng.validateRows([{ ...noRes, ClosureCode: 'Duplicate' }], CTX, { claimed: ['DUP'], markStatus: { DUP: 'successful' } }).get('DUP').ok, true);
});

test('the required fields reject absence as well as every N/A spelling', () => {
  // No Issue / Date / Res lines at all: all three are required and all three fail.
  const bare = eng.validateTicket(ticket({ RootCauseDetails: ['SID: DAB5', 'Cnt: 1'].join('\n') }), CTX);
  assert.deepEqual(keys(bare), ['Date', 'Issue', 'Res']);
  eng.REQUIRED_FIELDS.forEach(k => assert.equal(bare.fields[k], 'N/A', k + ' is stored as N/A'));
});

// ---- Engine: skips and whole-ticket acceptance ----
test('a ticket the contractor marked Error gets no result', () => {
  const rows = [ticket({ ShortId: 'T1', Title: 'bad title' }), ticket({ ShortId: 'T2', Title: 'bad title' })];
  const out = eng.validateRows(rows, CTX, { markStatus: new Map([['T1', 'error']]) });
  assert.equal(out.has('T1'), false);
  assert.equal(out.get('T2').ok, false);
});

test('only the tickets whose claim the upload has seen are validated', () => {
  const rows = [ticket({ ShortId: 'MARKED', Title: 'bad title' }), ticket({ ShortId: 'UNMARKED', Title: 'bad title' })];
  const out = eng.validateRows(rows, CTX, { claimed: ['MARKED'] });
  assert.deepEqual(Array.from(out.keys()), ['MARKED']);
  assert.equal(out.get('MARKED').ok, false);
  assert.equal(eng.validateRows(rows, CTX, { claimed: [] }).size, 0);
});

test('the claim statuses are the ones the tracker uses', () => {
  assert.deepEqual(eng.CLAIM_STATUSES.slice(), Object.keys(require('./sanitization-assign').CLAIMS));
});

test('a ticket the owner approved as an error gets no result', () => {
  const out = eng.validateRows([ticket({ Title: 'bad title' })], CTX, { approvedError: [{ shortId: 'T1' }] });
  assert.equal(out.size, 0);
});

test('a ticket the owner accepted as a sanitized error is never validated again', () => {
  const rcd = ['Issue: Theft', 'SID: DAB5', 'Cnt: abc', 'Zip: 90001', 'Res: Coaching'].join('\n');
  const rows = [ticket({ RootCauseDetails: rcd })];
  assert.deepEqual(keys(eng.validateRows(rows, CTX, {}).get('T1')), ['Cnt', 'Date']);
  // A Set of ids, a list of ids and a list of accept docs all mean the same thing.
  [new Set(['T1']), ['T1'], [{ shortId: 'T1', acceptedBy: 'harisss' }]].forEach(accepted => {
    assert.equal(eng.validateRows(rows, CTX, { accepted }).size, 0);
  });
  // ...and the acceptance is per ticket: another ticket keeps being checked.
  const two = eng.validateRows(rows.concat([ticket({ ShortId: 'T2', RootCauseDetails: rcd })]), CTX, { accepted: ['T1'] });
  assert.deepEqual(Array.from(two.keys()), ['T2']);
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
// Claims the uploads below (stamped 2026-03-01 / 2026-03-05) have already seen: only claimed tickets
// are validated, so every store fixture marks its tickets the way a contractor would.
const claims = (ids, at) => ids.map(id => ({ login: 'urmahala', shortId: id, status: 'successful', at: at || '2026-02-10T00:00:00.000Z' }));
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
    marks: claims(['BAD', 'OK', 'NOT-ASSIGNED']), approved: [], accepted: new Set(), types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
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
    marks: [{ shortId: 'ERR', login: 'urmahala', status: 'error', at: '2026-02-01T00:00:00.000Z' }].concat(claims(['APV'])),
    approved: [{ shortId: 'APV' }], types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
  assert.equal(out.validated, 0);
  assert.equal(out.ops, 0);
  assert.equal(coll.calls.length, 0);
});

test('runValidation writes nothing for an assigned ticket the contractor has not marked yet', async () => {
  const rows = [ticket({ ShortId: 'OPEN', Title: 'nothing valid' }), ticket({ ShortId: 'PENDING', Title: 'nothing valid' }),
    ticket({ ShortId: 'BACK', Title: 'nothing valid' })];
  const coll = fakeColl();
  const out = await store.runValidation({ validationColl: coll, ticketRows: rows, assignments: asg(['OPEN', 'PENDING', 'BACK']),
    // OPEN: never marked. PENDING: claimed AFTER this upload. BACK: sent back for rework, no claim.
    marks: claims(['PENDING'], '2026-03-02T00:00:00.000Z').concat([{ login: 'urmahala', shortId: 'BACK', status: 'returned',
      at: '2026-02-05T00:00:00.000Z', returnedAt: '2026-02-20T00:00:00.000Z' }]),
    approved: [], types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
  assert.deepEqual({ validated: out.validated, flagged: out.flagged, ops: out.ops }, { validated: 0, flagged: 0, ops: 0 });
  assert.equal(coll.calls.length, 0);
});

test('claimedIds takes only the claims the upload has already seen', () => {
  const marks = claims(['SEEN']).concat(claims(['LATER'], '2026-03-02T00:00:00.000Z'),
    [{ login: 'urmahala', shortId: 'ERR', status: 'error', at: '2026-02-10T00:00:00.000Z' },
      { login: 'urmahala', shortId: 'BACK', status: 'returned', at: '2026-02-10T00:00:00.000Z' },
      { login: 'urmahala', shortId: 'OLD', status: 'completed', at: '2026-02-10T00:00:00.000Z' }]);
  assert.deepEqual(Array.from(store.claimedIds(marks, '2026-03-01T10:00:00.000Z')), ['SEEN']);
  assert.equal(store.claimedIds(marks, null).size, 0);
  // A newer claim replaces an older one: the newest mark decides.
  const re = claims(['SEEN']).concat([{ login: 'urmahala', shortId: 'SEEN', status: 'error', at: '2026-02-20T00:00:00.000Z' }]);
  assert.equal(store.claimedIds(re, '2026-03-01T10:00:00.000Z').size, 0);
});

test('a newer upload refreshes detectedAt on a ticket that is still flagged', async () => {
  const rows = [ticket({ ShortId: 'BAD', Title: 'nothing valid' })];
  const deps = { ticketRows: rows, assignments: asg(['BAD']), marks: claims(['BAD']), approved: [], types: TYPES };
  const first = fakeColl(), second = fakeColl();
  await store.runValidation({ ...deps, validationColl: first, stamp: '2026-03-01T10:00:00.000Z' });
  await store.runValidation({ ...deps, validationColl: second, stamp: '2026-03-05T08:30:00.000Z' });
  assert.equal(upserts(first)[0].updateOne.update.$set.detectedAt, '2026-03-01T10:00:00.000Z');
  assert.equal(upserts(second)[0].updateOne.update.$set.detectedAt, '2026-03-05T08:30:00.000Z');
});

test('acceptedSet reads the accept docs and an accepted ticket gets neither an upsert nor a delete', async () => {
  const coll = fakeColl();
  const rcd = ['Issue: Theft', 'SID: DAB5', 'Cnt: abc', 'Zip: 90001', 'Res: Coaching', 'Date: 2026-01-15'].join('\n');
  // _id, shortId and a bare string are all accepted shapes.
  const accepted = store.acceptedSet([{ _id: 'BAD', shortId: 'BAD', acceptedBy: 'harisss' }, { _id: 'GONE' }, 'ALSO']);
  assert.deepEqual(Array.from(accepted).sort(), ['ALSO', 'BAD', 'GONE']);
  const out = await store.runValidation({ validationColl: coll, ticketRows: [ticket({ ShortId: 'BAD', RootCauseDetails: rcd })],
    assignments: asg(['BAD']), marks: claims(['BAD']), approved: [], accepted, types: TYPES, stamp: '2026-03-01T10:00:00.000Z' });
  assert.deepEqual({ validated: out.validated, flagged: out.flagged, ops: out.ops }, { validated: 0, flagged: 0, ops: 0 });
  assert.equal(coll.calls.length, 0);
  assert.equal(store.acceptedSet(null).size, 0);
});

test('only ACTIVE assignments are in scope and the newest mark decides', () => {
  assert.deepEqual(Array.from(store.assignedIds(asg(['A', 'B']))).sort(), ['A', 'B']);
  assert.equal(store.assignedIds(asg(['A'], 'revoked')).size, 0);
  const marks = [{ shortId: 'A', status: 'error', at: '2026-02-01T00:00:00.000Z' },
    { shortId: 'A', status: 'duplicate', at: '2026-02-09T00:00:00.000Z' }];
  assert.equal(store.markStatusMap(marks).get('A'), 'duplicate');
});
