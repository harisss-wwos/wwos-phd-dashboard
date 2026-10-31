// PHD Resolutions list shown on phd-resolutions.html (display order = priority, 1 = most severe).
// One doc per resolution { name, nameKey (lower-case), likelihood, impact, priority, updatedBy, updatedAt }
// + one seed-marker doc. Kept in its own module so validation + seed + re-ordering can be unit-tested
// without a DB.
// NOTE: this list is separate from window.RC_RESOLUTIONS in issue-types-data.js (Tools builder and
// My Tickets dropdowns), which is unchanged.

// Edit access: ONLY these usernames (case-insensitive). phd-resolutions.html mirrors this client-side.
const PHD_RES_EDITORS = ['harisss'];
function canEditPhdResolutions(username) {
  return PHD_RES_EDITORS.indexOf(String(username || '').trim().toLowerCase()) >= 0;
}

const PHD_RES_LEVELS = ['High', 'Low'];
const PHD_RES_NAME_MIN = 2;
const PHD_RES_NAME_MAX = 60;
const PHD_RES_NAME_RE = /^[A-Za-z0-9 &()\-'.]+$/;

// Trim + collapse inner whitespace. Returns { ok:true, value } or { ok:false, error }.
function normalizeResolutionName(raw) {
  const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Name is required.' };
  if (name.length < PHD_RES_NAME_MIN || name.length > PHD_RES_NAME_MAX) {
    return { ok: false, error: 'Name must be ' + PHD_RES_NAME_MIN + '-' + PHD_RES_NAME_MAX + ' characters.' };
  }
  if (!PHD_RES_NAME_RE.test(name)) {
    return { ok: false, error: "Name can only use letters, numbers, spaces and & ( ) - ' ." };
  }
  return { ok: true, value: name };
}

// 'High' | 'Low' (case-insensitive input). Returns the canonical value or ''.
function normalizeLevel(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (v === 'high') return 'High';
  if (v === 'low') return 'Low';
  return '';
}

// Integer 1..max (accepts a number or a digit string). Returns the integer or 0 when invalid.
function normalizePriority(raw, max) {
  if (typeof raw === 'boolean' || raw == null || raw === '') return 0;
  if (typeof raw === 'string' && !/^\s*\d+\s*$/.test(raw)) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return 0;
  return n;
}

// Validate a POST body against the current list ([{name, ...}]).
// Returns { ok:true, value:{name, likelihood, impact, priority} } or { ok:false, status, error }.
function validateNewResolution(body, list) {
  const b = body || {};
  const rows = Array.isArray(list) ? list : [];
  const n = normalizeResolutionName(b.name);
  if (!n.ok) return { ok: false, status: 400, error: n.error };
  const key = n.value.toLowerCase();
  if (rows.some(r => String((r && r.name) || '').trim().toLowerCase() === key)) {
    return { ok: false, status: 409, error: 'Already in the list' };
  }
  const likelihood = normalizeLevel(b.likelihood);
  if (!likelihood) return { ok: false, status: 400, error: 'Likelihood must be High or Low.' };
  const impact = normalizeLevel(b.impact);
  if (!impact) return { ok: false, status: 400, error: 'Impact must be High or Low.' };
  const max = rows.length + 1;
  const priority = normalizePriority(b.priority, max);
  if (!priority) return { ok: false, status: 400, error: 'Priority must be a whole number from 1 to ' + max + '.' };
  return { ok: true, value: { name: n.value, likelihood, impact, priority } };
}

// Sort by current priority (stable on ties) and renumber 1..N. Returns new objects; input untouched.
function normalizePriorities(list) {
  const rows = (Array.isArray(list) ? list : []).map((r, i) => ({ r, i }));
  rows.sort((a, b) => ((Number(a.r.priority) || 0) - (Number(b.r.priority) || 0)) || (a.i - b.i));
  return rows.map((x, i) => Object.assign({}, x.r, { priority: i + 1 }));
}

// Insert `item` at priority p (1..N+1); everything at >= p moves down by one. Returns the new list.
function insertAtPriority(list, item, p) {
  const ordered = normalizePriorities(list);
  const pos = Math.min(Math.max(1, p | 0), ordered.length + 1);
  ordered.splice(pos - 1, 0, Object.assign({}, item));
  return ordered.map((r, i) => Object.assign(r, { priority: i + 1 }));
}

// Move the row whose `id` matches to priority p (1..N); others renumber contiguously.
// Returns the new list, or null when the id is not found.
function moveToPriority(list, id, p) {
  const ordered = normalizePriorities(list);
  const from = ordered.findIndex(r => String(r.id) === String(id));
  if (from < 0) return null;
  const pos = Math.min(Math.max(1, p | 0), ordered.length);
  const [row] = ordered.splice(from, 1);
  ordered.splice(pos - 1, 0, row);
  return ordered.map((r, i) => Object.assign(r, { priority: i + 1 }));
}

const PHD_RES_MARKER_KIND = '__marker';
const PHD_RES_SEED_MARKER_ID = 'seed:phd-resolutions-v1';
// Query filter for real resolution docs (excludes the marker).
const PHD_RES_REAL_FILTER = { kind: { $ne: PHD_RES_MARKER_KIND } };
// The original hard-coded list (priority 1 = most severe).
const PHD_RES_SEED = [
  { name: 'Account Closure', likelihood: 'High', impact: 'High' },
  { name: 'Physical Order Block', likelihood: 'High', impact: 'High' },
  { name: 'Area Exclusion', likelihood: 'High', impact: 'Low' },
  { name: 'Address Exclusion', likelihood: 'High', impact: 'Low' },
  { name: 'Address Deprio', likelihood: 'High', impact: 'Low' },
  { name: 'Routing Update', likelihood: 'Low', impact: 'High' },
  { name: 'GeoFence Update', likelihood: 'Low', impact: 'High' },
  { name: 'GeoPin Update', likelihood: 'Low', impact: 'High' },
  { name: 'Customer Reassurance', likelihood: 'Low', impact: 'Low' },
  { name: 'Parcel Box Installation', likelihood: 'Low', impact: 'High' },
  { name: 'Delivery Hint', likelihood: 'Low', impact: 'High' },
  { name: 'Driver Follow-up', likelihood: 'Low', impact: 'Low' },
].map((r, i) => Object.assign(r, { priority: i + 1 }));

// API shape: { id, name, likelihood, impact, priority }.
function mapResolution(d) {
  return {
    id: String(d._id != null ? d._id : d.id),
    name: String(d.name || ''),
    likelihood: normalizeLevel(d.likelihood) || 'Low',
    impact: normalizeLevel(d.impact) || 'Low',
    priority: Number(d.priority) || 0,
  };
}

// Idempotent: no-op once the marker exists (so later edits are never overwritten or re-seeded).
// Only inserts the defaults when the collection has no resolution docs yet. Returns docs inserted.
async function seedPhdResolutions(coll, log) {
  const marker = await coll.findOne({ _id: PHD_RES_SEED_MARKER_ID });
  if (marker) return 0;
  const now = new Date().toISOString();
  const existing = await coll.countDocuments(PHD_RES_REAL_FILTER);
  let inserted = 0;
  if (!existing) {
    const docs = PHD_RES_SEED.map(s => ({
      name: s.name, nameKey: s.name.toLowerCase(), likelihood: s.likelihood, impact: s.impact,
      priority: s.priority, updatedBy: 'system', updatedAt: now,
    }));
    await coll.insertMany(docs);
    inserted = docs.length;
  }
  await coll.updateOne(
    { _id: PHD_RES_SEED_MARKER_ID },
    { $setOnInsert: { kind: PHD_RES_MARKER_KIND, seededNames: PHD_RES_SEED.map(s => s.name), at: now } },
    { upsert: true }
  );
  if (inserted && log) log('PHD resolutions seeded: ' + inserted + ' (' + PHD_RES_SEED.map(s => s.name).join(', ') + ')');
  return inserted;
}

module.exports = {
  PHD_RES_EDITORS, canEditPhdResolutions, PHD_RES_LEVELS, normalizeResolutionName, normalizeLevel,
  normalizePriority, validateNewResolution, normalizePriorities, insertAtPriority, moveToPriority,
  PHD_RES_MARKER_KIND, PHD_RES_SEED_MARKER_ID, PHD_RES_REAL_FILTER, PHD_RES_SEED, mapResolution,
  seedPhdResolutions,
};
