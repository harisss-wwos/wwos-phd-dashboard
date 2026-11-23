// Sanitization validation persistence — turns the engine's result (server/sanitization-validate.js)
// into the writes of COLLECTIONS.sanitizationValidations: ONE doc per flagged ticket
//   { _id: <shortId>, shortId, title, closureCode, scope, fields (all ten), failures, ok:false,
//     detectedAt, dataStamp }
// stamped with the upload that revealed the errors (detectedAt = eirDataStamp's publishedAt), so
// re-uploading the same ticket refreshes the timestamp the tracker shows. A ticket that comes back
// clean has its doc deleted; a ticket the contractor marked Error, or one the owner approved as an
// error, is left alone entirely (the engine returns no result for it, so neither an upsert nor a
// delete is planned). Scope = the tickets of the ACTIVE sanitization assignments.
// No reads of its own and no DB I/O in planUpsert: server.js passes the rows, the assignments, the
// marks, the approvals and the field approvals it already loads (sanValidateAfterUpload), so this
// module is unit-testable with a fake collection. COLLECTIONS.ticketDocs is never written.
'use strict';
const { validateRows, approvalKey } = require('./sanitization-validate');

const BATCH = 500;   // operations per bulkWrite, as in sanitization-update.js

const str = v => (v == null ? '' : String(v));

// shortIds of every ticket in an ACTIVE assignment (the Sanitization Tracker's scope).
function assignedIds(assignments) {
  const out = new Set();
  (assignments || []).forEach(a => {
    if (!a || a.status !== 'active') return;
    (a.tickets || []).forEach(t => { if (t && t.shortId) out.add(str(t.shortId).trim()); });
  });
  return out;
}
// COLLECTIONS.sanitizationMarks holds one doc per (login, shortId): the NEWEST mark per ticket decides
// (an 'error' mark takes the ticket out of validation). -> Map shortId -> status (lower-case).
function markStatusMap(marks) {
  const newest = new Map();
  (marks || []).forEach(m => {
    if (!m || !m.shortId) return;
    const p = newest.get(m.shortId);
    if (!p || str(m.at) > str(p.at)) newest.set(m.shortId, m);
  });
  const out = new Map();
  newest.forEach((m, id) => out.set(id, str(m.status).trim().toLowerCase()));
  return out;
}
// COLLECTIONS.sanitizationFieldApprovals docs -> the Set of '<shortId>|<FIELD>' keys the engine reads
// (the _id of each doc; { shortId, field } is accepted too).
function fieldApprovalSet(docs) {
  const out = new Set();
  (docs || []).forEach(d => {
    if (!d) return;
    const key = d._id ? str(d._id) : (d.shortId && d.field ? approvalKey(d.shortId, d.field) : '');
    if (key) out.add(key);
  });
  return out;
}

// Pure: the bulkWrite operations for one validation run. results = validateRows' Map (or an array of
// results). A flagged ticket is upserted (_id comes from the filter, so _id is never in the $set); the
// shortIds that produced a clean result no longer have a record and are deleted in one deleteMany.
// dataStamp defaults to detectedAt (both are the upload's stamp).
function planUpsert(results, detectedAt, dataStamp) {
  const stamp = dataStamp === undefined ? (detectedAt || null) : dataStamp;
  const list = results instanceof Map ? Array.from(results.values()) : (results || []);
  const ops = [], cleanIds = [];
  list.forEach(r => {
    if (!r || !r.shortId) return;
    if (r.ok) { cleanIds.push(r.shortId); return; }
    ops.push({ updateOne: {
      filter: { _id: r.shortId },
      update: { $set: { shortId: r.shortId, title: r.title || '', closureCode: r.closureCode || '', scope: r.scope,
        fields: r.fields, failures: r.failures, ok: false, detectedAt: detectedAt || null, dataStamp: stamp } },
      upsert: true,
    } });
  });
  if (cleanIds.length) ops.push({ deleteMany: { filter: { _id: { $in: cleanIds } } } });
  return ops;
}

// One validation run after an upload. Loads nothing: deps = { validationColl, ticketRows (the scope
// rows), assignments (every assignment doc; only the active ones count), marks, approved (approved
// error docs / ids), approvedFields (Set of '<shortId>|<FIELD>'), types (issue-type names), stamp (the
// upload's publishedAt), now?() }.
// -> { validated, flagged, clean, ops, detectedAt }.
async function runValidation(deps) {
  const d = deps || {};
  const ids = assignedIds(d.assignments);
  const rows = (d.ticketRows || []).filter(r => r && ids.has(str(r.ShortId || r.IssueId).trim()));
  const results = validateRows(rows, { types: d.types }, {
    markStatus: markStatusMap(d.marks), approvedError: d.approved, approvedFields: d.approvedFields,
  });
  const detectedAt = d.stamp || (d.now ? d.now() : new Date()).toISOString();
  const ops = planUpsert(results, detectedAt, d.stamp || null);
  let flagged = 0;
  results.forEach(r => { if (!r.ok) flagged++; });
  for (let i = 0; i < ops.length; i += BATCH) {
    await d.validationColl.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  }
  return { validated: results.size, flagged, clean: results.size - flagged, ops: ops.length, detectedAt };
}

module.exports = { BATCH, assignedIds, markStatusMap, fieldApprovalSet, planUpsert, runValidation };
