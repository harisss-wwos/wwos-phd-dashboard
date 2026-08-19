// Archive dashboard renderer - reads precomputed metrics JSON
const COLORS=['#ff9900','#2074d5','#1d8102','#d13212','#1b9cb0','#8c6bb1','#44b9d6','#ec7211','#3ecf4a','#879596','#ffb84d','#5b9bd5','#ff5252','#2ecc71','#e67e22','#9b59b6'];
const charts=[];
const DB_NAME='phd_archive_db',STORE='archives';

function openDB(){return new Promise((res,rej)=>{const rq=indexedDB.open(DB_NAME,1);rq.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});};rq.onsuccess=e=>res(e.target.result);rq.onerror=e=>rej(e.target.error);});}
async function dbGet(key){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const rq=tx.objectStore(STORE).get(key);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});}
async function dbPut(key,metrics,name){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({key,metrics,name});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

function qparam(k){return new URLSearchParams(location.search).get(k);}

async function loadMetrics(){
  const ds=qparam('ds');
  if(ds==='custom'){
    const key=qparam('key');
    try{const rec=await dbGet(key);return rec?{metrics:rec.metrics,name:rec.name}:null;}catch(e){return null;}
  }
  const key=ds==='q2'?'q2':'archive';
  const file=ds==='q2'?'metrics-q2.json':'metrics-archive.json';
  const name=ds==='q2'?'Q2 2026 Report':'Program History: Jan 2021 – Mar 2026';
  // Try IndexedDB cache (non-blocking - if it fails or times out, fall through to fetch)
  try{
    const cached=await Promise.race([dbGet(key),new Promise(r=>setTimeout(()=>r(null),1500))]);
    if(cached&&cached.metrics)return{metrics:cached.metrics,name:cached.name};
  }catch(e){/* ignore cache errors */}
  // Fetch from JSON file
  const resp=await fetch(file);
  if(!resp.ok)throw new Error('Could not load '+file+' (HTTP '+resp.status+')');
  const metrics=await resp.json();
  // Cache in background (don't await - don't block render)
  dbPut(key,metrics,name).catch(()=>{});
  return{metrics,name};
}

function mkChart(id,cfg){const el=document.getElementById(id);if(el){charts.push(new Chart(el,cfg));}}

function pieCfg(entries,label){return{type:'doughnut',data:{labels:entries.map(e=>e[0]),datasets:[{data:entries.map(e=>e[1]),backgroundColor:COLORS,borderColor:'#000',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:'#d5dbdb',font:{size:10},padding:6}}}}};}
function barCfg(entries,horizontal){
  return {
    type:'bar',
    data:{labels:entries.map(e=>e[0]),datasets:[{data:entries.map(e=>e[1]),backgroundColor:COLORS,borderRadius:3}]},
    options:{
      responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',
      plugins:{legend:{display:false}},
      scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'},ticks:{font:{size:11}}},y:{grid:{display:false},ticks:{font:{size:11}}}}
    }
  };
}

function render(metrics,name){
  const m=metrics;
  const phd=m.phdResolvers||[];
  // Split resolvers: PHD first, then others
  const phdRes=m.resolvers.filter(([k])=>phd.includes(k));
  const otherRes=m.resolvers.filter(([k])=>!phd.includes(k));
  document.getElementById('app').innerHTML=`<div class="content">
    <div class="page-title"><h1>${name}</h1><p>Data range: ${m.dateRange[0]} to ${m.dateRange[1]} · ${m.total.toLocaleString()} total tickets · Read-only archive</p></div>

    <div class="section"><h2>Summary Statistics</h2>
    <div class="kpi-grid">
      <div class="kpi-card accent"><div class="value">${m.total.toLocaleString()}</div><div class="label">Total Tickets</div></div>
      <div class="kpi-card success"><div class="value">${m.resolvedClosed.toLocaleString()}</div><div class="label">Resolved / Closed</div></div>
      <div class="kpi-card warning"><div class="value">${m.open.toLocaleString()}</div><div class="label">Open</div></div>
      <div class="kpi-card success"><div class="value">${m.slaPct}%</div><div class="label">SLA ≤${m.slaHrs}hrs</div></div>
      <div class="kpi-card warning"><div class="value">${m.hiRepeatPct}%</div><div class="label">Repeat Offenders (HI>0)</div></div>
    </div></div>

    <div class="charts-grid">
      <div class="chart-box"><h3>Resolution Type</h3><div class="chart-wrap"><canvas id="cResType"></canvas></div></div>
      <div class="chart-box"><h3>Incident Types (from Issue field)</h3><div class="chart-wrap tall"><canvas id="cIncident"></canvas></div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div class="section" style="margin-bottom:0"><h2>Geography / Region — Count</h2>
      <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Region</th><th>Number of Cases</th></tr></thead><tbody>
      ${m.regions.map(([k,v],i)=>`<tr><td>${i+1}</td><td><strong>${k}</strong></td><td>${v.toLocaleString()}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="section" style="margin-bottom:0"><h2>Resolver Volume — PHD Team (WWOS)</h2>
      <div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Resolver</th><th>Tickets Resolved</th></tr></thead><tbody>
      ${phdRes.map(([k,v],i)=>`<tr><td>${i+1}</td><td><strong>${k}</strong><span class="phd-badge">PHD</span></td><td>${v}</td></tr>`).join('')||'<tr><td colspan="3" style="color:#879596">No PHD resolvers in this dataset</td></tr>'}
      </tbody></table></div></div>
    </div>
    <div style="margin-bottom:24px"></div>

    <div class="charts-grid">
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Created per Year</h3><div class="chart-wrap"><canvas id="cCreatedYear"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Resolved per Year</h3><div class="chart-wrap"><canvas id="cResolvedYear"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Created per Quarter</h3><div class="chart-wrap"><canvas id="cCreatedQ"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Resolved per Quarter</h3><div class="chart-wrap"><canvas id="cResolvedQ"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Created vs Resolved per Month (Backlog Trend)</h3><div class="chart-wrap"><canvas id="cCvR"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Severity Trend Over Time (by Year)</h3><div class="chart-wrap"><canvas id="cSevTrend"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Resolution Time Trend (Median hrs per Month)</h3><div class="chart-wrap"><canvas id="cResTrend"></canvas></div></div>
    </div>

    <div class="section"><h2>Year-over-Year Growth</h2>
    <div style="overflow-x:auto"><table><thead><tr><th>Year</th><th>Tickets Created</th><th>YoY Growth %</th></tr></thead><tbody>
    ${m.yoy.map(y=>`<tr><td><strong>${y.year}</strong></td><td>${y.count.toLocaleString()}</td><td style="color:${y.growth===null?'#879596':parseFloat(y.growth)>=0?'#ff5252':'#4ade80'}">${y.growth===null?'—':(parseFloat(y.growth)>=0?'+':'')+y.growth+'%'}</td></tr>`).join('')}
    </tbody></table></div></div>

    <div class="section"><h2>Root Cause × Region (Cross-Tab)</h2><div style="overflow-x:auto" id="rcRegionTable"></div></div>
  </div>`;

  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  mkChart('cResType',pieCfg(m.resolutionTypes));
  mkChart('cIncident',barCfg(m.incidentTypes,true));
  // Time series
  mkChart('cCreatedYear',{type:'bar',data:{labels:m.createdByYear.map(e=>e[0]),datasets:[{label:'Created',data:m.createdByYear.map(e=>e[1]),backgroundColor:'rgba(255,153,0,.8)',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  mkChart('cResolvedYear',{type:'bar',data:{labels:m.resolvedByYear.map(e=>e[0]),datasets:[{label:'Resolved',data:m.resolvedByYear.map(e=>e[1]),backgroundColor:'rgba(74,222,128,.8)',borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  mkChart('cCreatedQ',{type:'bar',data:{labels:m.createdByQuarter.map(e=>e[0]),datasets:[{label:'Created',data:m.createdByQuarter.map(e=>e[1]),backgroundColor:'rgba(255,153,0,.8)',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{ticks:{font:{size:9}}}}}});
  mkChart('cResolvedQ',{type:'bar',data:{labels:m.resolvedByQuarter.map(e=>e[0]),datasets:[{label:'Resolved',data:m.resolvedByQuarter.map(e=>e[1]),backgroundColor:'rgba(74,222,128,.8)',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{ticks:{font:{size:9}}}}}});
  // Created vs Resolved overlay by month
  const allMonths=[...new Set([...m.createdByMonth.map(e=>e[0]),...m.resolvedByMonth.map(e=>e[0])])].sort();
  const cMap=Object.fromEntries(m.createdByMonth),rMap=Object.fromEntries(m.resolvedByMonth);
  mkChart('cCvR',{type:'line',data:{labels:allMonths,datasets:[{label:'Created',data:allMonths.map(mo=>cMap[mo]||0),borderColor:'#ff9900',backgroundColor:'rgba(255,153,0,.06)',fill:true,tension:.3,pointRadius:0},{label:'Resolved',data:allMonths.map(mo=>rMap[mo]||0),borderColor:'#4ade80',backgroundColor:'rgba(74,222,128,.06)',fill:true,tension:.3,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true},x:{ticks:{font:{size:8},maxTicksLimit:20}}}}});
  // Severity trend
  const sevYears=Object.keys(m.sevByYear).sort();const allSev=[...new Set(sevYears.flatMap(y=>Object.keys(m.sevByYear[y])))].sort();
  const sevColors={'3':'#4ade80','4':'#fbbf24','5':'#ff5252'};
  mkChart('cSevTrend',{type:'line',data:{labels:sevYears,datasets:allSev.map((sev,i)=>({label:'Sev '+sev,data:sevYears.map(y=>m.sevByYear[y][sev]||0),borderColor:sevColors[sev]||COLORS[i],backgroundColor:'transparent',tension:.3,pointRadius:3}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}}},scales:{y:{beginAtZero:true}}}});
  // Res time trend
  mkChart('cResTrend',{type:'line',data:{labels:m.resTrendLabels,datasets:[{label:'Median Res (hrs)',data:m.resTrendData,borderColor:'#2074d5',backgroundColor:'rgba(32,116,213,.08)',fill:true,tension:.3,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true},x:{ticks:{font:{size:8},maxTicksLimit:20}}}}});
  // Cross-tab tables
  renderCrossTab('rcRegionTable',m.rcXregion,m.regions.slice(0,8).map(e=>e[0]),10);
}

function renderCrossTab(elId,data,colKeys,maxRows,maxCols){
  const rows=Object.entries(data).map(([k,v])=>[k,Object.values(v).reduce((s,x)=>s+x,0),v]).sort((a,b)=>b[1]-a[1]).slice(0,maxRows);
  let cols=colKeys;
  if(!cols){const colTotals={};rows.forEach(([k,t,v])=>{Object.entries(v).forEach(([c,n])=>{colTotals[c]=(colTotals[c]||0)+n;});});cols=Object.entries(colTotals).sort((a,b)=>b[1]-a[1]).slice(0,maxCols||8).map(e=>e[0]);}
  let html='<table><thead><tr><th></th>'+cols.map(c=>`<th>${c.substring(0,20)}</th>`).join('')+'<th>Total</th></tr></thead><tbody>';
  rows.forEach(([k,total,v])=>{html+=`<tr><td><strong>${k}</strong></td>`+cols.map(c=>{const n=v[c]||0;const intensity=total?Math.min(n/total,1):0;return`<td style="background:rgba(255,153,0,${(intensity*0.5).toFixed(2)})">${n||''}</td>`;}).join('')+`<td><strong>${total}</strong></td></tr>`;});
  html+='</tbody></table>';
  document.getElementById(elId).innerHTML=html;
}

(async function(){
  try{
    const result=await loadMetrics();
    if(!result){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Dashboard not found</h2><p style="color:#879596">This archive could not be loaded. <a href="home.html" style="color:#44b9d6">Return home</a></p></div></div>';return;}
    render(result.metrics,result.name);
  }catch(e){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Error loading dashboard</h2><p style="color:#879596">'+e.message+'</p></div></div>';}
})();
