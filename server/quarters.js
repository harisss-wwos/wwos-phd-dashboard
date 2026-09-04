// Quarter helpers. A "quarter id" looks like "2026-Q3".
// The pre-GSOC archive (Jan 2021 - Mar 2026) is served statically and is NOT a dynamic quarter here.

// Quarter of a Date -> "YYYY-Qn", or null for invalid dates.
function quarterOf(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d)) return null;
  const q = Math.floor(d.getMonth() / 3) + 1; // Jan-Mar=1 ... Oct-Dec=4
  return `${d.getFullYear()}-Q${q}`;
}

// Current quarter id from "now" (defaults to real time; overridable for testing).
function currentQuarter(now) {
  return quarterOf(now || new Date());
}

// Inclusive date range [start, endExclusive) for a quarter id.
function quarterRange(qid) {
  const m = /^(\d{4})-Q([1-4])$/.exec(qid || '');
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const q = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const endExclusive = new Date(year, startMonth + 3, 1, 0, 0, 0, 0);
  return { start, endExclusive };
}

// Human label, e.g. "Q3 2026".
function quarterLabel(qid) {
  const m = /^(\d{4})-Q([1-4])$/.exec(qid || '');
  if (!m) return qid || '';
  return `Q${m[2]} ${m[1]}`;
}

// Is this quarter id the live (current) one?
function isLiveQuarter(qid, now) {
  return qid === currentQuarter(now);
}

module.exports = { quarterOf, currentQuarter, quarterRange, quarterLabel, isLiveQuarter };
