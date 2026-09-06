// Archive dashboard renderer - reads precomputed metrics JSON
const COLORS=['#ff9900','#2074d5','#1d8102','#d13212','#1b9cb0','#8c6bb1','#44b9d6','#ec7211','#3ecf4a','#879596','#ffb84d','#5b9bd5','#ff5252','#2ecc71','#e67e22','#9b59b6'];
const charts=[];
const DB_NAME='phd_archive_db',STORE='archives';

function openDB(){return new Promise((res,rej)=>{const rq=indexedDB.open(DB_NAME,1);rq.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});};rq.onsuccess=e=>res(e.target.result);rq.onerror=e=>rej(e.target.error);});}
async function dbGet(key){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const rq=tx.objectStore(STORE).get(key);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});}
async function dbPut(key,metrics,name){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({key,metrics,name});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

function qparam(k){return new URLSearchParams(location.search).get(k);}

// Bump when metrics JSON shape changes so stale IndexedDB caches auto-invalidate.
const SCHEMA_VER='v5-slabyweek';

async function loadMetrics(){
  const ds=qparam('ds');
  if(ds==='custom'){
    const key=qparam('key');
    try{const rec=await dbGet(key);return rec?{metrics:rec.metrics,name:rec.name}:null;}catch(e){return null;}
  }
  // Dynamic quarter (DB-backed, non-live): fetch raw tickets and compute metrics in the browser.
  if(ds==='quarter'){
    const qid=qparam('qid');
    if(!qid||!window.QuarterMetrics)throw new Error('Quarter view unavailable.');
    const r=await window.PHDAuth.api('GET','/api/quarter/'+encodeURIComponent(qid));
    if(!r.ok||!r.data)throw new Error('Could not load quarter '+qid+' (HTTP '+(r.status||'?')+')');
    const tickets=(r.data.data&&r.data.data.tickets)||[];
    const range=r.data.range||null;
    const metrics=window.QuarterMetrics.compute(tickets,range);
    return {metrics,name:(r.data.label||qid)+' Report',ds:'quarter'};
  }
  const key=(ds==='q2'?'q2':'archive')+'_'+SCHEMA_VER;
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

function render(metrics,name,ds){
  const m=metrics;
  // "Q2-style" (weekly charts, root-cause groups, incident agent drill-down, resolution merge)
  // applies to the static Q2 dataset AND any dynamic non-live quarter.
  const isQ2=(ds==='q2'||ds==='quarter');
  const quarterMode=(ds==='quarter');
  const phd=m.phdResolvers||[];
  // Split resolvers: PHD first, then others
  const phdRes=m.resolvers.filter(([k])=>phd.includes(k));
  const otherRes=m.resolvers.filter(([k])=>!phd.includes(k));
  // Human-friendly date like "1st April 2026"
  const fmtDate=(iso)=>{const d=new Date(iso+'T00:00:00');if(isNaN(d))return iso;const day=d.getDate();const suf=(day%10===1&&day!==11)?'st':(day%10===2&&day!==12)?'nd':(day%10===3&&day!==13)?'rd':'th';return day+suf+' '+d.toLocaleString('en-US',{month:'long'})+' '+d.getFullYear();};
  // Q2 static shows its fixed window; dynamic quarters + archive use the computed range.
  const rangeText=(ds==='q2')?'1st April 2026 to 30th June 2026':`${fmtDate(m.dateRange[0])} to ${fmtDate(m.dateRange[1])}`;
  // Short window label for weekly chart titles, e.g. "(Apr 1 – Jun 30, 2026)".
  const shortD=(iso)=>{const d=new Date(iso+'T00:00:00');return isNaN(d)?iso:d.toLocaleString('en-US',{month:'short',day:'numeric'});};
  const windowText=(ds==='q2')?'Apr 1 – Jun 30, 2026':(m.dateRange&&m.dateRange[0]?`${shortD(m.dateRange[0])} – ${shortD(m.dateRange[1])}`:'this quarter');
  document.getElementById('app').innerHTML=`<div class="content">
    <div class="page-title"><h1>${name}</h1><p>Data range: ${rangeText} · ${m.total.toLocaleString()} total tickets · Read-only archive</p></div>

    <div class="section"><h2>Summary Statistics</h2>
    <div class="kpi-grid">
      <div class="kpi-card accent"><div class="value">${m.total.toLocaleString()}</div><div class="label">Total Tickets</div></div>
      <div class="kpi-card success"><div class="value">${m.resolvedClosed.toLocaleString()}</div><div class="label">Resolved / Closed</div></div>
      <div class="kpi-card warning"><div class="value">${m.open.toLocaleString()}</div><div class="label">Open</div></div>
      <div class="kpi-card success"><div class="value">${m.slaPct}%</div><div class="label">SLA ≤${m.slaHrs}hrs</div></div>
      <div class="kpi-card warning"><div class="value">${m.hiRepeatPct}%</div><div class="label">Repeat Offenders (HI>0)</div></div>
    </div></div>

    <div class="charts-grid">
      <div class="chart-box"${isQ2?' style="grid-column:1/-1"':''}><h3>Resolution Type</h3><div class="chart-wrap${isQ2?' tall':''}"><canvas id="${isQ2?'cResBar':'cResType'}"></canvas></div></div>
      <div class="chart-box"${isQ2?' style="grid-column:1/-1"':''}><h3>Incident Types${isQ2?' <span style="font-size:.7em;color:#879596;font-weight:400">(click a bar for agent breakdown)</span>':' (from Issue field)'}</h3><div class="chart-wrap tall"><canvas id="cIncident"></canvas></div></div>
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
      ${isQ2?`
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Created per Week (${windowText})</h3><div class="chart-wrap"><canvas id="cCreatedWeek"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Resolved per Week (${windowText})</h3><div class="chart-wrap"><canvas id="cResolvedWeek"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Created vs Resolved per Week (Backlog Trend)</h3><div class="chart-wrap"><canvas id="cCvRWeek"></canvas></div></div>
      `:`
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Created per Year</h3><div class="chart-wrap"><canvas id="cCreatedYear"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Resolved per Year</h3><div class="chart-wrap"><canvas id="cResolvedYear"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Created per Quarter</h3><div class="chart-wrap"><canvas id="cCreatedQ"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Tickets Resolved per Quarter</h3><div class="chart-wrap"><canvas id="cResolvedQ"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Created vs Resolved per Month (Backlog Trend)</h3><div class="chart-wrap"><canvas id="cCvR"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Severity Trend Over Time (by Year)</h3><div class="chart-wrap"><canvas id="cSevTrend"></canvas></div></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>Resolution Time Trend (Median hrs per Month)</h3><div class="chart-wrap"><canvas id="cResTrend"></canvas></div></div>
      `}
    </div>

    ${isQ2?'':`<div class="section"><h2>Year-over-Year Growth</h2>
    <div style="overflow-x:auto"><table><thead><tr><th>Year</th><th>Tickets Created</th><th>YoY Growth %</th></tr></thead><tbody>
    ${m.yoy.map(y=>`<tr><td><strong>${y.year}</strong></td><td>${y.count.toLocaleString()}</td><td style="color:${y.growth===null?'#879596':parseFloat(y.growth)>=0?'#ff5252':'#4ade80'}">${y.growth===null?'—':(parseFloat(y.growth)>=0?'+':'')+y.growth+'%'}</td></tr>`).join('')}
    </tbody></table></div></div>`}

    ${isQ2&&m.slaByWeek?`<div class="section"><h2>SLA Compliance per Week (≤240 hrs)</h2>
      <p style="color:var(--tm);font-size:.85em;margin:-8px 0 16px">Percentage of each week's resolved tickets that met the 240-hour (10-day) SLA. Weeks are bucketed by resolved date.</p>
      <div class="chart-wrap tall"><canvas id="cSlaWave"></canvas></div>
    </div>`:''}

    ${isQ2
      ?`<div class="section"><h2>Root Causes by Group</h2><div id="rcGroups" class="rc-accordion"></div></div>`
      :`<div class="section"><h2>Root Cause × Region (Cross-Tab)</h2><div style="overflow-x:auto" id="rcRegionTable"></div></div>`}
  </div>`;

  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  // Q2 only: merge duplicate/mis-typed resolution-type variants into canonical names, then sum counts.
  let resTypeEntries=m.resolutionTypes;
  if(isQ2){
    const merged={};
    (m.resolutionTypes||[]).forEach(([k,v])=>{const name=canonResolutionType(k);merged[name]=(merged[name]||0)+v;});
    resTypeEntries=Object.entries(merged).sort((a,b)=>b[1]-a[1]);
  }
  if(!isQ2)mkChart('cResType',pieCfg(resTypeEntries));// Q2 uses horizontal bar instead (built below)
  // Q2: fixed Incident Types list — Pet Incident split into handled (591) vs first-time auto/immediate (18).
  // Pet total 609 (Pet Incident 559 + Attack w/ Pet 50) minus 18 first-time resolutions.
  const Q2_INCIDENT_TYPES=[
    ['Pet Incident',591],
    ['Verbal Harassment',523],
    ['Threat w/o Weapon',152],
    ['Impeding Egress',147],
    ['Aggressive CX (unprovoked)',122],
    ['Attack w/o Weapon',118],
    ['Verbal Threat',104],
    ['Yelling/Abusive Behavior',90],
    ['Threat w/ Weapon',90],
    ['Yelling/abusive behavior',83],
    ['Intimidation',66],
    ['Name Calling',64],
    ['Verbal threat',63],
    ['Aggressive CM (unprovoked)',63],
    ['Weapon Present - Implied Threat',54],
    ['Physical altercation',53],
    ['Harassment/Intimidation',52],
    ['Aggressive CX(unprovoked)',41],
    ['Abusive Behavior',41],
    ['Pet Incident (First time)',18]
  ].sort((a,b)=>b[1]-a[1]);
  if(isQ2){
    // Clickable incident bars → agent breakdown modal
    window.__incidentAgents=m.incidentAgents||{};
    const incLabels=Q2_INCIDENT_TYPES.map(e=>e[0]);
    const incData=Q2_INCIDENT_TYPES.map(e=>e[1]);
    mkChart('cIncident',{
      type:'bar',
      data:{labels:incLabels,datasets:[{data:incData,backgroundColor:COLORS,borderRadius:3}]},
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        onClick:(evt,els)=>{if(els&&els.length){const lbl=incLabels[els[0].index];openIncidentModal(lbl);}},
        onHover:(evt,els)=>{evt.native.target.style.cursor=els&&els.length?'pointer':'default';},
        plugins:{legend:{display:false},tooltip:{callbacks:{afterLabel:()=>'Click for agent breakdown'}}},
        scales:{x:{beginAtZero:true,grid:{color:'rgba(255,255,255,.04)'}},y:{grid:{display:false},ticks:{font:{size:11},autoSkip:false}}}
      }
    });
  }else{
    mkChart('cIncident',barCfg(m.incidentTypes,true));
  }
  if(isQ2){
    // Weekly charts (Q2 only) — buckets are week-start dates spanning Apr 1 – Jun 30, 2026
    mkChart('cCreatedWeek',{type:'bar',data:{labels:(m.createdByWeek||[]).map(e=>e[0]),datasets:[{label:'Created',data:(m.createdByWeek||[]).map(e=>e[1]),backgroundColor:'rgba(255,153,0,.8)',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>'Week '+items[0].label}}},scales:{y:{beginAtZero:true,title:{display:true,text:'No. of tickets created',color:'#d5dbdb',font:{size:12}}},x:{ticks:{font:{size:10}},title:{display:true,text:'Week ('+windowText+')',color:'#d5dbdb',font:{size:12}}}}}});
    mkChart('cResolvedWeek',{type:'bar',data:{labels:(m.resolvedByWeek||[]).map(e=>e[0]),datasets:[{label:'Resolved',data:(m.resolvedByWeek||[]).map(e=>e[1]),backgroundColor:'rgba(74,222,128,.8)',borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>'Week '+items[0].label}}},scales:{y:{beginAtZero:true,title:{display:true,text:'No. of tickets resolved',color:'#d5dbdb',font:{size:12}}},x:{ticks:{font:{size:10}},title:{display:true,text:'Week ('+windowText+')',color:'#d5dbdb',font:{size:12}}}}}});
    // Created vs Resolved overlay per week (backlog trend) — same 13 Apr1–Jun30 buckets
    const wkLabels=(m.createdByWeek||[]).map(e=>e[0]);
    const wkCreated=(m.createdByWeek||[]).map(e=>e[1]);
    const wkResolvedMap=Object.fromEntries(m.resolvedByWeek||[]);
    const wkResolved=wkLabels.map(l=>wkResolvedMap[l]||0);
    mkChart('cCvRWeek',{type:'line',data:{labels:wkLabels,datasets:[{label:'Created',data:wkCreated,borderColor:'#ff9900',backgroundColor:'rgba(255,153,0,.08)',fill:true,tension:.3,pointRadius:2},{label:'Resolved',data:wkResolved,borderColor:'#4ade80',backgroundColor:'rgba(74,222,128,.08)',fill:true,tension:.3,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{color:'#d5dbdb'}},tooltip:{callbacks:{title:(items)=>'Week '+items[0].label}}},scales:{y:{beginAtZero:true,title:{display:true,text:'No. of tickets',color:'#d5dbdb',font:{size:12}}},x:{ticks:{font:{size:10}},title:{display:true,text:'Week ('+windowText+')',color:'#d5dbdb',font:{size:12}}}}}});

    // SLA compliance per week — wave (filled, smooth) area chart.
    if(m.slaByWeek&&m.slaByWeek.length){
      const slaLabels=m.slaByWeek.map(w=>w.week);
      const slaData=m.slaByWeek.map(w=>w.pct);
      mkChart('cSlaWave',{type:'line',data:{labels:slaLabels,datasets:[{label:'SLA % (≤240h)',data:slaData,borderColor:'#4ade80',backgroundColor:(ctx)=>{const c=ctx.chart.ctx;const g=c.createLinearGradient(0,0,0,340);g.addColorStop(0,'rgba(74,222,128,.35)');g.addColorStop(1,'rgba(74,222,128,.02)');return g;},fill:true,tension:.45,pointRadius:3,pointBackgroundColor:'#4ade80',spanGaps:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{title:(items)=>'Week '+items[0].label,label:(c)=>{const w=m.slaByWeek[c.dataIndex];return (c.raw==null?'No resolutions':c.raw+'% within SLA')+(w?(' ('+w.within+'/'+w.resolved+')'):'');}}}},scales:{y:{beginAtZero:true,max:100,title:{display:true,text:'SLA % (≤240 hrs)',color:'#d5dbdb',font:{size:12}},ticks:{callback:v=>v+'%'}},x:{ticks:{font:{size:10}},title:{display:true,text:'Week ('+windowText+')',color:'#d5dbdb',font:{size:12}}}}}});
    }

    renderResolutionAlternatives(resTypeEntries);
  }else{
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
  }
  if(isQ2){
    renderRootCauseGroups('rcGroups',m.rcXregion);
  }else{
    // Cross-tab tables
    renderCrossTab('rcRegionTable',m.rcXregion,m.regions.slice(0,8).map(e=>e[0]),10);
  }
}

// ===== Root-cause grouping (Q2 view) =====
// Canonical group definitions. Each group lists the raw root-cause titles (as they appear in the data)
// that belong to it. Any raw value not matched falls into "Miscellaneous / Other".
const RC_GROUPS=[
  ['Pets / Animals',['Unsecured Animal (CX Pet)','Unsecured Animal (Non-CX Pet/ Other)','Dog Bite First Occurrence','Repeat Pet Incident (2nd occurrence -not','Dog Bite Repeat 2nd Occurrence','Unsecured animal','Attack w/ Pet','Unsecured Animal','Dog Bite Repeat 3rd Occurrence','Dog Evasion First Occurrence','Dog Evasion Repeat 2nd Occurrence','Repeat Pet incident - incident 3rd+ occu','Repeat Pet incident - incident 4th+ occu','Dog Evasion Repeat 3rd Occurrence','Dog Evasion Repeat 4th+ Occurrence','Unsecured Animal Attack (Non-CX Pet/ Oth','Dog Bite Repeat 4th+ Occurrence']],
  ['Not Applicable / No Action / Undetermined',['NOT APPLICABLE/No Further Action Require','Undetermined','Unknown','NOT APPLICABLE','Not Amazon related','No Further Action by PHD Team','DO NOT USE *****']],
  ['Aggression / Abusive Behavior',['Aggressive CX (unprovoked)','Aggressive CM (unprovoked)','Yelling/Abusive Behavior','Name Calling']],
  ['Harassment / Intimidation / Discrimination',['Harassment/Intimidation','Discriminatory Harassment','Inappropriate Racial Comments','Inappropriate Conduct','Inappropriate Sexual Comments','Written Harassment','Sexual Harassment (Verbal)','Indecent Exposure','Signage/Paraphernalia']],
  ['Threats',['Verbal Threat','Written Threat']],
  ['Weapons',['Weapon present (no threat - 1st incident','Armed w/ Weapon','Weapon Pointed at Driver','Attack w/ Weapon','Shots Fired','Incidents: Customer/3P - Weapon Display ']],
  ['Physical Violence / Assault',['Physical Altercation','Sexual Assault (Physical)','Critical Injury','Near Miss','Failure to de-escalate']],
  ['Robbery / Theft',['Robbery w/o Weapon','Armed Robbery']],
  ['Delivery Instructions / Process',['Not following delivery instructions','OTP Confusion','CX Unfamiliar with Delivery Process','Unexpected Delivery Time','Missing Delivery Instructions','Previous Delivery Experience','Missing delivery instructions','Transporter felt unsafe (No Interaction)','Transporter felt unsafe (no interaction)','Inaccurate Delivery Instructions','Previous delivery experience','Inappropriate Delivery Notes','Customer Service Escalation']],
  ['Package Handling / Delivery Outcome',['Package Handling','Wrong/No Package Delivered','Wrong Package Delivered','Empty Package at delivery']],
  ['Location / Access / Routing (Geo & Address)',['Routing Issue','Geo Pin','Access Code Defect','Routing issue']],
  ['Parking / Access Obstruction',['Parking Dispute','Impeding Egress','Blocking Driveway','Double Parking']],
  ['Driving Behavior / Road',['Driving Behavior - Other','Speeding','Road Rage','Vehicle Collision','Vehicle Unsecured']],
  ['Driver Conduct / False Reports',['Driver Embellished/False Report','Embellished/False Report','Driver false report','Embellished Report','Transporter Misconduct','Failure to follow standard work','Opportunity']],
  ['Property Damage / Vandalism',['Property Damage','Minor Property Damage','Vandalism','Minor property damage']],
  ['Targeting / Following',['Transporter being followed','Driver targeted','Amazon/Driver targeted','Collusion','Repeat Customer Incident']],
  ['Miscellaneous / Other',['Misidentification']]
];

function renderRootCauseGroups(elId,rcXregion){
  const el=document.getElementById(elId);if(!el)return;
  // total count per raw root cause, plus the per-region map
  const totals={},regionMap={};
  Object.entries(rcXregion).forEach(([k,v])=>{totals[k]=Object.values(v).reduce((s,x)=>s+x,0);regionMap[k]=v;});
  // region chips (sorted desc) for a given root cause
  const regionChips=(rc)=>{
    const regs=Object.entries(regionMap[rc]||{}).sort((a,b)=>b[1]-a[1]);
    if(!regs.length)return'';
    return`<div class="rc-regions">${regs.map(([r,c])=>`<span class="rc-region-chip">${r}<b>${c.toLocaleString()}</b></span>`).join('')}</div>`;
  };
  const assigned=new Set();
  const groups=RC_GROUPS.map(([name,items])=>{
    const rows=items.filter(it=>totals[it]!==undefined).map(it=>{assigned.add(it);return[it,totals[it]];}).sort((a,b)=>b[1]-a[1]);
    const total=rows.reduce((s,r)=>s+r[1],0);
    // group-level region rollup
    const grpReg={};rows.forEach(([k])=>{Object.entries(regionMap[k]||{}).forEach(([r,c])=>{grpReg[r]=(grpReg[r]||0)+c;});});
    return{name,rows,total,grpReg};
  });
  // Sweep up any unassigned raw values into Miscellaneous / Other
  const leftovers=Object.keys(totals).filter(k=>!assigned.has(k)).map(k=>[k,totals[k]]).sort((a,b)=>b[1]-a[1]);
  if(leftovers.length){
    let misc=groups.find(g=>g.name==='Miscellaneous / Other');
    if(!misc){misc={name:'Miscellaneous / Other',rows:[],total:0,grpReg:{}};groups.push(misc);}
    leftovers.forEach(([k,v])=>{misc.rows.push([k,v]);misc.total+=v;Object.entries(regionMap[k]||{}).forEach(([r,c])=>{misc.grpReg[r]=(misc.grpReg[r]||0)+c;});});
    misc.rows.sort((a,b)=>b[1]-a[1]);
  }
  // Drop empty groups, sort groups by total desc
  const visible=groups.filter(g=>g.rows.length>0).sort((a,b)=>b.total-a.total);
  const grpRegionChips=(gr)=>{const regs=Object.entries(gr).sort((a,b)=>b[1]-a[1]);return regs.length?`<div class="rc-regions rc-regions-group">${regs.map(([r,c])=>`<span class="rc-region-chip">${r}<b>${c.toLocaleString()}</b></span>`).join('')}</div>`:'';};
  const grandTotal=visible.reduce((s,g)=>s+g.total,0);
  el.innerHTML=`<table class="rc-table"><thead><tr><th style="width:38px">#</th><th>Root Cause Group</th><th style="width:110px;text-align:right">Tickets</th><th style="width:90px;text-align:right">Share</th></tr></thead><tbody>
    ${visible.map((g,i)=>`
      <tr class="rc-grow" data-idx="${i}">
        <td class="rc-idx">${i+1}</td>
        <td class="rc-gname"><span class="rc-caret">▶</span>${g.name}</td>
        <td class="rc-gcount">${g.total.toLocaleString()}</td>
        <td class="rc-gshare">${(g.total/grandTotal*100).toFixed(1)}%</td>
      </tr>
      <tr class="rc-detail-row" id="rcBody${i}" hidden>
        <td></td>
        <td colspan="3">
          <div class="rc-group-regions"><span class="rc-regions-label">Regions (group total)</span>${grpRegionChips(g.grpReg)}</div>
          <table class="rc-subtable"><thead><tr><th>Root Cause</th><th style="width:90px;text-align:right">Tickets</th><th style="width:55%">Regions</th></tr></thead><tbody>
            ${g.rows.map(([k,v])=>`<tr>
              <td class="rc-item-name">${k}</td>
              <td class="rc-item-count">${v.toLocaleString()}</td>
              <td>${regionChips(k)}</td>
            </tr>`).join('')}
          </tbody></table>
        </td>
      </tr>`).join('')}
  </tbody></table>`;
  // Accordion: only one open at a time
  el.querySelectorAll('tr.rc-grow').forEach(row=>{
    row.addEventListener('click',()=>{
      const idx=row.getAttribute('data-idx');
      const body=document.getElementById('rcBody'+idx);
      const isOpen=!body.hidden;
      // close all
      el.querySelectorAll('.rc-detail-row').forEach(b=>b.hidden=true);
      el.querySelectorAll('tr.rc-grow').forEach(h=>h.classList.remove('open'));
      // open clicked one if it was closed
      if(!isOpen){body.hidden=false;row.classList.add('open');}
    });
  });
}

// ===== Incident Type -> Agent -> Tickets drill-down modal (Q2 only) =====
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function openIncidentModal(incType){
  const data=(window.__incidentAgents||{})[incType]||{};
  const agents=Object.entries(data).map(([name,tickets])=>[name,tickets]).sort((a,b)=>b[1].length-a[1].length);
  const total=agents.reduce((s,[,t])=>s+t.length,0);
  const bd=document.getElementById('incModalBg');
  const body=document.getElementById('incModalBody');
  document.getElementById('incModalTitle').textContent=incType;
  document.getElementById('incModalSub').textContent=`${total.toLocaleString()} tickets · ${agents.length} agent${agents.length===1?'':'s'}`;
  if(!agents.length){
    body.innerHTML='<p style="color:#879596;padding:20px">No agent data available for this incident type.</p>';
  }else{
    body.innerHTML=`<div class="inc-agent-list">${agents.map(([name,tickets],i)=>`
      <div class="inc-agent">
        <button type="button" class="inc-agent-head" data-idx="${i}" aria-expanded="false">
          <span class="inc-caret">▶</span>
          <span class="inc-agent-name">${escapeHtml(name)}</span>
          <span class="inc-agent-count">${tickets.length.toLocaleString()}</span>
        </button>
        <div class="inc-agent-body" id="incAgentBody${i}" hidden>
          <table class="inc-ticket-table"><thead><tr><th>#</th><th>Ticket ID</th><th>Resolved</th></tr></thead><tbody>
            ${tickets.slice().sort((a,b)=>(b.resolved||'').localeCompare(a.resolved||'')).map((t,j)=>`<tr>
              <td>${j+1}</td>
              <td>${t.url?`<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.id||'(no id)')}</a>`:escapeHtml(t.id||'(no id)')}</td>
              <td>${escapeHtml(t.resolved||'—')}</td>
            </tr>`).join('')}
          </tbody></table>
        </div>
      </div>`).join('')}</div>`;
    // accordion within modal: one agent open at a time
    body.querySelectorAll('.inc-agent-head').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const idx=btn.getAttribute('data-idx');
        const ab=document.getElementById('incAgentBody'+idx);
        const isOpen=!ab.hidden;
        body.querySelectorAll('.inc-agent-body').forEach(b=>b.hidden=true);
        body.querySelectorAll('.inc-agent-head').forEach(h=>{h.setAttribute('aria-expanded','false');h.classList.remove('open');});
        if(!isOpen){ab.hidden=false;btn.setAttribute('aria-expanded','true');btn.classList.add('open');}
      });
    });
  }
  bd.style.display='flex';
}
function closeIncidentModal(){const bd=document.getElementById('incModalBg');if(bd)bd.style.display='none';}

// ===== Canonicalize resolution-type labels (Q2) — merge mis-typed variants =====
// Explicit mappings per the agreed families; anything else keeps a lightly-cleaned form.
function canonResolutionType(raw){
  // Strip leading "- ", bracket tags like [#cx-reassurance ], trailing punctuation, collapse spaces.
  let t=String(raw).replace(/^-\s*/,'').replace(/\[[^\]]*\]/g,'').replace(/\s+/g,' ').replace(/[.\s]+$/,'').trim();
  const low=t.toLowerCase().replace(/\s*-\s*/g,' ').replace(/\s+/g,' ').trim();// normalize "follow - up" -> "follow up"
  if(low.startsWith('customer reassurance')||low==='customer reassurance')return'Customer Reassurance';
  if(/^driver follow ?up$/.test(low)||low==='driver followup'||low==='driver follow up')return'Driver Follow-up';
  if(low.startsWith('delivery hint'))return'Delivery Hint';
  if(low.startsWith('address exclusion'))return'Address Exclusion';
  if(low.startsWith('parcel box'))return'Parcel Box Install';
  if(low.startsWith('geopin')||low.startsWith('geo pin'))return'Geopin Update';
  if(low.startsWith('insufficient information'))return'Insufficient Information';
  return t;// fallback: cleaned original
}

// ===== Resolution Type visualization (Q2 only): sorted horizontal bar =====
function renderResolutionAlternatives(entries){
  if(!entries||!entries.length)return;
  const sorted=[...entries].sort((a,b)=>b[1]-a[1]);
  const labels=sorted.map(e=>e[0]);
  const data=sorted.map(e=>e[1]);
  const grand=data.reduce((s,v)=>s+v,0);
  const palette=Array.from({length:labels.length},(_,i)=>COLORS[i%COLORS.length]);
  // Horizontal bar, sorted descending; tooltip shows count + % of total
  mkChart('cResBar',{type:'bar',data:{labels,datasets:[{data,backgroundColor:palette,borderRadius:3}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>`${c.raw.toLocaleString()} (${(c.raw/grand*100).toFixed(1)}%)`}}},scales:{x:{beginAtZero:true,title:{display:true,text:'Tickets',color:'#d5dbdb'}},y:{ticks:{font:{size:10},autoSkip:false}}}}});
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
  // Show a loading shimmer immediately (esp. for DB-backed quarters which may hit Render cold start).
  const ds=qparam('ds');
  const loadingNote=(ds==='quarter')?'Loading quarter data from the database…':'Loading report…';
  if(window.PHDAuth&&window.PHDAuth.skeletonDashboard){
    document.getElementById('app').innerHTML=window.PHDAuth.skeletonDashboard(loadingNote);
  }
  try{
    const result=await loadMetrics();
    if(!result){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Dashboard not found</h2><p style="color:#879596">This archive could not be loaded. <a href="index.html" style="color:#44b9d6">Return home</a></p></div></div>';return;}
    render(result.metrics,result.name,qparam('ds'));
  }catch(e){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Error loading dashboard</h2><p style="color:#879596">'+e.message+'</p></div></div>';}
})();
