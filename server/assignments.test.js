// Tests for the top-bar bucket's "is this still waiting for me?" rule and the revoke path that
// shares the older predicate with it (node --test).
// In-memory fixtures and a fake collection only: nothing here touches MongoDB Atlas, and the fake
// records every write so the revoke test can show which documents were touched.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const asg = require('./assignments');

const ME = 'punithsd', BY = 'flofalgu', AT = '2026-11-19T04:22:32.990Z';
// Every registered user login (server.js builds this set from the users collection).
const REGISTERED = new Set(['punithsd', 'flofalgu', 'harisss', 'shaavhad']);
// The LM-CAP identity reaches acTicketStates as a bare UUID; AutoSIM and an empty assignee likewise
// normalise to something that is not a registered login.
const LMCAP = '0d1616c8-bcb7-4450-8bc5-f0a296bc01d1';
// acTicketStates shape for a ticket that is still open, with the SIM assignee of each open doc.
const open = (...logins) => ({ assignees: logins.filter(Boolean), row: { shortId: 'x' } });
const active = (shortId, o) => ({ kind: 'active', _id: asg.activeId(shortId), shortId, assignee: ME, by: BY, at: AT, status: 'pending', ...o });
const bucket = (docs, states) => asg.bucketList(docs, new Map(states), REGISTERED);
const waiting = rows => rows.filter(r => !r.takenBy).map(r => r.shortId);

// ---- bucketList: taken by somebody else ----
test('an open ticket another registered user holds is taken, not waiting, and names the holder', () => {
  const rows = bucket([active('V2463259558')], [['V2463259558', open('flofalgu')]]);
  assert.deepEqual(rows, [{ shortId: 'V2463259558', assignee: ME, by: BY, at: AT, takenBy: 'flofalgu' }]);
  assert.deepEqual(waiting(rows), []);
});

test('the row stays listed, so the agent still sees who assigned it and who took it', () => {
  const rows = bucket([active('V2463632681')], [['V2463632681', open('shaavhad')]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].by, BY);            // assigned by
  assert.equal(rows[0].takenBy, 'shaavhad');   // held by now
});

test('the six stale punithsd tickets are all taken, none waiting', () => {
  const holders = { V2463259558: 'flofalgu', V2463354089: 'flofalgu', V2463392965: 'flofalgu',
    V2463530955: 'harisss', V2463544508: 'harisss', V2463632681: 'shaavhad' };
  const sids = Object.keys(holders);
  const rows = bucket(sids.map(s => active(s)), sids.map(s => [s, open(holders[s])]));
  assert.deepEqual(rows.map(r => r.takenBy), sids.map(s => holders[s]));
  assert.deepEqual(waiting(rows), []);
});

// ---- bucketList: still genuinely waiting ----
test('a ticket nobody holds is waiting', () => {
  const rows = bucket([active('V1')], [['V1', open()]]);
  assert.deepEqual(rows, [{ shortId: 'V1', assignee: ME, by: BY, at: AT, takenBy: '' }]);
});

test('LM-CAP, AutoSIM and a blank identity are not a holder: the ticket keeps counting as waiting', () => {
  [LMCAP, 'autosim', ''].forEach(id => {
    const rows = bucket([active('V1')], [['V1', open(id)]]);
    assert.deepEqual(waiting(rows), ['V1'], 'identity ' + JSON.stringify(id) + ' should stay waiting');
    assert.equal(rows[0].takenBy, '');
  });
});

test('a ticket the assignee picked up themself is dropped, like before', () => {
  assert.deepEqual(bucket([active('V1')], [['V1', open(ME)]]), []);
});

test('a ticket that is no longer open, or missing from the data, is dropped, like before', () => {
  assert.deepEqual(bucket([active('V1'), active('V2')], [['V1', null]]), []);
});

test('a revoked active document is never listed', () => {
  assert.deepEqual(bucket([active('V1', { status: 'revoked' })], [['V1', open('flofalgu')]]), []);
});

test('one bucket mixes waiting and taken rows in input order', () => {
  const rows = bucket(
    [active('V1'), active('V2'), active('V3'), active('V4')],
    [['V1', open('harisss')], ['V2', open()], ['V3', open(ME)], ['V4', open(LMCAP)]]);
  assert.deepEqual(rows.map(r => [r.shortId, r.takenBy]), [['V1', 'harisss'], ['V2', ''], ['V4', '']]);
  assert.deepEqual(waiting(rows), ['V2', 'V4']);
});

// ---- the shared predicate still lets revoke release a taken-by-other ticket ----
test('assignmentStatus keeps calling a taken-by-other assignment pending, so revoke can release it', () => {
  const a = { assignee: ME };
  assert.equal(asg.assignmentStatus(a, open('flofalgu')), 'pending');
  assert.equal(asg.assignmentStatus(a, open(ME)), 'picked');
  assert.equal(asg.assignmentStatus(a, null), 'resolved');
});

// Minimal in-memory stand-in for the ticket_assignments collection: equality, $in and $exists only.
function fakeColl(docs) {
  const match = (d, q) => Object.keys(q).every(k => {
    const c = q[k], v = d[k];
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      if ('$in' in c) return c.$in.some(x => String(x) === String(v));
      if ('$exists' in c) return (v !== undefined) === c.$exists;
    }
    return String(v) === String(c);
  });
  const writes = [];
  return {
    docs, writes,
    async findOne(q) { return docs.find(d => match(d, q)) || null; },
    find(q) { return { sort: () => ({ limit: () => ({ async toArray() { return docs.filter(d => match(d, q)); } }) }), async toArray() { return docs.filter(d => match(d, q)); } }; },
    async updateOne(q, u) {
      const d = docs.find(x => match(x, q));
      if (!d) return { modifiedCount: 0 };
      Object.assign(d, u.$set); writes.push({ _id: d._id, set: u.$set });
      return { modifiedCount: 1 };
    },
    async insertOne(d) { d._id = d._id || 'new'; docs.push(d); writes.push({ insert: d }); return { insertedId: d._id }; },
  };
}

test('revoke still releases a ticket somebody else has taken', async () => {
  const logId = 'log1';
  const entry = { _id: logId, kind: 'log', at: AT, by: BY, assignee: ME, group: 'BLR', section: 'Sev 3',
    tickets: [{ shortId: 'V2463259558', title: 'taken by flofalgu' }, { shortId: 'V1', title: 'nobody has it' }], count: 2 };
  const coll = fakeColl([entry, active('V2463259558', { logId }), active('V1', { logId })]);
  const out = await asg.handleRevoke({ logId }, {
    coll, user: { username: BY }, toId: s => s,
    states: async sids => new Map(sids.map(s => [s, s === 'V2463259558' ? open('flofalgu') : open()])),
    now: () => new Date('2026-11-24T00:00:00.000Z'),
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.revoked.sort(), ['V1', 'V2463259558']);
  assert.deepEqual(out.body.skipped, []);
  assert.equal(coll.docs.find(d => d._id === asg.activeId('V2463259558')).status, 'revoked');
});

test('revoke still skips a ticket the assignee picked up, and one already resolved', async () => {
  const logId = 'log2';
  const entry = { _id: logId, kind: 'log', at: AT, by: BY, assignee: ME,
    tickets: [{ shortId: 'VP' }, { shortId: 'VR' }], count: 2 };
  const coll = fakeColl([entry, active('VP', { logId }), active('VR', { logId })]);
  const out = await asg.handleRevoke({ logId }, {
    coll, user: { username: BY }, toId: s => s,
    states: async () => new Map([['VP', open(ME)]]),
    now: () => new Date('2026-11-24T00:00:00.000Z'),
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.revoked, []);
  assert.deepEqual(out.body.skipped.sort(), ['VP', 'VR']);
});
