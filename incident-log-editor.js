// ====================================================================================
// Shared structured incident-log editor ("Add / Edit incident log · <ID>" modal).
// Used by my-tickets.html and important-cases.html.
//
// What lives here (page-agnostic):
//   - the modal markup (IncidentLogEditor.markupHtml / mount) — fixed ids (incidentModal, ilPhdFindings…)
//   - the light-theme CSS (IncidentLogEditor.injectStyles — opt-in; my-tickets keeps its own inline
//     copy so its existing cascade is untouched)
//   - parse / serialize (parseIncidentOutput / ilSerializeFields / buildIncidentOutput)
//   - field lock/edit toggles, per-field copy, empty markers, autosize, Root Cause / Resolution
//     selects, footer Copy + Copy w/o RC Details, title copy-ID.
//
// What each page provides (globals referenced by the markup's onclick handlers):
//   closeIncidentLog(), submitIncidentLog(), deleteIncidentFromForm()
// Optional page globals used at call time: toast(msg), window.icon(name,size),
// window.RC_ROOT_CAUSES / RC_RESOLUTIONS / makeSearchableSelect (issue-types-data.js).
//
// All helpers keep the exact global names my-tickets.html already calls.
// ====================================================================================

function _ileIc(n,s){ return (typeof window!=='undefined' && window.icon) ? window.icon(n,s) : ''; }
function _ileEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function _ileToast(m){ if(typeof window!=='undefined' && typeof window.toast==='function') window.toast(m); }

// ---- Pure parse / serialize (no DOM; also exported for Node) ----
// Assemble the 7 structured fields into the standard copy/save format.
// f = {findings, invest, sim, rootCause, link, res, notes}; opts.omitSim drops the SIM section.
function ilSerializeFields(f,opts){
  opts=opts||{}; f=f||{};
  var v=function(k){ return String(f[k]==null?'':f[k]).trim(); };
  var parts=[];
  parts.push('**PHD Findings**:\n'+(v('findings')||'-'));
  parts.push('**PHD Investigation for mitigation:**\n'+(v('invest')||'-'));
  if(!opts.omitSim) parts.push('**SIM Root Cause Details:**\n'+(v('sim')||'-'));
  parts.push('**Root Cause**: '+(v('rootCause')||''));
  parts.push('**PHD Related Link**: '+(v('link')||''));
  parts.push('**PHD Resolution**: '+(v('res')||''));
  parts.push('**PHD notes**:\n'+(v('notes')||'-'));
  return parts.join('\n\n');
}
// Reverse of ilSerializeFields: split a saved log blob back into the 7 structured fields so the
// Edit flow reopens the same split form. Tolerant of extra whitespace; a lone "-" placeholder -> ''.
function parseIncidentOutput(text){
  var s=String(text||'').replace(/\r\n/g,'\n');
  var clean=function(v){ v=String(v||'').trim(); return (v==='-')?'':v; };
  // Capture each labelled section up to the next known label (or end).
  var grab=function(re){ var m=s.match(re); return m?clean(m[1]):''; };
  var NEXT='(?=\\n\\n\\*\\*PHD Investigation|\\n\\n\\*\\*SIM Root Cause|\\n\\n\\*\\*Root Cause\\*\\*|\\n\\n\\*\\*PHD Related Link\\*\\*|\\n\\n\\*\\*PHD Resolution\\*\\*|\\n\\n\\*\\*PHD notes\\*\\*|$)';
  return {
    findings:  grab(new RegExp('(?:\\*\\*)?PHD Findings(?:\\*\\*)?:\\n([\\s\\S]*?)'+NEXT, 'i')),
    invest:    grab(new RegExp('\\*\\*PHD Investigation for mitigation:\\*\\*\\n([\\s\\S]*?)'+NEXT, 'i')),
    sim:       grab(new RegExp('\\*\\*SIM Root Cause Details:\\*\\*\\n([\\s\\S]*?)'+NEXT, 'i')),
    rootCause: grab(new RegExp('\\*\\*Root Cause\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    link:      grab(new RegExp('\\*\\*PHD Related Link\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    res:       grab(new RegExp('\\*\\*PHD Resolution\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    notes:     grab(new RegExp('\\*\\*PHD notes\\*\\*:\\n([\\s\\S]*?)'+NEXT, 'i'))
  };
}
// Assemble the structured form fields (DOM) into the standard copy/save format.
// opts.omitSim === true drops the "SIM Root Cause Details" section (used by "Copy w/o RC Details").
function buildIncidentOutput(opts){
  var g=function(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; };
  return ilSerializeFields({
    findings:g('ilPhdFindings'), invest:g('ilPhdInvestigation'), sim:g('ilSimRcd'),
    rootCause:g('ilRootCause'), link:g('ilRelatedLink'), res:g('ilPhdResolution'), notes:g('ilPhdNotes')
  }, opts);
}

// ---- DOM helpers (fixed element ids from the shared markup) ----
var IL_FIELD_IDS=['ilPhdFindings','ilPhdInvestigation','ilSimRcd','ilRootCause','ilRelatedLink','ilPhdResolution','ilPhdNotes'];
var IL_TICKET_SID='';  // the ticket ShortId the modal is currently open for (for the title copy icon)
// Populate the Root Cause + PHD Resolution dropdowns from the shared data file (once).
var _ilSelectsFilled=false;
function fillIncidentSelects(){
  if(_ilSelectsFilled) return; _ilSelectsFilled=true;
  var rc=document.getElementById('ilRootCause');
  if(rc){ var causes=window.RC_ROOT_CAUSES||[];
    rc.innerHTML='<option value="">— Select root cause —</option>'+causes.map(function(c){return '<option value="'+_ileEsc(c)+'">'+_ileEsc(c)+'</option>';}).join('');
    if(window.makeSearchableSelect) window.makeSearchableSelect(rc); }
  var res=document.getElementById('ilPhdResolution');
  if(res){ var rl=window.RC_RESOLUTIONS||[];
    res.innerHTML='<option value="">— Select resolution —</option>'+rl.map(function(c){return '<option value="'+_ileEsc(c)+'">'+_ileEsc(c)+'</option>';}).join('');
    if(window.makeSearchableSelect) window.makeSearchableSelect(res); }
}
// Resync the searchable comboboxes for the two dropdowns (after their .value is set directly).
function ilRefreshSelectUI(){
  ['ilRootCause','ilPhdResolution'].forEach(function(id){ var el=document.getElementById(id); if(el && el._ssWrap && window.makeSearchableSelect) window.makeSearchableSelect(el); });
  if(typeof ilSyncResolutionEnabled==='function') ilSyncResolutionEnabled();   // gate PHD Resolution on SIM content
}
// Reveal + paint the title's "copy ticket ID" icon for the given ShortId.
function ilSetTitleCopyId(sid){
  IL_TICKET_SID=String(sid||'');
  var btn=document.getElementById('incidentIdCopyBtn'); if(!btn) return;
  if(IL_TICKET_SID){ btn.style.display=''; btn.innerHTML=_ileIc('copy',14); btn.classList.remove('copied'); btn.title='Copy ticket ID '+IL_TICKET_SID; }
  else { btn.style.display='none'; }
}
// Copy just the ticket ID shown in the modal title.
async function copyIncidentTicketId(btn){
  if(!IL_TICKET_SID) return;
  try{ await navigator.clipboard.writeText(IL_TICKET_SID); }
  catch(e){ var ta=document.createElement('textarea');ta.value=IL_TICKET_SID;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_){}ta.remove(); }
  _ileToast('Copied '+IL_TICKET_SID);
  if(btn){ btn.classList.add('copied'); var prev=btn.innerHTML; btn.innerHTML=_ileIc('check-circle',14); setTimeout(function(){ btn.classList.remove('copied'); btn.innerHTML=prev; },1200); }
}
// Toggle the light-red "Empty" marker on a field's label based on whether it has a value.
function ilMarkEmpty(el){
  if(el){ var field=el.closest('.ail-field'); if(field) field.classList.toggle('is-empty', !String(el.value||'').trim()); }
  ilUpdateCopyState();
}
// Refresh the empty markers on every structured field at once (used when the modal opens).
function ilRefreshEmptyMarks(){
  IL_FIELD_IDS.forEach(function(id){ var el=document.getElementById(id); if(el){ var f=el.closest('.ail-field'); if(f) f.classList.toggle('is-empty', !String(el.value||'').trim()); } });
  ilUpdateCopyState();
}
// Copy is allowed ONLY when every field has a value.
function ilAllFilled(){
  return IL_FIELD_IDS.every(function(id){ var el=document.getElementById(id); return el && String(el.value||'').trim(); });
}
// Copy is blocked when the SIM Root Cause Details "Res:" line contains PENDING.
function ilSimResPending(){
  var el=document.getElementById('ilSimRcd'); if(!el) return false;
  var m=String(el.value||'').match(/^\s*Res\s*:\s*(.*)$/mi);
  return !!(m && /pending/i.test(m[1]));
}
// PHD Resolution can only be picked once SIM Root Cause Details has content. Disable the dropdown
// (and its searchable combobox face) while SIM is empty; re-enable when it has text.
function ilSyncResolutionEnabled(){
  var sim=document.getElementById('ilSimRcd'), res=document.getElementById('ilPhdResolution');
  if(!res) return;
  var hasSim=!!String((sim||{}).value||'').trim();
  res.disabled=!hasSim;
  if(!hasSim) res.value='';   // clear any stale selection when SIM goes empty
  if(window.makeSearchableSelect && res._ssWrap) window.makeSearchableSelect(res);   // refresh the combobox face/disabled state
}
// When the PHD Resolution dropdown changes, rewrite the SIM Root Cause Details "Res:" line to the
// selected resolution — replacing whatever was there (PENDING or any prior value). No-op if the SIM
// field is empty or no resolution is selected.
function ilSyncSimResFromResolution(){
  var res=document.getElementById('ilPhdResolution'); var sim=document.getElementById('ilSimRcd');
  if(!res || !sim) return;
  var val=String(res.value||'').trim();
  if(!val) return;                                   // nothing selected -> leave SIM as-is
  var text=String(sim.value||''); if(!text.trim()) return;   // empty SIM -> nothing to update
  var wasReadonly=sim.readOnly;                      // temporarily unlock if it was read-only
  var reRe=/^([ \t]*Res[ \t]*:[ \t]*).*$/mi;
  var next;
  if(reRe.test(text)){ next=text.replace(reRe, '$1'+val); }   // replace the existing Res: value
  else { next=text.replace(/\s*$/,'')+'\nRes: '+val; }        // or append a Res: line
  if(next===text) return;
  sim.readOnly=false; sim.value=next; sim.readOnly=wasReadonly;
  // Keep the empty-marker, copy-state (PENDING check), and autosize in sync.
  if(typeof ilMarkEmpty==='function') ilMarkEmpty(sim);
  if(typeof ilUpdateCopyState==='function') ilUpdateCopyState();
  if(typeof ilAutosize==='function') ilAutosize(sim);
}
function ilUpdateCopyState(){
  var pending=ilSimResPending();
  var ok=ilAllFilled() && !pending;
  var btn=document.getElementById('incidentCopyFooterBtn');
  if(btn){
    btn.disabled=!ok;
    btn.title=pending ? 'Copy disabled — SIM Root Cause Details resolution is PENDING'
      : (ok ? 'Copy the formatted incident log' : 'Fill every field to enable copying');
  }
  // "Copy w/o RC Details" mirrors the same enable state (same gating), just omits the SIM section.
  var btn2=document.getElementById('incidentCopyNoRcBtn');
  if(btn2){
    btn2.disabled=!ok;
    btn2.title=pending ? 'Copy disabled — SIM Root Cause Details resolution is PENDING'
      : (ok ? 'Copy everything except the SIM Root Cause Details' : 'Fill every field to enable copying');
  }
  ilUpdateFieldCopyStates();
}
// Paint the per-field copy + edit icons (static HTML can't call ic()).
function ilPaintFieldCopyIcons(){
  document.querySelectorAll('.ail-fcopy').forEach(function(b){ if(!b.dataset.painted){ b.innerHTML=_ileIc('copy',14); b.dataset.painted='1'; } });
  document.querySelectorAll('.ail-fedit').forEach(function(b){ if(!b.dataset.painted){ b.innerHTML=_ileIc('edit',14); b.dataset.painted='1'; } });
}
// Click the pencil: unlock that one field for editing.
function ilEditField(btn){
  if(!btn) return;
  var el=document.getElementById(btn.getAttribute('data-for')); if(!el) return;
  el.readOnly=false; btn.classList.add('editing');
  try{ el.focus(); var n=el.value.length; el.setSelectionRange(n,n); }catch(e){}
  if(typeof ilAutosize==='function') ilAutosize(el);
}
// Put the 4 text fields into read-only "display" mode for EDIT open: filled ones become read-only
// with a visible pencil; empty ones stay editable with the pencil hidden. `locked`=false (add mode)
// leaves everything editable and hides all pencils.
function ilSetFieldLocks(locked){
  ['ilPhdFindings','ilPhdInvestigation','ilSimRcd','ilPhdNotes'].forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    var btn=document.querySelector('.ail-fedit[data-for="'+id+'"]');
    var hasContent=!!String(el.value||'').trim();
    // Exception: SIM Root Cause Details with a PENDING Res: stays EDITABLE (not read-only) so the
    // user can replace PENDING with the real resolution right away.
    var forceEdit=(id==='ilSimRcd' && ilSimResPending());
    if(locked && hasContent && !forceEdit){ el.readOnly=true; if(btn){ btn.style.display=''; btn.classList.remove('editing'); } }
    else{ el.readOnly=false; if(btn){ btn.style.display=(locked&&hasContent)?'':'none'; btn.classList.toggle('editing',!!forceEdit); } }
  });
}
// Enable a field's copy icon only when that field is non-empty.
function ilUpdateFieldCopyStates(){
  document.querySelectorAll('.ail-fcopy').forEach(function(b){
    var el=document.getElementById(b.getAttribute('data-for'));
    b.disabled=!(el && String(el.value||'').trim());
  });
}
// Per-field copy format — matches exactly how each field is written in the full saved log
// (buildIncidentOutput). Block fields put the value on the next line; inline fields keep it on one.
var IL_COPY_FMT={
  ilPhdFindings:      {prefix:'**PHD Findings**:', block:true},
  ilPhdInvestigation: {prefix:'**PHD Investigation for mitigation:**', block:true},
  ilSimRcd:           {prefix:'**SIM Root Cause Details:**', block:true},
  ilRootCause:        {prefix:'**Root Cause**:', block:false},
  ilRelatedLink:      {prefix:'**PHD Related Link**:', block:false},
  ilPhdResolution:    {prefix:'**PHD Resolution**:', block:false},
  ilPhdNotes:         {prefix:'**PHD notes**:', block:true}
};
// Copy a single field using its canonical header format (only when it has content).
async function ilCopyField(btn){
  if(!btn) return;
  var id=btn.getAttribute('data-for');
  var el=document.getElementById(id);
  var val=el?String(el.value||'').trim():'';
  if(!val){ _ileToast('Nothing to copy — field is empty'); return; }
  var label=btn.getAttribute('data-label')||'';
  var fmt=IL_COPY_FMT[id]||{prefix:label+':', block:true};
  var text=fmt.block ? (fmt.prefix+'\n'+val) : (fmt.prefix+' '+val);
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    var tmp=document.createElement('textarea');tmp.value=text;tmp.style.position='fixed';tmp.style.opacity='0';
    document.body.appendChild(tmp);tmp.select();try{document.execCommand('copy');}catch(_){}document.body.removeChild(tmp);
  }
  _ileToast('Copied '+label);
  btn.classList.add('copied'); var prev=btn.innerHTML; btn.innerHTML=_ileIc('check-circle',14);
  setTimeout(function(){ btn.classList.remove('copied'); btn.innerHTML=prev; },1200);
}
// Textarea auto-size: default ~5 lines, grow with content, cap at ~16 lines (then scroll).
var _ilTaWired=false;
// Resize ONE textarea to fit its content, clamped between the 5-line min and the 16-line cap.
function ilAutosize(ta){
  if(!ta) return;
  var lh=parseFloat(getComputedStyle(ta).lineHeight)||20, pad=20;
  var minH=Math.round(5*lh+pad), maxH=Math.round(16*lh+pad);
  ta.style.height='auto';                       // reset so scrollHeight reflects the true content height
  var h=Math.min(Math.max(ta.scrollHeight, minH), maxH);
  ta.style.height=h+'px';
  ta.style.overflowY=(ta.scrollHeight>maxH)?'auto':'hidden';   // only scroll once past the cap
}
function ilWireTextareaAutosize(){
  if(_ilTaWired) return; _ilTaWired=true;
  document.querySelectorAll('.ail-field textarea').forEach(function(ta){
    ta.addEventListener('input',function(){ ilAutosize(ta); });
  });
}
// Size every textarea to its current content (used when the modal opens / fields are (re)filled).
function ilAutosizeAll(){ document.querySelectorAll('.ail-field textarea').forEach(ilAutosize); }
// Copy the formatted incident log — ONLY when every field is filled.
async function copyIncidentDraft(){
  var btn=document.getElementById('incidentCopyFooterBtn');
  if(!ilAllFilled()){ _ileToast('Fill every field before copying'); return; }
  if(ilSimResPending()){ _ileToast('Resolve the PENDING resolution before copying'); return; }
  await _ilCopyText(buildIncidentOutput(), btn, 'Copied');
}
// Same as Copy, but omits the SIM Root Cause Details section.
async function copyIncidentNoRc(btn){
  if(!ilAllFilled()){ _ileToast('Fill every field before copying'); return; }
  if(ilSimResPending()){ _ileToast('Resolve the PENDING resolution before copying'); return; }
  await _ilCopyText(buildIncidentOutput({omitSim:true}), btn, 'Copied (no RC)');
}
// Shared clipboard write + button flash for the two footer copy buttons.
async function _ilCopyText(text,btn,toastMsg){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    var tmp=document.createElement('textarea');tmp.value=text;tmp.style.position='fixed';tmp.style.opacity='0';
    document.body.appendChild(tmp);tmp.select();try{document.execCommand('copy');}catch(_){}document.body.removeChild(tmp);
  }
  _ileToast(toastMsg||'Copied');
  if(btn){ var prev=btn.textContent; btn.classList.add('copied'); btn.textContent='Copied!';
    setTimeout(function(){btn.classList.remove('copied');btn.textContent=prev;},1200); }
}

// ---- Markup + CSS ----
var IncidentLogEditor=(function(){
  // One labelled field row. kind: 'ta' (textarea + pencil), 'select', 'link' (read-only input).
  function field(id,label,kind,extra){
    var pencil=(kind==='ta')
      ? '<button type="button" class="ail-fedit" data-for="'+id+'" onclick="ilEditField(this)" title="Edit this field" aria-label="Edit '+label+'" style="display:none"></button>' : '';
    var lbl='<label class="ail-flabel" for="'+id+'"><span class="ail-flabel-tx">'+label+'</span> <span class="ail-empty-dot">Empty</span>'+pencil+
      '<button type="button" class="ail-fcopy" data-for="'+id+'" data-label="'+label+'" onclick="ilCopyField(this)" title="Copy this field" aria-label="Copy '+label+'"></button></label>';
    return '<div class="ail-field" data-ilfield>\n        '+lbl+'\n        '+extra+'\n      </div>';
  }
  function markupHtml(){
    return '<div class="modal-bg ail-bg" id="incidentModal" onclick="if(event.target===this)closeIncidentLog()">'+
      '<div class="modal ail-modal" role="dialog" aria-modal="true" aria-labelledby="incidentTitle">'+
        '<div class="ail-head">'+
          '<span class="ail-head-ic" id="ailHeadIc"></span>'+
          '<div class="ail-head-tx"><h2 id="incidentTitle"><span id="incidentTitleText">Add incident log</span><button type="button" class="ail-idcopy" id="incidentIdCopyBtn" onclick="copyIncidentTicketId(this)" title="Copy ticket ID" aria-label="Copy ticket ID" style="display:none"></button></h2><span class="ail-head-sub">Structured PHD findings &amp; mitigation, saved to this ticket\'s log</span></div>'+
          '<span class="mtc-icons ail-head-flags" id="ailHeadFlags"></span>'+
          '<button type="button" class="ail-x" onclick="closeIncidentLog()" aria-label="Close">&times;</button>'+
        '</div>'+
        '<div class="ail-body">'+
          field('ilPhdFindings','PHD Findings','ta','<textarea id="ilPhdFindings" class="ail-f" oninput="ilMarkEmpty(this)" placeholder="- On 11OCT\'26, a DSP DA from station …&#10;- …"></textarea>')+
          field('ilPhdInvestigation','PHD Investigation for mitigation','ta','<textarea id="ilPhdInvestigation" class="ail-f" oninput="ilMarkEmpty(this)" placeholder="- Does current ticket have any duplicate: No&#10;- Is POI the CX: …"></textarea>')+
          field('ilSimRcd','SIM Root Cause Details','ta','<textarea id="ilSimRcd" class="ail-f" oninput="ilMarkEmpty(this);ilUpdateCopyState();ilSyncResolutionEnabled()" placeholder="Issue: …&#10;SID: …&#10;Driv: …&#10;Date: …&#10;Res: …"></textarea>')+
          field('ilRootCause','Root Cause','select','<select id="ilRootCause" onchange="ilMarkEmpty(this)"></select>')+
          field('ilRelatedLink','PHD Related Link','link','<input type="text" id="ilRelatedLink" readonly placeholder="https://t.corp.amazon.com/…">')+
          field('ilPhdResolution','PHD Resolution','select','<select id="ilPhdResolution" onchange="ilMarkEmpty(this);ilSyncSimResFromResolution()"></select>')+
          field('ilPhdNotes','PHD Notes','ta','<textarea id="ilPhdNotes" class="ail-f" oninput="ilMarkEmpty(this)" placeholder="- The DA has confessed …&#10;- …"></textarea>')+
          '<div class="msg err ail-err" id="incidentErr" style="display:none" role="alert"></div>'+
        '</div>'+
        '<div class="ail-actions">'+
          '<button type="button" class="ail-btn danger" id="incidentDeleteBtn" onclick="deleteIncidentFromForm()" style="display:none">Delete</button>'+
          '<button type="button" class="ail-btn copy" id="incidentCopyFooterBtn" onclick="copyIncidentDraft()" disabled title="Fill every field to enable copying">Copy</button>'+
          '<button type="button" class="ail-btn copy2" id="incidentCopyNoRcBtn" onclick="copyIncidentNoRc(this)" disabled title="Copy everything except the SIM Root Cause Details">Copy w/o RC Details</button>'+
          '<button class="ail-btn sec" onclick="closeIncidentLog()">Close</button>'+
          '<button class="ail-btn primary" id="incidentBtn" onclick="submitIncidentLog()">Save</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  // Replace the placeholder element (keeps the modal's DOM position, so stacking order with the
  // page's other modals is unchanged). No-op if the modal already exists.
  function mount(placeholderId){
    if(document.getElementById('incidentModal')) return;
    var ph=document.getElementById(placeholderId);
    var tmp=document.createElement('div'); tmp.innerHTML=markupHtml();
    var node=tmp.firstChild;
    if(ph && ph.parentNode) ph.parentNode.replaceChild(node,ph); else document.body.appendChild(node);
  }
  // Light-theme CSS for the editor (same rules as my-tickets' inline base + light overrides).
  var CSS=[
    '.ail-modal{width:min(760px,94vw);max-width:min(760px,94vw);padding:0;overflow:hidden;display:flex;flex-direction:column;height:90vh;max-height:90vh}',
    '.ail-field{margin-bottom:14px}',
    '.ail-field:last-child{margin-bottom:0}',
    '.ail-flabel{display:flex;align-items:center;gap:7px;font-size:.8em;font-weight:700;color:#1b2026;margin-bottom:5px}',
    '.ail-empty-dot{display:none;align-items:center;gap:4px;font-size:.82em;font-weight:700;color:#c0392b;background:#fdeaea;border:1px solid #f3b4b4;border-radius:999px;padding:1px 8px;line-height:1.4}',
    '.ail-empty-dot::before{content:"";width:7px;height:7px;border-radius:50%;background:#ff6b6b;display:inline-block}',
    '.ail-field.is-empty .ail-empty-dot{display:inline-flex}',
    '.ail-fcopy{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #d4dce4;border-radius:5px;background:transparent;color:#5c6773;cursor:pointer;transition:border-color .15s,color .15s,background .15s;flex:0 0 auto}',
    '.ail-fcopy svg{width:14px;height:14px}',
    '.ail-fcopy:hover{border-color:#1577a0;color:#1577a0;background:rgba(21,119,160,.08)}',
    '.ail-fcopy:disabled{opacity:.35;cursor:not-allowed;pointer-events:none}',
    '.ail-fcopy.copied{border-color:#1f9d57;color:#1f9d57}',
    '.ail-field.is-empty .ail-fcopy{opacity:.35;pointer-events:none}',
    '.ail-fedit{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #d4dce4;border-radius:5px;background:transparent;color:#5c6773;cursor:pointer;transition:border-color .15s,color .15s,background .15s;flex:0 0 auto}',
    '.ail-fedit svg{width:14px;height:14px}',
    '.ail-fedit:hover,.ail-fedit.editing{border-color:#ec7211;color:#ec7211;background:rgba(236,114,17,.1)}',
    '.ail-fsub{color:#5c6773;font-weight:500}',
    '.ail-field textarea,.ail-field select,.ail-field input[type=text]{width:100%;background:#fff!important;border:1px solid #d4dce4!important;border-radius:5px;color:#1b2026!important;font-size:.88em;padding:10px 12px;font-family:inherit;line-height:1.55}',
    '.ail-field textarea{resize:vertical;min-height:calc(5 * 1.55em + 20px);max-height:calc(16 * 1.55em + 20px);white-space:pre-wrap;overflow-y:auto}',
    '.ail-field textarea[readonly]{background:#f3f5f7!important;color:#2a3340!important;cursor:default;opacity:1}',
    '.ail-field select:focus,.ail-field input:focus,.ail-field textarea:focus{outline:none;border-color:#ec7211!important;box-shadow:0 0 0 3px rgba(236,114,17,.14)}',
    '.ail-head{display:flex;align-items:flex-start;gap:12px;padding:20px 22px 16px;border-bottom:1px solid #e6eaee}',
    '.ail-head-ic{flex-shrink:0;width:38px;height:38px;border-radius:10px;background:rgba(21,119,160,.1);color:#1577a0;display:inline-flex;align-items:center;justify-content:center}',
    '.ail-head-ic svg{width:18px;height:18px}',
    '.ail-head-tx{flex:1;min-width:0}',
    '.ail-head-tx h2{margin:0;color:#1b2026;font-size:1.1em;font-weight:800;display:inline-flex;align-items:center;gap:8px}',
    '.ail-idcopy{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid #d4dce4;color:#5c6773;background:transparent;border-radius:6px;cursor:pointer;transition:border-color .15s,color .15s,background .15s}',
    '.ail-idcopy svg{width:13px;height:13px}',
    '.ail-idcopy:hover{border-color:#1577a0;color:#1577a0;background:rgba(21,119,160,.08)}',
    '.ail-idcopy.copied{border-color:#1f9d57;color:#1f9d57}',
    '.ail-head-sub{display:block;color:#5c6773;font-size:.8em;margin-top:3px}',
    '.ail-head-flags{flex:0 0 auto;align-items:center;gap:8px;margin-top:1px}',
    '.ail-head-flags:empty{display:none}',
    '.ail-x{flex-shrink:0;background:transparent;border:none;color:#8793a0;font-size:1.5em;line-height:1;cursor:pointer;padding:0 2px;border-radius:5px}',
    '.ail-x:hover{color:#1b2026;background:rgba(20,30,45,.06)}',
    '.ail-body{padding:18px 22px;overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column}',
    '.ail-err{margin-top:8px;color:#d33a3a;font-size:.85em}',
    '.ail-actions{display:flex;gap:10px;justify-content:flex-end;padding:16px 22px;border-top:1px solid #e6eaee;flex-shrink:0}',
    '.ail-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 18px;border-radius:5px;font-weight:700;font-size:.88em;cursor:pointer;border:1px solid transparent;font-family:inherit;transition:filter .15s,background .15s,border-color .15s,color .15s}',
    '.ail-btn.primary{background:linear-gradient(180deg,#ffcb52,#f7b21a);color:#151206;box-shadow:0 4px 14px -4px rgba(251,191,36,.5)}',
    '.ail-btn.primary:hover{filter:brightness(1.05)}',
    '.ail-btn.primary:disabled{opacity:.6;cursor:default;filter:none}',
    '.ail-btn.sec{background:transparent;border-color:#d4dce4;color:#2a3340}',
    '.ail-btn.sec:hover{border-color:#8793a0;color:#1b2026}',
    '.ail-btn.copy{background:#ec7211;border-color:#ec7211;color:#fff}',
    '.ail-btn.copy:hover{filter:brightness(1.06)}',
    '.ail-btn.copy:disabled,.ail-btn.copy2:disabled{opacity:.45;cursor:not-allowed;filter:none}',
    '.ail-btn.copy.copied,.ail-btn.copy2.copied{background:#1f9d57;border-color:#1f9d57;color:#fff}',
    '.ail-btn.copy2{background:#b45309;border-color:#b45309;color:#fff}',
    '.ail-btn.copy2:hover{filter:brightness(1.08)}',
    '.ail-actions .ail-btn.sec{margin-left:auto}',
    '.ail-btn.danger{background:#e23b3b;border-color:#e23b3b;color:#fff}',
    '.ail-btn.danger:hover{background:#c82f2f;border-color:#c82f2f}',
    '.ail-btn:focus-visible,.ail-fcopy:focus-visible,.ail-fedit:focus-visible,.ail-idcopy:focus-visible,.ail-x:focus-visible{outline:2px solid #1577a0;outline-offset:2px}'
  ].join('\n');
  // Opt-in: inject the editor CSS once (appended last in <head> so it wins the page cascade).
  function injectStyles(){
    if(document.getElementById('ile-css')) return;
    var st=document.createElement('style'); st.id='ile-css'; st.textContent=CSS;
    document.head.appendChild(st);
  }
  return { markupHtml:markupHtml, mount:mount, injectStyles:injectStyles,
    parse:parseIncidentOutput, serialize:ilSerializeFields, build:buildIncidentOutput };
})();
if(typeof window!=='undefined') window.IncidentLogEditor=IncidentLogEditor;
if(typeof module!=='undefined' && module.exports) module.exports={ parseIncidentOutput:parseIncidentOutput, ilSerializeFields:ilSerializeFields };
