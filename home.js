// Home page quarter cards, grouped into collapsible YEAR sections (newest year first).
// The Admin Guide + Program History cards stay hardcoded in index.html (#cardGrid). Every
// quarter REPORT card is rendered here from /api/quarters, grouped under a collapsible header
// per year (2026, 2025, ... 2021). The year that contains the live quarter is expanded by
// default; all others start collapsed. A shimmer skeleton shows while /api/quarters loads.

function fmtCount(n){return (typeof n==='number')?n.toLocaleString():'';}
function icH(n,s){return window.icon?window.icon(n,s||22):'';}

// Expand/collapse a year section.
function toggleYearSection(btn){
  const sec=btn.closest('.year-section');
  if(!sec)return;
  const open=sec.classList.toggle('open');
  btn.setAttribute('aria-expanded',open?'true':'false');
}
window.toggleYearSection=toggleYearSection;

// Build one quarter report card's HTML. Compact, poster-style tile: quarter label + big ticket
// count + status pill. Live quarter gets a green treatment + pulsing LIVE badge.
function quarterCardHtml(q,isLive){
  const m=/^(\d{4})-Q([1-4])$/.exec(q.id||'');
  const qn=m?('Q'+m[2]):(q.label||q.id);
  const yr=m?m[1]:'';
  const href=isLive?'app.html':('archive.html?ds=quarter&qid='+encodeURIComponent(q.id));
  const countNum=(typeof q.count==='number')?fmtCount(q.count):(isLive?'—':'—');
  const status=isLive
    ? '<span class="qc-pill qc-live">'+icH('grid',13)+' LIVE</span>'
    : '<span class="qc-pill">'+icH('lock',12)+' Archived</span>';
  return '<a class="qcard'+(isLive?' qcard-live':'')+'" id="qcard-'+q.id+'" href="'+href+'" title="'+q.label+' Report">'+
    '<div class="qc-top"><span class="qc-q">'+qn+'</span><span class="qc-yr">'+yr+'</span>'+status+'</div>'+
    '<div class="qc-count"><b>'+countNum+'</b><span>tickets</span></div>'+
    '<div class="qc-foot">'+(isLive?'Live dashboard':'Read-only snapshot')+' <span class="qc-arrow">\u2192</span></div>'+
  '</a>';
}

async function renderQuarterCards(){
  const host=document.getElementById('yearSections');
  if(!host||!window.PHDAuth)return;

  let info;
  try{
    const r=await window.PHDAuth.api('GET','/api/quarters');
    if(!r.ok||!r.data){ host.innerHTML='<p style="color:var(--tm);text-align:center;padding:20px">Could not load quarter reports.</p>'; return; }
    info=r.data;
  }catch(e){ host.innerHTML='<p style="color:var(--tm);text-align:center;padding:20px">Could not load quarter reports.</p>'; return; }

  const liveId=info.liveQuarter;
  const quarters=(info.quarters||[]).slice();
  const seen={};quarters.forEach(q=>{seen[q.id]=true;});
  if(liveId && !seen[liveId]){quarters.push({id:liveId,label:info.liveLabel||liveId,count:undefined,isLive:true});seen[liveId]=true;}

  // Assign each quarter to one of three ERAS (a quarter's numeric key = year*10 + Q):
  //   after   = "After WWOS (complete take over by WWOS)"  -> Q2 2026, Q3 2026 (>= 2026-Q2)
  //   moving  = "After moving under WWOS"                  -> Q4 2025, Q1 2026 (Oct 2025 - Mar 2026)
  //   (The pre-WWOS "Before WWOS" era is represented by the Program History card, not listed here.)
  function qKey(id){ const m=/^(\d{4})-Q([1-4])$/.exec(id||''); return m?(parseInt(m[1],10)*10+parseInt(m[2],10)):0; }
  const eras=[
    { key:'after',  title:'After WWOS \u2014 complete take over by WWOS', min:20262, max:99999 },
    { key:'moving', title:'After moving under WWOS',                       min:20254, max:20261 },
  ];
  const byEra={ after:[], moving:[] };
  quarters.forEach(q=>{
    const m=/^(\d{4})-Q([1-4])$/.exec(q.id||''); if(!m)return;
    const k=qKey(q.id);
    const era=eras.find(e=>k>=e.min&&k<=e.max);
    if(era) byEra[era.key].push(Object.assign({},q,{_k:k}));
  });
  if(!byEra.after.length&&!byEra.moving.length){ host.innerHTML='<p style="color:var(--tm);text-align:center;padding:20px">No quarter reports available.</p>'; return; }

  const eraSectionHtml=function(era){
    const list=byEra[era.key].slice().sort((a,b)=>b._k-a._k); // newest quarter first
    if(!list.length)return '';
    const total=list.reduce((s,q)=>s+((typeof q.count==='number')?q.count:0),0);
    const hasLive=list.some(q=>q.id===liveId);
    const cards=list.map(q=>quarterCardHtml(q,q.id===liveId)).join('');
    const metaTxt=(total>0?fmtCount(total)+' tickets · ':'')+list.length+' quarter'+(list.length===1?'':'s');
    return ''+
    '<div class="year-section'+(hasLive?' open':'')+'">'+
      '<button type="button" class="year-head" aria-expanded="'+(hasLive?'true':'false')+'" onclick="toggleYearSection(this)">'+
        '<span class="year-title">'+icH('calendar',20)+' '+era.title+(hasLive?' <span class="year-live-badge">LIVE</span>':'')+'</span>'+
        '<span class="year-meta">'+metaTxt+'</span>'+
        '<span class="year-caret" aria-hidden="true">▾</span>'+
      '</button>'+
      '<div class="year-body"><div class="grid">'+cards+'</div></div>'+
    '</div>';
  };
  // ---- Redesigned "nav tiles": uniform cards with an icon chip, title + subtitle, description, and
  // an action footer with an arrow. The Active tile keeps its green identity + pulsing ACTIVE pill.
  // opts: { href, icon, title, sub, desc, action, live, external, tone }
  const navTile=function(opts){
    const ext=opts.external ? ' target="_blank" rel="noopener"' : '';
    const pill=opts.live ? '<span class="nt-pill">ACTIVE</span>' : '';
    const sub=opts.sub ? '<span class="nt-sub">'+opts.sub+'</span>' : '';
    const action=opts.action ? ('<span class="nt-cta">'+opts.action+' <span class="nt-arrow">'+(opts.external?'↗':'→')+'</span></span>') : '';
    return '<a class="nav-tile'+(opts.live?' nt-live':'')+(opts.tone?(' nt-'+opts.tone):'')+'" href="'+opts.href+'"'+ext+'>'+
      '<span class="nt-top">'+
        '<span class="nt-ic">'+icH(opts.icon,20)+'</span>'+pill+
      '</span>'+
      '<span class="nt-body">'+
        '<span class="nt-title">'+opts.title+'</span>'+sub+
        '<span class="nt-desc">'+opts.desc+'</span>'+
      '</span>'+
      action+
    '</a>';
  };
  const tiles=[
    // Program History — year-by-year archive, Q1 2021 -> Q4 2025.
    navTile({ href:'archive.html?ds=archive', icon:'inbox', tone:'amber',
      title:'Program History', sub:'Q1 2021 – Q4 2025',
      desc:'Year-by-year incident analytics, quarter by quarter.', action:'View year-by-year' }),
    // Active Dashboard — the live quarter (app.html). Green identity + ACTIVE pill.
    navTile({ href:'app.html', icon:'bolt', live:true,
      title:'Active Dashboard', sub:'From 1st Jan 2026',
      desc:'Combined live analytics under WWOS.', action:'Open dashboard' }),
    // Issue standardization — governed issue-type taxonomy reference.
    navTile({ href:'issue-types.html', icon:'clipboard', tone:'violet',
      title:'Issue Standardization', sub:'Reference guide',
      desc:'Standard issue-type definitions, usage and examples.', action:'View issue types' }),
    // PHD Wiki — external deep-dive.
    navTile({ href:'https://w.amazon.com/bin/view/GSOC/PHD#Attachments', icon:'globe', tone:'blue', external:true,
      title:'PHD Wiki', sub:'External resource',
      desc:'Dive deeper into the PHD program on the official wiki.', action:'Explore the wiki' }),
    // Rules — the scoring/SLA/classification rulebook. Kept LAST per request.
    navTile({ href:'rules.html', icon:'book', tone:'teal',
      title:'Rules & Definitions', sub:'How the numbers work',
      desc:'SLA, severity, colour and classification rules behind the dashboard.', action:'Read the rules' }),
  ];
  host.innerHTML='<div class="nav-tiles">'+tiles.join('')+'</div>';
}

renderQuarterCards();

// ---- Comparison-table mini charts: labeled 3-point trend (Before -> Q2 -> Q3) per row. ----
// Plots the REAL metric values with a Y axis (min/mid/max ticks) and an X axis (Before/Q2/Q3), so
// the numbers are readable. Line is green when the metric improves over time, red if it worsens.
// `data-dir="up"` = higher is better; `data-dir="down"` = lower is better.
function renderCmpSparks(){
  var cells=document.querySelectorAll('.cmp-spark[data-vals]'); if(!cells.length)return;
  var W=220, H=80, L=22, R=22, T=16, B=12;            // small margins so value labels aren't clipped
  var fmt=function(v){ v=Math.round(v*10)/10; return (v>=1000)?Math.round(v).toLocaleString():String(v); };
  cells.forEach(function(td){
    var vals=(td.getAttribute('data-vals')||'').split(',').map(function(v){return parseFloat(v);}).filter(function(v){return !isNaN(v);});
    if(vals.length<2)return;
    var dir=td.getAttribute('data-dir')||'up';
    var n=vals.length;
    // Improvement? up-metrics: last>first; down-metrics: last<first.
    var improved=(dir==='down')?(vals[n-1]<vals[0]):(vals[n-1]>vals[0]);
    var C=improved?'#4ade80':'#ff5252';
    // Y scale over the real values with a little headroom.
    var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals);
    if(mn===mx){ mn=mn*0.9; mx=mx*1.1||1; }
    var pad=(mx-mn)*0.12; var lo=Math.max(0,mn-pad), hi=mx+pad, rng=(hi-lo)||1;
    var innerW=W-L-R, innerH=H-T-B;
    var X=function(i){ return L+innerW*(i/(n-1)); };
    var Y=function(v){ return T+innerH*(1-((v-lo)/rng)); };
    var pts=vals.map(function(v,i){ return [X(i),Y(v)]; });
    var line=pts.map(function(p,i){ return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1); }).join(' ');
    var area=line+' L'+pts[n-1][0].toFixed(1)+' '+(T+innerH)+' L'+pts[0][0].toFixed(1)+' '+(T+innerH)+' Z';
    var gid='spg'+Math.random().toString(36).slice(2,8);
    // No axis lines/gridlines/tick labels — just the value label above (or below) each point.
    var vlab='';
    pts.forEach(function(p,i){
      var above=(p[1]>T+12); vlab+='<text x="'+p[0].toFixed(1)+'" y="'+((above?p[1]-6:p[1]+12)).toFixed(1)+'" text-anchor="middle" font-size="9" font-weight="700" fill="'+C+'">'+fmt(vals[i])+'</text>';
    });
    var dots=pts.map(function(p,i){ var last=(i===n-1); return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(last?3.2:2.6)+'" fill="'+(last?C:'#fff')+'" stroke="'+C+'" stroke-width="1.5"/>'; }).join('');
    td.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="year trend 2021 to 2026">'+
      '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0" stop-color="'+C+'" stop-opacity=".22"/><stop offset="1" stop-color="'+C+'" stop-opacity="0"/>'+
      '</linearGradient></defs>'+
      '<path d="'+area+'" fill="url(#'+gid+')"/>'+
      '<path d="'+line+'" fill="none" stroke="'+C+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
      dots+vlab+
    '</svg>';
  });
}

// Fetch /api/year-metrics and fill the per-year comparison table (2021-2026) + its sparklines.
// Public endpoint; runs on the home page. Graceful no-op if the table or data is missing.
(function(){
  var table=document.getElementById('yearCmpTable'); if(!table)return;
  var A=window.PHDAuth;
  // 2021-2025 are hardcoded in the HTML (historical, never change). Only 2026 (live) is fetched.
  var setLive=function(metric,html){
    var row=table.querySelector('tr[data-metric="'+metric+'"]'); if(!row)return;
    var td=row.querySelector('td.yv[data-y="2026"]'); if(td)td.innerHTML=html;
  };
  // Sparkline = the row's fixed 2021-2025 values (data-fixed) + the live 2026 value appended.
  var sparkWith=function(metric,v2026){
    var row=table.querySelector('tr[data-metric="'+metric+'"]'); if(!row)return;
    var cell=row.querySelector('.cmp-spark'); if(!cell)return;
    var fixed=(cell.getAttribute('data-fixed')||'').split(',').filter(Boolean);
    if(v2026!=null) fixed.push(String(v2026));
    cell.setAttribute('data-vals',fixed.join(','));
  };
  var put=function(){
    (A&&A.api?A.api('GET','/api/year-metrics'):Promise.reject()).then(function(r){
      if(!r||!r.ok||!r.data||!Array.isArray(r.data.years)) throw new Error('bad');
      var d=null; r.data.years.forEach(function(y){ if(y.year===2026) d=y; });
      d=d||{};
      var vol=(d.volPerMonth!=null)?d.volPerMonth:null;
      var res=(d.avgResHrs!=null)?d.avgResHrs:null;
      var sla=(d.slaPct!=null)?d.slaPct:null;
      setLive('vol', vol!=null?(vol.toLocaleString()+'<span class="cmp-u">/mo</span>'):'\u2014');
      setLive('res', res!=null?(res+'<span class="cmp-u">hrs</span>'):'\u2014');
      setLive('sla', sla!=null?(sla+'%'):'\u2014');
      sparkWith('vol',vol); sparkWith('res',res); sparkWith('sla',sla);
      renderCmpSparks();
    }).catch(function(){
      // Endpoint failed: show a dash for 2026 and draw the sparkline from the 5 fixed years only.
      setLive('vol','\u2014'); setLive('res','\u2014'); setLive('sla','\u2014');
      sparkWith('vol',null); sparkWith('res',null); sparkWith('sla',null);
      renderCmpSparks();
    });
  };
  put();
})();
