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
  // Tile background choices (keys match server/external-links.js EXT_LINK_BGS). No red / purple /
  // green / yellow / black. '' = the default white tile.
  var BGS=[
    {key:'',       name:'Default (white)', hex:'#ffffff'},
    {key:'navy',   name:'Navy',  hex:'#1f2a40'},
    {key:'blue',   name:'Blue',  hex:'#2563eb'},
    {key:'sky',    name:'Sky',   hex:'#dbeafe'},
    {key:'cyan',   name:'Cyan',  hex:'#0e7490'},
    {key:'orange', name:'Orange',hex:'#ea580c'},
    {key:'brown',  name:'Brown', hex:'#7c4a1e'},
    {key:'slate',  name:'Slate', hex:'#475569'}
  ];
  function bgOf(key){ for(var i=0;i<BGS.length;i++) if(BGS[i].key===key) return BGS[i]; return BGS[0]; }
  // WCAG relative luminance -> pick the text colour with the higher contrast (white vs dark ink).
  function lum(hex){
    var c=hex.replace('#',''), v=[0,2,4].map(function(i){ var x=parseInt(c.substr(i,2),16)/255; return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4); });
    return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];
  }
  function onDark(hex){ var L=lum(hex); return (1.05/(L+0.05)) > ((L+0.05)/(lum('#1b2026')+0.05)); }

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
    // Chosen background: inline colour + a light/dark text class picked for contrast.
    var bg=bgOf(l.bg||''), bgCls='', bgSty='';
    if(bg.key){ bgCls=' nt-bg '+(onDark(bg.hex)?'nt-on-dark':'nt-on-light'); bgSty=' style="--tbg:'+bg.hex+'"'; }
    // Defence in depth: only http(s) URLs ever become an href.
    var tile=isHttpUrl(l.url)
      ? '<a class="nav-tile nt-external'+bgCls+'"'+bgSty+' href="'+esc(l.url)+'" target="_blank" rel="noopener noreferrer">'+inner+'</a>'
      : '<div class="nav-tile nt-external'+bgCls+'"'+bgSty+' aria-disabled="true">'+inner+'</div>';
    var btn=del ? '<button type="button" class="nt-del" data-id="'+esc(l.id)+'" aria-label="Delete link '+esc(l.title)+'" title="Delete link">'+icH('trash',14)+'</button>' : '';
    return '<div class="nt-wrap'+(del?' nt-has-del':'')+'" data-link-id="'+esc(l.id)+'">'+tile+btn+'</div>';
  }
  function grid(){ return document.getElementById('extLinks'); }
  // Empty state for the External links section (shown once the list has loaded and is empty).
  var loaded=false;
  function syncEmpty(){
    var e=document.getElementById('extLinksEmpty'); if(!e)return;
    var none=loaded && !Object.keys(links).length;
    var m=document.getElementById('extLinksEmptyMsg')||e;
    m.textContent=isAdmin?'No external links yet. Use Add External link to add one.':'No external links yet.';
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
          // Background colour: radio swatches; the text colour follows automatically (contrast).
          '<fieldset class="el-bgs"><legend>Background colour</legend><div class="el-bg-row">'+
            BGS.map(function(b,i){
              var dark=onDark(b.hex);
              return '<label class="el-bg" title="'+esc(b.name)+'"><input type="radio" name="elBg" value="'+esc(b.key)+'"'+(i===0?' checked':'')+'>'+
                '<span class="el-bg-sw" style="background:'+b.hex+';color:'+(dark?'#fff':'#1b2026')+'" aria-hidden="true">Aa</span>'+
                '<span class="el-bg-n">'+esc(b.name)+'</span></label>';
            }).join('')+
          '</div><p class="el-bg-hint">The text colour switches automatically so it stays readable on the chosen background.</p></fieldset>'+
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
    var bgSel=document.querySelector('#elAddForm input[name="elBg"]:checked');
    return {ok:true, value:{title:title, description:description, url:url, author:author, bg:bgSel?bgSel.value:''}};
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
    var h=document.querySelector('#linksSec .hm-card-head');
    if(h && !document.getElementById('elAddBtn')){
      var b=document.createElement('button');
      b.type='button'; b.className='el-add-btn'; b.id='elAddBtn';
      b.setAttribute('aria-haspopup','dialog');
      b.innerHTML=icH('plus',14)+'<span>Add External link</span>';
      b.addEventListener('click',function(){ openAdd(b); });
      h.appendChild(b);
    }
  }

  // ---- Loading / error states for the External links fetch ----
  // While loading: skeleton tiles in #extLinks, aria-busy on the section, a polite status message.
  // On failure: a styled error card with a Retry button that re-runs the same request.
  var sec=document.getElementById('linksSec');
  var statusEl=document.getElementById('extLinksStatus');
  var errBox=document.getElementById('extLinksErr');
  var errMsg=document.getElementById('extLinksErrMsg');
  var retryBtn=document.getElementById('extLinksRetry');
  var loading=false;
  function say(t){ if(statusEl) statusEl.textContent=t; }
  function skelTile(){
    return '<div class="nav-tile nt-skel-tile" aria-hidden="true">'+
      '<div class="hm-skel-row"><span class="hm-skel" style="width:42px;height:42px;border-radius:10px"></span>'+
        '<div class="hm-skel-col"><span class="hm-skel" style="width:38%;height:12px;border-radius:99px"></span><span class="hm-skel" style="width:70%;height:16px"></span></div></div>'+
      '<span class="hm-skel" style="width:92%;height:11px"></span><span class="hm-skel" style="width:64%;height:11px"></span>'+
      '<span class="hm-skel" style="width:34%;height:12px;margin-top:8px"></span>'+
    '</div>';
  }
  function setLoading(on){
    loading=on;
    if(sec){ if(on) sec.setAttribute('aria-busy','true'); else sec.removeAttribute('aria-busy'); }
  }
  function showLoadErr(msg){
    var g=grid(); if(g) g.innerHTML='';
    var e=document.getElementById('extLinksEmpty'); if(e) e.hidden=true;
    if(errMsg) errMsg.textContent=msg;
    if(errBox) errBox.hidden=false;
    say('External links failed to load.');
  }
  // Fetch after the base tiles have rendered; never blocks the page and nothing is cached.
  async function loadLinks(){
    if(loading)return;
    var g=grid();
    Object.keys(links).forEach(function(k){ delete links[k]; });
    loaded=false;
    if(errBox) errBox.hidden=true;
    var e=document.getElementById('extLinksEmpty'); if(e) e.hidden=true;
    if(g) g.innerHTML=skelTile()+skelTile()+skelTile();
    setLoading(true); say('Loading external links\u2026');
    var r;
    try{ r=await A.api('GET','/api/external-links'); }
    catch(err){ r=null; }
    setLoading(false);
    if(!r){ showLoadErr('We couldn\u2019t reach the server. Check your connection and try again.'); return; }
    if(!r.ok||!Array.isArray(r.data)){
      showLoadErr('The server couldn\u2019t return the links right now (HTTP '+r.status+'). Please try again.');
      return;
    }
    if(g) g.innerHTML='';
    loaded=true;
    r.data.forEach(appendLink);
    syncEmpty();
    say(r.data.length?(r.data.length+' external link'+(r.data.length===1?'':'s')+' loaded.'):'No external links yet.');
  }
  if(retryBtn) retryBtn.addEventListener('click',function(){
    loadLinks().then(function(){
      // Keep keyboard focus sensible: first link on success, Retry again on failure.
      if(errBox&&!errBox.hidden){ retryBtn.focus(); return; }
      var first=grid()&&grid().querySelector('a.nav-tile'); if(first) first.focus();
    });
  });
  loadLinks();
})();

// ---- Comparison-table mini charts: labeled 3-point trend (Before -> Q2 -> Q3) per row. ----
// Plots the REAL metric values with a Y axis (min/mid/max ticks) and an X axis (Before/Q2/Q3), so
// the numbers are readable. Line is green when the metric improves over time, red if it worsens.
// `data-dir="up"` = higher is better; `data-dir="down"` = lower is better.
function renderCmpSparks(){
  var cells=document.querySelectorAll('.cmp-spark[data-vals]'); if(!cells.length)return;
  // Consistent palette for every row: navy line + soft area, white points, the 2026 (last) point in
  // orange to match the highlighted 2026 column. Only the first and last values are labelled so the
  // labels stay readable at this size; the full series is in the aria-label (and the table itself).
  var W=200, H=56, L=8, R=8, T=16, B=6;
  var NAVY='#1f2a40', ACC='#ec7211';
  var fmt=function(v){ v=Math.round(v*10)/10; return (v>=1000)?Math.round(v).toLocaleString():String(v); };
  cells.forEach(function(td){
    var vals=(td.getAttribute('data-vals')||'').split(',').map(function(v){return parseFloat(v);}).filter(function(v){return !isNaN(v);});
    if(vals.length<2)return;
    var n=vals.length;
    var unit=td.getAttribute('data-unit')||'';
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
    var lab=function(i,anchor,col){
      // Above the point (below it when the point is near the top); first label runs right, last runs left.
      var p=pts[i], y=(p[1]-T<2)?p[1]+14:p[1]-6;
      return '<text x="'+(anchor==='start'?p[0]-4:p[0]+4).toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="'+anchor+'" font-size="10" font-weight="800" fill="'+col+'">'+fmt(vals[i])+'</text>';
    };
    var dots=pts.map(function(p,i){ var last=(i===n-1); return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(last?3.6:2.4)+'" fill="'+(last?ACC:'#fff')+'" stroke="'+(last?'#fff':NAVY)+'" stroke-width="1.5"/>'; }).join('');
    var years=[2021,2022,2023,2024,2025,2026].slice(-n);
    var desc='Trend '+years[0]+' to '+years[n-1]+': '+vals.map(function(v,i){ return years[i]+' '+fmt(v)+unit; }).join(', ');
    td.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" role="img" aria-label="'+desc+'">'+
      '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0" stop-color="'+NAVY+'" stop-opacity=".16"/><stop offset="1" stop-color="'+NAVY+'" stop-opacity="0"/>'+
      '</linearGradient></defs>'+
      '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(T+innerH)+'" y2="'+(T+innerH)+'" stroke="#e2e6ea" stroke-width="1"/>'+
      '<path d="'+area+'" fill="url(#'+gid+')"/>'+
      '<path d="'+line+'" fill="none" stroke="'+NAVY+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'+
      dots+lab(0,'start','#5c6773')+lab(n-1,'end','#9a4100')+
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
