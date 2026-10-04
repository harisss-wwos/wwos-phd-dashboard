// READ-ONLY: build a Count-of-IssueId pivot (ResolvedByIdentity x ClosureCode) across the 3 report
// CSVs for the 7 listed agents, and compare to the user's target table.
const fs = require('fs');
function parseCSV(text) {
  const rows = []; let i = 0, field = '', row = [], inQ = false; text = text.replace(/^\uFEFF/, '');
  while (i < text.length) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return []; const header = rows[0];
  return rows.slice(1).filter(r => r.length && r.some(x => x !== '')).map(r => { const o = {}; header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ''; }); return o; });
}
const FILES = [
  'c:\\Kiro\\01_Data report for Jan 1st 2021 to March 31st 2026.csv',
  'c:\\Kiro\\02_Data report for April 1st 2026 to July 31st 2026.csv',
  'c:\\Kiro\\03_Data report from August 1st.csv',
];
const AGENTS = ['punithsd', 'harisss', 'arunkzn', 'mbozied', 'flofalgu', 'nobregak', 'mellanej'];
const CODES = ['Automatically Closed', 'Duplicate', 'Immediately Resolved', 'Successful', 'Successful with Problems', 'Unsuccessful'];
// Target table (user-provided) for comparison.
const TARGET = {
  punithsd: { 'Automatically Closed': 4, Duplicate: 8, 'Immediately Resolved': 255, Successful: 348, 'Successful with Problems': 0, Unsuccessful: 0 },
  harisss:  { 'Automatically Closed': 2, Duplicate: 7, 'Immediately Resolved': 232, Successful: 330, 'Successful with Problems': 0, Unsuccessful: 0 },
  arunkzn:  { 'Automatically Closed': 0, Duplicate: 13, 'Immediately Resolved': 261, Successful: 301, 'Successful with Problems': 0, Unsuccessful: 0 },
  mbozied:  { 'Automatically Closed': 1, Duplicate: 9, 'Immediately Resolved': 685, Successful: 292, 'Successful with Problems': 0, Unsuccessful: 0 },
  flofalgu: { 'Automatically Closed': 0, Duplicate: 4, 'Immediately Resolved': 374, Successful: 276, 'Successful with Problems': 0, Unsuccessful: 0 },
  nobregak: { 'Automatically Closed': 0, Duplicate: 13, 'Immediately Resolved': 692, Successful: 261, 'Successful with Problems': 0, Unsuccessful: 0 },
  mellanej: { 'Automatically Closed': 0, Duplicate: 12, 'Immediately Resolved': 483, Successful: 63, 'Successful with Problems': 13, Unsuccessful: 16 },
};

// Count distinct IssueId per (agent, code). Use a Set on IssueId to avoid double-counting duplicate rows across files.
const seen = new Set();          // IssueId already counted (dedupe across files)
const pivot = {}; AGENTS.forEach(a => { pivot[a] = {}; CODES.forEach(c => pivot[a][c] = 0); });
let rowsTotal = 0;
for (const f of FILES) {
  const rows = parseCSV(fs.readFileSync(f, 'utf8'));
  rowsTotal += rows.length;
  for (const r of rows) {
    const agent = String(r.ResolvedByIdentity || '').trim().toLowerCase();
    if (AGENTS.indexOf(agent) < 0) continue;
    const code = String(r.ClosureCode || '').trim();
    if (CODES.indexOf(code) < 0) continue;
    const id = String(r.IssueId || r.ShortId || '').trim();
    const key = id + '|' + agent + '|' + code;
    if (id && seen.has(id + '|')) { /* IssueId already counted anywhere */ }
    // dedupe by IssueId across the whole set (a ticket appears once)
    if (id) { if (seen.has(id)) continue; seen.add(id); }
    pivot[agent][code]++;
  }
}

// Print pivot + comparison.
const pad = (s, n) => String(s).padEnd(n);
const padN = (s, n) => String(s).padStart(n);
console.log('Rows read (all 3 files):', rowsTotal, '\n');
console.log(pad('Agent', 10) + CODES.map(c => padN(c.slice(0, 10), 12)).join('') + padN('Total', 8));
let gt = {}; CODES.forEach(c => gt[c] = 0); let gGrand = 0;
AGENTS.forEach(a => {
  let rowTot = 0; CODES.forEach(c => { rowTot += pivot[a][c]; gt[c] += pivot[a][c]; });
  gGrand += rowTot;
  console.log(pad(a, 10) + CODES.map(c => padN(pivot[a][c], 12)).join('') + padN(rowTot, 8));
});
console.log(pad('TOTAL', 10) + CODES.map(c => padN(gt[c], 12)).join('') + padN(gGrand, 8));

// Diff vs target.
console.log('\n=== DIFF vs your target table (computed - target) ===');
let anyDiff = false;
AGENTS.forEach(a => {
  const diffs = [];
  CODES.forEach(c => { const d = pivot[a][c] - (TARGET[a][c] || 0); if (d !== 0) diffs.push(c + ': ' + (d > 0 ? '+' : '') + d); });
  if (diffs.length) { anyDiff = true; console.log('  ' + a + ' -> ' + diffs.join(', ')); }
});
if (!anyDiff) console.log('  MATCH — every cell equals the target table.');
const targetGrand = Object.values(TARGET).reduce((s, o) => s + Object.values(o).reduce((x, y) => x + y, 0), 0);
console.log('\nComputed grand total:', gGrand, '| target grand total:', targetGrand);
