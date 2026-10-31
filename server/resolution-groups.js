// Temporary display grouping for the resolutions.html "Resolution Types" table (split mode only).
// The raw "Res" values are being cleaned upstream; until new uploads carry one of the clean PHD
// Resolutions values, the table merges every raw value into one of these 17 priority groups
// (1 = most severe). Pure, no DB; unit-testable.
//
// Matching (both sides normalised by resolutionGroupKey: lower-case, whitespace collapsed, trimmed,
// trailing '.' / ':' stripped):
//   1. exact match against a listed value -> its group (the listed placement wins, even for
//      multi-mitigation values). A value listed in more than one group keeps the FIRST occurrence
//      (see RESOLUTION_GROUP_DUPLICATES);
//   2. else the value equals a group NAME -> that group;
//   3. else split on ',', '/', '+', '&', ' and ', ' or ' (after removing '[#...]' hashtag notes),
//      map each part via 1-2 (plus RESOLUTION_GROUP_ALIASES) and keep the LOWEST priority number;
//   4. else 'Others'.

const RESOLUTION_GROUPS = [
  { priority: 1, name: 'Account Closure', values: [
    'Account Closure', 'Account Closure (Permanent)', 'Account Closure [#account-closure]', 'Account Suspension',
    'Account Suspension (Temporary)', 'Account Suspension (Temporary), Customer Reassurance',
    'Account Suspension (Temporary), Driver Follow-up', 'Account Suspension (Temporary), No Further Action Taken',
    'Customer Account Closure'] },
  { priority: 2, name: 'Physical Order Block', values: [
    'Account Suspension (Temporary) , Physical Order Block', 'Address Exclusion, Physical Order Block, Driver Follow-Up',
    'Physical Order Block', 'Physical Order Block on Business and Personal CX accounts, Address Exclusion, Customer Reassurance'] },
  { priority: 3, name: 'Area Exclusion', values: ['Area Exclusion'] },
  { priority: 4, name: 'Address Exclusion', values: [
    'Address Exclusion', 'Address Exclusion [#address-exclusion]', 'Address Exclusion, Delivery Hint, Customer Education',
    'Address Exclusion, Driver Follow-up', 'Address Exclusion, GeoPin Update, GeoFence Update, Customer Education, Pet Info',
    'Address Exclusion, Parcel Box, Customer Reassurance, Delivery Hint, Driver Misconduct Reported'] },
  { priority: 5, name: 'Address Deprio', values: [
    'Address De-prioritization [#address-depri]', 'Address Depri', 'Address Deprio', 'Address Deprioritization', 'Address Deprivation'] },
  { priority: 6, name: 'Routing Update', values: ['Routing / Geopin update', 'Routing Update', 'Routing/Geopin update'] },
  { priority: 7, name: 'GeoFence Update', values: ['GeoFence Update'] },
  { priority: 8, name: 'GeoPin Update', values: [
    'Customer Reassurance [#cx-reassurance ] and Geopin Update [#geopin-update]', 'Customer Reassurance and Geopin Update',
    'Customer reassurance/Geopin update', 'Driver Follow-Up, GeoPin Update, GeoFence Update', 'Geopin Update',
    'Geopin Update [#geopin-update]', 'Geopin Update [#geopin-update] and Customer Reassurance [#cx-reassurance ]',
    'Geopin update/ Customer reassurance', 'GeoPin Update , Delivery Hint', 'GeoPin Update, Customer Reassurance',
    'GeoPin Update, Customer Reassurance, Driver Misconduct Not Reported', 'GeoPin Update, Delivery Hint, Customer Education',
    'GeoPin Update, Delivery Hint, Customer Education, Customer Reassurance', 'GeoPin Update, Delivery Hint, Customer Reassurance',
    'GeoPin Update, Delivery Hint, Pet Info Update, Customer Reassurance', 'GeoPin Update.',
    'Pet Info Update, Delivery Hint, GeoPin Update, Driver Misconduct'] },
  { priority: 9, name: 'Customer Reassurance', values: [
    'Customer Education', 'Customer Education, Customer Reassurance', 'Customer Education, Driver Follow-up',
    'Customer Reassurance', 'Customer Reassurance (Neutral)', 'Customer Reassurance (Verbal)', 'Customer Reassurance:',
    'Customer Reassurance [#cx-reassurance ]', 'Customer Reassurance [#cx-reassurance]', 'Customer Reassurance + Customer Education',
    'Customer Reassurance, Driver Follow-up', 'Customer reassurance.', 'Customwr reassurance', 'CX reassurance',
    'CX reassurance provided', 'CX Reassurances', 'Delivery Hint, Customer Reassurance, Driver Misconduct Reported',
    'Delivery Hint, Customer Reassurance, Pet Info Update, Driver Misconduct Reported', 'Driver false report/ Customer reassurance',
    'Driver Follow-up OR Customer Reassurance', 'Parcel Box Installation, Delivery Hint, Customer Reassurance',
    'Verbal Reassurance', 'Customer Reassurance, Driver Misconduct Reported', 'Driver Misconduct Reported , Customer Reassurance',
    'Driver Misconduct Reported, Customer Reassurance'] },
  { priority: 10, name: 'Parcel Box Installation', values: [
    'Customer Reassurance and Parcel Box Install', 'Parcel Box', 'Parcel Box Install', 'Parcel Box Install [#parcel-box]',
    'Parcel Box Install [#parcel-box] and Customer Reassurance [#cx-reassurance ]', 'Parcel Box Install + Customer Reassurance',
    'Parcel Box Install and Customer Reassurance', 'Parcel box install/ Customer reassurance', 'Parcel Box install/ Delivery hint',
    'Parcel Box Installation', 'Parcel Box Installation, Customer Reassurance'] },
  { priority: 11, name: 'Delivery Hint', values: [
    'Customer Reassurance [#cx-reassurance ] and Delivery Hint [#delivery-hint]', 'Customer Reassurance and Delivery Hint',
    'Customer Reassurance, Customer Education, Delivery Hint', 'Customer Reassurance, Delivery Hint',
    'Customer reassurance/Delivery Hint', 'Delivery Hint', 'Delivery Hint & Customer Reassurance',
    'Delivery Hint and Customer Reassurance', 'Delivery Hint and Driver Follow-up', 'Delivery Hint Update',
    'Delivery Hint, Customer Education, Customer Reassurance', 'Delivery Hint, Customer Reassurance', 'Delivery Hint.',
    'Delivery hint/ Customer reassurance', 'Delivery hint/ Customer reassurance.', 'Delivery hint/Customer reassurance'] },
  { priority: 12, name: 'Driver Follow-up', values: [
    'Automatically Closed', 'Driver behavior', 'Driver Education', 'Driver Follow Up.', 'Driver follow - up', 'Driver follow -up',
    'Driver follow- up', 'Driver follow up', 'Driver Follow-up', 'Driver Follow-up [#driver-follow-up]', 'Driver Followup',
    'Insufficient Information / Driver Education', 'Out of Scope', 'Unidentifiable POI- no further action by PHD Team',
    'No Further Action', 'No Further Action Required', 'No Further Action Taken', 'NOT APPLICABLE/No Further Action Required',
    'Insufficient in formation', 'Insufficient Information', 'Insufficient information.', 'Insufficient infromation',
    'Insufficient Information & paw print added', 'Insufficient Information , paw print added',
    'Insufficient Information, paw print added', 'paw print , Insufficient information',
    'paw print added- Insufficient Information', 'paw print added. No CX response'] },
  { priority: 13, name: 'Blocking Place ID', values: ['Blocking Place ID'] },
  { priority: 14, name: 'Pet Info Update', values: ['Dog Info Update', 'Pet Info Update'] },
  { priority: 15, name: 'Driver Misconduct Reported', values: ['Driver Misconduct', 'Driver Misconduct Reported', 'Driver Misconduct Not Reported'] },
  { priority: 16, name: 'Driver False Report', values: ['Driver False Report', 'Driver False Report [#driver-false-report]'] },
  { priority: 17, name: 'Others', values: ['Address change', 'Arrange for Locker', 'Duplicate', 'Failure to follow Standard Work', 'Unsecured Animal Attack (CX Pet)'] },
];
const RESOLUTION_OTHERS_NAME = 'Others';
// Extra part-level synonyms used by step 3 only (each maps to a group name).
const RESOLUTION_GROUP_ALIASES = {
  'customer education': 'Customer Reassurance',
  'dog info': 'Pet Info Update',
  'pet info': 'Pet Info Update',
  'parcel box': 'Parcel Box Installation',
  'account suspension': 'Account Closure',
};

function resolutionGroupKey(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.:\s]+$/, '');
}

// Lookup tables, built once. First listed occurrence wins; cross-group repeats are recorded.
const GROUP_BY_NAME = new Map();      // normalised group name -> group
const GROUP_BY_VALUE = new Map();     // normalised listed value -> group
const RESOLUTION_GROUP_DUPLICATES = [];   // { value, keptIn, alsoIn }
RESOLUTION_GROUPS.forEach(g => GROUP_BY_NAME.set(resolutionGroupKey(g.name), g));
RESOLUTION_GROUPS.forEach(g => g.values.forEach(v => {
  const k = resolutionGroupKey(v);
  const prev = GROUP_BY_VALUE.get(k);
  if (!prev) GROUP_BY_VALUE.set(k, g);
  else if (prev !== g) RESOLUTION_GROUP_DUPLICATES.push({ value: v, keptIn: prev.name, alsoIn: g.name });
}));
const OTHERS_GROUP = GROUP_BY_NAME.get(resolutionGroupKey(RESOLUTION_OTHERS_NAME));

function groupOfKey(k) { return GROUP_BY_VALUE.get(k) || GROUP_BY_NAME.get(k) || null; }

// Group for one raw Res value: { priority, name, step } (step = 1..4, which rule matched).
function resolutionGroupOf(value) {
  const k = resolutionGroupKey(value);
  const v = GROUP_BY_VALUE.get(k);
  if (v) return { priority: v.priority, name: v.name, step: 1 };
  const n = GROUP_BY_NAME.get(k);
  if (n) return { priority: n.priority, name: n.name, step: 2 };
  const parts = String(value == null ? '' : value).replace(/\[#[^\]]*\]?/g, ' ')
    .split(/,|\/|\+|&|\s+and\s+|\s+or\s+/i).map(resolutionGroupKey).filter(Boolean);
  let best = null;
  parts.forEach(p => {
    const g = groupOfKey(p) || (RESOLUTION_GROUP_ALIASES[p] ? GROUP_BY_NAME.get(resolutionGroupKey(RESOLUTION_GROUP_ALIASES[p])) : null);
    if (g && (!best || g.priority < best.priority)) best = g;
  });
  if (best) return { priority: best.priority, name: best.name, step: 3 };
  return { priority: OTHERS_GROUP.priority, name: OTHERS_GROUP.name, step: 4 };
}

module.exports = { RESOLUTION_GROUPS, RESOLUTION_GROUP_ALIASES, RESOLUTION_GROUP_DUPLICATES, RESOLUTION_OTHERS_NAME, resolutionGroupKey, resolutionGroupOf };
