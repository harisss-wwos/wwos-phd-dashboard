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

  // Group by year (id looks like "2026-Q3").
  const byYear={};
  quarters.forEach(q=>{
    const m=/^(\d{4})-Q([1-4])$/.exec(q.id||'');
    if(!m)return;
    const yr=m[1]; const qn=parseInt(m[2],10);
    (byYear[yr]=byYear[yr]||[]).push(Object.assign({},q,{_q:qn}));
  });
  const years=Object.keys(byYear).sort((a,b)=>b.localeCompare(a)); // newest year first
  if(!years.length){ host.innerHTML='<p style="color:var(--tm);text-align:center;padding:20px">No quarter reports available.</p>'; return; }

  const liveYear=liveId?(/^(\d{4})-Q[1-4]$/.exec(liveId)||[])[1]:null;

  host.innerHTML=years.map(function(yr){
    const list=byYear[yr].slice().sort((a,b)=>b._q-a._q); // Q4..Q1 within the year
    const total=list.reduce((s,q)=>s+((typeof q.count==='number')?q.count:0),0);
    const hasLive=(yr===liveYear);
    const cards=list.map(q=>quarterCardHtml(q,q.id===liveId)).join('');
    const metaTxt=(total>0?fmtCount(total)+' tickets · ':'')+list.length+' quarter'+(list.length===1?'':'s');
    return ''+
    '<div class="year-section'+(hasLive?' open':'')+'">'+
      '<button type="button" class="year-head" aria-expanded="'+(hasLive?'true':'false')+'" onclick="toggleYearSection(this)">'+
        '<span class="year-title">'+icH('calendar',20)+' '+yr+(hasLive?' <span class="year-live-badge">LIVE</span>':'')+'</span>'+
        '<span class="year-meta">'+metaTxt+'</span>'+
        '<span class="year-caret" aria-hidden="true">▾</span>'+
      '</button>'+
      '<div class="year-body"><div class="grid">'+cards+'</div></div>'+
    '</div>';
  }).join('');
}

renderQuarterCards();

// ---- Comparison-table mini charts: labeled 3-point trend (Before -> Q2 -> Q3) per row. ----
// Plots the REAL metric values with a Y axis (min/mid/max ticks) and an X axis (Before/Q2/Q3), so
// the numbers are readable. Line is green when the metric improves over time, red if it worsens.
// `data-dir="up"` = higher is better; `data-dir="down"` = lower is better.
(function(){
  var cells=document.querySelectorAll('.cmp-spark[data-vals]'); if(!cells.length)return;
  var W=220, H=80, L=22, R=22, T=16, B=12;            // small margins so value labels aren't clipped
  var XL=['Before','Q2','Q3'];
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
    var dots=pts.map(function(p,i){ var last=(i===n-1); return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(last?3.2:2.6)+'" fill="'+(last?C:'#0b0f14')+'" stroke="'+C+'" stroke-width="1.5"/>'; }).join('');
    td.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="trend Before to Q3">'+
      '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0" stop-color="'+C+'" stop-opacity=".24"/><stop offset="1" stop-color="'+C+'" stop-opacity="0"/>'+
      '</linearGradient></defs>'+
      '<path d="'+area+'" fill="url(#'+gid+')"/>'+
      '<path d="'+line+'" fill="none" stroke="'+C+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
      dots+vlab+
    '</svg>';
  });
})();
