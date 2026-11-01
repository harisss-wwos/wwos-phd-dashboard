// zip-geo.js — OFFLINE zip / postal code -> { state, city } lookup for the Incident Explorer.
// No network I/O: the index is built once, at require time (server start), from the GeoNames postal-code
// dump files in data/geonames/<CC>.txt (pinned in data/geonames/SOURCES.json; see data/README.md).
// Postal code data (c) GeoNames (geonames.org), licensed under CC BY 4.0.
//
// GeoNames columns (tab-separated): 0 country, 1 postal code, 2 place name, 3 admin1 name, 4 admin1 code,
// 5 admin2 name, 6 admin2 code, 7 admin3 name, 8 admin3 code, 9 lat, 10 lon, 11 accuracy.
// STATE  = admin1 name (state / province / estado / region). MX alias: 'Distrito Federal' -> 'Ciudad de México'.
// CITY   per country (GeoNames place names are not always cities):
//          CA            admin2 if set (T2P -> Calgary); else the text inside the place name's parentheses when it
//                        has no '/' ('Eastern Alberta (St. Paul)' -> St. Paul); else the place name minus '(...)'.
//          MX            admin3 (ciudad) if set, else admin2 (municipio) — MX place names are colonias.
//          IN JP AU TR PT admin2 (district / shi / LGA / ilçe / concelho) if set, else the place name — their
//                        place names are post offices, neighbourhoods, suburbs or streets.
//          all others    the place name (US: '65101' -> Jefferson City).
// AMBIGUITY  one postal key -> several GeoNames rows: the derived (state, city) pairs of that key are tallied and the
//          most frequent pair wins; a tie goes to the pair seen first in GeoNames file order.
// ZIP NORMALIZATION  key = upper-case, every non [A-Z0-9] removed; empty or all-zero -> invalid. Per dataset country:
//          US / PR  ZIP or ZIP+4 -> first 5 digits; 3-4 digits -> left-padded with 0 (Excel-dropped zeros); else a lone
//                   5-digit group in the text ('TX 75704-4047' -> 75704). A US miss is retried in PR.
//          MX       4-5 digits -> left-padded to 5.          CA  the FSA (first 3 chars, A9A) of the value or of its
//                   first token that starts with A9A ('AB T5X 3N1' -> T5X).
//          GB       full postcode -> outward code (drop the last 3 chars); outward-only as is; else the first token that
//                   is an outward code ('B36 0' -> B36). GeoNames GB.txt holds outward codes only.
//          BR       8-digit CEP exact, else its 5-digit prefix + '000' (GeoNames BR has city-level CEPs only).
//          others   exact key, else the longest prefix of the key that is a postal key of that country.
// COUNTRY  the ticket's country code (UK -> GB, UAE -> AE). Missing / 'Unknown' / not in the dataset: the zip alone
//          decides only when unambiguous — a full Canadian postal code (A9A9A9) -> CA; every other format -> Unknown.
// UNKNOWN  'Unknown' for state and / or city when the zip is missing / invalid / a placeholder, the country has no
//          dataset file, or nothing matches; a matched row with no derived city -> known state + city 'Unknown';
//          a row with no admin1 name (US APO / FPO military codes) -> 'Unknown' for both.
'use strict';
const fs = require('fs');
const path = require('path');

const UNKNOWN = 'Unknown';
const DATA_DIR = path.join(__dirname, 'data', 'geonames');
const COUNTRY_ALIAS = { UK: 'GB', UAE: 'AE' };
const ADMIN2_CITY = new Set(['IN', 'JP', 'AU', 'TR', 'PT']);
const STATE_ALIAS = { MX: { 'Distrito Federal': 'Ciudad de México' } };
const STRICT_KEYS = new Set(['US', 'PR', 'MX', 'CA', 'GB', 'BR']);   // no generic prefix fallback
const AMBIGUITY_RULE = 'When one postal code maps to several GeoNames places, the (state, city) pair that occurs most often for that code wins; a tie goes to the pair listed first in the GeoNames file.';
const CA_FULL_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;
const CA_FSA_RE = /^[A-Z]\d[A-Z]/;
const GB_FULL_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const GB_OUT_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/;

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const keyOf = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const NON_KEY_RE = /[^A-Z0-9]/;
// GeoNames fields are already single-spaced; trim() is enough on the hot load path.
const field = s => (s ? s.trim() : '');

function cityOf(cc, c) {
  const place = field(c[2]), a2 = field(c[5]), a3 = field(c[7]);
  if (cc === 'CA') {
    if (a2) return a2;
    const m = place.match(/\(([^)]*)\)/);
    if (m && m[1].indexOf('/') < 0 && clean(m[1])) return clean(m[1]);
    return clean(place.replace(/\([^)]*\)/g, ''));
  }
  if (cc === 'MX') return a3 || a2;
  if (ADMIN2_CITY.has(cc)) return a2 || place;
  return place;
}
function stateOf(cc, c) {
  const s = field(c[3]);
  const alias = STATE_ALIAS[cc];
  return alias && alias[s] ? alias[s] : s;
}

// ---- Build the index (once, at require time) ----
// Fast path: data/geonames/zip-geo-index.json — the derived key -> (state, city) winners, prebuilt from the pinned
// <CC>.txt files by `node zip-geo.js --build`. It is used only when its `sources` (txt sha256 per country) equal
// SOURCES.json and its `derive` equals DERIVE_VERSION; otherwise the raw <CC>.txt files are parsed (slower, same result).
const DERIVE_VERSION = 2;   // bump when cityOf / stateOf / the key rule / the ambiguity rule change
const INDEX_FILE = path.join(DATA_DIR, 'zip-geo-index.json');
const INDEX = new Map();     // cc -> Map(key -> { state, city })
const KEY_LENS = new Map();  // cc -> distinct key lengths, longest first
const STATS = { loadMs: 0, from: 'none', countries: {} };
let META = null;

function readSources() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'SOURCES.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}
function sourceShas(src) {
  const out = {};
  ((src && src.files) || []).forEach(f => { if (f && f.cc) out[f.cc] = String(f.txtSha256 || ''); });
  return out;
}
// One GeoNames <CC>.txt -> Map(key -> { state, city }) with the ambiguity rule applied.
function parseCountryFile(cc, file) {
  const tally = new Map();   // key -> { first: pair, more: Map(pk -> pair) | null }; pair = { state, city, pk, n, order }
  let order = 0;
  const text = fs.readFileSync(file, 'utf8');
  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos); if (end < 0) end = text.length;
    const line = text.slice(pos, end); pos = end + 1;
    if (!line) continue;
    const c = line.split('\t');
    let key = (c[1] || '').toUpperCase();
    if (NON_KEY_RE.test(key)) key = key.replace(/[^A-Z0-9]/g, '');
    if (!key) continue;
    // No admin1 name (e.g. US APO / FPO military codes) -> the row places nothing: Unknown / Unknown.
    const state = stateOf(cc, c) || UNKNOWN, city = state === UNKNOWN ? UNKNOWN : (cityOf(cc, c) || UNKNOWN);
    const pk = state + '\u0001' + city;
    const t = tally.get(key);
    if (!t) { tally.set(key, { first: { state, city, pk, n: 1, order: order++ }, more: null }); continue; }
    if (t.first.pk === pk) { t.first.n++; continue; }
    if (!t.more) t.more = new Map();
    const p = t.more.get(pk);
    if (p) p.n++; else t.more.set(pk, { state, city, pk, n: 1, order: order++ });
  }
  const idx = new Map();
  tally.forEach((t, key) => {
    let best = t.first;
    if (t.more) t.more.forEach(p => { if (p.n > best.n || (p.n === best.n && p.order < best.order)) best = p; });
    idx.set(key, { state: best.state, city: best.city });
  });
  return idx;
}
function parseRawFiles() {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(DATA_DIR).filter(f => /^[A-Z]{2}\.txt$/.test(f)).sort(); } catch (e) { files = []; }
  files.forEach(f => { out.set(f.slice(0, 2), parseCountryFile(f.slice(0, 2), path.join(DATA_DIR, f))); });
  return out;
}
// Compact JSON form: per country a name table, the keys (space-joined) and per key a pair index.
function serializeIndex(map, shas) {
  const countries = {};
  map.forEach((idx, cc) => {
    const names = [], nameAt = new Map(), pairs = [], pairAt = new Map(), keys = [], vals = [];
    const nameId = s => { let i = nameAt.get(s); if (i === undefined) { i = names.length; names.push(s); nameAt.set(s, i); } return i; };
    idx.forEach((g, key) => {
      const pk = g.state + '\u0001' + g.city;
      let p = pairAt.get(pk);
      if (p === undefined) { p = pairs.length / 2; pairs.push(nameId(g.state), nameId(g.city)); pairAt.set(pk, p); }
      keys.push(key); vals.push(p);
    });
    countries[cc] = { names, pairs, keys: keys.join(' '), vals };
  });
  return { derive: DERIVE_VERSION, built: new Date().toISOString().slice(0, 10), sources: shas, ambiguityRule: AMBIGUITY_RULE, countries };
}
function deserializeIndex(j) {
  const out = new Map();
  Object.keys(j.countries || {}).sort().forEach(cc => {
    const c = j.countries[cc], pairObjs = [];
    for (let i = 0; i < c.pairs.length; i += 2) pairObjs.push(Object.freeze({ state: c.names[c.pairs[i]], city: c.names[c.pairs[i + 1]] }));
    const keys = c.keys ? c.keys.split(' ') : [], idx = new Map();
    for (let i = 0; i < keys.length; i++) idx.set(keys[i], pairObjs[c.vals[i]]);
    out.set(cc, idx);
  });
  return out;
}
function sameShas(a, b) {
  const ka = Object.keys(a || {}).sort(), kb = Object.keys(b || {}).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
(function load() {
  const t0 = Date.now();
  if (!fs.existsSync(DATA_DIR)) {
    console.warn('zip-geo: no GeoNames data in ' + DATA_DIR + ' — every state / city will be Unknown.');
    return;
  }
  const shas = sourceShas(readSources());
  let map = null;
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    if (j && j.derive === DERIVE_VERSION && sameShas(j.sources, shas)) { map = deserializeIndex(j); STATS.from = 'index'; }
    else console.warn('zip-geo: ' + path.basename(INDEX_FILE) + ' is stale — parsing the GeoNames files (run `node zip-geo.js --build` to refresh it).');
  } catch (e) { /* no prebuilt index: parse the raw files */ }
  if (!map) { map = parseRawFiles(); STATS.from = 'raw'; }
  map.forEach((idx, cc) => {
    INDEX.set(cc, idx);
    const lens = new Set();
    idx.forEach((g, key) => lens.add(key.length));
    KEY_LENS.set(cc, Array.from(lens).sort((a, b) => b - a));
    STATS.countries[cc] = idx.size;
  });
  STATS.loadMs = Date.now() - t0;
  const keys = Object.values(STATS.countries).reduce((a, b) => a + b, 0);
  console.log('zip-geo: loaded ' + INDEX.size + ' countries / ' + keys + ' postal keys (' + STATS.from + ') in ' + STATS.loadMs + ' ms');
})();

// Ticket country (+ zip, for inference) -> GeoNames country code with a loaded file, or ''.
function datasetCountry(ticketCountry, rawZip) {
  let c = clean(ticketCountry).toUpperCase();
  c = COUNTRY_ALIAS[c] || c;
  if (INDEX.has(c)) return c;
  if ((!c || c === 'UNKNOWN') && INDEX.has('CA') && CA_FULL_RE.test(keyOf(rawZip))) return 'CA';
  return '';
}

// Raw zip -> lookup key for a dataset country, or '' (invalid / placeholder).
function normalizeZip(cc, rawZip) {
  const s = String(rawZip == null ? '' : rawZip).toUpperCase();
  const key = keyOf(s);
  if (!key || /^0+$/.test(key)) return '';
  const tokens = s.split(/[^A-Z0-9]+/).filter(Boolean);
  switch (cc) {
    case 'US': case 'PR': {
      if (/^\d{5}(\d{4})?$/.test(key)) return key.slice(0, 5);
      if (/^\d{3,4}$/.test(key)) return key.padStart(5, '0');
      const m = s.match(/(?:^|[^0-9])(\d{5})(?:-\d{4})?(?![0-9])/);
      return m && !/^0+$/.test(m[1]) ? m[1] : '';
    }
    case 'MX': return /^\d{4,5}$/.test(key) ? key.padStart(5, '0') : '';
    case 'CA': {
      if (CA_FSA_RE.test(key)) return key.slice(0, 3);
      const t = tokens.find(x => CA_FSA_RE.test(x));
      return t ? t.slice(0, 3) : '';
    }
    case 'GB': {
      if (GB_FULL_RE.test(key)) return key.slice(0, -3);
      if (GB_OUT_RE.test(key)) return key;
      return tokens.find(x => GB_OUT_RE.test(x)) || '';
    }
    case 'BR':
      if (/^\d{8}$/.test(key)) return key;
      return /^\d{5}$/.test(key) ? key + '000' : '';
    default: return key;
  }
}

function lookup(cc, key) {
  const idx = INDEX.get(cc);
  if (!idx || !key) return null;
  const hit = idx.get(key);
  if (hit) return hit;
  if (cc === 'BR') return idx.get(key.slice(0, 5) + '000') || null;
  if (STRICT_KEYS.has(cc)) return null;
  for (const len of KEY_LENS.get(cc) || []) {
    if (len >= key.length) continue;
    const p = idx.get(key.slice(0, len));
    if (p) return p;
  }
  return null;
}

const UNKNOWN_GEO = Object.freeze({ state: UNKNOWN, city: UNKNOWN });
const memo = new Map();
// (ticket country, raw zip) -> { state, city } — each a name or 'Unknown'. Memoized.
function geoOf(ticketCountry, rawZip) {
  const mk = String(ticketCountry == null ? '' : ticketCountry) + '|' + String(rawZip == null ? '' : rawZip);
  let g = memo.get(mk);
  if (g) return g;
  g = UNKNOWN_GEO;
  const cc = datasetCountry(ticketCountry, rawZip);
  if (cc) {
    let hit = lookup(cc, normalizeZip(cc, rawZip));
    if (!hit && cc === 'US' && INDEX.has('PR')) hit = lookup('PR', normalizeZip('PR', rawZip));
    if (hit) g = hit;
  }
  memo.set(mk, g);
  return g;
}

// Dataset description for the API payload / page attribution.
function geoMeta() {
  if (!META) {
    const src = readSources() || {};
    META = {
      source: src.source || 'GeoNames postal code dump',
      url: src.baseUrl || 'https://download.geonames.org/export/zip/',
      license: src.license || 'CC BY 4.0',
      licenseUrl: src.licenseUrl || 'https://creativecommons.org/licenses/by/4.0/',
      downloaded: src.downloaded || null,
      countries: Array.from(INDEX.keys()),
      ambiguityRule: AMBIGUITY_RULE,
    };
  }
  return Object.assign({}, META, { countries: META.countries.slice() });
}
function stats() { return { loadMs: STATS.loadMs, from: STATS.from, countries: Object.assign({}, STATS.countries) }; }

// CLI: `node zip-geo.js --build` rewrites data/geonames/zip-geo-index.json from the raw <CC>.txt files.
if (require.main === module && process.argv.indexOf('--build') >= 0) {
  const t0 = Date.now();
  const j = serializeIndex(parseRawFiles(), sourceShas(readSources()));
  fs.writeFileSync(INDEX_FILE, JSON.stringify(j));
  console.log('zip-geo: wrote ' + INDEX_FILE + ' (' + Object.keys(j.countries).length + ' countries) in ' + (Date.now() - t0) + ' ms');
}

module.exports = { UNKNOWN, AMBIGUITY_RULE, datasetCountry, normalizeZip, geoOf, geoMeta, stats };
