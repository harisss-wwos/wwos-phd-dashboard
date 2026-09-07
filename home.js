// Home page: inject dynamic quarter cards (the live quarter + any DB-backed past quarters).
// Static cards (Admin & Operations Guide, Program History) are in the HTML. Quarter cards
// (Q2, Q3, Q4...) are appended dynamically from the database in ascending order.

function fmtCount(n){return (typeof n==='number')?n.toLocaleString():'';}

// Build one card-shaped shimmer placeholder that mirrors the real quarter card layout.
function quarterSkeletonCard(){
  const el=document.createElement('div');
  el.className='q-skel';
  el.innerHTML=
    '<div class="shimmer q-skel-head"></div>'+
    '<div class="shimmer q-skel-line"></div>'+
    '<div class="shimmer q-skel-line short"></div>'+
    '<div class="shimmer q-skel-tag"></div>';
  return el;
}

// Append quarter cards (from the DB) after the static cards. Shows card-shaped shimmers while loading.
async function renderQuarterCards(){
  const grid=document.getElementById('cardGrid');
  if(!grid||!window.PHDAuth)return;
  // Loading shimmer: a few card-shaped placeholders matching the quarter-card grid
  // (Render can cold-start, so this may be visible for a moment).
  const skWrap=document.createElement('div');
  skWrap.id='quarterLoading';
  skWrap.style.display='contents'; // let the skeleton cards sit directly in the grid
  for(let i=0;i<2;i++)skWrap.appendChild(quarterSkeletonCard());
  grid.appendChild(skWrap);
  let info;
  try{
    const r=await window.PHDAuth.api('GET','/api/quarters');
    if(!r.ok||!r.data){skWrap.remove();return;}
    info=r.data;
  }catch(e){skWrap.remove();return;}
  skWrap.remove();

  const liveId=info.liveQuarter;
  const frag=document.createDocumentFragment();

  // Sort quarters ASCENDING (Q2, Q3, Q4...); ensure the live quarter is present even if not yet in DB.
  const seen={};
  const quarters=(info.quarters||[]).slice();
  quarters.forEach(q=>{seen[q.id]=true;});
  if(liveId && !seen[liveId]){quarters.push({id:liveId,label:info.liveLabel,count:undefined,isLive:true});}
  quarters.sort((a,b)=>a.id.localeCompare(b.id));

  quarters.forEach(q=>{
    const a=document.createElement('a');
    const isLive=q.id===liveId;
    // Live quarter -> operational live dashboard (app.html). Past quarters -> read-only Q2-style report.
    a.href=isLive?'app.html':('archive.html?ds=quarter&qid='+encodeURIComponent(q.id));
    a.className='card '+(isLive?'live':'');
    const countTxt=q.count!=null?(fmtCount(q.count)+' tickets'):'';
    const ic=(n,s)=>window.icon?window.icon(n,s||22):'';
    if(isLive){
      a.innerHTML='<div class="card-head"><span class="card-ic">'+ic('grid')+'</span><h2>'+q.label+' Report</h2><span class="live-pill">● LIVE</span></div>'
        +'<p>Current quarter — live operations dashboard. Authorized users upload &amp; merge the latest CSV; everyone sees the published data.</p>'
        +'<span class="tag">'+(countTxt||'Live')+'</span>';
    }else{
      a.innerHTML='<div class="card-head"><span class="card-ic">'+ic('bar-chart')+'</span><h2>'+q.label+' Report</h2></div>'
        +'<p>WWOS-managed incident data for '+q.label+'. Read-only snapshot.</p>'
        +'<span class="tag">'+(countTxt||'Archived')+'</span>';
    }
    frag.appendChild(a);
  });

  // Append quarter cards after the static cards (Admin Guide, Program History) — ascending order.
  grid.appendChild(frag);
}

renderQuarterCards();
