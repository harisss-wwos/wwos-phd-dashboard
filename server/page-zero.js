// Page ZERO ("GLOBAL PHD Page 0 — <year>") — pure classification + aggregation for GET /api/page-zero.
// No DB access here: server.js reads the projected ticket docs and hands them to computePageZero().
// Everything is exported so it can be unit-tested in isolation.
'use strict';
const { issueFromRcd, resolutionFromRcd } = require('./pulse-check');

// ---------------------------------------------------------------------------------------------
// Issue taxonomy: category -> type names.
// KEEP IN SYNC with window.IZ_CATS in ../issue-types-data.js (9 categories, 28 types). Only the
// category and type names are needed here; definitions/colours stay in the front-end file (the
// keyword rules below were written from those definitions). Page ZERO rows group the types by
// ISSUE_ROWS, not by these categories; a load-time check makes sure every type is in one row.
// ---------------------------------------------------------------------------------------------
const IZ_CATEGORIES = [
  { category: 'Weapon & Robbery', types: ['Robbery w/ weapon', 'Robbery w/o weapon', 'Attack w/weapon', 'Weapon pointed at driver', 'Armed w/weapon', 'Weapon present w/ no threat', 'Shots fired'] },
  { category: 'Pet', types: ['Attack w/pet', 'Unsecured pet - bite/injury', 'Unsecured pet - evasion injury', 'Unsecured pet - no contact'] },
  { category: 'Physical / Severe Outcome', types: ['Fatality from assault', 'Physical altercation \u2013 No Injury', 'Physical altercation w/ Injury'] },
  { category: 'Threats', types: ['Threat of harm (verbal or written)'] },
  { category: 'Detention / Impeding', types: ['Kidnapping', 'Impeding egress'] },
  { category: 'Sexual', types: ['Sexual assault (physical)', 'Sexual harassment (verbal)', 'Indecent exposure'] },
  { category: 'Abuse, Intimidation & Discrimination', types: ['Name Calling', 'Intimidation', 'Verbal abuse', 'Signage/Paraphernalia'] },
  { category: 'Property', types: ['Vandalism'] },
  { category: 'Out of Scope of PHD', types: ['Accidental injury (no POI)', 'Property / vehicle damage only', 'Suspicious Following'] },
];
const SLA_HOURS = 240;   // same create->resolve threshold as /api/resolutions/monthly (SLA_THRESHOLD_HRS)

// Matching key: case-insensitive, whitespace/punctuation-insensitive. Bracketed notes such as the
// hashtag suffix " [#cx-reassurance ]" are dropped first. Only letters, digits and "/" survive, so
// "Attack w/ Pet" == "Attack w/pet", "Driver follow - up" == "Driver Follow-up",
// "Unsecured Animal(CX Pet)" == "Unsecured Animal (CX Pet)". ("w/" vs "w/o" stay distinct.)
function normKey(s) {
  return String(s == null ? '' : s)
    .replace(/\[[^\]]*\]?/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9/]/g, '');
}

// =============================================================================================
// CORE INCIDENT METRICS — ticket classification (rows 02-09). ONE place: edit here.
//
// Every ticket created in the period lands in EXACTLY ONE of rows 02-09, so rows 02-09 always
// add up to row 01 (PHD Incidents (Total)). The type lists below only define what goes into each
// row; they are not displayed. All 28 taxonomy types (IZ_CATEGORIES) must appear exactly once.
// =============================================================================================
const ISSUE_ROWS = [
  { n: 2, key: 'robbery', label: 'Robbery', types: ['Robbery w/ weapon', 'Robbery w/o weapon'] },
  { n: 3, key: 'weapon', label: 'Weapon Incidents', types: ['Attack w/weapon', 'Weapon pointed at driver', 'Armed w/weapon', 'Weapon present w/ no threat', 'Shots fired'] },
  { n: 4, key: 'pet', label: 'Pet Incidents', types: ['Attack w/pet', 'Unsecured pet - bite/injury', 'Unsecured pet - evasion injury', 'Unsecured pet - no contact'] },
  { n: 5, key: 'physical', label: 'Physical Altercation', types: ['Fatality from assault', 'Physical altercation \u2013 No Injury', 'Physical altercation w/ Injury'] },
  { n: 6, key: 'verbal', label: 'Verbal Threats / Harassment', types: ['Threat of harm (verbal or written)', 'Name Calling', 'Intimidation', 'Verbal abuse', 'Signage/Paraphernalia', 'Vandalism'] },
  { n: 7, key: 'kidnap', label: 'Kidnapping / Impeding', types: ['Kidnapping', 'Impeding egress'] },
  { n: 8, key: 'sexual', label: 'Sexual Related Incidents', types: ['Sexual assault (physical)', 'Sexual harassment (verbal)', 'Indecent exposure'] },
  // Row 09 also takes every ticket that cannot be classified (Step 3 below).
  { n: 9, key: 'notSpecified', label: 'Issue not specified', types: ['Accidental injury (no POI)', 'Property / vehicle damage only', 'Suspicious Following'] },
];
const ROW_NOT_SPECIFIED = 'notSpecified';
const ROW_PET = 'pet';
// Non-pet incidents (repeat row 11, rate row 13, Assaults SLA row): rows 02, 03, 05, 06, 07, 08.
const NON_PET_ROWS = ['robbery', 'weapon', 'physical', 'verbal', 'kidnap', 'sexual'];
const ROW_KEYS = ISSUE_ROWS.map(r => r.key);
const ROW_ORDER = new Map(ISSUE_ROWS.map((r, i) => [r.key, i]));

const TYPE_INDEX = new Map();   // normKey(type) -> { row, type }
ISSUE_ROWS.forEach(r => r.types.forEach(t => {
  if (TYPE_INDEX.has(normKey(t))) throw new Error('page-zero: type in two rows ' + t);
  TYPE_INDEX.set(normKey(t), { row: r.key, type: t });
}));
IZ_CATEGORIES.forEach(c => c.types.forEach(t => {
  if (!TYPE_INDEX.has(normKey(t))) throw new Error('page-zero: taxonomy type not mapped to a row ' + t);
}));

// Legacy / free-text Issue spellings seen in live 2026 RootCauseDetails and ticket titles that are
// NOT taxonomy type names. Value = a taxonomy type name, or '@<row key>' (ISSUE_ROWS key) when only
// the row is clear. Compared with normKey(). Edit this table to extend exact coverage.
const ISSUE_ALIASES = {
  // Row 04 Pet
  'Pet Incident': '@pet', 'Pet attack': '@pet', 'Repeat Pet Incident': '@pet', 'Dog incident': '@pet', 'Dog attack': '@pet',
  'Unsecured Animal': '@pet', 'Unsecured Animal (CX Pet)': '@pet', 'Unsecured Animal (Non-CX Pet)': '@pet',
  'Unsecured Dog (CX pet)': '@pet', 'Unsecured animal (CX)': '@pet', 'Unsecured CX Pet': '@pet', 'Unsecured pet': '@pet',
  'Potential Harm - Pet Incident': '@pet', 'Pet incedent': '@pet',
  'Dog bite': 'Unsecured pet - bite/injury', 'Bite/Injury': 'Unsecured pet - bite/injury',
  'Driver injured by dog while making delivery': 'Unsecured pet - bite/injury',
  'Unsecured Animal Attack (CX Pet)': 'Unsecured pet - bite/injury',
  'Unsecured Animal Attack (Non-CX Pet/ Other)': 'Unsecured pet - bite/injury',
  'Unsecured Animal Evasion (CX Pet)': 'Unsecured pet - evasion injury',
  'Unsecured Animal Evasion (Non-CX Pet/ Other)': 'Unsecured pet - evasion injury',
  // Row 05 Physical Altercation
  'Attack w/o Weapon': '@physical', 'Assault w/o Weapon': '@physical', 'Physical Altercation': '@physical',
  'Assault': '@physical', 'Physical assault': '@physical', 'Attempt of Assault': '@physical', 'Attack on the driver': '@physical',
  'Detrimental Behavior - Assault': '@physical', 'Driver assaulted while making delivery': '@physical',
  'Assault - No Injury': 'Physical altercation \u2013 No Injury', 'Assault w/o injury': 'Physical altercation \u2013 No Injury',
  'Assault no injury': 'Physical altercation \u2013 No Injury', 'Detrimental Behavior - Assault - No Injury': 'Physical altercation \u2013 No Injury',
  'Assault w/ injury': 'Physical altercation w/ Injury', 'Assault - Injury': 'Physical altercation w/ Injury',
  'Detrimental Behavior - Assault - Injury': 'Physical altercation w/ Injury',
  // Row 03 Weapon Incidents
  'Attack w/ Weapon': 'Attack w/weapon', 'Attack with weapon': 'Attack w/weapon', 'Assault w/ weapon': 'Attack w/weapon',
  'Threat w/ Weapon': 'Armed w/weapon', 'Threat with weapon': 'Armed w/weapon', 'Weapon Present - Implied Threat': 'Armed w/weapon',
  'Implied Threat w/ Weapon': 'Armed w/weapon', 'Gun brandished': 'Armed w/weapon', 'Weapon display': 'Armed w/weapon', 'Weapon display w/o use': 'Armed w/weapon',
  'Weapon Present': 'Weapon present w/ no threat', 'Weapon present (no threat, 1st incident)': 'Weapon present w/ no threat',
  'Weapon present (no threat': 'Weapon present w/ no threat', 'Weapon present (Not pointed)': 'Weapon present w/ no threat',
  'Weapon Present/No Threat': 'Weapon present w/ no threat', 'Weapon presence': 'Weapon present w/ no threat',
  'Weapon pointed': 'Weapon pointed at driver',
  'Shooting': 'Shots fired', 'Shooting - No Injury': 'Shots fired', 'Shooting w/o Injury': 'Shots fired',
  'Detrimental Behavior - Shooting - No Injury': 'Shots fired', 'Driver Reported Firearm Discharged': 'Shots fired', 'Shorts fired': 'Shots fired',
  // Row 02 Robbery
  'Armed robbery': 'Robbery w/ weapon',
  'Robbery': 'Robbery w/o weapon', 'Theft/Robbery': 'Robbery w/o weapon', 'Attempted robbery': 'Robbery w/o weapon', 'Robbery Attempt': 'Robbery w/o weapon',
  'Robbery w/o Injury': 'Robbery w/o weapon', 'Robbery - No Injury': 'Robbery w/o weapon', 'Robbery - Injury': 'Robbery w/o weapon',
  'Detrimental Behavior - Robbery - No Injury': 'Robbery w/o weapon', 'Assault / Robbery': 'Robbery w/o weapon',
  // Row 06 Verbal Threats / Harassment
  'Threat w/o Weapon': 'Threat of harm (verbal or written)', 'Verbal Threat': 'Threat of harm (verbal or written)',
  'Verbal threats': 'Threat of harm (verbal or written)', 'Threat of harm': 'Threat of harm (verbal or written)',
  'Written threat': 'Threat of harm (verbal or written)', 'Written Threats': 'Threat of harm (verbal or written)', 'Threats - Verbal': 'Threat of harm (verbal or written)',
  'Threats verbal': 'Threat of harm (verbal or written)', 'Detrimental Behavior - Threats - Verbal': 'Threat of harm (verbal or written)',
  'Verbal Harassment': 'Verbal abuse', 'Verbal harrasment': 'Verbal abuse', 'Verbal harassement': 'Verbal abuse', 'Verbal harrassement': 'Verbal abuse',
  'Harassment': 'Verbal abuse', 'Harrasment': 'Verbal abuse', 'Written Harassment': 'Verbal abuse', 'Verbal Altercation': 'Verbal abuse',
  'Yelling/Abusive Behavior': 'Verbal abuse', 'Yelling Abusive Behavior': 'Verbal abuse', 'Yelling & abusive behaviour': 'Verbal abuse', 'Abusive Behavior': 'Verbal abuse',
  'Abusive Behavior - Towards AMZN': 'Verbal abuse', 'Detrimental Behavior - Abusive Behavior': 'Verbal abuse',
  'Detrimental Behavior - Abusive Behavior - Towards AMZN': 'Verbal abuse', 'Bullying': 'Verbal abuse', 'Inappropriate notes': 'Verbal abuse',
  'Harassment/Intimidation': 'Intimidation', 'Harrasement Intimidation': 'Intimidation', 'Harassment Intimidation': 'Intimidation',
  // Legacy discrimination values = discriminatory language at the driver = 'Name Calling'.
  'Discriminatory Harassment': 'Name Calling', 'Inappropriate Racial Comments': 'Name Calling', 'Racist Notes': 'Name Calling',
  'Discrimination': 'Name Calling', 'Racism': 'Name Calling', 'Racist Harassment': 'Name Calling',
  // Row 07 Kidnapping / Impeding
  'Impending egress': 'Impeding egress', 'Impeded Egress': 'Impeding egress', 'Blocking driveway': 'Impeding egress',
  'Impeding Egress - Towards AMZN': 'Impeding egress', 'Detrimental Behavior - Impeding Egress - Towards AMZN': 'Impeding egress',
  // Row 08 Sexual
  'Sexual Assault': 'Sexual assault (physical)',
  'Sexual Harassment': 'Sexual harassment (verbal)', 'Inappropriate Sexual Comments': 'Sexual harassment (verbal)',
  // Row 09 (named out-of-scope types)
  'Transporter being followed': 'Suspicious Following', 'Driver reporting being followed': 'Suspicious Following',
};
const ALIAS_INDEX = new Map();   // normKey(alias) -> { row, type|null }
Object.keys(ISSUE_ALIASES).forEach(a => {
  const target = ISSUE_ALIASES[a];
  let hit;
  if (target.charAt(0) === '@') {
    const row = target.slice(1);
    if (!ROW_ORDER.has(row)) throw new Error('page-zero: unknown alias row ' + row);
    hit = { row, type: null };
  } else {
    hit = TYPE_INDEX.get(normKey(target));
    if (!hit) throw new Error('page-zero: unknown alias type ' + target);
  }
  ALIAS_INDEX.set(normKey(a), hit);
});

// ---------------------------------------------------------------------------------------------
// Keyword rules ("closest match"), built from the type definitions / usage / examples in
// ../issue-types-data.js. Each rule: row, type (informational; null = row only), w (rule weight),
// re (matched on lower-cased text). Among all matching rules the winner is: highest w, then the
// longest matched phrase (most specific), then row order 02..09.
//   w 9  Pet words — a pet match is never overridden by other words ("Verbal harassment with pet").
//   w 7  Out-of-scope overrides: package / vehicle theft with no driver present (definition: out of
//        scope of Robbery) and "hit by a car" / traffic collisions (not an assault).
//   w 6  Robbery — beats weapon words (robbery w/ weapon is row 02) and physical words (a shove
//        during a robbery is still "Robbery w/o weapon").
//   w 5  Weapon — beats threat / physical words ("threat w/ weapon" = Armed w/weapon).
//   w 4  Sexual   w 3  Kidnapping / Impeding   w 2  Physical   w 1  Verbal threats / harassment
//   w 0  Row 09 words (accidental injury, property damage, being followed) — only when no PHD row
//        word matched.
//   w -1 WEAK words (aggressive / hostile / rude / unprofessional / road rage / confront): count in
//        row 06 only if neither the Issue value nor the title has a stronger match (see classifyTicket).
// Before matching: "non-pet" / "no pet" and "w/o weapon" / "without a weapon" / "no weapon" are
// neutralised so they cannot trigger the Pet or Weapon words.
// ---------------------------------------------------------------------------------------------
const WEAPON_WORDS = '(?:guns?|handguns?|firearms?|pistols?|rifles?|shotguns?|knife|knives|machete|weapons?|armed|gunpoint|knifepoint|brandish\\w*|taser|pepper spray|mace)';
const WEAPON_RE = new RegExp('\\b' + WEAPON_WORDS + '\\b');
const KW = (row, type, w, src) => ({ row, type, w, re: new RegExp(src, 'g') });
const KEYWORD_RULES = [
  // Row 04 Pet (w 9)
  KW('pet', 'Attack w/pet', 9, '\\b(?:attack\\w*|assault\\w*)\\s+(?:with|w/)\\s*(?:a |the |their |his |her )?(?:pets?|dogs?|animals?)\\b|\\b(?:sic+ed|commanded|ordered|set)\\s+(?:the |their |his |her |a )?(?:pets?|dogs?)\\b'),
  KW('pet', 'Unsecured pet - bite/injury', 9, '\\bdog\\s*bites?\\b|\\bbit(?:e|es|ten)?\\s+by\\b|\\bbites?\\b|\\bbitten\\b|\\binjured by (?:a |the )?(?:dog|pet|animal)\\b'),
  KW('pet', 'Unsecured pet - evasion injury', 9, '\\bevasion\\b|\\bevad\\w*|\\b(?:fleeing|fled|escaping)\\b[^.]{0,40}\\b(?:dog|pet|animal)s?\\b'),
  KW('pet', 'Unsecured pet - no contact', 9, '\\bno contact\\b|\\b(?:dog|pet|animal)s?\\b[^.]{0,30}\\b(?:chas\\w*|charg\\w*|lung\\w*|bark\\w*)'),
  KW('pet', null, 9, '\\b(?:pets?|dogs?|pupp(?:y|ies)|canines?|k-?9s?|animals?)\\b'),
  // Row 09 overrides (w 7)
  KW('notSpecified', 'Property / vehicle damage only', 7, '\\b(?:package|parcel)s?\\s+(?:theft|stolen)\\b|\\btheft\\s*-?\\s*from\\s+(?:the |a )?vehicle\\b|\\bvehicle\\s+theft\\b|\\bstolen\\s+vehicle\\b'),
  KW('notSpecified', 'Accidental injury (no POI)', 7, '\\b(?:hit|struck)\\s+by\\s+(?:a |an |the )?(?:car|vehicle|truck|van)\\b|\\b(?:vehicle|traffic)\\s+(?:collision|accident)s?\\b'),
  // Row 02 Robbery (w 6). Type: w/ weapon when a weapon word is present too (resolved in kwMatch).
  KW('robbery', 'Robbery w/o weapon', 6, '\\b(?:robbery|robberies|robbed|robbing|rob|mugg(?:ed|ing)|stole|stolen|steal(?:s|ing)?|theft|carjack\\w*|snatch\\w*)\\b'),
  // Row 03 Weapon (w 5)
  KW('weapon', 'Shots fired', 5, '\\bshots?\\b|\\bshoot(?:s|ing)?\\b|\\bshorts fired\\b|\\bfired\\b|\\bgunfire\\b|\\bgunshots?\\b|\\bdischarg\\w*'),
  KW('weapon', 'Weapon pointed at driver', 5, '\\b' + WEAPON_WORDS + '\\b[^.]{0,30}\\b(?:point|aim)\\w*|\\b(?:point|aim)\\w*\\b[^.]{0,30}\\b' + WEAPON_WORDS + '\\b'),
  KW('weapon', 'Weapon present w/ no threat', 5, '\\bweapons?\\s+(?:present|presence|seen|visible)\\b'),
  KW('weapon', 'Attack w/weapon', 5, '\\b(?:attack|assault|hit|struck|swung|swing|threw)\\w*\\s+(?:with|w/)\\s*(?:a |an )?(?:weapon|knife|gun|bat|pipe|bottle|rock|brick)s?\\b|\\bstabb?\\w*'),
  KW('weapon', 'Armed w/weapon', 5, '\\b' + WEAPON_WORDS + '\\b'),
  // Row 08 Sexual (w 4)
  KW('sexual', 'Sexual assault (physical)', 4, '\\bsexual(?:ly)?\\s+assault\\w*|\\bgrop\\w*|\\bfondl\\w*|\\blewd\\b|\\bmasturbat\\w*'),
  KW('sexual', 'Sexual harassment (verbal)', 4, '\\bsexual(?:ly)?\\s+(?:harass\\w*|comment\\w*|remark\\w*|suggestive)|\\bsolicit\\w*|\\bcatcall\\w*|\\bsexist\\b'),
  KW('sexual', 'Indecent exposure', 4, '\\bindecent\\w*|\\bexpos(?:ed|ure|ing)\\b|\\bnaked\\b|\\bnude\\b|\\bnudity\\b|\\bflash(?:ed|ing)\\b'),
  KW('sexual', null, 4, '\\bsexual(?:ly)?\\b'),
  // Row 07 Kidnapping / Impeding (w 3)
  KW('kidnap', 'Kidnapping', 3, '\\bkidnap\\w*|\\babduct\\w*|\\bforced\\s+(?:in|into)\\s+(?:a |the |their |his |her )?(?:car|vehicle)\\b'),
  KW('kidnap', 'Impeding egress', 3, '\\bimped\\w*|\\bimpend\\w*\\s+egress\\b|\\begress\\b|\\bblock(?:ed|ing|s)?\\b|\\btrapped\\b|\\blocked\\s+in\\b|\\bdetain\\w*|\\bheld\\s+against\\b|\\b(?:would not|wouldn\'?t|did not|didn\'?t)\\s+let\\b'),
  // Row 05 Physical (w 2)
  KW('physical', 'Fatality from assault', 2, '\\bfatal\\w*|\\bdied\\b|\\bdeath\\b|\\bkilled\\b|\\bhomicide\\b'),
  KW('physical', 'Physical altercation \u2013 No Injury', 2, '\\b(?:no|without|w/o)\\s+injur\\w*'),
  KW('physical', null, 2, '\\bassault\\w*|\\bphysical(?:ly)?\\b|\\bpunch\\w*|\\bshov\\w*|\\bpush(?:ed|ing)?\\b|\\bslap\\w*|\\bkick\\w*|\\bspit(?:ting)?\\b|\\bspat\\b|\\bchok\\w*|\\btackl\\w*|\\bbeat(?:en| up)\\b|\\battack\\w*|\\bfight\\w*|\\bfought\\b|\\bhit\\b|\\bstruck\\b|\\bscuffle\\b'),
  // Row 06 Verbal threats / harassment (w 1)
  KW('verbal', 'Threat of harm (verbal or written)', 1, '\\bthreat\\w*|\\bharm\\b|\\bkill you\\b'),
  KW('verbal', 'Name Calling', 1, '\\bname[-\\s]?call\\w*|\\bslurs?\\b|\\bracis\\w*|\\bracial\\w*|\\bdiscriminat\\w*|\\bhomophob\\w*|\\bbigot\\w*|\\bn-word\\b'),
  KW('verbal', 'Intimidation', 1, '\\bintimidat\\w*|\\bmenac\\w*'),
  KW('verbal', 'Verbal abuse', 1, '\\bverbal\\w*|\\bhar+as+\\w*|\\byell\\w*|\\bscream\\w*|\\bshout\\w*|\\bcurs(?:e|ed|es|ing)\\b|\\bprofan\\w*|\\babus\\w*|\\binsult\\w*|\\bbull(?:y|ied|ying)\\b|\\boffensive\\b|\\bswear\\w*'),
  KW('verbal', 'Signage/Paraphernalia', 1, '\\bsignage\\b|\\bsigns?\\b|\\bparaphernalia\\b|\\bswastikas?\\b|\\bnooses?\\b|\\bconfederate flags?\\b'),
  KW('verbal', 'Vandalism', 1, '\\bvandal\\w*|\\bdefac\\w*|\\bkeyed\\b|\\bslash(?:ed)?\\s+tires?\\b|\\bsmash\\w*|\\bthrew\\s+(?:a\\s+)?(?:rocks?|stones?|eggs?|bricks?)\\b|\\begg(?:ed|ing)\\b|\\b(?:purposely|intentionally|deliberately)\\s+damag\\w*'),
  // Row 09 (w 0)
  KW('notSpecified', 'Accidental injury (no POI)', 0, '\\baccident\\w*|\\bslip(?:ped|s)?\\b|\\btrip(?:ped|ping)?\\b|\\bfell\\b|\\bfall(?:s|ing)?\\b|\\bmedical\\b|\\bcollision\\w*|\\bcrash\\w*|\\bsprain\\w*'),
  KW('notSpecified', 'Property / vehicle damage only', 0, '\\bproperty damage\\b|\\bvehicle damage\\b|\\bdamage only\\b|\\bdamag(?:e|ed|es)\\b'),
  KW('notSpecified', 'Suspicious Following', 0, '\\b(?:being|was|were|got|been|is|are|getting)\\s+followed\\b|\\bfollowed\\s+(?:by|the|me|him|her|them)\\b|\\bsuspicious\\s+follow\\w*|\\bfollowing\\s+(?:the |a |our )?(?:dp|da|driver|transporter|van|vehicle)s?\\b|\\bsurveil\\w*|\\btrail(?:ed|ing)\\b|\\bstalk\\w*|\\bfelt unsafe\\b|\\bsuspicious\\b'),
  // WEAK -> row 06 (w -1)
  KW('verbal', 'Intimidation', -1, '\\baggressiv\\w*|\\bhostil\\w*|\\brude\\w*|\\bunprofessional\\b|\\binappropriate\\s+(?:conduct|behaviou?r)\\b|\\broad rage\\b|\\bconfront\\w*|\\bdetrimental\\s+behaviou?r\\b|\\bunprovoked\\b'),
];

// Placeholder Issue / title values that mean "no value".
const NO_VALUE_KEYS = new Set(['', 'na', 'n/a', 'none', 'null', 'unknown', 'notspecified', 'nil']);
function isNoValue(s) { return NO_VALUE_KEYS.has(normKey(s)); }

// Generic title wording that never describes the incident type: removed before matching.
// Titles usually look like "<Region> Customer Incident Escalation - Severity <N> - <Incident Type>".
const TITLE_NOISE_RES = [
  /\[?\s*country code[^\]]*\]?/gi,
  /paste incident issue here/gi,
  /\baccount\s*id\s*:?\s*[a-z0-9]+/gi,
  /\b(?:customer|community member|cm)\s+incident(?:\s+escalation)?\b/gi,
  /\bincident\s+escalation\b/gi,
  /\bno\s+emt\b/gi,
];
const SEVERITY_RE = /\b(?:sev|severity)(?![a-z])(?:\s*level)?\s*[-:]?\s*\d*/gi;   // "Severity 4", "Sev 5", "Severity level - 3"
const REGION_RE = /^\s*\[?[A-Z]{2,3}\]?(?=[\s\]-])/;                    // leading "US", "[UK]", "UAE"
const SEG_SPLIT_RE = /\s+[-\u2013\u2014]+\s*|\s*[-\u2013\u2014]+\s+/;    // " - ", " -X", "X- " (not "pet-bite")
const PET_FLAG_RE = /^(?:non[-\s]?pet|pet)\s+(?=\S)/i;                  // title flag "Pet ..." / "Non-pet ..."

// Free text -> segments (generic words, severity and region removed). The last segment is the
// incident type; earlier ones are context.
function incidentSegments(text) {
  let s = String(text == null ? '' : text).replace(/\*\*/g, ' ');
  s = s.replace(REGION_RE, ' ');
  TITLE_NOISE_RES.forEach(re => { s = s.replace(re, ' - '); });
  s = s.replace(SEVERITY_RE, ' - ').replace(/[[\]]/g, ' ');
  return s.split(SEG_SPLIT_RE).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x && !/^[\d\s:.,]*$/.test(x));
}

// Exact taxonomy type name (how:'type') beats an ISSUE_ALIASES entry (how:'alias').
// Tried on: the raw text, then the trailing 1..N segments joined (so "Unsecured pet - bite/injury"
// and "Weapon Present - Implied Threat" survive the split), each also without a "Pet "/"Non-pet " flag.
function exactMatch(text, segs) {
  const cands = [text];
  for (let k = 1; k <= segs.length; k++) {
    const suf = segs.slice(-k).join(' - ');
    cands.push(suf, suf.replace(PET_FLAG_RE, ''));
  }
  for (const c of cands) { const h = TYPE_INDEX.get(normKey(c)); if (h) return { row: h.row, type: h.type, how: 'type' }; }
  for (const c of cands) { const h = ALIAS_INDEX.get(normKey(c)); if (h) return { row: h.row, type: h.type, how: 'alias' }; }
  return null;
}

// Keyword scan of one string -> best rule hit or null (see KEYWORD_RULES for the ordering).
// rules defaults to KEYWORD_RULES (issueTypeOf passes a row's typed rules to pick a type in that row).
function kwScan(s, rules) {
  const txt = ' ' + String(s || '').toLowerCase()
    .replace(/\bnon[-\s]?pets?\b|\bno\s+pets?\b/g, ' ')
    .replace(/\b(?:w\/o|w\/\s?out|without|no)\s+(?:a\s+|any\s+)?weapons?\b/g, ' unarmed ') + ' ';
  let best = null;
  (rules || KEYWORD_RULES).forEach(r => {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(txt))) {
      const len = m[0].length;
      if (!best || r.w > best.w || (r.w === best.w && (len > best.len || (len === best.len && ROW_ORDER.get(r.row) < ROW_ORDER.get(best.row))))) {
        best = { row: r.row, type: r.type, w: r.w, len, phrase: m[0].trim() };
      }
      if (!len) r.re.lastIndex++;
    }
  });
  if (best && best.row === 'robbery' && WEAPON_RE.test(txt)) best.type = 'Robbery w/ weapon';
  return best;
}
// Keyword match for a text: the last segment (incident type) first, then the whole cleaned text.
// A strong hit on the last segment wins; otherwise a strong hit on the whole text; else any weak hit.
function kwMatch(segs) {
  if (!segs.length) return null;
  const a = kwScan(segs[segs.length - 1]);
  if (a && a.w >= 0) return a;
  const b = segs.length > 1 ? kwScan(segs.join(' - ')) : null;
  if (b && b.w >= 0) return b;
  const h = a || b;
  return h ? Object.assign(h, { weak: true }) : null;
}

// One free-text value (Issue line or ticket title) -> { row, type, how, weak, phrase } or null.
// how: 'type' (exact taxonomy name) > 'alias' (ISSUE_ALIASES) > 'keyword' (KEYWORD_RULES).
function matchIncidentText(text) {
  if (isNoValue(text)) return null;
  const segs = incidentSegments(text);
  const ex = exactMatch(text, segs);
  if (ex) return Object.assign(ex, { weak: false });
  const kw = kwMatch(segs);
  return kw ? { row: kw.row, type: kw.type, how: 'keyword', weak: !!kw.weak, phrase: kw.phrase } : null;
}

// Issue string -> classification (Issue line only; kept for callers that only have the Issue).
function classifyIssue(issue) {
  const m = matchIncidentText(issue);
  return m ? { key: normKey(issue), row: m.row, type: m.type, how: m.how, recognised: true } : { key: normKey(issue), row: null, type: null, how: null, recognised: false };
}

// Ticket -> exactly one row of ISSUE_ROWS.
//   Step 1  the "Issue:" value from SIM Root Cause Details (issueFromRcd) -> matchIncidentText.
//   Step 2  no row from Step 1 (no Issue value, or an Issue that matches nothing) -> the ticket
//           title, same matching (incident type = segment after the last " - ", then whole title).
//   WEAK    keyword-only weak hits (KEYWORD_RULES w -1) are used only when neither the Issue nor
//           the title has a stronger hit: Issue weak hit first (step 1), then title weak hit (step 2).
//   Step 3  still nothing -> row 09 "Issue not specified".
// Returns { row, type, step: 1|2|3, how, src }.
function classifyTicket(t) {
  const issue = issueFromRcd(t && t.RootCauseDetails);
  const mi = matchIncidentText(issue);
  if (mi && !mi.weak) return { row: mi.row, type: mi.type, step: 1, how: mi.how, src: issue, phrase: mi.phrase || '' };
  const title = t && t.Title;
  const mt = matchIncidentText(title);
  if (mt && !mt.weak) return { row: mt.row, type: mt.type, step: 2, how: mt.how, src: title, phrase: mt.phrase || '' };
  if (mi) return { row: mi.row, type: mi.type, step: 1, how: mi.how, src: issue, phrase: mi.phrase || '' };
  if (mt) return { row: mt.row, type: mt.type, step: 2, how: mt.how, src: title, phrase: mt.phrase || '' };
  return { row: ROW_NOT_SPECIFIED, type: null, step: 3, how: 'none', src: isNoValue(issue) ? String(title || '') : issue, phrase: '' };
}

// ---------------------------------------------------------------------------------------------
// Ticket -> ONE of the 28 taxonomy types (or 'Issue not specified'), for the Incident Explorer.
// Same classifyTicket() order as the Core rows (Issue line exact/alias/keyword -> Title -> none), so a
// ticket's type always sits in the Core row Page ZERO puts it in. When only the ROW is known (an
// '@row' alias, or an untyped keyword such as "dog" / "assault" / "sexual"), the closest type in
// that row is picked: the row's typed keyword rules (TYPE_REFINE_RULES) on the matched text, then on
// the other text (title / Issue line); else ROW_DEFAULT_TYPE (the row's no-injury / no-contact type,
// per the definitions in ../issue-types-data.js).
//   source: 'RCD Issue line' | 'Title'  exact type name or alias (step 1 / step 2)
//           'Closest match'             keyword match, or a row-only match refined to a type
//           'Not specified'             step 3 (nothing matched)
// ---------------------------------------------------------------------------------------------
const ISSUE_NOT_SPECIFIED = 'Issue not specified';
const ISSUE_SOURCES = ['RCD Issue line', 'Title', 'Closest match', 'Not specified'];
// Extra wording used ONLY to pick a type inside an already chosen row (never changes the row).
const TYPE_REFINE_RULES = KEYWORD_RULES.filter(r => r.type).concat([
  KW('physical', 'Physical altercation w/ Injury', 2, '\\binjur(?:y|ies|ed)\\b|\\bbleed\\w*|\\bbruis\\w*|\\bhospital\\w*|\\bconcuss\\w*'),
]);
const ROW_REFINE_RULES = new Map(ISSUE_ROWS.map(r => [r.key, TYPE_REFINE_RULES.filter(k => k.row === r.key)]));
const ROW_DEFAULT_TYPE = { pet: 'Unsecured pet - no contact', physical: 'Physical altercation \u2013 No Injury', sexual: 'Sexual harassment (verbal)' };
function closestTypeInRow(row, texts) {
  const rules = ROW_REFINE_RULES.get(row) || [];
  for (const s of texts) {
    if (isNoValue(s)) continue;
    const h = kwScan(s, rules);
    if (h && h.type) return h.type;
  }
  return ROW_DEFAULT_TYPE[row] || (ROW_META.get(row) || ISSUE_ROWS[ISSUE_ROWS.length - 1]).types[0];
}
// -> { type, source, row, step, how }
function issueTypeOf(t) {
  const cls = classifyTicket(t);
  if (cls.step === 3) return { type: ISSUE_NOT_SPECIFIED, source: 'Not specified', row: cls.row, step: 3, how: cls.how };
  let type = cls.type;
  let closest = cls.how === 'keyword';
  if (!type) {
    closest = true;
    const other = cls.step === 1 ? (t && t.Title) : issueFromRcd(t && t.RootCauseDetails);
    type = closestTypeInRow(cls.row, [cls.src, other]);
  }
  return { type, source: closest ? 'Closest match' : (cls.step === 1 ? 'RCD Issue line' : 'Title'), row: cls.row, step: cls.step, how: cls.how };
}

// ---------------------------------------------------------------------------------------------
// MITIGATION ACTIONS DEPLOYED rows. One place: edit here.
// Every RESOLVED ticket (same set as row 14) gets exactly ONE resolution label from the Resolutions
// page's split-mode classification: server.js perfResolutionGroupLabelOf(doc, true), passed in as
// opts.resolutionLabelOf (AUTO-SIM / Rule for 'Not specified' Res values, else one of the 17
// resolution-groups.js priority groups). That label picks ONE row below (mutually exclusive):
//   match: 'autosim' / 'rule' -> opts.resolutionLabels.autosim / .rule (server.js PERF_RES_* labels)
//   match: <group name>       -> that resolution-groups.js group (compared case-insensitively)
// Any other label (Others, Not specified, Area Exclusion, GeoFence Update, Blocking Place ID,
// Pet Info Update, ...) -> 'No Action Taken' (RES_NO_ACTION). So the RES_ROWS add up to row 14, and
// 'Mitigation implemented' = every row except 'No Action Taken'.
// ---------------------------------------------------------------------------------------------
const RES_ROWS = [
  { key: 'resAutosim', label: 'Resolved by "AUTO-SIM"', match: 'autosim' },
  { key: 'resRule', label: 'Resolved by "Rule"', match: 'rule' },
  { key: 'resDriverFollowup', label: 'Driver Follow-up', match: 'Driver Follow-up' },
  { key: 'resReassurance', label: 'Customer Reassurance', match: 'Customer Reassurance' },
  { key: 'resAddressExclusion', label: 'Address Exclusion', match: 'Address Exclusion' },
  { key: 'resDeliveryHint', label: 'Delivery Hint', match: 'Delivery Hint' },
  { key: 'resGeopin', label: 'GeoPin Update', match: 'GeoPin Update' },
  { key: 'resDriverMisconduct', label: 'Driver Misconduct Reported', match: 'Driver Misconduct Reported' },
  { key: 'resParcelBox', label: 'Parcel Box Installation', match: 'Parcel Box Installation' },
  { key: 'resOrderBlock', label: 'Physical Order Block', match: 'Physical Order Block' },
  { key: 'resAddressDeprio', label: 'Address Deprio', match: 'Address Deprio' },
  { key: 'resAccountClosure', label: 'Account Closure', match: 'Account Closure' },
  { key: 'resRouting', label: 'Routing Update', match: 'Routing Update' },
  { key: 'resDriverFalseReport', label: 'Driver False Report', match: 'Driver False Report' },
  { key: 'resNoAction', label: 'No Action Taken', match: null },
];
const RES_NO_ACTION = RES_ROWS[RES_ROWS.length - 1];
const resLabelKey = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();

// opts -> function(ticket) -> RES_ROWS key (exactly one). Without opts.resolutionLabelOf every
// ticket is 'No Action Taken' (server.js always passes it).
function resolutionRowResolver(o) {
  const labelOf = typeof o.resolutionLabelOf === 'function' ? o.resolutionLabelOf : (() => '');
  const special = (o && o.resolutionLabels) || {};
  const index = new Map();   // resLabelKey(label) -> row key
  RES_ROWS.forEach(r => {
    if (!r.match) return;
    const name = r.match === 'autosim' || r.match === 'rule' ? special[r.match] : r.match;
    if (name) index.set(resLabelKey(name), r.key);
  });
  return t => index.get(resLabelKey(labelOf(t))) || RES_NO_ACTION.key;
}

// ---------------------------------------------------------------------------------------------
// DUPLICATES & APPEALS rows (informational). Same RESOLVED set as row 14; NOT exclusive with each
// other or with the Mitigation rows (a ticket can count in Duplicate, Appeals and one Mitigation row).
//   Duplicate = opts.isDuplicate(ticket)  (server.js perfIsDuplicateClosure: ClosureCode 'Duplicate',
//               the Resolutions page Duplicate card's closure rule, without that card's precedence)
//   Appeals   = opts.isAppeal(ticket)     (server.js perfIsAppeal: Title contains 'appeal', any case)
// ---------------------------------------------------------------------------------------------
const defaultIsDuplicate = t => String(t && t.ClosureCode != null ? t.ClosureCode : '').replace(/\s+/g, ' ').trim().toLowerCase() === 'duplicate';
const defaultIsAppeal = t => /appeal/i.test(String(t && t.Title != null ? t.Title : ''));

// ---------------------------------------------------------------------------------------------
// INCIDENTS BY DRIVER TYPE rows. Same CREATED set as row 01; every ticket -> exactly ONE row, so the
// four rows add up to row 01. Value = the "Driv:" (alias "Driver Type:") line of SIM Root Cause
// Details (RCD_DRIV_RE, parsed like the other RCD keys). Compared on a compact key (lower-case,
// letters + digits only). A value naming more than one type (e.g. "Flex DSP") -> Others.
// Everything that is not DSP DA / Flex DP / Hub DA -> Others: other values (CMU, bare "DA"/"DP", ...),
// placeholders (DRIVER_PLACEHOLDERS) and tickets without a Driv line.
// ---------------------------------------------------------------------------------------------
const DRIVER_ROWS = [
  // short = the driver type name alone (Incident Explorer level values).
  { key: 'drvDsp', label: 'Incidents processed involving "DSP DA"', short: 'DSP DA', re: /dsp|^(?:dps|sdp|dsa)da/ },        // DSP, DSP-DA, DA (DSP), DPS DA typo
  { key: 'drvFlex', label: 'Incidents processed involving "Flex DP"', short: 'Flex DP', re: /flex|^(?:fles|felx|flew)dp$/ },  // Flex, Flex-DP, Amazon Flex, Felx DP typo
  { key: 'drvHub', label: 'Incidents processed involving "Hub DA"', short: 'Hub DA', re: /hub/ },                            // Hub, Hub-DA, HUB DA
  { key: 'drvOthers', label: '"Others"', short: 'Others', re: null },
];
const DRIVER_OTHERS = DRIVER_ROWS[DRIVER_ROWS.length - 1];
const DRIVER_PLACEHOLDERS = new Set(['', 'na', 'none', 'null', 'nil', 'unknown', 'tbd']);
// rcd -> { key: DRIVER_ROWS key, raw: Driv value ('' if none), cls: 'type' | 'other' | 'placeholder' | 'none' }
function driverTypeOf(rcd) {
  const m = String(rcd == null ? '' : rcd).replace(/\*\*/g, '').match(RCD_DRIV_RE);
  if (!m) return { key: DRIVER_OTHERS.key, raw: '', cls: 'none' };
  const raw = m[1].replace(/\s+/g, ' ').trim();
  const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (DRIVER_PLACEHOLDERS.has(k)) return { key: DRIVER_OTHERS.key, raw, cls: 'placeholder' };
  const hits = DRIVER_ROWS.filter(r => r.re && r.re.test(k));
  return hits.length === 1 ? { key: hits[0].key, raw, cls: 'type' } : { key: DRIVER_OTHERS.key, raw, cls: 'other' };
}

// Repeat count: same rule as hiCountOf() in server.js ("Cnt: <n>", else "Historical Incident: <n>").
const HI_CNT_RE = /\bCnt\s*[:\s]\s*(\d+)/i;
const HI_HIST_RE = /Historical Incident\s*:?\s*(\d+)/i;
function cntOf(rcd) {
  const s = String(rcd || '');
  const m = s.match(HI_CNT_RE); if (m) return parseInt(m[1], 10) || 0;
  const m2 = s.match(HI_HIST_RE); if (m2) return parseInt(m2[1], 10) || 0;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Row definitions (display order). kind: count | pct | days.
//   count -> f   = accumulator field
//   pct   -> num/den fields, value = num/den*100 (1 dp), null when den is 0
//   days  -> num (sum of days) / den (ticket count), 1 dp
// Quarter / YTD columns sum the underlying fields first, then derive (never average a rate).
// ---------------------------------------------------------------------------------------------
const S_CORE = 'CORE INCIDENT METRICS', S_PERF = 'PERFORMANCE METRICS', S_MIT = 'MITIGATION ACTIONS DEPLOYED', S_SUP = 'SUPPLEMENTAL METRICS';
const S_DUP = 'DUPLICATES & APPEALS', S_DRV = 'INCIDENTS BY DRIVER TYPE';
// CORE INCIDENT METRICS = exactly 13 rows: 01 total, 02-09 ISSUE_ROWS (mutually exclusive, sum to
// row 01), 10-11 repeat counts, 12-13 repeat rates. Later sections continue the numbering from 14.
//   10 Repeat Pet      = repeat tickets (cntOf > 0) in row 04
//   11 Repeat Non-Pet  = repeat tickets in rows 02, 03, 05, 06, 07, 08 (row 09 excluded)
//   12 Repeat Pet %    = row 10 / row 04 * 100
//   13 Repeat Non-Pet% = row 11 / (rows 02+03+05+06+07+08) * 100   (field 'nonPet')
const ROWS = [
  { n: 1, key: 'created', label: 'PHD Incidents (Total)', section: S_CORE, kind: 'count', f: 'created' },
].concat(ISSUE_ROWS.map(r => ({ n: r.n, key: r.key, label: r.label, section: S_CORE, kind: 'count', f: r.key })))
  .concat([
    { n: 10, key: 'repeatPet', label: 'Repeat Pet incidents', section: S_CORE, kind: 'count', f: 'repeatPet' },
    { n: 11, key: 'repeatNonPet', label: 'Repeat Non-Pet incidents', section: S_CORE, kind: 'count', f: 'repeatNonPet' },
    { n: 12, key: 'repeatPetRate', label: 'Repeat Pet %', section: S_CORE, kind: 'pct', num: 'repeatPet', den: ROW_PET },
    { n: 13, key: 'repeatNonPetRate', label: 'Repeat Non-Pet %', section: S_CORE, kind: 'pct', num: 'repeatNonPet', den: 'nonPet' },
    { n: 14, key: 'resolved', label: 'PHD Performance (Resolved)', section: S_PERF, kind: 'count', f: 'resolved' },
    { n: 15, key: 'avgAge', label: 'Average Ticket Age | Successful resolved tickets', section: S_PERF, kind: 'days', num: 'ageDaysSum', den: 'ageN' },
    { n: 16, key: 'resolutionPct', label: 'Incident Resolution within 240 hrs (% of resolved)', section: S_PERF, kind: 'pct', num: 'resolvedWithinSla', den: 'resolved' },
    // Mitigation implemented = resolved tickets in every RES_ROWS row except 'No Action Taken'.
    { n: 17, key: 'mitigation', label: 'Mitigation implemented', section: S_MIT, kind: 'count', f: 'mitigation' },
  ])
  .concat(RES_ROWS.map(r => ({ key: r.key, label: r.label, section: S_MIT, kind: 'count', f: r.key })))
  .concat([
    // Informational: resolved tickets (row 14 set); also counted in the Mitigation rows; not exclusive.
    { key: 'dupResolved', label: 'Duplicate', section: S_DUP, kind: 'count', f: 'dupResolved' },
    { key: 'appealResolved', label: 'Appeals', section: S_DUP, kind: 'count', f: 'appealResolved' },
  ])
  // Created tickets (row 01 set), one driver row each: the four rows add up to row 01.
  .concat(DRIVER_ROWS.map(r => ({ key: r.key, label: r.label, section: S_DRV, kind: 'count', f: r.key })))
  .concat([
    // SLA rows: Dogs = tickets in row 04; Assaults = tickets in rows 02, 03, 05, 06, 07, 08.
    { key: 'petSla', label: 'PHD Dogs SLA Compliance', section: S_SUP, kind: 'pct', num: 'petSlaWithin', den: 'petSlaN' },
    { key: 'assaultSla', label: 'PHD Assaults SLA Compliance', section: S_SUP, kind: 'pct', num: 'asSlaWithin', den: 'asSlaN' },
  ]);
// Rows from 18 on are numbered consecutively in display order (rows 01-17 keep their fixed numbers).
ROWS.forEach((r, i) => { if (r.n == null) r.n = i + 1; else if (r.n !== i + 1) throw new Error('page-zero: row numbering ' + r.key); });

const FIELDS = ['created', 'nonPet', 'repeatPet', 'repeatNonPet', 'resolved', 'ageDaysSum', 'ageN', 'resolvedWithinSla', 'mitigation',
  'petSlaN', 'petSlaWithin', 'asSlaN', 'asSlaWithin', 'dupResolved', 'appealResolved']
  .concat(ROW_KEYS, RES_ROWS.map(r => r.key), DRIVER_ROWS.map(r => r.key));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RESOLVED_STATUSES = ['Resolved', 'Closed'];   // same as /api/resolutions/monthly

const r1 = x => Math.round(x * 10) / 10;
const pctOf = (num, den) => (den > 0 ? r1(num / den * 100) : null);
function toDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Months of `year` that have started by `now` (UTC): 0..12.
function elapsedMonths(year, now) {
  const y = now.getUTCFullYear();
  return year < y ? 12 : year > y ? 0 : now.getUTCMonth() + 1;
}

// Column layout: 12 month keys, Q1..Q4, YTD -> month indexes (0-based) each column covers.
function columnsFor(year, now) {
  const last = elapsedMonths(year, now), yy = String(year).slice(-2);
  const months = MON.map((m, i) => ({ key: year + '-' + String(i + 1).padStart(2, '0'), label: m + "'" + yy, elapsed: i < last }));
  const cols = [];
  months.forEach((m, i) => cols.push({ key: m.key, idx: m.elapsed ? [i] : [] }));
  for (let q = 0; q < 4; q++) cols.push({ key: 'Q' + (q + 1), idx: [0, 1, 2].map(k => q * 3 + k).filter(i => i < last) });
  cols.push({ key: 'YTD', idx: Array.from({ length: last }, (_, i) => i) });
  return { months, cols };
}

// Derive one row's value from a summed bucket.
function rowValue(row, b) {
  if (row.kind === 'count') return b[row.f];
  if (row.kind === 'pct') return pctOf(b[row.num], b[row.den]);
  return b[row.den] > 0 ? r1(b[row.num] / b[row.den]) : null;   // days
}

// ---------------------------------------------------------------------------------------------
// INDICATIVE KRI (stand-in until a real KRI source exists; approved by the user).
//   Data      tickets CREATED (CreateDate, UTC month), one per ShortId. Site ID = RootCauseDetails
//             "SID:" value (upper-case, must match /^[A-Z0-9]{3,6}$/); Zipcode = "Zip:" value
//             (whitespace collapsed, upper-case). Blank / N/A / '-' are ignored.
//   Windows   Current = current UTC month to date; Last Month = previous UTC month; 2 Mo Ago = the
//             month before that. A window outside `year` is null ('—').
//   Score     KRI(month, entity) = round2(100 * incidents(entity, month) / max incidents of any
//             entity that month) -> the busiest site/zip of the month scores 100; 0 incidents -> 0.
//   Ranked    entities with >= KRI_MIN_INCIDENTS incidents in the Current month; top KRI_TOP by
//             Current KRI desc, then Current incidents desc, then id A->Z.
//   Changes   MoM = Current - Last; MoM % = MoM / Last * 100. QoQ = Current - 2 Mo Ago (as in the
//             user's sheet); QoQ % = QoQ / 2 Mo Ago * 100. % is null when the base is 0 / null.
//   Country   an entity's most frequent ticket country in the year (ties: known code first, A->Z).
// ---------------------------------------------------------------------------------------------
const KRI_MIN_INCIDENTS = 3;
const KRI_TOP = 5;
// KRI Level bands (sites only), checked top-down: first band with score >= min wins.
const KRI_LEVELS = [
  { min: 80, level: 'Critical' },
  { min: 60, level: 'Very High' },
  { min: 40, level: 'High' },
  { min: 20, level: 'Medium' },
  { min: -Infinity, level: 'Low' },
];
function kriLevelOf(score) {
  if (score == null || !isFinite(score)) return null;
  for (const b of KRI_LEVELS) if (score >= b.min) return b.level;
  return 'Low';
}
// Same "KEY: value up to newline or next known KEY:" approach as issueFromRcd / resolutionFromRcd
// in pulse-check.js (KEEP IN SYNC with RCD_NEXT_KEYS there; Issue added so a one-line blob that
// starts "SID: X Issue: Y" also stops). Markdown '**' is stripped first.
const KRI_NEXT_KEYS = 'I?ssue(?:\\s*Type)?|SID|Station\\s*ID|TID|Transporter\\s*ID|Driv|Driver\\s*Type|Date|Incident\\s*Date|TBA|Tracking\\s*ID|Cnt|Historical\\s*Incident|HI\\d+|Zip|CID|AID|UPID|Res|Resolution|Tag';
const rcdKeyRe = key => new RegExp('(?:^|\\s)' + key + '[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + KRI_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
const RCD_SID_RE = rcdKeyRe('SID');
const RCD_ZIP_RE = rcdKeyRe('Zip');
const PLACEHOLDER_RE = /^(n\/?a|none|null|unknown|-+|\u2014)$/i;
function rcdValue(rcd, re) {
  const m = String(rcd == null ? '' : rcd).replace(/\*\*/g, '').match(re);
  const v = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return !v || PLACEHOLDER_RE.test(v) ? '' : v;
}
// Site ID from RootCauseDetails, or '' when absent / placeholder / not 3-6 letters+digits.
function sidFromRcd(rcd) {
  const v = rcdValue(rcd, RCD_SID_RE).toUpperCase();
  return /^[A-Z0-9]{3,6}$/.test(v) ? v : '';
}
// Zipcode from RootCauseDetails, or '' when absent / placeholder.
function zipFromRcd(rcd) { return rcdValue(rcd, RCD_ZIP_RE).toUpperCase(); }

const r2 = x => Math.round(x * 100) / 100;
// Window month (0-based index in `year`) k months before now's UTC month; null if outside `year`.
function kriWindow(year, now, k) {
  const abs = now.getUTCFullYear() * 12 + now.getUTCMonth() - k;
  const y = Math.floor(abs / 12), m = abs - y * 12;
  if (y !== year) return null;
  return { idx: m, key: y + '-' + String(m + 1).padStart(2, '0'), label: MON[m] + ' ' + y, short: MON[m], toDate: k === 0 };
}
// Most frequent country in a Map(country -> n); ties: a known code beats 'Unknown', then A->Z.
function topCountry(cm) {
  let best = 'Unknown', bn = -1;
  (cm ? Array.from(cm.entries()) : []).forEach(([c, n]) => {
    if (n > bn || (n === bn && ((best === 'Unknown' && c !== 'Unknown') || (c !== 'Unknown' && c < best)))) { best = c; bn = n; }
  });
  return best;
}
// perMonth: 12 Maps (entity -> incidents); countries: Map(entity -> Map(country -> n)).
function rankKri(perMonth, countries, win, withLevel) {
  const cur = win.current;
  if (!cur) return [];
  const maxOf = w => { if (!w) return 0; let mx = 0; perMonth[w.idx].forEach(n => { if (n > mx) mx = n; }); return mx; };
  const mx = { current: maxOf(win.current), last: maxOf(win.last), prev2: maxOf(win.prev2) };
  const score = (w, key, id) => {
    if (!w) return null;
    const n = perMonth[w.idx].get(id) || 0;
    return mx[key] > 0 ? r2(100 * n / mx[key]) : 0;
  };
  const list = [];
  // Sites need >= KRI_MIN_INCIDENTS this month to be ranked. Zipcodes have far fewer incidents each,
  // so every zip with at least 1 incident this month is ranked (top 5 = most incidents).
  const minN = withLevel ? KRI_MIN_INCIDENTS : 1;
  perMonth[cur.idx].forEach((n, id) => {
    if (n < minN) return;
    const current = score(win.current, 'current', id), last = score(win.last, 'last', id), prev2 = score(win.prev2, 'prev2', id);
    const mom = last == null ? null : r2(current - last);
    const qoq = prev2 == null ? null : r2(current - prev2);
    const e = { rank: 0, id, country: topCountry(countries.get(id)) };
    if (withLevel) e.level = kriLevelOf(current);
    Object.assign(e, {
      current, last, prev2, currentCount: n,
      mom, momPct: mom != null && last > 0 ? r1(mom / last * 100) : null,
      qoq, qoqPct: qoq != null && prev2 > 0 ? r1(qoq / prev2 * 100) : null,
    });
    list.push(e);
  });
  // Most incidents this month first (KRI follows the count), then last month's KRI, then id A->Z.
  list.sort((a, b) => b.currentCount - a.currentCount || (b.last || 0) - (a.last || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return list.slice(0, KRI_TOP).map((e, i) => Object.assign(e, { rank: i + 1 }));
}

// ---------------------------------------------------------------------------------------------
// Shared per-ticket helpers: computePageZero (the table) and coreExportCsv (the per-period CSV)
// both go through dedupeTickets + coreClassify, so the export always reconciles with the table.
// ---------------------------------------------------------------------------------------------
// Cross-quarter dedupe: one doc per ShortId (first doc wins), as /api/issue-types-report does.
function dedupeTickets(tickets) {
  const seen = new Set(), out = [];
  (tickets || []).forEach(t => {
    const sid = String(t.ShortId || t.IssueId || '');
    if (sid) { if (seen.has(sid)) return; seen.add(sid); }
    out.push(t);
  });
  return out;
}
const ROW_META = new Map(ISSUE_ROWS.map(r => [r.key, r]));
const SOURCE_LABEL = { 1: 'Issue line', 2: 'Title', 3: 'Not specified' };
// Ticket -> Core Incident Metrics placement: one of rows 02-09, plus the repeat rows 10 / 11.
//   repeat = Cnt > 0 AND the ticket is in row 04 (-> row 10) or rows 02/03/05-08 (-> row 11);
//   row 09 tickets never count as repeats (same rule as the table).
function coreClassify(t) {
  const cls = classifyTicket(t);
  const meta = ROW_META.get(cls.row);
  const cnt = cntOf(t && t.RootCauseDetails);
  const isPet = cls.row === ROW_PET, inAssault = NON_PET_ROWS.indexOf(cls.row) >= 0;
  return {
    row: cls.row, rowN: meta.n, rowLabel: meta.label, type: cls.type || '', how: cls.how,
    source: SOURCE_LABEL[cls.step], matchedText: cls.step === 3 ? '' : String(cls.src || ''), phrase: cls.phrase || '',
    cnt, isPet, inAssault, repeat: cnt > 0 && (isPet || inAssault),
  };
}

// ---------------------------------------------------------------------------------------------
// CSV export: GET /api/page-zero/export?year=&period= (period = month key 'YYYY-MM' as in
// columnsFor, or 'Q1'..'Q4'). Rows = every ticket CREATED in the period's elapsed UTC months —
// exactly the tickets behind row 01 of that column.
// ---------------------------------------------------------------------------------------------
// -> { key, idx, fileTag } or null when the period is unknown / not elapsed / YTD.
function exportPeriod(year, now, period) {
  const p = String(period == null ? '' : period).trim();
  if (!/^(?:\d{4}-(?:0[1-9]|1[0-2])|Q[1-4])$/.test(p)) return null;
  const col = columnsFor(year, now).cols.find(c => c.key === p);
  if (!col || !col.idx.length) return null;
  return { key: p, idx: col.idx.slice(), fileTag: p.charAt(0) === 'Q' ? year + '-' + p : p };
}
const CSV_HEADER = ['Ticket ID', 'Ticket URL', 'Title', 'Created (UTC, ISO)', 'Created (IST)', 'Created (MST)', 'Status', 'Resolved Date', 'Resolved By',
  'Closure Code', 'Country/Region', 'SID', 'Zip', 'Driv', 'Issue', 'Res', 'Core Row #', 'Core Row', 'Matched Issue Type', 'Classified From',
  'Repeat', 'Repeat Count'];
// One CSV cell: formula-injection guard (leading = + - @ tab CR -> prefixed with '), then RFC 4180 quoting.
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Date -> 'YYYY-MM-DD HH:mm' at a fixed UTC offset (minutes). IST = +330, MST (no DST) = -420.
function fmtOffset(d, offMin) { return d ? new Date(d.getTime() + offMin * 60000).toISOString().slice(0, 16).replace('T', ' ') : ''; }
const RCD_DRIV_RE = rcdKeyRe('(?:Driv|Driver\\s*Type)');
// tickets: same docs as computePageZero (+ IssueUrl, ResolvedByIdentity). opts: { year, now, period,
// countryOf(t), resolverName(raw) }. Returns { period, filename, count, byRow, repeat, csv } or null (bad period).
function coreExportCsv(tickets, opts) {
  const o = opts || {};
  const year = o.year || 2026, now = o.now || new Date();
  const P = exportPeriod(year, now, o.period);
  if (!P) return null;
  const countryOf = typeof o.countryOf === 'function' ? o.countryOf : (() => 'Unknown');
  const resolverName = typeof o.resolverName === 'function' ? o.resolverName : (s => String(s || ''));
  const Y0 = Date.UTC(year, 0, 1), Y1 = Date.UTC(year + 1, 0, 1);
  const months = new Set(P.idx);
  const list = [];
  dedupeTickets(tickets).forEach(t => {
    const cd = toDate(t.cd);
    if (!cd || cd.getTime() < Y0 || cd.getTime() >= Y1 || !months.has(cd.getUTCMonth())) return;
    list.push({ t, cd, rd: toDate(t.rd), core: coreClassify(t) });
  });
  list.sort((a, b) => a.cd - b.cd || String(a.t.ShortId || a.t.IssueId || '').localeCompare(String(b.t.ShortId || b.t.IssueId || '')));
  const byRow = {}; ISSUE_ROWS.forEach(r => { byRow[r.n] = 0; });
  const repeat = { pet: 0, nonPet: 0 };
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  list.forEach(({ t, cd, rd, core }) => {
    byRow[core.rowN]++;
    if (core.repeat) { if (core.isPet) repeat.pet++; else repeat.nonPet++; }
    const rcd = t.RootCauseDetails;
    const sid = String(t.ShortId || t.IssueId || '');
    lines.push([
      sid, t.IssueUrl || (sid ? 'https://t.corp.amazon.com/issues/' + sid : ''), t.Title || '',
      cd.toISOString(), fmtOffset(cd, 330), fmtOffset(cd, -420),
      t.Status || '', rd ? rd.toISOString() : '', resolverName(t.ResolvedByIdentity), t.ClosureCode || '',
      countryOf(t) || 'Unknown', rcdValue(rcd, RCD_SID_RE), zipFromRcd(rcd), rcdValue(rcd, RCD_DRIV_RE),
      issueFromRcd(rcd) || '', resolutionFromRcd(rcd) || '',
      String(core.rowN).padStart(2, '0'), core.rowLabel, core.type, core.source,
      core.repeat ? 'Yes' : 'No', core.cnt,
    ].map(csvCell).join(','));
  });
  return {
    period: P.key, filename: 'PHD_Page0_Core_' + P.fileTag + '.csv', count: list.length, byRow, repeat,
    csv: '\uFEFF' + lines.join('\r\n') + '\r\n',
  };
}

// tickets: [{ ShortId|IssueId, Status, ClosureCode, RootCauseDetails, Country, Title, cd: Date|string, rd: Date|string }]
// (+ ResolvedByIdentity for the AUTO-SIM label).
// opts: { year, now, countryOf(ticket) -> code|'Unknown' (server.js passes slaCountryOf),
//         resolutionLabelOf(ticket) -> split-mode resolution label (server.js perfResolutionGroupLabelOf(doc, true)),
//         resolutionLabels: { autosim, rule } (server.js PERF_RES_AUTOSIM_LABEL / PERF_RES_RULE_LABEL),
//         isDuplicate(ticket) / isAppeal(ticket) (server.js perfIsDuplicateClosure / perfIsAppeal) }.
// Returns { year, generatedAt, months, rows, kri }. Future months / fully-future quarters are null.
function computePageZero(tickets, opts) {
  const o = opts || {};
  const year = o.year || 2026, now = o.now || new Date();
  const countryOf = typeof o.countryOf === 'function' ? o.countryOf : (() => 'Unknown');
  const resRowOf = resolutionRowResolver(o);
  const isDuplicate = typeof o.isDuplicate === 'function' ? o.isDuplicate : defaultIsDuplicate;
  const isAppeal = typeof o.isAppeal === 'function' ? o.isAppeal : defaultIsAppeal;
  const sitesPM = Array.from({ length: 12 }, () => new Map()), zipsPM = Array.from({ length: 12 }, () => new Map());
  const siteCty = new Map(), zipCty = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const bumpCty = (m, id, c) => { let cm = m.get(id); if (!cm) { cm = new Map(); m.set(id, cm); } bump(cm, c); };
  const Y0 = Date.UTC(year, 0, 1), Y1 = Date.UTC(year + 1, 0, 1);
  const acc = Array.from({ length: 12 }, () => { const a = {}; FIELDS.forEach(f => { a[f] = 0; }); return a; });
  // One count per ShortId (dedupeTickets); every ticket -> exactly one of rows 02-09 (coreClassify).
  dedupeTickets(tickets).forEach(t => {
    const cd = toDate(t.cd), rd = toDate(t.rd);
    const core = coreClassify(t);
    const isPet = core.isPet, inAssault = core.inAssault;
    if (cd && cd.getTime() >= Y0 && cd.getTime() < Y1) {
      const a = acc[cd.getUTCMonth()];
      a.created++;
      a[core.row]++;
      a[driverTypeOf(t.RootCauseDetails).key]++;
      if (inAssault) a.nonPet++;
      if (core.repeat) {
        if (isPet) a.repeatPet++;
        else a.repeatNonPet++;
      }
      const site = sidFromRcd(t.RootCauseDetails), zip = zipFromRcd(t.RootCauseDetails);
      if (site || zip) {
        const cty = countryOf(t) || 'Unknown';
        if (site) { bump(sitesPM[cd.getUTCMonth()], site); bumpCty(siteCty, site, cty); }
        if (zip) { bump(zipsPM[cd.getUTCMonth()], zip); bumpCty(zipCty, zip, cty); }
      }
    }
    if (rd && rd.getTime() >= Y0 && rd.getTime() < Y1 && RESOLVED_STATUSES.indexOf(t.Status) >= 0) {
      const a = acc[rd.getUTCMonth()];
      a.resolved++;
      const successful = String(t.ClosureCode || '').trim().toLowerCase() === 'successful';
      const hrs = cd ? (rd.getTime() - cd.getTime()) / 3600000 : null;
      // Row 15: age over Successful resolved tickets only. Row 16: resolved within SLA_HOURS (no created date = not within).
      if (hrs != null && successful) { a.ageDaysSum += hrs / 24; a.ageN++; }
      if (hrs != null && hrs <= SLA_HOURS) a.resolvedWithinSla++;
      const resKey = resRowOf(t);
      a[resKey]++;
      if (resKey !== RES_NO_ACTION.key) a.mitigation++;
      if (isDuplicate(t)) a.dupResolved++;
      if (isAppeal(t)) a.appealResolved++;
      if (hrs != null) {
        if (isPet) { a.petSlaN++; if (hrs <= SLA_HOURS) a.petSlaWithin++; }
        if (inAssault) { a.asSlaN++; if (hrs <= SLA_HOURS) a.asSlaWithin++; }
      }
    }
  });
  const { months, cols } = columnsFor(year, now);
  const sums = {};
  cols.forEach(c => {
    if (!c.idx.length) { sums[c.key] = null; return; }
    const b = {}; FIELDS.forEach(f => { b[f] = c.idx.reduce((s, i) => s + acc[i][f], 0); });
    sums[c.key] = b;
  });
  const rowsOut = ROWS.map(row => {
    const out = { n: row.n, key: row.key, label: row.label, section: row.section, kind: row.kind, values: {} };
    if (row.kind !== 'count') { out.num = {}; out.den = {}; }
    cols.forEach(c => {
      const b = sums[c.key];
      out.values[c.key] = b ? rowValue(row, b) : null;
      if (row.kind !== 'count') {
        out.num[c.key] = b ? (row.kind === 'days' ? r1(b[row.num]) : b[row.num]) : null;
        out.den[c.key] = b ? b[row.den] : null;
      }
    });
    return out;
  });
  const win = { current: kriWindow(year, now, 0), last: kriWindow(year, now, 1), prev2: kriWindow(year, now, 2) };
  const winOut = w => (w ? { key: w.key, label: w.label, short: w.short, toDate: w.toDate } : null);
  const kri = {
    windows: { current: winOut(win.current), last: winOut(win.last), prev2: winOut(win.prev2) },
    minIncidents: KRI_MIN_INCIDENTS,
    sites: rankKri(sitesPM, siteCty, win, true),
    zips: rankKri(zipsPM, zipCty, win, false),
  };
  return { year, generatedAt: now.toISOString(), months, rows: rowsOut, kri };
}

module.exports = {
  IZ_CATEGORIES, ISSUE_ALIASES, ISSUE_ROWS, KEYWORD_RULES, NON_PET_ROWS, RES_ROWS, RES_NO_ACTION, ROWS, SLA_HOURS,
  KRI_MIN_INCIDENTS, KRI_TOP, KRI_LEVELS, DRIVER_ROWS, driverTypeOf,
  normKey, classifyIssue, classifyTicket, coreClassify, dedupeTickets, exportPeriod, coreExportCsv, csvCell, matchIncidentText, incidentSegments, resolutionRowResolver, cntOf, columnsFor, elapsedMonths, computePageZero,
  sidFromRcd, zipFromRcd, kriLevelOf, kriWindow, topCountry,
  issueTypeOf, ISSUE_NOT_SPECIFIED, ISSUE_SOURCES, RESOLVED_STATUSES, toDate,
};
