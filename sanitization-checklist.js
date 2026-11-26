// Ticket Sanitization sections of sanitization-tracker.html (moved here from ticket-sanitization.html):
//   - the hero buttons "Copy prompt" (TS_PROMPT), "Sanitization checklist" and "Sanitization assignment
//     log" (owner only), plus the hero summary chips,
//   - the top-level one-open-at-a-time accordion (also used by the page's Contractors section),
//   - the "Sanitization checklist" pop-up (everyone; editors add / edit / delete checks),
//   - "Assignment Center" (closure-code groups) + the "Assign to sanitize" pop-up (owner only),
//   - "Sanitized tickets" and "Approved errors & agent-marked duplicates" (owner only),
//   - the "Sanitization assignment log" pop-up (owner only).
// Styles: sanitization-checklist.css. Needs icons.js, api-config.js, topbar-auth.js (PHDAuth, PHDLoginUI,
// PHDConfirm, PHDBanner, the shared .tbl-* dialog shell) and the page's #tsCkModal / #tsLogModal /
// #tsAddModal / #tsEditModal / #tsDelModal markup. Everything lives inside one IIFE; the inline-handler
// functions (window.ts*) and window.PHDSanCheck are the only globals.
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
// The checks the SERVER applies to every ticket after each data upload, keyed on the closure code the
// upload carries. Read-only in the card: they come from the code, not from the database.
// KEEP IN SYNC with server/sanitization-validate.js RULES (a browser file cannot require it).
var TS_RULES=[
  {key:'r-immediate',label:'Closure code "Immediately Resolved"',icon:'check-circle',lines:[
    'SIM Title: a known country code at the start.',
    'SIM Title: a valid issue type \u2014 unless the Sim Root Cause Details Issue field holds a valid one, which then stands in for it.',
    'SIM Title: a severity (Sev 1-5).',
    'Sim Root Cause Details is not checked for this closure code.']},
  {key:'r-successful',label:'Closure code "Successful"',icon:'clipboard',lines:[
    'SIM Title: a known country code at the start.',
    'SIM Title: a valid issue type \u2014 unless the Sim Root Cause Details Issue field holds a valid one, which then stands in for it.',
    'SIM Title: a severity (Sev 1-5).',
    'Sim Root Cause Details: Issue, Date and Res must have a real value (N/A does not count).',
    'Sim Root Cause Details: SID, TID, Driv, Zip, CID and UPID may have a value or N/A.',
    'Sim Root Cause Details: Cnt must be a number or N/A (N/A counts as 0).']},
  {key:'r-duplicate',label:'Closure code "Duplicate"',icon:'ticket',lines:[
    'Nothing is checked.']},
  {key:'r-other',label:'Any other closure code',icon:'info',lines:[
    'The closure code itself is the error: a sanitized ticket may only end as Successful, Immediately Resolved or Duplicate.',
    'It is listed under Error detected, naming the code the upload carried (Automatically Closed, No Issue, a blank code, ...).',
    'Nothing else on the ticket is checked until it is closed with an allowed code.']},
  {key:'r-skipped',label:'Tickets left out of validation',icon:'flag',lines:[
    'A ticket is checked only after the contractor marks it: an unmarked ticket stays in Tickets to sanitize.',
    'A ticket marked Error in the app waits for harisss to approve it and is not validated.',
    'A ticket approved as an error is never validated again.',
    'A ticket harisss accepts as a sanitized error is never validated again; Rework sends it back instead.']}
];
// The sections still rendered from the sanitization_checklist collection (and editable). The rows that
// described the old 11-point SIM Title / Root Cause Details / ClosureCode checks are no longer shown -
// TS_RULES replaces them - but they are left in the collection untouched.
var TS_DB_KEYS=['tags','other'];
var TS_ADD_SEC='Hashtags';  // last section picked in the editor's add row (kept across re-renders)
function tsSectionKey(text){
  var m=TS_PREFIX_RE.exec(String(text==null?'':text)); if(!m) return 'other';
  var p=m[1].toLowerCase().replace(/\s+/g,' ');
  if(p==='sim title'||p==='title') return 'title';
  if(p==='root cause details'||p==='rootcause details'||p==='rcd') return 'rcd';
  if(p==='closurecode'||p==='closure code') return 'closure';
  return 'tags';
}
function tsStripPrefix(text){ return String(text==null?'':text).replace(TS_PREFIX_RE,'').trim(); }
// items -> [{key,label,icon,lines:[{idx,text}]}] for the DB-driven sections only (TS_DB_KEYS: Hashtags,
// then 'Other' when a row carries no known prefix); fixed section order, DB order within a section.
// `idx` stays the row's index in TS_ITEMS, so tsEdit / tsDelete keep working on the dropped rows' siblings.
function tsGroup(items){
  var by={title:[],rcd:[],tags:[],closure:[],other:[]};
  (items||[]).forEach(function(it,idx){ by[tsSectionKey(it.text)].push({idx:idx,text:tsStripPrefix(it.text)}); });
  var out=TS_SECTIONS.filter(function(s){ return TS_DB_KEYS.indexOf(s.key)>=0; })
    .map(function(s){ return {key:s.key,label:s.label,icon:s.icon,lines:by[s.key]}; });
  if(by.other.length) out.push({key:TS_OTHER.key,label:TS_OTHER.label,icon:TS_OTHER.icon,lines:by.other});
  return out;
}
// Lines the card actually shows: the code-defined rules + the DB rows of the sections left.
function tsRuleLines(){ var n=0; TS_RULES.forEach(function(r){ n+=r.lines.length; }); return n; }
function tsDbLines(){ var n=0; tsGroup(TS_ITEMS).forEach(function(s){ n+=s.lines.length; }); return n; }
function tsCount(){ return tsRuleLines()+tsDbLines(); }
// ---- end section grouping helpers ----

// Sub-section open state: in memory only, kept across re-renders. On every page load the checklist
// card is open and ALL its sub-sections (the read-only rule groups of TS_RULES, then the Hashtags
// rows from the database) are collapsed.
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
// TS_TOP = id of the one open card (null = all collapsed, which is the state on every page load now that
// the checklist is a pop-up). In memory only.
// Toggling only flips attributes, so inner accordions / pages keep their state; re-renders read TS_TOP.
var TS_TOP=null;
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
  'STEP 3 \u2014 RESOLUTION (IN SCOPE only). This is for SANITIZING an already resolved ticket, so you MIRROR the resolution the human PHD agent already gave. The human PHD agent\u2019s resolution ALWAYS wins over your own opinion. Never suggest, change or "improve" it.',
  '  - Find the resolution the PHD agent recorded in the pasted information (e.g. a "Res:" line, "PHD Resolution:", "Resolution:", or the resolution stated in the PHD comments / notes).',
  '  - If it matches one of the 12 values in list C (ignore case, spacing and hyphens, e.g. "driver follow up" = Driver Follow-up), use that value exactly as written in list C.',
  '  - Example: the CX pointed a weapon at the driver, the CX did not respond, and the PHD agent resolved it as Driver Follow-up \u2014 Res is Driver Follow-up, even if you think Address Exclusion would be better.',
  '  - Example: the CX gave reassurance and the PHD agent resolved it as Customer Reassurance \u2014 Res is Customer Reassurance, even if you think Address Deprio or Address Exclusion would be better.',
  '  - If NO resolution is given in the pasted information, OR the given resolution is NOT one of the 12 in list C, do NOT output any block. Reply with ONLY this question (fill in the value found, or "none"):',
  '    The resolution provided in this ticket ("<value found>") is not in the PHD resolution list. Please select one of these 12 so I can give the SIM Title, Root Cause, SIM Root Cause Details, Primary Case Tag and PHD Findings: ' + TS_RESOLUTIONS.join(', ') + '.',
  '  - When I reply with one of the 12, use it as Res and output the IN SCOPE block.',
  '',
  'STEP 4 \u2014 OUTPUT. Reply with EXACTLY ONE of the two blocks below (or the STEP 3 question).',
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
  'Res: <the PHD agent\u2019s resolution from STEP 3, exactly as in list C>',
  '',
  'SIM Title: <see SIM Title rules>',
  '',
  'Primary Case Tag:',
  '- <the ONE #hashtag the PHD agent used in the pasted information if present (keep it exactly); otherwise the one #hashtag that best fits the case; or: No Hashtag Applicable>',
  '=== end of IN SCOPE block ===',
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
  '',
  'Primary Case Tag:',
  '- #out-of-scope',
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
// Hero summary chips ('Checklist unavailable' after a failed load, 'View only' for non-editors); the page
// puts them in its hero (#tsHeroChips). The check count and the Editor tag live in the checklist pop-up's head.
function chipsHtml(editor){
  return LOADING
    ? '<li class="is-skel" aria-hidden="true"><span class="ts-skel ts-skel-d" style="width:120px;height:10px"></span></li><li class="is-skel" aria-hidden="true"><span class="ts-skel ts-skel-d" style="width:70px;height:10px"></span></li>'
    : (LOAD_ERR?'<li><span>Checklist unavailable</span></li>':'')+
      (editor?'':'<li>View only</li>');
}
function paintChips(){ var el=document.getElementById('tsHeroChips'); if(el) el.innerHTML=chipsHtml(tsCanEdit()); }
// Hero "Copy prompt" button (orange; sits in the page's hero action grid, see sanitization-tools.js heroActsHtml).
function promptBtnHtml(){
  return '<button type="button" class="ts-hero-link ts-hero-prompt" onclick="tsCopyPrompt(this)" title="Copy the AI prompt for writing PHD Findings, Primary Case Tag, SIM Root Cause Details and SIM Title">'+
    '<span class="ts-hl-sheet" aria-hidden="true">'+ICO_COPY+'</span>'+
    '<span class="ts-hl-txt"><span class="ts-hl-t">Copy prompt</span></span></button>';
}
// The other two hero buttons: each opens its pop-up (the page's #tsCkModal / #tsLogModal).
// The assignment log is owner only, so its button is left out for everyone else.
function checklistBtnHtml(){
  return '<button type="button" class="ts-hero-link" id="tsCkBtn" onclick="tsCkOpen()" aria-haspopup="dialog" title="What the server checks on every ticket after a data upload">'+
    '<span class="ts-hl-sheet" aria-hidden="true">'+ICO_LIST+'</span>'+
    '<span class="ts-hl-txt"><span class="ts-hl-t">Sanitization checklist</span></span></button>';
}
function logBtnHtml(){
  if(!tsIsOwner()) return '';
  return '<button type="button" class="ts-hero-link" id="tsLogBtn" onclick="tsLogOpen()" aria-haspopup="dialog" title="Who was assigned how many tickets, by day">'+
    '<span class="ts-hl-sheet" aria-hidden="true">'+ic('clock-rewind',18)+'</span>'+
    '<span class="ts-hl-txt"><span class="ts-hl-t">Sanitization assignment log</span></span></button>';
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

// One collapsible sub-section shell (header toggle + body); inner = the section's markup.
function tsSecShell(key,label,icon,n,inner){
  var hid='tsSec-'+key, lid='tsSecList-'+key, open=!!TS_OPEN[key];
  return '<section class="ts-sec'+(open?' is-open':'')+'" aria-labelledby="'+hid+'">'+
    '<h3 class="ts-sec-h" id="'+hid+'"><button type="button" class="ts-sec-tog" id="tsSecBtn-'+key+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+lid+'" onclick="tsToggleSec(\''+key+'\')">'+
      '<span class="ts-sec-chev" aria-hidden="true">'+ICO_CHEV+'</span>'+
      '<span class="ts-sec-ic" aria-hidden="true">'+ic(icon,15)+'</span><span class="ts-sec-lbl">'+esc(label)+'</span>'+
      '<span class="ts-count"><span class="ts-sr">(</span>'+n+'<span class="ts-sr"> '+(n===1?'line':'lines')+')</span></span></button></h3>'+
    '<div class="ts-sec-body" id="'+lid+'"'+(open?'':' hidden')+'>'+inner+'</div></section>';
}
// The validation rules, read-only (no add / edit / delete): one collapsed section per closure code.
function rulesHtml(){
  return '<p class="ts-rules-n">'+ICO_INFO+'<span>Every ticket is checked by the server after each data upload, on the closure code the upload carries. '+
    'These rules come from the code, so they cannot be edited here. Anything missing goes to <b>Error detected</b> in the Sanitization Center, '+
    'where harisss approves single items or sends the ticket back for rework.</span></p>'+
    TS_RULES.map(function(r){
      return tsSecShell(r.key,r.label,r.icon,r.lines.length,
        '<ul class="ts-rules">'+r.lines.map(function(l){ return '<li>'+esc(l)+'</li>'; }).join('')+'</ul>');
    }).join('');
}
function stepsHtml(editor,anim){
  if(LOADING) return skeletonSections();
  if(LOAD_ERR) return '<div class="ts-state" role="alert"><span class="ts-state-ic" aria-hidden="true">'+ic('alert-triangle',20)+'</span><div class="ts-state-txt">'+
      '<p class="ts-state-t">Couldn\u2019t load the checklist</p><p class="ts-state-p">'+esc(LOAD_ERR)+'</p></div>'+
      '<button type="button" class="ts-btn" id="tsRetry" onclick="tsRetry()">'+ICO_RETRY+'<span>Retry</span></button></div>';
  var seq=0;
  return '<div class="ts-secs">'+rulesHtml()+tsGroup(TS_ITEMS).map(function(sec){
    var n=sec.lines.length, lab=sec.label;
    return tsSecShell(sec.key,lab,sec.icon,n,
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
      }).join('')+'</ol>':'<div class="ts-empty">'+ICO_INFO+'No lines in this section yet.</div>'));
  }).join('')+'</div>';
}

// Re-paint the checklist pop-up's body and head in place (the page's sections are left alone) + the hero chips.
// The pop-up's markup is the page's #tsCkModal, so it is painted whether or not the pop-up is open.
function render(){
  var anim=FIRST&&!LOADING&&!LOAD_ERR; if(anim) FIRST=false;
  var editor=tsCanEdit(), ready=!LOADING&&!LOAD_ERR;
  var el=document.getElementById('tsCkBody');
  if(el){ tsKeepFocus(function(){ el.innerHTML=stepsHtml(editor,anim); }); el.setAttribute('aria-busy',LOADING?'true':'false'); }
  var cnt=document.getElementById('tsCkCount');
  if(cnt){ var n=tsCount(); cnt.textContent=n.toLocaleString()+' '+(n===1?'check':'checks'); cnt.hidden=!ready; }
  var mode=document.getElementById('tsCkMode'); if(mode) mode.hidden=!(ready&&editor);
  var add=document.getElementById('tsAddBtn'); if(add) add.hidden=!(ready&&editor);
  paintChips();
}
// ---- "Sanitization checklist" pop-up (hero button -> the page's #tsCkModal, the shared .tbl-* shell) ----
// Its [data-ic] icon slots are filled once at load, with the add pop-up's (see the loop at the end of this file).
function tsCkOpen(){
  var bg=document.getElementById('tsCkModal'); if(!bg) return;
  render();
  bg.style.display='flex';
  if(window.PHDLoginUI) window.PHDLoginUI.opened(bg,tsCkClose,null);
}
window.tsCkOpen=tsCkOpen;
function tsCkClose(){
  var bg=document.getElementById('tsCkModal'); if(!bg||bg.style.display==='none') return;
  bg.style.display='none';
  if(window.PHDLoginUI) window.PHDLoginUI.closed(bg); else { var b=document.getElementById('tsCkBtn'); if(b) b.focus(); }
}
window.tsCkClose=tsCkClose;

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
    announce('Loaded '+tsCount()+' checklist '+(tsCount()===1?'step':'steps')+'.');
    // Retry lives inside the checklist pop-up and is gone once the load succeeds: keep focus in there.
    if(fromRetry){ var ab=document.getElementById('tsAddBtn'), h=(ab&&!ab.hidden)?ab:document.querySelector('#tsCkModal .tbl-x'); if(h) h.focus(); }
  }
}
function tsRetry(){ loadChecklist(true); }
window.tsRetry=tsRetry;

// ---- Add via the "Add new check" pop-up (shared .tbl-* shell; PHDLoginUI gives Esc, the Tab trap and focus return) ----
function tsOpenAdd(){
  if(!tsCanEdit()) return;
  var bg=document.getElementById('tsAddModal'), sel=document.getElementById('tsAddSec'), ta=document.getElementById('tsAddText');
  // Only the sections the card still renders from the database (TS_DB_KEYS): the SIM Title, Root Cause
  // Details and ClosureCode checks are code-defined now (TS_RULES), so a new row there would never show.
  sel.innerHTML=TS_SECTIONS.filter(function(s){ return TS_DB_KEYS.indexOf(s.key)>=0; })
    .map(function(s){ return '<option value="'+esc(s.label)+'"'+(s.label===TS_ADD_SEC?' selected':'')+'>'+esc(s.label)+'</option>'; }).join('');
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
  var m=document.getElementById('tsEditModal'); m.classList.add('show');
  // Registered with the shared shell helper as well, so Esc and the Tab trap find THIS modal and not
  // the checklist pop-up underneath it (topbar-auth.js handles Escape in the capture phase).
  if(window.PHDLoginUI) window.PHDLoginUI.opened(m,tsCloseEdit,null);
  setTimeout(function(){ ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length); },40);
}
window.tsEdit=tsEdit;
function tsCloseEdit(){ var m=document.getElementById('tsEditModal'); var open=m.classList.contains('show'); m.classList.remove('show'); TS_EDIT_ID=null;
  if(open&&window.PHDLoginUI) window.PHDLoginUI.closed(m);
  if(open) tsRestoreFocus(); }
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
  var m=document.getElementById('tsDelModal'); m.classList.add('show');
  if(window.PHDLoginUI) window.PHDLoginUI.opened(m,tsCloseDel,null);   // see tsEdit: Esc / Tab must find this modal
  setTimeout(function(){ var b=document.getElementById('tsDelConfirm'); if(b) b.focus(); },40);
}
window.tsDelete=tsDelete;
function tsCloseDel(){ var m=document.getElementById('tsDelModal'); var open=m.classList.contains('show'); m.classList.remove('show'); TS_DEL_ID=null;
  if(open&&window.PHDLoginUI) window.PHDLoginUI.closed(m);
  if(open) tsRestoreFocus(); }
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

// ---- Assignment Center (owner-only; the server enforces it too: GET /api/sanitization-score) ----
// Three owner-only top-level cards share one payload (SC.data) and one open sub-group (SC.open):
//   Assignment Center (#tsScore) - the tickets that still need sanitizing (rule A not passed), one
//     collapsible group per SIM closure code (server: groups, sanitization-assign.js closureGroups),
//     each row showing only the chevron, the closure-code label, '(N tickets)', 'N available' and
//     'Assign to sanitize'. No points, no summary line, no chart and no missing-field chips.
//   Sanitized tickets (#tsSanitized) - the tickets that already pass rule A (the server's clr flag),
//     counted per closure code in one chip row, then the created-quarter sub-sections directly.
//   Approved errors & agent-marked duplicates (#tsMarked, last) - two tables; Restore per approved error.
// Appeal / test / Duplicate / AUTO-SIM tickets and Cnt > 0 are ignored (the server leaves them out).
// Inside a group: created-quarter sub-sections (Pacific, oldest first, collapsed); tickets paged by 100 in two 50-row columns.
var TS_OWNER='harisss';
function tsIsOwner(){ var u=A&&A.getUser&&A.getUser(); return !!(u && String(u.username||'').trim().toLowerCase()===TS_OWNER); }
// open = open sub-group ('g<index into SC.data.groups>', 'ae' approved errors, 'du' duplicates; never
// 'clear' - Sanitized tickets shows its quarters directly, with no group row to open);
// openQ = open quarter sub-section ('2026-Q1'); page = {'key|quarter': page no.};
// rs = {shortId:true} while its Restore request runs.
var SC={loading:true, err:'', data:null, quarter:'', open:null, openQ:null, page:{}, rs:{}};
var SC_PAGE=100;
var ICO_SCORE='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/></svg>';
// Top score: the server's maxScore (MAX_SCORE in sanitization-score.js), 11 until the payload is here.
var SC_MAX_DEFAULT=11;
function scMax(){ var m=SC.data&&Number(SC.data.maxScore); return m>0?m:SC_MAX_DEFAULT; }
// One neutral hue for every closure-code group (colour does not imply a score).
var SC_GROUP_HUE=210;
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
// Sub-group keys: 'g<i>' = closure-code group i of SC.data.groups (tickets NOT passing rule A; the
// index, never the code, goes into inline handlers), 'clear' (the sanitized tickets: the server's clr
// flag = rule A pass), 'ae' / 'du' (approved errors / agent-marked duplicates, the last card).
var SC_CLEAR_CODES=['Successful','Immediately Resolved','Automatically Closed'];
function scArg(k){ return typeof k==='number'?String(k):'\''+k+'\''; }
// Closure-code group id of a SIM code. KEEP IN SYNC with server/sanitization-score.js closureGroupOf.
function scGroupId(cc){ var s=String(cc==null?'':cc).trim().replace(/\s+/g,' '); return s?s.toLowerCase():'(blank)'; }
function scGroupOf(d,k){ var m=/^g(\d+)$/.exec(String(k)), g=d&&d.groups; return m&&g&&g[Number(m[1])]?g[Number(m[1])]:null; }
function scGroup(k){ return scGroupOf(SC.data,k); }
// Key of the group with this id in the current payload, or null.
function scGroupKey(id){ var g=(SC.data&&SC.data.groups)||[]; for(var i=0;i<g.length;i++) if(g[i].id===id) return 'g'+i; return null; }
function scName(k){
  if(k==='clear') return 'Sanitized tickets';
  if(k==='ae') return 'Approved errors';
  if(k==='du') return 'Agent-marked duplicates';
  var g=scGroup(k); return g?g.label:String(k);
}
// Created quarter oldest first (none last), then oldest resolved (ro), then ticket id: the server's pick order.
function scRo(t){ return typeof t.ro==='number'?t.ro:Infinity; }
function scByAge(a,b){
  var qa=scQKey(a), qb=scQKey(b);
  return (qa===qb?0:(qa==='none'?1:(qb==='none'?-1:qa.localeCompare(qb))))||(scRo(a)-scRo(b))||String(a.shortId||'').localeCompare(String(b.shortId||''));
}
// Ticket lists per sub-group key, built once per payload (d._lists).
function scLists(d){
  if(d._lists) return d._lists;
  var L={clear:[]}, ix={};
  (d.groups||[]).forEach(function(g,i){ ix[g.id]=i; L['g'+i]=[]; });
  (d.tickets||[]).forEach(function(t){
    if(t.clr){ L.clear.push(t); return; }
    var i=ix[scGroupId(t.cc)]; if(i!=null) L['g'+i].push(t);
  });
  Object.keys(L).forEach(function(k){ L[k].sort(scByAge); });
  return (d._lists=L);
}
function scList(k){ return SC.data?(scLists(SC.data)[k]||[]):[]; }
function scClearTotal(d){ return (d.clear&&Number(d.clear.total))||0; }
function scToSanitize(d){ return (d.groups||[]).reduce(function(s,g){ return s+(Number(g.n)||0); },0); }
// Created quarter id from the server ('2026-Q1'); anything else (no CreateDate) -> 'none'.
function scQKey(t){ var q=t&&t.cq; return /^\d{4}-Q[1-4]$/.test(q||'')?q:'none'; }
function scQLabel(k){ return k==='none'?'No create date':k.slice(5)+' '+k.slice(0,4); }
// One ticket's failed checks with their parsed values (row tooltip + sr-only text).
function scMissText(t,crit){
  var m=[];
  (t.checks||[]).forEach(function(c,i){ if(c[0]) return; var cr=crit[i]||{chip:'Check '+(i+1)}; m.push(cr.chip+(c[1]?' (value: '+c[1]+')':'')); });
  return m.length?'Missing: '+m.join(', '):'All checks pass';
}
function scColHtml(rows,from,score,qk,crit){
  return '<div class="ts-sc-half"><table class="ts-sc-tbl cmp"><caption class="ts-sr">'+esc(scQLabel(qk))+', '+esc(scName(score))+': tickets '+from+' to '+(from+rows.length-1)+'</caption>'+
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
      '<button type="button" class="ts-mbtn sec" id="tsScQP-'+id+'" aria-describedby="tsScQS-'+id+'" onclick="tsScorePage('+scArg(score)+',\''+qk+'\',-1)"'+(p<=1?' disabled':'')+'>Previous</button>'+
      '<button type="button" class="ts-mbtn sec" id="tsScQN-'+id+'" aria-describedby="tsScQS-'+id+'" onclick="tsScorePage('+scArg(score)+',\''+qk+'\',1)"'+(p>=pages?' disabled':'')+'>Next</button></div>':'')+
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
      '<h4 class="ts-sc-qh" id="tsScQH-'+id+'"><button type="button" class="ts-sc-qtog" id="tsScQB-'+id+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="tsScQL-'+id+'" onclick="tsScoreQtr('+scArg(score)+',\''+k+'\')">'+
        '<span class="ts-sec-chev" aria-hidden="true">'+ICO_CHEV+'</span><span class="ts-sec-lbl">'+esc(scQLabel(k))+'</span>'+
        '<span class="ts-count"><span class="ts-sr">(</span>'+n.toLocaleString()+'<span class="ts-sr"> '+(n===1?'ticket':'tickets')+')</span></span></button></h4>'+
      '<div class="ts-sc-qb" id="tsScQL-'+id+'"'+(open?'':' hidden')+'>'+(open?scQBodyHtml(by[k],score,k,crit):'')+'</div></section>';
  }).join('')+'</div>';
}
// Collapsible group shell ('g<i>', 'ae', 'du'): k = group key, badge (optional) / label / n = header,
// extra = header-row HTML.
function scSecHtml(k,o){
  var open=SC.open===k, n=Number(o.n)||0;
  return '<section class="ts-sec ts-sc-sec'+(open?' is-open':'')+'" style="--sc-h:'+o.hue+'" id="tsScSec-'+k+'" aria-labelledby="tsScH-'+k+'">'+
    '<div class="ts-sc-hrow"><h3 class="ts-sec-h" id="tsScH-'+k+'"><button type="button" class="ts-sec-tog" id="tsScB-'+k+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="tsScL-'+k+'" onclick="tsScoreToggle('+scArg(k)+')">'+
      '<span class="ts-sec-chev" aria-hidden="true">'+ICO_CHEV+'</span>'+
      (o.badge?'<span class="ts-sc-badge">'+esc(o.badge)+'</span>':'')+'<span class="ts-sec-lbl">'+esc(o.label)+'</span>'+
      '<span class="ts-count"><span class="ts-sr">(</span>'+n.toLocaleString()+'<span class="ts-sr"> '+(n===1?'ticket':'tickets')+')</span></span>'+
      '</button></h3>'+(o.extra||'')+'</div>'+
    '<div class="ts-sec-body" id="tsScL-'+k+'"'+(open?'':' hidden')+'>'+(open?o.body():'')+'</div></section>';
}
function scEmpty(){ return '<div class="ts-empty" style="margin:14px">'+ICO_INFO+'No tickets</div>'; }
// Count chips: [[label, n], ...] (zero counts left out unless keepZero). cls = the list class
// ('ts-sc-miss' inside a .ts-sc-hrow, 'ts-sc-chiprow' for a standalone row in a card body).
function scCountChips(aria,rows,keepZero,cls){
  var li=rows.filter(function(r){ return keepZero||r[1]; }).map(function(r){
    return '<li class="ts-chip ts-chip-grp'+(r[2]?' ok':'')+'">'+esc(r[0])+' <b>'+Number(r[1]).toLocaleString()+'</b><span class="ts-sr"> tickets</span></li>';
  });
  return li.length?'<ul class="'+(cls||'ts-sc-miss')+'" aria-label="'+esc(aria)+'">'+li.join('')+'</ul>':'';
}
// Assignment Center card body: one group per closure code (tickets still to sanitize). The header row
// carries nothing but the chevron, the closure-code label, the count and 'N available' + Assign.
function scGroupsHtml(d){
  var crit=d.criteria||[], gs=d.groups||[];
  if(!gs.length) return scEmpty();
  return '<div class="ts-secs">'+gs.map(function(g,i){
    var k='g'+i;
    return scSecHtml(k,{n:g.n,hue:SC_GROUP_HUE,label:g.label,extra:saHeadActs(d,k),
      body:function(){ var l=scList(k); return l.length?scQuartersHtml(l,k,crit):scEmpty(); }});
  }).join('')+'</div>';
}
// Sanitized tickets card body: the tickets that already pass rule A (Successful 11 checks; eligible
// Immediately Resolved / Automatically Closed: 3 title checks), counted per closure code in one chip
// row, then the created-quarter sub-sections directly (no group row in between).
function scClearHtml(d){
  var crit=d.criteria||[], bc=(d.clear&&d.clear.byCode)||{}, codes=SC_CLEAR_CODES.slice();
  Object.keys(bc).forEach(function(c){ if(codes.indexOf(c)<0) codes.push(c); });
  return scCountChips('Sanitized tickets by closure code',codes.map(function(c){ return [c,bc[c]||0,true]; }).filter(function(r,ix){ return ix<2||r[1]; }),true,'ts-sc-chiprow')+
    (scList('clear').length?scQuartersHtml(scList('clear'),'clear',crit):scEmpty());
}
function scLinkHtml(r){
  var id=r.shortId||'\u2014';
  return r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(id)+'<span class="ts-sr"> (opens in a new tab)</span></a>':esc(id);
}
function scScopeTxt(r){
  if(r.scope==='scored'||!r.scope) return '';
  return r.scope==='not-found'?'Not in the current data':'Left out of scoring: '+r.scope;
}
// Approved errors: the contractor's error message (the Error mark's reason the owner read before approving).
function scAeTableHtml(ae){
  return '<div class="ts-sc-tw"><table class="ts-sc-tbl"><caption class="ts-sr">Approved error tickets with the contractor\u2019s error message</caption>'+
    '<thead><tr><th scope="col" class="id">Ticket ID</th><th scope="col">Title</th><th scope="col">Error message</th><th scope="col">Contractor</th><th scope="col">Approved</th><th scope="col">Action</th></tr></thead><tbody>'+
    ae.map(function(r){
      var sid=String(r.shortId||''), busy=!!SC.rs[sid];
      return '<tr><td class="id">'+scLinkHtml(r)+'</td><td class="tt">'+esc(r.title||'\u2014')+'</td>'+
        '<td class="tt">'+(r.reason?esc(r.reason):'\u2014')+(r.note?'<br><small>Owner note: '+esc(r.note)+'</small>':'')+'</td>'+
        '<td>'+esc(r.login||'\u2014')+'</td><td>'+esc((r.approvedBy||'\u2014')+(r.approvedAt?' \u00b7 '+scWhen(r.approvedAt):''))+'</td>'+
        '<td>'+(sid?'<button type="button" class="ts-abtn" data-tsrestore="'+esc(sid)+'" id="tsRs-'+esc(sid)+'"'+(busy?' disabled aria-busy="true"':'')+'>'+
          (busy?'Restoring\u2026':'Restore')+'<span class="ts-sr"> '+esc(sid)+'</span></button>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
// Agent-marked duplicates: no error message (the same column, said explicitly).
function scDuTableHtml(du){
  return '<div class="ts-sc-tw"><table class="ts-sc-tbl"><caption class="ts-sr">Tickets marked Duplicate by agents</caption>'+
    '<thead><tr><th scope="col" class="id">Ticket ID</th><th scope="col">Title</th><th scope="col">Error message</th><th scope="col">Agent</th><th scope="col">Marked on</th><th scope="col">SIM closure code now</th></tr></thead><tbody>'+
    du.map(function(r){
      var s=(r.cc||'\u2014')+(r.pending?' (no upload since the mark)':''), sc=scScopeTxt(r);
      return '<tr><td class="id">'+scLinkHtml(r)+'</td><td class="tt">'+esc(r.title||'\u2014')+'</td>'+
        '<td><span class="tsa-mut">\u2014 (marked Duplicate, no message)</span></td><td>'+esc(r.login||'\u2014')+'</td><td>'+esc(scWhen(r.markedAt)||'\u2014')+'</td>'+
        '<td>'+esc(s)+(sc?'<br><small>'+esc(sc)+'</small>':'')+'</td></tr>';
    }).join('')+'</tbody></table></div>';
}
function scMarkedOf(d){ return (d&&d.marked)||{approvedErrors:[],duplicates:[],agents:[],simDuplicates:0}; }
// Last card body: one count tile per agent, the SIM-duplicates note, then the two separately headed
// tables. The tiles replace a row of bracketed red .ts-chip pills ('[login: errors N | duplicates
// N]'): those reused the missing-criteria alert pill, so six agents read as six errors, their widths
// never lined up, and the row sat 14px inside the two section rows under it.
function scMarkedHtml(d){
  var mk=scMarkedOf(d), ae=mk.approvedErrors||[], du=mk.duplicates||[], simDup=Number(mk.simDuplicates)||0;
  var chips=(mk.agents||[]).length?'<ul class="ts-sc-agents" aria-label="Approved errors and agent-marked duplicates by agent">'+mk.agents.map(function(a){
      return '<li class="ts-sc-ag"><span class="ts-sc-ag-l">'+esc(a.login)+'</span>'+
        '<span class="ts-sc-ag-n is-err">errors <b>'+Number(a.errors).toLocaleString()+'</b></span>'+
        '<span class="ts-sc-ag-n is-dup">duplicates <b>'+Number(a.duplicates).toLocaleString()+'</b></span></li>';
    }).join('')+'</ul>':'';
  var note='<p class="ts-sc-tot">'+simDup.toLocaleString()+' '+(simDup===1?'ticket is':'tickets are')+' closed as Duplicate in SIM and left out of scoring; only the tickets an agent marked Duplicate are listed here.</p>';
  return chips+note+'<div class="ts-secs">'+
    scSecHtml('ae',{n:ae.length,hue:0,badge:'Error',label:scName('ae'),body:function(){ return ae.length?scAeTableHtml(ae):scEmpty(); }})+
    scSecHtml('du',{n:du.length,hue:SC_GROUP_HUE,badge:'Dup',label:scName('du'),body:function(){ return du.length?scDuTableHtml(du):scEmpty(); }})+'</div>';
}
// Loading skeleton / load error with Retry (each card gets its own Retry id), or '' once loaded.
function scStateHtml(retryId){
  if(SC.loading) return scSkel();
  if(SC.err) return '<div class="ts-state" role="alert"><span class="ts-state-ic" aria-hidden="true">'+ic('alert-triangle',20)+'</span><div class="ts-state-txt">'+
    '<p class="ts-state-t">Couldn\u2019t load the sanitization data</p><p class="ts-state-p">'+esc(SC.err)+'</p></div>'+
    '<button type="button" class="ts-btn" id="'+retryId+'" onclick="tsScoreRetry()">'+ICO_RETRY+'<span>Retry</span></button></div>';
  return '';
}
function scBodyHtml(){
  var st=scStateHtml('tsScoreRetry'); if(st) return st;
  var d=SC.data; if(!d) return '';
  return scGroupsHtml(d);
}
function scReady(){ return !SC.loading&&!SC.err&&SC.data; }
function scoreHtml(){
  if(!tsIsOwner()) return '';
  var tot=scReady()?scToSanitize(SC.data):null;
  return '<section class="'+tsTopCls('tsScore')+'" id="tsScore" aria-labelledby="tsScoreHead" aria-busy="'+(SC.loading?'true':'false')+'">'+
    tsTopHead('tsScore',{icon:ICO_SCORE,title:'Assignment Center',
      sum:tot!=null?tsTopSum(tot.toLocaleString()+' to sanitize'):'',
      tags:'<span class="ts-own">Only visible to you</span>',
      sub:'Tickets that still need sanitizing, grouped by their SIM closure code. Assign a group\u2019s oldest tickets to a contractor. Tickets that already meet their closure code\u2019s checks are under Sanitized tickets.',
      acts:scQuarterSelect()})+
    tsTopBody('tsScore')+scBodyHtml()+'</div></section>';
}
function sanitizedHtml(){
  if(!tsIsOwner()) return '';
  var d=scReady()?SC.data:null;
  return '<section class="'+tsTopCls('tsSanitized')+'" id="tsSanitized" aria-labelledby="tsSanitizedHead" aria-busy="'+(SC.loading?'true':'false')+'">'+
    tsTopHead('tsSanitized',{icon:ic('check-circle',17)||ICO_SCORE,title:'Sanitized tickets',
      sum:d?tsTopSum(scClearTotal(d).toLocaleString()+' sanitized'):'',
      tags:'<span class="ts-own">Only visible to you</span>',
      sub:'Tickets that already meet their closure code\u2019s checks (Successful: all '+scMax()+'; Immediately Resolved or Automatically Closed with an eligible title: the 3 title checks). Nothing to assign.'})+
    tsTopBody('tsSanitized')+(scStateHtml('tsScoreRetry2')||(d?scClearHtml(d):''))+'</div></section>';
}
function markedHtml(){
  if(!tsIsOwner()) return '';
  var d=scReady()?SC.data:null, mk=scMarkedOf(d), ne=(mk.approvedErrors||[]).length, nd=(mk.duplicates||[]).length;
  return '<section class="'+tsTopCls('tsMarked')+'" id="tsMarked" aria-labelledby="tsMarkedHead" aria-busy="'+(SC.loading?'true':'false')+'">'+
    tsTopHead('tsMarked',{icon:ic('flag',17)||ICO_SCORE,title:'Approved errors &amp; agent-marked duplicates',
      sum:d?tsTopSum(saPlural(ne,'approved error')+' \u00b7 '+saPlural(nd,'duplicate')):'',
      tags:'<span class="ts-own">Only visible to you</span>',
      sub:'Tickets you approved as errors, with the error message the contractor wrote, and tickets an agent marked Duplicate. Restore puts an approved error back into sanitization tracking.'})+
    tsTopBody('tsMarked')+(scStateHtml('tsScoreRetry3')||(d?scMarkedHtml(d):''))+'</div></section>';
}
// The three cards re-render in place together (same payload, one open sub-group).
var SC_CARDS=[['tsScore',scoreHtml],['tsSanitized',sanitizedHtml],['tsMarked',markedHtml]];
function scRender(focusId){
  tsKeepFocus(function(){ SC_CARDS.forEach(function(c){ var el=document.getElementById(c[0]); if(el) el.outerHTML=c[1](); }); });
  if(focusId){ var f=document.getElementById(focusId); if(f) f.focus(); }
}
// keep = refresh in place (after an assign / revoke): the open section, quarter and page stay.
async function loadScores(quarter,fromRetry,keep){
  if(!tsIsOwner()) return;
  SC.loading=true; SC.err=''; if(quarter!=null) SC.quarter=quarter; scRender();
  var r=null;
  try{ r=await A.api('GET','/api/sanitization-score?quarter=since2026'); }catch(e){ r=null; }
  SC.loading=false;
  if(r&&r.ok&&r.data&&r.data.buckets&&Array.isArray(r.data.groups)){
    // A kept open closure-code group follows its id (group indexes can move after a refresh).
    var og=keep?scGroup(SC.open):null;
    SC.data=r.data; SC.quarter=r.data.quarter;
    if(!keep){ SC.open=null; SC.openQ=null; SC.page={}; }
    else if(og){ var nk=scGroupKey(og.id); if(nk!==SC.open){ SC.open=nk; SC.openQ=null; SC.page={}; } }
  }
  else SC.err=(r&&r.ok&&r.data&&!r.data.error)?'The server did not send the closure-code groups (it may need a restart).':((r&&r.data&&r.data.error)||(r?'The server answered HTTP '+(r.status||'?')+'.':'Network error.'));
  scRender(SC.err&&fromRetry?'tsScoreRetry':(quarter!=null?'tsScoreQ':null));
  announce(SC.err?'Couldn\u2019t load the sanitization data.':('Assignment Center loaded: '+scToSanitize(SC.data)+' tickets to sanitize, '+scClearTotal(SC.data)+' sanitized, '+SC.data.excluded+' ignored.'));
}
function tsScoreRetry(){ loadScores(null,true); }
function tsScoreQuarter(v){ loadScores(String(v||'')); }
// Opening / closing a sub-group collapses its quarters and forgets their pages.
function tsScoreToggle(i){ SC.open=SC.open===i?null:i; SC.openQ=null; SC.page={}; scRender('tsScB-'+i); }
// Quarter sub-section: one open at a time across the page; collapsing resets its page. 'clear' has no
// group row to open (Sanitized tickets shows its quarters directly), so it is not gated on SC.open.
function tsScoreQtr(i,k){
  if(i!=='clear'&&SC.open!==i) return;
  SC.openQ=SC.openQ===k?null:k; SC.page={};
  scRender('tsScQB-'+i+'-'+k);
}
function tsScorePage(i,k,dir){
  if((i!=='clear'&&SC.open!==i)||SC.openQ!==k||!SC.data) return;
  var n=scList(i).filter(function(t){ return scQKey(t)===k; }).length;
  var pages=Math.max(1,Math.ceil(n/SC_PAGE)), pk=i+'|'+k, p=Math.min(Math.max(1,(SC.page[pk]||1)+dir),pages);
  SC.page[pk]=p;
  var bid=(dir<0?'tsScQP-':'tsScQN-')+i+'-'+k, atEnd=dir<0?p<=1:p>=pages;
  scRender(atEnd?'tsScQB-'+i+'-'+k:bid);   // keep focus on the pressed button; the heading once it disables
  var a=(p-1)*SC_PAGE;
  announce(scQLabel(k)+', '+scName(i)+': page '+p+' of '+pages+', showing '+(a+1)+' to '+Math.min(a+SC_PAGE,n)+' of '+n+'.');
}
// Restore an approved error (last card; POST /api/my-sanitization/restore, owner only). No confirm: the
// Error mark is kept, so the ticket goes back to Error tickets and can be approved again. Success (or a
// 404: the row is stale) reloads the three cards; success also tells the page ('phd-san-restored') so the
// contractor's view refetches.
async function scRestore(sid){
  if(!sid||SC.rs[sid]||!tsIsOwner()) return;
  var row=null; (scMarkedOf(SC.data).approvedErrors||[]).forEach(function(r){ if(r.shortId===sid) row=r; });
  SC.rs[sid]=true; scRender('tsRs-'+sid);
  var r=null; try{ r=await A.api('POST','/api/my-sanitization/restore',{shortId:sid}); }catch(e){ r=null; }
  delete SC.rs[sid];
  var ok=!!(r&&r.ok&&r.data&&r.data.ok), gone=!ok&&r&&r.status===404;
  var msg=ok?sid+' restored: it is tracked again.':((r&&r.data&&r.data.error)||'Could not restore the ticket. Please try again.');
  if(window.PHDBanner) window.PHDBanner[ok?'ok':'error'](msg);
  if(ok||gone){
    await loadScores(null,false,true);
    var f=document.getElementById('tsScB-ae'); if(f) f.focus();
    if(ok){ try{ document.dispatchEvent(new CustomEvent('phd-san-restored',{detail:{shortId:sid,login:row?row.login:''}})); }catch(e){} }
  } else scRender('tsRs-'+sid);
  announce(msg);
}
document.addEventListener('click',function(ev){
  var b=ev.target&&ev.target.closest?ev.target.closest('[data-tsrestore]'):null;
  if(!b||b.disabled) return;
  scRestore(b.getAttribute('data-tsrestore'));
});
window.tsScoreRetry=tsScoreRetry; window.tsScoreQuarter=tsScoreQuarter; window.tsScoreToggle=tsScoreToggle; window.tsScoreQtr=tsScoreQtr; window.tsScorePage=tsScorePage;

// ---- Sanitization assignments (owner-only; the server enforces it: /api/sanitization-assign) ----
// Assign a closure-code group's oldest available tickets to a contractor (the server picks them), then the
// next data uploads verify them (assignment log here; per-contractor results on sanitization-tracker.html).
// SA = { loading, err, data:{contractors, assignments, ...}, x:{id:true} (Show IDs), rv:{id:true} (revoking),
//        day:{dayKey:true} (expanded day groups; all collapsed by default) }
var SA={loading:true, err:'', data:null, x:{}, rv:{}, day:{}};
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

// Closure-code group header ('g<i>'): 'N available' (not locked in an active assignment) + 'Assign to sanitize'.
function saHeadActs(d,k){
  var g=scGroupOf(d,k); if(!g) return '';
  var av=Number(g.available)||0;
  return '<div class="ts-sc-acts"><span class="ts-sc-av'+(av?'':' is-none')+'" id="tsScAv-'+k+'">'+av.toLocaleString()+' available</span>'+
    '<button type="button" class="ts-abtn" id="tsScA-'+k+'" aria-haspopup="dialog" aria-label="'+esc('Assign '+g.label+' tickets to sanitize')+'" aria-describedby="tsScAv-'+k+'" onclick="tsAsgOpen(\''+k+'\')"'+(av?'':' disabled')+'>'+
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
// The assignment log lives in the owner's "Sanitization assignment log" pop-up (the page's #tsLogModal);
// its body is re-painted in place by id. (Contractor performance and Needs rework moved to
// sanitization-tracker.html.)
function saRender(focusSel){
  var el=document.getElementById('tsLogBody'); if(!el) return;
  var d=SA.data, ready=!SA.loading&&!SA.err&&d;
  tsKeepFocus(function(){ el.innerHTML=SA.loading?saSkel():(SA.err?saErrHtml():saLogHtml(d)); });
  el.setAttribute('aria-busy',SA.loading?'true':'false');
  var cnt=document.getElementById('tsLogCount');
  if(cnt){ if(ready) cnt.textContent=saPlural((d.assignments||[]).length,'assignment'); cnt.hidden=!ready; }
  if(focusSel){ var f=document.querySelector(focusSel); if(f) f.focus(); }
}
// ---- "Sanitization assignment log" pop-up (owner only; the hero button is left out for everyone else) ----
function tsLogOpen(){
  if(!tsIsOwner()) return;
  var bg=document.getElementById('tsLogModal'); if(!bg) return;
  saRender();
  bg.style.display='flex';
  if(window.PHDLoginUI) window.PHDLoginUI.opened(bg,tsLogClose,null);
}
window.tsLogOpen=tsLogOpen;
function tsLogClose(){
  var bg=document.getElementById('tsLogModal'); if(!bg||bg.style.display==='none') return;
  bg.style.display='none';
  if(window.PHDLoginUI) window.PHDLoginUI.closed(bg); else { var b=document.getElementById('tsLogBtn'); if(b) b.focus(); }
}
window.tsLogClose=tsLogClose;
function saSkel(){ return '<div aria-hidden="true"><span class="ts-skel" style="width:100%;height:14px;margin-bottom:10px"></span><span class="ts-skel" style="width:70%;height:14px"></span></div>'; }
function saErrHtml(){
  return '<div class="ts-state" role="alert"><span class="ts-state-ic" aria-hidden="true">'+ic('alert-triangle',20)+'</span><div class="ts-state-txt">'+
    '<p class="ts-state-t">Couldn\u2019t load the sanitization assignments</p><p class="ts-state-p">'+esc(SA.err)+'</p></div>'+
    '<button type="button" class="ts-btn" id="tsAsgRetry" onclick="tsAsgRetry()">'+ICO_RETRY+'<span>Retry</span></button></div>';
}
function saStatusHtml(a){
  if(a.status==='revoked') return '<span class="tsa-pill revoked">Revoked by '+esc(a.revokedBy||'\u2014')+' \u00b7 '+esc(saDate(a.revokedAt))+'</span>';
  // Tracker section counts (server: sanitization-assign.js sectionCounts); no deadline.
  var n=function(k){ return Number(a[k]||0).toLocaleString(); }, other=Number(a.other||0);
  return '<span class="tsa-pill '+(a.status==='done'?'verified':'progress')+(a.failed?' has-bad':'')+'">'+n('toSanitize')+' to sanitize \u00b7 '+n('tempCleared')+' temporarily cleared \u00b7 '+
    n('errors')+' '+(Number(a.errors)===1?'error':'errors')+' \u00b7 '+n('sanitized')+' sanitized'+(other?' \u00b7 '+other.toLocaleString()+' not found or ignored':'')+'</span>';
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
      '<b>'+esc(a.assignedBy)+'</b> assigned <b>'+saPlural(a.count,'ticket')+'</b> ('+(a.closureCode?esc(a.closureCode):a.score+' '+(a.score===1?'point':'points'))+') to <b>'+esc(a.assignee)+'</b>'+saStatusHtml(a)+'</span>'+
    '<span class="tsa-acts">'+saExtractBtn('data-sa="copy" data-id="'+esc(id)+'"','for '+sum)+
      '<button type="button" class="ts-abtn" data-sa="x" data-id="'+esc(id)+'" id="tsaX-'+esc(id)+'" aria-expanded="'+x+'" aria-controls="tsaI-'+esc(id)+'">'+(x?'Hide':'Show')+' IDs<span class="ts-sr"> for '+esc(sum)+'</span></button>'+
      (a.status==='active'?'<button type="button" class="ts-abtn is-red" data-sa="rv" data-id="'+esc(id)+'"'+(rv?' disabled aria-busy="true"':'')+'>'+ic('clock-rewind',13)+(rv?'Revoking\u2026':'Revoke')+'<span class="ts-sr"> '+esc(sum)+'</span></button>':'')+
    '</span>'+
    '<span class="tsa-fbh" id="tsaF-'+esc(id)+'"></span>'+
    '<ul class="tsa-ids" id="tsaI-'+esc(id)+'" aria-label="Tickets in this assignment (score at assign \u2192 now)"'+(x?'':' hidden')+'>'+ids+'</ul></li>';
}
function saLogHtml(d){
  var list=(d.assignments||[]).slice().sort(function(a,b){ return String(b.assignedAt||'').localeCompare(String(a.assignedAt||'')); });
  if(!list.length) return '<div class="ts-empty">'+ICO_INFO+'No tickets have been assigned for sanitization yet. Use \u201cAssign to sanitize\u201d on a closure-code group in Assignment Center.</div>';
  var days=[], by={};
  list.forEach(function(a){ var k=saDayKey(a.assignedAt); if(!by[k]){ by[k]=[]; days.push(k); } by[k].push(a); });
  return '<ol class="tsa-days" aria-label="Assignment log by day, newest first">'+days.map(function(k){
    var items=by[k], label=k==='unknown'?'Unknown date':new Date(items[0].assignedAt).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    var tix=0; items.forEach(function(a){ tix+=Number(a.count)||0; });
    // Day header = an expand/collapse button for that day's rows (collapsed unless opened, SA.day).
    var open=!!SA.day[k], did='tsaD-'+k;
    return '<li class="tsa-day'+(open?' is-open':'')+'"><h3 class="tsa-day-h"><button type="button" class="tsa-day-tog" data-sa="day" data-day="'+esc(k)+'" aria-expanded="'+open+'" aria-controls="'+did+'">'+
        '<span class="tsa-day-chev" aria-hidden="true">'+ICO_CHEV+'</span><span>'+esc(label)+' <span class="tsa-mut">\u00b7 '+saPlural(items.length,'assignment')+' \u00b7 '+saPlural(tix,'ticket')+'</span></span></button></h3>'+
      '<ol class="tsa-log" id="'+did+'"'+(open?'':' hidden')+'>'+items.map(saEntryHtml).join('')+'</ol></li>';
  }).join('')+'</ol>';
}
// Log buttons (delegated: the card is re-rendered).
document.addEventListener('click',async function(ev){
  var b=ev.target&&ev.target.closest?ev.target.closest('[data-sa]'):null; if(!b||!tsIsOwner()) return;
  var act=b.getAttribute('data-sa'), id=b.getAttribute('data-id'), a=saFind(id);
  if(act==='day'){
    // Flip in place (no re-render); SA.day keeps it across re-renders.
    var k=b.getAttribute('data-day'), on=!SA.day[k], ol=document.getElementById(b.getAttribute('aria-controls'));
    if(on) SA.day[k]=true; else delete SA.day[k];
    b.setAttribute('aria-expanded',on?'true':'false');
    if(ol) ol.hidden=!on;
    var li=b.closest('.tsa-day'); if(li) li.classList.toggle('is-open',on);
    return;
  }
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
// SAD = { sel:{closureCode,label}, avail, step:1|2|3, count, split:{login:'typed'}, touched, busy, prog, err,
//         done:[{assignee,count,tickets:[{shortId,url}]}], failed:{login,count,status,msg}|null, rest:[{login,count}] }
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
// sel = {closureCode:<group id>} (the page) or a number (legacy score section).
async function saRunSplit(api,sel,queue,onStep){
  var done=[];
  for(var i=0;i<queue.length;i++){
    var q=queue[i]; if(onStep) onStep(q,i,queue.length);
    var body=typeof sel==='number'?{score:sel,count:q.count,assignee:q.login}:{closureCode:sel.closureCode,count:q.count,assignee:q.login};
    var r=null; try{ r=await api('POST','/api/sanitization-assign',body); }catch(e){ r=null; }
    if(r&&r.ok&&r.data&&r.data.ok){
      done.push({login:q.login,assignee:r.data.assignee||q.login,count:r.data.count!=null?Number(r.data.count):q.count,tickets:r.data.tickets||[]});
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
// k = closure-code group key ('g<i>'); SAD.sel = {closureCode:<group id>, label}.
async function tsAsgOpen(k){
  if(!tsIsOwner()||!SC.data) return;
  var g=scGroup(k); if(!g) return;
  var av=Number(g.available)||0;
  if(!av) return;
  tsAsgClose(true);
  SAD={sel:{closureCode:g.id,label:g.label},avail:av,step:1,count:av,split:{},touched:false,busy:false,prog:'',err:'',done:[],failed:null,rest:[]};
  var ov=document.createElement('div'); ov.id='tsAsgDlg'; ov.className='tbl-bg'; ov.style.cssText='display:flex;z-index:5000';
  ov.innerHTML='<div class="tbl-card" role="dialog" aria-modal="true" aria-labelledby="tsAsgT" aria-describedby="tsAsgSub">'+
    '<div class="tbl-head"><span class="tbl-head-ic" aria-hidden="true">'+ic('user-plus',20)+'</span>'+
      '<div class="tbl-head-tx"><div class="tbl-eyebrow">Assignment Center \u00b7 Assign</div><h2 class="tbl-title" id="tsAsgT">Assign '+esc(g.label)+' tickets to sanitize</h2></div>'+
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
  var done=!!(SAD&&SAD.done.length), sel=SAD?SAD.sel:null; SAD=null;   // any contractor assigned (also a partial run)
  ov.remove(); if(window.PHDLoginUI) window.PHDLoginUI.closed(ov);
  if(done){
    loadAssign();
    // Refocus the group's button, found again by id (its index can move after the refresh).
    loadScores(null,false,true).then(function(){
      var k=sel?scGroupKey(sel.closureCode):null; if(!k) return;
      var a=document.getElementById('tsScA-'+k), b=a&&!a.disabled?a:document.getElementById('tsScB-'+k); if(b) b.focus();
    });
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
    return '<p class="tbl-msg"><b>'+saPlural(SAD.avail,'ticket')+'</b> with closure code <b>'+esc(SAD.sel.label)+'</b> available to assign</p>'+
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
    return '<p class="tsa-k" id="tsaWhoK">Split '+saPlural(SAD.count,'ticket')+' ('+esc(SAD.sel.label)+') across contractors</p>'+rows+
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
    '<p class="tsa-hint">No deadline: the tickets are checked once marked and a newer data upload arrives. Extract copies only the ticket links, one per line.</p>'+
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
  var out=await saRunSplit(A.api.bind(A),SAD.sel,queue,function(q,i,k){
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

// Esc closes whichever modal is open. A pop-up stacked on top of the checklist or the log pop-up
// (Add / Edit / Delete a line, Assign to sanitize) closes on its own, leaving the one underneath open.
function tsStacked(){
  var a=document.getElementById('tsAddModal'), e=document.getElementById('tsEditModal'), d=document.getElementById('tsDelModal');
  return !!(document.getElementById('tsAsgDlg')||(a&&a.style.display==='flex')||
    (e&&e.classList.contains('show'))||(d&&d.classList.contains('show')));
}
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape') return;
  var stacked=tsStacked();
  tsCloseEdit(); tsCloseDel(); tsCloseAdd(); tsAsgClose();
  if(!stacked){ tsCkClose(); tsLogClose(); }
});
// Fill the [data-ic] icon slots of the page's static pop-ups (icons.js).
document.querySelectorAll('#tsAddModal [data-ic],#tsCkModal [data-ic],#tsLogModal [data-ic]').forEach(function(el){ el.insertAdjacentHTML('afterbegin',ic(el.getAttribute('data-ic'),+el.getAttribute('data-sz')||16)); });

// API for sanitization-tracker.html. The page builds its shell once (hero + its sections), then calls
// start() for logged-in users (the login gate is the page's). Any logged-in user opens the checklist
// pop-up; only harisss/flofalgu see its edit controls; the scores and the assignment log pop-up are
// owner only (servers enforce both).
window.PHDSanCheck = {
  isOwner: tsIsOwner, canEdit: tsCanEdit,
  // Top-level accordion helpers: open(id) = the open card (null = all collapsed, the state on first paint).
  open: function (id) { if (id !== undefined) TS_TOP = id; return TS_TOP; },
  topCls: tsTopCls, topHead: tsTopHead, topBody: tsTopBody, topSum: tsTopSum,
  chipsHtml: function () { return chipsHtml(tsCanEdit()); }, promptBtnHtml: promptBtnHtml,
  checklistBtnHtml: checklistBtnHtml, logBtnHtml: logBtnHtml,
  ckOpen: tsCkOpen, ckClose: tsCkClose, logOpen: tsLogOpen, logClose: tsLogClose,
  scoreHtml: scoreHtml,
  sanitizedHtml: sanitizedHtml, markedHtml: markedHtml,
  start: function () {
    loadChecklist();
    loadScores();   // owner only (no-op for everyone else; the server returns 403 to non-owners anyway)
    loadAssign();   // owner only: sanitization assignment log
  }
};
})();
