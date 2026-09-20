// After a direct ticket_docs write, mark the affected quarters' rollups stale so they rebuild on read.
// We bump meta.publishedAt on each affected quarter doc; the endpoints recompute when publishedAt
// no longer matches the cached rollup. (Analytics quarter/window/overall endpoints aggregate live, so
// they need nothing.) Live-quarter dash/group/agent/shift rollups then rebuild on next dashboard hit.
require('dotenv').config();
const { getCollection, COLLECTIONS } = require('./db');

(async () => {
  const qColl = await getCollection(COLLECTIONS.quarters);
  const t = await getCollection(COLLECTIONS.ticketDocs);
  const now = new Date().toISOString();
  // Full rebuild touched every quarter -> bump ALL distinct quarters present in ticket_docs.
  const AFFECTED = (await t.distinct('q')).filter(Boolean).sort();
  for (const qid of AFFECTED) {
    const r = await qColl.updateOne({ _id: qid }, { $set: { 'meta.publishedAt': now } });
    console.log(qid, 'publishedAt bumped ->', now, '(matched:', r.matchedCount + ')');
  }
  // Also count per-quarter ticket_docs so we can sanity-check.
  for (const qid of AFFECTED) console.log(qid, 'ticket_docs:', await t.countDocuments({ q: qid }));
  console.log('Rollups will rebuild on next read (dashboard/analytics).');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
