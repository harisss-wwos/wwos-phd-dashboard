// Tests for the SIM Tag Tracker's owner-only gate and, above all, for WHERE the work happens: the
// stage list of the one pipeline the page costs, so the match, the tag split, the count, the sort and
// the pagination are proven to run inside MongoDB rather than in Node (node --test).
// In-memory fixtures and a fake collection only: nothing here touches MongoDB Atlas, and the fake
// records every call so "Node never holds the tagged set" can be asserted instead of assumed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const simTags = require('./sim-tags');

const OWNER = 'harisss';
const ADMINS = ['punithsd', 'arunkzn', 'flofalgu', 'mbozied', 'nobregak', 'mellanej'];
const CONTRACTORS = ['tanviroo', 'urmahala', 'chousoud', 'obalasut', 'shaavhad', 'dbiswamb'];
const USERS = ['megmyer', 'ivanajs'];

// Minimal stand-in for ticket_docs. It answers ONLY aggregate(): a find() or a countDocuments() would
// be the very bug these tests exist to catch, so they are not implemented and would throw.
function fakeColl(facetDoc, titleDocs) {
  const calls = [];
  return {
    calls,
    aggregate(pipeline) {
      calls.push(pipeline);
      const isTitles = pipeline.length === 2 && pipeline[1].$project && pipeline[1].$project.Title === 1;
      const out = isTitles ? (titleDocs || []) : [facetDoc || {}];
      return { async toArray() { return out; } };
    },
  };
}
const deps = (username, coll) => ({ user: username == null ? null : { username }, coll });
const FACET = {
  rows: [
    { _id: '2026-Q4|P111', ShortId: 'P111', created: new Date('2026-11-27T04:00:00.000Z'), tags: ['weapon_involved', 'physical_contact', 'no_emt_attached'], tagCount: 3 },
    { _id: '2026-Q4|P222', ShortId: 'P222', created: new Date('2026-11-26T04:00:00.000Z'), tags: ['driver_type_flex_dp'], tagCount: 1 },
  ],
  tags: [{ _id: 'pet_incident_auto_resolved', n: 6573 }, { _id: 'driver_type_dsp_da', n: 47 }],
  total: [{ n: 6965 }],
};
const TITLES = [{ _id: '2026-Q4|P111', Title: 'Driver threatened customer' }, { _id: '2026-Q4|P222', Title: 'Parcel left at wrong door' }];

// ---- access: owner only, enforced on the route and not by the UI ----
test('only harisss gets the tracker; every other account gets 403 and no session gets 401', async () => {
  const ok = await simTags.handleGet({}, deps(OWNER, fakeColl(FACET, TITLES)));
  assert.equal(ok.status, 200);
  for (const login of ADMINS.concat(CONTRACTORS, USERS)) {
    const coll = fakeColl(FACET, TITLES);
    const out = await simTags.handleGet({}, deps(login, coll));
    assert.equal(out.status, 403, login);
    assert.equal(coll.calls.length, 0, login + ' must not reach the collection');
    assert.equal(out.body.rows, undefined, login + ' must get no ticket data');
  }
  const anon = fakeColl(FACET, TITLES);
  const out401 = await simTags.handleGet({}, deps(null, anon));
  assert.equal(out401.status, 401);
  assert.equal(anon.calls.length, 0);
});

test('the owner check ignores case and padding, and nothing close to it passes', async () => {
  for (const v of ['harisss', 'HARISSS', ' Harisss ']) {
    assert.equal((await simTags.handleGet({}, deps(v, fakeColl(FACET, TITLES)))).status, 200, v);
  }
  for (const v of ['harisss2', 'haris', 'xharisss', '']) {
    assert.equal((await simTags.handleGet({}, deps(v, fakeColl(FACET, TITLES)))).status, 403, v);
  }
});

// ---- the pipeline: the stage list, in order ----
test('the page is ONE aggregation whose stages are match, project, addFields, match, facet', () => {
  const p = simTags.pagePipeline({ skip: 0, limit: 50 });
  assert.deepEqual(p.map(s => Object.keys(s)[0]), ['$match', '$project', '$addFields', '$match', '$facet']);
});

test('the first $match asks the database for tickets that carry a Tags value', () => {
  const p = simTags.pagePipeline({ skip: 0, limit: 50 });
  assert.deepEqual(p[0], { $match: { Tags: { $exists: true, $nin: [null, ''] } } });
});

test('the $project carries ONLY the fields the page renders - never Title, never RootCauseDetails', () => {
  const proj = simTags.pagePipeline({ skip: 0, limit: 50 })[1].$project;
  assert.deepEqual(Object.keys(proj).sort(), ['ShortId', '_id', 'created', 'tags']);
  assert.equal(proj.Title, undefined);
  assert.equal(proj.RootCauseDetails, undefined);
  // CreateDate is mixed Date / string in this collection, so the sort key is a converted date.
  assert.deepEqual(proj.created, { $convert: { input: '$CreateDate', to: 'date', onError: null, onNull: null } });
});

test('the tag split happens in the pipeline and handles an array, a separated list and one tag', () => {
  const tags = simTags.pagePipeline({ skip: 0, limit: 50 })[1].$project.tags;
  const branch = tags.$let.vars.raw.$cond;
  assert.deepEqual(branch[0], { $isArray: '$Tags' });   // an array is taken as-is
  assert.equal(branch[1], '$Tags');
  assert.ok(branch[2].$split, 'a string value is split in the database');
  assert.equal(branch[2].$split[1], ',');
  const src = JSON.stringify(branch[2].$split[0]);
  assert.ok(src.includes('";"') && src.includes('"\\n"'), 'semicolon and newline become commas first');
  // The padding a list leaves behind is trimmed and the empties dropped, so "a, ,b," -> ['a','b'].
  assert.ok(tags.$let.in.$filter.input.$map.in.$trim, 'each tag is trimmed');
  assert.deepEqual(tags.$let.in.$filter.cond, { $and: [{ $ne: ['$$t', null] }, { $ne: ['$$t', ''] }] });
});

test('the tag count is computed with $size and whitespace-only / empty Tags are dropped there', () => {
  const p = simTags.pagePipeline({ skip: 0, limit: 50 });
  assert.deepEqual(p[2], { $addFields: { tagCount: { $size: '$tags' } } });
  assert.deepEqual(p[3], { $match: { tagCount: { $gte: 1 } } });   // only tagged tickets reach the page
});

test('sort, paginate and the tag tally all run inside the $facet; nothing counts in JavaScript', () => {
  const f = simTags.pagePipeline({ skip: 100, limit: 25 })[4].$facet;
  assert.deepEqual(Object.keys(f).sort(), ['rows', 'tags', 'total']);
  assert.deepEqual(f.rows, [{ $sort: simTags.SORT }, { $skip: 100 }, { $limit: 25 }]);
  assert.deepEqual(f.tags, [
    { $unwind: '$tags' },
    { $group: { _id: '$tags', n: { $sum: 1 } } },
    { $sort: { n: -1, _id: 1 } },
  ]);
  assert.deepEqual(f.total, [{ $count: 'n' }]);
});

test('the sort is most tags first, then newest created, then the ticket id as the tiebreak', () => {
  assert.deepEqual(simTags.SORT, { tagCount: -1, created: -1, ShortId: 1 });
  assert.deepEqual(Object.keys(simTags.SORT), ['tagCount', 'created', 'ShortId']);   // order matters
});

test('the distinct tags are grouped out of the data, so no tag list is hardcoded anywhere', () => {
  const src = require('node:fs').readFileSync(require.resolve('./sim-tags'), 'utf8');
  ['driver_type_dsp_da', 'driver_type_flex_dp', 'no_emt_attached', 'weapon_involved', 'resolution_missing']
    .forEach(t => assert.ok(!src.includes("'" + t + "'"), t + ' must not be hardcoded'));
  const group = simTags.pagePipeline({})[4].$facet.tags[1].$group;
  assert.equal(group._id, '$tags');
});

// ---- the titles of the page's rows, and nothing more ----
test('titles are read for the page rows alone, keyed on _id (a ShortId repeats across quarters)', () => {
  const p = simTags.titlesPipeline(['2026-Q4|P111', '2026-Q3|P111']);
  assert.deepEqual(p.map(s => Object.keys(s)[0]), ['$match', '$project']);
  assert.deepEqual(p[0], { $match: { _id: { $in: ['2026-Q4|P111', '2026-Q3|P111'] } } });
  assert.deepEqual(p[1], { $project: { _id: 1, Title: 1 } });
});

test('a page of rows costs two calls and the title call asks for exactly the rows on the page', async () => {
  const coll = fakeColl(FACET, TITLES);
  await simTags.handleGet({ page: 1, pageSize: 50 }, deps(OWNER, coll));
  assert.equal(coll.calls.length, 2);
  assert.deepEqual(coll.calls[1][0].$match._id.$in, ['2026-Q4|P111', '2026-Q4|P222']);
});

test('an empty page asks for no titles at all', async () => {
  const coll = fakeColl({ rows: [], tags: [], total: [] }, []);
  const out = await simTags.handleGet({ page: 9999 }, deps(OWNER, coll));
  assert.equal(coll.calls.length, 1);
  assert.deepEqual(out.body.rows, []);
  assert.equal(out.body.total, 0);
  assert.equal(out.body.pageCount, 1);
});

// ---- the payload the page renders ----
test('a row carries the four columns the page shows, plus the SIM link built from the ShortId', async () => {
  const out = await simTags.handleGet({}, deps(OWNER, fakeColl(FACET, TITLES)));
  assert.deepEqual(Object.keys(out.body.rows[0]).sort(), ['created', 'shortId', 'tagCount', 'tags', 'title', 'url']);
  assert.deepEqual(out.body.rows[0], {
    shortId: 'P111',
    url: 'https://t.corp.amazon.com/issues/P111',
    title: 'Driver threatened customer',
    created: new Date('2026-11-27T04:00:00.000Z'),
    tags: ['weapon_involved', 'physical_contact', 'no_emt_attached'],
    tagCount: 3,
  });
  assert.equal(out.body.rows[1].title, 'Parcel left at wrong door');
});

test('the tag tally and the totals come straight from the facet', async () => {
  const out = await simTags.handleGet({}, deps(OWNER, fakeColl(FACET, TITLES)));
  assert.deepEqual(out.body.tags, [{ tag: 'pet_incident_auto_resolved', count: 6573 }, { tag: 'driver_type_dsp_da', count: 47 }]);
  assert.equal(out.body.tagCount, 2);
  assert.equal(out.body.total, 6965);
  assert.equal(out.body.pageCount, 140);   // 6965 / 50
});

test('a row whose title did not come back still renders, with an empty title', async () => {
  const out = await simTags.handleGet({}, deps(OWNER, fakeColl(FACET, [TITLES[0]])));
  assert.equal(out.body.rows[1].title, '');
});

// ---- pagination arithmetic ----
test('page and pageSize are clamped, and a junk value falls back to the defaults', () => {
  assert.equal(simTags.parsePage(undefined), 1);
  [0, -4, 'x', null, NaN, ''].forEach(v => assert.equal(simTags.parsePage(v), 1, String(v)));
  assert.equal(simTags.parsePage('7'), 7);
  assert.equal(simTags.parsePageSize(undefined), simTags.DEFAULT_PAGE_SIZE);
  assert.equal(simTags.parsePageSize('25'), 25);
  assert.equal(simTags.parsePageSize(5000), simTags.MAX_PAGE_SIZE);
  [0, -1, 'x', null].forEach(v => assert.equal(simTags.parsePageSize(v), simTags.DEFAULT_PAGE_SIZE, String(v)));
});

test('$skip follows from the asked-for page, and a huge pageSize cannot widen the read', () => {
  const skipOf = (page, size) => simTags.pagePipeline({ skip: (page - 1) * size, limit: size })[4].$facet.rows[1].$skip;
  assert.equal(skipOf(1, 50), 0);
  assert.equal(skipOf(3, 50), 100);
  assert.equal(simTags.pagePipeline({ skip: -5, limit: 50 })[4].$facet.rows[1].$skip, 0);
  assert.equal(simTags.pagePipeline({ skip: 0, limit: 99999 })[4].$facet.rows[2].$limit, simTags.MAX_PAGE_SIZE);
});
