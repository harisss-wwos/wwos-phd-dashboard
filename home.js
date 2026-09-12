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

// Build one quarter report card's HTML.
function quarterCardHtml(q,isLive){
  const countTxt=q.count!=null?(fmtCount(q.count)+' tickets'+(isLive?'':' · Archived')):(isLive?'Live':'Archived');
  const href=isLive?'app.html':('archive.html?ds=quarter&qid='+encodeURIComponent(q.id));
  const head=isLive
    ? '<div class="card-head"><span class="card-ic">'+icH('grid')+'</span><h2>'+q.label+' Report</h2><span class="live-pill">● LIVE</span></div>'
      +'<p>Current quarter — live operations dashboard. Authorized users upload &amp; merge the latest CSV; everyone sees the published data.</p>'
    : '<div class="card-head"><span class="card-ic">'+icH('bar-chart')+'</span><h2>'+q.label+' Report</h2></div>'
      +'<p>WWOS-managed incident data for '+q.label+'. Read-only snapshot.</p>';
  return '<a class="card '+(isLive?'live':'')+'" id="qcard-'+q.id+'" href="'+href+'">'+head+'<span class="tag">'+countTxt+'</span></a>';
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
