// "Update tickets data" (ticket-sanitization.html, owner-only): harisss uploads cleaned ticket CSVs and
// the matching ticket_docs get the new values.
//   POST /api/sanitization-update { rows:[{csv row}], files:[names], dryRun:boolean }
// Rules:
//   - Rows match ticket_docs by ShortId (trimmed). EVERY doc with that ShortId is updated (a ticket can
//     sit in several quarters). Nothing is ever inserted or deleted; unknown ShortIds are reported.
//   - Only CSV columns that are ticket fields are written, never the identity / system fields
//     (PROTECTED). Fields not in the CSV are untouched and a BLANK cell never overwrites a value.
//   - Values compare normalised (CRLF -> LF, trimmed); only changed fields are $set (bulkWrite, 500).
//   - Same ShortId in several rows (several files): rows merge in upload order, the last non-blank cell wins.
//   - Before writing: an undo snapshot (upload-revoke.js createSnapshotRecorder: full previous docs,
//     added:[]) so the View Log "Revoke" can undo it. After writing: meta.publishedAt bumped on each
//     affected quarter and ONE data_log entry (action 'sanitization-update', publishedAt = now) so the
//     data stamp (eirDataStamp) moves on and every stamp-keyed cache / the assignment verification rebuild.
//   - dryRun (the default unless dryRun === false) returns the preview and writes nothing.
// Pure functions + a handler taking deps, so it can be unit-tested without a DB.
'use strict';
const { isOwner } = require('./sanitization-score');

const MAX_ROWS = 50000;
const MAX_FILES = 100;
const BATCH = 500;
const FIND_CHUNK = 1000;
const SAMPLE_MAX = 10;
const SAMPLE_CLIP = 120;
const LIST_MAX = 200;
const ACTION = 'sanitization-update';
const OWNER_ONLY = 'Only harisss can update ticket data.';
// Identity / system fields: never written from a CSV.
const PROTECTED = new Set(['ShortId', 'IssueId', '_id', 'q', 'IssueUrl', 'CreateDate']);
// Ticket columns of the LM-HUB export (also accepted when no matched doc carries the field yet).
const KNOWN_FIELDS = ['Title', 'Status', 'Severity', 'AssigneeIdentity', 'ResolvedDate', 'Age', 'ClosureCode', 'ResolvedByIdentity',
  'RootCause', 'RootCauseDetails', 'AssignedGroup', 'Labels', 'Tags', 'LastAssignedDate', 'LastUpdatedConversationDate',
  'LastUpdatedDate', 'RequesterIdentity'];

const str = v => (v == null ? '' : String(v));
const norm = v => str(v).replace(/\r\n?/g, '\n').trim();
const clip = s => (s.length > SAMPLE_CLIP ? s.slice(0, SAMPLE_CLIP - 1) + '\u2026' : s);
const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);
// A column name that is safe to $set (no operators, no dotted paths, no private fields).
const safeKey = k => typeof k === 'string' && k.length > 0 && k.length <= 100 && !/^[_$]/.test(k) && k.indexOf('.') < 0;

// Strict input check -> { ok, value:{ rows, files, dryRun } } | { ok:false, status, error }.
function validate(body) {
  const b = isPlain(body) ? body : {};
  const bad = error => ({ ok: false, status: 400, error });
  if (!Array.isArray(b.rows) || !b.rows.length) return bad('rows must be a non-empty array.');
  if (b.rows.length > MAX_ROWS) return bad('Too many rows: at most ' + MAX_ROWS.toLocaleString('en-US') + ' per update.');
  for (let i = 0; i < b.rows.length; i++) {
    const r = b.rows[i];
    if (!isPlain(r)) return bad('Row ' + (i + 1) + ' is not an object.');
    if (!norm(r.ShortId)) return bad('Row ' + (i + 1) + ' has no ShortId.');
  }
  const files = b.files == null ? [] : b.files;
  if (!Array.isArray(files) || files.length > MAX_FILES || files.some(f => typeof f !== 'string' || f.length > 255)) {
    return bad('files must be a list of at most ' + MAX_FILES + ' file names.');
  }
  if (b.dryRun != null && typeof b.dryRun !== 'boolean') return bad('dryRun must be true or false.');
  return { ok: true, value: { rows: b.rows, files: files.map(f => f.trim()).filter(Boolean), dryRun: b.dryRun !== false } };
}

// rows -> { byId: Map shortId -> { field: normalised non-blank value }, duplicates:[shortId], columns:[name] }.
// Rows merge in order (later non-blank cell wins); blank cells and the ShortId column carry no value.
function mergeRows(rows) {
  const byId = new Map(), seen = new Map(), columns = new Set();
  (rows || []).forEach(r => {
    const id = norm(r.ShortId);
    if (!id) return;
    seen.set(id, (seen.get(id) || 0) + 1);
    const cur = byId.get(id) || {};
    Object.keys(r).forEach(k => {
      if (k === 'ShortId') return;
      columns.add(k);
      const v = norm(r[k]);
      if (v) cur[k] = v;
    });
    byId.set(id, cur);
  });
  const duplicates = [];
  seen.forEach((n, id) => { if (n > 1) duplicates.push(id); });
  return { byId, duplicates, columns: Array.from(columns) };
}

// Pure diff. merged = mergeRows() result, docs = every ticket_docs doc whose ShortId is in merged.
// -> preview numbers + changes:[{ _id, q, shortId, set:{field:value}, before:<full doc> }].
function planUpdate(merged, docs) {
  const docsById = new Map();
  (docs || []).forEach(d => {
    const id = norm(d && d.ShortId);
    if (!id || !merged.byId.has(id) || !str(d.q)) return;   // every ticket_docs doc carries its quarter q
    if (!docsById.has(id)) docsById.set(id, []);
    docsById.get(id).push(d);
  });
  // Writable fields: known ticket columns + any field a matched doc already has, minus PROTECTED.
  const fieldSet = new Set(KNOWN_FIELDS);
  docsById.forEach(list => list.forEach(d => Object.keys(d).forEach(k => fieldSet.add(k))));
  const writable = k => safeKey(k) && !PROTECTED.has(k) && fieldSet.has(k);
  const fields = merged.columns.filter(writable);
  const ignoredColumns = merged.columns.filter(k => !writable(k));

  const notFound = [], changes = [], perField = {}, sample = [];
  let matched = 0, unchanged = 0, ticketsChanged = 0;
  merged.byId.forEach((row, id) => {
    const list = docsById.get(id);
    if (!list) { notFound.push(id); return; }
    matched++;
    const touched = new Set();
    list.forEach(d => {
      const set = {};
      fields.forEach(f => {
        if (!Object.prototype.hasOwnProperty.call(row, f)) return;   // blank cell / column absent -> keep
        const nv = row[f], ov = d[f];
        if (norm(ov) === nv) return;
        set[f] = nv;
        if (!touched.has(f)) {
          touched.add(f);
          perField[f] = (perField[f] || 0) + 1;
          if (sample.length < SAMPLE_MAX) sample.push({ shortId: id, field: f, old: clip(norm(ov)), new: clip(nv) });
        }
      });
      if (Object.keys(set).length) changes.push({ _id: d._id, q: d.q, shortId: id, set, before: d });
    });
    if (touched.size) ticketsChanged++; else unchanged++;
  });
  return {
    uniqueTickets: merged.byId.size, matched, notFound, ticketsChanged, docsChanged: changes.length, unchanged,
    perField, sample, duplicates: merged.duplicates, fields, ignoredColumns, changes,
  };
}

// API shape of a plan (no docs).
function previewOf(plan, rows, files) {
  return {
    files, totalRows: rows, uniqueTickets: plan.uniqueTickets, matched: plan.matched,
    notFoundCount: plan.notFound.length, notFound: plan.notFound.slice(0, LIST_MAX),
    ticketsChanged: plan.ticketsChanged, docsChanged: plan.docsChanged, unchanged: plan.unchanged,
    perField: plan.perField, sample: plan.sample,
    duplicateCount: plan.duplicates.length, duplicates: plan.duplicates.slice(0, LIST_MAX),
    fields: plan.fields, ignoredColumns: plan.ignoredColumns,
  };
}

// One update at a time per process.
let _chain = Promise.resolve();
function serial(fn) { const p = _chain.then(fn, fn); _chain = p.catch(() => {}); return p; }

async function findDocs(ticketColl, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += FIND_CHUNK) {
    const part = await ticketColl.find({ ShortId: { $in: ids.slice(i, i + FIND_CHUNK) } }).toArray();
    part.forEach(d => out.push(d));
  }
  return out;
}

// POST /api/sanitization-update. Returns { status, body, quarterIds? }.
// deps: { user:{username, role}, ticketColl, quartersColl, logColl, snapColl, createSnapshotRecorder,
//         quarterLabel?(qid), now?() }
function handleUpdate(body, deps) {
  if (!deps.user || !isOwner(deps.user.username)) return Promise.resolve({ status: 403, body: { error: OWNER_ONLY } });
  const v = validate(body);
  if (!v.ok) return Promise.resolve({ status: v.status, body: { error: v.error } });
  return serial(async () => {
    const { rows, files, dryRun } = v.value;
    const merged = mergeRows(rows);
    const plan = planUpdate(merged, await findDocs(deps.ticketColl, Array.from(merged.byId.keys())));
    const preview = previewOf(plan, rows.length, files);
    if (dryRun || !plan.changes.length) return { status: 200, body: { ok: true, dryRun, written: false, updated: 0, ...preview } };

    const at = (deps.now ? deps.now() : new Date()).toISOString();
    const user = String(deps.user.username || '').trim().toLowerCase();
    const byQ = new Map();
    plan.changes.forEach(c => { const q = str(c.q); if (!byQ.has(q)) byQ.set(q, []); byQ.get(q).push(c); });
    const quarterIds = Array.from(byQ.keys()).sort();

    // 1) Undo snapshot (previous full docs, nothing added). No snapshot -> nothing is written.
    const snap = deps.createSnapshotRecorder({ snapColl: deps.snapColl, quartersColl: deps.quartersColl, id: at, at, user });
    for (const q of quarterIds) {
      await snap.capture(q, { added: [], before: byQ.get(q).map(c => c.before) });
      if (snap.failed) break;
    }
    if (snap.failed || !snap.captured) {
      await snap.finalize(deps.logColl);
      return { status: 500, body: { error: 'Could not save the undo snapshot, so nothing was changed. Try again with fewer tickets.' } };
    }

    // 2) Changed fields only, 500 per bulkWrite. 3) New publishedAt on each affected quarter.
    // 4) One data_log entry (the new data stamp), linked to the snapshot. A failed write still logs
    //    (partial:true) so the owner can revoke what was written.
    let written = 0, writeErr = null;
    try {
      for (let i = 0; i < plan.changes.length; i += BATCH) {
        const ops = plan.changes.slice(i, i + BATCH).map(c => ({ updateOne: { filter: { _id: c._id }, update: { $set: c.set } } }));
        await deps.ticketColl.bulkWrite(ops, { ordered: false });
        written += ops.length;
      }
      for (const q of quarterIds) if (q) await deps.quartersColl.updateOne({ _id: q }, { $set: { 'meta.publishedAt': at } });
    } catch (e) { writeErr = e; }
    const label = q => (deps.quarterLabel ? deps.quarterLabel(q) : q);
    const entry = {
      action: ACTION, user, role: deps.user.role || '', at, publishedAt: at,
      fileName: files.join(', '), files,
      changeSummary: { added: 0, updated: plan.ticketsChanged },
      perField: plan.perField, notFound: plan.notFound.length, totalRows: rows.length, matched: plan.matched,
      docsChanged: plan.docsChanged, totalTickets: plan.ticketsChanged,
      written: quarterIds.map(q => ({ quarter: q, label: label(q), count: byQ.get(q).length, isLive: false })),
      snapshotId: snap.id, revocable: true,
    };
    if (writeErr) { entry.partial = true; entry.docsWritten = written; }
    await deps.logColl.insertOne(entry);
    await snap.finalize(deps.logColl);
    if (writeErr) return { status: 500, quarterIds, body: { error: 'The update stopped part-way. Revoke it from View Log, then try again.' } };
    return { status: 200, quarterIds, body: { ok: true, dryRun: false, written: true, updated: plan.ticketsChanged, at, ...preview } };
  });
}

module.exports = { MAX_ROWS, BATCH, PROTECTED, KNOWN_FIELDS, ACTION, norm, validate, mergeRows, planUpdate, previewOf, handleUpdate };
