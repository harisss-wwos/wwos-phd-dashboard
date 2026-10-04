// PRODUCTION WRITE (additive only): add newer columns onto existing ticket_docs.
// Source files (all have LastAssignedDate): SEP 2025->Mar 2026, file 02, file 03.
// For each ShortId, set the fields that file 01 lacked: AssignedGroup, LastAssignedDate,
// LastUpdatedConversationDate, LastUpdatedDate, Labels. Matches existing docs by ShortId only.
// Does NOT insert, delete, or change any other field / the ticket set.
require('dotenv').config();
const fs = require('fs');
const { getCollection, COLLECTIONS } = require('./db');
function parseCSV(text){const rows=[];let i=0,f='',row=[],q=false;text=text.replace(/^\uFEFF/,'');while(i<text.length){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}if(c==='"'){q=true;i++;continue;}if(c===','){row.push(f);f='';i++;continue;}if(c==='\r'){i++;continue;}if(c==='\n'){row.push(f);rows.push(row);row=[];f='';i++;continue;}f+=c;i++;}if(f.length||row.length){row.push(f);rows.push(row);}if(!rows.length)return[];const h=rows[0];return rows.slice(1).filter(r=>r.length&&r.some(x=>x!=='')).map(r=>{const o={};h.forEach((k,idx)=>o[k]=r[idx]!=null?r[idx]:'');return o;});}
const FILES = [
  'c:\\Kiro\\Data from September 1st 2025 to March 31st 2026.csv',
  'c:\\Kiro\\02_Data report for April 1st 2026 to July 31st 2026.csv',
  'c:\\Kiro\\03_Data report from August 1st.csv',
];
const NEW_FIELDS = ['AssignedGroup','LastAssignedDate','LastUpdatedConversationDate','LastUpdatedDate','Labels'];
function ludMs(v){const d=new Date(v);return isNaN(d)?null:d.getTime();}

(async () => {
  const t = await getCollection(COLLECTIONS.ticketDocs);

  // 1) Build ShortId -> newest row (dedup across files by LastUpdatedDate).
  const bySid = new Map();
  for (const f of FILES){
    for (const r of parseCSV(fs.readFileSync(f,'utf8'))){
      const sid = String(r.ShortId || r.IssueId || '').trim(); if(!sid) continue;
      const prev = bySid.get(sid);
      if(!prev){ bySid.set(sid, r); continue; }
      const a = ludMs(r.LastUpdatedDate), b = ludMs(prev.LastUpdatedDate);
      if (a != null && (b == null || a >= b)) bySid.set(sid, r);
    }
  }
  console.log('Unique ShortIds to update:', bySid.size);

  // 2) Bulk updateMany by ShortId, setting only the new fields (skip blank values).
  const ops = [];
  for (const [sid, r] of bySid){
    const set = {};
    for (const k of NEW_FIELDS){ const v = (r[k] != null ? String(r[k]) : '').trim(); if (v !== '') set[k] = r[k]; }
    if (Object.keys(set).length === 0) continue;
    ops.push({ updateMany: { filter: { ShortId: sid }, update: { $set: set } } });
  }
  console.log('Update ops:', ops.length);

  let modified = 0, matched = 0;
  for (let i = 0; i < ops.length; i += 1000){
    const res = await t.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    matched += res.matchedCount || 0; modified += res.modifiedCount || 0;
    console.log('  batch', (i/1000)+1, '-> matched', matched, 'modified', modified);
  }

  // 3) Verify: how many docs now have a non-empty LastAssignedDate, and range.
  const withLad = await t.countDocuments({ LastAssignedDate: { $exists: true, $nin: [null, ''] } });
  console.log('\nDONE. matched:', matched, 'modified:', modified);
  console.log('ticket_docs with LastAssignedDate now:', withLad);
  // ensure index for fast LAD-scoped queries
  try { await t.createIndex({ AssigneeIdentity: 1, LastAssignedDate: 1 }); console.log('index (AssigneeIdentity, LastAssignedDate) ok'); } catch(e){ console.log('index err', e.message); }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
