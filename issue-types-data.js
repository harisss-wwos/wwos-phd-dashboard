// Shared PHD incident-type taxonomy (read-only). Used by issue-types.html (the reference cards) and
// tool-rcd.html (the Build-Root-Cause-Details converter's Issue dropdown + definitions).
// Shape: [{category, catIcon, catImg, types:[{type,desc,def,use,ex,color,icon}]}]
window.IZ_CATS = [
  { category:"Weapon & Robbery", catIcon:"flame", catImg:"icons/issue-types/weapon-robbery.png", types:[
    { type:"Robbery w/ weapon", desc:"Property taken/attempted, with a weapon", color:"#d33b4e", icon:"alert",
      def:"POI robs the transporter \u2014 or attempts to \u2014 using/presenting a weapon posing a lethal threat, taking property (in the driver\u2019s custody or not). Package theft when the transporter is NOT present is out of scope.",
      use:"Property taken/attempted by force WITH a weapon while the driver is present.",
      ex:"Armed individuals take the DP\u2019s phone and packages at gunpoint." },
    { type:"Robbery w/o weapon", desc:"Property taken/attempted, no weapon", color:"#d33b4e", icon:"alert",
      def:"Purposeful robbery/theft \u2014 or attempt \u2014 of property (in custody or not), without a weapon and without critical injury. Package theft when the transporter is NOT present is out of scope.",
      use:"Property taken/attempted by force or theft WITHOUT a weapon while the driver is present.",
      ex:"A CM shoves the DP and grabs their phone or packages during the delivery." },
    { type:"Attack w/weapon", desc:"Weapon used/attempted on driver", color:"#d33b4e", icon:"flame",
      def:"POI uses or attempts to use a weapon against the driver, regardless of injury level \u2014 including injury, critical injury, or hospitalization (severity via SEV).",
      use:"A weapon is actually used or attempted against the driver.",
      ex:"A CM swings a metal pipe at the DP; a CX throws a bottle that strikes the driver." },
    { type:"Weapon pointed at driver", desc:"Weapon aimed at the driver", color:"#e0564a", icon:"target",
      def:"POI aims/directs a weapon at the driver, or draws/reveals a concealed weapon directing the threat at them, but does not use it.",
      use:"A weapon is aimed at the driver but not used.",
      ex:"A CX\u2019s spouse points a firearm at the DP and keeps it aimed until they leave." },
    { type:"Armed w/weapon", desc:"Weapon brandished to threaten, not used", color:"#e08a1d", icon:"alert",
      def:"POI holds/displays/brandishes a weapon to threaten, but does not aim it at the driver or use it; no critical injury.",
      use:"A weapon is brandished to threaten, but not aimed or used.",
      ex:"A CX holds a bat and threatens the DA but never swings it." },
    { type:"Weapon present w/ no threat", desc:"Weapon only present, no threat", color:"#2f9fb8", icon:"eye",
      def:"A weapon is visible/known but not held toward, aimed at, referenced, or used against the driver.",
      use:"A weapon is merely seen/known, with no threatening gesture, aim, or words.",
      ex:"A CX answers the door holding a rifle at their side; not aimed, no threat." },
    { type:"Shots fired", desc:"Firearm discharged near/at driver", color:"#d33b4e", icon:"flame",
      def:"Driver hears or sees shots (intentional or unintentional) fired of any kind.",
      use:"A firearm is discharged near or at the driver.",
      ex:"A resident fires a gun toward the DA\u2019s vehicle." }
  ]},
  { category:"Pet", catIcon:"paw", catImg:"icons/issue-types/pet.png", types:[
    { type:"Attack w/pet", desc:"POI commands pet to attack", color:"#e08a1d", icon:"paw",
      def:"POI intentionally uses or commands a pet to cause harm \u2014 pet deployed as a weapon.",
      use:"The POI deliberately sets/commands the pet on the driver.",
      ex:"A CX commands their dog to attack the DA." },
    { type:"Unsecured pet - bite/injury", desc:"Unsecured pet bites/contacts, injury", color:"#e08a1d", icon:"paw",
      def:"POI\u2019s unsecured pet bites/makes contact causing injury, without command.",
      use:"An unsecured pet bites/contacts the driver causing injury (not commanded).",
      ex:"A CX\u2019s loose dog bites the DA\u2019s leg, breaking skin." },
    { type:"Unsecured pet - evasion injury", desc:"Injured escaping the pet, no bite", color:"#e08a1d", icon:"paw",
      def:"Driver injured while escaping/avoiding a pet (fall, trip, strain), with no bite/contact.",
      use:"The driver is hurt fleeing/avoiding a pet, with no bite/contact.",
      ex:"The DA sprains a wrist tripping while fleeing a charging dog." },
    { type:"Unsecured pet - no contact", desc:"Aggressive pet, no contact/injury", color:"#e08a1d", icon:"paw",
      def:"POI\u2019s unsecured pet charges/chases aggressively with no contact and no injury.",
      use:"An unsecured pet is aggressive but makes no contact/injury.",
      ex:"A dog rushes out barking; the DP retreats to the vehicle; no contact." }
  ]},
  { category:"Physical / Severe Outcome", catIcon:"alert", catImg:"icons/issue-types/physical-severe-outcome.png", types:[
    { type:"Fatality from assault", desc:"Driver died", color:"#d33b4e", icon:"alert",
      def:"Loss of life resulting from CX actions or a CX-location hazard.",
      use:"The driver dies from a CX-caused act or CX-location hazard.",
      ex:"The driver dies from injuries inflicted during an assault." },
    { type:"Physical altercation \u2013 No Injury", desc:"Assault w/o weapon, no injury", color:"#e08a1d", icon:"user",
      def:"Purposeful physical force/assault without a weapon and no injury to the driver.",
      use:"The POI makes physical contact/assault without a weapon and no injury to the driver.",
      ex:"The CX\u2019s partner punches the DA; a CX spits in the DA\u2019s face." },
    { type:"Physical altercation w/ Injury", desc:"Assault w/o weapon, causes injury", color:"#d33b4e", icon:"alert",
      def:"Purposeful physical force/assault without a weapon causing Injury (regardless of level of injury).",
      use:"The POI makes physical contact/assault without a weapon causing injury to the driver.",
      ex:"The CX punches the DA on the nose that causes bleeding." }
  ]},
  { category:"Threats", catIcon:"message", catImg:"icons/issue-types/threats.png", types:[
    { type:"Threat of harm (verbal or written)", desc:"Threatens to harm the driver", color:"#e08a1d", icon:"message",
      def:"Purposeful threat of physical harm to the driver, whether spoken (in person/any channel) or written (note handed over or left on the vehicle).",
      use:"The POI threatens physical harm, verbally or in writing.",
      ex:"\u201cI\u2019ll shoot you if you come back\u201d; or a threatening note left on the vehicle." }
  ]},
  { category:"Detention / Impeding", catIcon:"lock", catImg:"icons/issue-types/detention-impeding.png", types:[
    { type:"Kidnapping", desc:"Taken/moved to another location", color:"#e0564a", icon:"lock",
      def:"POI forcibly seizes and takes/relocates the driver to another location under their control.",
      use:"The driver is forcibly taken/moved to another location against their will.",
      ex:"A POI forces the driver into a vehicle and drives them away." },
    { type:"Impeding egress", desc:"Blocked from leaving", color:"#e08a1d", icon:"no-entry",
      def:"POI temporarily blocks/obstructs the driver\u2019s exit or path, without confining or moving them, and without a weapon or critical injury.",
      use:"The driver is blocked from leaving, but not locked in and not taken away.",
      ex:"A CX parks their car to block the DA\u2019s van from leaving the driveway." }
  ]},
  { category:"Sexual", catIcon:"shield", catImg:"icons/issue-types/sexual.png", types:[
    { type:"Sexual assault (physical)", desc:"Sexual physical contact/attempt", color:"#d33b4e", icon:"alert",
      def:"Purposeful sexual touching/attempt, kissing, sexually suggestive contact, or purposeful lewd exposure.",
      use:"Sexual physical contact/attempt or intentional lewd exposure.",
      ex:"A CX gropes the DP while handing over the package." },
    { type:"Sexual harassment (verbal)", desc:"Sexual comments/solicitation", color:"#2f9fb8", icon:"message",
      def:"Unwelcome verbal/written sexual comments, leering, or sexist/stereotypical remarks based on gender.",
      use:"The POI makes unwelcome sexual or sexist remarks toward the driver.",
      ex:"A CX makes sexually suggestive comments and solicits the DP." },
    { type:"Indecent exposure", desc:"Nudity/exposure, no sexual intent", color:"#2f9fb8", icon:"eye",
      def:"Exposure that makes the driver uncomfortable \u2014 full/partial nudity or any body part(s) \u2014 without sexual intent or lewd conduct (else use Sexual assault/harassment).",
      use:"The customer is naked or exposes body parts uncomfortably, no sexual intent.",
      ex:"A CX answers the door naked." }
  ]},
  { category:"Abuse, Intimidation & Discrimination", catIcon:"users", catImg:"icons/issue-types/abuse-intimidation-discrimination.png", types:[
    { type:"Name Calling", desc:"Slurs/name calling at driver (protected trait)", color:"#e08a1d", icon:"message",
      def:"Discriminatory language, name calling or conduct directed at the driver \u2014 slurs, insults, abuse \u2014 targeting a protected characteristic. (Displayed symbols/signage \u2192 Signage/Paraphernalia.)",
      use:"The POI directs discriminatory language/slurs/name calling at the driver.",
      ex:"A CX directs racial or homophobic slurs at the DA." },
    { type:"Intimidation", desc:"Physical intimidation causing fear", color:"#e08a1d", icon:"user",
      def:"Purposeful physical intimidation causing fear/apprehension, without a weapon or critical injury.",
      use:"The POI physically intimidates the driver causing fear.",
      ex:"A CX films the DA up close and aggressively confronts them." },
    { type:"Verbal abuse", desc:"Yelling/profanity/harassing notes, no threat", color:"#2f9fb8", icon:"message",
      def:"Offensive/harassing language \u2014 yelling, profanity or harassing customer notes (written) \u2014 that is not discriminatory and not threatening.",
      use:"The POI yells, curses, name-calls, or leaves harassing notes, no threat/discrimination.",
      ex:"A CX curses and yells at the DP over a late delivery." },
    { type:"Signage/Paraphernalia", desc:"Racist/threatening signage at property", color:"#2f9fb8", icon:"flame",
      def:"Discriminatory, racist, or threatening symbols/signs/paraphernalia displayed at the property \u2014 not language directed at the driver.",
      use:"The address displays racist/threatening/discriminatory signage or symbols.",
      ex:"A racist symbol or threatening sign is posted at the delivery location." }
  ]},
  { category:"Property", catIcon:"tool", catImg:"icons/issue-types/property.png", types:[
    { type:"Vandalism", desc:"Purposely damages vehicle/property", color:"#e08a1d", icon:"tool",
      def:"Purposeful defacement, damage, or destruction of property \u2014 whether in the driver\u2019s custody or not \u2014 including the vehicle or Amazon packages.",
      use:"The POI purposely damages/defaces the driver\u2019s vehicle or packages.",
      ex:"A CX strikes the DP\u2019s windshield; a resident throws a rock at the vehicle." }
  ]},
  { category:"Out of Scope of PHD", catIcon:"alert", catImg:"icons/issue-types/out-of-scope.png", types:[
    { type:"Accidental injury (no POI)", desc:"Injury,no POI (collision/slip/medical)", color:"#e08a1d", icon:"alert",
      def:"Transporter injury or medical event with no POI involvement \u2014 traffic collision, slip/fall, or medical emergency",
      use:"The driver is injured with no POI involvement.",
      ex:"A traffic collision injures the DA; the DA slips on icy stairs." },
    { type:"Property / vehicle damage only", desc:"Damage only , no injury, no POI", color:"#e08a1d", icon:"alert",
      def:"Accidental damage to the vehicle/property with no injury and no purposeful POI act.",
      use:"An accident damages the vehicle/property with no injury and no POI intent.",
      ex:"A detached trailer strikes the DA\u2019s vehicle; no injuries." },
    { type:"Suspicious Following", desc:"unidentified POI follows", color:"#e08a1d", icon:"alert",
      def:"An unidentified POI follows, trails, surveils, or positions themselves to monitor the driver during a delivery, with no verbal exchange, threat, weapon, or physical contact.",
      use:"When a driver is followed, trailed, or watched by an unidentified party with no direct interaction, no threat, no weapon, and no contact, and the POI is not tied to a customer or address.",
      ex:"The DP noticed an unknown vehicle that had earlier parked next to the DP's vehicle on arrival. The same vehicle followed the DP. The DP felt unsafe." }
  ]}
];

// Shared PHD resolution list (clean names, in canonical mitigation-matrix order). Single source of
// truth for the tools-page Root-Cause-Details builder AND the My Tickets structured incident log.
window.RC_RESOLUTIONS = [
  'Account Closure',
  'Account Suspension',
  'Blocking Place ID',
  'Physical Order Block',
  'Address Exclusion',
  'Address Deprioritization or Address Depri',
  'Area Exclusion',
  'GeoPin Update',
  'GeoFence Update',
  'Geo-Routing Update',
  'Parcel Box Installation',
  'Delivery Hint Update',
  'Customer Education',
  'Customer Reassurance',
  'Driver Follow-up',
  'Pet Info Update',
  'Insufficient Information',
  'PHD Outreach',
  'Driver Education',
  'Driver Misconduct Reported',
  'Driver Misconduct Not Reported'
];

// Shared PHD "Root Cause" classification list (used by the My Tickets structured incident log).
window.RC_ROOT_CAUSES = [
  'Access Code Defect',
  'Aggressive CM (unprovoked)',
  'Aggressive CX (unprovoked)',
  'Amazon/Driver targeted',
  'CX Unfamiliar with Delivery Process',
  'CX/CM Embellished/False Report',
  'Collusion',
  'Customer Appeal Request (Not Applicable)',
  'Customer Service Escalation',
  'Driver Embellished/False Report',
  'Driving Behavior - Other',
  'Failure to de-escalate',
  'Geo Pin',
  'Inaccurate Delivery Instructions',
  'Inappropriate Conduct',
  'Inappropriate Racial Comments',
  'Inappropriate Sexual Comments',
  'Key In-Garage Delivery',
  'Language Barrier',
  'Misidentification',
  'Missing Delivery Instructions',
  'NOT APPLICABLE/No Further Action Required',
  'Not Amazon related',
  'Not following delivery instructions',
  'OTP Confusion',
  'Opportunity',
  'Package Handling',
  'Parking Dispute',
  'Previous Delivery Experience',
  'Property Damage',
  'Road Rage',
  'Routing Issue',
  'Transporter Misconduct',
  'Transporter being followed',
  'Transporter felt unsafe (No Interaction)',
  'Undetermined',
  'Unexpected Delivery Time',
  'Unsecured Animal Attack (CX Pet)',
  'Unsecured Animal Attack (Non-CX Pet/ Other)',
  'Unsecured Animal Evasion (CX Pet)',
  'Unsecured Animal Evasion (Non-CX Pet/ Other)',
  'Vehicle Collision',
  'Vehicle Unsecured',
  'Wrong/No Package Delivered'
];

// ====================================================================================
// Shared "searchable select" enhancer.
// Turns a native <select> into a type-to-filter combobox (like the Resolve-ticket Root Cause
// picker) WITHOUT changing the underlying <select>: the native element stays the source of truth,
// so existing code that reads/sets .value and listens to 'change' keeps working. Call
// window.makeSearchableSelect(selectEl) after the <select> is populated with its <option>s.
// Idempotent (safe to call again after re-populating options — pass {rebuild:true} to resync).
// ====================================================================================
(function () {
  var OPEN = null; // currently-open combobox (only one at a time)
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  // Inject the shared CSS once.
  function ensureCss(){
    if (document.getElementById('ss-css')) return;
    var st = document.createElement('style'); st.id = 'ss-css';
    st.textContent = [
      '.ss-wrap{position:relative;width:100%}',
      '.ss-field{width:100%;display:flex;align-items:center;gap:8px;box-sizing:border-box;cursor:pointer;background:#fff;border:1px solid #d4dce4;border-radius:8px;color:#1b2026;font-family:inherit;font-size:.9em;padding:10px 12px;line-height:1.3}',
      '.ss-field:focus,.ss-wrap.open .ss-field{outline:none;border-color:#ec7211;box-shadow:0 0 0 3px rgba(236,114,17,.14)}',
      '.ss-field.ss-disabled{background:#f1f3f6;color:#a7b0ba;cursor:not-allowed;opacity:.8}',
      '.ss-field .ss-val{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ss-field .ss-val.ss-ph{color:#8a94a2}',
      '.ss-field .ss-caret{flex:0 0 auto;color:#8a94a2;transition:transform .15s}',
      '.ss-wrap.open .ss-field .ss-caret{transform:rotate(180deg)}',
      '.ss-pop{position:absolute;z-index:6000;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1px solid #d4dce4;border-radius:8px;box-shadow:0 12px 30px -12px rgba(20,30,50,.35);padding:8px;display:none}',
      '.ss-wrap.open .ss-pop{display:block}',
      '.ss-search{display:flex;align-items:center;gap:8px;border:0;border-radius:0;padding:0;margin-bottom:8px}',
      '.ss-search svg{flex:0 0 auto;color:#8a94a2}',
      '.ss-search input{flex:1;min-width:0;border:0!important;outline:none!important;box-shadow:none!important;background:transparent;font-family:inherit;font-size:.9em;color:#1b2026;padding:0!important}',
      '.ss-list{max-height:240px;overflow:auto}',
      '.ss-opt{padding:9px 11px;border-radius:6px;font-size:.9em;color:#1b2026;cursor:pointer;white-space:normal;line-height:1.35}',
      '.ss-opt:hover,.ss-opt.ss-active{background:#eef3f8}',
      '.ss-opt.ss-chosen{font-weight:700}',
      '.ss-empty{padding:10px 11px;color:#8a94a2;font-size:.86em}'
    ].join('');
    document.head.appendChild(st);
  }
  var SEARCH_ICO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var CARET_ICO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  function closeOpen(){ if (OPEN){ OPEN.classList.remove('open'); OPEN=null; } }
  document.addEventListener('click', function(e){ if (OPEN && !OPEN.contains(e.target)) closeOpen(); });
  document.addEventListener('keydown', function(e){ if (e.key==='Escape') closeOpen(); });

  window.makeSearchableSelect = function (sel, opts) {
    opts = opts || {};
    if (!sel || sel.tagName !== 'SELECT') return;
    ensureCss();
    var wrap = sel._ssWrap;
    if (wrap && !opts.rebuild) { refreshFromSelect(sel); return; }
    if (!wrap) {
      // Build the combobox shell once and hide the native select.
      sel.style.display = 'none';
      wrap = document.createElement('div'); wrap.className = 'ss-wrap';
      sel.parentNode.insertBefore(wrap, sel.nextSibling);
      var field = document.createElement('button');
      field.type = 'button'; field.className = 'ss-field';
      field.innerHTML = '<span class="ss-val"></span><span class="ss-caret">'+CARET_ICO+'</span>';
      var pop = document.createElement('div'); pop.className = 'ss-pop';
      pop.innerHTML = '<div class="ss-search">'+SEARCH_ICO+'<input type="text" placeholder="Filter\u2026" aria-label="Filter options"></div><div class="ss-list"></div>';
      wrap.appendChild(field); wrap.appendChild(pop);
      sel._ssWrap = wrap; sel._ssField = field; sel._ssInput = pop.querySelector('input'); sel._ssList = pop.querySelector('.ss-list');

      field.addEventListener('click', function(){ if (sel.disabled) return; var isOpen = wrap.classList.contains('open'); closeOpen(); if (!isOpen){ wrap.classList.add('open'); OPEN = wrap; sel._ssInput.value=''; renderList(sel,''); setTimeout(function(){ sel._ssInput.focus(); }, 10); } });
      sel._ssInput.addEventListener('input', function(){ renderList(sel, this.value); });
      sel._ssInput.addEventListener('keydown', function(e){
        var items = Array.prototype.slice.call(sel._ssList.querySelectorAll('.ss-opt'));
        var act = sel._ssList.querySelector('.ss-opt.ss-active'); var idx = items.indexOf(act);
        if (e.key==='ArrowDown'){ e.preventDefault(); idx=Math.min(items.length-1, idx+1); }
        else if (e.key==='ArrowUp'){ e.preventDefault(); idx=Math.max(0, idx-1); }
        else if (e.key==='Enter'){ e.preventDefault(); if (act) act.click(); return; }
        else return;
        items.forEach(function(x){ x.classList.remove('ss-active'); });
        if (items[idx]){ items[idx].classList.add('ss-active'); items[idx].scrollIntoView({block:'nearest'}); }
      });
    }
    refreshFromSelect(sel);
  };

  // Mirror the native select's current value + disabled state into the combobox face.
  function refreshFromSelect(sel){
    var field = sel._ssField; if (!field) return;
    var val = sel.value;
    var opt = sel.options[sel.selectedIndex];
    var label = opt ? opt.textContent : '';
    var valEl = field.querySelector('.ss-val');
    // A placeholder option has an empty value — show it greyed.
    valEl.textContent = label || (sel.options[0] ? sel.options[0].textContent : '');
    valEl.classList.toggle('ss-ph', !val);
    field.classList.toggle('ss-disabled', !!sel.disabled);
  }
  // (Re)render the filtered option list.
  function renderList(sel, q){
    var list = sel._ssList; if (!list) return;
    q = String(q||'').trim().toLowerCase();
    var html = ''; var cur = sel.value;
    for (var i=0;i<sel.options.length;i++){
      var o = sel.options[i];
      if (o.value==='' ) continue;                 // skip the placeholder row inside the list
      var txt = o.textContent;
      if (q && txt.toLowerCase().indexOf(q)<0) continue;
      html += '<div class="ss-opt'+(o.value===cur?' ss-chosen':'')+'" data-val="'+esc(o.value)+'">'+esc(txt)+'</div>';
    }
    list.innerHTML = html || '<div class="ss-empty">No matches</div>';
    Array.prototype.forEach.call(list.querySelectorAll('.ss-opt'), function(el){
      el.addEventListener('click', function(){
        sel.value = el.getAttribute('data-val');
        refreshFromSelect(sel);
        closeOpen();
        sel.dispatchEvent(new Event('change', { bubbles:true }));
      });
    });
  }
})();
