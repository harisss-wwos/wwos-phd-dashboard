// Per-file grand totals for the 7 agents x 6 codes, to see which file/range matches target 4955.
const fs = require('fs');
function parseCSV(text){const rows=[];let i=0,f='',row=[],q=false;text=text.replace(/^\uFEFF/,'');while(i<text.length){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}if(c==='"'){q=true;i++;continue;}if(c===','){row.push(f);f='';i++;continue;}if(c==='\r'){i++;continue;}if(c==='\n'){row.push(f);rows.push(row);row=[];f='';i++;continue;}f+=c;i++;}if(f.length||row.length){row.push(f);rows.push(row);}if(!rows.length)return[];const h=rows[0];return rows.slice(1).filter(r=>r.length&&r.some(x=>x!=='')).map(r=>{const o={};h.forEach((k,idx)=>o[k]=r[idx]!=null?r[idx]:'');return o;});}
const FILES = {
  '01 (2021->Mar2026)': 'c:\\Kiro\\01_Data report for Jan 1st 2021 to March 31st 2026.csv',
  '02 (Apr->Jul 2026)': 'c:\\Kiro\\02_Data report for April 1st 2026 to July 31st 2026.csv',
  '03 (Aug 2026->)':    'c:\\Kiro\\03_Data report from August 1st.csv',
};
const AGENTS=['punithsd','harisss','arunkzn','mbozied','flofalgu','nobregak','mellanej'];
const CODES=['Automatically Closed','Duplicate','Immediately Resolved','Successful','Successful with Problems','Unsuccessful'];
for (const [label,f] of Object.entries(FILES)){
  const rows=parseCSV(fs.readFileSync(f,'utf8'));
  let n=0; const per={}; AGENTS.forEach(a=>per[a]=0);
  rows.forEach(r=>{const a=String(r.ResolvedByIdentity||'').trim().toLowerCase();const c=String(r.ClosureCode||'').trim();if(AGENTS.indexOf(a)>=0&&CODES.indexOf(c)>=0){n++;per[a]++;}});
  console.log(label,'rows:',rows.length,'| matching(agent+code):',n);
  console.log('   per-agent:',AGENTS.map(a=>a+'='+per[a]).join(' '));
}
