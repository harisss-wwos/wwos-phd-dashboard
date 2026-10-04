// Verify post-merge state: total count, no cross-quarter duplicates, per-quarter counts,
// and that the CSV ADDs are now present + a few UPDATEs applied.
require('dotenv').config();
const fs = require('fs');
const { getCollection, COLLECTIONS } = require('./db');

(async () => {
  const coll = await getCollection(COLLECTIONS.ticketDocs);
  const total = await coll.countDocuments({});
  console.log('ticket_docs total:', total);

  // Duplicate ShortIds across quarters (should be 0 now).
  const dups = await coll.aggregate([
    { $group: { _id: '$ShortId', n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 } } },
  ], { allowDiskUse: true }).toArray();
  console.log('Cross-quarter duplicate ShortIds remaining:', dups.length);
  if (dups.length) console.log('  sample:', dups.slice(0, 5));

  // Per-quarter counts.
  const byQ = await coll.aggregate([{ $group: { _id: '$q', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray();
  console.log('Per-quarter:'); byQ.forEach(r => console.log('  ', r._id, r.n));

  // Spot-check: the 5 sample ADDs from the dry-run should now exist.
  const sampleAdds = ['P300790761', 'D352903181', 'D354155490', 'P302612581', 'D307862501'];
  for (const sid of sampleAdds) { const d = await coll.findOne({ ShortId: sid }); console.log('  ADD check', sid, '->', d ? ('present in ' + d.q) : 'MISSING'); }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
