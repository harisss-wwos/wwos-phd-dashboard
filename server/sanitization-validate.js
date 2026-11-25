// Sanitization validation — the per-ticket rules the Sanitization Tracker reports after a data upload
// (sanitization-tracker.html). Pure: no DB, no network. server.js loads the Resolved / Closed
// ticket_docs of the sanitization scope (sanScopeRows) and the issue-type list (issue-types-data.js
// IZ_CATS, via errors-in-resolved.js), then calls validateRows();
// server/sanitization-validate-store.js persists one doc per flagged ticket in
// COLLECTIONS.sanitizationValidations and reads the tickets the owner accepted as sanitized errors
// from COLLECTIONS.sanitizationErrorAccepts.
// The checks are selected by the UPLOADED ClosureCode only (closureKey: trimmed, inner whitespace
// collapsed, lower-cased), never by the contractor's mark in the app:
//   Immediately Resolved -> scope 'title'      the 3 SIM Title checks only; the Sim Root Cause Details
//                                              FIELDS are NOT validated (a re-upload as Immediately
//                                              Resolved settles the ticket on its title alone). Its
//                                              Issue line is still read, for the issue-type override
//                                              below only - that raises no RCD failure.
//   Successful           -> scope 'title+rcd'  the 3 SIM Title checks + the 10 Sim Root Cause Details
//                                              fields.
//   Duplicate            -> scope 'none'       no checks.
//   anything else        -> scope 'code'       the CODE ITSELF is the error (one 'closureCode' failure
//                                              naming it): the owner's rule is that a sanitized ticket
//                                              may only end as Successful, Immediately Resolved or
//                                              Duplicate, so Automatically Closed, Automatically
//                                              Resolved, No Issue, Successful with Problems, a blank
//                                              code and the rest are reported under Error detected.
//                                              Nothing else is checked on such a ticket: the closure
//                                              code has to be fixed first. (This REPLACES the earlier
//                                              behaviour, where any other code produced no record.)
// SIM Title (3): country = a known country code at the start (titleCountry), severity = Sev / Severity
// 1-5 (titleSeverity), issue type = a valid issue type anywhere in the title (findInText + prepList).
// All three reuse server/sanitization-score.js, so the tracker and the scores page read one definition.
// Issue-type override: the Sim Root Cause Details Issue line is the authoritative issue type, so when
// it holds a valid catalogue type (matchExact against the same issue-types-data.js list) the TITLE's
// issue type is not reported at all, whatever the title says. The owner's rule is "if the SIM root
// cause details have a proper Issue and the title has something else then ignore the title and use the
// issue type in Sim root cause details", stated for all pages, so it applies to Immediately Resolved
// as well as Successful. sanitization-score.js requiredChecks already does the same for Successful.
// Sim Root Cause Details (RCD_FIELDS, 10 fields; any line order, labels case-insensitive, the long
// label forms of the real data accepted through the same alias sets and the same RCD_NEXT_KEYS
// terminator as the score parser):
//   required (REQUIRED_FIELDS) Issue, Date, Res          absent, present with an empty value, or written
//                              as an N/A spelling fails: N/A is reserved for the optional fields.
//   optional                   SID, TID, Driv, Zip, CID, UPID   a value or 'N/A' both pass; absent or
//                              empty is read as 'N/A' and never fails (TID is an ordinary optional
//                              field, not a mandated constant).
//   optional, with a content rule  Cnt                   the whole trimmed value must be a number or an
//                              N/A spelling (N/A counts as 0); letters or symbols fail.
// Every field is stored with the literal 'N/A' when its line is absent or empty, so a persisted record
// always carries all ten.
// Skips (validateRows): validation follows the contractor's cleanup, so only a ticket they have
// already marked with a closure claim the upload has seen (opts.claimed, built by
// sanitization-validate-store.js claimedIds from COLLECTIONS.sanitizationMarks and the upload stamp)
// is checked — an assigned ticket nobody has marked yet stays in their "Tickets to sanitize" queue and
// gets no result at all. A ticket the contractor marked 'error' in the app, a ticket the owner
// approved as an error (COLLECTIONS.sanitizationExcluded) and a ticket the owner accepted as a
// sanitized error (opts.accepted, COLLECTIONS.sanitizationErrorAccepts) get no result either — no
// checks, no flags. Acceptance is whole-ticket and permanent: a ticket harisss accepts is never
// validated again, however the uploads change.
// These four skips come FIRST and are unconditional: the closure-code error above is raised only for
// a ticket that got through them, so an unmarked or Error-marked ticket is never pulled into the
// owner-only Error detected section by its closure code.
'use strict';
const { RCD_ISSUE_RE, RCD_RESOLUTION_RE, RCD_NEXT_KEYS, rcdPlain } = require('./pulse-check');
const { titleCountry, titleSeverity, prepList, findInText, matchExact, closureKey } = require('./sanitization-score');

// The ten Sim Root Cause Details fields, in rule order.
const RCD_FIELDS = Object.freeze(['Issue', 'SID', 'TID', 'Driv', 'Date', 'Cnt', 'Zip', 'CID', 'UPID', 'Res']);
const REQUIRED_FIELDS = Object.freeze(['Issue', 'Date', 'Res']);
const NA = 'N/A';
// N/A spellings (NA, n/a, N.A.) — the same test the score's Cnt check uses.
const NA_RE = /^\s*n\.?\s*\/?\s*a\.?\s*$/i;
const NUM_RE = /^\d+(?:\.\d+)?$/;
const SCOPE_TITLE = 'title', SCOPE_RCD = 'title+rcd', SCOPE_NONE = 'none', SCOPE_CODE = 'code';
// The only closure codes a sanitized ticket may end with; anything else is reported as an error.
const ALLOWED_CODES = Object.freeze(['Successful', 'Immediately Resolved', 'Duplicate']);
const ALLOWED_TEXT = ALLOWED_CODES.slice(0, -1).join(', ') + ' or ' + ALLOWED_CODES[ALLOWED_CODES.length - 1];
// The closure-code failure's item key / label (the owner can approve it like any other item).
const CODE_KEY = 'closureCode', CODE_LABEL = 'Closure code';
const BLANK_CODE = '(blank)';   // how a missing code reads, as on the scores page (sanitization-score.js)
// The contractor's closure-claim mark statuses (the keys of sanitization-assign.js CLAIMS): a ticket is
// validated only once the contractor has claimed it and an upload has seen that claim.
const CLAIM_STATUSES = Object.freeze(['successful', 'immediate', 'duplicate']);
// ClosureCode (closureKey) -> what is checked.
const SCOPE_BY_CODE = Object.freeze({ 'immediately resolved': SCOPE_TITLE, successful: SCOPE_RCD, duplicate: SCOPE_NONE });

const str = v => (v == null ? '' : String(v));
const clean = v => str(v).replace(/\s+/g, ' ').trim();

// ---- SIM Title (definitions reused from sanitization-score.js) ----
const TITLE_CHECKS = Object.freeze([
  Object.freeze({ key: 'country', label: 'Title: country code', message: 'The title does not start with a known country code.',
    ok: (title) => !!titleCountry(title) }),
  // The Sim Root Cause Details Issue line overrides the title: a valid catalogue type there (an exact,
  // normalised match, the same test sanitization-score.js uses for its RCD 'issue' check) settles the
  // issue type, so the title's is never reported. rcdIssue is '' / null when the line is absent, and
  // an N/A spelling never matches a catalogue type.
  Object.freeze({ key: 'type', label: 'Title: issue type', message: 'The title has no valid issue type, and the Sim Root Cause Details Issue field does not hold one either.',
    ok: (title, types, rcdIssue) => !!findInText(title, types) || !!matchExact(rcdIssue, types) }),
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

const rcdLabel = k => 'Sim Root Cause Details: ' + k;
const fail = (key, group, label, message) => ({ key, group, label, message });

// ---- One ticket ----
// ticket: a ticket doc (ShortId / IssueId, Title, RootCauseDetails, ClosureCode). ctx: { types }.
// Every check of the uploaded closure code's scope is applied: there is nothing to suppress per item
// any more (acceptance takes the whole ticket out of validation, in validateRows).
// -> { shortId, title, closureCode, scope, fields (all ten), failures:[{ key, group, label, message }], ok }.
function validateTicket(ticket, ctx) {
  const t = ticket || {};
  const shortId = str(t.ShortId || t.IssueId).trim();
  const title = str(t.Title);
  const closureCode = clean(t.ClosureCode);
  const raw = rawFields(t.RootCauseDetails);
  const fields = {};
  RCD_FIELDS.forEach(k => { fields[k] = raw[k] ? raw[k] : NA; });
  const scope = SCOPE_BY_CODE[closureKey(closureCode)] || SCOPE_CODE;
  const failures = [];
  // A code outside the three allowed ones IS the error, and the only one raised: the title and the
  // Sim Root Cause Details are not judged until the ticket is closed with an allowed code.
  if (scope === SCOPE_CODE) {
    failures.push(fail(CODE_KEY, 'code', CODE_LABEL,
      'Closure code ' + (closureCode || BLANK_CODE) + ' is not allowed: it must be ' + ALLOWED_TEXT + '.'));
  }
  if (scope === SCOPE_TITLE || scope === SCOPE_RCD) {
    const types = typeList(ctx);
    TITLE_CHECKS.forEach(c => { if (!c.ok(title, types, raw.Issue)) failures.push(fail(c.key, 'title', c.label, c.message)); });
  }
  if (scope === SCOPE_RCD) {
    RCD_FIELDS.forEach(k => {
      const v = raw[k];
      if (REQUIRED_FIELDS.indexOf(k) >= 0) {
        // Required: absent, empty, or an N/A spelling (N/A is only for the optional fields).
        if (!v || NA_RE.test(v)) failures.push(fail(k, 'rcd', rcdLabel(k), k + ': has no value (it is required, and N/A does not count).'));
        return;
      }
      // Cnt is the one optional field with a content rule; the other six take a value or N/A.
      if (k === 'Cnt' && v && !NUM_RE.test(v) && !NA_RE.test(v)) {
        failures.push(fail(k, 'rcd', rcdLabel(k), 'Cnt: must be a number or N/A (' + v + ' is neither).'));
      }
    });
  }
  return { shortId, title: clean(title), closureCode, scope, fields, failures, ok: !failures.length };
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
// rows: ticket docs. opts: { claimed (Set / array of the shortIds whose claim the upload has already
// seen — the only tickets validated; omit it to validate every row), markStatus (Map / object shortId
// -> mark status), approvedError (Set / array of owner-approved error shortIds), accepted (Set /
// array of ids / array of docs: the tickets the owner accepted as sanitized errors) }.
// -> Map shortId -> validateTicket result. A ticket the contractor has not claimed yet, one they marked
// 'error', one the owner approved as an error and one the owner accepted as a sanitized error are
// skipped entirely: they get no entry at all.
function validateRows(rows, ctx, opts) {
  const o = opts || {};
  const marks = markMap(o.markStatus), approved = idSet(o.approvedError), accepted = idSet(o.accepted);
  const claimed = o.claimed == null ? null : idSet(o.claimed);
  const ctx2 = { types: typeList(ctx) };
  const out = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const shortId = str(r && (r.ShortId || r.IssueId)).trim();
    if (!shortId || out.has(shortId)) return;
    if (claimed && !claimed.has(shortId)) return;   // not sanitized yet: nothing to validate
    if (str(marks.get(shortId)).trim().toLowerCase() === 'error') return;
    if (approved.has(shortId)) return;
    if (accepted.has(shortId)) return;              // accepted as a sanitized error: never validated again
    out.set(shortId, validateTicket(r, ctx2));
  });
  return out;
}

// ---- The rules, as the pages show them (sanitization-checklist.js renders this list) ----
// Code-defined on purpose: the checklist card must never drift from the engine above.
const RULES = Object.freeze([
  Object.freeze({ key: 'immediate', code: 'Immediately Resolved', title: 'Closure code "Immediately Resolved"', lines: Object.freeze([
    'SIM Title: a known country code at the start.',
    'SIM Title: a valid issue type \u2014 unless the Sim Root Cause Details Issue field holds a valid one, which then stands in for it.',
    'SIM Title: a severity (Sev 1-5).',
    'Sim Root Cause Details is not checked for this closure code.',
  ]) }),
  Object.freeze({ key: 'successful', code: 'Successful', title: 'Closure code "Successful"', lines: Object.freeze([
    'SIM Title: a known country code at the start.',
    'SIM Title: a valid issue type \u2014 unless the Sim Root Cause Details Issue field holds a valid one, which then stands in for it.',
    'SIM Title: a severity (Sev 1-5).',
    'Sim Root Cause Details: Issue, Date and Res must have a real value (N/A does not count).',
    'Sim Root Cause Details: SID, TID, Driv, Zip, CID and UPID may have a value or N/A.',
    'Sim Root Cause Details: Cnt must be a number or N/A (N/A counts as 0).',
  ]) }),
  Object.freeze({ key: 'duplicate', code: 'Duplicate', title: 'Closure code "Duplicate"', lines: Object.freeze([
    'Nothing is checked.',
  ]) }),
  Object.freeze({ key: 'other', code: '', title: 'Any other closure code', lines: Object.freeze([
    'The closure code itself is the error: a sanitized ticket may only end as ' + ALLOWED_TEXT + '.',
    'It is listed under Error detected, naming the code the upload carried (Automatically Closed, No Issue, a blank code, ...).',
    'Nothing else on the ticket is checked until it is closed with an allowed code.',
  ]) }),
  Object.freeze({ key: 'skipped', code: '', title: 'Tickets left out of validation', lines: Object.freeze([
    'A ticket is checked only after the contractor marks it: an unmarked ticket stays in Tickets to sanitize.',
    'A ticket marked Error in the app waits for harisss to approve it and is not validated.',
    'A ticket approved as an error is never validated again.',
    'A ticket harisss accepts as a sanitized error is never validated again; Rework sends it back instead.',
  ]) }),
]);

module.exports = {
  RCD_FIELDS, REQUIRED_FIELDS, NA, TITLE_CHECKS, SCOPE_BY_CODE, CLAIM_STATUSES, RCD_RE, RULES,
  ALLOWED_CODES, ALLOWED_TEXT, CODE_KEY, CODE_LABEL, BLANK_CODE,
  parseRcdFields, validateTicket, validateRows,
};
