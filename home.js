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

// The "Dashboards & reports" cards are 100% STATIC text (no server data), so render them
// synchronously on load — no /api/quarters fetch, no shimmer wait. (The per-quarter tiles live on
// the Program History / archive page, not here.)
function renderQuarterCards(){
  const host=document.getElementById('yearSections');
  if(!host)return;
  // ---- Redesigned "nav tiles": uniform cards with an icon chip, title + subtitle, description, and
  // an action footer with an arrow. The Active tile keeps its green identity + pulsing ACTIVE pill.
  // opts: { href, icon, title, sub, desc, action, live, external, tone }
  // Logged out? The "Dashboards & reports" tiles are DISABLED (inert, greyed, not clickable) — a
  // guest can only stay on index.html. Logged in -> normal clickable links.
  const isGuest=!(window.PHDAuth&&window.PHDAuth.getUser&&window.PHDAuth.getUser());
  const navTile=function(opts){
    const ext=opts.external ? ' target="_blank" rel="noopener"' : '';
    const pill=opts.live ? '<span class="nt-pill">ACTIVE</span>' : '';
    const sub=opts.sub ? '<span class="nt-sub">'+opts.sub+'</span>' : '';
    const action=opts.action ? ('<span class="nt-cta">'+opts.action+' <span class="nt-arrow">'+(opts.external?'↗':'→')+'</span></span>') : '';
    const inner=
      '<span class="nt-top">'+
        '<span class="nt-ic">'+icH(opts.icon,18)+'</span>'+
        '<span class="nt-head"><span class="nt-title">'+opts.title+'</span>'+sub+'</span>'+
        (opts.live?pill:'')+
        (isGuest?'<span class="nt-lock" title="Log in to access">'+icH('key',14)+'</span>':'')+
      '</span>'+
      '<span class="nt-body">'+
        '<span class="nt-desc">'+opts.desc+'</span>'+
      '</span>'+
      action;
    const extCls=opts.external?' nt-external':'';
    if(isGuest){
      // Inert tile: a <div> (no href), greyed + not clickable.
      return '<div class="nav-tile nt-disabled'+(opts.live?' nt-live':'')+extCls+(opts.tone?(' nt-'+opts.tone):'')+'" aria-disabled="true" title="Log in to access">'+inner+'</div>';
    }
    return '<a class="nav-tile'+(opts.live?' nt-live':'')+extCls+(opts.tone?(' nt-'+opts.tone):'')+'" href="'+opts.href+'"'+ext+'>'+inner+'</a>';
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
    // Ticket Sanitization Process — step-by-step guide + links (page designed later).
    navTile({ href:'ticket-sanitization.html', icon:'check-circle', tone:'rose',
      title:'Ticket Sanitization Process', sub:'Step-by-step guide',
      desc:'Instructions and linked resources that walk you through sanitizing a ticket.', action:'Open the guide' }),
    // PHD Resolutions — the 12 allowed resolutions (same list as Tools + My Tickets).
    navTile({ href:'phd-resolutions.html', icon:'check-circle', tone:'teal',
      title:'PHD Resolutions', sub:'Reference list',
      desc:'The 12 resolutions allowed for the Res line and PHD Resolution.', action:'View resolutions' }),
    // Rules & Definitions — program rules, plus the Regions & countries grouping.
    navTile({ href:'rules.html', icon:'book', tone:'blue',
      title:'Rules & Definitions', sub:'Reference guide',
      desc:'Program rules and definitions, including how countries are grouped into regions.', action:'View the rules' }),
  ];
  host.innerHTML='<div class="nav-tiles">'+tiles.join('')+'</div>';
  // External links live in their own "External links" section (#linksSec, filled below for
  // logged-in users via /api/external-links). Guests can't call that API, so they get PHD Wiki +
  // PHD Mitigation Matrix as disabled placeholders there (no href is rendered for guests).
  const linksHost=document.getElementById('extLinks');
  if(isGuest && linksHost){
    linksHost.innerHTML=
      navTile({ href:'#', icon:'globe', tone:'blue', external:true,
        title:'PHD Wiki', sub:'External link',
        desc:'Dive deeper into the PHD program on the official wiki.', action:'Open link' })+
      navTile({ href:'#', icon:'grid', tone:'teal', external:true,
        title:'PHD Mitigation Matrix', sub:'External link',
        desc:'Open the PHD Mitigation Matrix dashboard in QuickSight.', action:'Open link' });
  }
}

renderQuarterCards();

// ---- Admin-managed external links (extra dark "External link" tiles after the base tiles) ----
// GET /api/external-links needs a login, so guests never fetch. Admin+ get an "Add External link"
// button in the card header; a link's creator (admin+) gets a delete icon on their own tiles. The
// validation below mirrors server/external-links.js (http/https only, same length caps).
(function(){
  var A=window.PHDAuth;
  var user=A&&A.getUser&&A.getUser();
  if(!user)return;                                  // guests: keep the disabled base tiles only
  var isAdmin=!!(A.atLeast&&A.atLeast('admin'));
  var me=String(user.username||'').toLowerCase();
  var LIM={title:60, description:200, url:2000, author:60};
  var links={};                                     // id -> link (for the delete confirm title)

  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function isHttpUrl(s){ try{ var u=new URL(String(s)); return u.protocol==='https:'||u.protocol==='http:'; }catch(e){ return false; } }
  function canDelete(l){ return isAdmin && String(l.createdBy||'').toLowerCase()===me; }

  function tileHtml(l){
    var del=canDelete(l);
    var inner=
      '<span class="nt-top">'+
        '<span class="nt-ic">'+icH(l.icon==='grid'?'grid':'globe',18)+'</span>'+
        '<span class="nt-head"><span class="nt-title">'+esc(l.title)+'</span><span class="nt-sub">'+esc(l.sub||'External link')+'</span></span>'+
      '</span>'+
      '<span class="nt-body"><span class="nt-desc">'+esc(l.description)+'</span>'+
        (l.author?'<span class="nt-author"><span class="nt-author-k">Author</span><span class="nt-author-v">'+esc(l.author)+'</span></span>':'')+'</span>'+
      '<span class="nt-cta">'+esc(l.action||'Open link')+' <span class="nt-arrow">\u2197</span></span>';
    // Defence in depth: only http(s) URLs ever become an href.
    var tile=isHttpUrl(l.url)
      ? '<a class="nav-tile nt-external" href="'+esc(l.url)+'" target="_blank" rel="noopener noreferrer">'+inner+'</a>'
      : '<div class="nav-tile nt-external" aria-disabled="true">'+inner+'</div>';
    var btn=del ? '<button type="button" class="nt-del" data-id="'+esc(l.id)+'" aria-label="Delete link '+esc(l.title)+'" title="Delete link">'+icH('trash',14)+'</button>' : '';
    return '<div class="nt-wrap'+(del?' nt-has-del':'')+'" data-link-id="'+esc(l.id)+'">'+tile+btn+'</div>';
  }
  function grid(){ return document.getElementById('extLinks'); }
  // Empty state for the External links section (shown once the list has loaded and is empty).
  var loaded=false;
  function syncEmpty(){
    var e=document.getElementById('extLinksEmpty'); if(!e)return;
    var none=loaded && !Object.keys(links).length;
    e.textContent=isAdmin?'No external links yet. Use Add External link to add one.':'No external links yet.';
    e.hidden=!none;
  }
  function appendLink(l){
    var g=grid(); if(!g||!l||!l.id)return;
    links[l.id]=l;
    g.insertAdjacentHTML('beforeend',tileHtml(l));
    syncEmpty();
  }

  // ---- Modal plumbing: one open modal at a time; Esc/backdrop close, Tab focus trap, focus return.
  var openBg=null, returnTo=null, onCloseFn=null;
  function focusables(root){
    return Array.prototype.filter.call(root.querySelectorAll('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])'),function(el){ return !el.disabled && el.offsetParent!==null; });
  }
  function openModal(bg,opener,first,onClose){
    returnTo=opener||null; onCloseFn=onClose||null; openBg=bg;
    bg.style.display='flex';
    setTimeout(function(){ if(first) first.focus(); },30);
  }
  function closeModal(){
    if(!openBg)return;
    openBg.style.display='none'; openBg=null;
    if(onCloseFn) onCloseFn();
    var t=(returnTo&&document.body.contains(returnTo))?returnTo:(document.getElementById('elAddBtn')||null);
    returnTo=null; onCloseFn=null;
    if(t) t.focus();
  }
  document.addEventListener('keydown',function(e){
    if(!openBg)return;
    if(e.key==='Escape'){ e.preventDefault(); closeModal(); return; }
    if(e.key==='Tab'){
      var f=focusables(openBg.querySelector('.modal')); if(!f.length)return;
      var a=f[0], z=f[f.length-1];
      if(e.shiftKey && (document.activeElement===a||!openBg.contains(document.activeElement))){ e.preventDefault(); z.focus(); }
      else if(!e.shiftKey && (document.activeElement===z||!openBg.contains(document.activeElement))){ e.preventDefault(); a.focus(); }
    }
  });
  function makeBg(id,html){
    var bg=document.createElement('div');
    bg.className='modal-bg el-modal-bg'; bg.id=id; bg.innerHTML=html;
    bg.addEventListener('click',function(e){ if(e.target===bg) closeModal(); });
    document.body.appendChild(bg);
    return bg;
  }
  function showErr(el,msg){ el.textContent=msg||''; el.style.display=msg?'block':'none'; }

  // ---- Delete confirm (creator only) ----
  var delBg=null, delId=null;
  function ensureDelModal(){
    if(delBg)return delBg;
    delBg=makeBg('elDelModal',
      '<div class="modal el-modal" role="dialog" aria-modal="true" aria-labelledby="elDelH" aria-describedby="elDelMsg">'+
        '<h2 id="elDelH">Delete this link?</h2>'+
        '<p class="el-msg" id="elDelMsg"></p>'+
        '<div class="err" id="elDelErr" role="alert"></div>'+
        '<div class="el-actions">'+
          '<button type="button" class="btn sec" id="elDelCancel">Cancel</button>'+
          '<button type="button" class="btn danger" id="elDelOk">Delete</button>'+
        '</div>'+
      '</div>');
    document.getElementById('elDelCancel').addEventListener('click',closeModal);
    document.getElementById('elDelOk').addEventListener('click',doDelete);
    return delBg;
  }
  function openDelete(id,opener){
    var l=links[id]; if(!l)return;
    ensureDelModal(); delId=id;
    document.getElementById('elDelMsg').innerHTML='<b>'+esc(l.title)+'</b>';
    showErr(document.getElementById('elDelErr'),'');
    var ok=document.getElementById('elDelOk'); ok.disabled=false; ok.textContent='Delete'; ok.removeAttribute('aria-busy');
    openModal(delBg,opener,document.getElementById('elDelCancel'));
  }
  async function doDelete(){
    var id=delId; if(!id)return;
    var ok=document.getElementById('elDelOk'), err=document.getElementById('elDelErr');
    ok.disabled=true; ok.textContent='Deleting\u2026'; ok.setAttribute('aria-busy','true'); showErr(err,'');
    var r;
    try{ r=await A.api('DELETE','/api/external-links/'+encodeURIComponent(id)); }
    catch(e){ r={ok:false,status:0,data:{error:'Network error. Please try again.'}}; }
    ok.disabled=false; ok.textContent='Delete'; ok.removeAttribute('aria-busy');
    if(!r.ok){ showErr(err,(r.data&&r.data.error)||('Could not delete the link (HTTP '+r.status+').')); return; }
    var w=document.querySelector('.nt-wrap[data-link-id="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
    if(w) w.remove();
    delete links[id];
    syncEmpty();
    closeModal();
  }
  var host=document.getElementById('extLinks');
  if(host) host.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('.nt-del'); if(!b)return;
    e.preventDefault(); e.stopPropagation();
    openDelete(b.getAttribute('data-id'),b);
  });

  // ---- Add External link (admin+) ----
  var addBg=null;
  function ensureAddModal(){
    if(addBg)return addBg;
    addBg=makeBg('elAddModal',
      '<div class="modal el-modal" role="dialog" aria-modal="true" aria-labelledby="elAddH">'+
        '<h2 id="elAddH">Add external link</h2>'+
        '<form id="elAddForm" novalidate>'+
          '<label for="elTitle">Title <span class="el-req" aria-hidden="true">*</span></label>'+
          '<input type="text" id="elTitle" maxlength="'+LIM.title+'" required aria-required="true" aria-describedby="elTitleErr" autocomplete="off">'+
          '<div class="el-ferr" id="elTitleErr"></div>'+
          '<label for="elDesc">Description (optional)</label>'+
          '<textarea id="elDesc" rows="3" maxlength="'+LIM.description+'" aria-describedby="elDescErr"></textarea>'+
          '<div class="el-ferr" id="elDescErr"></div>'+
          '<label for="elUrl">Link <span class="el-req" aria-hidden="true">*</span></label>'+
          '<input type="url" id="elUrl" maxlength="'+LIM.url+'" required aria-required="true" aria-describedby="elUrlErr" placeholder="https://\u2026" inputmode="url" autocomplete="off">'+
          '<div class="el-ferr" id="elUrlErr"></div>'+
          '<label for="elAuthor">Author <span class="el-req" aria-hidden="true">*</span></label>'+
          '<input type="text" id="elAuthor" maxlength="'+LIM.author+'" required aria-required="true" aria-describedby="elAuthorErr" placeholder="Login ID" autocomplete="off">'+
          '<div class="el-ferr" id="elAuthorErr"></div>'+
          '<div class="err" id="elAddErr" role="alert"></div>'+
          '<div class="el-actions">'+
            '<button type="button" class="btn sec" id="elAddCancel">Cancel</button>'+
            '<button type="submit" class="btn" id="elAddSave">Save</button>'+
          '</div>'+
        '</form>'+
      '</div>');
    document.getElementById('elAddCancel').addEventListener('click',closeModal);
    document.getElementById('elAddForm').addEventListener('submit',function(e){ e.preventDefault(); doAdd(); });
    return addBg;
  }
  function setFieldErr(inputId,errId,msg){
    var i=document.getElementById(inputId), m=document.getElementById(errId);
    m.textContent=msg||'';
    if(msg) i.setAttribute('aria-invalid','true'); else i.removeAttribute('aria-invalid');
    return !msg;
  }
  // Mirrors validateExternalLink() on the server. Returns {ok, value} and paints inline errors.
  function validateForm(){
    var title=document.getElementById('elTitle').value.trim();
    var description=document.getElementById('elDesc').value.trim();
    var url=document.getElementById('elUrl').value.trim();
    var author=document.getElementById('elAuthor').value.replace(/\s+/g,' ').trim();   // free text
    var aErr=!author?'Author is required.':(author.length>LIM.author?'Author must be '+LIM.author+' characters or fewer.':'');
    var tErr=!title?'Title is required.':(title.length>LIM.title?'Title must be '+LIM.title+' characters or fewer.':'');
    var dErr=description.length>LIM.description?'Description must be '+LIM.description+' characters or fewer.':'';
    var uErr=!url?'Link is required.':(url.length>LIM.url?'Link must be '+LIM.url+' characters or fewer.':(!isHttpUrl(url)?'Enter a valid http:// or https:// URL.':''));
    setFieldErr('elTitle','elTitleErr',tErr); setFieldErr('elDesc','elDescErr',dErr); setFieldErr('elUrl','elUrlErr',uErr); setFieldErr('elAuthor','elAuthorErr',aErr);
    var firstBad=tErr?'elTitle':(dErr?'elDesc':(uErr?'elUrl':(aErr?'elAuthor':null)));
    if(firstBad){ document.getElementById(firstBad).focus(); return {ok:false}; }
    return {ok:true, value:{title:title, description:description, url:url, author:author}};
  }
  function openAdd(opener){
    ensureAddModal();
    document.getElementById('elAddForm').reset();
    setFieldErr('elTitle','elTitleErr',''); setFieldErr('elDesc','elDescErr',''); setFieldErr('elUrl','elUrlErr',''); setFieldErr('elAuthor','elAuthorErr','');
    document.getElementById('elAuthor').value=me;   // prefilled with your login ID; editable
    showErr(document.getElementById('elAddErr'),'');
    var s=document.getElementById('elAddSave'); s.disabled=false; s.textContent='Save'; s.removeAttribute('aria-busy');
    openModal(addBg,opener,document.getElementById('elTitle'));
  }
  async function doAdd(){
    var s=document.getElementById('elAddSave'); if(s.disabled)return;
    var err=document.getElementById('elAddErr'); showErr(err,'');
    var v=validateForm(); if(!v.ok)return;
    s.disabled=true; s.textContent='Saving\u2026'; s.setAttribute('aria-busy','true');
    var r;
    try{ r=await A.api('POST','/api/external-links',v.value); }
    catch(e){ r={ok:false,status:0,data:{error:'Network error. Please try again.'}}; }
    s.disabled=false; s.textContent='Save'; s.removeAttribute('aria-busy');
    if(!r.ok){ showErr(err,(r.data&&r.data.error)||('Could not add the link (HTTP '+r.status+').')); return; }
    appendLink(r.data);
    closeModal();
  }
  if(isAdmin){
    var h=document.querySelector('#linksSec .home-sec-h');
    if(h && !document.getElementById('elAddBtn')){
      var b=document.createElement('button');
      b.type='button'; b.className='el-add-btn'; b.id='elAddBtn';
      b.setAttribute('aria-haspopup','dialog');
      b.innerHTML=icH('plus',14)+'<span>Add External link</span>';
      b.addEventListener('click',function(){ openAdd(b); });
      h.appendChild(b);
    }
  }

  // Fetch after the base tiles have rendered; never blocks the page and nothing is cached.
  (async function(){
    try{
      var r=await A.api('GET','/api/external-links');
      if(!r.ok||!Array.isArray(r.data)){
        var e=document.getElementById('extLinksEmpty');
        if(e){ e.textContent='Could not load external links.'; e.hidden=false; }
        return;
      }
      loaded=true;
      r.data.forEach(appendLink);
      syncEmpty();
    }catch(e){}
  })();
})();

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

// Draw the per-year comparison table's trend sparklines (2021-2026). All year values — including
// 2026 (approximate program averages: ~2,375/mo, ~116.4 hrs, ~90.1%) — are now HARDCODED in the
// HTML; this no longer fetches /api/year-metrics. Each row's data-fixed already carries all six
// points, so we just mirror it into data-vals and render. No-op if the table is missing.
(function(){
  var table=document.getElementById('yearCmpTable'); if(!table)return;
  var sparkFromFixed=function(metric){
    var row=table.querySelector('tr[data-metric="'+metric+'"]'); if(!row)return;
    var cell=row.querySelector('.cmp-spark'); if(!cell)return;
    var fixed=(cell.getAttribute('data-fixed')||'').split(',').filter(Boolean);
    cell.setAttribute('data-vals',fixed.join(','));
  };
  sparkFromFixed('vol'); sparkFromFixed('res'); sparkFromFixed('sla');
  renderCmpSparks();
})();
