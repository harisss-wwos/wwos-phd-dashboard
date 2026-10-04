// FULL REBUILD (PRODUCTION WRITE): wipe ticket_docs and rebuild entirely from the 3 report CSVs.
// Backs up the ENTIRE current ticket_docs collection to JSON first (rollback safety).
// DB after this = exactly the union of the 3 files (dedup by ShortId, keep newest LastUpdatedDate).
require('dotenv').config();
const fs = require('fs');
const { getCollection, COLLECTIONS } = require('./db');
const { quarterOf } = require('./quarters');
function parseCSV(text){const rows=[];let i=0,f='',row=[],q=false;text=text.replace(/^\uFEFF/,'');while(i<text.length){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}if(c==='"'){q=true;i++;continue;}if(c===','){row.push(f);f='';i++;continue;}if(c==='\r'){i++;continue;}if(c==='\n'){row.push(f);rows.push(row);row=[];f='';i++;continue;}f+=c;i++;}if(f.length||row.length){row.push(f);rows.push(row);}if(!rows.length)return[];const h=rows[0];return rows.slice(1).filter(r=>r.length&&r.some(x=>x!=='')).map(r=>{const o={};h.forEach((k,idx)=>o[k]=r[idx]!=null?r[idx]:'');return o;});}
const FILES = [
  'c:\\Kiro\\01_Data report for Jan 1st 2021 to March 31st 2026.csv',
  'c:\\Kiro\\02_Data report for April 1st 2026 to July 31st 2026.csv',
  'c:\\Kiro\\03_Data report from August 1st.csv',
];
function sidOf(t){return String((t&&(t.ShortId||t.IssueId))||'').trim();}
function ludMs(v){const d=new Date(v);return isNaN(d)?null:d.getTime();}

(async () => {
  const coll = await getCollection(COLLECTIONS.ticketDocs);

  // 1) BACKUP the entire current collection.
  const before = await coll.find({}).toArray();
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath = 'c:\\Kiro\\ticket_docs-full-backup-'+stamp+'.json';
  fs.writeFileSync(backupPath, JSON.stringify(before));
  console.log('Backed up', before.length, 'existing ticket_docs ->', backupPath);

  // 2) Build the union of the 3 files (dedup by ShortId, keep newest LastUpdatedDate).
  const map = new Map();
  for (const f of FILES){
    for (const r of parseCSV(fs.readFileSync(f,'utf8'))){
      const sid = sidOf(r); if(!sid) continue;
      if(!r.ShortId && r.IssueId) r.ShortId = r.IssueId;
      const prev = map.get(sid);
      if(!prev){ map.set(sid, r); continue; }
      const a=ludMs(r.LastUpdatedDate), b=ludMs(prev.LastUpdatedDate);
      if(a!=null&&(b==null||a>=b)) map.set(sid, r);
    }
  }
  console.log('Unique tickets from files:', map.size);

  // 3) Build docs keyed <quarter>|<ShortId>.
  const docs = [];
  let undated = 0;
  for (const [sid, r] of map){
    const q = quarterOf(r.CreateDate); if(!q){ undated++; continue; }
    docs.push(Object.assign({}, r, { q, _id: q + '|' + sid }));
  }
  console.log('Docs to insert:', docs.length, '| skipped undated:', undated);

  // 4) WIPE + rebuild.
  const del = await coll.deleteMany({});
  console.log('Wiped', del.deletedCount, 'docs.');
  let done = 0;
  for (let k = 0; k < docs.length; k += 1000){
    const batch = docs.slice(k, k + 1000);
    await coll.insertMany(batch, { ordered: false });
    done += batch.length;
    console.log('  inserted', done, '/', docs.length);
  }
  // Ensure indexes exist (mirror ensureTicketIndexes).
  try{ await coll.createIndex({ q:1 }); await coll.createIndex({ ShortId:1 }); await coll.createIndex({ q:1, Status:1 }); await coll.createIndex({ q:1, AssigneeIdentity:1 }); }catch(e){}

  const finalCount = await coll.countDocuments({});
  console.log('DONE. ticket_docs total now:', finalCount);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
