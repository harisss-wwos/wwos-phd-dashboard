// Archive dashboard renderer - reads precomputed metrics JSON
const COLORS=['#ff9900','#2074d5','#1d8102','#d13212','#1b9cb0','#8c6bb1','#44b9d6','#ec7211','#3ecf4a','#879596','#ffb84d','#5b9bd5','#ff5252','#2ecc71','#e67e22','#9b59b6'];
const charts=[];
const DB_NAME='phd_archive_db',STORE='archives';

function openDB(){return new Promise((res,rej)=>{const rq=indexedDB.open(DB_NAME,1);rq.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});};rq.onsuccess=e=>res(e.target.result);rq.onerror=e=>rej(e.target.error);});}
async function dbGet(key){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const rq=tx.objectStore(STORE).get(key);rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});}
async function dbPut(key,metrics,name,publishedAt){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({key,metrics,name,publishedAt:publishedAt||null});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

// Background revalidation for a cached quarter: fetch fresh, and if the quarter's publishedAt
// changed since we cached it, recompute + re-cache + silently re-render.
async function quarterRevalidate(qid,cacheKey,cachedPublishedAt){
  const banner=window.PHDRefreshBanner;
  try{
    const r=await window.PHDAuth.api('GET','/api/quarter/'+encodeURIComponent(qid));
    if(!r.ok||!r.data){ if(banner)banner.hide(); return; }
    const publishedAt=(r.data.meta&&r.data.meta.publishedAt)||null;
    if((publishedAt||null)===(cachedPublishedAt||null)){ if(banner)banner.upToDate(); return; } // unchanged (a===b) -> reassure, keep cache
    const tickets=(r.data.data&&r.data.data.tickets)||[];
    const metrics=window.QuarterMetrics.compute(tickets,r.data.range||null);
    const name=(r.data.label||qid);
    try{ dbPut(cacheKey,metrics,name,publishedAt); }catch(e){}
    render(metrics,name,'quarter'); // silent swap to the fresh data
    if(banner)banner.updated('Updated with the latest data.');
  }catch(e){ if(banner)banner.hide(); /* offline / cold -> keep the cached view */ }
}

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
  // This is the slow path (large ticket payload + Render cold start), so we cache the COMPUTED
  // metrics in IndexedDB keyed by qid. On revisit we return the cache instantly, then revalidate
  // in the background (re-render if the quarter's publishedAt changed, e.g. a past-quarter merge).
  if(ds==='quarter'){
    const qid=qparam('qid');
    if(!qid||!window.QuarterMetrics)throw new Error('Quarter view unavailable.');
    const cacheKey='quarterMetrics_'+qid+'_'+SCHEMA_VER;
    let cachedRec=null;
    try{ cachedRec=await Promise.race([dbGet(cacheKey),new Promise(r=>setTimeout(()=>r(null),1200))]); }catch(e){}
    if(cachedRec&&cachedRec.metrics){
      // Instant paint from cache; revalidate in the background (with the shared refresh banner).
      if(window.PHDRefreshBanner)window.PHDRefreshBanner.show();
      quarterRevalidate(qid,cacheKey,cachedRec.publishedAt||null);
      return {metrics:cachedRec.metrics,name:cachedRec.name,ds:'quarter'};
    }
    const r=await window.PHDAuth.api('GET','/api/quarter/'+encodeURIComponent(qid));
    if(!r.ok||!r.data)throw new Error('Could not load quarter '+qid+' (HTTP '+(r.status||'?')+')');
    const tickets=(r.data.data&&r.data.data.tickets)||[];
    const range=r.data.range||null;
    const metrics=window.QuarterMetrics.compute(tickets,range);
    const name=(r.data.label||qid);
    const publishedAt=(r.data.meta&&r.data.meta.publishedAt)||null;
    try{ dbPut(cacheKey,metrics,name,publishedAt); }catch(e){}
    return {metrics,name,ds:'quarter'};
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

// Inline-SVG icon helper (icons.js). Returns '' if unavailable so markup stays clean.
function ic(name,size){return (typeof window.icon==='function')?window.icon(name,size||15):'';}

// ===== Program History quarter selection (checkbox tree) — aggregate selected quarters =====
// The pre-WWOS era, grouped era -> year -> quarter. Only these quarters exist in ARCHIVE_QUARTERS.
const PH_TREE=[
  { year:'2025', quarters:['2025-Q3','2025-Q2','2025-Q1'] },
  { year:'2024', quarters:['2024-Q4','2024-Q3','2024-Q2','2024-Q1'] },
  { year:'2023', quarters:['2023-Q4','2023-Q3','2023-Q2','2023-Q1'] },
  { year:'2022', quarters:['2022-Q4','2022-Q3','2022-Q2','2022-Q1'] },
  { year:'2021', quarters:['2021-Q4','2021-Q3','2021-Q2','2021-Q1'] },
];
const PH_ALL_QIDS=PH_TREE.reduce(function(a,y){return a.concat(y.quarters);},[]);
let PH_SELECTED=PH_ALL_QIDS.slice(); // default: Program History (all quarters) selected

// Merge helpers for the metrics shape (mirrors gaSumData in agent-analytics).
function _mergeEntryList(target,list){ (list||[]).forEach(function(e){ target[e[0]]=(target[e[0]]||0)+e[1]; }); }
function _entriesSorted(map,limit){ var a=Object.entries(map).sort(function(x,y){return y[1]-x[1];}); return limit?a.slice(0,limit):a; }
function _entriesByKey(map){ return Object.entries(map).sort(function(x,y){return x[0].localeCompare(y[0]);}); }
function _deepMergeXtab(target,src){ Object.keys(src||{}).forEach(function(row){ target[row]=target[row]||{}; Object.keys(src[row]).forEach(function(col){ target[row][col]=(target[row][col]||0)+src[row][col]; }); }); }

// Sum a set of quarter-metrics objects into ONE combined metrics object matching render()'s needs.
function sumQuarterMetrics(qids){
  const src=(window.ARCHIVE_QUARTERS)||{};
  const list=qids.map(function(q){return src[q];}).filter(Boolean);
  if(!list.length) return null;

  let total=0,resolvedClosed=0,open=0,reopen=0,hiTotal=0,hiRepeat=0;
  // Weighted accumulators for averages we can't exactly reconstruct (avgRes/median) — approximate
  // avg via total-weighting; median across quarters isn't exact, so approximate with a weighted avg
  // of medians. slaPct recomputed from resolved-with-hours counts is exact-ish; we use slaByWeek sums.
  let avgResSum=0,avgResN=0;
  const statuses={},closureCodes={},severities={},rootCauses={},assignees={},resolvers={},regions={},driverTypes={},resolutionTypes={},incidentTypes={},parties={};
  const createdByYear={},resolvedByYear={},createdByMonth={},resolvedByMonth={},createdByQuarter={},resolvedByQuarter={};
  const hiDist={'0':0,'1':0,'2':0,'3+':0};
  const rcXregion={},driverXincident={},regionXincident={},incidentAgents={};
  let slaResolved=0,slaWithin=0;
  let dmin=null,dmax=null;
  let phdResolvers=[];

  list.forEach(function(m){
    total+=m.total||0; resolvedClosed+=m.resolvedClosed||0; open+=m.open||0; reopen+=m.reopen||0;
    hiTotal+=m.hiTotal||0; hiRepeat+=m.hiRepeat||0;
    if(m.avgRes&&m.total){ avgResSum+=m.avgRes*m.total; avgResN+=m.total; }
    _mergeEntryList(statuses,m.statuses); _mergeEntryList(closureCodes,m.closureCodes); _mergeEntryList(severities,m.severities);
    _mergeEntryList(rootCauses,m.rootCauses); _mergeEntryList(assignees,m.assignees); _mergeEntryList(resolvers,m.resolvers);
    _mergeEntryList(regions,m.regions); _mergeEntryList(driverTypes,m.driverTypes); _mergeEntryList(resolutionTypes,m.resolutionTypes);
    _mergeEntryList(incidentTypes,m.incidentTypes); _mergeEntryList(parties,m.parties);
    _mergeEntryList(createdByYear,m.createdByYear); _mergeEntryList(resolvedByYear,m.resolvedByYear);
    _mergeEntryList(createdByMonth,m.createdByMonth); _mergeEntryList(resolvedByMonth,m.resolvedByMonth);
    _mergeEntryList(createdByQuarter,m.createdByQuarter); _mergeEntryList(resolvedByQuarter,m.resolvedByQuarter);
    if(m.hiDist){ ['0','1','2','3+'].forEach(function(k){ hiDist[k]+=(m.hiDist[k]||0); }); }
    _deepMergeXtab(rcXregion,m.rcXregion); _deepMergeXtab(driverXincident,m.driverXincident); _deepMergeXtab(regionXincident,m.regionXincident);
    // Incident-agent drill-down: bucket -> agent -> [tickets]; concat lists.
    Object.keys(m.incidentAgents||{}).forEach(function(b){ incidentAgents[b]=incidentAgents[b]||{}; Object.keys(m.incidentAgents[b]).forEach(function(ag){ incidentAgents[b][ag]=(incidentAgents[b][ag]||[]).concat(m.incidentAgents[b][ag]); }); });
    // SLA: sum weekly resolved/within across quarters (each quarter has its own 13-week buckets).
    (m.slaByWeek||[]).forEach(function(w){ slaResolved+=w.resolved||0; slaWithin+=w.within||0; });
    if(m.dateRange){ if(m.dateRange[0]&&(!dmin||m.dateRange[0]<dmin))dmin=m.dateRange[0]; if(m.dateRange[1]&&(!dmax||m.dateRange[1]>dmax))dmax=m.dateRange[1]; }
    if(m.phdResolvers&&m.phdResolvers.length>phdResolvers.length)phdResolvers=m.phdResolvers;
  });

  const createdByYearE=_entriesByKey(createdByYear);
  const years=createdByYearE.map(function(e){return e[0];});
  const yoy=years.map(function(y,i){ if(i===0)return{year:y,count:createdByYear[y],growth:null}; var prev=createdByYear[years[i-1]]; return {year:y,count:createdByYear[y],growth:prev?(((createdByYear[y]-prev)/prev)*100).toFixed(1):null}; });

  return {
    total:total, resolvedClosed:resolvedClosed, open:open, reopen:reopen,
    resolutionRate: total?+(resolvedClosed/total*100).toFixed(1):0,
    avgRes: avgResN?+(avgResSum/avgResN).toFixed(1):0,
    medianRes: 0, minRes:0, maxRes:0, avgAge:0, medianAge:0,
    slaHrs:240, slaPct: slaResolved?+(slaWithin/slaResolved*100).toFixed(1):0,
    hiTotal:hiTotal, hiRepeat:hiRepeat, hiRepeatPct: hiTotal?+(hiRepeat/hiTotal*100).toFixed(1):0, hiDist:hiDist,
    dateRange:[dmin||'',dmax||''],
    statuses:_entriesSorted(statuses), closureCodes:_entriesSorted(closureCodes), severities:_entriesSorted(severities),
    rootCauses:_entriesSorted(rootCauses,20), assignees:_entriesSorted(assignees,25), resolvers:_entriesSorted(resolvers),
    regions:_entriesSorted(regions), driverTypes:_entriesSorted(driverTypes,12), resolutionTypes:_entriesSorted(resolutionTypes,15),
    incidentTypes:_entriesSorted(incidentTypes,20), parties:_entriesSorted(parties), phdResolvers:phdResolvers,
    createdByYear:createdByYearE, resolvedByYear:_entriesByKey(resolvedByYear),
    createdByMonth:_entriesByKey(createdByMonth), resolvedByMonth:_entriesByKey(resolvedByMonth),
    createdByQuarter:_entriesByKey(createdByQuarter), resolvedByQuarter:_entriesByKey(resolvedByQuarter),
    yoy:yoy, rcXregion:rcXregion, driverXincident:driverXincident, regionXincident:regionXincident, incidentAgents:incidentAgents,
    // weekly buckets aren't meaningful across multiple quarters -> leave empty (archive layout doesn't use them)
    createdByWeek:[], resolvedByWeek:[], slaByWeek:[], sevByYear:{}, resTrendLabels:[], resTrendData:[],
    uniqAssignees:0, uniqResolvers:0, uniqStations:0
  };
}

// Destroy all Chart.js instances (render() rebuilds #app on every toggle; avoid leaking charts).
function destroyArchiveCharts(){ try{ charts.forEach(function(c){ try{c.destroy();}catch(e){} }); charts.length=0; }catch(e){} }

// Chart-loading spinner overlay — only for DB-backed quarter reports (ds=quarter). Placed inside
// a .chart-wrap; removed by clearChartSpinners() once charts have drawn.
function cspin(){return (qparam('ds')==='quarter')?'<div class="chart-spin"><div class="spinner"></div></div>':'';}
function clearChartSpinners(){document.querySelectorAll('.chart-spin').forEach(function(el){el.remove();});}

// Collapsible section wrapper. titleHtml may include an icon; bodyHtml is the content.
// open=true renders expanded; header is a button that toggles the body.
let _collapseId=0;
function collapsible(titleHtml,bodyHtml,open,colorCls){
  const id='cs'+(++_collapseId);
  return '<div class="section collapsible'+(open?' open':'')+(colorCls?(' '+colorCls):'')+'" id="'+id+'">'+
    '<h2 class="collapse-head" role="button" tabindex="0" aria-expanded="'+(open?'true':'false')+'" onclick="toggleCollapse(this)" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleCollapse(this);}">'+
      '<span class="collapse-title">'+titleHtml+'</span><span class="collapse-caret" aria-hidden="true">▾</span>'+
    '</h2>'+
    '<div class="collapse-body">'+bodyHtml+'</div>'+
  '</div>';
}
// Two sub-tables side by side inside one big section (stacks on narrow screens).
function phTwoCol(titleA,htmlA,titleB,htmlB){
  return '<div class="ph-2col">'+
    '<div class="ph-col"><h3 class="ph-col-title">'+titleA+'</h3>'+htmlA+'</div>'+
    '<div class="ph-col"><h3 class="ph-col-title">'+titleB+'</h3>'+htmlB+'</div>'+
  '</div>';
}
function toggleCollapse(headEl){
  const sec=headEl.closest('.collapsible');if(!sec)return;
  const willOpen=!sec.classList.contains('open');
  // Accordion: close every OTHER collapsible section so only one is open at a time.
  if(willOpen){
    var scope=sec.parentElement||document;
    scope.querySelectorAll('.section.collapsible.open').forEach(function(other){
      if(other!==sec){ other.classList.remove('open'); var h=other.querySelector('.collapse-head'); if(h)h.setAttribute('aria-expanded','false'); }
    });
  }
  const isOpen=sec.classList.toggle('open');
  headEl.setAttribute('aria-expanded',isOpen?'true':'false');
  // When expanding, resize any Chart.js canvas inside AFTER the ~300ms expand animation.
  if(isOpen){
    setTimeout(function(){
      sec.querySelectorAll('canvas').forEach(function(cv){
        try{ var ch=(window.Chart&&window.Chart.getChart)?window.Chart.getChart(cv):null; if(ch)ch.resize(); }catch(e){}
      });
    },340);
  }
}

// Replace KPI number spinners with their real values after a short delay (mimics a DB fetch).
// Animate each Summary KPI from a random "scramble" into its real value, then a quick count-up
// that settles exactly on the target. Handles plain counts (7,136), percentages (88.7%), and 0.
// While the DB data loads, flicker random numbers in every .scramble-kpi so the Summary Statistics
// look alive instead of spinning. Stopped (stopKpiScramble) the moment the real render takes over.
var _kpiScrTimer=null;
function startKpiScramble(){
  stopKpiScramble();
  var tick=function(){
    var els=document.querySelectorAll('.scramble-kpi');
    if(!els.length){stopKpiScramble();return;}
    els.forEach(function(el){
      var max=parseInt(el.getAttribute('data-scr-max'),10)||100;
      var pct=el.getAttribute('data-scr-pct')==='1';
      var n=Math.random()*max;
      el.textContent=pct?(n.toFixed(1)+'%'):Math.floor(n).toLocaleString();
    });
  };
  tick();
  _kpiScrTimer=setInterval(tick,70);
}
function stopKpiScramble(){ if(_kpiScrTimer){clearInterval(_kpiScrTimer);_kpiScrTimer=null;} }

function fillKpiNumbers(delay){
  var raf=window.requestAnimationFrame||function(cb){return setTimeout(function(){cb(Date.now());},16);};
  setTimeout(function(){
    document.querySelectorAll('.kpi-num[data-val]').forEach(function(el){
      var raw=el.getAttribute('data-val')||'';
      // Whatever happens, never leave a stuck spinner: show the real value on any failure.
      try{
        var isPct=/%\s*$/.test(raw);
        var m=raw.match(/\.(\d+)/);
        var decimals=(m&&m[1])?m[1].length:0;                  // e.g. "88.7%" -> 1 decimal
        var target=parseFloat(raw.replace(/[^0-9.\-]/g,''));
        if(isNaN(target)){ el.textContent=raw; return; }       // non-numeric -> just show it
        var fmt=function(n){
          var s=isPct?n.toFixed(decimals):Math.round(n).toLocaleString();
          return isPct?(s+'%'):s;
        };
        el.textContent=fmt(target*0);                          // clear any spinner immediately
        var SCRAMBLE_MS=150, COUNT_MS=750, start=null;         // shell already scrambled; brief blend then count up
        var scrMax=Math.max(10, isPct?100:target*1.3);         // plausible flicker range
        var step=function(ts){
          try{
            if(start===null)start=ts;
            var t=ts-start;
            if(t<SCRAMBLE_MS){ el.textContent=fmt(Math.random()*scrMax); raf(step); }
            else if(t<SCRAMBLE_MS+COUNT_MS){ var p=(t-SCRAMBLE_MS)/COUNT_MS; el.textContent=fmt(target*(1-Math.pow(1-p,3))); raf(step); }
            else { el.textContent=raw; }                       // land exactly on the real value
          }catch(err){ el.textContent=raw; }
        };
        raf(step);
      }catch(err){ el.textContent=raw; }
    });
  }, delay||300);
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

function render(metrics,name,ds,targetId){
  stopKpiScramble(); // shell scramble handed off to the real count-up below
  destroyArchiveCharts(); // clear any prior Chart.js instances (archive filter re-renders repeatedly)
  const m=metrics;
  const TARGET=targetId||'app';
  // Program History: hide the cross-period trend sections (Yearly/Quarterly/Monthly/YoY) when a
  // SINGLE quarter is selected — a lone quarter has no meaningful multi-period trend.
  const multiPeriod=(ds!=='archive')||(typeof PH_SELECTED!=='undefined'&&PH_SELECTED.length>1);
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
  // Q2 (static OR dynamic) shows its fixed window; other dynamic quarters + archive use computed range.
  const _qidRT=quarterMode?qparam('qid'):'';
  const rangeText=(ds==='q2'||_qidRT==='2026-Q2')?'31st March 2026 to 30th June 2026':`${fmtDate(m.dateRange[0])} to ${fmtDate(m.dateRange[1])}`;
  // Short window label for weekly chart titles, e.g. "(Apr 1 – Jun 30, 2026)".
  const shortD=(iso)=>{const d=new Date(iso+'T00:00:00');return isNaN(d)?iso:d.toLocaleString('en-US',{month:'short',day:'numeric'});};
  const windowText=(ds==='q2')?'Apr 1 – Jun 30, 2026':(m.dateRange&&m.dateRange[0]?`${shortD(m.dateRange[0])} – ${shortD(m.dateRange[1])}`:'this quarter');
  // Admin-only "upload/merge into this quarter" control (past/non-live quarters only).
  const loggedIn=quarterMode && window.PHDAuth && window.PHDAuth.getUser && window.PHDAuth.getUser();
  const canMerge=quarterMode && window.PHDAuth && window.PHDAuth.atLeast && window.PHDAuth.atLeast('admin');
  const qid=quarterMode?qparam('qid'):'';
  const logBtn=loggedIn?`<a class="btn sec pt-btn" href="data-log.html?qid=${encodeURIComponent(qid)}" title="Update data log">${ic('history')}<span class="btn-label">Update data log</span></a>`:'';
  const mergeBtn=canMerge?`<label class="btn pt-btn" style="cursor:pointer" title="Upload / merge into this quarter">${ic('upload')}<span class="btn-label">Upload / merge into this quarter</span><input type="file" accept=".csv" id="qMergeFile" style="display:none"></label>`:'';
  const actions=(logBtn||mergeBtn)?`<div class="pt-actions">${logBtn}${mergeBtn}</div>`:'';
  document.getElementById(TARGET).innerHTML=`<div class="content">
    <div class="page-title" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:220px"><h1>${quarterMode ? name : 'Program History: Jan 2021 – Mar 2026'.replace('Program History:', '<span class="ph-full">Program History:</span><span class="ph-short">PH:</span>')}</h1>${quarterMode
        ? `<p style="line-height:1.6"><span style="display:block">Data range: ${rangeText}</span><span style="display:block">${m.total.toLocaleString()} total tickets</span></p>`
        : `<p style="line-height:1.6"><span style="display:block">Data range: ${rangeText}</span><span style="display:block">${m.total.toLocaleString()} total tickets · Read-only archive</span></p>`}</div>
      ${actions}
    </div>

    <div class="section sec-purple"><h2>${ic('bar-chart',18)} Summary Statistics</h2>
    <div class="kpi-grid">
      <div class="kpi-card accent"><div class="value kpi-num" data-val="${m.total.toLocaleString()}"><span class="num-spinner"></span></div><div class="label">${ic('ticket',13)} Total Tickets</div></div>
      <div class="kpi-card success"><div class="value kpi-num" data-val="${m.resolvedClosed.toLocaleString()}"><span class="num-spinner"></span></div><div class="label">${ic('check-circle',13)} Resolved / Closed</div></div>
      <div class="kpi-card warning"><div class="value kpi-num" data-val="${m.open.toLocaleString()}"><span class="num-spinner"></span></div><div class="label">${ic('hourglass',13)} Open</div></div>
      <div class="kpi-card success"><div class="value kpi-num" data-val="${m.slaPct}%"><span class="num-spinner"></span></div><div class="label">${ic('target',13)} SLA ≤${m.slaHrs}hrs</div></div>
      <div class="kpi-card warning"><div class="value kpi-num" data-val="${m.hiRepeatPct}%"><span class="num-spinner"></span></div><div class="label">${ic('repeat',13)} Repeat Offenders (HI>0)</div></div>
    </div></div>

    ${isQ2?`
    ${collapsible(ic('bar-chart',18)+' Resolution Type',
      '<div class="chart-box"><div class="chart-wrap tall">'+cspin()+'<canvas id="cResBar"></canvas></div></div>', true, 'sec-blue')}
    ${collapsible(ic('bar-chart',18)+' Incident Types',
      '<div class="chart-box"><div class="chart-wrap tall">'+cspin()+'<canvas id="cIncident"></canvas></div></div>', true, 'sec-rose')}
    ${collapsible(ic('globe',18)+' Geography / Region — Count',
      '<div class="tbl-card"><table style="width:100%"><thead><tr><th>#</th><th>Region</th><th>Number of Cases</th></tr></thead><tbody>'+
      m.regions.map(([k,v],i)=>'<tr><td>'+(i+1)+'</td><td><strong>'+k+'</strong></td><td>'+v.toLocaleString()+'</td></tr>').join('')+
      '</tbody></table></div>', true, 'sec-teal')}
    ${collapsible(ic('users',18)+' Resolver Volume — PHD Team (WWOS)',
      '<div class="tbl-card"><table style="width:100%"><thead><tr><th>#</th><th>Resolver</th><th>Tickets Resolved</th></tr></thead><tbody>'+
      (phdRes.map(([k,v],i)=>'<tr><td>'+(i+1)+'</td><td><strong>'+k+'</strong><span class="phd-badge">PHD</span></td><td>'+v+'</td></tr>').join('')||'<tr><td colspan="3" style="color:#879596">No PHD resolvers in this dataset</td></tr>')+
      '</tbody></table></div>', true, 'sec-green')}
    ${collapsible(ic('bar-chart',18)+' Weekly Trends ('+windowText+')',
        '<div class="charts-grid"><div class="chart-box" style="grid-column:1/-1"><h3>Tickets Created per Week</h3><div class="chart-wrap">'+cspin()+'<canvas id="cCreatedWeek"></canvas></div></div>'+
        '<div class="chart-box" style="grid-column:1/-1"><h3>Tickets Resolved per Week</h3><div class="chart-wrap">'+cspin()+'<canvas id="cResolvedWeek"></canvas></div></div></div>', true)}
    ${collapsible(ic('bar-chart',18)+' Created vs Resolved per Week (Backlog Trend)',
        '<div class="charts-grid"><div class="chart-box" style="grid-column:1/-1"><div class="chart-wrap">'+cspin()+'<canvas id="cCvRWeek"></canvas></div></div></div>', true)}
    ${m.slaByWeek?collapsible(ic('check-circle',18)+' SLA Compliance per Week (≤240 hrs)',
      '<p style="color:var(--tm);font-size:.85em;margin:0 0 16px">Percentage of each week\'s resolved tickets that met the 240-hour (10-day) SLA. Weeks are bucketed by resolved date.</p>'+
      '<div class="chart-wrap tall">'+cspin()+'<canvas id="cSlaWave"></canvas></div>', true):''}
    ${collapsible(ic('repeat',18)+' Root Causes by Group','<div id="rcGroups" class="rc-accordion"></div>', true)}
    `:`
    ${multiPeriod?collapsible(ic('bar-chart',18)+' Trends',
      phTwoCol('Yearly Trends &amp; Growth', xlsYearlyTable(m.createdByYear,m.resolvedByYear,m.yoy),
               'Quarterly Trends', xlsTrendTable(m.createdByQuarter,m.resolvedByQuarter,'Quarter')), true, 'sec-cyan'):''}
    ${collapsible(ic('bar-chart',18)+' Analytics Breakdown',
      phTwoCol('Resolution Type', xlsRankTable(m.resolutionTypes,'Resolution Type'),
               'Incident Types <span style="font-size:.78em;color:#879596;font-weight:400">(from Issue field)</span>', xlsRankTable(m.incidentTypes,'Incident Type')), true, 'sec-blue')}
    ${collapsible(ic('globe',18)+' Geography &amp; Root Cause',
      phTwoCol('Geography / Region — Count',
        '<div class="tbl-card"><table class="xls-table" style="width:100%"><thead><tr><th style="width:1%;white-space:nowrap;text-align:center">#</th><th>Region</th><th style="text-align:right">Number of Cases</th></tr></thead><tbody>'+
        m.regions.map(([k,v],i)=>'<tr><td style="text-align:center">'+(i+1)+'</td><td><strong>'+k+'</strong></td><td style="text-align:right">'+v.toLocaleString()+'</td></tr>').join('')+
        '</tbody></table></div>',
        'Root Cause × Region (Cross-Tab)', '<div style="overflow-x:auto" id="rcRegionTable"></div>'), true, 'sec-teal')}
    ${(phdRes&&phdRes.length)?collapsible(ic('users',18)+' Resolver Volume — PHD Team (WWOS)',
      '<div class="tbl-card"><table class="xls-table" style="width:100%"><thead><tr><th style="width:1%;white-space:nowrap;text-align:center">#</th><th>Resolver</th><th style="text-align:right">Tickets Resolved</th></tr></thead><tbody>'+
      phdRes.map(([k,v],i)=>'<tr><td style="text-align:center">'+(i+1)+'</td><td><strong>'+k+'</strong><span class="phd-badge">PHD</span></td><td style="text-align:right">'+v+'</td></tr>').join('')+
      '</tbody></table></div>', true, 'sec-green'):''}
    `}
  </div>`;

  // Data is here — hand the scrambling numbers straight into a count-up that lands on real values.
  fillKpiNumbers(0);

  Chart.defaults.color='#879596';Chart.defaults.borderColor='rgba(255,255,255,0.06)';
  // Q2 only: merge duplicate/mis-typed resolution-type variants into canonical names, then sum counts.
  let resTypeEntries=m.resolutionTypes;
  if(isQ2){
    const merged={};
    (m.resolutionTypes||[]).forEach(([k,v])=>{const name=canonResolutionType(k);merged[name]=(merged[name]||0)+v;});
    resTypeEntries=Object.entries(merged).sort((a,b)=>b[1]-a[1]);
  }
  // (Program History Resolution Type is now an Excel table; Q2 uses a horizontal bar built below.)
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
  }
  // (Program History Incident Types is now an Excel table — no chart.)
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
  }
  // (Program History: Yearly/Quarterly/Monthly trends are all Excel tables now — no charts.)
  if(isQ2){
    renderRootCauseGroups('rcGroups',m.rcXregion);
  }else{
    // Cross-tab tables
    renderCrossTab('rcRegionTable',m.rcXregion,m.regions.slice(0,8).map(e=>e[0]),10);
  }
  // Wire the admin "upload/merge into this quarter" file input (past quarters only).
  if(canMerge){
    const fi=document.getElementById('qMergeFile');
    if(fi)fi.onchange=(e)=>{const f=e.target.files[0];e.target.value='';if(f)mergeIntoQuarter(qid,f);};
  }
  // Charts have drawn — remove the chart-loading spinner overlays (Q2/quarter reports).
  clearChartSpinners();
  // Give every title/heading a hover tooltip with its full text (in case it's truncated).
  addHeadingTitles();
}

// Set a title="" (hover tooltip) on all headings/collapsible titles so truncated text stays readable.
function addHeadingTitles(){
  try{
    document.querySelectorAll('.content h1, .content h2, .content h3, .collapse-title, .page-title p span').forEach(function(el){
      var t=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(t && !el.getAttribute('title'))el.setAttribute('title',t);
    });
  }catch(e){}
}

// ===== Admin: upload/merge a CSV into THIS (past, non-live) quarter =====
// CSV parser (mirrors the app/loader parser: handles quoted fields + embedded newlines).
function parseCSVArchive(text){
  const cells=[];let cur='';let inQ=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(ch==='"'){if(inQ&&text[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;}}
    else if(ch===','&&!inQ){cells.push(cur);cur='';}
    else if((ch==='\n'||ch==='\r')&&!inQ){if(ch==='\r'&&text[i+1]==='\n')i++;cells.push(cur);cur='';cells.push('__RE__');}
    else{cur+=ch;}}
  if(cur)cells.push(cur);cells.push('__RE__');
  const rows=[];let row=[];
  for(const c of cells){if(c==='__RE__'){if(row.length>0)rows.push(row);row=[];}else{row.push(c);}}
  const h=rows[0]||[];const d=[];
  for(let i=1;i<rows.length;i++){const o={};for(let j=0;j<h.length;j++)o[h[j]]=rows[i][j]||'';d.push(o);}
  return d;
}

function archiveOverlay(html){
  const o=document.createElement('div');
  o.className='inc-modal-bg';o.style.display='flex';
  o.onclick=(e)=>{if(e.target===o)o.remove();};
  o.innerHTML=`<div class="inc-modal" style="max-width:80vw;width:80vw"><div class="inc-modal-body" style="padding:22px">${html}</div></div>`;
  document.body.appendChild(o);
  return o;
}

async function mergeIntoQuarter(qid,file){
  const reader=new FileReader();
  reader.onload=async(e)=>{
    let rows;
    try{
      rows=parseCSVArchive(e.target.result).filter(r=>r.ShortId||r.IssueId).map(r=>{if(!r.ShortId&&r.IssueId)r.ShortId=r.IssueId;return r;});
    }catch(err){archiveOverlay('<h2 style="color:#ff5252;margin:0 0 8px">Could not read CSV</h2><p style="color:#879596">The file could not be parsed.</p>');return;}
    if(!rows.length){archiveOverlay('<h2 style="color:#ff5252;margin:0 0 8px">No tickets found</h2><p style="color:#879596">No rows with a ShortId/IssueId were found in the file.</p>');return;}
    const busy=archiveOverlay(`<h2 style="color:#fff;margin:0 0 10px">Merging…</h2><p style="color:#879596">Uploading ${rows.length.toLocaleString()} tickets and merging into ${qid} by ShortId.</p><div class="spinner" style="margin:20px auto"></div>`);
    try{
      const r=await window.PHDAuth.api('POST','/api/quarter/'+encodeURIComponent(qid)+'/merge',{data:{tickets:rows}});
      busy.remove();
      if(!r.ok){archiveOverlay(`<h2 style="color:#ff5252;margin:0 0 8px">Merge failed</h2><p style="color:#879596">${(r.data&&r.data.error)||('HTTP '+r.status)}</p>`);return;}
      const cs=r.data.changeSummary||{};
      const rowLi=(label,val,color)=>`<li style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2a2a2a"><span style="color:#879596">${label}</span><span style="font-weight:700;color:${color||'#fff'}">${(val||0).toLocaleString()}</span></li>`;
      const done=archiveOverlay(`
        <h2 style="color:#3ecf4a;margin:0 0 6px">Merge complete</h2>
        <p style="color:#879596;margin:0 0 14px">${r.data.label} updated. Newly uploaded tickets win on conflict; existing tickets not in the file were kept.</p>
        <ul style="list-style:none;padding:0;margin:0">
          ${rowLi('Uploaded in file',cs.uploaded,'#44b9d6')}
          ${rowLi('New tickets added',cs.added,'#3ecf4a')}
          ${rowLi('Existing tickets updated',cs.updated,'#fbbf24')}
          ${rowLi('Existing tickets preserved',cs.preserved,'#879596')}
          ${rowLi('New quarter total',cs.total,'#ff9900')}
        </ul>
        <p style="color:#879596;font-size:.82em;margin:14px 0 0">Recorded in the data log. Reloading the report…</p>
        <div style="margin-top:16px;text-align:right"><button class="btn" onclick="location.reload()">Reload now</button></div>`);
      setTimeout(()=>location.reload(),2500);
    }catch(err){busy.remove();archiveOverlay('<h2 style="color:#ff5252;margin:0 0 8px">Merge failed</h2><p style="color:#879596">'+err.message+'</p>');}
  };
  reader.readAsText(file);
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

// Excel-style ranked table for [label,count] entry lists: # | <label> | Count | % of Total.
function xlsRankTable(entries,labelHead){
  const list=entries||[];
  const grand=list.reduce(function(s,e){return s+e[1];},0)||1;
  return '<div class="tbl-card"><table class="xls-table" style="width:100%"><thead><tr>'+
    '<th style="width:1%;white-space:nowrap;text-align:center">#</th>'+
    '<th>'+labelHead+'</th>'+
    '<th style="width:1%;white-space:nowrap;text-align:right">Count</th>'+
    '<th style="width:1%;white-space:nowrap;text-align:right">% of Total</th>'+
    '</tr></thead><tbody>'+
    (list.length?list.map(function(e,i){return '<tr><td style="text-align:center">'+(i+1)+'</td><td><strong>'+e[0]+'</strong></td><td style="text-align:right">'+e[1].toLocaleString()+'</td><td style="text-align:right">'+(e[1]/grand*100).toFixed(1)+'%</td></tr>';}).join('')
      :'<tr><td colspan="4" style="color:#879596">No data.</td></tr>')+
    '</tbody></table></div>';
}
// Excel-style paired trend table: <period> | Created | Resolved, aligned by period key.
function xlsTrendTable(createdEntries,resolvedEntries,periodHead){
  const rMap=Object.fromEntries(resolvedEntries||[]);
  const cMap=Object.fromEntries(createdEntries||[]);
  const keys=Array.from(new Set([].concat((createdEntries||[]).map(function(e){return e[0];}),(resolvedEntries||[]).map(function(e){return e[0];})))).sort();
  return '<div class="tbl-card"><table class="xls-table" style="width:100%"><thead><tr>'+
    '<th>'+periodHead+'</th>'+
    '<th style="text-align:right">Tickets Created</th>'+
    '<th style="text-align:right">Tickets Resolved</th>'+
    '</tr></thead><tbody>'+
    (keys.length?keys.map(function(k){return '<tr><td><strong>'+k+'</strong></td><td style="text-align:right">'+(cMap[k]||0).toLocaleString()+'</td><td style="text-align:right">'+(rMap[k]||0).toLocaleString()+'</td></tr>';}).join('')
      :'<tr><td colspan="3" style="color:#879596">No data.</td></tr>')+
    '</tbody></table></div>';
}
// Combined yearly table: Year | Tickets Created | Tickets Resolved | YoY Growth % (created-based).
function xlsYearlyTable(createdEntries,resolvedEntries,yoy){
  const rMap=Object.fromEntries(resolvedEntries||[]);
  const cMap=Object.fromEntries(createdEntries||[]);
  const gMap={}; (yoy||[]).forEach(function(y){ gMap[y.year]=y.growth; });
  const keys=Array.from(new Set([].concat((createdEntries||[]).map(function(e){return e[0];}),(resolvedEntries||[]).map(function(e){return e[0];})))).sort();
  return '<div class="tbl-card"><table class="xls-table" style="width:100%"><thead><tr>'+
    '<th>Year</th>'+
    '<th style="text-align:right">Tickets Created</th>'+
    '<th style="text-align:right">Tickets Resolved</th>'+
    '<th style="text-align:right">YoY Growth %</th>'+
    '</tr></thead><tbody>'+
    (keys.length?keys.map(function(k){
      var g=gMap[k];
      var gTxt=(g===null||g===undefined)?'\u2014':((parseFloat(g)>=0?'+':'')+g+'%');
      var gCol=(g===null||g===undefined)?'#879596':(parseFloat(g)>=0?'#ff5252':'#4ade80');
      return '<tr><td><strong>'+k+'</strong></td><td style="text-align:right">'+(cMap[k]||0).toLocaleString()+'</td><td style="text-align:right">'+(rMap[k]||0).toLocaleString()+'</td><td style="text-align:right;color:'+gCol+'">'+gTxt+'</td></tr>';
    }).join('')
      :'<tr><td colspan="4" style="color:#879596">No data.</td></tr>')+
    '</tbody></table></div>';
}
function renderCrossTab(elId,data,colKeys,maxRows,maxCols){
  const rows=Object.entries(data).map(([k,v])=>[k,Object.values(v).reduce((s,x)=>s+x,0),v]).sort((a,b)=>b[1]-a[1]).slice(0,maxRows);
  let cols=colKeys;
  if(!cols){const colTotals={};rows.forEach(([k,t,v])=>{Object.entries(v).forEach(([c,n])=>{colTotals[c]=(colTotals[c]||0)+n;});});cols=Object.entries(colTotals).sort((a,b)=>b[1]-a[1]).slice(0,maxCols||8).map(e=>e[0]);}
  let html='<table class="xls-table"><thead><tr><th></th>'+cols.map(c=>`<th>${c.substring(0,20)}</th>`).join('')+'<th>Total</th></tr></thead><tbody>';
  rows.forEach(([k,total,v])=>{html+=`<tr><td><strong>${k}</strong></td>`+cols.map(c=>{const n=v[c]||0;const intensity=total?Math.min(n/total,1):0;return`<td style="background:rgba(255,153,0,${(intensity*0.5).toFixed(2)})">${n||''}</td>`;}).join('')+`<td><strong>${total}</strong></td></tr>`;});
  html+='</tbody></table>';
  document.getElementById(elId).innerHTML=html;
}

// Paint the Q2/quarter page STRUCTURE immediately with spinners in every DB-driven slot
// (title total count, KPI numbers, chart areas, table bodies). render() replaces this once the
// DB data arrives. Homepage-style: static bits show instantly, live values spin until loaded.
function renderQuarterShell(qid){
  var m=/^(\d{4})-Q([1-4])$/.exec(qid||'');
  var label=m?('Q'+m[2]+' '+m[1]):(qid||'Quarter');
  var sp='<span class="num-spinner"></span>';
  // KPIs scramble random numbers from the very start (while the DB data loads) instead of spinning.
  // scrMax = plausible upper bound; pct=true renders with a % sign.
  var kpiScr=function(cls,lbl,scrMax,pct){
    return '<div class="kpi-card '+cls+'"><div class="value scramble-kpi" data-scr-max="'+scrMax+'" data-scr-pct="'+(pct?1:0)+'">0</div><div class="label">'+lbl+'</div></div>';
  };
  var chartBox=function(title){return '<div class="chart-box" style="grid-column:1/-1"><h3>'+title+'</h3><div class="chart-wrap"><div class="chart-spin"><div class="spinner"></div></div></div></div>';};
  var tableSpin='<div style="display:flex;align-items:center;justify-content:center;min-height:120px"><div class="spinner"></div></div>';
  document.getElementById('app').innerHTML=''+
    '<div class="content">'+
      '<div class="page-title"><h1>'+label+'</h1><p>Data range: <span class="num-spinner"></span> · <span class="num-spinner"></span> total tickets</p></div>'+
      '<div class="section"><h2>'+ic('bar-chart',18)+' Summary Statistics</h2><div class="kpi-grid">'+
        kpiScr('accent',ic('ticket',13)+' Total Tickets',9000,false)+
        kpiScr('success',ic('check-circle',13)+' Resolved / Closed',9000,false)+
        kpiScr('warning',ic('hourglass',13)+' Open',200,false)+
        kpiScr('success',ic('target',13)+' SLA \u2264240hrs',100,true)+
        kpiScr('warning',ic('repeat',13)+' Repeat Offenders (HI>0)',100,true)+
      '</div></div>'+
      '<div class="charts-grid">'+chartBox('Resolution Type')+chartBox('Incident Types')+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">'+
        '<div class="section" style="margin-bottom:0"><h2>'+ic('globe',18)+' Geography / Region — Count</h2>'+tableSpin+'</div>'+
        '<div class="section" style="margin-bottom:0"><h2>'+ic('users',18)+' Resolver Volume — PHD Team (WWOS)</h2>'+tableSpin+'</div>'+
      '</div>'+
      '<div style="margin-bottom:24px"></div>'+
      '<div class="charts-grid">'+chartBox('Weekly Trends')+'</div>'+
      '<div class="section"><h2>'+ic('repeat',18)+' Root Causes by Group</h2>'+tableSpin+'</div>'+
    '</div>';
  startKpiScramble(); // animate the KPI numbers from the start, while the DB data loads
}

// ===== Program History with quarter-selection checkbox tree (ds=archive) =====
// Owns #app: a persistent filter panel (era -> year -> quarter) + a #phBody that holds the analytics.
// Toggling a box recomputes the summed metrics from PH_SELECTED and re-renders #phBody.
function phQuarterLabel(qid){ var m=/^(\d{4})-Q([1-4])$/.exec(qid); return m?('Q'+m[2]+' '+m[1]):qid; }
function renderProgramHistory(){
  const el=document.getElementById('app'); if(!el)return;
  // Master (whole era) checkbox + per-year groups with per-quarter checkboxes.
  const allChecked=PH_SELECTED.length===PH_ALL_QIDS.length;
  const yearBlock=function(y,idx){
    const yChecked=y.quarters.every(function(q){return PH_SELECTED.indexOf(q)>=0;});
    const yPartial=!yChecked&&y.quarters.some(function(q){return PH_SELECTED.indexOf(q)>=0;});
    const qs=y.quarters.map(function(q){
      const on=PH_SELECTED.indexOf(q)>=0;
      return '<label class="ph-opt'+(on?' checked':'')+'"><input type="checkbox" data-q="'+q+'" '+(on?'checked':'')+' onchange="phToggleQuarter(\''+q+'\')"> '+phQuarterLabel(q)+'</label>';
    }).join('');
    return '<div class="ph-year ph-year-'+(idx%5)+'">'+
      '<label class="ph-opt ph-year-head'+(yChecked?' checked':'')+(yPartial?' partial':'')+'"><input type="checkbox" '+(yChecked?'checked':'')+' onchange="phToggleYear(\''+y.year+'\')"> '+y.year+'</label>'+
      '<div class="ph-qs">'+qs+'</div>'+
    '</div>';
  };
  el.innerHTML='<div class="content">'+
    '<div class="ph-hero"><div class="phh-left">'+
      '<h1 class="phh-title">'+ic('calendar',26)+' <span><span class="ph-full">Program History:</span><span class="ph-short">PH:</span> 1st Jan 2021 \u2013 30th Sep 2025</span></h1>'+
      '<div class="phh-sub">Pre-WWOS era. Tick one or more quarters (or a whole year) to view combined analytics. Read-only archive.</div>'+
    '</div></div>'+
    '<div class="ph-filter">'+
      '<div class="ph-filter-head">'+
        '<label class="ph-opt ph-master'+(allChecked?' checked':'')+'"><input type="checkbox" '+(allChecked?'checked':'')+' onchange="phToggleAll()"> '+ic('inbox',15)+' Program History (From 1st January 2021 to 30th September 2025)</label>'+
        '<button type="button" class="ph-clear" onclick="phClear()">Clear</button>'+
      '</div>'+
      '<div class="ph-tree">'+PH_TREE.map(yearBlock).join('')+'</div>'+
    '</div>'+
    '<div id="phBody"></div>'+
  '</div>';
  phRenderBody();
}
// Render the analytics body from the current selection (empty state if nothing checked).
function phRenderBody(){
  const body=document.getElementById('phBody'); if(!body)return;
  destroyArchiveCharts();
  if(!PH_SELECTED.length){
    body.innerHTML='<div class="section" style="text-align:center;padding:48px 20px">'+
      '<div style="font-size:2em;margin-bottom:8px;opacity:.5">\uD83D\uDCC2</div>'+
      '<h2 style="border:0;justify-content:center">No quarters selected</h2>'+
      '<p style="color:#879596">Tick a quarter or a year above to view its combined analytics.</p></div>';
    return;
  }
  const m=sumQuarterMetrics(PH_SELECTED);
  if(!m){ body.innerHTML='<div class="section"><p style="color:#879596">No data for this selection.</p></div>'; return; }
  // Reuse the full archive renderer, targeting #phBody. It rebuilds the analytics + charts.
  render(m,'Program History',(qparam('ds')||'archive'),'phBody');
  // render() writes a full .page-title (Program History header + count); the panel already shows the
  // title, so hide the duplicate inner page-title inside #phBody.
  var dup=body.querySelector('.page-title'); if(dup) dup.style.display='none';
}
// Toggle handlers -> update PH_SELECTED, sync UI, re-render body.
function phToggleQuarter(q){ var i=PH_SELECTED.indexOf(q); if(i>=0)PH_SELECTED.splice(i,1); else PH_SELECTED.push(q); renderProgramHistory(); }
function phToggleYear(year){ var y=PH_TREE.find(function(x){return x.year===year;}); if(!y)return; var all=y.quarters.every(function(q){return PH_SELECTED.indexOf(q)>=0;}); if(all){ PH_SELECTED=PH_SELECTED.filter(function(q){return y.quarters.indexOf(q)<0;}); } else { y.quarters.forEach(function(q){ if(PH_SELECTED.indexOf(q)<0)PH_SELECTED.push(q); }); } renderProgramHistory(); }
function phToggleAll(){ PH_SELECTED=(PH_SELECTED.length===PH_ALL_QIDS.length)?[]:PH_ALL_QIDS.slice(); renderProgramHistory(); }
function phClear(){ PH_SELECTED=[]; renderProgramHistory(); }
window.phToggleQuarter=phToggleQuarter; window.phToggleYear=phToggleYear; window.phToggleAll=phToggleAll; window.phClear=phClear;

// ===== After moving under WWOS (ds=moving): fixed combined view of Q4 2025 + Q1 2026 =====
// Same Excel-style layout as Program History, with a Combined + Q4 2025 + Q1 2026 checkbox filter.
const MOVING_QIDS=['2025-Q4','2026-Q1'];       // chronological order for display
let MOVING_SELECTED=MOVING_QIDS.slice();        // default: both (Combined)
function movingQLabel(qid){ var m=/^(\d{4})-Q([1-4])$/.exec(qid); return m?('Q'+m[2]+' '+m[1]):qid; }
function renderMovingCombined(){
  const el=document.getElementById('app'); if(!el)return;
  const bothChecked=MOVING_SELECTED.length===MOVING_QIDS.length;
  const qOpts=MOVING_QIDS.map(function(q){
    const on=MOVING_SELECTED.indexOf(q)>=0;
    return '<label class="ph-opt'+(on?' checked':'')+'"><input type="checkbox" '+(on?'checked':'')+' onchange="movingToggle(\''+q+'\')"> '+movingQLabel(q)+'</label>';
  }).join('');
  el.innerHTML='<div class="content">'+
    '<div class="ph-hero"><div class="phh-left">'+
      '<h1 class="phh-title">'+ic('calendar',26)+' Under WWOS \u2014 1st October 2025 to 31st March 2026</h1>'+
      '<div class="phh-sub">Transition period. Pick Combined, or a single quarter. Read-only.</div>'+
    '</div></div>'+
    '<div class="ph-filter">'+
      '<div class="ph-filter-head" style="border-bottom:0;margin-bottom:0;padding-bottom:0">'+
        '<label class="ph-opt ph-master'+(bothChecked?' checked':'')+'"><input type="checkbox" '+(bothChecked?'checked':'')+' onchange="movingToggleAll()"> '+ic('calendar',15)+' Combined (Q4 2025 &amp; Q1 2026)</label>'+
        '<div class="ph-tree" style="margin-left:auto"><div class="ph-year ph-year-1"><div class="ph-qs">'+qOpts+'</div></div></div>'+
      '</div>'+
    '</div>'+
    '<div id="phBody"></div>'+
  '</div>';
  movingRenderBody();
}
function movingRenderBody(){
  const body=document.getElementById('phBody'); if(!body)return;
  destroyArchiveCharts();
  if(!MOVING_SELECTED.length){
    body.innerHTML='<div class="section" style="text-align:center;padding:48px 20px">'+
      '<div style="font-size:2em;margin-bottom:8px;opacity:.5">\uD83D\uDCC2</div>'+
      '<h2 style="border:0;justify-content:center">Nothing selected</h2>'+
      '<p style="color:#879596">Tick Combined or a single quarter above to view its analytics.</p></div>';
    return;
  }
  // Sync PH_SELECTED so render()'s multiPeriod flag (>1 => show Trends) is correct.
  PH_SELECTED=MOVING_SELECTED.slice();
  const m=sumQuarterMetrics(MOVING_SELECTED);
  if(!m){ body.innerHTML='<div class="section"><p style="color:#879596">No data for this selection.</p></div>'; return; }
  render(m,'After moving under WWOS','archive','phBody');
  var dup=body.querySelector('.page-title'); if(dup) dup.style.display='none';
}
function movingToggle(q){ var i=MOVING_SELECTED.indexOf(q); if(i>=0)MOVING_SELECTED.splice(i,1); else MOVING_SELECTED.push(q); renderMovingCombined(); }
function movingToggleAll(){ MOVING_SELECTED=(MOVING_SELECTED.length===MOVING_QIDS.length)?[]:MOVING_QIDS.slice(); renderMovingCombined(); }
window.renderMovingCombined=renderMovingCombined; window.movingToggle=movingToggle; window.movingToggleAll=movingToggleAll;

(async function(){
  // Show a loading shimmer immediately (esp. for DB-backed quarters which may hit Render cold start).
  // The Program History archive (ds=archive) loads from a static file and renders its own KPI
  // spinners, so it skips the full shimmer and shows just a light spinner.
  const ds=qparam('ds');
  if(ds==='quarter'){
    // Paint the shell (structure + spinners) instantly; render() fills it after the DB fetch.
    renderQuarterShell(qparam('qid'));
  }else if(ds==='archive'||ds==='moving'){
    // Static, per-quarter-metrics-backed views render their own body; show just a light spinner.
    document.getElementById('app').innerHTML='<div class="content" style="text-align:center;padding:80px 0"><div class="spinner"></div></div>';
  }else if(window.PHDAuth&&window.PHDAuth.skeletonDashboard){
    document.getElementById('app').innerHTML=window.PHDAuth.skeletonDashboard('Loading report…');
  }
  // Program History (ds=archive): quarter-selection checkbox tree over hardcoded per-quarter metrics.
  if(ds==='archive'){
    if(!window.ARCHIVE_QUARTERS){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Program History unavailable</h2><p style="color:#879596">Per-quarter data failed to load.</p></div></div>';return;}
    renderProgramHistory();
    return;
  }
  // After moving under WWOS (ds=moving): fixed combined view of Q4 2025 + Q1 2026 (no tree).
  if(ds==='moving'){
    if(!window.ARCHIVE_QUARTERS){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Report unavailable</h2><p style="color:#879596">Per-quarter data failed to load.</p></div></div>';return;}
    renderMovingCombined();
    return;
  }
  try{
    const result=await loadMetrics();
    if(!result){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Dashboard not found</h2><p style="color:#879596">This archive could not be loaded. <a href="index.html" style="color:#44b9d6">Return home</a></p></div></div>';return;}
    render(result.metrics,result.name,qparam('ds'));
  }catch(e){document.getElementById('app').innerHTML='<div class="content"><div class="section"><h2>Error loading dashboard</h2><p style="color:#879596">'+e.message+'</p></div></div>';}
})();
