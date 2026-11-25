// Tests for the team leave calendar's access + marking rules, its 2026-12-01..2027-03-31 date range
// and the two handlers (node --test).
// In-memory fixtures and a fake collection only: nothing here touches MongoDB Atlas, and the fake
// records every write so a refused call can be shown to have written nothing at all.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const leave = require('./leave');

const OWNER = 'harisss';
const BLR = ['harisss', 'punithsd', 'arunkzn', 'flofalgu'];
const AZA = ['mbozied', 'nobregak', 'mellanej'];
const WFH = ['tanviroo', 'urmahala', 'chousoud', 'obalasut', 'shaavhad', 'dbiswamb'];
const MGR = ['ashamzon', 'wehnermi'];
const ALL = BLR.concat(AZA, WFH, MGR);
const OUTSIDERS = ['megmyer', 'ivanajs', ''];
const NOW = '2026-11-28T06:15:00.000Z';
const doc = (login, date, by) => ({ _id: leave.leaveId(login, date), login, date, by: by || login, at: NOW });

// Minimal in-memory stand-in for the team_leave collection: _id equality only, every mutation kept.
function fakeColl(docs) {
  const list = (docs || []).slice(), writes = [];
  return {
    docs: list, writes,
    find() { return { async toArray() { return list.slice(); } }; },
    async findOne(q) { return list.find(d => String(d._id) === String(q._id)) || null; },
    async updateOne(filter, update, options) {
      writes.push({ updateOne: { filter, update, options } });
      const d = list.find(x => String(x._id) === String(filter._id));
      if (d) Object.assign(d, update.$set); else list.push({ _id: filter._id, ...update.$set });
      return { ok: 1 };
    },
    async deleteOne(filter) {
      writes.push({ deleteOne: { filter } });
      const i = list.findIndex(x => String(x._id) === String(filter._id));
      if (i >= 0) list.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    async countDocuments() { return list.length; },
  };
}
const deps = (user, coll) => ({ user: { username: user }, coll, now: () => new Date(NOW) });

// ---- the member set comes out of ASSIGN_GROUPS ----
test('the 15 accounts are the 13 analysts from ASSIGN_GROUPS plus the 2 managers', () => {
  assert.equal(leave.MEMBERS.length, 15);
  assert.deepEqual(leave.MEMBERS.map(m => m.login).slice().sort(), ALL.slice().sort());
  const byGroup = g => leave.MEMBERS.filter(m => m.group === g).map(m => m.login).sort();
  assert.deepEqual(byGroup('BLR'), BLR.slice().sort());
  assert.deepEqual(byGroup('AZA'), AZA.slice().sort());
  assert.deepEqual(byGroup('WFH'), WFH.slice().sort());
  assert.deepEqual(byGroup('MGR'), MGR.slice().sort());
});

test('hasAccess is the 15 and nobody else, and ignores case and padding', () => {
  ALL.forEach(l => assert.equal(leave.hasAccess(l), true, l));
  assert.equal(leave.hasAccess(' Tanviroo '), true);
  OUTSIDERS.concat([null, undefined, 'megmyer ']).forEach(l => assert.equal(leave.hasAccess(l), false, String(l)));
});

// ---- the date range ----
test('leaveDates covers 2026-12-01..2027-03-31 as 121 days', () => {
  const dates = leave.leaveDates();
  assert.equal(dates.length, 121);
  assert.equal(dates[0], '2026-12-01');
  assert.equal(dates[dates.length - 1], '2027-03-31');
  assert.equal(leave.RANGE_FROM, '2026-12-01');
  assert.equal(leave.RANGE_TO, '2027-03-31');
  assert.deepEqual(dates.slice().sort(), dates, 'the days come out in order');
  assert.equal(new Set(dates).size, 121, 'no day is repeated');
  const count = p => dates.filter(d => d.startsWith(p)).length;
  assert.deepEqual([count('2026-12'), count('2027-01'), count('2027-02'), count('2027-03')], [31, 31, 28, 31]);
});

test('validDate takes a real day inside the range and nothing else', () => {
  ['2026-12-01', '2027-03-31', '2026-12-25', '2027-02-28'].forEach(d => assert.equal(leave.validDate(d), true, d));
  ['2026-11-30', '2027-04-01', '2027-02-29', '', '2027-1-5', '2026-12-32', '2026-13-01', 'tomorrow', null, 20261201]
    .forEach(d => assert.equal(leave.validDate(d), false, String(d)));
});

test('a date that has already passed is still markable while it is inside the range', () => {
  // The range opens in the past relative to nothing: there is no "future only" rule, by design.
  assert.equal(leave.validDate('2026-12-02'), true);
});

test('leaveId is <login>|<date>, normalised', () => {
  assert.equal(leave.leaveId('Tanviroo', '2026-12-01'), 'tanviroo|2026-12-01');
});

// ---- canMark truth table ----
test('everyone in the 15 marks themselves', () => {
  ALL.forEach(l => assert.equal(leave.canMark(l, l), true, l));
});

test('a BLR or AZA member marks the two managers but not another analyst', () => {
  assert.equal(leave.canMark('punithsd', 'ashamzon'), true);
  assert.equal(leave.canMark('punithsd', 'wehnermi'), true);
  assert.equal(leave.canMark('mbozied', 'ashamzon'), true);
  assert.equal(leave.canMark('punithsd', 'tanviroo'), false);
  assert.equal(leave.canMark('punithsd', 'arunkzn'), false);
});

test('a WFH member marks only themselves', () => {
  assert.equal(leave.canMark('tanviroo', 'tanviroo'), true);
  assert.equal(leave.canMark('tanviroo', 'obalasut'), false);
  assert.equal(leave.canMark('tanviroo', 'ashamzon'), false);
  assert.equal(leave.canMark('tanviroo', 'wehnermi'), false);
});

test('the owner marks all 15', () => {
  ALL.forEach(l => assert.equal(leave.canMark(OWNER, l), true, l));
  assert.deepEqual(leave.canMarkList(OWNER).slice().sort(), ALL.slice().sort());
});

test('a manager marks only themselves, not the other manager', () => {
  assert.equal(leave.canMark('ashamzon', 'wehnermi'), false);
  assert.equal(leave.canMark('wehnermi', 'ashamzon'), false);
  assert.equal(leave.canMark('ashamzon', 'ashamzon'), true);
});

test('anyone outside the 15 is refused as actor and as target', () => {
  OUTSIDERS.forEach(o => {
    assert.equal(leave.canMark(o, o), false, o + ' -> self');
    assert.equal(leave.canMark(o, 'tanviroo'), false, o + ' -> tanviroo');
    assert.equal(leave.canMark(OWNER, o), false, 'owner -> ' + o);
    assert.equal(leave.canMark('punithsd', o), false, 'punithsd -> ' + o);
  });
});

test('canMarkList is self for WFH, self + the managers for BLR and AZA, self for a manager', () => {
  assert.deepEqual(leave.canMarkList('tanviroo'), ['tanviroo']);
  assert.deepEqual(leave.canMarkList('punithsd').slice().sort(), ['ashamzon', 'punithsd', 'wehnermi']);
  assert.deepEqual(leave.canMarkList('mellanej').slice().sort(), ['ashamzon', 'mellanej', 'wehnermi']);
  assert.deepEqual(leave.canMarkList('ashamzon'), ['ashamzon']);
  assert.deepEqual(leave.canMarkList('megmyer'), []);
});

// ---- handleMark ----
test('a refused pair gets 403 and writes nothing', async () => {
  const coll = fakeColl();
  const out = await leave.handleMark({ login: 'obalasut', date: '2026-12-01', on: true }, deps('tanviroo', coll));
  assert.equal(out.status, 403);
  assert.ok(out.body.error);
  assert.deepEqual(coll.writes, []);
  assert.equal(coll.docs.length, 0);
});

test('an outsider gets 403 on their own leave and writes nothing', async () => {
  const coll = fakeColl();
  const out = await leave.handleMark({ login: 'megmyer', date: '2026-12-01', on: true }, deps('megmyer', coll));
  assert.equal(out.status, 403);
  assert.deepEqual(coll.writes, []);
});

test('a date outside the range or a non-date gets 400 and writes nothing', async () => {
  for (const date of ['2026-11-30', '2027-04-01', '2027-02-29', '', '2027-1-5']) {
    const coll = fakeColl();
    const out = await leave.handleMark({ login: 'tanviroo', date, on: true }, deps('tanviroo', coll));
    assert.equal(out.status, 400, date);
    assert.deepEqual(coll.writes, [], date);
  }
});

test('marking own leave upserts exactly one doc', async () => {
  const coll = fakeColl();
  const out = await leave.handleMark({ login: 'tanviroo', date: '2026-12-10', on: true }, deps('tanviroo', coll));
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, login: 'tanviroo', date: '2026-12-10', on: true });
  assert.equal(coll.writes.length, 1);
  assert.deepEqual(coll.writes[0], { updateOne: {
    filter: { _id: 'tanviroo|2026-12-10' },
    update: { $set: { login: 'tanviroo', date: '2026-12-10', by: 'tanviroo', at: NOW } },
    options: { upsert: true },
  } });
});

test('an omitted login means the caller themselves', async () => {
  const coll = fakeColl();
  const out = await leave.handleMark({ date: '2026-12-10', on: true }, deps('tanviroo', coll));
  assert.equal(out.status, 200);
  assert.equal(out.body.login, 'tanviroo');
});

test('marking the same day twice stays one doc (the upsert is idempotent)', async () => {
  const coll = fakeColl();
  await leave.handleMark({ login: 'tanviroo', date: '2026-12-10', on: true }, deps('tanviroo', coll));
  await leave.handleMark({ login: 'tanviroo', date: '2026-12-10', on: true }, deps('tanviroo', coll));
  assert.equal(coll.docs.length, 1);
});

test('unmarking deletes exactly one doc by _id', async () => {
  const coll = fakeColl([doc('tanviroo', '2026-12-10'), doc('urmahala', '2026-12-10')]);
  const out = await leave.handleMark({ login: 'tanviroo', date: '2026-12-10', on: false }, deps('tanviroo', coll));
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, login: 'tanviroo', date: '2026-12-10', on: false });
  assert.deepEqual(coll.writes, [{ deleteOne: { filter: { _id: 'tanviroo|2026-12-10' } } }]);
  assert.deepEqual(coll.docs.map(d => d._id), ['urmahala|2026-12-10']);
});

test('a BLR member marks a manager, and the mark records who did it', async () => {
  const coll = fakeColl();
  const out = await leave.handleMark({ login: 'ashamzon', date: '2027-03-31', on: true }, deps('punithsd', coll));
  assert.equal(out.status, 200);
  assert.equal(coll.docs[0].login, 'ashamzon');
  assert.equal(coll.docs[0].by, 'punithsd');
});

test('the owner marks a WFH analyst', async () => {
  const coll = fakeColl();
  const out = await leave.handleMark({ login: 'obalasut', date: '2027-01-15', on: true }, deps(OWNER, coll));
  assert.equal(out.status, 200);
  assert.equal(coll.writes.length, 1);
});

// ---- handleGet ----
test('handleGet gives an outsider 403', async () => {
  const coll = fakeColl([doc('tanviroo', '2026-12-10')]);
  const out = await leave.handleGet({}, deps('megmyer', coll));
  assert.equal(out.status, 403);
  assert.ok(out.body.error);
});

test('handleGet gives an anonymous caller 403', async () => {
  const out = await leave.handleGet({}, { user: null, coll: fakeColl() });
  assert.equal(out.status, 403);
});

test('every viewer with access sees the whole team, the range and their own canMark list', async () => {
  const coll = fakeColl([doc('tanviroo', '2026-12-10'), doc('ashamzon', '2027-02-02', 'punithsd')]);
  const out = await leave.handleGet({}, deps('tanviroo', coll));
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.range, { from: '2026-12-01', to: '2027-03-31' });
  assert.equal(out.body.dates.length, 121);
  assert.equal(out.body.members.length, 15);
  assert.deepEqual(out.body.me, { login: 'tanviroo', group: 'WFH', canMark: ['tanviroo'] });
  assert.deepEqual(out.body.leave, [
    { login: 'tanviroo', date: '2026-12-10', by: 'tanviroo', at: NOW },
    { login: 'ashamzon', date: '2027-02-02', by: 'punithsd', at: NOW },
  ]);
});

test('handleGet reads only: it writes nothing', async () => {
  const coll = fakeColl([doc('tanviroo', '2026-12-10')]);
  await leave.handleGet({}, deps(OWNER, coll));
  assert.deepEqual(coll.writes, []);
});
