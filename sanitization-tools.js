// Sanitization tools shared by sanitization-tracker.html (moved here from ticket-sanitization.html):
//   - the hero buttons "Update tickets data" (owner only), "Generate Title and Root Cause Details" and
//     "Open assigned tickets sheet", two rows with the page's "Copy prompt" (PHDSanTools.heroActsHtml),
//   - the "Update tickets data" pop-up (owner only; POST /api/sanitization-update, the server enforces it),
//   - the "Generate Title and Root Cause Details" pop-up (front end only, nothing is saved).
// Styles: sanitization-tools.css. Needs icons.js, api-config.js, topbar-auth.js (PHDAuth, PHDLoginUI,
// PHDParseCSV, the shared .tbl-* dialog shell) and issue-types-data.js (IZ_CATS + makeSearchableSelect).
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
function copyFallback(text, done) { try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); done(ok); } catch (e) { done(false); } }

// The shared SharePoint sheet where each contractor finds their assigned tickets.
var TS_SHEET_URL = 'https://amazon-my.sharepoint.com/:x:/r/personal/flofalgu_amazon_com/_layouts/15/doc2.aspx?sourcedoc=%7B1C13EF24-F76D-41A3-A9A4-CE41C2550BA8%7D&file=Book.xlsx&action=editnew&mobileredirect=true';
var ICO_EXT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
var ICO_SHEET = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>';
// Hero buttons in two rows of equal-width cells: [Update (owner only) | Generate] and [Open sheet | opts.extra]
// (opts.extra = the page's "Copy prompt" button). A row with one button gives it the whole width.
function heroActsHtml(opts) {
  opts = opts || {};
  return '<div class="ts-hero-acts is-rows"><div class="ts-hero-row">' +
    (opts.owner ? '<button type="button" class="ts-hero-link ts-hero-upd" id="tsUpdBtn" onclick="tsUpdOpen()" aria-haspopup="dialog" title="Upload cleaned ticket CSVs to update existing tickets">' +
      '<span class="ts-hl-sheet" aria-hidden="true">' + ic('upload', 18) + '</span>' +
      '<span class="ts-hl-txt"><span class="ts-hl-t">Update tickets data</span><span class="ts-hl-s" aria-hidden="true">Upload cleaned ticket CSVs</span></span></button>' : '') +
    '<button type="button" class="ts-hero-link ts-hero-gen" id="tsGenBtn" onclick="tsGenOpen()" aria-haspopup="dialog" title="Paste a SIM ticket to generate the SIM Title and SIM Root Cause Details">' +
      '<span class="ts-hl-sheet" aria-hidden="true">' + ic('clipboard', 18) + '</span>' +
      '<span class="ts-hl-txt"><span class="ts-hl-t">Generate Title and Root Cause Details</span><span class="ts-hl-s" aria-hidden="true">Paste a SIM ticket, get the title + SIM RCD</span></span></button>' +
    '</div><div class="ts-hero-row">' +
    '<a class="ts-hero-link" href="' + esc(TS_SHEET_URL) + '" target="_blank" rel="noopener noreferrer" title="SharePoint \u00b7 Excel \u00b7 opens in a new tab">' +
      '<span class="ts-hl-sheet" aria-hidden="true">' + ICO_SHEET + '</span>' +
      '<span class="ts-hl-txt"><span class="ts-hl-t">Open assigned tickets sheet</span><span class="ts-hl-s" aria-hidden="true">SharePoint \u00b7 Excel \u00b7 opens in a new tab</span></span>' +
      '<span class="ts-hl-ext" aria-hidden="true">' + ICO_EXT + '</span><span class="ts-sr"> (opens in a new tab)</span></a>' +
    (opts.extra || '') +
    '</div></div>';
}

/* TSG-PURE-BEGIN — "Generate Title and Root Cause Details": pure parse / generate helpers (no DOM).
   The RCD part is a copy of the Build Root Cause Details converter.
   KEEP IN SYNC with tool-rcd.html (RC_RESLIST, RC_FIELDS, RC_OTHER_KEYS, rcFmtDate, rcHiCountOf, RC_HI_MAX, rcConvert's output lines).
   Reading the paste is NOT a copy of rcGrab: tsgGrab is line based (a whole SIM page has UI text / free text around the keys),
   dates go through tsgNormDate first, and TID keeps only the first ID ("A3LD0EAD6DVXT8 / FAPS" -> "A3LD0EAD6DVXT8"). */
var TSG_RESLIST=[null,'Account Closure','Address Deprio','Address Exclusion','Area Exclusion','Customer Reassurance','Delivery Hint',
  'Driver Follow-up','GeoFence Update','GeoPin Update','Parcel Box Installation','Physical Order Block','Routing Update'];
var TSG_RC_FIELDS=[
  ['SID',  ['Station ID','SID']],
  ['TID',  ['Transporter ID','TID']],
  ['Driv', ['Driver Type','Driv']],
  ['Date', ['Incident Date','Date of Incident','Date']],
  ['Cnt',  ['Historical Incident Count','Historical Incident','Historical Incidents','Cnt']],
  ['Zip',  ['Zip Code','Zip']],
  ['CID',  ['Customer Account ID','Account ID','AID','CID']],
  ['UPID', ['Unit Place ID','UPID']]
];
var TSG_OTHER_KEYS=['Contact ID','Contact Id','Contact Date','Severity','Tag','Place ID','UID','CAID',
  'Customer ID','Threat Contact ID','SIM Root Cause Details','Output','Historical','AID','CID',
  'Tracking ID','Related Tracking ID','TBA',
  'HI1','HI2','HI3','HI4','HI5','HI6','HI7','HI8','HI9',
  // Extra stop keys for a whole SIM page paste (not in tool-rcd.html): free text / links never leak into a field.
  'Summary of Incident','Incident Summary','Related Items','Account Suspension Tag','EMT Link (if applicable)','EMT Link',
  'ECR','EDR','EMT ID','Reminder'];
var TSG_HI_MAX=9;
var TSG_ALL_KEYS=(function(){
  var ks=['Issue','Resolution','Res'];
  TSG_RC_FIELDS.forEach(function(f){ f[1].forEach(function(a){ ks.push(a); }); });
  TSG_OTHER_KEYS.forEach(function(k){ ks.push(k); });
  return Array.from(new Set(ks)).sort(function(a,b){ return b.length-a.length; });
})();
function tsgEscRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
// Line-based reader for a whole SIM page paste (deliberately stricter than rcGrab):
// - a key counts only at the START of a line ("Key: v", "Key - v", "Key:: v"); the value is the rest of that line;
// - "Key:" with nothing after it reads the NEXT line, unless that line is a known key or UI noise;
// - the free-text summary ("Incident Summary:" / "Summary of Incident:") is skipped up to the next key or noise line.
// So the SIM title ("... - Account ID: X - ...") and free text never fill a field. First non-empty value wins (alias order).
var TSG_KEY_RE=new RegExp('^('+TSG_ALL_KEYS.map(tsgEscRe).join('|')+')\\s*[:\\-]\\s*(.*)$','i');
var TSG_SUMMARY_KEYS={'summary of incident':1,'incident summary':1};
// SIM page UI text / tail notes / investigation template lines (line start, case-insensitive).
var TSG_NOISE_RE=/^(?:edit(?: announcement)?$|actions$|open oncall assistant|ticket synopsis|customize your ticket synopsis|announcements$|overview$|communication$|assistant$|information$|event management$|audit trail$|ids\s*:|reminder\b|incident summary\b|summary of incident\b|related items\b|ecr\s*:|edr\s*:|lmir\s*:|emt id\s*:|[\u2022*]|route information\b|driver statement\b|local law enforcement update\b|crime index\b|incident location\b|={3,}|-{3,}|please contact workflow owner|original ticket created by|related to source ticket|team to identify)/i;
function tsgKeyOf(line){ var m=String(line||'').trim().match(TSG_KEY_RE); return m?{key:m[1].toLowerCase(), rest:m[2]}:null; }
function tsgIsNoise(line){ return TSG_NOISE_RE.test(String(line||'').trim()); }
function tsgClean(v){ return String(v==null?'':v).replace(/^[:\s]+/,'').trim().replace(/[,;|]+$/,'').trim(); }
// raw -> {entries:[{key (lower case), value}], ignored: number of non-key lines}. One-entry cache (re-read per field).
var TSG_SCAN_CACHE={raw:null, res:null};
function tsgScan(raw){
  raw=String(raw==null?'':raw);
  if(TSG_SCAN_CACHE.raw===raw) return TSG_SCAN_CACHE.res;
  var lines=raw.split(/\r?\n/), entries=[], ignored=0, inSum=false;
  for(var i=0;i<lines.length;i++){
    var t=lines[i].trim(); if(!t) continue;
    var k=tsgKeyOf(t);
    if(inSum){ if(!k && !tsgIsNoise(t)){ ignored++; continue; } inSum=false; }
    if(!k){ ignored++; continue; }
    if(TSG_SUMMARY_KEYS[k.key]){ inSum=true; ignored++; continue; }
    var v=tsgClean(k.rest);
    if(!v && i+1<lines.length){
      var nt=lines[i+1].trim();
      if(nt && !tsgKeyOf(nt) && !tsgIsNoise(nt)){ v=tsgClean(nt); i++; }
    }
    entries.push({key:k.key, value:v});
  }
  TSG_SCAN_CACHE={raw:raw, res:{entries:entries, ignored:ignored}};
  return TSG_SCAN_CACHE.res;
}
// -> {found (a key line exists), key (the alias that matched), value (first non-empty, alias order)}.
function tsgGrabInfo(raw, aliases){
  var es=tsgScan(raw).entries, found='';
  for(var i=0;i<aliases.length;i++){
    var a=aliases[i].toLowerCase();
    for(var j=0;j<es.length;j++){
      if(es[j].key!==a) continue;
      if(!found) found=aliases[i];
      if(es[j].value) return {found:true, key:aliases[i], value:es[j].value};
    }
  }
  return {found:!!found, key:found, value:''};
}
function tsgGrab(raw, aliases){ return tsgGrabInfo(raw,aliases).value; }
// Copy of rcFmtDate: date only, "11 Oct 2026".
function tsgFmtDate(v){
  if(!v) return '';
  var s=String(v).trim().replace(/^[:\s]+/,'');
  var p=function(n){ return String(n).padStart(2,'0'); };
  var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var build=function(y,mo,da){ return da+' '+(MON[mo-1]||p(mo))+' '+y; };
  var iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso){ return build(+iso[1], +iso[2], +iso[3]); }
  var m=s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(m){
    var yr=m[3].length===2?('20'+m[3]):m[3];
    var d=new Date(yr+'-'+p(+m[1])+'-'+p(+m[2]));
    if(!isNaN(d)) return build(d.getFullYear(), d.getMonth()+1, d.getDate());
  }
  var d2=new Date(s);
  if(isNaN(d2)) return s;
  return build(d2.getFullYear(), d2.getMonth()+1, d2.getDate());
}
// Copy of rcHiCountOf: plain non-negative integer -> number of HI fields (max 9); else 0.
function tsgHiCountOf(cnt){
  var s=String(cnt==null?'':cnt).trim();
  if(!/^\d+$/.test(s)) return {n:0, over:false};
  var v=parseInt(s,10);
  return {n:Math.min(v,TSG_HI_MAX), over:v>TSG_HI_MAX};
}
// ISO 3166-1 alpha-2 (all 249). The codebase only has partial lists (IL_COUNTRY_CODES in incident-log-editor.js).
// The United Kingdom is listed as "UK" (the code SIM titles use); "GB" is accepted as its alias, "UAE" as AE.
var TSG_COUNTRIES=('AD:Andorra|AE:United Arab Emirates|AF:Afghanistan|AG:Antigua and Barbuda|AI:Anguilla|AL:Albania|AM:Armenia|AO:Angola|'+
  'AQ:Antarctica|AR:Argentina|AS:American Samoa|AT:Austria|AU:Australia|AW:Aruba|AX:\u00c5land Islands|AZ:Azerbaijan|'+
  'BA:Bosnia and Herzegovina|BB:Barbados|BD:Bangladesh|BE:Belgium|BF:Burkina Faso|BG:Bulgaria|BH:Bahrain|BI:Burundi|BJ:Benin|'+
  'BL:Saint Barth\u00e9lemy|BM:Bermuda|BN:Brunei Darussalam|BO:Bolivia|BQ:Bonaire, Sint Eustatius and Saba|BR:Brazil|BS:Bahamas|'+
  'BT:Bhutan|BV:Bouvet Island|BW:Botswana|BY:Belarus|BZ:Belize|CA:Canada|CC:Cocos (Keeling) Islands|CD:Congo (Democratic Republic)|'+
  'CF:Central African Republic|CG:Congo|CH:Switzerland|CI:C\u00f4te d\u2019Ivoire|CK:Cook Islands|CL:Chile|CM:Cameroon|CN:China|'+
  'CO:Colombia|CR:Costa Rica|CU:Cuba|CV:Cabo Verde|CW:Cura\u00e7ao|CX:Christmas Island|CY:Cyprus|CZ:Czechia|DE:Germany|DJ:Djibouti|'+
  'DK:Denmark|DM:Dominica|DO:Dominican Republic|DZ:Algeria|EC:Ecuador|EE:Estonia|EG:Egypt|EH:Western Sahara|ER:Eritrea|ES:Spain|'+
  'ET:Ethiopia|FI:Finland|FJ:Fiji|FK:Falkland Islands|FM:Micronesia|FO:Faroe Islands|FR:France|GA:Gabon|UK:United Kingdom (GB)|'+
  'GD:Grenada|GE:Georgia|GF:French Guiana|GG:Guernsey|GH:Ghana|GI:Gibraltar|GL:Greenland|GM:Gambia|GN:Guinea|GP:Guadeloupe|'+
  'GQ:Equatorial Guinea|GR:Greece|GS:South Georgia and the South Sandwich Islands|GT:Guatemala|GU:Guam|GW:Guinea-Bissau|GY:Guyana|'+
  'HK:Hong Kong|HM:Heard Island and McDonald Islands|HN:Honduras|HR:Croatia|HT:Haiti|HU:Hungary|ID:Indonesia|IE:Ireland|IL:Israel|'+
  'IM:Isle of Man|IN:India|IO:British Indian Ocean Territory|IQ:Iraq|IR:Iran|IS:Iceland|IT:Italy|JE:Jersey|JM:Jamaica|JO:Jordan|'+
  'JP:Japan|KE:Kenya|KG:Kyrgyzstan|KH:Cambodia|KI:Kiribati|KM:Comoros|KN:Saint Kitts and Nevis|KP:Korea (North)|KR:Korea (South)|'+
  'KW:Kuwait|KY:Cayman Islands|KZ:Kazakhstan|LA:Lao PDR|LB:Lebanon|LC:Saint Lucia|LI:Liechtenstein|LK:Sri Lanka|LR:Liberia|'+
  'LS:Lesotho|LT:Lithuania|LU:Luxembourg|LV:Latvia|LY:Libya|MA:Morocco|MC:Monaco|MD:Moldova|ME:Montenegro|MF:Saint Martin (French part)|'+
  'MG:Madagascar|MH:Marshall Islands|MK:North Macedonia|ML:Mali|MM:Myanmar|MN:Mongolia|MO:Macao|MP:Northern Mariana Islands|'+
  'MQ:Martinique|MR:Mauritania|MS:Montserrat|MT:Malta|MU:Mauritius|MV:Maldives|MW:Malawi|MX:Mexico|MY:Malaysia|MZ:Mozambique|'+
  'NA:Namibia|NC:New Caledonia|NE:Niger|NF:Norfolk Island|NG:Nigeria|NI:Nicaragua|NL:Netherlands|NO:Norway|NP:Nepal|NR:Nauru|NU:Niue|'+
  'NZ:New Zealand|OM:Oman|PA:Panama|PE:Peru|PF:French Polynesia|PG:Papua New Guinea|PH:Philippines|PK:Pakistan|PL:Poland|'+
  'PM:Saint Pierre and Miquelon|PN:Pitcairn|PR:Puerto Rico|PS:Palestine|PT:Portugal|PW:Palau|PY:Paraguay|QA:Qatar|RE:R\u00e9union|'+
  'RO:Romania|RS:Serbia|RU:Russian Federation|RW:Rwanda|SA:Saudi Arabia|SB:Solomon Islands|SC:Seychelles|SD:Sudan|SE:Sweden|'+
  'SG:Singapore|SH:Saint Helena, Ascension and Tristan da Cunha|SI:Slovenia|SJ:Svalbard and Jan Mayen|SK:Slovakia|SL:Sierra Leone|'+
  'SM:San Marino|SN:Senegal|SO:Somalia|SR:Suriname|SS:South Sudan|ST:Sao Tome and Principe|SV:El Salvador|SX:Sint Maarten (Dutch part)|'+
  'SY:Syria|SZ:Eswatini|TC:Turks and Caicos Islands|TD:Chad|TF:French Southern Territories|TG:Togo|TH:Thailand|TJ:Tajikistan|'+
  'TK:Tokelau|TL:Timor-Leste|TM:Turkmenistan|TN:Tunisia|TO:Tonga|TR:T\u00fcrkiye|TT:Trinidad and Tobago|TV:Tuvalu|TW:Taiwan|'+
  'TZ:Tanzania|UA:Ukraine|UG:Uganda|UM:United States Minor Outlying Islands|US:United States|UY:Uruguay|UZ:Uzbekistan|VA:Holy See|'+
  'VC:Saint Vincent and the Grenadines|VE:Venezuela|VG:Virgin Islands (British)|VI:Virgin Islands (U.S.)|VN:Viet Nam|VU:Vanuatu|'+
  'WF:Wallis and Futuna|WS:Samoa|YE:Yemen|YT:Mayotte|ZA:South Africa|ZM:Zambia|ZW:Zimbabwe').split('|').map(function(s){
    var i=s.indexOf(':'); return {code:s.slice(0,i), name:s.slice(i+1)}; })
  .sort(function(a,b){ return a.name.localeCompare(b.name); });
var TSG_COUNTRY_SET=(function(){ var o={}; TSG_COUNTRIES.forEach(function(c){ o[c.code]=1; }); return o; })();
var TSG_COUNTRY_ALIAS={GB:'UK',UAE:'AE'};
// 'us' / 'GB' / 'UAE' -> list code ('US' / 'UK' / 'AE'); '' when unknown.
function tsgCountryCode(v){
  var c=String(v==null?'':v).trim().toUpperCase(); c=TSG_COUNTRY_ALIAS[c]||c;
  return TSG_COUNTRY_SET[c]?c:'';
}
function tsgLines(raw){ return String(raw==null?'':raw).split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean); }
// SIM title = first non-empty line; when it does not start with a country code, the first "... Incident Escalation ..." line.
function tsgTitleLine(raw){
  var ls=tsgLines(raw); if(!ls.length) return '';
  if(tsgLeadCode(ls[0])) return ls[0];
  for(var i=0;i<ls.length;i++){ if(/incident\s+escalation/i.test(ls[i])) return ls[i]; }
  return ls[0];
}
// Leading upper-case code of a title ("US Customer ...", "(UK) ...", "[CA] ...") when it is a known country.
function tsgLeadCode(line){
  var m=String(line||'').match(/^\s*[(\[]?\s*([A-Z]{2,3})\s*[)\]]?(?=[\s:\-\u2013\u2014|,.]|$)/);
  return m?tsgCountryCode(m[1]):'';
}
// Amazon customer account id: "A" + 8..20 upper-case letters / digits.
function tsgValidAid(v){ return /^A[A-Z0-9]{8,20}$/.test(String(v==null?'':v).trim()); }
var TSG_AID_KEYS=['Customer Account ID','Account ID','AID','CID'];
function tsgParseAid(raw){
  var v=tsgGrab(raw,TSG_AID_KEYS).toUpperCase();
  return tsgValidAid(v)?v:'';
}
// Severity in a title: Severity 5, Sev 5, Sev-5, Sev5, Severity level 5.
var TSG_SEV_RE=/\bsev(?:erity)?(?:\s*level)?\s*[-:#]?\s*([1-5])(?!\d)/i;
var TSG_NO_EMT_RE=/\bno[\s\-]*emt\b/i;
// " - " style separators (not the dash inside "pet-bite"); same as server/page-zero.js SEG_SPLIT_RE.
var TSG_SEG_SPLIT=/\s+[-\u2013\u2014]+\s*|\s*[-\u2013\u2014]+\s+/;
// SIM title -> {country, party ('Customer' | 'Community Member' | ''), aid (valid "Account ID: X" in the title),
// sev ('1'..'5' | ''), noEmt, issue (what is left after the country, party, Account ID, severity and "No EMT")}.
// Handles "[UK] ...", "- - ", "Severity 4 Threat w/o Weapon", "- 4 - verbal threats", "Severity level - X", "[Severity No EMT - X]".
function tsgParseTitle(title){
  var s=String(title||''), cc=tsgLeadCode(s), o={country:cc, party:'', aid:'', sev:'', noEmt:false, issue:''};
  if(cc) s=s.replace(/^\s*[(\[]?\s*[A-Za-z]{2,3}\s*[)\]]?/,' ');
  if(/\bcommunity\s+member\b/i.test(s)) o.party='Community Member'; else if(/\bcustomer\b/i.test(s)) o.party='Customer';
  var am=s.match(/\baccount\s*id\s*[:#]?\s*([A-Za-z0-9]+)/i);
  if(am){ var a=am[1].toUpperCase(); if(tsgValidAid(a)) o.aid=a; s=s.replace(am[0],' - '); }
  s=s.replace(/\b(?:customer|community\s+member)\s+incident(?:\s+escalation)?\b/ig,' - ').replace(/\bincident\s+escalation\b/ig,' - ').replace(/[\[\]]/g,' ');
  if(TSG_NO_EMT_RE.test(s)){ o.noEmt=true; s=s.replace(new RegExp(TSG_NO_EMT_RE.source,'ig'),' - '); }
  var m=s.match(TSG_SEV_RE);
  if(m){ o.sev=m[1]; s=s.replace(m[0],' - '); }
  var segs=s.replace(/\bsev(?:erity)?(?:\s*level)?\b/ig,' - ').split(TSG_SEG_SPLIT)
    .map(function(x){ return x.replace(/\s+/g,' ').replace(/^[\s\-\u2013\u2014:|,]+|[\s\-\u2013\u2014:|,]+$/g,''); }).filter(Boolean);
  if(!o.sev){ for(var i=0;i<segs.length;i++){ if(/^[1-5]$/.test(segs[i])){ o.sev=segs[i]; segs.splice(i,1); break; } } }
  o.issue=segs.filter(function(x){ return !/^[\d\s:.,#]*$/.test(x); }).join(' - ');
  return o;
}
// Severity: the "Severity:" value first ("4", "Severity 4", "No EMT ..."), then the SIM title.
// "No EMT" = Severity 5 (sanitization checklist: "If no EMT processed -> Severity set to 5"), tag 'noemt'.
// "EMT incident #1232557" / "NA" / empty are not a severity. Nothing found -> sev '' (the dialog uses 5 + DEFAULT).
function tsgParseSev(raw, tp){
  var v=tsgGrab(raw,['Severity']);
  var m=v.match(/^(?:sev(?:erity)?)?(?:\s*level)?\s*[-:#]?\s*([1-5])(?!\d)/i);
  if(m) return {sev:m[1], src:'Severity line', tag:'', raw:v};
  if(TSG_NO_EMT_RE.test(v)) return {sev:'5', src:'Severity line', tag:'noemt', raw:v};
  tp=tp||tsgParseTitle(tsgTitleLine(raw));
  if(tp.sev) return {sev:tp.sev, src:'SIM title', tag:'', raw:v};
  if(tp.noEmt) return {sev:'5', src:'SIM title', tag:'noemt', raw:v};
  return {sev:'', src:'', tag:'', raw:v};
}
function tsgIssueList(cats){ var out=[]; (cats||[]).forEach(function(c){ (c.types||[]).forEach(function(t){ out.push(String(t.type)); }); }); return out; }
// Exact match after trimming, case-insensitive -> the list spelling; '' otherwise.
function tsgMatchIssue(name, cats){
  var k=String(name==null?'':name).trim().toLowerCase(); if(!k) return '';
  var list=tsgIssueList(cats);
  for(var i=0;i<list.length;i++){ if(list[i].trim().toLowerCase()===k) return list[i]; }
  return '';
}
/* Issue suggestion ("Suggested: <type>" chip; never auto-applied): a compact port of the dashboard's free-text matcher.
   KEEP IN SYNC with server/page-zero.js (normKey, ISSUE_ROWS, ISSUE_ALIASES, WEAPON_WORDS, KEYWORD_RULES, TYPE_REFINE_RULES,
   ROW_DEFAULT_TYPE, NO_VALUE_KEYS and the order of exactMatch / kwScan / kwMatch / classifyTicket / closestTypeInRow). */
function tsgNormKey(s){ return String(s==null?'':s).replace(/\[[^\]]*\]?/g,' ').toLowerCase().replace(/[^a-z0-9/]/g,''); }
var TSG_PZ_ROWS=[
  ['robbery',['Robbery w/ weapon','Robbery w/o weapon']],
  ['weapon',['Attack w/weapon','Weapon pointed at driver','Armed w/weapon','Weapon present w/ no threat','Shots fired']],
  ['pet',['Attack w/pet','Unsecured pet - bite/injury','Unsecured pet - evasion injury','Unsecured pet - no contact']],
  ['physical',['Fatality from assault','Physical altercation \u2013 No Injury','Physical altercation w/ Injury']],
  ['verbal',['Threat of harm (verbal or written)','Name Calling','Intimidation','Verbal abuse','Signage/Paraphernalia','Vandalism']],
  ['kidnap',['Kidnapping','Impeding egress']],
  ['sexual',['Sexual assault (physical)','Sexual harassment (verbal)','Indecent exposure']],
  ['notSpecified',['Accidental injury (no POI)','Property / vehicle damage only','Suspicious Following']]
];
var TSG_PZ_ORDER={}, TSG_PZ_TYPES={}, TSG_PZ_TYPE={};
TSG_PZ_ROWS.forEach(function(r,i){ TSG_PZ_ORDER[r[0]]=i; TSG_PZ_TYPES[r[0]]=r[1]; r[1].forEach(function(t){ TSG_PZ_TYPE[tsgNormKey(t)]={row:r[0], type:t}; }); });
var TSG_PZ_ALIASES={
  'Pet Incident':'@pet','Pet attack':'@pet','Repeat Pet Incident':'@pet','Dog incident':'@pet','Dog attack':'@pet',
  'Unsecured Animal':'@pet','Unsecured Animal (CX Pet)':'@pet','Unsecured Animal (Non-CX Pet)':'@pet',
  'Unsecured Dog (CX pet)':'@pet','Unsecured animal (CX)':'@pet','Unsecured CX Pet':'@pet','Unsecured pet':'@pet',
  'Potential Harm - Pet Incident':'@pet','Pet incedent':'@pet',
  'Dog bite':'Unsecured pet - bite/injury','Bite/Injury':'Unsecured pet - bite/injury',
  'Driver injured by dog while making delivery':'Unsecured pet - bite/injury',
  'Unsecured Animal Attack (CX Pet)':'Unsecured pet - bite/injury','Unsecured Animal Attack (Non-CX Pet/ Other)':'Unsecured pet - bite/injury',
  'Unsecured Animal Evasion (CX Pet)':'Unsecured pet - evasion injury','Unsecured Animal Evasion (Non-CX Pet/ Other)':'Unsecured pet - evasion injury',
  'Attack w/o Weapon':'@physical','Assault w/o Weapon':'@physical','Physical Altercation':'@physical',
  'Assault':'@physical','Physical assault':'@physical','Attempt of Assault':'@physical','Attack on the driver':'@physical',
  'Detrimental Behavior - Assault':'@physical','Driver assaulted while making delivery':'@physical',
  'Assault - No Injury':'Physical altercation \u2013 No Injury','Assault w/o injury':'Physical altercation \u2013 No Injury',
  'Assault no injury':'Physical altercation \u2013 No Injury','Detrimental Behavior - Assault - No Injury':'Physical altercation \u2013 No Injury',
  'Assault w/ injury':'Physical altercation w/ Injury','Assault - Injury':'Physical altercation w/ Injury',
  'Detrimental Behavior - Assault - Injury':'Physical altercation w/ Injury',
  'Attack w/ Weapon':'Attack w/weapon','Attack with weapon':'Attack w/weapon','Assault w/ weapon':'Attack w/weapon',
  'Threat w/ Weapon':'Armed w/weapon','Threat with weapon':'Armed w/weapon','Weapon Present - Implied Threat':'Armed w/weapon',
  'Implied Threat w/ Weapon':'Armed w/weapon','Gun brandished':'Armed w/weapon','Weapon display':'Armed w/weapon','Weapon display w/o use':'Armed w/weapon',
  'Weapon Present':'Weapon present w/ no threat','Weapon present (no threat, 1st incident)':'Weapon present w/ no threat',
  'Weapon present (no threat':'Weapon present w/ no threat','Weapon present (Not pointed)':'Weapon present w/ no threat',
  'Weapon Present/No Threat':'Weapon present w/ no threat','Weapon presence':'Weapon present w/ no threat',
  'Weapon pointed':'Weapon pointed at driver',
  'Shooting':'Shots fired','Shooting - No Injury':'Shots fired','Shooting w/o Injury':'Shots fired',
  'Detrimental Behavior - Shooting - No Injury':'Shots fired','Driver Reported Firearm Discharged':'Shots fired','Shorts fired':'Shots fired',
  'Armed robbery':'Robbery w/ weapon',
  'Robbery':'Robbery w/o weapon','Theft/Robbery':'Robbery w/o weapon','Attempted robbery':'Robbery w/o weapon','Robbery Attempt':'Robbery w/o weapon',
  'Robbery w/o Injury':'Robbery w/o weapon','Robbery - No Injury':'Robbery w/o weapon','Robbery - Injury':'Robbery w/o weapon',
  'Detrimental Behavior - Robbery - No Injury':'Robbery w/o weapon','Assault / Robbery':'Robbery w/o weapon',
  'Threat w/o Weapon':'Threat of harm (verbal or written)','Verbal Threat':'Threat of harm (verbal or written)',
  'Verbal threats':'Threat of harm (verbal or written)','Threat of harm':'Threat of harm (verbal or written)',
  'Written threat':'Threat of harm (verbal or written)','Written Threats':'Threat of harm (verbal or written)','Threats - Verbal':'Threat of harm (verbal or written)',
  'Threats verbal':'Threat of harm (verbal or written)','Detrimental Behavior - Threats - Verbal':'Threat of harm (verbal or written)',
  'Verbal Harassment':'Verbal abuse','Verbal harrasment':'Verbal abuse','Verbal harassement':'Verbal abuse','Verbal harrassement':'Verbal abuse',
  'Harassment':'Verbal abuse','Harrasment':'Verbal abuse','Written Harassment':'Verbal abuse','Verbal Altercation':'Verbal abuse',
  'Yelling/Abusive Behavior':'Verbal abuse','Yelling Abusive Behavior':'Verbal abuse','Yelling & abusive behaviour':'Verbal abuse','Abusive Behavior':'Verbal abuse',
  'Abusive Behavior - Towards AMZN':'Verbal abuse','Detrimental Behavior - Abusive Behavior':'Verbal abuse',
  'Detrimental Behavior - Abusive Behavior - Towards AMZN':'Verbal abuse','Bullying':'Verbal abuse','Inappropriate notes':'Verbal abuse',
  'Harassment/Intimidation':'Intimidation','Harrasement Intimidation':'Intimidation','Harassment Intimidation':'Intimidation',
  'Discriminatory Harassment':'Name Calling','Inappropriate Racial Comments':'Name Calling','Racist Notes':'Name Calling',
  'Discrimination':'Name Calling','Racism':'Name Calling','Racist Harassment':'Name Calling',
  'Impending egress':'Impeding egress','Impeded Egress':'Impeding egress','Blocking driveway':'Impeding egress',
  'Impeding Egress - Towards AMZN':'Impeding egress','Detrimental Behavior - Impeding Egress - Towards AMZN':'Impeding egress',
  'Sexual Assault':'Sexual assault (physical)',
  'Sexual Harassment':'Sexual harassment (verbal)','Inappropriate Sexual Comments':'Sexual harassment (verbal)',
  'Transporter being followed':'Suspicious Following','Driver reporting being followed':'Suspicious Following'
};
var TSG_PZ_ALIAS={};
Object.keys(TSG_PZ_ALIASES).forEach(function(a){ var t=TSG_PZ_ALIASES[a];
  TSG_PZ_ALIAS[tsgNormKey(a)]=t.charAt(0)==='@'?{row:t.slice(1), type:null}:TSG_PZ_TYPE[tsgNormKey(t)]; });
var TSG_PZ_WEAPON_WORDS='(?:guns?|handguns?|firearms?|pistols?|rifles?|shotguns?|knife|knives|machete|weapons?|armed|gunpoint|knifepoint|brandish\\w*|taser|pepper spray|mace)';
var TSG_PZ_WEAPON_RE=new RegExp('\\b'+TSG_PZ_WEAPON_WORDS+'\\b');
function tsgKW(row,type,w,src){ return {row:row, type:type, w:w, re:new RegExp(src,'g')}; }
var TSG_PZ_RULES=[
  tsgKW('pet','Attack w/pet',9,'\\b(?:attack\\w*|assault\\w*)\\s+(?:with|w/)\\s*(?:a |the |their |his |her )?(?:pets?|dogs?|animals?)\\b|\\b(?:sic+ed|commanded|ordered|set)\\s+(?:the |their |his |her |a )?(?:pets?|dogs?)\\b'),
  tsgKW('pet','Unsecured pet - bite/injury',9,'\\bdog\\s*bites?\\b|\\bbit(?:e|es|ten)?\\s+by\\b|\\bbites?\\b|\\bbitten\\b|\\binjured by (?:a |the )?(?:dog|pet|animal)\\b'),
  tsgKW('pet','Unsecured pet - evasion injury',9,'\\bevasion\\b|\\bevad\\w*|\\b(?:fleeing|fled|escaping)\\b[^.]{0,40}\\b(?:dog|pet|animal)s?\\b'),
  tsgKW('pet','Unsecured pet - no contact',9,'\\bno contact\\b|\\b(?:dog|pet|animal)s?\\b[^.]{0,30}\\b(?:chas\\w*|charg\\w*|lung\\w*|bark\\w*)'),
  tsgKW('pet',null,9,'\\b(?:pets?|dogs?|pupp(?:y|ies)|canines?|k-?9s?|animals?)\\b'),
  tsgKW('notSpecified','Property / vehicle damage only',7,'\\b(?:package|parcel)s?\\s+(?:theft|stolen)\\b|\\btheft\\s*-?\\s*from\\s+(?:the |a )?vehicle\\b|\\bvehicle\\s+theft\\b|\\bstolen\\s+vehicle\\b'),
  tsgKW('notSpecified','Accidental injury (no POI)',7,'\\b(?:hit|struck)\\s+by\\s+(?:a |an |the )?(?:car|vehicle|truck|van)\\b|\\b(?:vehicle|traffic)\\s+(?:collision|accident)s?\\b'),
  tsgKW('robbery','Robbery w/o weapon',6,'\\b(?:robbery|robberies|robbed|robbing|rob|mugg(?:ed|ing)|stole|stolen|steal(?:s|ing)?|theft|carjack\\w*|snatch\\w*)\\b'),
  tsgKW('weapon','Shots fired',5,'\\bshots?\\b|\\bshoot(?:s|ing)?\\b|\\bshorts fired\\b|\\bfired\\b|\\bgunfire\\b|\\bgunshots?\\b|\\bdischarg\\w*'),
  tsgKW('weapon','Weapon pointed at driver',5,'\\b'+TSG_PZ_WEAPON_WORDS+'\\b[^.]{0,30}\\b(?:point|aim)\\w*|\\b(?:point|aim)\\w*\\b[^.]{0,30}\\b'+TSG_PZ_WEAPON_WORDS+'\\b'),
  tsgKW('weapon','Weapon present w/ no threat',5,'\\bweapons?\\s+(?:present|presence|seen|visible)\\b'),
  tsgKW('weapon','Attack w/weapon',5,'\\b(?:attack|assault|hit|struck|swung|swing|threw)\\w*\\s+(?:with|w/)\\s*(?:a |an )?(?:weapon|knife|gun|bat|pipe|bottle|rock|brick)s?\\b|\\bstabb?\\w*'),
  tsgKW('weapon','Armed w/weapon',5,'\\b'+TSG_PZ_WEAPON_WORDS+'\\b'),
  tsgKW('sexual','Sexual assault (physical)',4,'\\bsexual(?:ly)?\\s+assault\\w*|\\bgrop\\w*|\\bfondl\\w*|\\blewd\\b|\\bmasturbat\\w*'),
  tsgKW('sexual','Sexual harassment (verbal)',4,'\\bsexual(?:ly)?\\s+(?:harass\\w*|comment\\w*|remark\\w*|suggestive)|\\bsolicit\\w*|\\bcatcall\\w*|\\bsexist\\b'),
  tsgKW('sexual','Indecent exposure',4,'\\bindecent\\w*|\\bexpos(?:ed|ure|ing)\\b|\\bnaked\\b|\\bnude\\b|\\bnudity\\b|\\bflash(?:ed|ing)\\b'),
  tsgKW('sexual',null,4,'\\bsexual(?:ly)?\\b'),
  tsgKW('kidnap','Kidnapping',3,'\\bkidnap\\w*|\\babduct\\w*|\\bforced\\s+(?:in|into)\\s+(?:a |the |their |his |her )?(?:car|vehicle)\\b'),
  tsgKW('kidnap','Impeding egress',3,'\\bimped\\w*|\\bimpend\\w*\\s+egress\\b|\\begress\\b|\\bblock(?:ed|ing|s)?\\b|\\btrapped\\b|\\blocked\\s+in\\b|\\bdetain\\w*|\\bheld\\s+against\\b|\\b(?:would not|wouldn\'?t|did not|didn\'?t)\\s+let\\b'),
  tsgKW('physical','Fatality from assault',2,'\\bfatal\\w*|\\bdied\\b|\\bdeath\\b|\\bkilled\\b|\\bhomicide\\b'),
  tsgKW('physical','Physical altercation \u2013 No Injury',2,'\\b(?:no|without|w/o)\\s+injur\\w*'),
  tsgKW('physical',null,2,'\\bassault\\w*|\\bphysical(?:ly)?\\b|\\bpunch\\w*|\\bshov\\w*|\\bpush(?:ed|ing)?\\b|\\bslap\\w*|\\bkick\\w*|\\bspit(?:ting)?\\b|\\bspat\\b|\\bchok\\w*|\\btackl\\w*|\\bbeat(?:en| up)\\b|\\battack\\w*|\\bfight\\w*|\\bfought\\b|\\bhit\\b|\\bstruck\\b|\\bscuffle\\b'),
  tsgKW('verbal','Threat of harm (verbal or written)',1,'\\bthreat\\w*|\\bharm\\b|\\bkill you\\b'),
  tsgKW('verbal','Name Calling',1,'\\bname[-\\s]?call\\w*|\\bslurs?\\b|\\bracis\\w*|\\bracial\\w*|\\bdiscriminat\\w*|\\bhomophob\\w*|\\bbigot\\w*|\\bn-word\\b'),
  tsgKW('verbal','Intimidation',1,'\\bintimidat\\w*|\\bmenac\\w*'),
  tsgKW('verbal','Verbal abuse',1,'\\bverbal\\w*|\\bhar+as+\\w*|\\byell\\w*|\\bscream\\w*|\\bshout\\w*|\\bcurs(?:e|ed|es|ing)\\b|\\bprofan\\w*|\\babus\\w*|\\binsult\\w*|\\bbull(?:y|ied|ying)\\b|\\boffensive\\b|\\bswear\\w*'),
  tsgKW('verbal','Signage/Paraphernalia',1,'\\bsignage\\b|\\bsigns?\\b|\\bparaphernalia\\b|\\bswastikas?\\b|\\bnooses?\\b|\\bconfederate flags?\\b'),
  tsgKW('verbal','Vandalism',1,'\\bvandal\\w*|\\bdefac\\w*|\\bkeyed\\b|\\bslash(?:ed)?\\s+tires?\\b|\\bsmash\\w*|\\bthrew\\s+(?:a\\s+)?(?:rocks?|stones?|eggs?|bricks?)\\b|\\begg(?:ed|ing)\\b|\\b(?:purposely|intentionally|deliberately)\\s+damag\\w*'),
  tsgKW('notSpecified','Accidental injury (no POI)',0,'\\baccident\\w*|\\bslip(?:ped|s)?\\b|\\btrip(?:ped|ping)?\\b|\\bfell\\b|\\bfall(?:s|ing)?\\b|\\bmedical\\b|\\bcollision\\w*|\\bcrash\\w*|\\bsprain\\w*'),
  tsgKW('notSpecified','Property / vehicle damage only',0,'\\bproperty damage\\b|\\bvehicle damage\\b|\\bdamage only\\b|\\bdamag(?:e|ed|es)\\b'),
  tsgKW('notSpecified','Suspicious Following',0,'\\b(?:being|was|were|got|been|is|are|getting)\\s+followed\\b|\\bfollowed\\s+(?:by|the|me|him|her|them)\\b|\\bsuspicious\\s+follow\\w*|\\bfollowing\\s+(?:the |a |our )?(?:dp|da|driver|transporter|van|vehicle)s?\\b|\\bsurveil\\w*|\\btrail(?:ed|ing)\\b|\\bstalk\\w*|\\bfelt unsafe\\b|\\bsuspicious\\b'),
  tsgKW('verbal','Intimidation',-1,'\\baggressiv\\w*|\\bhostil\\w*|\\brude\\w*|\\bunprofessional\\b|\\binappropriate\\s+(?:conduct|behaviou?r)\\b|\\broad rage\\b|\\bconfront\\w*|\\bdetrimental\\s+behaviou?r\\b|\\bunprovoked\\b')
];
var TSG_PZ_REFINE=TSG_PZ_RULES.filter(function(r){ return r.type; }).concat([
  tsgKW('physical','Physical altercation w/ Injury',2,'\\binjur(?:y|ies|ed)\\b|\\bbleed\\w*|\\bbruis\\w*|\\bhospital\\w*|\\bconcuss\\w*')]);
var TSG_PZ_ROW_DEFAULT={pet:'Unsecured pet - no contact', physical:'Physical altercation \u2013 No Injury', sexual:'Sexual harassment (verbal)'};
var TSG_PZ_NOVALUE={'':1,'na':1,'n/a':1,'none':1,'null':1,'unknown':1,'notspecified':1,'nil':1};
function tsgPzNoValue(s){ return !!TSG_PZ_NOVALUE[tsgNormKey(s)]; }
function tsgPzKwScan(s, rules){
  var txt=' '+String(s||'').toLowerCase().replace(/\bnon[-\s]?pets?\b|\bno\s+pets?\b/g,' ')
    .replace(/\b(?:w\/o|w\/\s?out|without|no)\s+(?:a\s+|any\s+)?weapons?\b/g,' unarmed ')+' ';
  var best=null;
  (rules||TSG_PZ_RULES).forEach(function(r){
    r.re.lastIndex=0; var m;
    while((m=r.re.exec(txt))){
      var len=m[0].length;
      if(!best || r.w>best.w || (r.w===best.w && (len>best.len || (len===best.len && TSG_PZ_ORDER[r.row]<TSG_PZ_ORDER[best.row]))))
        best={row:r.row, type:r.type, w:r.w, len:len};
      if(!len) r.re.lastIndex++;
    }
  });
  if(best && best.row==='robbery' && TSG_PZ_WEAPON_RE.test(txt)) best.type='Robbery w/ weapon';
  return best;
}
// One text -> {row, type|null, weak} | null: exact type name > alias > keyword (last segment, then the whole text).
function tsgPzMatch(text){
  text=String(text==null?'':text).trim();
  if(tsgPzNoValue(text)) return null;
  var segs=text.split(TSG_SEG_SPLIT).map(function(x){ return x.trim(); }).filter(Boolean), cands=[text], k, h;
  for(k=1;k<=segs.length;k++){ var suf=segs.slice(-k).join(' - '); cands.push(suf, suf.replace(/^(?:non[-\s]?pet|pet)\s+(?=\S)/i,'')); }
  for(k=0;k<cands.length;k++){ h=TSG_PZ_TYPE[tsgNormKey(cands[k])]; if(h) return {row:h.row, type:h.type, weak:false}; }
  for(k=0;k<cands.length;k++){ h=TSG_PZ_ALIAS[tsgNormKey(cands[k])]; if(h) return {row:h.row, type:h.type, weak:false}; }
  if(!segs.length) return null;
  var a=tsgPzKwScan(segs[segs.length-1]); if(a && a.w>=0) return {row:a.row, type:a.type, weak:false};
  var b=segs.length>1?tsgPzKwScan(segs.join(' - ')):null; if(b && b.w>=0) return {row:b.row, type:b.type, weak:false};
  h=a||b; return h?{row:h.row, type:h.type, weak:true}:null;
}
// Issue value + the title's issue part -> the list spelling of the closest type, '' when nothing maps.
function tsgSuggest(issueLine, titleIssue, cats){
  var mi=tsgPzMatch(issueLine), mt=tsgPzMatch(titleIssue), pick=null, texts=[];
  if(mi && !mi.weak){ pick=mi; texts=[issueLine,titleIssue]; }
  else if(mt && !mt.weak){ pick=mt; texts=[titleIssue,issueLine]; }
  else if(mi){ pick=mi; texts=[issueLine,titleIssue]; }
  else if(mt){ pick=mt; texts=[titleIssue,issueLine]; }
  if(!pick) return '';
  var type=pick.type;
  if(!type){
    var rules=TSG_PZ_REFINE.filter(function(r){ return r.row===pick.row; });
    for(var i=0;i<texts.length && !type;i++){ if(tsgPzNoValue(texts[i])) continue; var h=tsgPzKwScan(texts[i],rules); if(h && h.type) type=h.type; }
    if(!type) type=TSG_PZ_ROW_DEFAULT[pick.row]||(TSG_PZ_TYPES[pick.row]||[])[0]||'';
  }
  return tsgMatchIssue(type,cats);
}
// Issue: an EXACT list option (trimmed, case-insensitive) from the "Issue:" value, else from the title's issue part.
// Otherwise issue '' and a suggestion (shown as a chip, never applied automatically).
function tsgParseIssue(raw, cats, tp){
  var line=tsgGrab(raw,['Issue']);
  tp=tp||tsgParseTitle(tsgTitleLine(raw));
  var hit=tsgMatchIssue(line,cats);
  if(hit) return {issue:hit, src:'Issue line', rawIssue:line, suggest:''};
  var hit2=tsgMatchIssue(tp.issue,cats);
  if(hit2) return {issue:hit2, src:'SIM title', rawIssue:line||tp.issue, suggest:''};
  return {issue:'', src:'', rawIssue:line||tp.issue, suggest:tsgSuggest(line,tp.issue,cats)};
}
// Incident Date -> "YYYY-MM-DD" for tsgFmtDate when it is one of the SIM spellings
// ("2026-06-12 at 7:54AM EDT", "24-MAR-26", "30-MAR-26 / 02:38 PM CEST", "6 June 2026", "June 9, 2026", "Jun 7, 2026 6:18 AM").
// Anything else is passed through unchanged (tsgFmtDate's own rules).
var TSG_MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function tsgNormDate(v){
  var s=String(v==null?'':v).trim().replace(/^[:\s]+/,''), m, mo;
  var ymd=function(y,mon,d){ y=+y; if(y<100) y+=2000; d=+d; return (mon && d>=1 && d<=31)?(y+'-'+String(mon).padStart(2,'0')+'-'+String(d).padStart(2,'0')):s; };
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/))) return ymd(m[1],(+m[2]>=1&&+m[2]<=12)?+m[2]:0,m[3]);
  if((m=s.match(/^(\d{1,2})[\s\-.\/]*([A-Za-z]{3,9})\.?[\s\-.\/,]*(\d{4}|\d{2})(?!\d)/)) && (mo=TSG_MON[m[2].slice(0,3).toLowerCase()])) return ymd(m[3],mo,m[1]);
  if((m=s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/)) && (mo=TSG_MON[m[1].slice(0,3).toLowerCase()])) return ymd(m[3],mo,m[2]);
  return s;
}
// Several tickets in one paste: split at separator lines of 5+ "=" and before every further SIM title line
// ("<CC> ... Incident Escalation ..."). -> [{title, text}] (at least one entry).
function tsgIsTitle(line){ return !!tsgLeadCode(line) && /incident\s+escalation/i.test(line); }
function tsgSplitTickets(raw){
  var lines=String(raw==null?'':raw).split(/\r?\n/), out=[], cur=[], seen=false;
  var flush=function(){ var t=cur.join('\n'); if(t.trim()) out.push({title:tsgTitleLine(t), text:t}); cur=[]; seen=false; };
  lines.forEach(function(l){
    if(/^\s*={5,}\s*$/.test(l)){ flush(); return; }
    if(l.trim()){ if(seen && tsgIsTitle(l)) flush(); seen=true; }
    cur.push(l);
  });
  flush();
  return out.length?out:[{title:'', text:String(raw==null?'':raw)}];
}
// Keys that are read but not used for the outputs (shown as "ignored" in "What was read").
var TSG_READ_IGNORED=[['Tracking ID',['Tracking ID','Related Tracking ID','TBA']],['Contact ID',['Contact ID','Contact Id']],
  ['Account Suspension Tag',['Account Suspension Tag']],['EMT Link',['EMT Link (if applicable)','EMT Link']]];
// One ticket's text -> prefill values + the builder's RCD fields + the "What was read" rows.
function tsgParse(raw, cats){
  var title=tsgTitleLine(raw), tp=tsgParseTitle(title);
  var sev=tsgParseSev(raw,tp), iss=tsgParseIssue(raw,cats,tp);
  // Customer / Community Member: a valid Customer Account ID; else the title's "Account ID: <valid>" when the title says Customer;
  // "CM" in the Account ID line = Community Member; a Customer title with no valid ID = Customer + empty (required) Account ID.
  var aidInfo=tsgGrabInfo(raw,TSG_AID_KEYS), fAid=aidInfo.value.toUpperCase(), party, aid='', aidSrc='', partyHint='';
  if(tsgValidAid(fAid)){ party='Customer'; aid=fAid; aidSrc='Customer Account ID line'; }
  else if(tp.party==='Customer' && tp.aid){ party='Customer'; aid=tp.aid; aidSrc='SIM title'; }
  else if(/^(?:cm|community\s*member)$/i.test(aidInfo.value)){ party='Community Member'; partyHint='cm'; }
  else if(tp.party==='Customer'){ party='Customer'; partyHint='noaid'; }
  else party='Community Member';
  var fields={}, cnt='', read=[{k:'SIM title', v:title, st:title?'used':'missing'}];
  read.push({k:'Severity', v:sev.raw, o:sev.sev?('Sev '+sev.sev+(sev.tag==='noemt'?' (No EMT)':'')+(sev.src==='SIM title'?' from the SIM title':'')):'', st:sev.raw?'used':'missing'});
  var issLine=tsgGrab(raw,['Issue']);
  read.push({k:'Issue', v:issLine, o:iss.issue?(iss.issue+(iss.src==='SIM title'?' (from the SIM title)':'')):(issLine?'not an Issue Types option':''), st:issLine?'used':'missing'});
  TSG_RC_FIELDS.forEach(function(f){
    var gi=tsgGrabInfo(raw,f[1]), v=gi.value, out=v;
    if(f[0]==='Date' && v) out=tsgFmtDate(tsgNormDate(v));
    if(f[0]==='TID' && v) out=v.split(/[\s\/,;|]+/)[0];
    if(f[0]==='Cnt') cnt=v;
    fields[f[0]]=out;
    read.push({k:gi.key||f[1][0], v:v, o:(out!==v)?out:'', st:v?'used':(gi.found?'empty':'missing')});
  });
  TSG_READ_IGNORED.forEach(function(x){ var gi=tsgGrabInfo(raw,x[1]); if(gi.found) read.push({k:gi.key, v:gi.value, st:'ignored'}); });
  var hi=[]; for(var n=1;n<=TSG_HI_MAX;n++) hi.push(tsgMatchIssue(tsgGrab(raw,['HI'+n]),cats));
  return {country:tp.country, title:title, party:party, aid:aid, aidSrc:aidSrc, partyHint:partyHint,
    sev:sev.sev, sevSrc:sev.src, sevTag:sev.tag, issue:iss.issue, issueSrc:iss.src, rawIssue:iss.rawIssue, suggest:iss.suggest,
    fields:fields, cnt:cnt, hi:hi, read:read, ignoredLines:tsgScan(raw).ignored};
}
// Title + its checklist. o = {country, party, aid, sev, issue, cats}.
function tsgBuildTitle(o){
  var cc=tsgCountryCode(o.country), sev=/^[1-5]$/.test(String(o.sev||''))?String(o.sev):'';
  var issue=tsgMatchIssue(o.issue,o.cats), cx=o.party==='Customer', aid=String(o.aid||'').trim().toUpperCase();
  var aidOk=!cx || tsgValidAid(aid);
  var checks=[
    {key:'country', ok:!!cc, label:cc?('Valid country code ('+cc+')'):'Valid country code', miss:'select a country'},
    {key:'sev', ok:!!sev, label:sev?('Severity (Sev '+sev+')'):'Severity', miss:'select a severity'},
    {key:'issue', ok:!!issue, label:issue?('Valid issue type ('+issue+')'):'Valid issue type', miss:'select an issue type'},
    {key:'party', ok:(o.party==='Customer'||o.party==='Community Member') && aidOk,
      label:cx?('CX \u00b7 Customer'+(aidOk?(' with Account ID '+aid):' \u2014 Account ID needed')):'CM \u00b7 Community Member',
      miss:cx?'enter a valid Account ID (A + 8\u201320 letters/digits)':'choose Customer or Community Member'}
  ];
  var ok=checks.every(function(c){ return c.ok; });
  var text=(cc||'<CC>')+' '+(cx?('Customer Incident Escalation - Account ID: '+(aid||'<Account ID>')):'Community Member Incident Escalation')+
    ' - Sev '+(sev||'<N>')+' - '+(issue||'<Issue type>');
  return {text:text, ok:ok, checks:checks, miss:checks.filter(function(c){ return !c.ok; }).map(function(c){ return c.miss; })};
}
// SIM Root Cause Details: the builder's lines / order / N/A rules. o = {issue, res, fields, hi:[...], hasInput}.
function tsgBuildRcd(o){
  var issue=String(o.issue||''), res=String(o.res||''), f=o.fields||{}, hi=o.hi||[];
  var lines=['Issue: '+issue], drivOk=true;
  TSG_RC_FIELDS.forEach(function(d){ var out=(f[d[0]]||'N/A'); if(d[0]==='Driv' && out==='N/A') drivOk=false; lines.push(d[0]+': '+out); });
  lines.push('Res: '+res);
  hi.forEach(function(v,i){ lines.push('HI'+(i+1)+': '+(v||'')); });
  var hiOk=hi.every(function(v){ return !!v; });
  var miss=[];
  if(!o.hasInput) miss.push('paste the SIM ticket text');
  if(!issue) miss.push('select a valid Issue');
  if(!res) miss.push('select a Resolution');
  if(!drivOk) miss.push('add the Driver Type');
  if(!hiOk) miss.push('select an issue type for every historical incident (HI)');
  return {text:lines.join('\n'), ok:!miss.length, drivOk:drivOk, miss:miss};
}
/* TSG-PURE-END */

// ---- "Update tickets data" (owner only): upload cleaned ticket CSVs -> update existing tickets ----
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
      '<p class="tbl-sub" id="tsUpdSub">Upload cleaned ticket CSVs. Existing tickets are matched by ShortId; only changed, non-blank cells are written.</p></div>'+
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

// ---- "Generate Title and Root Cause Details" pop-up (every logged-in user; front end only, nothing is saved) ----
// Left: the pasted SIM page. Right: controls prefilled from the paste + the two outputs, updated live (debounced).
// Pure parse / generate helpers: the TSG-PURE block above (copied from tool-rcd.html).
// G = {touched:{country,party,aid,sev,issue}, sevDefault, p (last parse), timer}; null while closed.
var G=null;
function tsgCats(){ return window.IZ_CATS||[]; }
function tsgEl(id){ return document.getElementById(id); }
function tsgIssueOpts(ph){
  var h='<option value="">'+esc(ph)+'</option>';
  tsgCats().forEach(function(cat){ h+='<optgroup label="'+esc(cat.category)+'">';
    (cat.types||[]).forEach(function(t){ h+='<option value="'+esc(t.type)+'">'+esc(t.type)+'</option>'; });
    h+='</optgroup>'; });
  return h;
}
function tsgDialogHtml(){
  var cOpts='<option value="">\u2014 Select a country \u2014</option>'+TSG_COUNTRIES.map(function(c){ return '<option value="'+esc(c.code)+'">'+esc(c.code+' \u00b7 '+c.name)+'</option>'; }).join('');
  var rOpts='<option value="">\u2014 Select resolution \u2014</option>';
  for(var i=1;i<TSG_RESLIST.length;i++) rOpts+='<option value="'+i+'">'+String(i).padStart(2,'0')+'. '+esc(TSG_RESLIST[i])+'</option>';
  var sevs=''; for(var n=1;n<=5;n++) sevs+='<button type="button" class="tsg-sevb" data-tsgsev="'+n+'" aria-pressed="false" aria-label="Severity '+n+'">'+n+'</button>';
  return '<div class="tbl-card" role="dialog" aria-modal="true" aria-labelledby="tsGenT" aria-describedby="tsGenSub">'+
    '<div class="tbl-head"><span class="tbl-head-ic" aria-hidden="true">'+ic('clipboard',20)+'</span>'+
      '<div class="tbl-head-tx"><div class="tbl-eyebrow">Ticket Sanitization \u00b7 Generator</div><h2 class="tbl-title" id="tsGenT">Generate Title and Root Cause Details</h2></div>'+
      '<button type="button" class="tbl-x" data-tsgx="1" aria-label="Close">'+ic('close',18)+'</button>'+
      '<p class="tbl-sub" id="tsGenSub">Paste the whole SIM ticket page. The SIM Title and SIM Root Cause Details update as you paste or change a value. Nothing is saved.</p></div>'+
    '<div class="tbl-body"><div class="tsg-grid">'+
      '<div class="tsg-left">'+
        '<label class="tbl-label" for="tsgRaw">Paste the SIM ticket text</label>'+
        '<textarea id="tsgRaw" class="tsg-raw" spellcheck="false" aria-describedby="tsgRawHint" placeholder="US Customer Incident Escalation - Severity 5&#10;&#8230;&#10;Severity: 5&#10;Issue: Verbal abuse&#10;Station ID: DIP1&#10;Driver Type: Flex DP&#10;Incident Date: 2026-06-09&#10;Customer Account ID: A2BE6RJDLHJ794&#10;&#8230;"></textarea>'+
        '<div class="tsg-multi" id="tsgMulti" hidden><p class="tsg-note is-warn" id="tsgMultiN" role="status"></p>'+
          '<label class="tsg-lbl" for="tsgTicket">Ticket to use</label><select id="tsgTicket" class="tsg-sel"></select></div>'+
        '<p class="tsg-hint" id="tsgRawHint">The first line is read as the SIM title. Keys are read only at the start of a line; UI text and the incident summary are ignored; missing keys become N/A.</p>'+
        '<div class="tsg-left-acts"><button type="button" class="tsg-ghost" data-tsgclear="1">Clear</button></div>'+
      '</div>'+
      '<div class="tsg-right">'+
        '<div class="tsg-ctls">'+
          '<div class="tsg-f"><label class="tsg-lbl" for="tsgCountry" id="tsgCountryL">Country <span class="tsg-req" aria-hidden="true">*</span></label>'+
            '<select id="tsgCountry" class="tsg-sel" aria-required="true" aria-describedby="tsgCountryN">'+cOpts+'</select><p class="tsg-note" id="tsgCountryN"></p></div>'+
          '<div class="tsg-f"><label class="tsg-lbl" for="tsgParty">Customer / Community Member</label>'+
            '<select id="tsgParty" class="tsg-sel" aria-describedby="tsgPartyN"><option value="Customer">Customer</option><option value="Community Member">Community Member</option></select><p class="tsg-note" id="tsgPartyN"></p></div>'+
          '<div class="tsg-f" id="tsgAidF" hidden><label class="tsg-lbl" for="tsgAid">Account ID <span class="tsg-req" aria-hidden="true">*</span></label>'+
            '<input type="text" id="tsgAid" class="tsg-in" autocomplete="off" spellcheck="false" aria-required="true" aria-describedby="tsgAidN" placeholder="e.g. A2BE6RJDLHJ794"><p class="tsg-note" id="tsgAidN"></p></div>'+
          '<div class="tsg-f"><span class="tsg-lbl" id="tsgSevL">Severity <span class="tsg-def" id="tsgSevDef" hidden>Default</span></span>'+
            '<div class="tsg-sevs" role="group" aria-labelledby="tsgSevL" aria-describedby="tsgSevN">'+sevs+'</div><p class="tsg-note" id="tsgSevN"></p></div>'+
          '<div class="tsg-f is-wide"><label class="tsg-lbl" for="tsgIssue" id="tsgIssueL">Issue type <span class="tsg-req" aria-hidden="true">*</span></label>'+
            '<select id="tsgIssue" class="tsg-sel" aria-required="true" aria-describedby="tsgIssueN">'+tsgIssueOpts('Select an issue type')+'</select><p class="tsg-note" id="tsgIssueN"></p><div class="tsg-sug" id="tsgIssueSug"></div></div>'+
          '<div class="tsg-f is-wide"><label class="tsg-lbl" for="tsgRes" id="tsgResL">Resolution <span class="tsg-req" aria-hidden="true">*</span></label>'+
            '<select id="tsgRes" class="tsg-sel" aria-required="true">'+rOpts+'</select></div>'+
          '<div class="tsg-hi" id="tsgHi" role="group" aria-labelledby="tsgHiT" hidden>'+
            '<p class="tsg-hi-t" id="tsgHiT">Historical incidents <span class="tsg-hi-n" id="tsgHiN"></span></p>'+
            '<p class="tsg-hi-warn" id="tsgHiWarn" role="status" hidden></p><div class="tsg-hi-f" id="tsgHiF"></div></div>'+
        '</div>'+
        '<details class="tsg-read" id="tsgRead" open><summary>What was read</summary><dl class="tsg-read-l" id="tsgReadL"></dl><p class="tsg-read-x" id="tsgReadX"></p></details>'+
        '<section class="tsg-out-sec" aria-labelledby="tsgTitleH">'+
          '<div class="tsg-out-h"><h3 id="tsgTitleH">Title</h3><button type="button" class="tsg-copy" id="tsgCopyTitle" data-tsgcopy="title" disabled>'+ic('copy',14)+'<span>Copy title</span></button></div>'+
          '<pre class="tsg-out" id="tsgTitleOut" aria-live="polite" aria-atomic="true"></pre>'+
          '<ul class="tsg-chk" id="tsgTitleChk" aria-label="Title checklist"></ul>'+
          '<p class="tsg-msg" id="tsgTitleMsg" role="status"></p>'+
        '</section>'+
        '<section class="tsg-out-sec" aria-labelledby="tsgRcdH">'+
          '<div class="tsg-out-h"><h3 id="tsgRcdH">SIM Root Cause Details</h3><button type="button" class="tsg-copy" id="tsgCopyRcd" data-tsgcopy="rcd" disabled>'+ic('copy',14)+'<span>Copy RCD</span></button></div>'+
          '<pre class="tsg-out" id="tsgRcdOut" aria-live="polite" aria-atomic="true"></pre>'+
          '<p class="tsg-err" id="tsgDrivErr" role="alert"></p>'+
          '<p class="tsg-msg" id="tsgRcdMsg" role="status"></p>'+
        '</section>'+
        '<div class="tsg-both"><p class="tsg-msg" id="tsgBothMsg" role="status" style="margin:0"></p>'+
          '<button type="button" class="tsg-copy" id="tsgCopyBoth" data-tsgcopy="both" disabled>'+ic('copy',14)+'<span>Copy both</span></button></div>'+
      '</div>'+
    '</div></div></div>';
}
function tsgSS(sel){ if(sel && window.makeSearchableSelect) window.makeSearchableSelect(sel); }
// Give the visible combobox button the field's accessible name / description.
function tsgSSLabel(sel,lblId,descId){
  if(!sel||!sel._ssField) return;
  // Name = the label + the button's own text (the current value).
  sel._ssField.id=sel.id+'SS';
  sel._ssField.setAttribute('aria-labelledby',lblId+' '+sel._ssField.id); sel._ssField.setAttribute('aria-haspopup','listbox');
  if(descId) sel._ssField.setAttribute('aria-describedby',descId);
}
function tsGenOpen(){
  if(!(A&&A.getUser&&A.getUser())) return;
  tsGenClose(true);
  G={touched:{}, sevDefault:true, sevTag:'default', p:tsgParse('',tsgCats()), timer:null, tk:0, tkSig:null};
  var ov=document.createElement('div'); ov.id='tsGenDlg'; ov.className='tbl-bg'; ov.style.cssText='display:flex;z-index:5000';
  ov.innerHTML=tsgDialogHtml();
  ov.addEventListener('click',function(e){ if(e.target===ov) tsGenClose(); });
  // Esc while a searchable dropdown is open closes only that dropdown (runs before the page / dialog Esc handlers).
  ov.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var open=ov.querySelector('.ss-wrap.open'); if(!open) return;
    e.stopPropagation(); e.preventDefault();
    document.body.click();   // the enhancer closes its pop-up on any click outside it
    var f=open.querySelector('.ss-field'); if(f) f.focus();
  },true);
  document.body.appendChild(ov);
  [['tsgCountry','tsgCountryL','tsgCountryN'],['tsgIssue','tsgIssueL','tsgIssueN'],['tsgRes','tsgResL','']].forEach(function(x){ var s=tsgEl(x[0]); tsgSS(s); tsgSSLabel(s,x[1],x[2]); });
  tsgEl('tsgParty').value='Community Member';
  if(window.PHDLoginUI) window.PHDLoginUI.opened(ov,function(){ tsGenClose(); },tsgEl('tsgRaw'));
  else setTimeout(function(){ var t=tsgEl('tsgRaw'); if(t) t.focus(); },40);
  tsgRender(true);
}
window.tsGenOpen=tsGenOpen;
function tsGenClose(silent){
  var ov=document.getElementById('tsGenDlg'); if(!ov) return;
  if(ov.querySelector('.ss-wrap.open')) document.body.click();
  if(G&&G.timer) clearTimeout(G.timer);
  G=null; ov.remove();
  if(window.PHDLoginUI) window.PHDLoginUI.closed(ov);
  if(!silent && (!document.activeElement||document.activeElement===document.body)){ var b=document.getElementById('tsGenBtn'); if(b) b.focus(); }
}
window.tsGenClose=tsGenClose;
// Apply the parse to every control the user has not changed yet.
function tsgPrefill(p){
  var t=G.touched;
  if(!t.country){ tsgEl('tsgCountry').value=p.country||''; tsgSS(tsgEl('tsgCountry')); }
  if(!t.party) tsgEl('tsgParty').value=p.party;
  if(!t.aid) tsgEl('tsgAid').value=p.aid||'';
  if(!t.sev){ G.sev=p.sev||'5'; G.sevTag=p.sev?(p.sevTag||''):'default'; G.sevDefault=G.sevTag==='default'; }
  if(!t.issue){ tsgEl('tsgIssue').value=p.issue||''; tsgSS(tsgEl('tsgIssue')); }
}
// HI1..HIN pickers for the parsed Cnt (same rules as tool-rcd.html rcSyncHi): keep the chosen values of the
// indexes that remain; a new / still-empty field takes the paste's "HIn: <type>" when it is a list option.
function tsgSyncHi(cntVal, p, fromRaw, hasInput){
  var block=tsgEl('tsgHi'), box=tsgEl('tsgHiF'); if(!block||!box) return [];
  var c=tsgHiCountOf(cntVal);
  var rows=box.querySelectorAll('[data-tsghi]');
  for(var r=rows.length-1;r>=c.n;r--) rows[r].parentNode.removeChild(rows[r]);
  for(var i=box.children.length+1;i<=c.n;i++){
    var row=document.createElement('div'); row.className='tsg-f'; row.setAttribute('data-tsghi',String(i));
    row.innerHTML='<label class="tsg-lbl" for="tsgHi'+i+'" id="tsgHiL'+i+'">HI'+i+': Issue type <span class="tsg-req" aria-hidden="true">*</span></label>'+
      '<select id="tsgHi'+i+'" class="tsg-sel" aria-required="true" aria-describedby="tsgHiE'+i+'">'+tsgIssueOpts('\u2014 Select issue type \u2014')+'</select>'+
      '<p class="tsg-hi-err" id="tsgHiE'+i+'"></p>';
    box.appendChild(row);
    var sel=row.querySelector('select'); sel._tsgNew=true; tsgSS(sel); tsgSSLabel(sel,'tsgHiL'+i,'tsgHiE'+i);
  }
  var vals=[];
  Array.prototype.forEach.call(box.querySelectorAll('select'),function(sel,idx){
    var n=idx+1;
    if((fromRaw||sel._tsgNew) && !sel.value && p.hi[idx]) sel.value=p.hi[idx];
    sel._tsgNew=false; tsgSS(sel);
    vals.push(sel.value||'');
    var bad=hasInput && !sel.value, err=tsgEl('tsgHiE'+n);
    if(err) err.textContent=bad?('Select an issue type for HI'+n+'.'):'';
    sel.setAttribute('aria-invalid',bad?'true':'false');
    if(sel._ssField) sel._ssField.setAttribute('aria-invalid',bad?'true':'false');
  });
  block.hidden=!c.n;
  tsgEl('tsgHiN').textContent=c.n?('Cnt '+String(cntVal).trim()):'';
  var w=tsgEl('tsgHiWarn'); w.hidden=!c.over; w.textContent=c.over?'Cnt over 9 \u2014 only 9 historical incidents can be listed':'';
  return vals;
}
function tsgNote(id,text,warn){ var el=tsgEl(id); if(!el) return; el.textContent=text||''; el.classList.toggle('is-warn',!!warn); }
function tsgSetCopy(id,ok){ var b=tsgEl(id); if(b){ b.disabled=!ok; b.setAttribute('aria-disabled',ok?'false':'true'); } }
function tsgMissText(miss){ return miss.length?('Copy disabled \u2014 please '+miss.join(' and ')+'.'):''; }
// fromRaw = the paste changed (re-parse + prefill untouched controls).
function tsgRender(fromRaw){
  if(!G||!tsgEl('tsgRaw')) return;
  var raw=String(tsgEl('tsgRaw').value||''), hasInput=!!raw.trim(), cats=tsgCats();
  if(fromRaw){
    if(!hasInput) G.touched={};   // an emptied paste starts over
    // Several tickets (==== separators / several SIM title lines): parse only the picked one.
    var tk=tsgSplitTickets(raw), sig=tk.map(function(x){ return x.title; }).join('\n');
    if(sig!==G.tkSig || !(G.tk>=0 && G.tk<tk.length)) G.tk=0;   // a different set of tickets starts at the first one
    if(sig!==G.tkSig){
      G.tkSig=sig;
      tsgEl('tsgTicket').innerHTML=tk.map(function(x,i){ return '<option value="'+i+'">'+esc((i+1)+'. '+(x.title||'(no title line)'))+'</option>'; }).join('');
    }
    tsgEl('tsgTicket').value=String(G.tk);
    tsgEl('tsgMulti').hidden=tk.length<2;
    tsgEl('tsgMultiN').textContent=tk.length<2?'':(tk.length+' tickets detected \u2014 '+(G.tk?('using ticket '+(G.tk+1)):'using the first one'));
    G.p=tsgParse(tk[G.tk].text,cats); tsgPrefill(G.p);
  }
  var p=G.p, t=G.touched;
  var country=tsgEl('tsgCountry').value, party=tsgEl('tsgParty').value, aid=String(tsgEl('tsgAid').value||'').trim().toUpperCase();
  var issue=tsgEl('tsgIssue').value, resN=tsgEl('tsgRes').value, res=(resN&&TSG_RESLIST[+resN])?TSG_RESLIST[+resN]:'';
  var cx=party==='Customer';
  // Notes under the controls (which source prefilled what).
  tsgNote('tsgCountryN', t.country?'':(p.country?'From the SIM title':(hasInput?'No country code at the start of the SIM title \u2014 select a country.':'')), !t.country&&!p.country&&hasInput);
  var pNote='', pWarn=false;
  if(!t.party && hasInput){
    if(p.aid) pNote=p.aidSrc==='SIM title'?'Customer \u2014 Account ID from the SIM title':'Customer Account ID found in the paste';
    else if(p.partyHint==='noaid'){ pNote='No valid Customer Account ID found \u2014 pick Community Member or enter the ID'; pWarn=true; }
    else if(p.partyHint==='cm') pNote='The Customer Account ID line says CM';
    else pNote='No valid Customer Account ID in the paste';
  }
  tsgNote('tsgPartyN', pNote, pWarn);
  tsgEl('tsgAidF').hidden=!cx;
  var aidOk=tsgValidAid(aid);
  tsgEl('tsgAid').setAttribute('aria-invalid',(cx&&!aidOk)?'true':'false');
  tsgNote('tsgAidN', aidOk?(t.aid?'':(p.aid?('From the '+(p.aidSrc||'Customer Account ID line')):'')):'Required: A followed by 8\u201320 letters or digits.', !aidOk);
  Array.prototype.forEach.call(document.querySelectorAll('#tsGenDlg [data-tsgsev]'),function(b){ b.setAttribute('aria-pressed',b.getAttribute('data-tsgsev')===G.sev?'true':'false'); });
  var sevTag=t.sev?'':(G.sevTag||''), sdef=tsgEl('tsgSevDef');
  sdef.hidden=!sevTag; sdef.textContent=sevTag==='noemt'?'No EMT \u2192 Sev 5':'Default'; sdef.classList.toggle('is-emt',sevTag==='noemt');
  tsgNote('tsgSevN', t.sev?'':(sevTag==='default'?'No severity found \u2014 using 5 by default.':
    (sevTag==='noemt'?('No EMT in the '+(p.sevSrc==='SIM title'?'SIM title':'Severity line')+' \u2014 Severity 5 (sanitization checklist).'):('From the '+p.sevSrc))), sevTag==='default');
  var iNote='';
  if(!t.issue){
    if(p.issue) iNote='Matched from the '+(p.issueSrc==='SIM title'?'SIM title':'Issue: line')+' ('+p.issue+')';
    else if(p.rawIssue) iNote='\u201c'+p.rawIssue+'\u201d is not in the Issue Types list \u2014 select an issue type.';
    else if(hasInput) iNote='No issue type found \u2014 select an issue type.';
  }
  tsgNote('tsgIssueN', iNote, !issue);
  // Suggestion chip: only while no issue type is selected; applied only on click.
  tsgEl('tsgIssueSug').innerHTML=(hasInput && !issue)?(p.suggest?
    ('<button type="button" class="tsg-chip" data-tsgsug="'+esc(p.suggest)+'" aria-label="Apply suggested issue type: '+esc(p.suggest)+'">Suggested: '+esc(p.suggest)+'</button>'):
    '<span class="tsg-nosug">No suggestion</span>'):'';
  // "What was read": key -> value as parsed (-> what the outputs use), ignored / not found keys.
  var ST={missing:'not found', empty:'empty', ignored:'ignored (not used)'};
  tsgEl('tsgRead').hidden=!hasInput;
  tsgEl('tsgReadL').innerHTML=hasInput?p.read.map(function(r){
    var v=String(r.v||''); if(v.length>90) v=v.slice(0,87)+'\u2026';
    return '<dt>'+esc(r.k)+'</dt><dd>'+(v?esc(v):'')+(r.st!=='used'?((v?' ':'')+'<span class="tsg-rd-st">'+esc(v&&r.st==='ignored'?'(ignored)':ST[r.st]||'')+'</span>'):'')+
      (r.o?' <span class="tsg-rd-o">\u2192 '+esc(r.o)+'</span>':'')+'</dd>';
  }).join(''):'';
  tsgEl('tsgReadX').textContent=hasInput?(p.ignoredLines+' other line'+(p.ignoredLines===1?'':'s')+' ignored (SIM page UI text, summary, notes, links).'):'';
  var issueSel=tsgEl('tsgIssue'); issueSel.setAttribute('aria-invalid',(hasInput&&!issue)?'true':'false'); if(issueSel._ssField) issueSel._ssField.setAttribute('aria-invalid',(hasInput&&!issue)?'true':'false');
  var hi=tsgSyncHi(hasInput?p.cnt:'', p, !!fromRaw, hasInput);
  // A) Title
  var T=tsgBuildTitle({country:country, party:party, aid:aid, sev:G.sev, issue:issue, cats:cats});
  var to=tsgEl('tsgTitleOut'); to.textContent=T.text; to.classList.toggle('is-ph',!T.ok);
  tsgEl('tsgTitleChk').innerHTML=T.checks.map(function(c){
    return '<li class="'+(c.ok?'is-ok':'is-bad')+'"><span class="tsg-tick" aria-hidden="true">'+ic(c.ok?'check':'close',11)+'</span>'+esc(c.label)+'<span class="ts-sr">'+(c.ok?' \u2014 done':' \u2014 missing')+'</span></li>';
  }).join('');
  tsgEl('tsgTitleMsg').textContent=tsgMissText(T.miss);
  tsgSetCopy('tsgCopyTitle',T.ok);
  // B) SIM Root Cause Details (builder format + gating)
  var R=tsgBuildRcd({issue:issue, res:res, fields:p.fields, hi:hi, hasInput:hasInput});
  var ro=tsgEl('tsgRcdOut'); ro.textContent=hasInput?R.text:'Paste the SIM ticket text to generate the SIM Root Cause Details.'; ro.classList.toggle('is-ph',!R.ok);
  tsgEl('tsgDrivErr').textContent=(hasInput&&!R.drivOk)?'Driver Type is missing (Driv: N/A). Add the Driver Type to the pasted details before copying.':'';
  tsgEl('tsgRcdMsg').textContent=tsgMissText(R.miss);
  tsgSetCopy('tsgCopyRcd',R.ok);
  var both=T.ok&&R.ok;
  tsgEl('tsgBothMsg').textContent=both?'':'Copy both needs the title and the SIM Root Cause Details to be complete.';
  tsgSetCopy('tsgCopyBoth',both);
  G.out={title:T.text, rcd:R.text};
}
function tsgSchedule(fromRaw){
  if(!G) return;
  if(fromRaw) G.rawDirty=true;
  if(G.timer) clearTimeout(G.timer);
  G.timer=setTimeout(function(){ if(!G) return; G.timer=null; var d=!!G.rawDirty; G.rawDirty=false; tsgRender(d); },180);
}
function tsgCopy(kind,btn){
  if(!G||!G.out||!btn||btn.disabled) return;
  var txt=kind==='title'?G.out.title:(kind==='rcd'?G.out.rcd:(G.out.title+'\n\n'+G.out.rcd));
  var lbl=btn.querySelector('span'), orig=lbl?lbl.textContent:'';
  var done=function(ok){
    announce(ok?'Copied to the clipboard':'Copy failed');
    if(!lbl) return; lbl.textContent=ok?'Copied':'Copy failed'; btn.classList.toggle('is-done',!!ok);
    setTimeout(function(){ lbl.textContent=orig; btn.classList.remove('is-done'); },1400);
    if(btn.isConnected && document.activeElement!==btn) btn.focus();   // the copy fallback borrows focus
  };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function(){done(true);},function(){copyFallback(txt,done);});
  else copyFallback(txt,done);
}
document.addEventListener('input',function(ev){
  var el=ev.target; if(!G||!el||!el.closest||!el.closest('#tsGenDlg')) return;
  if(el.id==='tsgRaw') tsgSchedule(true);
  else if(el.id==='tsgAid'){ G.touched.aid=true; tsgSchedule(false); }
});
document.addEventListener('change',function(ev){
  var el=ev.target; if(!G||!el||!el.closest||!el.closest('#tsGenDlg')) return;
  if(el.id==='tsgTicket'){ G.tk=+el.value||0; G.touched={}; tsgRender(true); return; }   // another ticket = a fresh prefill
  if(el.id==='tsgCountry') G.touched.country=true;
  else if(el.id==='tsgParty') G.touched.party=true;
  else if(el.id==='tsgIssue') G.touched.issue=true;
  else if(!/^tsgRes$|^tsgHi\d+$/.test(el.id)) return;
  tsgRender(false);
});
document.addEventListener('click',function(ev){
  var t=ev.target; if(!G||!t||!t.closest||!t.closest('#tsGenDlg')) return;
  if(t.closest('[data-tsgx]')){ tsGenClose(); return; }
  var sb=t.closest('[data-tsgsev]'); if(sb){ G.sev=sb.getAttribute('data-tsgsev'); G.sevDefault=false; G.sevTag=''; G.touched.sev=true; tsgRender(false); return; }
  var sg=t.closest('[data-tsgsug]');
  if(sg){
    var isel=tsgEl('tsgIssue'); isel.value=sg.getAttribute('data-tsgsug'); tsgSS(isel); G.touched.issue=true; tsgRender(false);
    var f=isel._ssField||isel; if(f&&f.focus) f.focus();   // the chip is gone after applying
    announce('Issue type set to '+isel.value);
    return;
  }
  var cb=t.closest('[data-tsgcopy]'); if(cb){ tsgCopy(cb.getAttribute('data-tsgcopy'),cb); return; }
  if(t.closest('[data-tsgclear]')){
    var ta=tsgEl('tsgRaw'); ta.value=''; G.touched={};
    tsgEl('tsgRes').value=''; tsgSS(tsgEl('tsgRes'));
    tsgSyncHi('', G.p, false, false);
    tsgRender(true); ta.focus(); announce('Cleared');
  }
});


// Esc closes whichever of the two pop-ups is open.
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { tsUpdClose(); tsGenClose(); } });
window.PHDSanTools = { heroActsHtml: heroActsHtml, SHEET_URL: TS_SHEET_URL };
})();
