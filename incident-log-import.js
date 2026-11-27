// ====================================================================================
// Whole-log import parser for the structured incident log ("Import whole log" paste).
// Pure text analysis: NO DOM, no network, no globals read at load time — so it also runs under
// `node --test` (incident-log-import.test.js). The editor's dialog, review panel and tag chips stay
// in incident-log-editor.js; this file only turns a pasted log into fields plus a review report.
//
// Seven agent formats produce seven shapes of the same incident (see
// .agents/tasks/incident-log-import/format-spec.md): harisss (the canonical shape the log expects),
// nobregak, mboized, punithsd (Determination / PHD Findings / Evidence Details / Related Links /
// Risk Assessment prose), mellanej (box-drawn banners, bullet characters, deep indentation and its
// own structured metadata labels), flofalgu (prose, sometimes one unbroken paragraph, compound
// resolutions) and arunkzn (terse dash bullets, NO SIM Root Cause Details, a Created / Last modified
// trailer). detect() only picks the per-agent quirks (which trailer to strip, which link label is the
// PHD SIM, which heading opens an incident); extraction itself runs off the union of every label
// variant, so a log that scores `generic` still parses. One code path, not seven.
//
// The rules this file implements:
//   - NEVER invent an Issue type, a Root Cause or a Resolution. All three are closed catalogues
//     (window.IZ_CATS / RC_ROOT_CAUSES / RC_RESOLUTIONS, passed in as o.issues / o.rootCauses /
//     o.res): a value that is not in its catalogue leaves the field blank and is reported under
//     review().unmapped. The one mapping the spec states is "Parcel Box" -> "Parcel Box Installation".
//   - NEVER guess a "PHD Investigation for mitigation" answer. A structured checklist line wins
//     (api._ilfInvestKey / api._ilfAnswer), else the IL_EVIDENCE_RULES prose table, else the key stays
//     absent and is reported under review().blank. A rule whose answer is not one of the question's
//     own options is reported, not applied.
//   - The canonical Date is the INCIDENT date: outreach, EMT-record and Created / Last modified dates
//     are collected with their role and are never eligible (resolveDate).
//   - The PHD SIM is never a "Source Ticket:", an "LMIR Source Ticket:" or an
//     "Address Exclusion SIM raised:" link; the EMT id is read from incidentId=<digits> even when the
//     URL is truncated mid-querystring ("&tabV") and the canonical URL is rebuilt from it.
//   - Several incidents in one paste are never silently merged: every block is reported (blocks,
//     incidents[]) and only the first is applied.
//
// Injected api (the deps-injection pattern the server modules use; pass IncidentLogEditor, or bind it
// once with withApi(api)). Used at call time, never at load time, so there is no load-order coupling:
//   _ilsExact, _ilfInvestKey, _ilfAnswer, _ilfHeadKind, ilSimFmtDate, ilSimParseDate, ilSimDriv,
//   ilSimImport, ilParseSim, ilEmtNumber, ilSevFromText, IL_SIM_FIELDS, IL_INVEST_QS,
//   IL_EMT_URL_PRE, IL_EMT_URL_POST.
//
// Exports one global (window.PHDIncidentImport) / module.exports: normalise, detect, splitIncidents,
// splitSections, IL_IMP_LABELS, extractFields, resolveDate, mapResolution, IL_EVIDENCE_RULES,
// investFromProse, routeExtras, ilCaseTags, parse, review, withApi.
// ====================================================================================
(function (root) {

// ---- small text helpers ----
// A line as the matchers see it: ** stripped and trimmed; the bullet marker is KEPT (section bodies
// keep the agent's bullets, exactly as the editor's own importer writes them).
function _clean(l){ return String(l==null?'':l).replace(/\*\*/g,'').replace(/^[\s>]+/,'').replace(/\s+$/,''); }
var IL_IMP_BULLET=/^[-*\u2022\u2023\u25AA]\s+/;
function _nk(s){ return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,''); }
function _sq(s){ return String(s==null?'':s).replace(/\s+/g,' ').trim(); }
function _has(o,k){ return Object.prototype.hasOwnProperty.call(o,k); }
function _cut(s,n){ s=_sq(s); return s.length>n ? s.slice(0,n-1)+'\u2026' : s; }
function _rxEsc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
// "Label: rest" of a line (a leading bullet marker is ignored) -> {label, key, rest}; null when the
// line carries no label.
function _label(line){
  var m=_clean(line).replace(IL_IMP_BULLET,'').match(/^([^:]{1,72}?)\s*:[ \t]*(.*)$/);
  return m ? {label:_sq(m[1]), key:_nk(m[1]), rest:_sq(m[2])} : null;
}

// ---- 1. normalise ----
// Box drawing ([\u2500-\u257F], mellanej's separator runs) and \u00A0 are removed, the bullet
// characters and a leading "*" become "-", the Created / Last modified trailer is dropped (metadata,
// never content), separator-only lines go and runs of blank lines collapse to one.
var IL_IMP_TRAILER=/^(?:created|last\s*modified)\s*:.*\bby\s+[A-Za-z0-9._-]+@/i;
// The same trailer with its "by <alias>@" tail cut off by the agent: still metadata, never content,
// so normalise drops it on the label alone. Detection keeps the stricter form above.
var IL_IMP_TRAILER_BARE=/^(?:created|last\s*modified)\s*:/i;
function normalise(text){
  var s=String(text==null?'':text).replace(/\r\n?/g,'\n').replace(/\u00A0/g,' ').replace(/[\u2500-\u257F]/g,'');
  var out=[];
  s.split('\n').forEach(function(raw){
    var l=String(raw).replace(/\s+$/,'');
    l=l.replace(/^([ \t]*)[\u2022\u2023\u25AA\u25CF\u00B7](\s*)/,'$1- ').replace(/^([ \t]*)\*(?!\*)(\s+)/,'$1- ');
    var bare=l.replace(/\s/g,'');
    if(IL_IMP_TRAILER_BARE.test(_clean(l))) return;                  // metadata trailer
    if(!bare) { out.push(''); return; }
    if(/^(?:-{3,}|={3,}|_{3,}|\*{3,}|~{3,})$/.test(bare)) return;     // separator run
    out.push(l);
  });
  return out.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+/,'').replace(/\s+$/,'');
}

// ---- 2. detect ----
// Marker scoring, not author names. The format only selects pre-normalisation quirks (which heading
// opens an incident, which trailer to strip); it never gates extraction.
var IL_IMP_FORMATS=[
  {format:'harisss',  open:/^\s*(?:\*\*)?SIM Title\s*:/i, markers:[
    [/SIM Root Cause Details\s*:/i, 2, 'SIM Root Cause Details:'],
    [/PHD Investigation for mitigation/i, 2, 'PHD Investigation for mitigation:'],
    [/^\s*(?:\*\*)?PHD Related Link\s*:/im, 1, 'PHD Related Link:']]},
  {format:'mellanej', open:/^\s*OVERVIEW\s*$/m, markers:[
    [/[\u2500-\u257F]{3,}/, 2, 'box-drawing separator'],
    [/^\s*OVERVIEW\s*$/m, 2, 'OVERVIEW banner'],
    [/Evidence Checklist\s*:/i, 1, 'Evidence Checklist:'],
    [/Primary Mitigation Actioned\s*:/i, 1, 'Primary Mitigation Actioned:']]},
  {format:'arunkzn',  open:/^\s*(?:\*\*)?PHD Notes\s*:/im, markers:[
    [/^\s*(?:\*\*)?PHD Notes\s*:/im, 2, 'PHD Notes:'],
    [IL_IMP_TRAILER, 2, 'Created / Last modified trailer'],
    [/Address Exclusion SIM raised\s*:/i, 1, 'Address Exclusion SIM raised:']]},
  {format:'punithsd', open:/^\s*(?:\*\*)?PHD note\s*:/im, markers:[
    [/^\s*(?:\*\*)?PHD note\s*:/im, 2, 'PHD note:'],
    [/PHD ticket id\s*:/i, 2, 'PHD ticket id :'],
    [/Matrix Pathway\s*:/i, 1, 'Matrix Pathway:']]},
  {format:'mboized',  open:/^\s*(?:\*\*)?Determination\s*:/im, markers:[
    [/^\s*(?:\*\*)?EMT\s*:/im, 2, 'EMT:'],
    [/Matrix pathway\s*:/i, 1, 'Matrix pathway:']]},
  {format:'nobregak', open:/^\s*(?:\*\*)?Determination\s*:/im, markers:[
    [/Treatment Rationale\s*:/i, 2, 'Treatment Rationale:'],
    [/EMT Incident Report\s*:/i, 2, 'EMT Incident Report:'],
    [/^\s*(?:\*\*)?Determination\s*:/im, 1, 'Determination:']]},
  {format:'flofalgu', open:/The PHD Team has concluded/i, markers:[
    [/Incident as reported\s*:/i, 2, 'Incident as reported:'],
    [/Why this resolution\s*:/i, 2, 'Why this resolution:'],
    [/Re-?trigger\s*:/i, 1, 'Re-trigger:'],
    [/Customer statement\s*:/i, 1, 'Customer statement:']]}
];
function detect(text){
  var s=String(text==null?'':text), best={format:'generic', score:0, markers:[]};
  IL_IMP_FORMATS.forEach(function(f){
    var score=0, hit=[];
    f.markers.forEach(function(m){ if(m[0].test(s)){ score+=m[1]; hit.push(m[2]); } });
    if(score>best.score) best={format:f.format, score:score, markers:hit};
  });
  return best;
}
function _openRe(format){
  for(var i=0;i<IL_IMP_FORMATS.length;i++) if(IL_IMP_FORMATS[i].format===format) return IL_IMP_FORMATS[i].open;
  return /^\s*(?:\*\*)?Determination\s*:/i;
}

// ---- 3. splitIncidents ----
// One block per incident, cut at the detected format's opening heading. Returns
// [{index, heading, text}]; a paste with no repeated opening heading is one block. Text BEFORE the
// first opening heading (a greeting, an "Incident 1:" header, a reordered first section) is a
// preamble, not an incident: it stays with the first block, so the block count only ever rises on a
// genuine repeat of the opening heading.
function splitIncidents(text){
  var norm=normalise(text), open=_openRe(detect(text).format), lines=norm.split('\n'), at=[];
  lines.forEach(function(l,i){ if(open.test(_clean(l)) || open.test(l)) at.push(i); });
  if(!at.length) return norm.trim() ? [{index:0, heading:_cut(lines[0]||'',90), text:norm}] : [];
  var out=[];
  at.forEach(function(from,i){
    var start=i===0 ? 0 : from;
    var to=i+1<at.length ? at[i+1] : lines.length, body=lines.slice(start,to).join('\n').trim();
    if(body) out.push({index:out.length, heading:_cut(_clean(lines[from]),90), text:body});
  });
  return out;
}

// ---- 4. sections ----
// Heading kinds come from the editor's own table first (api._ilfHeadKind: sim / rootCause / findings /
// checklist / links / res / tag / determination / evidence / risk / notes / drop), then from the
// per-agent headings below. 'ref' = structured metadata with no canonical slot, 'notes' = narrative,
// 'unknown' = an unrecognised "Something:" heading (kept, routed to the notes bucket).
var IL_IMP_HEADS=[
  {re:/^phd investigation(?: for mitigation)?$/, kind:'invest'},
  {re:/^evidence$/, kind:'evidence'},
  {re:/^(?:matrix pathway|likelihood of (?:repeat|impact)|treatment rationale)$/, kind:'risk'},
  {re:/^(?:overview|assessment process|phd assessment notes|additional information)$/, kind:'notes'},
  {re:/^(?:incident as reported|customer statement|driver statement|assessment|why this resolution|re-?trigger)$/, kind:'notes'},
  {re:/^(?:outreach|immediate mitigation actions taken|historical findings)$/, kind:'notes'},
  {re:/^phd note$/, kind:'notes'},
  {re:/^resolution$/, kind:'res'},
  {re:/^(?:transporter records|customer records|additional links)$/, kind:'ref'}
];
// Headings that also appear mid-line (flofalgu writes a whole log as one paragraph). Matched
// case-insensitively, but only where the text before ends in sentence punctuation or its last word is
// capitalised — so "Why this resolution:" is not split again on its own "resolution:".
var IL_IMP_INLINE=['Resolution','Determination','Incident as reported','Customer statement','Driver statement',
  'Evidence','Evidence Details','Assessment','Why this resolution','Re-trigger','Root Cause','PHD Findings',
  'Related Links','Risk Assessment','Treatment Rationale','PHD Resolution','Primary Case Tag','PHD notes'];
var _inlineRe=new RegExp('(' + IL_IMP_INLINE.map(_rxEsc).join('|') + ')\\s*:\\s', 'gi');
function _splitInline(line){
  var s=String(line), out=[], from=0, m;
  _inlineRe.lastIndex=0;
  while((m=_inlineRe.exec(s))){
    if(m.index<=from){ continue; }
    var before=s.slice(from,m.index), prev=(before.match(/([A-Za-z]+)[^A-Za-z]*$/)||[])[1];
    var ok=/[:.;!?)\]"']\s*$/.test(before) || (prev && /^[A-Z]/.test(prev));
    // "- Primary Root Cause:" / "Secondary Root Causes:" are labels of their own: never cut them in two.
    if(_IL_IMP_FIELD_IDX[_nk(_clean(before).replace(IL_IMP_BULLET,'')+m[1])]) ok=false;
    if(!ok) continue;
    out.push(before); from=m.index;
  }
  if(!out.length) return [s];
  out.push(s.slice(from));
  return out.filter(function(x){ return String(x).trim(); });
}
function _headKind(name,api){
  var n=_sq(name).toLowerCase().replace(/\s*:$/,'');
  var k=(api && typeof api._ilfHeadKind==='function') ? api._ilfHeadKind(n) : null;
  if(k) return k;
  for(var i=0;i<IL_IMP_HEADS.length;i++) if(IL_IMP_HEADS[i].re.test(n)) return IL_IMP_HEADS[i].kind;
  return null;
}
// Normalised text -> [{title, kind, known, lines:[cleaned], raw:[as pasted]}]. The text before the
// first heading is one 'intro' section.
function splitSections(text,api){
  var cur={title:'', kind:'intro', known:false, lines:[], raw:[]}, secs=[cur];
  normalise(text).split('\n').forEach(function(line){
    _splitInline(line).forEach(function(part){
      var c=_clean(part);
      if(!c){ if(cur.lines.length){ cur.lines.push(''); cur.raw.push(''); } return; }
      var isBullet=IL_IMP_BULLET.test(c), lb=_label(c), k=null, title='';
      if(!isBullet){
        if(lb){ k=_headKind(lb.label,api); title=lb.label; }
        else if(/^[A-Z][A-Z /&-]{3,}$/.test(c)){ k=_headKind(c,api); title=c; }
        if(!k && lb && !lb.rest && lb.label.split(/\s+/).length<=8 && !/^HI\s*\d+$/i.test(lb.label)) { k='unknown'; title=lb.label; }
      }
      if(k && !(k==='unknown' && _IL_IMP_FIELD_IDX[lb.key])){
        cur={title:title, kind:k, known:k!=='unknown', lines:[], raw:[]};
        secs.push(cur);
        if(lb && lb.rest){ cur.lines.push(lb.rest); cur.raw.push(lb.rest); }
        return;
      }
      cur.lines.push(c); cur.raw.push(String(part).replace(/\s+$/,''));
    });
  });
  return secs.filter(function(s){ return s.title || s.lines.join('').trim(); });
}

// ---- 5. labels ----
// The union of every label variant in format-spec.md §2, in priority order per field: the first
// label of a field that is found with a value wins, so a canonical "Res:" beats a prose
// "Primary Mitigation Actioned:". `link` fields only accept a line that really carries the id/URL.
var IL_IMP_LABELS=[
  {field:'simTitle', labels:['SIM Title','Title']},
  {field:'phdSim',   link:'sim', labels:['PHD Related Link','PHD SIM','PHD SIM Ticket','PHD ticket id','PHD Ticket','PHD note','PHD SIM Link']},
  {field:'emt',      link:'emt', labels:['EMT Link','EMT Incident Report','EMT Incident','EMT','EMT Report']},
  {field:'emtRelated', link:'emt', labels:['Related EMT Report']},
  {field:'rootCause', labels:['Root Cause','Primary Root Cause']},
  {field:'rootCause2', labels:['Secondary Root Causes','Secondary Root Cause']},
  {field:'Issue',    labels:['Issue','Issue type','Incident type']},
  {field:'SID',      labels:['SID','Station','Station ID','Station code']},
  {field:'Driv',     labels:['Driv','Driver Type','Driver']},
  {field:'Date',     labels:['Date','Incident Date','Date of Incident']},
  {field:'TID',      labels:['TID','Transporter ID','Transporter']},
  {field:'Zip',      labels:['Zip','Zip code','Zipcode','Postal code']},
  {field:'Cnt',      labels:['Cnt','Count','Historical Incident Count','Historical incidents']},
  {field:'CID',      labels:['CID','Customer ID','Customer Account ID','Account ID','AID']},
  {field:'UPID',     labels:['UPID','Unit Place ID']},
  {field:'res',      labels:['Res','PHD Resolution','Resolution','Primary Mitigation Actioned']},
  {field:'resAdd',   labels:['Additional Mitigations Actioned','Additional Mitigation Actioned']},
  {field:'severity', labels:['Severity','Sev']}
];
// normalised label -> {field, rank}; the rank is the label's position in its own list.
var _IL_IMP_FIELD_IDX=(function(){
  var m={};
  IL_IMP_LABELS.forEach(function(d){ d.labels.forEach(function(l,i){ var k=_nk(l); if(!m[k]) m[k]={field:d.field, rank:i, link:d.link||''}; }); });
  return m;
})();
// Labels that are a link but NEVER the PHD SIM (spec §2 "Source / LMIR ticket").
var IL_IMP_LINK_DENY=/^(?:source ticket|lmir source ticket|address exclusion sim raised|related emt report|dxp escalation ticket|paw print sim link)/i;
var IL_IMP_TID_RE=/\bTransporter\s+(A[A-Z0-9]{9,19})\b/;
var IL_IMP_SID_RE=/\b(?:delivering\s+)?out of\s+([A-Z]{2,4}\d{1,2})\b/;
var IL_IMP_UPID_RE=/Unit Place ID\s*\(\s*([A-Z]{2,3}\d{6,18})\s*\)/i;
var IL_IMP_CID_RE=/\(\s*CID\s*:?\s*([A-Z0-9]{10,20})\s*\)/i;
var IL_IMP_ZIP_RE=/\bin the ([A-Z0-9][A-Z0-9]{2,9}(?: ?[A-Z0-9]{3})?)[ -]?ZIP code\b/i;
var IL_IMP_SIM_ID_RE=/\b([VD]\d{9,10})\b/;
// Historical-incident count from prose (spec §2 "Cnt"); the value is the capture, 'zero' -> 0.
var IL_IMP_CNT_RULES=[
  /confirmed historical incident count at the address is (zero|\d+)/i,
  /confirmed number of previous incidents at the address is (zero|\d+)/i,
  /(zero|no) confirmed historical incidents are on record/i,
  /(no) prior incidents (?:for|from) the customer/i,
  /(no) prior incidents (?:are |were )?(?:on record|noted)/i,
  /(first) time incident/i,
  /(no) historical safety concerns identified/i
];
// Driver type from prose. 'N/A' = the log names a DA / DP without saying which (never guessed).
var IL_IMP_DRIV_RULES=[
  [/\bDSP\s+DA\b/i, 'DSP DA'], [/\bHub\s+DA\b/i, 'Hub DA'],
  [/\bFlex\s+(?:Delivery\s+Partner|DP|Driver)\b/i, 'Flex DP'], [/\bFLEX\s+DP\b/, 'Flex DP'],
  [/\b(?:the|a)\s+(?:DP|DA|Delivery Partner|Delivery Associate)\b/i, 'N/A']
];
// text -> {values:{field:value}, sources:{field:line}, hits:{field:[{label,value,line}]}}.
// Only a label hit that yields a usable value is recorded; prose patterns fill what no label did.
function extractFields(text,o){
  o=o||{}; var api=o.api||{}, norm=normalise(text), cl=[], hits={}, values={}, sources={};
  norm.split('\n').forEach(function(l){ _splitInline(l).forEach(function(p){ cl.push(_clean(p)); }); });
  var isLabel=function(line){ var lb=_label(line); return !!(lb && _IL_IMP_FIELD_IDX[lb.key]); };
  cl.forEach(function(line,i){
    var lb=_label(line); if(!lb) return;
    var d=_IL_IMP_FIELD_IDX[lb.key]; if(!d) return;
    var val=lb.rest;
    if(!val){                                    // "Root Cause:" / "PHD Resolution:" with the value on the next line
      for(var j=i+1;j<cl.length && j<=i+3;j++){
        if(!cl[j]) continue;
        if(isLabel(cl[j]) || _headKind(((_label(cl[j])||{}).label)||cl[j],api)) break;
        val=cl[j]; break;
      }
    }
    if(!val || val==='-') return;
    if(d.link==='sim'){
      if(IL_IMP_LINK_DENY.test(lb.label)) return;
      var sid=IL_IMP_SIM_ID_RE.exec(val);
      if(!sid || !/t\.corp\.amazon\.com|^\s*[VD]\d{9,10}\s*$/i.test(val)) return;
      val='https://t.corp.amazon.com/issues/'+sid[1];
    } else if(d.link==='emt'){
      var id=(typeof api.ilEmtNumber==='function' ? api.ilEmtNumber([val]) : '') || (/^\d{5,10}$/.test(val) ? val : '');
      if(!id) return;
      val=id;
    }
    (hits[d.field]=hits[d.field]||[]).push({label:lb.label, value:val, line:line, rank:d.rank, at:i});
  });
  Object.keys(hits).forEach(function(f){
    var list=hits[f].slice().sort(function(a,b){ return a.rank-b.rank || a.at-b.at; });
    values[f]=list[0].value; sources[f]=list[0].label+': '+_cut(list[0].value,120);
  });
  // ---- prose fallbacks (only where no label answered) ----
  var set=function(f,v,src){ if(!values[f] && v){ values[f]=_sq(v); sources[f]=_cut(src,140); } };
  var find=function(re){ var m=re.exec(norm); return m ? m : null; };
  var m;
  if((m=find(IL_IMP_SID_RE))) set('SID', m[1].toUpperCase(), m[0]);
  if((m=find(IL_IMP_TID_RE))) set('TID', m[1], m[0]);
  if((m=find(IL_IMP_UPID_RE))) set('UPID', m[1], m[0]);   // "Address ID (…)" is a DIFFERENT id and is never read here
  if((m=find(IL_IMP_CID_RE))) set('CID', m[1], m[0]);
  if((m=find(IL_IMP_ZIP_RE))) set('Zip', m[1], m[0]);
  if(!values.Driv){
    for(var i=0;i<IL_IMP_DRIV_RULES.length;i++){
      var dm=IL_IMP_DRIV_RULES[i][0].exec(norm);
      if(dm){ set('Driv', IL_IMP_DRIV_RULES[i][1], dm[0]); break; }
    }
  }
  if(!values.Cnt){
    for(var c=0;c<IL_IMP_CNT_RULES.length;c++){
      var cm=IL_IMP_CNT_RULES[c].exec(norm);
      if(cm){ set('Cnt', /^\d+$/.test(cm[1]) ? cm[1] : '0', cm[0]); break; }
    }
  }
  if(/^n\/?a$/i.test(String(values.Cnt||''))) { values.Cnt='0'; }
  // A bare t.corp link with no label at all is still the PHD SIM — but never one on a Source Ticket /
  // LMIR Source Ticket / Address Exclusion SIM line.
  if(!values.phdSim){
    for(var bi=0;bi<cl.length;bi++){
      var blb=_label(cl[bi]);
      if(blb && (IL_IMP_LINK_DENY.test(blb.label) || _isRefLine(blb.label))) continue;
      var bm=/https?:\/\/t\.corp\.amazon\.com\/(?:issues\/)?([VD]\d{9,10})\b/i.exec(cl[bi]);
      if(bm){ values.phdSim='https://t.corp.amazon.com/issues/'+bm[1]; sources.phdSim=_cut(cl[bi],140); break; }
    }
  }
  // The SIM Title carries the Account ID (-> CID) and the Issue after "- Sev N - ".
  if(values.simTitle){
    var am=/Account ID\s*:\s*([A-Z0-9]{10,20})/i.exec(values.simTitle);
    if(am) set('CID', am[1], values.simTitle);
    var im=/-\s*Sev(?:erity)?\s*[1-5]\s*-\s*(.+)$/i.exec(values.simTitle);
    if(im) set('Issue', im[1].replace(/[.\s]+$/,''), values.simTitle);
  }
  // The SIM Root Cause Details section, when the log has one, wins over everything above.
  var sec=splitSections(norm,api).filter(function(s){ return s.kind==='sim'; });
  if(sec.length && typeof api.ilParseSim==='function'){
    var body=sec.map(function(s){ return s.lines.join('\n'); }).join('\n');
    var found=api.ilParseSim(body,{aliases:true}).found||{};
    Object.keys(found).forEach(function(k){
      if(!_IL_IMP_FIELD_IDX[_nk(k)] || !found[k] || found[k]==='-') return;
      values[k]=_sq(found[k]); sources[k]='SIM Root Cause Details \u2014 '+k+': '+_cut(found[k],90);
    });
  }
  return {values:values, sources:sources, hits:hits};
}

// ---- 6. resolveDate ----
// Every date in the paste is collected with a role; only 'incident' is eligible and the earliest of
// those wins. A prose date counts as the incident date only when it reads as "… on <date>" (or opens
// a findings bullet) AND the line does not pin the date to something else (an instruction applied /
// updated / added, an outreach or reassurance contact, a count of prior deliveries).
var IL_IMP_DATE_RE=/(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})|(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\s?[A-Za-z]{3,9}'?\s?\d{2,4})|([A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})/g;
var IL_IMP_DATE_LABELS={date:'incident', incidentdate:'incident', dateofincident:'incident',
  dateofemtincident:'emtRecord', datenewinstructionsadded:'other', created:'metadata', lastmodified:'metadata'};
var IL_IMP_OUTREACH_RE=/outreach|reassur|voicemail|successful outreach|responded via email|called the cx|sent an email|lmir/i;
var IL_IMP_NOT_INCIDENT_RE=/\bapplied\b|\bupdated\b|\badded\b|\bsince\b|\bconfirm|\bprior\b|\bpast\b|\bpreviously\b|\bdeliveries\b|\borders\b|\bexclusion\b/i;
function resolveDate(text,o){
  o=o||{}; var api=o.api||{}, fmt=(typeof api.ilSimFmtDate==='function') ? api.ilSimFmtDate : function(){ return ''; };
  var parse1=(typeof api.ilSimParseDate==='function') ? api.ilSimParseDate : function(){ return null; };
  var secs=o.secs || splitSections(text,api), cands=[];
  var add=function(role,raw,line){
    var v=fmt(raw); if(!v) return;
    var p=parse1(raw), key=p ? (p.y*10000+p.m*100+p.d) : 0;
    cands.push({role:role, value:v, raw:_sq(raw), line:_cut(line,140), sort:key});
  };
  secs.forEach(function(s){
    var proseOk=s.kind==='determination' || s.kind==='findings' || /incident as reported/i.test(s.title||'');
    s.lines.forEach(function(line){
      if(!line) return;
      var lb=_label(line), role=lb ? IL_IMP_DATE_LABELS[lb.key] : null;
      if(role){
        IL_IMP_DATE_RE.lastIndex=0;
        var lm=IL_IMP_DATE_RE.exec(lb.rest||line);
        if(lm) add(role, lm[0], line);
        return;
      }
      var out=IL_IMP_OUTREACH_RE.test(line), skip=IL_IMP_NOT_INCIDENT_RE.test(line), m;
      IL_IMP_DATE_RE.lastIndex=0;
      while((m=IL_IMP_DATE_RE.exec(line))){
        var before=line.slice(0,m.index), onDate=/\bon\s+(?:the\s+)?$/i.test(before) || !/\S/.test(before);
        if(out) add('outreach', m[0], line);
        else if(proseOk && onDate && !skip) add('incident', m[0], line);
        else add('other', m[0], line);
      }
    });
  });
  var inc=cands.filter(function(c){ return c.role==='incident'; })
    .sort(function(a,b){ return a.sort-b.sort; });
  return {value: inc.length ? inc[0].value : '', source: inc.length ? inc[0].line : '',
    role: inc.length ? 'incident' : '', candidates:cands};
}

// ---- 7. mapResolution ----
// The 12 window.RC_RESOLUTIONS values, matched case / whitespace / hyphen-insensitively ("Customer
// reassurance", "driver follow up"). The ONE mapping the spec states is applied; everything else that
// is not in the catalogue ("Driver Misconduct Reported", "Driver Education", "Blocking Place ID",
// "Delivery Instruction") is reported, never mapped onto a neighbour. A compound ("A + B") keeps its
// first piece as the primary (blank when that piece is not in the catalogue) and the rest as additional.
var IL_IMP_RES_MAP={parcelbox:'Parcel Box Installation'};
var IL_IMP_RES_PROSE=[/resolving the (?:phd )?sim as ([a-z][a-z \-]+?)\s*(?:[.,;]|$)/i,
  /going ahead with(?: (?:an|a|the))? ([a-z][a-z \-]+?)\s*(?:[.,;]|$)/i,
  /\bactioned (?:an |a )?([a-z][a-z \-]+?) as the primary mitigation/i];
function _resKey(v){ return String(v==null?'':v).toLowerCase().replace(/[^a-z0-9]/g,''); }
function _resOne(piece,list){
  var t=_sq(String(piece).replace(/\*\*/g,'').replace(/\(\s*primary\s*\)/ig,' ').replace(/^[-*\u2022\s]+/,'')).replace(/[\s.]+$/,'');
  if(!t) return null;
  var k=_resKey(t);
  if(IL_IMP_RES_MAP[k]) return {value:IL_IMP_RES_MAP[k], raw:t};
  for(var i=0;i<(list||[]).length;i++) if(_resKey(list[i])===k) return {value:list[i], raw:t};
  return {value:'', raw:t};
}
// raw (+ o.additional raw, o.text for arunkzn's prose) -> {primary, additional:[], unmapped:[], raw}.
function mapResolution(raw,o){
  o=o||{}; var list=o.res||[], text=String(raw==null?'':raw), out={primary:'', additional:[], unmapped:[], raw:_sq(text)};
  if(!text.trim() && o.text){
    for(var p=0;p<IL_IMP_RES_PROSE.length;p++){
      var pm=IL_IMP_RES_PROSE[p].exec(String(o.text));
      if(pm){ text=pm[1]; out.raw=_sq(pm[0]); break; }
    }
  }
  var pieces=String(text).replace(/\s+and\s+/ig,' + ').split(/\s*[+,;]\s*/);
  pieces.concat(String(o.additional==null?'':o.additional).split(/\s*[+,;]\s*/)).forEach(function(piece,i){
    var r=_resOne(piece,list); if(!r) return;
    if(!r.value){ out.unmapped.push(r.raw); return; }
    if(!out.primary && i===0) out.primary=r.value;
    else if(out.additional.indexOf(r.value)<0 && r.value!==out.primary) out.additional.push(r.value);
  });
  return out;
}

// ---- 8. the "PHD Investigation for mitigation" autofill ----
// One row per spec §3 mapping-table line, keyed on the IL_INVEST_QS keys. Order matters: the first
// match per key wins, so a "No" phrasing that contains the "Yes" words is listed first. `sub` carries
// the matched sentence into the question's sub-answer; `qualifier` keeps the agent's wording for the
// review. A rule NEVER produces a default: a key with no match stays absent.
var IL_EVIDENCE_RULES=[
  {key:'dup', value:'Yes', re:/identified a duplicate (?:report|sim)|duplicate sim identification|duplicate report \([VD]\d/i},
  {key:'poi', value:'No', re:/POI is the package recipient, not the ordering customer|POI is an unidentified community member|community member is not the account holder|CX is not POI|POI was an unidentified neigh\w+|POI was a household member, not the account holder|the CM is not identified/i},
  {key:'poi', value:'Unverified', re:/person of interest remains unverified|POI was never confirmed/i},
  {key:'poi', value:'Yes', re:/POI Identified\s*:\s*Yes|is POI the CX\s*:\s*Yes/i},
  {key:'susp', value:'Yes', re:/found the threat credible and suspended the CX|account unlock|placed the account back on hold|CX Account Suspension Requested\s*:\s*Yes/i},
  {key:'negFb', value:'', re:/(\d+)\s+conduct related items/i, num:1},
  {key:'negFb', value:'0', re:/Transporter Records\s*:?\s*[\s\S]{0,40}No Historical Safety Concerns Identified/i},
  {key:'locSim', value:'0', re:/no prior incidents are on record at this address/i},
  {key:'locEmt', value:'0', re:/no (?:other )?(?:complaints|incidents)[^.]*\bEMT\b[^.]*\brecords\b/i},
  {key:'cortex', value:'No', re:/No driver trace could be located/i},
  {key:'cortex', value:'Yes', re:/Cortex Driver Trace|Cortex driver trace and heat map|location trace placed the DA at the correct delivery location|Driver trace shows|Driver Trace confirms|as per the cortex/i},
  {key:'clear', value:'N/A', re:/CLEAR Report Conducted\s*:\s*Not Applicable|CLEAR is not applicable|Cant check CLEAR|Netradyne and CLEAR are not available/i},
  {key:'clear', value:'Yes (Dated older than 10 years)', re:/Yes \(Dated older than 10 years\)/i},
  {key:'clear', value:'No', re:/did NOT reveal a violent criminal background|did not identify a documented history of violent offenses|No criminal history for the customer|Only traffic\w* related offences/i},
  {key:'clear', value:'Yes', re:/did reveal a violent criminal background|significant violent criminal background|found a violent criminal background|offence related to Sex offender|Charged with violence-related disorderly misconduct/i},
  {key:'station', value:'Yes', re:/action item was sent to Station Leadership|Station Leadership was actioned in AUSTIN|action item to Station Leadership|Station Request\s*:\s*Yes/i},
  {key:'netra', value:'N/A', re:/Netradyne is not applicable|Netradyne and CLEAR are not available for this region|Cant check CLEAR and NETRADYNE/i},
  {key:'netra', value:'No', re:/Netradyne footage could not be played because of a technical issue/i, sub:'netraInfo', qualifier:true},
  {key:'netra', value:'No', re:/No Netradyne footage available|Netradyne footage (?:and audio )?were not supplied|Netradyne was checked, and no video of the incident was found|no usable video found|no video of the incident was found|no available video evidence/i},
  {key:'netra', value:'Yes', re:/Photo\/Video Evidence Obtained\s*:\s*Netradyne|Netradyne footage retrieved/i},
  {key:'addPkg', value:'Yes', re:/deliveries have been completed to this address since the reported incident|(?:one|two|three|four|five|\d+) deliver(?:y|ies) (?:has|have) (?:since )?been completed|\d+ new orders placed in the account post the incident|(?:two|three|\d+) more were delivered after the incident/i},
  {key:'di', value:'No', re:/No delivery instructions noted|Delivery Instructions? Prior to Incident\s*:\s*No|no delivery instructions or preferred delivery location on record/i},
  {key:'di', value:'N/A', re:/Delivery Instructions? Prior to Incident\s*:\s*Not Applicable/i},
  {key:'di', value:'Yes', re:/Delivery Instructions? Prior to Incident\s*:\s*Yes|Delivery instructions? noted\s*:\s*"|account delivery instruction directs the transporter|The delivery instructions ask that/i},
  {key:'diUpd', value:'Yes', re:/New Instructions Added Post-Incident\s*:\s*Yes|(?:customer|CX) has since added delivery instructions|CX updated the delivery notes to read|updated by LMIR per the CX's request/i},
  {key:'austin', value:'Yes', re:/Station leadership completed an AUSTIN investigation|Station Leadership was actioned in AUSTIN/i}
];
function _investDefs(api){
  var defs={}, qs=(api && api.IL_INVEST_QS) || [];
  qs.forEach(function(q){ defs[q.key]=q; if(q.sub) defs[q.sub.key]=q.sub; if(q.poiWho) defs[q.poiWho.key]=q.poiWho; });
  return defs;
}
// An answer only applies when it is one of the question's own options (a number for a number
// question). Anything else is reported, never applied — that is the "never invent" rule.
function _investOk(def,v){
  if(!def || v==null || v==='') return false;
  if(def.type==='number') return /^\d+$/.test(String(v));
  if(def.type==='text' || def.type==='textarea') return true;
  return (def.opts||[]).indexOf(v)>=0;
}
function _sentence(s,at){
  var from=s.lastIndexOf('.',at), nl=s.lastIndexOf('\n',at);
  from=Math.max(from,nl)+1;
  var to=s.indexOf('.',at); if(to<0) to=s.length;
  var nl2=s.indexOf('\n',at); if(nl2>=0 && nl2<to) to=nl2;
  return _sq(s.slice(from,to+1));
}
// prose -> {answers:{key:value}, qualifiers:{key:wording}, unmapped:[{field,raw,catalogue}]}.
function investFromProse(text,o){
  o=o||{}; var api=o.api||{}, defs=_investDefs(api), s=normalise(text);
  var out={}, quals={}, unmapped=[], done={};
  IL_EVIDENCE_RULES.forEach(function(r){
    if(done[r.key]) return;
    var m=r.re.exec(s); if(!m) return;
    var val=r.num!=null ? String(parseInt(m[r.num],10)) : r.value;
    var def=defs[r.key];
    if(!_investOk(def,val)){
      done[r.key]=true;
      unmapped.push({field:(def&&def.label)||r.key, raw:_sq(m[0]), catalogue:(def&&def.opts)||[]});
      return;
    }
    done[r.key]=true; out[r.key]=val;
    if(r.sub && defs[r.sub]) out[r.sub]=_sentence(s,m.index);
    if(r.qualifier || r.sub) quals[r.key]=_sq(m[0]);
  });
  return {answers:out, qualifiers:quals, unmapped:unmapped};
}
// Structured "- <Question>: <Answer>" lines anywhere in the paste, through the editor's own
// _ilfInvestKey / _ilfAnswer. These take precedence over the prose rules.
function _investStructured(text,api){
  var out={}, defs=_investDefs(api);
  if(typeof api._ilfInvestKey!=='function' || typeof api._ilfAnswer!=='function') return out;
  normalise(text).split('\n').forEach(function(line){
    var lb=_label(_clean(line)); if(!lb || !lb.rest) return;
    var k=api._ilfInvestKey(lb.label); if(!k || _has(out,k)) return;
    var v=api._ilfAnswer(defs[k], lb.rest);
    if(v!=null && _investOk(defs[k],v)) out[k]=v;
  });
  return out;
}

// ---- 9. extras routing ----
// Determination / Evidence Details / Risk Assessment keep their own existing fields (the editor's
// IL_EXTRA_SECS); narrative sections go to PHD Notes; structured metadata with no canonical slot goes
// to the "ONLY FOR PHD REFERENCE WILL NOT BE COPIED" field, each under its own "**<heading>**" block
// with the agent's wording preserved. Created / Last modified are already dropped by normalise().
var IL_IMP_REF_LINES=['geopins accurate','geopin update requested','geopin ids updated','geopin update notes',
  'geofence perimeter accurate','geofence update requested','geofence ids updated','geofence update notes',
  'pet related incident','vaccination records obtained','dog risk level','preferred delivery location',
  'poi identified','contact established with poi','da follow up completed in emt','driver follow up action item details',
  'dp wellness check','secondary root causes','secondary root cause','additional mitigations actioned',
  'source ticket','lmir source ticket','address exclusion sim raised','related emt report',
  'photo video evidence','incomplete action item outreach conducted','evidence checklist','transporter records'];
function _isRefLine(label){
  var n=_sq(String(label).toLowerCase()).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ');
  for(var i=0;i<IL_IMP_REF_LINES.length;i++) if(n.indexOf(IL_IMP_REF_LINES[i])===0) return true;
  return false;
}
function _block(title,lines){
  var body=lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  if(!body && !title) return '';
  return (title ? '**'+_sq(title).replace(/\s*:$/,'')+':**\n' : '')+body;
}
// sections -> {findings, determination, evidence, risk, notes, reference, invest:[lines], known}
function routeExtras(secs){
  var fin=[], extra={determination:[], evidence:[], risk:[]}, notes=[], ref=[], inv=[], known=0;
  var bullet=function(l){ return String(l).replace(/^(\s*)[*\u2022]\s+/,'$1- '); };
  secs.forEach(function(s){
    if(s.known) known++;
    var keep=[], pulled=[];
    s.lines.forEach(function(l){
      var lb=_label(l);
      if(lb && lb.rest && _isRefLine(lb.label)){ pulled.push(_block(lb.label,[lb.rest])); return; }
      keep.push(l);
    });
    var body=keep.map(bullet).join('\n').replace(/\n{3,}/g,'\n\n').trim();
    var head=_sq(s.title).replace(/\s*:$/,'').toLowerCase();
    if(s.kind==='findings'){ if(body) fin.push(body); }
    else if(extra[s.kind]){
      // Likelihood of Repeat / Likelihood of Impact / Matrix pathway / Treatment Rationale are their
      // own headings in several formats: they fold into the Risk Assessment body, heading and all.
      var own=head && head!=='determination' && head!=='evidence' && head!=='evidence details' && head!=='risk assessment';
      if(body) extra[s.kind].push(own ? _block(s.title,keep.map(bullet)) : body);
    }
    else if(s.kind==='invest'){ inv=inv.concat(keep); }
    else if(s.kind==='res'){
      // The first line is the resolution value itself (a field); only what follows is a note.
      var rl=keep.slice(), fi=-1;
      for(var ri=0;ri<rl.length;ri++){ if(String(rl[ri]).trim()){ fi=ri; break; } }
      if(fi>=0) rl.splice(fi,1);
      var rb=_block(s.title,rl.map(bullet)); if(rl.join('').trim() && rb) notes.push(rb);
    }
    else if(s.kind==='sim' || s.kind==='rootCause' || s.kind==='drop'){ /* handled as fields */ }
    else if(s.kind==='tag' || s.kind==='ref' || s.kind==='checklist'){ var b=_block(s.title,keep); if(b) ref.push(b); }
    else if(s.kind==='links'){
      var left=keep.filter(function(l){ return !/t\.corp\.amazon\.com|app\.emt\.amazon\.dev/i.test(l) || _isRefLine((_label(l)||{}).label||''); });
      var lb2=_block(s.title,left); if(lb2) ref.push(lb2);
    }
    else if(s.kind==='intro'){ var ib=_block('',keep); if(ib) ref.push(ib); }
    else { var nb=_block(s.title,keep.map(bullet)); if(nb) notes.push(nb); }
    if(pulled.length) ref=ref.concat(pulled);
  });
  return {findings:fin.join('\n\n').trim(), determination:extra.determination.join('\n\n').trim(),
    evidence:extra.evidence.join('\n\n').trim(), risk:extra.risk.join('\n\n').trim(),
    notes:notes.join('\n\n').trim(), reference:ref.join('\n\n').trim(), invest:inv, known:known};
}

// ---- 10. case tags ----
// The "Primary Case Tag" block's #tags, in order, or the literal "No Hashtag Applicable". Pure and
// shared with the editor's copyable chip row, which calls it on the reference text (so the chips
// survive save -> reopen with no format change).
function ilCaseTags(text){
  var lines=String(text==null?'':text).replace(/\r\n?/g,'\n').split('\n'), out=[], seen={}, inTag=false, blank=0;
  lines.forEach(function(raw){
    var c=_clean(raw), lb=_label(c);
    if(lb && /^primary ?case ?tags?$/.test(_sq(lb.label).toLowerCase().replace(/[^a-z ]/g,''))){
      inTag=true; blank=0;
      if(lb.rest) _tagsOf(lb.rest,out,seen);
      return;
    }
    if(!inTag) return;
    if(!c){ if(++blank>1) inTag=false; return; }
    if(lb && !lb.rest){ inTag=false; return; }           // the next heading ends the block
    if(!_tagsOf(c,out,seen) && out.length) inTag=false;
  });
  return out;
}
function _tagsOf(line,out,seen){
  var m=String(line).match(/#[A-Za-z0-9][A-Za-z0-9_-]*/g), n=0;
  (m||[]).forEach(function(t){ if(!seen[t]){ seen[t]=1; out.push(t); n++; } });
  if(!m && /no hashtag applicable/i.test(line) && !seen._none){ seen._none=1; out.push('No Hashtag Applicable'); n++; }
  return n>0;
}

// ---- 11. parse / review ----
var IL_IMP_LABEL_TEXT={Issue:'SIM \u2014 Issue', SID:'SIM \u2014 SID', Driv:'SIM \u2014 Driv', Date:'SIM \u2014 Date',
  TID:'SIM \u2014 TID', Zip:'SIM \u2014 Zip', Cnt:'SIM \u2014 Cnt', CID:'SIM \u2014 CID', UPID:'SIM \u2014 UPID', Res:'SIM \u2014 Res',
  rootCause:'Root Cause', res:'PHD Resolution', phdSimLink:'PHD Related Link', emtLink:'EMT Link', severity:'Severity',
  findings:'PHD Findings', determination:'Determination', evidence:'Evidence Details', risk:'Risk Assessment',
  notes:'PHD notes', reference:'PHD reference (not copied)'};
// The questionnaire keys the review reports on (the spec §3 table), in question order.
var IL_IMP_INVEST_KEYS=['dup','poi','susp','negFb','histCx','locSim','cortex','locEmt','clear','station','netra','addPkg','di','diUpd','austin'];
// text + {rootCauses, issues, res, api} -> the whole import. Several incidents: every block is
// reported and only the first is applied.
function parse(text,o){
  o=o||{}; var api=o.api||{}, raw=String(text==null?'':text);
  var det=detect(raw), all=splitIncidents(raw);
  var block=all.length ? all[0].text : normalise(raw);
  var secs=splitSections(block,api);
  var ex=routeExtras(secs);
  var fx=extractFields(block,{api:api});
  var v=fx.values, src=fx.sources;
  var dr=resolveDate(block,{api:api, secs:secs});
  if(!v.Date && dr.value){ v.Date=dr.value; src.Date=dr.source; }
  // Investigation: structured checklist lines win over the prose rules.
  var pro=investFromProse(block,{api:api}), st=_investStructured(block,api), inv={}, quals={};
  Object.keys(pro.answers).forEach(function(k){ inv[k]=pro.answers[k]; });
  Object.keys(pro.qualifiers).forEach(function(k){ quals[k]=pro.qualifiers[k]; });
  Object.keys(st).forEach(function(k){ inv[k]=st[k]; delete quals[k]; });
  // Cnt also comes from the "Historical incidents against CX in SIM" answer when no label / prose did.
  if(!v.Cnt && /^\d+$/.test(String(inv.histCx||''))){ v.Cnt=String(inv.histCx); src.Cnt='Historical incidents against CX in SIM: '+inv.histCx; }
  if(!_has(inv,'histCx') && /^\d+$/.test(String(v.Cnt||''))) inv.histCx=String(v.Cnt);
  // Closed catalogues: exact match only, else blank + reported.
  var exact=(typeof api._ilsExact==='function') ? api._ilsExact : function(){ return ''; };
  var rc={found:!!v.rootCause, raw:v.rootCause||'', value:exact(o.rootCauses, v.rootCause||'')};
  var issue={raw:v.Issue||'', value:exact(o.issues, v.Issue||'')};
  var res=mapResolution(v.res||'', {res:o.res, additional:v.resAdd||'', text:block});
  // SIM Root Cause Details: the extracted values go back through the editor's own import rules
  // (exact-match-only Issue / Res, Driv / Date normalisation, Cnt default 0).
  var simVals={Issue:issue.value, SID:v.SID||'', Driv:v.Driv||'', Date:v.Date||'', TID:v.TID||'',
    Zip:v.Zip||'', Cnt:v.Cnt||'', CID:v.CID||'', UPID:v.UPID||'', Res:res.primary};
  var simText=Object.keys(simVals).filter(function(k){ return simVals[k]; }).map(function(k){ return k+': '+simVals[k]; }).join('\n');
  var sim=(typeof api.ilSimImport==='function') ? api.ilSimImport(simText,{issues:o.issues, res:o.res}) : null;
  var emtId=v.emt || v.emtRelated || (typeof api.ilEmtNumber==='function' ? api.ilEmtNumber([block]) : '');
  var pre=api.IL_EMT_URL_PRE||'', post=api.IL_EMT_URL_POST||'';
  var tags=ilCaseTags(block);
  return {
    format:det.format, detect:det, blocks:all.length, incidents:all.map(function(b){ return {index:b.index, heading:b.heading, chars:b.text.length}; }),
    sim:sim, simValues:simVals, sources:src, rootCause:rc, issue:issue,
    findings:ex.findings, invest:inv, investQualifiers:quals, investUnmapped:pro.unmapped,
    notes:ex.notes, determination:ex.determination, evidence:ex.evidence, risk:ex.risk, reference:ex.reference,
    phdSimLink:v.phdSim||'', emtId:emtId, emtLink:emtId ? pre+emtId+post : '',
    res:res.primary, additionalResolutions:res.additional, resUnmapped:res.unmapped, resRaw:res.raw,
    tags:tags, severity:(typeof api.ilSevFromText==='function' ? api.ilSevFromText(block) : ''),
    dateSource:dr.source, dateCandidates:dr.candidates, known:ex.known
  };
}
// The single report both the dialog's review step and the panel render.
function review(r,o){
  o=o||{}; var api=o.api||{}, defs=_investDefs(api), filled=[], blank=[], unmapped=[];
  r=r||{};
  var sv=r.simValues||{}, sf=(r.sim&&r.sim.fields)||{}, src=r.sources||{};
  // What the LOG said for a SIM key, not what survived validation: simValues already holds the
  // blanked Issue / Res, so an off-catalogue value has to be read from the raw capture or the owner
  // is told "the log does not state it" about a value the log does state.
  var rawOf=function(k){
    if(k==='Issue') return (r.issue&&r.issue.raw)||'';
    if(k==='Res') return r.resRaw||'';
    return String(sv[k]==null?'':sv[k]);
  };
  var simKeys=((api.IL_SIM_FIELDS||[]).map(function(f){ return f.key; }));
  if(!simKeys.length) simKeys=['Issue','SID','Driv','Date','TID','Zip','Cnt','CID','UPID','Res'];
  simKeys.forEach(function(k){
    var val=String(sf[k]==null?'':sf[k]).trim(), label=IL_IMP_LABEL_TEXT[k]||k;
    // Cnt: ilSimImport defaults an unstated count to 0, so say so — a stated zero and an assumed
    // zero must not read the same in a panel whose whole job is to separate them.
    if(k==='Cnt' && val==='0' && !rawOf('Cnt') && !src.Cnt){ filled.push({field:label, value:val, source:'not stated \u2014 defaulted to 0'}); return; }
    if(val) filled.push({field:label, value:val, source:src[k]||''});
    else blank.push({field:label, why: rawOf(k) ? 'the pasted value is not an allowed option' : 'the log does not state it'});
  });
  [['rootCause', r.rootCause&&r.rootCause.value], ['res', r.res], ['phdSimLink', r.phdSimLink],
   ['emtLink', r.emtLink], ['severity', r.severity], ['findings', r.findings&&'(filled)'],
   ['determination', r.determination&&'(filled)'], ['evidence', r.evidence&&'(filled)'],
   ['risk', r.risk&&'(filled)'], ['notes', r.notes&&'(filled)'], ['reference', r.reference&&'(filled)']
  ].forEach(function(p){
    var label=IL_IMP_LABEL_TEXT[p[0]];
    var stated=p[0]==='rootCause' ? ((r.rootCause&&r.rootCause.raw)||'') : (p[0]==='res' ? (r.resRaw||'') : '');
    if(p[1]) filled.push({field:label, value:String(p[1]), source:src[p[0]]||''});
    else blank.push({field:label, why: stated ? 'the pasted value is not an allowed option' : 'the log does not state it'});
  });
  if(r.issue && r.issue.raw && !r.issue.value) unmapped.push({field:'SIM \u2014 Issue', raw:r.issue.raw, catalogue:'Issue types (issue-types.html)'});
  if(r.rootCause && r.rootCause.raw && !r.rootCause.value) unmapped.push({field:'Root Cause', raw:r.rootCause.raw, catalogue:'RC_ROOT_CAUSES'});
  (r.resUnmapped||[]).forEach(function(x){ unmapped.push({field:'PHD Resolution', raw:x, catalogue:'RC_RESOLUTIONS (12)'}); });
  (r.investUnmapped||[]).forEach(function(x){ unmapped.push({field:x.field, raw:x.raw, catalogue:(x.catalogue||[]).join(' / ')}); });
  IL_IMP_INVEST_KEYS.forEach(function(k){
    var def=defs[k], label=(def&&def.label)||k, a=(r.invest||{})[k];
    if(a!=null && a!=='') filled.push({field:label, value:String(a)+((r.investQualifiers||{})[k] ? ' \u2014 '+(r.investQualifiers||{})[k] : ''), source:'PHD Investigation for mitigation'});
    else blank.push({field:label, why:'no evidence in the paste supports an answer'});
  });
  var n=r.blocks||0;
  return {filled:filled, blank:blank, unmapped:unmapped, tags:r.tags||[],
    multi:{count:n, warning: n>1 ? n+' incidents were pasted \u2014 only the first was imported. Import the others one at a time.' : ''}};
}

// ---- api ----
// withApi(IncidentLogEditor) -> the same surface with the editor's helpers already bound.
function withApi(api){
  var b={};
  Object.keys(IMP).forEach(function(k){ b[k]=IMP[k]; });
  b.parse=function(t,o){ o=o||{}; return parse(t, {rootCauses:o.rootCauses, issues:o.issues, res:o.res, api:o.api||api}); };
  b.review=function(r,o){ o=o||{}; return review(r, {api:o.api||api}); };
  b.extractFields=function(t,o){ o=o||{}; o.api=o.api||api; return extractFields(t,o); };
  b.resolveDate=function(t,o){ o=o||{}; o.api=o.api||api; return resolveDate(t,o); };
  b.investFromProse=function(t,o){ o=o||{}; o.api=o.api||api; return investFromProse(t,o); };
  b.splitSections=function(t,a){ return splitSections(t, a||api); };
  b.withApi=withApi;
  return b;
}
var IMP={ normalise:normalise, detect:detect, splitIncidents:splitIncidents, splitSections:splitSections,
  IL_IMP_LABELS:IL_IMP_LABELS, IL_IMP_FORMATS:IL_IMP_FORMATS, IL_IMP_INVEST_KEYS:IL_IMP_INVEST_KEYS,
  extractFields:extractFields, resolveDate:resolveDate, mapResolution:mapResolution,
  IL_EVIDENCE_RULES:IL_EVIDENCE_RULES, investFromProse:investFromProse, routeExtras:routeExtras,
  ilCaseTags:ilCaseTags, parse:parse, review:review, withApi:withApi };
if(typeof module!=='undefined' && module.exports) module.exports=IMP;
else root.PHDIncidentImport=IMP;

})(typeof window!=='undefined' ? window : this);
