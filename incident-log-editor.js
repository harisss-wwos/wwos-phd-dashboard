// ====================================================================================
// Shared structured incident-log editor ("Add / Edit incident log · <ID>" modal).
// Used by my-tickets.html and important-cases.html.
//
// What lives here (page-agnostic):
//   - the modal markup (IncidentLogEditor.markupHtml / mount) — fixed ids (incidentModal, ilPhdFindings…)
//   - the light-theme CSS (IncidentLogEditor.injectStyles — opt-in; my-tickets keeps its own inline
//     copy so its existing cascade is untouched)
//   - parse / serialize (parseIncidentOutput / ilSerializeFields / buildIncidentOutput)
//   - the "PHD Investigation for mitigation" questionnaire (IL_INVEST_QS; pure ilParseInvestigation /
//     ilSerializeInvestigation / ilInvestMissing / ilCopyMissing; DOM ilSetInvestigation(text) /
//     ilGetInvestigation())
//   - "Historical Incidents" rows driven by the SIM "Cnt:" line (pure ilSimCnt / ilParseHistorical /
//     ilSerializeHistorical / ilHistMissing; DOM ilSetHistorical(text) / ilGetHistorical() / ilHistSync())
//   - field lock/edit toggles, per-field copy, empty markers, autosize, Root Cause / Resolution
//     selects, footer Copy + Copy w/o RC Details (always enabled; empty fields are confirmed in the
//     "Some fields are empty" pop-up, ilCopyConfirm), title copy-ID.
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
// f = {findings, invest, sim, hist, rootCause, link, res, notes}; opts.omitSim drops the SIM section.
// f.hist = serialized "Historical Incidents" body (ilSerializeHistorical); the section is written
// right after SIM and omitted entirely when empty. opts.omitSim (Copy w/o RC Details) drops the
// Historical Incidents section too — it belongs to the RC details.
function ilSerializeFields(f,opts){
  opts=opts||{}; f=f||{};
  var v=function(k){ return String(f[k]==null?'':f[k]).trim(); };
  var parts=[];
  parts.push('**PHD Findings**:\n'+(v('findings')||'-'));
  parts.push('**PHD Investigation for mitigation:**\n'+(v('invest')||'-'));
  if(!opts.omitSim) parts.push('**SIM Root Cause Details:**\n'+(v('sim')||'-'));
  if(!opts.omitSim && v('hist')) parts.push(IL_HIST_HEAD+'\n'+v('hist'));
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
  var NEXT='(?=\\n\\n\\*\\*PHD Investigation|\\n\\n\\*\\*SIM Root Cause|\\n\\n\\*\\*Historical Incidents:\\*\\*|\\n\\n\\*\\*Root Cause\\*\\*|\\n\\n\\*\\*PHD Related Link\\*\\*|\\n\\n\\*\\*PHD Resolution\\*\\*|\\n\\n\\*\\*PHD notes\\*\\*|$)';
  return {
    findings:  grab(new RegExp('(?:\\*\\*)?PHD Findings(?:\\*\\*)?:\\n([\\s\\S]*?)'+NEXT, 'i')),
    invest:    grab(new RegExp('\\*\\*PHD Investigation for mitigation:\\*\\*\\n([\\s\\S]*?)'+NEXT, 'i')),
    sim:       grab(new RegExp('\\*\\*SIM Root Cause Details:\\*\\*\\n([\\s\\S]*?)'+NEXT, 'i')),
    hist:      grab(new RegExp('\\*\\*Historical Incidents:\\*\\*[ \\t]*\\n([\\s\\S]*?)'+NEXT, 'i')),
    rootCause: grab(new RegExp('\\*\\*Root Cause\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    link:      grab(new RegExp('\\*\\*PHD Related Link\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    res:       grab(new RegExp('\\*\\*PHD Resolution\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    notes:     grab(new RegExp('\\*\\*PHD notes\\*\\*:\\n([\\s\\S]*?)'+NEXT, 'i'))
  };
}
// ---- "PHD Investigation for mitigation" questionnaire (pure model; no DOM; exported for Node) ----
// Saved text keeps the long-standing shape: one "- <Question>: <Answer>" line per question, with
// conditional sub-questions as indented "    - <Sub>: <Answer>" lines directly under their parent.
// `aliases` = labels used before the questionnaire existed, so old entries still parse.
var IL_INVEST_QS=[
  {key:'dup',    label:'Does current ticket have any duplicate', type:'select', opts:['No','Yes']},
  // "No" reveals an optional free-text "Who is the POI?" saved inline as "No (<text>)".
  {key:'poi',    label:'Is POI the CX', type:'select', opts:['Yes','No'],
    poiWho:{key:'poiWho', label:'Who is the POI?', type:'text', optional:true, placeholder:"e.g. CX's father / neighbour / unknown person"}},
  {key:'susp',   label:'CX Account suspension requested from GSOC?', type:'select', opts:['No','Yes'],
    aliases:['CX Account suspension requested?','CX Account suspension requested']},
  {key:'negFb',  label:'Negative Delivery Feedbacks reported in SIM against the Transporter', type:'number',
    aliases:['Negative Delivery Feedback or Fraud appeal reported in SIM against the Transporter',
             'Negative Delivery Feedbacks or Fraud appeal reported in SIM against the Transporter',
             'Negative Delivery Feedback reported in SIM against the Transporter']},
  {key:'histCx', label:'Historical incidents against CX in SIM [If CX is POI]', type:'number',
    aliases:['Historical incidents against CX in SIM']},
  {key:'locSim', label:'Location Historical incidents in SIM records (UPID)', type:'number'},
  {key:'cortex', label:'Cortex Driver Trace added to SIM & EMT', type:'select', opts:['Yes','No'],
    aliases:['Cortex Driver Trace added to SIM','Cortex Driver Trace added to SIM and EMT']},
  {key:'locEmt', label:'Location Historical incidents in EMT records (Physical address)', type:'number'},
  {key:'clear',  label:'CLEAR history of POI (Any violent/related charges exists?)', type:'select', opts:['No','Yes','Yes (low level offense)','N/A']},
  {key:'station',label:'Station request made', type:'select', opts:['No','Yes'],
    sub:{key:'stationLink', label:'Station request link', type:'text', inputType:'url', placeholder:'LINK_IF_APPLICABLE'}},
  {key:'netra',  label:'Netradyne footage exists', type:'select', opts:['No','Yes'],
    // Multi-line free text (5-row textarea). Extra lines are saved as continuation lines indented
    // IL_INVEST_CONT_INDENT under the sub-line (see ilSerializeInvestigation / ilParseInvestigation).
    sub:{key:'netraInfo', label:'Netradyne footage review', type:'textarea', rows:5, placeholder:'IF_APPLICABLE',
      aliases:['Netradyne footage request info']}},
  {key:'addPkg', label:'Additional packages delivered after incident?', type:'select', opts:['Yes','No']},
  {key:'di',     label:'Delivery instructions present', type:'select', opts:['Yes','No'],
    sub:{key:'diUpd', label:'Delivery instructions updated after incident?', type:'select', opts:['Yes','No']}},
  {key:'pod',    label:'GeoStudio Delivery Photo (POD) added', type:'select', opts:['No','Yes']}
];
var IL_INVEST_SUB_INDENT='    ';
// Continuation lines of a multi-line answer: indented deeper than any sub-question line.
var IL_INVEST_CONT_INDENT='        ';
// Leading-whitespace width of a line (tab = 4 columns).
function _ilqIndentOf(raw){
  var w=0, s=String(raw);
  for(var i=0;i<s.length;i++){ if(s[i]===' ') w++; else if(s[i]==='\t') w+=4; else break; }
  return w;
}
// Strip a continuation line's indent (up to IL_INVEST_CONT_INDENT columns) and trailing whitespace;
// anything indented further is the user's own indentation and is kept.
function _ilqStripCont(raw){
  var s=String(raw), w=0, i=0, max=IL_INVEST_CONT_INDENT.length;
  while(i<s.length && w<max){ if(s[i]===' ') w++; else if(s[i]==='\t') w+=4; else break; i++; }
  return s.slice(i).replace(/\s+$/,'');
}
// Label normaliser for matching: case-insensitive, "&" == "and", whitespace collapsed, trailing "?" ignored.
function _ilqNorm(s){ return String(s||'').toLowerCase().replace(/&/g,' and ').replace(/\s+/g,' ').trim().replace(/\s*\?$/,''); }
// normalised label -> {q, sub} (sub = the sub-question def when the label is a sub-question).
var _ilqIndex=(function(){
  var m={};
  IL_INVEST_QS.forEach(function(q){
    [q.label].concat(q.aliases||[]).forEach(function(l){ m[_ilqNorm(l)]={q:q,sub:null}; });
    if(q.sub) [q.sub.label].concat(q.sub.aliases||[]).forEach(function(l){ m[_ilqNorm(l)]={q:q,sub:q.sub}; });
  });
  return m;
})();
// Canonical select option for a saved answer (case-insensitive); returns the raw text when it is
// not one of the options (the editor then keeps it as an extra "(old)" option).
function _ilqCanon(def,v){
  v=String(v==null?'':v).trim(); if(!v) return '';
  for(var i=0;i<def.opts.length;i++) if(def.opts[i].toLowerCase()===v.toLowerCase()) return def.opts[i];
  return v;
}
// Parse the section body -> { answers:{key:value}, unknown:[raw lines kept verbatim] }.
// A lone "-" (the empty-section placeholder) parses to an empty questionnaire.
// Continuation lines: a line indented deeper than the current item that does not start a new
// recognised question (a recognised "- Label:" indented IL_INVEST_CONT_INDENT or more still counts
// as text) is joined onto the current answer with "\n"; blank lines between such lines are kept.
// Continuations of an unrecognised line stay with it in `unknown`.
function ilParseInvestigation(text){
  var answers={}, unknown=[], seen={}, rawOf={}, defOf={}, order=[];
  var s=String(text==null?'':text).replace(/\r\n/g,'\n');
  if(s.trim()==='-' || !s.trim()) return {answers:answers, unknown:unknown};
  var cur=null, blanks=0, contMin=IL_INVEST_CONT_INDENT.length;   // cur = {key|null, indent}
  s.split('\n').forEach(function(raw){
    if(!raw.trim()){ if(cur) blanks++; return; }
    var ind=_ilqIndentOf(raw);
    var m=raw.match(/^\s*(?:[-*\u2022]\s*)?([^:]+?)\s*:[ \t]?(.*)$/);
    var hit=m ? _ilqIndex[_ilqNorm(m[1])] : null;
    var def=hit ? (hit.sub||hit.q) : null;
    if(cur && ind>cur.indent && (!def || ind>=contMin)){      // continuation of the current item
      if(cur.key){
        answers[cur.key]+=new Array(blanks+2).join('\n')+_ilqStripCont(raw);
        rawOf[cur.key].push(raw);
      } else unknown.push(raw);
      blanks=0; return;
    }
    blanks=0;
    if(!def || seen[def.key]){ unknown.push(raw); cur={key:null, indent:ind}; return; }   // unrecognised / duplicate -> keep as-is
    seen[def.key]=true; rawOf[def.key]=[raw]; defOf[def.key]=def; order.push(def.key);
    answers[def.key]=m[2].trim();
    cur={key:def.key, indent:ind};
  });
  // Normalise the collected answers (POI "No (<who>)" split, canonical select options).
  order.forEach(function(k){
    var def=defOf[k], ans=String(answers[k]).trim();
    if(def.poiWho){
      var pm=ans.match(/^no\s*\(([\s\S]*)\)\s*$/i);
      if(pm){ answers.poi='No'; answers.poiWho=pm[1].trim(); return; }
    }
    answers[k]=(def.type==='select') ? _ilqCanon(def,ans) : ans;
  });
  // A saved sub-answer whose parent is not "Yes" would be dropped on save (hidden sub-questions are
  // omitted) — keep its original line with the other notes instead so nothing is lost.
  IL_INVEST_QS.forEach(function(q){
    if(q.sub && answers[q.sub.key] && answers[q.key]!=='Yes'){ unknown.push.apply(unknown, rawOf[q.sub.key]); delete answers[q.sub.key]; }
  });
  return {answers:answers, unknown:unknown};
}
// True if the sub-question of q is currently shown (parent answered "Yes").
function _ilqSubShown(q,a){ return !!(q.sub && a[q.key]==='Yes'); }
// Serialize answers (+ preserved unknown lines) back into the section body. Unanswered questions
// keep their line with an empty answer so the structure is stable. Returns '' when nothing at all
// is answered and there are no preserved lines (the section then saves as the usual "-").
function ilSerializeInvestigation(answers,unknown){
  var a=answers||{}, extra=(unknown||[]).filter(function(l){ return String(l).trim(); });
  var val=function(k){ return String(a[k]==null?'':a[k]).trim(); };
  var any=extra.length>0;
  var lines=[];
  // "<prefix><answer line 1>" then each further line as an IL_INVEST_CONT_INDENT continuation
  // (blank lines stay empty so no line carries trailing whitespace).
  var push=function(prefix,v){
    var ls=String(v).split(/\r?\n/).map(function(l){ return l.replace(/\s+$/,''); });
    lines.push(prefix+ls[0]);
    for(var i=1;i<ls.length;i++) lines.push(ls[i] ? IL_INVEST_CONT_INDENT+ls[i] : '');
  };
  IL_INVEST_QS.forEach(function(q){
    var v=val(q.key);
    if(q.poiWho && v==='No' && val('poiWho')) v='No ('+val('poiWho')+')';
    if(v) any=true;
    push('- '+q.label+': ',v);
    if(_ilqSubShown(q,a)){ var sv=val(q.sub.key); if(sv) any=true; push(IL_INVEST_SUB_INDENT+'- '+q.sub.label+': ',sv); }
  });
  return any ? lines.concat(extra).join('\n') : '';
}
// Copy gating for this section: every VISIBLE question answered. Selects non-empty, number fields
// non-empty integers >= 0, shown sub-questions required; "Who is the POI?" is optional.
// Returns the list of keys that are missing/invalid (empty array = complete).
function ilInvestMissing(answers){
  var a=answers||{}, miss=[];
  var val=function(k){ return String(a[k]==null?'':a[k]).trim(); };
  IL_INVEST_QS.forEach(function(q){
    var v=val(q.key);
    if(q.type==='number' ? !/^\d+$/.test(v) : !v) miss.push(q.key);
    if(_ilqSubShown(q,a) && !val(q.sub.key)) miss.push(q.sub.key);
  });
  return miss;
}
// Section labels (as shown in the modal) in form order, keyed by field id.
var IL_FIELD_LABELS={ilPhdFindings:'PHD Findings', ilPhdInvestigation:'PHD Investigation for mitigation',
  ilSimRcd:'SIM Root Cause Details', ilRootCause:'Root Cause', ilRelatedLink:'PHD Related Link',
  ilPhdResolution:'PHD Resolution', ilPhdNotes:'PHD Notes'};
// What the footer Copy buttons check before copying (same rules the old disabled-gating used):
// every section non-empty; the questionnaire per ilInvestMissing. opts.omitSim (Copy w/o RC Details)
// skips SIM Root Cause Details, which that copy leaves out.
// f = {findings, sim, rootCause, link, res, notes} (strings); answers = questionnaire answers.
// Returns [{id, key, label}] in form order (key = questionnaire key, '' for whole sections).
function ilCopyMissing(f,answers,opts){
  f=f||{}; opts=opts||{};
  var out=[], txt=function(k){ return String(f[k]==null?'':f[k]).trim(); };
  var sec=function(id,k){ if(!txt(k)) out.push({id:id, key:'', label:IL_FIELD_LABELS[id]}); };
  // Same order as the form on screen: SIM (+ historical rows), Investigation, Findings, then the rest.
  if(!opts.omitSim){
    sec('ilSimRcd','sim');
    // Historical incident rows shown for the SIM "Cnt:" value (f.histRows); skipped with SIM.
    ilHistMissing(f.histRows, ilSimCnt(f.sim)).forEach(function(m){ out.push(m); });
  }
  var defs={}; IL_INVEST_QS.forEach(function(q){ defs[q.key]=q; if(q.sub) defs[q.sub.key]=q.sub; });
  ilInvestMissing(answers).forEach(function(k){
    out.push({id:'ilq_'+k, key:k, label:'PHD Investigation \u2014 '+defs[k].label});
  });
  sec('ilPhdFindings','findings');
  sec('ilRootCause','rootCause'); sec('ilRelatedLink','link'); sec('ilPhdResolution','res'); sec('ilPhdNotes','notes');
  return out;
}

// ---- Historical incidents (pure model; no DOM; exported for Node) ----
// The SIM Root Cause Details "Cnt: <n>" line (or "Historical Incident(s): <n>") drives N rows of
// five fields shown under the SIM field. The SIM lines themselves are never rewritten; the rows are
// saved in their own section right after SIM:
//   **Historical Incidents:**
//   - Historical incident 1:
//       - SIM link: <v>
//       - Assignee: <v>
//       - Incident date: <v>
//       - Issue type: <an issue from IZ_CATS> (was "Incident type: Pet|Non-pet"; old entries still parse)
//       - Incident resolution: <v>
//       - Incident brief: <first line>
//           <further lines, IL_INVEST_CONT_INDENT continuation lines>
var IL_HIST_HEAD='**Historical Incidents:**';
var IL_HIST_MAX=10;   // rows rendered / saved at most (a higher Cnt shows "Showing 10 of N")
// Layout (3 columns): [SIM link / Assignee / Incident date] [Issue type / Incident resolution] [Incident brief, full height].
// `aliases` = labels used in entries saved before a rename, so they still parse.
var IL_HIST_FIELDS=[
  {key:'link',     label:'SIM link',            type:'url', placeholder:'https://t.corp.amazon.com/...'},
  {key:'assignee', label:'Assignee',            type:'text'},
  {key:'date',     label:'Incident date',       type:'text', placeholder:'e.g. 18 Oct 2026'},
  // Issue type options = the Build Root Cause Details issue list (window.IZ_CATS, grouped by category).
  {key:'type',     label:'Issue type',          type:'select', src:'issues', opts:[], aliases:['Incident type']},
  {key:'res',      label:'Incident resolution', type:'text'},
  {key:'brief',    label:'Incident brief',      type:'textarea', rows:5, placeholder:'Give a short brief of the incident in one or two lines.'}
];
// Cnt from the SIM text: first "Cnt: <n>" / "Historical Incident(s): <n>" line (case-insensitive).
// Missing / non-numeric (e.g. "Cnt: N/A") -> 0.
function ilSimCnt(sim){
  var m=String(sim==null?'':sim).match(/^[ \t]*(?:Cnt|Historical[ \t]+Incident(?:s|\(s\))?)[ \t]*:[ \t]*(\d+)\b/mi);
  return m ? (parseInt(m[1],10)||0) : 0;
}
function _ilhEmpty(){ return {link:'',assignee:'',date:'',type:'',res:'',brief:''}; }
// (Issue type values are kept exactly as saved; an old "Pet" / "Non-pet" shows as an extra "(old)" option.)
// Parse the section body -> array of rows ({link, assignee, type, res, brief}). Tolerant of CRLF,
// extra blank lines and missing lines; "- Historical incident <n>:" selects row n (gaps are empty
// rows). Lines indented deeper than the current "- Label:" line continue its value ("\n"-joined).
function ilParseHistorical(text){
  var rows=[], s=String(text==null?'':text).replace(/\r\n/g,'\n');
  if(!s.trim() || s.trim()==='-') return rows;
  var lab={}; IL_HIST_FIELDS.forEach(function(f){ [f.label].concat(f.aliases||[]).forEach(function(l){ lab[_ilqNorm(l)]=f.key; }); });
  var cur=null, key=null, keyInd=0, blanks=0, contMin=IL_INVEST_CONT_INDENT.length;
  s.split('\n').forEach(function(raw){
    if(!raw.trim()){ if(key) blanks++; return; }
    var ind=_ilqIndentOf(raw);
    var hm=raw.match(/^\s*(?:[-*\u2022]\s*)?Historical\s+incident\s*#?\s*(\d+)\s*:?\s*$/i);
    var fm=raw.match(/^\s*(?:[-*\u2022]\s*)?([^:]+?)\s*:[ \t]?(.*)$/);
    var fk=fm ? lab[_ilqNorm(fm[1])] : null;
    if(key && ind>keyInd && (ind>=contMin || (!hm && !fk))){   // continuation of the current value
      cur[key]+=new Array(blanks+2).join('\n')+_ilqStripCont(raw);
      blanks=0; return;
    }
    blanks=0;
    if(hm){
      var n=parseInt(hm[1],10);
      if(n>=1){ while(rows.length<n) rows.push(_ilhEmpty()); cur=rows[n-1]; }
      key=null; return;
    }
    if(fk){
      if(!cur){ rows.push(_ilhEmpty()); cur=rows[rows.length-1]; }
      cur[fk]=fm[2].replace(/\s+$/,''); key=fk; keyInd=ind; return;
    }
    key=null;   // unrecognised line: ignored
  });
  rows.forEach(function(r){
    IL_HIST_FIELDS.forEach(function(f){ r[f.key]=String(r[f.key]).replace(/\s+$/,'').replace(/^\s+/,''); });
  });
  return rows;
}
// Serialize the first min(cnt, IL_HIST_MAX) rows; '' when cnt is 0 (section then omitted).
// Empty answers keep their line ("    - Assignee:") so the structure is stable.
function ilSerializeHistorical(rows,cnt){
  var n=Math.min(Math.max(parseInt(cnt,10)||0,0),IL_HIST_MAX);
  if(!n) return '';
  var lines=[];
  for(var i=0;i<n;i++){
    var r=(rows&&rows[i])||{};
    lines.push('- Historical incident '+(i+1)+':');
    IL_HIST_FIELDS.forEach(function(f){
      var ls=String(r[f.key]==null?'':r[f.key]).replace(/\r\n/g,'\n').trim().split('\n').map(function(l){ return l.replace(/\s+$/,''); });
      lines.push(IL_INVEST_SUB_INDENT+'- '+f.label+':'+(ls[0]?' '+ls[0]:''));
      for(var j=1;j<ls.length;j++) lines.push(ls[j] ? IL_INVEST_CONT_INDENT+ls[j] : '');
    });
  }
  return lines.join('\n');
}
// Copy check for the visible rows: every field of each of the first min(cnt, IL_HIST_MAX) rows.
// Returns [{id, key, label}] ("Historical incident 2 — SIM link"); ids match the DOM controls.
function ilHistMissing(rows,cnt){
  var n=Math.min(Math.max(parseInt(cnt,10)||0,0),IL_HIST_MAX), out=[];
  for(var i=0;i<n;i++){
    var r=(rows&&rows[i])||{};
    IL_HIST_FIELDS.forEach(function(f){
      if(!String(r[f.key]==null?'':r[f.key]).trim())
        out.push({id:'ilh_'+(i+1)+'_'+f.key, key:'', label:'Historical incident '+(i+1)+' \u2014 '+f.label});
    });
  }
  return out;
}

// Assemble the structured form fields (DOM) into the standard copy/save format.
// opts.omitSim === true drops the "SIM Root Cause Details" section (used by "Copy w/o RC Details").
function buildIncidentOutput(opts){
  var g=function(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; };
  return ilSerializeFields({
    findings:g('ilPhdFindings'), invest:ilGetInvestigation(), sim:g('ilSimRcd'), hist:ilGetHistorical(),
    rootCause:g('ilRootCause'), link:g('ilRelatedLink'), res:g('ilPhdResolution'), notes:g('ilPhdNotes')
  }, opts);
}

// ---- Historical incidents DOM: block #ilHist under the SIM textarea, controls "ilh_<n>_<key>" ----
var _ilhRows=[];       // every row typed / loaded, incl. rows above the current Cnt (restored if Cnt goes back up)
var _ilhCnt=0;         // Cnt currently applied (from #ilSimRcd)
var _ilhShown=0;       // rows currently rendered (min(Cnt, IL_HIST_MAX))
var _ilhLocked=false;  // follows the SIM field's lock (read-only) state
function _ilhEl(i,k){ return document.getElementById('ilh_'+(i+1)+'_'+k); }
// Copy the rendered controls' values into _ilhRows.
function _ilhCapture(){
  for(var i=0;i<_ilhShown;i++){
    var r=_ilhRows[i]||(_ilhRows[i]=_ilhEmpty());
    IL_HIST_FIELDS.forEach(function(f){ var el=_ilhEl(i,f.key); if(el) r[f.key]=String(el.value||''); });
  }
}
// Let a brief textarea grow with its content (no-op while the modal is hidden / not laid out).
// The brief now fills the full height of its 3-row column (CSS), so no auto-grow; clear any old inline height.
function _ilhGrow(ta){
  if(ta) ta.style.height='';
}
function _ilhControl(i,f){
  var id='ilh_'+(i+1)+'_'+f.key, a=' id="'+id+'" class="ail-hctl'+(f.type==='textarea'?' ail-hta':'')+'" aria-required="true"';
  var opt=function(o){ return '<option value="'+_ileEsc(o)+'">'+_ileEsc(o)+'</option>'; };
  if(f.type==='select' && f.src==='issues'){
    // Same list + category groups as the Build Root Cause Details "Issue" dropdown.
    var cats=(typeof window!=='undefined' && Array.isArray(window.IZ_CATS)) ? window.IZ_CATS : [];
    return '<select'+a+' onchange="ilHistChanged(this)"><option value="">Select an issue type</option>'+
      cats.map(function(cat){ return '<optgroup label="'+_ileEsc(cat.category)+'">'+
        (cat.types||[]).map(function(ty){ return opt(ty.type); }).join('')+'</optgroup>'; }).join('')+'</select>';
  }
  if(f.type==='select')
    return '<select'+a+' onchange="ilHistChanged(this)"><option value="">Select an option</option>'+f.opts.map(opt).join('')+'</select>';
  if(f.type==='textarea')
    return '<textarea'+a+' rows="'+(f.rows||2)+'"'+(f.placeholder?' placeholder="'+_ileEsc(f.placeholder)+'"':'')+' oninput="ilHistChanged(this)"></textarea>';
  return '<input type="'+f.type+'"'+a+' autocomplete="off"'+(f.placeholder?' placeholder="'+_ileEsc(f.placeholder)+'"':'')+' oninput="ilHistChanged(this)">';
}
// (Re)build the rows from _ilhRows for the current _ilhCnt.
function _ilhRender(){
  var box=document.getElementById('ilHist'); if(!box) return;
  var n=Math.min(_ilhCnt,IL_HIST_MAX);
  while(_ilhRows.length<n) _ilhRows.push(_ilhEmpty());
  _ilhShown=n;
  box.hidden=!n;
  if(!n){ box.innerHTML=''; return; }
  var html='<div class="ail-hist-h" id="ilHistTitle">Historical Incidents (Cnt: '+_ilhCnt+')</div>'+
    (_ilhCnt>IL_HIST_MAX ? '<p class="ail-hist-note">Showing '+IL_HIST_MAX+' of '+_ilhCnt+'</p>' : '');
  for(var i=0;i<n;i++){
    html+='<div class="ail-hrow" role="group" aria-labelledby="ilh_'+(i+1)+'_h">'+
      '<div class="ail-hrow-h" id="ilh_'+(i+1)+'_h">Historical incident '+(i+1)+'</div><div class="ail-hgrid">'+
      IL_HIST_FIELDS.map(function(f){
        return '<div class="ail-hcell ail-hcell-'+f.key+'"><label class="ail-hlabel" for="ilh_'+(i+1)+'_'+f.key+'">'+_ileEsc(f.label)+'</label>'+_ilhControl(i,f)+'</div>';
      }).join('')+'</div></div>';
  }
  box.innerHTML=html;
  for(var j=0;j<n;j++){
    IL_HIST_FIELDS.forEach(function(f){
      var el=_ilhEl(j,f.key); if(!el) return;
      var v=String(_ilhRows[j][f.key]||'');
      if(el.tagName==='SELECT' && v && !Array.prototype.some.call(el.options,function(o){ return o.value===v; })){
        var o=document.createElement('option'); o.value=v; o.textContent=v+' (old)'; el.appendChild(o);   // keep a saved non-option value
      }
      if(el.tagName==='INPUT') v=v.replace(/[ \t]*\n\s*/g,' ');
      el.value=v; el.disabled=_ilhLocked;
      if(el.tagName==='TEXTAREA') _ilhGrow(el);
    });
  }
}
// Re-read Cnt from #ilSimRcd and re-render the block when it changed (typed values are kept in memory).
function ilHistSync(){
  var box=document.getElementById('ilHist'); if(!box) return;
  var sim=document.getElementById('ilSimRcd');
  var cnt=ilSimCnt(sim?sim.value:'');
  if(cnt===_ilhCnt && box.getAttribute('data-ready')) return;
  _ilhCapture();
  _ilhCnt=cnt; box.setAttribute('data-ready','1');
  _ilhRender();
}
// Load a saved section body ('' to reset). Rows beyond the current Cnt stay in memory.
function ilSetHistorical(text){
  _ilhRows=ilParseHistorical(text);
  _ilhShown=0;   // nothing rendered belongs to the new rows -> do not capture over them
  var box=document.getElementById('ilHist'); if(box) box.removeAttribute('data-ready');
  ilHistSync();
}
// Serialized section body for the rows shown now ('' when hidden -> section omitted).
function ilGetHistorical(){
  if(typeof document==='undefined' || !document.getElementById('ilHist')) return '';
  ilHistSync(); _ilhCapture();
  return ilSerializeHistorical(_ilhRows, _ilhCnt);
}
// Any historical-incident control changed.
function ilHistChanged(el){
  _ilhCapture();
  if(el && el.tagName==='TEXTAREA') _ilhGrow(el);
  ilUpdateCopyState();
}
// Lock / unlock the rows together with the SIM field.
function _ilhSetLocked(locked){
  _ilhLocked=!!locked;
  var box=document.getElementById('ilHist'); if(!box) return;
  Array.prototype.forEach.call(box.querySelectorAll('.ail-hctl'), function(el){ el.disabled=_ilhLocked; });
}

// ---- DOM helpers (fixed element ids from the shared markup) ----
var IL_FIELD_IDS=['ilPhdFindings','ilPhdInvestigation','ilSimRcd','ilRootCause','ilRelatedLink','ilPhdResolution','ilPhdNotes'];
var IL_TICKET_SID='';  // the ticket ShortId the modal is currently open for (for the title copy icon)

// ---- Questionnaire DOM: container #ilPhdInvestigation, one control per question (id "ilq_<key>") ----
var _ilqUnknown=[];   // saved lines that matched no question; shown read-only and re-appended on save
function _ilqEl(key){ return document.getElementById('ilq_'+key); }
// Every control definition in DOM order (questions, the POI free-text, sub-questions).
function _ilqAllDefs(){
  var d=[]; IL_INVEST_QS.forEach(function(q){ d.push(q); if(q.poiWho) d.push(q.poiWho); if(q.sub) d.push(q.sub); }); return d;
}
function _ilqReadAnswers(){
  var a={}; _ilqAllDefs().forEach(function(d){ var el=_ilqEl(d.key); a[d.key]=el?String(el.value||'').trim():''; }); return a;
}
// Getter: the serialized section body ('' when nothing is answered -> saved as "-").
function ilGetInvestigation(){
  if(typeof document==='undefined' || !document.getElementById('ilPhdInvestigation')) return '';
  return ilSerializeInvestigation(_ilqReadAnswers(), _ilqUnknown);
}
// Setter: load a saved section body (or '' to reset) into the questionnaire controls.
function ilSetInvestigation(text){
  var p=ilParseInvestigation(text);
  _ilqUnknown=p.unknown.slice();
  _ilqAllDefs().forEach(function(d){
    var el=_ilqEl(d.key); if(!el) return;
    var v=p.answers[d.key]==null?'':String(p.answers[d.key]);
    if(el.tagName==='SELECT'){
      // Drop "(old)" options from a previous entry; keep a saved answer that is not an option.
      Array.prototype.slice.call(el.querySelectorAll('option[data-old]')).forEach(function(o){ o.parentNode.removeChild(o); });
      if(v && !Array.prototype.some.call(el.options,function(o){ return o.value===v; })){
        var o=document.createElement('option'); o.value=v; o.textContent=v+' (old)'; o.setAttribute('data-old','1'); el.appendChild(o);
      }
    } else if(d.type==='number'){
      // A number input would blank non-numeric text — show an old free-text value as text instead.
      el.type=(!v || /^-?\d+(\.\d+)?$/.test(v)) ? 'number' : 'text';
    }
    // Single-line inputs strip "\n" (gluing words together) — join continuation lines with a space.
    if(el.tagName==='INPUT') v=v.replace(/[ \t]*\n\s*/g,' ');
    el.value=v;
  });
  var ex=document.getElementById('ilqExtra'), wrap=document.getElementById('ilqExtraWrap');
  if(ex) ex.textContent=_ilqUnknown.join('\n');
  if(wrap) wrap.hidden=!_ilqUnknown.length;
  _ilqSyncVisibility();
  ilMarkEmpty(document.getElementById('ilPhdInvestigation'));
}
// Show / hide the conditional rows from the current parent answers.
function _ilqSyncVisibility(){
  var a=_ilqReadAnswers();
  IL_INVEST_QS.forEach(function(q){
    var row;
    if(q.poiWho){ row=document.querySelector('[data-ilq-row="'+q.poiWho.key+'"]'); if(row) row.hidden=(a[q.key]!=='No'); }
    if(q.sub){ row=document.querySelector('[data-ilq-row="'+q.sub.key+'"]'); if(row) row.hidden=!_ilqSubShown(q,a); }
  });
}
// aria-invalid / visual state per control + the "n questions need an answer" status line.
function _ilqUpdateValidity(){
  if(!document.getElementById('ilPhdInvestigation')) return;
  var a=_ilqReadAnswers(), miss=ilInvestMissing(a);
  _ilqAllDefs().forEach(function(d){
    var el=_ilqEl(d.key); if(!el) return;
    var bad=miss.indexOf(d.key)>=0;
    if(bad) el.setAttribute('aria-invalid','true'); else el.removeAttribute('aria-invalid');
    el.classList.toggle('ail-qbad', bad && !!String(el.value||'').trim());   // red only for a wrong value, not a blank
  });
  var st=document.getElementById('ilqStatus');
  if(st){
    var txt=miss.length ? (miss.length+(miss.length===1?' question needs':' questions need')+' an answer (numbers: whole numbers 0 or more)') : 'All questions answered';
    if(st.textContent!==txt) st.textContent=txt;
    st.classList.toggle('ok', !miss.length);
  }
}
// Any questionnaire control changed.
function ilInvestChanged(){
  _ilqSyncVisibility();
  ilMarkEmpty(document.getElementById('ilPhdInvestigation'));
}
// Lock (display mode) / unlock every questionnaire control.
function _ilqSetLocked(locked){
  var box=document.getElementById('ilPhdInvestigation'); if(!box) return;
  box.classList.toggle('is-locked', !!locked);
  Array.prototype.forEach.call(box.querySelectorAll('.ail-qctl'), function(el){ el.disabled=!!locked; });
}
// Current text value of a structured field (the questionnaire serializes; others read .value).
function _ilVal(id){
  if(id==='ilPhdInvestigation') return ilGetInvestigation();
  var el=document.getElementById(id); return el?String(el.value||'').trim():'';
}
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
  if(el){ var field=el.closest('.ail-field'); if(field) field.classList.toggle('is-empty', !(el.id==='ilPhdInvestigation' ? ilGetInvestigation() : String(el.value||'').trim())); }
  ilUpdateCopyState();
}
// Refresh the empty markers on every structured field at once (used when the modal opens).
function ilRefreshEmptyMarks(){
  ilHistSync();   // SIM may have been set programmatically -> refresh the Historical Incidents rows
  IL_FIELD_IDS.forEach(function(id){ var el=document.getElementById(id); if(el){ var f=el.closest('.ail-field'); if(f) f.classList.toggle('is-empty', !_ilVal(id)); } });
  ilUpdateCopyState();
}
// Missing / invalid fields in the open modal for a footer copy (opts.omitSim for Copy w/o RC Details).
function ilCopyMissingNow(opts){
  var g=function(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; };
  ilHistSync(); _ilhCapture();
  return ilCopyMissing({findings:g('ilPhdFindings'), sim:g('ilSimRcd'), histRows:_ilhRows, rootCause:g('ilRootCause'),
    link:g('ilRelatedLink'), res:g('ilPhdResolution'), notes:g('ilPhdNotes')}, _ilqReadAnswers(), opts);
}
// True when every field has a value (the questionnaire: every visible question answered).
function ilAllFilled(){ return ilCopyMissingNow().length===0; }
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
  ilHistSync();
  // Keep the empty-marker, copy-state (PENDING check), and autosize in sync.
  if(typeof ilMarkEmpty==='function') ilMarkEmpty(sim);
  if(typeof ilUpdateCopyState==='function') ilUpdateCopyState();
  if(typeof ilAutosize==='function') ilAutosize(sim);
}
// The footer Copy buttons are always enabled; empty fields are confirmed on click (ilCopyConfirm).
// Only the tooltips track the PENDING state here.
function ilUpdateCopyState(){
  var pending=ilSimResPending();
  var btn=document.getElementById('incidentCopyFooterBtn');
  if(btn) btn.title=pending ? 'Resolve the PENDING SIM Root Cause Details resolution before copying' : 'Copy the formatted incident log';
  var btn2=document.getElementById('incidentCopyNoRcBtn');
  if(btn2) btn2.title=pending ? 'Resolve the PENDING SIM Root Cause Details resolution before copying' : 'Copy everything except the SIM Root Cause Details';
  _ilqUpdateValidity();
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
  if(el.id==='ilPhdInvestigation'){   // questionnaire: unlock every control, focus the first one
    _ilqSetLocked(false); btn.classList.add('editing');
    var first=Array.prototype.filter.call(el.querySelectorAll('.ail-qctl'),function(c){ return !c.closest('[hidden]'); })[0];
    if(first) try{ first.focus(); }catch(e){}
    return;
  }
  el.readOnly=false; btn.classList.add('editing');
  if(el.id==='ilSimRcd') _ilhSetLocked(false);   // the Historical Incidents rows unlock with SIM
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
    if(id==='ilPhdInvestigation'){   // questionnaire: lock/unlock all of its controls together
      var lock=!!(locked && ilGetInvestigation());
      _ilqSetLocked(lock);
      if(btn){ btn.style.display=lock?'':'none'; btn.classList.remove('editing'); }
      return;
    }
    var hasContent=!!String(el.value||'').trim();
    // Exception: SIM Root Cause Details with a PENDING Res: stays EDITABLE (not read-only) so the
    // user can replace PENDING with the real resolution right away.
    var forceEdit=(id==='ilSimRcd' && ilSimResPending());
    if(locked && hasContent && !forceEdit){ el.readOnly=true; if(btn){ btn.style.display=''; btn.classList.remove('editing'); } }
    else{ el.readOnly=false; if(btn){ btn.style.display=(locked&&hasContent)?'':'none'; btn.classList.toggle('editing',!!forceEdit); } }
    if(id==='ilSimRcd') _ilhSetLocked(el.readOnly);   // Historical Incidents rows share the SIM lock
  });
}
// Enable a field's copy icon only when that field is non-empty.
function ilUpdateFieldCopyStates(){
  document.querySelectorAll('.ail-fcopy').forEach(function(b){
    var id=b.getAttribute('data-for');
    b.disabled=!(document.getElementById(id) && _ilVal(id));
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
  var val=_ilVal(id);
  if(!val){ _ileToast('Nothing to copy — field is empty'); return; }
  var label=btn.getAttribute('data-label')||'';
  var fmt=IL_COPY_FMT[id]||{prefix:label+':', block:true};
  var text=fmt.block ? (fmt.prefix+'\n'+val) : (fmt.prefix+' '+val);
  if(id==='ilSimRcd'){ var hist=ilGetHistorical(); if(hist) text+='\n\n'+IL_HIST_HEAD+'\n'+hist; }   // SIM copy includes its rows
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
  document.querySelectorAll('.ail-field textarea:not(.ail-qta):not(.ail-hta)').forEach(function(ta){
    ta.addEventListener('input',function(){ ilAutosize(ta); });
  });
}
// Size every textarea to its current content (used when the modal opens / fields are (re)filled).
function ilAutosizeAll(){
  document.querySelectorAll('.ail-field textarea:not(.ail-qta):not(.ail-hta)').forEach(ilAutosize);
  document.querySelectorAll('#ilHist textarea.ail-hta').forEach(_ilhGrow);   // brief fields: grow to content
}
// Copy the formatted incident log. Empty / invalid fields ask for confirmation first.
async function copyIncidentDraft(){
  var btn=document.getElementById('incidentCopyFooterBtn');
  if(ilSimResPending()){ _ileToast('Resolve the PENDING resolution before copying'); return; }
  var go=function(){ return _ilCopyText(buildIncidentOutput(), btn, 'Copied'); };
  var miss=ilCopyMissingNow();
  if(miss.length){ ilCopyConfirm(miss, btn, go); return; }
  await go();
}
// Same as Copy, but omits the SIM Root Cause Details section (so SIM is not required).
async function copyIncidentNoRc(btn){
  btn=btn||document.getElementById('incidentCopyNoRcBtn');
  if(ilSimResPending()){ _ileToast('Resolve the PENDING resolution before copying'); return; }
  var go=function(){ return _ilCopyText(buildIncidentOutput({omitSim:true}), btn, 'Copied (no RC)'); };
  var miss=ilCopyMissingNow({omitSim:true});
  if(miss.length){ ilCopyConfirm(miss, btn, go); return; }
  await go();
}
// ---- "Some fields are empty" confirmation (alertdialog on top of the incident-log modal) ----
var _ilcState=null;   // {opener, onCopy, first} while the pop-up is open
function _ilcBuild(){
  var bg=document.getElementById('ilCopyConfirm'); if(bg) return bg;
  bg=document.createElement('div'); bg.id='ilCopyConfirm'; bg.className='ilc-bg'; bg.hidden=true;
  bg.innerHTML='<div class="ilc-dlg" role="alertdialog" aria-modal="true" aria-labelledby="ilCopyConfirmTitle" aria-describedby="ilCopyConfirmDesc">'+
      '<h3 class="ilc-title" id="ilCopyConfirmTitle">Some fields are empty</h3>'+
      '<div class="ilc-body" id="ilCopyConfirmDesc">'+
        '<ul class="ilc-list" id="ilCopyConfirmList" tabindex="0" aria-label="Empty fields"></ul>'+
        '<p class="ilc-q">Do you still want to copy?</p>'+
      '</div>'+
      '<div class="ilc-actions">'+
        '<button type="button" class="ilc-btn sec" id="ilCopyConfirmCancel">Cancel</button>'+
        '<button type="button" class="ilc-btn go" id="ilCopyConfirmGo">Copy anyway</button>'+
      '</div>'+
    '</div>';
  // Inside #incidentModal so it stacks above the editor dialog; falls back to <body>.
  (document.getElementById('incidentModal')||document.body).appendChild(bg);
  document.getElementById('ilCopyConfirmCancel').addEventListener('click',function(){ ilCopyConfirmClose(false); });
  document.getElementById('ilCopyConfirmGo').addEventListener('click',function(){ ilCopyConfirmClose(true); });
  bg.addEventListener('click',function(e){ e.stopPropagation(); });   // never reach the editor's backdrop-close
  // Window capture runs before the pages' document-level editor key handlers.
  window.addEventListener('keydown',_ilcKeydown,true);
  return bg;
}
function _ilcKeydown(e){
  if(!_ilcState) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); ilCopyConfirmClose(false); return; }
  if(e.key!=='Tab') return;
  e.stopPropagation();
  var dlg=document.querySelector('#ilCopyConfirm .ilc-dlg');
  var f=Array.prototype.filter.call(dlg.querySelectorAll('button,[tabindex]:not([tabindex="-1"])'),function(el){ return !el.disabled && el.offsetParent!==null; });
  if(!f.length){ e.preventDefault(); return; }
  var first=f[0], last=f[f.length-1], a=document.activeElement;
  if(!dlg.contains(a)){ e.preventDefault(); first.focus(); }
  else if(e.shiftKey && a===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && a===last){ e.preventDefault(); first.focus(); }
}
// Open the pop-up listing `missing` ([{id,label}]); `onCopy` runs on "Copy anyway".
function ilCopyConfirm(missing, opener, onCopy){
  var bg=_ilcBuild();
  document.getElementById('ilCopyConfirmList').innerHTML=missing.map(function(m){ return '<li>'+_ileEsc(m.label)+'</li>'; }).join('');
  _ilcState={opener:opener||document.activeElement, onCopy:onCopy, first:missing[0]};
  bg.hidden=false;
  // Same width as the incident-log modal as rendered now (CSS 90vw / 96vw rule is the fallback).
  var dlg=bg.querySelector('.ilc-dlg'), modal=document.querySelector('#incidentModal .ail-modal');
  var w=modal ? Math.round(modal.getBoundingClientRect().width) : 0;
  if(dlg){ dlg.style.width=w>0 ? w+'px' : ''; dlg.style.maxWidth=w>0 ? w+'px' : ''; }
  var list=document.getElementById('ilCopyConfirmList'); list.scrollTop=0;
  try{ document.getElementById('ilCopyConfirmCancel').focus(); }catch(e){}
}
// Close: copy=true runs the pending copy (focus back to the opener); Cancel jumps to the first
// missing field and highlights it.
function ilCopyConfirmClose(copy){
  var st=_ilcState; if(!st) return;
  _ilcState=null;
  var bg=document.getElementById('ilCopyConfirm'); if(bg) bg.hidden=true;
  if(copy){
    if(st.opener && st.opener.focus) try{ st.opener.focus(); }catch(e){}
    Promise.resolve(st.onCopy && st.onCopy());
    return;
  }
  if(!_ilFocusMissing(st.first) && st.opener && st.opener.focus) try{ st.opener.focus(); }catch(e){}
}
// Scroll to / focus / highlight a missing field ({id}). Returns true if focus moved there.
function _ilFocusMissing(m){
  var el=m && document.getElementById(m.id); if(!el) return false;
  var field=el.closest('.ail-field');
  if(el.classList.contains('ail-qctl') && el.disabled){   // locked questionnaire -> unlock it (pencil)
    var pen=document.querySelector('.ail-fedit[data-for="ilPhdInvestigation"]'); if(pen) ilEditField(pen);
  }
  var isHist=el.classList.contains('ail-hctl');
  if(isHist && el.disabled){   // locked Historical Incidents row -> unlock with the SIM pencil
    var spen=document.querySelector('.ail-fedit[data-for="ilSimRcd"]'); if(spen) ilEditField(spen);
  }
  ilMarkEmpty(el.classList.contains('ail-qctl') ? document.getElementById('ilPhdInvestigation') : (isHist ? document.getElementById('ilSimRcd') : el));
  var target=(el._ssWrap && el._ssWrap.querySelector('.ss-field')) || el;   // searchable select face
  var row=el.closest('.ail-qrow')||el.closest('.ail-hcell')||field||target;
  try{ row.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){ try{ row.scrollIntoView(); }catch(_){} }
  row.classList.add('ail-flash'); setTimeout(function(){ row.classList.remove('ail-flash'); },1800);
  if(target.disabled) return false;
  try{ target.focus({preventScroll:true}); }catch(e){ return false; }
  return document.activeElement===target;
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
  // "PHD Investigation for mitigation" questionnaire field. Same header (Empty marker, pencil, copy)
  // as the other fields; the header is a <div> because each question has its own <label for>.
  function qControl(def){
    var id='ilq_'+def.key, req=' aria-required="'+(def.optional?'false':'true')+'"';
    if(def.type==='select')
      return '<select id="'+id+'" class="ail-qctl"'+req+' onchange="ilInvestChanged()"><option value="">Select an option</option>'+
        def.opts.map(function(o){ return '<option value="'+_ileEsc(o)+'">'+_ileEsc(o)+'</option>'; }).join('')+'</select>';
    if(def.type==='number')
      return '<input type="number" id="'+id+'" class="ail-qctl" min="0" step="1" inputmode="numeric" placeholder="#"'+req+' oninput="ilInvestChanged()">';
    if(def.type==='textarea')
      return '<textarea id="'+id+'" class="ail-qctl ail-qta" rows="'+(def.rows||5)+'" placeholder="'+_ileEsc(def.placeholder||'')+'"'+req+' oninput="ilInvestChanged()"></textarea>';
    return '<input type="'+(def.inputType||'text')+'" id="'+id+'" class="ail-qctl" autocomplete="off" placeholder="'+_ileEsc(def.placeholder||'')+'"'+req+' oninput="ilInvestChanged()">';
  }
  function qRow(def,isSub){
    return '<div class="ail-qrow'+(isSub?' ail-qsub':'')+(def.type==='textarea'?' ail-qrow-ta':'')+'" data-ilq-row="'+def.key+'"'+(isSub?' hidden':'')+'>'+
      '<label class="ail-qlabel" for="ilq_'+def.key+'">'+_ileEsc(def.label)+(def.optional?' <span class="ail-qopt">(optional)</span>':'')+'</label>'+
      qControl(def)+'</div>';
  }
  function investigationField(){
    var id='ilPhdInvestigation', label='PHD Investigation for mitigation';
    var rows=IL_INVEST_QS.map(function(q){
      return qRow(q,false)+(q.poiWho?qRow(q.poiWho,true):'')+(q.sub?qRow(q.sub,true):'');
    }).join('');
    return '<div class="ail-field" data-ilfield>'+
      '<div class="ail-flabel"><span class="ail-flabel-tx" id="ilPhdInvestigationLbl">'+label+'</span> <span class="ail-empty-dot">Empty</span>'+
        '<button type="button" class="ail-fedit" data-for="'+id+'" onclick="ilEditField(this)" title="Edit this field" aria-label="Edit '+label+'" style="display:none"></button>'+
        '<button type="button" class="ail-fcopy" data-for="'+id+'" data-label="'+label+'" onclick="ilCopyField(this)" title="Copy this field" aria-label="Copy '+label+'"></button></div>'+
      '<div id="'+id+'" class="ail-qn" role="group" aria-labelledby="ilPhdInvestigationLbl" aria-describedby="ilqStatus">'+rows+'</div>'+
      '<p class="ail-qn-status" id="ilqStatus" aria-live="polite"></p>'+
      '<div class="ail-qn-extra" id="ilqExtraWrap" hidden><div class="ail-qn-extra-h">Other notes from the saved entry (kept as-is on save)</div>'+
        '<pre id="ilqExtra"></pre></div>'+
    '</div>';
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
          // Display order: SIM Root Cause Details, PHD Investigation, PHD Findings, Root Cause, Related Link,
          // Resolution, Notes. Only the on-screen order changed; the saved / copied text keeps its section order.
          field('ilSimRcd','SIM Root Cause Details','ta','<textarea id="ilSimRcd" class="ail-f" oninput="ilHistSync();ilMarkEmpty(this);ilUpdateCopyState();ilSyncResolutionEnabled()" onchange="ilHistSync();ilMarkEmpty(this)" placeholder="Issue: …&#10;SID: …&#10;Driv: …&#10;Date: …&#10;Res: …"></textarea>'+
            // Historical Incidents rows (shown when the SIM "Cnt:" line is 1 or more; see ilHistSync).
            '<div class="ail-hist" id="ilHist" role="group" aria-labelledby="ilHistTitle" hidden></div>')+
          investigationField()+
          field('ilPhdFindings','PHD Findings','ta','<textarea id="ilPhdFindings" class="ail-f" oninput="ilMarkEmpty(this)" placeholder="- On 11OCT\'26, a DSP DA from station …&#10;- …"></textarea>')+
          field('ilRootCause','Root Cause','select','<select id="ilRootCause" onchange="ilMarkEmpty(this)"></select>')+
          field('ilRelatedLink','PHD Related Link','link','<input type="text" id="ilRelatedLink" readonly placeholder="https://t.corp.amazon.com/…">')+
          field('ilPhdResolution','PHD Resolution','select','<select id="ilPhdResolution" onchange="ilMarkEmpty(this);ilSyncSimResFromResolution()"></select>')+
          field('ilPhdNotes','PHD Notes','ta','<textarea id="ilPhdNotes" class="ail-f" oninput="ilMarkEmpty(this)" placeholder="- The DA has confessed …&#10;- …"></textarea>')+
          '<div class="msg err ail-err" id="incidentErr" style="display:none" role="alert"></div>'+
        '</div>'+
        '<div class="ail-actions">'+
          '<button type="button" class="ail-btn danger" id="incidentDeleteBtn" onclick="deleteIncidentFromForm()" style="display:none">Delete</button>'+
          '<button type="button" class="ail-btn copy" id="incidentCopyFooterBtn" onclick="copyIncidentDraft()" title="Copy the formatted incident log">Copy</button>'+
          '<button type="button" class="ail-btn copy2" id="incidentCopyNoRcBtn" onclick="copyIncidentNoRc(this)" title="Copy everything except the SIM Root Cause Details">Copy w/o RC Details</button>'+
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
    injectQnStyles();
  }
  // Questionnaire CSS (light theme). Injected by mount() on every page — my-tickets keeps its own
  // inline copy of the base editor CSS, so these rules are self-contained and scoped to .ail-qn.
  var QN_CSS=[
    '.ail-qn{border:1px solid #d4dce4;border-radius:5px;background:#fff;padding:2px 12px}',
    '.ail-qrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,240px);gap:6px 14px;align-items:center;padding:7px 0;border-top:1px solid #eef1f4}',
    '.ail-qrow:first-child{border-top:0}',
    '.ail-qrow[hidden],.ail-qn-extra[hidden]{display:none!important}',
    '.ail-qlabel{font-size:.84em;font-weight:500;color:#1b2026;line-height:1.4}',
    '.ail-qopt{color:#5c6773;font-weight:400}',
    '.ail-qsub{margin-left:18px;padding-left:12px;border-left:2px solid #f2c79b;animation:ailqIn .18s ease-out}',
    '.ail-qsub .ail-qlabel{color:#2a3340}',
    '@keyframes ailqIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '.ail-field .ail-qn .ail-qctl{width:100%;min-height:34px;padding:6px 10px!important;font-size:.85em;line-height:1.4;font-family:inherit;border-radius:5px;background:#fff!important;border:1px solid #d4dce4!important;color:#1b2026!important}',
    '.ail-field .ail-qn .ail-qctl:focus{outline:none;border-color:#ec7211!important;box-shadow:0 0 0 3px rgba(236,114,17,.14)}',
    '.ail-field .ail-qn .ail-qctl:disabled{background:#f3f5f7!important;color:#2a3340!important;opacity:1;cursor:default}',
    '.ail-field .ail-qn .ail-qctl.ail-qbad{border-color:#d33a3a!important}',
    '.ail-qn-status{margin:6px 0 0;font-size:.78em;color:#8a5a00}',
    '.ail-qn-status.ok{color:#1f7a45}',
    '.ail-qn-extra{margin-top:8px}',
    '.ail-qn-extra-h{font-size:.78em;font-weight:700;color:#5c6773;margin-bottom:4px}',
    '.ail-qn-extra pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:.82em;line-height:1.5;background:#f3f5f7;border:1px solid #e6eaee;border-radius:5px;padding:8px 10px;color:#2a3340}',
    // Multi-line answer (Netradyne footage review): 5 rows, vertical resize, full control-column width.
    '.ail-qrow-ta{align-items:start}',
    '.ail-qrow-ta .ail-qlabel{padding-top:7px}',
    '.ail-field .ail-qn textarea.ail-qta{display:block;width:100%;height:auto;min-height:calc(5 * 1.4em + 14px);max-height:calc(16 * 1.4em + 14px);resize:vertical;overflow-y:auto;white-space:pre-wrap}',
    '.ail-qrow.ail-flash,.ail-field.ail-flash{animation:ailFlash 1.8s ease-out}',
    '@keyframes ailFlash{0%,40%{background:rgba(236,114,17,.16);box-shadow:0 0 0 2px rgba(236,114,17,.45)}100%{background:transparent;box-shadow:none}}',
    // "Some fields are empty" confirmation pop-up (stacks above the editor dialog).
    // Same width as the incident-log modal (90vw; 96vw under 700px). ilCopyConfirm also pins it to
    // the modal's rendered width. The list scrolls inside the 80vh cap.
    '.ilc-bg{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:2vw;background:rgba(20,30,45,.45)}',
    '.ilc-bg[hidden]{display:none!important}',
    '.ilc-dlg{box-sizing:border-box;width:90vw;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;background:#fff;color:#1b2026;border:1px solid #d4dce4;border-radius:5px;box-shadow:0 18px 48px -12px rgba(20,30,45,.45);padding:22px 26px 18px;font-size:15px;text-align:left}',
    '.ilc-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
    '.ilc-title{margin:0 0 12px;font-size:1.1em;font-weight:800;color:#1b2026}',
    '.ilc-list{flex:1 1 auto;min-height:0;margin:0;padding:10px 12px 10px 28px;overflow-y:auto;background:#f7f9fb;border:1px solid #e6eaee;border-radius:5px;font-size:.9em;line-height:1.55;color:#2a3340}',
    '.ilc-list li{margin:1px 0}',
    '.ilc-q{margin:12px 0 0;font-size:.9em;color:#2a3340}',
    '.ilc-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}',
    '.ilc-btn{display:inline-flex;align-items:center;padding:8px 16px;border-radius:5px;font-weight:700;font-size:.88em;font-family:inherit;cursor:pointer;border:1px solid transparent}',
    '.ilc-btn.sec{background:#fff;border-color:#d4dce4;color:#2a3340}',
    '.ilc-btn.sec:hover{border-color:#8793a0;color:#1b2026}',
    '.ilc-btn.go{background:#ec7211;border-color:#ec7211;color:#fff}',
    '.ilc-btn.go:hover{filter:brightness(1.06)}',
    '.ilc-btn:focus-visible,.ilc-list:focus-visible{outline:2px solid #1577a0;outline-offset:2px}',
    // Incident-log modal width (Add + Edit, both pages): 90vw, 96vw under 700px. Scoped to
    // #incidentModal so it wins over the pages' older .ail-modal width rules.
    '#incidentModal .ail-modal{width:90vw;max-width:90vw}',
    '@media (max-width:699.98px){#incidentModal .ail-modal,.ilc-dlg{width:96vw;max-width:96vw}}',
    // Historical Incidents rows under SIM Root Cause Details: one line of five columns per row
    // (brief widest); four + brief on a second line under 900px; two columns on phones.
    '.ail-hist{margin-top:10px;border:1px solid #d4dce4;border-radius:5px;background:#fff;padding:8px 12px 10px}',
    '.ail-hist[hidden]{display:none!important}',
    '.ail-hist-h{font-size:.84em;font-weight:700;color:#1b2026;margin:2px 0 4px}',
    '.ail-hist-note{margin:0 0 6px;font-size:.78em;color:#8a5a00}',
    '.ail-hrow{padding:8px 0;border-top:1px solid #eef1f4}',
    '.ail-hist-h+.ail-hrow,.ail-hist-note+.ail-hrow{border-top:0}',
    '.ail-hrow-h{font-size:.74em;font-weight:700;color:#5c6773;margin-bottom:5px}',
    // 3 columns: col 1 = SIM link / Assignee / Incident date, col 2 = Issue type / Incident resolution,
    // col 3 = Incident brief spanning all three rows (same height as column 1).
    '.ail-hgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.6fr);grid-template-areas:"link type brief" "assignee res brief" "date . brief";gap:8px 12px;align-items:stretch}',
    '.ail-hcell-link{grid-area:link}.ail-hcell-assignee{grid-area:assignee}.ail-hcell-date{grid-area:date}',
    '.ail-hcell-type{grid-area:type}.ail-hcell-res{grid-area:res}.ail-hcell-brief{grid-area:brief}',
    '.ail-field .ail-hist .ail-hcell-brief textarea.ail-hta{flex:1 1 auto;height:100%;min-height:calc(5 * 1.4em + 14px);max-height:none}',
    '.ail-hcell{min-width:0;display:flex;flex-direction:column;gap:3px;border-radius:5px}',
    '.ail-hlabel{font-size:.76em;font-weight:600;color:#2a3340}',
    '.ail-field .ail-hist .ail-hctl{box-sizing:border-box;width:100%;min-height:34px;margin:0;padding:6px 10px!important;font-size:.85em;line-height:1.4;font-family:inherit;border-radius:5px!important;background:#fff!important;border:1px solid #d4dce4!important;color:#1b2026!important}',
    '.ail-field .ail-hist .ail-hctl:focus{outline:none;border-color:#ec7211!important;box-shadow:0 0 0 3px rgba(236,114,17,.14)}',
    '.ail-field .ail-hist .ail-hctl:disabled{background:#f3f5f7!important;color:#2a3340!important;opacity:1;cursor:default}',
    '.ail-field .ail-hist textarea.ail-hta{display:block;height:auto;min-height:calc(2 * 1.4em + 14px);max-height:calc(12 * 1.4em + 14px);resize:vertical;overflow-y:auto;white-space:pre-wrap}',
    '.ail-hcell.ail-flash{animation:ailFlash 1.8s ease-out}',
    '@media (max-width:900px){.ail-hgrid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:"link type" "assignee res" "date ." "brief brief"}}',
    '@media (max-width:520px){.ail-hgrid{grid-template-columns:minmax(0,1fr);grid-template-areas:"link" "assignee" "date" "type" "res" "brief"}}',
    '@media (max-width:640px){.ail-qrow{grid-template-columns:1fr;gap:4px}.ail-qsub{margin-left:8px}}',
    '@media (prefers-reduced-motion:reduce){.ail-qsub{animation:none}.ail-qrow.ail-flash,.ail-field.ail-flash{animation:none;outline:2px solid #ec7211}}'
  ].join('\n');
  function injectQnStyles(){
    if(document.getElementById('ile-qn-css')) return;
    var st=document.createElement('style'); st.id='ile-qn-css'; st.textContent=QN_CSS;
    document.head.appendChild(st);
  }
  // Light-theme CSS for the editor (same rules as my-tickets' inline base + light overrides).
  var CSS=[
    '.ail-modal{width:90vw;max-width:90vw;padding:0;overflow:hidden;display:flex;flex-direction:column;height:90vh;max-height:90vh}',
    '@media (max-width:699.98px){.ail-modal{width:96vw;max-width:96vw}}',
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
    parse:parseIncidentOutput, serialize:ilSerializeFields, build:buildIncidentOutput,
    setInvestigation:ilSetInvestigation, getInvestigation:ilGetInvestigation,
    setHistorical:ilSetHistorical, getHistorical:ilGetHistorical };
})();
if(typeof window!=='undefined') window.IncidentLogEditor=IncidentLogEditor;
if(typeof module!=='undefined' && module.exports) module.exports={ parseIncidentOutput:parseIncidentOutput, ilSerializeFields:ilSerializeFields,
  IL_INVEST_QS:IL_INVEST_QS, ilParseInvestigation:ilParseInvestigation, ilSerializeInvestigation:ilSerializeInvestigation, ilInvestMissing:ilInvestMissing,
  ilCopyMissing:ilCopyMissing, IL_HIST_FIELDS:IL_HIST_FIELDS, IL_HIST_MAX:IL_HIST_MAX, ilSimCnt:ilSimCnt,
  ilParseHistorical:ilParseHistorical, ilSerializeHistorical:ilSerializeHistorical, ilHistMissing:ilHistMissing };
