// Ticket Sanitization sections of sanitization-tracker.html (moved here from ticket-sanitization.html):
//   - the hero "Copy prompt" button (TS_PROMPT) and the hero summary chips,
//   - the top-level one-open-at-a-time accordion (also used by the page's Contractors section),
//   - "Sanitization checklist" (everyone; editors add / edit / delete checks),
//   - "Sanitization scores" + the "Assign to sanitize" pop-up (owner only),
//   - "Sanitization assignment log" (owner only).
// Styles: sanitization-checklist.css. Needs icons.js, api-config.js, topbar-auth.js (PHDAuth, PHDLoginUI,
// PHDConfirm, PHDBanner, the shared .tbl-* dialog shell) and the page's #tsAddModal / #tsEditModal /
// #tsDelModal markup. Everything lives inside one IIFE; the inline-handler functions (window.ts*) and
// window.PHDSanCheck are the only globals.
(function () {
const A=window.PHDAuth;
const ic=(n,s)=>window.icon?window.icon(n,s||18):'';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// Edit access: only these two usernames (case-insensitive). The server enforces the same allow-list.
var TS_EDITORS=['harisss','flofalgu'];
function tsCanEdit(){ var u=A&&A.getUser&&A.getUser(); return !!(u && TS_EDITORS.indexOf(String(u.username||'').toLowerCase())>=0); }

// Glyphs.
var ICO_COPY='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
var ICO_CHEV='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
var ICO_EDIT='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
var ICO_DEL='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
var ICO_PLUS='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
var ICO_RETRY='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';
var ICO_INFO='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
var ICO_LIST='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 6h1v4M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>';
var SPIN='<span class="ts-spin" aria-hidden="true"></span>';

var TS_ITEMS=[];  // [{id,text,order}]
// View state: LOADING = checklist request in flight; LOAD_ERR = why the last GET failed (error + Retry).
var LOADING=true, LOAD_ERR='', FIRST=true, TS_LAST_FOCUS=null;

// One persistent polite live region (outside #wrap, so re-renders never replace it).
function liveEl(){
  var el=document.getElementById('tsLive');
  if(!el){ el=document.createElement('span'); el.id='tsLive'; el.className='ts-sr'; el.setAttribute('aria-live','polite'); el.setAttribute('role','status'); document.body.appendChild(el); }
  return el;
}
function announce(msg){ var live=liveEl(); live.textContent=''; setTimeout(function(){ live.textContent=msg; },30); }

function copyFallback(text,done){ try{ var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); var ok=document.execCommand('copy'); document.body.removeChild(ta); done(ok); }catch(e){ done(false); } }
// ---- Section grouping helpers (pure; no DOM) ----
// Stored lines start with a section prefix ("SIM Title - ...", "Root Cause Details - ...", "Hashtags - ...").
// The prefix picks the sub-section and is stripped for display; edits still use the full stored text.
var TS_PREFIX_RE=/^\s*(SIM Title|Title|Root ?Cause Details|RCD|Hashtags?|Labels?|Closure ?Code)\s*[-\u2013\u2014:]\s*/i;
var TS_SECTIONS=[
  {key:'title',label:'SIM Title',icon:'ticket'},
  {key:'rcd',label:'Root Cause Details',icon:'clipboard'},
  {key:'tags',label:'Hashtags',icon:'hash'},
  {key:'closure',label:'ClosureCode',icon:'check-circle'}
];
var TS_OTHER={key:'other',label:'Other',icon:'info'};
var TS_ADD_SEC='SIM Title';  // last section picked in the editor's add row (kept across re-renders)
function tsSectionKey(text){
  var m=TS_PREFIX_RE.exec(String(text==null?'':text)); if(!m) return 'other';
  var p=m[1].toLowerCase().replace(/\s+/g,' ');
  if(p==='sim title'||p==='title') return 'title';
  if(p==='root cause details'||p==='rootcause details'||p==='rcd') return 'rcd';
  if(p==='closurecode'||p==='closure code') return 'closure';
  return 'tags';
}
function tsStripPrefix(text){ return String(text==null?'':text).replace(TS_PREFIX_RE,'').trim(); }
// items -> [{key,label,icon,lines:[{idx,text}]}]; fixed section order, DB order within a section, 'Other' only when non-empty.
function tsGroup(items){
  var by={title:[],rcd:[],tags:[],closure:[],other:[]};
  (items||[]).forEach(function(it,idx){ by[tsSectionKey(it.text)].push({idx:idx,text:tsStripPrefix(it.text)}); });
  var out=TS_SECTIONS.map(function(s){ return {key:s.key,label:s.label,icon:s.icon,lines:by[s.key]}; });
  if(by.other.length) out.push({key:TS_OTHER.key,label:TS_OTHER.label,icon:TS_OTHER.icon,lines:by.other});
  return out;
}
// ---- end section grouping helpers ----

// Sub-section open state: in memory only, kept across re-renders. On every page load the checklist
// card is open and ALL its sub-sections (SIM Title / Root Cause Details / Hashtags / ClosureCode) are collapsed.
var TS_OPEN={};
function tsSetSec(key,open){
  TS_OPEN[key]=!!open;
  var btn=document.getElementById('tsSecBtn-'+key), body=document.getElementById('tsSecList-'+key);
  if(btn) btn.setAttribute('aria-expanded',open?'true':'false');
  if(body) body.hidden=!open;
  if(btn&&btn.closest) { var s=btn.closest('.ts-sec'); if(s) s.classList.toggle('is-open',!!open); }
}
// Opening a sub-section closes the others (one at a time once the user starts toggling); closing one
// leaves the rest as they are, so collapsing one of the all-open defaults keeps the other two open.
function tsToggleSec(key){
  var open=!TS_OPEN[key];
  if(open) Object.keys(TS_OPEN).forEach(function(k){ if(k!==key&&TS_OPEN[k]) tsSetSec(k,false); });
  tsSetSec(key,open);
}
window.tsToggleSec=tsToggleSec;

// ---- Top-level accordion (checklist, scores, assignment log) ----
// TS_TOP = id of the one open card (null = all collapsed). The checklist is open on every page load. In memory only.
// Toggling only flips attributes, so inner accordions / pages keep their state; re-renders read TS_TOP.
var TS_TOP='tsGuide';
function tsTopCls(id){ return 'ts-card ts-acc'+(TS_TOP===id?' is-open':''); }
function tsTopSum(text,cls){ return text?'<span class="ts-count ts-top-sum'+(cls?' '+cls:'')+'">'+text+'</span>':''; }
// o = {icon, title, sum, tags, sub, acts}; acts sit OUTSIDE the toggle button (clicking them never toggles).
function tsTopHead(id,o){
  var open=TS_TOP===id;
  return '<div class="ts-head"><h2 class="ts-top-h"><button type="button" class="ts-top-tog" id="'+id+'Btn" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+id+'Body" onclick="tsTopToggle(\''+id+'\')">'+
      '<span class="ts-head-ic" aria-hidden="true">'+o.icon+'</span>'+
      '<span class="ts-top-txt"><span class="ts-top-tl"><span id="'+id+'Head">'+o.title+'</span>'+(o.sum||'')+(o.tags||'')+'</span>'+
        '<span class="ts-head-p ts-top-sub">'+o.sub+'</span></span>'+
      '<span class="ts-top-chev" aria-hidden="true">'+ICO_CHEV+'</span></button></h2>'+(o.acts||'')+'</div>';
}
function tsTopBody(id){ return '<div class="ts-top-body" id="'+id+'Body"'+(TS_TOP===id?'':' hidden')+'>'; }
function tsTopSet(id,open){
  var card=document.getElementById(id), btn=document.getElementById(id+'Btn'), body=document.getElementById(id+'Body');
  if(card) card.classList.toggle('is-open',!!open);
  if(btn) btn.setAttribute('aria-expanded',open?'true':'false');
  if(body) body.hidden=!open;
}
function tsTopToggle(id){
  var open=TS_TOP!==id;
  if(TS_TOP&&TS_TOP!==id) tsTopSet(TS_TOP,false);
  TS_TOP=open?id:null; tsTopSet(id,open);
}
window.tsTopToggle=tsTopToggle;
// Re-render helper: if the focused element was replaced, focus its re-rendered twin (same id).
function tsKeepFocus(fn){
  var a=document.activeElement, id=a&&a!==document.body?a.id:'';
  fn();
  if(id&&(!document.activeElement||document.activeElement===document.body)){ var f=document.getElementById(id); if(f&&f!==a) f.focus({preventScroll:true}); }
}

// AI prompt copied by the hero "Copy prompt" button.
// Root Cause / Res lists = the dashboard's dropdown values (exact spelling). KEEP IN SYNC with
// issue-types-data.js RC_ROOT_CAUSES / RC_RESOLUTIONS (the prompt keeps its own copy).
var TS_ROOT_CAUSES=['Access Code Defect','Aggressive CM (unprovoked)','Aggressive CX (unprovoked)','Amazon/Driver targeted',
  'CX Unfamiliar with Delivery Process','CX/CM Embellished/False Report','Collusion','Customer Appeal Request (Not Applicable)',
  'Customer Service Escalation','Driver Embellished/False Report','Driving Behavior - Other','Failure to de-escalate','Geo Pin',
  'Inaccurate Delivery Instructions','Inappropriate Conduct','Inappropriate Racial Comments','Inappropriate Sexual Comments',
  'Key In-Garage Delivery','Language Barrier','Misidentification','Missing Delivery Instructions',
  'NOT APPLICABLE/No Further Action Required','Not Amazon related','Not following delivery instructions','OTP Confusion',
  'Opportunity','Package Handling','Parking Dispute','Previous Delivery Experience','Property Damage','Road Rage','Routing Issue',
  'Threat over pet presence','Transporter Misconduct','Transporter being followed','Transporter felt unsafe (No Interaction)',
  'Undetermined','Unexpected Delivery Time','Unsecured Animal Attack (CX Pet)','Unsecured Animal Attack (Non-CX Pet/ Other)',
  'Unsecured Animal Evasion (CX Pet)','Unsecured Animal Evasion (Non-CX Pet/ Other)','Vehicle Collision','Vehicle Unsecured',
  'Wrong/No Package Delivered'];
var TS_RESOLUTIONS=['Account Closure','Address Deprio','Address Exclusion','Area Exclusion','Customer Reassurance','Delivery Hint',
  'Driver Follow-up','GeoFence Update','GeoPin Update','Parcel Box Installation','Physical Order Block','Routing Update'];
// Issue types + definitions (PHD Issue Types page). KEEP IN SYNC with issue-types-data.js IZ_CATS.
var TS_ISSUE_TYPES=[
  ['Weapon & Robbery',[
    ['Robbery w/ weapon','POI robs the transporter \u2014 or attempts to \u2014 using/presenting a weapon posing a lethal threat, taking property (in the driver\u2019s custody or not). Package theft when the transporter is NOT present is out of scope.'],
    ['Robbery w/o weapon','Purposeful robbery/theft \u2014 or attempt \u2014 of property (in custody or not), without a weapon and without critical injury. Package theft when the transporter is NOT present is out of scope.'],
    ['Attack w/weapon','POI uses or attempts to use a weapon against the driver, regardless of injury level \u2014 including injury, critical injury, or hospitalization.'],
    ['Weapon pointed at driver','POI aims/directs a weapon at the driver, or draws/reveals a concealed weapon directing the threat at them, but does not use it.'],
    ['Armed w/weapon','POI holds/displays/brandishes a weapon to threaten, but does not aim it at the driver or use it; no critical injury.'],
    ['Weapon present w/ no threat','A weapon is visible/known but not held toward, aimed at, referenced, or used against the driver.'],
    ['Shots fired','Driver hears or sees shots (intentional or unintentional) fired of any kind.']]],
  ['Pet',[
    ['Attack w/pet','POI intentionally uses or commands a pet to cause harm \u2014 pet deployed as a weapon.'],
    ['Unsecured pet - bite/injury','POI\u2019s unsecured pet bites/makes contact causing injury, without command.'],
    ['Unsecured pet - evasion injury','Driver injured while escaping/avoiding a pet (fall, trip, strain), with no bite/contact.'],
    ['Unsecured pet - no contact','POI\u2019s unsecured pet charges/chases aggressively with no contact and no injury.']]],
  ['Physical / Severe Outcome',[
    ['Fatality from assault','Loss of life resulting from CX actions or a CX-location hazard.'],
    ['Physical altercation \u2013 No Injury','Purposeful physical force/assault without a weapon and no injury to the driver.'],
    ['Physical altercation w/ Injury','Purposeful physical force/assault without a weapon causing Injury (regardless of level of injury).']]],
  ['Threats',[
    ['Threat of harm (verbal or written)','Purposeful threat of physical harm to the driver, whether spoken (in person/any channel) or written (note handed over or left on the vehicle).']]],
  ['Detention / Impeding',[
    ['Kidnapping','POI forcibly seizes and takes/relocates the driver to another location under their control.'],
    ['Impeding egress','POI temporarily blocks/obstructs the driver\u2019s exit or path, without confining or moving them, and without a weapon or critical injury.']]],
  ['Sexual',[
    ['Sexual assault (physical)','Purposeful sexual touching/attempt, kissing, sexually suggestive contact, or purposeful lewd exposure.'],
    ['Sexual harassment (verbal)','Unwelcome verbal/written sexual comments, leering, or sexist/stereotypical remarks based on gender.'],
    ['Indecent exposure','Exposure that makes the driver uncomfortable \u2014 full/partial nudity or any body part(s) \u2014 without sexual intent or lewd conduct (else use Sexual assault/harassment).']]],
  ['Abuse, Intimidation & Discrimination',[
    ['Name Calling','Discriminatory language, name calling or conduct directed at the driver \u2014 slurs, insults, abuse \u2014 targeting a protected characteristic.'],
    ['Intimidation','Purposeful physical intimidation causing fear/apprehension, without a weapon or critical injury.'],
    ['Verbal abuse','Offensive/harassing language \u2014 yelling, profanity or harassing customer notes (written) \u2014 that is not discriminatory and not threatening.'],
    ['Signage/Paraphernalia','Discriminatory, racist, or threatening symbols/signs/paraphernalia displayed at the property \u2014 not language directed at the driver.']]],
  ['Property',[
    ['Vandalism','Purposeful defacement, damage, or destruction of property \u2014 whether in the driver\u2019s custody or not \u2014 including the vehicle or Amazon packages.']]],
  ['Out of Scope of PHD',[
    ['Accidental injury (no POI)','Transporter injury or medical event with no POI involvement \u2014 traffic collision, slip/fall, or medical emergency.'],
    ['Property / vehicle damage only','Accidental damage to the vehicle/property with no injury and no purposeful POI act.'],
    ['Suspicious Following','An unidentified POI follows, trails, surveils, or positions themselves to monitor the driver during a delivery, with no verbal exchange, threat, weapon, or physical contact.']]]
];
var TS_OOS_RESOLUTION=[
  'No further action is required by the PHD Team at this time. This incident falls under one or more of the following categories:',
  'First-time pet incident',
  'The driver did not sustain significant injuries',
  'The driver is not seeking immediate medical attention',
  'The dog belongs to a community member (CM) and not the customer (CX)',
  'The animal/pet did not make contact with the driver',
  'The driver was not transported to the hospital by EMS',
  '',
  'Should additional information emerge that materially affects the disposition of this incident, PHD will conduct a reassessment.',
  '#out-of-scope'
].join('\n');
var TS_PROMPT=[
  'You are a PHD incident classifier. Follow these instructions EXACTLY. They override any other habit or default you have.',
  '',
  'When I paste the next incident or information, analyse ONLY the pasted information, decide whether the incident is IN SCOPE or OUT OF SCOPE for PHD using the rules below, and reply with ONLY the output block for that case \u2014 using exactly its headings, in exactly its order. No introduction, no commentary, no explanation, no reasoning, no text before or after the block. Never invent facts that are not in the pasted information.',
  '',
  'ALLOWED VALUES (use ONLY these, copied character for character \u2014 same spelling, case, spacing and punctuation; never invent, combine, shorten or reword a value):',
  '',
  'A) Issue types \u2014 pick exactly ONE whose definition matches the incident:',
  TS_ISSUE_TYPES.map(function(c){ return '['+c[0]+']\n'+c[1].map(function(t){ return '  - '+t[0]+': '+t[1]; }).join('\n'); }).join('\n'),
  '',
  'B) Root Cause \u2014 exactly ONE of:',
  TS_ROOT_CAUSES.map(function(x){ return '  - '+x; }).join('\n'),
  '',
  'C) Res (PHD resolution) \u2014 exactly ONE of these 12:',
  TS_RESOLUTIONS.map(function(x){ return '  - '+x; }).join('\n'),
  '',
  'STEP 1 \u2014 ISSUE TYPE: read the pasted information and choose the ONE issue type from list A whose definition best fits what happened to the transporter. Use the definitions, not the words the reporter used.',
  '',
  'STEP 2 \u2014 SCOPE. The incident is OUT OF SCOPE if EITHER of these is true; otherwise it is IN SCOPE:',
  '  (1) The issue type from STEP 1 is in the [Out of Scope of PHD] category; OR',
  '  (2) The issue type is in the [Pet] category AND ALL of these are true: the Historical Incident count in the pasted information is 0 (or not given); the transporter did not sustain significant injuries; the transporter is not seeking immediate medical attention; and EMS was not called to the location and the transporter was not transported to a hospital.',
  'If any of the conditions in (2) is not met or is unclear, the pet incident is IN SCOPE.',
  '',
  'STEP 3 \u2014 OUTPUT. Reply with EXACTLY ONE of the two blocks below.',
  '',
  '=== IN SCOPE block (closure code Successful) ===',
  'Closure Code: Successful',
  '',
  'PHD Findings:',
  '- <factual bullet points from the pasted information, for reading purposes: date in DDMON\u2019YY form (e.g. 02NOV\u201926), who did what, injuries, emergency services, outreach and reassurance outcome>',
  '',
  'Root Cause: <exactly one value from list B>',
  '',
  'SIM Root Cause Details:',
  'Issue: <the issue type from STEP 1, exactly as in list A>',
  'SID: <station code / Station ID from the pasted information>',
  'Driv: <exactly one of: DSP DA, Flex DP, Hub DA; N/A if not given>',
  'Date: <incident date as MM/DD/YY>',
  'TID: <Transporter ID>',
  'Zip: <zip / postal code>',
  'Cnt: <Historical Incident count as a number; 0 if not given or N/A>',
  'CID: <Customer Account ID; N/A if none>',
  'UPID: <Unit Place ID; N/A if none>',
  'Res: <exactly one value from list C>',
  '',
  'SIM Title: <see SIM Title rules>',
  '=== end of IN SCOPE block ===',
  '',
  'Res rules (IN SCOPE only):',
  '- If the CX gave ANY reassurance \u2014 full OR partial, verbal OR written \u2014 that drivers can keep delivering safely, Res is: Customer Reassurance.',
  '- If no reassurance was obtained and the risk is low, Res is: Driver Follow-up.',
  '- Use Account Closure, Physical Order Block, Address Exclusion, Area Exclusion or Address Deprio ONLY when the pasted information clearly shows a high risk of repeat or of serious harm.',
  '- For a delivery-location problem use the matching fix: Delivery Hint, GeoPin Update, GeoFence Update, Routing Update or Parcel Box Installation.',
  '',
  '=== OUT OF SCOPE block (closure code Immediately Resolved) ===',
  'Closure Code: Immediately Resolved',
  '',
  'Root Cause: NOT APPLICABLE/No Further Action Required',
  '',
  'SIM Title: <see SIM Title rules>',
  '',
  'PHD Resolution:',
  TS_OOS_RESOLUTION,
  '=== end of OUT OF SCOPE block ===',
  '(Copy the PHD Resolution text above word for word. Do not add PHD Findings or SIM Root Cause Details to the OUT OF SCOPE block.)',
  '',
  'SIM Title rules (both blocks):',
  '- If a Customer Account ID is present, use: <COUNTRY CODE> Customer Incident Escalation - Account ID: <Customer Account ID> - Sev <N> - <Issue type>',
  '- If there is no Customer Account ID, use (and leave out "Account ID" entirely): <COUNTRY CODE> Community Member Incident Escalation - Sev <N> - <Issue type>',
  '- <Issue type> is the issue type from STEP 1, exactly as in list A.',
  '- Sev <N> is the incident severity (1-5) from the pasted information. If no EMT was processed, or no severity is given, use Sev 5.',
  '- Example: US Customer Incident Escalation - Account ID: A2BE6RJDLHJ794 - Sev 5 - Verbal abuse',
  '',
  'Do not output the === marker lines. Output only the headings and values of the chosen block.'
].join('\n');
function tsCopyPrompt(btn){
  var lbl=btn&&btn.querySelector('.ts-hl-t'); var orig=lbl?lbl.textContent:'';
  var done=function(ok){ if(!lbl) return; lbl.textContent=ok?'Prompt copied':'Copy failed'; announce(ok?'Prompt copied':'Copy failed'); setTimeout(function(){ lbl.textContent=orig; },1400); };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(TS_PROMPT).then(function(){done(true);},function(){copyFallback(TS_PROMPT,done);});
  else copyFallback(TS_PROMPT,done);
}
window.tsCopyPrompt=tsCopyPrompt;

// ---- Building blocks ----
// Hero summary chips ('N steps', 'Editor access' / 'View only'); the page puts them in its hero (#tsHeroChips).
function chipsHtml(editor){
  var n=TS_ITEMS.length;
  return LOADING
    ? '<li class="is-skel" aria-hidden="true"><span class="ts-skel ts-skel-d" style="width:120px;height:10px"></span></li><li class="is-skel" aria-hidden="true"><span class="ts-skel ts-skel-d" style="width:70px;height:10px"></span></li>'
    : (LOAD_ERR?'<li><span>Checklist unavailable</span></li>':'<li><span><b>'+n+'</b> '+(n===1?'step':'steps')+'</span></li>')+
      (editor?'<li class="is-acc">Editor access</li>':'<li>View only</li>');
}
function paintChips(){ var el=document.getElementById('tsHeroChips'); if(el) el.innerHTML=chipsHtml(tsCanEdit()); }
// Hero "Copy prompt" button (orange; sits in the page's second hero row, see sanitization-tools.js heroActsHtml).
function promptBtnHtml(){
  return '<button type="button" class="ts-hero-link ts-hero-prompt" onclick="tsCopyPrompt(this)" title="Copy the AI prompt for writing PHD Findings, Primary Case Tag, SIM Root Cause Details and SIM Title">'+
    '<span class="ts-hl-sheet" aria-hidden="true">'+ICO_COPY+'</span>'+
    '<span class="ts-hl-txt"><span class="ts-hl-t">Copy prompt</span><span class="ts-hl-s" aria-hidden="true">Paste it into your AI tool before the incident</span></span></button>';
}

// Loading placeholder: three collapsed sub-section header rows (chevron + icon + title + count).
function skeletonSections(){
  return '<div class="ts-secs" aria-hidden="true">'+[110,170,96].map(function(w){
    return '<div class="ts-sec"><div class="ts-sec-head"><span class="ts-skel" style="width:16px;height:16px;border-radius:4px"></span>'+
      '<span class="ts-skel" style="width:26px;height:26px;border-radius:7px"></span>'+
      '<span class="ts-skel" style="width:'+w+'px;height:14px"></span>'+
      '<span class="ts-skel" style="width:28px;height:18px;border-radius:99px"></span></div></div>';
  }).join('')+'</div>';
}

// Display markup for a stripped line. Root Cause Details lines like "Issue: ..." get the field name in bold.
function tsLineHtml(key,text){
  if(key==='rcd'){ var m=/^([A-Za-z][A-Za-z0-9 ]{0,24}):\s*([\s\S]*)$/.exec(text); if(m) return '<b>'+esc(m[1])+':</b> '+esc(m[2]); }
  return esc(text);
}

function stepsHtml(editor,anim){
  if(LOADING) return skeletonSections();
  if(LOAD_ERR) return '<div class="ts-state" role="alert"><span class="ts-state-ic" aria-hidden="true">'+ic('alert-triangle',20)+'</span><div class="ts-state-txt">'+
      '<p class="ts-state-t">Couldn\u2019t load the checklist</p><p class="ts-state-p">'+esc(LOAD_ERR)+'</p></div>'+
      '<button type="button" class="ts-btn" id="tsRetry" onclick="tsRetry()">'+ICO_RETRY+'<span>Retry</span></button></div>';
  if(!TS_ITEMS.length) return '<div class="ts-empty">'+ICO_INFO+'No checklist lines yet.</div>';
  var seq=0;
  return '<div class="ts-secs">'+tsGroup(TS_ITEMS).map(function(sec){
    var hid='tsSec-'+sec.key, lid='tsSecList-'+sec.key, n=sec.lines.length, lab=sec.label, open=!!TS_OPEN[sec.key];
    return '<section class="ts-sec'+(open?' is-open':'')+'" aria-labelledby="'+hid+'">'+
      '<h3 class="ts-sec-h" id="'+hid+'"><button type="button" class="ts-sec-tog" id="tsSecBtn-'+sec.key+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+lid+'" onclick="tsToggleSec(\''+sec.key+'\')">'+
        '<span class="ts-sec-chev" aria-hidden="true">'+ICO_CHEV+'</span>'+
        '<span class="ts-sec-ic" aria-hidden="true">'+ic(sec.icon,15)+'</span><span class="ts-sec-lbl">'+esc(lab)+'</span>'+
        '<span class="ts-count"><span class="ts-sr">(</span>'+n+'<span class="ts-sr"> '+(n===1?'line':'lines')+')</span></span></button></h3>'+
      '<div class="ts-sec-body" id="'+lid+'"'+(open?'':' hidden')+'>'+
      (n?'<ol class="ts-steps">'+sec.lines.map(function(l,j){
        var i=l.idx, k=j+1, d=seq++;
        return '<li class="ts-step" id="tsItem'+i+'" tabindex="-1"'+(anim?' style="--i:'+Math.min(d,14)+'"':'')+'>'+
          '<span class="ts-dot" aria-hidden="true">'+k+'</span>'+
          '<div class="ts-step-body">'+
            '<div class="ts-step-txt"><span class="ts-step-k">Step '+k+'</span><span class="ts-text">'+tsLineHtml(sec.key,l.text)+'</span></div>'+
            (editor?('<span class="ts-step-act">'+
              '<button class="ts-ibtn edit" type="button" title="Edit line" aria-label="Edit '+esc(lab)+' step '+k+'" onclick="tsEdit('+i+')">'+ICO_EDIT+'</button>'+
              '<button class="ts-ibtn del" type="button" title="Delete line" aria-label="Delete '+esc(lab)+' step '+k+'" onclick="tsDelete('+i+')">'+ICO_DEL+'</button>'+
            '</span>'):'')+
          '</div></li>';
      }).join('')+'</ol>':'<div class="ts-empty">'+ICO_INFO+'No lines in this section yet.</div>')+
    '</div></section>';
  }).join('')+'</div>';
}

// The checklist card (top-level accordion section 'tsGuide'). anim = the one entrance animation of its steps.
function guideHtml(anim){
  var editor=tsCanEdit(), n=TS_ITEMS.length;
  var ready=!LOADING&&!LOAD_ERR;
  return '<section class="'+tsTopCls('tsGuide')+(anim?' is-anim':'')+'" id="tsGuide" aria-labelledby="tsGuideHead" aria-busy="'+(LOADING?'true':'false')+'">'+
        tsTopHead('tsGuide',{icon:ICO_LIST,title:'Sanitization checklist',
          sum:ready?tsTopSum(n.toLocaleString()+' '+(n===1?'check':'checks')):'',
          tags:ready&&editor?'<span class="ts-mode">Editor</span>':'',
          sub:'Work through each step in order for every assigned ticket.',
          acts:ready&&editor?'<button class="ts-btn" type="button" id="tsAddBtn" aria-haspopup="dialog" onclick="tsOpenAdd()">'+ICO_PLUS+'<span>Add new check</span></button>':''})+
        tsTopBody('tsGuide')+
        stepsHtml(editor,anim)+
        // Card-level error slot (a failed delete reports here, since its pop-up closes).
        (ready&&editor?'<div class="ts-err" id="tsErr" role="alert"></div>':'')+
      '</div></section>';
}
// Re-render the checklist card in place (the page's other sections are left alone) + the hero chips.
function render(){
  var anim=FIRST&&!LOADING&&!LOAD_ERR; if(anim) FIRST=false;
  var el=document.getElementById('tsGuide');
  if(el) tsKeepFocus(function(){ el.outerHTML=guideHtml(anim); });
  paintChips();
}

function tsErr(msg){ var e=document.getElementById('tsErr'); if(e){ e.textContent=msg||''; e.style.display=msg?'flex':'none'; } }

async function loadChecklist(fromRetry){
  LOADING=true; LOAD_ERR=''; render();
  announce('Loading the sanitization checklist\u2026');
  var r=null;
  try{ r=await A.api('GET','/api/sanitization-checklist'); }catch(e){ r=null; }
  LOADING=false;
  if(r&&r.ok&&r.data&&Array.isArray(r.data.items)){ TS_ITEMS=r.data.items; }
  else LOAD_ERR=r?('Could not load the checklist (HTTP '+(r.status||'?')+').'):'Could not load the checklist \u2014 network error.';
  render();
  if(LOAD_ERR){
    announce('Couldn\u2019t load the checklist.');
    if(fromRetry){ var rb=document.getElementById('tsRetry'); if(rb) rb.focus(); }
  } else {
    announce('Loaded '+TS_ITEMS.length+' checklist '+(TS_ITEMS.length===1?'step':'steps')+'.');
    if(fromRetry){ var h=document.getElementById('tsGuideBtn'); if(h) h.focus(); }
  }
}
function tsRetry(){ loadChecklist(true); }
window.tsRetry=tsRetry;

// ---- Add via the "Add new check" pop-up (shared .tbl-* shell; PHDLoginUI gives Esc, the Tab trap and focus return) ----
function tsOpenAdd(){
  if(!tsCanEdit()) return;
  var bg=document.getElementById('tsAddModal'), sel=document.getElementById('tsAddSec'), ta=document.getElementById('tsAddText');
  sel.innerHTML=TS_SECTIONS.map(function(s){ return '<option value="'+esc(s.label)+'"'+(s.label===TS_ADD_SEC?' selected':'')+'>'+esc(s.label)+'</option>'; }).join('');
  tsModalErr('tsAddErr','');
  bg.style.display='flex';
  if(window.PHDLoginUI) window.PHDLoginUI.opened(bg,tsCloseAdd,ta); else setTimeout(function(){ ta.focus(); },40);
}
window.tsOpenAdd=tsOpenAdd;
function tsCloseAdd(){
  var bg=document.getElementById('tsAddModal'); if(bg.style.display==='none') return;
  bg.style.display='none';
  if(window.PHDLoginUI) window.PHDLoginUI.closed(bg); else { var b=document.getElementById('tsAddBtn'); if(b) b.focus(); }
}
window.tsCloseAdd=tsCloseAdd;
async function tsAdd(){
  if(!tsCanEdit()) return;
  var inp=document.getElementById('tsAddText'), sel=document.getElementById('tsAddSec'), btn=document.getElementById('tsAddSave');
  if(btn.disabled) return;
  var text=String(inp.value||'').trim(); if(!text){ tsModalErr('tsAddErr','Enter a check first.'); inp.focus(); return; }
  tsModalErr('tsAddErr','');
  // Prepend the chosen section prefix unless the typed text already carries a known one.
  if(sel&&sel.value){ TS_ADD_SEC=sel.value; if(!TS_PREFIX_RE.test(text)) text=sel.value+' - '+text; }
  btn.disabled=true; btn.textContent='Adding\u2026';   // the shared .tbl-submit:disabled rule draws the spinner
  var r=null;
  try{ r=await A.api('POST','/api/sanitization-checklist',{text:text}); }catch(e){ r=null; }
  btn.disabled=false; btn.textContent='Add check';
  if(r&&r.ok){
    inp.value=''; tsCloseAdd();
    TS_OPEN={}; TS_OPEN[tsSectionKey(text)]=true;   // open only the section the check went into
    await loadChecklist();
    var b=document.getElementById('tsAddBtn'); if(b) b.focus();   // re-rendered, so re-find the opener
    announce('Check added');
  } else { tsModalErr('tsAddErr',(r&&r.data&&r.data.error)||('Add failed (HTTP '+(r?r.status:'?')+').')); inp.focus(); }
}
window.tsAdd=tsAdd;

// ---- Edit via in-page modal (replaces window.prompt) ----
var TS_EDIT_ID=null, TS_DEL_ID=null;
function tsModalErr(id,msg){ var e=document.getElementById(id); if(e){ e.textContent=msg||''; e.style.display=msg?'block':'none'; } }
function tsRestoreFocus(){ var f=TS_LAST_FOCUS; TS_LAST_FOCUS=null; if(f&&document.body.contains(f)) f.focus(); }

function tsEdit(i){
  if(!tsCanEdit()) return;
  var it=TS_ITEMS[i]; if(!it) return;
  TS_EDIT_ID=it.id; TS_LAST_FOCUS=document.activeElement;
  var ta=document.getElementById('tsEditText'); ta.value=it.text;
  tsModalErr('tsEditErr','');
  document.getElementById('tsEditModal').classList.add('show');
  setTimeout(function(){ ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length); },40);
}
window.tsEdit=tsEdit;
function tsCloseEdit(){ var m=document.getElementById('tsEditModal'); var open=m.classList.contains('show'); m.classList.remove('show'); TS_EDIT_ID=null; if(open) tsRestoreFocus(); }
window.tsCloseEdit=tsCloseEdit;
async function tsEditSave(){
  if(!tsCanEdit()||!TS_EDIT_ID) return;
  var text=String(document.getElementById('tsEditText').value||'').trim();
  if(!text){ tsModalErr('tsEditErr','Line cannot be empty.'); return; }
  var btn=document.getElementById('tsEditSave'); btn.disabled=true; btn.innerHTML=SPIN+'<span>Saving\u2026</span>';
  var r=await A.api('PUT','/api/sanitization-checklist/'+TS_EDIT_ID,{text:text});
  btn.disabled=false; btn.textContent='Save';
  if(r&&r.ok){ TS_LAST_FOCUS=null; tsCloseEdit(); await loadChecklist(); announce('Checklist line saved.'); }
  else tsModalErr('tsEditErr',(r&&r.data&&r.data.error)||('Save failed (HTTP '+(r?r.status:'?')+').'));
}
window.tsEditSave=tsEditSave;

function tsDelete(i){
  if(!tsCanEdit()) return;
  var it=TS_ITEMS[i]; if(!it) return;
  TS_DEL_ID=it.id; TS_LAST_FOCUS=document.activeElement;
  document.getElementById('tsDelBody').textContent=it.text;
  document.getElementById('tsDelModal').classList.add('show');
  setTimeout(function(){ var b=document.getElementById('tsDelConfirm'); if(b) b.focus(); },40);
}
window.tsDelete=tsDelete;
function tsCloseDel(){ var m=document.getElementById('tsDelModal'); var open=m.classList.contains('show'); m.classList.remove('show'); TS_DEL_ID=null; if(open) tsRestoreFocus(); }
window.tsCloseDel=tsCloseDel;
async function tsDelConfirm(){
  if(!tsCanEdit()||!TS_DEL_ID) return;
  var btn=document.getElementById('tsDelConfirm'); btn.disabled=true; btn.innerHTML=SPIN+'<span>Deleting\u2026</span>';
  var r=await A.api('DELETE','/api/sanitization-checklist/'+TS_DEL_ID);
  btn.disabled=false; btn.textContent='Delete';
  TS_LAST_FOCUS=null;
  if(r&&r.ok){ tsCloseDel(); await loadChecklist(); announce('Checklist line deleted.'); }
  else { tsCloseDel(); tsErr((r&&r.data&&r.data.error)||('Delete failed (HTTP '+(r?r.status:'?')+').')); }
}
window.tsDelConfirm=tsDelConfirm;

// ---- Sanitization scores (owner-only; the server enforces it too: GET /api/sanitization-score) ----
// Every Resolved / Closed ticket scored 0..scMax() (11: one point per check); appeal / test / Duplicate / AUTO-SIM tickets and Cnt > 0 are ignored.
// scMax()+1 collapsible buckets, 0 points first (they matter most); one open at a time; each header lists its failing checks.
// Inside: created-quarter sub-sections (Pacific, oldest first, collapsed); tickets paged by 100 in two 50-row columns.
var TS_OWNER='harisss';
function tsIsOwner(){ var u=A&&A.getUser&&A.getUser(); return !!(u && String(u.username||'').trim().toLowerCase()===TS_OWNER); }
// open = open score section; openQ = open quarter sub-section inside it ('2026-Q1'); page = {'score|quarter': page no.}.
var SC={loading:true, err:'', data:null, quarter:'', open:null, openQ:null, page:{}};
var SC_PAGE=100;
var ICO_SCORE='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/></svg>';
// Top score: the server's maxScore (MAX_SCORE in sanitization-score.js), 11 until the payload is here.
var SC_MAX_DEFAULT=11;
function scMax(){ var m=SC.data&&Number(SC.data.maxScore); return m>0?m:SC_MAX_DEFAULT; }
// Hue per score: 0 red (0) -> half amber (38) -> max green (142).
function scHue(s){ var M=scMax(), h=M/2; s=Math.max(0,Math.min(M,Number(s)||0)); return s<=h ? Math.round(s/h*38) : Math.round(38+(s-h)/(M-h)*104); }
function scWhen(iso){ var d=new Date(iso); return iso&&!isNaN(d)?d.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''; }

function scSkel(){
  return '<div aria-hidden="true"><span class="ts-skel" style="width:260px;height:14px;margin-bottom:14px"></span>'+
    '<span class="ts-skel" style="width:100%;height:96px;border-radius:10px;margin-bottom:16px"></span>'+
    '<div class="ts-secs">'+[0,1,2,3].map(function(){ return '<div class="ts-sec"><div class="ts-sec-head"><span class="ts-skel" style="width:16px;height:16px;border-radius:4px"></span>'+
      '<span class="ts-skel" style="width:52px;height:22px;border-radius:7px"></span><span class="ts-skel" style="width:120px;height:14px"></span>'+
      '<span class="ts-skel" style="width:28px;height:18px;border-radius:99px"></span></div></div>'; }).join('')+'</div></div>';
}
// Fixed scope (no selector): tickets created from 1 Jan 2026 to the latest upload.
function scQuarterSelect(){
  return '<div class="ts-sc-ctl ts-top-acts"><span class="ts-own" title="Only tickets created on or after 1 Jan 2026 (Pacific time) are scored">Created 1 Jan 2026 \u2013 latest</span></div>';
}
function scDistHtml(d){
  var M=scMax(), max=0, i; for(i=0;i<=M;i++) max=Math.max(max,d.buckets[i]||0);
  var li=[];
  for(i=0;i<=M;i++){
    var n=d.buckets[i]||0, h=max?Math.max(n?4:0,Math.round(n/max*100)):0;
    li.push('<li style="--sc-h:'+scHue(i)+'"><button type="button" onclick="tsScoreJump('+i+')" aria-label="'+i+' points: '+n+' '+(n===1?'ticket':'tickets')+'. Show this group">'+
      '<span class="ts-sc-n" aria-hidden="true">'+n+'</span><span class="ts-sc-col" aria-hidden="true"><span class="ts-sc-bar" style="height:'+h+'%"></span></span>'+
      '<span class="ts-sc-x" aria-hidden="true">'+i+'</span></button></li>');
  }
  return '<ul class="ts-sc-dist" style="grid-template-columns:repeat('+(M+1)+',minmax(0,1fr))" aria-label="Score distribution, 0 to '+M+' points">'+li.join('')+'</ul>';
}
// Created quarter id from the server ('2026-Q1'); anything else (no CreateDate) -> 'none'.
function scQKey(t){ var q=t&&t.cq; return /^\d{4}-Q[1-4]$/.test(q||'')?q:'none'; }
function scQLabel(k){ return k==='none'?'No create date':k.slice(5)+' '+k.slice(0,4); }
// One ticket's failed checks with their parsed values (row tooltip + sr-only text).
function scMissText(t,crit){
  var m=[];
  (t.checks||[]).forEach(function(c,i){ if(c[0]) return; var cr=crit[i]||{chip:'Check '+(i+1)}; m.push(cr.chip+(c[1]?' (value: '+c[1]+')':'')); });
  return m.length?'Missing: '+m.join(', '):'All checks pass';
}
// Header summary: failing criteria among a score group's tickets, most frequent first.
function scMissHtml(list,score,crit){
  if(!list.length) return '';
  if(score===scMax()) return '<ul class="ts-sc-miss" aria-label="Checks for '+score+' points"><li class="ts-chip ok">All checks pass</li></ul>';
  var cnt=crit.map(function(){ return 0; });
  list.forEach(function(t){ (t.checks||[]).forEach(function(c,i){ if(!c[0]&&i<cnt.length) cnt[i]++; }); });
  var rows=cnt.map(function(n,i){ return {i:i,n:n}; }).filter(function(x){ return x.n>0; });
  if(!rows.length) return '';
  // Grouped by prefix in check order: [Title: no country code 39 | no severity 39 | …] [RCD: Issue 39 | SID 39 | …] [ClosureCode: not allowed 12]
  var groups=[], gi={};
  rows.forEach(function(x){
    var cr=crit[x.i]||{chip:'Check '+(x.i+1),label:''}, chip=String(cr.chip||''), k=chip.indexOf(':');
    var pre=k>0?chip.slice(0,k):'', name=k>0?chip.slice(k+1).trim():chip;
    if(!(pre in gi)){ gi[pre]=groups.length; groups.push({pre:pre,items:[]}); }
    // ClosureCode: the tooltip breaks the failures down by 'current → expected' code (the check value).
    var by=null;
    if(cr.key==='closure'){
      var bc={}; list.forEach(function(t){ var c=(t.checks||[])[x.i]; if(c&&!c[0]){ var v=String(c[1]||'(blank)'); bc[v]=(bc[v]||0)+1; } });
      by=Object.keys(bc).sort(function(a,b){ return bc[b]-bc[a]||a.localeCompare(b); }).map(function(v){ return '  '+v+': '+bc[v].toLocaleString(); });
    }
    groups[gi[pre]].items.push({name:name,n:x.n,label:cr.label||chip,by:by});
  });
  var tot=list.length.toLocaleString();
  return '<ul class="ts-sc-miss" aria-label="Missing checks for '+score+' '+(score===1?'point':'points')+'">'+groups.map(function(g){
    var tip=g.items.map(function(it){ return it.n.toLocaleString()+' of '+tot+' tickets fail: '+it.label+(it.by&&it.by.length?'\n'+it.by.join('\n'):''); }).join('\n');
    return '<li class="ts-chip ts-chip-grp" title="'+esc(tip)+'">['+(g.pre?esc(g.pre)+': ':'')+g.items.map(function(it){
      return esc(it.name)+' <b>'+it.n.toLocaleString()+'</b><span class="ts-sr"> tickets</span>';
    }).join(' <span class="ts-chip-sep" aria-hidden="true">|</span> ')+']</li>';
  }).join('')+'</ul>';
}
function scColHtml(rows,from,score,qk,crit){
  return '<div class="ts-sc-half"><table class="ts-sc-tbl cmp"><caption class="ts-sr">'+esc(scQLabel(qk))+', '+score+' points: tickets '+from+' to '+(from+rows.length-1)+'</caption>'+
    '<thead><tr><th scope="col" class="id">Ticket ID</th><th scope="col">Title</th></tr></thead><tbody>'+rows.map(function(t){
      var id=t.shortId||'\u2014', title=t.title||'\u2014', miss=scMissText(t,crit);
      return '<tr title="'+esc(title+'\n'+miss)+'"><td class="id">'+(t.url?'<a href="'+esc(t.url)+'" target="_blank" rel="noopener noreferrer">'+esc(id)+'<span class="ts-sr"> (opens in a new tab)</span></a>':esc(id))+'</td>'+
        '<td class="tt">'+(t.asg?'<span class="ts-sc-atag" title="Assigned to '+esc(t.asg)+' for sanitization"><span class="ts-sr">Assigned to </span>'+esc(t.asg)+'</span>':'')+esc(title)+'<span class="ts-sr">. '+esc(miss)+'</span></td></tr>';
    }).join('')+'</tbody></table></div>';
}
// One quarter's tickets: page of SC_PAGE, first half in the left column, second half in the right.
function scQBodyHtml(list,score,qk,crit){
  var n=list.length, pages=Math.max(1,Math.ceil(n/SC_PAGE)), pk=score+'|'+qk;
  var p=Math.min(Math.max(1,SC.page[pk]||1),pages), a=(p-1)*SC_PAGE, rows=list.slice(a,a+SC_PAGE), half=SC_PAGE/2;
  var L=rows.slice(0,half), R=rows.slice(half), id=score+'-'+qk;
  var st='Page '+p+' of '+pages+' \u00b7 showing '+(a+1).toLocaleString()+'\u2013'+(a+rows.length).toLocaleString()+' of '+n.toLocaleString();
  return '<div class="ts-sc-cols">'+scColHtml(L,a+1,score,qk,crit)+(R.length?scColHtml(R,a+half+1,score,qk,crit):'')+'</div>'+
    '<div class="ts-sc-pg"><span class="ts-sc-pgs" id="tsScQS-'+id+'">'+st+'</span>'+
    (pages>1?'<div class="ts-sc-pgb" role="group" aria-label="'+esc(scQLabel(qk))+' pages">'+
      '<button type="button" class="ts-mbtn sec" id="tsScQP-'+id+'" aria-describedby="tsScQS-'+id+'" onclick="tsScorePage('+score+',\''+qk+'\',-1)"'+(p<=1?' disabled':'')+'>Previous</button>'+
      '<button type="button" class="ts-mbtn sec" id="tsScQN-'+id+'" aria-describedby="tsScQS-'+id+'" onclick="tsScorePage('+score+',\''+qk+'\',1)"'+(p>=pages?' disabled':'')+'>Next</button></div>':'')+
    '</div>';
}
// Quarter sub-sections (oldest first, only quarters with tickets); one open at a time, collapsed by default.
function scQuartersHtml(list,score,crit){
  var by={}, keys=[];
  list.forEach(function(t){ var k=scQKey(t); if(!by[k]){ by[k]=[]; keys.push(k); } by[k].push(t); });
  keys.sort(function(a,b){ return a==='none'?1:b==='none'?-1:a.localeCompare(b); });
  return '<div class="ts-sc-qs">'+keys.map(function(k){
    var open=SC.openQ===k, id=score+'-'+k, n=by[k].length;
    return '<section class="ts-sc-q'+(open?' is-open':'')+'" aria-labelledby="tsScQH-'+id+'">'+
      '<h4 class="ts-sc-qh" id="tsScQH-'+id+'"><button type="button" class="ts-sc-qtog" id="tsScQB-'+id+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="tsScQL-'+id+'" onclick="tsScoreQtr('+score+',\''+k+'\')">'+
        '<span class="ts-sec-chev" aria-hidden="true">'+ICO_CHEV+'</span><span class="ts-sec-lbl">'+esc(scQLabel(k))+'</span>'+
        '<span class="ts-count"><span class="ts-sr">(</span>'+n.toLocaleString()+'<span class="ts-sr"> '+(n===1?'ticket':'tickets')+')</span></span></button></h4>'+
      '<div class="ts-sc-qb" id="tsScQL-'+id+'"'+(open?'':' hidden')+'>'+(open?scQBodyHtml(by[k],score,k,crit):'')+'</div></section>';
  }).join('')+'</div>';
}
function scBucketsHtml(d){
  var M=scMax(), by={}, i; for(i=0;i<=M;i++) by[i]=[];
  (d.tickets||[]).forEach(function(t){ if(by[t.score]) by[t.score].push(t); });
  var crit=d.criteria||[], out=[];
  if(!d._miss) d._miss={};   // header summaries, computed once per payload
  for(i=0;i<=M;i++){
    var n=(d.buckets&&d.buckets[i])||0, open=SC.open===i, great=i===M;
    out.push('<section class="ts-sec ts-sc-sec'+(open?' is-open':'')+(great?' is-great':'')+'" style="--sc-h:'+scHue(i)+'" id="tsScSec-'+i+'" aria-labelledby="tsScH-'+i+'">'+
      '<div class="ts-sc-hrow"><h3 class="ts-sec-h" id="tsScH-'+i+'"><button type="button" class="ts-sec-tog" id="tsScB-'+i+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="tsScL-'+i+'" onclick="tsScoreToggle('+i+')">'+
        '<span class="ts-sec-chev" aria-hidden="true">'+ICO_CHEV+'</span>'+
        '<span class="ts-sc-badge">'+i+' / '+M+'</span><span class="ts-sec-lbl">'+i+' '+(i===1?'point':'points')+'</span>'+
        '<span class="ts-count"><span class="ts-sr">(</span>'+n+'<span class="ts-sr"> '+(n===1?'ticket':'tickets')+')</span></span>'+
        (great?'<span class="ts-sc-great">Great</span>':'')+'</button></h3>'+
        (great?'':saHeadActs(d,i,n))+
        (d._miss[i]!=null?d._miss[i]:(d._miss[i]=scMissHtml(by[i],i,crit)))+'</div>'+
      '<div class="ts-sec-body" id="tsScL-'+i+'"'+(open?'':' hidden')+'>'+
        (open?(by[i].length?scQuartersHtml(by[i],i,crit):'<div class="ts-empty" style="margin:14px">'+ICO_INFO+'No tickets</div>'):'')+
      '</div></section>');
  }
  return '<div class="ts-secs">'+out.join('')+'</div>';
}
function scBodyHtml(){
  if(SC.loading) return scSkel();
  if(SC.err) return '<div class="ts-state" role="alert"><span class="ts-state-ic" aria-hidden="true">'+ic('alert-triangle',20)+'</span><div class="ts-state-txt">'+
    '<p class="ts-state-t">Couldn\u2019t load the sanitization scores</p><p class="ts-state-p">'+esc(SC.err)+'</p></div>'+
    '<button type="button" class="ts-btn" id="tsScoreRetry" onclick="tsScoreRetry()">'+ICO_RETRY+'<span>Retry</span></button></div>';
  var d=SC.data; if(!d) return '';
  var when=scWhen(d.asOf);
  var xb=d.excludedBy||{}, XL=[['appeal','appeal'],['test','test'],['duplicate','duplicate'],['autosim','AUTO-SIM'],['cnt','Cnt &gt; 0'],['approved error','approved error']];
  var why=XL.filter(function(x){ return xb[x[0]]; }).map(function(x){ return Number(xb[x[0]]).toLocaleString()+' '+x[1]; }).join(', ');
  return '<p class="ts-sc-tot"><b>'+Number(d.total||0).toLocaleString()+'</b> '+(d.total===1?'ticket':'tickets')+' scored \u00b7 <b>'+Number(d.excluded||0).toLocaleString()+'</b> ignored'+(why?' ('+why+')':'')+
      (when?' <span>\u00b7 data as of '+esc(when)+'</span>':'')+'</p>'+
    scDistHtml(d)+scBucketsHtml(d);
}
function scoreHtml(){
  if(!tsIsOwner()) return '';
  var tot=SC.data?Number(SC.data.total||0):null;
  return '<section class="'+tsTopCls('tsScore')+'" id="tsScore" aria-labelledby="tsScoreHead" aria-busy="'+(SC.loading?'true':'false')+'">'+
    tsTopHead('tsScore',{icon:ICO_SCORE,title:'Sanitization scores',
      sum:tot!=null?tsTopSum(tot.toLocaleString()+' scored'):'',
      tags:'<span class="ts-own">Only visible to you</span>',
      sub:'Every Resolved or Closed ticket gets one point per check (3 SIM Title + 7 Root Cause Details + 1 ClosureCode = '+scMax()+'). Lowest scores need sanitizing first.',
      acts:scQuarterSelect()})+
    tsTopBody('tsScore')+scBodyHtml()+'</div></section>';
}
function scRender(focusId){
  var el=document.getElementById('tsScore'); if(!el) return;
  tsKeepFocus(function(){ el.outerHTML=scoreHtml(); });
  if(focusId){ var f=document.getElementById(focusId); if(f) f.focus(); }
}
// keep = refresh in place (after an assign / revoke): the open section, quarter and page stay.
async function loadScores(quarter,fromRetry,keep){
  if(!tsIsOwner()) return;
  SC.loading=true; SC.err=''; if(quarter!=null) SC.quarter=quarter; scRender();
  var r=null;
  try{ r=await A.api('GET','/api/sanitization-score?quarter=since2026'); }catch(e){ r=null; }
  SC.loading=false;
  if(r&&r.ok&&r.data&&r.data.buckets){ SC.data=r.data; SC.quarter=r.data.quarter; if(!keep){ SC.open=null; SC.openQ=null; SC.page={}; } }
  else SC.err=(r&&r.data&&r.data.error)||(r?'The server answered HTTP '+(r.status||'?')+'.':'Network error.');
  scRender(SC.err&&fromRetry?'tsScoreRetry':(quarter!=null?'tsScoreQ':null));
  announce(SC.err?'Couldn\u2019t load the sanitization scores.':('Sanitization scores loaded: '+SC.data.total+' tickets scored, '+SC.data.excluded+' ignored.'));
}
function tsScoreRetry(){ loadScores(null,true); }
function tsScoreQuarter(v){ loadScores(String(v||'')); }
// Opening / closing a score section collapses its quarters and forgets their pages.
function tsScoreToggle(i){ SC.open=SC.open===i?null:i; SC.openQ=null; SC.page={}; scRender('tsScB-'+i); }
function tsScoreJump(i){
  if(SC.open!==i){ SC.open=i; SC.openQ=null; SC.page={}; }
  scRender('tsScB-'+i);
  var s=document.getElementById('tsScSec-'+i); if(s&&s.scrollIntoView) s.scrollIntoView({block:'nearest',behavior:'smooth'});
}
// Quarter sub-section: one open at a time; collapsing resets its page.
function tsScoreQtr(i,k){
  if(SC.open!==i) return;
  SC.openQ=SC.openQ===k?null:k; SC.page={};
  scRender('tsScQB-'+i+'-'+k);
}
function tsScorePage(i,k,dir){
  if(SC.open!==i||SC.openQ!==k||!SC.data) return;
  var n=(SC.data.tickets||[]).filter(function(t){ return t.score===i&&scQKey(t)===k; }).length;
  var pages=Math.max(1,Math.ceil(n/SC_PAGE)), pk=i+'|'+k, p=Math.min(Math.max(1,(SC.page[pk]||1)+dir),pages);
  SC.page[pk]=p;
  var bid=(dir<0?'tsScQP-':'tsScQN-')+i+'-'+k, atEnd=dir<0?p<=1:p>=pages;
  scRender(atEnd?'tsScQB-'+i+'-'+k:bid);   // keep focus on the pressed button; the heading once it disables
  var a=(p-1)*SC_PAGE;
  announce(scQLabel(k)+', '+i+' points: page '+p+' of '+pages+', showing '+(a+1)+' to '+Math.min(a+SC_PAGE,n)+' of '+n+'.');
}
window.tsScoreRetry=tsScoreRetry; window.tsScoreQuarter=tsScoreQuarter; window.tsScoreToggle=tsScoreToggle; window.tsScoreJump=tsScoreJump; window.tsScoreQtr=tsScoreQtr; window.tsScorePage=tsScorePage;

// ---- Sanitization assignments (owner-only; the server enforces it: /api/sanitization-assign) ----
// Assign a score section's oldest available tickets to a contractor (the server picks them), then the
// next data uploads verify them (assignment log here; per-contractor results on sanitization-tracker.html).
// SA = { loading, err, data:{contractors, assignments, ...}, x:{id:true} (Show IDs), rv:{id:true} (revoking) }
var SA={loading:true, err:'', data:null, x:{}, rv:{}};
function saPlural(n,one,many){ n=Number(n)||0; return n.toLocaleString()+' '+(n===1?one:(many||one+'s')); }
function saDay(iso){ var d=new Date(iso); return iso&&!isNaN(d)?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):'\u2014'; }
function saDate(iso){ var d=new Date(iso); return iso&&!isNaN(d)?d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'\u2014'; }
function saDayKey(iso){ var d=new Date(iso); if(!iso||isNaN(d)) return 'unknown'; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function saUrl(t){ return (t&&t.url)||(t&&t.shortId?'https://t.corp.amazon.com/issues/'+encodeURIComponent(t.shortId):''); }
function saFind(id){ var d=SA.data; return d?(d.assignments||[]).filter(function(a){ return a.id===id; })[0]||null:null; }
function saLinkCell(t){ var u=saUrl(t), id=t.shortId||'\u2014'; return u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(id)+'<span class="ts-sr"> (opens in a new tab)</span></a>':esc(id); }
function saExtractBtn(attr,label){ return '<button type="button" class="ts-abtn" '+attr+'>'+ICO_COPY+'<span class="tsa-bl">Extract tickets</span><span class="ts-sr"> '+esc(label||'')+'</span></button>'; }

// Copy ONLY the ticket links, one per line. Feedback 'Copied N links'; when the clipboard is blocked a
// read-only textarea with the links (selected) appears in fbHost.
function saCopy(urls,btn,fbHost){
  urls=(urls||[]).filter(Boolean); var text=urls.join('\n'), n=urls.length;
  var lbl=btn&&btn.querySelector('.tsa-bl');
  if(lbl&&!lbl.getAttribute('data-l')) lbl.setAttribute('data-l',lbl.textContent);   // e.g. 'Extract tickets' / 'Extract all'
  var done=function(ok){
    if(ok){
      if(fbHost) fbHost.innerHTML='';
      var msg='Copied '+saPlural(n,'link');
      if(lbl){ lbl.textContent=msg; setTimeout(function(){ if(lbl.isConnected) lbl.textContent=lbl.getAttribute('data-l')||'Extract tickets'; },1800); }
      announce(msg); return;
    }
    if(fbHost){
      var fid='tsaFb'+Math.random().toString(36).slice(2,8);
      fbHost.innerHTML='<label class="tsa-fbl" for="'+fid+'">Copying is blocked in this browser. Select and copy these '+saPlural(n,'link')+':</label><textarea class="tsa-fb" id="'+fid+'" readonly rows="5"></textarea>';
      var ta=document.getElementById(fid); ta.value=text; ta.focus(); ta.select();
    }
    announce('Copying is blocked. The links are shown in a text box to copy by hand.');
  };
  if(!n){ announce('No ticket links to copy.'); return; }
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ done(true); },function(){ copyFallback(text,done); });
  else copyFallback(text,done);
}

// Score section header: 'N available' + 'Assign to sanitize' (0..scMax()-1 points; the top section has none).
function saHeadActs(d,i,n){
  var av=(d.available&&d.available[i]!=null)?d.available[i]:n;
  return '<div class="ts-sc-acts"><span class="ts-sc-av'+(av?'':' is-none')+'" id="tsScAv-'+i+'">'+Number(av).toLocaleString()+' available</span>'+
    '<button type="button" class="ts-abtn" id="tsScA-'+i+'" aria-haspopup="dialog" aria-label="Assign '+i+'-point tickets to sanitize" aria-describedby="tsScAv-'+i+'" onclick="tsAsgOpen('+i+')"'+(av?'':' disabled')+'>'+
      ic('user-plus',14)+'Assign to sanitize</button></div>';
}

async function loadAssign(fromRetry,focusSel){
  if(!tsIsOwner()) return;
  SA.loading=!SA.data; SA.err=''; if(SA.loading) saRender();
  var r=null;
  try{ r=await A.api('GET','/api/sanitization-assign'); }catch(e){ r=null; }
  SA.loading=false;
  if(r&&r.ok&&r.data&&Array.isArray(r.data.assignments)) SA.data=r.data;
  else SA.err=(r&&r.data&&r.data.error)||(r?'The server answered HTTP '+(r.status||'?')+'.':'Network error.');
  saRender(SA.err&&fromRetry?'#tsAsgRetry':focusSel);
}
function tsAsgRetry(){ loadAssign(true); }
window.tsAsgRetry=tsAsgRetry;
// The assignment log is a top-level accordion card, re-rendered in place by id. (Contractor
// performance and Needs rework moved to sanitization-tracker.html.)
var SA_CARDS=['tsAsgLog'];
function saRender(focusSel){
  if(!document.getElementById('tsAsgLog')) return;
  tsKeepFocus(function(){ SA_CARDS.forEach(function(id){ var el=document.getElementById(id); if(el) el.outerHTML=saCardHtml(id); }); });
  if(focusSel){ var f=document.querySelector(focusSel); if(f) f.focus(); }
}
function saCard(id,icon,title,sub,body,sum){
  return '<section class="'+tsTopCls(id)+'" id="'+id+'" aria-labelledby="'+id+'Head" aria-busy="'+(SA.loading?'true':'false')+'">'+
    tsTopHead(id,{icon:icon,title:title,sum:sum,tags:'<span class="ts-own">Only visible to you</span>',sub:sub})+
    tsTopBody(id)+body+'</div></section>';
}
function saSkel(){ return '<div aria-hidden="true"><span class="ts-skel" style="width:100%;height:14px;margin-bottom:10px"></span><span class="ts-skel" style="width:70%;height:14px"></span></div>'; }
function saErrHtml(){
  return '<div class="ts-state" role="alert"><span class="ts-state-ic" aria-hidden="true">'+ic('alert-triangle',20)+'</span><div class="ts-state-txt">'+
    '<p class="ts-state-t">Couldn\u2019t load the sanitization assignments</p><p class="ts-state-p">'+esc(SA.err)+'</p></div>'+
    '<button type="button" class="ts-btn" id="tsAsgRetry" onclick="tsAsgRetry()">'+ICO_RETRY+'<span>Retry</span></button></div>';
}
// The assignment log card (a load error shows inside it, with Retry).
function saCardHtml(id){
  var d=SA.data, ready=!SA.loading&&!SA.err&&d;
  return saCard('tsAsgLog',ic('clock-rewind',17),'Sanitization assignment log','Who was assigned how many tickets, by day, newest first. Due 7 days after assigning.',
    SA.loading?saSkel():(SA.err?saErrHtml():saLogHtml(d)), ready?tsTopSum(saPlural((d.assignments||[]).length,'assignment')):'');
}
function saSecsHtml(){
  if(!tsIsOwner()) return '';
  return SA_CARDS.map(saCardHtml).join('');
}
function saStatusHtml(a){
  if(a.status==='revoked') return '<span class="tsa-pill revoked">Revoked by '+esc(a.revokedBy||'\u2014')+' \u00b7 '+esc(saDate(a.revokedAt))+'</span>';
  var nf=(a.notFound||0)+(a.excluded||0);
  if(a.statusLabel==='Verified') return '<span class="tsa-pill verified'+(a.failed?' has-bad':'')+'">Verified: '+Number(a.passed).toLocaleString()+' passed, '+Number(a.failed).toLocaleString()+' need rework'+(nf?', '+nf+' not found or ignored':'')+'</span>';
  if(a.statusLabel==='Awaiting new data') return '<span class="tsa-pill awaiting">Awaiting new data</span>';
  return '<span class="tsa-pill progress">In progress until '+esc(saDay(a.dueAt))+(a.dataStamp&&a.verifiedCount?' \u00b7 '+Number(a.passed).toLocaleString()+' at '+scMax()+'/'+scMax()+' so far':'')+'</span>';
}
function saEntryHtml(a){
  var id=a.id, x=SA.x[id]===true, rv=SA.rv[id]===true, list=a.tickets||[];
  var sum=a.assignedBy+' assigned '+saPlural(a.count,'ticket')+' to '+a.assignee+' on '+saDate(a.assignedAt);
  var ids=x?list.map(function(t){
    var now=t.score!=null?(t.score+' / '+scMax()):(t.excludedReason?'ignored ('+t.excludedReason+')':(t.found===false?'not found':'\u2014'));
    return '<li>'+saLinkCell(t)+'<span class="t">'+esc(t.title||'No title')+'</span><span class="s">'+esc(String(t.scoreAtAssign))+' \u2192 '+esc(now)+'</span></li>';
  }).join(''):'';
  return '<li class="tsa-e'+(a.status==='revoked'?' is-rvk':'')+'">'+
    '<span class="tsa-what"><span class="tsa-mut">'+esc(new Date(a.assignedAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}))+'</span> \u00b7 '+
      '<b>'+esc(a.assignedBy)+'</b> assigned <b>'+saPlural(a.count,'ticket')+'</b> ('+a.score+' '+(a.score===1?'point':'points')+') to <b>'+esc(a.assignee)+'</b> \u00b7 due '+esc(saDay(a.dueAt))+saStatusHtml(a)+'</span>'+
    '<span class="tsa-acts">'+saExtractBtn('data-sa="copy" data-id="'+esc(id)+'"','for '+sum)+
      '<button type="button" class="ts-abtn" data-sa="x" data-id="'+esc(id)+'" id="tsaX-'+esc(id)+'" aria-expanded="'+x+'" aria-controls="tsaI-'+esc(id)+'">'+(x?'Hide':'Show')+' IDs<span class="ts-sr"> for '+esc(sum)+'</span></button>'+
      (a.status==='active'?'<button type="button" class="ts-abtn is-red" data-sa="rv" data-id="'+esc(id)+'"'+(rv?' disabled aria-busy="true"':'')+'>'+ic('clock-rewind',13)+(rv?'Revoking\u2026':'Revoke')+'<span class="ts-sr"> '+esc(sum)+'</span></button>':'')+
    '</span>'+
    '<span class="tsa-fbh" id="tsaF-'+esc(id)+'"></span>'+
    '<ul class="tsa-ids" id="tsaI-'+esc(id)+'" aria-label="Tickets in this assignment (score at assign \u2192 now)"'+(x?'':' hidden')+'>'+ids+'</ul></li>';
}
function saLogHtml(d){
  var list=(d.assignments||[]).slice().sort(function(a,b){ return String(b.assignedAt||'').localeCompare(String(a.assignedAt||'')); });
  if(!list.length) return '<div class="ts-empty">'+ICO_INFO+'No tickets have been assigned for sanitization yet. Use \u201cAssign to sanitize\u201d on a score section above.</div>';
  var days=[], by={};
  list.forEach(function(a){ var k=saDayKey(a.assignedAt); if(!by[k]){ by[k]=[]; days.push(k); } by[k].push(a); });
  return '<ol class="tsa-days" aria-label="Assignment log by day, newest first">'+days.map(function(k){
    var items=by[k], label=k==='unknown'?'Unknown date':new Date(items[0].assignedAt).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    var tix=0; items.forEach(function(a){ tix+=Number(a.count)||0; });
    return '<li class="tsa-day"><h3 class="tsa-day-h">'+esc(label)+' <span class="tsa-mut">\u00b7 '+saPlural(items.length,'assignment')+' \u00b7 '+saPlural(tix,'ticket')+'</span></h3>'+
      '<ol class="tsa-log">'+items.map(saEntryHtml).join('')+'</ol></li>';
  }).join('')+'</ol>';
}
// Log buttons (delegated: the card is re-rendered).
document.addEventListener('click',async function(ev){
  var b=ev.target&&ev.target.closest?ev.target.closest('[data-sa]'):null; if(!b||!tsIsOwner()) return;
  var act=b.getAttribute('data-sa'), id=b.getAttribute('data-id'), a=saFind(id);
  if(act==='x'&&a){ SA.x[id]=!SA.x[id]; saRender('#tsaX-'+id); return; }
  if(act==='copy'&&a){ saCopy((a.tickets||[]).map(saUrl),b,document.getElementById('tsaF-'+id)); return; }
  if(act==='rv'&&a&&a.status==='active'&&!SA.rv[id]){
    var ok=window.PHDConfirm?await window.PHDConfirm({title:'Revoke assignment',body:'Revoke the assignment of '+saPlural(a.count,'ticket')+' to '+a.assignee+'? Its tickets that are not '+scMax()+'/'+scMax()+' become available to assign again. The log entry is kept.',okLabel:'Revoke',danger:true}):window.confirm('Revoke this assignment?');
    if(!ok){ var b0=document.querySelector('[data-sa="rv"][data-id="'+id+'"]'); if(b0) b0.focus(); return; }
    SA.rv[id]=true; saRender();
    var r=null; try{ r=await A.api('POST','/api/sanitization-assign/revoke',{id:id}); }catch(e){ r=null; }
    delete SA.rv[id];
    var msg=r&&r.ok&&r.data&&r.data.ok?(r.data.alreadyRevoked?'This assignment was already revoked.':'Revoked the assignment of '+saPlural(a.count,'ticket')+' to '+a.assignee+'.')
      :((r&&r.data&&r.data.error)||'Could not revoke the assignment. Please try again.');
    if(window.PHDBanner) window.PHDBanner[r&&r.ok?'ok':'error'](msg);
    await loadAssign(false,'#tsaX-'+id);
    announce(msg);
    if(r&&r.ok) loadScores(null,false,true);
  }
});

// ---- Assign pop-up: how many -> split across contractors -> done (Extract tickets) ----
// SAD = { score, avail, step:1|2|3, count, split:{login:'typed'}, touched, busy, prog, err,
//         done:[{assignee,count,dueAt,tickets:[{shortId,url}]}], failed:{login,count,status,msg}|null, rest:[{login,count}] }
var SAD=null;
var SAD_SUB={1:'Step 1 of 2 \u00b7 How many tickets?',2:'Step 2 of 2 \u00b7 Which contractors?',3:'Done'};
function saContractors(){ return (SA.data&&SA.data.contractors)||[]; }
function saLogins(){ return saContractors().map(function(c){ return c.login; }); }

// Validate a split of n tickets: blank = 0, whole numbers only, total 1..n (less than n is fine: the rest stay available).
function saSplitCheck(split,logins,n){
  var total=0,k=0,bad='';
  (logins||[]).forEach(function(l){
    var v=split&&split[l]!=null?String(split[l]).trim():'';
    if(v==='') return;
    if(!/^\d+$/.test(v)){ if(!bad) bad=l; return; }
    var q=Number(v); if(q>0){ total+=q; k++; }
  });
  var err='';
  if(bad) err='Enter a whole number of tickets for '+bad+'.';
  else if(total>n) err='Allocated '+total.toLocaleString()+' of '+n.toLocaleString()+'. Remove '+(total-n).toLocaleString()+' to continue.';
  else if(!total) err='Enter how many tickets each contractor gets.';
  return {total:total,k:k,remaining:Math.max(0,n-total),over:Math.max(0,total-n),ok:!err,err:err};
}
// One POST per contractor, in list order (the server picks the next oldest available tickets each call).
// Stops at the first failure; returns what succeeded, the failure and the not-yet-attempted rest.
async function saRunSplit(api,score,queue,onStep){
  var done=[];
  for(var i=0;i<queue.length;i++){
    var q=queue[i]; if(onStep) onStep(q,i,queue.length);
    var r=null; try{ r=await api('POST','/api/sanitization-assign',{score:score,count:q.count,assignee:q.login}); }catch(e){ r=null; }
    if(r&&r.ok&&r.data&&r.data.ok){
      done.push({login:q.login,assignee:r.data.assignee||q.login,count:r.data.count!=null?Number(r.data.count):q.count,dueAt:r.data.dueAt,tickets:r.data.tickets||[]});
      continue;
    }
    var msg=(r&&r.data&&r.data.error)||(r?'The server answered HTTP '+(r.status||'?')+'.':'Network error.');
    return {done:done,failed:{login:q.login,count:q.count,status:r?r.status:0,msg:msg},rest:queue.slice(i+1)};
  }
  return {done:done,failed:null,rest:[]};
}
function saDoneFor(login){ return SAD.done.filter(function(d){ return d.login===login; })[0]||null; }
// Contractors still to assign (count > 0, not yet assigned in this pop-up), in list order.
function saQueue(){
  return saLogins().filter(function(l){ return !saDoneFor(l); }).map(function(l){
    var v=String(SAD.split[l]==null?'':SAD.split[l]).trim(); return {login:l,count:/^\d+$/.test(v)?Number(v):0};
  }).filter(function(q){ return q.count>0; });
}
async function tsAsgOpen(score){
  if(!tsIsOwner()||!SC.data) return;
  var av=(SC.data.available&&SC.data.available[score]!=null)?SC.data.available[score]:(SC.data.buckets[score]||0);
  if(!av) return;
  tsAsgClose(true);
  SAD={score:score,avail:av,step:1,count:av,split:{},touched:false,busy:false,prog:'',err:'',done:[],failed:null,rest:[]};
  var ov=document.createElement('div'); ov.id='tsAsgDlg'; ov.className='tbl-bg'; ov.style.cssText='display:flex;z-index:5000';
  ov.innerHTML='<div class="tbl-card" role="dialog" aria-modal="true" aria-labelledby="tsAsgT" aria-describedby="tsAsgSub">'+
    '<div class="tbl-head"><span class="tbl-head-ic" aria-hidden="true">'+ic('user-plus',20)+'</span>'+
      '<div class="tbl-head-tx"><div class="tbl-eyebrow">Sanitization scores \u00b7 Assign</div><h2 class="tbl-title" id="tsAsgT">Assign '+score+'-point tickets to sanitize</h2></div>'+
      '<button type="button" class="tbl-x" data-sax="1" aria-label="Close">'+ic('close',18)+'</button>'+
      '<p class="tbl-sub" id="tsAsgSub"></p></div>'+
    '<div class="tbl-body" id="tsAsgBody"></div></div>';
  ov.addEventListener('click',function(e){ if(e.target===ov) tsAsgClose(); });
  document.body.appendChild(ov);
  if(window.PHDLoginUI) window.PHDLoginUI.opened(ov,function(){ tsAsgClose(); },null);
  saPaint();
  if(!SA.data){ await loadAssign(); if(SAD) saPaint(SAD.step===1?'#tsaCount':null); }
}
window.tsAsgOpen=tsAsgOpen;
// Closing after a successful assign refreshes the scores (available counts) and the assignment cards.
function tsAsgClose(force){
  var ov=document.getElementById('tsAsgDlg'); if(!ov) return;
  if(SAD&&SAD.busy&&!force) return;
  var done=!!(SAD&&SAD.done.length), score=SAD?SAD.score:null; SAD=null;   // any contractor assigned (also a partial run)
  ov.remove(); if(window.PHDLoginUI) window.PHDLoginUI.closed(ov);
  if(done){
    loadAssign();
    loadScores(null,false,true).then(function(){ var b=document.getElementById('tsScA-'+score)||document.getElementById('tsScB-'+score); if(b) b.focus(); });
  }
}
window.tsAsgClose=tsAsgClose;
function saErrP(){ return '<p class="tbl-err" id="tsaErr" role="alert"'+(SAD.err?' style="display:block"':'')+'>'+esc(SAD.err||'')+'</p>'; }
function saSumHtml(chk){
  var n=SAD.count, tag=chk.over?'<span class="tsa-tag is-over">'+chk.over.toLocaleString()+' over</span>':
    (chk.remaining?'<span class="tsa-tag is-rem">'+chk.remaining.toLocaleString()+' remaining</span>':'<span class="tsa-tag is-all">All allocated</span>');
  return '<span>Allocated '+chk.total.toLocaleString()+' of '+n.toLocaleString()+' \u00b7 Remaining '+chk.remaining.toLocaleString()+'</span>'+tag;
}
function saGoLabel(chk){
  if(SAD.busy) return SAD.prog||'Assigning\u2026';
  var q=saQueue(), x=q.reduce(function(s,e){ return s+e.count; },0);
  if(!chk.ok||!q.length) return SAD.failed?'Retry':'Assign tickets';
  return (SAD.failed?'Retry: assign ':'Assign ')+saPlural(x,'ticket')+' to '+saPlural(q.length,'contractor');
}
// Outcome of a run that stopped at an error: who got their tickets, who failed (server message), who wasn't tried.
function saResHtml(){
  var f=SAD.failed; if(!f) return '';
  var ok=SAD.done.map(function(d){ return esc(d.login)+' ('+saPlural(d.count,'ticket')+')'; }).join(', ');
  var rest=SAD.rest.map(function(q){ return esc(q.login)+' ('+saPlural(q.count,'ticket')+')'; }).join(', ');
  return '<div class="tsa-res" id="tsaRes" role="alert">'+
    (ok?'<p><b class="ok">Assigned:</b> '+ok+'</p>':'')+
    '<p><b class="bad">Failed:</b> '+esc(f.login)+' ('+saPlural(f.count,'ticket')+')'+(f.status?' \u00b7 HTTP '+f.status:'')+' \u2014 '+esc(f.msg)+'</p>'+
    (rest?'<p><b>Not attempted:</b> '+rest+'</p>':'')+
    '<p>Retry assigns the remaining contractors only. You can change their numbers first.</p></div>';
}
// Live update of the summary, inline error, invalid inputs and the primary button (no repaint, keeps focus).
function saSplitSync(){
  var b=document.getElementById('tsAsgBody'); if(!b||!SAD||SAD.step!==2) return;
  var chk=saSplitCheck(SAD.split,saLogins(),SAD.count);
  var s=b.querySelector('#tsaSum'); if(s) s.innerHTML=saSumHtml(chk);
  var showErr=!chk.ok&&SAD.touched;
  var e=b.querySelector('#tsaSErr'); if(e){ e.textContent=showErr?chk.err:''; e.style.display=showErr?'block':'none'; }
  b.querySelectorAll('input.tsa-q').forEach(function(el){
    var v=String(el.value).trim(), bad=v!==''&&(!/^\d+$/.test(v)||(chk.over>0&&Number(v)>0&&!el.disabled));
    if(bad) el.setAttribute('aria-invalid','true'); else el.removeAttribute('aria-invalid');
  });
  var go=b.querySelector('#tsaGo'); if(go){ go.disabled=SAD.busy||!chk.ok||!saQueue().length; go.textContent=saGoLabel(chk); }
}
function saBodyHtml(){
  var cancel='<button type="button" class="tbl-cancel" data-sax="1"'+(SAD.busy?' disabled':'')+'>Cancel</button>';
  if(SAD.step===1){
    return '<p class="tbl-msg"><b>'+saPlural(SAD.avail,'ticket')+'</b> with <b>'+SAD.score+' '+(SAD.score===1?'point':'points')+'</b> available to assign</p>'+
      '<label class="tbl-label" for="tsaCount" style="margin-top:14px!important">How many tickets?</label>'+
      '<input type="number" class="tsa-num" id="tsaCount" min="1" max="'+SAD.avail+'" step="1" inputmode="numeric" value="'+SAD.count+'" aria-describedby="tsaHint'+(SAD.err?' tsaErr':'')+'"'+(SAD.err?' aria-invalid="true"':'')+'>'+
      '<p class="tsa-hint" id="tsaHint">Oldest first, across all quarters \u00b7 1 to '+SAD.avail.toLocaleString()+'</p>'+saErrP()+
      '<div class="tbl-actions tbl-row">'+cancel+'<button type="button" class="tbl-submit" data-sastep="2">Next</button></div>';
  }
  if(SAD.step===2){
    var cs=saContractors(), chk=saSplitCheck(SAD.split,saLogins(),SAD.count), showErr=!chk.ok&&SAD.touched, lock=SAD.done.length>0;
    var rows=cs.length?'<ul class="tsa-list" aria-labelledby="tsaWhoK">'+cs.map(function(c,i){
      var d=saDoneFor(c.login), v=d?String(d.count):(SAD.split[c.login]==null?'':String(SAD.split[c.login]));
      return '<li><label class="tsa-row'+(d?' is-done':'')+'" for="tsaQ-'+i+'"><span class="tsa-t">'+esc(c.login)+'</span>'+
        (d?'<span class="tsa-tag is-all">Assigned</span>':'')+
        '<input type="number" class="tsa-q" id="tsaQ-'+i+'" data-login="'+esc(c.login)+'" aria-label="Tickets for '+esc(c.login)+'" aria-describedby="tsaSum tsaSErr"'+
          ' min="0" max="'+SAD.count+'" step="1" inputmode="numeric" placeholder="0" value="'+esc(v)+'"'+(d||SAD.busy?' disabled':'')+'></label></li>';
    }).join('')+'</ul>':(SA.loading?'<p class="tbl-msg">Loading contractors\u2026</p>':'<p class="tbl-msg">No contractors found.</p>');
    return '<p class="tsa-k" id="tsaWhoK">Split '+saPlural(SAD.count,'ticket')+' ('+SAD.score+' '+(SAD.score===1?'point':'points')+') across contractors</p>'+rows+
      '<div class="tsa-sum" id="tsaSum" aria-live="polite">'+saSumHtml(chk)+'</div>'+
      '<p class="tbl-err" id="tsaSErr" aria-live="polite"'+(showErr?' style="display:block"':'')+'>'+esc(showErr?chk.err:'')+'</p>'+
      '<p class="tsa-hint">Any tickets left unallocated stay available.</p>'+
      saResHtml()+saErrP()+'<p class="tsa-prog" id="tsaProg" role="status">'+esc(SAD.busy?SAD.prog:'')+'</p>'+
      '<div class="tbl-actions tbl-row">'+(lock?'':'<button type="button" class="tbl-cancel" data-sastep="1"'+(SAD.busy?' disabled':'')+'>Back</button>')+
        (lock?'<button type="button" class="tbl-cancel" data-sax="1"'+(SAD.busy?' disabled':'')+'>Close</button>':cancel)+
        '<button type="button" class="tbl-submit'+(SAD.busy?' is-busy':'')+'" id="tsaGo"'+(SAD.busy||!chk.ok||!saQueue().length?' disabled':'')+(SAD.busy?' aria-busy="true"':'')+'>'+esc(saGoLabel(chk))+'</button></div>';
  }
  var tot=SAD.done.reduce(function(s,d){ return s+d.count; },0), all=[];
  SAD.done.forEach(function(d){ all=all.concat(d.tickets.map(saUrl)); });
  return '<p class="tsa-ok" role="status">'+ic('check-circle',18)+'Assigned '+saPlural(tot,'ticket')+' to '+saPlural(SAD.done.length,'contractor')+'</p>'+
    '<p class="tsa-hint">Due '+esc(saDate(SAD.done[0]&&SAD.done[0].dueAt))+'. Extract copies only the ticket links, one per line.</p>'+
    '<ul class="tsa-dl" aria-label="Assigned contractors">'+SAD.done.map(function(d,i){
      return '<li><span class="tsa-t">'+esc(d.assignee)+'</span><span class="tsa-c">'+saPlural(d.count,'ticket')+'</span>'+
        saExtractBtn('data-sacp="'+i+'"','for the '+saPlural(d.count,'ticket')+' assigned to '+d.assignee)+'</li>';
    }).join('')+'</ul>'+
    '<div class="tsa-all"><button type="button" class="ts-abtn" id="tsaCopy">'+ICO_COPY+'<span class="tsa-bl">Extract all</span><span class="ts-sr"> '+esc(saPlural(all.length,'ticket link'))+'</span></button></div>'+
    '<span class="tsa-fbh" id="tsaFbD"></span>'+
    '<div class="tbl-actions tbl-row"><button type="button" class="tbl-submit" data-sax="1">Close</button></div>';
}
function saPaint(focusSel){
  var ov=document.getElementById('tsAsgDlg'); if(!ov||!SAD) return;
  document.getElementById('tsAsgSub').textContent=SAD_SUB[SAD.step];
  var b=document.getElementById('tsAsgBody'); b.innerHTML=saBodyHtml();
  var f=focusSel?b.querySelector(focusSel):null;
  if(!f) f=SAD.step===1?b.querySelector('#tsaCount'):(SAD.step===3?b.querySelector('#tsaCopy'):(b.querySelector('input.tsa-q:not(:disabled)')||b.querySelector('.tbl-cancel')));
  if(f){ f.focus(); if(f.select&&f.type==='number') f.select(); }
}
function saStep1Next(){
  var el=document.getElementById('tsaCount'), v=String(el?el.value:'').trim(), n=/^\d+$/.test(v)?Number(v):NaN;
  if(!(n>=1&&n<=SAD.avail)){ SAD.err='Enter a whole number from 1 to '+SAD.avail.toLocaleString()+'.'; saPaint('#tsaCount'); return; }
  SAD.count=n; SAD.err=''; SAD.step=2; saPaint();
}
async function saSubmit(){
  if(!SAD||SAD.busy||SAD.step!==2) return;
  SAD.touched=true;
  var chk=saSplitCheck(SAD.split,saLogins(),SAD.count), queue=saQueue();
  if(!chk.ok||!queue.length){ saSplitSync(); var bad=document.querySelector('#tsAsgBody input.tsa-q[aria-invalid="true"]')||document.querySelector('#tsAsgBody input.tsa-q:not(:disabled)'); if(bad) bad.focus(); return; }
  var sd=SAD; SAD.busy=true; SAD.err=''; SAD.failed=null; SAD.rest=[]; SAD.prog='Assigning\u2026'; saPaint('#tsaGo');
  var out=await saRunSplit(A.api.bind(A),SAD.score,queue,function(q,i,k){
    if(SAD!==sd) return;
    SAD.prog='Assigning to '+q.login+' ('+(i+1)+' of '+k+')\u2026';
    var go=document.getElementById('tsaGo'); if(go) go.textContent=SAD.prog;
    var p=document.getElementById('tsaProg'); if(p) p.textContent=SAD.prog;
  });
  if(SAD!==sd) return;
  SAD.busy=false; SAD.prog=''; SAD.done=SAD.done.concat(out.done);
  if(!out.failed){
    SAD.step=3; saPaint();
    announce('Assigned '+saPlural(SAD.done.reduce(function(s,d){ return s+d.count; },0),'ticket')+' to '+saPlural(SAD.done.length,'contractor')+'.');
    return;
  }
  SAD.failed=out.failed; SAD.rest=out.rest;
  saPaint('#tsaGo');
  announce((out.done.length?'Assigned to '+out.done.map(function(d){ return d.login; }).join(', ')+'. ':'')+'Failed for '+out.failed.login+': '+out.failed.msg);
}
document.addEventListener('click',function(ev){
  var t=ev.target; if(!t||!t.closest||!t.closest('#tsAsgDlg')||!SAD) return;
  if(t.closest('[data-sax]')){ tsAsgClose(); return; }
  var st=t.closest('[data-sastep]'); if(st&&!st.disabled){ var to=Number(st.getAttribute('data-sastep')); if(to===2) saStep1Next(); else { SAD.step=to; SAD.err=''; saPaint(); } return; }
  if(t.closest('#tsaGo')){ saSubmit(); return; }
  var fb=document.getElementById('tsaFbD');
  var one=t.closest('[data-sacp]'); if(one){ var d=SAD.done[Number(one.getAttribute('data-sacp'))]; if(d) saCopy(d.tickets.map(saUrl),one,fb); return; }
  var cp=t.closest('#tsaCopy'); if(cp){ var all=[]; SAD.done.forEach(function(d){ all=all.concat(d.tickets.map(saUrl)); }); saCopy(all,cp,fb); }
});
document.addEventListener('input',function(ev){
  var el=ev.target; if(!el||!SAD||!el.classList||!el.classList.contains('tsa-q')||!el.closest('#tsAsgDlg')) return;
  SAD.split[el.getAttribute('data-login')]=el.value; SAD.touched=true; SAD.err='';
  var er=document.getElementById('tsaErr'); if(er){ er.textContent=''; er.style.display='none'; }
  saSplitSync();
});
document.addEventListener('keydown',function(ev){
  var t=ev.target; if(ev.key!=='Enter'||!SAD||!t) return;
  if(t.id==='tsaCount'){ ev.preventDefault(); saStep1Next(); }
  else if(t.classList&&t.classList.contains('tsa-q')&&t.closest('#tsAsgDlg')){ ev.preventDefault(); saSubmit(); }
});

// Esc closes whichever modal is open.
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ tsCloseEdit(); tsCloseDel(); tsCloseAdd(); tsAsgClose(); } });
// Fill the add pop-up's [data-ic] icon slots (icons.js).
document.querySelectorAll('#tsAddModal [data-ic]').forEach(function(el){ el.insertAdjacentHTML('afterbegin',ic(el.getAttribute('data-ic'),+el.getAttribute('data-sz')||16)); });

// API for sanitization-tracker.html. The page builds its shell once (hero + the four sections), then
// calls start() for logged-in users (the login gate is the page's). Any logged-in user sees the checklist;
// only harisss/flofalgu see edit controls; scores + the assignment log are owner only (servers enforce both).
window.PHDSanCheck = {
  isOwner: tsIsOwner, canEdit: tsCanEdit,
  // Top-level accordion helpers: open(id) = the open section on first paint (default: the checklist).
  open: function (id) { if (id !== undefined) TS_TOP = id; return TS_TOP; },
  topCls: tsTopCls, topHead: tsTopHead, topBody: tsTopBody, topSum: tsTopSum,
  chipsHtml: function () { return chipsHtml(tsCanEdit()); }, promptBtnHtml: promptBtnHtml,
  guideHtml: function () { return guideHtml(false); }, scoreHtml: scoreHtml, logHtml: saSecsHtml,
  start: function () {
    loadChecklist();
    loadScores();   // owner only (no-op for everyone else; the server returns 403 to non-owners anyway)
    loadAssign();   // owner only: sanitization assignment log
  }
};
})();
