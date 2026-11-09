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
//   - the "SIM Root Cause Details" form (IL_SIM_FIELDS; pure ilParseSim / ilSerializeSim / ilSimImport /
//     ilSimParseDate; DOM ilSetSim / ilGetSim — the hidden #ilSimRcd textarea's value is a live view of
//     the form, so `el.value` reads / writes keep working) + its Import pop-up (ilSimImportOpen)
//   - "Historical Incidents" rows driven by the SIM "Cnt:" line (pure ilSimCnt / ilParseHistorical /
//     ilSerializeHistorical / ilHistMissing; DOM ilSetHistorical(text) / ilGetHistorical() / ilHistSync())
//   - ticket region (ilSetTicketRegion(title, country) — call before ilSetInvestigation; the CLEAR /
//     Station request / Netradyne questions are US/CA only) and the computed PHD Related Link
//     (hidden #ilRelatedLink) / PHD Resolution (SIM "Res:" line, else ilSetSavedResolution(v))
//   - field lock/edit toggles, per-field copy, empty markers, autosize, Root Cause
//     select, footer Copy + Copy w/o RC Details (always enabled; empty fields are confirmed in the
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
// right after PHD Findings (it is shown under SIM in the form but copied with the findings) and
// omitted entirely when empty. Copy w/o RC Details keeps it.
// Section order (saved): [Severity], Root Cause, SIM Root Cause Details, PHD Investigation, PHD Findings (+ Historical
// Incidents), then PHD Related Link + PHD Resolution (not shown in the form),
// then PHD notes. The headings are unchanged, and every parser (parseIncidentOutput, the server's
// incident-log-merge.js) locates sections by heading, so older entries in the old order still parse.
// opts.copy === true (footer Copy / Copy w/o RC Details only — not the saved text, not the per-field
// copies) puts "**SIM Title**: …" (ilCopySimTitle; f.country = ticket country code) and, when an EMT
// incident number is found (ilEmtNumber), "**EMT Link**: …" at the very top; the PHD notes then go
// through ilCopyNotes (internal / tag sections left out, duplicate EMT URL dropped, bold headings).
//
// f.severity ('1'..'5' or '') : the saved text starts with "**Severity**: Sev N" (left out when no
// severity is chosen); a Copy has no Severity line — the severity is in the SIM Title instead.
// Copy order (opts.copy only): SIM Title, EMT Link, Root Cause, PHD Related Link, SIM Root Cause
// Details, PHD Investigation, PHD Findings (+ Historical Incidents), PHD notes (without their
// "PHD Resolution:" section), "**PHD Resolution**: <value>", then the notes' "**PHD Resolution:**"
// section (ilSplitCopyNotesRes). The saved order is unchanged.
function ilSerializeFields(f,opts){
  opts=opts||{}; f=f||{};
  var v=function(k){ return String(f[k]==null?'':f[k]).trim(); };
  var parts=[], notes=v('notes'), sev=ilNormSeverity(v('severity'));
  if(opts.copy){
    parts.push('**SIM Title**: '+ilCopySimTitle(v('country'), v('sim'), sev));
    var emt=ilEmtNumber([v('notes'), v('findings'), v('rootCause'), v('sim'), v('invest'), v('hist'), v('link'), v('res')]);
    if(emt) parts.push('**EMT Link**: '+IL_EMT_URL_PRE+emt+IL_EMT_URL_POST);
    var cn=ilSplitCopyNotesRes(ilCopyNotes(notes,{emt:emt}));   // copy-only filtering (ilCopyNotes); nothing left -> "-"
    parts.push('**Root Cause**: '+(v('rootCause')||''));
    parts.push('**PHD Related Link**: '+(v('link')||''));
    if(!opts.omitSim) parts.push('**SIM Root Cause Details:**\n'+(v('sim')||'-'));
    parts.push('**PHD Investigation for mitigation:**\n'+(v('invest')||'-'));
    parts.push('**PHD Findings**:\n'+(v('findings')||'-'));
    if(v('hist')) parts.push(IL_HIST_HEAD+'\n'+v('hist'));
    parts.push('**PHD notes**:\n'+(cn.notes||'-'));
    parts.push('**PHD Resolution**: '+(v('res')||''));
    if(cn.res) parts.push(cn.res);
    return parts.join('\n\n');
  }
  if(sev) parts.push('**Severity**: Sev '+sev);
  parts.push('**Root Cause**: '+(v('rootCause')||''));
  if(!opts.omitSim) parts.push('**SIM Root Cause Details:**\n'+(v('sim')||'-'));
  parts.push('**PHD Investigation for mitigation:**\n'+(v('invest')||'-'));
  parts.push('**PHD Findings**:\n'+(v('findings')||'-'));
  // Historical Incidents travel with PHD Findings (also kept in Copy w/o RC Details).
  if(v('hist')) parts.push(IL_HIST_HEAD+'\n'+v('hist'));
  parts.push('**PHD Related Link**: '+(v('link')||''));
  parts.push('**PHD Resolution**: '+(v('res')||''));
  parts.push('**PHD notes**:\n'+(notes||'-'));
  return parts.join('\n\n');
}
// Severity 1..5 found in a text: "Severity N" / "Sev N" / "Sev-N" / "SevN" / "Sev#N" / "Severity: N" /
// "Severity level N" (any case), last match wins (same rule as the Assignment Center's title
// severity, plus the optional "level"). '' when none.
function ilSevFromText(text){
  var re=/\b(?:severity|sev)(?:[\s\-_:#]*(?:level|lvl))?[\s\-_:#]*([1-5])\b/gi, m, last='';
  var s=String(text==null?'':text);
  while((m=re.exec(s))) last=m[1];
  return last;
}
// '1'..'5' from a stored value ("3", 3, "Sev 3", "Severity 3"); '' otherwise.
function ilNormSeverity(v){
  var s=String(v==null?'':v).trim();
  return /^[1-5]$/.test(s) ? s : ilSevFromText(s);
}
// Split copied notes (ilCopyNotes output) into the notes without their "**PHD Resolution:**"
// section and that section (heading + its lines up to the next heading / the end). res is '' when
// the notes have no such section (or it has no lines).
function ilSplitCopyNotesRes(notes){
  var lines=String(notes==null?'':notes).split('\n'), keep=[], sec=[], inRes=false;
  var plain=function(l){ return String(l).replace(/\*\*/g,'').trim(); };
  var isHead=function(l){ var p=plain(l); return !!p && !/^[-*\u2022]/.test(p) && /:$/.test(p); };
  lines.forEach(function(l){
    if(isHead(l)){ inRes=/^phd resolution\s*:$/i.test(plain(l)); if(inRes){ if(sec.length) sec.push(''); return; } }
    else if(/^(?:-{3,}|\*{3,}|_{3,})$/.test(String(l).replace(/\s+/g,''))) inRes=false;
    if(inRes) sec.push(l); else keep.push(l);
  });
  var trim=function(a){ return a.join('\n').replace(/\n{3,}/g,'\n\n').trim(); };
  var body=trim(sec);
  if(!body) return {notes:trim(keep), res:''};
  return {notes:trim(keep), res:'**PHD Resolution:**\n'+body};
}
// Copied "SIM Title": "<CC> Customer Incident Escalation - Account ID: <CID> - Sev <N> - <Issue>" when
// the SIM "CID:" holds an account id, else "<CC> Community Member Incident Escalation - Sev <N> -
// <Issue>". CID blank / "-" / N/A / NA / None = absent. A missing country / severity / Issue is simply
// left out (no dangling " - ").
function ilCopySimTitle(country,sim,severity){
  var p=ilParseSim(sim,{aliases:true}).found||{};
  var cl=function(x){ x=String(x==null?'':x).replace(/\*\*/g,'').trim(); return /^(?:-|n\/?a|none)?$/i.test(x) ? '' : x; };
  var cid=cl(p.CID), iss=cl(p.Issue), cc=String(country==null?'':country).trim().toUpperCase(), sev=ilNormSeverity(severity);
  var parts=[(cc?cc+' ':'')+(cid?'Customer':'Community Member')+' Incident Escalation'];
  if(cid) parts.push('Account ID: '+cid);
  if(sev) parts.push('Sev '+sev);
  if(iss) parts.push(iss);
  return parts.join(' - ');
}
// EMT incident number: the digits of "incidentId=<digits>" in the first app.emt.amazon.dev URL found,
// searching the texts in the given order; '' when none.
var IL_EMT_URL_PRE='https://app.emt.amazon.dev/incidents/incidentId?accountId=account_amazongsoc&incidentId=';
var IL_EMT_URL_POST='&tabV=&tabValue=Overview';
function ilEmtNumber(texts){
  var re=/https?:\/\/app\.emt\.amazon\.dev\/[^\s<>"')\]]*?[?&]incidentId=(\d+)/i;
  for(var i=0;i<(texts||[]).length;i++){ var m=String(texts[i]==null?'':texts[i]).match(re); if(m) return m[1]; }
  return '';
}
// PHD Notes as they go into a footer Copy (opts.copy only; the saved text keeps the notes as-is).
//  - "Primary Case Tag:", "Evidence Checklist:" and "Investigation Checklist:" sections (heading +
//    lines up to the next heading) and the "INTERNAL ONLY — … DO NOT COPY …" heading are left out,
//    with a "---" rule directly above any of them.
//  - o.emt (EMT number found -> "**EMT Link**" is already at the top): lines holding an
//    app.emt.amazon.dev incident URL are left out, and so is a "Related Links:" heading left empty.
//  - "Risk Assessment:" / "PHD Resolution:" heading lines become "**Risk Assessment:**" /
//    "**PHD Resolution:**".
// Headings match case-insensitively with or without ** markers. Runs of blank lines collapse to one;
// leading / trailing blank lines (and rules) are trimmed. Returns '' when nothing is left.
var IL_COPY_BOLD_HEADS={'risk assessment':'Risk Assessment', 'phd resolution':'PHD Resolution'};
function ilCopyNotes(notes,o){
  o=o||{};
  var lines=String(notes==null?'':notes).replace(/\r\n?/g,'\n').split('\n');
  var plain=function(l){ return String(l).replace(/\*\*/g,'').trim(); };
  var isRule=function(l){ return /^(?:-{3,}|\*{3,}|_{3,})$/.test(String(l).replace(/\s+/g,'')); };
  var isInternal=function(l){ return /^internal only\s*[\u2014\u2013-]/i.test(plain(l)); };
  // Heading = a non-bullet line ending in ":" (after ** are removed), or the INTERNAL ONLY line.
  var isHead=function(l){ var p=plain(l); return isInternal(l) || (!!p && !/^[-*\u2022]/.test(p) && /:$/.test(p)); };
  var dropSec=function(l){ return /^(?:primary case tag|evidence checklist|investigation checklist)\s*:$/i.test(plain(l)); };
  var emtRe=/https?:\/\/app\.emt\.amazon\.dev\/\S*?[?&]incidentId=\d+/i;
  var nextText=function(i){ for(var j=i+1;j<lines.length;j++){ if(String(lines[j]).trim()) return lines[j]; } return ''; };
  var out=[], skip=false;
  lines.forEach(function(l,i){
    if(isHead(l)){
      if(isInternal(l)){ skip=false; return; }
      skip=dropSec(l);
      if(skip) return;
      var b=IL_COPY_BOLD_HEADS[plain(l).replace(/\s*:$/,'').toLowerCase()];
      out.push(b ? '**'+b+':**' : l);
      return;
    }
    if(skip) return;
    if(isRule(l)){ var n=nextText(i); if(n && (isInternal(n) || dropSec(n))) return; }
    if(o.emt && emtRe.test(l)) return;
    out.push(l);
  });
  // An emptied "Related Links:" heading (only blank lines up to the next heading / the end).
  if(o.emt){
    out=out.filter(function(l,i){
      if(!/^related links?\s*:$/i.test(plain(l))) return true;
      for(var j=i+1;j<out.length;j++){ if(isHead(out[j]) || isRule(out[j])) return false; if(String(out[j]).trim()) return true; }
      return false;
    });
  }
  var res=[];
  out.forEach(function(l){ if(!String(l).trim() && (!res.length || !String(res[res.length-1]).trim())) return; res.push(l); });
  while(res.length && (!String(res[res.length-1]).trim() || isRule(res[res.length-1]))) res.pop();
  while(res.length && isRule(res[0])) { res.shift(); while(res.length && !String(res[0]).trim()) res.shift(); }
  return res.join('\n').trim();
}
// PHD Resolution = the SIM Root Cause Details "Res:" value. Same rule as the server's
// resolutionFromRcd (pulse-check.js): key "Res" / "Resolution" at the start or after whitespace,
// value up to a newline or the next known "KEY:" (KEEP IN SYNC with RCD_NEXT_KEYS there), '**'
// stripped, whitespace collapsed. Returns null when there is no Res line (the caller then falls
// back to the saved entry's PHD Resolution); placeholder values are returned as written.
var IL_RCD_NEXT_KEYS='SID|Station\\s*ID|TID|Transporter\\s*ID|Driv|Driver\\s*Type|Date|Incident\\s*Date|TBA|Tracking\\s*ID|Cnt|Historical\\s*Incident|HI\\d+|Zip|CID|AID|UPID|Res|Resolution|Tag';
var IL_RCD_RES_RE=new RegExp('(?:^|\\s)Res(?:olution)?[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:'+IL_RCD_NEXT_KEYS+')\\s*:|[\\r\\n]|$)','i');
function ilResFromSim(sim){
  var m=String(sim==null?'':sim).replace(/\*\*/g,'').match(IL_RCD_RES_RE);
  return m ? m[1].replace(/\s+/g,' ').trim() : null;
}
// Country / region code of a ticket: the leading 2-3 letter code of the TITLE ("US Customer
// Incident …", "(US) Community Member …", "[CA] …"), when it is a known code; otherwise the
// ticket's country field (code or full name). '' when neither gives a known code.
var IL_COUNTRY_CODES={US:1,UK:1,CA:1,IN:1,AU:1,MX:1,JP:1,DE:1,IT:1,FR:1,EG:1,ES:1,SA:1,BR:1,NL:1,ZA:1,PT:1,UAE:1,IE:1,SG:1,TR:1,PL:1,SE:1,BE:1,AT:1,CH:1,DK:1,NO:1,FI:1,GR:1,CZ:1,GB:1,NZ:1,AE:1};
var IL_COUNTRY_NAMES={UNITEDSTATES:'US',USA:'US',CANADA:'CA',UNITEDKINGDOM:'UK',INDIA:'IN'};
function ilTicketCountry(title,country){
  var m=String(title||'').match(/^\s*[(\[]?\s*([A-Za-z]{2,3})\s*[)\]]?(?=[\s:\-\u2013\u2014|,.)\]]|$)/);
  if(m && IL_COUNTRY_CODES[m[1].toUpperCase()]) return m[1].toUpperCase();
  var c=String(country||'').toUpperCase().replace(/[^A-Z]/g,'');
  if(IL_COUNTRY_CODES[c]) return c;
  return IL_COUNTRY_NAMES[c]||'';
}
// The CLEAR / Station request / Netradyne questions apply to US and CA tickets only.
function ilIsUsCa(code){ code=String(code||'').toUpperCase(); return code==='US' || code==='CA'; }
// Reverse of ilSerializeFields: split a saved log blob back into the 7 structured fields so the
// Edit flow reopens the same split form. Tolerant of extra whitespace; a lone "-" placeholder -> ''.
// severity = the "**Severity**:" line ('1'..'5'), else the "Sev N" of a pasted Copy's SIM Title, else ''.
// A pasted Copy (PHD notes before PHD Resolution, then the notes' "**PHD Resolution:**" section at the
// very end): that trailing section goes back to the end of notes.
function parseIncidentOutput(text){
  var s=String(text||'').replace(/\r\n/g,'\n');
  var simTitle=s.match(/^\s*\*\*SIM Title\*\*:([^\n]*)/i);
  // A pasted Copy starts with "**SIM Title**: …" / "**EMT Link**: …" lines — not part of any field.
  s=s.replace(/^(?:[ \t]*\n)*(?:[ \t]*\*\*(?:SIM Title|EMT Link)\*\*:[^\n]*\n(?:[ \t]*\n)*)+/i,'');
  var clean=function(v){ v=String(v||'').trim(); return (v==='-')?'':v; };
  var tail='', iN=s.search(/\n\n\*\*PHD notes\*\*:\n/i), mt=s.match(/\n\n\*\*PHD Resolution\*\*:[ \t]*[^\n]*\n\n(\*\*PHD Resolution:\*\*[ \t]*\n[\s\S]*)$/i);
  if(iN>=0 && mt && mt.index>iN){ tail=mt[1].trim(); s=s.slice(0, s.length-mt[1].length).replace(/\s+$/,''); }
  // Capture each labelled section up to the next known label (or end).
  var grab=function(re){ var m=s.match(re); return m?clean(m[1]):''; };
  var NEXT='(?=\\n\\n(?:\\*\\*)?PHD Findings(?:\\*\\*)?:|\\n\\n\\*\\*PHD Investigation|\\n\\n\\*\\*SIM Root Cause|\\n\\n\\*\\*Historical Incidents:\\*\\*|\\n\\n\\*\\*Root Cause\\*\\*|\\n\\n\\*\\*PHD Related Link\\*\\*|\\n\\n\\*\\*PHD Resolution\\*\\*|\\n\\n\\*\\*PHD notes\\*\\*|\\n\\n\\*\\*Severity\\*\\*|$)';
  var sevLine=s.match(/(?:^|\n)[ \t]*\*\*Severity\*\*:[ \t]*([^\n]*)/i);
  var notes=grab(new RegExp('\\*\\*PHD notes\\*\\*:\\n([\\s\\S]*?)'+NEXT, 'i'));
  if(tail) notes=notes ? notes+'\n\n'+tail : tail;
  return {
    severity:  (sevLine && ilNormSeverity(sevLine[1])) || (simTitle ? ilSevFromText(simTitle[1]) : ''),
    findings:  grab(new RegExp('(?:\\*\\*)?PHD Findings(?:\\*\\*)?:\\n([\\s\\S]*?)'+NEXT, 'i')),
    invest:    grab(new RegExp('\\*\\*PHD Investigation for mitigation:\\*\\*\\n([\\s\\S]*?)'+NEXT, 'i')),
    sim:       grab(new RegExp('\\*\\*SIM Root Cause Details:\\*\\*\\n([\\s\\S]*?)'+NEXT, 'i')),
    hist:      grab(new RegExp('\\*\\*Historical Incidents:\\*\\*[ \\t]*\\n([\\s\\S]*?)'+NEXT, 'i')),
    rootCause: grab(new RegExp('\\*\\*Root Cause\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    link:      grab(new RegExp('\\*\\*PHD Related Link\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    res:       grab(new RegExp('\\*\\*PHD Resolution\\*\\*:[ \\t]*([\\s\\S]*?)'+NEXT, 'i')),
    notes:     notes
  };
}
// ---- "PHD Investigation for mitigation" questionnaire (pure model; no DOM; exported for Node) ----
// Saved text keeps the long-standing shape: one "- <Question>: <Answer>" line per question, with
// conditional sub-questions as indented "    - <Sub>: <Answer>" lines directly under their parent.
// `aliases` = labels used before the questionnaire existed, so old entries still parse.
// `importAliases` = AI checklist labels ("**Investigation / Evidence Checklist:**") that the whole-log
// Import maps onto the question (matched with and without a "(…)" suffix; see _ilfInvestKey). Not used
// for saved text.
var IL_INVEST_QS=[
  {key:'dup',    label:'Does current ticket have any duplicate', type:'select', opts:['No','Yes'],
    importAliases:['Duplicate Check via TBA','Duplicate Check']},
  // Form: unchecked = "No"; checked -> dropdown Yes / Community Member (Unknown).
  // "No" reveals an optional free-text "Who is the POI?" saved inline as "No (<text>)".
  // "Community Member (Unknown)" hides the IL_POI_CM_HIDE questions (form, copies and saved text).
  // direct: a plain dropdown (no row checkbox) — Yes (default) / Community Member / No (+ "Who is the POI?").
  {key:'poi',    label:'Is POI the CX', type:'select', direct:true, opts:['Yes','Community Member (Unknown)','No'],
    importAliases:['POI Is CX / Package Recipient vs CXID','POI Is CX / Package Recipient','POI Is CX'],
    poiWho:{key:'poiWho', label:'Who is the POI?', type:'text', optional:true, placeholder:"e.g. CX's father / neighbour / unknown person"}},
  {key:'susp',   label:'CX Account suspension requested from GSOC?', type:'select', opts:['No','Yes'],
    aliases:['CX Account suspension requested?','CX Account suspension requested'],
    importAliases:['CX Account Suspension Requested']},
  {key:'negFb',  label:'Negative Delivery Feedbacks reported in SIM against the Transporter', type:'number',
    aliases:['Negative Delivery Feedback or Fraud appeal reported in SIM against the Transporter',
             'Negative Delivery Feedbacks or Fraud appeal reported in SIM against the Transporter',
             'Negative Delivery Feedback reported in SIM against the Transporter'],
    importAliases:['Concerning Transporter History','Negative Delivery Feedback','Negative Delivery Feedbacks']},
  {key:'histCx', label:'Historical incidents against CX in SIM [If CX is POI]', type:'number',
    aliases:['Historical incidents against CX in SIM'],
    importAliases:['CXID History','Historical incidents against CX']},
  {key:'locSim', label:'Location Historical incidents in SIM records (UPID)', type:'number',
    importAliases:['UPID History','Location Historical incidents in SIM']},
  {key:'cortex', label:'Cortex Driver Trace added to SIM & EMT', type:'select', opts:['Yes','No'],
    aliases:['Cortex Driver Trace added to SIM','Cortex Driver Trace added to SIM and EMT'],
    importAliases:['Cortex Driver Trace and Heat Map','Cortex Driver Trace']},
  {key:'locEmt', label:'Location Historical incidents in EMT records (Physical address)', type:'number',
    importAliases:['Historical Incidents at Physical Address','Historical Incidents at the Physical Address','Location Historical incidents in EMT']},
  // usCa: asked only for US / CA tickets (ilSetTicketRegion); see _ilqRegionHidden.
  {key:'clear',  label:'CLEAR history of POI (Any violent/related charges exists?)', type:'select', opts:['No','Yes','Yes (low level offense)','N/A'], usCa:true,
    importAliases:['CLEAR POI History','CLEAR History of POI','CLEAR History']},
  // noFlex: also hidden when the SIM "Driv:" is Flex DP (see _ilqRegionHidden).
  {key:'station',label:'Station request made', type:'select', opts:['No','Yes'], usCa:true, noFlex:true,
    importAliases:['Station Request'],
    sub:{key:'stationLink', label:'Station request link', type:'text', inputType:'url', placeholder:'LINK_IF_APPLICABLE'}},
  {key:'netra',  label:'Netradyne footage exists', type:'select', opts:['No','Yes'], usCa:true, noFlex:true,
    importAliases:['Netradyne Footage'],
    // Multi-line free text (5-row textarea). Extra lines are saved as continuation lines indented
    // IL_INVEST_CONT_INDENT under the sub-line (see ilSerializeInvestigation / ilParseInvestigation).
    sub:{key:'netraInfo', label:'Netradyne footage review', type:'textarea', rows:5, placeholder:'IF_APPLICABLE',
      aliases:['Netradyne footage request info'],
      importAliases:['Netradyne Request Information','Netradyne Request Info','Netradyne Request']}},
  {key:'addPkg', label:'Additional packages delivered after incident?', type:'select', opts:['Yes','No'],
    importAliases:['Packages Delivered After Incident','Additional Packages Delivered After Incident']},
  {key:'di',     label:'Delivery instructions present', type:'select', opts:['Yes','No'],
    sub:{key:'diUpd', label:'Delivery instructions updated after incident?', type:'select', opts:['Yes','No'],
      importAliases:['Delivery Instructions Updated After Incident','Delivery Instructions Updated']}},
  // Checkbox (unchecked by default): checked = "Yes" -> "- GeoStudio Delivery Photo (POD) added: Yes";
  // unchecked -> no line at all (copies and saved text). Not required by the copy check.
  {key:'pod',    label:'GeoStudio Delivery Photo (POD) added', type:'check', opts:['Yes'],
    importAliases:['GeoStudio Delivery Photo Added','Delivery Photo (POD) Added','Delivery Photo Added']},
  // Only for DA: noFlex -> hidden when the SIM "Driv:" is Flex DP (shown for DSP DA / Hub DA / no Driv yet).
  // restToSub: a whole-log Import "Yes <more text>" puts the rest in the sub textarea (see _ilfInvest).
  {key:'austin', label:'AUSTIN Investigation Findings (Only for DA)', type:'select', opts:['No','Yes'], noFlex:true, restToSub:true,
    aliases:['AUSTIN Investigation Findings (DA)','AUSTIN Investigation Findings'],
    sub:{key:'austinInfo', label:'AUSTIN Investigation', type:'textarea', rows:5, placeholder:'IF_APPLICABLE'}},
  // petOnly: shown only for a pet incident (ilIsPetIncident; see _ilqRegionHidden).
  {key:'petRisk',label:'GeoStudio Dog Risk Level Updated (Only for Pet incidents)', type:'select', opts:['No','Yes'], petOnly:true,
    aliases:['GeoStudio Dog Risk Level Updated','GeoStudio Dog Risk Level']},
  {key:'pawLink',label:'Paw Print SIM Link Present (Only for Pet incidents)', type:'select', opts:['No','Yes'], petOnly:true,
    aliases:['Paw Print SIM Link Present','Paw Print SIM Link']},
  {key:'vacc',   label:'Vaccination Records received from POI (Only for Pet incidents)', type:'select', opts:['No','Yes'], petOnly:true,
    aliases:['Vaccination Records received from POI','Vaccination Records']}
];
// "Is POI the CX" = IL_POI_CM -> these questions (and their sub-questions) are hidden in the form and
// left out of the serialized section / copy check. Their values stay in the controls for the session.
var IL_POI_CM='Community Member (Unknown)';
var IL_POI_CM_HIDE=['susp','histCx','locSim','cortex','locEmt','clear','station','netra','addPkg','di','pod'];
// True if question q is hidden by the current POI answer.
function _ilqPoiHidden(q,a){ return IL_POI_CM_HIDE.indexOf(q.key)>=0 && String((a||{}).poi==null?'':a.poi).trim()===IL_POI_CM; }
// True if question q is hidden for the ticket's region. ro = {usca:boolean}; usca===false hides the
// usCa questions (+ their sub-questions). No ro / usca undefined -> shown (Node callers, old shape).
// noFlex questions (Station request, Netradyne + their sub-questions) are also hidden when the SIM
// Root Cause Details "Driv:" is Flex DP (ro.flex===true; see ilIsFlexDriv).
// petOnly questions (GeoStudio Dog Risk Level, Paw Print SIM Link, Vaccination Records) are hidden when
// the ticket is not a pet incident (ro.pet===false; see ilIsPetIncident).
function _ilqRegionHidden(q,ro){
  return !!((q.usCa && ro && ro.usca===false) || (q.noFlex && ro && ro.flex===true) || (q.petOnly && ro && ro.pet===false));
}
// Pet incident rule (same order and keywords as Page ZERO's classifyTicket, server/page-zero.js):
//   1. the SIM Root Cause Details "Issue:" value is one of the Issue Types "Pet" category
//      (IZ_CATS: Attack w/pet, Unsecured pet - bite/injury / evasion injury / no contact) or contains a
//      pet keyword (pet, dog, puppy, canine, K9, animal — e.g. "Pet Incident", "Dog bite",
//      "Unsecured Animal Attack (CX Pet)") -> pet;
//   2. an Issue that is another known Issue Type (e.g. "Threat of harm (verbal or written)") -> not pet;
//   3. otherwise (no / unknown Issue) the ticket title decides with the same keywords
//      (e.g. "US Community Member Incident Escalation - Sev 4 - Dog bite" -> pet).
// cats = the Issue Types list (defaults to window.IZ_CATS).
// "Non-pet" / "non pet" / "nonpet" are NOT pet (the hyphen is a word boundary, so it needs the lookbehind).
var IL_PET_RE=/(?<!non[\s\-_]?)\b(?:pets?|dogs?|pupp(?:y|ies)|canines?|k-?9s?|animals?)\b/i;
function ilSimIssue(sim){
  var m=String(sim==null?'':sim).replace(/\*\*/g,'').match(/(?:^|\n)[ \t]*Issue[ \t]*:[ \t]*([^\r\n]*)/i);
  return m ? m[1].trim() : '';
}
function ilIsPetIncident(issue,title,cats){
  if(cats==null) cats=(typeof window!=='undefined' && Array.isArray(window.IZ_CATS)) ? window.IZ_CATS : [];
  var iss=String(issue==null?'':issue).trim(), lo=iss.toLowerCase(), known=false, inPet=false;
  if(iss){
    (cats||[]).forEach(function(c){ (c.types||[]).forEach(function(t){
      if(t && String(t.type||'').toLowerCase()===lo){ known=true; if(c.category==='Pet') inPet=true; }
    }); });
    if(inPet || IL_PET_RE.test(iss)) return true;
    if(known) return false;
  }
  return IL_PET_RE.test(String(title==null?'':title));
}
// True when the SIM Root Cause Details text has "Driv:" / "Driver Type:" = Flex DP (any case/spacing,
// e.g. "Flex DP", "FLEX-DP", "Flex").
function ilIsFlexDriv(sim){
  var m=String(sim==null?'':sim).replace(/\*\*/g,'').match(/(?:^|\s)Driv(?:er\s*Type)?[ \t]*:[ \t]*([^\r\n]*)/i);
  return !!(m && /^flex/i.test(m[1].replace(/[^A-Za-z]/g,'')));
}
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
    if(def.type==='check'){
      // "Yes" -> checked; "No" / blank -> unchecked; anything else is kept verbatim with the other notes.
      if(/^yes$/i.test(ans)) answers[k]='Yes';
      else if(!ans || /^no$/i.test(ans)) answers[k]='';
      else { unknown.push.apply(unknown, rawOf[k]); delete answers[k]; }
      return;
    }
    answers[k]=(def.type==='select') ? _ilqCanon(def,ans) : ans;
  });
  // A saved sub-answer whose parent is not "Yes" would be dropped on save (hidden sub-questions are
  // omitted) — keep its original line with the other notes instead so nothing is lost.
  IL_INVEST_QS.forEach(function(q){
    if(q.sub && answers[q.sub.key] && answers[q.key]!=='Yes'){ unknown.push.apply(unknown, rawOf[q.sub.key]); delete answers[q.sub.key]; }
  });
  // raw = the original lines (incl. continuation lines) per answered key, so a caller can keep a
  // hidden question's saved lines byte-for-byte (see ilRegionKeptLines).
  var raw={}; Object.keys(answers).forEach(function(k){ if(rawOf[k]) raw[k]=rawOf[k].slice(); });
  return {answers:answers, unknown:unknown, raw:raw};
}
// Saved lines of the usCa questions (and their shown sub-questions) from a parsed section, keyed
// by question: {clear:[...], station:[...], netra:[...]}. Only questions with a saved answer.
function ilRegionKeptLines(p){
  var out={}, a=(p&&p.answers)||{}, raw=(p&&p.raw)||{};
  IL_INVEST_QS.forEach(function(q){
    if(!q.usCa) return;
    var ls=[];
    if(String(a[q.key]==null?'':a[q.key]).trim() && raw[q.key]) ls=ls.concat(raw[q.key]);
    if(q.sub && String(a[q.sub.key]==null?'':a[q.sub.key]).trim() && raw[q.sub.key]) ls=ls.concat(raw[q.sub.key]);
    if(ls.length) out[q.key]=ls;
  });
  return out;
}
// True if the sub-question of q is currently shown (parent answered "Yes").
function _ilqSubShown(q,a){ return !!(q.sub && a[q.key]==='Yes'); }
// Serialize answers (+ preserved unknown lines) back into the section body. Unanswered questions
// keep their line with an empty answer so the structure is stable. Returns '' when nothing at all
// is answered and there are no preserved lines (the section then saves as the usual "-").
// ro (optional) = {usca:boolean, kept:{key:[lines]}}: usca===false leaves out the usCa questions;
// for those, ro.kept lines (from the saved entry, ilRegionKeptLines) are written back unchanged in
// their place — the Save path passes them, the Copy path does not.
// The POD checkbox ('check') writes its line only when checked.
function ilSerializeInvestigation(answers,unknown,ro){
  var a=answers||{}, extra=(unknown||[]).filter(function(l){ return String(l).trim(); });
  var kept=(ro&&ro.kept)||{};
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
    if(_ilqRegionHidden(q,ro)){   // not a US / CA ticket (or Flex DP) -> no line, except saved answers kept as-is
      if(kept[q.key] && kept[q.key].length){ any=true; lines.push.apply(lines, kept[q.key]); }
      return;
    }
    if(_ilqPoiHidden(q,a)) return;   // hidden for a Community Member POI -> no line
    var v=val(q.key);
    if(q.type==='check'){ if(v==='Yes'){ any=true; push('- '+q.label+': ','Yes'); } return; }   // unchecked -> no line
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
function ilInvestMissing(answers,ro){
  var a=answers||{}, miss=[];
  var val=function(k){ return String(a[k]==null?'':a[k]).trim(); };
  IL_INVEST_QS.forEach(function(q){
    if(_ilqRegionHidden(q,ro) || _ilqPoiHidden(q,a)) return;   // hidden questions are not required
    if(q.type==='check') return;                                // a checkbox is never "missing"
    var v=val(q.key);
    if(q.type==='number' ? !/^\d+$/.test(v) : !v) miss.push(q.key);
    if(_ilqSubShown(q,a) && !val(q.sub.key)) miss.push(q.sub.key);
  });
  return miss;
}
// "DEFAULT" tag model (UI only; never part of saved / copied text). decided = {key:true} for every
// question the user changed this session, an import set, or a saved entry answered.
// Text answers and the optional "Who is the POI?" never get the tag.
function _ilqDefaultable(d){ return !d.optional && d.type!=='text' && d.type!=='textarea'; }
// decided map for a saved section body: every key with a saved answer; an entry with any saved
// answer also counts the POD checkbox (unchecked writes no line) as decided.
function ilInvestDecidedFromSaved(text){
  var p=(text && typeof text==='object') ? text : ilParseInvestigation(text), out={}, any=false;
  Object.keys(p.answers||{}).forEach(function(k){ out[k]=true; any=true; });
  if(any) IL_INVEST_QS.forEach(function(q){ if(q.type==='check') out[q.key]=true; });
  return out;
}
// Visible questions / shown sub-questions (same rules as the form) still at their untouched default.
function ilInvestDefaultKeys(decided,answers,ro){
  var d=decided||{}, a=answers||{}, out=[];
  IL_INVEST_QS.forEach(function(q){
    if(_ilqRegionHidden(q,ro) || _ilqPoiHidden(q,a)) return;
    if(_ilqDefaultable(q) && !d[q.key]) out.push(q.key);
    if(_ilqSubShown(q,a) && _ilqDefaultable(q.sub) && !d[q.sub.key]) out.push(q.sub.key);
  });
  return out;
}
// Section labels (as shown in the modal) in form order, keyed by field id.
var IL_FIELD_LABELS={ilRootCause:'Root Cause', ilSimRcd:'SIM Root Cause Details',
  ilPhdInvestigation:'PHD Investigation for mitigation', ilPhdFindings:'PHD Findings', ilPhdNotes:'PHD Notes'};
// What the footer Copy buttons check before copying (same rules the old disabled-gating used):
// every section non-empty; the questionnaire per ilInvestMissing. opts.omitSim (Copy w/o RC Details)
// skips SIM Root Cause Details, which that copy leaves out. opts.usca===false skips the US/CA-only
// questions. PHD Related Link is filled automatically (not checked); PHD Resolution comes from the
// SIM "Res:" line, so a missing one points at the SIM field.
// f = {findings, sim, rootCause, res, notes} (strings); answers = questionnaire answers.
// Returns [{id, key, label}] in form order (key = questionnaire key, '' for whole sections).
function ilCopyMissing(f,answers,opts){
  f=f||{}; opts=opts||{};
  var out=[], txt=function(k){ return String(f[k]==null?'':f[k]).trim(); };
  var sec=function(id,k){ if(!txt(k)) out.push({id:id, key:'', label:IL_FIELD_LABELS[id]}); };
  // Same order as the form on screen: Root Cause, SIM (+ historical rows), Investigation, Findings, Notes.
  sec('ilRootCause','rootCause');
  if(!opts.omitSim){
    sec('ilSimRcd','sim');
    // HI1..HIN issue types shown for Cnt (ids match the form's dropdowns "ils_HI<n>").
    ilSimHiMissing(f.sim).forEach(function(m){ out.push(m); });
    // Historical incident rows shown for the SIM "Cnt:" value (f.histRows); skipped with SIM.
    ilHistMissing(f.histRows, ilSimCnt(f.sim)).forEach(function(m){ out.push(m); });
  }
  var defs={}; IL_INVEST_QS.forEach(function(q){ defs[q.key]=q; if(q.sub) defs[q.sub.key]=q.sub; });
  ilInvestMissing(answers, opts).forEach(function(k){
    out.push({id:'ilq_'+k, key:k, label:'PHD Investigation \u2014 '+defs[k].label});
  });
  sec('ilPhdFindings','findings');
  if(!txt('res')) out.push({id:'ilSimRcd', key:'', label:'PHD Resolution (the "Res:" line of SIM Root Cause Details)'});
  sec('ilPhdNotes','notes');
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

// ---- SIM Root Cause Details form (pure model; no DOM; exported for Node) ----
// The field is a structured form (Issue dropdown, text inputs, Driv chips, date picker, Cnt
// buttons, Res dropdown) whose values serialize into the long-standing "Key: value" lines, one per
// line in IL_SIM_FIELDS order, so every reader of the text (ilSimCnt, ilResFromSim, ilIsFlexDriv,
// the server's Pulse Check / scoring parsers) is unchanged. Lines that are not one of the keys are
// kept and re-appended after the keys. `aliases` are accepted by the Import pop-up only.
var IL_SIM_FIELDS=[
  {key:'Issue', type:'issue', aliases:['Issue type','Incident type']},
  // Import aliases mirror the Build Root Cause Details tool (tool-rcd.html RC_FIELDS).
  {key:'SID',   type:'text',  hint:'station', aliases:['Station','Station ID','Station code']},
  {key:'Driv',  type:'driv',  hint:'driver type', aliases:['Driver type','Driver']},
  {key:'Date',  type:'date',  hint:'MM/DD/YY', aliases:['Incident date','Date of Incident']},
  {key:'TID',   type:'text',  hint:'transporter ID', aliases:['Transporter ID','Transporter']},
  {key:'Zip',   type:'text',  aliases:['Zip code','Zipcode','Postal code']},
  {key:'Cnt',   type:'cnt',   hint:'historical incidents', aliases:['Count','Historical Incident Count','Historical incidents','Historical incident','Historical incident(s)']},
  {key:'CID',   type:'text',  hint:'customer ID', aliases:['Customer Account ID','Account ID','AID','Customer ID']},
  {key:'UPID',  type:'text',  aliases:['Unit Place ID']},
  {key:'Res',   type:'res',   hint:'resolution', aliases:['Resolution']}
];
var IL_SIM_DRIV=['DSP DA','Flex DP','Hub DA'];
// Historical-incident issue types (same as the Build Root Cause Details tool, tool-rcd.html
// rcSyncHi): Cnt > 0 shows rows HI1..HIN below Res (at most IL_SIM_HI_MAX); each chosen row is
// written as "HIn: <type>" after the Res line. Unchosen rows are not written.
var IL_SIM_HI_MAX=9;
// Cnt value -> {n: rows to show, over: Cnt above IL_SIM_HI_MAX} (rcHiCountOf). Only a plain
// non-negative integer counts; blank / "N/A" / other text -> no rows.
function ilSimHiCount(cnt){
  var s=String(cnt==null?'':cnt).trim();
  if(!/^\d+$/.test(s)) return {n:0, over:false};
  var v=parseInt(s,10);
  return {n:Math.min(v,IL_SIM_HI_MAX), over:v>IL_SIM_HI_MAX};
}
// "HI2: X" / "hi 2 : X" / "**HI2:** X" -> {n:2, v:'X'}; null when not an HI line.
function _ilsHiLine(seg){
  var m=String(seg==null?'':seg).replace(/\*\*/g,'').match(/^\s*(?:[-*\u2022]\s*)?HI\s*(\d+)\s*:[ \t]*(.*)$/i);
  return m ? {n:parseInt(m[1],10), v:m[2].replace(/\s+/g,' ').trim()} : null;
}
function _ilsNormKey(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
var _ilsKeyIdx=(function(){
  var c={}, a={};
  IL_SIM_FIELDS.forEach(function(f){
    c[_ilsNormKey(f.key)]=f.key; a[_ilsNormKey(f.key)]=f.key;
    (f.aliases||[]).forEach(function(x){ a[_ilsNormKey(x)]=f.key; });
  });
  return {canon:c, alias:a};
})();
function _ilsKeyRe(alias){
  var names=[];
  IL_SIM_FIELDS.forEach(function(f){ names.push(f.key); if(alias) names=names.concat(f.aliases||[]); });
  names.sort(function(x,y){ return y.length-x.length; });
  names=names.map(function(n){ return n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*'); });
  names.push('HI\\s*\\d+');   // "Res: X HI1: Y" on one line splits like the other keys
  return new RegExp('(^|\\s)(?:'+names.join('|')+')\\s*:','gi');
}
// Split "Issue: X SID: Y" (several keys on one line) into one segment per key. A key only starts a
// new segment when the text before it already holds a "key:" (so "Incident date: …" stays whole).
function _ilsSplitLine(raw,alias){
  var re=_ilsKeyRe(alias), cuts=[], m, last=0;
  while((m=re.exec(raw))){
    var at=m.index+m[1].length;
    if(at>last && raw.slice(last,at).indexOf(':')>=0){ cuts.push(at); last=at; }
    if(re.lastIndex===m.index) re.lastIndex++;
  }
  if(!cuts.length) return [raw];
  var out=[], from=0;
  cuts.forEach(function(c){ out.push(raw.slice(from,c)); from=c; });
  out.push(raw.slice(from));
  return out;
}
// List match: case-insensitive, whitespace collapsed, any dash (- – — ‐) equal, so the typed
// "Physical altercation - No Injury" matches the list's "Physical altercation – No Injury".
function _ilsLoose(v){ return String(v==null?'':v).replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\s*-\s*/g,' - ').replace(/\s+/g,' ').trim().toLowerCase(); }
// -> the list's spelling; '' when not listed.
function _ilsCanon(list,v){
  var n=_ilsLoose(v); if(!n) return '';
  list=list||[];
  for(var i=0;i<list.length;i++) if(_ilsLoose(list[i])===n) return list[i];
  return '';
}
// Driver type -> 'DSP DA' / 'Flex DP' / 'Hub DA' (any case / spacing / dashes); '' when none.
function ilSimDriv(v){
  var t=String(v==null?'':v).toLowerCase().replace(/[^a-z]/g,'');
  if(t==='dspda'||t==='dsp') return 'DSP DA';
  if(t==='flexdp'||t==='flex'||t==='amazonflex'||t==='flexdriver') return 'Flex DP';
  if(t==='hubda'||t==='hub') return 'Hub DA';
  return '';
}
// ---- Dates: stored as MM/DD/YY ----
var IL_SIM_MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
function _ilsMon(s){
  s=String(s||'').toLowerCase(); if(s.length<3) return 0;
  for(var i=0;i<12;i++) if(IL_SIM_MONTHS[i].indexOf(s)===0 || (s==='sept' && i===8)) return i+1;
  return 0;
}
function _ilsYear(y){ y=parseInt(y,10); return y<100 ? 2000+y : y; }
function _ilsValidDate(y,m,d){
  if(!(m>=1 && m<=12 && d>=1 && y>=1900 && y<=2199)) return null;
  return d<=new Date(Date.UTC(y,m,0)).getUTCDate() ? {y:y,m:m,d:d} : null;
}
// Parse a date typed in common formats -> {y,m,d} or null. Accepts MM/DD/YY(YY) (DD/MM when the
// first number is above 12), YYYY-MM-DD (also with a time), "29 Oct 2026", "29OCT26", "11OCT'26",
// "Oct 29, 2026", "Thu, Oct 29 2026", YYYYMMDD. Separators / . - are interchangeable.
function ilSimParseDate(s){
  s=String(s==null?'':s).trim().replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i,'').replace(/[.,;]+$/,'');
  if(!s) return null;
  var m;
  if((m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/))) return _ilsValidDate(+m[1],+m[2],+m[3]);
  if((m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/))){
    var a=+m[1], b=+m[2]; if(a>12 && b<=12){ var t=a; a=b; b=t; }
    return _ilsValidDate(_ilsYear(m[3]),a,b);
  }
  if((m=s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]*([A-Za-z]{3,9})\.?[\s\-\/.,']*(\d{4}|\d{2})$/))){
    var mo=_ilsMon(m[2]); return mo ? _ilsValidDate(_ilsYear(m[3]),mo,+m[1]) : null;
  }
  if((m=s.match(/^([A-Za-z]{3,9})\.?[\s\-\/.]*(\d{1,2})(?:st|nd|rd|th)?[\s,\-\/.']+(\d{4}|\d{2})$/))){
    var mo2=_ilsMon(m[1]); return mo2 ? _ilsValidDate(_ilsYear(m[3]),mo2,+m[2]) : null;
  }
  if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/))) return _ilsValidDate(+m[1],+m[2],+m[3]);
  return null;
}
function _ils2(n){ return (n<10?'0':'')+n; }
// Any accepted date -> "MM/DD/YY"; '' when not a date.
function ilSimFmtDate(s){ var p=ilSimParseDate(s); return p ? _ils2(p.m)+'/'+_ils2(p.d)+'/'+_ils2(p.y%100) : ''; }
function _ilsIso(p){ return p ? p.y+'-'+_ils2(p.m)+'-'+_ils2(p.d) : ''; }
// Parse the field text -> {fields:{Issue..Res}, listed:{Issue,Res}, extra:[lines kept as-is],
// found:{key:raw value}}. Keys are case-insensitive with any spacing ("cnt :3", "**Res:** x"); a
// repeated key or any other line goes to `extra`. o.issues / o.res = the dropdown lists: Issue / Res
// stay as written in `fields` (so an unedited entry saves byte-identical) and `listed` holds the
// matching list option ('' when not in the list). o.aliases = also accept IL_SIM_FIELDS aliases.
// Driv: one of IL_SIM_DRIV when it matches, else as written. Cnt: digits normalised ("03" -> "3").
// Date: kept as written (the form normalises it to MM/DD/YY when edited).
// "HIn: <type>" lines (any case / spacing): the first one per n with n <= the Cnt row count
// (ilSimHiCount) -> fields.HI[n-1] (listed.HI[n-1] = list option); repeats / n above Cnt -> extra.
// fields.HI always has one entry per shown row ('' when absent).
function ilParseSim(text,o){
  o=o||{};
  var fields={}, found={}, extra=[], listed={Issue:'', Res:'', HI:[]};
  IL_SIM_FIELDS.forEach(function(f){ fields[f.key]=''; });
  fields.HI=[];
  var s=String(text==null?'':text).replace(/\r\n?/g,'\n');
  if(!s.trim() || s.trim()==='-') return {fields:fields, listed:listed, extra:extra, found:found};
  var idx=o.aliases ? _ilsKeyIdx.alias : _ilsKeyIdx.canon;
  var his=[];   // HI lines, kept in `extra` until Cnt is known: {at: index in extra, n, v}
  s.split('\n').forEach(function(raw){
    if(!raw.trim()) return;
    var segs=_ilsSplitLine(raw, !!o.aliases);
    segs.forEach(function(seg){
      var line=segs.length>1 ? seg.trim() : raw, h=_ilsHiLine(seg);
      if(h){ his.push({at:extra.length, n:h.n, v:h.v}); extra.push(line); return; }
      var m=seg.replace(/\*\*/g,'').match(/^\s*(?:[-*\u2022]\s*)?([^:]+?)\s*:[ \t]*(.*)$/);
      var k=m ? idx[_ilsNormKey(m[1])] : null;
      if(!k || Object.prototype.hasOwnProperty.call(found,k)){ extra.push(line); return; }
      found[k]=m[2].replace(/\s+/g,' ').trim();
    });
  });
  IL_SIM_FIELDS.forEach(function(f){
    var v=found[f.key]; if(v==null) return;
    if(f.type==='issue') listed.Issue=_ilsCanon(o.issues,v);
    else if(f.type==='res') listed.Res=_ilsCanon(o.res,v);
    else if(f.type==='driv') v=ilSimDriv(v)||v;
    else if(f.type==='cnt' && /^\d+$/.test(v)) v=String(parseInt(v,10));
    fields[f.key]=v;
  });
  // Leading number, as the Cnt control reads it ("2 (prior)" -> 2; N/A -> 0).
  var hn=ilSimHiCount((String(fields.Cnt).match(/^(\d+)\b/)||['',''])[1]).n, taken={}, drop={};
  for(var i=0;i<hn;i++){ fields.HI.push(''); listed.HI.push(''); }
  his.forEach(function(h){
    if(h.n<1 || h.n>hn || taken[h.n]) return;   // outside the shown rows / repeated -> stays in extra
    taken[h.n]=true; drop[h.at]=true;
    found['HI'+h.n]=h.v;
    fields.HI[h.n-1]=h.v; listed.HI[h.n-1]=_ilsCanon(o.issues,h.v);
  });
  extra=extra.filter(function(l,j){ return !drop[j]; });
  return {fields:fields, listed:listed, extra:extra, found:found};
}
// Fields (+ kept extra lines) -> the field text: every key on its own line in IL_SIM_FIELDS order
// ("SID:" when empty; Cnt defaults to "Cnt: 0"), extra lines after them. Returns '' when nothing is
// filled (all empty, Cnt 0, no extra lines) so a new log's untouched field still saves as "-".
function ilSerializeSim(fields,extra){
  var f=fields||{}, ex=(extra||[]).filter(function(l){ return String(l).trim(); });
  var any=ex.length>0, lines=[];
  IL_SIM_FIELDS.forEach(function(d){
    var v=String(f[d.key]==null?'':f[d.key]).replace(/\s+/g,' ').trim();
    if(d.type==='cnt' && !v) v='0';
    // Driv with none of the 3 options chosen -> "Driv: N/A" (same as the Build Root Cause Details tool).
    var na=d.type==='driv' && (!v || IL_SIM_DRIV.indexOf(v)<0 && /^n\/?a$/i.test(v));
    if(na) v='N/A';
    if(v && !na && !(d.type==='cnt' && v==='0')) any=true;
    lines.push(d.key+':'+(v?' '+v:''));
  });
  // "HIn: <type>" after Res, one per shown row (Cnt) that has a type chosen.
  var hi=Array.isArray(f.HI) ? f.HI : [], hn=ilSimHiCount(f.Cnt).n;
  for(var i=0;i<hn;i++){
    var hv=String(hi[i]==null?'':hi[i]).replace(/\s+/g,' ').trim();
    if(hv){ lines.push('HI'+(i+1)+': '+hv); any=true; }
  }
  return any ? lines.concat(ex).join('\n') : '';
}
// Import pop-up: map pasted text onto the fields. Only keys found with a usable value are returned
// in `fields`: Issue / Res in the list's spelling (an unlisted value is still returned, to show as
// "(not in list)", but reported as not matched); Driv only one of IL_SIM_DRIV; Date only when it
// parses (-> MM/DD/YY); Cnt only a number. summary = "Filled 8 of 10 fields · not matched: Res".
// Exact list match after trimming both sides (case and punctuation must match); '' when not listed.
function _ilsExact(list,v){
  var t=String(v==null?'':v).trim(); if(!t) return '';
  list=list||[];
  for(var i=0;i<list.length;i++) if(String(list[i]==null?'':list[i]).trim()===t) return list[i];
  return '';
}
function ilSimImport(text,o){
  o=o||{};
  var p=ilParseSim(text,{aliases:true}), out={}, filled=[], nm=[];
  IL_SIM_FIELDS.forEach(function(f){
    if(!Object.prototype.hasOwnProperty.call(p.found,f.key)) return;
    var v=p.found[f.key], c; if(!v || v==='-') return;
    if(f.type==='issue' || f.type==='res'){
      // Import pastes Issue / Res ONLY on an exact match (after trimming) with a dropdown option;
      // anything else is ignored and the dropdown is left blank.
      c=_ilsExact(f.type==='issue'?o.issues:o.res, v);
      out[f.key]=c; (c?filled:nm).push(f.key);
    } else if(f.type==='driv'){ c=ilSimDriv(v); if(c){ out[f.key]=c; filled.push(f.key); } else nm.push(f.key); }
    else if(f.type==='date'){ c=ilSimFmtDate(v); if(c){ out[f.key]=c; filled.push(f.key); } else nm.push(f.key); }
    else if(f.type==='cnt'){ var cm=v.match(/^(\d+)\b/); out[f.key]=cm ? String(parseInt(cm[1],10)) : '0'; filled.push(f.key); }
    else { out[f.key]=v; filled.push(f.key); }
  });
  // Cnt missing / blank / "-" in the pasted text -> 0 (the default).
  if(!Object.prototype.hasOwnProperty.call(out,'Cnt')){ out.Cnt='0'; filled.push('Cnt'); }
  // HI1..HIN issue types for the imported Cnt: out.HI[i] = list spelling (unlisted value kept, to
  // show as "(not in list)", and reported as not matched); '' = not in the text (row left as is).
  var hn=ilSimHiCount(out.Cnt).n, total=IL_SIM_FIELDS.length+hn;
  if(hn){
    out.HI=[];
    for(var i=0;i<hn;i++){
      var hv=String(p.fields.HI[i]||''), hc;
      if(!hv || hv==='-'){ out.HI.push(''); continue; }
      hc=_ilsExact(o.issues,hv); out.HI.push(hc); (hc?filled:nm).push('HI'+(i+1));
    }
  }
  var summary='Filled '+filled.length+' of '+total+' fields'+(nm.length?' \u00b7 not matched: '+nm.join(', '):'');
  return {fields:out, filled:filled, notMatched:nm, summary:summary};
}
// Copy check: every HI row shown for the SIM text's Cnt needs an issue type.
// Returns [{id:'ils_HI<n>', key:'', label:'SIM Root Cause Details — HI<n> issue type'}].
function ilSimHiMissing(sim){
  var p=ilParseSim(sim), out=[];
  p.fields.HI.forEach(function(v,i){
    if(!String(v||'').trim()) out.push({id:'ils_HI'+(i+1), key:'', label:IL_FIELD_LABELS.ilSimRcd+' \u2014 HI'+(i+1)+' issue type'});
  });
  return out;
}

// ---- Whole-log Import (pure model; no DOM; exported for Node) ----
// The pasted AI output is split into sections by heading lines ("**Determination:**", "PHD Findings:",
// "**INTERNAL ONLY — …**"; ** optional, trailing colon optional, any case). Mapping:
//   SIM Root Cause Details -> the SIM form (ilSimImport rules); Root Cause -> the dropdown (exact
//   match only); PHD Findings -> the findings field; Investigation / Evidence Checklist lines that
//   name a questionnaire question (or sub-question) -> that question (_ilfAnswer rules) and NOT the
//   notes; the checklist lines that name no question and every other section (incl. unknown
//   headings) -> PHD Notes, verbatim minus **.
var IL_FULL_HEADS=[
  {re:/^sim root cause details$/, kind:'sim'},
  {re:/^root cause$/, kind:'rootCause'},
  {re:/^phd findings$/, kind:'findings'},
  {re:/^(?:investigation|evidence) checklist$/, kind:'checklist'},
  {re:/^(?:determination|evidence details|risk assessment|phd resolution|primary case tag|phd notes)$/, kind:'notes'},
  {re:/^internal only\b/, kind:'notes'}
];
function _ilfHeadKind(name){
  var n=String(name||'').toLowerCase().replace(/\s+/g,' ').trim().replace(/\s*:$/,'');
  for(var i=0;i<IL_FULL_HEADS.length;i++) if(IL_FULL_HEADS[i].re.test(n)) return IL_FULL_HEADS[i].kind;
  return null;
}
// Heading line -> {title, kind, rest, known}; null for a content line. curKind = the section being read
// (inside SIM / checklists an empty "Key:" line is a value, not an unknown heading).
function _ilfHeading(raw,curKind){
  var t=String(raw).trim().replace(/^#{1,6}\s+/,'');
  if(/^[-\u2022]\s/.test(t) || /^\*\s/.test(t)) return null;   // bullet
  var b=t.match(/^\*\*(.+?)\*\*\s*(.*)$/), k;
  if(b){
    var name=b[1].trim(), rest=b[2];
    if(/^:/.test(rest)){ rest=rest.slice(1); if(!/:$/.test(name)) name+=':'; }
    rest=rest.replace(/\*\*/g,'').trim(); k=_ilfHeadKind(name);
    if(k) return {title:name, kind:k, rest:rest, known:true};
    if(!rest && /:$/.test(name)) return {title:name, kind:'notes', rest:'', known:false};   // unknown bold heading
    return null;
  }
  var p=t.replace(/\*\*/g,'').trim(), m=p.match(/^([^:]+?)\s*:\s*(.*)$/);
  if((k=_ilfHeadKind(p))) return {title:p, kind:k, rest:'', known:true};
  if(m && (k=_ilfHeadKind(m[1]))) return {title:m[1]+':', kind:k, rest:m[2].trim(), known:true};
  if(m && !m[2] && curKind!=='sim' && curKind!=='checklist' && m[1].split(/\s+/).length<=8 &&
     !_ilsKeyIdx.alias[_ilsNormKey(m[1])] && !/^HI\s*\d+$/i.test(m[1]))
    return {title:p, kind:'notes', rest:'', known:false};   // unknown plain heading "Something:"
  return null;
}
// Checklist label -> questionnaire key (first match wins; null = recognised but never filled).
var IL_FULL_INVEST_MAP=[
  ['clear',      /\bclear\b.*\bpoi\b|\bclear history\b/],
  ['poi',        /\bpoi\b.*\b(?:cx|customer|recipient)\b|is poi the cx/],
  ['susp',       /account suspension/],
  ['dup',        /duplicate/],
  ['negFb',      /concerning transporter history|negative delivery feedback/],
  ['histCx',     /cxid history|historical incidents against cx/],
  ['locSim',     /upid history|location historical incidents in sim/],
  ['locEmt',     /historical incidents at (?:the )?physical address|location historical incidents in emt/],
  ['cortex',     /cortex driver trace/],
  ['stationLink',/station request link/],
  ['station',    /^station request(?: made)?$/],
  ['netraInfo',  /netradyne (?:request|footage review)/],
  ['netra',      /netradyne footage(?: exists)?$/],
  ['addPkg',     /packages delivered after incident/],
  ['diUpd',      /delivery instructions updated/],
  ['di',         /delivery instructions present/],
  ['pod',        /delivery photo|\bpod\b/],
  ['austin',     /^austin investigation findings\b/],
  ['petRisk',    /^geostudio dog risk level\b/],
  ['pawLink',    /^paw print sim link\b/],
  ['vacc',       /^vaccination records\b/]
];
// normalised import label (with and without a "(…)" suffix) -> question / sub-question key.
var _ilfImpIndex=(function(){
  var m={}, add=function(d){
    (d.importAliases||[]).forEach(function(l){ m[_ilqNorm(l)]=d.key; m[_ilqNorm(String(l).replace(/\([^)]*\)/g,' '))]=d.key; });
  };
  IL_INVEST_QS.forEach(function(q){ add(q); if(q.sub) add(q.sub); });
  return m;
})();
// Checklist label -> questionnaire key: saved labels / aliases, then importAliases, then the loose
// IL_FULL_INVEST_MAP patterns. null = the line maps to no question (it stays in PHD Notes).
function _ilfInvestKey(label){
  var full=_ilqNorm(label), n=_ilqNorm(String(label).replace(/\([^)]*\)/g,' '));
  var hit=_ilqIndex[full] || _ilqIndex[n];
  if(hit) return (hit.sub||hit.q).key;
  if(_ilfImpIndex[full]) return _ilfImpIndex[full];
  if(_ilfImpIndex[n]) return _ilfImpIndex[n];
  for(var i=0;i<IL_FULL_INVEST_MAP.length;i++) if(IL_FULL_INVEST_MAP[i][1].test(n)) return IL_FULL_INVEST_MAP[i][0];
  return null;
}
// Checklist answer -> the question's value; null = nothing to apply.
//   "Not Documented" / "Not Provided" -> "No" (selects with No; the POD checkbox -> "No" = unchecked),
//   "0" for numbers, '' for text sub-questions; "Not Applicable" -> "N/A" when offered, otherwise the same.
//   A leading "Trace Mandatory — " style prefix is skipped. "Is POI the CX" is set only when the
//   answer names one of its options. Otherwise an explicit leading option / number; text
//   sub-questions take the text as-is.
function _ilfAnswer(def,a){
  if(!def) return null;
  a=String(a==null?'':a).replace(/\*\*/g,'').trim().replace(/^[a-z][a-z ]*?\bmandatory\s*[\u2014\u2013:\-]+\s*/i,'');
  var opts=def.opts||[], txt=(def.type==='text'||def.type==='textarea'), poi=!!def.poiWho;
  var nd=/^not\s+(?:documented|provided)(?![a-z0-9])/i.test(a), na=/^not\s+applicable(?![a-z0-9])/i.test(a);
  if((nd||na) && !poi){
    if(txt) return '';
    if(na && opts.indexOf('N/A')>=0) return 'N/A';
    if(def.type==='number') return '0';
    if(def.type==='check' || opts.indexOf('No')>=0) return 'No';
    return null;
  }
  if(!a || nd || na) return null;
  if(txt) return a;
  if(def.type==='number'){ var m=a.match(/^(\d+)(?![.,]\d)\b/); return m ? String(parseInt(m[1],10)) : null; }
  var so=opts.slice().sort(function(x,y){ return y.length-x.length; }), lo=a.toLowerCase();
  for(var i=0;i<so.length;i++){
    var ol=so[i].toLowerCase();
    if(lo.indexOf(ol)===0 && !/[a-z0-9]/i.test(lo.charAt(ol.length))) return so[i];
  }
  if(opts.indexOf(IL_POI_CM)>=0 && /^community member(?![a-z0-9])/i.test(a)) return IL_POI_CM;
  if(def.type==='check' && /^no(?![a-z0-9])/i.test(a)) return 'No';
  return null;
}
// Checklist line -> the key it maps to (null = not a "Label: answer" line or no question).
function _ilfLineKey(l){
  var t=String(l).replace(/\*\*/g,'').replace(/^\s*[-*\u2022]\s+/,''), m=t.match(/^([^:]+?)\s*:/);
  return m ? _ilfInvestKey(m[1]) : null;
}
// Checklist lines left for PHD Notes: every item that maps to a question is dropped (with its
// continuation lines); items that map to no question stay. An item = a bullet or a "Label:" line.
function _ilfNotesLines(lines){
  var keep=[], drop=false;
  lines.forEach(function(l){
    var t=String(l).replace(/\*\*/g,'');
    if(/^\s*[-*\u2022]\s+/.test(t) || /^\s*[^:\s][^:]*:/.test(t)) drop=!!_ilfLineKey(l);
    if(!drop) keep.push(l);
  });
  return keep;
}
// Checklist lines -> {key: answer}. The first line per key wins; '' = an applied empty text answer.
function _ilfInvest(lines){
  var defs={}, out={}, has=function(k){ return Object.prototype.hasOwnProperty.call(out,k); };
  IL_INVEST_QS.forEach(function(q){ defs[q.key]=q; if(q.sub) defs[q.sub.key]=q.sub; });
  lines.forEach(function(l){
    var t=String(l).replace(/\*\*/g,'').replace(/^\s*[-*\u2022]\s+/,''), m=t.match(/^([^:]+?)\s*:\s*(.*)$/);
    if(!m) return;
    var k=_ilfInvestKey(m[1]); if(!k || has(k)) return;
    var v=_ilfAnswer(defs[k],m[2]); if(v!=null) out[k]=v;
    // restToSub (AUSTIN): "Yes - <findings>" -> the rest goes into the sub textarea.
    if(v==='Yes' && defs[k].restToSub && defs[k].sub && !Object.prototype.hasOwnProperty.call(out,defs[k].sub.key)){
      var rest=String(m[2]).replace(/\*\*/g,'').trim().slice(3).trim(), par=/^\((.*)\)$/.exec(rest);
      rest=(par ? par[1] : rest).replace(/^[\s,;:.\-\u2013\u2014]+/,'').trim();
      if(rest) out[defs[k].sub.key]=rest;
    }
  });
  // A sub-answer only applies under a "Yes" parent.
  IL_INVEST_QS.forEach(function(q){ if(q.sub && has(q.sub.key) && out[q.key]!=='Yes') delete out[q.sub.key]; });
  return out;
}
// "Imported: SIM Root Cause Details (10 of 10), Root Cause, … · not matched: Root Cause".
// investN = questionnaire answers actually applied (defaults to every parsed one).
function ilFullLogSummary(r,investN){
  var parts=[], nm=[];
  if(r.sim){
    var total=IL_SIM_FIELDS.length+ilSimHiCount(r.sim.fields.Cnt).n;
    parts.push(IL_FIELD_LABELS.ilSimRcd+' ('+r.sim.filled.length+' of '+total+')');
    r.sim.notMatched.forEach(function(k){ nm.push('SIM '+k); });
    if(r.drivInferred) parts.push('Driv: '+r.drivInferred+' (from the text)');
  }
  if(r.rootCause.found){ if(r.rootCause.value) parts.push('Root Cause'); else nm.unshift('Root Cause'); }
  if(r.severity) parts.unshift('Severity'); else nm.unshift('Severity');
  if(r.findings) parts.push('PHD Findings');
  var n=investN==null ? Object.keys(r.invest).length : investN;
  if(n) parts.push('Investigation ('+n+(n===1?' answer)':' answers)'));
  if(r.notes) parts.push('PHD Notes');
  return (parts.length ? 'Imported: '+parts.join(', ') : 'Nothing imported')+(nm.length?' \u00b7 not matched: '+nm.join(', '):'');
}
// text + {rootCauses, issues, res} (the dropdown lists) ->
// {sim: ilSimImport result | null, rootCause:{found, raw, value}, findings, invest:{key:answer},
//  notes, known: number of recognised headings, summary}.
function ilParseFullLog(text,o){
  o=o||{};
  var cur={title:'', kind:'notes', lines:[]}, secs=[cur], known=0;
  String(text==null?'':text).replace(/\r\n?/g,'\n').split('\n').forEach(function(raw){
    if(!raw.trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return;   // blank lines + "---" separators
    var h=_ilfHeading(raw,cur.kind);
    if(h){ cur={title:h.title, kind:h.kind, lines:[]}; secs.push(cur); if(h.known) known++; if(h.rest) cur.lines.push(h.rest); return; }
    cur.lines.push(raw.replace(/\*\*/g,'').replace(/\s+$/,''));
  });
  var unb=function(l){ return String(l).replace(/^\s*[-*\u2022]\s+/,'').trim(); };
  var sim=[], rc=[], fin=[], chk=[], notes=[];
  // Checklist lines that map to a question go to the questionnaire only (not repeated in PHD Notes);
  // a checklist heading with nothing left is dropped, and so is a bare "INTERNAL ONLY …" heading
  // when no checklist line is left at all.
  var anyChk=false;
  secs.forEach(function(s){ if(s.kind==='checklist'){ s.rem=_ilfNotesLines(s.lines); if(s.rem.length) anyChk=true; } });
  secs.forEach(function(s){
    if(!s.title && !s.lines.length) return;
    if(s.kind==='sim'){ sim=sim.concat(s.lines.map(unb)); return; }
    if(s.kind==='rootCause'){ rc=rc.concat(s.lines.map(unb).filter(Boolean)); return; }
    if(s.kind==='findings'){ fin=fin.concat(s.lines); return; }
    if(s.kind==='checklist'){
      chk=chk.concat(s.lines);
      if(s.rem.length) notes.push((s.title?[s.title]:[]).concat(s.rem).join('\n'));
      return;
    }
    if(!s.lines.length && !anyChk && /^internal only\b/i.test(String(s.title).trim())) return;
    notes.push((s.title?[s.title]:[]).concat(s.lines).join('\n'));
  });
  var hasRc=secs.some(function(s){ return s.kind==='rootCause'; });
  var r={
    sim: secs.some(function(s){ return s.kind==='sim'; }) ? ilSimImport(sim.join('\n'),{issues:o.issues, res:o.res}) : null,
    rootCause:{found:hasRc, raw:rc[0]||'', value:_ilsExact(o.rootCauses, rc[0]||'')},
    findings:fin.join('\n').trim(),
    invest:_ilfInvest(chk),
    notes:notes.join('\n\n').trim(),
    severity:ilSevFromText(text),   // anywhere in the pasted text ('' = not found)
    known:known
  };
  // Bare "Driv: DA" / "Delivery Associate": the driver type comes from the rest of the paste when
  // exactly one of "DSP" / "Hub" appears there (whole word, any case; "Flex" is not looked at).
  // Neither or both -> today's rule (not matched, left as N/A).
  if(r.sim && r.sim.notMatched.indexOf('Driv')>=0){
    var dv=String(ilParseSim(sim.join('\n'),{aliases:true}).found.Driv||'').replace(/\*\*/g,'').trim();
    if(/^(?:da|delivery\s+associate)$/i.test(dv)){
      var other=secs.filter(function(s){ return s.kind!=='sim'; })
        .map(function(s){ return (s.title||'')+'\n'+s.lines.join('\n'); }).join('\n');
      var dsp=/\bdsp\b/i.test(other), hub=/\bhub\b/i.test(other);
      if(dsp!==hub){
        r.drivInferred=dsp ? 'DSP DA' : 'Hub DA';
        r.sim.fields.Driv=r.drivInferred;
        r.sim.notMatched=r.sim.notMatched.filter(function(k){ return k!=='Driv'; });
        r.sim.filled.push('Driv');
      }
    }
  }
  r.summary=ilFullLogSummary(r);
  return r;
}

// Assemble the structured form fields (DOM) into the standard copy/save format.
// opts.omitSim === true drops the "SIM Root Cause Details" section (used by "Copy w/o RC Details").
// opts.copy === true = a Copy (US/CA-only answers kept from a non-US/CA saved entry are left out);
// without it (Save) those kept lines are written back unchanged.
// PHD Related Link + PHD Resolution are not form fields: the link is the hidden #ilRelatedLink the
// pages fill with the ticket URL; the resolution is the SIM "Res:" value (ilCurrentResolution).
function buildIncidentOutput(opts){
  opts=opts||{};
  var g=function(id){ var el=document.getElementById(id); return el?String(el.value||'').trim():''; };
  return ilSerializeFields({
    findings:g('ilPhdFindings'), invest:ilGetInvestigation(!opts.copy), sim:g('ilSimRcd'), hist:ilGetHistorical(),
    rootCause:g('ilRootCause'), link:ilCurrentLink(), res:ilCurrentResolution(), notes:g('ilPhdNotes'),
    country:IL_TICKET_COUNTRY, severity:ilGetSeverity()
  }, opts);
}
// ---- Severity row (#ilSevField above Root Cause; buttons 1..5, single choice, none by default) ----
var _ilSev='';        // '1'..'5' or ''
var _ilSevNeed=false; // the whole-log Import found no severity -> amber "Select a severity" mark
function ilGetSeverity(){ return _ilSev; }
function _ilSevRender(){
  if(typeof document==='undefined') return;
  var g=document.getElementById('ilSevGroup'); if(!g) return;
  Array.prototype.forEach.call(g.querySelectorAll('.ail-qnb'),function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-n')===_ilSev?'true':'false'); });
  var fld=document.getElementById('ilSevField'), need=_ilSevNeed && !_ilSev;
  if(fld){ fld.classList.toggle('is-changed', !!_ilSev); fld.classList.toggle('is-needed', need); }
  var h=document.getElementById('ilSevHint'); if(h) h.hidden=!need;
  if(need) g.setAttribute('aria-describedby','ilSevHint'); else g.removeAttribute('aria-describedby');
}
// v = 1..5 / "Sev 3" / '' (clears). o.need = show the "Select a severity" mark while it is empty.
function ilSetSeverity(v,o){
  _ilSev=ilNormSeverity(v);
  _ilSevNeed=!!(o && o.need);
  _ilSevRender();
}
// Opened saved entry: its "**Severity**:" value, else the ticket title's severity (ilSetTicketRegion).
function ilSetSavedSeverity(v){ ilSetSeverity(ilNormSeverity(v) || ilSevFromText(IL_TICKET_TITLE)); }
// Button click: pick N; clicking the selected one clears it.
function ilSevPick(n){
  n=String(n);
  _ilSev=(_ilSev===n) ? '' : ilNormSeverity(n);
  _ilSevRender();
}
// ---- PHD Related Link / PHD Resolution (computed, not shown in the form) ----
var _ilSavedRes='';   // the opened entry's saved PHD Resolution (fallback when SIM has no Res line)
function ilSetSavedResolution(v){ _ilSavedRes=String(v==null?'':v).trim(); }
function ilCurrentResolution(){
  var el=document.getElementById('ilSimRcd');
  var r=ilResFromSim(el?el.value:'');
  return r!=null ? r : _ilSavedRes;
}
function ilCurrentLink(){
  var el=document.getElementById('ilRelatedLink'), v=el?String(el.value||'').trim():'';
  return v || (IL_TICKET_SID ? 'https://t.corp.amazon.com/issues/'+IL_TICKET_SID : '');
}
// ---- Ticket region (drives the US/CA-only questions) ----
var _ilUsca=false;   // set per opened ticket by ilSetTicketRegion (unknown country -> not US/CA)
var IL_TICKET_COUNTRY='';
var IL_TICKET_TITLE='';   // the opened ticket's title (pet incident fallback when SIM has no Issue)
// Call BEFORE ilSetInvestigation when opening the editor for a ticket.
function ilSetTicketRegion(title,country){
  IL_TICKET_TITLE=String(title==null?'':title);
  IL_TICKET_COUNTRY=ilTicketCountry(title,country);
  ilSetSeverity(ilSevFromText(IL_TICKET_TITLE));   // per opened ticket: the title's severity ('' = none); ilSetSavedSeverity overrides
  _ilUsca=ilIsUsCa(IL_TICKET_COUNTRY);
  if(typeof document!=='undefined' && document.getElementById('ilPhdInvestigation')) _ilqSyncVisibility();
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

// ---- SIM Root Cause Details form DOM: #ilSimForm, controls "ils_<key>" ----
// #ilSimRcd stays in the markup as a hidden textarea whose `value` is a live view of the form:
// reading it serializes the controls (ilGetSim), assigning it parses the text into them (ilSetSim).
// So the pages' `el.value=…` reset / edit-open code and every reader keep working unchanged.
var _ilsExtra=[];      // saved lines that are not one of the keys; re-appended on save
var _ilsOldCnt=null;   // a saved non-numeric Cnt (e.g. "N/A"), kept until the Cnt control changes
var _ilsLocked=false;  // follows the field lock (pencil)
var _ilsResList=(typeof window!=='undefined' && Array.isArray(window.RC_RESOLUTIONS)) ? window.RC_RESOLUTIONS.slice() : [];
var _ilsResAsked=false;
function _ilsEl(k){ return document.getElementById('ils_'+k); }
function _ilsSlice(l){ return Array.prototype.slice.call(l||[]); }
// Issue types = the Issue Types page taxonomy (window.IZ_CATS, issue-types-data.js), flat.
function _ilsIssues(){
  var out=[], cats=(typeof window!=='undefined' && Array.isArray(window.IZ_CATS)) ? window.IZ_CATS : [];
  cats.forEach(function(c){ (c.types||[]).forEach(function(t){ if(t && t.type && out.indexOf(t.type)<0) out.push(t.type); }); });
  return out;
}
function _ilsLists(){ return {issues:_ilsIssues(), res:_ilsResList}; }
function _ilsIssueOptions(){
  var cats=(typeof window!=='undefined' && Array.isArray(window.IZ_CATS)) ? window.IZ_CATS : [];
  return '<option value="">Select issue type</option>'+cats.map(function(cat){
    return '<optgroup label="'+_ileEsc(cat.category)+'">'+(cat.types||[]).map(function(t){
      return '<option value="'+_ileEsc(t.type)+'">'+_ileEsc(t.type)+'</option>'; }).join('')+'</optgroup>';
  }).join('');
}
function _ilsResOptions(list){
  return '<option value="">Select resolution</option>'+(list||[]).map(function(r){ return '<option value="'+_ileEsc(r)+'">'+_ileEsc(r)+'</option>'; }).join('');
}
// PHD Resolutions: the phd-resolutions.html list (GET /api/phd-resolutions, read only), A-Z like the
// other My Tickets dropdowns; window.RC_RESOLUTIONS until it loads / when it fails or no session.
function ilSimLoadResolutions(){
  if(_ilsResAsked || typeof window==='undefined') return;
  var A=window.PHDAuth;
  if(!(A && A.api && A.getUser && A.getUser())) return;   // no session: a 401 would pop the expired-session modal
  _ilsResAsked=true;
  Promise.resolve().then(function(){ return A.api('GET','/api/phd-resolutions'); }).then(function(r){
    if(!(r && r.ok && Array.isArray(r.data))) return;
    var names=[];
    r.data.forEach(function(x){ var n=String((x&&x.name)||'').trim(); if(n && names.indexOf(n)<0) names.push(n); });
    if(!names.length) return;
    names.sort(function(a,b){ return a.localeCompare(b); });
    _ilsResList=names;
    var sel=_ilsEl('Res'); if(!sel) return;
    var cur=_ilsSelVal(sel); sel.innerHTML=_ilsResOptions(names); _ilsSetSelect(sel,cur,_ilsCanon(names,cur));
  }).catch(function(){});
}
// Selected dropdown value; a loaded spelling that differs from its list option only by case /
// dashes (sel._ilsRaw, see _ilsSetSelect) is returned as saved while that option stays selected.
function _ilsSelVal(sel){
  if(!sel) return '';
  var v=String(sel.value||'');
  return (sel._ilsRaw && v===sel._ilsRaw.opt) ? sel._ilsRaw.raw : v;
}
// Set a dropdown. listed = the list option matching v loosely (ilParseSim .listed): that option is
// selected and v's own spelling kept for saving. A value not in the list is added as
// "<value> (not in list)" so nothing is lost.
function _ilsSetSelect(sel,v,listed){
  if(!sel) return;
  _ilsSlice(sel.querySelectorAll('option[data-extra]')).forEach(function(o){ o.parentNode.removeChild(o); });
  v=String(v==null?'':v).trim();
  sel._ilsRaw=null;
  if(v && listed && listed!==v && _ilsSlice(sel.options).some(function(o){ return o.value===listed; })){ sel._ilsRaw={opt:listed, raw:v}; v=listed; }
  if(v && !_ilsSlice(sel.options).some(function(o){ return o.value===v; })){
    var o=document.createElement('option'); o.value=v; o.textContent=v+' (not in list)'; o.setAttribute('data-extra','1'); sel.appendChild(o);
  }
  sel.value=v;
  if(sel._ssWrap && window.makeSearchableSelect) window.makeSearchableSelect(sel);
}
// Driv: native radios (name ilsDriv) styled as chips; clicking the selected one clears it.
function _ilsDrivRadios(){ var g=document.getElementById('ils_Driv'); return g ? _ilsSlice(g.querySelectorAll('input[type=radio]')) : []; }
function _ilsDrivVal(){ var r=_ilsDrivRadios().filter(function(x){ return x.checked; })[0]; return r ? r.value : ''; }
function _ilsDrivMark(){
  var any=false;
  _ilsDrivRadios().forEach(function(r){ r._ilsWas=r.checked; if(r.checked) any=true; });
  var c=document.getElementById('ils_DrivClear'); if(c) c.hidden=!any;
}
function _ilsSetDriv(v){
  var g=document.getElementById('ils_Driv'); if(!g) return;
  _ilsSlice(g.querySelectorAll('[data-extra]')).forEach(function(n){ n.parentNode.removeChild(n); });
  v=String(v==null?'':v).trim();
  if(v && IL_SIM_DRIV.indexOf(v)<0){   // saved value that is not one of the three -> extra chip
    var lab=document.createElement('label'); lab.className='ail-schip'; lab.setAttribute('data-extra','1');
    lab.innerHTML='<input type="radio" class="ail-sctl" name="ilsDriv" id="ils_Driv_x" onclick="ilsDrivClick(this)"><span>'+_ileEsc(v)+' (not in list)</span>';
    lab.querySelector('input').value=v; lab.querySelector('input').disabled=_ilsLocked;
    g.appendChild(lab);
  }
  _ilsDrivRadios().forEach(function(r){ r.checked=(!!v && r.value===v); });
  _ilsDrivMark();
}
function ilsDrivClick(el){
  if(el && el._ilsWas) el.checked=false;   // click on the selected chip clears it
  _ilsDrivMark(); ilSimChanged();
}
function ilsDrivClear(){
  _ilsDrivRadios().forEach(function(r){ r.checked=false; });
  _ilsDrivMark(); ilSimChanged();
  var f=_ilsDrivRadios()[0]; if(f) try{ f.focus(); }catch(e){}
}
// Cnt: buttons 0..10 + "Other" (same control as the questionnaire's negative-feedback count).
function _ilsCntBtns(){ var g=document.getElementById('ilsg_Cnt'); return g ? _ilsSlice(g.querySelectorAll('.ail-qnb')) : []; }
function _ilsSetCntBtn(n){ _ilsCntBtns().forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-n')===String(n)?'true':'false'); }); }
function _ilsCntNote(){
  var o=document.getElementById('ils_Cnt_old'); if(!o) return;
  o.hidden=_ilsOldCnt==null;
  o.textContent=_ilsOldCnt==null ? '' : 'Saved value: "'+_ilsOldCnt+'" (kept until you change it)';
}
function _ilsCntVal(){
  if(_ilsOldCnt!=null) return _ilsOldCnt;
  var b=_ilsCntBtns().filter(function(x){ return x.getAttribute('aria-pressed')==='true'; })[0];
  if(b) return b.getAttribute('data-n');
  var el=_ilsEl('Cnt'), v=el ? String(el.value||'').trim() : '';
  return /^\d+$/.test(v) ? String(parseInt(v,10)) : '0';
}
function _ilsSetCnt(v){
  _ilsOldCnt=null;
  var el=_ilsEl('Cnt'); if(el) el.value='';
  v=String(v==null?'':v).trim();
  if(!v) _ilsSetCntBtn(0);
  // Leading number wins ("2 (prior)" -> 2); N/A / blank / any other text -> 0 (the default).
  var lead=v.match(/^(\d+)\b/);
  if(lead){ var n=parseInt(lead[1],10); if(n<=10) _ilsSetCntBtn(n); else { _ilsSetCntBtn(null); if(el) el.value=String(n); } }
  else _ilsSetCntBtn(0);
  _ilsCntNote();
}
function ilsPickCnt(n){
  _ilsOldCnt=null; _ilsSetCntBtn(n);
  var el=_ilsEl('Cnt'); if(el) el.value='';
  _ilsCntNote(); ilSimChanged();
}
function ilsCntInput(){
  _ilsOldCnt=null;
  var el=_ilsEl('Cnt'), typed=!!(el && (String(el.value)!=='' || (el.validity && el.validity.badInput)));
  _ilsSetCntBtn(typed ? null : 0);
  _ilsCntNote(); ilSimChanged();
}
// HI1..HIN rows (#ilsHiBox, directly below Res): one searchable Issue Types dropdown "ils_HI<n>"
// per Cnt (ilSimHiCount). _ilsHi keeps every value chosen this session, so a row hidden by a lower
// Cnt gets its value back when Cnt goes up again (reset when a log is loaded, ilSetSim).
var _ilsHi=[];
function _ilsHiSels(){ var b=document.getElementById('ilsHiBox'); return b ? _ilsSlice(b.querySelectorAll('select.ail-shi-sel')) : []; }
function _ilsHiCapture(){ _ilsHiSels().forEach(function(s,i){ _ilsHi[i]=_ilsSelVal(s).replace(/\s+/g,' ').trim(); }); }
// Add / remove rows to match Cnt (values from _ilsHi) and toggle the Cnt-over-9 warning.
// noCapture: _ilsHi was just set (load / Import) -> do not read the old rows back over it.
function _ilsSyncHi(noCapture){
  var box=document.getElementById('ilsHiBox'); if(!box) return;
  if(!noCapture) _ilsHiCapture();
  var c=ilSimHiCount(_ilsCntVal()), warn=document.getElementById('ils_HiWarn');
  var rows=_ilsSlice(box.querySelectorAll('.ail-scell-HI'));
  for(var r=rows.length-1;r>=c.n;r--) box.removeChild(rows[r]);
  for(var i=rows.length+1;i<=c.n;i++){
    var id='ils_HI'+i, row=document.createElement('div');
    row.className='ail-scell ail-scell-HI'; row.setAttribute('data-hi',String(i));
    row.innerHTML='<label class="ail-slabel" id="'+id+'_lbl" for="'+id+'">HI'+i+' <span class="ail-shint">(historical incident '+i+' issue type)</span></label>'+
      '<select id="'+id+'" class="ail-sctl ail-qinp ail-shi-sel" aria-required="true" onchange="ilsHiChanged(this)">'+_ilsIssueOptions()+'</select>';
    box.insertBefore(row,warn);
    var sel=row.querySelector('select'); sel.disabled=_ilsLocked;
    if(window.makeSearchableSelect){
      window.makeSearchableSelect(sel);
      var face=sel._ssField, val=face && face.querySelector('.ss-val');
      if(face && val){ val.id=id+'_val'; face.id=id+'_face'; face.setAttribute('aria-labelledby',id+'_lbl '+id+'_val'); face.setAttribute('aria-haspopup','listbox'); face.setAttribute('aria-required','true'); face.classList.add('ail-sctl'); face.disabled=_ilsLocked; }
      var lbl=document.getElementById(id+'_lbl'); if(lbl && face) lbl.setAttribute('for',id+'_face');
    }
  }
  var issues=_ilsIssues();
  _ilsHiSels().forEach(function(s,j){
    var v=String(_ilsHi[j]||'');
    if(_ilsSelVal(s)!==v) _ilsSetSelect(s, v, _ilsCanon(issues,v));
  });
  if(warn){ warn.hidden=!c.over; warn.textContent=c.over ? 'Cnt over '+IL_SIM_HI_MAX+' \u2014 only '+IL_SIM_HI_MAX+' historical incidents can be listed' : ''; }
}
// Copy an HIn issue type into Historical incident n's "Issue type" when that one is still empty
// (one-way: a type already set there is never overwritten).
function _ilsHiPrefill(i,v){
  if(!v) return;
  ilHistSync(); _ilhCapture();
  if(i>=_ilhShown || !_ilhRows[i] || String(_ilhRows[i].type||'').trim()) return;
  var el=_ilhEl(i,'type'); if(!el) return;
  if(!_ilsSlice(el.options).some(function(o){ return o.value===v; })){
    var o=document.createElement('option'); o.value=v; o.textContent=v+' (not in list)'; el.appendChild(o);
  }
  el.value=v; ilHistChanged(el);
}
function ilsHiChanged(sel){
  ilSimChanged();
  var i=_ilsHiSels().indexOf(sel);
  if(i>=0) _ilsHiPrefill(i, String(sel.value||''));
}
// Date: text input (stored MM/DD/YY) kept in sync with the calendar picker.
function _ilsDateSync(){
  var t=_ilsEl('Date'), pk=document.getElementById('ils_DatePick'); if(!t) return;
  var v=String(t.value||'').trim(), p=ilSimParseDate(v);
  if(pk) pk.value=_ilsIso(p);
  var h=document.getElementById('ils_Date_hint'); if(h) h.hidden=!(v && !p);
}
function ilsDateText(el,commit){
  if(commit && el){ var f=ilSimFmtDate(el.value); if(f) el.value=f; }
  _ilsDateSync(); ilSimChanged();
}
function ilsDatePick(el){
  var t=_ilsEl('Date'), v=String((el&&el.value)||'');
  if(t) t.value=v ? (ilSimFmtDate(v)||t.value) : '';
  _ilsDateSync(); ilSimChanged();
}
var IL_SIM_TEXT_KEYS=['SID','TID','Zip','CID','UPID','Date'];
function _ilsRead(){
  var f={};
  if(typeof document==='undefined') return f;
  var g=function(k){ var el=_ilsEl(k); return el ? String(el.value||'').replace(/\s+/g,' ').trim() : ''; };
  IL_SIM_TEXT_KEYS.forEach(function(k){ f[k]=g(k); });
  ['Issue','Res'].forEach(function(k){ f[k]=_ilsSelVal(_ilsEl(k)).replace(/\s+/g,' ').trim(); });
  f.Driv=_ilsDrivVal(); f.Cnt=_ilsCntVal();
  _ilsHiCapture(); f.HI=_ilsHi.slice();   // ilSerializeSim writes only the rows Cnt shows
  return f;
}
// Getter: the field text ('' while nothing is filled -> saved as "-").
function ilGetSim(){
  if(typeof document==='undefined' || !document.getElementById('ilSimForm')) return '';
  return ilSerializeSim(_ilsRead(), _ilsExtra);
}
// Put values into the controls (only the keys present in `fields`).
function _ilsApply(fields,listed){
  var has=function(k){ return Object.prototype.hasOwnProperty.call(fields,k); };
  listed=listed||{};
  _ilsHiCapture();   // keep the HI rows' current choices before Cnt / rows change
  if(has('Issue')) _ilsSetSelect(_ilsEl('Issue'), fields.Issue, listed.Issue);
  if(has('Res')) _ilsSetSelect(_ilsEl('Res'), fields.Res, listed.Res);
  IL_SIM_TEXT_KEYS.forEach(function(k){ var el=_ilsEl(k); if(el && has(k)) el.value=String(fields[k]==null?'':fields[k]); });
  if(has('Driv')) _ilsSetDriv(fields.Driv);
  if(has('Cnt')) _ilsSetCnt(fields.Cnt);
  if(has('HI')) (fields.HI||[]).forEach(function(v,i){ if(v) _ilsHi[i]=String(v); });   // only chosen ones
  _ilsSyncHi(true);
  _ilsDateSync();
}
// Setter: load the saved field text ('' = a new log: all empty, Driv none, Cnt 0).
function ilSetSim(text){
  if(typeof document==='undefined' || !document.getElementById('ilSimForm')) return;
  ilSimLoadResolutions();
  var L=_ilsLists(), p=ilParseSim(text,{issues:L.issues, res:L.res});
  _ilsExtra=p.extra.slice();
  // New log / entry: forget the previous HI choices and rows.
  _ilsHi=[]; _ilsSlice(document.querySelectorAll('#ilsHiBox .ail-scell-HI')).forEach(function(r){ r.parentNode.removeChild(r); });
  _ilsApply(p.fields, p.listed);
  var ex=document.getElementById('ilsExtra'), wrap=document.getElementById('ilsExtraWrap');
  if(ex) ex.textContent=_ilsExtra.join('\n');
  if(wrap) wrap.hidden=!_ilsExtra.length;
  var st=document.getElementById('ilsStatus'); if(st){ st.textContent=''; st.hidden=true; }
  _ilsMarkRows();
  if(document.getElementById('ilPhdInvestigation')) _ilqSyncVisibility();   // Driv: Flex DP hides questions
}
// Any SIM control changed: Historical Incidents rows (Cnt), Empty marker / copy state, Flex DP questions.
// Highlight each filled row (same look as a changed PHD Investigation row). Cnt counts above 0.
function _ilsMarkRows(){
  if(typeof document==='undefined') return;
  var f=_ilsRead();
  IL_SIM_FIELDS.forEach(function(x){
    var cell=document.querySelector('#ilSimForm .ail-scell-'+x.key); if(!cell) return;
    var v=String(f[x.key]==null?'':f[x.key]).trim();
    cell.classList.toggle('is-changed', x.key==='Cnt' ? (v!=='' && v!=='0') : !!v);
  });
  _ilsHiSels().forEach(function(s){ var cell=s.closest('.ail-scell'); if(cell) cell.classList.toggle('is-changed', !!String(s.value||'')); });
}
function ilSimChanged(){
  _ilsSyncHi();
  _ilsMarkRows();
  ilHistSync();
  ilMarkEmpty(document.getElementById('ilSimRcd'));
  if(document.getElementById('ilPhdInvestigation')) _ilqSyncVisibility();
}
function _ilsSetLocked(locked){
  _ilsLocked=!!locked;
  var box=document.getElementById('ilSimForm'); if(!box) return;
  box.classList.toggle('is-locked',_ilsLocked);
  _ilsSlice(box.querySelectorAll('.ail-sctl')).forEach(function(el){ el.disabled=_ilsLocked; });
  [_ilsEl('Issue')].concat(_ilsHiSels()).forEach(function(s){ if(s && s._ssWrap && window.makeSearchableSelect) window.makeSearchableSelect(s); });
}
// First focusable SIM control (the Issue combobox face when searchable).
function _ilsFirstCtl(){ var s=_ilsEl('Issue'); return s ? ((s._ssWrap && s._ssWrap.querySelector('.ss-field')) || s) : null; }
// Control to jump to for a copy-check miss on the SIM field: Res for the PHD Resolution miss,
// otherwise the first empty field.
function _ilsMissTarget(m){
  if(m && /Res:/.test(m.label||'')) return _ilsEl('Res');
  var f=_ilsRead();
  for(var i=0;i<IL_SIM_FIELDS.length;i++){
    var k=IL_SIM_FIELDS[i].key; if(k==='Cnt' || f[k]) continue;
    return k==='Driv' ? _ilsDrivRadios()[0] : _ilsEl(k);
  }
  return _ilsEl('Issue');
}
// Make #ilSimRcd's value a live view of the form (see above) and make the Issue list searchable.
function _ilsInstall(){
  var ta=document.getElementById('ilSimRcd'); if(!ta || ta._ilsProxy) return;
  ta._ilsProxy=true;
  Object.defineProperty(ta,'value',{configurable:true, get:function(){ return ilGetSim(); }, set:function(v){ ilSetSim(v); }});
  var is=_ilsEl('Issue');
  if(is && window.makeSearchableSelect){
    window.makeSearchableSelect(is);
    var face=is._ssField, val=face && face.querySelector('.ss-val');
    if(face && val){ val.id='ils_Issue_val'; face.id='ils_Issue_face'; face.setAttribute('aria-labelledby','ils_Issue_lbl ils_Issue_val'); face.setAttribute('aria-haspopup','listbox'); face.classList.add('ail-sctl'); }
    var lbl=document.getElementById('ils_Issue_lbl'); if(lbl && face) lbl.setAttribute('for','ils_Issue_face');
  }
  ilSetSim('');
}
// ---- Import pop-up (same dialog style as "Some fields are empty") ----
var _ilsiOpener=null;
function _ilsiBuild(){
  var bg=document.getElementById('ilSimImport'); if(bg) return bg;
  bg=document.createElement('div'); bg.id='ilSimImport'; bg.className='ilc-bg'; bg.hidden=true;
  bg.innerHTML='<div class="ilc-dlg ils-dlg" role="dialog" aria-modal="true" aria-labelledby="ilSimImportTitle" aria-describedby="ilSimImportHint">'+
      '<h3 class="ilc-title" id="ilSimImportTitle">Import SIM Root Cause Details</h3>'+
      '<div class="ilc-body">'+
        '<label class="ils-lbl" for="ilSimImportText">Paste SIM Root Cause Details</label>'+
        '<textarea id="ilSimImportText" class="ils-ta" rows="12" spellcheck="false" placeholder="Issue: \u2026&#10;SID: \u2026&#10;Driv: \u2026&#10;Date: \u2026&#10;TID: \u2026&#10;Zip: \u2026&#10;Cnt: \u2026&#10;CID: \u2026&#10;UPID: \u2026&#10;Res: \u2026"></textarea>'+
        '<p class="ils-hint" id="ilSimImportHint">Only fields with a matching value are filled; the others stay as they are.</p>'+
        '<p class="ils-err" id="ilSimImportErr" role="alert" hidden></p>'+
      '</div>'+
      '<div class="ilc-actions">'+
        '<button type="button" class="ilc-btn sec" id="ilSimImportCancel">Cancel</button>'+
        '<button type="button" class="ilc-btn go" id="ilSimImportGo">Import</button>'+
      '</div>'+
    '</div>';
  (document.getElementById('incidentModal')||document.body).appendChild(bg);
  document.getElementById('ilSimImportCancel').addEventListener('click',function(){ ilSimImportClose(false); });
  document.getElementById('ilSimImportGo').addEventListener('click',function(){ ilSimImportClose(true); });
  bg.addEventListener('click',function(e){ e.stopPropagation(); if(e.target===bg) ilSimImportClose(false); });
  window.addEventListener('keydown',_ilsiKeydown,true);
  return bg;
}
function _ilsiOpen(){ var bg=document.getElementById('ilSimImport'); return !!(bg && !bg.hidden); }
function _ilsiKeydown(e){
  if(!_ilsiOpen()) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); ilSimImportClose(false); return; }
  if(e.key!=='Tab') return;
  e.stopPropagation();
  var dlg=document.querySelector('#ilSimImport .ilc-dlg');
  var f=_ilsSlice(dlg.querySelectorAll('textarea,button')).filter(function(el){ return !el.disabled && el.offsetParent!==null; });
  if(!f.length){ e.preventDefault(); return; }
  var first=f[0], last=f[f.length-1], a=document.activeElement;
  if(!dlg.contains(a)){ e.preventDefault(); first.focus(); }
  else if(e.shiftKey && a===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && a===last){ e.preventDefault(); first.focus(); }
}
function ilSimImportOpen(btn){
  var bg=_ilsiBuild();
  _ilsiOpener=btn||document.activeElement;
  var ta=document.getElementById('ilSimImportText'); ta.value='';
  var er=document.getElementById('ilSimImportErr'); er.hidden=true; er.textContent='';
  bg.hidden=false;
  try{ ta.focus(); }catch(e){}
}
// apply=true parses the pasted text into the form (unlocking the field first when it is locked).
function ilSimImportClose(apply){
  var bg=document.getElementById('ilSimImport'); if(!bg || bg.hidden) return;
  if(apply){
    var ta=document.getElementById('ilSimImportText'), er=document.getElementById('ilSimImportErr');
    var txt=String(ta.value||'');
    var r=txt.trim() ? ilSimImport(txt,_ilsLists()) : null;
    if(!r || (!r.filled.length && !r.notMatched.length)){
      er.textContent=txt.trim() ? 'No SIM Root Cause Details fields found in the pasted text.' : 'Paste the SIM Root Cause Details first.';
      er.hidden=false; try{ ta.focus(); }catch(e){} return;
    }
    bg.hidden=true;
    if(_ilsLocked){ var pen=document.querySelector('.ail-fedit[data-for="ilSimRcd"]'); if(pen) ilEditField(pen); }
    _ilsApply(r.fields);
    ilSimChanged();
    (r.fields.HI||[]).forEach(function(v,i){ var s=_ilsHiSels()[i]; if(v && s) _ilsHiPrefill(i, String(s.value||'')); });
    // Import summary line under the form: shown for 5 seconds, then hidden.
    var st=document.getElementById('ilsStatus');
    if(st){
      st.textContent=r.summary; st.hidden=false;
      clearTimeout(st._ilsHide);
      st._ilsHide=setTimeout(function(){ st.hidden=true; st.textContent=''; },5000);
    }
    _ileToast(r.summary);
  } else bg.hidden=true;
  var op=_ilsiOpener; _ilsiOpener=null;
  if(op && op.focus) try{ op.focus(); }catch(e){}
}

// ---- Whole-log Import pop-up (modal header button; same dialog style as the SIM Import) ----
var _ilfiOpener=null;
function _ilfiBuild(){
  var bg=document.getElementById('ilLogImport'); if(bg) return bg;
  bg=document.createElement('div'); bg.id='ilLogImport'; bg.className='ilc-bg'; bg.hidden=true;
  bg.innerHTML='<div class="ilc-dlg ils-dlg" role="dialog" aria-modal="true" aria-labelledby="ilLogImportTitle" aria-describedby="ilLogImportHint">'+
      '<h3 class="ilc-title" id="ilLogImportTitle">Import incident log</h3>'+
      '<div class="ilc-body">'+
        '<label class="ils-lbl" for="ilLogImportText">Paste the full incident log</label>'+
        '<textarea id="ilLogImportText" class="ils-ta" rows="14" spellcheck="false" placeholder="**Determination:**&#10;- \u2026&#10;**PHD Findings:**&#10;- \u2026&#10;**Root Cause:**&#10;- \u2026&#10;**SIM Root Cause Details:**&#10;- Issue: \u2026"></textarea>'+
        '<p class="ils-hint" id="ilLogImportHint">SIM Root Cause Details, Root Cause, PHD Findings and matching checklist answers fill their fields; everything else goes to PHD Notes.</p>'+
        '<label class="ilfi-rep" id="ilLogImportRepWrap" hidden><input type="checkbox" id="ilLogImportRep" checked> Replace existing PHD Notes</label>'+
        '<p class="ils-err" id="ilLogImportErr" role="alert" hidden></p>'+
      '</div>'+
      '<div class="ilc-actions">'+
        '<button type="button" class="ilc-btn sec" id="ilLogImportCancel">Cancel</button>'+
        '<button type="button" class="ilc-btn go" id="ilLogImportGo">Import</button>'+
      '</div>'+
    '</div>';
  (document.getElementById('incidentModal')||document.body).appendChild(bg);
  document.getElementById('ilLogImportCancel').addEventListener('click',function(){ ilLogImportClose(false); });
  document.getElementById('ilLogImportGo').addEventListener('click',function(){ ilLogImportClose(true); });
  bg.addEventListener('click',function(e){ e.stopPropagation(); if(e.target===bg) ilLogImportClose(false); });
  window.addEventListener('keydown',_ilfiKeydown,true);
  return bg;
}
function _ilfiOpen(){ var bg=document.getElementById('ilLogImport'); return !!(bg && !bg.hidden); }
function _ilfiKeydown(e){
  if(!_ilfiOpen()) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); ilLogImportClose(false); return; }
  if(e.key!=='Tab') return;
  e.stopPropagation();
  var dlg=document.querySelector('#ilLogImport .ilc-dlg');
  var f=_ilsSlice(dlg.querySelectorAll('textarea,input,button')).filter(function(el){ return !el.disabled && el.offsetParent!==null; });
  if(!f.length){ e.preventDefault(); return; }
  var first=f[0], last=f[f.length-1], a=document.activeElement;
  if(!dlg.contains(a)){ e.preventDefault(); first.focus(); }
  else if(e.shiftKey && a===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && a===last){ e.preventDefault(); first.focus(); }
}
function ilLogImportOpen(btn){
  var bg=_ilfiBuild();
  _ilfiOpener=btn||document.activeElement;
  var ta=document.getElementById('ilLogImportText'); ta.value='';
  var er=document.getElementById('ilLogImportErr'); er.hidden=true; er.textContent='';
  var notes=document.getElementById('ilPhdNotes');
  document.getElementById('ilLogImportRepWrap').hidden=!(notes && String(notes.value||'').trim());
  document.getElementById('ilLogImportRep').checked=true;
  bg.hidden=false;
  try{ ta.focus(); }catch(e){}
}
// Unlock a locked field before writing into it (same as clicking its pencil, without moving focus).
function _ilfiUnlock(id){
  var el=document.getElementById(id); if(!el) return;
  var pen=document.querySelector('.ail-fedit[data-for="'+id+'"]'), was;
  if(id==='ilPhdInvestigation'){ was=el.classList.contains('is-locked'); _ilqSetLocked(false); }
  else if(id==='ilSimRcd'){ was=_ilsLocked || el.readOnly; el.readOnly=false; _ilhSetLocked(false); _ilsSetLocked(false); }
  else { was=el.readOnly; el.readOnly=false; }
  if(was && pen) pen.classList.add('editing');
}
// apply=true parses the pasted log into the form fields (nothing is saved).
function ilLogImportClose(apply){
  var bg=document.getElementById('ilLogImport'); if(!bg || bg.hidden) return;
  if(apply){
    var ta=document.getElementById('ilLogImportText'), er=document.getElementById('ilLogImportErr');
    var txt=String(ta.value||''), L=_ilsLists();
    var r=txt.trim() ? ilParseFullLog(txt,{rootCauses:window.RC_ROOT_CAUSES||[], issues:L.issues, res:L.res}) : null;
    if(!r || !r.known){
      er.textContent=txt.trim() ? 'No incident log sections found in the pasted text.' : 'Paste the full incident log first.';
      er.hidden=false; try{ ta.focus(); }catch(e){} return;
    }
    var repWrap=document.getElementById('ilLogImportRepWrap'), replace=repWrap.hidden || document.getElementById('ilLogImportRep').checked;
    bg.hidden=true;
    // SIM Root Cause Details (first: Driv: Flex DP hides questions below).
    if(r.sim && document.getElementById('ilSimForm')){
      _ilfiUnlock('ilSimRcd');
      _ilsApply(r.sim.fields);
      ilSimChanged();
      (r.sim.fields.HI||[]).forEach(function(v,i){ var s=_ilsHiSels()[i]; if(v && s) _ilsHiPrefill(i, String(s.value||'')); });
    }
    // Root Cause: exact match only; otherwise left as it is.
    var rc=document.getElementById('ilRootCause');
    if(rc && r.rootCause.value){ rc.value=r.rootCause.value; ilRefreshSelectUI(); }
    // Severity: found in the text -> selected; not found -> a severity already chosen (title / user)
    // stays, otherwise the row is left empty with the amber "Select a severity" mark.
    if(r.severity) ilSetSeverity(r.severity);
    else if(!ilGetSeverity()) ilSetSeverity('',{need:true});
    var put=function(id,v,append){
      var el=document.getElementById(id); if(!el) return;
      _ilfiUnlock(id);
      var cur=String(el.value||'').trim();
      el.value=(append && cur) ? cur+'\n\n'+v : v;
      ilAutosize(el);
    };
    if(r.findings) put('ilPhdFindings', r.findings, false);
    // Questionnaire: write each mapped answer straight into its control — also for questions that
    // are hidden right now (POI / region / Flex DP / pet rules; hidden ones are still left out of the
    // saved / copied text) — and mark it decided (no DEFAULT tag).
    var n=0, keys=Object.keys(r.invest);
    if(keys.length && document.getElementById('ilPhdInvestigation')){
      var defs={};
      _ilqAllDefs().forEach(function(d){ defs[d.key]=d; });
      _ilfiUnlock('ilPhdInvestigation');
      keys.forEach(function(k){
        var d=defs[k]; if(!d) return;
        delete _ilqOld[k];
        _ilqSetControl(d, r.invest[k]);
        _ilqDecided[k]=true; n++;
      });
      ilInvestChanged();
    }
    if(r.notes) put('ilPhdNotes', r.notes, !replace);
    ilRefreshEmptyMarks();
    var summary=ilFullLogSummary(r,n);
    // Import summary line at the top of the form: shown for 5 seconds, then hidden.
    var st=document.getElementById('ilLogImportStatus');
    if(st){
      st.textContent=summary; st.hidden=false;
      clearTimeout(st._ilfHide);
      st._ilfHide=setTimeout(function(){ st.hidden=true; st.textContent=''; },5000);
    }
    _ileToast(summary);
  } else bg.hidden=true;
  var op=_ilfiOpener; _ilfiOpener=null;
  if(op && op.focus) try{ op.focus(); }catch(e){}
}

// ---- DOM helpers (fixed element ids from the shared markup) ----
var IL_FIELD_IDS=['ilRootCause','ilSimRcd','ilPhdInvestigation','ilPhdFindings','ilPhdNotes'];
var IL_TICKET_SID='';  // the ticket ShortId the modal is currently open for (for the title copy icon)

// ---- Questionnaire DOM: container #ilPhdInvestigation, one control per question (id "ilq_<key>") ----
var _ilqUnknown=[];   // saved lines that matched no question; shown read-only and re-appended on save
var _ilqKept={};      // non-US/CA ticket: saved US/CA-only answer lines, re-written unchanged on Save (not copied)
function _ilqEl(key){ return document.getElementById('ilq_'+key); }
// flex = the SIM Root Cause Details in the form currently says "Driv: Flex DP".
function _ilFlexNow(){ var el=document.getElementById('ilSimRcd'); return !!(el && ilIsFlexDriv(el.value)); }
// pet = the form's SIM "Issue:" (else the ticket title) is a pet incident (ilIsPetIncident).
function _ilPetNow(){ var el=document.getElementById('ilSimRcd'); return ilIsPetIncident(ilSimIssue(el?el.value:''), IL_TICKET_TITLE); }
function _ilqRO(forSave){ return {usca:_ilUsca, flex:_ilFlexNow(), pet:_ilPetNow(), kept:forSave?_ilqKept:null}; }
// Every control definition in DOM order (questions, the POI free-text, sub-questions).
function _ilqAllDefs(){
  var d=[]; IL_INVEST_QS.forEach(function(q){ d.push(q); if(q.poiWho) d.push(q.poiWho); if(q.sub) d.push(q.sub); }); return d;
}
// Every question row starts with a checkbox (id "ilqc_<key>"); the saved / copied answer per kind:
//   yn    (Yes/No questions + the diUpd sub-question): checked = "Yes", unchecked = "No" (Yes/No tag)
//   num   unchecked = "0" ("0" tag); checked -> buttons 0..10 ("0" pressed by default) or the "Other"
//         input (id "ilq_<key>", whole number >= 0); an invalid typed value = "" (copy check flags it)
//   cbsel (CLEAR history, Is POI the CX) unchecked = "No" ("No" tag; POI also shows the optional
//         "Who is the POI?" row); checked -> dropdown (id "ilq_<key>") of the other options
//   check (GeoStudio POD) checked = "Yes", unchecked = "" (no line)
//   text  sub-fields (station link, Netradyne review, Who is the POI?): plain control "ilq_<key>"
// The answer text / pure model (ilSerializeInvestigation etc.) is unchanged.
var _ilqOld={};   // saved answers the controls cannot show (old free text) -> kept as-is until that row changes
var _ilqDecided={};   // keys changed by the user / set by an import / answered in the saved entry (no DEFAULT tag)
function _ilqHasOld(k){ return Object.prototype.hasOwnProperty.call(_ilqOld,k); }
function _ilqKind(d){
  if(d.type==='number') return 'num';
  if(d.type==='check') return 'check';
  if(d.type==='select' && d.direct) return 'dsel';   // plain dropdown, no row checkbox (Is POI the CX)
  if(d.type==='select') return (d.opts.length===2 && d.opts.indexOf('Yes')>=0 && d.opts.indexOf('No')>=0) ? 'yn' : 'cbsel';
  return 'text';
}
function _ilqCb(key){ return document.getElementById('ilqc_'+key); }
function _ilqNumBtns(key){ var g=document.getElementById('ilqg_'+key); return g?Array.prototype.slice.call(g.querySelectorAll('.ail-qnb')):[]; }
// Number chosen on a 'num' row: the pressed button, else a whole number >= 0 typed in "Other"; '' = none.
function _ilqNumVal(key){
  var b=_ilqNumBtns(key).filter(function(x){ return x.getAttribute('aria-pressed')==='true'; })[0];
  if(b) return b.getAttribute('data-n');
  var el=_ilqEl(key), v=el?String(el.value||'').trim():'';
  return /^\d+$/.test(v) ? String(+v) : '';
}
// True if the "Other" input of a 'num' row holds something (incl. text the browser rejects).
function _ilqNumTyped(key){ var el=_ilqEl(key); return !!(el && (String(el.value)!=='' || (el.validity && el.validity.badInput))); }
// Press button n (null = clear the buttons).
function _ilqSetNumBtn(key,n){
  _ilqNumBtns(key).forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-n')===String(n)?'true':'false'); });
}
function _ilqReadAnswers(){
  var a={};
  _ilqAllDefs().forEach(function(d){
    var k=d.key, kind=_ilqKind(d), cb=_ilqCb(k), el=_ilqEl(k);
    if(_ilqHasOld(k)){ a[k]=_ilqOld[k]; return; }
    if(kind==='text'||kind==='dsel'){ a[k]=el?String(el.value||'').trim():''; return; }
    if(!cb){ a[k]=''; return; }
    if(kind==='check') a[k]=cb.checked?'Yes':'';
    else if(kind==='yn') a[k]=cb.checked?'Yes':'No';
    else if(kind==='num') a[k]=cb.checked?_ilqNumVal(k):'0';
    else a[k]=cb.checked?(el?String(el.value||'').trim():''):'No';   // cbsel
  });
  return a;
}
// Row checkbox changed: drop a kept old answer for that row. A ticked number row with nothing
// chosen gets the default "0" so it always has a value.
function ilqToggle(key){
  delete _ilqOld[key];
  _ilqDecided[key]=true;
  var cb=_ilqCb(key);
  if(cb && cb.checked && _ilqNumBtns(key).length && _ilqNumVal(key)==='' && !_ilqNumTyped(key)) _ilqSetNumBtn(key,0);
  ilInvestChanged();
}
// Number button clicked: press it (only one pressed), clear the "Other" input.
function ilqPickNum(key,n){
  delete _ilqOld[key];
  _ilqDecided[key]=true;
  _ilqSetNumBtn(key,n);
  var el=_ilqEl(key); if(el) el.value='';
  ilInvestChanged();
}
// Typing in "Other" clears the button selection (only one of the two is ever set); clearing the
// input again falls back to the default "0" button.
function ilqNumInput(key){
  delete _ilqOld[key];
  _ilqDecided[key]=true;
  _ilqSetNumBtn(key, _ilqNumTyped(key) ? null : 0);
  ilInvestChanged();
}
// Getter: the serialized section body ('' when nothing is answered -> saved as "-").
// forSave=true also writes back the kept US/CA-only lines of a non-US/CA ticket (see _ilqKept).
function ilGetInvestigation(forSave){
  if(typeof document==='undefined' || !document.getElementById('ilPhdInvestigation')) return '';
  return ilSerializeInvestigation(_ilqReadAnswers(), _ilqUnknown, _ilqRO(!!forSave));
}
// Setter: load a saved section body (or '' to reset) into the questionnaire controls.
// Call ilSetTicketRegion first: on a non-US/CA ticket the saved US/CA-only answers are not loaded
// into the (hidden) controls — their original lines are kept in _ilqKept for Save.
function ilSetInvestigation(text){
  var p=ilParseInvestigation(text);
  _ilqDecided=ilInvestDecidedFromSaved(p);   // a saved entry's answers count as decided (no DEFAULT tag)
  _ilqUnknown=p.unknown.slice();
  _ilqKept={};
  if(!_ilUsca){
    _ilqKept=ilRegionKeptLines(p);
    IL_INVEST_QS.forEach(function(q){ if(q.usCa){ delete p.answers[q.key]; if(q.sub) delete p.answers[q.sub.key]; } });
  }
  _ilqOld={};
  _ilqAllDefs().forEach(function(d){ _ilqSetControl(d, p.answers[d.key]); });
  var ex=document.getElementById('ilqExtra'), wrap=document.getElementById('ilqExtraWrap');
  if(ex) ex.textContent=_ilqUnknown.join('\n');
  if(wrap) wrap.hidden=!_ilqUnknown.length;
  _ilqSyncVisibility();
  ilMarkEmpty(document.getElementById('ilPhdInvestigation'));
}
// Put one answer (saved-text form: "Yes" / "No" / "3" / option / text; null = blank) into the
// control(s) of definition d. An answer the control cannot show is kept in _ilqOld.
function _ilqSetControl(d,val){
  (function(){
    var k=d.key, kind=_ilqKind(d), cb=_ilqCb(k), el=_ilqEl(k);
    var v=val==null?'':String(val);
    if(kind==='text'){
      if(!el) return;
      // Single-line inputs strip "\n" (gluing words together) — join continuation lines with a space.
      if(el.tagName==='INPUT') v=v.replace(/[ \t]*\n\s*/g,' ');
      el.value=v; return;
    }
    if(kind==='dsel'){
      // Is POI the CX: blank (new log) -> "Yes"; a saved answer not in the list is kept as "(old)".
      if(!el) return;
      Array.prototype.slice.call(el.querySelectorAll('option[data-old]')).forEach(function(o){ o.parentNode.removeChild(o); });
      v=v.trim(); if(!v){ el.value='Yes'; return; }
      if(!Array.prototype.some.call(el.options,function(o){ return o.value===v; })){
        var od=document.createElement('option'); od.value=v; od.textContent=v+' (old)'; od.setAttribute('data-old','1'); el.appendChild(od);
      }
      el.value=v; return;
    }
    if(!cb) return;
    v=v.trim(); cb.checked=false;
    var keep=function(){ _ilqOld[k]=v; var o=document.getElementById('ilqo_'+k); if(o) o.textContent='Saved answer: "'+v.replace(/\s*\n\s*/g,' ')+'" (kept until you change this row)'; };
    if(kind==='check'){ cb.checked=(v==='Yes'); return; }
    if(kind==='yn'){ if(v==='Yes') cb.checked=true; else if(v && v!=='No') keep(); return; }
    if(kind==='num'){
      _ilqSetNumBtn(k,0); if(el) el.value='';   // default "0" (shown once the row is ticked)
      if(/^\d+$/.test(v)){ var n=parseInt(v,10); if(n>0){ cb.checked=true; if(n<=10) _ilqSetNumBtn(k,n); else { _ilqSetNumBtn(k,null); if(el) el.value=String(n); } } }
      else if(v) keep();
      return;
    }
    // cbsel (CLEAR, POI): "No" / blank -> unchecked; another answer -> checked + that option
    // ("(old)" when not listed). Unchecked rows reset to the first option (POI: "Yes").
    if(!el) return;
    Array.prototype.slice.call(el.querySelectorAll('option[data-old]')).forEach(function(o){ o.parentNode.removeChild(o); });
    if(!v || v==='No'){ el.selectedIndex=0; return; }
    cb.checked=true;
    if(!Array.prototype.some.call(el.options,function(o){ return o.value===v; })){
      var o=document.createElement('option'); o.value=v; o.textContent=v+' (old)'; o.setAttribute('data-old','1'); el.appendChild(o);
    }
    el.value=v;
  })();
}
// Show / hide the conditional rows from the current parent answers.
function _ilqSyncVisibility(){
  var a=_ilqReadAnswers();
  var ro=_ilqRO(false);
  IL_INVEST_QS.forEach(function(q){
    var row, off=_ilqPoiHidden(q,a) || _ilqRegionHidden(q,ro);
    if(IL_POI_CM_HIDE.indexOf(q.key)>=0 || q.usCa || q.noFlex || q.petOnly){ row=document.querySelector('[data-ilq-row="'+q.key+'"]'); if(row) row.hidden=off; }
    if(q.poiWho){ row=document.querySelector('[data-ilq-row="'+q.poiWho.key+'"]'); if(row) row.hidden=(a[q.key]!=='No'); }
    if(q.sub){ row=document.querySelector('[data-ilq-row="'+q.sub.key+'"]'); if(row) row.hidden=off || !_ilqSubShown(q,a); }
  });
  // Controls revealed by the row checkbox, the state tag (Yes/No rows: "Yes" / "No"; dropdown rows:
  // "No" and number rows: "0" while unchecked) and old-answer notes.
  _ilqAllDefs().forEach(function(d){
    var k=d.key, kind=_ilqKind(d), cb=_ilqCb(k); if(!cb) return;
    var old=_ilqHasOld(k), rev=document.getElementById('ilqv_'+k), note=document.getElementById('ilqo_'+k), st=document.getElementById('ilqs_'+k);
    if(rev) rev.hidden=old || !cb.checked;
    if(note) note.hidden=!old;
    if(st){
      if(kind==='yn'||kind==='check'){ st.hidden=old; st.textContent=cb.checked?'Yes':'No'; st.classList.toggle('is-yes',cb.checked); }
      else st.hidden=old || cb.checked;
    }
  });
  // "Changed from the default" highlight: Yes on a Yes/No or POD row, a number above 0, any CLEAR answer
  // other than No, and an "Is POI the CX" answer other than the default Yes.
  _ilqAllDefs().forEach(function(d){
    var k=d.key, kind=_ilqKind(d), row=document.querySelector('[data-ilq-row="'+k+'"]'); if(!row) return;
    var v=String(a[k]==null?'':a[k]).trim(), on=false;
    if(kind==='yn'||kind==='check') on=(v==='Yes');
    else if(kind==='num') on=/^\d+$/.test(v) && +v>0;
    else if(kind==='cbsel') on=!!v && v!=='No';
    else if(kind==='dsel') on=!!v && v!=='Yes';
    row.classList.toggle('is-changed', on && !row.hidden);
  });
  _ilqSyncDefaults(a,ro);
}
// "DEFAULT" tag (left of the control) on every shown question still at its untouched default
// (ilInvestDefaultKeys) + the row's amber .is-default mark, plus the hint pill in the field header
// (#ilqDefHint) while any tag is shown.
function _ilqSyncDefaults(a,ro){
  var keys=ilInvestDefaultKeys(_ilqDecided, a, ro), any=false;
  _ilqAllDefs().forEach(function(d){
    var tag=document.getElementById('ilqd_'+d.key); if(!tag) return;
    var on=keys.indexOf(d.key)>=0 && !_ilqHasOld(d.key), ctl=_ilqCb(d.key)||_ilqEl(d.key);
    tag.hidden=!on;
    var row=document.querySelector('[data-ilq-row="'+d.key+'"]');
    if(row) row.classList.toggle('is-default', on && !row.classList.contains('is-changed'));
    if(ctl){ if(on) ctl.setAttribute('aria-describedby','ilqds_'+d.key); else if(ctl.getAttribute('aria-describedby')==='ilqds_'+d.key) ctl.removeAttribute('aria-describedby'); }
    if(on) any=true;
  });
  var h=document.getElementById('ilqDefHint'); if(h) h.hidden=!any;
}
// aria-invalid / visual state per control + the "n questions need an answer" status line.
function _ilqUpdateValidity(){
  if(!document.getElementById('ilPhdInvestigation')) return;
  var a=_ilqReadAnswers(), miss=ilInvestMissing(a, _ilqRO(false));
  _ilqAllDefs().forEach(function(d){
    var k=d.key, el=_ilqEl(k); if(!el) return;
    var bad=miss.indexOf(k)>=0;
    if(bad) el.setAttribute('aria-invalid','true'); else el.removeAttribute('aria-invalid');
    if(_ilqKind(d)==='num'){
      // A ticked row always has a number (default "0"); only an invalid "Other" value is flagged.
      var cb=_ilqCb(k), on=!!(cb && cb.checked && !_ilqHasOld(k)), h=document.getElementById('ilqh_'+k);
      var badTyped=bad && on && _ilqNumTyped(k);
      if(h) h.hidden=!badTyped;
      el.classList.toggle('ail-qbad', badTyped);
      return;
    }
    el.classList.toggle('ail-qbad', bad && !!String(el.value||'').trim());   // red only for a wrong value, not a blank
  });
  // Only the "n questions need an answer" hint; nothing is shown once every question is answered.
  var st=document.getElementById('ilqStatus');
  if(st){
    var txt=miss.length ? (miss.length+(miss.length===1?' question needs':' questions need')+' an answer') : '';
    if(st.textContent!==txt) st.textContent=txt;
    st.hidden=!miss.length;
  }
}
// Any questionnaire control changed (key = the control's question -> no longer DEFAULT).
function ilInvestChanged(key){
  if(key) _ilqDecided[key]=true;
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
// Populate the Root Cause dropdown from the shared data file (once). (PHD Resolution is no longer a
// form field — it is taken from the SIM "Res:" line, see ilCurrentResolution.)
var _ilSelectsFilled=false;
function fillIncidentSelects(){
  ilSimLoadResolutions();   // SIM "Res" dropdown: the PHD Resolutions list (once per page, when signed in)
  if(_ilSelectsFilled) return; _ilSelectsFilled=true;
  var rc=document.getElementById('ilRootCause');
  if(rc){ var causes=window.RC_ROOT_CAUSES||[];
    rc.innerHTML='<option value="">— Select root cause —</option>'+causes.map(function(c){return '<option value="'+_ileEsc(c)+'">'+_ileEsc(c)+'</option>';}).join('');
    if(window.makeSearchableSelect) window.makeSearchableSelect(rc); }
}
// Resync the searchable Root Cause combobox (after its .value is set directly).
function ilRefreshSelectUI(){
  ['ilRootCause','ils_Issue'].forEach(function(id){ var el=document.getElementById(id); if(el && el._ssWrap && window.makeSearchableSelect) window.makeSearchableSelect(el); });
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
    res:ilCurrentResolution(), notes:g('ilPhdNotes')}, _ilqReadAnswers(), Object.assign({usca:_ilUsca, flex:ilIsFlexDriv(g('ilSimRcd')), pet:_ilPetNow()}, opts||{}));
}
// True when every field has a value (the questionnaire: every visible question answered).
function ilAllFilled(){ return ilCopyMissingNow().length===0; }
// Copy is blocked when the SIM Root Cause Details "Res:" line contains PENDING.
function ilSimResPending(){
  var el=document.getElementById('ilSimRcd'); if(!el) return false;
  var m=String(el.value||'').match(/^\s*Res\s*:\s*(.*)$/mi);
  return !!(m && /pending/i.test(m[1]));
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
  document.querySelectorAll('.ail-simimp').forEach(function(b){ if(!b.dataset.painted){ var ic=_ileIc('upload',14); if(ic){ b.innerHTML=ic+'<span class="ail-simimp-tx">Import</span>'; b.dataset.painted='1'; } } });
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
  if(el.id==='ilSimRcd'){   // SIM form: unlock its controls + the Historical Incidents rows, focus Issue
    _ilhSetLocked(false); _ilsSetLocked(false);
    var sf=_ilsFirstCtl(); if(sf) try{ sf.focus(); }catch(e){}
    return;
  }
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
    if(id==='ilSimRcd'){ _ilhSetLocked(el.readOnly); _ilsSetLocked(el.readOnly); }   // SIM form + Historical Incidents rows share the lock
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
// Fields whose own copy icon copies just the value, without the heading line. The SIM Root Cause
// Details heading is still written by the footer Copy (Copy w/o RC Details leaves the section out).
var IL_COPY_BARE={ilSimRcd:true};
// Text one field's copy icon puts on the clipboard (pure; exported for Node).
function ilFieldCopyText(id,val,label){
  if(IL_COPY_BARE[id]) return val;
  var fmt=IL_COPY_FMT[id]||{prefix:(label||'')+':', block:true};
  return fmt.block ? (fmt.prefix+'\n'+val) : (fmt.prefix+' '+val);
}
// Copy a single field using its canonical header format (only when it has content).
async function ilCopyField(btn){
  if(!btn) return;
  var id=btn.getAttribute('data-for');
  var val=_ilVal(id);
  if(!val){ _ileToast('Nothing to copy — field is empty'); return; }
  var label=btn.getAttribute('data-label')||'';
  var text=ilFieldCopyText(id,val,label);
  // The Historical Incidents rows sit under SIM in the form but are copied WITH PHD Findings (not SIM).
  if(id==='ilPhdFindings'){ var hist=ilGetHistorical(); if(hist) text+='\n\n'+IL_HIST_HEAD+'\n'+hist; }
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
  document.querySelectorAll('.ail-field textarea:not(.ail-qta):not(.ail-hta):not(.ail-simraw)').forEach(function(ta){
    ta.addEventListener('input',function(){ ilAutosize(ta); });
  });
}
// Size every textarea to its current content (used when the modal opens / fields are (re)filled).
function ilAutosizeAll(){
  document.querySelectorAll('.ail-field textarea:not(.ail-qta):not(.ail-hta):not(.ail-simraw)').forEach(ilAutosize);
  document.querySelectorAll('#ilHist textarea.ail-hta').forEach(_ilhGrow);   // brief fields: grow to content
}
// Copy the formatted incident log. Empty / invalid fields ask for confirmation first.
async function copyIncidentDraft(){
  var btn=document.getElementById('incidentCopyFooterBtn');
  if(ilSimResPending()){ _ileToast('Resolve the PENDING resolution before copying'); return; }
  var go=function(){ return _ilCopyText(buildIncidentOutput({copy:true}), btn, 'Copied'); };
  var check=function(){
    var miss=ilCopyMissingNow();
    if(miss.length){ ilCopyConfirm(miss, btn, go); return; }
    return go();
  };
  // No severity -> the "Select a severity" pop-up first; then the empty-fields check as before.
  if(!ilGetSeverity()){ ilSevConfirm(btn, check); return; }
  await check();
}
// Same as Copy, but omits the SIM Root Cause Details section (so SIM is not required).
async function copyIncidentNoRc(btn){
  btn=btn||document.getElementById('incidentCopyNoRcBtn');
  if(ilSimResPending()){ _ileToast('Resolve the PENDING resolution before copying'); return; }
  var go=function(){ return _ilCopyText(buildIncidentOutput({omitSim:true, copy:true}), btn, 'Copied (no RC)'); };
  var check=function(){
    var miss=ilCopyMissingNow({omitSim:true});
    if(miss.length){ ilCopyConfirm(miss, btn, go); return; }
    return go();
  };
  if(!ilGetSeverity()){ ilSevConfirm(btn, check); return; }
  await check();
}
// ---- "Select a severity" pop-up (footer copies with no severity chosen) ----
var _ilsvState=null;   // {opener, onGo} while open
function _ilsvBuild(){
  var bg=document.getElementById('ilSevConfirm'); if(bg) return bg;
  bg=document.createElement('div'); bg.id='ilSevConfirm'; bg.className='ilc-bg'; bg.hidden=true;
  bg.innerHTML='<div class="ilc-dlg ils-dlg" role="alertdialog" aria-modal="true" aria-labelledby="ilSevConfirmTitle" aria-describedby="ilSevConfirmDesc">'+
      '<h3 class="ilc-title" id="ilSevConfirmTitle">Select a severity</h3>'+
      '<div class="ilc-body"><p class="ilc-q" id="ilSevConfirmDesc">You should select a severity # before copying. If not, continue with the default Sev 5.</p></div>'+
      '<div class="ilc-actions">'+
        '<button type="button" class="ilc-btn sec" id="ilSevConfirmPick">Select severity</button>'+
        '<button type="button" class="ilc-btn go" id="ilSevConfirmGo">Continue with Sev 5</button>'+
      '</div>'+
    '</div>';
  (document.getElementById('incidentModal')||document.body).appendChild(bg);
  document.getElementById('ilSevConfirmPick').addEventListener('click',function(){ ilSevConfirmClose(false); });
  document.getElementById('ilSevConfirmGo').addEventListener('click',function(){ ilSevConfirmClose(true); });
  bg.addEventListener('click',function(e){ e.stopPropagation(); });   // never reach the editor's backdrop-close
  window.addEventListener('keydown',_ilsvKeydown,true);
  return bg;
}
function _ilsvKeydown(e){
  if(!_ilsvState) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); ilSevConfirmClose(null); return; }
  if(e.key!=='Tab') return;
  e.stopPropagation();
  var dlg=document.querySelector('#ilSevConfirm .ilc-dlg');
  var f=Array.prototype.filter.call(dlg.querySelectorAll('button'),function(el){ return !el.disabled && el.offsetParent!==null; });
  if(!f.length){ e.preventDefault(); return; }
  var first=f[0], last=f[f.length-1], a=document.activeElement;
  if(!dlg.contains(a)){ e.preventDefault(); first.focus(); }
  else if(e.shiftKey && a===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && a===last){ e.preventDefault(); first.focus(); }
}
// onGo runs after "Continue with Sev 5" (Severity set to 5 first).
function ilSevConfirm(opener,onGo){
  var bg=_ilsvBuild();
  _ilsvState={opener:opener||document.activeElement, onGo:onGo};
  bg.hidden=false;
  try{ document.getElementById('ilSevConfirmGo').focus(); }catch(e){}
}
// go=true: Sev 5 + copy; go=false ("Select severity"): jump to the Severity row, no copy;
// go=null (Esc): cancel, focus back to the opener.
function ilSevConfirmClose(go){
  var st=_ilsvState; if(!st) return;
  _ilsvState=null;
  var bg=document.getElementById('ilSevConfirm'); if(bg) bg.hidden=true;
  if(go){
    ilSetSeverity('5');
    if(st.opener && st.opener.focus) try{ st.opener.focus(); }catch(e){}
    Promise.resolve(st.onGo && st.onGo());
    return;
  }
  if(go===false){
    var fld=document.getElementById('ilSevField'), b=document.querySelector('#ilSevGroup .ail-qnb');
    if(fld){
      _ilSevNeed=true; _ilSevRender();
      try{ fld.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){ try{ fld.scrollIntoView(); }catch(_){} }
      fld.classList.add('ail-flash'); setTimeout(function(){ fld.classList.remove('ail-flash'); },1800);
      if(b) try{ b.focus({preventScroll:true}); return; }catch(e){}
    }
  }
  if(st.opener && st.opener.focus) try{ st.opener.focus(); }catch(e){}
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
  if(el.id==='ilSimRcd') el=_ilsMissTarget(m)||el;   // hidden text -> the SIM form control to fill
  var field=el.closest('.ail-field');
  if(el.classList.contains('ail-qctl') && el.disabled){   // locked questionnaire -> unlock it (pencil)
    var pen=document.querySelector('.ail-fedit[data-for="ilPhdInvestigation"]'); if(pen) ilEditField(pen);
  }
  var isHist=el.classList.contains('ail-hctl') || el.classList.contains('ail-sctl');
  if(isHist && el.disabled){   // locked Historical Incidents row -> unlock with the SIM pencil
    var spen=document.querySelector('.ail-fedit[data-for="ilSimRcd"]'); if(spen) ilEditField(spen);
  }
  ilMarkEmpty(el.classList.contains('ail-qctl') ? document.getElementById('ilPhdInvestigation') : (isHist ? document.getElementById('ilSimRcd') : el));
  var target=(el._ssWrap && el._ssWrap.querySelector('.ss-field')) || el;   // searchable select face
  var row=el.closest('.ail-qrow')||el.closest('.ail-hcell')||el.closest('.ail-scell')||field||target;
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

// ---- Read-only view of a saved entry (My Tickets "Incident log" pop-up + Unique Cases "Log updates") ----
// Pure string builders (no DOM). The saved text is never changed: these only turn the
// "**Heading**:" blob into labelled sections; Copy still copies the raw text.
var IL_VIEW_NP='<span class="ilv-np">Not provided</span>';
function _ilvBlank(v){ v=String(v==null?'':v).trim(); return !v || v==='-'; }
// Escaped HTML with http(s) URLs turned into new-tab links.
function _ilvLinkify(s){
  s=String(s==null?'':s);
  var out='', re=/https?:\/\/[^\s<>"']+/g, last=0, m;
  while((m=re.exec(s))){
    var url=m[0].replace(/[).,;:!?\]]+$/,'');
    out+=_ileEsc(s.slice(last,m.index))+'<a href="'+_ileEsc(url)+'" target="_blank" rel="noopener noreferrer">'+_ileEsc(url)+'</a>';
    last=m.index+url.length; re.lastIndex=last;
  }
  return out+_ileEsc(s.slice(last));
}
function _ilvText(v){ return _ilvBlank(v) ? IL_VIEW_NP : '<div class="ilv-txt">'+_ilvLinkify(String(v).trim())+'</div>'; }
// "- Question: Answer" lines (sub-questions indented 4, continuation lines indented 8) -> Q/A list.
function _ilvInvest(v){
  if(_ilvBlank(v)) return IL_VIEW_NP;
  var rows=[], cur=null;
  String(v).replace(/\r\n/g,'\n').split('\n').forEach(function(raw){
    if(!raw.trim()) return;
    var ind=_ilqIndentOf(raw);
    var m=raw.match(/^\s*[-*\u2022]\s*([^:]{1,160}?)\s*:[ \t]?(.*)$/);
    if(cur && (ind>=IL_INVEST_CONT_INDENT.length || !m)){ cur.a+=(cur.a?'\n':'')+raw.trim(); return; }
    if(m){ cur={q:m[1], a:m[2].trim(), sub:ind>=IL_INVEST_SUB_INDENT.length}; rows.push(cur); return; }
    rows.push({q:'', a:raw.trim(), sub:false});   // free text before the first question
  });
  return '<dl class="ilv-qa">'+rows.map(function(r){
    return '<div class="ilv-qa-row'+(r.sub?' is-sub':'')+(r.q?'':' is-free')+'">'+
      (r.q?'<dt>'+_ileEsc(r.q)+'</dt>':'')+'<dd>'+(_ilvBlank(r.a)?IL_VIEW_NP:_ilvLinkify(r.a))+'</dd></div>';
  }).join('')+'</dl>';
}
// SIM Root Cause Details "Key: value" lines -> compact key/value grid (monospace values).
function _ilvKv(v){
  if(_ilvBlank(v)) return IL_VIEW_NP;
  var h='';
  String(v).replace(/\r\n/g,'\n').split('\n').forEach(function(raw){
    var line=raw.trim(); if(!line) return;
    var m=line.match(/^([A-Za-z][\w .\/#&()-]{0,30}?)\s*:\s*(.*)$/);
    if(m && !/^https?$/i.test(m[1])) h+='<dt>'+_ileEsc(m[1])+'</dt><dd>'+(_ilvBlank(m[2])?IL_VIEW_NP:_ilvLinkify(m[2]))+'</dd>';
    else h+='<dd class="ilv-kv-full">'+_ilvLinkify(line)+'</dd>';
  });
  return '<dl class="ilv-kv">'+h+'</dl>';
}
function _ilvSec(label,body,cls){ return '<section class="ilv-sec'+(cls?' '+cls:'')+'"><h3 class="ilv-lbl">'+_ileEsc(label)+'</h3>'+body+'</section>'; }
var IL_VIEW_LABEL_RE=/\*\*\s*(PHD Findings|PHD Investigation for mitigation|SIM Root Cause Details|Root Cause|PHD Related Link|PHD Resolution|PHD notes)\s*:?\s*\*\*/i;
// Body of one entry. Structured blobs -> two columns (sections | SIM grid); anything else -> raw text.
function ilRenderLogBody(text){
  var s=String(text==null?'':text).replace(/\r\n/g,'\n');
  if(!IL_VIEW_LABEL_RE.test(s)) return '<div class="ilv-txt ilv-raw">'+(_ilvBlank(s)?IL_VIEW_NP:_ilvLinkify(s.trim()))+'</div>';
  var f=parseIncidentOutput(s);
  var link=_ilvBlank(f.link) ? IL_VIEW_NP : _ilvLinkify(f.link.trim());
  var fact=function(l,v){ return '<div class="ilv-fact"><dt>'+l+'</dt><dd>'+v+'</dd></div>'; };
  var main=_ilvSec('PHD Findings',_ilvText(f.findings))+
    _ilvSec('PHD Investigation for mitigation',_ilvInvest(f.invest))+
    '<dl class="ilv-facts">'+fact('Root Cause',_ilvBlank(f.rootCause)?IL_VIEW_NP:_ileEsc(f.rootCause))+
      fact('PHD Resolution',_ilvBlank(f.res)?IL_VIEW_NP:_ileEsc(f.res))+fact('PHD Related Link',link)+'</dl>'+
    _ilvSec('PHD notes',_ilvText(f.notes));
  var side=_ilvSec('SIM Root Cause Details',_ilvKv(f.sim))+(_ilvBlank(f.hist)?'':_ilvSec('Historical Incidents',_ilvText(f.hist)));
  return '<div class="ilv-cols"><div class="ilv-col">'+main+'</div><div class="ilv-col ilv-col-side">'+side+'</div></div>';
}
// One timeline entry. e = {id, user, at, text}; o = {when (display string), actionsHtml, latest}.
function ilRenderLogEntry(e,o){
  e=e||{}; o=o||{};
  var user=String(e.user||'\u2014'), ini=(user.match(/[A-Za-z0-9]/)||['?'])[0].toUpperCase();
  var when=o.when?'<time class="ilv-when"'+(e.at?' datetime="'+_ileEsc(e.at)+'"':'')+'>'+_ileEsc(o.when)+'</time>':'';
  return '<li class="ilv-entry'+(o.latest?' is-latest':'')+'" data-id="'+_ileEsc(e.id)+'">'+
    '<span class="ilv-dot" aria-hidden="true"></span>'+
    '<article class="ilv-card" aria-label="'+_ileEsc('Entry by '+user+(o.when?', '+o.when:''))+'">'+
      '<header class="ilv-ehead">'+
        '<span class="ilv-av" aria-hidden="true">'+_ileEsc(ini)+'</span>'+
        '<div class="ilv-meta"><span class="ilv-user">'+_ileEsc(user)+'</span>'+when+'</div>'+
        (o.latest?'<span class="ilv-badge">Latest</span>':'')+
        (o.actionsHtml?'<div class="ilv-acts">'+o.actionsHtml+'</div>':'')+
      '</header>'+
      '<div class="ilv-ebody">'+ilRenderLogBody(e.text)+'</div>'+
    '</article></li>';
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
  // Controls on the right of a row (see _ilqKind). Revealed controls sit in "ilqv_<key>"; a kept
  // old answer is shown in "ilqo_<key>".
  function qControl(def,kind){
    var k=def.key, id='ilq_'+k, req=' aria-required="'+(def.optional?'false':'true')+'"', lbl=_ileEsc(def.label);
    var old='<span class="ail-qold" id="ilqo_'+k+'" hidden></span>';
    if(kind==='check') return '<span class="ail-qstate" id="ilqs_'+k+'" aria-hidden="true">No</span>';   // GeoStudio POD: No / Yes tag
    if(kind==='yn') return '<span class="ail-qstate" id="ilqs_'+k+'" aria-hidden="true">No</span>'+old;
    if(kind==='num'){
      var btns=''; for(var n=0;n<=10;n++) btns+='<button type="button" class="ail-qctl ail-qnb" data-n="'+n+'" aria-pressed="'+(n===0?'true':'false')+'" onclick="ilqPickNum(\''+k+'\','+n+')">'+n+'</button>';
      return '<span class="ail-qstate" id="ilqs_'+k+'" aria-hidden="true">0</span>'+
        '<div class="ail-qrev" id="ilqv_'+k+'" hidden>'+
        '<div class="ail-qnums" id="ilqg_'+k+'" role="group" aria-label="'+lbl+': number">'+btns+'</div>'+
        '<input type="number" id="'+id+'" class="ail-qctl ail-qinp ail-qnum" min="0" step="1" inputmode="numeric" placeholder="Other" aria-label="'+lbl+': other number" aria-describedby="ilqh_'+k+'" oninput="ilqNumInput(\''+k+'\')">'+
        '<span class="ail-qhint" id="ilqh_'+k+'" hidden>Enter a whole number</span>'+
      '</div>'+old;
    }
    if(kind==='dsel')
      return '<select id="'+id+'" class="ail-qctl ail-qinp ail-qsel" aria-label="'+lbl+': answer"'+req+' onchange="ilInvestChanged(\''+k+'\')">'+
        def.opts.map(function(o){ return '<option value="'+_ileEsc(o)+'">'+_ileEsc(o===IL_POI_CM?'Community Member':o)+'</option>'; }).join('')+'</select>';
    if(kind==='cbsel')
      return '<span class="ail-qstate" id="ilqs_'+k+'" aria-hidden="true">No</span>'+
        '<div class="ail-qrev" id="ilqv_'+k+'" hidden><select id="'+id+'" class="ail-qctl ail-qinp ail-qsel" aria-label="'+lbl+': answer" onchange="ilInvestChanged(\''+k+'\')">'+
        def.opts.filter(function(o){ return o!=='No'; }).map(function(o){ return '<option value="'+_ileEsc(o)+'">'+_ileEsc(o)+'</option>'; }).join('')+'</select></div>';
    if(def.type==='textarea')
      return '<textarea id="'+id+'" class="ail-qctl ail-qinp ail-qta" rows="'+(def.rows||5)+'" placeholder="'+_ileEsc(def.placeholder||'')+'"'+req+' oninput="ilInvestChanged(\''+k+'\')"></textarea>';
    return '<input type="'+(def.inputType||'text')+'" id="'+id+'" class="ail-qctl ail-qinp" autocomplete="off" placeholder="'+_ileEsc(def.placeholder||'')+'"'+req+' oninput="ilInvestChanged(\''+k+'\')">';
  }
  // Row = [checkbox][label][controls]. Text sub-fields have no checkbox (empty lead cell).
  // Defaultable rows (_ilqDefaultable) start the controls with the "DEFAULT" pill (ilqd_<key>,
  // aria-hidden) and have a hidden "default value, not changed" text (ilqds_<key>) that
  // _ilqSyncDefaults links to the row's control with aria-describedby while the pill is shown.
  function qRow(def,isSub){
    var k=def.key, kind=_ilqKind(def), plain=(kind==='text'||kind==='dsel'), lead=plain
      ? '<span class="ail-qlead" aria-hidden="true"></span>'
      : '<span class="ail-qlead"><input type="checkbox" id="ilqc_'+k+'" class="ail-qctl ail-qcb" onchange="ilqToggle(\''+k+'\')"></span>';
    var dflt=_ilqDefaultable(def);
    return '<div class="ail-qrow'+(isSub?' ail-qsub':'')+(kind==='text'?' ail-qrow-txt':'')+(def.type==='textarea'?' ail-qrow-ta':'')+'" data-ilq-row="'+k+'"'+(isSub?' hidden':'')+'>'+
      lead+'<label class="ail-qlabel" for="'+(plain?'ilq_':'ilqc_')+k+'">'+_ileEsc(def.label)+(def.optional?' <span class="ail-qopt">(optional)</span>':'')+
        (dflt?'<span id="ilqds_'+k+'" hidden>default value, not changed</span>':'')+'</label>'+
      '<div class="ail-qctls">'+(dflt?'<span class="ail-qdef" id="ilqd_'+k+'" aria-hidden="true" title="Default value - not changed yet" hidden>Default</span>':'')+qControl(def,kind)+'</div></div>';
  }
  function investigationField(){
    var id='ilPhdInvestigation', label='PHD Investigation for mitigation';
    var rows=IL_INVEST_QS.map(function(q){
      return qRow(q,false)+(q.poiWho?qRow(q.poiWho,true):'')+(q.sub?qRow(q.sub,true):'');
    }).join('');
    return '<div class="ail-field" data-ilfield>'+
      '<div class="ail-flabel"><span class="ail-flabel-tx" id="ilPhdInvestigationLbl">'+label+'</span> <span class="ail-empty-dot">Empty</span>'+
        // DEFAULT hint pill: in the header, right side, just left of the pencil / copy icons (plain
        // spans in the header <div>, no handler, so a click on it does nothing).
        '<span class="ail-qn-defhint" id="ilqDefHint" title="DEFAULT = not changed yet. Please confirm these values." hidden><span class="ail-qdef">Default</span><span class="ail-qn-defhint-tx">= not changed yet. Please confirm these values.</span></span>'+
        '<button type="button" class="ail-fedit" data-for="'+id+'" onclick="ilEditField(this)" title="Edit this field" aria-label="Edit '+label+'" style="display:none"></button>'+
        '<button type="button" class="ail-fcopy" data-for="'+id+'" data-label="'+label+'" onclick="ilCopyField(this)" title="Copy this field" aria-label="Copy '+label+'"></button></div>'+
      '<div id="'+id+'" class="ail-qn" role="group" aria-labelledby="ilPhdInvestigationLbl" aria-describedby="ilqStatus">'+rows+'</div>'+
      '<p class="ail-qn-status" id="ilqStatus" aria-live="polite" hidden></p>'+
      '<div class="ail-qn-extra" id="ilqExtraWrap" hidden><div class="ail-qn-extra-h">Other notes from the saved entry (kept as-is on save)</div>'+
        '<pre id="ilqExtra"></pre></div>'+
    '</div>';
  }
  // "SIM Root Cause Details" form: one row per IL_SIM_FIELDS key, one below the other (label | control).
  // Controls carry .ail-sctl (locked / unlocked together); styling reuses the questionnaire's
  // .ail-qinp / .ail-qnb rules (the form box is also .ail-qn).
  function simCell(f){
    var k=f.key, id='ils_'+k;
    var txt=_ileEsc(k)+(f.hint?' <span class="ail-shint">('+_ileEsc(f.hint)+')</span>':'');
    var lab='<label class="ail-slabel" id="'+id+'_lbl" for="'+id+'">'+txt+'</label>', ctl;
    if(f.type==='issue')
      ctl='<select id="'+id+'" class="ail-sctl ail-qinp" onchange="ilSimChanged()">'+_ilsIssueOptions()+'</select>';
    else if(f.type==='res')
      ctl='<select id="'+id+'" class="ail-sctl ail-qinp" onchange="ilSimChanged()">'+_ilsResOptions(_ilsResList)+'</select>';
    else if(f.type==='driv'){
      lab='<span class="ail-slabel" id="'+id+'_lbl">'+txt+'</span>';
      ctl='<div class="ail-sdriv"><div class="ail-schips" id="'+id+'" role="radiogroup" aria-labelledby="'+id+'_lbl">'+
        IL_SIM_DRIV.map(function(o,i){
          return '<label class="ail-schip"><input type="radio" class="ail-sctl" name="ilsDriv" id="'+id+'_'+i+'" value="'+_ileEsc(o)+'" onclick="ilsDrivClick(this)"><span>'+_ileEsc(o)+'</span></label>';
        }).join('')+'</div>'+
        '<button type="button" class="ail-sctl ail-sclear" id="ils_DrivClear" onclick="ilsDrivClear()" aria-label="Clear Driv" hidden>Clear</button></div>';
    }
    else if(f.type==='date')
      ctl='<div class="ail-sdate">'+
        '<input type="text" id="'+id+'" class="ail-sctl ail-qinp" autocomplete="off" placeholder="MM/DD/YY" aria-describedby="ils_Date_hint" oninput="ilsDateText(this,false)" onchange="ilsDateText(this,true)">'+
        '<input type="date" id="ils_DatePick" class="ail-sctl ail-qinp ail-sdpick" aria-label="Date: pick from calendar" onchange="ilsDatePick(this)">'+
        '</div><span class="ail-shelp" id="ils_Date_hint" hidden>Not a recognised date (kept as typed)</span>';
    else if(f.type==='cnt'){
      lab='<span class="ail-slabel" id="'+id+'_lbl">'+txt+'</span>';
      var btns=''; for(var n=0;n<=10;n++) btns+='<button type="button" class="ail-sctl ail-qnb" data-n="'+n+'" aria-pressed="'+(n===0?'true':'false')+'" onclick="ilsPickCnt('+n+')">'+n+'</button>';
      ctl='<div class="ail-scnt"><div class="ail-qnums" id="ilsg_Cnt" role="group" aria-labelledby="'+id+'_lbl">'+btns+'</div>'+
        '<input type="number" id="'+id+'" class="ail-sctl ail-qinp ail-qnum" min="0" step="1" inputmode="numeric" placeholder="Other" aria-label="Cnt: other number" oninput="ilsCntInput()"></div>'+
        '<span class="ail-qold" id="ils_Cnt_old" hidden></span>';
    }
    else ctl='<input type="text" id="'+id+'" class="ail-sctl ail-qinp" autocomplete="off" oninput="ilSimChanged()">';
    return '<div class="ail-scell ail-scell-'+k+'">'+lab+ctl+'</div>';
  }
  function simField(){
    var id='ilSimRcd', label='SIM Root Cause Details';
    return '<div class="ail-field" data-ilfield>'+
      '<div class="ail-flabel"><span class="ail-flabel-tx" id="ilSimRcdLbl">'+label+'</span> <span class="ail-empty-dot">Empty</span>'+
        '<button type="button" class="ail-fedit" data-for="'+id+'" onclick="ilEditField(this)" title="Edit this field" aria-label="Edit '+label+'" style="display:none"></button>'+
        '<button type="button" class="ail-simimp" id="ilSimImportBtn" onclick="ilSimImportOpen(this)" title="Import SIM Root Cause Details from pasted text" aria-haspopup="dialog" aria-label="Import SIM Root Cause Details"><span class="ail-simimp-tx">Import</span></button>'+
        '<button type="button" class="ail-fcopy" data-for="'+id+'" data-label="'+label+'" onclick="ilCopyField(this)" title="Copy this field" aria-label="Copy '+label+'"></button></div>'+
      // The field text (value = live serialization of the form; see _ilsInstall). Not shown.
      '<textarea id="'+id+'" class="ail-simraw" hidden aria-hidden="true" tabindex="-1"></textarea>'+
      '<div id="ilSimForm" class="ail-qn ail-sim" role="group" aria-labelledby="ilSimRcdLbl">'+
        '<div class="ail-sgrid">'+IL_SIM_FIELDS.map(simCell).join('')+
          // HI1..HIN rows directly below Res (added / removed with Cnt, see _ilsSyncHi).
          '<div class="ail-shi" id="ilsHiBox"><p class="ail-shi-warn" id="ils_HiWarn" role="status" hidden></p></div>'+
        '</div>'+
        '<p class="ail-sim-status" id="ilsStatus" role="status" aria-live="polite" hidden></p>'+
        '<div class="ail-qn-extra" id="ilsExtraWrap" hidden><div class="ail-qn-extra-h">Other lines from the saved entry (kept as-is on save)</div><pre id="ilsExtra"></pre></div>'+
      '</div>'+
      // Historical Incidents rows (shown when the SIM "Cnt:" value is 1 or more; see ilHistSync).
      '<div class="ail-hist" id="ilHist" role="group" aria-labelledby="ilHistTitle" hidden></div>'+
    '</div>';
  }
  // Severity row: not a data-ilfield (no Empty marker / copy icon). .ail-qn wrapper = the shared
  // .ail-qnb button look (frame removed by .ail-sevbox). State: ilSevPick / _ilSevRender.
  function sevField(){
    var btns=''; for(var n=1;n<=5;n++) btns+='<button type="button" class="ail-qnb" data-n="'+n+'" aria-pressed="false" aria-label="Severity '+n+'" onclick="ilSevPick('+n+')">'+n+'</button>';
    return '<div class="ail-field ail-field-inline ail-sev" id="ilSevField">'+
      '<div class="ail-flabel"><span class="ail-flabel-tx" id="ilSevLbl">Severity</span>'+
        '<span class="ail-qdef ail-sev-hint" id="ilSevHint" hidden>Select a severity</span></div>'+
      '<div class="ail-qn ail-sevbox"><div class="ail-qnums" id="ilSevGroup" role="group" aria-labelledby="ilSevLbl">'+btns+'</div></div>'+
    '</div>';
  }
  function markupHtml(){
    return '<div class="modal-bg ail-bg" id="incidentModal" onclick="if(event.target===this)closeIncidentLog()">'+
      '<div class="modal ail-modal" role="dialog" aria-modal="true" aria-labelledby="incidentTitle">'+
        '<div class="ail-head">'+
          '<span class="ail-head-ic" id="ailHeadIc"></span>'+
          '<div class="ail-head-tx"><h2 id="incidentTitle"><span id="incidentTitleText">Add incident log</span><button type="button" class="ail-idcopy" id="incidentIdCopyBtn" onclick="copyIncidentTicketId(this)" title="Copy ticket ID" aria-label="Copy ticket ID" style="display:none"></button></h2><span class="ail-head-sub">Structured PHD findings &amp; mitigation, saved to this ticket\'s log</span></div>'+
          // Whole-log Import (same look as the SIM Import button), left of the page's head flags.
          '<button type="button" class="ail-simimp ail-logimp" id="ilLogImportBtn" onclick="ilLogImportOpen(this)" title="Import the full incident log from pasted text" aria-haspopup="dialog" aria-label="Import the full incident log"><span class="ail-simimp-tx">Import</span></button>'+
          '<span class="mtc-icons ail-head-flags" id="ailHeadFlags"></span>'+
          '<button type="button" class="ail-x" onclick="closeIncidentLog()" aria-label="Close">&times;</button>'+
        '</div>'+
        '<div class="ail-body">'+
          '<p class="ail-log-status" id="ilLogImportStatus" role="status" aria-live="polite" hidden></p>'+
          // Display order (= copy / save order): Root Cause, SIM Root Cause Details, PHD Investigation,
          // PHD Findings, PHD Notes. PHD Related Link (hidden input, filled by the page with the ticket
          // URL) and PHD Resolution (the SIM "Res:" value) are not shown but are in every copy / save.
          // Severity (above Root Cause, same side-by-side layout): buttons 1..5 like the SIM "Cnt" ones.
          sevField()+
          // Root Cause: label and dropdown side by side (.ail-field-inline).
          field('ilRootCause','Root Cause','select','<select id="ilRootCause" onchange="ilMarkEmpty(this)"></select>').replace('class="ail-field"','class="ail-field ail-field-inline"')+
          simField()+
          investigationField()+
          field('ilPhdFindings','PHD Findings','ta','<textarea id="ilPhdFindings" class="ail-f" oninput="ilMarkEmpty(this)" placeholder="- On 11OCT\'26, a DSP DA from station …&#10;- …"></textarea>')+
          '<input type="hidden" id="ilRelatedLink">'+
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
    _ilsInstall();   // SIM Root Cause Details form <-> #ilSimRcd text
  }
  // Questionnaire CSS (light theme). Injected by mount() on every page — my-tickets keeps its own
  // inline copy of the base editor CSS, so these rules are self-contained and scoped to .ail-qn.
  var QN_CSS=[
    '.ail-qn{border:1px solid #d4dce4;border-radius:10px;background:#fff;padding:2px 12px}',
    // Row = [checkbox][label][controls on the right]; text sub-fields keep a fixed-width control column.
    '.ail-qrow{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:6px 12px;align-items:center;padding:8px 0;border-top:1px solid #eef1f4}',
    '.ail-qrow-txt{grid-template-columns:22px minmax(0,1fr) minmax(200px,380px)}',
    '.ail-qrow:first-child{border-top:0}',
    '.ail-qrow[hidden],.ail-qn-extra[hidden],.ail-qrev[hidden],.ail-qold[hidden],.ail-qhint[hidden],.ail-qstate[hidden]{display:none!important}',
    '.ail-qlead{display:flex;align-items:center;justify-content:center;min-height:30px}',
    '.ail-qlabel{font-size:.84em;font-weight:500;color:#1b2026;line-height:1.4;cursor:pointer}',
    '.ail-qrow-txt .ail-qlabel{cursor:default}',
    '.ail-qopt{color:#5c6773;font-weight:400}',
    '.ail-qctls{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 8px;min-width:0}',
    '.ail-qrow-txt .ail-qctls{display:block}',
    '.ail-qsub{margin-left:18px;padding-left:12px;border-left:2px solid #f2c79b;animation:ailqIn .18s ease-out}',
    '.ail-qsub .ail-qlabel{color:#2a3340}',
    '@keyframes ailqIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '.ail-field .ail-qn .ail-qinp{box-sizing:border-box;width:100%;min-height:34px;margin:0;padding:6px 10px!important;font-size:.85em;line-height:1.4;font-family:inherit;border-radius:8px!important;background:#fff!important;border:1px solid #d4dce4!important;color:#1b2026!important}',
    '.ail-field .ail-qn .ail-qinp:focus{outline:none;border-color:#ec7211!important;box-shadow:0 0 0 3px rgba(236,114,17,.14)}',
    '.ail-field .ail-qn .ail-qinp:disabled{background:#f3f5f7!important;color:#2a3340!important;opacity:1;cursor:default}',
    '.ail-field .ail-qn .ail-qinp.ail-qbad{border-color:#d33a3a!important}',
    '.ail-qn-status{margin:6px 0 0;font-size:.78em;color:#8a5a00}',
    '.ail-qn-status[hidden]{display:none!important}',
    // Row checkbox (left).
    '.ail-field .ail-qn input.ail-qcb{width:18px!important;height:18px!important;min-height:0;margin:0;padding:0!important;accent-color:#ec7211;cursor:pointer}',
    '.ail-field .ail-qn input.ail-qcb:disabled{cursor:default}',
    '.ail-field .ail-qn input.ail-qcb:focus-visible{outline:2px solid #1577a0;outline-offset:2px;box-shadow:none}',
    // State tag: Yes / No of a Yes/No row; "No" / "0" of an unchecked dropdown / number row.
    '.ail-qstate{font-size:.74em;font-weight:700;color:#5c6773;background:#f3f5f7;border:1px solid #e3e8ee;border-radius:999px;padding:2px 10px;line-height:1.4}',
    '.ail-qstate.is-yes{color:#1f2a40;background:#fff3e8;border-color:#f7c99c}',
    // "DEFAULT" highlight mark (amber) left of an untouched control + the hint pill in the field
    // header (same colour family). A row still at its default gets a subtle amber left mark
    // (.is-default, set by _ilqSyncDefaults); a changed row never has it (orange .is-changed wins).
    '.ail-qdef{display:inline-block;font-size:.64em;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#7a4b00;background:#fff3c4;border:1px solid #f2c94c;border-radius:4px;padding:1px 6px;line-height:1.5;white-space:nowrap;cursor:default}',
    '.ail-qdef[hidden],.ail-qn-defhint[hidden]{display:none!important}',
    // Hint pill in the PHD Investigation header: pushed right, the copy icon then follows it directly.
    '.ail-flabel>.ail-qn-defhint{display:inline-flex;align-items:center;gap:5px;margin:0 0 0 auto;min-width:0;max-width:60%;flex:0 1 auto;overflow:hidden;white-space:nowrap;font-size:.92em;font-weight:600;line-height:1.4;color:#7a4b00;background:none;border:0;border-radius:0;padding:0;cursor:default;user-select:none}',
    '.ail-qn-defhint .ail-qdef{flex:0 0 auto;font-size:.84em}',
    '.ail-qn-defhint-tx{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ail-flabel>.ail-qn-defhint:not([hidden])~.ail-fcopy{margin-left:0}',
    '@media (max-width:640px){.ail-flabel:has(>.ail-qn-defhint:not([hidden])){flex-wrap:wrap}.ail-flabel>.ail-qn-defhint{order:10;max-width:100%;margin-left:0;white-space:normal;border-radius:10px}.ail-qn-defhint-tx{white-space:normal}.ail-flabel>.ail-qn-defhint:not([hidden])~.ail-fcopy{margin-left:auto}}',
    '.ail-qrow.is-default:not(.is-changed){box-shadow:inset 3px 0 0 #f2c94c;border-radius:6px;padding-left:8px;padding-right:8px;margin:0 -8px}',
    // Row whose answer differs from the default (Yes, a number above 0, a CLEAR / POI change).
    '.ail-qrow.is-changed{background:#fff8f1;box-shadow:inset 3px 0 0 #ec7211;border-radius:6px;padding-left:8px;padding-right:8px;margin:0 -8px}',
    '.ail-qrow.is-changed .ail-qlabel{font-weight:700}',
    // Revealed controls (number buttons + "Other", CLEAR / POI dropdowns).
    '.ail-qrev{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 8px;animation:ailqIn .18s ease-out}',
    '.ail-qnums{display:inline-flex;flex-wrap:wrap;gap:4px}',
    '.ail-field .ail-qn button.ail-qnb{min-width:30px;height:30px;margin:0;padding:0 6px!important;border-radius:8px!important;border:1px solid #d4dce4!important;background:#fff!important;color:#2a3340!important;font-family:inherit;font-size:.8em;font-weight:700;line-height:1;cursor:pointer;box-shadow:none!important;transition:background .12s,border-color .12s,color .12s}',
    '.ail-field .ail-qn button.ail-qnb:hover:not(:disabled){border-color:#ec7211!important;color:#b4500a!important}',
    '.ail-field .ail-qn button.ail-qnb[aria-pressed="true"]{background:#1f2a40!important;border-color:#1f2a40!important;color:#fff!important}',
    '.ail-field .ail-qn button.ail-qnb:focus-visible{outline:2px solid #1577a0;outline-offset:2px}',
    '.ail-field .ail-qn button.ail-qnb:disabled{cursor:default;opacity:.7}',
    '.ail-field .ail-qn input.ail-qnum{width:78px;min-height:30px;padding:4px 8px!important}',
    '.ail-field .ail-qn select.ail-qsel{width:auto;min-width:210px}',
    '.ail-qhint{flex-basis:100%;text-align:right;font-size:.76em;color:#8a5a00}',
    '.ail-qold{font-size:.76em;color:#5c6773;font-style:italic;max-width:360px}',
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
    // Narrow: controls wrap below the label (aligned with it, not the checkbox).
    '@media (max-width:860px){.ail-qrow,.ail-qrow-txt{grid-template-columns:22px minmax(0,1fr);gap:4px 10px}.ail-qctls{grid-column:2;justify-content:flex-start}.ail-qrev{justify-content:flex-start}.ail-qhint{text-align:left}.ail-qctls:empty{display:none}}',
    '@media (max-width:640px){.ail-qsub{margin-left:8px}}',
    // SIM Root Cause Details form: 2-column grid of labelled cells (1 column under 760px).
    '.ail-simraw{display:none!important}',
    '.ail-qn.ail-sim{padding:12px}',
    // Side-by-side field (Root Cause): [label + markers] [control], label above the control when narrow.
    // Lives in QN_CSS (injected on every page that mounts the editor; My Tickets has its own base CSS).
    '.ail-field.ail-field-inline{display:grid;grid-template-columns:200px minmax(0,1fr);align-items:center;gap:6px 14px}',
    '.ail-field.ail-field-inline>.ail-flabel{margin-bottom:0;flex-wrap:wrap}',
    '.ail-field.ail-field-inline>:not(.ail-flabel){min-width:0}',
    '@media (max-width:640px){.ail-field.ail-field-inline{grid-template-columns:minmax(0,1fr)}}',
    // Severity row (above Root Cause): buttons 1..5 (.ail-qnb look), no frame around them. Chosen =
    // orange .is-changed (same as a filled SIM row); missing after an Import = amber mark + hint.
    // #incidentModal-prefixed copies win over My Tickets' "#incidentModal .ail-field" card rule.
    '.ail-field.ail-sev{padding:6px 8px;border-radius:6px}',
    '.ail-qn.ail-sevbox{border:0;border-radius:0;background:transparent;padding:0}',
    '.ail-field.ail-sev.is-changed,#incidentModal .ail-field.ail-sev.is-changed{background:#fff8f1;box-shadow:inset 3px 0 0 #ec7211}',
    '.ail-field.ail-sev.is-changed .ail-flabel-tx{font-weight:800}',
    '.ail-field.ail-sev.is-needed,#incidentModal .ail-field.ail-sev.is-needed{background:#fffbea;box-shadow:inset 3px 0 0 #f2c94c}',
    '.ail-sev-hint{font-size:.84em;text-transform:none;letter-spacing:0}',
    '.ail-sev-hint[hidden]{display:none!important}',
    // One field per row, one below the other: [label] [control] (label above the control when narrow).
    '.ail-sgrid{display:flex;flex-direction:column}',
    '.ail-scell{min-width:0;display:grid;grid-template-columns:200px minmax(0,1fr);gap:4px 14px;align-items:center;padding:8px 0;border-top:1px solid #eef1f4;border-radius:5px}',
    '.ail-scell:first-child{border-top:0}',
    // Filled row = same highlight as a changed PHD Investigation row (.ail-qrow.is-changed).
    '.ail-scell.is-changed{background:#fff8f1;box-shadow:inset 3px 0 0 #ec7211;border-radius:6px;padding-left:8px;padding-right:8px;margin:0 -8px}',
    '.ail-scell.is-changed .ail-slabel{font-weight:800}',
    '.ail-scell>.ail-slabel{grid-column:1}',
    '.ail-scell>:not(.ail-slabel){grid-column:2;min-width:0}',
    '@media (max-width:640px){.ail-scell{grid-template-columns:minmax(0,1fr)}.ail-scell>:not(.ail-slabel){grid-column:1}}',
    '.ail-slabel{font-size:.78em;font-weight:700;color:#1b2026}',
    '.ail-shint{color:#5c6773;font-weight:400}',
    '.ail-shelp{font-size:.76em;color:#8a5a00}',
    '.ail-shelp[hidden],.ail-sim-status[hidden],.ail-sclear[hidden]{display:none!important}',
    '.ail-sdate{display:flex;gap:8px;min-width:0}',
    '.ail-field .ail-qn .ail-sdate .ail-qinp{flex:1 1 0;min-width:0}',
    '.ail-field .ail-qn .ail-sdate input.ail-sdpick{flex:0 0 auto;width:150px}',
    '.ail-sdriv{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}',
    '.ail-schips{display:flex;flex-wrap:wrap;gap:6px}',
    '.ail-schip{position:relative;display:inline-flex;margin:0}',
    '.ail-field .ail-qn .ail-schip input{position:absolute;opacity:0;width:1px;height:1px;margin:0;padding:0;pointer-events:none}',
    '.ail-schip span{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:0 12px;border:1px solid #d4dce4;border-radius:999px;background:#fff;color:#2a3340;font-size:.8em;font-weight:700;cursor:pointer;user-select:none;transition:background .12s,border-color .12s,color .12s}',
    '.ail-schip span::before{content:"";flex:0 0 auto;width:14px;height:14px;box-sizing:border-box;border:1.5px solid #8793a0;border-radius:4px;background:#fff}',
    '.ail-schip span:hover{border-color:#ec7211}',
    '.ail-schip input:checked+span{background:#1f2a40;border-color:#1f2a40;color:#fff}',
    '.ail-schip input:checked+span::before{border-color:#ec7211;background:#ec7211;box-shadow:inset 0 0 0 2px #1f2a40}',
    '.ail-schip input:focus-visible+span{outline:2px solid #1577a0;outline-offset:2px}',
    '.ail-schip input:disabled+span{cursor:default;opacity:.7}',
    '.ail-schip input:disabled+span:hover{border-color:#d4dce4}',
    '.ail-schip input:checked:disabled+span:hover{border-color:#1f2a40}',
    '.ail-field .ail-qn button.ail-sclear{height:28px;margin:0;padding:0 10px!important;border:1px solid transparent!important;border-radius:6px!important;background:transparent!important;color:#1577a0!important;font-family:inherit;font-size:.78em;font-weight:700;text-decoration:underline;cursor:pointer;box-shadow:none!important}',
    '.ail-field .ail-qn button.ail-sclear:focus-visible{outline:2px solid #1577a0;outline-offset:2px}',
    '.ail-field .ail-qn button.ail-sclear:disabled{display:none}',
    '.ail-scnt{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}',
    '.ail-sim-status{margin:10px 0 0;font-size:.8em;font-weight:600;color:#1f6f43}',
    '.ail-sim .ail-qn-extra{margin-top:10px}',
    '.ail-scell.ail-flash{animation:ailFlash 1.8s ease-out}',
    // HI1..HIN rows below Res: same row look as the other SIM rows; Cnt-over-9 warning (Build Root Cause Details style).
    '.ail-shi{display:contents}',
    '.ail-shi>.ail-scell:first-child{border-top:1px solid #eef1f4}',
    '.ail-shi-warn{margin:6px 0 0;font-size:.78em;font-weight:700;color:#b5680c;background:#fff3e0;border:1px solid #f6ddb8;border-radius:7px;padding:6px 10px}',
    '.ail-shi-warn[hidden]{display:none!important}',
    // Import button (header, right corner, before the copy icon).
    '.ail-simimp{margin-left:auto;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid #d4dce4;border-radius:5px;background:transparent;color:#5c6773;font-family:inherit;font-size:1em;font-weight:700;cursor:pointer;flex:0 0 auto;transition:border-color .15s,color .15s,background .15s}',
    '.ail-simimp svg{width:14px;height:14px}',
    '.ail-simimp:hover{border-color:#1577a0;color:#1577a0;background:rgba(21,119,160,.08)}',
    '.ail-simimp:focus-visible{outline:2px solid #1577a0;outline-offset:2px}',
    '.ail-simimp+.ail-fcopy{margin-left:0}',
    // Import pop-up (ilc-* dialog, narrower).
    '.ilc-dlg.ils-dlg{width:min(680px,96vw);max-width:min(680px,96vw)}',
    '.ils-lbl{display:block;margin:0 0 6px;font-size:.88em;font-weight:700;color:#1b2026}',
    '.ils-ta{box-sizing:border-box;display:block;width:100%;min-height:260px;max-height:55vh;resize:vertical;margin:0;padding:10px 12px;border:1px solid #d4dce4;border-radius:5px;background:#fff;color:#1b2026;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;line-height:1.5}',
    '.ils-ta:focus{outline:none;border-color:#ec7211;box-shadow:0 0 0 3px rgba(236,114,17,.14)}',
    '.ils-hint{margin:8px 0 0;font-size:.8em;color:#5c6773}',
    '.ils-err{margin:6px 0 0;font-size:.82em;font-weight:600;color:#b42318}',
    '.ils-err[hidden]{display:none}',
    // Whole-log Import: header button, "Replace existing PHD Notes" option, summary line.
    '.ail-head .ail-simimp.ail-logimp{margin-left:0;margin-top:1px;font-size:.8em}',
    '.ilfi-rep{display:inline-flex;align-items:center;gap:7px;margin:10px 0 0;font-size:.85em;font-weight:600;color:#1b2026;cursor:pointer}',
    '.ilfi-rep input{width:16px;height:16px;margin:0;accent-color:#ec7211;cursor:pointer}',
    '.ilfi-rep input:focus-visible{outline:2px solid #1577a0;outline-offset:2px}',
    '.ilfi-rep[hidden],.ail-log-status[hidden]{display:none!important}',
    '.ail-log-status{margin:0 0 12px;font-size:.8em;font-weight:600;color:#1f6f43}',
    '@media (prefers-reduced-motion:reduce){.ail-qsub,.ail-qrev{animation:none}.ail-qrow.ail-flash,.ail-field.ail-flash{animation:none;outline:2px solid #ec7211}}'
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
  // Read-only incident-log pop-up (.ilv-*): app dialog language (navy gradient head band, thin orange
  // accent, icon tile, uppercase orange eyebrow, glassy icon buttons) + a vertical entry timeline.
  // 90vw (min 320px), 96vw under 720px, max 88vh with the body scrolling inside. Two columns per
  // entry from 1000px. Selectors are two-class + !important where the pages' generic rules compete.
  var VIEW_CSS=[
    '.ilv-modal{box-sizing:border-box;flex:0 0 auto;width:90vw;max-width:90vw;min-width:min(320px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;margin:0;padding:0;background:#fff;color:#1b2026;border:1px solid rgba(255,255,255,.1);border-radius:14px;box-shadow:0 30px 70px -22px rgba(5,10,20,.85),0 2px 8px -2px rgba(5,10,20,.3);text-align:left;animation:ilvIn .18s ease-out}',
    '@media (max-width:719.98px){.ilv-modal{width:96vw;max-width:96vw}}',
    '@keyframes ilvIn{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}',
    '.ilv-modal .ilv-head{position:relative;overflow:hidden;flex-shrink:0;display:flex;align-items:center;gap:12px 14px;padding:18px 20px 16px 26px;color:#e9edf3;background:radial-gradient(120% 170% at 100% 0%,rgba(236,114,17,.30),transparent 55%),linear-gradient(135deg,#131a2a,#1f2a40);border-bottom:1px solid rgba(236,114,17,.35)}',
    '.ilv-modal .ilv-head::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:24px 24px;-webkit-mask-image:linear-gradient(90deg,transparent 25%,#000 85%);mask-image:linear-gradient(90deg,transparent 25%,#000 85%)}',
    '.ilv-modal .ilv-head::after{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#ff9f2e,#ec7211)}',
    '.ilv-modal .ilv-head>*{position:relative}',
    '.ilv-modal .ilv-head-ic{width:42px;height:42px;border-radius:11px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;background:rgba(236,114,17,.16);color:#ffb26b;border:1px solid rgba(236,114,17,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}',
    '.ilv-modal .ilv-head-ic svg{width:20px;height:20px}',
    '.ilv-modal .ilv-head-tx{flex:1 1 auto;min-width:0}',
    '.ilv-modal .ilv-eyebrow{font-size:.66em;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:#ffb26b;margin:0 0 4px;line-height:1.2}',
    '.ilv-modal h2.ilv-title{margin:0!important;padding:0;color:#fff!important;font-size:1.35em!important;font-weight:800!important;letter-spacing:-.3px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:none;background:none!important}',
    '.ilv-modal .ilv-title a{color:#fff!important;text-decoration:underline;text-decoration-color:rgba(255,178,107,.6);text-underline-offset:4px;text-decoration-thickness:2px}',
    '.ilv-modal .ilv-title a:hover{color:#ffcf9e!important;text-decoration-color:#ffb26b}',
    '.ilv-modal .ilv-sub{margin:4px 0 0;color:rgba(233,237,243,.82);font-size:.8em;line-height:1.4}',
    '.ilv-modal .ilv-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
    '.ilv-modal button.ilv-icbtn{flex-shrink:0;width:36px;height:36px;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:10px!important;background:rgba(255,255,255,.08)!important;border:1px solid rgba(255,255,255,.2)!important;color:#e9edf3!important;cursor:pointer;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);box-shadow:inset 0 1px 0 rgba(255,255,255,.1);transition:background .15s,border-color .15s,color .15s}',
    '.ilv-modal button.ilv-icbtn svg{width:16px;height:16px}',
    '.ilv-modal button.ilv-icbtn:hover{background:rgba(236,114,17,.22)!important;border-color:rgba(255,178,107,.7)!important;color:#fff!important}',
    '.ilv-modal button.ilv-icbtn.copied{background:rgba(31,157,87,.3)!important;border-color:#4ade80!important}',
    '.ilv-modal .ilv-head :is(button,a):focus-visible{outline:3px solid #f0a35a!important;outline-offset:2px}',
    '.ilv-modal .ilv-body{flex:1 1 auto;min-height:0;overflow:auto;padding:20px 24px 24px;background:#f4f6f9}',
    '.ilv-modal ol.ilv-tl{position:relative;list-style:none;margin:0;padding:0 0 0 28px}',
    '.ilv-modal ol.ilv-tl::before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:2px;border-radius:2px;background:#dfe4ea}',
    '.ilv-modal .ilv-entry{position:relative;margin:0 0 16px;padding:0}',
    '.ilv-modal .ilv-entry:last-child{margin-bottom:0}',
    '.ilv-modal .ilv-dot{position:absolute;left:-25px;top:20px;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #c9d1da;box-sizing:border-box}',
    '.ilv-modal .ilv-entry.is-latest .ilv-dot{border-color:#ec7211;background:#ffe3c7}',
    '.ilv-modal .ilv-card{background:#fff;border:1px solid #e3e8ee;border-radius:12px;box-shadow:0 1px 2px rgba(16,24,38,.05),0 8px 20px -16px rgba(16,24,38,.35);overflow:hidden}',
    '.ilv-modal .ilv-entry.is-latest .ilv-card{border-color:#f2c79b}',
    '.ilv-modal .ilv-ehead{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:12px 16px;border-bottom:1px solid #eef1f4;background:linear-gradient(180deg,#fbfcfd,#fff)}',
    '.ilv-modal .ilv-av{flex-shrink:0;width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1f2a40,#2f3f5f);color:#ffcf9e;font-weight:800;font-size:.9em;box-shadow:inset 0 0 0 2px rgba(236,114,17,.45)}',
    '.ilv-modal .ilv-meta{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;line-height:1.3}',
    '.ilv-modal .ilv-user{font-weight:800;color:#1b2026;font-size:.9em}',
    '.ilv-modal .ilv-when{color:#5c6773;font-size:.78em}',
    '.ilv-modal .ilv-badge{flex-shrink:0;font-size:.66em;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#8a3a00;background:#fff3e8;border:1px solid #f7c99c;border-radius:999px;padding:2px 9px}',
    '.ilv-modal .ilv-acts{display:flex;gap:8px;flex-shrink:0;margin-left:auto}',
    '.ilv-modal button.ilv-btn{display:inline-flex;align-items:center;gap:6px;height:32px;margin:0;padding:0 12px;border-radius:8px!important;font-family:inherit;font-size:.8em;font-weight:800!important;cursor:pointer;background:#fff!important;border:1px solid #cdd4db!important;color:#2a3340!important;box-shadow:none!important;transition:background .15s,border-color .15s,color .15s}',
    '.ilv-modal button.ilv-btn svg{width:13px;height:13px}',
    '.ilv-modal button.ilv-btn:hover:not(:disabled){border-color:#8793a0!important;background:#f5f6f8!important;color:#1b2026!important}',
    '.ilv-modal button.ilv-btn.danger{background:#b42318!important;border-color:#b42318!important;color:#fff!important}',
    '.ilv-modal button.ilv-btn.danger:hover:not(:disabled){background:#912018!important;border-color:#912018!important;color:#fff!important}',
    '.ilv-modal button.ilv-btn:disabled{opacity:.5;cursor:not-allowed}',
    '.ilv-modal .ilv-body :is(button,a,[tabindex]):focus-visible{outline:3px solid #1577a0!important;outline-offset:2px}',
    '.ilv-modal .ilv-ebody{padding:14px 16px 16px}',
    '.ilv-modal .ilv-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:4px 28px}',
    '@media (min-width:1000px){.ilv-modal .ilv-cols{grid-template-columns:minmax(0,1.45fr) minmax(300px,1fr)}.ilv-modal .ilv-col-side{border-left:1px dashed #e3e8ee;padding-left:24px}}',
    '.ilv-modal .ilv-col{min-width:0}',
    '.ilv-modal .ilv-sec{margin:0 0 14px}',
    '.ilv-modal .ilv-col>.ilv-sec:last-child{margin-bottom:0}',
    '.ilv-modal h3.ilv-lbl{margin:0 0 6px!important;padding:0;font-size:.68em!important;font-weight:800!important;letter-spacing:1.2px;text-transform:uppercase;color:#9a4100!important;line-height:1.3;background:none!important;border:0!important}',
    '.ilv-modal .ilv-txt{color:#2a3340;font-size:.88em;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0}',
    '.ilv-modal .ilv-np{color:#5c6773;font-style:italic;font-size:.84em}',
    '.ilv-modal .ilv-body a{color:#0b5f8f;text-decoration:underline;text-underline-offset:2px;word-break:break-all}',
    '.ilv-modal .ilv-body a:hover{color:#063f60}',
    '.ilv-modal dl{margin:0;padding:0}',
    '.ilv-modal dd{margin:0}',
    '.ilv-modal dl.ilv-qa{border:1px solid #eef1f4;border-radius:10px;padding:2px 12px;background:#fff}',
    '.ilv-modal .ilv-qa-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(70px,auto);gap:4px 16px;align-items:baseline;padding:6px 0;border-top:1px solid #f0f2f5}',
    '.ilv-modal .ilv-qa-row:first-child{border-top:0}',
    '.ilv-modal .ilv-qa-row dt{color:#3d4753;font-size:.84em;line-height:1.4}',
    '.ilv-modal .ilv-qa-row dd{color:#1b2026;font-size:.84em;font-weight:700;text-align:right;white-space:pre-wrap;word-break:break-word}',
    '.ilv-modal .ilv-qa-row.is-sub{margin-left:14px;padding-left:10px;border-left:2px solid #f2c79b}',
    '.ilv-modal .ilv-qa-row.is-free{grid-template-columns:minmax(0,1fr)}',
    '.ilv-modal .ilv-qa-row.is-free dd{text-align:left;font-weight:400}',
    '.ilv-modal dl.ilv-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin:0 0 14px}',
    '.ilv-modal .ilv-fact{min-width:0;padding:8px 10px;border-radius:10px;background:#f7f9fb;border:1px solid #e6eaee}',
    '.ilv-modal .ilv-fact dt{font-size:.66em;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:#9a4100;margin:0 0 3px}',
    '.ilv-modal .ilv-fact dd{font-size:.86em;font-weight:700;color:#1b2026;word-break:break-word}',
    '.ilv-modal .ilv-fact dd .ilv-np{font-weight:400}',
    '.ilv-modal dl.ilv-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:0 14px;padding:4px 12px;border-radius:10px;background:#f7f9fb;border:1px solid #e6eaee}',
    '.ilv-modal .ilv-kv dt,.ilv-modal .ilv-kv dd{padding:6px 0;border-top:1px solid #e9edf1}',
    '.ilv-modal .ilv-kv dt:first-child,.ilv-modal .ilv-kv dt:first-child+dd,.ilv-modal .ilv-kv dd.ilv-kv-full:first-child{border-top:0}',
    '.ilv-modal .ilv-kv dt{font-size:.78em;font-weight:700;color:#5c6773;line-height:1.5}',
    '.ilv-modal .ilv-kv dd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.82em;color:#1b2026;line-height:1.5;word-break:break-word}',
    '.ilv-modal .ilv-kv dd.ilv-kv-full{grid-column:1/-1;font-family:inherit}',
    '.ilv-modal .ilv-kv dd .ilv-np{font-family:inherit}',
    '.ilv-modal .ilv-empty{padding:28px 16px;text-align:center;color:#5c6773;border:1px dashed #cdd4db;border-radius:12px;background:#fff}',
    '@media (max-width:519.98px){.ilv-modal .ilv-head{padding:14px 14px 12px 20px;gap:10px}.ilv-modal .ilv-head-ic{width:36px;height:36px}.ilv-modal h2.ilv-title{font-size:1.15em!important}.ilv-modal .ilv-body{padding:14px 12px 16px}.ilv-modal ol.ilv-tl{padding-left:20px}.ilv-modal ol.ilv-tl::before{left:5px}.ilv-modal .ilv-dot{left:-21px}.ilv-modal .ilv-ehead,.ilv-modal .ilv-ebody{padding-left:12px;padding-right:12px}.ilv-modal .ilv-acts{margin-left:0;width:100%}.ilv-modal .ilv-acts .ilv-btn{flex:1 1 0;justify-content:center}}',
    '@media (prefers-reduced-motion:reduce){.ilv-modal{animation:none}}'
  ].join('\n');
  function injectViewStyles(){
    if(document.getElementById('ile-view-css')) return;
    var st=document.createElement('style'); st.id='ile-view-css'; st.textContent=VIEW_CSS;
    document.head.appendChild(st);
  }
  return { markupHtml:markupHtml, mount:mount, injectStyles:injectStyles, injectViewStyles:injectViewStyles,
    renderLogBody:ilRenderLogBody, renderLogEntry:ilRenderLogEntry,
    parse:parseIncidentOutput, serialize:ilSerializeFields, build:buildIncidentOutput,
    setInvestigation:ilSetInvestigation, getInvestigation:ilGetInvestigation,
    setHistorical:ilSetHistorical, getHistorical:ilGetHistorical, setSim:ilSetSim, getSim:ilGetSim };
})();
if(typeof window!=='undefined') window.IncidentLogEditor=IncidentLogEditor;
if(typeof module!=='undefined' && module.exports) module.exports={ parseIncidentOutput:parseIncidentOutput, ilSerializeFields:ilSerializeFields,
  IL_INVEST_QS:IL_INVEST_QS, ilParseInvestigation:ilParseInvestigation, ilSerializeInvestigation:ilSerializeInvestigation, ilInvestMissing:ilInvestMissing,
  ilCopyMissing:ilCopyMissing, IL_HIST_FIELDS:IL_HIST_FIELDS, IL_HIST_MAX:IL_HIST_MAX, ilSimCnt:ilSimCnt,
  ilParseHistorical:ilParseHistorical, ilSerializeHistorical:ilSerializeHistorical, ilHistMissing:ilHistMissing,
  ilRenderLogBody:ilRenderLogBody, ilRenderLogEntry:ilRenderLogEntry,
  ilResFromSim:ilResFromSim, ilTicketCountry:ilTicketCountry, ilIsUsCa:ilIsUsCa, ilRegionKeptLines:ilRegionKeptLines,
  ilFieldCopyText:ilFieldCopyText, IL_SIM_FIELDS:IL_SIM_FIELDS, IL_SIM_DRIV:IL_SIM_DRIV, ilParseSim:ilParseSim,
  ilSerializeSim:ilSerializeSim, ilSimImport:ilSimImport, ilSimParseDate:ilSimParseDate, ilSimFmtDate:ilSimFmtDate, ilSimDriv:ilSimDriv,
  IL_SIM_HI_MAX:IL_SIM_HI_MAX, ilSimHiCount:ilSimHiCount, ilSimHiMissing:ilSimHiMissing,
  ilParseFullLog:ilParseFullLog, ilFullLogSummary:ilFullLogSummary,
  ilInvestDecidedFromSaved:ilInvestDecidedFromSaved, ilInvestDefaultKeys:ilInvestDefaultKeys,
  ilCopySimTitle:ilCopySimTitle, ilEmtNumber:ilEmtNumber, ilCopyNotes:ilCopyNotes,
  ilSevFromText:ilSevFromText, ilNormSeverity:ilNormSeverity, ilSplitCopyNotesRes:ilSplitCopyNotesRes,
  ilSetTicketRegion:ilSetTicketRegion, ilSetSavedSeverity:ilSetSavedSeverity, ilGetSeverity:ilGetSeverity,
  ilIsFlexDriv:ilIsFlexDriv, ilIsPetIncident:ilIsPetIncident, ilSimIssue:ilSimIssue };
