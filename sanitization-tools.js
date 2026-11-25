// Sanitization tools shared by sanitization-tracker.html (moved here from ticket-sanitization.html):
//   - the hero action grid (PHDSanTools.heroActsHtml): "Update tickets data" (owner only) plus whatever
//     the page passes in opts.extra (its "Copy prompt", "Sanitization checklist" and, for the owner,
//     "Sanitization assignment log" buttons), two per row,
//   - the "Update tickets data" pop-up (owner only; POST /api/sanitization-update, the server enforces it).
// Styles: sanitization-tools.css. Needs icons.js, api-config.js and topbar-auth.js (PHDAuth, PHDLoginUI,
// PHDParseCSV, the shared .tbl-* dialog shell).
// Everything lives inside one IIFE; only the open / close functions and PHDSanTools are global.
(function () {
'use strict';
var A = window.PHDAuth;
var ic = function (n, s) { return window.icon ? window.icon(n, s || 18) : ''; };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var SPIN = '<span class="ts-spin" aria-hidden="true"></span>';
function saPlural(n, one, many) { n = Number(n) || 0; return n.toLocaleString() + ' ' + (n === 1 ? one : (many || one + 's')); }
var TS_OWNER = 'harisss';
function tsIsOwner() { var u = A && A.getUser && A.getUser(); return !!(u && String(u.username || '').trim().toLowerCase() === TS_OWNER); }
// Polite live region of its own (outside the page's re-rendered content).
function announce(msg) {
  var el = document.getElementById('tstLive');
  if (!el) { el = document.createElement('span'); el.id = 'tstLive'; el.className = 'ts-sr'; el.setAttribute('aria-live', 'polite'); el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 30);
}

// Hero buttons in a two-column grid (sanitization-tools.css .ts-hero-acts.is-rows): "Update tickets data"
// (owner only) first, then opts.extra - the page's "Copy prompt", "Sanitization checklist" and, for the
// owner, "Sanitization assignment log" buttons. A contractor's two buttons fill the first row.
function heroActsHtml(opts) {
  opts = opts || {};
  return '<div class="ts-hero-acts is-rows">' +
    (opts.owner ? '<button type="button" class="ts-hero-link ts-hero-upd" id="tsUpdBtn" onclick="tsUpdOpen()" aria-haspopup="dialog" title="Update existing tickets from cleaned CSVs: tickets are matched by ShortId and only changed, non-blank cells are written">' +
      '<span class="ts-hl-sheet" aria-hidden="true">' + ic('upload', 18) + '</span>' +
      '<span class="ts-hl-txt"><span class="ts-hl-t">Update tickets data</span></span></button>' : '') +
    (opts.extra || '') +
    '</div>';
}

// ---- "Update tickets data" (owner only): cleaned ticket CSVs -> updates to existing tickets ----
// Files are parsed in the browser with the main upload's CSV parser (topbar-auth.js PHDParseCSV, quoted
// multi-line cells kept). Step 1 = server dry run (preview), step 2 = the write; the page then reloads so
// the scores and the tracker's ticket statuses recompute.
var TSU_MAX_ROWS=50000, TSU_MAX_BYTES=14.5*1024*1024;
var TSU_SKIP_COLS={IssueId:1,_id:1,q:1,IssueUrl:1,CreateDate:1};   // identity / system columns (the server ignores them too)
var UD=null;   // { files:[{name,size,rows,noId,err}], step:'pick'|'preview'|'done', busy, err, preview, done }
function tsuRows(){ var out=[]; UD.files.forEach(function(f){ if(f.rows) out=out.concat(f.rows); }); return out; }
// One parsed CSV -> rows of { ShortId, non-blank columns } (blank cells never overwrite, so they are not sent).
function tsuParse(text){
  var parse=window.PHDParseCSV; if(typeof parse!=='function') throw new Error('CSV parser unavailable. Reload the page.');
  var rows=[], noId=0;
  parse(String(text||'')).forEach(function(r){
    var id=String(r.ShortId==null?'':r.ShortId).trim(), o={}, any=false;
    Object.keys(r).forEach(function(k){
      if(!k||k==='ShortId'||TSU_SKIP_COLS[k]) return;
      var v=String(r[k]==null?'':r[k]); if(v.trim()===''){ return; }
      o[k]=v; any=true;
    });
    if(!id){ if(any) noId++; return; }
    o.ShortId=id; rows.push(o);
  });
  return {rows:rows,noId:noId};
}
async function tsuAddFiles(list){
  if(!UD||UD.busy) return;
  var files=Array.prototype.slice.call(list||[]); if(!files.length) return;
  UD.err=''; UD.preview=null; UD.step='pick'; UD.busy=true; UD.reading=true; tsuPaint();
  for(var i=0;i<files.length;i++){
    var f=files[i];
    if(UD.files.some(function(x){ return x.name===f.name&&x.size===f.size; })) continue;
    var ent={name:f.name,size:f.size,rows:null,noId:0,err:''};
    if(!/\.csv$/i.test(f.name)) ent.err='Not a .csv file';
    else {
      try{ var p=tsuParse(await f.text()); ent.rows=p.rows; ent.noId=p.noId; if(!p.rows.length) ent.err='No rows with a ShortId'; }
      catch(e){ ent.err='Could not read this CSV'; ent.rows=null; }
    }
    UD.files.push(ent);
  }
  if(!UD) return;
  UD.busy=false; UD.reading=false; tsuPaint('#tsuFile');
  var n=tsuRows().length; announce(saPlural(UD.files.length,'file')+' chosen, '+saPlural(n,'row')+'.');
}
function tsUpdOpen(){
  if(!tsIsOwner()) return;
  tsUpdClose(true);
  UD={files:[],step:'pick',busy:false,err:'',preview:null,done:null};
  var ov=document.createElement('div'); ov.id='tsUpdDlg'; ov.className='tbl-bg'; ov.style.cssText='display:flex;z-index:5000';
  ov.innerHTML='<div class="tbl-card" role="dialog" aria-modal="true" aria-labelledby="tsUpdT" aria-describedby="tsUpdSub">'+
    '<div class="tbl-head"><span class="tbl-head-ic" aria-hidden="true">'+ic('upload',20)+'</span>'+
      '<div class="tbl-head-tx"><div class="tbl-eyebrow">Ticket Sanitization \u00b7 Update data</div><h2 class="tbl-title" id="tsUpdT">Update tickets data</h2></div>'+
      '<button type="button" class="tbl-x" data-tsux="1" aria-label="Close">'+ic('close',18)+'</button>'+
      '<p class="tbl-sub" id="tsUpdSub">Match existing tickets by ShortId; only changed, non-blank cells are written.</p></div>'+
    '<div class="tbl-body" id="tsUpdBody"></div></div>';
  ov.addEventListener('click',function(e){ if(e.target===ov) tsUpdClose(); });
  document.body.appendChild(ov);
  if(window.PHDLoginUI) window.PHDLoginUI.opened(ov,function(){ tsUpdClose(); },null);
  tsuPaint('#tsuFile');
}
window.tsUpdOpen=tsUpdOpen;
function tsUpdClose(force){
  var ov=document.getElementById('tsUpdDlg'); if(!ov) return;
  if(UD&&(UD.busy||UD.step==='done')&&!force) return;
  UD=null; ov.remove(); if(window.PHDLoginUI) window.PHDLoginUI.closed(ov);
  var b=document.getElementById('tsUpdBtn'); if(b&&!force) b.focus();
}
window.tsUpdClose=tsUpdClose;
function tsuErrP(){ return '<p class="tbl-err" id="tsuErr" role="alert"'+(UD.err?' style="display:block"':'')+'>'+esc(UD.err||'')+'</p>'; }
function tsuStat(n,label,hl){ return '<li'+(hl?' class="is-hl"':'')+'><b>'+(Number(n)||0).toLocaleString()+'</b><span>'+esc(label)+'</span></li>'; }
function tsuPickHtml(){
  var rows=tsuRows().length, ok=rows>0&&rows<=TSU_MAX_ROWS&&!UD.busy;
  var list=UD.files.length?'<ul class="tsu-files" aria-label="Chosen files">'+UD.files.map(function(f,i){
    var c=f.err?'<span class="tsu-fc is-bad">'+esc(f.err)+'</span>':'<span class="tsu-fc">'+saPlural(f.rows.length,'row')+(f.noId?' \u00b7 '+saPlural(f.noId,'row')+' without ShortId skipped':'')+'</span>';
    return '<li><span class="tsu-fn">'+esc(f.name)+'</span>'+c+
      '<button type="button" class="tsu-rm" data-tsurm="'+i+'" aria-label="Remove '+esc(f.name)+'"'+(UD.busy?' disabled':'')+'>'+ic('close',14)+'</button></li>';
  }).join('')+'</ul>':'';
  var tot=UD.files.length?'<p class="tsu-hint" aria-live="polite">'+saPlural(UD.files.length,'file')+' \u00b7 '+saPlural(rows,'row')+' in total'+
    (rows>TSU_MAX_ROWS?' \u00b7 at most '+TSU_MAX_ROWS.toLocaleString()+' rows per update':'')+'</p>':'';
  return '<div class="tsu-drop" id="tsuDrop">'+ic('upload',22)+
      '<p class="tsu-drop-t" id="tsuDropT">Drop CSV files here, or choose them</p>'+
      '<input type="file" id="tsuFile" accept=".csv,text/csv" multiple aria-labelledby="tsuDropT"'+(UD.busy?' disabled':'')+'>'+
      '<p class="tsu-hint" style="margin:0">Several files at once. Columns not in a file, blank cells, ShortId, IssueId, IssueUrl and CreateDate are never changed. New tickets are never added.</p></div>'+
    list+tot+(UD.busy?'<p class="tsu-hint" role="status">'+SPIN+(UD.reading?' Reading files\u2026':' Checking the tickets\u2026')+'</p>':'')+tsuErrP()+
    '<div class="tbl-actions tbl-row"><button type="button" class="tbl-cancel" data-tsux="1"'+(UD.busy?' disabled':'')+'>Cancel</button>'+
      '<button type="button" class="tbl-submit'+(UD.busy?' is-busy':'')+'" id="tsuGo" data-tsugo="preview"'+(ok?'':' disabled')+(UD.busy?' aria-busy="true"':'')+'>'+(UD.busy&&!UD.reading?'Checking\u2026':'Preview')+'</button></div>';
}
function tsuPreviewHtml(){
  var p=UD.preview, n=p.ticketsChanged||0;
  var pf=Object.keys(p.perField||{}).sort(function(a,b){ return p.perField[b]-p.perField[a]||a.localeCompare(b); });
  var html='<ul class="tsu-grid" aria-label="Preview">'+
      tsuStat((p.files||[]).length,'Files')+tsuStat(p.totalRows,'Total rows')+tsuStat(p.uniqueTickets,'Unique tickets')+
      tsuStat(p.matched,'Matched tickets')+tsuStat(p.notFoundCount,'Not found (ignored)')+
      tsuStat(n,'Tickets that would change',true)+tsuStat(p.unchanged,'Unchanged tickets')+'</ul>';
  html+='<p class="tsu-h">Changes per field</p>'+(pf.length?'<ul class="tsu-pf">'+pf.map(function(k){ return '<li>'+esc(k)+' '+Number(p.perField[k]).toLocaleString()+'</li>'; }).join('')+'</ul>':'<p class="tsu-hint" style="margin:0">No field changes.</p>');
  if(p.docsChanged>n) html+='<p class="tsu-hint">'+saPlural(p.docsChanged,'ticket record')+' across quarters will be updated (a ticket can sit in several quarters).</p>';
  if(p.duplicateCount) html+='<p class="tsu-note"><b>'+saPlural(p.duplicateCount,'ShortId')+'</b> appear in more than one row. Rows are applied in file order, so the <b>last file wins</b> for each non-blank cell.</p>'+
    '<details class="tsu-det"><summary>Duplicate ShortIds</summary><div class="tsu-ids">'+esc((p.duplicates||[]).join(', '))+(p.duplicateCount>(p.duplicates||[]).length?' \u2026':'')+'</div></details>';
  if(p.notFoundCount) html+='<details class="tsu-det"><summary>'+saPlural(p.notFoundCount,'ShortId')+' not found in the database (ignored)</summary><div class="tsu-ids">'+esc((p.notFound||[]).join(', '))+(p.notFoundCount>(p.notFound||[]).length?' \u2026':'')+'</div></details>';
  if(p.ignoredColumns&&p.ignoredColumns.length) html+='<p class="tsu-hint">Ignored columns (not ticket fields or protected): '+esc(p.ignoredColumns.join(', '))+'</p>';
  if(p.sample&&p.sample.length) html+='<p class="tsu-h" id="tsuSmpK">Sample of changes (up to 10)</p><div class="tsu-tw"><table class="tsu-tbl" aria-labelledby="tsuSmpK"><thead><tr><th scope="col">ShortId</th><th scope="col">Field</th><th scope="col">Old \u2192 New</th></tr></thead><tbody>'+
    p.sample.map(function(s){ return '<tr><td>'+esc(s.shortId)+'</td><td>'+esc(s.field)+'</td><td class="tsu-v"><span class="tsu-old">'+(esc(s.old)||'<i>blank</i>')+'</span><span aria-hidden="true"> \u2192 </span><span class="ts-sr"> changes to </span><span class="tsu-new">'+esc(s.new)+'</span></td></tr>'; }).join('')+'</tbody></table></div>';
  html+=(UD.busy?'<p class="tsu-hint" role="status">'+SPIN+' Updating tickets\u2026</p>':'')+tsuErrP()+
    '<div class="tbl-actions tbl-row"><button type="button" class="tbl-cancel" data-tsuback="1"'+(UD.busy?' disabled':'')+'>Back</button>'+
      '<button type="button" class="tbl-cancel" data-tsux="1"'+(UD.busy?' disabled':'')+'>Cancel</button>'+
      '<button type="button" class="tbl-submit'+(UD.busy?' is-busy':'')+'" id="tsuGo" data-tsugo="write"'+(UD.busy||!n?' disabled':'')+(UD.busy?' aria-busy="true"':'')+'>'+(UD.busy?'Updating\u2026':(n?'Update '+saPlural(n,'ticket'):'Nothing to update'))+'</button></div>';
  return html;
}
function tsuPaint(focusSel){
  var b=document.getElementById('tsUpdBody'); if(!b||!UD) return;
  if(UD.step==='done') b.innerHTML='<p class="tsu-ok" role="status" id="tsuOk" tabindex="-1">'+ic('check-circle',18)+'Updated '+saPlural(UD.done.updated,'ticket')+'</p><p class="tsu-hint">Reloading the page so the scores and assignments recompute\u2026</p>';
  else b.innerHTML=UD.step==='preview'&&UD.preview?tsuPreviewHtml():tsuPickHtml();
  var f=focusSel?b.querySelector(focusSel):null;
  if(!f&&UD.step==='preview') f=b.querySelector('#tsuGo:not(:disabled)')||b.querySelector('.tbl-cancel');
  if(!f&&UD.step==='done') f=b.querySelector('#tsuOk');
  if(f&&!f.disabled) f.focus();
}
async function tsuSend(dryRun){
  if(!UD||UD.busy) return;
  var rows=tsuRows();
  if(!rows.length){ UD.err='Choose at least one CSV file with ShortId rows.'; tsuPaint(); return; }
  if(rows.length>TSU_MAX_ROWS){ UD.err='Too many rows: at most '+TSU_MAX_ROWS.toLocaleString()+' per update.'; tsuPaint(); return; }
  var body={rows:rows,files:UD.files.filter(function(f){ return f.rows&&f.rows.length; }).map(function(f){ return f.name; }),dryRun:!!dryRun};
  var size=0; try{ size=JSON.stringify(body).length; }catch(e){}
  if(size>TSU_MAX_BYTES){ UD.err='These files are too large to send at once. Upload fewer files at a time.'; tsuPaint(); return; }
  var ud=UD; UD.busy=true; UD.err=''; tsuPaint('#tsuGo');
  var r=null; try{ r=await A.api('POST','/api/sanitization-update',body); }catch(e){ r=null; }
  if(UD!==ud) return;
  UD.busy=false;
  if(!r||!r.ok){
    UD.err=(r&&r.data&&r.data.error)||(r&&r.status===413?'These files are too large to send at once. Upload fewer files at a time.':'Could not reach the server. Try again.');
    tsuPaint('#tsuGo'); announce(UD.err); return;
  }
  if(dryRun){ UD.preview=r.data; UD.step='preview'; tsuPaint(); announce(saPlural(r.data.ticketsChanged||0,'ticket')+' would change.'); return; }
  UD.done=r.data; UD.step='done'; tsuPaint();
  announce('Updated '+saPlural(r.data.updated||0,'ticket')+'. Reloading the page.');
  setTimeout(function(){ location.reload(); },1500);
}
document.addEventListener('click',function(ev){
  var t=ev.target; if(!t||!t.closest||!t.closest('#tsUpdDlg')||!UD) return;
  if(t.closest('[data-tsux]')){ tsUpdClose(); return; }
  if(t.closest('[data-tsuback]')){ if(!UD.busy){ UD.step='pick'; UD.preview=null; UD.err=''; tsuPaint('#tsuGo'); } return; }
  var rm=t.closest('[data-tsurm]'); if(rm&&!UD.busy){ UD.files.splice(Number(rm.getAttribute('data-tsurm')),1); UD.preview=null; UD.err=''; tsuPaint('#tsuFile'); return; }
  var go=t.closest('[data-tsugo]'); if(go&&!go.disabled){ tsuSend(go.getAttribute('data-tsugo')==='preview'); }
});
document.addEventListener('change',function(ev){
  var el=ev.target; if(!el||el.id!=='tsuFile'||!UD) return;
  var fl=el.files; tsuAddFiles(fl);
});
['dragenter','dragover'].forEach(function(n){ document.addEventListener(n,function(ev){
  var z=ev.target&&ev.target.closest?ev.target.closest('#tsuDrop'):null; if(!z||!UD||UD.busy) return;
  ev.preventDefault(); z.classList.add('is-over');
}); });
['dragleave','drop'].forEach(function(n){ document.addEventListener(n,function(ev){
  var z=ev.target&&ev.target.closest?ev.target.closest('#tsuDrop'):null; if(!z||!UD) return;
  if(n==='dragleave'&&ev.relatedTarget&&z.contains(ev.relatedTarget)) return;
  z.classList.remove('is-over');
  if(n==='drop'){ ev.preventDefault(); if(!UD.busy&&ev.dataTransfer) tsuAddFiles(ev.dataTransfer.files); }
}); });

// Esc closes the "Update tickets data" pop-up.
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { tsUpdClose(); } });
window.PHDSanTools = { heroActsHtml: heroActsHtml };
})();
