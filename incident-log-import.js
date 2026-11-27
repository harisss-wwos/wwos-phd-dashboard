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
//   - NEVER LOSE THE AGENT'S WORDING either. A Root Cause or a Resolution the catalogue rejects is
//     kept verbatim in the reference block under its own heading (IL_IMP_RC_RAW_HEAD /
//     IL_IMP_RES_RAW_HEAD), worded so re-importing that text can never read it back into the field,
//     and the allowed half of a compound resolution is written into PHD notes under
//     "**PHD Resolution:**" (the slot ilCopyResExtra carries into a Copy).
//   - NEVER guess a "PHD Investigation for mitigation" answer. A structured checklist line wins
//     (api._ilfInvestKey / api._ilfAnswer), else the IL_EVIDENCE_RULES prose table, else the key stays
//     absent and is reported under review().blank. A rule whose answer is not one of the question's
//     own options is reported, not applied.
//   - The canonical Date is the INCIDENT date: outreach, EMT-record and Created / Last modified dates
//     are collected with their role and are never eligible (resolveDate).
//   - The PHD SIM is never a "Source Ticket:", an "LMIR Source Ticket:" or an
//     "Address Exclusion SIM raised:" link; the EMT id is read from incidentId=<digits> even when the
//     URL is truncated mid-querystring ("&tabV") and the canonical URL is rebuilt from it.
//   - Several incidents in one paste are never silently merged, whether the two logs come from the
//     same agent or from two different ones: splitIncidents cuts on a repeated heading from ANY
//     format, every block is reported (blocks, incidents[]) and only the first is applied.
//   - The review never asks for an answer the editor would not ask for: every question the
//     questionnaire hides by its own three rules (region / Flex DP / pet, a Customer Service
//     Escalation root cause, a Community-Member POI — api._ilqAutoHidden) is left out of the report,
//     and a question that is already reported as unmappable is not also reported as blank.
//   - A severity nobody wrote down is the owner's standing rule, not a guess: spec section 2 states
//     "no EMT processed or no severity = Sev 5", so parse() reports severity '' with
//     severityAssumed '5' and the review shows that row as a marked default (the same way an
//     unstated Cnt reads as "defaulted to 0"). The editor only applies it when no severity has been
//     chosen yet, so a severity read from the ticket title still wins.
//
// Injected api (the deps-injection pattern the server modules use; pass IncidentLogEditor, or bind it
// once with withApi(api)). Used at call time, never at load time, so there is no load-order coupling:
//   _ilsExact, _ilfInvestKey, _ilfAnswer, _ilfHeadKind, ilSimFmtDate, ilSimParseDate, ilSimDriv,
//   ilSimImport, ilParseSim, ilEmtNumber, ilSevFromText, IL_SIM_FIELDS, IL_INVEST_QS,
//   IL_EMT_URL_PRE, IL_EMT_URL_POST.
//
// The owner's final shared prompt (approved 27 Nov) is accepted ALONGSIDE the seven agent formats,
// never instead of them: "Incident Findings:" is a full synonym of "PHD Findings:", "PHD Mitigation:"
// replaces "PHD notes:" (which, like "Determination:", is no longer required), the two "Outreaches
// to …" items are kept under their own label in the reference block, the new
// "- Likelihood: <High|Low>," risk shape needs no tier line, and nothing anywhere keys off section
// ORDER — only off the headings.
//
// Exports one global (window.PHDIncidentImport) / module.exports: normalise, detect, detectFamilies,
// familyMarkers, splitIncidents, splitSections, IL_IMP_LABELS, extractFields, resolveDate,
// mapResolution, IL_EVIDENCE_RULES, investFromProse, routeExtras, ilCaseTags, parse, review, withApi.
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
// The same trailer with its "by <alias>@" tail cut off by the agent: still metadata, never content.
// Dropped on the label alone ONLY in the trailing metadata block (see _trailerFrom), so a content
// line that happens to start "Created: …" in the middle of a log is kept. Detection keeps the
// stricter form above.
var IL_IMP_TRAILER_BARE=/^(?:created|last\s*modified)\s*:/i;
// Index of the first line of the trailing run of blank / bare-trailer lines (lines.length = none).
function _trailerFrom(lines){
  var from=lines.length;
  for(var i=lines.length-1;i>=0;i--){
    var c=_clean(lines[i]);
    if(!c.replace(/\s/g,'')){ from=i; continue; }
    if(IL_IMP_TRAILER_BARE.test(c)){ from=i; continue; }
    break;
  }
  return from;
}
function normalise(text){
  var s=String(text==null?'':text).replace(/\r\n?/g,'\n').replace(/\u00A0/g,' ').replace(/[\u2500-\u257F]/g,'');
  var out=[], src=s.split('\n'), tail=_trailerFrom(src);
  src.forEach(function(raw,i){
    var l=String(raw).replace(/\s+$/,'');
    l=l.replace(/^([ \t]*)[\u2022\u2023\u25AA\u25CF\u00B7](\s*)/,'$1- ').replace(/^([ \t]*)\*(?!\*)(\s+)/,'$1- ');
    var bare=l.replace(/\s/g,'');
    // Metadata trailer: the "by <alias>@" form anywhere, the bare label only in the trailing block.
    if(IL_IMP_TRAILER_BARE.test(_clean(l)) && (IL_IMP_TRAILER.test(_clean(l)) || i>=tail)) return;
    if(!bare) { out.push(''); return; }
    if(/^(?:-{3,}|={3,}|_{3,}|\*{3,}|~{3,})$/.test(bare)) return;     // separator run
    out.push(l);
  });
  return out.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^\n+/,'').replace(/\s+$/,'');
}

// ---- 2. detect ----
// Marker scoring, not author names. The format only selects pre-normalisation quirks (which heading
// opens an incident, which trailer to strip); it never gates extraction.
// A marker row is [regex, score, label, signature?]. A SIGNATURE marker belongs to one agent's shape
// only — never a heading several formats share (PHD Notes:, Determination:, Matrix pathway:,
// Treatment Rationale:, EMT Incident Report:) — so two signature families in one paste mean two
// logs even when they share no heading to cut on (see detectFamilies / parse().multiSuspect).
var IL_IMP_FORMATS=[
  {format:'harisss',  open:/^\s*(?:\*\*)?SIM Title\s*:/i, markers:[
    [/SIM Root Cause Details\s*:/i, 2, 'SIM Root Cause Details:', 1],
    [/PHD Investigation for mitigation/i, 2, 'PHD Investigation for mitigation:', 1],
    [/^\s*(?:\*\*)?PHD Related Link\s*:/im, 1, 'PHD Related Link:', 1]]},
  {format:'mellanej', open:/^\s*OVERVIEW\s*$/m, markers:[
    [/[\u2500-\u257F]{3,}/, 2, 'box-drawing separator', 1],
    [/^\s*OVERVIEW\s*$/m, 2, 'OVERVIEW banner', 1],
    [/Evidence Checklist\s*:/i, 1, 'Evidence Checklist:', 1],
    [/Primary Mitigation Actioned\s*:/i, 1, 'Primary Mitigation Actioned:', 1]]},
  {format:'arunkzn',  open:/^\s*(?:\*\*)?PHD Notes\s*:/im, markers:[
    [/^\s*(?:\*\*)?PHD Notes\s*:/im, 2, 'PHD Notes:'],
    [IL_IMP_TRAILER, 2, 'Created / Last modified trailer', 1],
    [/Address Exclusion SIM raised\s*:/i, 1, 'Address Exclusion SIM raised:', 1]]},
  {format:'punithsd', open:/^\s*(?:\*\*)?PHD note\s*:/im, markers:[
    [/^\s*(?:\*\*)?PHD note\s*:/im, 2, 'PHD note:', 1],
    [/PHD ticket id\s*:/i, 2, 'PHD ticket id :', 1],
    [/Matrix Pathway\s*:/i, 1, 'Matrix Pathway:']]},
  {format:'mboized',  open:/^\s*(?:\*\*)?Determination\s*:/im, markers:[
    [/^\s*(?:\*\*)?EMT\s*:/im, 2, 'EMT:', 1],
    [/Matrix pathway\s*:/i, 1, 'Matrix pathway:']]},
  {format:'nobregak', open:/^\s*(?:\*\*)?Determination\s*:/im, markers:[
    [/Treatment Rationale\s*:/i, 2, 'Treatment Rationale:'],
    [/EMT Incident Report\s*:/i, 2, 'EMT Incident Report:', 1],
    [/^\s*(?:\*\*)?Determination\s*:/im, 1, 'Determination:']]},
  // flofalgu's incident boundary is a heading, not its "The PHD Team has concluded" opening sentence
  // (that sentence is often absent, and a prose sentence is no boundary): its first heading is
  // "Incident as reported:" and its own section order starts at "Resolution:".
  {format:'flofalgu', open:/^\s*(?:\*\*)?(?:Incident as reported|Resolution)\s*:/im, markers:[
    [/Incident as reported\s*:/i, 2, 'Incident as reported:', 1],
    [/Why this resolution\s*:/i, 2, 'Why this resolution:', 1],
    [/Re-?trigger\s*:/i, 1, 'Re-trigger:', 1],
    [/Customer statement\s*:/i, 1, 'Customer statement:', 1]]}
];
// The agent shapes whose OWN signature markers appear in the paste, in table order. Two of them in
// one paste is evidence of two logs: parse() warns when it could not also split them apart, because
// a silent merge is the one failure the review panel cannot show.
function detectFamilies(text){
  var s=String(text==null?'':text), out=[];
  IL_IMP_FORMATS.forEach(function(f){
    for(var i=0;i<f.markers.length;i++){
      if(f.markers[i][3] && f.markers[i][0].test(s)){ out.push(f.format); return; }
    }
  });
  return out;
}
// Every signature marker each family matched, with the line it was found on -> [{format, markers:[],
// lines:[]}]. A paste that could not be split names these in its warning, so the owner is told WHAT
// made it look like two logs instead of being asked to take the warning on trust.
function familyMarkers(text){
  var s=String(text==null?'':text), lines=s.replace(/\r\n?/g,'\n').split('\n'), out=[];
  IL_IMP_FORMATS.forEach(function(f){
    var names=[], at=[];
    f.markers.forEach(function(m){
      if(!m[3] || !m[0].test(s)) return;
      names.push(m[2]);
      for(var i=0;i<lines.length;i++){ if(m[0].test(lines[i])){ at.push(i+1); break; } }
    });
    if(names.length) out.push({format:f.format, markers:names, lines:at});
  });
  return out;
}
function detect(text){
  var s=String(text==null?'':text), best={format:'generic', score:0, markers:[]};
  IL_IMP_FORMATS.forEach(function(f){
    var score=0, hit=[];
    f.markers.forEach(function(m){ if(m[0].test(s)){ score+=m[1]; hit.push(m[2]); } });
    if(score>best.score) best={format:f.format, score:score, markers:hit};
  });
  return best;
}
// True when a line opens an incident in ANY of the seven formats (not just the detected one): a real
// paste mixes agents, so the detected format's own opening heading can appear exactly once while a
// second incident starts on somebody else's heading.
function _isOpenHead(line){
  var c=_clean(line);
  for(var i=0;i<IL_IMP_FORMATS.length;i++){
    var re=IL_IMP_FORMATS[i].open;
    if(re.test(c) || re.test(line)) return true;
  }
  return false;
}

// ---- 3. splitIncidents ----
// One block per incident. A boundary candidate is any line that opens an incident in one of the seven
// formats OR that splitSections reads as a known section heading, and a candidate whose heading
// ALREADY appeared in the current block starts a new incident. That catches the three shapes:
//   - two logs from the same agent  (the opening heading repeats),
//   - two logs from DIFFERENT agents (the opening heading appears once each, but ordinary section
//     headings — Root Cause, PHD Findings, PHD Resolution — repeat),
//   - a prose log with no opening sentence at all (its own headings repeat).
// Text BEFORE the first boundary (a greeting, an "Incident 1:" header, a reordered first section) is
// a preamble, not an incident: it stays with the first block, so the block count only ever rises on a
// genuine repeat. Returns [{index, heading, text}].
// How many preceding new headings a repeat may look back over for the real start of the second
// incident ("Determination:" sitting one heading before the repeated "PHD Findings:").
var IL_IMP_BOUND_BACK=2;
// The boundary key of a line: '' when the line can open neither an incident nor a known section.
function _boundKey(line,api){
  var c=_clean(line);
  if(!c || IL_IMP_BULLET.test(c)) return '';
  var lb=_label(c), name=lb ? lb.label : (/^[A-Z][A-Z /&-]{3,}$/.test(c) ? c : '');
  if(!name) return '';
  if(_isOpenHead(line)) return _nk(name);
  return _headKind(name,api) ? _nk(name) : '';
}
// The "Created: … / Last modified: …" trailer CLOSES an incident (arunkzn's shape, a log that is one
// prose section and shares no heading with any other format). Anything after it belongs to the next
// incident, whatever heading that one opens with — so the raw paste is cut there before the heading
// scan runs. A trailer with nothing after it is just the end of the paste.
// -> {lines, cuts:[line index where a new incident starts]}
function _trailerCuts(text){
  var lines=String(text==null?'':text).replace(/\r\n?/g,'\n').split('\n'), cuts=[];
  for(var i=0;i<lines.length;i++){
    // Only the alias-stamped form opens a trailer run: a content line that merely starts "Created:"
    // must never cut an incident in two.
    if(!IL_IMP_TRAILER.test(_clean(lines[i]))) continue;
    var j=i;                                   // walk to the end of this trailer / blank run
    while(j+1<lines.length){
      var n=_clean(lines[j+1]);
      if(!n.replace(/\s/g,'') || IL_IMP_TRAILER_BARE.test(n)){ j++; continue; }
      break;
    }
    if(j+1<lines.length) cuts.push(j+1);
    i=j;
  }
  return {lines:lines, cuts:cuts};
}
function splitIncidents(text,api){
  var t=_trailerCuts(text), starts=[0].concat(t.cuts), out=[];
  starts.forEach(function(from,i){
    var to=i+1<starts.length ? starts[i+1] : t.lines.length;
    _splitRepeats(t.lines.slice(from,to).join('\n'),api).forEach(function(b){
      out.push({index:out.length, heading:b.heading, text:b.text});
    });
  });
  return out;
}
// One paste segment -> its blocks, cut on a repeated heading (the scan described above).
function _splitRepeats(text,api){
  var norm=normalise(text), units=[];
  // Inline headings count too (flofalgu writes a whole log as one paragraph), so the scan runs over
  // the same parts splitSections sees, not over raw lines.
  norm.split('\n').forEach(function(l){ _splitInline(l).forEach(function(p){ units.push(String(p).replace(/\s+$/,'')); }); });
  var keys=units.map(function(u){ return _boundKey(u,api); });
  var at=[], seen={}, run=[];
  units.forEach(function(u,i){
    var k=keys[i]; if(!k) return;
    if(!seen[k]){ seen[k]=1; run.push(i); return; }
    // A repeated heading = a second incident. When the repeat is itself an opening heading it IS the
    // start; otherwise the start is the nearest opening heading just before it (within a short
    // look-back), so a mixed-format paste cuts where the second agent's log really begins.
    var cut=i;
    if(!_isOpenHead(units[i])){
      for(var j=run.length-1, back=0; j>=0 && back<IL_IMP_BOUND_BACK; j--, back++){
        if(_isOpenHead(units[run[j]])){ cut=run[j]; break; }
      }
    }
    at.push(cut);
    seen={}; run=[];
    for(var m=cut;m<=i;m++){ if(keys[m] && !seen[keys[m]]){ seen[keys[m]]=1; run.push(m); } }
  });
  if(!at.length) return norm.trim() ? [{index:0, heading:_cut(units[0]||'',90), text:norm}] : [];
  var out=[], starts=[0].concat(at);
  starts.forEach(function(from,i){
    var to=i+1<starts.length ? starts[i+1] : units.length;
    var body=units.slice(from,to).join('\n').trim();
    if(body) out.push({index:out.length, heading:_cut(_clean(units[from]),90), text:body});
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
  // The owner's final prompt: "Incident Findings:" is a full synonym of "PHD Findings:", and
  // "PHD Mitigation:" replaces "PHD notes:" (both are also in the editor's IL_FULL_HEADS, this table
  // keeps the parser readable on its own).
  {re:/^incident findings$/, kind:'findings'},
  {re:/^phd mitigation$/, kind:'notes'},
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
  var k=_resKey(t), i;
  // The spec's one mapping is checked against the injected catalogue like any other value: a mapping
  // target that is not in the 12 is reported, never trusted because it is hardcoded here.
  if(IL_IMP_RES_MAP[k]){
    var mapped=IL_IMP_RES_MAP[k];
    if(!(list||[]).length) return {value:mapped, raw:t};
    for(i=0;i<list.length;i++) if(_resKey(list[i])===_resKey(mapped)) return {value:list[i], raw:t};
    return {value:'', raw:t};
  }
  for(i=0;i<(list||[]).length;i++) if(_resKey(list[i])===k) return {value:list[i], raw:t};
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
      // The key travels with the report so review() can tell this is the SAME question it would
      // otherwise list as blank, and can drop it when the editor hides that question entirely.
      unmapped.push({key:r.key, field:(def&&def.label)||r.key, raw:_sq(m[0]), catalogue:(def&&def.opts)||[]});
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
// ---- the final prompt's two outreach items (appended to the investigation list) ----
// They are NOT questionnaire questions — IL_INVEST_QS is a closed list and this file never adds to
// it — so their text is kept in the reference block under the agent's own label instead of being
// dropped with the rest of the unmatched investigation lines. The transporter label varies with
// "Driv:" (DA / DP / Transporter); all four spellings read into one field, and a label that
// disagrees with Driv is imported as written and reported as a mismatch.
var IL_IMP_OUTREACH=[
  {key:'outreachCx', re:/^outreach(?:es)?\s+to\s+(?:the\s+)?cx\s*\/?\s*poi$/i, who:''},
  {key:'outreachTr', re:/^outreach(?:es)?\s+to\s+(?:the\s+)?da$/i, who:'DA'},
  {key:'outreachTr', re:/^outreach(?:es)?\s+to\s+(?:the\s+)?dp$/i, who:'DP'},
  {key:'outreachTr', re:/^outreach(?:es)?\s+to\s+(?:the\s+)?transporter$/i, who:'Transporter'}
];
// "Driv:" -> the transporter-outreach label the final prompt asks for.
var IL_IMP_OUTREACH_WHO={dspda:'DA', hubda:'DA', flexdp:'DP', na:'Transporter'};
function _outreachOf(label){
  var n=_sq(String(label==null?'':label)).replace(/\s*:$/,'');
  for(var i=0;i<IL_IMP_OUTREACH.length;i++) if(IL_IMP_OUTREACH[i].re.test(n)) return IL_IMP_OUTREACH[i];
  return null;
}
// The lines belonging to an outreach label: its own value plus the bullets under it, up to the next
// unbulleted label or a blank line. -> {end: last line index used, lines}
function _outreachBody(lines,at){
  var lb=_label(lines[at]), body=(lb && lb.rest) ? [lb.rest] : [], i=at+1;
  for(;i<lines.length;i++){
    var c=String(lines[i]);
    if(!c.trim()) break;
    var l2=_label(c);
    if(l2 && (!IL_IMP_BULLET.test(c) || _outreachOf(l2.label))) break;
    body.push(c);
  }
  return {end:i-1, lines:body};
}
// sections -> {items, cx, transporter, label, who}: the outreach values as the log states them.
function _outreachFrom(secs){
  var out={items:[], cx:'', transporter:'', label:'', who:''};
  (secs||[]).forEach(function(s){
    for(var i=0;i<s.lines.length;i++){
      var lb=_label(s.lines[i]); if(!lb) continue;
      var d=_outreachOf(lb.label); if(!d) continue;
      var b=_outreachBody(s.lines,i), txt=b.lines.join('\n').trim();
      out.items.push({key:d.key, who:d.who, label:lb.label, text:txt});
      if(d.key==='outreachCx'){ if(!out.cx) out.cx=txt; }
      else if(!out.transporter){ out.transporter=txt; out.label=lb.label; out.who=d.who; }
      i=b.end;
    }
  });
  return out;
}
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
// sections -> {findings, determination, evidence, risk, notes, reference, rootCauseBody,
//              invest:[lines], known}
// rootCauseBody is the Root Cause section as the agent wrote it, with no heading: parse() keeps it
// only when the wording does not match the catalogue, so an off-catalogue root cause is not lost.
function routeExtras(secs){
  var fin=[], extra={determination:[], evidence:[], risk:[]}, notes=[], ref=[], inv=[], rcBody=[], known=0;
  var bullet=function(l){ return String(l).replace(/^(\s*)[*\u2022]\s+/,'$1- '); };
  secs.forEach(function(s){
    if(s.known) known++;
    var keep=[], pulled=[];
    for(var li=0;li<s.lines.length;li++){
      var l=s.lines[li], lb=_label(l), od=lb ? _outreachOf(lb.label) : null;
      // An outreach item takes its own bullets with it, so a multi-attempt list is kept whole.
      if(od){ var ob=_outreachBody(s.lines,li); pulled.push(_block(lb.label,ob.lines)); li=ob.end; continue; }
      if(lb && lb.rest && _isRefLine(lb.label)){ pulled.push(_block(lb.label,[lb.rest])); continue; }
      keep.push(l);
    }
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
    else if(s.kind==='rootCause'){ var rcb=keep.map(bullet).join('\n').replace(/\n{3,}/g,'\n\n').trim(); if(rcb) rcBody.push(rcb); }
    else if(s.kind==='sim' || s.kind==='drop'){ /* handled as fields */ }
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
    notes:notes.join('\n\n').trim(), reference:ref.join('\n\n').trim(),
    rootCauseBody:rcBody.join('\n\n').trim(), invest:inv, known:known};
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
// "NEEDS HUMAN CHOICE: <field>" — the final prompt's own marker for a decision the agent must not
// make. It is an explicit gap, so it joins the review's blank list instead of sitting in a bullet.
var IL_IMP_NEEDS_RE=/NEEDS\s+HUMAN\s+CHOICE\s*:?[ \t]*([^\n]*)/ig;
function _needsChoice(text){
  var s=normalise(text), out=[], seen={}, m;
  IL_IMP_NEEDS_RE.lastIndex=0;
  while((m=IL_IMP_NEEDS_RE.exec(s))){
    var f=_sq(String(m[1]||'').replace(/\*\*/g,'')).replace(/^[-\s]+/,'').replace(/[\s.,;:]+$/,'');
    if(!f || seen[_nk(f)]) continue;
    seen[_nk(f)]=1; out.push(f);
  }
  return out;
}
// The questionnaire keys the review reports on (the spec §3 table), in question order.
var IL_IMP_INVEST_KEYS=['dup','poi','susp','negFb','histCx','locSim','cortex','locEmt','clear','station','netra','addPkg','di','diUpd','austin'];
// Heading the reference block gets when the Root Cause wording is not one of the 45 allowed values.
// Deliberately NOT the "Root Cause:" label, so re-importing the reference text never reads it back
// into the Root Cause field.
var IL_IMP_RC_RAW_HEAD='Root Cause as written (not an allowed value)';
// The same treatment for the resolution: a value outside the 12 leaves "Res:" blank, but the words
// the agent wrote are kept in the reference under this heading (again not a re-readable "Res" label,
// so a re-import of the reference text never puts an off-catalogue value back in the field).
var IL_IMP_RES_RAW_HEAD='PHD Resolution as written (not an allowed value)';
// The notes heading the additional resolutions of a compound go under: the slot the editor's
// ilCopyResExtra carries straight under the Copy's "**PHD Resolution**: <value>" line.
var IL_IMP_RES_NOTE_HEAD='**PHD Resolution:**';
// Spec section 2: "Often absent entirely -> default Sev 5 (owner's existing rule: no EMT processed or
// no severity = Sev 5)". Reported as an assumption (severityAssumed), never as a stated value.
var IL_IMP_SEV_DEFAULT='5';
// lines -> the notes with those lines under the "**PHD Resolution:**" heading (reused when the notes
// already carry that heading, so there is never a second one).
function _notesWithRes(notes,lines){
  var body=(lines||[]).filter(function(l){ return String(l).trim(); }).join('\n');
  if(!body) return String(notes==null?'':notes);
  var at=String(notes==null?'':notes).split('\n'), idx=-1;
  for(var i=0;i<at.length;i++){ if(/^\s*\*\*PHD Resolution:\*\*\s*$/i.test(at[i])){ idx=i; break; } }
  if(idx<0) return (at.join('\n').trim() ? at.join('\n').trim()+'\n\n' : '')+IL_IMP_RES_NOTE_HEAD+'\n'+body;
  at.splice(idx+1,0,body);
  return at.join('\n').trim();
}
// text + {rootCauses, issues, res, api} -> the whole import. Several incidents: every block is
// reported and only the first is applied.
function parse(text,o){
  o=o||{}; var api=o.api||{}, raw=String(text==null?'':text);
  var det=detect(raw), all=splitIncidents(raw,api);
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
  // An off-catalogue Root Cause leaves the field blank (never guessed) — but the agent's own wording
  // is kept in the reference block, so the owner can read it while picking the allowed value.
  var reference=ex.reference;
  if(!rc.value && (ex.rootCauseBody || rc.raw)){
    var rcKeep=_block(IL_IMP_RC_RAW_HEAD,[ex.rootCauseBody || rc.raw]);
    if(rcKeep) reference=reference ? reference+'\n\n'+rcKeep : rcKeep;
  }
  var res=mapResolution(v.res||'', {res:o.res, additional:v.resAdd||'', text:block});
  // An off-catalogue resolution leaves "Res:" blank (never guessed) — and, exactly like the Root
  // Cause above, its wording is kept in the reference instead of surviving only in a dismissible
  // panel. A compound keeps its whole line, a partly-mapped one keeps just the rejected pieces.
  if(res.unmapped.length || (res.raw && !res.primary)){
    var resKeep=_block(IL_IMP_RES_RAW_HEAD, res.primary ? res.unmapped.slice() : [res.raw || res.unmapped.join(' + ')]);
    if(resKeep) reference=reference ? reference+'\n\n'+resKeep : resKeep;
  }
  // The allowed half of a compound ("Delivery Instruction + Customer Reassurance") is a real
  // resolution the owner actioned: the SIM "Res:" keeps the primary only, so the rest goes into PHD
  // notes under "**PHD Resolution:**", the slot ilCopyResExtra carries into a Copy (plan item 5).
  var notes=ex.notes;
  if(res.additional.length) notes=_notesWithRes(notes, res.additional.map(function(x){ return '- Additional resolution actioned: '+x; }));
  // SIM Root Cause Details: the extracted values go back through the editor's own import rules
  // (exact-match-only Issue / Res, Driv / Date normalisation, Cnt default 0).
  var simVals={Issue:issue.value, SID:v.SID||'', Driv:v.Driv||'', Date:v.Date||'', TID:v.TID||'',
    Zip:v.Zip||'', Cnt:v.Cnt||'', CID:v.CID||'', UPID:v.UPID||'', Res:res.primary};
  var simText=Object.keys(simVals).filter(function(k){ return simVals[k]; }).map(function(k){ return k+': '+simVals[k]; }).join('\n');
  var sim=(typeof api.ilSimImport==='function') ? api.ilSimImport(simText,{issues:o.issues, res:o.res}) : null;
  var emtId=v.emt || v.emtRelated || (typeof api.ilEmtNumber==='function' ? api.ilEmtNumber([block]) : '');
  var pre=api.IL_EMT_URL_PRE||'', post=api.IL_EMT_URL_POST||'';
  var tags=ilCaseTags(block);
  // The severity as STATED, plus the owner's standing default when the log states none (spec §2).
  var sev=(typeof api.ilSevFromText==='function' ? api.ilSevFromText(block) : '');
  // The two outreach items, and the label-vs-Driv mismatch the final prompt warns about.
  var och=_outreachFrom(secs), wantWho=IL_IMP_OUTREACH_WHO[_nk(v.Driv||'')]||'';
  var ochMiss=(och.who && wantWho && och.who!==wantWho)
    ? '\u201c'+och.label+'\u201d was stated while \u201cDriv:\u201d is '+_sq(v.Driv)+', where the prompt asks for \u201cOutreaches to '+wantWho+'\u201d. The value was imported as written \u2014 check which one is right.'
    : '';
  // Two agent shapes in one paste that could NOT be split: say so rather than hand over a blended
  // record. Failing loud beats merging silently.
  var fams=detectFamilies(raw), marks=familyMarkers(raw);
  // Name the markers that made it look like two logs (and the line each was found on), so the owner
  // can see which two shapes were mixed and where, instead of being asked to trust the warning.
  var why=marks.filter(function(m){ return fams.indexOf(m.format)>=0; }).map(function(m){
    return m.format+': '+m.markers.map(function(nm,i){ return nm+(m.lines[i]?' (line '+m.lines[i]+')':''); }).join(', ');
  }).join('; ');
  var suspect=(all.length<2 && fams.length>1)
    ? 'Two agent formats appear in this paste ('+fams.join(', ')+') and it could not be split into separate incidents \u2014 import one incident at a time and check every field. What was seen: '+why+'.'
    : '';
  return {
    format:det.format, detect:det, blocks:all.length, incidents:all.map(function(b){ return {index:b.index, heading:b.heading, chars:b.text.length}; }),
    families:fams, familyMarkers:marks, multiSuspect:suspect, outreach:och, outreachMismatch:ochMiss,
    needsChoice:_needsChoice(block),
    sim:sim, simValues:simVals, sources:src, rootCause:rc, issue:issue,
    findings:ex.findings, invest:inv, investQualifiers:quals, investUnmapped:pro.unmapped,
    notes:notes, determination:ex.determination, evidence:ex.evidence, risk:ex.risk, reference:reference,
    phdSimLink:v.phdSim||'', emtId:emtId, emtLink:emtId ? pre+emtId+post : '',
    res:res.primary, additionalResolutions:res.additional, resUnmapped:res.unmapped, resRaw:res.raw,
    tags:tags, severity:sev, severityAssumed:sev ? '' : IL_IMP_SEV_DEFAULT,
    dateSource:dr.source, dateCandidates:dr.candidates, known:ex.known
  };
}
// The question a key belongs to (a sub / poiWho key -> its parent), because only the top-level
// question carries the usCa / noFlex / petOnly gating flags.
function _investOwner(api){
  var o={}, qs=(api&&api.IL_INVEST_QS)||[];
  qs.forEach(function(q){ o[q.key]=q; if(q.sub) o[q.sub.key]=q; if(q.poiWho) o[q.poiWho.key]=q; });
  return o;
}
// True when the editor would not ask this question at all for this incident: the review must not
// demand an answer the form never shows. The questionnaire hides a question by THREE rules — region /
// Flex DP / pet, a "Customer Service Escalation" root cause, and a Community-Member POI — and
// api._ilqAutoHidden is the one that combines all three, so that is what is asked here.
// a = the answers that gate (the POI value this paste states, else the one already in the form).
function _investHidden(api,key,ro,a){
  if(!ro) return false;
  var own=_investOwner(api)[key];
  if(!own) return false;
  if(typeof api._ilqAutoHidden==='function') return !!api._ilqAutoHidden(own,a||{},ro);
  if(typeof api._ilqRegionHidden==='function') return !!api._ilqRegionHidden(own,ro);
  return !!((own.usCa && ro.usca===false) || (own.noFlex && ro.flex===true) || (own.petOnly && ro.pet===false));
}
// The gating facts for this import: whatever the open ticket already knows (o.ro, the editor's
// _ilqRO()) plus what this very paste states, since an import applies its own Driv and Root Cause
// the moment it lands — "Driv: Flex DP" hides the Flex-only questions and a Customer Service
// Escalation root cause hides all but four.
function _investRO(r,ro){
  ro=ro||{};
  var driv=String((r.simValues||{}).Driv||'').replace(/[^A-Za-z]/g,'');
  return {usca:ro.usca, flex:(ro.flex===true || /^flex/i.test(driv)), pet:ro.pet,
    rootCause:((r.rootCause&&r.rootCause.value)||ro.rootCause||'')};
}
// The POI answer that gates: this paste's, else the one already in the form (o.answers, the editor's
// _ilqReadAnswers()). Only "poi" matters today — it is the one answer IL_POI_CM_HIDE keys off.
function _investAnswers(r,answers){
  var poi=(r.invest||{}).poi;
  return {poi:(poi==null||poi==='') ? ((answers||{}).poi||'') : poi};
}
// The single report both the dialog's review step and the panel render. o.ro (optional) = the
// {usca, flex, pet, rootCause} gating of the open ticket and o.answers its current questionnaire
// answers; without them only what the paste states can gate.
function review(r,o){
  o=o||{}; var api=o.api||{}, defs=_investDefs(api), filled=[], blank=[], unmapped=[];
  r=r||{};
  var ro=_investRO(r,o.ro), ans=_investAnswers(r,o.answers), reported={};
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
    if(k==='Cnt' && val==='0' && !rawOf('Cnt') && !src.Cnt){ filled.push({field:label, value:val, source:'not stated \u2014 defaulted to 0', assumed:true}); return; }
    if(val) filled.push({field:label, value:val, source:src[k]||''});
    else blank.push({field:label, why: rawOf(k) ? 'the pasted value is not an allowed option' : 'the log does not state it'});
  });
  // Determination, Evidence Details, PHD notes and the reference are OPTIONAL sections: the owner's
  // final prompt no longer emits Determination or PHD notes at all (PHD Mitigation carries what used
  // to be in notes), so a missing one is not a gap the owner has to fill. They are listed when
  // filled and otherwise left out.
  var optional={determination:1, evidence:1, notes:1, reference:1};
  [['rootCause', r.rootCause&&r.rootCause.value], ['res', r.res], ['phdSimLink', r.phdSimLink],
   ['emtLink', r.emtLink], ['findings', r.findings&&'(filled)'],
   ['determination', r.determination&&'(filled)'], ['evidence', r.evidence&&'(filled)'],
   ['risk', r.risk&&'(filled)'], ['notes', r.notes&&'(filled)'], ['reference', r.reference&&'(filled)']
  ].forEach(function(p){
    var label=IL_IMP_LABEL_TEXT[p[0]];
    var stated=p[0]==='rootCause' ? ((r.rootCause&&r.rootCause.raw)||'') : (p[0]==='res' ? (r.resRaw||'') : '');
    if(p[1]) filled.push({field:label, value:String(p[1]), source:src[p[0]]||''});
    else if(!optional[p[0]]) blank.push({field:label, why: stated ? 'the pasted value is not an allowed option' : 'the log does not state it'});
  });
  // Severity: a stated one is a filled field; an unstated one is the owner's standing Sev 5 rule
  // (spec §2), reported as the marked default it is — the same shape an unstated Cnt gets above.
  var sevLbl=IL_IMP_LABEL_TEXT.severity;
  if(r.severity) filled.push({field:sevLbl, value:String(r.severity), source:src.severity||''});
  else if(r.severityAssumed) filled.push({field:sevLbl, value:String(r.severityAssumed),
    source:'not stated \u2014 defaulted to Sev '+r.severityAssumed, assumed:true});
  else blank.push({field:sevLbl, why:'the log does not state it'});
  // The two outreach items are kept as stated (they are not questionnaire questions).
  [['outreachCx','Outreaches to CX/POI',(r.outreach&&r.outreach.cx)||''],
   ['outreachTr',(r.outreach&&r.outreach.label)||'Outreaches to the transporter',(r.outreach&&r.outreach.transporter)||'']
  ].forEach(function(p){
    if(p[2]) filled.push({field:p[1], value:p[2], source:'kept in the PHD reference (not a questionnaire question)'});
  });
  if(r.issue && r.issue.raw && !r.issue.value) unmapped.push({field:'SIM \u2014 Issue', raw:r.issue.raw, catalogue:'Issue types (issue-types.html)'});
  if(r.rootCause && r.rootCause.raw && !r.rootCause.value) unmapped.push({field:'Root Cause', raw:r.rootCause.raw, catalogue:'RC_ROOT_CAUSES'});
  (r.resUnmapped||[]).forEach(function(x){ unmapped.push({field:'PHD Resolution', raw:x, catalogue:'RC_RESOLUTIONS (12)'}); });
  (r.investUnmapped||[]).forEach(function(x){
    if(x.key && _investHidden(api,x.key,ro,ans)) return;   // the editor does not ask this question
    var got=(r.invest||{})[x.key];
    if(x.key && got!=null && got!=='') return;            // a checklist line answered it after all
    if(x.key) reported[x.key]=1;                          // reported here, so never ALSO as blank
    unmapped.push({field:x.field, raw:x.raw, catalogue:(x.catalogue||[]).join(' / ')});
  });
  IL_IMP_INVEST_KEYS.forEach(function(k){
    var def=defs[k], label=(def&&def.label)||k, a=(r.invest||{})[k];
    if(a!=null && a!==''){ filled.push({field:label, value:String(a)+((r.investQualifiers||{})[k] ? ' \u2014 '+(r.investQualifiers||{})[k] : ''), source:'PHD Investigation for mitigation'}); return; }
    if(reported[k]) return;                               // already under "not mapped to an allowed value"
    if(_investHidden(api,k,ro,ans)) return;               // hidden: region / Flex / pet, CSE root cause, CM POI
    blank.push({field:label, why:'no evidence in the paste supports an answer'});
  });
  // "NEEDS HUMAN CHOICE: <field>" lines are gaps the agent flagged on purpose. They merge into the
  // row for the same field when there already is one, so one gap is never reported twice.
  (r.needsChoice||[]).forEach(function(f){
    var k=_nk(f), hit=null;
    if(k.length>=4) blank.forEach(function(b){
      var bk=_nk(b.field);
      if(!hit && (bk.indexOf(k)>=0 || k.indexOf(bk)>=0)) hit=b;
    });
    if(hit){ if(hit.why.indexOf('NEEDS HUMAN CHOICE')<0) hit.why=hit.why+' \u2014 the log marks it NEEDS HUMAN CHOICE'; return; }
    blank.push({field:_sq(f), why:'the log marks it NEEDS HUMAN CHOICE'});
  });
  var n=r.blocks||0, warnings=[];
  if(r.outreachMismatch) warnings.push(r.outreachMismatch);
  // multi.blocks: the heading each pasted incident opens with, so the owner reads WHICH blocks were
  // found (and that the first one is the one applied) rather than only a count.
  var blocks=(n>1) ? (r.incidents||[]).map(function(b){ return {index:b.index, heading:b.heading, applied:b.index===0}; }) : [];
  return {filled:filled, blank:blank, unmapped:unmapped, tags:r.tags||[], warnings:warnings,
    multi:{count:n, blocks:blocks,
      warning: n>1 ? n+' incidents were pasted \u2014 only the first was imported. Import the others one at a time.' : (r.multiSuspect||'')}};
}

// ---- api ----
// withApi(IncidentLogEditor) -> the same surface with the editor's helpers already bound.
function withApi(api){
  var b={};
  Object.keys(IMP).forEach(function(k){ b[k]=IMP[k]; });
  b.parse=function(t,o){ o=o||{}; return parse(t, {rootCauses:o.rootCauses, issues:o.issues, res:o.res, api:o.api||api}); };
  b.review=function(r,o){ o=o||{}; return review(r, {api:o.api||api, ro:o.ro, answers:o.answers}); };
  b.extractFields=function(t,o){ o=o||{}; o.api=o.api||api; return extractFields(t,o); };
  b.resolveDate=function(t,o){ o=o||{}; o.api=o.api||api; return resolveDate(t,o); };
  b.investFromProse=function(t,o){ o=o||{}; o.api=o.api||api; return investFromProse(t,o); };
  b.splitSections=function(t,a){ return splitSections(t, a||api); };
  b.withApi=withApi;
  return b;
}
var IMP={ normalise:normalise, detect:detect, detectFamilies:detectFamilies, familyMarkers:familyMarkers,
  splitIncidents:splitIncidents, splitSections:splitSections,
  IL_IMP_LABELS:IL_IMP_LABELS, IL_IMP_FORMATS:IL_IMP_FORMATS, IL_IMP_INVEST_KEYS:IL_IMP_INVEST_KEYS,
  extractFields:extractFields, resolveDate:resolveDate, mapResolution:mapResolution,
  IL_EVIDENCE_RULES:IL_EVIDENCE_RULES, investFromProse:investFromProse, routeExtras:routeExtras,
  ilCaseTags:ilCaseTags, parse:parse, review:review, withApi:withApi };
if(typeof module!=='undefined' && module.exports) module.exports=IMP;
else root.PHDIncidentImport=IMP;

})(typeof window!=='undefined' ? window : this);
