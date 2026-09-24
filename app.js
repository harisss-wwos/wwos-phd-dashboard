// PHD Dashboard - Single File Application
// CSV Parser, Metrics Engine, and UI Renderer

const STORAGE_KEY = 'phd_dashboard_data';
const PHD_AGENTS = ['harisss','shaavhad','flofalgu','punithsd','dbiswamb','arunkzn','tanviroo','obalasut','mellanej','chousoud','mbozied','urmahala','nobregak'];
const GA1 = ['harisss','punithsd','arunkzn','flofalgu'];
const GA2 = ['tanviroo','urmahala','chousoud','obalasut','shaavhad','dbiswamb'];
const GB = ['mbozied','nobregak','mellanej'];
const COLORS = ['#ff9900','#2074d5','#1d8102','#d13212','#1b9cb0','#8c6bb1','#44b9d6','#ec7211','#3ecf4a','#879596','#ffb84d','#5b9bd5','#ff5252'];

// ===== Status ranking for merge logic =====
const STATUS_RANK={'Assigned':1,'Researching':2,'Work In Progress':3,'Pending':4,'Resolved':5,'Closed':6};

// ===== Upload validation: the CSV header MUST contain all of these columns =====
// All columns are mandatory (the upload is blocked unless every one is present).
// Listed alphabetically. Columns added beyond the original 18 are tagged "new" in the popup.
const REQUIRED_COLUMNS=['Age','AssignedGroup','AssigneeIdentity','ClosureCode','CreateDate','IssueId','IssueUrl','Labels','LastAssignedDate','LastUpdatedConversationDate','LastUpdatedDate','RequesterIdentity','ResolvedByIdentity','ResolvedDate','RootCause','RootCauseDetails','Severity','ShortId','Status','Tags','Title'];
// Columns that are newly required (added after the original 18) — flagged with a "new" tag.
const NEW_COLUMNS=new Set(['Labels','RequesterIdentity','Tags']);

// Parse only the header row of a CSV (respects quoted commas), returns trimmed header names.
function parseCSVHeaders(text){
  const cells=[];let cur='';let inQ=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(ch==='"'){if(inQ&&text[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;}}
    else if(ch===','&&!inQ){cells.push(cur);cur='';}
    else if((ch==='\n'||ch==='\r')&&!inQ){break;} // end of first line
    else{cur+=ch;}}
  cells.push(cur);
  return cells.map(h=>String(h||'').trim());
}

// Freshness compare: is date a strictly-or-equally newer than date b? Missing/invalid b => true
// (incoming wins when we have nothing to compare, e.g. legacy tickets without LastUpdatedDate).
function isNewer(a,b){
  const da=new Date(a);const db=new Date(b);
  if(isNaN(db))return true;      // no/invalid stored value -> incoming wins
  if(isNaN(da))return false;     // incoming has no date but stored does -> keep stored
  return da.getTime()>=db.getTime();
}

// Merge rule: the 3 activity timestamps that trigger an update, and the data fields to overwrite.
const TIMESTAMP_FIELDS=['LastAssignedDate','LastUpdatedConversationDate','LastUpdatedDate'];
const MERGE_FIELDS=['Title','Status','Severity','AssigneeIdentity','ResolvedDate','Age','ClosureCode','ResolvedByIdentity','RootCause','RootCauseDetails','Labels','RequesterIdentity','Tags'];
// Normalize a timestamp for equality: same instant => equal; blank/invalid both => equal ('').
function tsNorm(v){ const d=new Date(v); return isNaN(d)?String(v==null?'':v).trim():String(d.getTime()); }
// Did ANY of the 3 activity timestamps change between the incoming row and the stored ticket?
function timestampsChanged(nr,old){
  return TIMESTAMP_FIELDS.some(f=>tsNorm(nr[f])!==tsNorm(old[f]));
}

// Returns { ok, missing:[...] } — case-insensitive/trimmed match of required columns against the header.
function validateColumns(csvText){
  const headers=parseCSVHeaders(csvText);
  const have=new Set(headers.map(h=>h.toLowerCase()));
  const missing=REQUIRED_COLUMNS.filter(c=>!have.has(c.toLowerCase()));
  return { ok: missing.length===0, missing };
}

// Popup: mandatory-columns error. Lists every required column (alphabetical, "new" ones tagged);
// highlights the missing ones. No upload happens.
function showColumnError(missing){
  closeAllPopups();
  const miss=new Set(missing);
  const listHtml=REQUIRED_COLUMNS.map(c=>{
    const bad=miss.has(c);
    const newTag=NEW_COLUMNS.has(c)?' <span style="background:#fbbf24;color:#000;font-size:.66em;font-weight:800;padding:1px 6px;border-radius:9px;text-transform:uppercase;letter-spacing:.4px;vertical-align:middle">new</span>':'';
    return '<li style="display:flex;align-items:center;gap:8px;padding:4px 0;color:'+(bad?'#ff5252':'#4ade80')+'">'
      +(bad?'✗':'✓')+' <span style="font-family:monospace;font-size:.9em">'+c+'</span>'+newTag+(bad?' <span style="color:#ff5252;font-size:.78em">(missing)</span>':'')+'</li>';
  }).join('');
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(ev)=>{if(ev.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px">
    <h2 style="color:#ff5252;font-size:1.2em;margin-bottom:6px">Upload blocked — missing required columns</h2>
    <p style="color:#879596;font-size:.9em;margin-bottom:14px">The file is missing <b style="color:#ff5252">${missing.length}</b> required column${missing.length===1?'':'s'}. All ${REQUIRED_COLUMNS.length} columns below are mandatory. Fix the export and try again — <b>no data was uploaded</b>.</p>
    <ul style="list-style:none;padding:0;margin:0;columns:2;column-gap:24px">${listHtml}</ul>
    <div style="margin-top:20px;text-align:right"><button class="btn" onclick="closeAllPopups()">Close</button></div>
  </div>`;
  document.body.appendChild(overlay);
}

// ===== Shared data store: MongoDB Atlas via the Render API (see api-config.js) =====
// Auth + publish now go through window.PHDAuth / window.PHD_API_BASE.

// Global lock — true while a publish is in progress. Blocks uploads/merges.
let PUBLISHING=false;

// ===== IndexedDB storage =====
const DB_NAME='phd_dashboard_db';const STORE='tickets';const META_STORE='meta';
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,2);req.onupgradeneeded=(e)=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'ShortId'});if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:'key'});};req.onsuccess=(e)=>resolve(e.target.result);req.onerror=(e)=>reject(e.target.error);});}
// Cache metadata: which live quarter + its publishedAt is currently stored in the tickets store.
async function metaGet(key){const db=await openDB();return new Promise((resolve)=>{try{const tx=db.transaction(META_STORE,'readonly');const req=tx.objectStore(META_STORE).get(key);req.onsuccess=()=>resolve(req.result?req.result.value:null);req.onerror=()=>resolve(null);}catch(e){resolve(null);}});}
async function metaSet(key,value){const db=await openDB();return new Promise((resolve)=>{try{const tx=db.transaction(META_STORE,'readwrite');tx.objectStore(META_STORE).put({key,value});tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();}catch(e){resolve();}});}
// Delete every cached-metrics entry (key prefixed 'metrics:') except keepKey, so the meta store
// doesn't accumulate one stale metrics blob per historical publish.
async function metaPruneMetrics(keepKey){const db=await openDB();return new Promise((resolve)=>{try{const tx=db.transaction(META_STORE,'readwrite');const store=tx.objectStore(META_STORE);const req=store.getAllKeys();req.onsuccess=()=>{try{(req.result||[]).forEach(k=>{if(typeof k==='string'&&k.indexOf('metrics:')===0&&k!==keepKey)store.delete(k);});}catch(e){}};tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();}catch(e){resolve();}});}
async function dbGetAll(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
async function dbPutAll(rows){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);rows.forEach(r=>store.put(r));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function dbClear(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function dbCount(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).count();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}

function getGroup(n){if(GA1.includes(n))return'A1';if(GA2.includes(n))return'A2';if(GB.includes(n))return'B';return null;}
function displayName(n){if(n==='0d1616c8-bcb7-4450-8bc5-f0a296bc01d1')return'LM-CAP';if(n&&n.includes('AutoSIM'))return'AutoSIM';return n;}
// AUTHORITATIVE AutoSIM-resolved rule (ALL FOUR must hold): RootCauseDetails empty; ClosureCode is
// Immediately Resolved / Automatically Closed; ResolvedByIdentity is exactly the AutoSIM ARN; Tags
// contains 'pet_incident_auto_resolved'. Analyst-resolved tickets are NOT AutoSIM even if tagged.
const AUTOSIM_ARN='arn:aws:sts::511128310777:assumed-role/AutoSIM/AutoSIM';
function isAutoSimResolved(r){
  if(!r)return false;
  const rcdEmpty=String(r.RootCauseDetails||'').trim()==='';
  const cc=String(r.ClosureCode||'').trim();
  const ccOk=(cc==='Immediately Resolved'||cc==='Automatically Closed');
  const arnOk=String(r.ResolvedByIdentity||'').trim()===AUTOSIM_ARN;
  const tags=Array.isArray(r.Tags)?r.Tags.join(','):String(r.Tags||'');
  const tagOk=tags.toLowerCase().includes('pet_incident_auto_resolved');
  return rcdEmpty&&ccOk&&arnOk&&tagOk;
}
function isLMCAP(n){return n==='0d1616c8-bcb7-4450-8bc5-f0a296bc01d1';}
function hBetween(d1,d2){return Math.abs(d2-d1)/(1000*60*60);}
function avg(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}
function dayOrd(d){const n=d.getDate();const s=['th','st','nd','rd'];const v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
const MO=['January','February','March','April','May','June','July','August','September','October','November','December'];

function parseCSV(text){
  const lines=[];let cur='';let inQ=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(ch==='"'){if(inQ&&text[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;}}
    else if(ch===','&&!inQ){lines.push(cur);cur='';}
    else if((ch==='\n'||ch==='\r')&&!inQ){if(ch==='\r'&&text[i+1]==='\n')i++;lines.push(cur);cur='';lines.push('__ROW_END__');}
    else{cur+=ch;}}
  if(cur)lines.push(cur);lines.push('__ROW_END__');
  const rows=[];let row=[];
  for(const cell of lines){if(cell==='__ROW_END__'){if(row.length>0)rows.push(row);row=[];}else{row.push(cell);}}
  const headers=rows[0];const data=[];
  for(let i=1;i<rows.length;i++){const obj={};for(let j=0;j<headers.length;j++)obj[headers[j]]=rows[i][j]||'';data.push(obj);}
  return data;
}

function computeMetrics(data){
  const allDates=data.map(r=>new Date(r.CreateDate)).filter(d=>!isNaN(d));
  const maxDate=new Date(Math.max(...allDates));
  const refDate=new Date(maxDate.getFullYear(),maxDate.getMonth(),maxDate.getDate(),19,0,0);
  const T=data.length;
  const statuses={};data.forEach(r=>{statuses[r.Status]=(statuses[r.Status]||0)+1;});
  const asgn=statuses['Assigned']||0,pend=statuses['Pending']||0,wip=statuses['Work In Progress']||0,res=statuses['Resolved']||0,researching=statuses['Researching']||0,closed=statuses['Closed']||0;
  const inQ=asgn+pend+wip+researching;
  const autosim=data.filter(r=>isAutoSimResolved(r)).length;
  // Ticket Color Classification
  const now=new Date();
  const colorTickets={green:[],yellow:[],red:[],black:[],purple:[]};
  data.forEach(r=>{
    if(r.Status==='Resolved'||r.Status==='Closed')return;
    const cd=new Date(r.CreateDate);const ageHrs=hBetween(cd,now);
    const hasResolvedDate=r.ResolvedDate&&r.ResolvedDate.trim()!=='';
    // Reopened = flagged during merge OR (WIP-type status with a prior ResolvedDate attached)
    if(r._reopened||hasResolvedDate){colorTickets.purple.push(r);}
    else if(ageHrs<=96){colorTickets.green.push(r);}
    else if(ageHrs<=168){colorTickets.yellow.push(r);}
    else if(ageHrs<=240){colorTickets.red.push(r);}
    else{colorTickets.black.push(r);}
  });
  let n10=0,p72=0,nSLA=0;
  data.forEach(r=>{const cd=new Date(r.CreateDate);const h=hBetween(cd,refDate);if(r.Status!=='Resolved'){if(h>720)n10++;if(h>672)nSLA++;}if(r.Status==='Assigned'&&h>72)p72++;});
  const ss=new Date(refDate);ss.setHours(ss.getHours()-12);
  const l12A=data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=ss&&cd<=refDate&&r.Status==='Assigned';}).length;
  const l12P=data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=ss&&cd<=refDate&&r.Status==='Pending';}).length;
  const l12W=data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=ss&&cd<=refDate&&r.Status==='Work In Progress';}).length;
  const l12R=data.filter(r=>{const rd=r.ResolvedDate?new Date(r.ResolvedDate):null;return rd&&rd>=ss&&rd<=refDate;}).length;
  const ts=new Date(maxDate.getFullYear(),maxDate.getMonth(),maxDate.getDate(),0,0,0);
  const te=new Date(maxDate.getFullYear(),maxDate.getMonth(),maxDate.getDate(),23,59,59);
  const rToday=data.filter(r=>{if(r.ResolvedDate){const rd=new Date(r.ResolvedDate);return rd>=ts&&rd<=te;}return false;}).length;
  const rTimes=[];data.forEach(r=>{if(r.Status==='Resolved'&&r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/(36e5);if(h>=0)rTimes.push(h);}});
  const avgR=avg(rTimes);
  const slaCompliant=rTimes.filter(h=>h<=240).length;
  const slaPct=rTimes.length>0?((slaCompliant/rTimes.length)*100).toFixed(1):0;
  const dL=[],dD=[],dC=[];for(let i=6;i>=0;i--){const ds=new Date(maxDate);ds.setDate(ds.getDate()-i);ds.setHours(0,0,0,0);const de=new Date(ds);de.setDate(de.getDate()+1);dL.push(ds.toLocaleDateString('en-US',{month:'short',day:'numeric'}));dD.push(data.filter(r=>{if(r.ResolvedDate){const rd=new Date(r.ResolvedDate);return rd>=ds&&rd<de;}return false;}).length);dC.push(data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=ds&&cd<de;}).length);}
  const wb={},wbR={};data.forEach(r=>{if(r.CreateDate){const d=new Date(r.CreateDate);const j4=new Date(d.getFullYear(),0,4);const dy=Math.ceil((d-new Date(d.getFullYear(),0,1))/(864e5));const wn=Math.ceil((dy+j4.getDay())/7);wb[`W${wn}`]=(wb[`W${wn}`]||0)+1;}});
  data.forEach(r=>{if(r.ResolvedDate){const d=new Date(r.ResolvedDate);const j4=new Date(d.getFullYear(),0,4);const dy=Math.ceil((d-new Date(d.getFullYear(),0,1))/(864e5));const wn=Math.ceil((dy+j4.getDay())/7);wbR[`W${wn}`]=(wbR[`W${wn}`]||0)+1;}});
  const wL=Object.keys(wb).sort(),wD=wL.map(k=>wb[k]),wDR=wL.map(k=>wbR[k]||0);
  const geoM={};data.forEach(r=>{const t=r.Title||'';let g='Other';['US','UK','CA','AU','BR','JP','IN','DE','SG','IT','FR','MX','AE'].forEach(c=>{if(t.startsWith(c+' '))g=c;});geoM[g]=(geoM[g]||0)+1;});
  const gL=Object.keys(geoM).sort((a,b)=>geoM[b]-geoM[a]),gD=gL.map(k=>geoM[k]);
  // Incident Types - use RootCause field directly as incident type
  const incM={};const incTickets={};
  const ANALYSTS=['arunkzn','flofalgu','harisss','punithsd','mbozied','mellanej','nobregak','chousoud','dbiswamb','obalasut','shaavhad','tanviroo','urmahala'];
  data.forEach(r=>{
    let tp='Other';const details=r.RootCauseDetails||'';const rootCause=(r.RootCause||'').replace(/^\s*-\s*/,'').trim();const title=r.Title||'';const resolver=r.ResolvedByIdentity||'';
    // Incident Type = the raw RootCause value (leading "- " already stripped), or "No Root Cause"
    // when empty. Grouping/relabeling is handled separately by the incident-types grouping tool.
    tp=(rootCause&&rootCause.length>1)?rootCause:'No Root Cause';
    incM[tp]=(incM[tp]||0)+1;
    if(!incTickets[tp])incTickets[tp]=[];
    incTickets[tp].push({ShortId:r.ShortId||r.IssueId,AssigneeIdentity:r.AssigneeIdentity,ResolvedByIdentity:resolver,CreateDate:r.CreateDate,Status:r.Status,Title:title});
  });
  const iL=Object.keys(incM).sort((a,b)=>incM[b]-incM[a]),iD=iL.map(k=>incM[k]);
  // Slim incTickets for storage
  const incTicketsSlim={};iL.forEach(k=>{incTicketsSlim[k]=incTickets[k].map(r=>({ShortId:r.ShortId,AssigneeIdentity:r.AssigneeIdentity,ResolvedByIdentity:r.ResolvedByIdentity,CreateDate:r.CreateDate,Status:r.Status,Title:r.Title}));});
  // Agents (Resolved/Closed = resolved, rest = open)
  const aRes={},aTm={};data.forEach(r=>{if((r.Status==='Resolved'||r.Status==='Closed')&&r.ResolvedByIdentity&&!isAutoSimResolved(r)){const x=r.ResolvedByIdentity;aRes[x]=(aRes[x]||0)+1;if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/36e5;if(h>=0){if(!aTm[x])aTm[x]=[];aTm[x].push(h);}}}});
  const aOpen={},aAsgn={};data.filter(r=>r.Status!=='Resolved'&&r.Status!=='Closed').forEach(r=>{if(r.AssigneeIdentity&&PHD_AGENTS.includes(r.AssigneeIdentity))aOpen[r.AssigneeIdentity]=(aOpen[r.AssigneeIdentity]||0)+1;});
  data.forEach(r=>{if(r.AssigneeIdentity&&PHD_AGENTS.includes(r.AssigneeIdentity))aAsgn[r.AssigneeIdentity]=(aAsgn[r.AssigneeIdentity]||0)+1;});
  // Per-agent status counts
  const aStatus={};PHD_AGENTS.forEach(n=>{aStatus[n]={Assigned:0,'Work In Progress':0,Researching:0,Pending:0,Resolved:0,Closed:0};});
  data.forEach(r=>{if(r.AssigneeIdentity&&PHD_AGENTS.includes(r.AssigneeIdentity)&&aStatus[r.AssigneeIdentity][r.Status]!==undefined){aStatus[r.AssigneeIdentity][r.Status]++;}});
  // Per-agent open tickets (Assigned, WIP, Pending) for popup drill-down
  const agentOpenTickets={};PHD_AGENTS.forEach(n=>{agentOpenTickets[n]=[];});
  data.forEach(r=>{if(r.AssigneeIdentity&&PHD_AGENTS.includes(r.AssigneeIdentity)&&(r.Status==='Assigned'||r.Status==='Work In Progress'||r.Status==='Pending')){agentOpenTickets[r.AssigneeIdentity].push({ShortId:r.ShortId||r.IssueId,CreateDate:r.CreateDate,Status:r.Status,Title:r.Title});}});
  const agents=PHD_AGENTS.map(n=>({name:n,assigned:aAsgn[n]||0,resolved:aRes[n]||0,open:aOpen[n]||0,avgTime:aTm[n]?avg(aTm[n]):0,group:getGroup(n),statuses:aStatus[n]}));
  // HI - Historical Incident (Cnt in RootCauseDetails, or "Historical Incident:")
  const cntP=/\bCnt\s*[:\s]\s*(\d+)/i;const hiP=/Historical Incident\s*:?\s*(\d+)/i;const hiCases=[];
  data.forEach(r=>{if(r.RootCauseDetails){let n=0;const m=r.RootCauseDetails.match(cntP);const m2=r.RootCauseDetails.match(hiP);if(m)n=parseInt(m[1]);else if(m2)n=parseInt(m2[1]);if(n>0){const rc=(r.RootCause||'').toLowerCase();const isAnimal=rc.includes('unsecured animal');const resolvedStatus=(r.Status==='Resolved'||r.Status==='Closed');hiCases.push({id:r.ShortId,cnt:n,assignee:r.AssigneeIdentity,rootCause:r.RootCause,status:r.Status,isAnimal,CreateDate:r.CreateDate,resolvedStatus});}}});
  hiCases.sort((a,b)=>b.cnt-a.cnt);
  const hiResolved=hiCases.filter(h=>h.resolvedStatus).length;
  const hiUnresolved=hiCases.filter(h=>!h.resolvedStatus).length;
  const hiUnresolvedTickets=hiCases.filter(h=>!h.resolvedStatus).sort((a,b)=>new Date(b.CreateDate)-new Date(a.CreateDate));
  // Last 12 hours resolved (based on ResolvedDate relative to latest date in data)
  const allCreateDates=data.map(r=>new Date(r.CreateDate)).filter(d=>!isNaN(d));
  const refNow=allCreateDates.length?new Date(Math.max(...allCreateDates)):new Date();
  const twelveAgo=new Date(refNow.getTime()-12*36e5);
  const twentyfourAgo=new Date(refNow.getTime()-24*36e5);
  const last12Resolved=data.filter(r=>{if(r.ResolvedDate){const rd=new Date(r.ResolvedDate);return rd>=twelveAgo&&rd<=refNow;}return false;}).length;
  const last12Created=data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=twelveAgo&&cd<=refNow;}).length;
  const last24Created=data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=twentyfourAgo&&cd<=refNow;}).length;
  const hiAnimal=hiCases.filter(h=>h.isAnimal);
  const hiNonAnimal=hiCases.filter(h=>!h.isAnimal);
  // Groups
  let a1R=0,a2R=0,bR=0,a1O=0,a2O=0,bO=0;
  data.forEach(r=>{if(r.Status==='Resolved'){const g=getGroup(r.ResolvedByIdentity);if(g==='A1')a1R++;else if(g==='A2')a2R++;else if(g==='B')bR++;}if(r.Status!=='Resolved'){const g=getGroup(r.AssigneeIdentity);if(g==='A1')a1O++;else if(g==='A2')a2O++;else if(g==='B')bO++;}});
  const a1T=[],a2T=[],bT=[];data.forEach(r=>{if(r.Status==='Resolved'&&r.ResolvedByIdentity&&r.CreateDate&&r.ResolvedDate){const g=getGroup(r.ResolvedByIdentity);const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/36e5;if(h>=0){if(g==='A1')a1T.push(h);else if(g==='A2')a2T.push(h);else if(g==='B')bT.push(h);}}});
  let a1As=0,a2As=0,bAs=0;data.forEach(r=>{const g=getGroup(r.AssigneeIdentity);if(g==='A1')a1As++;else if(g==='A2')a2As++;else if(g==='B')bAs++;});
  const dgA1=[],dgA2=[],dgB=[];for(let i=6;i>=0;i--){const ds=new Date(maxDate);ds.setDate(ds.getDate()-i);ds.setHours(0,0,0,0);const de=new Date(ds);de.setDate(de.getDate()+1);let x=0,y=0,z=0;data.forEach(r=>{if(r.ResolvedDate){const rd=new Date(r.ResolvedDate);if(rd>=ds&&rd<de){const g=getGroup(r.ResolvedByIdentity);if(g==='A1')x++;else if(g==='A2')y++;else if(g==='B')z++;}}});dgA1.push(x);dgA2.push(y);dgB.push(z);}
  // Previous week
  const pwE=new Date(maxDate);pwE.setDate(pwE.getDate()-2);pwE.setHours(0,0,0,0);const pwS=new Date(pwE);pwS.setDate(pwS.getDate()-6);const pwEF=new Date(pwE);pwEF.setDate(pwEF.getDate()+1);
  const pwC=data.filter(r=>{const cd=new Date(r.CreateDate);return cd>=pwS&&cd<pwEF;});
  const pwR=data.filter(r=>{if(r.ResolvedDate){const rd=new Date(r.ResolvedDate);return rd>=pwS&&rd<pwEF;}return false;});
  const pwAuto=pwR.filter(r=>isAutoSimResolved(r)).length;
  const pwRC={};pwR.forEach(r=>{let x=isAutoSimResolved(r)?'AutoSIM':(r.ResolvedByIdentity||'Unknown');pwRC[x]=(pwRC[x]||0)+1;});
  const pwAn={};pwR.forEach(r=>{let x=isAutoSimResolved(r)?'AutoSIM':(r.ResolvedByIdentity||'Unknown');if(!pwAn[x])pwAn[x]={t:0,a:0};pwAn[x].t++;if((r.RootCause||'').toLowerCase().includes('unsecured animal'))pwAn[x].a++;});
  const pwDC=[],pwDR=[],pwDL=[];for(let i=0;i<7;i++){const ds=new Date(pwS);ds.setDate(ds.getDate()+i);const de=new Date(ds);de.setDate(de.getDate()+1);pwDC.push(pwC.filter(r=>{const cd=new Date(r.CreateDate);return cd>=ds&&cd<de;}).length);pwDR.push(pwR.filter(r=>{const rd=new Date(r.ResolvedDate);return rd>=ds&&rd<de;}).length);pwDL.push(ds.toLocaleDateString('en-US',{month:'short',day:'numeric'}));}
  const pwSt={};pwC.forEach(r=>{pwSt[r.Status]=(pwSt[r.Status]||0)+1;});
  // ---- SLA compliance per week (≤240h), bucketed by RESOLVED date, for the current quarter ----
  // Quarter start = first day of the quarter that contains the latest ticket date. 13 weekly buckets.
  const qStart=new Date(maxDate.getFullYear(),Math.floor(maxDate.getMonth()/3)*3,1);
  const isoWeekNum=(d)=>{const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const ys=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-ys)/864e5+1)/7);};
  const weekIndexOf=(d)=>{const days=Math.floor((new Date(d.getFullYear(),d.getMonth(),d.getDate())-qStart)/864e5);if(days<0)return -1;const idx=Math.floor(days/7);return idx>12?-1:idx;};
  const slaResolvedWk=new Array(13).fill(0),slaWithinWk=new Array(13).fill(0);
  // Which week (0-based) does "now" fall into? Weeks beyond this stay null (not yet drawn).
  const currentWeekIdx=weekIndexOf(maxDate);
  data.forEach(r=>{
    if(!r.ResolvedDate||!r.CreateDate)return;
    const rd=new Date(r.ResolvedDate);if(isNaN(rd))return;
    const wi=weekIndexOf(rd);if(wi<0)return;
    const h=(rd-new Date(r.CreateDate))/36e5;if(h<0)return;
    slaResolvedWk[wi]++;if(h<=240)slaWithinWk[wi]++;
  });
  const slaByWeek=[];for(let i=0;i<13;i++){
    const dt=new Date(qStart.getFullYear(),qStart.getMonth(),qStart.getDate()+i*7);
    const label='W'+String(isoWeekNum(dt)).padStart(2,'0');
    // Only include weeks up to (and including) the current one — future weeks are not drawn yet.
    const inRange=(currentWeekIdx<0)||(i<=currentWeekIdx);
    const pct=(inRange&&slaResolvedWk[i])?+(slaWithinWk[i]/slaResolvedWk[i]*100).toFixed(1):null;
    slaByWeek.push({week:label,resolved:inRange?slaResolvedWk[i]:0,within:inRange?slaWithinWk[i]:0,pct});
  }
  return{T,asgn,pend,wip,res,researching,closed,inQ,autosim,colorTickets,slaByWeek,n10,p72,nSLA,l12A,l12P,l12W,l12R,rToday,avgR,slaCompliant,slaPct,dL,dD,dC,wL,wD,wDR,gL,gD,iL,iD,incTickets:incTicketsSlim,agents,agentOpenTickets,hiCases,hiAnimal,hiNonAnimal,hiResolved,hiUnresolved,hiUnresolvedTickets,last12Resolved,last12Created,last24Created,a1R,a2R,bR,a1O,a2O,bO,a1Avg:avg(a1T),a2Avg:avg(a2T),bAvg:avg(bT),a1As,a2As,bAs,dgA1,dgA2,dgB,pwCreated:pwC.length,pwResolved:pwR.length,pwAuto,pwRC,pwAn,pwDC,pwDR,pwDL,pwSt,dateStr:`${dayOrd(maxDate)} ${MO[maxDate.getMonth()]} ${maxDate.getFullYear()}`,pwStartStr:`${dayOrd(pwS)} ${MO[pwS.getMonth()]} ${pwS.getFullYear()}`,pwEndStr:`${dayOrd(pwE)} ${MO[pwE.getMonth()]} ${pwE.getFullYear()}`};
}

// ========= UI RENDERING =========
let currentView = 'dashboard';
let M = null; // metrics
const charts = [];

function destroyCharts(){charts.forEach(c=>c.destroy());charts.length=0;}

function handleFile(file){
  // legacy entry (fresh upload)
  handleUpload(file,'fresh');
}

// mode: 'fresh' = clear then load, 'merge' = merge into existing.
// autoPublish: after computing, push the merged dataset to Atlas and record the audit log.
function handleUpload(file,mode,autoPublish){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=(e)=>handleUploadText(e.target.result,mode,autoPublish);
  reader.readAsText(file);
}

// Same as handleUpload but from CSV text already in memory (used by the cross-page handoff).
function handleUploadText(csvText,mode,autoPublish){
  if(PUBLISHING){showToast('Publish in progress — data changes are locked.');return;}
  // RULE 1: reject the file if the header is missing any required column (no upload happens).
  const colCheck=validateColumns(csvText);
  if(!colCheck.ok){ showColumnError(colCheck.missing); return; }
  const uploadTime=new Date().toLocaleString('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  document.getElementById('app').innerHTML=`<div class="upload-wrap"><div style="text-align:center"><div class="spinner"></div><p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">Processing CSV data...</p><p style="color:#879596;margin-top:8px;font-size:.9em">${mode==='merge'?'Merging with existing data':'Building your dashboard'}</p></div></div>`;
  {setTimeout(async()=>{
    const parsed=parseCSV(csvText).filter(r=>r.ShortId||r.IssueId).map(r=>{if(!r.ShortId&&r.IssueId)r.ShortId=r.IssueId;return r;});
    // Split by quarter: the local store + browser merge only concern the LIVE quarter.
    // Non-live rows (e.g. Q2 tickets) are passed straight to the server, which merges them
    // into their own quarter doc — they must NOT enter the local live-dashboard store.
    const liveQ=LIVE_QUARTER?LIVE_QUARTER.quarter:null;
    const newRows=[];const nonLiveRows=[];
    parsed.forEach(r=>{const q=quarterOf(r.CreateDate);if(liveQ&&q&&q!==liveQ)nonLiveRows.push(r);else newRows.push(r);});
    let mergeReport=null;
    let deltaLive=null; // the changed/new live tickets to send in a delta publish (null => full replace)
    if(mode==='fresh'){
      await dbClear();
      await dbPutAll(newRows);
    } else {
      // Merge: load existing, apply merge rules
      const existing=await dbGetAll();
      const existingMap={};existing.forEach(r=>{existingMap[r.ShortId]=r;});
      const newMap={};newRows.forEach(r=>{newMap[r.ShortId]=r;});
      let added=0,updated=0,unchanged=0,reopened=0,autoClosed=0;const missing=[];
      const toWrite=[];
      newRows.forEach(nr=>{
        const old=existingMap[nr.ShortId];
        if(!old){toWrite.push(nr);added++;return;}
        // Rule: a ticket is only updated if ANY of the 3 activity timestamps changed vs stored.
        // If all three are unchanged, ignore the ticket entirely (no DB write).
        if(!timestampsChanged(nr,old)){ unchanged++; return; }
        // Something changed -> overwrite the specific data fields from the CSV; keep other stored
        // fields (IssueUrl, AssignedGroup, CreateDate, etc.) as-is. Also refresh the 3 timestamps.
        const merged={...old};
        MERGE_FIELDS.forEach(f=>{ merged[f]=nr[f]; });
        TIMESTAMP_FIELDS.forEach(f=>{ merged[f]=nr[f]; });
        // Reopen -> purple flag when a resolved/closed ticket comes back as Work In Progress.
        const isReopen=(old.Status==='Resolved'||old.Status==='Closed')&&nr.Status==='Work In Progress';
        if(isReopen){ merged._reopened=true; reopened++; }
        else if(old._reopened&&(nr.Status==='Resolved'||nr.Status==='Closed')){ delete merged._reopened; }
        toWrite.push(merged);updated++;
      });
      // Tickets in existing but NOT in new file
      existing.forEach(old=>{
        if(!newMap[old.ShortId]){
          missing.push(old.ShortId);
          // Auto-promote missing Resolved tickets to Closed (new data often omits closed tickets)
          if(old.Status==='Resolved'){toWrite.push({...old,Status:'Closed'});autoClosed++;}
        }
      });
      if(toWrite.length>0)await dbPutAll(toWrite);
      deltaLive=toWrite; // only the changed/new (+auto-closed) live tickets — the delta to publish
      mergeReport={added,updated,reopened,autoClosed,unchanged,missing:missing.length,missingIds:missing.slice(0,50)};
    }
    // Recompute from full merged LIVE set (local store holds live-quarter tickets only)
    const allRows=await dbGetAll();
    M=computeMetrics(allRows);M.uploadTime=uploadTime;M.mergeReport=mergeReport;M.totalStored=allRows.length;
    renderDashboard();
    if(autoPublish){
      // Delta publish: send only the changed/new live tickets (deltaLive) + non-live rows. For a
      // 'fresh' upload (deltaLive null) we do a full replace. doPublish handles the fallback.
      await doPublish(nonLiveRows, mergeReport, deltaLive);
    } else if(mergeReport){
      showMergeReport(mergeReport);
    }
  },50);}
}

function showMergeReport(rep,crossInfo){
  crossInfo=crossInfo||{};
  const skipped=crossInfo.skipped||[];
  let crossNote='';
  if(crossInfo.reviewed){
    crossNote=`<p style="color:#fbbf24;font-size:.85em;margin-top:16px;padding:10px 12px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px"><b>Cross-quarter review completed.</b> Non-live quarter data was reviewed and overwritten with the uploaded tickets.</p>`;
  }else if(skipped.length){
    const s=skipped.map(c=>`${c.label} (${c.count})`).join(', ');
    crossNote=`<p style="color:#879596;font-size:.85em;margin-top:16px;padding:10px 12px;background:rgba(135,149,150,.08);border:1px solid #2a2a2a;border-radius:8px">Non-live quarter tickets were <b>skipped</b> — only the live quarter was updated. Skipped: ${s}.</p>`;
  }
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h2 style="color:#4ade80;font-size:1.2em">Upload Complete</h2>
      <button class="btn danger" onclick="closeAllPopups()">Close</button>
    </div>
    <div class="handoff-grid">
      <div class="handoff-box"><h3>Change Summary</h3><ul>
        <li><span>New tickets added</span><span class="val" style="color:#4ade80">${rep.added}</span></li>
        <li><span>Tickets updated (status advanced)</span><span class="val" style="color:#fbbf24">${rep.updated}</span></li>
        <li><span>Tickets reopened (→ Purple)</span><span class="val" style="color:#a78bfa">${rep.reopened}</span></li>
        <li><span>Auto-closed (missing + was Resolved)</span><span class="val" style="color:#44b9d6">${rep.autoClosed||0}</span></li>
        <li><span>Unchanged</span><span class="val" style="color:#879596">${rep.unchanged}</span></li>
        <li><span>Not present in new file (retained)</span><span class="val" style="color:#ff5252">${rep.missing}</span></li>
      </ul></div>
    </div>
    ${crossNote}
    ${rep.autoClosed>0?`<p style="color:#879596;font-size:.85em;margin-top:16px">${rep.autoClosed} ticket(s) that were "Resolved" and absent from the new file were auto-promoted to "Closed" (new exports often omit closed tickets).</p>`:''}
    ${rep.missing>0?`<p style="color:#879596;font-size:.85em;margin-top:12px">The new data did not contain these ${rep.missing} ticket(s) that exist in the dashboard. Non-resolved ones were retained unchanged:</p><p style="color:#ff9900;font-size:.8em;margin-top:8px;word-break:break-all">${rep.missingIds.join(', ')}${rep.missing>50?' ...and more':''}</p>`:''}
  </div>`;
  document.body.appendChild(overlay);
}

async function startFresh(){await dbClear();M=null;destroyCharts();renderUpload();}

// Views other than the (chunked) dashboard need the FULL tickets array + computed M.
// Load it on demand so the dashboard stays lightweight. Shows a spinner while loading.
async function ensureFullData(){
  if(M)return true;
  // If a section skeleton (e.g. the Shift Report shimmer) is already on screen, keep it instead of
  // flashing a blank full-page spinner over it.
  const hasSkeleton=!!document.querySelector('.sr .sk-blk');
  if(!hasSkeleton){
    try{
      // Paint a neutral spinner so the switch isn't blank while ~8k rows load.
      document.getElementById('app').innerHTML=topBar(currentView||'dashboard')+'<div class="content" style="text-align:center;padding:80px 0"><div class="spinner"></div><p style="color:#879596;margin-top:16px">Loading full dataset…</p></div>';
    }catch(e){}
  }
  // Prefer whatever is already in IndexedDB; else fetch from the server.
  try{ const c=await metaGet('liveCache'); if(await renderFromLocalData())return !!M; }catch(e){}
  const ok=await refreshFromServerData();
  return ok && !!M;
}
// Build M from local IndexedDB rows (no render). Returns true if data existed.
async function renderFromLocalData(){
  try{
    const allRows=await dbGetAll();
    if(!allRows.length)return false;
    let maxLU=0; try{ maxLU=allRows.reduce((m,r)=>{const d=new Date(r.LastUpdatedDate);return(!isNaN(d)&&d.getTime()>m)?d.getTime():m;},0); window._dbMaxLastUpdated=maxLU; }catch(e){}
    M=computeMetrics(allRows);M.totalStored=allRows.length;
    return true;
  }catch(e){return false;}
}
// Fetch the full live dataset from the server, store it, build M (no render).
async function refreshFromServerData(){
  const shared=await loadLiveQuarter();
  if(!shared)return false;
  try{ await dbClear(); await dbPutAll(shared.tickets); }catch(e){}
  try{ await metaSet('liveCache',{quarter:LIVE_QUARTER?LIVE_QUARTER.quarter:null,publishedAt:shared.updatedAt||null}); }catch(e){}
  return await renderFromLocalData();
}

function nav(view){
  currentView=view;destroyCharts();
  // Move the top-right cluster back to <body> before wiping #app, so a re-render can't destroy it
  // (it may currently live inside the dashboard header row). The target render re-anchors it.
  try{ var _tr=document.getElementById('tbTopRight'); if(_tr&&_tr.parentNode!==document.body){document.body.appendChild(_tr);_tr.classList.remove('tb-top-right-inrow');} }catch(e){}
  if(view==='dashboard'){ renderDashboardChunked(); return; }
  // Shift Report has its own tiny aggregate endpoint — no full-dataset load needed.
  if(view==='shift-report'){ renderShiftReport(); if(window.PHDPlaceTopRight)window.PHDPlaceTopRight(); return; }
  // Other views need the full array — load it first if we don't have M yet.
  if(M){ _navRender(view); return; }
  ensureFullData().then(ok=>{ if(ok)_navRender(view); else renderDashboardChunked(); });
}
function _navRender(view){
  if(view==='groups')renderGroups();else if(view==='previous-week')renderPreviousWeek();else if(view==='shift-report')renderShiftReport();else renderDashboardChunked();
  if(window.PHDPlaceTopRight)window.PHDPlaceTopRight(); // keep the header cluster present on every view
}

function renderUpload(){
  document.getElementById('app').innerHTML=`
  <div class="upload-wrap">
    <div style="text-align:center;max-width:500px">
      <a href="index.html" style="color:#879596;font-size:.85em;text-decoration:none;display:inline-block;margin-bottom:20px">← Back to All Dashboards</a>
      <h1 style="color:#fff;font-size:2em;margin-bottom:8px">WWOS-PHD Dashboard</h1>
      <p style="color:#879596;margin-bottom:30px">No data exists to create a dashboard. Upload a CSV file to get started. Later you can merge additional CSVs to keep the dashboard updated.</p>
      <div class="drop-zone" id="dropZone">
        <p style="color:#fff;font-size:1.1em;font-weight:600;margin-bottom:8px">Drop CSV file here</p>
        <p style="color:#879596;font-size:.9em">or click to browse</p>
        <input type="file" accept=".csv" id="fileInput" style="display:none">
      </div>
      <p style="color:#879596;font-size:.8em;margin-top:20px">Required columns in the CSV for a complete dashboard:</p>\
      <ul style="color:#879596;font-size:.8em;margin-top:8px;list-style:none;padding:0;text-align:left;display:inline-block">\
        <li style="padding:3px 0">• Status</li>\
        <li style="padding:3px 0">• Created</li>\
        <li style="padding:3px 0">• Severity</li>\
        <li style="padding:3px 0">• Assignee</li>\
        <li style="padding:3px 0">• Resolved Date</li>\
        <li style="padding:3px 0">• Age</li>\
        <li style="padding:3px 0">• Closure Code</li>\
        <li style="padding:3px 0">• Resolved By</li>\
        <li style="padding:3px 0">• Root Cause</li>\
        <li style="padding:3px 0">• Root Cause Details</li>\
      </ul>
    </div>
  </div>`;
  const dz=document.getElementById('dropZone'),fi=document.getElementById('fileInput');
  dz.onclick=()=>fi.click();
  dz.ondragover=(e)=>e.preventDefault();
  dz.ondrop=(e)=>{e.preventDefault();handleUpload(e.dataTransfer.files[0],'fresh');};
  fi.onchange=(e)=>handleUpload(e.target.files[0],'fresh');
}

// Safe icon wrapper (no-op if icons.js isn't loaded).
function ic(name,size){return (typeof window.icon==='function')?window.icon(name,size||15):'';}

function topBar(active){
  // Shared nav (Section 1: logo + LIVE badge + Users/avatar; Section 2: full nav row) from topbar-auth.js.
  if(window.PHDNav&&window.PHDNav.buildToolbarHtml){
    return window.PHDNav.buildToolbarHtml(active,{inApp:true,liveLabel:LIVE_QUARTER?LIVE_QUARTER.label:''});
  }
  // Fallback (topbar-auth.js not loaded): minimal bar.
  return `<div class="top-bar"><a class="logo logo-link" href="index.html"><img src="gsoc-logo.svg" alt="GSOC"><span>WWOS-GSOC PHD Dashboard</span></a></div>`;
}

function doLogout(){window.PHDAuth.clear();location.reload();}

// ===== Help alerts (editor "ask for help") =====
// IDs of open requests we've already fired a desktop notification for (this tab's lifetime).
window._notifiedHelpIds=window._notifiedHelpIds||new Set();
window._helpPollTimer=window._helpPollTimer||null;
let _helpNotifPrimed=false; // becomes true after the first fetch so we don't blast notifications for the existing backlog on load

// Only admins/owner get desktop notifications (they're the ones who answer).
function canGetHelpNotifications(){return !!(window.PHDAuth&&window.PHDAuth.atLeast&&window.PHDAuth.atLeast('admin'));}

// Ask for OS notification permission once (called after login / on dashboard load for admins).
function ensureNotifyPermission(){
  if(!('Notification'in window))return;
  if(!canGetHelpNotifications())return;
  if(Notification.permission==='default'){try{Notification.requestPermission();}catch(e){}}
}

// Update the badge from a known open list, and fire desktop notifications for any newly-seen requests.
function applyHelpOpenList(list){
  const badge=document.getElementById('alertBadge');
  const n=Array.isArray(list)?list.length:0;
  if(badge){if(n>0){badge.textContent=n;badge.style.display='flex';}else{badge.style.display='none';}}
  if(!canGetHelpNotifications()||!Array.isArray(list))return;
  // On the very first fetch, just record the existing IDs so we don't notify for the backlog.
  if(!_helpNotifPrimed){list.forEach(h=>window._notifiedHelpIds.add(h.id));_helpNotifPrimed=true;return;}
  const canNotify=('Notification'in window)&&Notification.permission==='granted';
  list.forEach(h=>{
    if(window._notifiedHelpIds.has(h.id))return;
    window._notifiedHelpIds.add(h.id);
    if(canNotify){
      try{
        const body=(h.doubt||'').slice(0,140);
        const note=new Notification('New help request — '+(h.requester||'someone'),{
          body:(h.shortId?('Ticket '+h.shortId+': '):'')+body,
          tag:'help-'+h.id, // collapses duplicates for the same request
          icon:'gsoc-logo.svg'
        });
        note.onclick=()=>{try{window.focus();}catch(e){}location.href='alerts.html';try{note.close();}catch(e){}};
      }catch(e){/* notification failed silently */}
    }
  });
}

// Fetch open requests, update badge + notifications. Used by the poller and after render.
async function refreshHelpAlertCount(){
  const badge=document.getElementById('alertBadge');
  try{
    const r=await window.PHDAuth.api('GET','/api/help/open');
    const list=(r.ok&&Array.isArray(r.data))?r.data:[];
    applyHelpOpenList(list);
  }catch(e){if(badge)badge.style.display='none';}
}

// Start a background poll so admins get notified even when the dashboard tab is in the background.
function startHelpNotificationPolling(){
  if(window._helpPollTimer)return; // already running
  if(!(window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser()))return; // logged-in only
  ensureNotifyPermission();
  // Poll every 10 minutes. The badge/notifications update regardless of which view is showing.
  window._helpPollTimer=setInterval(refreshHelpAlertCount,600000);
}
function stopHelpNotificationPolling(){if(window._helpPollTimer){clearInterval(window._helpPollTimer);window._helpPollTimer=null;}}

// The "Alerts" button now navigates to the standalone alerts.html page (with back + recent-history),
// replacing the old in-dashboard popup. The badge count is still driven by refreshHelpAlertCount().

// Handle a chosen CSV from the "Upload new data" input.
function onUploadFileChange(e){
  if(PUBLISHING){showToast('Upload in progress — please wait.');e.target.value='';return;}
  const file=e.target.files&&e.target.files[0];e.target.value='';
  if(file)previewUpload(file);
}

// Delegated listener (bound once): survives every toolbar re-render since the #uploadFile input
// is re-created by the shared nav on each render. Using document-level delegation avoids the
// binding being lost when the toolbar HTML is replaced.
function attachNewFileHandler(){
  // No-op: the "Upload new data" pipeline now lives entirely in topbar-auth.js (in-place, runs on
  // any page including app.html). It binds its own delegated #uploadFile change listener there.
}

// Let the shared upload module refresh the dashboard in-place after a successful upload (app.html).
window.PHDRefreshLive=async function(){
  // A new publish happened. Bust the version memo + per-chunk load state + cached full dataset so
  // the chunked dashboard re-fetches everything against the new live version.
  try{ if(window.PHDAuth)window.PHDAuth._liveVerCache=undefined; }catch(e){}
  DASH_VERSION=undefined;
  Object.keys(DASH_LOADED).forEach(k=>{ delete DASH_LOADED[k]; });
  M=null; // other views will reload full data on demand
  try{ await metaSet('liveCache',null); }catch(e){}
  // Re-render the chunked dashboard (summary re-fetches; cards reload on next expand).
  if((currentView||'dashboard')==='dashboard'){ renderDashboardChunked(); }
  else { nav(currentView); }
};

// Expose the dashboard's cached version (b) as "<quarter>|<publishedAt>" so the Refresh button can
// version-check (a vs b) before doing a heavy refresh. Matches PHDAuth.liveVersion()'s format.
window.PHDGetCachedVersion=async function(){
  try{ const c=await metaGet('liveCache'); if(!c||!c.quarter)return null; return c.quarter+'|'+(c.publishedAt||''); }catch(e){ return null; }
};

// Which quarter does a CreateDate fall in? e.g. "2026-Q3". Returns null if unparseable.
function quarterOf(createDate){
  const d=new Date(createDate);
  if(isNaN(d))return null;
  return d.getFullYear()+'-Q'+(Math.floor(d.getMonth()/3)+1);
}

// Parse the CSV, compute a per-quarter breakdown, and show an Upload/Cancel confirmation
// popup BEFORE any processing. On Upload -> handleUpload(merge, autoPublish). On Cancel -> nothing.
function previewUpload(file){
  showAssessingSpinner();
  const reader=new FileReader();
  reader.onload=(e)=>previewUploadText(e.target.result);
  reader.onerror=()=>{hideAssessingSpinner();showToast('Could not read the file.');};
  reader.readAsText(file);
}

// Same as previewUpload but from CSV text already in memory (used by the cross-page handoff).
function previewUploadText(csvText){
  showAssessingSpinner();
  // Let the spinner paint before the (synchronous) parse/validate work runs.
  setTimeout(()=>assessAndPreview(csvText),40);
}
function assessAndPreview(csvText){
  // RULE 1: reject the file if the header is missing any required column (no upload happens).
  const colCheck=validateColumns(csvText);
  if(!colCheck.ok){ hideAssessingSpinner(); showColumnError(colCheck.missing); return; }
  {
    const e={target:{result:csvText}};
    let rows;
    try{ rows=parseCSV(e.target.result).filter(r=>r.ShortId||r.IssueId); }
    catch(err){ hideAssessingSpinner(); showToast('Could not read the CSV file.'); return; }
    if(!rows.length){ hideAssessingSpinner(); showToast('No tickets with a ShortId/IssueId were found in the file.'); return; }
    const liveQ=LIVE_QUARTER?LIVE_QUARTER.quarter:null;
    // Tally tickets per quarter (undated tickets are counted with the live quarter).
    const tally={};let undated=0;
    rows.forEach(r=>{const q=quarterOf(r.CreateDate)||liveQ||'unknown';if(!quarterOf(r.CreateDate))undated++;tally[q]=(tally[q]||0)+1;});
    const quarters=Object.keys(tally).sort();
    const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const qLabel=(q)=>{const m=/^(\d{4})-Q([1-4])$/.exec(q);return m?('Q'+m[2]+' '+m[1]):q;};
    const rowsHtml=quarters.map(q=>{
      const isLive=(q===liveQ);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #2a2a2a">
        <span style="color:#fff;font-weight:600">${esc(qLabel(q))} ${isLive?'<span style="color:#4ade80;font-size:.75em;font-weight:700;margin-left:6px">● LIVE</span>':'<span style="color:#fbbf24;font-size:.75em;font-weight:700;margin-left:6px">PAST QUARTER</span>'}</span>
        <span style="color:${isLive?'#4ade80':'#fbbf24'};font-weight:700">${tally[q].toLocaleString()} ticket${tally[q]===1?'':'s'}</span>
      </div>`;
    }).join('');
    const hasPast=quarters.some(q=>q!==liveQ);
    const note=hasPast
      ? `<p style="color:#fbbf24;font-size:.85em;margin:14px 0 0;padding:10px 12px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px"><b>Note:</b> tickets from a past quarter will be merged into <b>that quarter's own dashboard</b> (not the live one). Each quarter keeps its own data and update log.</p>`
      : `<p style="color:#879596;font-size:.85em;margin:14px 0 0">All tickets belong to the live quarter and will update the live dashboard.</p>`;
    // RULE 2 (freshness): compare the file's newest LastUpdatedDate to what's already live.
    // If the file is OLDER, warn (but still allow — admin can override).
    let staleWarn='';
    try{
      const maxDate=(arr,f)=>arr.reduce((m,r)=>{const d=new Date(f(r));return (!isNaN(d)&&d.getTime()>m)?d.getTime():m;},0);
      const fileMax=maxDate(rows,r=>r.LastUpdatedDate||r.CreateDate);
      const dbMax=(window._dbMaxLastUpdated!=null)?window._dbMaxLastUpdated:0;
      if(fileMax&&dbMax&&fileMax<dbMax){
        const fmt=(ms)=>new Date(ms).toLocaleString('en-US',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
        staleWarn=`<p style="color:#ff5252;font-size:.85em;margin:14px 0 0;padding:10px 12px;background:rgba(255,82,82,.1);border:1px solid rgba(255,82,82,.35);border-radius:8px"><b>⚠ This file looks OLDER than the current data.</b><br>Newest change in file: <b>${fmt(fileMax)}</b> · Newest already live: <b>${fmt(dbMax)}</b>.<br>Uploading an outdated export may not reflect recent changes. Only continue if you're sure this is the correct file.</p>`;
      }
    }catch(e){}
    const overlay=document.createElement('div');
    overlay.id='incPopup';
    overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.onclick=(ev)=>{if(ev.target===overlay)closeAllPopups();};
    overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px">
      <h2 style="color:#fff;font-size:1.2em;margin-bottom:6px">${ic('upload',18)} Confirm upload</h2>
      <p style="color:#879596;font-size:.88em;margin-bottom:16px">This file has <b style="color:#fff">${rows.length.toLocaleString()}</b> ticket${rows.length===1?'':'s'}. Here's how they'll be routed by quarter:</p>
      <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:6px 16px 12px">${rowsHtml}</div>
      ${undated?`<p style="color:#879596;font-size:.8em;margin-top:8px">${undated} ticket(s) had no readable date and are counted with the live quarter.</p>`:''}
      ${staleWarn}
      ${note}
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn sec" onclick="closeAllPopups()">Cancel</button>
        <button class="btn" style="background:#4ade80" id="confirmUploadBtn">${ic('upload',15)} Upload</button>
      </div>
    </div>`;
    hideAssessingSpinner(); // assessment done — show the confirm popup
    document.body.appendChild(overlay);
    const btn=document.getElementById('confirmUploadBtn');
    if(btn)btn.onclick=()=>{closeAllPopups();handleUploadText(csvText,'merge',/*autoPublish*/true);};
  }
}

function makeChart(id,config){
  const ctx=document.getElementById(id);
  if(ctx){const c=new Chart(ctx,config);charts.push(c);}
}

function closeAllPopups(){const p=document.getElementById('colorPopup');if(p)p.remove();const p2=document.getElementById('incPopup');if(p2)p2.remove();}

// Collapse/expand a dashboard section (header is the click target). Charts inside are resized on expand.
function toggleSection(h2){
  const sec=h2.closest('.section');if(!sec)return;
  const nowCollapsed=sec.classList.toggle('collapsed');
  if(!nowCollapsed){
    // Re-expanded: resize any Chart.js canvases AFTER the ~300ms expand animation finishes.
    setTimeout(()=>{try{charts.forEach(c=>{if(sec.contains(c.canvas))c.resize();});}catch(e){}},340);
  }
}
window.toggleSection=toggleSection;

// Ticket-level detail is restricted to logged-in users.
function requireLoginForTickets(){
  const user=window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser();
  if(user){ try{ if(window.loadUserAvatars)loadUserAvatars(); }catch(e){} return true; } // warm avatars for the drill-down
  showTicketAccessPrompt();
  return false;
}
function showTicketAccessPrompt(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='colorPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:50vw;width:50vw;min-width:min(92vw,420px);padding:28px;text-align:center">
    <div style="font-size:2em;margin-bottom:8px">🔒</div>
    <h2 style="color:#fff;font-size:1.2em;margin-bottom:10px">Login required</h2>
    <p style="color:#879596;font-size:.9em;line-height:1.6;margin-bottom:20px">Ticket-level details are available to logged-in users only. Please log in to view tickets, or for access reach out to <a href="https://amazon.enterprise.slack.com/team/U033KLXL0FQ" target="_blank" rel="noopener" style="color:#ff9900;font-weight:600;text-decoration:none">@harisss</a>.</p>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="btn sec" onclick="closeAllPopups()">Close</button>
      <button class="btn" style="background:#4ade80" onclick="closeAllPopups();showLoginModal()">Login</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

function showColorPopup(color,tickets){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const colorNames={green:'GREEN (0-4 days)',yellow:'YELLOW (4-7 days)',red:'RED (7-10 days)',black:'BLACK (>10 days)',purple:'PURPLE (Reopened)'};
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusColor=(s)=>({'Resolved':'#4ade80','Closed':'#4ade80','Assigned':'#44b9d6','Work In Progress':'#fbbf24','Pending':'#ff9900','Researching':'#a78bfa'})[s]||'#879596';
  const tix=colorTicketsFor(color);
  const me=(window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser())?String(window.PHDAuth.getUser().username||'').toLowerCase():'';
  // Group by agent, then sort agents by ticket count (highest -> lowest).
  const byAgent={}; tix.forEach(r=>{ const a=r.AssigneeIdentity||'Unassigned'; (byAgent[a]=byAgent[a]||[]).push(r); });
  const agentList=Object.entries(byAgent).sort((a,b)=>b[1].length-a[1].length);
  const now=new Date();
  // One expandable agent section: header (name + count) + an Excel table of their tickets.
  const agentBlock=([name,tickets],idx)=>{
    const dn=displayName(name);
    const nmeta=isLMCAP(name)?' <span class="pt-default">DEFAULT</span>':'';
    // How many of this agent's tickets carry a Station Request / Address Exclusion label (map-pin badge)
    // and how many are No-EMT (no-entry badge).
    const prioCount=tickets.reduce((n,r)=>n+(hasPriorityLabel(r.Labels)?1:0),0);
    const noEmtCount=tickets.reduce((n,r)=>n+(hasNoEmt(r.Title,r.Labels)?1:0),0);
    const prioBadge=prioCount>0?' <span class="ap-agent-prio" title="'+prioCount+' Station Request / Address Exclusion ticket'+(prioCount===1?'':'s')+'">'+ic('map-pin',13)+' '+prioCount+'</span>':'';
    const noEmtBadge=noEmtCount>0?' <span class="ap-agent-prio ap-agent-noemt" title="'+noEmtCount+' No EMT ticket'+(noEmtCount===1?'':'s')+'">'+ic('no-entry',13)+' '+noEmtCount+'</span>':'';
    // Tickets oldest-first (most urgent at top).
    const rows=tickets.slice().sort((a,b)=>new Date(a.CreateDate)-new Date(b.CreateDate)).map(r=>{
      const cd=new Date(r.CreateDate);
      const validCd=!isNaN(cd);
      const daysAgo=validCd?Math.floor((now-cd)/864e5):0;
      const daysAgoTxt=daysAgo<=0?'Today':(daysAgo===1?'1 day ago':daysAgo+' days ago');
      // "Days left" until the 10-day (240h) black threshold. <=0 means already overdue.
      const left=10-daysAgo;
      const leftCls=left>3?'ap-left-ok':(left>0?'ap-left-warn':'ap-left-over');
      const leftTxt=left>0?(left+(left===1?' day':' days')):(left===0?'Due today':(Math.abs(left)+' days over'));
      const sid=r.ShortId||'';
      const created=validCd?cd.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
      // "Mine" = ticket assigned to the logged-in user -> can add a comment (server enforces this too).
      const mine=(me && String(name).toLowerCase()===me)?'1':'0';
      // Markers next to the ticket id: map-pin = Station Request / Address Exclusion, no-entry = No EMT.
      const isPrio=hasPriorityLabel(r.Labels);
      const isNoEmt=hasNoEmt(r.Title,r.Labels);
      const prio=isPrio?' <span class="ap-crown" title="Station Request / Address Exclusion">'+ic('map-pin',13)+'</span>':'';
      const noEmt=isNoEmt?' <span class="ap-crown ap-noemt" title="No EMT">'+ic('no-entry',13)+'</span>':'';
      return '<tr'+(isPrio?' class="ap-row-prio"':'')+'>'+
        '<td><a class="ap-id" href="https://t.corp.amazon.com/issues/'+esc(sid)+'" target="_blank" rel="noopener">'+ic('ticket',13)+' '+esc(sid)+'</a>'+prio+noEmt+'</td>'+
        '<td><span class="ap-st" style="color:'+statusColor(r.Status)+'">'+esc(r.Status||'—')+'</span></td>'+
        '<td>'+esc(created)+'</td>'+
        '<td>'+daysAgoTxt+'</td>'+
        '<td class="'+leftCls+'">'+leftTxt+'</td>'+
        '<td class="ap-cmt pc-tk-cmt" data-sid="'+esc(sid)+'" data-mine="'+mine+'"><span class="pc-tk-cmt-txt">Loading…</span></td>'+
      '</tr>';
    }).join('');
    return '<div class="ap-agent">'+
      '<button type="button" class="ap-agent-head" onclick="apToggleAgent(this)">'+
        '<span class="ap-agent-name">'+esc(dn)+nmeta+prioBadge+noEmtBadge+'<span class="sub">@'+esc(name)+'</span></span>'+
        '<span class="ap-agent-count" style="color:'+colorHex[color]+'">'+tickets.length+'</span>'+
        '<span class="ap-caret" aria-hidden="true">\u25be</span>'+
      '</button>'+
      '<div class="ap-agent-body"><div class="ap-scroll"><table class="ap-tbl">'+
        '<colgroup><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:10%"><col style="width:10%"><col style="width:45%"></colgroup>'+
        '<thead><tr>'+
        '<th>Ticket</th><th>Status</th><th>Created</th><th>Age</th><th>Time left</th><th>Last comment</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div></div>'+
    '</div>';
  };
  const body=agentList.length?agentList.map(agentBlock).join(''):'<p class="pc-none">No open tickets in this category.</p>';
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div class="popup-card" style="max-width:80vw;width:80vw">
    <div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">
      <div><h2 style="color:${colorHex[color]};font-size:1.45em">${colorNames[color]}</h2><div class="pc-subcount" style="font-size:.95em">${tix.length} open ticket${tix.length===1?'':'s'} · ${agentList.length} agent${agentList.length===1?'':'s'} · highest first</div></div>
      <div class="popup-actions"><button class="btn" onclick="downloadColorCSV('${color}')">Download CSV</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <div style="margin-top:16px">${body}</div></div>`;
  document.body.appendChild(overlay);
  // Fetch the latest comment for every ticket shown (all agents) and fill the "Last comment" column.
  fillLatestComments(overlay, tix.map(r=>r.ShortId).filter(Boolean));
}
// Expand/collapse one agent section in the color popup — accordion: only one open at a time.
function apToggleAgent(btn){
  const s=btn.closest('.ap-agent'); if(!s)return;
  const willOpen=!s.classList.contains('open');
  // Collapse every other open agent section in this popup.
  const scope=s.closest('.popup-card')||document;
  scope.querySelectorAll('.ap-agent.open').forEach(function(other){ if(other!==s) other.classList.remove('open'); });
  s.classList.toggle('open', willOpen);
}
window.apToggleAgent=apToggleAgent;
window.showColorPopup=showColorPopup;

function showAgentDrilldown(color,agentName){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  const tix=colorTicketsFor(color).filter(r=>(r.AssigneeIdentity||'Unassigned')===agentName);
  // Sort by CreateDate ascending (oldest first, newest at the bottom)
  tix.sort((a,b)=>new Date(a.CreateDate)-new Date(b.CreateDate));
  const now=new Date();const dn=displayName(agentName);
  // Latest-comment column is shown only for red / black / purple sections.
  const showComments=(color==='red'||color==='black'||color==='purple');
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Each ticket is a row-card: ShortId link + status pill on top, created date + age below,
  // and (for red/black/purple) the latest comment underneath. Oldest first, newest at the bottom.
  const statusColor=(s)=>({'Resolved':'#4ade80','Closed':'#4ade80','Assigned':'#44b9d6','Work In Progress':'#fbbf24','Pending':'#ff9900','Researching':'#a78bfa'})[s]||'#879596';
  const rows=tix.map(r=>{
    const cd=new Date(r.CreateDate);
    const daysAgo=Math.floor((now-cd)/(864e5));
    const daysText=daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;
    const sid=r.ShortId||'';
    const st=esc(r.Status||'');
    const commentRow=showComments?`<div class="pc-tk-cmt" data-sid="${esc(sid)}">${ic('message',13)} <span class="pc-tk-cmt-txt">Loading latest comment…</span></div>`:'';
    const isPrio=hasPriorityLabel(r.Labels);
    const isNoEmt=hasNoEmt(r.Title,r.Labels);
    const prio=isPrio?` <span class="ap-crown" title="Station Request / Address Exclusion">${ic('map-pin',13)}</span>`:'';
    const noEmt=isNoEmt?` <span class="ap-crown ap-noemt" title="No EMT">${ic('no-entry',13)}</span>`:'';
    return`<div class="pc-tk${isPrio?' pc-tk-prio':''}">`+
      `<div class="pc-tk-top">`+
        `<a class="pc-tk-id" href="https://t.corp.amazon.com/issues/${esc(sid)}" target="_blank" rel="noopener">${ic('ticket',14)} ${esc(sid)}</a>${prio}${noEmt}`+
        `<span class="pc-tk-status" style="color:${statusColor(r.Status)};border-color:${statusColor(r.Status)}">${st}</span>`+
      `</div>`+
      `<div class="pc-tk-meta">${ic('calendar',13)} ${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span class="pc-tk-age">· ${daysText}</span></div>`+
      commentRow+
    `</div>`;
  }).join('');
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div class="popup-card" style="max-width:80vw;width:80vw">
    <div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">
      <div><h2 style="color:${colorHex[color]}">${dn}</h2><div class="pc-subcount">${tix.length} ticket${tix.length===1?'':'s'} · oldest first</div></div>
      <div class="popup-actions"><button class="btn" onclick="showColorPopup('${color}')">← Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <div class="pc-tk-list">${rows||'<p class="pc-none">No tickets.</p>'}</div></div>`;
  document.body.appendChild(overlay);
  // Fetch latest comments for the shown tickets (red/black/purple only) and fill the column.
  if(showComments){fillLatestComments(overlay,tix.map(r=>r.ShortId).filter(Boolean));}
}

// Batch-fetch the latest comment per ticket and populate each ticket card's comment row.
async function fillLatestComments(overlay,shortIds){
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setTxt=(row,html,muted)=>{const t=row.querySelector('.pc-tk-cmt-txt');if(t)t.innerHTML=html;row.style.color=muted?'#5f6b6c':'#d5dbdb';};
  const rows=overlay.querySelectorAll('.pc-tk-cmt');
  if(!window.PHDAuth||!window.PHDAuth.getUser||!window.PHDAuth.getUser()){rows.forEach(row=>setTxt(row,'Login to view comments',true));return;}
  try{
    const r=await window.PHDAuth.api('POST','/api/comments/latest',{shortIds});
    const map=(r.ok&&r.data)?r.data:{};
    rows.forEach(row=>{
      const sid=row.getAttribute('data-sid');
      const c=map[sid];
      if(c&&c.text){
        const when=c.at?new Date(c.at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
        setTxt(row,esc(c.text)+' <span style="color:#5f6b6c">— '+esc(c.user)+(when?(' · '+when):'')+'</span>',false);
      }else if(row.getAttribute('data-mine')==='1'){
        // No comment yet AND this ticket is assigned to me -> offer an inline "Add comment" action.
        setTxt(row,'<button type="button" class="ap-add-cmt" onclick="apAddComment(this,\''+esc(sid)+'\')">'+ic('plus',12)+' Add comment</button>',true);
      }else{
        setTxt(row,'No comment yet',true);
      }
    });
  }catch(e){rows.forEach(row=>setTxt(row,'Could not load comments',true));}
}
// Inline "add comment" from the color popup (only shown for the logged-in user's own tickets).
function apAddComment(btn, shortId){
  const cell=btn.closest('.pc-tk-cmt'); if(!cell)return;
  const txtWrap=cell.querySelector('.pc-tk-cmt-txt')||cell;
  txtWrap.innerHTML='<textarea class="ap-cmt-input" maxlength="2000" placeholder="Add a comment on '+shortId+'\u2026"></textarea>'+
    '<div class="ap-cmt-actions"><button type="button" class="ap-cmt-save" onclick="apSaveComment(this,\''+shortId.replace(/'/g,"\\'")+'\')">Save</button>'+
    '<button type="button" class="ap-cmt-cancel" onclick="apCancelComment(this)">Cancel</button></div>';
  // The wrapper span is inline (shrink-to-fit); force it block so the editor spans the full cell.
  txtWrap.style.display='block'; txtWrap.style.width='100%';
  const ta=txtWrap.querySelector('textarea'); if(ta) ta.focus();
}
window.apAddComment=apAddComment;
function apCancelComment(btn){
  const cell=btn.closest('.pc-tk-cmt'); const sid=cell?cell.getAttribute('data-sid'):'';
  const txtWrap=cell?cell.querySelector('.pc-tk-cmt-txt'):null;
  if(txtWrap){ txtWrap.style.display=''; txtWrap.style.width=''; txtWrap.innerHTML='<button type="button" class="ap-add-cmt" onclick="apAddComment(this,\''+String(sid).replace(/'/g,"\\'")+'\')">'+ic('plus',12)+' Add comment</button>'; }
}
window.apCancelComment=apCancelComment;
async function apSaveComment(btn, shortId){
  const cell=btn.closest('.pc-tk-cmt'); if(!cell)return;
  const ta=cell.querySelector('textarea'); const text=(ta&&ta.value||'').trim();
  if(!text){ if(ta) ta.focus(); return; }
  btn.disabled=true; btn.textContent='Saving\u2026';
  try{
    const r=await window.PHDAuth.api('POST','/api/tickets/'+encodeURIComponent(shortId)+'/comments',{text});
    const txtWrap=cell.querySelector('.pc-tk-cmt-txt')||cell;
    if(r.ok&&r.data){
      const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const when=r.data.at?new Date(r.data.at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
      txtWrap.style.display=''; txtWrap.style.width='';
      txtWrap.innerHTML=esc(text)+' <span style="color:#5f6b6c">\u2014 '+esc(r.data.user||'')+(when?(' \u00b7 '+when):'')+'</span>';
      cell.style.color='#d5dbdb';
    }else{
      btn.disabled=false; btn.textContent='Save';
      window.PHDAlert&&window.PHDAlert({title:'Could not save',body:(r.data&&r.data.error)||'Could not add the comment.'});
    }
  }catch(e){ btn.disabled=false; btn.textContent='Save'; window.PHDAlert&&window.PHDAlert({title:'Could not save',body:'Could not add the comment.'}); }
}
window.apSaveComment=apSaveComment;
function downloadColorCSV(color){
  const tickets=colorTicketsFor(color);
  let csv='ShortId,Assignee,CreateDate,Status,Title\n';
  tickets.forEach(r=>{csv+=`"${r.ShortId||''}","${r.AssigneeIdentity||''}","${r.CreateDate||''}","${r.Status||''}","${(r.Title||'').replace(/"/g,'""')}"\n`;});
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${color}_tickets.csv`;a.click();URL.revokeObjectURL(url);
}

function showIncidentPopup(type){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const tickets=M.incTickets[type]||[];
  // Group by resolver/assignee
  const byAgent={};tickets.forEach(r=>{const a=displayName(r.ResolvedByIdentity||r.AssigneeIdentity||'Unassigned');if(!byAgent[a])byAgent[a]=[];byAgent[a].push(r);});
  const agentList=Object.entries(byAgent).sort((a,b)=>b[1].length-a[1].length);
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  const agentRows=agentList.map(([name,tix])=>{const style=name==='LM-CAP'?'color:#f97316;font-style:italic':'color:#44b9d6';return`<tr style="cursor:pointer" onclick="showIncidentAgentDrilldown('${type.replace(/'/g,"\\'")}','${name.replace(/'/g,"\\'")}')"><td><strong style="${style}">${name}</strong>${name==='LM-CAP'?'<span style="margin-left:8px;padding:2px 6px;background:rgba(249,115,22,.15);color:#f97316;border-radius:3px;font-size:.7em">DEFAULT</span>':''}</td><td style="color:#ff9900;font-weight:700;font-size:1.1em">${tix.length}</td></tr>`;}).join('');
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="color:#ff9900;font-size:1.1em">${type} — ${tickets.length} tickets</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="downloadIncidentCSV('${type.replace(/'/g,"\\'")}')">Download CSV</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <p style="color:#879596;font-size:.85em;margin-bottom:12px">Click an agent to view their tickets</p>
    <table><thead><tr><th>Agent</th><th>Tickets</th></tr></thead><tbody>${agentRows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

function showIncidentAgentDrilldown(type,agentName){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const tickets=(M.incTickets[type]||[]).filter(r=>displayName(r.ResolvedByIdentity||r.AssigneeIdentity||'Unassigned')===agentName);
  tickets.sort((a,b)=>new Date(b.CreateDate)-new Date(a.CreateDate));
  const now=new Date();
  const rows=tickets.map(r=>{
    const cd=new Date(r.CreateDate);const daysAgo=Math.floor((now-cd)/(864e5));
    const daysText=daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;
    return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.ShortId}" target="_blank" style="color:#44b9d6">${r.ShortId}</a></td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${r.Status}</td></tr>`;
  }).join('');
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:#ff9900;font-size:1.1em">${agentName} — ${tickets.length} tickets (${type})</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="showIncidentPopup('${type.replace(/'/g,"\\'")}')">← Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <table><thead><tr><th>Ticket ID</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}
function downloadIncidentCSV(type){
  const tickets=M.incTickets[type]||[];
  let csv='ShortId,Assignee,CreateDate,Status,Title\n';
  tickets.forEach(r=>{csv+=`"${r.ShortId||''}","${r.AssigneeIdentity||''}","${r.CreateDate||''}","${r.Status||''}","${(r.Title||'').replace(/"/g,'""')}"\n`;});
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${type.replace(/[^a-zA-Z0-9]/g,'_')}_tickets.csv`;a.click();URL.revokeObjectURL(url);
}

function showHIUnresolvedPopup(){
  closeAllPopups();
  const tix=M.hiUnresolvedTickets||[];
  const now=new Date();
  const rows=tix.map(r=>{const cd=new Date(r.CreateDate);const daysAgo=Math.floor((now-cd)/(864e5));const daysText=isNaN(daysAgo)?'':daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.id}" target="_blank" style="color:#44b9d6">${r.id}</a></td><td><strong style="color:${r.cnt>=2?'#ff5252':'#ffb84d'}">${r.cnt}</strong></td><td>${displayName(r.assignee)||'-'}</td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${r.status}</td></tr>`;}).join('');
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 style="color:#ffb84d;font-size:1.1em">Unresolved Repeat Incidents (HI>0) — ${tix.length} tickets</h2><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    <table><thead><tr><th>Ticket ID</th><th>HI Cnt</th><th>Assignee</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

// Per-agent colour breakdown + slim ticket lists from /api/shift-report, for the takeover drill-down.
let SR_DATA=null;      // agents map { agent: {purple,black,...,total, tix:{color:[{id,c,s}]}} }
let SR_COUNTS=null;    // status/activity counts
let SR_COLORS=null;    // queue-by-colour counts
async function renderShiftReport(){
  // Show the shimmer skeleton immediately (in case we weren't deep-linked), then fetch the tiny
  // aggregate payload — NOT the full ~8k-ticket blob. This makes the page load in ~1s.
  try{ if(!document.querySelector('.sr .sk-blk')) document.getElementById('app').innerHTML=topBar('shift-report')+shiftReportSkeleton(); }catch(e){}
  let d=null;
  try{ const r=await window.PHDAuth.api('GET','/api/shift-report'); if(r.ok&&r.data)d=r.data; }catch(e){}
  if(!d){ document.getElementById('app').innerHTML=topBar('shift-report')+'<div class="content sr"><div class="sr-hero"><div class="sr-hero-txt"><span class="sr-eyebrow">Queue snapshot</span><h1>'+ic('clipboard',24)+' Shift Report</h1><p class="sr-lead">Could not load the shift report. Please refresh.</p></div></div></div>'; attachNewFileHandler(); return; }
  const cc=d.counts||{}, colors=d.colors||{};
  SR_COUNTS=cc; SR_COLORS=colors;
  const today=new Date();
  const dateStr=today.toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric'});
  const black=colors.black||0, red=colors.red||0;
  const inQueue=cc.inQ||0;
  const openTotal=cc.openTotal||0;
  // Per-agent colour breakdown for the takeover chart (already computed server-side).
  SR_DATA=d.agents||{};
  const agentSorted=Object.entries(SR_DATA).sort((a,b)=>b[1].total-a[1].total);
  window._takeoverAgents=agentSorted;
  // Shim so the rest of the render (built for M) reads from the aggregate payload.
  const m={ inQ:inQueue, asgn:cc.Assigned||0, wip:cc['Work In Progress']||0, researching:cc.Researching||0, pend:cc.Pending||0, res:cc.Resolved||0, closed:cc.Closed||0, T:cc.T||0, last12Created:cc.last12Created||0, last24Created:cc.last24Created||0, last12Resolved:cc.last12Resolved||0 };
  const ct={ purple:{length:colors.purple||0}, black:{length:colors.black||0}, red:{length:colors.red||0}, yellow:{length:colors.yellow||0}, green:{length:colors.green||0} };
  const pct=(v)=>(v/openTotal*100||0).toFixed(1);
  // Number cell that animates in (tally): shows a small spinner placeholder, then scrambles -> counts up.
  const nT=(v,cls)=>`<span class="sr-v ${cls||''} tally-ph" data-tally="${v}">\u2014</span>`;
  const colorTile=(cls,label,val,range)=>`<div class="sr-color sr-${cls}"><div class="sr-color-dot"></div><div class="sr-color-v">${nT(val)}</div><div class="sr-color-l">${label}</div><div class="sr-color-r">${range}</div></div>`;
  document.getElementById('app').innerHTML=topBar('shift-report')+`<div class="content sr">
  <div class="sr-hero">
    <div class="sr-hero-txt">
      <span class="sr-eyebrow">${ic('clock',12)} Queue snapshot · ${dateStr}</span>
      <h1>${ic('clipboard',24)} Shift Report</h1>
      <p class="sr-lead">Queue health for handoff — <strong>${inQueue}</strong> unresolved tickets in queue. Prioritise oldest (Black/Red) and reopened (Purple) first.</p>
    </div>
    <div class="sr-hero-badge"><div class="sr-hero-num">${nT(inQueue)}</div><div class="sr-hero-cap">In queue</div></div>
  </div>

  <section class="sr-sec sr-card-sec sr-sec-takeover">
    <div class="sr-sec-head"><h2>${ic('alert',18)} Takeover — Queue by Age</h2>
      <div class="sr-sec-actions"><button class="btn sec sr-exp" onclick="exportTakeover()">${ic('copy',14)} Export takeover</button></div></div>
    <div class="sr-sec-body">
    <div class="sr-colors">
      ${colorTile('purple','Reopened',ct.purple.length,'Purple')}
      ${colorTile('black','&gt; 10 days',black,'Black · &gt;240h')}
      ${colorTile('red','7–10 days',red,'Red · 168–240h')}
      ${colorTile('yellow','4–7 days',ct.yellow.length,'Yellow · 96–168h')}
      ${colorTile('green','0–4 days',ct.green.length,'Green · 0–96h')}
    </div>
    <div class="sr-chart-card"><h3>Unresolved Tickets by Agent (Age Breakdown)</h3><div class="chart-wrap" style="height:380px"><canvas id="takeoverChart"></canvas></div></div>
    </div>
  </section>

  <section class="sr-sec sr-card-sec sr-sec-handoff" id="shiftContent">
    <div class="sr-sec-head"><h2>${ic('clipboard',18)} Handoff Report</h2>
      <div class="sr-sec-actions"><button class="btn sr-exp" onclick="showExportRegionModal()">${ic('copy',14)} Export handoff</button></div></div>
    <div class="sr-sec-body">
    <div class="sr-meta">
      <span class="sr-chip">${ic('clock',13)} <b><span id="shiftDate">${dateStr}</span> 19:00 <span id="shiftTz">IST</span></b></span>
      <span class="sr-chip">Timeframe: <b>7:00 AM <span class="shiftTz2">IST</span> – 7:00 PM <span class="shiftTz2">IST</span></b></span>
      <span class="sr-chip">Handoff: <b><span id="shiftHandoff">IND → AMER</span></b></span>
    </div>
    <div class="sr-cards">
      <div class="sr-card"><h3>Ticket Health</h3><table class="sr-table"><tbody>
        <tr><td>&gt;10 Days Not Closed <em>(Black)</em></td><td class="sr-v">${nT(black)}</td></tr>
        <tr><td>Pending &gt;72 Hours <em>(Red)</em></td><td class="sr-v">${nT(red)}</td></tr>
        <tr><td>Created in Last 12 Hours</td><td class="sr-v">${nT(m.last12Created)}</td></tr>
        <tr><td>Created in Last 24 Hours</td><td class="sr-v">${nT(m.last24Created)}</td></tr>
      </tbody></table></div>
      <div class="sr-card"><h3>Last 12 Hours Activity</h3><table class="sr-table"><tbody>
        <tr><td>Assigned</td><td class="sr-v">${nT(m.asgn)}</td></tr>
        <tr><td>Pending</td><td class="sr-v">${nT(m.pend)}</td></tr>
        <tr><td>Work In Progress</td><td class="sr-v">${nT(m.wip)}</td></tr>
        <tr><td>Resolved</td><td class="sr-v">${nT(m.last12Resolved)}</td></tr>
      </tbody></table></div>
      <div class="sr-card"><h3>Ticket Count by Status</h3><table class="sr-table"><tbody>
        <tr><td>Assigned</td><td class="sr-v">${nT(m.asgn)}</td></tr>
        <tr><td>Work In Progress</td><td class="sr-v">${nT(m.wip)}</td></tr>
        <tr><td>Researching</td><td class="sr-v">${nT(m.researching)}</td></tr>
        <tr><td>Pending</td><td class="sr-v">${nT(m.pend)}</td></tr>
        <tr><td>Resolved</td><td class="sr-v">${nT(m.res)}</td></tr>
      </tbody></table></div>
      <div class="sr-card"><h3>Status Distribution</h3><table class="sr-table"><tbody>
        <tr><td>Assigned</td><td class="sr-v"><b class="sr-pct" data-pct="${pct(m.asgn)}">0%</b></td></tr>
        <tr><td>Work In Progress</td><td class="sr-v"><b class="sr-pct" data-pct="${pct(m.wip)}">0%</b></td></tr>
        <tr><td>Researching</td><td class="sr-v"><b class="sr-pct" data-pct="${pct(m.researching)}">0%</b></td></tr>
        <tr><td>Pending</td><td class="sr-v"><b class="sr-pct" data-pct="${pct(m.pend)}">0%</b></td></tr>
        <tr><td>Resolved</td><td class="sr-v"><b class="sr-pct" data-pct="${pct(m.res)}">0%</b></td></tr>
      </tbody></table></div>
    </div>
    <div class="sr-notes">
      <label for="shiftNotes">${ic('message',13)} Notes for the incoming shift</label>
      <textarea id="shiftNotes" placeholder="Add your notes here — one per line…"></textarea>
    </div>
    </div>
  </section>
  </div>`;
  attachNewFileHandler();
  // Tally-animate every DB-derived number (spinner placeholder -> scramble -> count-up), then the %s.
  try{
    const root=document.querySelector('.sr');
    if(window.PHDAuth&&window.PHDAuth.tallyAll) window.PHDAuth.tallyAll(root);
    // Percentages: count up to their 1-dp value and append "%".
    root.querySelectorAll('.sr-pct[data-pct]').forEach(function(el){ srTallyPct(el, parseFloat(el.getAttribute('data-pct'))||0); });
  }catch(e){}
  // Render takeover stacked bar chart
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  const labels=agentSorted.map(e=>e[0]);
  const seg=(key)=>agentSorted.map(e=>e[1][key]);
  const canvasEl=document.getElementById('takeoverChart');
  // Vertical gradient helper for each series color
  const grad=(c1,c2)=>{const cx=canvasEl.getContext('2d');const g=cx.createLinearGradient(0,0,0,380);g.addColorStop(0,c1);g.addColorStop(1,c2);return g;};
  // Soft drop-shadow plugin for bars
  const shadowPlugin={id:'barShadow',beforeDatasetsDraw(chart){const cx=chart.ctx;cx.save();cx.shadowColor='rgba(0,0,0,.45)';cx.shadowBlur=10;cx.shadowOffsetX=0;cx.shadowOffsetY=4;},afterDatasetsDraw(chart){chart.ctx.restore();}};
  makeChart('takeoverChart',{type:'bar',data:{labels,datasets:[
    {label:'Purple (Reopened)',data:seg('purple'),backgroundColor:grad('#c4b0fb','#8b5cf6')},
    {label:'Black (>10d)',data:seg('black'),backgroundColor:grad('#a3a3a3','#555')},
    {label:'Red (7-10d)',data:seg('red'),backgroundColor:grad('#ff7b7b','#e0342f')},
    {label:'Yellow (4-7d)',data:seg('yellow'),backgroundColor:grad('#ffd76b','#eab308')},
    {label:'Green (0-4d)',data:seg('green'),backgroundColor:grad('#6ee7a0','#22c55e')}
  ].map(d=>({...d,borderRadius:5,borderSkipped:false,borderWidth:1,borderColor:'rgba(0,0,0,.25)',maxBarThickness:52}))},
  options:{responsive:true,maintainAspectRatio:false,layout:{padding:{top:10}},
    onHover:(e,els)=>{e.native.target.style.cursor=els.length?'pointer':'default';},
    onClick:(evt,els)=>{if(els.length>0){const el=els[0];const agent=labels[el.index];const colorKey=['purple','black','red','yellow','green'][el.datasetIndex];showTakeoverAgentColorPopup(agent,colorKey);}},
    plugins:{legend:{position:'top',labels:{color:'#d5dbdb',font:{size:11},usePointStyle:true,pointStyle:'rectRounded',padding:16}},
      tooltip:{backgroundColor:'rgba(10,10,10,.95)',borderColor:'#333',borderWidth:1,padding:12,cornerRadius:8,titleColor:'#fff',bodyColor:'#d5dbdb',usePointStyle:true}},
    scales:{x:{stacked:true,grid:{display:false},ticks:{color:'#d5dbdb',font:{size:11,weight:'500'}}},
      y:{stacked:true,beginAtZero:true,grid:{color:'rgba(255,255,255,.05)',drawBorder:false},ticks:{font:{size:11}},border:{display:false}}}},
  plugins:[shadowPlugin]});
}

// Count up a percentage element to `target` (1-dp) with a trailing "%" (mirrors the tally feel).
function srTallyPct(el,target){
  if(!el)return; el.classList.remove('tally-ph');
  const raf=window.requestAnimationFrame||function(cb){return setTimeout(function(){cb(Date.now());},16);};
  const DUR=600;let start=null;
  const step=function(ts){ if(start===null)start=ts; const p=Math.min(1,(ts-start)/DUR); const v=(target*(1-Math.pow(1-p,3))); el.textContent=v.toFixed(1)+'%'; if(p<1)raf(step); else el.textContent=target.toFixed(1)+'%'; };
  raf(step);
}
function showExportRegionModal(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:50vw;width:50vw;min-width:min(92vw,420px);padding:28px">
    <h2 style="color:#fff;font-size:1.2em;margin-bottom:8px">Export Shift Report</h2>
    <p style="color:#879596;font-size:.9em;margin-bottom:20px">Which region is this report for?</p>
    <div style="display:flex;gap:12px">
      <button class="btn" style="flex:1" onclick="applyRegion('IN')">India (IST)</button>
      <button class="btn" style="flex:1" onclick="applyRegion('US')">US (MST)</button>
    </div>
    <button class="btn sec" style="margin-top:14px;width:100%" onclick="closeAllPopups()">Cancel</button>
  </div>`;
  document.body.appendChild(overlay);
}

function applyRegion(region){
  const cc=SR_COUNTS||{}, col=SR_COLORS||{};
  const m={ inQ:cc.inQ||0, asgn:cc.Assigned||0, wip:cc['Work In Progress']||0, researching:cc.Researching||0, pend:cc.Pending||0, res:cc.Resolved||0, last12Resolved:cc.last12Resolved||0, last12Created:cc.last12Created||0, last24Created:cc.last24Created||0 };
  const ct={ purple:{length:col.purple||0}, black:{length:col.black||0}, red:{length:col.red||0}, yellow:{length:col.yellow||0}, green:{length:col.green||0} };
  const tz=region==='IN'?'IST':'MST';
  const handoff=region==='IN'?'IND → AMER':'AMER → IND';
  document.getElementById('shiftTz').textContent=tz;
  document.querySelectorAll('.shiftTz2').forEach(el=>el.textContent=tz);
  document.getElementById('shiftHandoff').textContent=handoff;
  const today=new Date().toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric'});
  const openTotal=(cc.openTotal!=null?cc.openTotal:((cc.T||0)-(cc.Closed||0)));
  const rawNotes=(document.getElementById('shiftNotes')||{}).value||'';
  const notes=rawNotes.split(/\r?\n/).filter(l=>l.trim()!=='').map(l=>'    • '+l.trim()).join('\n');
  const txt=`Shift Handoff Report
Date/Time: ${today} 19:00 ${tz}
Timeframe Collected: 7:00 AM ${tz} - 7:00 PM ${tz}
Handoff: ${handoff}

Ticket Health Status
    >10 Days Not Closed: ${ct.black.length}
    Pending >72 Hours: ${ct.red.length}
    Created in Last 12 Hours: ${m.last12Created}
    Created in Last 24 Hours: ${m.last24Created}

Last 12 Hours Activity
    Assigned: ${m.asgn}
    Pending: ${m.pend}
    WIP: ${m.wip}
    Resolved: ${m.last12Resolved}

Ticket Count by Status
    Assigned: ${m.asgn}
    Work In Progress: ${m.wip}
    Researching: ${m.researching}
    Pending: ${m.pend}

Status Distribution (%)
    Assigned: ${(m.asgn/openTotal*100||0).toFixed(1)}%
    Work In Progress: ${(m.wip/openTotal*100||0).toFixed(1)}%
    Researching: ${(m.researching/openTotal*100||0).toFixed(1)}%
    Pending: ${(m.pend/openTotal*100||0).toFixed(1)}%

Current Amount of Tickets In Queue: ${m.inQ}

Notes:
${notes}`;
  closeAllPopups();
  const clearNotes=()=>{const n=document.getElementById('shiftNotes');if(n)n.value='';};
  navigator.clipboard.writeText(txt).then(()=>{
    showToast('Shift report copied to clipboard ('+region+' / '+tz+')');clearNotes();
  }).catch(()=>{
    const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
    showToast('Shift report copied to clipboard ('+region+' / '+tz+')');clearNotes();
  });
}

async function exportTakeover(){
  const cc=SR_COUNTS||{}, col=SR_COLORS||{};
  const inQ=cc.inQ||0, ct={purple:{length:col.purple||0},black:{length:col.black||0},red:{length:col.red||0},yellow:{length:col.yellow||0},green:{length:col.green||0}};
  const linesHtml=`Hello Team,<br>
Our queue currently stands at <b>${inQ}</b> unresolved tickets, with statuses:<br>
&nbsp;&nbsp;&nbsp;&nbsp;PURPLE (Reopened): <b>${ct.purple.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;BLACK (&gt;240 hrs / &gt;10 days): <b>${ct.black.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;RED (168-240 hrs / 7-10 days): <b>${ct.red.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;YELLOW (96-168 hrs / 4-7 days): <b>${ct.yellow.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;GREEN (0-96 hrs / 0-4 days): <b>${ct.green.length}</b><br>
Please prioritize the above.`;
  const txt=`Hello Team,\nOur queue currently stands at ${inQ} unresolved tickets, with statuses:\n    PURPLE (Reopened): ${ct.purple.length}\n    BLACK (>240 hrs / >10 days): ${ct.black.length}\n    RED (168-240 hrs / 7-10 days): ${ct.red.length}\n    YELLOW (96-168 hrs / 4-7 days): ${ct.yellow.length}\n    GREEN (0-96 hrs / 0-4 days): ${ct.green.length}\nPlease prioritize the above.`;
  // Get chart image
  const canvas=document.getElementById('takeoverChart');
  try{
    if(canvas&&window.ClipboardItem){
      const imgData=canvas.toDataURL('image/png');
      const html=`<div>${linesHtml}<br><br><img src="${imgData}" style="max-width:700px"/></div>`;
      const htmlBlob=new Blob([html],{type:'text/html'});
      const textBlob=new Blob([txt],{type:'text/plain'});
      await navigator.clipboard.write([new ClipboardItem({'text/html':htmlBlob,'text/plain':textBlob})]);
      showToast('Takeover report + chart copied to clipboard');
      return;
    }
  }catch(e){/* fall through to text-only */}
  navigator.clipboard.writeText(txt).then(()=>showToast('Takeover report copied (text only)')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast('Takeover report copied (text only)');
  });
}

function showTakeoverAgentColorPopup(agentName,colorKey){
  closeAllPopups();
  const colorNames={green:'GREEN (0-4 days)',yellow:'YELLOW (4-7 days)',red:'RED (7-10 days)',black:'BLACK (>10 days)',purple:'PURPLE (Reopened)'};
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  // Tickets in that colour for this agent, from the shift-report payload (sorted oldest -> newest).
  const src=((SR_DATA&&SR_DATA[agentName]&&SR_DATA[agentName].tix&&SR_DATA[agentName].tix[colorKey])||[]).slice()
    .sort((a,b)=>new Date(a.c)-new Date(b.c));
  const tix=src;
  const now=new Date();
  const rows=tix.map(r=>{const cd=new Date(r.c);const daysAgo=Math.floor((now-cd)/(864e5));const daysText=isNaN(daysAgo)?'':daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.id}" target="_blank" style="color:#44b9d6">${r.id}</a></td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${r.s}</td></tr>`;}).join('');
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:${colorHex[colorKey]};font-size:1.1em">${agentName} — ${colorNames[colorKey]} — ${tix.length} tickets</h2>
      <button class="btn danger" onclick="closeAllPopups()">Close</button>
    </div>
    <p style="color:#879596;font-size:.85em;margin-bottom:8px">Sorted oldest → newest by creation date</p>
    <table><thead><tr><th>Ticket ID</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows||'<tr><td colspan="3" style="color:#879596">No tickets</td></tr>'}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

function showToast(msg){
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#1d8102;color:#fff;padding:12px 24px;border-radius:8px;z-index:2000;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

function showAgentTicketsPopup(agentName){
  closeAllPopups();
  const tickets=M.agentOpenTickets[agentName]||[];
  const assigned=tickets.filter(t=>t.Status==='Assigned').sort((a,b)=>new Date(b.CreateDate)-new Date(a.CreateDate));
  const wip=tickets.filter(t=>t.Status==='Work In Progress').sort((a,b)=>new Date(b.CreateDate)-new Date(a.CreateDate));
  const pending=tickets.filter(t=>t.Status==='Pending').sort((a,b)=>new Date(b.CreateDate)-new Date(a.CreateDate));
  const now=new Date();
  function renderRows(tix){
    if(tix.length===0)return'<tr><td colspan="3" style="color:#879596;text-align:center">No tickets</td></tr>';
    return tix.map(r=>{const cd=new Date(r.CreateDate);const daysAgo=Math.floor((now-cd)/(864e5));const daysText=daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.ShortId}" target="_blank" style="color:#44b9d6">${r.ShortId}</a></td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${r.Status}</td></tr>`;}).join('');
  }
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h2 style="color:#44b9d6;font-size:1.2em">${agentName} — Open Tickets (${tickets.length})</h2>
      <button class="btn danger" onclick="closeAllPopups()">Close</button>
    </div>
    <h3 style="color:#ff9900;font-size:.9em;font-weight:600;text-transform:uppercase;margin-bottom:8px">Assigned (${assigned.length})</h3>
    <table style="margin-bottom:20px"><thead><tr><th>Ticket ID</th><th>Created</th><th>Status</th></tr></thead><tbody>${renderRows(assigned)}</tbody></table>
    <h3 style="color:#fbbf24;font-size:.9em;font-weight:600;text-transform:uppercase;margin-bottom:8px">Work In Progress (${wip.length})</h3>
    <table style="margin-bottom:20px"><thead><tr><th>Ticket ID</th><th>Created</th><th>Status</th></tr></thead><tbody>${renderRows(wip)}</tbody></table>
    <h3 style="color:#a78bfa;font-size:.9em;font-weight:600;text-transform:uppercase;margin-bottom:8px">Pending (${pending.length})</h3>
    <table><thead><tr><th>Ticket ID</th><th>Created</th><th>Status</th></tr></thead><tbody>${renderRows(pending)}</tbody></table>
  </div>`;
  document.body.appendChild(overlay);
}

function showHIPopup(rootCause){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const tickets=M.hiCases.filter(h=>(h.rootCause||'Unknown').replace(/^\s*-\s*/,'').trim()===rootCause);
  const byAgent={};tickets.forEach(r=>{const a=displayName(r.assignee||'Unassigned');if(!byAgent[a])byAgent[a]=[];byAgent[a].push(r);});
  const agentList=Object.entries(byAgent).sort((a,b)=>b[1].length-a[1].length);
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  const agentRows=agentList.map(([name,tix])=>{const style=name==='LM-CAP'?'color:#f97316;font-style:italic':'color:#44b9d6';return`<tr style="cursor:pointer" onclick="showHIAgentDrilldown('${rootCause.replace(/'/g,"\\'")}','${name.replace(/'/g,"\\'")}')"><td><strong style="${style}">${name}</strong>${name==='LM-CAP'?'<span style="margin-left:8px;padding:2px 6px;background:rgba(249,115,22,.15);color:#f97316;border-radius:3px;font-size:.7em">DEFAULT</span>':''}</td><td style="color:#ff9900;font-weight:700;font-size:1.1em">${tix.length}</td></tr>`;}).join('');
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <h2 style="color:#ff9900;font-size:1.1em">${rootCause} — ${tickets.length} tickets</h2>
      <button class="btn danger" onclick="closeAllPopups()">Close</button>
    </div>
    <p style="color:#879596;font-size:.85em;margin-bottom:12px">Click an agent to view their tickets</p>
    <table><thead><tr><th>Agent</th><th>Tickets</th></tr></thead><tbody>${agentRows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

function showHIAgentDrilldown(rootCause,agentName){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const tickets=M.hiCases.filter(h=>(h.rootCause||'Unknown').replace(/^\s*-\s*/,'').trim()===rootCause&&displayName(h.assignee||'Unassigned')===agentName);
  tickets.sort((a,b)=>b.cnt-a.cnt);
  const now=new Date();
  const rows=tickets.map(r=>{
    const cd=new Date(r.CreateDate||'');const daysAgo=Math.floor((now-cd)/(864e5));
    const daysText=isNaN(daysAgo)?'':daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;
    return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.id}" target="_blank" style="color:#44b9d6">${r.id}</a></td><td><strong style="color:${r.cnt>=2?'#ff5252':'#ffb84d'}">${r.cnt}</strong></td><td>${r.status}</td></tr>`;
  }).join('');
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:#ff9900;font-size:1.1em">${agentName} — ${tickets.length} tickets (${rootCause})</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="showHIPopup('${rootCause.replace(/'/g,"\\'")}')">← Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <table><thead><tr><th>Ticket ID</th><th>Cnt</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

// Live-dashboard SHELL: paint the full structure + static labels immediately with spinners in
// every DB-derived slot (KPI numbers, chart areas, table bodies). renderDashboard() replaces it
// ---- Loading scramble: cycle random numbers in the age tiles until real data lands. ----
let _scrambleTimer=null;
function startScramble(){
  stopScramble();
  const tick=()=>{
    const els=document.querySelectorAll('.scramble-num');
    if(!els.length){stopScramble();return;}
    els.forEach(el=>{
      const max=parseInt(el.getAttribute('data-scramble-max'),10)||100;
      el.textContent=Math.floor(Math.random()*max);
    });
  };
  tick();
  _scrambleTimer=setInterval(tick,70); // ~14 fps flicker — fast enough to read as "loading"
}
function stopScramble(){ if(_scrambleTimer){clearInterval(_scrambleTimer);_scrambleTimer=null;} }

// ---- Summary-KPI scramble (matches the archive/Q2 "Summary Statistics" animation) ----
// While /api/dash/summary loads, flicker random numbers in every .scramble-kpi slot so the
// KPI cards look alive instead of showing a static spinner. Stopped when real values land.
let _kpiScrTimer=null;
function startKpiScramble(){
  stopKpiScramble();
  const tick=function(){
    const els=document.querySelectorAll('.scramble-kpi');
    if(!els.length){stopKpiScramble();return;}
    els.forEach(function(el){
      const max=parseInt(el.getAttribute('data-scr-max'),10)||100;
      const pct=el.getAttribute('data-scr-pct')==='1';
      const n=Math.random()*max;
      el.textContent=pct?(n.toFixed(1)+'%'):Math.floor(n).toLocaleString();
    });
  };
  tick();
  _kpiScrTimer=setInterval(tick,70);
}
function stopKpiScramble(){ if(_kpiScrTimer){clearInterval(_kpiScrTimer);_kpiScrTimer=null;} }

// Animate a KPI element from a brief scramble into its real value via a quick ease-out count-up.
// `raw` is the final display string (e.g. "7,918 (97%)", "45 hrs (18.9%)", "99.2%", "+49%").
// Only the FIRST number in the string is animated; the rest of the label is appended verbatim.
function countUpKpi(el,raw){
  if(!el)return;
  const raf=window.requestAnimationFrame||function(cb){return setTimeout(function(){cb(Date.now());},16);};
  try{
    const m=String(raw).match(/-?[\d,]*\.?\d+/); // first numeric token
    if(!m){ el.textContent=raw; return; }
    const numStr=m[0];
    const before=raw.slice(0,m.index), after=raw.slice(m.index+numStr.length);
    const isPct=/^\s*%/.test(after);
    const dec=(numStr.match(/\.(\d+)/)||[])[1];
    const decimals=dec?dec.length:0;
    const target=parseFloat(numStr.replace(/,/g,''));
    if(isNaN(target)){ el.textContent=raw; return; }
    const fmt=function(n){ const s=(decimals>0)?n.toFixed(decimals):Math.round(n).toLocaleString(); return before+s+after; };
    const SCRAMBLE_MS=150, COUNT_MS=650; let start=null;
    const scrMax=Math.max(10,isPct?100:Math.abs(target)*1.3);
    const sign=target<0?-1:1;
    const step=function(ts){
      try{
        if(start===null)start=ts;
        const t=ts-start;
        if(t<SCRAMBLE_MS){ el.textContent=fmt(sign*Math.random()*scrMax); raf(step); }
        else if(t<SCRAMBLE_MS+COUNT_MS){ const p=(t-SCRAMBLE_MS)/COUNT_MS; el.textContent=fmt(target*(1-Math.pow(1-p,3))); raf(step); }
        else { el.textContent=raw; }
      }catch(err){ el.textContent=raw; }
    };
    raf(step);
  }catch(err){ el.textContent=raw; }
}

// once the ticket data is loaded + computed. Mirrors renderDashboard()'s layout so there's no jump.
function renderDashboardShell(){
  const loggedIn=window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser();
  const sp='<span class="num-spinner"></span>';                 // inline number spinner
  const csp='<div class="chart-spin"><div class="spinner"></div></div>'; // chart-area spinner
  const tsp='<div style="display:flex;align-items:center;justify-content:center;min-height:140px"><div class="spinner"></div></div>';
  const kpi=(cls,label,tip)=>`<div class="kpi-card ${cls||''}"><div class="value">${sp}</div><div class="label">${label}${tip?` <span title="${tip}" style="cursor:help;opacity:.7">&#9432;</span>`:''}</div></div>`;
  // Age tiles show a "slot-machine" scramble of random numbers while the real counts load.
  const rnd=(max)=>Math.floor(Math.random()*max);
  const ageTile=(color,name,range,scrMax)=>`<div class="kpi-card age-tile" style="border-top-color:${color}"><div class="value scramble-num" data-scramble-max="${scrMax}" style="color:${color}">${rnd(scrMax)}</div><div class="age-name">${name}</div><div class="age-range">${range}</div></div>`;
  const chartBox=(title,tall)=>`<div class="chart-box"><h3>${title}</h3><div class="chart-wrap${tall?' tall':''}">${csp}</div></div>`;
  document.getElementById('app').innerHTML=topBar('dashboard')+`<div class="content">
  <div class="page-title" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
    <h1 style="margin:0;display:inline-flex;align-items:center;gap:12px">Q3 2026 <span class="live-badge">LIVE</span></h1>
    ${loggedIn?`<span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><a class="btn sec" id="alertBtn" href="alerts.html" style="position:relative">${ic('alert',15)} Alerts<span id="alertBadge" style="display:none;position:absolute;top:-8px;right:-8px;background:#ff5252;color:#fff;border-radius:20px;min-width:18px;height:18px;font-size:.7em;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px">0</span></a>${(window.PHDAuth&&window.PHDAuth.canUpload&&window.PHDAuth.canUpload())?`<button type="button" class="btn sec" onclick="tbUploadIntro('app')">${ic('upload',15)} Upload new data</button><input type="file" accept=".csv" id="uploadFile" style="display:none">`:''}<a class="btn sec" href="data-log.html">${ic('history',15)} Uploaded data log</a></span>`:''}
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Total Tickets Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    ${kpi('accent',ic('ticket',14)+' Total Tickets','Total number of tickets stored in the dashboard')}
    ${kpi('success',ic('check-circle',14)+' Resolved','Tickets in Resolved or Closed status')}
    ${kpi('warning',ic('hourglass',14)+' Unresolved Tickets','Tickets not in Resolved/Closed status')}
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Average Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    ${kpi('','Avg Resolution Time','Average resolution time vs 240hr SLA')}
    ${kpi('','SLA Compliance (≤240 hrs)','Resolved within 240 hrs')}
    ${kpi('',ic('bolt',14)+' AutoSIM Resolved','Tickets auto-resolved by AutoSIM')}
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Repeat Incident Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    ${kpi('accent',ic('repeat',14)+' Repeat Incidents (HI&gt;0)','Tickets with Historical Incident / Cnt > 0')}
    ${kpi('',ic('paw',14)+' HI involving pet incidents','Repeat incidents whose root cause is an unsecured animal / pet')}
    ${kpi('',ic('paw',14)+' % of HI involving pet incidents')}
    ${kpi('',ic('repeat',14)+' HI involving non-pet incidents')}
    ${kpi('',ic('repeat',14)+' % of HI involving non-pet incidents')}
    ${kpi('',ic('bar-chart',14)+' Pet vs non-pet gap in HI','Percentage-point difference')}
  </div>

  <div class="section"><h2>Ticket Age Classification</h2>
    <p class="meta-info">Click any color segment to view tickets. Download individual segments as CSV.</p>
    <div class="kpi-grid">
      ${ageTile('#4ade80',ic('check-circle',14)+' GREEN','(0-4 days)',200)}
      ${ageTile('#fbbf24',ic('clock',14)+' YELLOW','(4-7 days)',80)}
      ${ageTile('#ff5252',ic('alert',14)+' RED','(7-10 days)',15)}
      ${ageTile('#888',ic('flame',14)+' BLACK','(&gt;10 days)',8)}
      ${ageTile('#a78bfa',ic('reopen',14)+' PURPLE','(Reopened)',12)}
    </div></div>

  <div class="section"><h2>Queue Status</h2>
    <div class="handoff-grid">
      <div class="handoff-box"><h3>Ticket Count by Status</h3><ul>
        <li><span>Assigned</span><span class="val">${sp}</span></li>
        <li><span>Work In Progress</span><span class="val">${sp}</span></li>
        <li><span>Researching</span><span class="val">${sp}</span></li>
        <li><span>Pending</span><span class="val">${sp}</span></li>
        <li><span>Resolved</span><span class="val">${sp}</span></li>
        <li><span>Closed</span><span class="val">${sp}</span></li>
      </ul></div>
      <div class="handoff-box"><h3>Status Distribution (%)</h3><ul>
        <li><span>Assigned</span><span class="val">${sp}</span></li>
        <li><span>Work In Progress</span><span class="val">${sp}</span></li>
        <li><span>Researching</span><span class="val">${sp}</span></li>
        <li><span>Pending</span><span class="val">${sp}</span></li>
        <li><span>Resolved</span><span class="val">${sp}</span></li>
        <li><span>Closed</span><span class="val">${sp}</span></li>
      </ul></div>
    </div></div>

  <div class="charts-grid" style="grid-template-columns:repeat(2,1fr)">
    ${chartBox('Daily Tickets Created (Last 7 Days)')}
    ${chartBox('Daily Tickets Resolved (Last 7 Days)')}
  </div>
  <div class="charts-grid" style="grid-template-columns:repeat(2,1fr)">
    ${chartBox('Weekly Volume: Created')}
    ${chartBox('Weekly Volume: Resolved')}
  </div>
  <div class="section"><h2>SLA Compliance per Week (&le;240 hrs)</h2>
    <div class="chart-box"><div class="chart-wrap tall">${csp}</div></div>
  </div>
  <div class="section"><h2>Incident Types</h2><p class="meta-info">Click any incident type to view agent breakdown</p>${tsp}</div>
  <div class="section"><h2>Historical Incidents (Cnt > 0)</h2>${tsp}</div>
  </div>`;
  startScramble(); // animate the age-tile numbers while data loads
}

function renderDashboard(){
  stopScramble(); // real counts are in — halt the loading animation
  const m=M;
  const sorted=[...m.agents].sort((a,b)=>b.resolved-a.resolved);
  const ct=m.colorTickets;
  // Priority blink conditions:
  // BLACK: blink whenever there are any black (>240h) tickets.
  const blackBlink=ct.black.length>0;
  // PURPLE policy (role-based): only owner/manager/admin may hold reopened (purple) tickets.
  // Blink if count>0 AND any purple ticket is Unassigned OR assigned to someone who is NOT
  // owner/manager/admin. PURPLE_ALLOWED_SET is populated from /api/user-roles (see loadUserRoles).
  const allowed=window.PURPLE_ALLOWED_SET;// Set of lowercase usernames, or null if roster unknown
  const purpleBlink=ct.purple.length>0 && ct.purple.some(r=>{
    const a=(r.AssigneeIdentity||'').trim().toLowerCase();
    if(!a)return true;                       // Unassigned -> not allowed -> blink
    if(!allowed)return false;                // roster not loaded yet -> don't false-blink
    return !allowed.has(a);                  // assigned to a non owner/manager/admin -> blink
  });
  const loggedIn=window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser();
  document.getElementById('app').innerHTML=topBar('dashboard')+`<div class="content">
  <div class="page-title" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
    <h1 style="margin:0;display:inline-flex;align-items:center;gap:12px">Q3 2026 <span class="live-badge">LIVE</span></h1>
    ${loggedIn?`<span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><a class="btn sec" id="alertBtn" href="alerts.html" style="position:relative">${ic('alert',15)} Alerts<span id="alertBadge" style="display:none;position:absolute;top:-8px;right:-8px;background:#ff5252;color:#fff;border-radius:20px;min-width:18px;height:18px;font-size:.7em;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px">0</span></a>${(window.PHDAuth&&window.PHDAuth.canUpload&&window.PHDAuth.canUpload())?`<button type="button" class="btn sec" onclick="tbUploadIntro('app')">${ic('upload',15)} Upload new data</button><input type="file" accept=".csv" id="uploadFile" style="display:none">`:''}<a class="btn sec" href="data-log.html">${ic('history',15)} Uploaded data log</a></span>`:''}
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Total Tickets Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="kpi-card accent"><div class="value">${m.T.toLocaleString()}</div><div class="label">${ic('ticket',14)} Total Tickets <span title="Total number of tickets stored in the dashboard" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card success"><div class="value">${(m.res+m.closed).toLocaleString()} (${((m.res+m.closed)/m.T*100).toFixed(1)}%)</div><div class="label">${ic('check-circle',14)} Resolved <span title="Tickets in Resolved or Closed status" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card warning"><div class="value">${m.inQ.toLocaleString()} (${(m.inQ/m.T*100).toFixed(1)}%)</div><div class="label">${ic('hourglass',14)} Unresolved Tickets <span title="Tickets not in Resolved/Closed status (Assigned, WIP, Researching, Pending)" style="cursor:help;opacity:.7">&#9432;</span></div></div>
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Average Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="kpi-card"><div class="value">${m.avgR.toFixed(0)} hrs (${(m.avgR/240*100).toFixed(1)}%)</div><div class="label">Avg Resolution Time <span title="Average resolution time. Percentage = avg / 240hr SLA" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card" style="border-top-color:${parseFloat(m.slaPct)>=90?'#4ade80':'#ff5252'}"><div class="value" style="color:${parseFloat(m.slaPct)>=90?'#4ade80':'#ff5252'}">${m.slaPct}%</div><div class="label">SLA Compliance (≤240 hrs) <span title="${m.slaCompliant} of ${m.res+m.closed} resolved within 240 hrs" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card"><div class="value">${m.autosim.toLocaleString()} (${(m.autosim/m.T*100).toFixed(1)}%)</div><div class="label">${ic('bolt',14)} AutoSIM Resolved <span title="Tickets auto-resolved by AutoSIM" style="cursor:help;opacity:.7">&#9432;</span></div></div>
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Repeat Incident Data</h3>
  ${(()=>{
    const totalHI=m.hiCases.length;
    const pet=m.hiAnimal.length, nonPet=m.hiNonAnimal.length;
    const petPct=totalHI?(pet/totalHI*100):0, nonPetPct=totalHI?(nonPet/totalHI*100):0;
    const diff=(petPct-nonPetPct); // how much pet incidents dominate/inflate the HI mix
    return `<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi-card accent"><div class="value">${totalHI.toLocaleString()}</div><div class="label">${ic('repeat',14)} Repeat Incidents (HI&gt;0) <span title="Tickets with Historical Incident / Cnt > 0" style="cursor:help;opacity:.7">&#9432;</span></div></div>
      <div class="kpi-card" style="border-top-color:#a78bfa"><div class="value" style="color:#a78bfa">${pet.toLocaleString()}</div><div class="label">${ic('paw',14)} HI involving pet incidents <span title="Repeat incidents whose root cause is an unsecured animal / pet" style="cursor:help;opacity:.7">&#9432;</span></div></div>
      <div class="kpi-card" style="border-top-color:#a78bfa"><div class="value" style="color:#a78bfa">${petPct.toFixed(1)}%</div><div class="label">${ic('paw',14)} % of HI involving pet incidents</div></div>
      <div class="kpi-card"><div class="value">${nonPet.toLocaleString()}</div><div class="label">${ic('repeat',14)} HI involving non-pet incidents</div></div>
      <div class="kpi-card"><div class="value">${nonPetPct.toFixed(1)}%</div><div class="label">${ic('repeat',14)} % of HI involving non-pet incidents</div></div>
      <div class="kpi-card ${diff>=0?'warning':'success'}"><div class="value">${diff>=0?'+':''}${diff.toFixed(1)}%</div><div class="label">${ic('bar-chart',14)} Pet vs non-pet gap in HI <span title="Percentage-point difference: how much pet incidents inflate the repeat-incident (HI>0) count over non-pet ones" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    </div>`;
  })()}

  <div class="section"><h2>Ticket Age Classification</h2><div class="sec-body">
    <p class="meta-info">Click any color segment to view tickets. Download individual segments as CSV.</p>
    <div class="kpi-grid">
      <div class="kpi-card age-tile" style="border-top-color:#4ade80;cursor:pointer" onclick="showColorPopup('green',M.colorTickets.green)"><div class="value" style="color:#4ade80">${ct.green.length}</div><div class="age-name">${ic('check-circle',14)} GREEN</div><div class="age-range">(0-4 days)</div></div>
      <div class="kpi-card age-tile" style="border-top-color:#fbbf24;cursor:pointer" onclick="showColorPopup('yellow',M.colorTickets.yellow)"><div class="value" style="color:#fbbf24">${ct.yellow.length}</div><div class="age-name">${ic('clock',14)} YELLOW</div><div class="age-range">(4-7 days)</div></div>
      <div class="kpi-card age-tile" style="border-top-color:#ff5252;cursor:pointer" onclick="showColorPopup('red',M.colorTickets.red)"><div class="value" style="color:#ff5252">${ct.red.length}</div><div class="age-name">${ic('alert',14)} RED</div><div class="age-range">(7-10 days)</div></div>
      <div class="kpi-card age-tile${blackBlink?' blink-alert':''}" style="border-top-color:#888;cursor:pointer" onclick="showColorPopup('black',M.colorTickets.black)"><div class="value" style="color:#888">${ct.black.length}</div><div class="age-name">${ic('flame',14)} BLACK</div><div class="age-range">(&gt;10 days)</div></div>
      <div class="kpi-card age-tile${purpleBlink?' blink-alert':''}" style="border-top-color:#a78bfa;cursor:pointer" onclick="showColorPopup('purple',M.colorTickets.purple)"><div class="value" style="color:#a78bfa">${ct.purple.length}</div><div class="age-name">${ic('reopen',14)} PURPLE${purpleBlink?' <span title="A purple ticket is assigned outside the allowed reviewers" style="color:#ff5252">⚠</span>':''}</div><div class="age-range">(Reopened)</div></div>
    </div></div></div>

  <div class="section"><h2>Queue Status</h2><div class="sec-body">
    <div class="handoff-grid">
      <div class="handoff-box"><h3>Ticket Count by Status</h3><ul>
        <li><span>Assigned</span><span class="val">${m.asgn}</span></li>
        <li><span>Work In Progress</span><span class="val">${m.wip}</span></li>
        <li><span>Researching</span><span class="val">${m.researching}</span></li>
        <li><span>Pending</span><span class="val">${m.pend}</span></li>
        <li><span>Resolved</span><span class="val">${m.res}</span></li>
        <li><span>Closed</span><span class="val">${m.closed}</span></li>
      </ul></div>
      <div class="handoff-box"><h3>Status Distribution (%)</h3><ul>
        <li><span>Assigned</span><span class="val">${(m.asgn/m.T*100).toFixed(1)}%</span></li>
        <li><span>Work In Progress</span><span class="val">${(m.wip/m.T*100).toFixed(1)}%</span></li>
        <li><span>Researching</span><span class="val">${(m.researching/m.T*100).toFixed(1)}%</span></li>
        <li><span>Pending</span><span class="val">${(m.pend/m.T*100).toFixed(1)}%</span></li>
        <li><span>Resolved</span><span class="val">${(m.res/m.T*100).toFixed(1)}%</span></li>
        <li><span>Closed</span><span class="val">${(m.closed/m.T*100).toFixed(1)}%</span></li>
      </ul></div>
    </div></div></div>

  <div class="section"><h2>Daily Tickets (Last 7 Days)</h2><div class="sec-body">
    <div class="pair-grid">
      <div class="chart-box"><h3>Daily Tickets Created (Last 7 Days)</h3><div class="chart-wrap"><canvas id="c2a"></canvas></div></div>
      <div class="chart-box"><h3>Daily Tickets Resolved (Last 7 Days)</h3><div class="chart-wrap"><canvas id="c2b"></canvas></div></div>
    </div>
  </div></div>
  <div class="section"><h2>Weekly Volume</h2><div class="sec-body">
    <div class="pair-grid">
      <div class="chart-box"><h3>Weekly Volume: Created</h3><div class="chart-wrap"><canvas id="c4a"></canvas></div></div>
      <div class="chart-box"><h3>Weekly Volume: Resolved</h3><div class="chart-wrap"><canvas id="c4b"></canvas></div></div>
    </div>
  </div></div>
  ${(m.slaByWeek&&m.slaByWeek.length)?`<div class="section"><h2>SLA Compliance per Week (&le;240 hrs)</h2><div class="sec-body">
    <p class="meta-info" style="margin:0 0 16px">Percentage of each week's resolved tickets that met the 240-hour (10-day) SLA, for ${LIVE_QUARTER?LIVE_QUARTER.label:'this quarter'}. Weeks are bucketed by resolved date and drawn as each week passes.</p>
    <div class="chart-box"><div class="chart-wrap tall"><canvas id="cSlaWave"></canvas></div></div>
  </div></div>`:''}
  <div class="section"><h2>Incident Types</h2><div class="sec-body"><p class="meta-info">Click any incident type to view agent breakdown</p>
    <div style="overflow-x:auto"><table style="width:100%;table-layout:fixed"><thead><tr><th style="text-align:center;width:10%">#</th><th style="width:50%">Incident Type</th><th style="text-align:center;width:20%">Count</th><th style="text-align:center;width:20%">% of Total</th></tr></thead><tbody>
    ${m.iL.map((type,i)=>{const count=m.iD[i];const pct=(count/m.T*100).toFixed(1);return`<tr style="cursor:pointer" onclick="showIncidentPopup('${type.replace(/'/g,"\\'")}')"><td style="color:#ff9900;font-weight:700;text-align:center">${i+1}</td><td style="word-break:break-word"><strong>${type}</strong></td><td style="text-align:center">${count}</td><td style="text-align:center">${pct}%</td></tr>`;}).join('')}
    </tbody></table></div></div></div>
  ${m.hiCases.length>0?(()=>{
    const totalHI=m.hiCases.length;
    const petCount=m.hiCases.filter(h=>h.isAnimal).length;
    const nonPetCount=totalHI-petCount;
    const petPct=(petCount/totalHI*100).toFixed(1);
    const nonPetPct=(nonPetCount/totalHI*100).toFixed(1);
    // Build a root-cause breakdown table for a subset of hiCases.
    const subTable=(cases,accent)=>{
      if(!cases.length)return '<p class="meta-info" style="margin:6px 0 0">None.</p>';
      const byRC={};cases.forEach(h=>{const rc=(h.rootCause||'Unknown').replace(/^\s*-\s*/,'').trim();byRC[rc]=(byRC[rc]||0)+1;});
      const sorted=Object.entries(byRC).sort((a,b)=>b[1]-a[1]);const mx=sorted[0][1];
      return `<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Root Cause</th><th>Count</th><th>% of Total HI</th><th>Volume</th></tr></thead><tbody>`
        +sorted.map(([rc,count],i)=>`<tr style="cursor:pointer" onclick="showHIPopup('${rc.replace(/'/g,"\\'")}')"><td style="color:${accent};font-weight:700">${i+1}</td><td><strong>${rc}</strong></td><td>${count}</td><td>${(count/totalHI*100).toFixed(1)}%</td><td><div style="display:flex;align-items:center"><div style="height:8px;border-radius:4px;background:${accent};width:${(count/mx*100).toFixed(0)}%;min-width:4px"></div></div></td></tr>`).join('')
        +`</tbody></table></div>`;
    };
    return `<div class="section"><h2>Historical Incidents (Cnt &gt; 0)</h2><div class="sec-body">
    <div style="background:#000;border:1px solid var(--bd);border-radius:10px;padding:16px 18px;margin-bottom:18px">
      <p style="color:#d5dbdb;font-size:.9em;line-height:1.6;margin-bottom:12px">Of <strong style="color:#ff9900">${totalHI}</strong> repeat incidents (HI&gt;0), <strong style="color:#a78bfa">${petPct}%</strong> are driven by <strong>pet/animal incidents</strong>. Pet incidents are the primary reason the HI&gt;0 count is elevated — handling them accounts for the majority of repeat cases.</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
        <div style="background:#0a0a0a;border:1px solid rgba(167,139,250,.35);border-radius:8px;padding:12px 14px"><div style="font-size:1.6em;font-weight:700;color:#a78bfa">${petCount} <span style="font-size:.55em;color:#879596">(${petPct}%)</span></div><div style="color:#879596;font-size:.82em;margin-top:2px">HI due to pet / animal incidents</div></div>
        <div style="background:#0a0a0a;border:1px solid rgba(255,153,0,.3);border-radius:8px;padding:12px 14px"><div style="font-size:1.6em;font-weight:700;color:#ff9900">${nonPetCount} <span style="font-size:.55em;color:#879596">(${nonPetPct}%)</span></div><div style="color:#879596;font-size:.82em;margin-top:2px">HI NOT related to pet incidents</div></div>
      </div>
    </div>
    <h3 style="color:#a78bfa;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">🐾 Involving pet / animal incidents — ${petCount} (${petPct}% of all HI)</h3>
    ${subTable(m.hiCases.filter(h=>h.isAnimal),'#a78bfa')}
    <h3 style="color:#ff9900;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin:22px 0 8px">Non-pet incidents — ${nonPetCount} (${nonPetPct}% of all HI)</h3>
    ${subTable(m.hiCases.filter(h=>!h.isAnimal),'#ff9900')}
    <p class="meta-info" style="margin-top:12px">Click any root cause to view the agent breakdown.</p>
    </div></div>`;
  })():''}</div>`;
  attachNewFileHandler();
  refreshHelpAlertCount();
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('c2a',{type:'bar',data:{labels:m.dL,datasets:[{label:'Created',data:m.dC,backgroundColor:'rgba(255,153,0,.8)',borderColor:'#ff9900',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  makeChart('c2b',{type:'bar',data:{labels:m.dL,datasets:[{label:'Resolved',data:m.dD,backgroundColor:'rgba(74,222,128,.8)',borderColor:'#4ade80',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  makeChart('c4a',{type:'bar',data:{labels:m.wL,datasets:[{label:'Created',data:m.wD,backgroundColor:'rgba(255,153,0,.8)',borderColor:'#ff9900',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  makeChart('c4b',{type:'bar',data:{labels:m.wL,datasets:[{label:'Resolved',data:m.wDR,backgroundColor:'rgba(74,222,128,.8)',borderColor:'#4ade80',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  // SLA compliance per week — wave (filled, smooth) area chart. Weeks up to "now" are drawn; future weeks stay null.
  if(m.slaByWeek&&m.slaByWeek.length){
    const slaQ=LIVE_QUARTER?LIVE_QUARTER.label:'this quarter';
    makeChart('cSlaWave',{type:'line',data:{labels:m.slaByWeek.map(w=>w.week),datasets:[{label:'SLA % (≤240h)',data:m.slaByWeek.map(w=>w.pct),borderColor:'#4ade80',backgroundColor:(ctx)=>{const c=ctx.chart.ctx;const g=c.createLinearGradient(0,0,0,340);g.addColorStop(0,'rgba(74,222,128,.35)');g.addColorStop(1,'rgba(74,222,128,.02)');return g;},fill:true,tension:.45,pointRadius:3,pointBackgroundColor:'#4ade80',spanGaps:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>'Week '+items[0].label,label:(c)=>{const w=m.slaByWeek[c.dataIndex];return (c.raw==null?'No resolutions yet':c.raw+'% within SLA')+(w&&w.resolved?(' ('+w.within+'/'+w.resolved+')'):'');}}}},scales:{y:{beginAtZero:true,max:100,title:{display:true,text:'SLA % (≤240 hrs)',color:'#d5dbdb',font:{size:12}},ticks:{callback:v=>v+'%'}},x:{ticks:{font:{size:10}},title:{display:true,text:'Week ('+slaQ+')',color:'#d5dbdb',font:{size:12}}}}}});
  }
}

// ============================================================================
// CHUNKED DASHBOARD (lazy per-card loading + version-first caching)
// The summary KPIs load + cache on entry; each chart/table card is COLLAPSED by
// default and fetches its own /api/dash/<chunk> slice only when first expanded,
// caching it against the live version (busts automatically on a new upload).
// Other views (groups / previous-week / shift-report) + ticket popups still use
// the full tickets array (M) — loaded on demand, see ensureFullData().
// ============================================================================
const DASH_LOADED = {};   // chunk key -> true once fetched this page-load
let DASH_VERSION = undefined; // A.liveVersion() for this page-load (fetched once)
// Per-colour open-ticket arrays from /api/dash/age-detail (for the color popups + drill-down + CSV),
// so the chunked dashboard doesn't need the full ~8k-ticket dataset just to power those popups.
let DASH_COLOR_TICKETS = null;
// The tickets for a colour: prefer the full dataset (M) when it's loaded (other views), else the
// chunked age-detail payload.
function colorTicketsFor(color){
  if(typeof M!=='undefined' && M && M.colorTickets && M.colorTickets[color]) return M.colorTickets[color];
  return (DASH_COLOR_TICKETS && DASH_COLOR_TICKETS[color]) || [];
}

async function dashVersion(){
  if(DASH_VERSION!==undefined)return DASH_VERSION;
  try{ DASH_VERSION = (window.PHDAuth&&window.PHDAuth.liveVersion)?await window.PHDAuth.liveVersion():null; }
  catch(e){ DASH_VERSION=null; }
  return DASH_VERSION;
}

// The Incident Types display grouping is published separately (its own version, NOT tied to the
// quarter's publishedAt). Fold that version into the incidents chunk's client cache key so publishing
// a new grouping busts the browser cache and the relabeled list shows on next load — for everyone.
let INC_GROUPS_VER=undefined;
async function incidentGroupsVersion(){
  if(INC_GROUPS_VER!==undefined)return INC_GROUPS_VER;
  try{ const r=await window.PHDAuth.api('GET','/api/incident-groups'); INC_GROUPS_VER=(r&&r.ok&&r.data&&r.data.version)||0; }
  catch(e){ INC_GROUPS_VER=0; }
  return INC_GROUPS_VER;
}
// Cache key for the incidents chunk, versioned by the grouping version so a publish invalidates it.
async function incidentsCacheKey(){ return 'dash-incidents-v2-g'+(await incidentGroupsVersion()); }

// Fetch one dashboard chunk with version-first SWR caching. onData(data) renders it.
async function loadDashChunk(chunk, onData, opts){
  opts=opts||{};
  const A=window.PHDAuth;
  // Scope resolution (per-section): an explicit opts.scope wins; otherwise fall back to the section
  // scope for this chunk. Non-live scopes (Overall / Q2) append ?q= and bypass the version cache.
  const CHUNK_SECTION={ summary:'avg', incidents:'incidents', hi:'hi', weekly:'weekly' };
  let scopeVal=opts.scope;
  if(scopeVal==null){ const sec=CHUNK_SECTION[chunk]; scopeVal=sec?DASH_SECTION_SCOPE[sec]:'live'; }
  const scopeQ=scopeToParam(scopeVal);
  const url='/api/dash/'+chunk+scopeQ;
  const nonLiveScope=!!scopeQ;
  // Time-sensitive chunks (age-detail) must NOT be version-cached — a cached copy would show
  // stale colours. Fetch fresh every time (payload is small). Non-live scopes also bypass the cache.
  if(opts.noCache||nonLiveScope){
    const r=await A.api('GET',url);
    if(r&&r.ok){ try{ onData(r.data); }catch(e){} return {painted:true,ok:true,fromCache:false,data:r.data}; }
    return {painted:false,ok:false,status:r?r.status:0};
  }
  const version=await dashVersion();
  return A.swrLoad({
    // Bump the cache key when a chunk's response SHAPE changes (not just its data), so stale-shaped
    // entries cached under the old key are ignored even when the dataset version is unchanged.
    key:(opts.cacheKey||('dash-'+chunk)),
    version:version,
    fetch:()=>A.api('GET',url),
    onData:(data)=>{ try{ onData(data); }catch(e){} },
    // Only the summary shows the shared banner; card expands are silent to avoid banner spam.
    refreshMsg:opts.silent?undefined:undefined,
    updatedMsg:opts.silent?undefined:undefined,
    upToDateMsg:opts.silent?undefined:undefined,
  });
}

// A collapsible card for the chunked dashboard. Collapsed by default; the body holds a
// spinner until its chunk loads on first expand. `chunk` is the /api/dash/<chunk> name.
function dashCard(chunk, iconName, title, bodyId, extra){
  const sp='<div style="display:flex;align-items:center;justify-content:center;min-height:140px"><div class="spinner"></div></div>';
  return '<div class="section collapsible collapsed" data-chunk="'+chunk+'">'+
    '<h2 onclick="toggleDashCard(this)">'+ic(iconName,16)+' '+title+'</h2>'+
    '<div class="sec-body">'+(extra||'')+'<div id="'+bodyId+'" class="dash-chunk-slot">'+sp+'</div></div>'+
  '</div>';
}
// A NON-collapsible dashboard section (always visible, no expand/collapse). Used for the Ticket
// Age Classification card, which loads eagerly on page load alongside the summary.
// bodyHtml: initial body content (defaults to a spinner). Pass a static skeleton to paint the
// full structure immediately, with only the data-driven bits waiting on the fetch.
function dashStaticCard(iconName, title, bodyId, bodyHtml, scopeSection){
  const sp='<div style="display:flex;align-items:center;justify-content:center;min-height:140px"><div class="spinner"></div></div>';
  // When scopeSection is given, the header shows a right-aligned Q3(Live)|Q2|Overall selector.
  const sel=scopeSection?sectionScopeSelector(scopeSection):'';
  return '<div class="section">'+
    '<div class="sec-head"><h2>'+ic(iconName,16)+' '+title+'</h2>'+sel+'</div>'+
    '<div id="'+bodyId+'" class="dash-chunk-slot">'+(bodyHtml||sp)+'</div>'+
  '</div>';
}

// Expand/collapse a chunked card. On FIRST expand, fetch + render that card's chunk.
function toggleDashCard(h2){
  const sec=h2.closest('.section');if(!sec)return;
  const nowCollapsed=sec.classList.toggle('collapsed');
  if(nowCollapsed)return; // collapsing -> nothing to load
  const chunk=sec.getAttribute('data-chunk');
  if(chunk && !DASH_LOADED[chunk]){
    DASH_LOADED[chunk]=true;
    renderDashChunkInto(chunk);
  } else {
    // Already loaded -> resize charts AFTER the ~300ms expand animation finishes.
    setTimeout(()=>{try{charts.forEach(c=>{if(sec.contains(c.canvas))c.resize();});}catch(e){}},340);
  }
}
window.toggleDashCard=toggleDashCard;

// Fetch a chunk and render it into its card body.
function renderDashChunkInto(chunk){
  const renderers={
    age:renderAgeChunk, queue:renderQueueChunk, daily7:renderDaily7Chunk,
    weekly:renderWeeklyChunk, 'sla-weekly':renderSlaWeeklyChunk,
    incidents:renderIncidentsChunk, hi:renderHiChunk,
  };
  const fn=renderers[chunk]; if(!fn)return;
  const source=chunk;
  // Bump the client cache key when a chunk's response SHAPE changed, so stale-shaped cached entries
  // (from before the change) are ignored even though the dataset version is unchanged.
  const CHUNK_CACHE_KEY={ incidents:'dash-incidents-v2' };
  const opts={silent:true}; if(CHUNK_CACHE_KEY[source]) opts.cacheKey=CHUNK_CACHE_KEY[source];
  loadDashChunk(source,fn,opts).catch(()=>{
    // On failure, show a small retry message so the card isn't a stuck spinner.
    const slot=document.querySelector('.section[data-chunk="'+chunk+'"] .dash-chunk-slot');
    if(slot)slot.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load this section. <a href="#" onclick="retryDashChunk(\''+chunk+'\');return false;" style="color:#ff9900">Retry</a></p>';
  });
}
function retryDashChunk(chunk){ DASH_LOADED[chunk]=true; renderDashChunkInto(chunk); }
window.retryDashChunk=retryDashChunk;

// The 5 age tiles are 100% static (colour, name, range, icon) EXCEPT the count — so the whole
// structure is hardcoded and painted immediately; only the number waits on the DB.
const AGE_TILES=[
  {cls:'green', color:'#4ade80', icon:'check-circle', name:'GREEN',  range:'(0-4 days)'},
  {cls:'yellow',color:'#fbbf24', icon:'clock',        name:'YELLOW', range:'(4-7 days)'},
  {cls:'red',   color:'#ff5252', icon:'alert',        name:'RED',    range:'(7-10 days)'},
  {cls:'black', color:'#888',    icon:'flame',        name:'BLACK',  range:'(&gt;10 days)'},
  {cls:'purple',color:'#a78bfa', icon:'reopen',       name:'PURPLE', range:'(Reopened)'},
];
// Static skeleton for the Ticket Age Classification card: intro + all 5 tiles with a spinner in
// the count slot. No data needed — rendered eagerly. renderAgeChunk() later fills the counts.
// Row order for the age table (per request): PURPLE, BLACK, RED, YELLOW, GREEN.
const AGE_ROW_ORDER=['purple','black','red','yellow','green'];
// A ticket is "priority" when its Labels contain "Station Request" OR "Address Exclusion"
// (case-insensitive; also catches "Pending Address Exclusion"). Mirrors server hasPriorityLabel().
function hasPriorityLabel(labels){
  const s=String(labels||'').toLowerCase();
  return s.indexOf('station request')>=0 || s.indexOf('address exclusion')>=0;
}
// Roster split for the priority-column profile icon color (lowercase usernames).
const PRIO_ICON_YELLOW=new Set(['dbiswamb','tanviroo','urmahala','shaavhad','chousoud','obalasut']);
const PRIO_ICON_BLUE=new Set(['harisss','flofalgu','arunkzn','nobregak','mellanej','punithsd','mbozied']);
// Icon color for an agent: yellow / blue by roster, gray if unlisted or unassigned.
function prioIconColor(agent){
  const a=String(agent||'').trim().toLowerCase();
  if(PRIO_ICON_YELLOW.has(a))return '#fbbf24';
  if(PRIO_ICON_BLUE.has(a))return '#44b9d6';
  return '#8b98a5';
}
// Build the priority-cell contents: one profile icon per agent holding priority tickets in this
// color, colored by roster, followed by that agent's count. Sorted highest-count first.
function prioAgentIconsHtml(list){
  const by={};
  list.forEach(function(r){
    if(!hasPriorityLabel(r.Labels))return;
    const a=(r.AssigneeIdentity||'').trim()||'Unassigned';
    by[a]=(by[a]||0)+1;
  });
  return idListHtml(by);
}
// Build a login-ID chip list: 2 chips per row × 2 rows (max 4 shown), then "+N" on the right.
// No avatars — just the login id + its count.
function idListHtml(by){
  const esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
  const agents=Object.keys(by).sort(function(x,y){ return by[y]-by[x] || x.localeCompare(y); });
  if(!agents.length)return '<div class="idlist"><span class="none">None</span></div>';
  const SHOW=4; // 2 rows of 2 chips
  const shown=agents.slice(0,SHOW), extra=agents.length-shown.length;
  const chips=shown.map(function(a){ return idChipHtml(a,by[a],esc); }).join('');
  const more=extra>0?('<span class="more">+'+extra+'</span>'):'';
  return '<div class="idlist"><div class="idchips idchips-2">'+chips+'</div>'+more+'</div>';
}
// One login-ID chip: login id + count badge (no avatar). Roster color tints the id text.
function idChipHtml(agent,count,esc){
  esc=esc||function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
  const col=prioIconColor(agent);
  // The LM-CAP identity ID (and any blank/unassigned value) shows as "Unassigned" here.
  const label=(agent==='Unassigned'||!agent||(typeof isLMCAP==='function'&&isLMCAP(agent)))?'Unassigned':agent;
  return '<span class="idchip idchip-noava" title="'+esc(label)+' \u2014 '+count+' ticket'+(count===1?'':'s')+'">'+
    '<b style="color:'+col+'">'+esc(label)+'</b><span class="ct">'+count+'</span></span>';
}
// Back-compat alias (some callers may reference the old name).
function prioAgentChipHtml(agent,count,esc){ return idChipHtml(agent,count,esc); }
// A ticket is "No EMT" when its Title OR Labels contain one of these whole-word phrases
// (case-insensitive): "No EMT" (separator between No & EMT optional: space(s)/hyphen/underscore/none),
// "Without EMT", or "EMT not required". Bare "EMT" alone does NOT count, and matches must be whole
// words (so "Casino EMT" / "Reno-EMTech" are not matched).
const NO_EMT_RE=/\bno[\s_-]*emt\b|\bwithout\s+emt\b|\bemt\s+not\s+required\b/i;
function hasNoEmt(title,labels){
  return NO_EMT_RE.test(String(title||'')+' '+String(labels||''));
}
// Build the No-EMT cell contents: one profile icon per agent holding No-EMT tickets in this color,
// colored by the same roster as the priority column, followed by that agent's count. Highest first.
function noEmtAgentIconsHtml(list){
  const by={};
  list.forEach(function(r){
    if(!hasNoEmt(r.Title,r.Labels))return;
    const a=(r.AssigneeIdentity||'').trim()||'Unassigned';
    by[a]=(by[a]||0)+1;
  });
  return idListHtml(by);
}
function ageTileByCls(cls){ return AGE_TILES.find(function(t){return t.cls===cls;})||{}; }
function ageCardSkeletonHtml(){
  // Band name shown without the surrounding parens for the sub-label.
  const rng=function(t){ return String(t.range||'').replace(/^\(|\)$/g,''); };
  const rows=AGE_ROW_ORDER.map(function(cls){
    const t=ageTileByCls(cls);
    return '<div id="ageRow-'+cls+'" class="age '+cls+'" onclick="showColorPopup(\''+cls+'\')" title="View '+t.name+' tickets">'+
      '<div class="band"><span class="dot"></span><span class="lbl"><b>'+t.name+'</b><span>'+rng(t)+'</span></span></div>'+
      '<div class="agents-count" id="ageAgents-'+cls+'"><span class="num-spinner"></span></div>'+
      '<div class="tik" id="ageCount-'+cls+'"><span class="num-spinner"></span></div>'+
      '<div id="agePrio-'+cls+'" title="Open tickets with a Station Request / Address Exclusion label"><span class="num-spinner"></span></div>'+
      '<div id="ageNoEmt-'+cls+'" title="Open tickets whose Title or Labels mention No EMT / No-EMT"><span class="num-spinner"></span></div>'+
    '</div>';
  }).join('');
  const srIcon='<svg class="hi" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.7-6-10a6 6 0 0 1 12 0c0 4.3-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>';
  const emtIcon='<svg class="hi" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ff6b6b" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>';
  return '<p class="meta-info">Open tickets classified by age. Click any row to see which agents hold them.</p>'+
    '<div class="age-grid">'+
      '<div class="agehead">'+
        '<span>AGE RANGE</span>'+
        '<span>AGENTS COUNT</span>'+
        '<span>TICKETS COUNT</span>'+
        '<span>'+srIcon+'TICKETS WITH STATION REQUESTS</span>'+
        '<span>'+emtIcon+'TICKETS WITH NO EMT</span>'+
      '</div>'+
      '<div class="agerows">'+rows+'</div>'+
    '</div>';
}

// ---- Per-card renderers (fill the card body from the chunk payload) ----
// Fills ONLY the dynamic bits of the (already-painted) age card: the counts, click handlers, and
// blink state. The tiles/labels/ranges/colours were rendered statically by ageCardSkeletonHtml().
function renderAgeChunk(d){
  const slot=document.getElementById('dashAgeBody');if(!slot)return;
  // If the static skeleton isn't there yet (edge case), paint it first.
  if(!document.getElementById('ageCount-green')) slot.innerHTML=ageCardSkeletonHtml();
  // d is the /api/dash/age-detail payload: per-colour arrays of slim tickets. Cache them so the
  // color popups + agent drill-down + CSV work without loading the full dataset.
  DASH_COLOR_TICKETS={
    green:d.green||[], yellow:d.yellow||[], red:d.red||[], black:d.black||[], purple:d.purple||[],
  };
  const ct=DASH_COLOR_TICKETS;
  // BLACK blinks whenever there are any (>240h) tickets.
  const blackBlink=ct.black.length>0;
  // PURPLE blinks if any reopened ticket is Unassigned OR assigned to someone NOT owner/manager/admin.
  const allowed=window.PURPLE_ALLOWED_SET; // Set of lowercase usernames, or null if roster unknown
  const purpleBlink=ct.purple.length>0 && ct.purple.some(function(r){
    const a=(r.AssigneeIdentity||'').trim().toLowerCase();
    if(!a)return true;            // Unassigned -> not allowed -> blink
    if(!allowed)return false;     // roster not loaded yet -> don't false-blink
    return !allowed.has(a);       // assigned outside owner/manager/admin -> blink
  });
  AGE_TILES.forEach(function(t){
    const list=ct[t.cls]||[];
    // Distinct agents holding tickets of this color (AssigneeIdentity; blank -> "Unassigned").
    const agentSet={}; list.forEach(function(r){ const a=(r.AssigneeIdentity||'Unassigned'); agentSet[a]=1; });
    const agentCount=Object.keys(agentSet).length;
    const row=document.getElementById('ageRow-'+t.cls);
    if(row){
      const blink=(t.cls==='black')?blackBlink:(t.cls==='purple')?purpleBlink:false;
      row.classList.toggle('blink-alert',!!blink);
    }
    const ael=document.getElementById('ageAgents-'+t.cls);
    if(ael){ ael.classList.add('kpi-anim'); countUpKpi(ael, String(agentCount)); }
    const cel=document.getElementById('ageCount-'+t.cls);
    if(cel){ cel.classList.add('kpi-anim'); countUpKpi(cel, String(list.length)); }
    // Priority column: one profile icon per agent holding this color's priority tickets
    // (Station Request / Address Exclusion), colored by roster, with each agent's count.
    const prioCount=list.reduce(function(n,r){ return n+(hasPriorityLabel(r.Labels)?1:0); },0);
    const pel=document.getElementById('agePrio-'+t.cls);
    if(pel){ pel.classList.toggle('has-prio',prioCount>0); pel.innerHTML=prioAgentIconsHtml(list); }
    // No-EMT column: one profile icon per agent holding this color's tickets whose Title or Labels
    // mention "No EMT" / "No-EMT", colored by the same roster, with each agent's count.
    const noEmtCount=list.reduce(function(n,r){ return n+(hasNoEmt(r.Title,r.Labels)?1:0); },0);
    const nel=document.getElementById('ageNoEmt-'+t.cls);
    if(nel){ nel.classList.toggle('has-prio',noEmtCount>0); nel.innerHTML=noEmtAgentIconsHtml(list); }
  });
  // The chips show agent avatars; if avatars aren't loaded yet, warm them and repaint the two
  // columns once they arrive (the first paint falls back to initials/icon meanwhile).
  if(!_avatarsLoaded && window.loadUserAvatars){ try{ loadUserAvatars().then(repaintAgePrioCells); }catch(e){} }
}
// Re-fill ONLY the SR/Addr-Excl + No-EMT cells from the cached age-detail tickets. Used after the
// user avatars finish loading so the chips upgrade from initials to real photos without a full re-render.
function repaintAgePrioCells(){
  const ct=DASH_COLOR_TICKETS; if(!ct)return;
  AGE_TILES.forEach(function(t){
    const list=ct[t.cls]||[];
    const pel=document.getElementById('agePrio-'+t.cls);
    if(pel) pel.innerHTML=prioAgentIconsHtml(list);
    const nel=document.getElementById('ageNoEmt-'+t.cls);
    if(nel) nel.innerHTML=noEmtAgentIconsHtml(list);
  });
}
// Fill the "Queue Status Data" KPI cards (top of the dashboard) from the queue chunk
// ({counts,pct}). One card per status + a Total, animated with the same count-up as the summary.
// Build a KPI section as a table. rows = [{metric, value, valColor, desc}]. `withDesc` adds a
// Definition column (used by Average / Repeat Incident sections). When withDesc is true the Value
// column is centered; otherwise it's right-aligned.
function kpiTableHtml(rows, withDesc){
  // withDesc (Average / Repeat Incident sections) -> combined "metric" cards: name + definition
  // stacked on the left, the animated value on the right, a colored accent spine per row.
  if(withDesc){
    // 2 metric tiles per row (2×N grid). Each tile: name + definition on the left, value on the right.
    const spineCycle=['s-cy','s-gr','s-am','s-pu'];
    const cards=rows.map(function(r,i){
      const raw=(r.value==null?'\u2014':String(r.value));
      const cell='<span class="kpi-anim" data-kpi-val="'+raw.replace(/"/g,'&quot;')+'"></span>';
      const vStyle=r.valColor?(' style="color:'+r.valColor+'"'):'';
      const vCls='mval'+(r.blink?' blink':'');
      return '<div class="metric '+spineCycle[i%spineCycle.length]+'">'+
        '<div class="mbody"><div class="mname">'+(r.metric||'')+'</div>'+
          (r.desc?('<div class="mdef">'+r.desc+'</div>'):'')+'</div>'+
        '<div class="'+vCls+'"'+vStyle+'>'+cell+'</div>'+
      '</div>';
    }).join('');
    return '<div class="metrics metrics-2col">'+cards+'</div>';
  }
  const valAlign='right';
  const head='<tr><th>Metric</th><th style="text-align:'+valAlign+'">Value</th></tr>';
  const body=rows.map(function(r){
    const raw=(r.value==null?'\u2014':String(r.value));
    const cell='<span class="kpi-anim" data-kpi-val="'+raw.replace(/"/g,'&quot;')+'"></span>';
    const vStyle=' style="text-align:'+valAlign+(r.valColor?(';color:'+r.valColor):'')+'"';
    return '<tr><td class="kt-metric">'+(r.metric||'')+'</td>'+
      '<td class="kt-value"'+vStyle+'>'+cell+'</td></tr>';
  }).join('');
  return '<div style="overflow-x:auto;grid-column:1/-1"><table class="kpi-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}
function renderQueueKpis(d){
  const grid=document.getElementById('dashQueueKpis'); if(!grid||!d||!d.counts)return;
  const c=d.counts, p=d.pct||{};
  const total=(d.total!=null)?d.total:['Assigned','Work In Progress','Researching','Pending','Resolved','Closed'].reduce(function(s,k){return s+(c[k]||0);},0);
  const inQueue=['Assigned','Work In Progress','Researching','Pending'].reduce(function(s,k){return s+(c[k]||0);},0);
  const inQueuePct=total?(Math.round(inQueue/total*1000)/10):0;
  // Demo stat tiles. The COUNT animates (countUpKpi); the % rides as a small suffix.
  // tone: cy/gr/am/gy/mut drives the value color.
  const tile=function(icon,label,count,pct,tone){
    const raw=String(count).replace(/"/g,'&quot;');
    const suffix=(pct!=null)?(' <small>'+pct+'%</small>'):'';
    return '<div class="q-tile'+(tone?(' '+tone):'')+'">'+
      '<div class="k">'+icon+' '+label+'</div>'+
      '<div class="v"><span class="kpi-anim" data-kpi-val="'+raw+'">'+'</span>'+suffix+'</div>'+
    '</div>';
  };
  grid.innerHTML='<div class="q-tiles">'+
    tile(ic('inbox',13),'In Queue', inQueue.toLocaleString(), inQueuePct, 'am')+
    tile(ic('grid',13),'Total Tickets', total.toLocaleString(), null, '')+
    tile(ic('check-circle',13),'Resolved', (c['Resolved']||0).toLocaleString(), p['Resolved'], 'gr')+
    tile(ic('check-circle',13),'Closed', (c['Closed']||0).toLocaleString(), p['Closed'], 'gy')+
    tile(ic('inbox',13),'Assigned', (c['Assigned']||0).toLocaleString(), p['Assigned'], '')+
    tile(ic('tool',13),'Work In Progress', (c['Work In Progress']||0).toLocaleString(), p['Work In Progress'], 'am')+
    tile(ic('eye',13),'Researching', (c['Researching']||0).toLocaleString(), p['Researching'], 'mut')+
    tile(ic('hourglass',13),'Pending', (c['Pending']||0).toLocaleString(), p['Pending'], '')+
  '</div>';
  grid.querySelectorAll('.kpi-anim[data-kpi-val]').forEach(function(el){ countUpKpi(el, el.getAttribute('data-kpi-val')); });
}
function renderQueueChunk(d){
  const slot=document.getElementById('dashQueueBody');if(!slot)return;
  const order=['Assigned','Work In Progress','Researching','Pending','Resolved','Closed'];
  const li=(k,v)=>'<li><span>'+k+'</span><span class="val">'+v+'</span></li>';
  slot.innerHTML='<div class="handoff-grid">'+
    '<div class="handoff-box"><h3>Ticket Count by Status</h3><ul>'+order.map(k=>li(k,d.counts[k])).join('')+'</ul></div>'+
    '<div class="handoff-box"><h3>Status Distribution (%)</h3><ul>'+order.map(k=>li(k,d.pct[k]+'%')).join('')+'</ul></div>'+
  '</div>';
}
function renderDaily7Chunk(d){
  const slot=document.getElementById('dashDaily7Body');if(!slot)return;
  slot.innerHTML='<div class="chart-box"><div class="chart-wrap tall"><canvas id="cDaily7Wave"></canvas></div></div>';
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('cDaily7Wave',{type:'line',data:{labels:d.labels,datasets:[
    _waveDataset('Created',d.created,'#ff9900','rgba(255,153,0,'),
    _waveDataset('Resolved',d.resolved,'#4ade80','rgba(74,222,128,')
  ]},options:_waveOpts('Tickets')});
}
function renderWeeklyChunk(d){
  const slot=document.getElementById('dashWeeklyBody');if(!slot)return;
  const slaQ=(typeof LIVE_QUARTER!=='undefined'&&LIVE_QUARTER)?LIVE_QUARTER.label:'this quarter';
  slot.innerHTML='<p class="meta-info" style="margin:0 0 16px">Weekly <b style="color:#ff9900">Created</b> vs <b style="color:#4ade80">Resolved</b> volume, overlaid with the <b style="color:#a78bfa">SLA compliance %</b> (\u2264240h) for each week of '+slaQ+'. SLA reads on the right axis.</p>'+
    '<div class="chart-box"><div class="chart-wrap tall"><canvas id="cWeeklyWave"></canvas></div></div>';
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  drawWeeklyCombined(d);
}
// Combined weekly chart: Created + Resolved (left axis, tickets, filled waves) + SLA % (right axis,
// solid straight purple line). All three come from ONE payload keyed by the same week buckets.
function drawWeeklyCombined(d){
  const wk=d.labels||[];
  const span=d.span||[];
  const fmtD=function(iso){ if(!iso)return null; var dt=new Date(iso); if(isNaN(dt))return null; return dt.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
  // X-axis shows ONLY the week code (e.g. "W26"); the date range is surfaced in the tooltip title.
  const labels=wk.slice();
  const spanText=wk.map(function(l,i){ var s=span[i]||{}; var a=fmtD(s.first), b=fmtD(s.last); return (a&&b)?(a+' \u2013 '+b):''; });
  const slaData=d.slaPct||[];
  const hasSla=slaData.some(function(v){ return v!=null; });
  // Created + Resolved as THICK LINES (left axis) instead of bars.
  const tline=function(label,data,color){ return {type:'line',label:label,data:data,yAxisID:'y',borderColor:color,backgroundColor:color,pointBackgroundColor:color,pointRadius:3,pointHoverRadius:5,borderWidth:4,tension:.35,fill:false,spanGaps:true,order:2}; };
  const datasets=[
    tline('Created',d.created,'#ff9900'),
    tline('Resolved',d.resolved,'#4ade80')
  ];
  if(hasSla){
    // SLA compliance: a clear STRAIGHT solid line drawn ON TOP of the bars, on the right axis.
    datasets.push({type:'line',label:'SLA % (\u2264240h)',data:slaData,yAxisID:'ySla',borderColor:'#a78bfa',
      pointBackgroundColor:'#a78bfa',pointBorderColor:'#fff',pointBorderWidth:1,pointRadius:4,pointHoverRadius:6,
      borderWidth:3,tension:0,fill:false,spanGaps:true,order:0});
  }
  // Right axis range: zoom to where the SLA values actually sit so weekly variation is visible
  // (like the reference chart's ~87–97% band) instead of being flattened against 0–100.
  var slaMin=100; slaData.forEach(function(v){ if(v!=null&&v<slaMin) slaMin=v; });
  var slaLo=hasSla?Math.max(0,Math.floor((slaMin-2))):0;
  // Inline plugin: print the SLA % just above each line point (no external dependency).
  var slaLabelPlugin={ id:'slaLabels', afterDatasetsDraw:function(chart){
    var ds=chart.data.datasets.findIndex(function(x){return x.yAxisID==='ySla';}); if(ds<0)return;
    var meta=chart.getDatasetMeta(ds); if(!meta||meta.hidden)return; var ctx=chart.ctx;
    ctx.save(); ctx.font='700 11px Inter, sans-serif'; ctx.fillStyle='#c9b6f5'; ctx.textAlign='center';
    meta.data.forEach(function(pt,i){ var v=chart.data.datasets[ds].data[i]; if(v==null||!pt)return; ctx.fillText(v+'%', pt.x, pt.y-9); });
    ctx.restore();
  }};
  const opts={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    layout:{padding:{top:24}},
    plugins:{legend:{display:true,position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:12}}},
      tooltip:{callbacks:{
        // Tooltip title = "W26  (Jun 23 – Jun 29)" using this week's observed date span.
        title:function(items){ var i=items[0]?items[0].dataIndex:0; var sp=spanText[i]; return labels[i]+(sp?('  ('+sp+')'):''); },
        label:function(c){
        if(c.dataset.yAxisID==='ySla'){ return 'SLA: '+(c.raw==null?'\u2014':(c.raw+'%'))+((d.slaResolved&&d.slaResolved[c.dataIndex])?(' ('+d.slaWithin[c.dataIndex]+'/'+d.slaResolved[c.dataIndex]+')'):''); }
        return c.dataset.label+': '+c.raw;
      }}}},
    scales:{
      y:{beginAtZero:true,position:'left',grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'Tickets',color:'#d5dbdb',font:{size:12}},ticks:{font:{size:12}}},
      // Give the SLA axis headroom above 100 so the "100%" point label isn't clipped at the top.
      ySla:{min:slaLo,max:108,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'SLA % (\u2264240 hrs)',color:'#a78bfa',font:{size:12}},ticks:{color:'#a78bfa',stepSize:10,callback:function(v){return v>100?'':(v+'%');}},display:hasSla},
      // Short "W#" labels: keep them horizontal; thin them out automatically when a scope has many weeks.
      x:{grid:{display:false},ticks:{font:{size:11},maxRotation:0,minRotation:0,autoSkip:true,autoSkipPadding:8}}}};
  makeChart('cWeeklyWave',{type:'line',data:{labels:labels,datasets:datasets},options:opts,plugins:[slaLabelPlugin]});
}
// Weekly Volume + Repeat Incidents (HI Cnt>0) created. Same Created/Resolved bars, plus a purple
// line = count of repeat-incident tickets CREATED each week. All on the left (tickets) axis.
function renderWeeklyHiChunk(d){
  const slot=document.getElementById('dashWeeklyHiBody');if(!slot)return;
  const slaQ=(typeof LIVE_QUARTER!=='undefined'&&LIVE_QUARTER)?LIVE_QUARTER.label:'this quarter';
  slot.innerHTML='<p class="meta-info" style="margin:0 0 16px">Weekly <b style="color:#ff9900">Created</b> vs <b style="color:#4ade80">Resolved</b> volume, overlaid with the number of <b style="color:#a78bfa">repeat incidents (HI Cnt&gt;0)</b> created each week of '+slaQ+'.</p>'+
    '<div class="chart-box"><div class="chart-wrap tall"><canvas id="cWeeklyHi"></canvas></div></div>';
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  drawWeeklyHi(d);
}
function drawWeeklyHi(d){
  const wk=d.labels||[];
  const span=d.span||[];
  const fmtD=function(iso){ if(!iso)return null; var dt=new Date(iso); if(isNaN(dt))return null; return dt.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
  // X-axis shows ONLY the week code (e.g. "W26"). The week's date range is surfaced in the tooltip title.
  const labels=wk.slice();
  const spanText=wk.map(function(l,i){ var s=span[i]||{}; var a=fmtD(s.first), b=fmtD(s.last); return (a&&b)?(a+' \u2013 '+b):''; });
  const hiData=d.hiCreated||[];              // total repeat incidents = pet + non-pet combined
  const hasHi=hiData.some(function(v){ return v!=null; });
  const bar=function(label,data,color){ return {type:'bar',label:label,data:data,yAxisID:'y',backgroundColor:color,borderColor:color,borderWidth:0,borderRadius:4,maxBarThickness:26,order:2}; };
  const datasets=[
    bar('Created',d.created,'rgba(255,153,0,.85)'),
    bar('Resolved',d.resolved,'rgba(74,222,128,.85)')
  ];
  if(hasHi){
    // Combined (pet + non-pet) repeat-incident count as a STRAIGHT line (tension:0), on its own
    // RIGHT axis so its scale is independent of the volume bars.
    datasets.push({type:'line',label:'Repeat Incidents (pet + non-pet combined)',data:hiData,yAxisID:'yHi',borderColor:'#a78bfa',
      pointBackgroundColor:'#a78bfa',pointBorderColor:'#fff',pointBorderWidth:1,pointRadius:4,pointHoverRadius:6,
      borderWidth:3,tension:0,fill:false,spanGaps:true,order:0});
  }
  // HI right-axis max: fixed 0–50, bumped to 0–100 if any week exceeds 50.
  var hiMax=50; hiData.forEach(function(v){ if(v!=null&&v>50) hiMax=100; });
  // Inline plugin: print the HI count just above each line point.
  var hiLabelPlugin={ id:'hiLabels', afterDatasetsDraw:function(chart){
    var ds=chart.data.datasets.findIndex(function(x){return x.type==='line';}); if(ds<0)return;
    var meta=chart.getDatasetMeta(ds); if(!meta||meta.hidden)return; var ctx=chart.ctx;
    ctx.save(); ctx.font='700 11px Inter, sans-serif'; ctx.fillStyle='#c9b6f5'; ctx.textAlign='center';
    meta.data.forEach(function(pt,i){ var v=chart.data.datasets[ds].data[i]; if(v==null||!pt)return; ctx.fillText(String(v), pt.x, pt.y-9); });
    ctx.restore();
  }};
  const opts={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    layout:{padding:{top:16}},
    plugins:{legend:{display:true,position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:12}}},
      tooltip:{callbacks:{
        // Tooltip title = "W26  (Jun 23 – Jun 29)" using this week's observed date span.
        title:function(items){ var i=items[0]?items[0].dataIndex:0; var sp=spanText[i]; return labels[i]+(sp?('  ('+sp+')'):''); },
        label:function(c){ return c.dataset.label+': '+c.raw; }}}},
    scales:{
      y:{beginAtZero:true,position:'left',grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'Tickets',color:'#d5dbdb',font:{size:12}},ticks:{font:{size:12}}},
      yHi:{beginAtZero:true,min:0,max:hiMax,position:'right',grid:{drawOnChartArea:false},title:{display:true,text:'Repeat Incidents (HI Cnt>0)',color:'#a78bfa',font:{size:12}},ticks:{color:'#a78bfa',stepSize:hiMax/5},display:hasHi},
      x:{grid:{display:false},ticks:{font:{size:11},maxRotation:0,minRotation:0,autoSkip:false}}}};
  makeChart('cWeeklyHi',{type:'bar',data:{labels:labels,datasets:datasets},options:opts,plugins:[hiLabelPlugin]});
}
// A smooth "wave" (filled area) line dataset. `rgbaPrefix` like 'rgba(255,153,0,' — fill fades out.
function _waveDataset(label,data,color,rgbaPrefix){
  return {label:label,data:data,borderColor:color,pointBackgroundColor:color,pointRadius:3,
    borderWidth:2,tension:.45,fill:true,spanGaps:true,
    backgroundColor:function(ctx){var c=ctx.chart.ctx;var g=c.createLinearGradient(0,0,0,340);
      g.addColorStop(0,rgbaPrefix+'.32)');g.addColorStop(1,rgbaPrefix+'.02)');return g;}};
}
function _waveOpts(yTitle){
  return {responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:true,position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:12}}}},
    scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:yTitle||'',color:'#d5dbdb',font:{size:12}},ticks:{font:{size:12}}},
      x:{grid:{display:false},ticks:{font:{size:11}}}}};
}
function renderSlaWeeklyChunk(d){
  const slot=document.getElementById('dashSlaBody');if(!slot)return;
  const weeks=d.weeks||[];
  const slaQ=(typeof LIVE_QUARTER!=='undefined'&&LIVE_QUARTER)?LIVE_QUARTER.label:'this quarter';
  slot.innerHTML='<p class="meta-info" style="margin:0 0 16px">Percentage of each week\'s resolved tickets that met the 240-hour (10-day) SLA. Weeks are bucketed by resolved date and drawn as each week passes.</p>'+
    '<div class="chart-box"><div class="chart-wrap tall"><canvas id="cSlaWave"></canvas></div></div>';
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('cSlaWave',{type:'line',data:{labels:weeks.map(w=>w.week),datasets:[{label:'SLA % (≤240h)',data:weeks.map(w=>w.pct),borderColor:'#4ade80',backgroundColor:(ctx)=>{const c=ctx.chart.ctx;const g=c.createLinearGradient(0,0,0,340);g.addColorStop(0,'rgba(74,222,128,.35)');g.addColorStop(1,'rgba(74,222,128,.02)');return g;},fill:true,tension:.45,pointRadius:3,pointBackgroundColor:'#4ade80',spanGaps:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>'Week '+items[0].label,label:(c)=>{const w=weeks[c.dataIndex];return (c.raw==null?'No resolutions yet':c.raw+'% within SLA')+(w&&w.resolved?(' ('+w.within+'/'+w.resolved+')'):'');}}}},scales:{y:{beginAtZero:true,max:100,title:{display:true,text:'SLA % (≤240 hrs)',color:'#d5dbdb',font:{size:12}},ticks:{callback:v=>v+'%'}},x:{ticks:{font:{size:10}},title:{display:true,text:'Week ('+slaQ+')',color:'#d5dbdb',font:{size:12}}}}}});
}
// Current scope of the Incident Types chunk (from d.quarter), so row-click popups query the same scope.
// Maps the chunk's quarter value to a ?q= param: live quarter => '' (omit); else '?q=<value>'.
let INCIDENTS_SCOPE_Q='';
function renderIncidentsChunk(d){
  const slot=document.getElementById('dashIncidentsBody');if(!slot)return;
  // Derive the scope param for drill-down popups. d.quarter is 'q2q3' | 'all' | '<YYYY-Qn>' | live qid.
  try{
    const liveQ=(typeof LIVE_QUARTER!=='undefined'&&LIVE_QUARTER)?LIVE_QUARTER.qid:null;
    INCIDENTS_SCOPE_Q=(d&&d.quarter&&d.quarter!==liveQ)?('&q='+encodeURIComponent(d.quarter)):'';
  }catch(e){ INCIDENTS_SCOPE_Q=''; }
  const autosim=d.autosimTypes||[], phd=d.phdTypes||[];
  const autosimT=(d.autosimTotal!=null)?d.autosimTotal:autosim.reduce((s,t)=>s+t.count,0);
  const phdT=(d.phdTotal!=null)?d.phdTotal:phd.reduce((s,t)=>s+t.count,0);
  slot.innerHTML=
    dashTcardHtml({title:'Resolved by AutoSIM',icon:ic('bolt',13),dot:'#5ecdec',countClass:'cy',total:autosimT,
      barColor:'#5ecdec',nameCol:'Incident Type',hidePct:true, rows:autosim,
      onRow:function(t,q){ return 'showIncidentAgentsPopup(\''+q(t.type)+'\',\'autosim\')'; }})+
    dashTcardHtml({title:'Resolved by PHD agents',icon:ic('user',13),dot:'#ffcf5e',countClass:'am',total:phdT,
      barColor:'#ff9900',nameCol:'Incident Type', rows:phd, grouped:d.phdGrouped||null, groupedLabel:'View Incident types group',
      onRow:function(t,q){ return 'showIncidentAgentsPopup(\''+q(t.type)+'\',\'phd\')'; },
      onGroup:function(t,q){ return 'showGroupMembersPopup(\''+q(t.type)+'\',this.getAttribute(\'data-m\'))'; }});
}

// Shared card-table renderer for Incident Types / Resolutions / Historical Incidents.
// cfg: {title, icon, dot, countClass, total, barColor, nameCol, hidePct, rows:[{type,count,pct}],
//       grouped:{name:[{type,count}]}, groupedLabel, onRow(t,q)->js, onGroup(t,q)->js }
function dashTcardHtml(cfg){
  const PAGE=10;
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const list=cfg.rows||[];
  const hidePct=!!cfg.hidePct;
  const body=list.length?list.map(function(t,i){
    const hidden=i>=PAGE?' hidden-row':'';
    const pct=(t.pct!=null)?t.pct:0;
    const members=(cfg.grouped&&cfg.grouped[t.type])?cfg.grouped[t.type]:null;
    const pctCell=hidePct?'':'<td><div class="pctwrap"><div class="pctbar"><span style="width:'+Math.max(pct,1.5)+'%;background:'+cfg.barColor+'"></span></div><span class="pctval">'+pct+'%</span></div></td>';
    if(members){
      const gLabel=cfg.groupedLabel||'View types';
      const btn='<button type="button" class="inc-grp-btn" onclick="event.stopPropagation();'+(cfg.onGroup?cfg.onGroup(t,q):'')+'" data-m="'+esc(JSON.stringify(members))+'">'+ic('copy',12)+' '+esc(gLabel)+'</button>';
      return '<tr class="inc-grouped'+hidden+'"><td class="it-name"><strong>'+esc(t.type)+'</strong> <span style="color:#a78bfa;font-size:.72em;font-weight:700">(grouped)</span> '+btn+'</td>'+
        '<td class="it-count">'+Number(t.count).toLocaleString()+'</td>'+pctCell+'</tr>';
    }
    const click=cfg.onRow?(' onclick="'+cfg.onRow(t,q)+'"'):'';
    return '<tr class="inc-clickrow'+hidden+'" title="View agents"'+click+'><td class="it-name"><strong>'+esc(t.type)+'</strong></td>'+
      '<td class="it-count">'+Number(t.count).toLocaleString()+'</td>'+pctCell+'</tr>';
  }).join(''):'';
  const extra=Math.max(list.length-PAGE,0);
  const headCols='<th>'+esc(cfg.nameCol||'Incident Type')+'</th><th class="num">Count</th>'+(hidePct?'':'<th class="pct">% of Total</th>');
  const tbl=list.length
    ? '<table class="itbl"><thead><tr>'+headCols+'</tr></thead><tbody>'+body+'</tbody></table>'
      +(extra>0?'<div class="loadmore"><button onclick="dashToggleMore(this)" data-shown="'+PAGE+'" data-mode="more">'+ic('caret-down',12)+' Load more <span class="rem">('+extra+' more)</span></button></div>':'')
    : '<div style="padding:16px 20px"><p class="meta-info" style="margin:0">None.</p></div>';
  return '<div class="tcard">'+
    '<div class="tcard-head">'+
      '<div class="th-title"><span class="th-dot" style="background:'+cfg.dot+'"></span>'+(cfg.icon||'')+' '+esc(cfg.title)+'</div>'+
      '<div class="th-count '+(cfg.countClass||'cy')+'">'+Number(cfg.total||0).toLocaleString()+'</div>'+
    '</div>'+tbl+'</div>';
}
// Reveal the next 10 rows of a card-table (shared by all dashboard .tcard tables).
function dashLoadMore(btn){
  // Back-compat: reveal the next 10 rows.
  dashToggleMore(btn);
}
window.dashLoadMore=dashLoadMore;
// Toggle a .tcard table between "Load more" (reveal +10) and "Show less" (collapse back to 10).
// When everything is visible the button flips to "Show less"; clicking it re-hides rows past 10.
const DASH_PAGE=10;
function dashToggleMore(btn){
  const card=btn.closest('.tcard'); if(!card)return;
  const rows=card.querySelectorAll('tbody tr');
  const mode=btn.getAttribute('data-mode')||'more';
  if(mode==='less'){
    // Collapse back to the default 10.
    for(let i=DASH_PAGE;i<rows.length;i++){ rows[i].classList.add('hidden-row'); }
    btn.setAttribute('data-shown',DASH_PAGE);
    btn.setAttribute('data-mode','more');
    const rem=rows.length-DASH_PAGE;
    btn.innerHTML=(ic('caret-down',12)||'\u25be')+' Load more <span class="rem">('+rem+' more)</span>';
    // Scroll the card back into view so the user isn't left far down the page.
    try{ card.scrollIntoView({behavior:'smooth',block:'nearest'}); }catch(e){}
    return;
  }
  // Reveal the next 10.
  let shown=parseInt(btn.getAttribute('data-shown'),10)||DASH_PAGE;
  const next=shown+DASH_PAGE;
  for(let i=shown;i<next && i<rows.length;i++){ rows[i].classList.remove('hidden-row'); }
  btn.setAttribute('data-shown',next);
  const remaining=rows.length-next;
  if(remaining<=0){
    // Everything is now visible -> flip to "Show less".
    btn.setAttribute('data-mode','less');
    btn.innerHTML=(ic('caret-up',12)||'\u25b4')+' Show less';
  } else {
    const r=btn.querySelector('.rem'); if(r)r.textContent='('+remaining+' more)';
  }
}
window.dashToggleMore=dashToggleMore;
// Popup 1: the incident types combined into a grouped PHD row, each with its ticket count (scope-aware).
// Each member row is clickable -> the existing agent-breakdown popup (Popup 2) for that raw type.
function showGroupMembersPopup(groupName, membersJson){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  let members=[]; try{ members=JSON.parse(membersJson||'[]'); }catch(e){}
  const total=members.reduce((s,x)=>s+(x.count||0),0);
  const rows=members.length?members.map((m,i)=>
    '<tr class="inc-clickrow" title="View agents who resolved '+esc(m.type)+'" onclick="showIncidentAgentsPopup(\''+q(m.type)+'\',\'phd\')">'+
      '<td style="color:#ff9900;font-weight:700;text-align:center">'+(i+1)+'</td>'+
      '<td style="word-break:break-word"><strong>'+esc(m.type)+'</strong></td>'+
      '<td style="text-align:center;font-weight:800;color:#fff">'+(m.count||0).toLocaleString()+'</td>'+
    '</tr>').join(''):'<tr><td colspan="3" style="text-align:center;color:#5f6b6c;padding:16px">No incident types in this scope.</td></tr>';
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML='<div class="popup-card" style="max-width:80vw;width:80vw">'+
    '<div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">'+
      '<div><h2 style="color:#a78bfa;font-size:1.3em">'+esc(groupName)+'</h2><div class="pc-subcount">Grouped incident types \u00b7 '+total.toLocaleString()+' ticket'+(total===1?'':'s')+' \u00b7 '+members.length+' type'+(members.length===1?'':'s')+' \u00b7 click a type for its agents</div></div>'+
      '<div class="popup-actions"><button class="btn danger" onclick="closeAllPopups()">Close</button></div>'+
    '</div>'+
    '<div style="margin-top:16px;overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:auto"><thead><tr>'+
      '<th style="text-align:center;width:1%;white-space:nowrap">#</th><th style="width:auto">Incident Type</th><th style="text-align:center;width:1%;white-space:nowrap">Tickets</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  document.body.appendChild(overlay);
}
window.showGroupMembersPopup=showGroupMembersPopup;

// ===================== RESOLUTIONS section (live dashboard, PHD-only) =====================
let RES_SCOPE_Q=''; // scope param for resolution drill-down popups (mirrors INCIDENTS_SCOPE_Q)
function renderResolutionsChunk(d){
  const slot=document.getElementById('dashResolutionsBody');if(!slot)return;
  try{
    const liveQ=(typeof LIVE_QUARTER!=='undefined'&&LIVE_QUARTER)?LIVE_QUARTER.qid:null;
    RES_SCOPE_Q=(d&&d.quarter&&d.quarter!==liveQ)?('&q='+encodeURIComponent(d.quarter)):'';
  }catch(e){ RES_SCOPE_Q=''; }
  const list=d.phdTypes||[]; const groupedMap=d.phdGrouped||null; const total=d.phdTotal||0;
  slot.innerHTML=dashTcardHtml({title:'Resolved by PHD agents',icon:ic('user',13),dot:'#ffcf5e',countClass:'am',total:total,
    barColor:'#fbbf24',nameCol:'Resolution', rows:list, grouped:groupedMap, groupedLabel:'View resolutions group',
    onRow:function(t,q){ return 'showResolutionAgentsPopup(\''+q(t.type)+'\')'; },
    onGroup:function(t,q){ return 'showResGroupMembersPopup(\''+q(t.type)+'\',this.getAttribute(\'data-m\'))'; }});
}

// Popup 1 for a grouped resolution: member resolution values + counts; click -> agents popup.
function showResGroupMembersPopup(groupName, membersJson){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  let members=[]; try{ members=JSON.parse(membersJson||'[]'); }catch(e){}
  const total=members.reduce((s,x)=>s+(x.count||0),0);
  const rows=members.length?members.map((m,i)=>
    '<tr class="inc-clickrow" title="View agents who used '+esc(m.type)+'" onclick="showResolutionAgentsPopup(\''+q(m.type)+'\')">'+
      '<td style="color:#ff9900;font-weight:700;text-align:center">'+(i+1)+'</td>'+
      '<td style="word-break:break-word"><strong>'+esc(m.type)+'</strong></td>'+
      '<td style="text-align:center;font-weight:800;color:#fff">'+(m.count||0).toLocaleString()+'</td>'+
    '</tr>').join(''):'<tr><td colspan="3" style="text-align:center;color:#5f6b6c;padding:16px">No resolutions in this scope.</td></tr>';
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML='<div class="popup-card" style="max-width:80vw;width:80vw">'+
    '<div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">'+
      '<div><h2 style="color:#a78bfa;font-size:1.3em">'+esc(groupName)+'</h2><div class="pc-subcount">Grouped resolutions \u00b7 '+total.toLocaleString()+' ticket'+(total===1?'':'s')+' \u00b7 '+members.length+' type'+(members.length===1?'':'s')+' \u00b7 click a resolution for its agents</div></div>'+
      '<div class="popup-actions"><button class="btn danger" onclick="closeAllPopups()">Close</button></div>'+
    '</div>'+
    '<div style="margin-top:16px;overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:auto"><thead><tr>'+
      '<th style="text-align:center;width:1%;white-space:nowrap">#</th><th style="width:auto">Resolution</th><th style="text-align:center;width:1%;white-space:nowrap">Tickets</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  document.body.appendChild(overlay);
}
window.showResGroupMembersPopup=showResGroupMembersPopup;

// Popup 2 for a resolution value/group: agents who used it + counts; click an agent -> tickets.
async function showResolutionAgentsPopup(value){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  try{ if(window.loadUserAvatars) loadUserAvatars(); }catch(e){}
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML='<div class="popup-card" style="max-width:80vw;width:80vw">'+
    '<div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">'+
      '<div><h2 style="color:#ff9900;font-size:1.3em">'+esc(value)+'</h2><div class="pc-subcount" id="resAgLoad">loading\u2026</div></div>'+
      '<div class="popup-actions"><button class="btn danger" onclick="closeAllPopups()">Close</button></div>'+
    '</div>'+
    '<div id="resAgBody" style="margin-top:16px"><div style="display:flex;align-items:center;justify-content:center;min-height:120px"><div class="spinner"></div></div></div></div>';
  document.body.appendChild(overlay);
  let data=null;
  try{ const r=await window.PHDAuth.api('GET','/api/dash/resolution-agents?value='+encodeURIComponent(value)+RES_SCOPE_Q); if(r&&r.ok)data=r.data; }catch(e){}
  const body=document.getElementById('resAgBody'); const load=document.getElementById('resAgLoad');
  if(!data||!data.agents){ if(body)body.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load agent breakdown.</p>'; return; }
  const agents=data.agents||[];
  if(load) load.textContent=data.total.toLocaleString()+' ticket'+(data.total===1?'':'s')+' \u00b7 '+agents.length+' agent'+(agents.length===1?'':'s')+' \u00b7 highest first';
  if(!agents.length){ if(body)body.innerHTML='<p class="pc-none">No tickets.</p>'; return; }
  const rows=agents.map((a,i)=>{
    const dn=displayName(a.agent);
    const ava=(window.PHDAuth&&window.PHDAuth.avatarHtml)?window.PHDAuth.avatarHtml(profileFor(a.agent),28):('<span class="inc-ava-fallback">'+ic('user',16)+'</span>');
    return '<tr class="inc-clickrow" title="View '+esc(dn)+"'s tickets\" onclick=\"showResolutionTicketsDrilldown('"+q(value)+"','"+q(a.agent)+"')\">"+
      '<td style="color:#ff9900;font-weight:700;text-align:center">'+(i+1)+'</td>'+
      '<td><span class="inc-ag-cell">'+ava+'<span class="inc-ag-name">'+esc(dn)+'<span class="inc-ag-sub">@'+esc(a.agent)+'</span></span></span></td>'+
      '<td style="text-align:center;font-weight:800;color:#fff">'+a.count+'</td>'+
    '</tr>';
  }).join('');
  body.innerHTML='<p class="meta-info" style="margin:0 0 10px">Click an agent to view their tickets.</p>'+
    '<div style="overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:auto"><thead><tr>'+
      '<th style="text-align:center;width:1%;white-space:nowrap">#</th><th style="width:auto">Agent</th><th style="text-align:center;width:1%;white-space:nowrap">Tickets</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}
window.showResolutionAgentsPopup=showResolutionAgentsPopup;

// Drill-down: one agent's tickets for a resolution value/group. Reuses the shared _INC_TK table.
async function showResolutionTicketsDrilldown(value,agent){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const dn=displayName(agent);
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML='<div class="popup-card" style="max-width:80vw;width:80vw">'+
    '<div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">'+
      '<div><h2 style="color:#ff9900;font-size:1.2em">'+esc(dn)+' \u2014 '+esc(value)+'</h2><div class="pc-subcount" id="incTkLoad">loading\u2026</div></div>'+
      '<div class="popup-actions"><button class="btn" onclick="showResolutionAgentsPopup(\''+q(value)+'\')">\u2190 Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>'+
    '</div>'+
    '<div id="incTkBody" style="margin-top:16px"><div style="display:flex;align-items:center;justify-content:center;min-height:120px"><div class="spinner"></div></div></div></div>';
  document.body.appendChild(overlay);
  let data=null;
  try{ const r=await window.PHDAuth.api('GET','/api/dash/resolution-tickets?value='+encodeURIComponent(value)+'&agent='+encodeURIComponent(agent)+RES_SCOPE_Q); if(r&&r.ok)data=r.data; }catch(e){}
  const body=document.getElementById('incTkBody'); const load=document.getElementById('incTkLoad');
  if(!data||!data.tickets){ if(body)body.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load tickets.</p>'; return; }
  const tix=(data.tickets||[]).map(t=>({ShortId:t.shortId,IssueUrl:t.url,Status:t.status,CreateDate:t.createDate,ResolvedDate:t.resolvedDate,Title:t.title}));
  if(load) load.textContent=tix.length.toLocaleString()+' ticket'+(tix.length===1?'':'s')+' \u00b7 newest resolved first';
  if(!tix.length){ if(body)body.innerHTML='<p class="pc-none">No tickets.</p>'; return; }
  // Back button on the shared table renderer should return to the RESOLUTION agents popup.
  _INC_TK={ tickets:tix, sortField:'CreateDate', sortDir:'desc' };
  renderIncTkTable();
}
window.showResolutionTicketsDrilldown=showResolutionTicketsDrilldown;
// Row-click popup for an incident type: agents who resolved that type + how many each, like the
// Ticket Age Classification popup. Fetches the per-type agent breakdown from the server on demand.
async function showIncidentAgentsPopup(type,resolverKey){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  try{ if(window.loadUserAvatars) loadUserAvatars(); }catch(e){}
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const subLabel=resolverKey==='autosim'?'Resolved by AutoSIM':(resolverKey==='phd'?'Resolved by PHD agents':'Resolved');
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML='<div class="popup-card" style="max-width:80vw;width:80vw">'+
    '<div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">'+
      '<div><h2 style="color:#ff9900;font-size:1.3em">'+esc(type)+'</h2><div class="pc-subcount" id="incAgLoad">'+subLabel+' \u00b7 loading\u2026</div></div>'+
      '<div class="popup-actions"><button class="btn danger" onclick="closeAllPopups()">Close</button></div>'+
    '</div>'+
    '<div id="incAgBody" style="margin-top:16px"><div style="display:flex;align-items:center;justify-content:center;min-height:120px"><div class="spinner"></div></div></div></div>';
  document.body.appendChild(overlay);
  let data=null;
  try{
    const r=await window.PHDAuth.api('GET','/api/dash/incident-agents?type='+encodeURIComponent(type)+'&resolver='+encodeURIComponent(resolverKey||'')+INCIDENTS_SCOPE_Q);
    if(r&&r.ok) data=r.data;
  }catch(e){}
  const body=document.getElementById('incAgBody'); const load=document.getElementById('incAgLoad');
  if(!data||!data.agents){ if(body)body.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load agent breakdown.</p>'; return; }
  const agents=data.agents||[];
  if(load) load.textContent=subLabel+' \u00b7 '+data.total.toLocaleString()+' ticket'+(data.total===1?'':'s')+' \u00b7 '+agents.length+' agent'+(agents.length===1?'':'s')+' \u00b7 highest first';
  if(!agents.length){ if(body)body.innerHTML='<p class="pc-none">No resolved tickets of this type.</p>'; return; }
  const max=agents[0].count||1;
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const isPhd=(resolverKey==='phd');
  const rows=agents.map((a,i)=>{
    const isBot=(a.agent==='AutoSIM');
    const dn=isBot?'AutoSIM':displayName(a.agent);
    const ava=isBot?('<span class="inc-ava-fallback">'+ic('bolt',16)+'</span>')
      :((window.PHDAuth&&window.PHDAuth.avatarHtml)?window.PHDAuth.avatarHtml(profileFor(a.agent),28):('<span class="inc-ava-fallback">'+ic('user',16)+'</span>'));
    return '<tr class="inc-clickrow" title="View '+esc(dn)+"'s "+esc(type)+' tickets" onclick="showIncidentTicketsDrilldown(\''+q(type)+'\',\''+q(a.agent)+'\',\''+q(resolverKey||'')+'\')">'+
      '<td style="color:#ff9900;font-weight:700;text-align:center">'+(i+1)+'</td>'+
      '<td><span class="inc-ag-cell">'+ava+'<span class="inc-ag-name">'+esc(dn)+(isBot?'':'<span class="inc-ag-sub">@'+esc(a.agent)+'</span>')+'</span></span></td>'+
      '<td style="text-align:center;font-weight:800;color:#fff">'+a.count+'</td>'+
    '</tr>';
  }).join('');
  // AutoSIM: 3-col table, no Volume (single bot row — a bar is pointless).
  // PHD: same 3-col table, but the freed space shows a horizontal bar chart of per-agent counts.
  const tableHtml='<div style="overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:auto"><thead><tr>'+
    '<th style="text-align:center;width:1%;white-space:nowrap">#</th><th style="width:auto;white-space:nowrap">Agent</th><th style="text-align:center;width:1%;white-space:nowrap">Tickets</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  if(isPhd){
    body.innerHTML='<p class="meta-info" style="margin:0 0 10px">Click an agent to view their tickets.</p>'+
      '<div class="inc-ag-split">'+
        '<div class="inc-ag-tbl">'+tableHtml+'</div>'+
        '<div class="inc-ag-chart"><div class="chart-wrap" style="height:'+Math.max(240,agents.length*30)+'px"><canvas id="incAgChart"></canvas></div></div>'+
      '</div>';
    // Horizontal bar chart of per-agent resolved counts (highest first, matching the table order).
    const labels=agents.map(a=>displayName(a.agent));
    const counts=agents.map(a=>a.count);
    try{
      makeChart('incAgChart',{type:'bar',data:{labels:labels,datasets:[{data:counts,backgroundColor:'#ff9900',borderRadius:3}]},
        options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>c.raw.toLocaleString()+' ticket'+(c.raw===1?'':'s')}}},
          scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:11}},title:{display:true,text:'Tickets resolved',color:'#d5dbdb',font:{size:12}}},
            y:{grid:{display:false},ticks:{font:{size:11},autoSkip:false}}}}});
    }catch(e){}
  }else{
    body.innerHTML='<p class="meta-info" style="margin:0 0 10px">Click the row to view the tickets.</p>'+tableHtml;
  }
}
window.showIncidentAgentsPopup=showIncidentAgentsPopup;
// Drill-down: the actual resolved tickets for one agent (or AutoSIM) of a given incident type.
// Ticket / Status / Created / Resolved. "Back" returns to the agent-breakdown popup.
async function showIncidentTicketsDrilldown(type,agent,resolverKey){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const q=(s)=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const isBot=(String(agent).toLowerCase()==='autosim');
  const dn=isBot?'AutoSIM':displayName(agent);
  const statusColor=(s)=>({'Resolved':'#4ade80','Closed':'#4ade80','Assigned':'#44b9d6','Work In Progress':'#fbbf24','Pending':'#ff9900','Researching':'#a78bfa'})[s]||'#879596';
  const overlay=document.createElement('div');
  overlay.id='colorPopup';overlay.className='popup-overlay';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML='<div class="popup-card" style="max-width:80vw;width:80vw">'+
    '<div class="popup-head" style="border-bottom:1px solid var(--bd);padding-bottom:14px">'+
      '<div><h2 style="color:#ff9900;font-size:1.2em">'+esc(dn)+' \u2014 '+esc(type)+'</h2><div class="pc-subcount" id="incTkLoad">loading\u2026</div></div>'+
      '<div class="popup-actions"><button class="btn" onclick="showIncidentAgentsPopup(\''+q(type)+'\',\''+q(resolverKey||'')+'\')">\u2190 Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>'+
    '</div>'+
    '<div id="incTkBody" style="margin-top:16px"><div style="display:flex;align-items:center;justify-content:center;min-height:120px"><div class="spinner"></div></div></div></div>';
  document.body.appendChild(overlay);
  let data=null;
  try{
    const r=await window.PHDAuth.api('GET','/api/dash/incident-tickets?type='+encodeURIComponent(type)+'&agent='+encodeURIComponent(agent)+INCIDENTS_SCOPE_Q);
    if(r&&r.ok) data=r.data;
  }catch(e){}
  const body=document.getElementById('incTkBody'); const load=document.getElementById('incTkLoad');
  if(!data||!data.tickets){ if(body)body.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load tickets.</p>'; return; }
  const tix=data.tickets||[];
  if(load) load.textContent=tix.length.toLocaleString()+' ticket'+(tix.length===1?'':'s')+' \u00b7 newest resolved first';
  if(!tix.length){ if(body)body.innerHTML='<p class="pc-none">No tickets.</p>'; return; }
  // Stash the tickets so the sortable Created/Resolved headers can re-sort in place (no re-fetch).
  // Default sort: Created, newest first.
  _INC_TK={ tickets:tix, sortField:'CreateDate', sortDir:'desc' };
  renderIncTkTable();
}
window.showIncidentTicketsDrilldown=showIncidentTicketsDrilldown;
// Current incident-tickets drill-down state (for in-place sorting).
let _INC_TK=null;
// Sort toggle from a clickable Created/Resolved header. Same field -> flip direction; new field ->
// start descending (newest first).
function incTkSort(field){
  if(!_INC_TK)return;
  if(_INC_TK.sortField===field){ _INC_TK.sortDir=(_INC_TK.sortDir==='desc'?'asc':'desc'); }
  else { _INC_TK.sortField=field; _INC_TK.sortDir='desc'; }
  renderIncTkTable();
}
window.incTkSort=incTkSort;
// (Re)render the incident-tickets table body from _INC_TK, applying the current sort.
function renderIncTkTable(){
  const body=document.getElementById('incTkBody'); if(!body||!_INC_TK)return;
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusColor=(s)=>({'Resolved':'#4ade80','Closed':'#4ade80','Assigned':'#44b9d6','Work In Progress':'#fbbf24','Pending':'#ff9900','Researching':'#a78bfa'})[s]||'#879596';
  const fmt=(d)=>{const x=new Date(d);return isNaN(x)?'\u2014':x.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});};
  const field=_INC_TK.sortField, dir=_INC_TK.sortDir;
  const tix=_INC_TK.tickets.slice().sort(function(a,b){
    const ta=new Date(a[field]||0).getTime()||0, tb=new Date(b[field]||0).getTime()||0;
    return dir==='desc' ? (tb-ta) : (ta-tb);
  });
  const arrow=(f)=>{ if(_INC_TK.sortField!==f) return ' <span class="inc-sort-ar" style="opacity:.35">\u21c5</span>'; return _INC_TK.sortDir==='desc'?' <span class="inc-sort-ar">\u2193</span>':' <span class="inc-sort-ar">\u2191</span>'; };
  const rows=tix.map(function(t){
    const sid=t.ShortId||'';
    return '<tr>'+
      '<td style="white-space:nowrap;text-align:center"><a class="ap-id inc-tk-id" href="https://t.corp.amazon.com/issues/'+esc(sid)+'" target="_blank" rel="noopener">'+esc(sid)+'</a></td>'+
      '<td style="white-space:nowrap;text-align:center"><span style="color:'+statusColor(t.Status)+';font-weight:600">'+esc(t.Status||'\u2014')+'</span></td>'+
      '<td style="white-space:nowrap;text-align:center">'+esc(fmt(t.CreateDate))+'</td>'+
      '<td style="white-space:nowrap;text-align:center">'+esc(fmt(t.ResolvedDate))+'</td>'+
      '<td class="inc-tk-title" title="'+esc(t.Title||'')+'">'+esc(t.Title||'')+'</td>'+
    '</tr>';
  }).join('');
  body.innerHTML='<div style="overflow-x:auto"><table class="xls-table inc-tk-table" style="width:100%;table-layout:auto"><thead><tr>'+
    '<th style="width:1%;white-space:nowrap;text-align:center"><span style="display:inline-flex;align-items:center;gap:5px;justify-content:center">'+ic('ticket',13)+' Ticket</span></th>'+
    '<th style="width:1%;white-space:nowrap;text-align:center">Status</th>'+
    '<th class="inc-sort-th" onclick="incTkSort(\'CreateDate\')" title="Sort by Created" style="width:1%;white-space:nowrap;text-align:center;cursor:pointer">Created'+arrow('CreateDate')+'</th>'+
    '<th class="inc-sort-th" onclick="incTkSort(\'ResolvedDate\')" title="Sort by Resolved" style="width:1%;white-space:nowrap;text-align:center;cursor:pointer">Resolved'+arrow('ResolvedDate')+'</th>'+
    '<th style="width:auto">Title</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  // Keep the subtitle in sync with the active sort.
  const load=document.getElementById('incTkLoad');
  if(load){ const fld=(field==='CreateDate'?'Created':'Resolved'); const ord=(dir==='desc'?'newest first':'oldest first'); load.textContent=_INC_TK.tickets.length.toLocaleString()+' ticket'+(_INC_TK.tickets.length===1?'':'s')+' \u00b7 '+fld+' '+ord; }
}
function renderHiChunk(d){
  const slot=document.getElementById('dashHiBody');if(!slot)return;
  const total=d.total||0;
  // Map an HI root-cause breakdown ({rootCause,count}) to the {type,count,pct} shape dashTcardHtml wants.
  const hiRows=function(list){ return (list||[]).map(function(r){ const rc=String(r.rootCause||'Unknown').replace(/^\s*-\s*/,'').trim(); return {type:rc,count:r.count,pct:total?+(r.count/total*100).toFixed(1):0}; }); };
  slot.innerHTML=
    // Weekly pet vs non-pet repeat incidents (HI Cnt>0), created per week — sits above the tables.
    '<h3 style="color:#d5dbdb;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Repeat incidents per week \u2014 pet vs non-pet</h3>'+
    '<p class="meta-info" style="margin:0 0 12px">Repeat-incident tickets (HI Cnt&gt;0) created each week, split into <b style="color:#a78bfa">pet / animal</b> vs <b style="color:#ff9900">non-pet</b>.</p>'+
    '<div class="chart-box"><div class="chart-wrap tall"><canvas id="cHiWeekly"></canvas></div></div>'+
    '<div style="margin-top:22px">'+
    dashTcardHtml({title:'🐾 Involving pet / animal incidents',icon:'',dot:'#a78bfa',countClass:'pu',total:d.pet,
      barColor:'#a78bfa',nameCol:'Root Cause', rows:hiRows(d.petBreakdown)})+
    dashTcardHtml({title:'Non-pet incidents',icon:'',dot:'#ffcf5e',countClass:'am',total:d.nonPet,
      barColor:'#fbbf24',nameCol:'Root Cause', rows:hiRows(d.nonPetBreakdown)})+
    '</div>';
  // Weekly pet/non-pet chart pulls from the (SWR-cached) /api/dash/weekly payload.
  loadDashChunk('weekly',drawHiWeekly,{silent:true,cacheKey:'dash-weekly-hisplit'}).catch(function(){});
}
// Wave (filled-area line) chart: pet vs non-pet repeat incidents (HI Cnt>0) created per week.
function drawHiWeekly(w){
  if(!w||!w.labels||!document.getElementById('cHiWeekly'))return;
  // X axis shows just the week code (W26). Full "W26 (start – end)" appears in the hover tooltip title.
  const labels=w.labels.slice();
  const span=w.span||[];
  const fmtD=function(iso){ if(!iso)return null; var dt=new Date(iso); if(isNaN(dt))return null; return dt.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
  const pet=w.hiPetCreated||[], nonPet=w.hiNonPetCreated||[];
  const combined=pet.map(function(v,i){ return (v||0)+((nonPet[i])||0); });
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('cHiWeekly',{type:'line',
    data:{labels:labels,datasets:[
      _waveDataset('Pet / animal',pet,'#a78bfa','rgba(167,139,250,'),
      _waveDataset('Non-pet',nonPet,'#ff9900','rgba(255,153,0,'),
      // Combined (pet + non-pet): a clear STRAIGHT solid line, no fill, drawn on top.
      {label:'Combined',data:combined,borderColor:'#4ade80',backgroundColor:'#4ade80',pointBackgroundColor:'#4ade80',pointRadius:3,pointHoverRadius:5,borderWidth:3,tension:0,fill:false,spanGaps:true,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:true,position:'top',labels:{usePointStyle:true,boxWidth:8,font:{size:12}}},
        tooltip:{callbacks:{title:function(items){ var i=items&&items[0]?items[0].dataIndex:-1; var s=(i>=0?span[i]:null)||{}; var a=fmtD(s.first), b=fmtD(s.last); return labels[i]+((a&&b)?(' ('+a+' \u2013 '+b+')'):''); }}}},
      scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},title:{display:true,text:'Repeat incidents (HI Cnt>0)',color:'#d5dbdb',font:{size:12}},ticks:{font:{size:11}}},
        x:{grid:{display:false},ticks:{font:{size:11},maxRotation:0,minRotation:0,autoSkip:false}}}}});
}
function _barOpts(){return {responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}};}

// Render the summary KPI groups from a /api/dash/summary payload.
// `target` (optional): 'avg' or 'repeat' repaints only that grid (used by a scoped section reload);
// omitted repaints all grids (initial page load).
function renderSummaryInto(d,target){
  // Persist the live version so the topbar Refresh button's "already up to date" check works,
  // and keep LIVE_QUARTER's label in sync for the SLA-per-week card. Only on the initial (untargeted,
  // live) load — a scoped Q2/Overall summary fetch must NOT clobber the live quarter reference.
  if(!target){
    try{
      if(d&&d.quarter){
        LIVE_QUARTER=Object.assign({},LIVE_QUARTER,{quarter:d.quarter,label:d.label||d.quarter});
        metaSet('liveCache',{quarter:d.quarter,publishedAt:d.publishedAt||null});
      }
    }catch(e){}
  }
  stopKpiScramble(); // real values are in — halt the flicker before the count-up
  const g1=(!target)?document.getElementById('dashSumTotals'):null;
  const g2=(!target||target==='avg')?document.getElementById('dashSumAvg'):null;
  const g3=(!target||target==='repeat')?document.getElementById('dashSumRepeat'):null;
  // Each section renders as a table; values carry their final string in data-kpi-val and are
  // animated by countUpKpi (scramble -> ease-out count-up -> lands exactly on the real number).
  if(g1){
    g1.innerHTML=kpiTableHtml([
      {metric:ic('ticket',14)+' Total Tickets', value:d.total.toLocaleString()},
      {metric:ic('check-circle',14)+' Resolved', value:d.resolved.toLocaleString()+' ('+d.resolvedPct+'%)', valColor:'#4ade80'},
      {metric:ic('hourglass',14)+' Unresolved Tickets', value:d.unresolved.toLocaleString()+' ('+d.unresolvedPct+'%)', valColor:'#fbbf24'}
    ], false);
  }
  if(g2){
    g2.innerHTML=kpiTableHtml([
      {metric:'Avg Resolution Time', value:d.avgResolutionHrs+' hrs', desc:'Avg create\u2192resolve time.'},
      {metric:'SLA Compliance (\u2264240 hrs)', value:d.slaPct+'%', valColor:(d.slaPct>=90?'#4ade80':'#ff5252'), desc:'Resolved within 240 hrs ('+d.slaCompliant+'/'+d.slaBase+').'},
      {metric:ic('bolt',14)+' AutoSIM Resolved', value:d.autosim.toLocaleString()+' ('+d.autosimPct+'%)', desc:'Auto-resolved by AutoSIM.'},
      {metric:ic('repeat',14)+' Avg Repeat Incidents / Week', value:Math.round(d.avgHiPerWeek||0), valColor:'#a78bfa', desc:'Repeat incidents (Cnt&gt;0) per week ('+(d.repeatIncidents!=null?d.repeatIncidents.toLocaleString():'0')+'\u00f7'+(d.weeksElapsed||0)+').'}
    ], true);
  }
  if(g3){
    g3.innerHTML=kpiTableHtml([
      {metric:ic('repeat',14)+' Total Repeat Incidents', value:d.repeatIncidents.toLocaleString(), desc:'Tickets with HI count (Cnt) &gt; 0.'},
      (function(){ var pct=d.total?(Math.round(d.repeatIncidents/d.total*1000)/10):0; var hot=pct>1; return {metric:ic('repeat',14)+' Repeat Incident %', value:pct+'%', valColor:(hot?'#ff5252':undefined), blink:hot, desc:'Share of all tickets that are repeat incidents. Blinks red above 1%.'}; })(),
      {metric:ic('paw',14)+' HI involving pet incidents', value:d.hiPet.toLocaleString()+' ('+d.hiPetPct+'%)', valColor:'#a78bfa', desc:'Repeat incidents with a pet/animal root cause.'},
      {metric:ic('repeat',14)+' HI involving non-pet incidents', value:d.hiNonPet.toLocaleString()+' ('+d.hiNonPetPct+'%)', desc:'Repeat incidents that are not pet-related.'}
    ], true);
  }
  // Animate every table value from a brief scramble into its real number.
  [g1,g2,g3].forEach(function(g){ if(g) g.querySelectorAll('.kpi-anim[data-kpi-val]').forEach(function(el){ countUpKpi(el, el.getAttribute('data-kpi-val')); }); });
}

// Shared dashboard page-title row: "Q3 2026" on the left, "LIVE" badge on the right, and the
// Alerts / Upload / Uploaded-data-log action buttons. On narrow widths the action buttons collapse
// to icon-only (the label is hidden; the button's title provides a hover tooltip) and spread
// across the available width. Returns the full <div class="dash-title-row"> HTML.
function dashPageTitleRow(){
  // No top banner. Each section carries its own banner-style header (see .sec-head styling).
  return '';
}
// Per-section scope. Each dashboard section picks its own scope INDEPENDENTLY, so switching
// e.g. "Incident Types" to Q2 only reloads that section — the rest stay on their own scope.
// Scope values: 'live' (Q3, the default — omits ?q=), '2026-Q2' (Q2), 'q2q3' (Q2 + Q3 combined).
const DASH_SECTION_SCOPE={ avg:'live', repeat:'live', incidents:'live', resolutions:'live', hi:'live', weekly:'live' };
// Map a scope value to the ?q= param for /api/dash/* (live => omit; else the qid/'all').
function scopeToParam(scope){ return (!scope||scope==='live')?'':('?q='+encodeURIComponent(scope)); }
// Legacy shim: chunk -> its section-scope param (used by loadDashChunk when no explicit scope passed).
function dashScopeParamFor(section){ return scopeToParam(DASH_SECTION_SCOPE[section]); }

// Build the 3-way scope selector shown on a section header's top-right: Q3 (Live) | Q2 | Overall.
// `section` is the key in DASH_SECTION_SCOPE; picking an option reloads only that section.
function sectionScopeSelector(section){
  const cur=DASH_SECTION_SCOPE[section]||'live';
  const opt=(val,label,live)=>'<label class="dsc-opt'+(cur===val?' checked':'')+'">'+
    '<input type="radio" name="dsc-'+section+'" value="'+val+'" '+(cur===val?'checked':'')+
    ' onchange="setSectionScope(\''+section+'\',\''+val+'\')"> '+label+(live?' <span class="dsc-live"></span>':'')+'</label>';
  return '<div class="dash-scope-sec" data-scope-sec="'+section+'">'+
    opt('live','Q3 (Live)',true)+opt('2026-Q2','Q2',false)+opt('q2q3','Q2 + Q3',false)+
  '</div>';
}
// Reload ONE section under a newly chosen scope, without touching the others.
function setSectionScope(section,val){
  if(DASH_SECTION_SCOPE[section]===val)return;
  DASH_SECTION_SCOPE[section]=val;
  // Move the orange "checked" highlight to the chosen chip (the header isn't re-rendered on reload).
  const bar=document.querySelector('.dash-scope-sec[data-scope-sec="'+section+'"]');
  if(bar){ bar.querySelectorAll('.dsc-opt').forEach(function(l){
    const inp=l.querySelector('input'); l.classList.toggle('checked', !!inp && inp.value===val);
  }); }
  reloadDashSection(section);
}
window.setSectionScope=setSectionScope;

// Re-fetch + re-render a single section body for its current scope. Paints a spinner first.
function reloadDashSection(section){
  const scope=DASH_SECTION_SCOPE[section]||'live';
  const spin='<div style="display:flex;align-items:center;justify-content:center;min-height:120px"><div class="spinner"></div></div>';
  const fail=(id,msg)=>{ const s=document.getElementById(id); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">'+msg+'</p>'; };
  if(section==='avg' || section==='repeat'){
    // Both come from the summary chunk; repaint only the requested grid.
    const gridId=(section==='avg')?'dashSumAvg':'dashSumRepeat';
    const g=document.getElementById(gridId); if(g)g.innerHTML=spin;
    loadDashChunk('summary',function(d){ renderSummaryInto(d,section); },{silent:true,scope:scope,noCache:true})
      .then(function(r){ if(!r||!r.ok){ if(g)g.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load this section.</p>'; } })
      .catch(function(){ if(g)g.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load this section.</p>'; });
    return;
  }
  if(section==='incidents'){
    const s=document.getElementById('dashIncidentsBody'); if(s)s.innerHTML=spin;
    loadDashChunk('incidents',renderIncidentsChunk,{silent:true,cacheKey:'dash-incidents-v2',scope:scope,noCache:true})
      .then(function(r){ if(!r||!r.ok)fail('dashIncidentsBody','Could not load incident types.'); })
      .catch(function(){ fail('dashIncidentsBody','Could not load incident types.'); });
    return;
  }
  if(section==='resolutions'){
    const s=document.getElementById('dashResolutionsBody'); if(s)s.innerHTML=spin;
    loadDashChunk('resolutions',renderResolutionsChunk,{silent:true,scope:scope,noCache:true})
      .then(function(r){ if(!r||!r.ok)fail('dashResolutionsBody','Could not load resolutions.'); })
      .catch(function(){ fail('dashResolutionsBody','Could not load resolutions.'); });
    return;
  }
  if(section==='hi'){
    const s=document.getElementById('dashHiBody'); if(s)s.innerHTML=spin;
    loadDashChunk('hi',renderHiChunk,{silent:true,scope:scope,noCache:true})
      .then(function(r){ if(!r||!r.ok)fail('dashHiBody','Could not load historical incidents.'); })
      .catch(function(){ fail('dashHiBody','Could not load historical incidents.'); });
    return;
  }
  if(section==='weekly'){
    const s=document.getElementById('dashWeeklyBody'); if(s)s.innerHTML=spin;
    loadDashChunk('weekly',renderWeeklyChunk,{silent:true,scope:scope,noCache:true})
      .then(function(r){ if(!r||!r.ok)fail('dashWeeklyBody','Could not load weekly volume.'); })
      .catch(function(){ fail('dashWeeklyBody','Could not load weekly volume.'); });
    return;
  }
}
window.reloadDashSection=reloadDashSection;

// The chunked dashboard view. Summary loads immediately (cached); the 7 cards below are
// collapsed and load lazily on first expand.
function renderDashboardChunked(){
  stopScramble();
  destroyCharts();
  const loggedIn=window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser();
  // A scrambling value cell for the table skeletons (flickers via startKpiScramble until data lands).
  const scrCell=(scrMax,pct)=>'<span class="scramble-kpi" data-scr-max="'+(scrMax||9000)+'" data-scr-pct="'+(pct?1:0)+'">0</span>';
  // Table skeleton for a metric/value(/definition) section that matches the final rendered table.
  const kpiTblSkel=(rows,withDesc)=>{
    // Mirror kpiTableHtml: 3-col (with Definition) = Metric/Value fit-to-content, Definition fills
    // the rest (auto layout); 2-col = right-aligned value.
    const head=withDesc
      ? '<tr><th style="text-align:center;width:1%;white-space:nowrap">Metric</th><th style="text-align:center;width:1%;white-space:nowrap">Value</th><th style="text-align:left">Definition</th></tr>'
      : '<tr><th>Metric</th><th style="text-align:right">Value</th></tr>';
    const body=rows.map(function(r){
      if(withDesc){
        return '<tr><td class="kt-metric" style="text-align:center;white-space:nowrap">'+r.m+'</td><td class="kt-value" style="text-align:center;white-space:nowrap">'+scrCell(r.s,r.p)+'</td><td class="kt-desc" style="text-align:left">\u2026</td></tr>';
      }
      return '<tr><td class="kt-metric">'+r.m+'</td><td class="kt-value" style="text-align:right">'+scrCell(r.s,r.p)+'</td></tr>';
    }).join('');
    const tblStyle=withDesc?' style="width:100%;table-layout:auto"':'';
    return '<div style="overflow-x:auto;grid-column:1/-1"><table class="kpi-table"'+tblStyle+'><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  };
  // Paired (4-col) queue skeleton: left = totals, right = open statuses.
  const queueSkel=function(){
    const L=[{m:ic('inbox',14)+' In Queue',s:400},{m:ic('grid',14)+' Total Tickets',s:9000},{m:ic('check-circle',14)+' Resolved',s:9000},{m:ic('check-circle',14)+' Closed',s:9000}];
    const R=[{m:ic('inbox',14)+' Assigned',s:200},{m:ic('tool',14)+' Work In Progress',s:300},{m:ic('eye',14)+' Researching',s:100},{m:ic('hourglass',14)+' Pending',s:100}];
    let rows='';
    for(let i=0;i<4;i++){ rows+='<tr><td class="kt-metric" style="text-align:center">'+L[i].m+'</td><td class="kt-value" style="text-align:center">'+scrCell(L[i].s)+'</td><td class="kt-metric" style="text-align:center">'+R[i].m+'</td><td class="kt-value" style="text-align:center">'+scrCell(R[i].s)+'</td></tr>'; }
    return '<div style="overflow-x:auto;grid-column:1/-1"><table class="kpi-table" style="width:100%;table-layout:fixed"><thead><tr><th style="text-align:center;width:25%">Metric</th><th style="text-align:center;width:25%">Value</th><th style="text-align:center;width:25%">Metric</th><th style="text-align:center;width:25%">Value</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  };
  // ---- Fixed skeletons for the always-open cards (match the new layouts; numbers tally via scramble). ----
  const shimmerBar=(w)=>'<div class="shimmer" style="height:8px;border-radius:4px;width:'+w+'%"></div>';
  // Incident Types: two resolver subsections, each a 5-col table (#, Incident Type, Count, %, Volume).
  const incTypesSkel=function(){
    const rowsFor=(n,widths)=>{ let s=''; for(let i=0;i<n;i++){ s+='<tr>'+
      '<td style="color:#ff9900;font-weight:700;text-align:center">'+(i+1)+'</td>'+
      '<td><div class="shimmer" style="height:12px;width:'+(140-i*8)+'px;border-radius:4px"></div></td>'+
      '<td style="text-align:center">'+scrCell(widths[i]||30)+'</td>'+
      '<td style="text-align:center"><span class="scramble-kpi" data-scr-max="90" data-scr-pct="1">0</span></td>'+
    '</tr>'; } return s; };
    const tbl=(rows)=>'<div style="overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:fixed"><thead><tr>'+
      '<th style="text-align:center;width:10%">#</th><th style="width:50%">Incident Type</th><th style="text-align:center;width:20%">Count</th><th style="text-align:center;width:20%">% of Total</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>';
    return '<p class="meta-info">Incident types across the live quarter (resolved tickets), split by who resolved them.</p>'+
      '<h3 class="inc-sub-h">'+ic('bolt',15)+' Resolved by AutoSIM <span class="inc-sub-n"><span class="scramble-kpi" data-scr-max="3000">0</span></span></h3>'+
      tbl(rowsFor(4,[2800,60,40,20]))+
      '<h3 class="inc-sub-h" style="margin-top:22px">'+ic('user',15)+' Resolved by PHD agents <span class="inc-sub-n"><span class="scramble-kpi" data-scr-max="6000">0</span></span></h3>'+
      tbl(rowsFor(6,[1500,1200,600,400,120,90]));
  };
  // Resolutions: single PHD table skeleton (# / Resolution / Count / % of Total).
  const resSkel=function(){
    let rows=''; for(let i=0;i<7;i++){ rows+='<tr>'+
      '<td style="color:#ff9900;font-weight:700;text-align:center">'+(i+1)+'</td>'+
      '<td><div class="shimmer" style="height:12px;width:'+(150-i*9)+'px;border-radius:4px"></div></td>'+
      '<td style="text-align:center">'+scrCell(1400-i*160)+'</td>'+
      '<td style="text-align:center"><span class="scramble-kpi" data-scr-max="90" data-scr-pct="1">0</span></td>'+
    '</tr>'; }
    return '<p class="meta-info">Resolutions recorded by PHD agents (resolved/closed tickets that carry a Resolution value).</p>'+
      '<h3 class="inc-sub-h">'+ic('user',15)+' Resolved by PHD agents <span class="inc-sub-n"><span class="scramble-kpi" data-scr-max="6000">0</span></span></h3>'+
      '<div style="overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:fixed"><thead><tr>'+
        '<th style="text-align:center;width:10%">#</th><th style="width:50%">Resolution</th><th style="text-align:center;width:20%">Count</th><th style="text-align:center;width:20%">% of Total</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  };
  // Historical Incidents: weekly wave chart on top, then two root-cause subsection tables.
  const hiSkel=function(){
    const rc=(accent,n)=>{ let s=''; for(let i=0;i<n;i++){ s+='<tr>'+
      '<td style="color:'+accent+';font-weight:700;text-align:center;white-space:nowrap">'+(i+1)+'</td>'+
      '<td style="text-align:center;white-space:nowrap"><div class="shimmer" style="height:12px;width:'+(160-i*10)+'px;border-radius:4px;margin:0 auto"></div></td>'+
      '<td style="text-align:center;width:26%">'+scrCell(120-i*15)+'</td>'+
      '<td style="text-align:center;width:26%"><span class="scramble-kpi" data-scr-max="90" data-scr-pct="1">0</span></td>'+
      '<td style="width:26%">'+shimmerBar(90-i*14)+'</td>'+
    '</tr>'; } return s; };
    const tbl=(rows)=>'<div style="overflow-x:auto"><table class="xls-table" style="width:100%;table-layout:auto"><thead><tr>'+
      '<th style="width:1%;white-space:nowrap;text-align:center">#</th><th style="width:1%;white-space:nowrap;text-align:center">Root Cause</th><th style="width:26%;text-align:center">Count</th><th style="width:26%;text-align:center">% of Total HI</th><th style="width:26%;text-align:center">Volume</th>'+
      '</tr></thead><tbody>'+rows+'</tbody></table></div>';
    return '<h3 style="color:#d5dbdb;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Repeat incidents per week \u2014 pet vs non-pet</h3>'+
      '<p class="meta-info" style="margin:0 0 12px">Repeat-incident tickets (HI Cnt&gt;0) created each week, split into <b style="color:#a78bfa">pet / animal</b> vs <b style="color:#ff9900">non-pet</b>.</p>'+
      '<div class="chart-box"><div class="chart-wrap tall shimmer"></div></div>'+
      '<h3 style="color:#a78bfa;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin:24px 0 8px">\uD83D\uDC3E Involving pet / animal incidents</h3>'+
      tbl(rc('#a78bfa',5))+
      '<h3 style="color:#ff9900;font-size:.85em;text-transform:uppercase;letter-spacing:.5px;margin:22px 0 8px">Non-pet incidents</h3>'+
      tbl(rc('#ff9900',5));
  };
  // Weekly Volume & SLA: a single tall chart.
  const weeklySkel=function(){
    return '<p class="meta-info" style="margin:0 0 16px">Weekly Created vs Resolved volume, with SLA compliance % on a second axis.</p>'+
      '<div class="chart-box"><div class="chart-wrap tall shimmer"></div></div>';
  };
  const kpiSection=(title,iconName,gridId,skel,scopeSection)=>
    '<div class="section kpi-section"><div class="sec-head"><h2>'+ic(iconName,16)+' '+title+'</h2>'+(scopeSection?sectionScopeSelector(scopeSection):'')+'</div>'+
    '<div class="sec-body"><div class="kpi-grid kpi-grid-compact" id="'+gridId+'" style="grid-template-columns:1fr">'+skel+'</div></div></div>';
  // Queue Status + Ticket Age reflect CURRENT open tickets (no scope selector — always live/current).
  document.getElementById('app').innerHTML=topBar('dashboard')+'<div class="content">'+
    dashPageTitleRow()+
    kpiSection('Queue Status Data','grid','dashQueueKpis',queueSkel())+
    // Ticket Age Classification sits right below Queue Status Data.
    dashStaticCard('clock','Ticket Age Classification','dashAgeBody',ageCardSkeletonHtml())+
    // Each of the five scoped sections carries its own Q3(Live)|Q2|Overall selector on its header.
    // Average Data + Repeat Incident Data sit SIDE BY SIDE (stack on narrow screens).
    '<div class="kpi-pair">'+
      kpiSection('Average Data','clock','dashSumAvg',kpiTblSkel([{m:'Avg Resolution Time',s:200},{m:'SLA Compliance (\u2264240 hrs)',s:100,p:true},{m:ic('bolt',14)+' AutoSIM Resolved',s:3000},{m:ic('repeat',14)+' Avg Repeat Incidents / Week',s:30}],true),'avg')+
      kpiSection('Repeat Incident Data','repeat','dashSumRepeat',kpiTblSkel([{m:ic('repeat',14)+' Repeat Incidents (HI&gt;0)',s:300},{m:ic('paw',14)+' HI involving pet incidents',s:200},{m:ic('repeat',14)+' HI involving non-pet incidents',s:100}],true),'repeat')+
    '</div>'+
    // All sections are always visible (no expand/collapse) and load eagerly. Each is painted with a
    // fixed skeleton matching its final layout, so there's no jump when the data lands.
    dashStaticCard('alert','Incident Types','dashIncidentsBody',incTypesSkel(),'incidents')+
    dashStaticCard('check-circle','Resolutions','dashResolutionsBody',resSkel(),'resolutions')+
    dashStaticCard('repeat','Historical Incidents (Cnt > 0)','dashHiBody',hiSkel(),'hi')+
    // Weekly Volume (Created + Resolved) combined with SLA Compliance % on a second axis.
    dashStaticCard('bar-chart','Weekly Volume & SLA Compliance','dashWeeklyBody',weeklySkel(),'weekly')+
  '</div>';
  attachNewFileHandler();
  if(window.PHDPlaceTopRight) window.PHDPlaceTopRight(); // move the top-right cluster into the header row
  refreshHelpAlertCount();
  startKpiScramble(); // flicker the summary KPI numbers while /api/dash/summary loads
  // Ticket Age Classification loads EAGERLY (always visible, not collapsible). age-detail is
  // time-sensitive so it's not version-cached — always fetched fresh (small payload).
  loadDashChunk('age-detail',renderAgeChunk,{silent:true,noCache:true}).then(function(r){
    if(!r||!r.ok){ const s=document.getElementById('dashAgeBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load ticket age classification.</p>'; }
  }).catch(function(){
    const s=document.getElementById('dashAgeBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load ticket age classification.</p>';
  });
  // Incident Types loads EAGERLY (always visible, no expand/collapse). ALWAYS fetch fresh (noCache):
  // the display grouping is published independently of the quarter version, so a browser-cached copy
  // could show a stale/ungrouped list. The chunk is served from a cheap server rollup, so this is fine.
  loadDashChunk('incidents',renderIncidentsChunk,{silent:true,noCache:true}).then(function(r){
    if(!r||!r.ok){ const s=document.getElementById('dashIncidentsBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load incident types.</p>'; }
  }).catch(function(){
    const s=document.getElementById('dashIncidentsBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load incident types.</p>';
  });
  // Resolutions section (PHD-only). Always fresh (grouping-dependent, no browser cache).
  loadDashChunk('resolutions',renderResolutionsChunk,{silent:true,noCache:true}).then(function(r){
    if(!r||!r.ok){ const s=document.getElementById('dashResolutionsBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load resolutions.</p>'; }
  }).catch(function(){
    const s=document.getElementById('dashResolutionsBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load resolutions.</p>';
  });
  // Historical Incidents + Weekly Volume load EAGERLY now (always visible, no expand/collapse).
  loadDashChunk('hi',renderHiChunk,{silent:true}).then(function(r){
    if(!r||!r.ok){ const s=document.getElementById('dashHiBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load historical incidents.</p>'; }
  }).catch(function(){ const s=document.getElementById('dashHiBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load historical incidents.</p>'; });
  loadDashChunk('weekly',renderWeeklyChunk,{silent:true}).then(function(r){
    if(!r||!r.ok){ const s=document.getElementById('dashWeeklyBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load weekly volume.</p>'; }
  }).catch(function(){ const s=document.getElementById('dashWeeklyBody'); if(s)s.innerHTML='<p class="meta-info" style="text-align:center;padding:20px">Could not load weekly volume.</p>'; });
  // Queue Status Data KPIs load EAGERLY from the /api/dash/queue chunk (always live/current).
  loadDashChunk('queue',function(d){ renderQueueKpis(d); renderQueueChunk(d); },{silent:true}).then(function(r){
    if(!r||!r.ok){ document.querySelectorAll('#dashQueueKpis .scramble-kpi').forEach(function(el){el.classList.remove('scramble-kpi');el.textContent='—';}); }
  }).catch(function(){ document.querySelectorAll('#dashQueueKpis .scramble-kpi').forEach(function(el){el.classList.remove('scramble-kpi');el.textContent='—';}); });
  // Load the summary (cached, version-first). The remaining cards load lazily on first expand.
  loadDashChunk('summary',renderSummaryInto,{silent:false}).then(function(r){
    // If nothing painted (fetch failed + no cache), stop the flicker and show a dash so it isn't stuck.
    if(!r||(!r.painted&&!r.ok)){ stopKpiScramble(); document.querySelectorAll('.scramble-kpi').forEach(function(el){el.textContent='—';}); }
  }).catch(function(){ stopKpiScramble(); document.querySelectorAll('.scramble-kpi').forEach(function(el){el.textContent='—';}); });
}

function renderGroups(){
  const m=M;const sorted=[...m.agents.filter(a=>a.group==='A1').sort((a,b)=>b.resolved-a.resolved),...m.agents.filter(a=>a.group==='A2').sort((a,b)=>b.resolved-a.resolved),...m.agents.filter(a=>a.group==='B').sort((a,b)=>b.resolved-a.resolved)];
  const gc={A1:'#7dd3fc',A2:'#fbbf24',B:'#4ade80'};const tc={A1:'tag-a1',A2:'tag-a2',B:'tag-b'};
  // Display names for the groups (internal keys A1/A2/B stay unchanged in the metrics engine).
  const gn={A1:'BLR',A2:'WFH',B:'AZA'};
  document.getElementById('app').innerHTML=topBar('groups')+`<div class="content">
  <div class="section" style="display:flex;gap:24px;flex-wrap:wrap">
    <span style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:3px;background:#7dd3fc;display:inline-block"></span> ${gn.A1}: harisss, punithsd, arunkzn, flofalgu</span>
    <span style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:3px;background:#fbbf24;display:inline-block"></span> ${gn.A2}: tanviroo, urmahala, chousoud, obalasut, shaavhad, dbiswamb</span>
    <span style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:3px;background:#4ade80;display:inline-block"></span> ${gn.B}: mbozied, nobregak, mellanej</span>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card" style="border-top-color:#7dd3fc"><div class="value" style="color:#7dd3fc">${m.a1R}</div><div class="label">${gn.A1} Resolved</div></div>
    <div class="kpi-card" style="border-top-color:#7dd3fc"><div class="value" style="color:#7dd3fc">${m.a1O}</div><div class="label">${gn.A1} Open</div></div>
    <div class="kpi-card" style="border-top-color:#fbbf24"><div class="value" style="color:#fbbf24">${m.a2R}</div><div class="label">${gn.A2} Resolved</div></div>
    <div class="kpi-card" style="border-top-color:#fbbf24"><div class="value" style="color:#fbbf24">${m.a2O}</div><div class="label">${gn.A2} Open</div></div>
    <div class="kpi-card" style="border-top-color:#4ade80"><div class="value" style="color:#4ade80">${m.bR}</div><div class="label">${gn.B} Resolved</div></div>
    <div class="kpi-card" style="border-top-color:#4ade80"><div class="value" style="color:#4ade80">${m.bO}</div><div class="label">${gn.B} Open</div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-box"><h3>Resolved vs Open</h3><div class="chart-wrap"><canvas id="g1"></canvas></div></div>
    <div class="chart-box"><h3>Avg Resolution Time (Hours)</h3><div class="chart-wrap"><canvas id="g2"></canvas></div></div>
    <div class="chart-box"><h3>Workload Distribution</h3><div class="chart-wrap"><canvas id="g3"></canvas></div></div>
    <div class="chart-box"><h3>Daily Group Trend (Last 7 Days)</h3><div class="chart-wrap"><canvas id="g4"></canvas></div></div>
    <div class="chart-box" style="grid-column:span 2"><h3>Per-Agent Resolved (by Group)</h3><div class="chart-wrap" style="height:400px"><canvas id="g5"></canvas></div></div>
    <div class="chart-box" style="grid-column:span 2"><h3>Agent Resolution Volume</h3><div class="chart-wrap" style="height:350px"><canvas id="g6"></canvas></div></div>
  </div>
  <div class="section"><h2>Individual Agent Performance</h2><div style="overflow-x:auto"><table><thead><tr><th>Agent</th><th>Group</th><th>Assigned</th><th>WIP</th><th>Researching</th><th>Pending</th><th>Resolved</th><th>Closed</th><th>Avg Res (hrs)</th><th>Rate</th></tr></thead><tbody>
    ${sorted.map(a=>`<tr><td><strong style="color:#44b9d6;cursor:pointer" onclick="showAgentTicketsPopup('${a.name}')">${a.name}</strong></td><td><span class="tag ${tc[a.group]}">${gn[a.group]||a.group}</span></td><td>${a.statuses?a.statuses['Assigned']:0}</td><td>${a.statuses?a.statuses['Work In Progress']:0}</td><td>${a.statuses?a.statuses['Researching']:0}</td><td>${a.statuses?a.statuses['Pending']:0}</td><td><span class="badge badge-g">${a.statuses?a.statuses['Resolved']:0}</span></td><td>${a.statuses?a.statuses['Closed']:0}</td><td>${a.avgTime.toFixed(1)}</td><td>${a.resolved+a.open>0?((a.resolved/(a.resolved+a.open))*100).toFixed(1):0}%</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="section"><h2>Group Totals Summary</h2><table><thead><tr><th>Group</th><th>Members</th><th>Assigned</th><th>Resolved</th><th>Open</th><th>Avg Hrs</th><th>Res/Member</th><th>Rate</th></tr></thead><tbody>
    <tr><td><span class="tag tag-a1">${gn.A1}</span></td><td>4</td><td>${m.a1As}</td><td>${m.a1R}</td><td>${m.a1O}</td><td>${m.a1Avg.toFixed(1)}</td><td>${(m.a1R/4).toFixed(1)}</td><td>${m.a1R+m.a1O>0?((m.a1R/(m.a1R+m.a1O))*100).toFixed(1):0}%</td></tr>
    <tr><td><span class="tag tag-a2">${gn.A2}</span></td><td>6</td><td>${m.a2As}</td><td>${m.a2R}</td><td>${m.a2O}</td><td>${m.a2Avg.toFixed(1)}</td><td>${(m.a2R/6).toFixed(1)}</td><td>${m.a2R+m.a2O>0?((m.a2R/(m.a2R+m.a2O))*100).toFixed(1):0}%</td></tr>
    <tr><td><span class="tag tag-b">${gn.B}</span></td><td>3</td><td>${m.bAs}</td><td>${m.bR}</td><td>${m.bO}</td><td>${m.bAvg.toFixed(1)}</td><td>${(m.bR/3).toFixed(1)}</td><td>${m.bR+m.bO>0?((m.bR/(m.bR+m.bO))*100).toFixed(1):0}%</td></tr>
  </tbody></table></div></div>`;
  attachNewFileHandler();Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('g1',{type:'bar',data:{labels:[gn.A1,gn.A2,gn.B],datasets:[{label:'Resolved',data:[m.a1R,m.a2R,m.bR],backgroundColor:['rgba(125,211,252,.8)','rgba(251,191,36,.8)','rgba(74,222,128,.8)'],borderRadius:3},{label:'Open',data:[m.a1O,m.a2O,m.bO],backgroundColor:['rgba(125,211,252,.3)','rgba(251,191,36,.3)','rgba(74,222,128,.3)'],borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{display:false}}}}});
  makeChart('g2',{type:'bar',data:{labels:[gn.A1,gn.A2,gn.B],datasets:[{data:[m.a1Avg,m.a2Avg,m.bAvg],backgroundColor:['rgba(125,211,252,.8)','rgba(251,191,36,.8)','rgba(74,222,128,.8)'],borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{display:false}}}}});
  makeChart('g3',{type:'pie',data:{labels:[`${gn.A1}(${m.a1As})`,`${gn.A2}(${m.a2As})`,`${gn.B}(${m.bAs})`],datasets:[{data:[m.a1As,m.a2As,m.bAs],backgroundColor:['rgba(125,211,252,.85)','rgba(251,191,36,.85)','rgba(74,222,128,.85)'],borderColor:'#000',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#d5dbdb'}}}}});
  makeChart('g4',{type:'line',data:{labels:m.dL,datasets:[{label:gn.A1,data:m.dgA1,borderColor:'#7dd3fc',backgroundColor:'rgba(125,211,252,.08)',fill:true,tension:.4,pointRadius:4},{label:gn.A2,data:m.dgA2,borderColor:'#fbbf24',backgroundColor:'rgba(251,191,36,.08)',fill:true,tension:.4,pointRadius:4},{label:gn.B,data:m.dgB,borderColor:'#4ade80',backgroundColor:'rgba(74,222,128,.08)',fill:true,tension:.4,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{color:'rgba(255,255,255,.04)'}}}}});
  makeChart('g5',{type:'bar',data:{labels:sorted.map(a=>a.name),datasets:[{label:'Resolved',data:sorted.map(a=>a.resolved),backgroundColor:sorted.map(a=>gc[a.group]),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},y:{grid:{display:false}}}}});
  const sortedByRes=[...m.agents].sort((a,b)=>b.resolved-a.resolved);
  makeChart('g6',{type:'bar',data:{labels:sortedByRes.map(a=>a.name),datasets:[{label:'Resolved',data:sortedByRes.map(a=>a.resolved),backgroundColor:'rgba(74,222,128,.75)',borderRadius:2},{label:'Open',data:sortedByRes.map(a=>a.open),backgroundColor:'rgba(255,153,0,.75)',borderRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}}}}});
}

function renderPreviousWeek(){
  const m=M;const resolvers=Object.entries(m.pwRC).sort((a,b)=>b[1]-a[1]);
  const phdR=resolvers.filter(([k])=>k==='AutoSIM'||PHD_AGENTS.includes(k));
  const lmirR=resolvers.filter(([k])=>k!=='AutoSIM'&&!PHD_AGENTS.includes(k));
  const maxC=resolvers.length>0?resolvers[0][1]:1;
  const ratio=m.pwCreated>0?((m.pwResolved/m.pwCreated)*100).toFixed(1):0;
  document.getElementById('app').innerHTML=topBar('previous-week')+`<div class="content">
  <div class="page-title"><h1>Previous Week Report</h1><p style="font-size:1.1em;font-weight:700;color:#fff;margin-top:6px">Week: ${m.pwStartStr} – ${m.pwEndStr}</p></div>
  <div class="kpi-grid">
    <div class="kpi-card accent"><div class="value">${m.pwCreated}</div><div class="label">Tickets Created</div></div>
    <div class="kpi-card success"><div class="value">${m.pwResolved}</div><div class="label">Tickets Resolved</div></div>
    <div class="kpi-card"><div class="value">${m.pwAuto}</div><div class="label">AutoSIM Resolved</div></div>
    <div class="kpi-card"><div class="value">${m.pwResolved-m.pwAuto}</div><div class="label">Agent Resolved</div></div>
    <div class="kpi-card success"><div class="value" title="(${m.pwResolved}/${m.pwCreated})×100">${ratio}%</div><div class="label" style="cursor:help;border-bottom:1px dashed #879596" title="(Resolved/Created)×100">Resolution Ratio ℹ</div></div>
  </div>
  <div class="charts-grid">
    <div class="chart-box"><h3>Daily Created vs Resolved</h3><div class="chart-wrap"><canvas id="p1"></canvas></div></div>
    <div class="chart-box"><h3>Agent Resolution Volume</h3><div class="chart-wrap" style="height:400px"><canvas id="p2"></canvas></div></div>
  </div>
  <div class="section"><h2>Resolution Leaderboard</h2>
    <h3 style="color:#ff9900;font-size:.9em;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">PHD Analysts</h3>
    <table><thead><tr><th>#</th><th>Resolver</th><th>Resolved (Unsecured Animal)</th><th>% of Total</th><th>Volume</th></tr></thead><tbody>
    ${phdR.map(([name,count],i)=>{const an=m.pwAn[name]?m.pwAn[name].a:0;return`<tr><td style="color:#ff9900;font-weight:700">${i+1}</td><td><strong>${name}</strong>${name==='AutoSIM'?' <span style="padding:2px 8px;background:rgba(27,156,176,.15);color:#1b9cb0;border-radius:4px;font-size:.75em;font-weight:600">AUTO</span>':''}</td><td>${count}${an>0?` <span style="color:#879596">(${an})</span>`:''}</td><td>${((count/m.pwResolved)*100).toFixed(1)}%</td><td><div style="display:flex;align-items:center"><div style="height:8px;border-radius:4px;background:#ff9900;width:${(count/maxC*100).toFixed(0)}%;min-width:4px"></div></div></td></tr>`;}).join('')}
    </tbody></table>
    ${lmirR.length>0?`<details style="margin-top:24px;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden"><summary style="padding:12px 16px;cursor:pointer;background:#0a0a0a;color:#879596;font-size:.9em;font-weight:600;text-transform:uppercase;letter-spacing:.5px"><span style="color:#1b9cb0">LMIR Agents</span> <span style="font-size:.8em;font-weight:400">(click to expand)</span></summary><table><thead><tr><th>#</th><th>Resolver</th><th>Resolved</th><th>%</th><th>Volume</th></tr></thead><tbody>${lmirR.map(([name,count],i)=>`<tr><td style="color:#1b9cb0;font-weight:700">${i+1}</td><td><strong>${name}</strong></td><td>${count}</td><td>${((count/m.pwResolved)*100).toFixed(1)}%</td><td><div style="display:flex;align-items:center"><div style="height:8px;border-radius:4px;background:#1b9cb0;width:${(count/maxC*100).toFixed(0)}%;min-width:4px"></div></div></td></tr>`).join('')}</tbody></table></details>`:''}</div>
  <div class="section"><h2>Status of Tickets Created This Week</h2><table><thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead><tbody>
    ${Object.entries(m.pwSt).sort((a,b)=>b[1]-a[1]).map(([s,c])=>`<tr><td>${s}</td><td>${c}</td><td>${m.pwCreated>0?((c/m.pwCreated)*100).toFixed(1):0}%</td></tr>`).join('')}
  </tbody></table></div></div>`;
  attachNewFileHandler();Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('p1',{type:'bar',data:{labels:m.pwDL,datasets:[{label:'Created',data:m.pwDC,backgroundColor:'rgba(255,153,0,.7)',borderColor:'#ff9900',borderWidth:1,borderRadius:3},{label:'Resolved',data:m.pwDR,backgroundColor:'rgba(29,129,2,.7)',borderColor:'#1d8102',borderWidth:1,borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{display:false}}}}});
  const phdOnly=phdR.filter(([k])=>k!=='AutoSIM');
  makeChart('p2',{type:'bar',data:{labels:phdOnly.map(([k])=>k),datasets:[{data:phdOnly.map(([,v])=>v),backgroundColor:phdOnly.map((_,i)=>i<3?'rgba(255,153,0,.8)':i<8?'rgba(32,116,213,.8)':'rgba(27,156,176,.7)'),borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},y:{grid:{display:false}}}}});
}

// ========= PUBLISH TO GITHUB (shared data) =========
// ========= LOGIN =========
function showLoginModal(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;padding:28px">
    <h2 style="color:#4ade80;font-size:1.2em;margin-bottom:8px">Log in</h2>
    <p style="color:#879596;font-size:.85em;margin-bottom:18px;line-height:1.5">Viewing the dashboard needs no login. Log in to publish or manage data.</p>
    <label style="display:block;color:#879596;font-size:.85em;margin-bottom:6px">Username</label>
    <input type="text" id="loginUser" autocomplete="username" style="width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.9em">
    <label style="display:block;color:#879596;font-size:.85em;margin:12px 0 6px">Password</label>
    <input type="password" id="loginPass" autocomplete="current-password" style="width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.9em">
    <label style="display:flex;align-items:center;gap:8px;color:#879596;font-size:.82em;margin-top:12px;cursor:pointer"><input type="checkbox" id="loginRemember" checked> Keep me logged in on this device</label>
    <div class="err" id="loginErr" style="color:#ff5252;font-size:.85em;margin-top:12px;display:none"></div>
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn sec" onclick="closeAllPopups()">Cancel</button>
      <button class="btn" style="background:#4ade80" onclick="doLogin()">Log in</button>
    </div>
    <p style="color:#5f6b6c;font-size:.75em;margin-top:14px">First login may take ~30–50s while the server wakes.</p>
  </div>`;
  document.body.appendChild(overlay);
  setTimeout(()=>{const u=document.getElementById('loginUser');if(u)u.focus();
    const p=document.getElementById('loginPass');if(p)p.addEventListener('keydown',(e)=>{if(e.key==='Enter')doLogin();});},50);
}

async function doLogin(){
  const username=document.getElementById('loginUser').value.trim();
  const password=document.getElementById('loginPass').value;
  const remember=document.getElementById('loginRemember').checked;
  const errEl=document.getElementById('loginErr');
  if(!username||!password){errEl.textContent='Enter username and password.';errEl.style.display='block';return;}
  errEl.style.display='none';
  const btn=event&&event.target;if(btn){btn.disabled=true;btn.textContent='Logging in...';}
  try{
    const r=await window.PHDAuth.api('POST','/api/login',{username,password});
    if(!r.ok){throw new Error((r.data&&r.data.error)||('Login failed (HTTP '+r.status+')'));}
    window.PHDAuth.setSession(r.data.token,r.data.user,remember);
    closeAllPopups();
    showLoginLoader(); // full-screen loader while roster/profile load + the toolbar re-renders
    // Refresh the role roster + my profile (avatar), then re-render so role-gated UI updates.
    await loadUserRoles();
    if(window.PHDAuth.loadMyProfile)await window.PHDAuth.loadMyProfile();
    startHelpNotificationPolling(); // begin desktop notifications for admins/owner
    hideLoginLoader();
    nav(currentView);
    showToast('Logged in as '+r.data.user.username+' ('+r.data.user.role+')');
  }catch(e){
    hideLoginLoader();
    errEl.textContent=e.message;errEl.style.display='block';
    if(btn){btn.disabled=false;btn.textContent='Log in';}
  }
}

// Full-screen loader shown during login while the roster/profile load and the UI re-renders.
function showLoginLoader(){
  hideLoginLoader();
  const o=document.createElement('div');
  o.id='loginLoader';
  o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:1200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
  o.innerHTML='<div class="spinner" style="width:48px;height:48px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:spin 1s linear infinite"></div><p style="color:#fff;font-size:1.05em;font-weight:600">Signing you in…</p><p style="color:#879596;font-size:.85em">Loading your dashboard and permissions</p>';
  document.body.appendChild(o);
}
function hideLoginLoader(){const o=document.getElementById('loginLoader');if(o)o.remove();}

// ========= PUBLISH (to MongoDB Atlas via API) =========
function showPublishModal(){
  if(!window.PHDAuth.atLeast('admin')){showToast('You need admin privileges to publish.');return;}
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;padding:28px">
    <h2 style="color:#4ade80;font-size:1.2em;margin-bottom:8px">Publish Data to Everyone</h2>
    <p style="color:#879596;font-size:.88em;margin-bottom:18px;line-height:1.5">This saves the current dashboard data to the shared database so all viewers see it. No token needed — you're already logged in.</p>
    <div class="err" id="pubErr" style="color:#ff5252;font-size:.85em;margin-top:4px;display:none"></div>
    <div style="margin-top:8px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn sec" onclick="closeAllPopups()">Cancel</button>
      <button class="btn" style="background:#4ade80" onclick="doPublish()">Publish</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

function showPublishSpinner(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.9);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML=`<div style="text-align:center">
    <div class="spinner"></div>
    <p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">New data is being pushed...</p>
    <p style="color:#879596;margin-top:8px;font-size:.9em">Saving to the shared database. This may take a moment.</p>
  </div>`;
  document.body.appendChild(overlay);
}

// Full-page spinner shown while the uploaded file is being validated/parsed (before the confirm popup).
function showAssessingSpinner(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='assessSpinner';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.9);z-index:1050;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML=`<div style="text-align:center">
    <div class="spinner"></div>
    <p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">New data is being assessed...</p>
    <p style="color:#879596;margin-top:8px;font-size:.9em">This may take a moment.</p>
  </div>`;
  document.body.appendChild(overlay);
}
function hideAssessingSpinner(){const el=document.getElementById('assessSpinner');if(el)el.remove();}

// Current live quarter info (set on init from the API). e.g. {quarter:'2026-Q3',label:'Q3 2026',range:{...}}
let LIVE_QUARTER=null;

// Publish to Atlas. Sends the merged LIVE dataset (local store) PLUS any non-live rows from the
// upload; the server buckets by quarter (replace live, merge non-live) and logs each quarter.
// nonLiveRows: raw uploaded rows whose CreateDate is outside the live quarter (may be empty).
// changeSummary (optional): the live-quarter browser merge report for the live data-log entry.
// deltaLive: array of only the changed/new live tickets to patch. When provided, we try the fast
// delta endpoint first (small payload, no full-doc rewrite) and fall back to a full replace on 409.
async function doPublish(nonLiveRows,changeSummary,deltaLive){
  if(!window.PHDAuth.atLeast('admin')){showToast('You need admin privileges to publish.');return;}
  nonLiveRows=Array.isArray(nonLiveRows)?nonLiveRows:[];
  PUBLISHING=true;                 // lock uploads/merges
  showPublishSpinner();
  try{
    let r=null, usedDelta=false;
    // 1) Fast path: delta publish (only changed/new live tickets + non-live rows).
    if(Array.isArray(deltaLive)){
      const patchBody={changed:deltaLive,nonLive:nonLiveRows,changeSummary:changeSummary||null};
      const pr=await window.PHDAuth.api('POST','/api/live-quarter/patch',patchBody);
      if(pr.ok){ r=pr; usedDelta=true; }
      else if(pr.status!==409 && !(pr.data&&pr.data.needFull)){
        // A real error (not "no live doc yet") -> surface it.
        throw new Error((pr.data&&pr.data.error)||('Publish failed (HTTP '+pr.status+')'));
      }
      // else: 409/needFull -> fall through to full replace below.
    }
    // 2) Full replace: fresh upload, or delta rejected because no live doc exists yet.
    if(!usedDelta){
      const liveRows=await dbGetAll();
      const tickets=liveRows.concat(nonLiveRows);
      const payload={updatedAt:new Date().toISOString(),count:tickets.length,tickets};
      const body={data:payload};
      if(changeSummary)body.changeSummary=changeSummary;
      r=await window.PHDAuth.api('POST','/api/live-quarter',body);
      if(!r.ok){throw new Error((r.data&&r.data.error)||('Publish failed (HTTP '+r.status+')'));}
    }
    PUBLISHING=false;
    closeAllPopups();
    // Invalidate the local cache version so the next visit re-syncs to the server's publishedAt.
    try{await metaSet('liveCache',null);}catch(_){}
    showToast('Data published! Live for everyone now.');
    showUploadResult((r.data&&r.data.written)||[],changeSummary);
  }catch(e){
    PUBLISHING=false;
    closeAllPopups();
    setTimeout(()=>showToast('Publish failed: '+e.message),60);
  }
}

// Post-upload summary: what was written per quarter (live replace + non-live merges).
function showUploadResult(written,liveSummary){
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rowsHtml=(written||[]).map(w=>{
    const isLive=w.isLive;
    return `<div style="padding:12px 0;border-bottom:1px solid #2a2a2a">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:#fff;font-weight:600">${esc(w.label||w.quarter)} ${isLive?'<span style="color:#4ade80;font-size:.72em;font-weight:700;margin-left:6px">● LIVE — updated</span>':'<span style="color:#fbbf24;font-size:.72em;font-weight:700;margin-left:6px">PAST — merged</span>'}</span>
        <span style="color:${isLive?'#4ade80':'#fbbf24'};font-weight:700">${(w.count||0).toLocaleString()} tickets</span>
      </div>
      <div style="color:#5f6b6c;font-size:.78em;margin-top:4px">${isLive?'View changes in the live quarter\u2019s update log.':'View changes in the '+esc(w.label||w.quarter)+' dashboard\u2019s update log.'}</div>
    </div>`;
  }).join('')||'<p style="color:#879596">No quarters were written.</p>';
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(ev)=>{if(ev.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px">
    <h2 style="color:#4ade80;font-size:1.2em;margin-bottom:6px">${ic('check-circle',18)} Upload complete</h2>
    <p style="color:#879596;font-size:.88em;margin-bottom:14px">Tickets were routed to their quarters. Each quarter's own update log records its changes.</p>
    <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:2px 16px 6px">${rowsHtml}</div>
    <div style="margin-top:20px;text-align:right"><button class="btn" onclick="closeAllPopups()">Done</button></div>
  </div>`;
  document.body.appendChild(overlay);
}

async function loadLiveQuarter(){
  try{
    const r=await window.PHDAuth.api('GET','/api/live-quarter');
    if(r.ok&&r.data){
      LIVE_QUARTER={quarter:r.data.quarter,label:r.data.label,range:r.data.range};
      const d=r.data.data;
      if(d&&d.tickets&&d.tickets.length){
        return {updatedAt:(r.data.meta&&r.data.meta.publishedAt)||d.updatedAt,count:d.count,tickets:d.tickets};
      }
    }
  }catch(e){}
  return null;
}

// Load the user roster (username->role) so the dashboard knows which assignees are
// owner/manager/admin (allowed to hold purple/reopened tickets). Logged-in only.
window.PURPLE_ALLOWED_SET=null;
async function loadUserRoles(){
  if(!(window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser()))return;
  try{
    const r=await window.PHDAuth.api('GET','/api/user-roles');
    if(r.ok&&Array.isArray(r.data)){
      const allowedRoles=new Set(['owner','manager','admin']);
      const set=new Set();const profiles={};
      r.data.forEach(u=>{const un=(u.username||'').toLowerCase();if(allowedRoles.has(u.role))set.add(un);profiles[un]=u;});
      window.PURPLE_ALLOWED_SET=set;
      window.USER_PROFILES=profiles; // lowercase username -> {username,role,displayName} (avatar merged in later)
    }
  }catch(e){/* leave null -> purple only blinks on Unassigned */}
}

// Lazily fetch avatars (username -> base64) and merge them into USER_PROFILES so drill-down popups
// show pictures. Kept OUT of loadUserRoles so the roster load stays tiny; runs once in the
// background (or on demand before a popup). Cached for the page load.
let _avatarsLoaded=false, _avatarsLoading=null;
function loadUserAvatars(){
  if(_avatarsLoaded)return Promise.resolve();
  if(_avatarsLoading)return _avatarsLoading;
  if(!(window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser()))return Promise.resolve();
  _avatarsLoading=(async()=>{
    try{
      const r=await window.PHDAuth.api('GET','/api/user-avatars');
      if(r.ok&&r.data&&typeof r.data==='object'){
        const profiles=window.USER_PROFILES||{};
        Object.keys(r.data).forEach(un=>{const k=un.toLowerCase();if(!profiles[k])profiles[k]={username:un};profiles[k].avatar=r.data[un];});
        window.USER_PROFILES=profiles;
        _avatarsLoaded=true;
      }
    }catch(e){/* avatars are optional — popups fall back to initials */}
    finally{_avatarsLoading=null;}
  })();
  return _avatarsLoading;
}
window.loadUserAvatars=loadUserAvatars;
// Look up a person's profile (for avatars) by assignee identity/username.
function profileFor(name){
  const p=(window.USER_PROFILES||{})[String(name||'').toLowerCase()];
  return p||{username:name};
}
// Is this assignee a registered account in our database (present in /api/user-roles)?
function isRegisteredUser(name){
  if(!name)return false;
  const roster=window.USER_PROFILES||null;
  if(!roster)return false; // roster not loaded -> treat as unknown/non-registered
  return Object.prototype.hasOwnProperty.call(roster,String(name).toLowerCase());
}

// Cheap "is it stale?" check: returns the live quarter's id + publishedAt without the ticket payload.
async function fetchLiveQuarterVersion(){
  try{
    const r=await window.PHDAuth.api('GET','/api/live-version'); // only the current quarter (no catalog)
    if(r.ok&&r.data&&r.data.quarter){
      const liveId=r.data.quarter;
      // Keep LIVE_QUARTER label in sync even on a cache hit.
      LIVE_QUARTER=Object.assign({},LIVE_QUARTER,{quarter:liveId,label:(r.data.label||liveId)});
      return {liveId,publishedAt:r.data.publishedAt||null};
    }
  }catch(e){}
  return null;
}

// Render either the deep-linked view (app.html?view=groups|previous-week|shift-report) or the
// dashboard. Making this authoritative at render time means a ?view= deep link shows the right
// view immediately, instead of rendering the dashboard first and switching afterward.
function renderCurrentOrView(){
  const v=initialViewParam();
  if(v){ nav(v); } else { renderDashboardChunked(); }
}

// Render the dashboard from whatever is currently in the local tickets store.
async function renderFromLocal(uploadTimeIso){
  // Fast path: reuse previously-computed metrics for this exact dataset version so we skip the
  // heavy computeMetrics() pass over ~8k rows on repeat loads. Keyed by publishedAt.
  const metricsKey=uploadTimeIso||null;
  if(metricsKey){
    try{
      const cachedM=await metaGet('metrics:'+metricsKey);
      if(cachedM){
        M=cachedM;
        try{ if(cachedM._dbMaxLastUpdated!=null)window._dbMaxLastUpdated=cachedM._dbMaxLastUpdated; }catch(e){}
        renderCurrentOrView();
        return true;
      }
    }catch(e){}
  }
  const allRows=await dbGetAll();
  if(!allRows.length)return false;
  // Track the newest LastUpdatedDate currently live, so the upload confirm can flag a stale file.
  let maxLU=0;
  try{ maxLU=allRows.reduce((m,r)=>{const d=new Date(r.LastUpdatedDate);return(!isNaN(d)&&d.getTime()>m)?d.getTime():m;},0); window._dbMaxLastUpdated=maxLU; }catch(e){}
  M=computeMetrics(allRows);M.totalStored=allRows.length;
  M.uploadTime=uploadTimeIso?new Date(uploadTimeIso).toLocaleString('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):null;
  // Persist the computed metrics for this version so the next load renders without recomputing.
  if(metricsKey){
    try{ const toStore=Object.assign({},M,{_dbMaxLastUpdated:maxLU}); await metaSet('metrics:'+metricsKey,toStore); }catch(e){}
  }
  renderCurrentOrView();
  return true;
}

// Fetch the full live-quarter dataset, store it, cache its version, and render.
async function refreshFromServer(showShimmer){
  if(showShimmer){
    // Dashboard shell (labels + spinners) during a full fetch; neutral spinner if deep-linked to a view.
    paintInitialLoading();
  }
  const shared=await loadLiveQuarter();// sets LIVE_QUARTER
  if(shared){
    await dbClear();
    await dbPutAll(shared.tickets);
    // Cache the version so future visits can skip the heavy fetch when nothing changed.
    await metaSet('liveCache',{quarter:LIVE_QUARTER?LIVE_QUARTER.quarter:null,publishedAt:shared.updatedAt||null});
    // Drop stale computed-metrics blobs from previous versions (keep only the current one).
    try{ await metaPruneMetrics('metrics:'+(shared.updatedAt||'')); }catch(e){}
    await renderFromLocal(shared.updatedAt);
    return true;
  }
  return false;
}

// Deep-link support: another page can link to app.html?view=groups|previous-week|shift-report.
// After the dashboard data is ready, switch to that view.
function applyInitialView(){
  try{
    const v=new URLSearchParams(location.search).get('view');
    if(v && v!=='dashboard' && ['groups','previous-week','shift-report'].includes(v) && M){ nav(v); }
  }catch(e){}
}

// Is the page deep-linked to a non-dashboard view (Groups/Prev/Shift)? Then we shouldn't flash the
// dashboard shell — show a neutral spinner while data loads, then render the requested view.
function initialViewParam(){
  try{const v=new URLSearchParams(location.search).get('view');return (['groups','previous-week','shift-report'].includes(v))?v:'';}catch(e){return '';}
}
function paintInitialLoading(){
  const v=initialViewParam();
  if(v==='shift-report'){
    // Paint the Shift Report layout with shimmer placeholders immediately (no blank full-page spinner).
    try{ document.getElementById('app').innerHTML=topBar('shift-report')+shiftReportSkeleton(); }
    catch(e){ document.getElementById('app').innerHTML=topBar('shift-report')+'<div class="content" style="text-align:center;padding:80px 0"><div class="spinner"></div></div>'; }
  }else if(v){
    document.getElementById('app').innerHTML=topBar(v)+'<div class="content" style="text-align:center;padding:80px 0"><div class="spinner"></div></div>';
  }else{
    renderDashboardShell();
  }
}

// Shift Report loading skeleton — same layout as the real report, with shimmer blocks where the
// numbers/chart will land. Shown instantly on deep-link so the page is never a blank spinner.
function shiftReportSkeleton(){
  const colorTile=(cls)=>`<div class="sr-color sr-${cls}"><div class="sr-color-dot"></div><div class="sk-blk sk-num" style="margin:0 auto"></div><div class="sk-blk sk-lbl" style="margin:8px auto 0"></div><div class="sk-blk sk-sub" style="margin:5px auto 0"></div></div>`;
  const cardRows=(n)=>{let s='';for(let i=0;i<n;i++)s+=`<tr><td><span class="sk-blk sk-row-l"></span></td><td class="sr-v"><span class="sk-blk sk-row-v"></span></td></tr>`;return s;};
  const card=(n)=>`<div class="sr-card"><div class="sk-blk sk-h3"></div><table class="sr-table"><tbody>${cardRows(n)}</tbody></table></div>`;
  return `<div class="content sr">
  <div class="sr-hero">
    <div class="sr-hero-txt"><span class="sr-eyebrow">${ic('clock',12)} Queue snapshot</span><h1>${ic('clipboard',24)} Shift Report</h1><p class="sr-lead">Loading queue health for handoff…</p></div>
    <div class="sr-hero-badge"><div class="sr-hero-num"><span class="sk-blk sk-num"></span></div><div class="sr-hero-cap">In queue</div></div>
  </div>
  <section class="sr-sec sr-card-sec sr-sec-takeover">
    <div class="sr-sec-head"><h2>${ic('alert',18)} Takeover — Queue by Age</h2></div>
    <div class="sr-colors">${colorTile('purple')}${colorTile('black')}${colorTile('red')}${colorTile('yellow')}${colorTile('green')}</div>
    <div class="sr-chart-card"><h3>Unresolved Tickets by Agent (Age Breakdown)</h3><div class="chart-wrap" style="height:380px;position:relative"><div class="sk-blk" style="position:absolute;inset:0;border-radius:10px"></div></div></div>
  </section>
  <section class="sr-sec sr-card-sec sr-sec-handoff">
    <div class="sr-sec-head"><h2>${ic('clipboard',18)} Handoff Report</h2></div>
    <div class="sr-cards">${card(4)}${card(4)}${card(5)}${card(5)}</div>
  </section>
  </div>`;
}

// If we arrived from a standalone page's "Upload new data" (sessionStorage handoff + ?upload=1),
// load the live-quarter data, then open the upload confirmation for the stashed CSV. The full
// pipeline (parse -> merge -> publish) then runs here and lands on the refreshed dashboard.
async function maybeHandlePendingUpload(){
  let flagged=false;
  try{ flagged=new URLSearchParams(location.search).get('upload')==='1'; }catch(e){}
  let stashed=null;
  try{ stashed=sessionStorage.getItem('phdPendingUpload'); }catch(e){}
  if(!flagged||!stashed)return false;
  try{ sessionStorage.removeItem('phdPendingUpload'); }catch(e){}
  // Clean the URL so a refresh doesn't re-trigger.
  try{ history.replaceState(null,'','app.html'); }catch(e){}
  if(window.tbHideLoader)window.tbHideLoader();
  if(!(window.PHDAuth&&window.PHDAuth.atLeast&&window.PHDAuth.atLeast('admin'))){
    showToast('Admin access required to upload.');return false;
  }
  // Need the current live quarter (for per-quarter routing) + the current dashboard data.
  await loadLiveQuarter();
  await refreshFromServer(/*showShimmer*/true);
  let payload;
  try{ payload=JSON.parse(stashed); }catch(e){ payload=null; }
  if(!payload||!payload.text){ showToast('Upload handoff failed. Please try again.'); return true; }
  previewUploadText(payload.text);
  return true;
}

// ========= INIT ========= (chunked dashboard: summary loads+caches immediately; each
// chart card lazy-loads on first expand. Other views load the full array on demand.)
(async function init(){
  // Cross-page upload handoff runs first (needs a full fetch + upload confirm).
  let uploadHandoff=false;
  try{ uploadHandoff=new URLSearchParams(location.search).get('upload')==='1' && !!sessionStorage.getItem('phdPendingUpload'); }catch(e){}

  const deepLink=initialViewParam(); // groups | previous-week | shift-report | ''

  // Paint immediately so the screen is never blank. Deep-linked views show a neutral spinner
  // (full data loads next); otherwise render the chunked dashboard right away.
  if(!uploadHandoff){
    if(deepLink){ paintInitialLoading(); }
    else{ renderDashboardChunked(); }
  }

  // Role roster + profile (avatar) so the header renders correctly; re-render the top bar after.
  await loadUserRoles();
  if(window.PHDAuth.loadMyProfile)await window.PHDAuth.loadMyProfile();
  try{ if(window.PHDNav&&window.PHDNav.refreshRight)window.PHDNav.refreshRight(); }catch(e){}
  startHelpNotificationPolling();
  // Warm avatars in the background (non-blocking) so drill-down popups show pictures without a
  // per-open fetch. The roster itself no longer carries the heavy base64 images.
  setTimeout(loadUserAvatars, 1200);

  // Cross-page upload handoff: a standalone page stashed a CSV and sent us here with ?upload=1.
  if(await maybeHandlePendingUpload())return;

  // Shift Report fetches its own tiny aggregate endpoint — no need to load the full ~8k blob.
  if(deepLink==='shift-report'){ currentView='shift-report'; renderShiftReport(); return; }
  // Other deep-linked views (groups/previous-week) still need the full dataset.
  if(deepLink){
    const ok=await ensureFullData();
    if(ok){ nav(deepLink); } else { renderDashboardChunked(); }
    return;
  }
  // Dashboard already rendered (chunked). Nothing else to do — each card caches itself on expand.
})();
