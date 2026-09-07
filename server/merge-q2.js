// Merge the Q2 CSV (7,102 tickets) into DB quarter 2026-Q2 by ShortId.
// CSV (newly uploaded) version wins on conflict; DB-only tickets are preserved.
// Usage: node merge-q2.js "<csv>"
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getCollection, COLLECTIONS } = require('./db');
const { quarterLabel } = require('./quarters');

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
  const QID = '2026-Q2';
  const abs = path.resolve(process.argv[2]);
  const csvRows = parseCSV(fs.readFileSync(abs, 'utf-8'))
    .filter(r => r.ShortId || r.IssueId)
    .map(r => { if (!r.ShortId && r.IssueId) r.ShortId = r.IssueId; return r; });

  const coll = await getCollection(COLLECTIONS.quarters);
  const existing = await coll.findOne({ _id: QID });
  const dbTickets = (existing && existing.data && existing.data.tickets) || [];

  // Build merged map keyed by ShortId. Start with DB tickets, then apply CSV (CSV wins).
  const map = new Map();
  dbTickets.forEach(t => { const id = String(t.ShortId || t.IssueId || '').trim(); if (id) map.set(id, t); });
  const beforeDbUnique = map.size;

  let added = 0, updated = 0;
  csvRows.forEach(t => {
    const id = String(t.ShortId).trim(); if (!id) return;
    if (map.has(id)) { updated++; } else { added++; }
    map.set(id, t); // CSV wins
  });

  const merged = Array.from(map.values());
  const now = new Date().toISOString();
  const changeSummary = {
    source: path.basename(abs),
    csvTickets: csvRows.length,
    dbBefore: beforeDbUnique,
    added,        // new tickets that were not in DB
    updated,      // overlapping tickets overwritten by CSV
    preserved: beforeDbUnique - updated, // DB tickets kept (not in CSV)
    total: merged.length,
  };

  const meta = { publishedBy: 'q2-backfill', publishedAt: now, count: merged.length, changeSummary };
  const payload = { updatedAt: now, count: merged.length, tickets: merged };
  await coll.updateOne({ _id: QID }, { $set: { data: payload, meta } }, { upsert: true });

  console.log(`Merged into ${QID} (${quarterLabel(QID)}):`);
  console.log(JSON.stringify(changeSummary, null, 2));
  console.log(`\nFinal ${QID} ticket count: ${merged.length}`);
  process.exit(0);
})().catch(e => { console.error('Merge failed:', e.message); process.exit(1); });
