// Home page quarter cards.
// The Q2 (past) and Q3 (live) card SHELLS are hardcoded in index.html — only the ticket COUNT
// is dynamic. This function fills each .q-count from /api/quarters (a small spinner shows until
// then, so there's no full-card shimmer). Any additional quarters the API reports that aren't
// already on the page are appended after the hardcoded ones.

function fmtCount(n){return (typeof n==='number')?n.toLocaleString():'';}

async function renderQuarterCards(){
  const grid=document.getElementById('cardGrid');
  if(!grid||!window.PHDAuth)return;

  let info;
  try{
    const r=await window.PHDAuth.api('GET','/api/quarters');
    if(!r.ok||!r.data)return; // leave hardcoded cards as-is (spinner stays); no crash
    info=r.data;
  }catch(e){return;}

  const liveId=info.liveQuarter;
  const quarters=(info.quarters||[]).slice();
  const seen={};quarters.forEach(q=>{seen[q.id]=true;});
  if(liveId && !seen[liveId]){quarters.push({id:liveId,label:info.liveLabel,count:undefined,isLive:true});seen[liveId]=true;}

  const byId={};quarters.forEach(q=>{byId[q.id]=q;});

  // 1) Fill counts for the hardcoded cards already on the page.
  document.querySelectorAll('.q-count[data-qid]').forEach(function(el){
    const qid=el.getAttribute('data-qid');
    const q=byId[qid];
    const isLive=(qid===liveId);
    if(q&&q.count!=null){ el.textContent=fmtCount(q.count)+' tickets'+(isLive?'':' · Archived'); }
    else { el.textContent=isLive?'Live':'Archived'; } // no count available -> fall back to a label
  });

  // 2) Append any EXTRA quarters returned by the API that aren't hardcoded on the page.
  const ic=(n,s)=>window.icon?window.icon(n,s||22):'';
  const extra=quarters
    .filter(q=>!document.getElementById('qcard-'+q.id))
    .sort((a,b)=>a.id.localeCompare(b.id));
  extra.forEach(function(q){
    const isLive=q.id===liveId;
    const a=document.createElement('a');
    a.id='qcard-'+q.id;
    a.href=isLive?'app.html':('archive.html?ds=quarter&qid='+encodeURIComponent(q.id));
    a.className='card '+(isLive?'live':'');
    const countTxt=q.count!=null?(fmtCount(q.count)+' tickets'):(isLive?'Live':'Archived');
    if(isLive){
      a.innerHTML='<div class="card-head"><span class="card-ic">'+ic('grid')+'</span><h2>'+q.label+' Report</h2><span class="live-pill">● LIVE</span></div>'
        +'<p>Current quarter — live operations dashboard. Authorized users upload &amp; merge the latest CSV; everyone sees the published data.</p>'
        +'<span class="tag">'+countTxt+'</span>';
    }else{
      a.innerHTML='<div class="card-head"><span class="card-ic">'+ic('bar-chart')+'</span><h2>'+q.label+' Report</h2></div>'
        +'<p>WWOS-managed incident data for '+q.label+'. Read-only snapshot.</p>'
        +'<span class="tag">'+countTxt+'</span>';
    }
    grid.appendChild(a);
  });
}

renderQuarterCards();
