// Load a CSV of tickets into Atlas as a quarter dataset.
// Usage: node load-quarter.js "<path-to-csv>" [quarterId]
//   If quarterId omitted, it is inferred from the majority CreateDate quarter.
// Stores { _id: quarterId, data: { tickets, count, updatedAt }, meta } in the `quarters` collection.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getCollection, COLLECTIONS } = require('./db');
const { quarterOf, quarterLabel } = require('./quarters');

function parseCSV(text) {
  const cells = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (inQ && text[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
    else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQ) { if (ch === '\r' && text[i + 1] === '\n') i++; cells.push(cur); cur = ''; cells.push('__RE__'); }
    else { cur += ch; }
  }
  if (cur) cells.push(cur); cells.push('__RE__');
  const rows = []; let row = [];
  for (const c of cells) { if (c === '__RE__') { if (row.length > 0) rows.push(row); row = []; } else { row.push(c); } }
  const h = rows[0]; const d = [];
  for (let i = 1; i < rows.length; i++) { const o = {}; for (let j = 0; j < h.length; j++) o[h[j]] = rows[i][j] || ''; d.push(o); }
  return d;
}

(async () => {
  const csvPath = process.argv[2];
  let quarterId = process.argv[3];
  if (!csvPath) { console.error('Usage: node load-quarter.js "<csv>" [quarterId]'); process.exit(1); }
  const abs = path.resolve(csvPath);
  const text = fs.readFileSync(abs, 'utf-8');
  let rows = parseCSV(text).filter(r => r.ShortId || r.IssueId).map(r => { if (!r.ShortId && r.IssueId) r.ShortId = r.IssueId; return r; });
  console.log('parsed rows:', rows.length);

  // Infer quarter if not given: majority CreateDate quarter.
  if (!quarterId) {
    const tally = {};
    rows.forEach(r => { const q = quarterOf(r.CreateDate); if (q) tally[q] = (tally[q] || 0) + 1; });
    quarterId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    console.log('inferred quarter:', quarterId, '(distribution:', JSON.stringify(tally) + ')');
  }

  // Report how many rows fall outside the target quarter (informational).
  let inQ = 0, outQ = 0;
  rows.forEach(r => { (quarterOf(r.CreateDate) === quarterId ? inQ++ : outQ++); });
  console.log(`rows in ${quarterId}: ${inQ}, outside: ${outQ}`);

  const coll = await getCollection(COLLECTIONS.quarters);
  const meta = { publishedBy: 'loader', publishedAt: new Date().toISOString(), count: rows.length };
  const payload = { updatedAt: meta.publishedAt, count: rows.length, tickets: rows };
  await coll.updateOne({ _id: quarterId }, { $set: { data: payload, meta } }, { upsert: true });
  console.log(`\nLoaded ${rows.length} tickets into quarter ${quarterId} (${quarterLabel(quarterId)}).`);
  process.exit(0);
})().catch(e => { console.error('Load failed:', e.message); process.exit(1); });
