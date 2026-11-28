// SIM Tag Tracker (sim-tags.html): GET /api/sim-tags?page=&pageSize=.
// One row per ticket_docs ticket that carries at least one SIM tag, most-tagged first, with the
// distinct tag tally beside it. The tags come from the AutoSIM rules through the normal CSV upload,
// in the `Tags` column.
//
// OWNER ONLY: harisss and nobody else (isOwner, the same gate the sanitization scores use). The gate
// lives here, on the route, so hiding the page or its nav entry is presentation only — a direct call
// with any other account gets 403 and no ticket data at all.
//
// THE TAG LIST IS NEVER HARDCODED. The distinct tags are grouped out of the data itself, so a tag
// from a rule the owner deploys next week shows up on the page with no code change.
//
// EVERYTHING IS AGGREGATED INSIDE MONGODB. The collection holds ~80k tickets and ~7k of them carry a
// tag; shipping that set to Node to count and sort it in JavaScript is the bug that cost three other
// endpoints 2-5 minutes each on this cluster (commits 3d8dbcb / baf2bb8 — the Atlas link runs at
// roughly 70 KB/s). So: $match on a non-empty Tags value, project ONLY the fields the page renders,
// split and count the tags with $size, $sort and paginate with $skip/$limit, and tally the distinct
// tags with $unwind/$group — all in one $facet, which returns ONE document (the page's rows, the tag
// tally and the total). Title is fetched afterwards for the page's rows ALONE (titlesPipeline), never
// for the whole tagged set: Title and RootCauseDetails are the two largest fields in ticket_docs, and
// RootCauseDetails is never read here at all.
//
// Pure (no DB I/O of its own): every dependency (user, coll) is injected by server.js, so the
// pipelines and the access rules are unit-testable against a fake collection.
'use strict';
const { isOwner } = require('./sanitization-score');   // OWNER = 'harisss'

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const URL_BASE = 'https://t.corp.amazon.com/issues/';   // IssueUrl of a ticket = this + ShortId

// Tickets that carry a Tags value at all. Deliberately coarse (missing / null / empty string out):
// whitespace-only and empty-array values are dropped by the tagCount match below, once the value has
// been split, so no shape slips through and no second pass in Node is needed.
const HAS_TAGS = { Tags: { $exists: true, $nin: [null, ''] } };

// Today's data holds one tag per ticket as a plain string ("driver_type_flex_dp"), but the column is
// free CSV text, so all three shapes are handled in the pipeline: an array, a separated list
// (comma, semicolon or newline) and a single tag. $trim drops the padding a list leaves behind and
// $filter drops the empties, so "a, ,b," yields exactly ['a','b'].
const TAG_LIST = {
  $let: {
    vars: {
      raw: {
        $cond: [
          { $isArray: '$Tags' },
          '$Tags',
          { $split: [
            { $replaceAll: { input: { $replaceAll: { input: { $toString: '$Tags' }, find: ';', replacement: ',' } }, find: '\n', replacement: ',' } },
            ',',
          ] },
        ],
      },
    },
    in: {
      $filter: {
        input: { $map: { input: '$$raw', as: 't', in: { $trim: { input: { $toString: '$$t' } } } } },
        as: 't',
        cond: { $and: [{ $ne: ['$$t', null] }, { $ne: ['$$t', ''] }] },
      },
    },
  },
};

// SORT: most tags first (that is the point of the page), then the newest created ticket, then the
// ticket id. The id makes the order total, so paging can never repeat or skip a row when two tickets
// share a tag count and a created time.
const SORT = { tagCount: -1, created: -1, ShortId: 1 };

function parsePage(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function parsePageSize(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

// The one pipeline the page costs: the rows of the asked-for page, the distinct tag tally and the
// total, as a SINGLE document. _id rides along so the titles of these rows (and only these rows) can
// be read afterwards; CreateDate is mixed Date / string in this collection, so $convert normalises it
// to a date for the sort (onError/onNull null, the idiom used elsewhere in server.js).
function pagePipeline(opts) {
  const o = opts || {};
  const skip = Math.max(0, Math.floor(Number(o.skip) || 0));
  const limit = parsePageSize(o.limit);
  return [
    { $match: HAS_TAGS },
    { $project: {
      _id: 1,
      ShortId: 1,
      created: { $convert: { input: '$CreateDate', to: 'date', onError: null, onNull: null } },
      tags: TAG_LIST,
    } },
    { $addFields: { tagCount: { $size: '$tags' } } },
    { $match: { tagCount: { $gte: 1 } } },
    { $facet: {
      rows: [{ $sort: SORT }, { $skip: skip }, { $limit: limit }],
      tags: [{ $unwind: '$tags' }, { $group: { _id: '$tags', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }],
      total: [{ $count: 'n' }],
    } },
  ];
}

// Titles for the page's rows ALONE (at most pageSize ids). Keyed on _id rather than ShortId because
// a ticket_docs _id is '<quarter>|<ShortId>' and the same ShortId can exist in two quarters.
function titlesPipeline(ids) {
  return [
    { $match: { _id: { $in: (ids || []).slice() } } },
    { $project: { _id: 1, Title: 1 } },
  ];
}

// GET /api/sim-tags. deps: { user:{username}, coll }. 401 without a session, 403 for anyone but the
// owner, and in both cases the collection is never touched.
async function handleGet(query, deps) {
  const q = query || {};
  const user = deps && deps.user;
  if (!user) return { status: 401, body: { error: 'Login required.' } };
  if (!isOwner(user.username)) return { status: 403, body: { error: 'The SIM Tag Tracker is visible only to harisss.' } };

  const pageSize = parsePageSize(q.pageSize);
  const page = parsePage(q.page);
  const facet = (await deps.coll.aggregate(pagePipeline({ skip: (page - 1) * pageSize, limit: pageSize })).toArray())[0] || {};
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const tags = (Array.isArray(facet.tags) ? facet.tags : []).map(t => ({ tag: String(t._id), count: t.n || 0 }));
  const total = (Array.isArray(facet.total) && facet.total[0] && facet.total[0].n) || 0;

  const titles = new Map();
  if (rows.length) {
    const docs = await deps.coll.aggregate(titlesPipeline(rows.map(r => r._id))).toArray();
    (docs || []).forEach(d => titles.set(String(d._id), String(d.Title == null ? '' : d.Title)));
  }

  return { status: 200, body: {
    page, pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    tagCount: tags.length,
    tags,
    rows: rows.map(r => ({
      shortId: String(r.ShortId == null ? '' : r.ShortId),
      url: r.ShortId ? (URL_BASE + r.ShortId) : '',
      title: titles.get(String(r._id)) || '',
      created: r.created || null,
      tags: Array.isArray(r.tags) ? r.tags : [],
      tagCount: r.tagCount || 0,
    })),
  } };
}

module.exports = {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, URL_BASE, HAS_TAGS, TAG_LIST, SORT,
  parsePage, parsePageSize, pagePipeline, titlesPipeline, handleGet,
};
