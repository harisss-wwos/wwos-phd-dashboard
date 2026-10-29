// Validation for admin-managed external links shown on the home page (Dashboards & reports).
// Kept in its own module so it can be unit-tested without a DB. home.js mirrors these rules.

const EXT_LINK_LIMITS = { title: 60, description: 200, url: 2000, author: 60, maxLinks: 50 };

// True only for absolute http:/https: URLs (rejects javascript:, data:, ftp:, relative, etc.).
function isHttpUrl(s) {
  try {
    const u = new URL(String(s));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

// Validate + trim a {title, description, url} body. Returns { ok:true, value } or { ok:false, error }.
function validateExternalLink(body) {
  const b = body || {};
  const title = String(b.title == null ? '' : b.title).trim();
  const description = String(b.description == null ? '' : b.description).trim();
  const url = String(b.url == null ? '' : b.url).trim();
  // Free text (e.g. "Team PHD"), whitespace collapsed; always escaped when shown.
  const author = String(b.author == null ? '' : b.author).replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, error: 'Title is required.' };
  if (title.length > EXT_LINK_LIMITS.title) return { ok: false, error: 'Title must be ' + EXT_LINK_LIMITS.title + ' characters or fewer.' };
  if (description.length > EXT_LINK_LIMITS.description) return { ok: false, error: 'Description must be ' + EXT_LINK_LIMITS.description + ' characters or fewer.' };
  if (!url) return { ok: false, error: 'Link is required.' };
  if (url.length > EXT_LINK_LIMITS.url) return { ok: false, error: 'Link must be ' + EXT_LINK_LIMITS.url + ' characters or fewer.' };
  if (!isHttpUrl(url)) return { ok: false, error: 'Link must be a valid http:// or https:// URL.' };
  if (!author) return { ok: false, error: 'Author is required.' };
  if (author.length > EXT_LINK_LIMITS.author) return { ok: false, error: 'Author must be ' + EXT_LINK_LIMITS.author + ' characters or fewer.' };
  return { ok: true, value: { title, description, url, author } };
}

// ---- Optional display fields + one-time seed of the former hard-coded tiles ----
// Links may carry icon/sub/action/seedKey (seeded links only; the Add modal never sets them, and
// validateExternalLink() drops them from POST bodies). A marker doc in the same collection records
// that the seed ran, so deleting a seeded link never brings it back on the next boot.
const EXT_LINK_ICONS = ['globe', 'grid', 'link'];
const EXT_LINK_MARKER_KIND = '__marker';
const EXT_LINK_SEED_MARKER_ID = 'seed:phd-builtin-links-v1';
// Query filter for real links (excludes the marker). Use it for GET / count / delete.
const EXT_LINK_REAL_FILTER = { kind: { $ne: EXT_LINK_MARKER_KIND } };
const EXT_LINK_SEED = [
  {
    seedKey: 'phd-wiki', title: 'PHD Wiki',
    description: 'Dive deeper into the PHD program on the official wiki.',
    url: 'https://w.amazon.com/bin/view/GSOC/PHD#Attachments',
    icon: 'globe', sub: 'External resource', action: 'Explore the wiki',
    createdBy: 'harisss', createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    seedKey: 'phd-mitigation-matrix', title: 'PHD Mitigation Matrix',
    description: 'Open the PHD Mitigation Matrix dashboard in QuickSight.',
    url: 'https://us-east-1.quicksight.aws.amazon.com/sn/account/amazonbi/apps/7d536622-b36f-4375-bf6c-5a1cf0424dc9/view/PHD-Mitigation-Matrix?sso_login=true#',
    icon: 'grid', sub: 'External resource', action: 'Open the matrix',
    createdBy: 'harisss', createdAt: '2026-01-01T00:00:01.000Z',
  },
];

// Idempotent: no-op once the marker exists; never duplicates a seedKey that is already present.
// Returns the number of links inserted.
async function seedExternalLinks(coll, log) {
  const marker = await coll.findOne({ _id: EXT_LINK_SEED_MARKER_ID });
  if (marker) return 0;
  const keys = EXT_LINK_SEED.map(s => s.seedKey);
  const existing = await coll.find({ seedKey: { $in: keys } }, { projection: { seedKey: 1 } }).toArray();
  const have = new Set(existing.map(d => d.seedKey));
  const docs = EXT_LINK_SEED.filter(s => !have.has(s.seedKey)).map(s => ({ ...s }));
  if (docs.length) await coll.insertMany(docs);
  await coll.updateOne(
    { _id: EXT_LINK_SEED_MARKER_ID },
    { $setOnInsert: { kind: EXT_LINK_MARKER_KIND, seededKeys: keys, at: new Date().toISOString() } },
    { upsert: true }
  );
  if (docs.length && log) log('External links seeded: ' + docs.map(d => d.seedKey).join(', '));
  return docs.length;
}

module.exports = {
  EXT_LINK_LIMITS, isHttpUrl, validateExternalLink,
  EXT_LINK_ICONS, EXT_LINK_MARKER_KIND, EXT_LINK_SEED_MARKER_ID, EXT_LINK_REAL_FILTER, EXT_LINK_SEED, seedExternalLinks,
};
