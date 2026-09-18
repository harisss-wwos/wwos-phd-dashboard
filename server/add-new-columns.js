// PRODUCTION WRITE (additive only): backfill the newer CSV columns onto existing tickets.
// New columns: Labels, RequesterIdentity, Tags.
//
// For each ShortId found in the provided CSV file(s), set those of the NEW_FIELDS that the CSV
// actually contains (skips blank values). Matches existing docs by ShortId ONLY.
// Does NOT insert, delete, or change any other field or the ticket set.
//
// Updates BOTH stores so the change reflects everywhere the app reads:
//   1) ticket_docs  (primary per-ticket store the app reassembles quarters from)
//   2) quarters.data.tickets[]  (legacy arrays, for any quarter not yet split into ticket_docs)
//
// Usage (from phd-pages/server):
//   node add-new-columns.js "c:\path\to\file1.csv" "c:\path\to\file2.csv" ...
//   node add-new-columns.js --dry "c:\path\to\file.csv"     (dry run: report only, no writes)
require('dotenv').config();
const fs = require('fs');
const { getCollection, COLLECTIONS } = require('./db');

// RFC-4180-ish CSV parser (handles quoted commas/newlines + "" escapes + BOM).
function parseCSV(text){const rows=[];let i=0,f='',row=[],q=false;text=text.replace(/^\uFEFF/,'');while(i<text.length){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}if(c==='"'){q=true;i++;continue;}if(c===','){row.push(f);f='';i++;continue;}if(c==='\r'){i++;continue;}if(c==='\n'){row.push(f);rows.push(row);row=[];f='';i++;continue;}f+=c;i++;}if(f.length||row.length){row.push(f);rows.push(row);}if(!rows.length)return{headers:[],rows:[]};const h=rows[0].map(x=>String(x||'').trim());return{headers:h,rows:rows.slice(1).filter(r=>r.length&&r.some(x=>x!=='')).map(r=>{const o={};h.forEach((k,idx)=>o[k]=r[idx]!=null?r[idx]:'');return o;})};}

const NEW_FIELDS = ['Labels','RequesterIdentity','Tags'];
function ludMs(v){const d=new Date(v);return isNaN(d)?null:d.getTime();}

(async () => {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry');
  const files = args.filter(a => a !== '--dry');
  if (!files.length) {
    console.error('No CSV file(s) provided.\nUsage: node add-new-columns.js [--dry] "<file1.csv>" ["<file2.csv>" ...]');
    process.exit(1);
  }

  // Which of the new fields are actually present across the provided files.
  const presentFields = new Set();

  // 1) Build ShortId -> newest row across all files (dedup by LastUpdatedDate).
  const bySid = new Map();
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error('MISSING FILE:', f); process.exit(1); }
    const { headers, rows } = parseCSV(fs.readFileSync(f, 'utf8'));
    NEW_FIELDS.forEach(k => { if (headers.includes(k)) presentFields.add(k); });
    console.log(`Read ${rows.length} rows from ${f}`);
    console.log('  new columns in this file:', NEW_FIELDS.filter(k => headers.includes(k)).join(', ') || '(none)');
    for (const r of rows) {
      const sid = String(r.ShortId || r.IssueId || '').trim(); if (!sid) continue;
      const prev = bySid.get(sid);
      if (!prev) { bySid.set(sid, r); continue; }
      const a = ludMs(r.LastUpdatedDate), b = ludMs(prev.LastUpdatedDate);
      if (a != null && (b == null || a >= b)) bySid.set(sid, r);
    }
  }

  const fields = NEW_FIELDS.filter(k => presentFields.has(k));
  console.log('\nUnique ShortIds in CSV(s):', bySid.size);
  console.log('New fields to backfill (present in CSV):', fields.join(', ') || '(none)');
  if (!fields.length) { console.error('None of the new columns (Labels/RequesterIdentity/Tags) are present in the CSV(s). Nothing to do.'); process.exit(1); }

  // 2) ticket_docs: bulk updateMany by ShortId, $set only the present new fields (skip blanks).
  const t = await getCollection(COLLECTIONS.ticketDocs);
  const ops = [];
  for (const [sid, r] of bySid) {
    const set = {};
    for (const k of fields) { const v = (r[k] != null ? String(r[k]) : '').trim(); if (v !== '') set[k] = r[k]; }
    if (Object.keys(set).length === 0) continue;
    ops.push({ updateMany: { filter: { ShortId: sid }, update: { $set: set } } });
  }
  console.log('ticket_docs update ops (ShortIds with >=1 non-blank new value):', ops.length);

  let matched = 0, modified = 0;
  if (!DRY) {
    for (let i = 0; i < ops.length; i += 1000) {
      const res = await t.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      matched += res.matchedCount || 0; modified += res.modifiedCount || 0;
      console.log('  ticket_docs batch', (i/1000)+1, '-> matched', matched, 'modified', modified);
    }
  } else {
    console.log('  [DRY] skipped ticket_docs writes');
  }

  // 3) Legacy quarters.data.tickets[] arrays: patch in place for any quarter not split into ticket_docs.
  const qColl = await getCollection(COLLECTIONS.quarters);
  const qDocs = await qColl.find({ 'data.tickets': { $exists: true, $ne: [] } }, { projection: { _id: 1, 'data.tickets': 1 } }).toArray();
  let legacyQuarters = 0, legacyRows = 0;
  for (const doc of qDocs) {
    const arr = (doc.data && doc.data.tickets) || [];
    if (!arr.length) continue;
    let touched = 0;
    for (const tk of arr) {
      const sid = String(tk.ShortId || tk.IssueId || '').trim(); if (!sid) continue;
      const src = bySid.get(sid); if (!src) continue;
      let rowChanged = false;
      for (const k of fields) {
        const v = (src[k] != null ? String(src[k]) : '').trim();
        if (v !== '' && String(tk[k] == null ? '' : tk[k]) !== String(src[k])) { tk[k] = src[k]; rowChanged = true; }
      }
      if (rowChanged) touched++;
    }
    if (touched) {
      legacyQuarters++; legacyRows += touched;
      if (!DRY) await qColl.updateOne({ _id: doc._id }, { $set: { 'data.tickets': arr } });
      console.log(`  legacy quarter ${doc._id}: ${touched} row(s) ${DRY ? '(dry)' : 'updated'}`);
    }
  }

  // 4) Verify counts in ticket_docs for each backfilled field.
  console.log('\nDONE.' + (DRY ? ' (DRY RUN — no writes performed)' : ''));
  console.log('ticket_docs matched:', matched, 'modified:', modified);
  console.log('legacy quarters touched:', legacyQuarters, 'legacy rows touched:', legacyRows);
  for (const k of fields) {
    const filter = {}; filter[k] = { $exists: true, $nin: [null, ''] };
    const n = await t.countDocuments(filter);
    console.log(`ticket_docs with non-empty ${k}:`, n);
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
