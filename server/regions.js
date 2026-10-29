// Regions & countries reference shown on the Rules page (rules.html).
// One doc per region { _id: <key>, key, name, order, countries:[codes] } + one seed-marker doc.
// Kept in its own module so validation + seed can be unit-tested without a DB.
// NOTE: this is a reference list only. Other pages still derive country codes from their own lists
// (COUNTRY_CODES in server.js, MT_COUNTRY_CODES in my-tickets.html, REGIONS in quarter-metrics.js).

// Edit access: ONLY these usernames (case-insensitive). rules.html mirrors this client-side.
const REGION_EDITORS = ['harisss'];
function canEditRegions(username) {
  return REGION_EDITORS.indexOf(String(username || '').trim().toLowerCase()) >= 0;
}

// Trim + upper-case; 2-3 letters A-Z only. Returns { ok:true, value } or { ok:false, error }.
function normalizeCountryCode(raw) {
  const code = String(raw == null ? '' : raw).trim().toUpperCase();
  if (!code) return { ok: false, error: 'Country code is required.' };
  if (!/^[A-Z]{2,3}$/.test(code)) return { ok: false, error: 'Country code must be 2 or 3 letters (A-Z).' };
  return { ok: true, value: code };
}

// Region keys are upper-case letters only (NA, LATAM, APAC, EU, MENA).
function normalizeRegionKey(raw) {
  const key = String(raw == null ? '' : raw).trim().toUpperCase();
  return /^[A-Z]{1,20}$/.test(key) ? key : '';
}

// The region (from a list of region docs) that already holds `code`, optionally ignoring one key.
function findRegionWithCountry(regions, code, exceptKey) {
  const list = Array.isArray(regions) ? regions : [];
  for (const r of list) {
    if (!r || (exceptKey && r.key === exceptKey)) continue;
    if (Array.isArray(r.countries) && r.countries.indexOf(code) >= 0) return r;
  }
  return null;
}

const REGION_MARKER_KIND = '__marker';
const REGION_SEED_MARKER_ID = 'seed:regions-v1';
// Query filter for real region docs (excludes the marker).
const REGION_REAL_FILTER = { kind: { $ne: REGION_MARKER_KIND } };
const REGION_SEED = [
  { key: 'NA', name: 'NA', order: 0, countries: ['US', 'CA', 'MX'] },
  { key: 'LATAM', name: 'LATAM', order: 1, countries: ['BR'] },
  { key: 'APAC', name: 'APAC', order: 2, countries: ['IN', 'JP', 'SG', 'AU', 'NZ'] },
  { key: 'EU', name: 'EU', order: 3, countries: ['UK', 'GB', 'IE', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'CH', 'PL', 'CZ', 'GR', 'DK', 'NO', 'SE', 'FI'] },
  { key: 'MENA', name: 'MENA', order: 4, countries: ['AE', 'UAE', 'SA', 'EG', 'TR', 'ZA'] },
];

// API shape: { key, name, countries }.
function mapRegion(d) {
  return { key: d.key || String(d._id), name: d.name || d.key || String(d._id), countries: Array.isArray(d.countries) ? d.countries.slice() : [] };
}

// Idempotent: no-op once the marker exists (so a removed country / region never comes back on the
// next boot); never overwrites a region doc that is already present. Returns regions inserted.
async function seedRegions(coll, log) {
  const marker = await coll.findOne({ _id: REGION_SEED_MARKER_ID });
  if (marker) return 0;
  const keys = REGION_SEED.map(s => s.key);
  const existing = await coll.find({ _id: { $in: keys } }, { projection: { _id: 1 } }).toArray();
  const have = new Set(existing.map(d => String(d._id)));
  const now = new Date().toISOString();
  const docs = REGION_SEED.filter(s => !have.has(s.key))
    .map(s => ({ _id: s.key, key: s.key, name: s.name, order: s.order, countries: s.countries.slice(), updatedBy: 'system', updatedAt: now }));
  if (docs.length) await coll.insertMany(docs);
  await coll.updateOne(
    { _id: REGION_SEED_MARKER_ID },
    { $setOnInsert: { kind: REGION_MARKER_KIND, seededKeys: keys, at: now } },
    { upsert: true }
  );
  if (docs.length && log) log('Regions seeded: ' + docs.map(d => d.key).join(', '));
  return docs.length;
}

module.exports = {
  REGION_EDITORS, canEditRegions, normalizeCountryCode, normalizeRegionKey, findRegionWithCountry,
  REGION_MARKER_KIND, REGION_SEED_MARKER_ID, REGION_REAL_FILTER, REGION_SEED, mapRegion, seedRegions,
};
