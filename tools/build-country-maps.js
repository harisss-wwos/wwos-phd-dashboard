#!/usr/bin/env node
// build-country-maps.js — builds maps/<ISO2>.svg (one state / province map per country) for the Incident
// Explorer from Natural Earth Admin 1 (1:10m, public domain), and rewrites maps/README.md.
//
// Run from anywhere:  node tools/build-country-maps.js [--src <geojson>] [--only US,IN] [--keep-temp] [--dry-run]
//                                                       [--mapshaper-dir <dir with node_modules/mapshaper>]
//   1. Downloads the pinned Natural Earth GeoJSON (~41 MB) into a temp folder (os.tmpdir()/phd-state-maps-*),
//      unless --src points at a local copy.
//   2. Installs mapshaper@0.8.9 into that temp folder (never into a package.json, never deployed), unless
//      --mapshaper-dir points at an existing install.
//   3. Per country: selects the features, groups / dissolves them to the explorer's State level (the GeoNames
//      admin1 level of server/data/geonames/<CC>.txt), projects, places insets, simplifies (topology-aware,
//      in mapshaper), fits into a 1000 x 650 viewBox and writes the SVG itself (own attributes and escaping).
//   4. Matches every GeoNames admin1 name (= every State name the explorer can show) to one region and bakes
//      the names into the path as data-states="a|b". Fails on an ambiguous / conflicting / unexpected match.
//   5. Projects every explorer City of the country (server/zip-geo.js cityPoints) with the same projection, inset
//      move and fit, into maps/<ISO2>-cities.json (see buildCities).
//   6. Validates (region count, ids, non-empty paths, size budget), writes the files, rewrites maps/README.md.
//   The temp folder is always deleted at the end unless --keep-temp is passed.
// No dependencies of its own (Node >= 18: fetch, crypto, fs, child_process).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const zipGeo = require('../server/zip-geo');   // city list + lat / lon for maps/<ISO2>-cities.json

const NE_VERSION = '5.1.2';
const SRC_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v' + NE_VERSION + '/geojson/ne_10m_admin_1_states_provinces.geojson';
const MAPSHAPER = 'mapshaper@0.8.9';
const LICENCE = 'Public domain (Natural Earth terms of use: https://www.naturalearthdata.com/about/terms-of-use/)';
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'maps');
const GEONAMES_DIR = path.join(ROOT, 'server', 'data', 'geonames');
const VIEW_W = 1000, VIEW_H = 650, MARGIN = 8;
const BUDGET = { US: 150 * 1024, other: 100 * 1024, total: 1200 * 1024 };
const MIN_RING_PX2 = 0.5;
// Copied from server/zip-geo.js (STATE_ALIAS): the explorer shows these GeoNames admin1 names renamed.
const STATE_ALIAS = { MX: { 'Distrito Federal': 'Ciudad de México' } };

// ---- Per-country configuration --------------------------------------------------------------------------
// adm0: Natural Earth adm0_a3 values. files: GeoNames files whose admin1 names are the explorer's State names.
// group(p): region key of a Natural Earth feature (default: its iso_3166_2). regions: dissolved regions
// {key: {name, alt[]}} (key = ISO 3166-2). rename: display-name overrides for as-is regions {iso: name}.
// isoOverride: {neIso: newIso} for outdated Natural Earth codes. exclude: [{iso|name, why}]. drop: lon/lat
// boxes [w,s,e,n] — polygons whose bbox centre falls inside are removed (remote islets). insets: [{keys,
// place, scale}]. codeMatch: GeoNames admin1 code === ISO 3166-2 suffix. alias: explorer name -> region key.
// fileRegion: every name of that GeoNames file (not already a name of another file) -> one region.
// expectUnmatched: {name: why}. simplifyPx: simplification interval in output pixels.
const IT_REGIONS = {
  'IT-21': 'Piemonte', 'IT-23': "Valle d'Aosta", 'IT-25': 'Lombardia', 'IT-32': 'Trentino-Alto Adige', 'IT-34': 'Veneto',
  'IT-36': 'Friuli-Venezia Giulia', 'IT-42': 'Liguria', 'IT-45': 'Emilia-Romagna', 'IT-52': 'Toscana', 'IT-55': 'Umbria',
  'IT-57': 'Marche', 'IT-62': 'Lazio', 'IT-65': 'Abruzzo', 'IT-67': 'Molise', 'IT-72': 'Campania', 'IT-75': 'Puglia',
  'IT-77': 'Basilicata', 'IT-78': 'Calabria', 'IT-82': 'Sicilia', 'IT-88': 'Sardegna',
};
const FR_REGIONS = {
  'FR-ARA': 'Auvergne-Rhône-Alpes', 'FR-BFC': 'Bourgogne-Franche-Comté', 'FR-BRE': 'Bretagne', 'FR-CVL': 'Centre-Val de Loire',
  'FR-COR': 'Corse', 'FR-GES': 'Grand Est', 'FR-HDF': 'Hauts-de-France', 'FR-IDF': 'Île-de-France', 'FR-NOR': 'Normandie',
  'FR-NAQ': 'Nouvelle-Aquitaine', 'FR-OCC': 'Occitanie', 'FR-PDL': 'Pays de la Loire', 'FR-PAC': "Provence-Alpes-Côte d'Azur",
};
const FR_OVERSEAS = ['FR-GF', 'FR-MQ', 'FR-GP', 'FR-RE', 'FR-YT'];
// Natural Earth `region` (autonomous community) -> ISO 3166-2. Ceuta and Melilla share region_cod ES.CE, so they
// are keyed by their own iso_3166_2.
const ES_BY_NE_REGION = {
  'Andalucía': 'ES-AN', 'Aragón': 'ES-AR', 'Asturias': 'ES-AS', 'Islas Baleares': 'ES-IB', 'Canary Is.': 'ES-CN', 'Cantabria': 'ES-CB',
  'Castilla-La Mancha': 'ES-CM', 'Castilla y León': 'ES-CL', 'Cataluña': 'ES-CT', 'Valenciana': 'ES-VC', 'Extremadura': 'ES-EX',
  'Galicia': 'ES-GA', 'La Rioja': 'ES-RI', 'Madrid': 'ES-MD', 'Murcia': 'ES-MC', 'Foral de Navarra': 'ES-NC', 'País Vasco': 'ES-PV',
};
const ES_REGIONS = {
  'ES-AN': 'Andalucía', 'ES-AR': 'Aragón', 'ES-AS': 'Asturias', 'ES-IB': 'Illes Balears', 'ES-CN': 'Canarias', 'ES-CB': 'Cantabria',
  'ES-CM': 'Castilla-La Mancha', 'ES-CL': 'Castilla y León', 'ES-CT': 'Cataluña', 'ES-CE': 'Ceuta', 'ES-ML': 'Melilla',
  'ES-VC': 'Comunitat Valenciana', 'ES-EX': 'Extremadura', 'ES-GA': 'Galicia', 'ES-RI': 'La Rioja', 'ES-MD': 'Comunidad de Madrid',
  'ES-MC': 'Región de Murcia', 'ES-NC': 'Navarra', 'ES-PV': 'País Vasco',
};
// Ireland: county (Natural Earth iso_3166_2) -> province. Ulster here = the 3 counties in the Republic.
const IE_PROVINCE = {
  G: 'IE-C', LM: 'IE-C', MO: 'IE-C', RN: 'IE-C', SO: 'IE-C',
  CN: 'IE-U', DL: 'IE-U', MN: 'IE-U',
  CE: 'IE-M', CO: 'IE-M', KY: 'IE-M', LK: 'IE-M', TA: 'IE-M', WD: 'IE-M',
  CW: 'IE-L', D: 'IE-L', KE: 'IE-L', KK: 'IE-L', LS: 'IE-L', LD: 'IE-L', LH: 'IE-L', MH: 'IE-L', OY: 'IE-L', WH: 'IE-L', WX: 'IE-L', WW: 'IE-L',
};
// Norway: Natural Earth has the 19 pre-2018 counties; GeoNames (the explorer) has the 15 counties of 2024.
const NO_COUNTY = {
  'NO-01': 'NO-31', 'NO-02': 'NO-32', 'NO-03': 'NO-03', 'NO-04': 'NO-34', 'NO-05': 'NO-34', 'NO-06': 'NO-33', 'NO-07': 'NO-39',
  'NO-08': 'NO-40', 'NO-09': 'NO-42', 'NO-10': 'NO-42', 'NO-11': 'NO-11', 'NO-12': 'NO-46', 'NO-14': 'NO-46', 'NO-15': 'NO-15',
  'NO-16': 'NO-50', 'NO-17': 'NO-50', 'NO-18': 'NO-18', 'NO-19': 'NO-55', 'NO-20': 'NO-56',
};
const NO_REGIONS = {
  'NO-31': 'Østfold', 'NO-32': 'Akershus', 'NO-03': 'Oslo', 'NO-34': 'Innlandet', 'NO-33': 'Buskerud', 'NO-39': 'Vestfold',
  'NO-40': 'Telemark', 'NO-42': 'Agder', 'NO-11': 'Rogaland', 'NO-46': 'Vestland', 'NO-15': 'Møre og Romsdal', 'NO-50': 'Trøndelag',
  'NO-18': 'Nordland', 'NO-55': 'Troms', 'NO-56': 'Finnmark',
};
const regionTable = o => { const r = {}; Object.keys(o).forEach(k => { r[k] = { name: o[k] }; }); return r; };
const PR_WHY = 'Puerto Rico municipality (US tickets whose zip resolves through the US -> PR fallback)';

const COUNTRIES = [
  { iso2: 'US', name: 'United States', adm0: ['USA', 'PRI'], files: ['US', 'PR'], unit: 'states', count: 52,
    level: '50 states + District of Columbia + Puerto Rico (one region)', proj: 'albersusa +PR', codeMatch: true,
    drop: [[-180, 50, -172.3, 56], [172, 50, 180, 56], [-179, 22.6, -160.6, 29]],
    fileRegion: { PR: 'US-PR' }, expectUnmatched: { 'Marshall Islands': 'GeoNames lists it as a US admin1; not a US state, no shape' } },
  { iso2: 'GB', name: 'United Kingdom', adm0: ['GBR'], files: ['GB'], unit: 'countries', count: 4,
    level: 'the 4 countries (Natural Earth counties / unitary authorities dissolved by geonunit)', codeMatch: true,
    drop: [[-14, 57, -13, 58.2]],
    group: p => ({ England: 'GB-ENG', Scotland: 'GB-SCT', Wales: 'GB-WLS', 'Northern Ireland': 'GB-NIR' })[p.geonunit],
    regions: { 'GB-ENG': { name: 'England' }, 'GB-SCT': { name: 'Scotland' }, 'GB-WLS': { name: 'Wales' }, 'GB-NIR': { name: 'Northern Ireland' } } },
  { iso2: 'CA', name: 'Canada', adm0: ['CAN'], files: ['CA'], unit: 'provinces / territories', count: 13,
    level: '13 provinces / territories (as is)', codeMatch: true, nameField: 'name_en' },
  { iso2: 'IN', name: 'India', adm0: ['IND'], files: ['IN'], unit: 'states / UTs', count: 35,
    level: 'states / union territories (Ladakh dissolved into Jammu and Kashmir, as GeoNames has no Ladakh)',
    group: p => (p.iso_3166_2 === 'IN-LA' ? 'IN-JK' : p.iso_3166_2),
    rename: { 'IN-JK': 'Jammu and Kashmir (incl. Ladakh)', 'IN-AN': 'Andaman and Nicobar Islands' } },
  { iso2: 'AU', name: 'Australia', adm0: ['AUS'], files: ['AU'], unit: 'states / territories', count: 8,
    level: '8 states / territories (as is)', codeMatch: true,
    exclude: [{ iso: 'AU-X02~', why: 'Jervis Bay Territory: not a state; GeoNames has no admin1 for it' },
      { iso: 'AU-X03~', why: 'Macquarie Island: remote sub-Antarctic island' },
      { name: 'Lord Howe Island', why: 'remote island of NSW, 600 km offshore' }] },
  { iso2: 'DE', name: 'Germany', adm0: ['DEU'], files: ['DE'], unit: 'Länder', count: 16,
    level: '16 Länder (as is)', codeMatch: true, nameField: 'name_en' },
  { iso2: 'JP', name: 'Japan', adm0: ['JPN'], files: ['JP'], unit: 'prefectures', count: 47,
    level: '47 prefectures (as is)', stripSuffix: / (Ken|Fu|To)$/, alias: { 'Gumma Ken': 'JP-10' },
    drop: [[135, 19, 155, 31.9]] },
  { iso2: 'MX', name: 'Mexico', adm0: ['MEX'], files: ['MX'], unit: 'states', count: 32,
    level: '32 states (as is)', isoOverride: { 'MX-DIF': 'MX-CMX' }, rename: { 'MX-CMX': 'Ciudad de México' },
    exclude: [{ iso: 'MX-X01~', why: 'unnamed Natural Earth feature, not a state' }],
    drop: [[-115.5, 17.5, -110.5, 19.7], [-118.6, 28.6, -117.8, 29.4]],
    alias: { 'Coahuila de Zaragoza': 'MX-COA', 'Michoacán de Ocampo': 'MX-MIC', 'Veracruz de Ignacio de la Llave': 'MX-VER',
      'México': 'MX-MEX', 'Ciudad de México': 'MX-CMX' } },
  { iso2: 'IT', name: 'Italy', adm0: ['ITA'], files: ['IT'], unit: 'regions', count: 20,
    level: '20 regions (Natural Earth provinces dissolved by region_cod)',
    group: p => String(p.region_cod || '').trim(), regions: regionTable(IT_REGIONS), alias: { 'Abruzzi': 'IT-65' } },
  { iso2: 'FR', name: 'France', adm0: ['FRA'], files: ['FR'], unit: 'regions', count: 13,
    level: '13 metropolitan regions (Natural Earth départements dissolved by region_cod; overseas excluded)',
    group: p => String(p.region_cod || '').trim(), regions: regionTable(FR_REGIONS),
    exclude: FR_OVERSEAS.map(i => ({ iso: i, why: 'overseas département: not in the GeoNames FR file' })) },
  { iso2: 'EG', name: 'Egypt', adm0: ['EGY'], files: [], unit: 'governorates', count: 27,
    level: '27 governorates (as is; no GeoNames data, every ticket is Unknown state)', nameField: 'name_en' },
  { iso2: 'BR', name: 'Brazil', adm0: ['BRA'], files: ['BR'], unit: 'states', count: 27,
    level: '26 states + Distrito Federal (as is)', rename: { 'BR-DF': 'Distrito Federal' }, drop: [[-31, -25, -27, 2]] },
  { iso2: 'ES', name: 'Spain', adm0: ['ESP'], files: ['ES'], unit: 'communities', count: 19,
    level: '17 autonomous communities + Ceuta + Melilla (Natural Earth provinces dissolved by region)', codeMatch: true,
    group: p => (p.iso_3166_2 === 'ES-CE' || p.iso_3166_2 === 'ES-ML' ? p.iso_3166_2 : ES_BY_NE_REGION[String(p.region || '').trim()]),
    regions: regionTable(ES_REGIONS), insets: [{ keys: ['ES-CN'], place: 'bottom-left', scale: 1 }] },
  { iso2: 'SA', name: 'Saudi Arabia', adm0: ['SAU'], files: [], unit: 'regions', count: 13,
    level: '13 regions (as is; no GeoNames data, every ticket is Unknown state)', nameField: 'name_en' },
  { iso2: 'AE', name: 'United Arab Emirates', adm0: ['ARE'], files: [], unit: 'emirates', count: 7,
    level: '7 emirates (as is; no GeoNames data, every ticket is Unknown state)',
    rename: { 'AE-AZ': 'Abu Dhabi', 'AE-AJ': 'Ajman', 'AE-DU': 'Dubai', 'AE-FU': 'Fujairah', 'AE-RK': 'Ras Al Khaimah', 'AE-SH': 'Sharjah', 'AE-UQ': 'Umm Al Quwain' },
    exclude: [{ iso: 'AE-X01~', why: 'shared "Neutral Zone", not an emirate' }, { iso: 'AE-X02~', why: 'shared "Neutral Zone", not an emirate' }] },
  { iso2: 'BE', name: 'Belgium', adm0: ['BEL'], files: ['BE'], unit: 'regions', count: 3,
    level: '3 regions (Natural Earth provinces dissolved by region)', codeMatch: true,
    group: p => ({ Flemish: 'BE-VLG', Walloon: 'BE-WAL', 'Capital Region': 'BE-BRU' })[String(p.region || '').trim()],
    regions: { 'BE-VLG': { name: 'Vlaanderen', alt: ['Flanders', 'Flemish Region'] }, 'BE-WAL': { name: 'Wallonie', alt: ['Wallonia', 'Walloon Region'] },
      'BE-BRU': { name: 'Bruxelles-Capitale', alt: ['Brussels-Capital Region', 'Brussels'] } } },
  { iso2: 'NL', name: 'Netherlands', adm0: ['NLD'], files: ['NL'], unit: 'provinces', count: 12,
    level: '12 provinces (as is; Caribbean Netherlands excluded)', alias: { 'Guelders': 'NL-GE' },
    exclude: ['NL-BQ1', 'NL-BQ2', 'NL-BQ3'].map(i => ({ iso: i, why: 'Caribbean special municipality: not in the GeoNames NL file' })) },
  { iso2: 'AT', name: 'Austria', adm0: ['AUT'], files: [], unit: 'Länder', count: 9,
    level: '9 Länder (as is; AT is not in the GeoNames dataset, every ticket is Unknown state)', nameField: 'name_en' },
  { iso2: 'IE', name: 'Ireland', adm0: ['IRL'], files: ['IE'], unit: 'provinces', count: 4,
    level: '4 provinces (Natural Earth counties dissolved by a county -> province table)', codeMatch: true,
    group: p => IE_PROVINCE[String(p.iso_3166_2 || '').replace(/^IE-/, '')],
    regions: { 'IE-C': { name: 'Connacht' }, 'IE-L': { name: 'Leinster' }, 'IE-M': { name: 'Munster' }, 'IE-U': { name: 'Ulster' } } },
  { iso2: 'NO', name: 'Norway', adm0: ['NOR'], files: ['NO'], unit: 'counties', count: 15,
    level: '15 counties of 2024 (Natural Earth\'s 19 pre-2018 counties dissolved by a county table; Svalbard excluded)',
    group: p => NO_COUNTY[p.iso_3166_2], regions: regionTable(NO_REGIONS), alias: { 'Oslo County': 'NO-03' },
    exclude: [{ iso: 'NO-21', why: 'Svalbard: not in the GeoNames NO file' }, { iso: 'NO-X01~', why: 'Bouvet Island: sub-Antarctic' }] },
  { iso2: 'PT', name: 'Portugal', adm0: ['PRT'], files: ['PT'], unit: 'districts / regions', count: 20,
    level: '18 districts + Azores + Madeira (as is)',
    insets: [{ keys: ['PT-20'], place: 'left-top', scale: 0.55 }, { keys: ['PT-30'], place: 'left-bottom', scale: 1 }] },
  { iso2: 'TR', name: 'Türkiye', adm0: ['TUR'], files: ['TR'], unit: 'provinces', count: 81,
    level: '81 provinces (as is)', nameField: 'name_en', alias: { 'Mersin(İçel)': 'TR-33' },
    expectUnmatched: { 'Kktc': 'Northern Cyprus (KKTC): not part of Türkiye on the map' } },
];

// ---- Pure helpers (exported for tests) -------------------------------------------------------------------
// Fold a name for matching: accents off, Turkish dotless i, lower case, '&' -> 'and', only [a-z0-9].
function fold(s, stripSuffix) {
  let t = String(s == null ? '' : s).trim();
  if (stripSuffix) t = t.replace(stripSuffix, '');
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'I');
  return t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}
function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}
// Number in tenths of a pixel -> shortest text ('.5', '-1.2', '3').
function fmt(t) { let s = String(t / 10); if (s.startsWith('0.')) s = s.slice(1); else if (s.startsWith('-0.')) s = '-' + s.slice(2); return s; }
function joinNums(nums) { let out = ''; nums.forEach((n, i) => { const s = fmt(n); out += (i && s[0] !== '-' ? ' ' : '') + s; }); return out; }
// Rings of integer tenths [[x,y],...] (closed or not) -> path data: absolute M, relative l, z.
function ringsToPath(rings) {
  let d = '';
  rings.forEach(r => {
    if (!r || r.length < 3) return;
    const nums = [];
    for (let i = 1; i < r.length; i++) nums.push(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    d += 'M' + joinNums([r[0][0], r[0][1]]) + (nums.length ? 'l' + joinNums(nums) : '') + 'z';
  });
  return d;
}
function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2; }

// Explorer State names -> region keys. universe: [{name, code, file}]; regions: [{key, cands[]}].
// Returns { map: {name: key}, how: {name: 'code'|'name'|'alias'|'file'}, unmatched: [{name, why}], problems: [] }.
function matchNames(cfg, universe, regions) {
  const cc = cfg.iso2, keys = new Set(regions.map(r => r.key)), byFold = new Map(), problems = [];
  regions.forEach(r => r.cands.forEach(c => {
    const f = fold(c, cfg.stripSuffix); if (!f) return;
    if (!byFold.has(f)) byFold.set(f, new Set());
    byFold.get(f).add(r.key);
  }));
  Object.keys(cfg.alias || {}).forEach(a => { if (!keys.has(cfg.alias[a])) problems.push(cc + ': alias "' + a + '" points at missing region ' + cfg.alias[a]); });
  Object.keys(cfg.fileRegion || {}).forEach(f => { if (!keys.has(cfg.fileRegion[f])) problems.push(cc + ': fileRegion ' + f + ' points at missing region ' + cfg.fileRegion[f]); });
  const map = {}, how = {}, unmatched = [];
  universe.forEach(u => {
    const name = u.name;
    if (name.indexOf('|') >= 0) { problems.push(cc + ': explorer name "' + name + '" contains "|"'); return; }
    if (cfg.alias && cfg.alias[name]) { map[name] = cfg.alias[name]; how[name] = 'alias'; return; }
    if (cfg.fileRegion && cfg.fileRegion[u.file]) { map[name] = cfg.fileRegion[u.file]; how[name] = 'file'; return; }
    const hits = byFold.get(fold(name, cfg.stripSuffix));
    const hitList = hits ? Array.from(hits).sort() : [];
    const codeKey = cfg.codeMatch && u.code ? cc + '-' + u.code.toUpperCase() : '';
    if (codeKey && keys.has(codeKey)) {
      if (hitList.length && hitList.indexOf(codeKey) < 0) problems.push(cc + ': "' + name + '" code says ' + codeKey + ' but the name says ' + hitList.join(', '));
      else { map[name] = codeKey; how[name] = 'code'; }
      return;
    }
    if (hitList.length === 1) { map[name] = hitList[0]; how[name] = 'name'; return; }
    if (hitList.length > 1) { problems.push(cc + ': "' + name + '" matches several regions: ' + hitList.join(', ')); return; }
    if (cfg.expectUnmatched && cfg.expectUnmatched[name]) { unmatched.push({ name, why: cfg.expectUnmatched[name] }); return; }
    problems.push(cc + ': explorer name "' + name + '" matches no region');
  });
  return { map, how, unmatched, problems };
}

// GeoNames admin1 names (column 3, trimmed, STATE_ALIAS applied) and codes (column 4) for the country files.
function readUniverse(cfg) {
  const seen = new Map();
  (cfg.files || []).forEach(cc => {
    const file = path.join(GEONAMES_DIR, cc + '.txt');
    const text = fs.readFileSync(file, 'utf8');
    const alias = STATE_ALIAS[cc] || {};
    text.split('\n').forEach(line => {
      const c = line.split('\t'); if (c.length < 5) return;
      let n = c[3].trim(); if (!n) return;
      if (alias[n]) n = alias[n];
      if (!seen.has(n)) seen.set(n, { name: n, code: c[4].trim(), file: cc });
    });
  });
  return Array.from(seen.values()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---- Geometry helpers -------------------------------------------------------------------------------------
function polysOf(geom) { if (!geom) return []; return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []; }
function bboxOfPolys(polys, b) {
  b = b || [Infinity, Infinity, -Infinity, -Infinity];
  polys.forEach(p => p.forEach(r => r.forEach(pt => { if (pt[0] < b[0]) b[0] = pt[0]; if (pt[1] < b[1]) b[1] = pt[1]; if (pt[0] > b[2]) b[2] = pt[0]; if (pt[1] > b[3]) b[3] = pt[1]; })));
  return b;
}
function inBox(x, y, bx) { return x >= bx[0] && x <= bx[2] && y >= bx[1] && y <= bx[3]; }
function dropPolys(geom, boxes) {
  if (!boxes || !boxes.length) return geom;
  const kept = polysOf(geom).filter(p => { const b = bboxOfPolys([p]); const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; return !boxes.some(bx => inBox(cx, cy, bx)); });
  return kept.length ? { type: 'MultiPolygon', coordinates: kept } : null;
}
function mapCoords(geom, fn) { return { type: 'MultiPolygon', coordinates: polysOf(geom).map(p => p.map(r => r.map(fn))) }; }

// ---- Build one country ------------------------------------------------------------------------------------
async function buildCountry(ms, cfg, all, built) {
  const problems = [], excluded = [];
  const ex = cfg.exclude || [];
  const feats = all.filter(f => cfg.adm0.indexOf(f.properties.adm0_a3) >= 0);
  const kept = [], members = {};   // rid -> [Natural Earth features]
  feats.forEach(f => {
    const p = f.properties, iso = String(p.iso_3166_2 || '').trim();
    const x = ex.find(e => (e.iso && e.iso === iso) || (e.name && e.name === p.name));
    if (x) { excluded.push(iso + ' ' + p.name + ' (' + x.why + ')'); return; }
    let rid = cfg.group ? cfg.group(p) : iso;
    if (cfg.isoOverride && cfg.isoOverride[rid]) rid = cfg.isoOverride[rid];
    if (!rid) { problems.push(cfg.iso2 + ': Natural Earth feature ' + iso + ' "' + p.name + '" has no region'); return; }
    const geom = dropPolys(f.geometry, cfg.drop);
    if (!geom) { excluded.push(iso + ' ' + p.name + ' (all parts inside a drop box)'); return; }
    (members[rid] = members[rid] || []).push(p);
    kept.push({ type: 'Feature', properties: { rid }, geometry: geom });
  });
  const rids = Object.keys(members).sort();
  if (cfg.regions) {
    const want = Object.keys(cfg.regions).sort();
    if (rids.join() !== want.join()) problems.push(cfg.iso2 + ': regions ' + rids.join(',') + ' != configured ' + want.join(','));
  }
  if (rids.length !== cfg.count) problems.push(cfg.iso2 + ': ' + rids.length + ' regions, expected ' + cfg.count);
  if (problems.length) return { cfg, problems };

  // Region metadata + match candidates.
  const regions = rids.map(rid => {
    const ps = members[rid], one = ps.length === 1 && !cfg.regions ? ps[0] : null;
    let name = cfg.regions && cfg.regions[rid] ? cfg.regions[rid].name : (cfg.rename && cfg.rename[rid]) || (one && String(one[cfg.nameField || 'name'] || one.name || '').trim()) || rid;
    const cands = [name].concat((cfg.regions && cfg.regions[rid] && cfg.regions[rid].alt) || []);
    if (cfg.regions) ps.forEach(p => { if (p.region) cands.push(String(p.region).trim()); });
    if (!cfg.regions) ps.forEach(p => {
      ['name', 'name_en', 'gn_name', 'woe_name'].forEach(k => { if (p[k]) cands.push(String(p[k]).trim()); });
      String(p.name_alt || '').split('|').forEach(s => { if (s.trim()) cands.push(s.trim()); });
    });
    return { key: rid, iso: rid, name, cands, nNe: ps.length };
  });

  // Name matching.
  const universe = readUniverse(cfg);
  const m = matchNames(cfg, universe, regions);
  problems.push.apply(problems, m.problems);
  const namesOf = {}; rids.forEach(r => { namesOf[r] = []; });
  Object.keys(m.map).sort().forEach(n => namesOf[m.map[n]].push(n));

  // Pass 1: dissolve + project.
  const fc = { type: 'FeatureCollection', features: kept };
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  kept.forEach(f => bboxOfPolys(polysOf(f.geometry), bb));
  const proj = cfg.proj ? '"' + cfg.proj + '"' : '+proj=laea +lat_0=' + ((bb[1] + bb[3]) / 2).toFixed(3) + ' +lon_0=' + ((bb[0] + bb[2]) / 2).toFixed(3) + ' +datum=WGS84';
  let g1;
  try {
    const o = await ms.applyCommands('-i in.json -dissolve rid -proj ' + proj + ' -o out.json format=geojson', { 'in.json': fc });
    g1 = JSON.parse(o['out.json']);
  } catch (e) { return { cfg, problems: [cfg.iso2 + ': mapshaper dissolve/proj failed: ' + (e && e.message)] }; }

  // Insets (projected units): placed next to the mainland bbox, 2% of its width apart. insetTf[rid] keeps each
  // move so the city points of those regions get exactly the same one.
  const insetTf = {};
  if (cfg.insets && cfg.insets.length) {
    const insetKeys = new Set(); cfg.insets.forEach(i => i.keys.forEach(k => insetKeys.add(k)));
    const main = bboxOfPolys([].concat.apply([], g1.features.filter(f => !insetKeys.has(f.properties.rid)).map(f => polysOf(f.geometry))));
    const gap = (main[2] - main[0]) * 0.02;
    cfg.insets.forEach(ins => {
      const fs_ = g1.features.filter(f => ins.keys.indexOf(f.properties.rid) >= 0);
      const b = bboxOfPolys([].concat.apply([], fs_.map(f => polysOf(f.geometry)))), s = ins.scale || 1;
      const w = (b[2] - b[0]) * s, h = (b[3] - b[1]) * s;
      let x0, y0;   // target lower-left
      if (ins.place === 'bottom-left') { x0 = main[0]; y0 = main[1] - gap - h; }
      else if (ins.place === 'left-top') { x0 = main[0] - gap - w; y0 = main[3] - h; }
      else if (ins.place === 'left-bottom') { x0 = main[0] - gap - w; y0 = main[1]; }
      else throw new Error(cfg.iso2 + ': unknown inset place ' + ins.place);
      const tf = pt => [x0 + (pt[0] - b[0]) * s, y0 + (pt[1] - b[1]) * s];
      ins.keys.forEach(k => { insetTf[k] = tf; });
      fs_.forEach(f => { f.geometry = mapCoords(f.geometry, tf); });
    });
  }
  // Fit.
  const fb = bboxOfPolys([].concat.apply([], g1.features.map(f => polysOf(f.geometry))));
  const scale = Math.min((VIEW_W - 2 * MARGIN) / (fb[2] - fb[0]), (VIEW_H - 2 * MARGIN) / (fb[3] - fb[1]));
  const offX = (VIEW_W - (fb[2] - fb[0]) * scale) / 2, offY = (VIEW_H - (fb[3] - fb[1]) * scale) / 2;
  const px = cfg.simplifyPx || 0.6;

  // Pass 2: topology-aware simplification.
  let g2;
  try {
    const o = await ms.applyCommands('-i in.json -simplify visvalingam weighted interval=' + (px / scale).toFixed(3) + ' keep-shapes -o out.json format=geojson', { 'in.json': g1 });
    g2 = JSON.parse(o['out.json']);
  } catch (e) { return { cfg, problems: [cfg.iso2 + ': mapshaper simplify failed: ' + (e && e.message)] }; }

  // To pixels (integer tenths), y flipped; drop tiny rings except each region's largest.
  const toPx = pt => [Math.round((offX + (pt[0] - fb[0]) * scale) * 10), Math.round((offY + (fb[3] - pt[1]) * scale) * 10)];
  const byRid = {};
  g2.features.forEach(f => { byRid[f.properties.rid] = f; });
  const paths = [], ringsOf = {};
  regions.forEach(r => {
    const f = byRid[r.key];
    const rings = [];
    polysOf(f && f.geometry).forEach(p => p.forEach(ring => {
      const out = [];
      ring.map(toPx).forEach(q => { const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); });
      if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
      if (out.length >= 3) rings.push({ r: out, a: Math.abs(ringArea(out)) / 100 });
    }));
    let big = null; rings.forEach(x => { if (!big || x.a > big.a) big = x; });
    const keepRings = rings.filter(x => x === big || x.a >= MIN_RING_PX2).map(x => x.r);
    ringsOf[r.key] = keepRings;
    const d = ringsToPath(keepRings);
    if (!d) problems.push(cfg.iso2 + ': region ' + r.key + ' has an empty path');
    if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(r.iso)) problems.push(cfg.iso2 + ': bad ISO code ' + r.iso);
    paths.push({ r, d, names: namesOf[r.key] });
  });
  const ids = new Set(paths.map(p => p.r.iso));
  if (ids.size !== paths.length) problems.push(cfg.iso2 + ': duplicate region ids');

  // City points (maps/<ISO2>-cities.json): the same projection, inset move and fit as the paths above.
  let cities;
  try { cities = await buildCities(ms, cfg, proj, m.map, insetTf, toPx, ringsOf); }
  catch (e) { return { cfg, problems: [cfg.iso2 + ': city points failed: ' + (e && e.message)] }; }

  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- ' + escXmlComment(cfg.name) + ', ' + escXmlComment(cfg.level) + '. Natural Earth Admin 1 (1:10m) v' + NE_VERSION + ', public domain.\n' +
    '     Built ' + built + ' by tools/build-country-maps.js; see maps/README.md. -->\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '" data-country="' + cfg.iso2 + '" data-name="' + escAttr(cfg.name) + '" data-unit="' + escAttr(cfg.unit) + '">\n' +
    paths.slice().sort((a, b) => (a.r.iso < b.r.iso ? -1 : 1)).map(p => '<path id="sm-' + p.r.iso + '" data-iso="' + p.r.iso + '" data-name="' + escAttr(p.r.name) + '" data-states="' + escAttr(p.names.join('|')) + '" d="' + p.d + '"/>\n').join('') +
    '</svg>\n';
  const bytes = Buffer.byteLength(svg, 'utf8');
  const limit = cfg.iso2 === 'US' ? BUDGET.US : BUDGET.other;
  if (bytes > limit) problems.push(cfg.iso2 + ': ' + bytes + ' bytes is over the ' + limit + '-byte budget; raise its simplifyPx');

  const how = m.how, cnt = { code: 0, name: 0, alias: 0, file: 0 };
  Object.keys(how).forEach(n => { cnt[how[n]]++; });
  return {
    cfg, problems, svg, bytes, excluded, neFeatures: feats.length, cities,
    report: {
      regions: regions.length, universe: universe.length, matched: Object.keys(m.map).length, cnt,
      aliases: Object.keys(how).filter(n => how[n] === 'alias').map(n => n + ' -> ' + m.map[n]),
      fileNames: Object.keys(how).filter(n => how[n] === 'file').length,
      unmatched: m.unmatched, noName: regions.filter(r => !namesOf[r.key].length).map(r => r.iso + ' ' + r.name),
    },
    universe,
  };
}
function escXmlComment(s) { return String(s).replace(/--/g, '- -'); }

// Distance from a point to the nearest edge of rings of [x, y] (same units).
function distToRings(x, y, rings) {
  let best = Infinity;
  (rings || []).forEach(r => {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = r[j][0], ay = r[j][1], dx = r[i][0] - ax, dy = r[i][1] - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      const qx = ax + t * dx - x, qy = ay + t * dy - y, d = Math.sqrt(qx * qx + qy * qy);
      if (d < best) best = d;
    }
  });
  return best;
}
// Even-odd point-in-polygon over rings of [x, y] (any units; used on integer tenths).
function inRings(x, y, rings) {
  let inside = false;
  (rings || []).forEach(r => {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}
// maps/<ISO2>-cities.json: per explorer State name (only names that are on this map), its cities A->Z as
//   { names: 'City A|City B', xy: [xA, yA, xB, yB] } — x / y in tenths of a viewBox unit (the SVG's own space).
// City list and lat / lon: server/zip-geo.js cityPoints() (the explorer's own state / city derivation and
// ambiguity rule, so the names match the explorer's City nodes exactly; the location rule is CITY_POINT_RULE).
// A city is left out of `names` (the page lists it as 'without a known location') when it has no usable
// GeoNames point, its point is inside one of the config's drop boxes (islets not drawn), it cannot be projected,
// it falls outside the viewBox, or it lies more than CITY_MAX_OUT_PX from its own region's drawn shape (a remote
// islet that is not drawn, a GeoNames point that contradicts its state, or the PR municipality 'Florida', which
// the explorer files under the state Florida). US + PR: a (state, city) already taken from US.txt is not re-read
// from PR.txt. stats.outside = placed points just outside their own region's simplified path (coastal points).
const CITY_MAX_OUT_PX = 50;   // viewBox units (5% of the map width)
async function buildCities(ms, cfg, proj, nameToRid, insetTf, toPx, ringsOf) {
  const list = [], seen = new Set(), stats = { cities: 0, placed: 0, noLocation: 0, outside: 0, far: [] };
  (cfg.files || []).forEach(cc => {
    zipGeo.cityPoints(cc).forEach((cs, state) => {
      const rid = nameToRid[state]; if (!rid) return;
      cs.forEach((pt, city) => {
        const pk = state + '\u0001' + city; if (seen.has(pk)) return;
        seen.add(pk); stats.cities++;
        if (!pt || (cfg.drop || []).some(bx => inBox(pt.lon, pt.lat, bx))) { stats.noLocation++; return; }
        list.push({ state, city, rid, lon: pt.lon, lat: pt.lat });
      });
    });
  });
  const byState = {};
  if (list.length) {
    const fc = { type: 'FeatureCollection', features: list.map((c, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })) };
    const o = await ms.applyCommands('-i pts.json -proj ' + proj + ' -o out.json format=geojson', { 'pts.json': fc });
    const got = new Array(list.length).fill(null);
    JSON.parse(o['out.json']).features.forEach(f => { const g = f.geometry; if (g && g.type === 'Point' && isFinite(g.coordinates[0]) && isFinite(g.coordinates[1])) got[f.properties.i] = g.coordinates; });
    list.forEach((c, i) => {
      let q = got[i];
      if (!q) { stats.noLocation++; return; }
      if (insetTf[c.rid]) q = insetTf[c.rid](q);
      const p = toPx(q);
      if (!(p[0] >= 0 && p[0] <= VIEW_W * 10 && p[1] >= 0 && p[1] <= VIEW_H * 10)) { stats.noLocation++; return; }
      if (!inRings(p[0], p[1], ringsOf[c.rid])) {
        const d = distToRings(p[0], p[1], ringsOf[c.rid]) / 10;
        if (d > CITY_MAX_OUT_PX) { stats.noLocation++; stats.far.push(c.state + ' / ' + c.city + ' (' + Math.round(d) + ' px)'); return; }
        stats.outside++;
      }
      stats.placed++;
      (byState[c.state] = byState[c.state] || []).push([c.city, p[0], p[1]]);
    });
  }
  const states = {};
  Object.keys(byState).sort().forEach(s => {
    const rows = byState[s].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    states[s] = { names: rows.map(r => r[0]).join('|'), xy: [].concat.apply([], rows.map(r => [r[1], r[2]])) };
  });
  const json = JSON.stringify({ country: cfg.iso2, unit: 0.1, rule: zipGeo.CITY_POINT_RULE, states }) + '\n';
  if (list.some(c => c.city.indexOf('|') >= 0)) throw new Error('a city name contains "|"');
  return { json, bytes: Buffer.byteLength(json, 'utf8'), gzip: zlib.gzipSync(json, { level: 9 }).length, stats };
}

// ---- README -----------------------------------------------------------------------------------------------
function readmeText(results, meta) {
  const rows = results.map(r => {
    const rep = r.report;
    const alias = rep.aliases.length ? rep.aliases.join('; ') : '—';
    const un = rep.unmatched.length ? rep.unmatched.map(u => u.name + ' (' + u.why + ')').join('; ') : '—';
    const by = 'code ' + rep.cnt.code + ', name ' + rep.cnt.name + ', alias ' + rep.cnt.alias + (rep.cnt.file ? ', PR file ' + rep.cnt.file : '');
    return '| ' + r.cfg.iso2 + ' | ' + r.cfg.level + ' | ' + rep.regions + ' (from ' + r.neFeatures + ' NE features) | ' + rep.universe + ' | ' + rep.matched + ' (' + by + ') | ' + alias + ' | ' + un + ' | ' +
      (rep.noName.length ? rep.noName.join('; ') : '—') + ' | ' + (r.bytes / 1024).toFixed(1) + ' KB |';
  }).join('\n');
  const excl = results.filter(r => r.excluded.length).map(r => '- ' + r.cfg.iso2 + ': ' + r.excluded.join('; ')).join('\n');
  const total = results.reduce((a, r) => a + r.bytes, 0);
  const cityRows = results.map(r => {
    const s = r.cities.stats;
    return '| ' + r.cfg.iso2 + ' | ' + s.cities + ' | ' + s.placed + ' | ' + s.noLocation + ' | ' + s.outside + ' | ' + (r.cities.bytes / 1024).toFixed(1) + ' KB | ' + (r.cities.gzip / 1024).toFixed(1) + ' KB |';
  }).join('\n');
  const cityTotal = results.reduce((a, r) => a + r.cities.bytes, 0), cityGz = results.reduce((a, r) => a + r.cities.gzip, 0);
  const cityFar = results.filter(r => r.cities.stats.far.length).map(r => '- ' + r.cfg.iso2 + ': ' + r.cities.stats.far.join('; ')).join('\n');
  return '# State / province maps (Incident Explorer)\n\n' +
    'One SVG per country (`<ISO2>.svg`), loaded on demand by `incident-explorer.html` when a country is opened on the world map.\n' +
    'Generated by `tools/build-country-maps.js` — do not edit by hand; rerun the script instead.\n\n' +
    '## Source and licence\n\n' +
    '- Natural Earth **Admin 1 – States, Provinces**, 1:10m, version ' + NE_VERSION + ': <' + SRC_URL + '>\n' +
    '  (official repository nvkelso/natural-earth-vector, tag v' + NE_VERSION + '; also at naturalearthdata.com).\n' +
    '- Downloaded ' + meta.date + (meta.lastModified ? ' (Last-Modified: ' + meta.lastModified + ')' : '') + ', ' + meta.size + ' bytes, sha256 `' + meta.sha256 + '`.\n' +
    '  The raw download is not committed; it lives in a temp folder only while the script runs.\n' +
    '- Licence: ' + LICENCE + '. Made with Natural Earth.\n' +
    '- Boundaries are Natural Earth\'s de facto boundaries (for example India\'s Jammu and Kashmir); Admin 1 has no point-of-view variant.\n\n' +
    '## Format\n\n' +
    '- `viewBox="0 0 ' + VIEW_W + ' ' + VIEW_H + '"`, coordinates rounded to 0.1, simplified with mapshaper (Visvalingam, weighted, topology kept).\n' +
    '- One `<path>` per region: `id="sm-<ISO 3166-2>"`, `data-iso`, `data-name` (map name) and `data-states` = the explorer State names\n' +
    '  (GeoNames admin1 names, as `server/zip-geo.js` shows them) that belong to the region, joined by `|`. No styles or scripts.\n' +
    '- The map level equals the explorer\'s State level per country; finer Natural Earth levels are dissolved.\n\n' +
    '## Countries\n\n' +
    '"Explorer names" = every admin1 name in `server/data/geonames/<CC>.txt` (US also PR.txt), i.e. every State the explorer can show for the country.\n\n' +
    '| ISO | Map level | Regions | Explorer names | Matched (how) | Aliases | Not on the map | Regions with no explorer name | Size |\n' +
    '|---|---|---|---|---|---|---|---|---|\n' + rows + '\n\n' +
    'Total size: ' + (total / 1024).toFixed(1) + ' KB (budget: US ' + BUDGET.US / 1024 + ' KB, others ' + BUDGET.other / 1024 + ' KB, total ' + BUDGET.total / 1024 + ' KB).\n\n' +
    'Notes:\n\n' +
    '- US: the 78 GeoNames Puerto Rico municipalities are one region, US-PR. The PR municipality "Florida" has the same name as the\n' +
    '  state, so the explorer cannot tell them apart; it stays on US-FL.\n' +
    '- SA, EG, AE and AT have no GeoNames postal data, so every ticket there is "Unknown" state and the map stays grey.\n\n' +
    '## Excluded / dropped Natural Earth parts\n\n' + (excl || '- none') + '\n\n' +
    'Remote islets are also dropped by lon/lat boxes in the config (US: western Aleutians, NW Hawaiian Islands; GB: Rockall; JP: Ogasawara and other\n' +
    'Tokyo islands south of 32°N; MX: Revillagigedo, Guadalupe; BR: Trindade, Martim Vaz, St Peter and St Paul rocks).\n' +
    'Insets: ES Canarias (bottom left), PT Azores (left, 55%) and Madeira (left).\n\n' +
    '## City points (`<ISO2>-cities.json`)\n\n' +
    'One file per country, loaded on demand by `incident-explorer.html` the first time a state is zoomed into, for the city dots.\n\n' +
    '- Format: `{ country, unit: 0.1, rule, states: { "<explorer State name>": { names: "City A|City B", xy: [xA, yA, xB, yB] } } }`.\n' +
    '  `x` / `y` are tenths of a unit in the SVG\'s own `viewBox` (divide by 10), so a dot sits exactly where the paths are drawn.\n' +
    '- Projection: each point goes through the same mapshaper `-proj` as the paths (US: `albersusa +PR`, so Alaska, Hawaii and\n' +
    '  Puerto Rico move with their shapes; others: the country\'s own `laea`), then the same inset move (ES Canarias, PT Azores /\n' +
    '  Madeira) and the same fit into the viewBox. Points are not simplified.\n' +
    '- Cities and their names: `server/zip-geo.js` `cityPoints()` — the explorer\'s own State / City derivation and ambiguity rule, so a\n' +
    '  name here is exactly an explorer City node under that State (same strings, scoped by State).\n' +
    '- Location rule: ' + zipGeo.CITY_POINT_RULE + '\n' +
    '- Left out (the page lists them as "cities without a known location"): no usable GeoNames point, a point inside a drop box\n' +
    '  (islets not drawn), a point outside the viewBox, or a point more than ' + CITY_MAX_OUT_PX + ' viewBox units (5% of the map width) from its\n' +
    '  State\'s drawn shape (listed below). US: a State + City already read from US.txt is not re-read from PR.txt.\n' +
    '- "Outside own region" = placed points within ' + CITY_MAX_OUT_PX + ' units of their region but not inside its simplified path (coastal /\n' +
    '  island postal points just past the simplified coastline); they are drawn where they project, and the page\'s zoom frame\n' +
    '  covers every placed point of the State.\n\n' +
    '| ISO | Cities | Placed | No location | Outside own region | Size | gzip |\n|---|---|---|---|---|---|---|\n' + cityRows + '\n\n' +
    'Total: ' + (cityTotal / 1024).toFixed(1) + ' KB (' + (cityGz / 1024).toFixed(1) + ' KB gzip).\n\n' +
    'Too far from their State\'s shape (not placed):\n\n' + (cityFar || '- none') + '\n\n' +
    '## Rebuild\n\n' +
    '```\nnode tools/build-country-maps.js            # download, build all 22, rewrite this README\n' +
    'node tools/build-country-maps.js --dry-run  # validate and report only\n' +
    'node tools/build-country-maps.js --only US,IN --src <local geojson>   # subset (README is not rewritten)\n```\n\n' +
    'After a rebuild, bump `STATE_MAP_V` (SVGs) and / or `CITY_MAP_V` (cities files) in `incident-explorer.html` so browsers fetch the new files.\n';
}

// ---- Main -------------------------------------------------------------------------------------------------
function argVal(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
async function main() {
  const args = process.argv.slice(2);
  const only = argVal(args, '--only'), src = argVal(args, '--src'), msDir = argVal(args, '--mapshaper-dir');
  const keepTemp = args.indexOf('--keep-temp') >= 0, dry = args.indexOf('--dry-run') >= 0;
  const list = only ? COUNTRIES.filter(c => only.toUpperCase().split(',').indexOf(c.iso2) >= 0) : COUNTRIES;
  if (!list.length) throw new Error('--only matched no country');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phd-state-maps-'));
  const tmpFiles = [];
  try {
    // Source.
    let buf, meta = { date: new Date().toISOString().slice(0, 10), lastModified: '' };
    if (src) { buf = fs.readFileSync(src); meta.lastModified = 'local file ' + path.basename(src); }
    else {
      console.log('Downloading ' + SRC_URL);
      const r = await fetch(SRC_URL);
      if (r.status !== 200) throw new Error('Download failed: HTTP ' + r.status + ' for ' + SRC_URL);
      buf = Buffer.from(await r.arrayBuffer());
      meta.lastModified = r.headers.get('last-modified') || '';
      fs.writeFileSync(path.join(tmp, 'ne_10m_admin_1_states_provinces.geojson'), buf);
    }
    if (!buf.length) throw new Error('Empty download');
    meta.size = buf.length; meta.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    let gj; try { gj = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('The source is not JSON: ' + e.message); }
    if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) throw new Error('The source is not a GeoJSON FeatureCollection');
    buf = null;
    // mapshaper.
    let modDir = msDir ? path.resolve(msDir) : path.join(tmp, 'ms');
    if (!msDir) {
      console.log('Installing ' + MAPSHAPER + ' into the temp folder');
      try { execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--prefix', modDir, MAPSHAPER], { stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32' }); }
      catch (e) { throw new Error('npm install ' + MAPSHAPER + ' failed: ' + String((e.stderr || '') + '').slice(0, 2000)); }
    }
    const ms = require(path.join(modDir, 'node_modules', 'mapshaper'));
    // Build.
    const results = [];
    for (const cfg of list) { process.stdout.write('  ' + cfg.iso2 + '...'); const r = await buildCountry(ms, cfg, gj.features, meta.date); results.push(r); console.log(r.problems.length ? ' PROBLEMS' : ' ' + (r.bytes / 1024).toFixed(1) + ' KB'); }
    const problems = [].concat.apply([], results.map(r => r.problems));
    const total = results.reduce((a, r) => a + (r.bytes || 0), 0);
    if (!only && total > BUDGET.total) problems.push('total ' + total + ' bytes is over the ' + BUDGET.total + '-byte budget');
    if (problems.length) { console.error('\nFAILED (' + problems.length + ' problems, nothing written):\n- ' + problems.join('\n- ')); process.exitCode = 1; return; }
    // Report.
    console.log('\nISO  regions  names  matched (code/name/alias/file)  size     aliases | not on map | regions with no name');
    results.forEach(r => {
      const p = r.report;
      console.log(r.cfg.iso2.padEnd(4) + String(p.regions).padStart(7) + String(p.universe).padStart(7) + String(p.matched).padStart(9) + ' (' + [p.cnt.code, p.cnt.name, p.cnt.alias, p.cnt.file].join('/') + ')' +
        ('').padEnd(16) + (r.bytes / 1024).toFixed(1).padStart(6) + ' KB  ' + (p.aliases.join('; ') || '-') + ' | ' + (p.unmatched.map(u => u.name).join('; ') || '-') + ' | ' + (p.noName.join('; ') || '-'));
    });
    console.log('Total ' + (total / 1024).toFixed(1) + ' KB');
    console.log('\nISO  cities  placed  no location  outside own region  cities.json (gzip)');
    results.forEach(r => {
      const c = r.cities, s = c.stats;
      console.log(r.cfg.iso2.padEnd(4) + String(s.cities).padStart(7) + String(s.placed).padStart(8) + String(s.noLocation).padStart(13) + String(s.outside).padStart(20) +
        '  ' + (c.bytes / 1024).toFixed(1) + ' KB (' + (c.gzip / 1024).toFixed(1) + ' KB)');
    });
    if (dry) { console.log('--dry-run: nothing written.'); return; }
    // Write (tmp then rename).
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outs = [];
    results.forEach(r => { outs.push([r.cfg.iso2 + '.svg', r.svg], [r.cfg.iso2 + '-cities.json', r.cities.json]); });
    outs.forEach(([f, txt]) => { const t = path.join(OUT_DIR, '.tmp-' + f); tmpFiles.push(t); fs.writeFileSync(t, txt); });
    outs.forEach(([f]) => { fs.renameSync(path.join(OUT_DIR, '.tmp-' + f), path.join(OUT_DIR, f)); });
    if (!only) fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readmeText(results, meta));
    else console.log('--only: maps/README.md not rewritten (run a full build to refresh it).');
    console.log('Wrote ' + results.length + ' SVG(s) and ' + results.length + ' cities file(s) to ' + OUT_DIR);
  } finally {
    tmpFiles.forEach(t => { try { fs.unlinkSync(t); } catch (e) { /* renamed or never written */ } });
    if (keepTemp) console.log('Temp folder kept: ' + tmp);
    else fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { COUNTRIES, fold, escAttr, ringsToPath, matchNames, readUniverse };
if (require.main === module) main().catch(e => { console.error('FAILED: ' + ((e && e.message) || e)); process.exitCode = 1; });
