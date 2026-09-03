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

// ===== GitHub publish config (shared data store) =====
const GH_OWNER='harisss-wwos';
const GH_REPO='wwos-phd-dashboard';
const GH_BRANCH='main';
const GH_DATA_PATH='live-data.json';

// Global lock — true while a publish/deploy is in progress. Blocks uploads/merges.
let PUBLISHING=false;

// ===== IndexedDB storage =====
const DB_NAME='phd_dashboard_db';const STORE='tickets';
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=(e)=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'ShortId'});};req.onsuccess=(e)=>resolve(e.target.result);req.onerror=(e)=>reject(e.target.error);});}
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
        const hasDetails=details.trim()!=='';
        if(hasDetails){tp='Pet Incident (HI>0)';}
        else{tp='Pet Incident (Resolved by AUTO-SIM)';}
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
  return{T,asgn,pend,wip,res,researching,closed,inQ,autosim,colorTickets,n10,p72,nSLA,l12A,l12P,l12W,l12R,rToday,avgR,slaCompliant,slaPct,dL,dD,dC,wL,wD,wDR,gL,gD,iL,iD,incTickets:incTicketsSlim,agents,agentOpenTickets,hiCases,hiAnimal,hiNonAnimal,hiResolved,hiUnresolved,hiUnresolvedTickets,last12Resolved,last12Created,last24Created,a1R,a2R,bR,a1O,a2O,bO,a1Avg:avg(a1T),a2Avg:avg(a2T),bAvg:avg(bT),a1As,a2As,bAs,dgA1,dgA2,dgB,pwCreated:pwC.length,pwResolved:pwR.length,pwAuto,pwRC,pwAn,pwDC,pwDR,pwDL,pwSt,dateStr:`${dayOrd(maxDate)} ${MO[maxDate.getMonth()]} ${maxDate.getFullYear()}`,pwStartStr:`${dayOrd(pwS)} ${MO[pwS.getMonth()]} ${pwS.getFullYear()}`,pwEndStr:`${dayOrd(pwE)} ${MO[pwE.getMonth()]} ${pwE.getFullYear()}`};
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

// mode: 'fresh' = clear then load, 'merge' = merge into existing
function handleUpload(file,mode){
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
    if(mergeReport)showMergeReport(mergeReport);
  },50);};
  reader.readAsText(file);
}

function showMergeReport(rep){
  const overlay=document.createElement('div');
  overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:700px;width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <h2 style="color:#4ade80;font-size:1.2em">Merge Complete</h2>
      <button class="btn danger" onclick="closeAllPopups()">Close</button>
    </div>
    <div class="handoff-grid">
      <div class="handoff-box"><h3>Merge Summary</h3><ul>
        <li><span>New tickets added</span><span class="val" style="color:#4ade80">${rep.added}</span></li>
        <li><span>Tickets updated (status advanced)</span><span class="val" style="color:#fbbf24">${rep.updated}</span></li>
        <li><span>Tickets reopened (→ Purple)</span><span class="val" style="color:#a78bfa">${rep.reopened}</span></li>
        <li><span>Auto-closed (missing + was Resolved)</span><span class="val" style="color:#44b9d6">${rep.autoClosed||0}</span></li>
        <li><span>Unchanged</span><span class="val" style="color:#879596">${rep.unchanged}</span></li>
        <li><span>Not present in new file (retained)</span><span class="val" style="color:#ff5252">${rep.missing}</span></li>
      </ul></div>
    </div>
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

function topBar(active){
  const navBtn=(view,lbl)=>`<button class="btn ${active===view?'':'sec'}" onclick="nav('${view}')" style="${active===view?'':'border-color:var(--bd)'}">${lbl}</button>`;
  return `<div class="top-bar" style="flex-wrap:wrap;gap:10px">
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div class="logo"><img src="gsoc-logo.svg" alt="GSOC"><span>WWOS-GSOC PHD Dashboard</span></div>
      <div style="display:flex;gap:8px">
        ${navBtn('dashboard','Dashboard')}
        ${navBtn('groups','Groups')}
        ${navBtn('previous-week','Previous Week')}
        ${navBtn('shift-report','Shift Report')}
      </div>
    </div>
    <div class="nav-actions">
      <a class="btn sec" href="index.html">← Home</a>
      <label class="btn" style="cursor:pointer">+ Merge Data<input type="file" accept=".csv" id="mergeFile" style="display:none"></label>
      <label class="btn sec" style="cursor:pointer">Start Fresh<input type="file" accept=".csv" id="freshFile" style="display:none"></label>
      <button class="btn" style="background:#4ade80" onclick="showPublishModal()">Publish Data</button>
    </div>
  </div>`;
}

function attachNewFileHandler(){
  const mf=document.getElementById('mergeFile');
  if(mf)mf.onchange=(e)=>{if(PUBLISHING){showToast('Publish in progress — please wait before adding data.');e.target.value='';return;}handleUpload(e.target.files[0],'merge');};
  const ff=document.getElementById('freshFile');
  if(ff)ff.onchange=(e)=>{if(PUBLISHING){showToast('Publish in progress — please wait before adding data.');e.target.value='';return;}if(confirm('Start Fresh will replace ALL existing data with this new file. Continue?'))handleUpload(e.target.files[0],'fresh');else e.target.value='';};
}

function makeChart(id,config){
  const ctx=document.getElementById(id);
  if(ctx){const c=new Chart(ctx,config);charts.push(c);}
}

function closeAllPopups(){const p=document.getElementById('colorPopup');if(p)p.remove();const p2=document.getElementById('incPopup');if(p2)p2.remove();}

function showColorPopup(color,tickets){
  closeAllPopups();
  const colorNames={green:'GREEN (0-96 hrs)',yellow:'YELLOW (96-168 hrs)',red:'RED (168-240 hrs)',black:'BLACK (>240 hrs)',purple:'PURPLE (Reopened)'};
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  const tix=M.colorTickets[color];
  // Group by agent
  const byAgent={};tix.forEach(r=>{const a=r.AssigneeIdentity||'Unassigned';if(!byAgent[a])byAgent[a]=[];byAgent[a].push(r);});
  const agentList=Object.entries(byAgent).sort((a,b)=>b[1].length-a[1].length);
  const overlay=document.createElement('div');
  overlay.id='colorPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  const agentRows=agentList.map(([name,tickets])=>{const dn=displayName(name);const style=isLMCAP(name)?'color:#f97316;font-style:italic':'color:#44b9d6';return`<tr style="cursor:pointer" onclick="showAgentDrilldown('${color}','${name.replace(/'/g,"\\'")}')"><td><strong style="${style}">${dn}</strong>${isLMCAP(name)?'<span style="margin-left:8px;padding:2px 6px;background:rgba(249,115,22,.15);color:#f97316;border-radius:3px;font-size:.7em">DEFAULT</span>':''}</td><td style="color:${colorHex[color]};font-weight:700;font-size:1.1em">${tickets.length}</td></tr>`;}).join('');
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:900px;width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:${colorHex[color]};font-size:1.2em">${colorNames[color]} — ${tix.length} tickets</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="downloadColorCSV('${color}')">Download All CSV</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <p style="color:#879596;font-size:.85em;margin-bottom:12px">Click an agent to view their tickets</p>
    <table><thead><tr><th>Agent</th><th>Tickets</th></tr></thead><tbody>${agentRows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}

function showAgentDrilldown(color,agentName){
  closeAllPopups();
  const colorHex={green:'#4ade80',yellow:'#fbbf24',red:'#ff5252',black:'#888',purple:'#a78bfa'};
  const tix=M.colorTickets[color].filter(r=>(r.AssigneeIdentity||'Unassigned')===agentName);
  // Sort by CreateDate descending
  tix.sort((a,b)=>new Date(b.CreateDate)-new Date(a.CreateDate));
  const now=new Date();const dn=displayName(agentName);
  const rows=tix.map(r=>{
    const cd=new Date(r.CreateDate);
    const daysAgo=Math.floor((now-cd)/(864e5));
    const daysText=daysAgo===0?'Today':daysAgo===1?'1 day ago':`${daysAgo} days ago`;
    return`<tr><td><a href="https://t.corp.amazon.com/issues/${r.ShortId}" target="_blank" style="color:#44b9d6">${r.ShortId}</a></td><td>${cd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} <span style="color:#879596;font-size:.8em">(${daysText})</span></td><td>${r.Status}</td></tr>`;
  }).join('');
  const overlay=document.createElement('div');
  overlay.id='colorPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:1000px;width:100%;max-height:80vh;overflow:auto;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="color:${colorHex[color]};font-size:1.1em">${dn} — ${tix.length} tickets</h2>
      <div style="display:flex;gap:10px"><button class="btn" onclick="showColorPopup('${color}')">← Back</button><button class="btn danger" onclick="closeAllPopups()">Close</button></div>
    </div>
    <table><thead><tr><th>Ticket ID</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.body.appendChild(overlay);
}
function downloadColorCSV(color){
  const tickets=M.colorTickets[color];
  let csv='ShortId,Assignee,CreateDate,Status,Title\n';
  tickets.forEach(r=>{csv+=`"${r.ShortId||''}","${r.AssigneeIdentity||''}","${r.CreateDate||''}","${r.Status||''}","${(r.Title||'').replace(/"/g,'""')}"\n`;});
  const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${color}_tickets.csv`;a.click();URL.revokeObjectURL(url);
}

function showIncidentPopup(type){
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
  document.getElementById('app').innerHTML=topBar('dashboard')+`<div class="content">
  <div class="page-title"><h1>Wall Street Journal</h1><p>${m.uploadTime?'Data last uploaded at '+m.uploadTime+' · ':''}${(m.totalStored||m.T).toLocaleString()} tickets in dashboard. Use "+ Merge Data" to add a new file, or "Start Fresh" to replace all.</p></div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Total Tickets Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="kpi-card accent"><div class="value">${m.T.toLocaleString()}</div><div class="label">Total Tickets <span title="Total number of tickets stored in the dashboard" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card success"><div class="value">${(m.res+m.closed).toLocaleString()} (${((m.res+m.closed)/m.T*100).toFixed(1)}%)</div><div class="label">Resolved <span title="Tickets in Resolved or Closed status" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card warning"><div class="value">${m.inQ.toLocaleString()} (${(m.inQ/m.T*100).toFixed(1)}%)</div><div class="label">Unresolved Tickets <span title="Tickets not in Resolved/Closed status (Assigned, WIP, Researching, Pending)" style="cursor:help;opacity:.7">&#9432;</span></div></div>
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Average Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="kpi-card"><div class="value">${m.avgR.toFixed(0)} hrs (${(m.avgR/240*100).toFixed(1)}%)</div><div class="label">Avg Resolution Time <span title="Average resolution time. Percentage = avg / 240hr SLA" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card" style="border-top-color:${parseFloat(m.slaPct)>=90?'#4ade80':'#ff5252'}"><div class="value" style="color:${parseFloat(m.slaPct)>=90?'#4ade80':'#ff5252'}">${m.slaPct}%</div><div class="label">SLA Compliance (≤240 hrs) <span title="${m.slaCompliant} of ${m.res+m.closed} resolved within 240 hrs" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card"><div class="value">${m.autosim.toLocaleString()} (${(m.autosim/m.T*100).toFixed(1)}%)</div><div class="label">AutoSIM Resolved <span title="Tickets auto-resolved by AutoSIM" style="cursor:help;opacity:.7">&#9432;</span></div></div>
  </div>

  <h3 style="color:#879596;font-size:.8em;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Repeat Incident Data</h3>
  <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi-card accent"><div class="value">${m.hiCases.length.toLocaleString()}</div><div class="label">Repeat Incidents (HI&gt;0) <span title="Tickets with Historical Incident / Cnt > 0" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card"><div class="value">${(m.hiCases.length/m.T*100).toFixed(1)}%</div><div class="label">Repeat Incident % <span title="Repeat incidents as % of total tickets" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card success"><div class="value">${m.hiResolved.toLocaleString()}</div><div class="label">Repeat - Resolved <span title="Repeat incidents in Resolved/Closed status" style="cursor:help;opacity:.7">&#9432;</span></div></div>
    <div class="kpi-card warning" style="cursor:pointer" onclick="showHIUnresolvedPopup()"><div class="value">${m.hiUnresolved.toLocaleString()}</div><div class="label">Repeat - Unresolved <span title="Click to view unresolved repeat incident tickets" style="cursor:help;opacity:.7">&#9432;</span></div></div>
  </div>

  <div class="section"><h2>Ticket Age Classification</h2>
    <p class="meta-info">Click any color segment to view tickets. Download individual segments as CSV.</p>
    <div class="kpi-grid">
      <div class="kpi-card" style="border-top-color:#4ade80;cursor:pointer" onclick="showColorPopup('green',M.colorTickets.green)"><div class="value" style="color:#4ade80">${ct.green.length}</div><div class="label">GREEN (0-96 hrs / 0-4 days)</div></div>
      <div class="kpi-card" style="border-top-color:#fbbf24;cursor:pointer" onclick="showColorPopup('yellow',M.colorTickets.yellow)"><div class="value" style="color:#fbbf24">${ct.yellow.length}</div><div class="label">YELLOW (96-168 hrs / 4-7 days)</div></div>
      <div class="kpi-card" style="border-top-color:#ff5252;cursor:pointer" onclick="showColorPopup('red',M.colorTickets.red)"><div class="value" style="color:#ff5252">${ct.red.length}</div><div class="label">RED (168-240 hrs / 7-10 days)</div></div>
      <div class="kpi-card" style="border-top-color:#888;cursor:pointer" onclick="showColorPopup('black',M.colorTickets.black)"><div class="value" style="color:#888">${ct.black.length}</div><div class="label">BLACK (>240 hrs / >10 days)</div></div>
      <div class="kpi-card" style="border-top-color:#a78bfa;cursor:pointer" onclick="showColorPopup('purple',M.colorTickets.purple)"><div class="value" style="color:#a78bfa">${ct.purple.length}</div><div class="label">PURPLE (Reopened)</div></div>
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
  <div class="section"><h2>Incident Types</h2><p class="meta-info">Click any incident type to view agent breakdown</p>
    <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Incident Type</th><th>Count</th><th>% of Total</th><th>Volume</th></tr></thead><tbody>
    ${m.iL.map((type,i)=>{const count=m.iD[i];const pct=(count/m.T*100).toFixed(1);const barW=(count/m.iD[0]*100).toFixed(0);return`<tr style="cursor:pointer" onclick="showIncidentPopup('${type.replace(/'/g,"\\'")}')"><td style="color:#ff9900;font-weight:700">${i+1}</td><td><strong>${type}</strong></td><td>${count}</td><td>${pct}%</td><td><div style="display:flex;align-items:center"><div style="height:8px;border-radius:4px;background:#ff9900;width:${barW}%;min-width:4px"></div></div></td></tr>`;}).join('')}
    </tbody></table></div></div>
  ${m.hiCases.length>0?`<div class="section"><h2>Historical Incidents (Cnt > 0)</h2><p class="meta-info">Total: ${m.hiCases.length} tickets with prior incident history. Click any root cause to view agent breakdown.</p>
    <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Root Cause</th><th>Count</th><th>% of Total HI</th><th>Volume</th></tr></thead><tbody>
    ${(()=>{const hiByRC={};m.hiCases.forEach(h=>{const rc=(h.rootCause||'Unknown').replace(/^\s*-\s*/,'').trim();hiByRC[rc]=(hiByRC[rc]||0)+1;});const hiSorted=Object.entries(hiByRC).sort((a,b)=>b[1]-a[1]);const hiMax=hiSorted.length>0?hiSorted[0][1]:1;return hiSorted.map(([rc,count],i)=>`<tr style="cursor:pointer" onclick="showHIPopup('${rc.replace(/'/g,"\\'")}')"><td style="color:#ff9900;font-weight:700">${i+1}</td><td><strong>${rc}</strong></td><td>${count}</td><td>${(count/m.hiCases.length*100).toFixed(1)}%</td><td><div style="display:flex;align-items:center"><div style="height:8px;border-radius:4px;background:#ff9900;width:${(count/hiMax*100).toFixed(0)}%;min-width:4px"></div></div></td></tr>`).join('');})()}
    </tbody></table></div></div>`:''}</div>`;
  attachNewFileHandler();
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('c2a',{type:'bar',data:{labels:m.dL,datasets:[{label:'Created',data:m.dC,backgroundColor:'rgba(255,153,0,.8)',borderColor:'#ff9900',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  makeChart('c2b',{type:'bar',data:{labels:m.dL,datasets:[{label:'Resolved',data:m.dD,backgroundColor:'rgba(74,222,128,.8)',borderColor:'#4ade80',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  makeChart('c4a',{type:'bar',data:{labels:m.wL,datasets:[{label:'Created',data:m.wD,backgroundColor:'rgba(255,153,0,.8)',borderColor:'#ff9900',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
  makeChart('c4b',{type:'bar',data:{labels:m.wL,datasets:[{label:'Resolved',data:m.wDR,backgroundColor:'rgba(74,222,128,.8)',borderColor:'#4ade80',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{font:{size:12}}},x:{grid:{display:false},ticks:{font:{size:12}}}}}});
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
function showPublishModal(){
  closeAllPopups();
  const savedToken=sessionStorage.getItem('gh_token')||'';
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.onclick=(e)=>{if(e.target===overlay)closeAllPopups();};
  overlay.innerHTML=`<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:520px;width:100%;padding:28px">
    <h2 style="color:#4ade80;font-size:1.2em;margin-bottom:8px">Publish Data to Everyone</h2>
    <p style="color:#879596;font-size:.88em;margin-bottom:18px;line-height:1.5">This publishes the current dashboard data to GitHub so all users see it. Paste a GitHub token with <b>Contents: write</b> permission for this repo. The token stays only in this browser session and is never saved to the site.</p>
    <label style="display:block;color:#879596;font-size:.85em;margin-bottom:6px">GitHub Personal Access Token</label>
    <input type="password" id="ghToken" value="${savedToken}" placeholder="github_pat_..." style="width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.9em">
    <label style="display:flex;align-items:center;gap:8px;color:#879596;font-size:.82em;margin-top:12px;cursor:pointer"><input type="checkbox" id="ghRemember" ${savedToken?'checked':''}> Remember token for this session</label>
    <div class="err" id="pubErr" style="color:#ff5252;font-size:.85em;margin-top:12px;display:none"></div>
    <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn sec" onclick="closeAllPopups()">Cancel</button>
      <button class="btn" style="background:#4ade80" onclick="doPublish()">Publish</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  setTimeout(()=>document.getElementById('ghToken').focus(),50);
}

function showPublishSpinner(){
  closeAllPopups();
  const overlay=document.createElement('div');overlay.id='incPopup';
  overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.9);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML=`<div style="text-align:center">
    <div class="spinner"></div>
    <p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">New data is being pushed...</p>
    <p style="color:#879596;margin-top:8px;font-size:.9em">Publishing to GitHub. This may take a moment.</p>
  </div>`;
  document.body.appendChild(overlay);
}

async function doPublish(){
  const token=document.getElementById('ghToken').value.trim();
  const remember=document.getElementById('ghRemember').checked;
  const errEl=document.getElementById('pubErr');
  if(!token){errEl.textContent='Please paste a GitHub token.';errEl.style.display='block';return;}
  if(remember)sessionStorage.setItem('gh_token',token);else sessionStorage.removeItem('gh_token');
  PUBLISHING=true;                 // lock uploads/merges
  showPublishSpinner();
  try{
    // Build payload: all stored tickets + metadata
    const allRows=await dbGetAll();
    const payload={updatedAt:new Date().toISOString(),count:allRows.length,tickets:allRows};
    const content=btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const apiBase=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_DATA_PATH}`;
    const headers={'Authorization':'token '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    // Get existing file SHA (needed to update)
    let sha=undefined;
    const getResp=await fetch(apiBase+'?ref='+GH_BRANCH,{headers});
    if(getResp.status===200){const j=await getResp.json();sha=j.sha;}
    else if(getResp.status!==404){throw new Error('GitHub read failed: HTTP '+getResp.status);}
    // Commit the file
    const putResp=await fetch(apiBase,{method:'PUT',headers,body:JSON.stringify({message:'Publish dashboard data '+new Date().toISOString(),content,branch:GH_BRANCH,sha})});
    if(!putResp.ok){const t=await putResp.text();throw new Error('GitHub write failed: HTTP '+putResp.status+' '+t.substring(0,120));}
    // Keep the lock during the GitHub Pages deploy window (~60s) so no one edits mid-deploy
    updatePublishSpinner('Data committed. Waiting for deployment to complete...');
    await new Promise(r=>setTimeout(r,60000));
    PUBLISHING=false;              // unlock
    closeAllPopups();
    showToast('Data published & deployed! Live for everyone now.');
  }catch(e){
    PUBLISHING=false;             // unlock on failure
    closeAllPopups();
    showPublishModal();
    setTimeout(()=>{const el=document.getElementById('pubErr');if(el){el.textContent=e.message;el.style.display='block';}},60);
  }
}

function updatePublishSpinner(msg){
  const p=document.querySelector('#incPopup p');
  if(p)p.textContent=msg;
}

async function loadSharedData(){
  try{
    const resp=await fetch(GH_DATA_PATH+'?t='+Date.now());
    if(!resp.ok)return null;
    const j=await resp.json();
    if(j&&j.tickets&&j.tickets.length)return j;
  }catch(e){}
  return null;
}

// ========= INIT =========
(async function init(){
  try{
    // 1. Prefer shared published data (so all users see the same thing)
    const shared=await loadSharedData();
    if(shared){
      await dbClear();
      await dbPutAll(shared.tickets);
      const allRows=await dbGetAll();
      M=computeMetrics(allRows);M.totalStored=allRows.length;
      M.uploadTime=shared.updatedAt?new Date(shared.updatedAt).toLocaleString('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):null;
      renderDashboard();
      return;
    }
    // 2. Fall back to local IndexedDB
    const count=await dbCount();
    if(count>0){
      const allRows=await dbGetAll();
      M=computeMetrics(allRows);M.totalStored=allRows.length;
      renderDashboard();
    } else {
      renderUpload();
    }
  }catch(e){renderUpload();}
})();
