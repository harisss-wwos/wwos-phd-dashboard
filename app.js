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
async function dbGetAll(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
async function dbPutAll(rows){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);rows.forEach(r=>store.put(r));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function dbClear(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function dbCount(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).count();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}

function getGroup(n){if(GA1.includes(n))return'A1';if(GA2.includes(n))return'A2';if(GB.includes(n))return'B';return null;}
function displayName(n){if(n==='0d1616c8-bcb7-4450-8bc5-f0a296bc01d1')return'LM-CAP';if(n&&n.includes('AutoSIM'))return'AutoSIM';return n;}
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
  const autosim=data.filter(r=>r.ResolvedByIdentity&&r.ResolvedByIdentity.includes('AutoSIM')).length;
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
    if(rootCause&&rootCause.length>1){
      // Check if animal/pet
      if(rootCause.toLowerCase().includes('unsecured animal')){
        // Pet tickets closed as Immediately Resolved / Automatically Closed WITH an assignee are
        // treated as first-time pet incidents (no action taken) — clubbed under one bucket.
        const cc=(r.ClosureCode||'').trim();
        const isImmAuto=(cc==='Immediately Resolved'||cc==='Automatically Closed');
        if(isImmAuto&&(r.AssigneeIdentity||'').trim()!==''){
          tp='First Time Pet Incident (Immediately Resolved / No Action Taken)';
        } else {
          const hasDetails=details.trim()!=='';
          if(hasDetails){tp='Pet Incident (HI>0)';}
          else{tp='Pet Incident (Resolved by AUTO-SIM)';}
        }
      } else {
        tp=rootCause;
      }
    } else {
      tp='No Root Cause';
    }
    if(tp.length>80)tp=tp.substring(0,80);
    incM[tp]=(incM[tp]||0)+1;
    if(!incTickets[tp])incTickets[tp]=[];
    incTickets[tp].push({ShortId:r.ShortId||r.IssueId,AssigneeIdentity:r.AssigneeIdentity,ResolvedByIdentity:resolver,CreateDate:r.CreateDate,Status:r.Status,Title:title});
  });
  const iL=Object.keys(incM).sort((a,b)=>incM[b]-incM[a]),iD=iL.map(k=>incM[k]);
  // Slim incTickets for storage
  const incTicketsSlim={};iL.forEach(k=>{incTicketsSlim[k]=incTickets[k].map(r=>({ShortId:r.ShortId,AssigneeIdentity:r.AssigneeIdentity,ResolvedByIdentity:r.ResolvedByIdentity,CreateDate:r.CreateDate,Status:r.Status,Title:r.Title}));});
  // Agents (Resolved/Closed = resolved, rest = open)
  const aRes={},aTm={};data.forEach(r=>{if((r.Status==='Resolved'||r.Status==='Closed')&&r.ResolvedByIdentity&&!r.ResolvedByIdentity.includes('AutoSIM')){const x=r.ResolvedByIdentity;aRes[x]=(aRes[x]||0)+1;if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/36e5;if(h>=0){if(!aTm[x])aTm[x]=[];aTm[x].push(h);}}}});
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
  const pwAuto=pwR.filter(r=>r.ResolvedByIdentity&&r.ResolvedByIdentity.includes('AutoSIM')).length;
  const pwRC={};pwR.forEach(r=>{let x=r.ResolvedByIdentity||'Unknown';if(x.includes('AutoSIM'))x='AutoSIM';pwRC[x]=(pwRC[x]||0)+1;});
  const pwAn={};pwR.forEach(r=>{let x=r.ResolvedByIdentity||'Unknown';if(x.includes('AutoSIM'))x='AutoSIM';if(!pwAn[x])pwAn[x]={t:0,a:0};pwAn[x].t++;if((r.RootCause||'').toLowerCase().includes('unsecured animal'))pwAn[x].a++;});
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
  if(PUBLISHING){showToast('Publish in progress — data changes are locked.');return;}
  const reader=new FileReader();
  const uploadTime=new Date().toLocaleString('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  document.getElementById('app').innerHTML=`<div class="upload-wrap"><div style="text-align:center"><div class="spinner"></div><p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">Processing CSV data...</p><p style="color:#879596;margin-top:8px;font-size:.9em">${mode==='merge'?'Merging with existing data':'Building your dashboard'}</p></div></div>`;
  reader.onload=(e)=>{setTimeout(async()=>{
    const newRows=parseCSV(e.target.result).filter(r=>r.ShortId||r.IssueId).map(r=>{if(!r.ShortId&&r.IssueId)r.ShortId=r.IssueId;return r;});
    let mergeReport=null;
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
        const oldRank=STATUS_RANK[old.Status]||0;const newRank=STATUS_RANK[nr.Status]||0;
        const isReopen=(old.Status==='Resolved'||old.Status==='Closed')&&nr.Status==='Work In Progress';
        if(isReopen){nr._reopened=true;toWrite.push(nr);reopened++;}
        else if(newRank>oldRank){if(old._reopened&&(nr.Status==='Resolved'||nr.Status==='Closed')){/* reopened ticket now closed again - clear flag */}else if(old._reopened){nr._reopened=true;}toWrite.push(nr);updated++;}
        else{unchanged++;}
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
      mergeReport={added,updated,reopened,autoClosed,unchanged,missing:missing.length,missingIds:missing.slice(0,50)};
    }
    // Recompute from full merged set
    const allRows=await dbGetAll();
    M=computeMetrics(allRows);M.uploadTime=uploadTime;M.mergeReport=mergeReport;M.totalStored=allRows.length;
    renderDashboard();
    if(autoPublish){
      // Push merged dataset to Atlas, passing the merge report so it's saved in the audit log.
      await doPublish(undefined, mergeReport);
    } else if(mergeReport){
      showMergeReport(mergeReport);
    }
  },50);};
  reader.readAsText(file);
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:700px;width:100%;max-height:80vh;overflow:auto;padding:24px">
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
function nav(view){currentView=view;destroyCharts();if(view==='dashboard')renderDashboard();else if(view==='groups')renderGroups();else if(view==='previous-week')renderPreviousWeek();else if(view==='shift-report')renderShiftReport();}

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
  const navBtn=(view,lbl,ico)=>`<button class="btn ${active===view?'':'sec'}" onclick="nav('${view}')" style="${active===view?'':'border-color:var(--bd)'}">${ic(ico)} ${lbl}</button>`;
  const loggedIn=!!(window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser());
  // Row 1: title bar only — clicking the logo/title goes Home.
  // Row 2: a dedicated toolbar section holding all nav + auth action buttons.
  return `<div class="top-bar">
    <a class="logo logo-link" href="index.html" title="Back to all dashboards"><img src="gsoc-logo.svg" alt="GSOC"><span>WWOS-GSOC PHD Dashboard</span>${LIVE_QUARTER?`<span class="live-badge">${LIVE_QUARTER.label} · LIVE</span>`:''}</a>
  </div>
  <div class="toolbar">
    <div class="toolbar-nav">
      ${navBtn('dashboard','Dashboard','grid')}
      ${loggedIn?`${navBtn('groups','Groups','users')}
      ${navBtn('previous-week','Previous Week','clock-rewind')}
      ${navBtn('shift-report','Shift Report','clipboard')}`:''}
      ${(window.PHDAuth&&window.PHDAuth.atLeast&&window.PHDAuth.atLeast('admin'))?`<a class="btn sec" href="agent-analytics.html">${ic('bar-chart')} Agent Analytics</a><a class="btn sec" href="last24.html">${ic('clock')} Last 24 Hours</a>`:''}
    </div>
    <div class="toolbar-actions">
      ${authActions()}
    </div>
  </div>`;
}

// Role-aware action buttons. Publishing/upload is admin/manager+; the rest for any logged-in user; users page for owner.
function authActions(){
  const A=window.PHDAuth;const user=A?A.getUser():null;
  if(!user){
    return `<button class="btn" style="background:#4ade80" onclick="showLoginModal()">${ic('key')} Login</button>`;
  }
  const canPublish=A.atLeast('admin'); // admin & manager (same rank) & owner
  const isOwner=A.atLeast('owner');
  let html='';
  html+=`<span style="color:#879596;font-size:.82em;margin-right:4px">${user.username} <span style="color:#ff9900;text-transform:uppercase;font-size:.85em;font-weight:700">${user.role}</span></span>`;
  if(canPublish){
    // Single button: ingest CSV -> merge -> auto-publish to Atlas.
    html+=`<label class="btn" style="background:#4ade80;cursor:pointer">${ic('upload')} Upload new data<input type="file" accept=".csv" id="uploadFile" style="display:none"></label>`;
  }
  html+=`<a class="btn sec" href="my-tickets.html">${ic('ticket')} My Tickets</a>`;
  if(isOwner)html+=`<a class="btn sec" href="users.html">${ic('users-gear')} Users</a>`;
  html+=`<a class="btn sec" href="data-log.html">${ic('history')} Update data log</a>`;
  html+=`<a class="btn sec" href="tools.html">${ic('tool')} PHD Tools</a>`;
  // Profile button is the user's avatar (photo or initial circle).
  const prof=(window.PHDAuth.myProfile&&window.PHDAuth.myProfile())||user;
  html+=`<a href="profile.html" title="Profile" style="display:inline-flex;align-items:center;text-decoration:none">${window.PHDAuth.avatarHtml(prof,34)}</a>`;
  // Logout moved to the Profile page.
  return html;
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
        note.onclick=()=>{try{window.focus();}catch(e){}showHelpAlerts();try{note.close();}catch(e){}};
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
  // Poll every 45s. The badge/notifications update regardless of which view is showing.
  window._helpPollTimer=setInterval(refreshHelpAlertCount,45000);
}
function stopHelpNotificationPolling(){if(window._helpPollTimer){clearInterval(window._helpPollTimer);window._helpPollTimer=null;}}

async function showHelpAlerts(){
  closeAllPopups();
  ensureNotifyPermission(); // clicking Alerts is a user gesture — good moment to ask for notification permission
  const canReply=window.PHDAuth.atLeast('admin'); // admin/manager/owner
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const r=await window.PHDAuth.api('GET','/api/help/open');
  const list=(r.ok&&Array.isArray(r.data))?r.data:[];
  const threads=list.length?list.map(h=>{
    const replies=(h.replies||[]).map(rp=>`<div style="border-top:1px solid rgba(255,255,255,.06);padding:6px 0;font-size:.85em"><b style="color:#d5dbdb">${esc(rp.by)}</b> <span style="color:#5f6b6c">(${esc(rp.role)})</span><div style="color:#d5dbdb;white-space:pre-wrap;margin-top:2px">${esc(rp.text)}</div></div>`).join('')||'<div style="color:#5f6b6c;font-size:.82em;font-style:italic;padding:4px 0">No reply yet</div>';
    return `<div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:14px 16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div><b style="color:#44b9d6">${esc(h.requester)}</b> asked on <a href="${esc(h.ticketUrl)}" target="_blank" rel="noopener" style="color:#44b9d6">${esc(h.shortId)}</a></div>
        <div style="color:#5f6b6c;font-size:.78em">${new Date(h.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <div style="color:#fff;font-size:.9em;white-space:pre-wrap;margin-bottom:6px">Q: ${esc(h.doubt)}</div>
      <div>${replies}</div>
      ${canReply?`<div style="margin-top:10px;display:flex;gap:8px;align-items:flex-start">
        <textarea id="reply-${h.id}" placeholder="Reply / suggestion…" style="flex:1;min-height:52px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.85em;padding:8px 10px;font-family:inherit;resize:vertical"></textarea>
        <button class="btn mini" onclick="submitHelpReply('${h.id}')">Reply</button>
      </div>`:''}
    </div>`;
  }).join(''):'<div style="text-align:center;color:#879596;padding:30px">No open help requests right now. 🎉</div>';
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:680px;width:100%;max-height:85vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:#fbbf24;font-size:1.2em">Help Requests (${list.length})</h2>
      <button class="btn danger" onclick="closeAllPopups()">Close</button>
    </div>
    ${canReply?'':'<p style="color:#879596;font-size:.82em;margin-bottom:12px">Admins and the owner can reply to these requests.</p>'}
    ${threads}
  </div>`;
  document.body.appendChild(overlay);
}

async function submitHelpReply(id){
  const el=document.getElementById('reply-'+id);
  const text=(el&&el.value||'').trim();
  if(!text){showToast('Enter a reply first.');return;}
  const r=await window.PHDAuth.api('POST','/api/help/'+id+'/reply',{text});
  if(r.ok){showToast('Reply sent');showHelpAlerts();}
  else{showToast((r.data&&r.data.error)||('Failed (HTTP '+r.status+')'));}
}

function attachNewFileHandler(){
  // Single "Upload new data" flow: merge the CSV into the current dataset, then auto-publish to Atlas.
  const uf=document.getElementById('uploadFile');
  if(uf)uf.onchange=(e)=>{
    if(PUBLISHING){showToast('Upload in progress — please wait.');e.target.value='';return;}
    const file=e.target.files[0];e.target.value='';
    if(file)handleUpload(file,'merge',/*autoPublish*/true);
  };
}

function makeChart(id,config){
  const ctx=document.getElementById(id);
  if(ctx){const c=new Chart(ctx,config);charts.push(c);}
}

function closeAllPopups(){const p=document.getElementById('colorPopup');if(p)p.remove();const p2=document.getElementById('incPopup');if(p2)p2.remove();}

// Ticket-level detail is restricted to logged-in users.
function requireLoginForTickets(){
  const user=window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser();
  if(user)return true;
  showTicketAccessPrompt();
  return false;
}
function showTicketAccessPrompt(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='colorPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:440px;width:100%;padding:28px;text-align:center">
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
  const colorNames={green:'GREEN (0-96 hrs)',yellow:'YELLOW (96-168 hrs)',red:'RED (168-240 hrs)',black:'BLACK (>240 hrs)',purple:'PURPLE (Reopened)'};
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  const tix=M.colorTickets[color];
  // Group by agent
  const byAgent={};tix.forEach(r=>{const a=r.AssigneeIdentity||'Unassigned';if(!byAgent[a])byAgent[a]=[];byAgent[a].push(r);});
  const agentList=Object.entries(byAgent).sort((a,b)=>b[1].length-a[1].length);
  // Split into registered (accounts in our DB) vs non-registered (unknown logins / LM-CAP / AutoSIM / Unassigned).
  const registered=agentList.filter(([name])=>isRegisteredUser(name));
  const nonRegistered=agentList.filter(([name])=>!isRegisteredUser(name));
  const rowFor=([name,tickets])=>{const dn=displayName(name);const style=isLMCAP(name)?'color:#f97316;font-style:italic':'color:#44b9d6';const pic=window.PHDAuth&&window.PHDAuth.avatarHtml?window.PHDAuth.avatarHtml(profileFor(name),30):'';return`<tr style="cursor:pointer" onclick="showAgentDrilldown('${color}','${name.replace(/'/g,"\\'")}')"><td style="width:44px">${pic}</td><td><strong style="${style}">${dn}</strong>${isLMCAP(name)?'<span style="margin-left:8px;padding:2px 6px;background:rgba(249,115,22,.15);color:#f97316;border-radius:3px;font-size:.7em">DEFAULT</span>':''}</td><td style="color:${colorHex[color]};font-weight:700;font-size:1.1em">${tickets.length}</td></tr>`;};
  const sumTix=(list)=>list.reduce((s,[,t])=>s+t.length,0);
  const sectionTable=(list)=>`<table><thead><tr><th></th><th>Agent</th><th>Tickets</th></tr></thead><tbody>${list.map(rowFor).join('')}</tbody></table>`;
  const overlay=document.createElement('div');
  overlay.id='colorPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  const regSection=`<div style="margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="color:#4ade80;font-weight:700;font-size:.95em">${ic('check-circle',15)} Registered users</span><span style="color:#5f6b6c;font-size:.8em">${registered.length} agent${registered.length===1?'':'s'} · ${sumTix(registered)} tickets</span></div>
      ${registered.length?sectionTable(registered):'<p style="color:#5f6b6c;font-size:.85em;font-style:italic;margin:4px 0 0">None.</p>'}
    </div>`;
  const nonRegSection=`<div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="color:#ff9900;font-weight:700;font-size:.95em">${ic('alert',15)} Non-registered logins</span><span style="color:#5f6b6c;font-size:.8em">${nonRegistered.length} agent${nonRegistered.length===1?'':'s'} · ${sumTix(nonRegistered)} tickets</span></div>
      <p style="color:#879596;font-size:.78em;margin:0 0 8px">These assignees are not accounts in our database (unknown login, default queue, or unassigned).</p>
      ${nonRegistered.length?sectionTable(nonRegistered):'<p style="color:#5f6b6c;font-size:.85em;font-style:italic;margin:4px 0 0">None.</p>'}
    </div>`;
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:900px;width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:${colorHex[color]};font-size:1.2em">${colorNames[color]} — ${tix.length} tickets</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="downloadColorCSV('${color}')">Download All CSV</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <p style="color:#879596;font-size:.85em;margin-bottom:16px">Click an agent to view their tickets</p>
    ${regSection}
    ${nonRegSection}</div>`;
  document.body.appendChild(overlay);
}

function showAgentDrilldown(color,agentName){
  if(!requireLoginForTickets())return;
  closeAllPopups();
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  const tix=M.colorTickets[color].filter(r=>(r.AssigneeIdentity||'Unassigned')===agentName);
  // Sort by CreateDate ascending (oldest first, newest at the bottom)
  tix.sort((a,b)=>new Date(a.CreateDate)-new Date(b.CreateDate));
  const now=new Date();const dn=displayName(agentName);
  // Latest-comment column is shown only for red / black / purple sections.
  const showComments=(color==='red'||color==='black'||color==='purple');
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows=tix.map(r=>{
    const cd=new Date(r.CreateDate);
    const daysAgo=Math.floor((now-cd)/(864e5));
    const daysText=daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;
    const sid=r.ShortId||'';
    const commentCell=showComments?`<td class="cmt-col" data-sid="${esc(sid)}" style="color:#879596;font-style:italic">Loading…</td>`:'';
    return`<tr><td><a href="https://t.corp.amazon.com/issues/${esc(sid)}" target="_blank" style="color:#44b9d6">${esc(sid)}</a></td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${esc(r.Status)}</td>${commentCell}</tr>`;
  }).join('');
  const overlay=document.createElement('div');
  overlay.id='colorPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  const head=`<tr><th>Ticket ID</th><th>Created</th><th>Status</th>${showComments?'<th>Latest comment</th>':''}</tr>`;
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:${showComments?'1100px':'1000px'};width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:${colorHex[color]};font-size:1.1em">${dn} — ${tix.length} tickets</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="showColorPopup('${color}')">← Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
  // Fetch latest comments for the shown tickets (red/black/purple only) and fill the column.
  if(showComments){fillLatestComments(overlay,tix.map(r=>r.ShortId).filter(Boolean));}
}

// Batch-fetch the latest comment per ticket and populate the "Latest comment" cells.
async function fillLatestComments(overlay,shortIds){
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const setAll=(text,color,italic)=>{overlay.querySelectorAll('.cmt-col').forEach(td=>{td.innerHTML=text;td.style.color=color||'#879596';td.style.fontStyle=italic?'italic':'normal';});};
  if(!window.PHDAuth||!window.PHDAuth.getUser||!window.PHDAuth.getUser()){setAll('Login to view comments','#879596',true);return;}
  try{
    const r=await window.PHDAuth.api('POST','/api/comments/latest',{shortIds});
    const map=(r.ok&&r.data)?r.data:{};
    overlay.querySelectorAll('.cmt-col').forEach(td=>{
      const sid=td.getAttribute('data-sid');
      const c=map[sid];
      if(c&&c.text){
        const when=c.at?new Date(c.at).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
        td.style.color='#d5dbdb';td.style.fontStyle='normal';
        td.innerHTML=`<div style="max-width:360px">${esc(c.text)}</div><div style="color:#5f6b6c;font-size:.72em;margin-top:3px">— ${esc(c.user)}${when?(' · '+when):''}</div>`;
      }else{
        td.style.color='#5f6b6c';td.style.fontStyle='italic';
        td.textContent='No comment made by user';
      }
    });
  }catch(e){setAll('Could not load comments','#ff5252',true);}
}
function downloadColorCSV(color){
  const tickets=M.colorTickets[color];
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:900px;width:100%;max-height:80vh;overflow:auto;padding:24px">
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:1000px;width:100%;max-height:80vh;overflow:auto;padding:24px">
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:1000px;width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2 style="color:#ffb84d;font-size:1.1em">Unresolved Repeat Incidents (HI>0) — ${tix.length} tickets</h2><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    <table><thead><tr><th>Ticket ID</th><th>HI Cnt</th><th>Assignee</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

function renderShiftReport(){
  const m=M;const ct=m.colorTickets;
  const today=new Date();
  const dateStr=today.toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric'});
  const black=ct.black.length;const red=ct.red.length;
  const inQueue=m.inQ;
  // open statuses (exclude Closed)
  const openStatuses=[['Assigned',m.asgn],['Work In Progress',m.wip],['Researching',m.researching],['Pending',m.pend],['Resolved',m.res]];
  const openTotal=m.T-m.closed;
  // Per-agent color breakdown for the takeover chart
  const agentColors={};
  const addToAgent=(list,color)=>{list.forEach(r=>{const a=displayName(r.AssigneeIdentity||'Unassigned');if(!agentColors[a])agentColors[a]={purple:0,black:0,red:0,yellow:0,green:0,total:0};agentColors[a][color]++;agentColors[a].total++;});};
  addToAgent(ct.purple,'purple');addToAgent(ct.black,'black');addToAgent(ct.red,'red');addToAgent(ct.yellow,'yellow');addToAgent(ct.green,'green');
  const agentSorted=Object.entries(agentColors).sort((a,b)=>b[1].total-a[1].total);
  window._takeoverAgents=agentSorted;
  document.getElementById('app').innerHTML=topBar('shift-report')+`<div class="content">
  <div class="page-title"><h1>Shift Takeover Report</h1></div>
  <div class="section">
    <div style="color:var(--t);font-size:.95em;line-height:1.7">
      Hello Team,<br>
      Our queue currently stands at <strong style="color:var(--o)">${inQueue}</strong> unresolved tickets, with statuses:<br>
      <span style="display:inline-block;margin-left:16px">• PURPLE (Reopened): <strong>${ct.purple.length}</strong></span><br>
      <span style="display:inline-block;margin-left:16px">• BLACK (&gt;240 hrs / &gt;10 days): <strong>${black}</strong></span><br>
      <span style="display:inline-block;margin-left:16px">• RED (168-240 hrs / 7-10 days): <strong>${red}</strong></span><br>
      <span style="display:inline-block;margin-left:16px">• YELLOW (96-168 hrs / 4-7 days): <strong>${ct.yellow.length}</strong></span><br>
      <span style="display:inline-block;margin-left:16px">• GREEN (0-96 hrs / 0-4 days): <strong>${ct.green.length}</strong></span><br>
      Please prioritize the above.
    </div>
    <div class="chart-box" style="margin-top:20px;background:linear-gradient(160deg,#0f0f0f,#000);box-shadow:0 8px 32px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.04);border:1px solid #333"><h3 style="letter-spacing:.5px">Unresolved Tickets by Agent (Age Breakdown)</h3><div class="chart-wrap" style="height:380px"><canvas id="takeoverChart"></canvas></div></div>
    <button class="btn" style="margin-top:18px" onclick="exportTakeover()">Export Takeover Report</button>
  </div>

  <div class="page-title" style="margin-top:12px"><h1>Shift Handoff Report</h1></div>
  <div class="section" id="shiftContent">
    <div id="shiftHeader" style="margin-bottom:20px">
      <p style="color:var(--t);font-size:.95em;line-height:1.9">
        <strong>Date/Time:</strong> <span id="shiftDate">${dateStr}</span> 19:00 <span id="shiftTz">IST</span><br>
        <strong>Timeframe Collected:</strong> 7:00 AM <span class="shiftTz2">IST</span> - 7:00 PM <span class="shiftTz2">IST</span><br>
        <strong>Handoff:</strong> <span id="shiftHandoff">IND → AMER</span>
      </p>
    </div>
    <div class="handoff-grid">
      <div class="handoff-box"><h3>Ticket Health Status</h3><ul>
        <li><span>&gt;10 Days Not Closed (BLACK)</span><span class="val">${black}</span></li>
        <li><span>Pending &gt;72 Hours (RED)</span><span class="val">${red}</span></li>
        <li><span>Created in Last 12 Hours</span><span class="val">${m.last12Created}</span></li>
        <li><span>Created in Last 24 Hours</span><span class="val">${m.last24Created}</span></li>
      </ul></div>
      <div class="handoff-box"><h3>Last 12 Hours Activity</h3><ul>
        <li><span>Assigned</span><span class="val">${m.asgn}</span></li>
        <li><span>Pending</span><span class="val">${m.pend}</span></li>
        <li><span>WIP</span><span class="val">${m.wip}</span></li>
        <li><span>Resolved</span><span class="val">${m.last12Resolved}</span></li>
      </ul></div>
      <div class="handoff-box"><h3>Ticket Count by Status</h3><ul>
        <li><span>Assigned</span><span class="val">${m.asgn}</span></li>
        <li><span>Work In Progress</span><span class="val">${m.wip}</span></li>
        <li><span>Researching</span><span class="val">${m.researching}</span></li>
        <li><span>Pending</span><span class="val">${m.pend}</span></li>
        <li><span>Resolved</span><span class="val">${m.res}</span></li>
      </ul></div>
      <div class="handoff-box"><h3>Status Distribution (%)</h3><ul>
        <li><span>Assigned</span><span class="val">${(m.asgn/openTotal*100||0).toFixed(1)}%</span></li>
        <li><span>Work In Progress</span><span class="val">${(m.wip/openTotal*100||0).toFixed(1)}%</span></li>
        <li><span>Researching</span><span class="val">${(m.researching/openTotal*100||0).toFixed(1)}%</span></li>
        <li><span>Pending</span><span class="val">${(m.pend/openTotal*100||0).toFixed(1)}%</span></li>
        <li><span>Resolved</span><span class="val">${(m.res/openTotal*100||0).toFixed(1)}%</span></li>
      </ul></div>
    </div>
    <div style="margin-top:20px;padding:16px;background:#0a0a0a;border:1px solid var(--bd);border-radius:8px">
      <strong style="color:var(--o)">Current Amount of Tickets In Queue:</strong> <span style="color:#fff;font-size:1.1em;font-weight:700">${inQueue}</span>
    </div>
    <div style="margin-top:20px">
      <h3 style="color:var(--o);font-size:.9em;text-transform:uppercase;margin-bottom:8px">Notes</h3>
      <textarea id="shiftNotes" placeholder="Add your notes here..." style="width:100%;min-height:100px;padding:12px;background:#0a0a0a;border:1px solid var(--bd);border-radius:8px;color:#fff;font-family:inherit;font-size:.9em;resize:vertical"></textarea>
    </div>
  </div>
  <div style="margin-bottom:40px">
    <button class="btn" onclick="showExportRegionModal()">Export Handoff Report</button>
  </div>
  </div>`;
  attachNewFileHandler();
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

function showExportRegionModal(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:420px;width:100%;padding:28px">
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
  const m=M;const ct=m.colorTickets;
  const tz=region==='IN'?'IST':'MST';
  const handoff=region==='IN'?'IND → AMER':'AMER → IND';
  document.getElementById('shiftTz').textContent=tz;
  document.querySelectorAll('.shiftTz2').forEach(el=>el.textContent=tz);
  document.getElementById('shiftHandoff').textContent=handoff;
  const today=new Date().toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric'});
  const openTotal=m.T-m.closed;
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
  const m=M;const ct=m.colorTickets;
  const linesHtml=`Hello Team,<br>
Our queue currently stands at <b>${m.inQ}</b> unresolved tickets, with statuses:<br>
&nbsp;&nbsp;&nbsp;&nbsp;PURPLE (Reopened): <b>${ct.purple.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;BLACK (&gt;240 hrs / &gt;10 days): <b>${ct.black.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;RED (168-240 hrs / 7-10 days): <b>${ct.red.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;YELLOW (96-168 hrs / 4-7 days): <b>${ct.yellow.length}</b><br>
&nbsp;&nbsp;&nbsp;&nbsp;GREEN (0-96 hrs / 0-4 days): <b>${ct.green.length}</b><br>
Please prioritize the above.`;
  const txt=`Hello Team,\nOur queue currently stands at ${m.inQ} unresolved tickets, with statuses:\n    PURPLE (Reopened): ${ct.purple.length}\n    BLACK (>240 hrs / >10 days): ${ct.black.length}\n    RED (168-240 hrs / 7-10 days): ${ct.red.length}\n    YELLOW (96-168 hrs / 4-7 days): ${ct.yellow.length}\n    GREEN (0-96 hrs / 0-4 days): ${ct.green.length}\nPlease prioritize the above.`;
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
  const colorNames={green:'GREEN (0-96 hrs / 0-4 days)',yellow:'YELLOW (96-168 hrs / 4-7 days)',red:'RED (168-240 hrs / 7-10 days)',black:'BLACK (>240 hrs / >10 days)',purple:'PURPLE (Reopened)'};
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  // Filter tickets in that color that belong to this agent, sorted oldest -> newest
  const tix=(M.colorTickets[colorKey]||[]).filter(r=>displayName(r.AssigneeIdentity||'Unassigned')===agentName)
    .sort((a,b)=>new Date(a.CreateDate)-new Date(b.CreateDate));
  const now=new Date();
  const rows=tix.map(r=>{const cd=new Date(r.CreateDate);const daysAgo=Math.floor((now-cd)/(864e5));const daysText=isNaN(daysAgo)?'':daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.ShortId}" target="_blank" style="color:#44b9d6">${r.ShortId}</a></td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${r.Status}</td></tr>`;}).join('');
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:1000px;width:100%;max-height:80vh;overflow:auto;padding:24px">
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:1000px;width:100%;max-height:80vh;overflow:auto;padding:24px">
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:900px;width:100%;max-height:80vh;overflow:auto;padding:24px">
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:900px;width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:#ff9900;font-size:1.1em">${agentName} — ${tickets.length} tickets (${rootCause})</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="showHIPopup('${rootCause.replace(/'/g,"\\'")}')">← Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <table><thead><tr><th>Ticket ID</th><th>Cnt</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

function renderDashboard(){
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
  <div class="page-title" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <h1 style="margin:0">${LIVE_QUARTER?LIVE_QUARTER.label+' — Live Dashboard':'Live Dashboard'}</h1>
    ${loggedIn?`<button class="btn sec" id="alertBtn" onclick="showHelpAlerts()" style="position:relative">${ic('alert',15)} Alerts<span id="alertBadge" style="display:none;position:absolute;top:-8px;right:-8px;background:#ff5252;color:#fff;border-radius:20px;min-width:18px;height:18px;font-size:.7em;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px">0</span></button>`:''}
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

  <div class="section"><h2>Ticket Age Classification</h2>
    <p class="meta-info">Click any color segment to view tickets. Download individual segments as CSV.</p>
    <div class="kpi-grid">
      <div class="kpi-card" style="border-top-color:#4ade80;cursor:pointer" onclick="showColorPopup('green',M.colorTickets.green)"><div class="value" style="color:#4ade80">${ct.green.length}</div><div class="label">${ic('check-circle',14)} GREEN (0-96 hrs / 0-4 days)</div></div>
      <div class="kpi-card" style="border-top-color:#fbbf24;cursor:pointer" onclick="showColorPopup('yellow',M.colorTickets.yellow)"><div class="value" style="color:#fbbf24">${ct.yellow.length}</div><div class="label">${ic('clock',14)} YELLOW (96-168 hrs / 4-7 days)</div></div>
      <div class="kpi-card" style="border-top-color:#ff5252;cursor:pointer" onclick="showColorPopup('red',M.colorTickets.red)"><div class="value" style="color:#ff5252">${ct.red.length}</div><div class="label">${ic('alert',14)} RED (168-240 hrs / 7-10 days)</div></div>
      <div class="kpi-card${blackBlink?' blink-alert':''}" style="border-top-color:#888;cursor:pointer" onclick="showColorPopup('black',M.colorTickets.black)"><div class="value" style="color:#888">${ct.black.length}</div><div class="label">${ic('flame',14)} BLACK (&gt;240 hrs / &gt;10 days)</div></div>
      <div class="kpi-card${purpleBlink?' blink-alert':''}" style="border-top-color:#a78bfa;cursor:pointer" onclick="showColorPopup('purple',M.colorTickets.purple)"><div class="value" style="color:#a78bfa">${ct.purple.length}</div><div class="label">${ic('reopen',14)} PURPLE (Reopened)${purpleBlink?' <span title="A purple ticket is assigned outside the allowed reviewers" style="color:#ff5252">⚠</span>':''}</div></div>
    </div></div>

  <div class="section"><h2>Queue Status</h2>
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
    </div></div>

  <div class="charts-grid" style="grid-template-columns:repeat(2,1fr)">
    <div class="chart-box"><h3>Daily Tickets Created (Last 7 Days)</h3><div class="chart-wrap"><canvas id="c2a"></canvas></div></div>
    <div class="chart-box"><h3>Daily Tickets Resolved (Last 7 Days)</h3><div class="chart-wrap"><canvas id="c2b"></canvas></div></div>
  </div>
  <div class="charts-grid" style="grid-template-columns:repeat(2,1fr)">
    <div class="chart-box"><h3>Weekly Volume: Created</h3><div class="chart-wrap"><canvas id="c4a"></canvas></div></div>
    <div class="chart-box"><h3>Weekly Volume: Resolved</h3><div class="chart-wrap"><canvas id="c4b"></canvas></div></div>
  </div>
  ${(m.slaByWeek&&m.slaByWeek.length)?`<div class="section"><h2>SLA Compliance per Week (&le;240 hrs)</h2>
    <p class="meta-info" style="margin:-8px 0 16px">Percentage of each week's resolved tickets that met the 240-hour (10-day) SLA, for ${LIVE_QUARTER?LIVE_QUARTER.label:'this quarter'}. Weeks are bucketed by resolved date and drawn as each week passes.</p>
    <div class="chart-box"><div class="chart-wrap tall"><canvas id="cSlaWave"></canvas></div></div>
  </div>`:''}
  <div class="section"><h2>Incident Types</h2><p class="meta-info">Click any incident type to view agent breakdown</p>
    <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Incident Type</th><th>Count</th><th>% of Total</th><th>Volume</th></tr></thead><tbody>
    ${m.iL.map((type,i)=>{const count=m.iD[i];const pct=(count/m.T*100).toFixed(1);const barW=(count/m.iD[0]*100).toFixed(0);return`<tr style="cursor:pointer" onclick="showIncidentPopup('${type.replace(/'/g,"\\'")}')"><td style="color:#ff9900;font-weight:700">${i+1}</td><td><strong>${type}</strong></td><td>${count}</td><td>${pct}%</td><td><div style="display:flex;align-items:center"><div style="height:8px;border-radius:4px;background:#ff9900;width:${barW}%;min-width:4px"></div></div></td></tr>`;}).join('')}
    </tbody></table></div></div>
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
    return `<div class="section"><h2>Historical Incidents (Cnt > 0)</h2>
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
    </div>`;
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

function renderGroups(){
  const m=M;const sorted=[...m.agents.filter(a=>a.group==='A1').sort((a,b)=>b.resolved-a.resolved),...m.agents.filter(a=>a.group==='A2').sort((a,b)=>b.resolved-a.resolved),...m.agents.filter(a=>a.group==='B').sort((a,b)=>b.resolved-a.resolved)];
  const gc={A1:'#7dd3fc',A2:'#fbbf24',B:'#4ade80'};const tc={A1:'tag-a1',A2:'tag-a2',B:'tag-b'};
  document.getElementById('app').innerHTML=topBar('groups')+`<div class="content">
  <div class="section" style="display:flex;gap:24px;flex-wrap:wrap">
    <span style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:3px;background:#7dd3fc;display:inline-block"></span> A1: harisss, punithsd, arunkzn, flofalgu</span>
    <span style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:3px;background:#fbbf24;display:inline-block"></span> A2: tanviroo, urmahala, chousoud, obalasut, shaavhad, dbiswamb</span>
    <span style="display:flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:3px;background:#4ade80;display:inline-block"></span> B: mbozied, nobregak, mellanej</span>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card" style="border-top-color:#7dd3fc"><div class="value" style="color:#7dd3fc">${m.a1R}</div><div class="label">A1 Resolved</div></div>
    <div class="kpi-card" style="border-top-color:#7dd3fc"><div class="value" style="color:#7dd3fc">${m.a1O}</div><div class="label">A1 Open</div></div>
    <div class="kpi-card" style="border-top-color:#fbbf24"><div class="value" style="color:#fbbf24">${m.a2R}</div><div class="label">A2 Resolved</div></div>
    <div class="kpi-card" style="border-top-color:#fbbf24"><div class="value" style="color:#fbbf24">${m.a2O}</div><div class="label">A2 Open</div></div>
    <div class="kpi-card" style="border-top-color:#4ade80"><div class="value" style="color:#4ade80">${m.bR}</div><div class="label">B Resolved</div></div>
    <div class="kpi-card" style="border-top-color:#4ade80"><div class="value" style="color:#4ade80">${m.bO}</div><div class="label">B Open</div></div>
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
    ${sorted.map(a=>`<tr><td><strong style="color:#44b9d6;cursor:pointer" onclick="showAgentTicketsPopup('${a.name}')">${a.name}</strong></td><td><span class="tag ${tc[a.group]}">${a.group}</span></td><td>${a.statuses?a.statuses['Assigned']:0}</td><td>${a.statuses?a.statuses['Work In Progress']:0}</td><td>${a.statuses?a.statuses['Researching']:0}</td><td>${a.statuses?a.statuses['Pending']:0}</td><td><span class="badge badge-g">${a.statuses?a.statuses['Resolved']:0}</span></td><td>${a.statuses?a.statuses['Closed']:0}</td><td>${a.avgTime.toFixed(1)}</td><td>${a.resolved+a.open>0?((a.resolved/(a.resolved+a.open))*100).toFixed(1):0}%</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="section"><h2>Group Totals Summary</h2><table><thead><tr><th>Group</th><th>Members</th><th>Assigned</th><th>Resolved</th><th>Open</th><th>Avg Hrs</th><th>Res/Member</th><th>Rate</th></tr></thead><tbody>
    <tr><td><span class="tag tag-a1">A1</span></td><td>4</td><td>${m.a1As}</td><td>${m.a1R}</td><td>${m.a1O}</td><td>${m.a1Avg.toFixed(1)}</td><td>${(m.a1R/4).toFixed(1)}</td><td>${m.a1R+m.a1O>0?((m.a1R/(m.a1R+m.a1O))*100).toFixed(1):0}%</td></tr>
    <tr><td><span class="tag tag-a2">A2</span></td><td>6</td><td>${m.a2As}</td><td>${m.a2R}</td><td>${m.a2O}</td><td>${m.a2Avg.toFixed(1)}</td><td>${(m.a2R/6).toFixed(1)}</td><td>${m.a2R+m.a2O>0?((m.a2R/(m.a2R+m.a2O))*100).toFixed(1):0}%</td></tr>
    <tr><td><span class="tag tag-b">B</span></td><td>3</td><td>${m.bAs}</td><td>${m.bR}</td><td>${m.bO}</td><td>${m.bAvg.toFixed(1)}</td><td>${(m.bR/3).toFixed(1)}</td><td>${m.bR+m.bO>0?((m.bR/(m.bR+m.bO))*100).toFixed(1):0}%</td></tr>
  </tbody></table></div></div>`;
  attachNewFileHandler();Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('g1',{type:'bar',data:{labels:['A1','A2','B'],datasets:[{label:'Resolved',data:[m.a1R,m.a2R,m.bR],backgroundColor:['rgba(125,211,252,.8)','rgba(251,191,36,.8)','rgba(74,222,128,.8)'],borderRadius:3},{label:'Open',data:[m.a1O,m.a2O,m.bO],backgroundColor:['rgba(125,211,252,.3)','rgba(251,191,36,.3)','rgba(74,222,128,.3)'],borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{display:false}}}}});
  makeChart('g2',{type:'bar',data:{labels:['A1','A2','B'],datasets:[{data:[m.a1Avg,m.a2Avg,m.bAvg],backgroundColor:['rgba(125,211,252,.8)','rgba(251,191,36,.8)','rgba(74,222,128,.8)'],borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{display:false}}}}});
  makeChart('g3',{type:'pie',data:{labels:[`A1(${m.a1As})`,`A2(${m.a2As})`,`B(${m.bAs})`],datasets:[{data:[m.a1As,m.a2As,m.bAs],backgroundColor:['rgba(125,211,252,.85)','rgba(251,191,36,.85)','rgba(74,222,128,.85)'],borderColor:'#000',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#d5dbdb'}}}}});
  makeChart('g4',{type:'line',data:{labels:m.dL,datasets:[{label:'A1',data:m.dgA1,borderColor:'#7dd3fc',backgroundColor:'rgba(125,211,252,.08)',fill:true,tension:.4,pointRadius:4},{label:'A2',data:m.dgA2,borderColor:'#fbbf24',backgroundColor:'rgba(251,191,36,.08)',fill:true,tension:.4,pointRadius:4},{label:'B',data:m.dgB,borderColor:'#4ade80',backgroundColor:'rgba(74,222,128,.08)',fill:true,tension:.4,pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{color:'rgba(255,255,255,.04)'}}}}});
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
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:420px;width:100%;padding:28px">
    <h2 style="color:#4ade80;font-size:1.2em;margin-bottom:8px">Log in</h2>
    <p style="color:#879596;font-size:.85em;margin-bottom:18px;line-height:1.5">Viewing the dashboard needs no login. Log in to publish or manage data.</p>
    <label style="display:block;color:#879596;font-size:.85em;margin-bottom:6px">Username</label>
    <input type="text" id="loginUser" autocomplete="username" style="width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.9em">
    <label style="display:block;color:#879596;font-size:.85em;margin:12px 0 6px">Password</label>
    <input type="password" id="loginPass" autocomplete="current-password" style="width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.9em">
    <label style="display:flex;align-items:center;gap:8px;color:#879596;font-size:.82em;margin-top:12px;cursor:pointer"><input type="checkbox" id="loginRemember"> Keep me logged in on this device</label>
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
    showToast('Logged in as '+r.data.user.username+' ('+r.data.user.role+')');
    // Refresh the role roster + my profile (avatar), then re-render so role-gated UI updates.
    await loadUserRoles();
    if(window.PHDAuth.loadMyProfile)await window.PHDAuth.loadMyProfile();
    startHelpNotificationPolling(); // begin desktop notifications for admins/owner
    nav(currentView);
  }catch(e){
    errEl.textContent=e.message;errEl.style.display='block';
    if(btn){btn.disabled=false;btn.textContent='Log in';}
  }
}

// ========= PUBLISH (to MongoDB Atlas via API) =========
function showPublishModal(){
  if(!window.PHDAuth.atLeast('admin')){showToast('You need admin privileges to publish.');return;}
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:520px;width:100%;padding:28px">
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

// Current live quarter info (set on init from the API). e.g. {quarter:'2026-Q3',label:'Q3 2026',range:{...}}
let LIVE_QUARTER=null;

// Carries the merge report across a cross-quarter confirm retry so the audit log keeps it.
let PENDING_CHANGE_SUMMARY=null;

// Publish the current dataset to the live quarter. Handles the cross-quarter warning.
// mode: undefined/false = first attempt (may trigger the 409 warning),
//       'drop'    = update the live quarter only (ignore non-live tickets),
//       'confirm' = review complete: include & overwrite non-live quarters.
// changeSummary (optional) is the merge report; saved to the audit log server-side.
async function doPublish(mode,changeSummary){
  if(!window.PHDAuth.atLeast('admin')){showToast('You need admin privileges to publish.');return;}
  if(changeSummary!==undefined)PENDING_CHANGE_SUMMARY=changeSummary; // remember across warning retry
  PUBLISHING=true;                 // lock uploads/merges
  showPublishSpinner();
  try{
    const allRows=await dbGetAll();
    const payload={updatedAt:new Date().toISOString(),count:allRows.length,tickets:allRows};
    const body={data:payload};
    if(mode==='confirm')body.confirmCrossQuarter=true;
    if(mode==='drop')body.dropCrossQuarter=true;
    if(PENDING_CHANGE_SUMMARY)body.changeSummary=PENDING_CHANGE_SUMMARY;
    const r=await window.PHDAuth.api('POST','/api/live-quarter',body);
    // Cross-quarter warning: server refuses on the first attempt until the user chooses.
    if(r.status===409&&r.data&&r.data.error==='cross-quarter'){
      PUBLISHING=false;
      closeAllPopups();
      showCrossQuarterWarning(r.data);
      return;
    }
    if(!r.ok){throw new Error((r.data&&r.data.error)||('Publish failed (HTTP '+r.status+')'));}
    PUBLISHING=false;
    closeAllPopups();
    // Invalidate the local cache version. The server stamps its own publishedAt; clearing this
    // makes the next visit do one clean refetch that re-syncs the cache to the server's value.
    try{await metaSet('liveCache',null);}catch(_){}
    const summary=PENDING_CHANGE_SUMMARY;
    PENDING_CHANGE_SUMMARY=null;
    const reviewed=!!(r.data&&r.data.crossQuarterReviewed);
    const skipped=(r.data&&r.data.skippedCrossQuarter)||[];
    showToast('Data published to '+(LIVE_QUARTER?LIVE_QUARTER.label:'the live quarter')+'! Live for everyone now.');
    if(summary)showMergeReport(summary,{reviewed,skipped}); // change-summary popup after a successful upload+publish
  }catch(e){
    PUBLISHING=false;
    closeAllPopups();
    setTimeout(()=>showToast('Publish failed: '+e.message),60);
  }
}

// Two-section warning when the upload contains tickets created in a non-live quarter.
// Section 1: update the LIVE quarter as-is (Update / Cancel) — skips non-live tickets.
// Section 2: review the actual non-live tickets, then Skip-for-now / Review complete & confirm.
function showCrossQuarterWarning(info){
  closeAllPopups();
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Flatten all non-live tickets across quarters for the review list.
  const allCross=[];
  (info.crossQuarter||[]).forEach(c=>{(c.tickets||[]).forEach(t=>allCross.push({...t,label:c.label}));});
  // sort oldest first by createDate
  allCross.sort((a,b)=>new Date(a.createDate)-new Date(b.createDate));
  const quarterRows=(info.crossQuarter||[]).map(c=>`<div style="display:flex;justify-content:space-between;padding:6px 0;color:#fbbf24;font-size:.88em"><span>${esc(c.label)}</span><span>${c.count} ticket(s)</span></div>`).join('');
  const ticketRows=allCross.map((t,i)=>`<tr>
      <td style="color:#879596">${i+1}</td>
      <td>${t.url?`<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:#44b9d6;text-decoration:none">${esc(t.id)}</a>`:esc(t.id)}</td>
      <td style="color:#fbbf24">${esc(t.label)}</td>
      <td style="color:#879596">${esc((t.createDate||'').split('T')[0])}</td>
      <td>${esc(t.status)}</td>
      <td style="color:#879596">${esc(t.assignee||'—')}</td>
    </tr>`).join('');

  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:760px;width:100%;max-height:88vh;overflow:auto;padding:26px">
    <h2 style="color:#fbbf24;font-size:1.2em;margin-bottom:6px">⚠ Data outside the live quarter</h2>
    <p style="color:#879596;font-size:.88em;margin-bottom:18px;line-height:1.6">This upload contains tickets created in a <b>non-live quarter</b>. The live quarter is <b style="color:#4ade80">${esc(info.liveLabel)}</b>.</p>

    <!-- Section 1: update the live quarter as-is -->
    <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:16px 18px;margin-bottom:16px">
      <h3 style="color:#fff;font-size:.98em;margin-bottom:8px">1 · Update the live quarter only</h3>
      <p style="color:#879596;font-size:.84em;line-height:1.6;margin-bottom:6px">Publish the <b style="color:#4ade80">${esc(info.liveLabel)}</b> tickets (<b>${info.liveCount}</b>) and <b>ignore</b> the non-live tickets below. Finalized quarters stay untouched.</p>
      <div style="margin-top:6px">${quarterRows}</div>
      <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn sec" onclick="closeAllPopups()">Cancel</button>
        <button class="btn" style="background:#4ade80" onclick="doPublish('drop')">Update</button>
      </div>
    </div>

    <!-- Section 2: review the non-live tickets -->
    <div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:16px 18px">
      <h3 style="color:#fff;font-size:.98em;margin-bottom:8px">2 · Review the non-live tickets (${allCross.length})</h3>
      <p style="color:#879596;font-size:.84em;line-height:1.6;margin-bottom:10px">These tickets were created in a non-live quarter. Confirming will <b style="color:#fbbf24">overwrite that quarter's data</b> with them. Oldest first.</p>
      <div style="max-height:280px;overflow:auto;border:1px solid #2a2a2a;border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:.82em">
          <thead><tr style="position:sticky;top:0;background:#000">
            <th style="text-align:left;padding:8px 10px;color:#879596">#</th>
            <th style="text-align:left;padding:8px 10px;color:#879596">Ticket</th>
            <th style="text-align:left;padding:8px 10px;color:#879596">Quarter</th>
            <th style="text-align:left;padding:8px 10px;color:#879596">Created</th>
            <th style="text-align:left;padding:8px 10px;color:#879596">Status</th>
            <th style="text-align:left;padding:8px 10px;color:#879596">Assignee</th>
          </tr></thead>
          <tbody>${ticketRows}</tbody>
        </table>
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn sec" onclick="doPublish('drop')">Skip for now</button>
        <button class="btn" style="background:#fbbf24;color:#000" onclick="doPublish('confirm')">Review complete — upload &amp; confirm</button>
      </div>
    </div>
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
      window.USER_PROFILES=profiles; // lowercase username -> {username,role,displayName,avatar}
    }
  }catch(e){/* leave null -> purple only blinks on Unassigned */}
}
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
    const r=await window.PHDAuth.api('GET','/api/quarters');
    if(r.ok&&r.data){
      const liveId=r.data.liveQuarter;
      const q=(r.data.quarters||[]).find(x=>x.id===liveId);
      // Keep LIVE_QUARTER label in sync even on a cache hit.
      if(liveId)LIVE_QUARTER=Object.assign({},LIVE_QUARTER,{quarter:liveId,label:(r.data.liveLabel||liveId)});
      return {liveId,publishedAt:q?(q.publishedAt||null):null};
    }
  }catch(e){}
  return null;
}

// Render the dashboard from whatever is currently in the local tickets store.
async function renderFromLocal(uploadTimeIso){
  const allRows=await dbGetAll();
  if(!allRows.length)return false;
  M=computeMetrics(allRows);M.totalStored=allRows.length;
  M.uploadTime=uploadTimeIso?new Date(uploadTimeIso).toLocaleString('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):null;
  renderDashboard();
  return true;
}

// Fetch the full live-quarter dataset, store it, cache its version, and render.
async function refreshFromServer(showShimmer){
  if(showShimmer&&window.PHDAuth&&window.PHDAuth.skeletonDashboard){
    document.getElementById('app').innerHTML=window.PHDAuth.skeletonDashboard('Loading live dashboard data from the database…');
  }
  const shared=await loadLiveQuarter();// sets LIVE_QUARTER
  if(shared){
    await dbClear();
    await dbPutAll(shared.tickets);
    // Cache the version so future visits can skip the heavy fetch when nothing changed.
    await metaSet('liveCache',{quarter:LIVE_QUARTER?LIVE_QUARTER.quarter:null,publishedAt:shared.updatedAt||null});
    await renderFromLocal(shared.updatedAt);
    return true;
  }
  return false;
}

// ========= INIT ========= (stale-while-revalidate: instant from cache, refresh only if changed)
(async function init(){
  // Paint the shimmer IMMEDIATELY (before any awaits) so the screen is never blank while we
  // check the roster / cache / server version. A cache hit will replace it instantly.
  if(window.PHDAuth&&window.PHDAuth.skeletonDashboard){
    document.getElementById('app').innerHTML=window.PHDAuth.skeletonDashboard('Loading live dashboard…');
  }
  // Fetch the role roster + my profile (avatar) first so the header renders correctly.
  await loadUserRoles();
  if(window.PHDAuth.loadMyProfile)await window.PHDAuth.loadMyProfile();
  // Start background help-request notifications for admins/owner (no-op if not logged in / not admin).
  startHelpNotificationPolling();
  try{
    const cache=await metaGet('liveCache');           // {quarter, publishedAt} from last successful load
    const localCount=await dbCount();
    const version=await fetchLiveQuarterVersion();     // cheap server check (id + publishedAt)

    if(version){
      const fresh=cache && localCount>0 && cache.quarter===version.liveId && (cache.publishedAt||null)===(version.publishedAt||null);
      if(fresh){
        // Nothing changed since last visit -> render instantly from cache, no shimmer, no heavy fetch.
        await renderFromLocal(version.publishedAt);
        return;
      }
      // Cache is stale or empty -> if we have SOME local data, show it instantly while we refresh;
      // otherwise show the shimmer during the full fetch.
      const hadLocal = localCount>0 ? await renderFromLocal(cache?cache.publishedAt:null) : false;
      const ok=await refreshFromServer(/*showShimmer*/ !hadLocal);
      if(!ok && !hadLocal)renderUpload();
      return;
    }

    // Version check failed (offline / server unreachable): fall back to local cache if present.
    if(localCount>0){ await renderFromLocal(cache?cache.publishedAt:null); return; }
    // No cache and no server -> last resort: try a full fetch with shimmer, else upload screen.
    const ok=await refreshFromServer(true);
    if(!ok)renderUpload();
  }catch(e){
    try{ if(await renderFromLocal(null))return; }catch(_){}
    renderUpload();
  }
})();
