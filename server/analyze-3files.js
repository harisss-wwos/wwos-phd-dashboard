// READ-ONLY: analyze the 3 report CSVs before a full rebuild.
// Reports: rows per file, ShortId overlap across files, total UNIQUE tickets (dedup by ShortId,
// keep newest LastUpdatedDate), per-quarter breakdown, and rows missing a ShortId/CreateDate.
const fs = require('fs');
const { quarterOf } = require('./quarters');
function parseCSV(text){const rows=[];let i=0,f='',row=[],q=false;text=text.replace(/^\uFEFF/,'');while(i<text.length){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}if(c==='"'){q=true;i++;continue;}if(c===','){row.push(f);f='';i++;continue;}if(c==='\r'){i++;continue;}if(c==='\n'){row.push(f);rows.push(row);row=[];f='';i++;continue;}f+=c;i++;}if(f.length||row.length){row.push(f);rows.push(row);}if(!rows.length)return[];const h=rows[0];return rows.slice(1).filter(r=>r.length&&r.some(x=>x!=='')).map(r=>{const o={};h.forEach((k,idx)=>o[k]=r[idx]!=null?r[idx]:'');return o;});}
const FILES = [
  ['01', 'c:\\Kiro\\01_Data report for Jan 1st 2021 to March 31st 2026.csv'],
  ['02', 'c:\\Kiro\\02_Data report for April 1st 2026 to July 31st 2026.csv'],
  ['03', 'c:\\Kiro\\03_Data report from August 1st.csv'],
];
function sidOf(t){return String((t&&(t.ShortId||t.IssueId))||'').trim();}
function ludMs(v){const d=new Date(v);return isNaN(d)?null:d.getTime();}

const combined = new Map();      // sid -> { row, files:Set }
let totalRows=0, noSid=0, noDate=0, dupAcross=0;
const perFileUnique={};
for (const [label,f] of FILES){
  const rows=parseCSV(fs.readFileSync(f,'utf8'));
  perFileUnique[label]=new Set();
  for (const r of rows){
    totalRows++;
    const sid=sidOf(r); if(!sid){ noSid++; continue; }
    perFileUnique[label].add(sid);
    if(!quarterOf(r.CreateDate)) noDate++;
    const prev=combined.get(sid);
    if(!prev){ combined.set(sid,{row:r,files:new Set([label])}); continue; }
    prev.files.add(label); dupAcross++;
    const a=ludMs(r.LastUpdatedDate), b=ludMs(prev.row.LastUpdatedDate);
    if(a!=null&&(b==null||a>=b)) prev.row=r;
  }
  console.log('File',label,'-> rows:',rows.length,'unique ShortIds:',perFileUnique[label].size);
}
console.log('\nTotal rows (all 3):',totalRows);
console.log('Rows with NO ShortId/IssueId (skipped):',noSid);
console.log('Rows with unparseable CreateDate:',noDate);
console.log('ShortIds seen in >1 file (overlap events):',dupAcross);
console.log('UNIQUE tickets to write:',combined.size);

// Per-quarter breakdown of what will be written.
const byQ={};
for (const [sid,v] of combined){ const q=quarterOf(v.row.CreateDate)||'(undated)'; byQ[q]=(byQ[q]||0)+1; }
console.log('\nPer-quarter tickets to write:');
Object.keys(byQ).sort().forEach(q=>console.log('  ',q, byQ[q]));

// Column set present (first file header).
const hdr = Object.keys(parseCSV(fs.readFileSync(FILES[0][1],'utf8'))[0]||{});
console.log('\nColumns:', hdr.join(', '));
