// Owner-only "Revoke upload" for ticket data uploads (View Log pop-up).
// Every publish (live full publish, live-quarter patch, past-quarter merge) saves an undo snapshot
// in COLLECTIONS.uploadSnapshots BEFORE it writes ticket_docs:
//   { _id:<publishedAt>, logId, at, user, quarterIds:[qid], added:[ticket _id inserted],
//     before:[full previous ticket docs that were changed or deleted], addedCount, beforeCount,
//     prevQuarterMeta:{ qid:{publishedAt,count,publishedBy}|null }, revoked:false, [failed:true] }
// Every data_log entry of that publish carries snapshotId (= the snapshot _id) and revocable.
// Only the LATEST non-revoked upload may be revoked, and only by harisss (case-insensitive).
// Revoking deletes `added`, restores `before`, resets each quarter's meta.count and bumps
// meta.publishedAt (so rollups rebuild), marks the entries + snapshot revoked and logs
// { action:'revoke', revokes:<id> }. Kept in its own module so it can be unit-tested without a DB.
const REVOKE_OWNER = 'harisss';
const SNAPSHOT_KEEP = 30;   // keep undo snapshots for the latest 30 uploads
const LATEST_ONLY_MSG = 'Only the most recent upload can be revoked. Revoke newer uploads first.';
const PRE_FEATURE_MSG = 'Uploaded before revoke was available.';
const NO_SNAPSHOT_MSG = 'This upload cannot be revoked: no undo snapshot was saved for it.';
const CHUNK = 500;

const normLogin = s => String(s == null ? '' : s).trim().toLowerCase();
function isRevokeOwner(username) { return normLogin(username) === REVOKE_OWNER; }

// Upload entries = everything in data_log except revoke actions.
const UPLOAD_FILTER = { action: { $ne: 'revoke' } };
const LIVE_UPLOAD_FILTER = { action: { $ne: 'revoke' }, revoked: { $ne: true } };

// Deep, key-order-independent equality of two ticket docs (used to keep only CHANGED docs in `before`).
function canon(v) {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => { if (v[k] !== undefined) o[k] = canon(v[k]); });
    return o;
  }
  return v;
}
function docsEqual(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

// Pure: what one bulk write of a quarter will change, so it can be undone.
//   targetDocs: Map/obj ticket _id -> replacement doc that will be upserted
//   existing:   full docs currently stored that the write touches (target copies + stale copies
//               in other buckets that the era-dedupe deletes)
//   removedDocs: full docs the removal list deletes
// -> { added:[_id not stored before], before:[stored docs that will change or disappear] }
function planSnapshot(targetDocs, existing, removedDocs) {
  const targets = targetDocs instanceof Map ? targetDocs : new Map(Object.entries(targetDocs || {}));
  const seen = new Map();
  const before = [];
  const keep = d => { if (d && d._id != null && !seen.has(String(d._id))) { seen.set(String(d._id), true); before.push(d); } };
  (existing || []).forEach(d => {
    if (!d) return;
    const repl = targets.get(String(d._id));
    if (repl === undefined) keep(d);              // stale copy -> deleted by the write
    else if (!docsEqual(d, repl)) keep(d);        // real change -> keep the previous version
    else seen.set(String(d._id), false);          // identical -> nothing to undo, but it existed
  });
  (removedDocs || []).forEach(keep);
  const added = [];
  targets.forEach((_, id) => { if (!seen.has(String(id))) added.push(String(id)); });
  return { added, before };
}

// Collects one publish's undo snapshot. capture() is called once per bulk write, BEFORE the write;
// it never throws (a failure only flips `failed`, so the publish carries on).
// deps: { snapColl, quartersColl, id, at, user }
function createSnapshotRecorder(deps) {
  const metaSeen = new Set(), addedSeen = new Set(), beforeSeen = new Set();
  const rec = {
    id: deps.id, failed: false, captured: false,
    async capture(qid, plan) {
      if (rec.failed) return;
      try {
        const p = plan || {};
        const before = (p.before || []).filter(d => { const k = String(d._id); if (beforeSeen.has(k) || addedSeen.has(k)) return false; beforeSeen.add(k); return true; });
        const added = (p.added || []).map(String).filter(k => { if (addedSeen.has(k) || beforeSeen.has(k)) return false; addedSeen.add(k); return true; });
        const set = {};
        if (!metaSeen.has(qid)) {
          metaSeen.add(qid);
          const q = await deps.quartersColl.findOne({ _id: qid }, { projection: { meta: 1 } });
          const m = q && q.meta;
          set['prevQuarterMeta.' + qid] = m ? { publishedAt: m.publishedAt || null, count: Number(m.count) || 0, publishedBy: m.publishedBy || null } : null;
        }
        const update = {
          $setOnInsert: { at: deps.at, user: deps.user, revoked: false, logId: null },
          $addToSet: { quarterIds: qid },
          $inc: { addedCount: added.length, beforeCount: before.length },
        };
        if (Object.keys(set).length) update.$set = set;
        if (added.length || before.length) update.$push = {};
        if (added.length) update.$push.added = { $each: added };
        if (before.length) update.$push.before = { $each: before };
        await deps.snapColl.updateOne({ _id: deps.id }, update, { upsert: true });
        rec.captured = true;
      } catch (e) {
        rec.failed = true;
      }
    },
    // After the publish's data_log entries are inserted (all carry snapshotId = rec.id):
    // link the snapshot, set revocable on the entries, prune old snapshots. Never throws.
    async finalize(logColl) {
      const ok = rec.captured && !rec.failed;
      try {
        if (!ok) {
          try { await deps.snapColl.updateOne({ _id: deps.id }, { $set: { failed: true } }); } catch (e) { /* ignore */ }
        } else {
          const first = (await logColl.find({ snapshotId: deps.id }).sort({ at: 1 }).limit(1).toArray())[0];
          if (first) await deps.snapColl.updateOne({ _id: deps.id }, { $set: { logId: String(first._id) } });
        }
        await logColl.updateMany({ snapshotId: deps.id }, { $set: { revocable: ok } });
        if (ok) await pruneSnapshots({ snapColl: deps.snapColl, logColl });
      } catch (e) { /* never block a publish */ }
      return ok;
    },
  };
  return rec;
}

// Retention: keep the newest SNAPSHOT_KEEP snapshots; older ones are deleted and their entries
// marked revocable:false.
async function pruneSnapshots(deps, keep) {
  const n = keep == null ? SNAPSHOT_KEEP : keep;
  const old = await deps.snapColl.find({}, { projection: { _id: 1 } }).sort({ at: -1 }).skip(n).toArray();
  const ids = old.map(d => d._id);
  if (!ids.length) return 0;
  await deps.snapColl.deleteMany({ _id: { $in: ids } });
  if (deps.logColl) await deps.logColl.updateMany({ snapshotId: { $in: ids }, revoked: { $ne: true } }, { $set: { revocable: false, snapshotPruned: true } });
  return ids.length;
}

// The upload that may be revoked right now: the newest non-revoked upload entry, if it has a usable
// snapshot. -> { snapshotId, user, at, added, restore } | null
async function revokeTarget(deps) {
  const latest = (await deps.logColl.find(LIVE_UPLOAD_FILTER).sort({ at: -1 }).limit(1).toArray())[0];
  if (!latest || !latest.snapshotId || latest.revocable === false) return null;
  const snap = await deps.snapColl.findOne({ _id: latest.snapshotId }, { projection: { added: 0, before: 0 } });
  if (!snap || snap.revoked || snap.failed) return null;
  return { snapshotId: latest.snapshotId, user: snap.user || latest.user, at: snap.at || latest.at,
    added: Number(snap.addedCount) || 0, restore: Number(snap.beforeCount) || 0 };
}

// API shape of the revoke-related fields of a data_log entry (merged into GET /api/data-log rows).
// target = revokeTarget() result (only computed for the owner) or null.
function mapRevokeFields(e, target) {
  const out = {};
  if (e.action === 'revoke') {
    Object.assign(out, { action: 'revoke', revokes: e.revokes ? String(e.revokes) : null,
      revokedUser: e.revokedUser || '', revokedUploadAt: e.revokedUploadAt || null, restored: e.restored || null });
    return out;
  }
  out.snapshotId = e.snapshotId || null;
  out.revocable = e.snapshotId ? e.revocable !== false && !e.snapshotPruned : false;
  out.preRevoke = !e.snapshotId;   // uploaded before revoke was available
  if (e.revoked) Object.assign(out, { revoked: true, revokedAt: e.revokedAt || null, revokedBy: e.revokedBy || '' });
  if (target && e.snapshotId && e.snapshotId === target.snapshotId && !e.revoked) {
    Object.assign(out, { canRevoke: true, revokeAdded: target.added, revokeRestore: target.restore });
  }
  return out;
}

// The whole POST /api/data-log/:id/revoke flow. Returns { status, body, quarterIds? }.
// deps: { logColl, snapColl, ticketColl, quartersColl, user:{username, role}, toId(str)->_id|null, now? }
async function handleRevokeUpload(idStr, deps) {
  const user = deps.user || {};
  if (!isRevokeOwner(user.username)) return { status: 403, body: { error: 'Only harisss can revoke uploads.' } };
  const id = deps.toId(String(idStr == null ? '' : idStr));
  if (id == null) return { status: 400, body: { error: 'Invalid log entry.' } };
  const { logColl, snapColl, ticketColl, quartersColl } = deps;
  const entry = await logColl.findOne({ _id: id });
  if (!entry) return { status: 404, body: { error: 'Log entry not found.' } };
  if (entry.action === 'revoke') return { status: 400, body: { error: 'A revoke entry cannot be revoked.' } };
  const already = e => ({ status: 200, body: { ok: true, alreadyRevoked: true, id: String(entry._id), revokedAt: e.revokedAt || null, revokedBy: e.revokedBy || '' } });
  if (entry.revoked) return already(entry);
  if (!entry.snapshotId) return { status: 409, body: { error: 'This upload cannot be revoked: ' + PRE_FEATURE_MSG.toLowerCase() } };
  if (entry.revocable === false) return { status: 409, body: { error: NO_SNAPSHOT_MSG } };
  const sid = entry.snapshotId;
  const snap = await snapColl.findOne({ _id: sid });
  if (!snap || snap.failed) return { status: 409, body: { error: NO_SNAPSHOT_MSG } };
  if (snap.revoked) return already(snap);
  const latest = (await logColl.find(LIVE_UPLOAD_FILTER).sort({ at: -1 }).limit(1).toArray())[0];
  if (!latest || latest.snapshotId !== sid) return { status: 409, body: { error: LATEST_ONLY_MSG } };

  // Claim the snapshot so two concurrent revokes cannot both run.
  const claim = await snapColl.updateOne({ _id: sid, revoked: { $ne: true }, revoking: { $ne: true } }, { $set: { revoking: true } });
  if (!claim || !claim.modifiedCount) {
    const cur = await snapColl.findOne({ _id: sid });
    if (cur && cur.revoked) return already(cur);
    return { status: 409, body: { error: 'A revoke of this upload is already in progress.' } };
  }

  const by = normLogin(user.username);
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const added = Array.isArray(snap.added) ? snap.added : [];
  const before = Array.isArray(snap.before) ? snap.before : [];
  const quarterIds = Array.isArray(snap.quarterIds) ? snap.quarterIds : [];
  const prevMeta = snap.prevQuarterMeta || {};
  const quarters = [];
  try {
    // 1) remove every ticket the upload inserted, 2) put back every ticket it changed or deleted.
    let deleted = 0;
    for (let i = 0; i < added.length; i += CHUNK) {
      const r = await ticketColl.deleteMany({ _id: { $in: added.slice(i, i + CHUNK) } });
      deleted += (r && r.deletedCount) || 0;
    }
    for (let i = 0; i < before.length; i += CHUNK) {
      await ticketColl.bulkWrite(before.slice(i, i + CHUNK).map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
    }
    // 3) quarter meta: restored count + a NEW publishedAt so rollups rebuild and data-as-of moves on.
    for (const qid of quarterIds) {
      const count = await ticketColl.countDocuments({ q: qid });
      const pm = prevMeta[qid] || null;
      await quartersColl.updateOne({ _id: qid }, {
        $set: { 'meta.count': count, 'meta.publishedAt': at, 'meta.publishedBy': (pm && pm.publishedBy) || by,
          'meta.revokedBy': by, 'meta.revokedAt': at, 'data.count': count, 'data.updatedAt': at },
        $unset: { 'meta.changeSummary': '' },
      }, { upsert: true });
      quarters.push({ quarter: qid, count, prevCount: pm ? pm.count : 0 });
    }
    const restored = { deleted, removedAdded: added.length, restored: before.length, quarters };
    await snapColl.updateOne({ _id: sid }, { $set: { revoked: true, revokedAt: at, revokedBy: by }, $unset: { revoking: '' } });
    await logColl.updateMany({ snapshotId: sid }, { $set: { revoked: true, revokedAt: at, revokedBy: by } });
    const ins = await logColl.insertOne({
      action: 'revoke', revokes: String(entry._id), snapshotId: null, user: by, role: user.role || '', at, publishedAt: at,
      revokedUser: snap.user || entry.user || '', revokedUploadAt: snap.at || entry.at || null, restored,
    });
    return { status: 200, quarterIds, body: { ok: true, id: String(entry._id), revokeId: ins && ins.insertedId != null ? String(ins.insertedId) : null, revokedAt: at, revokedBy: by, ...restored } };
  } catch (e) {
    // Release the claim so the (idempotent) revoke can simply be retried.
    try { await snapColl.updateOne({ _id: sid }, { $unset: { revoking: '' } }); } catch (_) { /* ignore */ }
    throw e;
  }
}

module.exports = {
  REVOKE_OWNER, SNAPSHOT_KEEP, LATEST_ONLY_MSG, PRE_FEATURE_MSG, NO_SNAPSHOT_MSG, UPLOAD_FILTER, LIVE_UPLOAD_FILTER,
  isRevokeOwner, docsEqual, planSnapshot, createSnapshotRecorder, pruneSnapshots, revokeTarget, mapRevokeFields, handleRevokeUpload,
};
