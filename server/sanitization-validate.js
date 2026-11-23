// Sanitization validation — the per-ticket rules the Sanitization Tracker reports after a data upload
// (sanitization-tracker.html). Pure: no DB, no network. server.js loads the Resolved / Closed
// ticket_docs of the sanitization scope (sanScopeRows) and the issue-type list (issue-types-data.js
// IZ_CATS, via errors-in-resolved.js), then calls validateRows();
// server/sanitization-validate-store.js persists one doc per flagged ticket in
// COLLECTIONS.sanitizationValidations and reads the owner's per-field approvals from
// COLLECTIONS.sanitizationFieldApprovals.
// The checks are selected by the UPLOADED ClosureCode only (closureKey: trimmed, inner whitespace
// collapsed, lower-cased), never by the contractor's mark in the app:
//   Immediately Resolved -> scope 'title'      the 3 SIM Title checks only; Sim Root Cause Details is
//                                              NOT looked at (a re-upload as Immediately Resolved
//                                              settles the ticket on its title alone).
//   Successful           -> scope 'title+rcd'  the 3 SIM Title checks + the 10 Sim Root Cause Details
//                                              fields.
//   Duplicate            -> scope 'none'       no checks.
//   anything else        -> scope 'none'       no checks: the rules define only the three codes, so
//                                              Automatically Closed, Successful with Problems, No
//                                              Issue, a blank code and the rest are left alone.
// SIM Title (3): country = a known country code at the start (titleCountry), severity = Sev / Severity
// 1-5 (titleSeverity), issue type = a valid issue type anywhere in the title (findInText + prepList).
// All three reuse server/sanitization-score.js, so the tracker and the scores page read one definition.
// Sim Root Cause Details (RCD_FIELDS, 10 fields; any line order, labels case-insensitive, the long
// label forms of the real data accepted through the same alias sets and the same RCD_NEXT_KEYS
// terminator as the score parser):
//   required (REQUIRED_FIELDS) Issue, Date, Res          absent, or present with an empty value, fails.
//   optional                   SID, TID, Driv, Zip, CID, UPID   a value or 'N/A' both pass; absent or
//                              empty is read as 'N/A' and never fails (TID is an ordinary optional
//                              field, not a mandated constant).
//   optional, with a content rule  Cnt                   the whole trimmed value must be a number or an
//                              N/A spelling (N/A counts as 0); letters or symbols fail.
// Every field is stored with the literal 'N/A' when its line is absent or empty, so a persisted record
// always carries all ten.
// Skips (validateRows): a ticket the contractor marked 'error' in the app and a ticket the owner
// approved as an error (COLLECTIONS.sanitizationExcluded) get no result at all — no checks, no flags.
// opts.approvedFields (a Set of approvalKey(shortId, key) strings) suppresses those single checks
// permanently, while every un-approved check keeps being validated on each upload.
'use strict';
const { RCD_ISSUE_RE, RCD_RESOLUTION_RE, RCD_NEXT_KEYS, rcdPlain } = require('./pulse-check');
const { titleCountry, titleSeverity, prepList, findInText, closureKey } = require('./sanitization-score');

// The ten Sim Root Cause Details fields, in rule order.
const RCD_FIELDS = Object.freeze(['Issue', 'SID', 'TID', 'Driv', 'Date', 'Cnt', 'Zip', 'CID', 'UPID', 'Res']);
const REQUIRED_FIELDS = Object.freeze(['Issue', 'Date', 'Res']);
const NA = 'N/A';
// N/A spellings (NA, n/a, N.A.) — the same test the score's Cnt check uses.
const NA_RE = /^\s*n\.?\s*\/?\s*a\.?\s*$/i;
const NUM_RE = /^\d+(?:\.\d+)?$/;
const SCOPE_TITLE = 'title', SCOPE_RCD = 'title+rcd', SCOPE_NONE = 'none';
// ClosureCode (closureKey) -> what is checked.
const SCOPE_BY_CODE = Object.freeze({ 'immediately resolved': SCOPE_TITLE, successful: SCOPE_RCD, duplicate: SCOPE_NONE });

const str = v => (v == null ? '' : String(v));
const clean = v => str(v).replace(/\s+/g, ' ').trim();

// ---- SIM Title (definitions reused from sanitization-score.js) ----
const TITLE_CHECKS = Object.freeze([
  Object.freeze({ key: 'country', label: 'Title: country code', message: 'The title does not start with a known country code.',
    ok: (title) => !!titleCountry(title) }),
  Object.freeze({ key: 'type', label: 'Title: issue type', message: 'The title has no valid issue type.',
    ok: (title, types) => !!findInText(title, types) }),
  Object.freeze({ key: 'severity', label: 'Title: severity', message: 'The title has no severity (Sev 1-5).',
    ok: (title) => !!titleSeverity(title) }),
]);
// ctx.types is the issue-type name list (prepList'd once per validateRows run; a prepared list passes through).
function typeList(ctx) {
  const list = (ctx && ctx.types) || [];
  return (list.length && list[0] && typeof list[0] === 'object') ? list : prepList(list);
}

// ---- Sim Root Cause Details ----
// Same shape as sanitization-score.js RCD_RE: the label must start the blob or follow whitespace, the
// value stops at a newline or at the next known KEY: (RCD_NEXT_KEYS), case-insensitive.
function fieldRe(keys) {
  return new RegExp('(?:^|\\s)(?:' + keys + ')[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
}
const RCD_RE = {
  Issue: RCD_ISSUE_RE,
  SID: fieldRe('SID|Station\\s*ID'),
  TID: fieldRe('TID|Transporter\\s*ID'),
  Driv: fieldRe('Driv|Driver\\s*Type'),
  Date: fieldRe('Incident\\s*Date|Date\\s*of\\s*Incident|Date'),
  Cnt: fieldRe('Cnt|Historical\\s*Incident'),
  Zip: fieldRe('Zip'),
  CID: fieldRe('CID|AID'),
  UPID: fieldRe('UPID'),
  Res: RCD_RESOLUTION_RE,
};
// -> { <field>: trimmed value } with '' when the label is present but empty and null when it is absent.
function rawFields(rootCauseDetails) {
  const plain = rcdPlain(rootCauseDetails);
  const out = {};
  RCD_FIELDS.forEach(k => { const m = plain.match(RCD_RE[k]); out[k] = m ? clean(m[1]) : null; });
  return out;
}
// All ten fields as they are stored: the trimmed value, or the literal 'N/A' when absent or empty.
function parseRcdFields(rootCauseDetails) {
  const raw = rawFields(rootCauseDetails);
  const out = {};
  RCD_FIELDS.forEach(k => { out[k] = raw[k] ? raw[k] : NA; });
  return out;
}

// One approved field: COLLECTIONS.sanitizationFieldApprovals _id (and the opts.approvedFields keys).
function approvalKey(shortId, key) { return str(shortId).trim() + '|' + str(key); }
const rcdLabel = k => 'Sim Root Cause Details: ' + k;
const fail = (key, group, label, message) => ({ key, group, label, message });

// ---- One ticket ----
// ticket: a ticket doc (ShortId / IssueId, Title, RootCauseDetails, ClosureCode). ctx: { types }.
// opts: { approvedFields } (a Set of approvalKey strings; those checks are dropped).
// -> { shortId, title, closureCode, scope, fields (all ten), failures:[{ key, group, label, message }], ok }.
function validateTicket(ticket, ctx, opts) {
  const t = ticket || {}, o = opts || {};
  const shortId = str(t.ShortId || t.IssueId).trim();
  const title = str(t.Title);
  const closureCode = clean(t.ClosureCode);
  const raw = rawFields(t.RootCauseDetails);
  const fields = {};
  RCD_FIELDS.forEach(k => { fields[k] = raw[k] ? raw[k] : NA; });
  const scope = SCOPE_BY_CODE[closureKey(closureCode)] || SCOPE_NONE;
  const failures = [];
  if (scope !== SCOPE_NONE) {
    const types = typeList(ctx);
    TITLE_CHECKS.forEach(c => { if (!c.ok(title, types)) failures.push(fail(c.key, 'title', c.label, c.message)); });
  }
  if (scope === SCOPE_RCD) {
    RCD_FIELDS.forEach(k => {
      const v = raw[k];
      if (REQUIRED_FIELDS.indexOf(k) >= 0) {
        if (!v) failures.push(fail(k, 'rcd', rcdLabel(k), k + ': has no value (it is required).'));
        return;
      }
      // Cnt is the one optional field with a content rule; the other six take a value or N/A.
      if (k === 'Cnt' && v && !NUM_RE.test(v) && !NA_RE.test(v)) {
        failures.push(fail(k, 'rcd', rcdLabel(k), 'Cnt: must be a number or N/A (' + v + ' is neither).'));
      }
    });
  }
  const appr = o.approvedFields;
  const kept = (appr && appr.size) ? failures.filter(f => !appr.has(approvalKey(shortId, f.key))) : failures;
  return { shortId, title: clean(title), closureCode, scope, fields, failures: kept, ok: !kept.length };
}

// Set of shortIds from a Set, an array of ids or an array of docs ({ shortId }).
function idSet(x) {
  if (x instanceof Set) return x;
  const out = new Set();
  Array.from(x || []).forEach(v => { const id = typeof v === 'string' ? v : (v && v.shortId); if (id) out.add(str(id).trim()); });
  return out;
}
// Map shortId -> the contractor's mark status, from a Map or a plain object.
function markMap(x) { return x instanceof Map ? x : new Map(Object.entries(x || {})); }

// ---- Many tickets ----
// rows: ticket docs. opts: { markStatus (Map / object shortId -> mark status), approvedError (Set /
// array of owner-approved error shortIds), approvedFields (Set of approvalKey) }.
// -> Map shortId -> validateTicket result. A ticket the contractor marked 'error', or one the owner
// approved as an error, is skipped entirely: it gets no entry at all.
function validateRows(rows, ctx, opts) {
  const o = opts || {};
  const marks = markMap(o.markStatus), approved = idSet(o.approvedError);
  const ctx2 = { types: typeList(ctx) };
  const out = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const shortId = str(r && (r.ShortId || r.IssueId)).trim();
    if (!shortId || out.has(shortId)) return;
    if (str(marks.get(shortId)).trim().toLowerCase() === 'error') return;
    if (approved.has(shortId)) return;
    out.set(shortId, validateTicket(r, ctx2, { approvedFields: o.approvedFields }));
  });
  return out;
}

// ---- The rules, as the pages show them (sanitization-checklist.js renders this list) ----
// Code-defined on purpose: the checklist card must never drift from the engine above.
const RULES = Object.freeze([
  Object.freeze({ key: 'immediate', code: 'Immediately Resolved', title: 'Closure code "Immediately Resolved"', lines: Object.freeze([
    'SIM Title: a known country code at the start.',
    'SIM Title: a valid issue type.',
    'SIM Title: a severity (Sev 1-5).',
    'Sim Root Cause Details is not checked for this closure code.',
  ]) }),
  Object.freeze({ key: 'successful', code: 'Successful', title: 'Closure code "Successful"', lines: Object.freeze([
    'SIM Title: a known country code at the start.',
    'SIM Title: a valid issue type.',
    'SIM Title: a severity (Sev 1-5).',
    'Sim Root Cause Details: Issue, Date and Res must have a value.',
    'Sim Root Cause Details: SID, TID, Driv, Zip, CID and UPID may have a value or N/A.',
    'Sim Root Cause Details: Cnt must be a number or N/A (N/A counts as 0).',
  ]) }),
  Object.freeze({ key: 'duplicate', code: 'Duplicate', title: 'Closure code "Duplicate"', lines: Object.freeze([
    'Nothing is checked.',
  ]) }),
  Object.freeze({ key: 'other', code: '', title: 'Any other closure code', lines: Object.freeze([
    'Nothing is checked: the rules cover only Immediately Resolved, Successful and Duplicate.',
  ]) }),
  Object.freeze({ key: 'skipped', code: '', title: 'Tickets left out of validation', lines: Object.freeze([
    'A ticket marked Error in the app waits for harisss to approve it and is not validated.',
    'A ticket approved as an error is never validated again.',
    'An item harisss approves on a ticket is never raised again; the other items keep being checked on every upload.',
  ]) }),
]);

module.exports = {
  RCD_FIELDS, REQUIRED_FIELDS, NA, TITLE_CHECKS, SCOPE_BY_CODE, RCD_RE, RULES,
  parseRcdFields, validateTicket, validateRows, approvalKey,
};
