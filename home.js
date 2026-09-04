// Home page: inject dynamic quarter cards (the live quarter + any DB-backed past quarters).
// Static cards (Program History, Q2 2026, PHD Tools) are in the HTML. The old "Live Dashboard"
// and "+ Add New Archive Dashboard" cards were removed in favor of this dynamic, quarter-based model.

function fmtCount(n){return (typeof n==='number')?n.toLocaleString():'';}

// Insert quarter cards just before the PHD Tools card so the live quarter sits with the reports.
async function renderQuarterCards(){
  const grid=document.getElementById('cardGrid');
  if(!grid||!window.PHDAuth)return;
  const toolsCardEl=grid.querySelector('.card.tools');
  // Loading shimmer placeholder card(s) while /api/quarters loads (may hit Render cold start).
  const ph=document.createElement('div');
  ph.className='shimmer sk-card';
  ph.id='quarterLoading';
  ph.style.minHeight='150px';
  if(toolsCardEl)grid.insertBefore(ph,toolsCardEl);else grid.appendChild(ph);
  let info;
  try{
    const r=await window.PHDAuth.api('GET','/api/quarters');
    if(!r.ok||!r.data){ph.remove();return;}
    info=r.data;
  }catch(e){ph.remove();return;}
  ph.remove();

  const liveId=info.liveQuarter;
  const toolsCard=grid.querySelector('.card.tools');
  const frag=document.createDocumentFragment();

  // Sort quarters newest first; ensure the live quarter is present even if not yet in DB.
  const seen={};
  const quarters=(info.quarters||[]).slice();
  quarters.forEach(q=>{seen[q.id]=true;});
  if(liveId && !seen[liveId]){quarters.push({id:liveId,label:info.liveLabel,count:undefined,isLive:true});}
  quarters.sort((a,b)=>b.id.localeCompare(a.id));

  quarters.forEach(q=>{
    const a=document.createElement('a');
    const isLive=q.id===liveId;
    // Live quarter -> operational live dashboard (app.html). Past quarters -> read-only Q2-style report.
    a.href=isLive?'app.html':('archive.html?ds=quarter&qid='+encodeURIComponent(q.id));
    a.className='card '+(isLive?'live':'');
    const countTxt=q.count!=null?(fmtCount(q.count)+' tickets'):'';
    if(isLive){
      a.innerHTML='<div class="card-head"><h2>'+q.label+' Report</h2><span class="live-pill">● LIVE</span></div>'
        +'<p>Current quarter — live operations dashboard. Authorized users upload &amp; merge the latest CSV; everyone sees the published data.</p>'
        +'<span class="tag">'+(countTxt||'Live')+'</span>';
    }else{
      a.innerHTML='<h2>'+q.label+' Report</h2>'
        +'<p>WWOS-managed incident data for '+q.label+'. Read-only snapshot.</p>'
        +'<span class="tag">'+(countTxt||'Archived')+'</span>';
    }
    frag.appendChild(a);
  });

  if(toolsCard)grid.insertBefore(frag,toolsCard);
  else grid.appendChild(frag);
}

renderQuarterCards();
