// READ-ONLY dry-run: compare alpha/beta/gamma team CSVs against ticket_docs.
// Reports would-add / would-update / duplicate ShortIds / DB-only tickets. Writes NOTHING to the DB.
// Exports DB-only tickets to c:\Kiro\db-only-tickets.csv for review.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getCollection, COLLECTIONS } = require('./db');
const { quarterOf } = require('./quarters');

const CSV_FILES = [
  'c:\\Kiro\\alpha team data.csv',
  'c:\\Kiro\\beta team data.csv',
  'c:\\Kiro\\gamma team data.csv',
];
const MERGE_FIELDS = ['Title', 'Status', 'Severity', 'AssigneeIdentity', 'ResolvedDate', 'Age', 'ClosureCode', 'ResolvedByIdentity', 'RootCause', 'RootCauseDetails'];

// --- Minimal CSV parser (handles quoted fields, commas, embedded newlines, "" escapes) ---
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  text = text.replace(/^\uFEFF/, ''); // strip BOM
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.length && r.some(x => x !== '')).map(r => {
    const o = {}; header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ''; }); return o;
  });
}

function sidOf(t) { return String((t && (t.ShortId || t.IssueId)) || '').trim(); }
function ludMs(v) { const d = new Date(v); return isNaN(d) ? null : d.getTime(); }

(async () => {
  // 1) Load + combine CSV rows (dedupe within CSVs, keep the newest LastUpdatedDate per ShortId).
  const csvMap = new Map(); // sid -> row
  let csvTotal = 0, csvDupWithin = 0;
  for (const f of CSV_FILES) {
    const rows = parseCSV(fs.readFileSync(f, 'utf8'));
    for (const r of rows) {
      const sid = sidOf(r); if (!sid) continue;
      csvTotal++;
      const prev = csvMap.get(sid);
      if (!prev) { csvMap.set(sid, r); continue; }
      csvDupWithin++;
      // keep the row with the newer LastUpdatedDate
      const a = ludMs(r.LastUpdatedDate), b = ludMs(prev.LastUpdatedDate);
      if (a != null && (b == null || a >= b)) csvMap.set(sid, r);
    }
  }
  console.log('CSV rows read (all 3):', csvTotal);
  console.log('CSV duplicate ShortIds (within/across files):', csvDupWithin);
  console.log('CSV unique ShortIds:', csvMap.size);

  // 2) Load all ticket_docs from DB (only fields we need).
  const coll = await getCollection(COLLECTIONS.ticketDocs);
  const proj = { q: 1, ShortId: 1, IssueId: 1, Status: 1, CreateDate: 1, LastUpdatedDate: 1 };
  MERGE_FIELDS.forEach(f => { proj[f] = 1; });
  const dbDocs = await coll.find({}, { projection: proj }).toArray();
  console.log('DB ticket_docs total:', dbDocs.length);

  // Group DB docs by ShortId to detect cross-quarter duplicates.
  const dbBySid = new Map(); // sid -> [docs]
  dbDocs.forEach(d => { const sid = sidOf(d); if (!sid) return; if (!dbBySid.has(sid)) dbBySid.set(sid, []); dbBySid.get(sid).push(d); });

  // 3) Duplicates in DB = same ShortId stored under >1 _id (i.e. >1 quarter).
  const dbDuplicates = [];
  for (const [sid, docs] of dbBySid) { if (docs.length > 1) dbDuplicates.push({ sid, ids: docs.map(d => d._id) }); }

  // 4) Compare CSV -> DB: would-add / would-update.
  let wouldAdd = 0, wouldUpdate = 0, unchanged = 0, olderIgnored = 0;
  const addList = [], updateList = [];
  for (const [sid, nr] of csvMap) {
    const q = quarterOf(nr.CreateDate);
    const docs = dbBySid.get(sid);
    const old = docs && docs.find(d => d.q === q) || (docs && docs[0]) || null;
    if (!old) { wouldAdd++; addList.push({ sid, q, status: nr.Status }); continue; }
    const a = ludMs(nr.LastUpdatedDate), b = ludMs(old.LastUpdatedDate);
    const notOlder = (a != null) && (b == null || a >= b);
    if (!notOlder) { olderIgnored++; continue; }
    const changed = MERGE_FIELDS.some(fld => String(nr[fld] == null ? '' : nr[fld]) !== String(old[fld] == null ? '' : old[fld]));
    if (changed) { wouldUpdate++; updateList.push({ sid, q, from: old.Status, to: nr.Status }); }
    else unchanged++;
  }

  // 5) DB tickets NOT in any CSV (report only — never delete).
  const dbOnly = dbDocs.filter(d => !csvMap.has(sidOf(d)));

  console.log('\n=== DRY RUN SUMMARY (no writes) ===');
  console.log('Would ADD (in CSV, missing in DB):', wouldAdd);
  console.log('Would UPDATE (newer + changed field):', wouldUpdate);
  console.log('Unchanged (already current):', unchanged);
  console.log('Ignored (CSV older than DB):', olderIgnored);
  console.log('DB duplicate ShortIds (same id in >1 quarter):', dbDuplicates.length);
  console.log('DB tickets NOT in any CSV (report only):', dbOnly.length);

  // Sample a few of each for eyeballing.
  console.log('\nSample ADD:', addList.slice(0, 5));
  console.log('Sample UPDATE:', updateList.slice(0, 5));
  console.log('Sample DB duplicates:', dbDuplicates.slice(0, 10));

  // Export DB-only tickets to CSV — use the ALREADY-LOADED docs (no slow re-query).
  if (dbOnly.length) {
    const cols = ['q', 'ShortId', 'IssueId', 'Title', 'Status', 'CreateDate', 'Severity', 'AssigneeIdentity', 'ResolvedDate', 'Age', 'ClosureCode', 'ResolvedByIdentity', 'RootCause', 'RootCauseDetails', 'LastUpdatedDate'];
    const csvEsc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const out = [cols.join(',')].concat(dbOnly.map(r => cols.map(c => csvEsc(r[c])).join(','))).join('\n');
    fs.writeFileSync('c:\\Kiro\\db-only-tickets.csv', out);
    console.log('\nExported', dbOnly.length, 'DB-only tickets -> c:\\Kiro\\db-only-tickets.csv');
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
