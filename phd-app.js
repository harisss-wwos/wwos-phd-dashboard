// PHD Dashboard - Single File Application
// CSV Parser, Metrics Engine, and UI Renderer

const STORAGE_KEY = 'phd_dashboard_data';
const PHD_AGENTS = ['harisss','shaavhad','flofalgu','punithsd','dbiswamb','arunkzn','tanviroo','obalasut','mellanej','chousoud','mbozied','urmahala','nobregak'];
const GA1 = ['harisss','punithsd','arunkzn','flofalgu'];
const GA2 = ['tanviroo','urmahala','chousoud','obalasut','shaavhad','dbiswamb'];
const GB = ['mbozied','nobregak','mellanej'];
const COLORS = ['#ff9900','#2074d5','#1d8102','#d13212','#1b9cb0','#8c6bb1','#44b9d6','#ec7211','#3ecf4a','#879596','#ffb84d','#5b9bd5','#ff5252'];

function getGroup(n){if(GA1.includes(n))return'A1';if(GA2.includes(n))return'A2';if(GB.includes(n))return'B';return null;}
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
  const asgn=statuses['Assigned']||0,pend=statuses['Pending']||0,wip=statuses['Work In Progress']||0,res=statuses['Resolved']||0;
  const inQ=asgn+pend+wip;
  const autosim=data.filter(r=>r.ResolvedByIdentity&&r.ResolvedByIdentity.includes('AutoSIM')).length;
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
  const dL=[],dD=[];for(let i=6;i>=0;i--){const ds=new Date(maxDate);ds.setDate(ds.getDate()-i);ds.setHours(0,0,0,0);const de=new Date(ds);de.setDate(de.getDate()+1);dL.push(ds.toLocaleDateString('en-US',{month:'short',day:'numeric'}));dD.push(data.filter(r=>{if(r.ResolvedDate){const rd=new Date(r.ResolvedDate);return rd>=ds&&rd<de;}return false;}).length);}
  const wb={};data.forEach(r=>{if(r.CreateDate){const d=new Date(r.CreateDate);const j4=new Date(d.getFullYear(),0,4);const dy=Math.ceil((d-new Date(d.getFullYear(),0,1))/(864e5));const wn=Math.ceil((dy+j4.getDay())/7);wb[`W${wn}`]=(wb[`W${wn}`]||0)+1;}});
  const wL=Object.keys(wb).sort(),wD=wL.map(k=>wb[k]);
  const geoM={};data.forEach(r=>{const t=r.Title||'';let g='Other';['US','UK','CA','AU','BR','JP','IN','DE','SG','IT','FR','MX','AE'].forEach(c=>{if(t.startsWith(c+' '))g=c;});geoM[g]=(geoM[g]||0)+1;});
  const gL=Object.keys(geoM).sort((a,b)=>geoM[b]-geoM[a]),gD=gL.map(k=>geoM[k]);
  const incM={};data.forEach(r=>{const t=r.Title||'';let tp='Other';if(t.includes('Pet Incident')||t.includes('Attack w/ Pet')||t.includes('Attack w/o Pet'))tp='Pet Incident';else if(t.includes('Verbal Harassment'))tp='Verbal Harassment';else if(t.includes('Weapon Present'))tp='Weapon Present';else if(t.includes('Attack w/o Weapon'))tp='Attack w/o Weapon';else if(t.includes('Detrimental Behavior'))tp='Detrimental Behavior';else if(t.includes('Impeding Egress'))tp='Impeding Egress';else if(t.toLowerCase().includes('dog bite'))tp='Dog Bite';else if(t.includes('Concerning Behavior'))tp='Concerning Behavior';else if(t.toLowerCase().includes('assault'))tp='Assault';incM[tp]=(incM[tp]||0)+1;});
  const iL=Object.keys(incM).sort((a,b)=>incM[b]-incM[a]),iD=iL.map(k=>incM[k]);
  // Agents
  const aRes={},aTm={};data.forEach(r=>{if(r.Status==='Resolved'&&r.ResolvedByIdentity&&!r.ResolvedByIdentity.includes('AutoSIM')){const x=r.ResolvedByIdentity;aRes[x]=(aRes[x]||0)+1;if(r.CreateDate&&r.ResolvedDate){const h=(new Date(r.ResolvedDate)-new Date(r.CreateDate))/36e5;if(h>=0){if(!aTm[x])aTm[x]=[];aTm[x].push(h);}}}});
  const aOpen={},aAsgn={};data.filter(r=>r.Status!=='Resolved').forEach(r=>{if(r.AssigneeIdentity&&PHD_AGENTS.includes(r.AssigneeIdentity))aOpen[r.AssigneeIdentity]=(aOpen[r.AssigneeIdentity]||0)+1;});
  data.forEach(r=>{if(r.AssigneeIdentity&&PHD_AGENTS.includes(r.AssigneeIdentity))aAsgn[r.AssigneeIdentity]=(aAsgn[r.AssigneeIdentity]||0)+1;});
  const agents=PHD_AGENTS.map(n=>({name:n,assigned:aAsgn[n]||0,resolved:aRes[n]||0,open:aOpen[n]||0,avgTime:aTm[n]?avg(aTm[n]):0,group:getGroup(n)}));
  // HI
  const cntP=/\bCnt\s*[:\s]\s*(\d+)/i;const hiCases=[];
  data.forEach(r=>{if(r.RootCauseDetails){const m=r.RootCauseDetails.match(cntP);if(m&&parseInt(m[1])>0)hiCases.push({id:r.ShortId,cnt:parseInt(m[1]),assignee:r.AssigneeIdentity,rootCause:r.RootCause,status:r.Status});}});
  hiCases.sort((a,b)=>b.cnt-a.cnt);
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
  return{T,asgn,pend,wip,res,inQ,autosim,n10,p72,nSLA,l12A,l12P,l12W,l12R,rToday,avgR,dL,dD,wL,wD,gL,gD,iL,iD,agents,hiCases,a1R,a2R,bR,a1O,a2O,bO,a1Avg:avg(a1T),a2Avg:avg(a2T),bAvg:avg(bT),a1As,a2As,bAs,dgA1,dgA2,dgB,pwCreated:pwC.length,pwResolved:pwR.length,pwAuto,pwRC,pwAn,pwDC,pwDR,pwDL,pwSt,dateStr:`${dayOrd(maxDate)} ${MO[maxDate.getMonth()]} ${maxDate.getFullYear()}`,pwStartStr:`${dayOrd(pwS)} ${MO[pwS.getMonth()]} ${pwS.getFullYear()}`,pwEndStr:`${dayOrd(pwE)} ${MO[pwE.getMonth()]} ${pwE.getFullYear()}`};
}

// ========= UI RENDERING =========
let currentView = 'dashboard';
let M = null; // metrics
const charts = [];

function destroyCharts(){charts.forEach(c=>c.destroy());charts.length=0;}

function handleFile(file){
  const reader=new FileReader();
  reader.onload=(e)=>{const data=parseCSV(e.target.result);M=computeMetrics(data);localStorage.setItem(STORAGE_KEY,JSON.stringify(M));renderDashboard();};
  reader.readAsText(file);
}

function logout(){localStorage.removeItem(STORAGE_KEY);M=null;destroyCharts();renderUpload();}
function nav(view){currentView=view;destroyCharts();if(view==='dashboard')renderDashboard();else if(view==='groups')renderGroups();else if(view==='previous-week')renderPreviousWeek();}

function renderUpload(){
  document.getElementById('app').innerHTML=`
  <div class="upload-wrap">
    <div style="text-align:center;max-width:500px">
      <h1 style="color:#fff;font-size:2em;margin-bottom:8px">WWOS-PHD Dashboard</h1>
      <p style="color:#879596;margin-bottom:30px">No data exists to create a dashboard. Upload a CSV file to get started.</p>
      <div class="drop-zone" id="dropZone">
        <p style="color:#fff;font-size:1.1em;font-weight:600;margin-bottom:8px">Drop CSV file here</p>
        <p style="color:#879596;font-size:.9em">or click to browse</p>
        <input type="file" accept=".csv" id="fileInput" style="display:none">
      </div>
      <p style="color:#879596;font-size:.8em;margin-top:20px">Required: IssueId, Title, Status, CreateDate, ResolvedDate, ResolvedByIdentity, RootCause, RootCauseDetails</p>
    </div>
  </div>`;
  const dz=document.getElementById('dropZone'),fi=document.getElementById('fileInput');
  dz.onclick=()=>fi.click();
  dz.ondragover=(e)=>e.preventDefault();
  dz.ondrop=(e)=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);};
  fi.onchange=(e)=>handleFile(e.target.files[0]);
}

function topBar(active){
  return `<div class="top-bar"><div class="logo"><span>WWOS-PHD Dashboard</span></div><div class="nav-actions">
    <label class="btn sec" style="cursor:pointer">Upload New CSV<input type="file" accept=".csv" id="newFile" style="display:none"></label>
    <button class="btn sec" onclick="nav('dashboard')" ${active==='dashboard'?'style="border-color:var(--o);color:var(--o)"':''}>Dashboard</button>
    <button class="btn sec" onclick="nav('groups')" ${active==='groups'?'style="border-color:var(--o);color:var(--o)"':''}>Groups</button>
    <button class="btn sec" onclick="nav('previous-week')" ${active==='previous-week'?'style="border-color:var(--o);color:var(--o)"':''}>Previous Week</button>
    <button class="btn danger" onclick="logout()">Logout</button>
  </div></div>`;
}

function attachNewFileHandler(){
  const nf=document.getElementById('newFile');
  if(nf)nf.onchange=(e)=>handleFile(e.target.files[0]);
}

function makeChart(id,config){
  const ctx=document.getElementById(id);
  if(ctx){const c=new Chart(ctx,config);charts.push(c);}
}

function renderDashboard(){
  const m=M;
  const sorted=[...m.agents].sort((a,b)=>b.resolved-a.resolved);
  document.getElementById('app').innerHTML=topBar('dashboard')+`<div class="content">
  <div class="page-title"><h1>Ticket Operations Overview</h1><p>Data as of ${m.dateStr} | 19:00 IST | Handoff: IND → AMER</p></div>
  <div class="kpi-grid">
    <div class="kpi-card accent"><div class="value">${m.T.toLocaleString()}</div><div class="label">Total Tickets</div></div>
    <div class="kpi-card success"><div class="value">${(m.res/m.T*100).toFixed(1)}%</div><div class="label">Resolved %</div></div>
    <div class="kpi-card warning"><div class="value">${m.inQ}</div><div class="label">In Queue</div></div>
    <div class="kpi-card"><div class="value">${m.autosim}</div><div class="label">AutoSIM Resolved</div></div>
    <div class="kpi-card danger"><div class="value">${m.p72}</div><div class="label">Pending >72hrs</div></div>
  </div>
  <div class="section"><h2>Previous Shift Handoff Summary</h2>
    <p class="meta-info">Date: ${m.dateStr} | Time: 19:00 IST | Handoff: IND → AMER | Timeframe: 7:00 AM - 7:00 PM IST</p>
    <div class="handoff-grid">
      <div class="handoff-box"><h3>Ticket Health</h3><ul><li><span>>10 Days Not Closed</span><span class="val">${m.n10}</span></li><li><span>Pending >72 Hours</span><span class="val">${m.p72}</span></li><li><span>Nearing SLA (≤48hrs)</span><span class="val">${m.nSLA}</span></li></ul></div>
      <div class="handoff-box"><h3>Last 12 Hours Activity</h3><ul><li><span>Assigned</span><span class="val">${m.l12A}</span></li><li><span>Pending</span><span class="val">${m.l12P}</span></li><li><span>WIP</span><span class="val">${m.l12W}</span></li><li><span>Resolved</span><span class="val">${m.l12R}</span></li></ul></div>
      <div class="handoff-box"><h3>Current Queue Status</h3><ul><li><span>Assigned</span><span class="val">${m.asgn} (${(m.asgn/m.T*100).toFixed(1)}%)</span></li><li><span>Pending</span><span class="val">${m.pend} (${(m.pend/m.T*100).toFixed(1)}%)</span></li><li><span>WIP</span><span class="val">${m.wip} (${(m.wip/m.T*100).toFixed(1)}%)</span></li><li><span>Resolved</span><span class="val">${m.res.toLocaleString()} (${(m.res/m.T*100).toFixed(1)}%)</span></li></ul></div>
      <div class="handoff-box"><h3>Key Info</h3><ul><li><span>In Queue</span><span class="val">${m.inQ}</span></li><li><span>AutoSIM</span><span class="val">${m.autosim}</span></li><li><span>Resolved Today</span><span class="val">${m.rToday}</span></li><li><span>Avg Resolution</span><span class="val">${m.avgR.toFixed(1)} hrs</span></li></ul></div>
    </div></div>
  <div class="charts-grid">
    <div class="chart-box"><h3>Status Distribution</h3><div class="chart-wrap"><canvas id="c1"></canvas></div></div>
    <div class="chart-box"><h3>Daily Resolution (Last 7 Days)</h3><div class="chart-wrap"><canvas id="c2"></canvas></div></div>
    <div class="chart-box"><h3>Incident Types</h3><div class="chart-wrap"><canvas id="c3"></canvas></div></div>
    <div class="chart-box"><h3>Weekly Volume Trend</h3><div class="chart-wrap"><canvas id="c4"></canvas></div></div>
    <div class="chart-box"><h3>Geography</h3><div class="chart-wrap"><canvas id="c5"></canvas></div></div>
    <div class="chart-box"><h3>Agent Resolution Volume</h3><div class="chart-wrap"><canvas id="c6"></canvas></div></div>
  </div>
  <div class="section"><h2>Agent Performance Table</h2><div style="overflow-x:auto"><table><thead><tr><th>Agent</th><th>Assigned</th><th>Resolved</th><th>Open</th><th>Avg Res (hrs)</th><th>Rate</th></tr></thead><tbody>
    ${sorted.map(a=>`<tr><td><strong>${a.name}</strong></td><td>${a.assigned}</td><td><span class="badge badge-g">${a.resolved}</span></td><td><span class="badge badge-w">${a.open}</span></td><td>${a.avgTime.toFixed(1)}</td><td>${a.resolved+a.open>0?((a.resolved/(a.resolved+a.open))*100).toFixed(1):0}%</td></tr>`).join('')}
  </tbody></table></div></div>
  ${m.hiCases.length>0?`<div class="section"><h2>Historical Incidents (Cnt > 0)</h2><p class="meta-info">Total: ${m.hiCases.length} (Cnt=1: ${m.hiCases.filter(h=>h.cnt===1).length}, Cnt≥2: ${m.hiCases.filter(h=>h.cnt>=2).length})</p><div style="overflow-x:auto"><table><thead><tr><th>ShortId</th><th>Cnt</th><th>Assignee</th><th>Root Cause</th><th>Status</th></tr></thead><tbody>${m.hiCases.map(h=>`<tr><td><a href="https://t.corp.amazon.com/issues/${h.id}" target="_blank" style="color:#44b9d6">${h.id}</a></td><td><strong style="color:${h.cnt>=2?'#ff5252':'#ffb84d'}">${h.cnt}</strong></td><td>${h.assignee}</td><td>${h.rootCause}</td><td><span class="badge badge-g">${h.status}</span></td></tr>`).join('')}</tbody></table></div></div>`:''}</div>`;
  attachNewFileHandler();
  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  makeChart('c1',{type:'doughnut',data:{labels:['Resolved','WIP','Assigned','Pending'],datasets:[{data:[m.res,m.wip,m.asgn,m.pend],backgroundColor:['#1d8102','#ff9900','#2074d5','#d13212'],borderColor:'#000',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:'#d5dbdb'}}}}});
  makeChart('c2',{type:'line',data:{labels:m.dL,datasets:[{data:m.dD,borderColor:'#ff9900',backgroundColor:'rgba(255,153,0,.08)',fill:true,tension:.4,pointBackgroundColor:'#ff9900',pointRadius:5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{color:'rgba(255,255,255,.04)'}}}}});
  makeChart('c3',{type:'bar',data:{labels:m.iL,datasets:[{data:m.iD,backgroundColor:COLORS,borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},y:{grid:{display:false}}}}});
  makeChart('c4',{type:'bar',data:{labels:m.wL,datasets:[{data:m.wD,backgroundColor:'rgba(255,153,0,.7)',borderColor:'#ff9900',borderWidth:1,borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},x:{grid:{color:'rgba(255,255,255,.04)'}}}}});
  makeChart('c5',{type:'pie',data:{labels:m.gL,datasets:[{data:m.gD,backgroundColor:COLORS,borderColor:'#000',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#d5dbdb',font:{size:11}}}}}});
  makeChart('c6',{type:'bar',data:{labels:m.agents.map(a=>a.name),datasets:[{label:'Resolved',data:m.agents.map(a=>a.resolved),backgroundColor:'rgba(29,129,2,.75)',borderRadius:2},{label:'Open',data:m.agents.map(a=>a.open),backgroundColor:'rgba(255,153,0,.75)',borderRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true,beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}}}}});
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
  </div>
  <div class="section"><h2>Individual Agent Performance</h2><div style="overflow-x:auto"><table><thead><tr><th>Agent</th><th>Group</th><th>Assigned</th><th>Resolved</th><th>Open</th><th>Avg Res (hrs)</th><th>Rate</th></tr></thead><tbody>
    ${sorted.map(a=>`<tr><td><strong>${a.name}</strong></td><td><span class="tag ${tc[a.group]}">${a.group}</span></td><td>${a.assigned}</td><td>${a.resolved}</td><td>${a.open}</td><td>${a.avgTime.toFixed(1)}</td><td>${a.resolved+a.open>0?((a.resolved/(a.resolved+a.open))*100).toFixed(1):0}%</td></tr>`).join('')}
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

// ========= INIT =========
(function init(){
  const stored=localStorage.getItem(STORAGE_KEY);
  if(stored){try{M=JSON.parse(stored);renderDashboard();}catch(e){renderUpload();}}
  else{renderUpload();}
})();
