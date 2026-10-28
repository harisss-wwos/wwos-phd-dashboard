// Merge a "Build Root Cause Details" push (Tools page) into an EXISTING My-Tickets incident-log
// entry without touching anything the analyst already wrote.
//
// Section format (same as incident-log-editor.js ilSerializeFields), sections joined by blank lines:
//   **PHD Findings**:\n...              (block)
//   **PHD Investigation for mitigation:**\n...  (block)
//   **SIM Root Cause Details:**\n...    (block)
//   **Root Cause**: ...                 (inline)
//   **PHD Related Link**: ...           (inline)
//   **PHD Resolution**: ...             (inline)
//   **PHD notes**:\n...                 (block)
//
// The merge edits the ORIGINAL string in place (span replacement), so every byte outside the
// sections it fills — Findings / Investigation / notes, unknown sections, CRLF, extra blank
// lines — is preserved exactly. A lone "-" counts as empty (the serializer's placeholder).

const SECTIONS = [
  { key: 'findings',  re: /(?:\*\*)?PHD Findings(?:\*\*)?:/i,             block: true,  label: '**PHD Findings**:' },
  { key: 'invest',    re: /\*\*PHD Investigation for mitigation:\*\*/i,   block: true,  label: '**PHD Investigation for mitigation:**' },
  { key: 'sim',       re: /\*\*SIM Root Cause Details:\*\*/i,             block: true,  label: '**SIM Root Cause Details:**' },
  { key: 'rootCause', re: /\*\*Root Cause\*\*:/i,                         block: false, label: '**Root Cause**:' },
  { key: 'link',      re: /\*\*PHD Related Link\*\*:/i,                   block: false, label: '**PHD Related Link**:' },
  { key: 'res',       re: /\*\*PHD Resolution\*\*:/i,                     block: false, label: '**PHD Resolution**:' },
  { key: 'notes',     re: /\*\*PHD notes\*\*:/i,                          block: true,  label: '**PHD notes**:' },
];

const isEmptyVal = (v) => { v = String(v == null ? '' : v).trim(); return !v || v === '-'; };

// Locate each known section in text: { key -> { start, bodyStart, bodyEnd } } (first occurrence at
// a line start). A body ends at the next known label line or the next "blank line + **" heading
// (the same boundary /api/rcd-target uses for hasSim), so unknown sections are never swallowed.
function locateSections(text) {
  const s = String(text || '');
  const found = {};
  for (const sec of SECTIONS) {
    const re = new RegExp('(^|\\n)[ \\t]*(' + sec.re.source + ')', 'i');
    const m = re.exec(s);
    if (!m) continue;
    const start = m.index + m[1].length;
    found[sec.key] = { start, bodyStart: m.index + m[0].length };
  }
  const starts = Object.values(found).map(f => f.start);
  for (const key of Object.keys(found)) {
    const f = found[key];
    let end = s.length;
    for (const st of starts) if (st >= f.bodyStart && st < end) end = st;   // next known label
    const rest = s.slice(f.bodyStart);
    const hm = /\r?\n[ \t]*\r?\n[ \t]*\*\*/.exec(rest);                     // next "\n\n**" heading
    if (hm && f.bodyStart + hm.index < end) end = f.bodyStart + hm.index;
    f.bodyEnd = end;
  }
  return found;
}

function sectionBody(text, key) {
  const f = locateSections(text)[key];
  return f ? String(text).slice(f.bodyStart, f.bodyEnd) : null;
}

// True if the text already has a non-empty (not "-") SIM Root Cause Details section.
function hasSimFilled(text) {
  const b = sectionBody(text, 'sim');
  return b != null && !isEmptyVal(b);
}

// True if the text contains at least one recognisable structured section label.
function hasStructuredSections(text) {
  return Object.keys(locateSections(text)).length > 0;
}

// Full blob for a ticket with no existing entry (identical to the old Tools-page wrapper).
function buildRcdBlob(f) {
  f = f || {};
  return [
    '**PHD Findings**:\n-',
    '**PHD Investigation for mitigation:**\n-',
    '**SIM Root Cause Details:**\n' + String(f.sim || '').trim(),
    '**Root Cause**: ' + String(f.rootCause || '').trim(),
    '**PHD Related Link**: ' + String(f.link || '').trim(),
    '**PHD Resolution**: ' + String(f.res || '').trim(),
    '**PHD notes**:\n-',
  ].join('\n\n');
}

// Merge f = { sim, rootCause, link, res } into text.
// Returns { conflict:true } when SIM is already filled, else { text, filled:[keys] }.
// Only empty / "-" sections are filled; filled values are never overwritten; missing sections
// are inserted in canonical order (only when there is a value to put in them).
function mergeRcdIntoText(text, f) {
  const orig = String(text || '');
  const nl = orig.includes('\r\n') ? '\r\n' : '\n';
  const toNl = (v) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().split('\n').join(nl);
  if (hasSimFilled(orig)) return { conflict: true };
  let out = orig;
  const filled = [];
  // Sections are re-located after every edit, so offsets always match the current string.
  for (const key of ['sim', 'rootCause', 'link', 'res']) {
    const value = toNl(f && f[key]);
    if (!value) continue;
    const sec = SECTIONS.find(x => x.key === key);
    const loc = locateSections(out);
    const here = loc[key];
    if (here) {
      const body = out.slice(here.bodyStart, here.bodyEnd);
      if (!isEmptyVal(body)) continue;                 // never overwrite a filled value
      let lead, trail;
      const core = body.trim();
      if (core) {                                      // the "-" placeholder: keep its surrounding whitespace
        const i = body.indexOf(core);
        lead = body.slice(0, i); trail = body.slice(i + core.length);
      } else if (sec.block) {
        const m = /^[ \t]*\r?\n/.exec(body);
        lead = m ? m[0] : (body.match(/^[ \t]*/)[0] + nl);
        trail = body.slice(m ? m[0].length : body.match(/^[ \t]*/)[0].length);
      } else {
        const h = body.match(/^[ \t]*/)[0];
        lead = h || ' '; trail = body.slice(h.length);
      }
      if (sec.block && !/\n/.test(lead)) lead = lead.replace(/[ \t]*$/, '') + nl;
      if (!sec.block && /\n/.test(lead)) lead = ' ' + lead.replace(/^[^\n]*\n/, '');   // keep inline value on the label line
      out = out.slice(0, here.bodyStart) + lead + value + trail + out.slice(here.bodyEnd);
    } else {
      // Missing section: insert before the first present section that canonically follows it,
      // otherwise append at the end (before any trailing whitespace).
      const piece = sec.label + (sec.block ? nl : ' ') + value;
      const idx = SECTIONS.findIndex(x => x.key === key);
      const after = SECTIONS.slice(idx + 1).map(x => loc[x.key]).filter(Boolean).sort((a, b) => a.start - b.start)[0];
      if (after) {
        out = out.slice(0, after.start) + piece + nl + nl + out.slice(after.start);
      } else {
        const tw = out.match(/\s*$/)[0];
        const head = out.slice(0, out.length - tw.length);
        out = head + (head ? nl + nl : '') + piece + tw;
      }
    }
    filled.push(key);
  }
  return { text: out, filled };
}

module.exports = { locateSections, hasSimFilled, hasStructuredSections, buildRcdBlob, mergeRcdIntoText, isEmptyVal };
