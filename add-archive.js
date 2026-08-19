// Add-archive page: gate check, parse CSV, compute metrics in-browser, save to IndexedDB, allow export
if(sessionStorage.getItem('phd_authed')!=='1'){window.location.href='home.html';}

const PHD_RESOLVERS=['arunkzn','flofalgu','harisss','punithsd','mbozied','mellanej','nobregak','chousoud','dbiswamb','obalasut','shaavhad','tanviroo','urmahala'];
const REGIONS=['US','UK','CA','AU','BR','JP','IN','DE','SG','IT','FR','MX','AE','ES','NL','PL','TR','SA','EG'];
const DB_NAME='phd_archive_db',STORE='archives';

function openDB(){return new Promise((res,rej)=>{const rq=indexedDB.open(DB_NAME,1);rq.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});};rq.onsuccess=e=>res(e.target.result);rq.onerror=e=>rej(e.target.error);});}
async function dbPut(key,metrics,name){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({key,metrics,name});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

function parseCSV(text){
  const lines=[];let cur='';let inQ=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(ch==='"'){if(inQ&&text[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;}}
    else if(ch===','&&!inQ){lines.push(cur);cur='';}
    else if((ch==='\n'||ch==='\r')&&!inQ){if(ch==='\r'&&text[i+1]==='\n')i++;lines.push(cur);cur='';lines.push('__RE__');}
    else{cur+=ch;}}
  if(cur)lines.push(cur);lines.push('__RE__');
  const rows=[];let row=[];
  for(const c of lines){if(c==='__RE__'){if(row.length>0)rows.push(row);row=[];}else{row.push(c);}}
  const h=rows[0];const d=[];
  for(let i=1;i<rows.length;i++){const o={};for(let j=0;j<h.length;j++)o[h[j]]=rows[i][j]||'';d.push(o);}
  return d;
}
function getRegion(t){for(const c of REGIONS){if(t.startsWith(c+' '))return c;}return'Other';}
function getField(details,label){const m=(details||'').match(new RegExp(label+'\\s*:?\\s*([^\\n\\r]+)','i'));return m?m[1].trim():null;}
function normDriver(dt){if(!dt)return null;const t=dt.trim().toUpperCase();if(t.includes('DSP')||t.includes('DA'))return'DSP DA';if(t.includes('FLEX')||t.includes('DP'))return'Flex DP';return'Flex DP';}
function median(arr){if(!arr.length)return 0;const s=[...arr].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];}
function avg(arr){return arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:0;}

function compute(data){
  const T=data.length;
  const statuses={},closureCodes={},severities={},rootCauses={},assignees={},resolvers={},regions={},driverTypes={},resolutionTypes={},incidentTypes={},parties={};
  const resTimes=[],ages=[];const hiDist={'0':0,'1':0,'2':0,'3+':0};let hiTotal=0,hiRepeat=0;
  const uniqStations=new Set(),uniqAssignees=new Set(),uniqResolvers=new Set();
  let resolvedClosed=0,open=0,reopen=0;
  const createdByMonth={},resolvedByMonth={},createdByYear={},resolvedByYear={},createdByQuarter={},resolvedByQuarter={};
  const sevByYear={},resTimeByMonth={},rcXregion={},driverXincident={},regionXincident={};
  data.forEach(r=>{
    statuses[r.Status]=(statuses[r.Status]||0)+1;
    if(r.ClosureCode)closureCodes[r.ClosureCode]=(closureCodes[r.ClosureCode]||0)+1;
    if(r.Severity)severities[r.Severity]=(severities[r.Severity]||0)+1;
    if(r.RootCause)rootCauses[r.RootCause]=(rootCauses[r.RootCause]||0)+1;
    if(r.AssigneeIdentity){assignees[r.AssigneeIdentity]=(assignees[r.AssigneeIdentity]||0)+1;uniqAssignees.add(r.AssigneeIdentity);}
    if(r.ResolvedByIdentity){const rb=r.ResolvedByIdentity.includes('AutoSIM')?'AutoSIM':r.ResolvedByIdentity;resolvers[rb]=(resolvers[rb]||0)+1;uniqResolvers.add(rb);}
    const region=getRegion(r.Title||'');regions[region]=(regions[region]||0)+1;
    const dt=normDriver(getField(r.RootCauseDetails,'Driver Type'));if(dt)driverTypes[dt]=(driverTypes[dt]||0)+1;
    const res=getField(r.RootCauseDetails,'Resolution');if(res)resolutionTypes[res]=(resolutionTypes[res]||0)+1;
    const iss=getField(r.RootCauseDetails,'Issue');const incType=iss||'Unknown';if(iss)incidentTypes[iss]=(incidentTypes[iss]||0)+1;
    const t=r.Title||'';if(t.includes('Customer Incident'))parties.Customer=(parties.Customer||0)+1;else if(t.includes('Community Member'))parties['Community Member']=(parties['Community Member']||0)+1;else parties.Other=(parties.Other||0)+1;
    const st=getField(r.RootCauseDetails,'Station ID');if(st)uniqStations.add(st);
    const hiM=(r.RootCauseDetails||'').match(/Historical Incident:\s*(\d+)/i);if(hiM){const n=parseInt(hiM[1]);hiTotal++;if(n>0)hiRepeat++;if(n===0)hiDist['0']++;else if(n===1)hiDist['1']++;else if(n===2)hiDist['2']++;else hiDist['3+']++;}
    if(r.Status==='Resolved'||r.Status==='Closed')resolvedClosed++;else open++;
    if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/36e5;if(h>=0)resTimes.push(h);}
    if(r.Age&&!isNaN(parseInt(r.Age)))ages.push(parseInt(r.Age));
    const cd=new Date(r.CreateDate);
    if(!isNaN(cd)){const y=cd.getFullYear();const mo=`${y}-${String(cd.getMonth()+1).padStart(2,'0')}`;const q=`${y}-Q${Math.floor(cd.getMonth()/3)+1}`;
      createdByYear[y]=(createdByYear[y]||0)+1;createdByMonth[mo]=(createdByMonth[mo]||0)+1;createdByQuarter[q]=(createdByQuarter[q]||0)+1;
      if(!sevByYear[y])sevByYear[y]={};if(r.Severity)sevByYear[y][r.Severity]=(sevByYear[y][r.Severity]||0)+1;
      if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-cd)/36e5;if(h>=0){if(!resTimeByMonth[mo])resTimeByMonth[mo]=[];resTimeByMonth[mo].push(h);}}}
    const rd=new Date(r.ResolvedDate);
    if(!isNaN(rd)){const y=rd.getFullYear();const mo=`${y}-${String(rd.getMonth()+1).padStart(2,'0')}`;const q=`${y}-Q${Math.floor(rd.getMonth()/3)+1}`;
      resolvedByYear[y]=(resolvedByYear[y]||0)+1;resolvedByMonth[mo]=(resolvedByMonth[mo]||0)+1;resolvedByQuarter[q]=(resolvedByQuarter[q]||0)+1;}
    const rcKey=(r.RootCause||'Unknown').replace(/^\s*-\s*/,'').substring(0,40);
    rcXregion[rcKey]=rcXregion[rcKey]||{};rcXregion[rcKey][region]=(rcXregion[rcKey][region]||0)+1;
    if(dt){driverXincident[dt]=driverXincident[dt]||{};driverXincident[dt][incType]=(driverXincident[dt][incType]||0)+1;}
    regionXincident[region]=regionXincident[region]||{};regionXincident[region][incType]=(regionXincident[region][incType]||0)+1;
  });
  resTimes.sort((a,b)=>a-b);ages.sort((a,b)=>a-b);
  const slaHrs=240;const slaCompliant=resTimes.filter(h=>h<=slaHrs).length;
  const resTrendLabels=Object.keys(resTimeByMonth).sort();
  const resTrendData=resTrendLabels.map(m=>+median(resTimeByMonth[m]).toFixed(1));
  const years=Object.keys(createdByYear).sort();
  const yoy=years.map((y,i)=>{if(i===0)return{year:y,count:createdByYear[y],growth:null};const prev=createdByYear[years[i-1]];return{year:y,count:createdByYear[y],growth:prev?(((createdByYear[y]-prev)/prev)*100).toFixed(1):null};});
  function sortObj(o){return Object.entries(o).sort((a,b)=>b[1]-a[1]);}
  const dates=data.map(r=>new Date(r.CreateDate)).filter(d=>!isNaN(d));
  return{total:T,resolvedClosed,open,resolutionRate:+(resolvedClosed/T*100).toFixed(1),avgRes:+avg(resTimes).toFixed(1),medianRes:+median(resTimes).toFixed(1),minRes:+(resTimes[0]||0).toFixed(1),maxRes:+(resTimes[resTimes.length-1]||0).toFixed(0),avgAge:+avg(ages).toFixed(0),medianAge:median(ages),uniqAssignees:uniqAssignees.size,uniqResolvers:uniqResolvers.size,uniqStations:uniqStations.size,slaPct:resTimes.length?+(slaCompliant/resTimes.length*100).toFixed(1):0,slaHrs,reopen,hiRepeatPct:hiTotal?+(hiRepeat/hiTotal*100).toFixed(1):0,hiTotal,hiRepeat,dateRange:dates.length?[new Date(Math.min(...dates)).toISOString().split('T')[0],new Date(Math.max(...dates)).toISOString().split('T')[0]]:['',''],statuses:sortObj(statuses),closureCodes:sortObj(closureCodes),severities:sortObj(severities),rootCauses:sortObj(rootCauses).slice(0,20),assignees:sortObj(assignees).slice(0,25),resolvers:sortObj(resolvers),regions:sortObj(regions),driverTypes:sortObj(driverTypes).slice(0,12),resolutionTypes:sortObj(resolutionTypes).slice(0,15),incidentTypes:sortObj(incidentTypes).slice(0,20),parties:sortObj(parties),hiDist,phdResolvers:PHD_RESOLVERS,createdByYear:Object.entries(createdByYear).sort(),resolvedByYear:Object.entries(resolvedByYear).sort(),createdByMonth:Object.entries(createdByMonth).sort(),resolvedByMonth:Object.entries(resolvedByMonth).sort(),createdByQuarter:Object.entries(createdByQuarter).sort(),resolvedByQuarter:Object.entries(resolvedByQuarter).sort(),sevByYear,resTrendLabels,resTrendData,yoy,rcXregion,driverXincident,regionXincident};
}

let computedMetrics=null,computedName='';
const dz=document.getElementById('dropZone'),fi=document.getElementById('fileInput');
dz.onclick=()=>fi.click();
dz.ondragover=e=>e.preventDefault();
dz.ondrop=e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);};
fi.onchange=e=>handleFile(e.target.files[0]);

function handleFile(file){
  if(!file)return;
  const name=document.getElementById('btnName').value.trim();
  if(!name){showStatus('err','Please enter a dashboard name first.');return;}
  document.getElementById('spin').style.display='block';
  document.getElementById('status').style.display='none';
  const reader=new FileReader();
  reader.onload=async(e)=>{setTimeout(async()=>{
    try{
      const data=parseCSV(e.target.result);
      computedMetrics=compute(data);computedName=name;
      const key='custom_'+name.toLowerCase().replace(/[^a-z0-9]/g,'_')+'_'+Date.now();
      await dbPut(key,computedMetrics,name);
      // register in localStorage
      const reg=JSON.parse(localStorage.getItem('phd_custom_archives')||'[]');
      reg.push({key,name,total:computedMetrics.total});
      localStorage.setItem('phd_custom_archives',JSON.stringify(reg));
      window._exportKey=key;
      document.getElementById('spin').style.display='none';
      showStatus('ok',`Success! "${name}" processed (${computedMetrics.total.toLocaleString()} tickets) and saved to your browser. It now appears on the home page. Preview: `);
      document.getElementById('status').innerHTML+=`<a href="archive.html?ds=custom&key=${encodeURIComponent(key)}" style="color:#44b9d6">Open dashboard →</a>`;
      document.getElementById('exportArea').style.display='block';
    }catch(err){document.getElementById('spin').style.display='none';showStatus('err','Error processing file: '+err.message);}
  },50);};
  reader.readAsText(file);
}
function showStatus(type,msg){const s=document.getElementById('status');s.className='status '+type;s.textContent=msg;}

document.getElementById('downloadBtn').onclick=()=>{
  if(!computedMetrics)return;
  const blob=new Blob([JSON.stringify({key:window._exportKey,name:computedName,metrics:computedMetrics})],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='archive-'+computedName.replace(/[^a-zA-Z0-9]/g,'_')+'.json';a.click();URL.revokeObjectURL(url);
};
