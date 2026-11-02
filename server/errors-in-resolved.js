// Errors in Resolved — pure checks for GET /api/errors-in-resolved (errors-in-resolved.html).
// No DB I/O: server.js loads the ticket_docs in scope (fromTicketDoc adapter), the PHD resolutions
// list and the issue-type taxonomy, then calls evaluateUpload() (cacheable) and buildReport()
// (applies the admin settings); filterTickets() / pageOf() serve the paged ticket rows.
// Scope: tickets with Status 'Resolved' or 'Closed' (case-insensitive, trimmed) resolved by an agent
// (not AutoSIM), not an appeal ('appeal' in the Title) and ClosureCode not 'Duplicate' /
// 'Immediately Resolved' / 'Automatically Closed'. buildReport() splits that scope into the page's
// three SECTIONS; a section lists only tickets failing one of ITS enabled checks, newest resolved first.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { RCD_ISSUE_RE, RCD_RESOLUTION_RE, RCD_NEXT_KEYS, rcdPlain } = require('./pulse-check');

const ISSUE_URL_BASE = 'https://t.corp.amazon.com/issues/';
const SETTINGS_ID = 'global';

const CHECKS = [
  { code: 'A1', label: 'Issue type in title' },
  { code: 'A2', label: 'Severity in title' },
  { code: 'B1', label: 'Issue line valid' },
  { code: 'B2', label: 'Issue matches title' },
  { code: 'B3', label: 'Date present' },
  { code: 'B4', label: 'Res valid' },
  { code: 'B5', label: 'Cnt within limit' },
  { code: 'B6', label: 'HI lines match Cnt' },
  { code: 'C1', label: 'Closure code Successful' },
];
const CHECK_CODES = CHECKS.map(c => c.code);

function str(v) { return v == null ? '' : String(v); }

// ---- Issue types: the same source as issue-types.html (issue-types-data.js -> window.IZ_CATS). ----
// Returns the type names in page order, or [] when the file is not available (e.g. a deploy that
// only ships the server folder); server.js then falls back to its own taxonomy seed.
function loadIssueTypesFromFile(file) {
  try {
    const code = fs.readFileSync(file || path.join(__dirname, '..', 'issue-types-data.js'), 'utf8');
    const sandbox = { window: {} };
    // The file's later browser-only helpers touch `document`; IZ_CATS is assigned before that runs.
    try { vm.runInNewContext(code, sandbox, { timeout: 1000 }); } catch (e) { /* keep what was assigned */ }
    const cats = Array.isArray(sandbox.window.IZ_CATS) ? sandbox.window.IZ_CATS : [];
    return typesFromCats(cats);
  } catch (e) {
    return [];
  }
}
function typesFromCats(cats) {
  const out = [];
  (Array.isArray(cats) ? cats : []).forEach(c => (c && Array.isArray(c.types) ? c.types : []).forEach(t => {
    const name = str(t && t.type).trim();
    if (name && out.indexOf(name) < 0) out.push(name);
  }));
  return out;
}

// ---- Minimal RFC-4180 CSV parser (quoted commas/newlines, "" escapes, BOM). Returns row objects. ----
function parseCsv(text) {
  const rows = [];
  let i = 0, f = '', row = [], q = false;
  const s = str(text).replace(/^\uFEFF/, '');
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(f); f = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length > 1 || (r[0] || '').trim()).map(r => {
    const o = {};
    head.forEach((h, k) => { if (h) o[h] = r[k] == null ? '' : r[k]; });
    return o;
  });
}

// ---- Text matching ----
// Canonical form: lower-case, en/em dashes -> '-', no spaces around '/' or '-', whitespace collapsed.
// Case and spacing differences are never errors; anything else is (spelling) or is a different value.
function shape(s) {
  return str(s).replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s*([/-])\s*/g, '$1').replace(/\s+/g, ' ').trim();
}
function canon(s) { return shape(s).toLowerCase(); }
function levenshtein(a, b, max) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1), cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return prev[lb];
}
// "Spelling mistake" = the same words in the same order (separators such as '/', '-', ',' ignored),
// each word misspelt by at most a small edit distance: words of 1-2 chars must be identical, 3-5
// chars allow 1 edit, longer words ~20%. A different word count is a different value, so e.g.
// "Attack w/o weapon" is never a misspelling of "Attack w/weapon". Returns the total distance or -1.
function wordLim(len) { return len <= 2 ? 0 : (len <= 5 ? 1 : Math.max(1, Math.floor(len * 0.2))); }
function wordsDist(got, want) {
  if (got.length !== want.length || !want.length) return -1;
  let total = 0;
  for (let i = 0; i < want.length; i++) {
    const lim = wordLim(want[i].length);
    const d = levenshtein(got[i], want[i], lim);
    if (d > lim) return -1;
    total += d;
  }
  return total;
}
const WORD_RE = /[a-z0-9]+/gi;
function wordsOf(s) { return str(s).toLowerCase().match(WORD_RE) || []; }

// Prepared vocabulary: [{ name, key, words }]; longest first so a longer type wins over a shorter one.
function vocab(names) {
  return (Array.isArray(names) ? names : []).map(n => str(n).trim()).filter(Boolean)
    .map(name => ({ name, key: canon(name), words: wordsOf(name) }))
    .sort((a, b) => b.key.length - a.key.length);
}
const isWordCh = ch => !!ch && /[a-z0-9]/i.test(ch);

// Find an issue type inside free text (the title). Exact (canonical, word-bounded) first; otherwise
// the closest token window within the spelling tolerance. -> { type, exact, found } or null.
function findTypeInText(text, voc) {
  const shaped = shape(text), key = shaped.toLowerCase();
  for (const v of voc) {
    let from = 0, at;
    while ((at = key.indexOf(v.key, from)) >= 0) {
      if (!isWordCh(key[at - 1]) || !isWordCh(v.key[0])) {
        if (!isWordCh(key[at + v.key.length]) || !isWordCh(v.key[v.key.length - 1])) return { type: v.name, exact: true, found: shaped.substr(at, v.key.length) };
      }
      from = at + 1;
    }
  }
  // Fuzzy: slide a window of the type's word count over the title's words.
  const spans = [];
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(shaped))) spans.push({ w: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length });
  let best = null;
  for (const v of voc) {
    const n = v.words.length;
    for (let i = 0; i + n <= spans.length; i++) {
      const d = wordsDist(spans.slice(i, i + n).map(x => x.w), v.words);
      if (d < 0) continue;
      const r = d / v.key.length;
      if (!best || r < best.r) best = { type: v.name, found: shaped.slice(spans[i].s, spans[i + n - 1].e), r };
    }
  }
  return best ? { type: best.type, exact: false, found: best.found } : null;
}
// Match a whole field value (Issue:/Res:) against a list. -> { name, exact } or null.
function matchValue(value, voc) {
  const key = canon(value);
  if (!key) return null;
  for (const v of voc) if (v.key === key) return { name: v.name, exact: true };
  const words = wordsOf(value);
  let best = null;
  for (const v of voc) {
    const d = wordsDist(words, v.words);
    if (d < 0) continue;
    const r = d / v.key.length;
    if (!best || r < best.r) best = { name: v.name, r };
  }
  return best ? { name: best.name, exact: false } : null;
}
const spellMsg = (found, correct) => 'Spelling: "' + found + '" \u2192 "' + correct + '"';

// ---- Field extraction (reusing the Pulse Check RootCauseDetails regexes) ----
const PLACEHOLDER_RE = /^(n\/?a|none|null|unknown|-+|\u2014)$/i;
function rcdField(rcd, re) {
  const m = rcdPlain(rcd).match(re);
  const v = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return (!v || PLACEHOLDER_RE.test(v)) ? '' : v;
}
// Date line with the tool-rcd.html aliases (Incident Date / Date of Incident / Date).
const RCD_DATE_RE = new RegExp('(?:^|\\s)(?:Incident\\s*Date|Date\\s*of\\s*Incident|Date)[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
// Severity 1-5 in the title: Sev 3, Sev3, Sev #3, Sev: 3, Severity 3, Severity #3, Severity Level 3, Severity level #3, #3.
const TITLE_SEV_RE = /(?:\bsev(?:erity)?\s*(?:level\s*)?[:#-]?\s*#?\s*|#\s*)[1-5](?!\d)/i;
// Repeat count: the same "Cnt:" parsing as page-zero.js cntOf() / server.js hiCountOf() (HI_CNT_RE),
// but only the Cnt key (never "Historical Incident"). RCD_CNT_LINE_RE finds a Cnt line whose value
// is not a number (reported as cntNonNumeric; such tickets pass B5).
const HI_CNT_RE = /\bCnt\s*[:\s]\s*(\d+)/i;
const RCD_CNT_LINE_RE = new RegExp('(?:^|\\s)Cnt[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
const CNT_MAX = 9;
// Historical incident lines (tool-rcd.html writes "HI1: <type>" .. "HIN: <type>" after Res:, N = Cnt, max 9).
// Key "HI" + digits; the value stops at a newline or the next known KEY: (HI\d+ is in RCD_NEXT_KEYS).
const RCD_HI_RE = new RegExp('(?:^|\\s)HI(\\d+)[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'gi');
function hiLinesOf(rcd) {
  const out = [], s = rcdPlain(rcd);
  RCD_HI_RE.lastIndex = 0;
  let m;
  while ((m = RCD_HI_RE.exec(s))) {
    out.push({ k: parseInt(m[1], 10), v: m[2].replace(/\s+/g, ' ').trim() });
    if (m[0].length === 0) RCD_HI_RE.lastIndex++;
  }
  return out;
}
// B6: Cnt = N > 0 -> HI1..HI(min(N, 9)) each present once with one of the issue types, none beyond.
// No Cnt line / Cnt 0 / non-numeric Cnt -> pass (not applicable). cntMatch = the B5 HI_CNT_RE match.
function checkHiLines(rcd, cntMatch, types) {
  const n = cntMatch ? parseInt(cntMatch[1], 10) : 0;
  if (!(n > 0)) return { pass: true, msg: '' };
  const want = Math.min(n, CNT_MAX), lines = hiLinesOf(rcd), msgs = [];
  const seen = new Map();
  lines.forEach(l => seen.set(l.k, (seen.get(l.k) || 0) + 1));
  const missing = [];
  for (let k = 1; k <= want; k++) if (!seen.has(k)) missing.push('HI' + k);
  if (missing.length) msgs.push('HI missing: ' + missing.join(', '));
  const extra = Array.from(seen.keys()).filter(k => k < 1 || k > want).sort((a, b) => a - b);
  if (seen.size > want) msgs.push('HI lines (' + seen.size + ') exceed Cnt (' + n + ')');
  else if (extra.length) msgs.push(extra.map(k => 'HI' + k).join(', ') + ' not expected (Cnt ' + n + ')');
  Array.from(seen.keys()).filter(k => seen.get(k) > 1).sort((a, b) => a - b).forEach(k => msgs.push('HI' + k + ' repeated'));
  const bad = new Set();
  lines.filter(l => l.k >= 1 && l.k <= want).forEach(l => {
    let msg;
    if (!l.v || PLACEHOLDER_RE.test(l.v)) msg = 'HI' + l.k + ': no issue type';
    else {
      const tm = matchValue(l.v, types);
      if (tm && tm.exact) return;
      msg = 'HI' + l.k + ': ' + (tm ? spellMsg(l.v, tm.name) : '"' + l.v + '" not a valid issue type');
    }
    if (!bad.has(msg)) { bad.add(msg); msgs.push(msg); }
  });
  return msgs.length ? { pass: false, msg: msgs.join('; ') } : { pass: true, msg: '' };
}
// 'Duplicate' and 'Immediately Resolved' are out of scope (see evaluateUpload), so only Successful passes.
const CLOSURE_OK = new Set(['successful']);

function evaluateTicket(t, ctx) {
  const title = str(t.Title), rcd = str(t.RootCauseDetails);
  const R = {};
  // A1
  const tt = findTypeInText(title, ctx.types);
  R.A1 = tt ? (tt.exact ? { pass: true, msg: '' } : { pass: false, msg: spellMsg(tt.found, tt.type) }) : { pass: false, msg: 'No issue type in title' };
  // A2
  R.A2 = TITLE_SEV_RE.test(title) ? { pass: true, msg: '' } : { pass: false, msg: 'No severity (#1\u20135) in title' };
  // B1
  const issueVal = rcdField(rcd, RCD_ISSUE_RE);
  const im = issueVal ? matchValue(issueVal, ctx.types) : null;
  if (!issueVal) R.B1 = { pass: false, msg: 'Issue: missing' };
  else if (!im) R.B1 = { pass: false, msg: 'Issue: not a valid type' };
  else R.B1 = im.exact ? { pass: true, msg: '' } : { pass: false, msg: spellMsg(issueVal, im.name) };
  // B2 (only when both the title and the Issue: line identified a type)
  if (tt && im) R.B2 = tt.type === im.name ? { pass: true, msg: '' } : { pass: false, msg: 'Title says ' + tt.type + ', Issue: says ' + im.name };
  else R.B2 = { pass: null, msg: '', na: true };
  // B3
  R.B3 = rcdField(rcd, RCD_DATE_RE) ? { pass: true, msg: '' } : { pass: false, msg: 'Date: missing' };
  // B4
  const resVal = rcdField(rcd, RCD_RESOLUTION_RE);
  const rm = resVal ? matchValue(resVal, ctx.resolutions) : null;
  if (!resVal) R.B4 = { pass: false, msg: 'Res: missing' };
  else if (!rm) R.B4 = { pass: false, msg: 'Res: not in PHD list' };
  else R.B4 = rm.exact ? { pass: true, msg: '' } : { pass: false, msg: spellMsg(resVal, rm.name) };
  // B5 (no Cnt line, a placeholder or a non-numeric value -> pass; > 9 -> fail)
  const cm = rcdPlain(rcd).match(HI_CNT_RE);
  if (cm) {
    const n = parseInt(cm[1], 10);
    R.B5 = n > CNT_MAX ? { pass: false, msg: 'Cnt: ' + n + ' (over ' + CNT_MAX + ')' } : { pass: true, msg: '' };
  } else {
    R.B5 = { pass: true, msg: '' };
    if (rcdField(rcd, RCD_CNT_LINE_RE)) R.B5.cntNonNumeric = true;
  }
  // B6 (Cnt parsed exactly like B5)
  R.B6 = checkHiLines(rcd, cm, ctx.types);
  // C1
  const cc = str(t.ClosureCode).trim();
  R.C1 = CLOSURE_OK.has(cc.replace(/\s+/g, ' ').toLowerCase()) ? { pass: true, msg: '' } : { pass: false, msg: 'Closure: ' + (cc || 'blank') };
  return R;
}

// Adapter: a ticket_docs document -> the flat string fields evaluateTicket / evaluateUpload read.
// Dates may be stored as Date or string; `rd` / `cd` (already converted by the query) win when present.
function isoOf(v) {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? str(v).trim() : d.toISOString();
}
function fromTicketDoc(d) {
  d = d || {};
  return {
    ShortId: str(d.ShortId || d.IssueId).trim(), Title: str(d.Title), RootCauseDetails: str(d.RootCauseDetails),
    ClosureCode: str(d.ClosureCode), Status: str(d.Status), ResolvedByIdentity: str(d.ResolvedByIdentity),
    IssueUrl: str(d.IssueUrl), ResolvedDate: isoOf(d.rd != null ? d.rd : d.ResolvedDate), CreateDate: isoOf(d.cd != null ? d.cd : d.CreateDate),
  };
}

const IN_SCOPE_STATUSES = new Set(['resolved', 'closed']);
const timeOf = s => { const n = Date.parse(s); return isNaN(n) ? -Infinity : n; };
// Newest resolved first; ties -> newest created first, then ticket id.
function newestFirst(a, b) {
  return (timeOf(b.resolvedAt) - timeOf(a.resolvedAt)) || (timeOf(b.createdAt) - timeOf(a.createdAt)) || a.id.localeCompare(b.id);
}

// Scope + evaluate every check (independent of the admin settings, so the result can be cached).
// deps: { isAutosim(raw), isAppeal(row), resolverLogin(raw) }.
function evaluateUpload(rows, issueTypes, resolutionNames, deps) {
  const ctx = { types: vocab(issueTypes), resolutions: vocab(resolutionNames) };
  const byId = new Map();
  (Array.isArray(rows) ? rows : []).forEach(t => {
    if (!t) return;
    const id = str(t.ShortId || t.IssueId).trim();
    if (id) byId.set(id, t);   // a re-listed id: the later row wins
  });
  const excluded = { notResolved: 0, autosim: 0, appeal: 0, duplicate: 0, immediatelyResolved: 0, automaticallyClosed: 0 };
  const tickets = [];
  const statuses = { resolved: 0, closed: 0 };   // every Resolved / Closed row, before the exclusions
  byId.forEach((t, id) => {
    const status = str(t.Status).trim().toLowerCase();
    if (!IN_SCOPE_STATUSES.has(status)) { excluded.notResolved++; return; }
    statuses[status]++;
    if (deps.isAutosim(t.ResolvedByIdentity)) { excluded.autosim++; return; }
    if (deps.isAppeal(t)) { excluded.appeal++; return; }   // appeals before closure codes
    const closure = str(t.ClosureCode).trim().replace(/\s+/g, ' ').toLowerCase();
    if (closure === 'duplicate') { excluded.duplicate++; return; }
    if (closure === 'immediately resolved') { excluded.immediatelyResolved++; return; }
    if (closure === 'automatically closed') { excluded.automaticallyClosed++; return; }
    const url = str(t.IssueUrl).trim();
    tickets.push({
      id, url: /^https?:\/\//i.test(url) ? url : ISSUE_URL_BASE + encodeURIComponent(id),
      title: str(t.Title).trim(), resolver: deps.resolverLogin(t.ResolvedByIdentity) || 'unknown',
      status: str(t.Status).trim(), closureCode: str(t.ClosureCode).trim(),
      resolvedAt: str(t.ResolvedDate).trim(), createdAt: str(t.CreateDate).trim(),
      results: evaluateTicket(t, ctx),
    });
  });
  tickets.sort(newestFirst);
  const inScopeStatuses = { resolved: 0, closed: 0 };
  tickets.forEach(t => { inScopeStatuses[t.status.toLowerCase()]++; });
  const cntNonNumeric = tickets.filter(t => t.results.B5 && t.results.B5.cntNonNumeric).length;
  return { rows: byId.size, statuses, inScopeStatuses, inScope: tickets.length, excluded, tickets, cntNonNumeric, typeCount: ctx.types.length, resolutionCount: ctx.resolutions.length };
}

function normalizeDisabled(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(c => { const k = str(c).trim().toUpperCase(); if (CHECK_CODES.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); });
  return out.sort((a, b) => CHECK_CODES.indexOf(a) - CHECK_CODES.indexOf(b));
}

// The page's three sections. Every section shares the scope above (since 1 Jan 2026, agent-resolved,
// same exclusions, same check logic); each narrows it by status and resolver type and evaluates only
// its own checks. PHD = resolver login in the registered-agent set (phdSet), Non-PHD = any other agent.
const NO_B6 = CHECK_CODES.filter(c => c !== 'B6');
const SECTIONS = [
  { key: 'phd', label: 'PHD agents \u2014 Resolved', statuses: ['resolved'], agents: 'phd', checks: NO_B6 },
  { key: 'hi', label: 'HI lines check \u2014 all agents', statuses: ['resolved', 'closed'], agents: 'all', checks: ['B6'] },
  { key: 'nonphd', label: 'Non-PHD agents \u2014 Resolved & Closed', statuses: ['resolved', 'closed'], agents: 'nonphd', checks: NO_B6 },
];
const SECTION_KEYS = SECTIONS.map(s => s.key);
const AGENT_FILTERS = ['all', 'phd', 'nonphd'];

// Apply the global settings: disabled checks are not evaluated (results -> { pass:null, disabled }),
// not counted, and never make a ticket listed. Per section, only tickets with >= 1 enabled failure of
// THAT section's checks are listed, and their results / errors / mask cover those checks only.
// Masks: bit i = CHECK_CODES[i] failed. phdSet: lower-case logins of registered PHD agents.
function buildReport(evald, disabledChecks, source, phdSet) {
  const isPhd = login => !!(phdSet && phdSet.has(str(login).toLowerCase()));
  const disabled = new Set(normalizeDisabled(disabledChecks));
  const label = code => CHECKS[CHECK_CODES.indexOf(code)].label;
  const sections = SECTIONS.map(s => ({
    def: s, statusSet: new Set(s.statuses), counts: Object.fromEntries(s.checks.map(c => [c, 0])),
    inScope: 0, inScopeStatuses: { resolved: 0, closed: 0 }, inScopeAgents: { phd: 0, nonphd: 0 },
    resMap: new Map(), tickets: [],
  }));
  const total = Object.fromEntries(CHECK_CODES.map(c => [c, 0]));
  evald.tickets.forEach(t => {
    const phd = isPhd(t.resolver), status = t.status.toLowerCase();
    sections.forEach(S => {
      const s = S.def;
      if (!S.statusSet.has(status)) return;
      if ((s.agents === 'phd' && !phd) || (s.agents === 'nonphd' && phd)) return;
      S.inScope++; S.inScopeStatuses[status]++; S.inScopeAgents[phd ? 'phd' : 'nonphd']++;
      const results = {};
      let fails = 0, mask = 0;
      s.checks.forEach(c => {
        if (disabled.has(c)) { results[c] = { pass: null, msg: '', disabled: true }; return; }
        const r = t.results[c];
        results[c] = r;
        if (r.pass === false) { fails++; S.counts[c]++; total[c]++; mask |= 1 << CHECK_CODES.indexOf(c); }
      });
      if (!fails) return;
      S.tickets.push(Object.assign({}, t, { results, errors: fails, mask, resolverPhd: phd }));
      const g = S.resMap.get(t.resolver) || { login: t.resolver, phd, tickets: 0, errors: 0, masks: {} };
      g.tickets++; g.errors += fails;
      g.masks[mask] = (g.masks[mask] || 0) + 1;
      S.resMap.set(t.resolver, g);
    });
  });
  // evald.tickets is already newest resolved first (evaluateUpload), so every section keeps that order.
  return {
    generatedAt: new Date().toISOString(),
    source,
    // Global toggles; count = failures over all sections (a check is evaluated in disjoint ticket sets).
    checks: CHECKS.map(c => ({ code: c.code, label: c.label, enabled: !disabled.has(c.code), count: disabled.has(c.code) ? 0 : total[c.code] })),
    disabledChecks: Array.from(disabled),
    inScope: evald.inScope,                           // union of the sections
    statuses: evald.statuses || null,                 // all Resolved / Closed rows before the exclusions
    inScopeStatuses: evald.inScopeStatuses || null,   // in-scope tickets by status
    cntNonNumeric: evald.cntNonNumeric || 0,   // in-scope tickets whose Cnt: value is not a number (B5 passes them)
    excluded: evald.excluded,
    sections: sections.map(S => ({
      key: S.def.key, label: S.def.label, statuses: S.def.statuses.slice(), agents: S.def.agents, checks: S.def.checks.slice(),
      inScope: S.inScope, inScopeStatuses: S.inScopeStatuses, inScopeAgents: S.inScopeAgents,
      withErrors: S.tickets.length,
      counts: S.def.checks.map(c => ({ code: c, label: label(c), enabled: !disabled.has(c), count: disabled.has(c) ? 0 : S.counts[c] })),
      resolvers: Array.from(S.resMap.values()).sort((a, b) => (b.tickets - a.tickets) || (b.errors - a.errors) || a.login.localeCompare(b.login)),
      tickets: S.tickets,
    })),
  };
}

// ---- Paging (GET /api/errors-in-resolved/tickets) ----
// f: { q, check, agents, resolver } — a section's filters: search over ticket id / title / resolver
// (case-insensitive substring), failing `check`, 'phd' / 'nonphd' agents only, one resolver login.
function filterTickets(tickets, f) {
  const q = str(f && f.q).trim().toLowerCase(), check = str(f && f.check).trim().toUpperCase();
  const agents = str(f && f.agents).trim().toLowerCase(), byAgent = agents === 'phd' || agents === 'nonphd';
  const hasRes = !!(f && f.resolver != null && f.resolver !== ''), resolver = hasRes ? str(f.resolver) : '';
  if (!q && !check && !byAgent && !hasRes) return tickets;
  return tickets.filter(t => {
    if (hasRes && t.resolver !== resolver) return false;
    if (byAgent && !!t.resolverPhd !== (agents === 'phd')) return false;
    if (check && !(t.results[check] && t.results[check].pass === false)) return false;
    if (q && (t.id + ' ' + (t.title || '') + ' ' + (t.resolver || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}
// Per-resolver { login, phd, masks: { failMask: ticketCount } } of a (filtered) list, so the page can
// recount tickets / errors for any set of scratched checks without the rows.
function maskGroups(tickets) {
  const map = new Map();
  tickets.forEach(t => {
    const g = map.get(t.resolver) || { login: t.resolver, phd: !!t.resolverPhd, masks: {} };
    g.masks[t.mask] = (g.masks[t.mask] || 0) + 1;
    map.set(t.resolver, g);
  });
  return Array.from(map.values());
}
// One page of an already-sorted list. page is clamped to 1..pages.
function pageOf(list, page, pageSize) {
  const total = list.length, pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page | 0), pages);
  return { total, page: p, pageSize, pages, tickets: list.slice((p - 1) * pageSize, p * pageSize) };
}

module.exports = {
  CHECKS, CHECK_CODES, SECTIONS, SECTION_KEYS, AGENT_FILTERS, SETTINGS_ID, loadIssueTypesFromFile, typesFromCats, parseCsv, canon, levenshtein,
  findTypeInText, matchValue, evaluateTicket, evaluateUpload, normalizeDisabled, buildReport, TITLE_SEV_RE, RCD_DATE_RE, HI_CNT_RE,
  hiLinesOf, checkHiLines, vocab, fromTicketDoc, newestFirst, filterTickets, maskGroups, pageOf,
};
