'use strict';
// LM-HUB group gate for uploaded ticket rows (pure, no DB).
// Only tickets whose AssignedGroup is 'LM-HUB' (trimmed, case-insensitive) are accepted from an
// upload. Rows with any other group, or a blank group when the column exists, are rejected and
// counted per group. This only filters INCOMING rows; it never touches tickets already stored.

const LMHUB_GROUP = 'LM-HUB';
const MISSING_GROUP_COLUMN_MSG = 'This file has no AssignedGroup column - export it from LM-HUB with the AssignedGroup column';
const BLANK_GROUP_LABEL = '(blank)';

function isLmHub(v) {
  return String(v == null ? '' : v).trim().toLowerCase() === 'lm-hub';
}

// True when at least one row carries an AssignedGroup key (i.e. the file had the column).
function hasGroupColumn(rows) {
  return (rows || []).some(r => r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'AssignedGroup'));
}

// Split rows into LM-HUB (kept) and everything else (rejected). Groups are bucketed by their
// trimmed, lower-cased value; the label is the first spelling seen. Blank -> '(blank)'.
function filterLmHub(rows) {
  const kept = [], rejected = [];
  const byKey = new Map();   // lower-cased group -> { label, count }
  for (const r of (rows || [])) {
    if (!r || typeof r !== 'object') continue;
    if (isLmHub(r.AssignedGroup)) { kept.push(r); continue; }
    rejected.push(r);
    const label = String(r.AssignedGroup == null ? '' : r.AssignedGroup).trim() || BLANK_GROUP_LABEL;
    const key = label.toLowerCase();
    const b = byKey.get(key);
    if (b) b.count++; else byKey.set(key, { label, count: 1 });
  }
  const rejectedGroups = {};
  for (const { label, count } of byKey.values()) rejectedGroups[label] = count;
  return { kept, rejected, rejectedGroups, rejectedCount: rejected.length };
}

// Merge two { group: count } maps (case-insensitive on the group name). Inputs are sanitised:
// at most 100 groups, names capped at 120 chars, counts must be positive integers.
function mergeRejectedGroups(a, b) {
  const byKey = new Map();
  const add = (src) => {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return;
    for (const [k, v] of Object.entries(src)) {
      const label = String(k || '').trim().slice(0, 120) || BLANK_GROUP_LABEL;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n <= 0) continue;
      const key = label.toLowerCase();
      const cur = byKey.get(key);
      if (cur) cur.count += n;
      else if (byKey.size < 100) byKey.set(key, { label, count: n });
    }
  };
  add(a); add(b);
  const out = {};
  for (const { label, count } of byKey.values()) out[label] = count;
  return out;
}

function sumGroups(groups) {
  return Object.values(groups || {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

// "DXP-Escalations (2,298), GSOC (92)" — largest group first.
function groupList(groups) {
  return Object.entries(groups || {})
    .sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0])))
    .map(([g, n]) => g + ' (' + Number(n).toLocaleString('en-US') + ')')
    .join(', ');
}

// The user-facing rejection message.
function rejectMessage(groups) {
  const n = sumGroups(groups);
  return 'LM-HUB is not selected as the group for ' + n.toLocaleString('en-US') + ' ticket' + (n === 1 ? '' : 's') + ': ' +
    groupList(groups) + '. These tickets were not uploaded. Only LM-HUB tickets are accepted. In the export, filter AssignedGroup = LM-HUB.';
}

module.exports = {
  LMHUB_GROUP, MISSING_GROUP_COLUMN_MSG, BLANK_GROUP_LABEL,
  isLmHub, hasGroupColumn, filterLmHub, mergeRejectedGroups, sumGroups, groupList, rejectMessage,
};
