// Merge alpha/beta/gamma team CSVs into ticket_docs (PRODUCTION WRITE).
//   ADD    : CSV ShortId missing in DB -> insert (quarter from CreateDate).
//   UPDATE : CSV newer-or-equal LastUpdatedDate AND any merge field changed -> overwrite 10 fields + 3 timestamps.
//   DELETE : cross-quarter duplicate ShortIds -> keep the copy whose quarter matches its CreateDate, delete the other.
// Backs up EVERY affected doc (updated/deleted) to a timestamped JSON before writing, for rollback.
require('dotenv').config();
const fs = require('fs');
const { getCollection, COLLECTIONS } = require('./db');
const { quarterOf } = require('./quarters');

const CSV_FILES = ['c:\\Kiro\\alpha team data.csv', 'c:\\Kiro\\beta team data.csv', 'c:\\Kiro\\gamma team data.csv'];
const MERGE_FIELDS = ['Title', 'Status', 'Severity', 'AssigneeIdentity', 'ResolvedDate', 'Age', 'ClosureCode', 'ResolvedByIdentity', 'RootCause', 'RootCauseDetails'];
const TS_FIELDS = ['LastAssignedDate', 'LastUpdatedConversationDate', 'LastUpdatedDate'];

function parseCSV(text) {
  const rows = []; let i = 0, field = '', row = [], inQ = false; text = text.replace(/^\uFEFF/, '');
  while (i < text.length) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return []; const header = rows[0];
  return rows.slice(1).filter(r => r.length && r.some(x => x !== '')).map(r => { const o = {}; header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ''; }); return o; });
}
function sidOf(t) { return String((t && (t.ShortId || t.IssueId)) || '').trim(); }
function ludMs(v) { const d = new Date(v); return isNaN(d) ? null : d.getTime(); }
function docId(q, sid) { return q + '|' + sid; }

(async () => {
  // Load + combine CSV rows (dedupe by ShortId, keep newest LastUpdatedDate).
  const csvMap = new Map();
  for (const f of CSV_FILES) {
    for (const r of parseCSV(fs.readFileSync(f, 'utf8'))) {
      const sid = sidOf(r); if (!sid) continue;
      if (!r.ShortId && r.IssueId) r.ShortId = r.IssueId;
      const prev = csvMap.get(sid);
      if (!prev) { csvMap.set(sid, r); continue; }
      const a = ludMs(r.LastUpdatedDate), b = ludMs(prev.LastUpdatedDate);
      if (a != null && (b == null || a >= b)) csvMap.set(sid, r);
    }
  }
  const coll = await getCollection(COLLECTIONS.ticketDocs);
  const dbDocs = await coll.find({}).toArray();
  const dbBySid = new Map();
  dbDocs.forEach(d => { const sid = sidOf(d); if (!sid) return; if (!dbBySid.has(sid)) dbBySid.set(sid, []); dbBySid.get(sid).push(d); });

  const backup = { at: new Date().toISOString(), updated: [], deleted: [] };
  const upserts = [];   // {replaceOne}
  const deletes = [];   // _id
  let adds = 0, updates = 0, dupDeletes = 0, unchanged = 0;

  // ADD / UPDATE from CSV.
  for (const [sid, nr] of csvMap) {
    const q = quarterOf(nr.CreateDate); if (!q) continue;   // skip undated (shouldn't happen)
    const docs = dbBySid.get(sid);
    const old = docs && (docs.find(d => d.q === q) || docs[0]) || null;
    if (!old) {
      const doc = Object.assign({}, nr, { q, _id: docId(q, sid) });
      upserts.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      adds++; continue;
    }
    const a = ludMs(nr.LastUpdatedDate), b = ludMs(old.LastUpdatedDate);
    const notOlder = (a != null) && (b == null || a >= b);
    if (!notOlder) { unchanged++; continue; }
    const changed = MERGE_FIELDS.some(fld => String(nr[fld] == null ? '' : nr[fld]) !== String(old[fld] == null ? '' : old[fld]));
    if (!changed) { unchanged++; continue; }
    backup.updated.push(old);                               // snapshot before overwrite
    const merged = Object.assign({}, old);
    MERGE_FIELDS.forEach(fld => { merged[fld] = nr[fld]; });
    TS_FIELDS.forEach(fld => { if (nr[fld] !== undefined) merged[fld] = nr[fld]; });
    upserts.push({ replaceOne: { filter: { _id: old._id }, replacement: merged, upsert: true } });
    updates++;
  }

  // DELETE cross-quarter duplicates: keep the copy whose q matches quarterOf(CreateDate), delete others.
  for (const [sid, docs] of dbBySid) {
    if (docs.length < 2) continue;
    // Prefer the copy whose stored q equals its own CreateDate quarter; else keep the first.
    let keep = docs.find(d => d.q === quarterOf(d.CreateDate)) || docs[0];
    docs.forEach(d => { if (d._id !== keep._id) { backup.deleted.push(d); deletes.push(d._id); dupDeletes++; } });
  }

  // Write backup BEFORE any DB change.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = 'c:\\Kiro\\merge-backup-' + stamp + '.json';
  fs.writeFileSync(backupPath, JSON.stringify(backup));
  console.log('Backup written:', backupPath, '(updated:', backup.updated.length, 'deleted:', backup.deleted.length + ')');

  console.log('Planned -> ADD:', adds, 'UPDATE:', updates, 'DUP-DELETE:', dupDeletes, 'UNCHANGED:', unchanged);

  // Execute: upserts in batches, then deletes.
  let done = 0;
  for (let k = 0; k < upserts.length; k += 500) {
    await coll.bulkWrite(upserts.slice(k, k + 500), { ordered: false });
    done += Math.min(500, upserts.length - k);
    console.log('  upserted', done, '/', upserts.length);
  }
  if (deletes.length) { await coll.deleteMany({ _id: { $in: deletes } }); console.log('  deleted', deletes.length, 'duplicate docs'); }

  const finalCount = await coll.countDocuments({});
  console.log('DONE. ticket_docs total now:', finalCount);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
