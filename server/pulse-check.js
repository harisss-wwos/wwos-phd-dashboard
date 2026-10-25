// Pulse Check (24h) — pure report maths for GET /api/pulse-check (pulse-check.html).
// No I/O: server.js fetches the docs and passes the shared constants/helpers in `deps`, so this
// module can be exercised with fixture arrays. Never mutates its inputs and never throws on
// missing fields; every divisor is guarded (rates/shares are null when the divisor is 0).
'use strict';

const HOUR_MS = 3600000;
const WINDOW_HOURS = 24;
const AT_RISK_TOP = 10;
const BREACH_ROWS_CAP = 500;
const ISSUE_URL_BASE = 'https://t.corp.amazon.com/issues/';
// Requester identities (lower-cased) skipped by repeatedRequesters. Empty by default (literal rule);
// e.g. add 'atlasforge' to exclude the bot account.
const REPEATED_REQUESTER_IGNORE = [];

// Upper-inclusive age buckets (hours): (0,72], (72,120], (120,168], (168,240] At Risk, >240 Breached.
const BUCKETS = [
  { key: 'd0_3', label: '0\u20133 days', maxH: 72 },
  { key: 'd3_5', label: '3\u20135 days', maxH: 120 },
  { key: 'd5_7', label: '5\u20137 days', maxH: 168 },
  { key: 'd7_10', label: '7\u201310 days (At Risk)', maxH: 240 },
  { key: 'gt10', label: '>10 days (Breached)', maxH: Infinity },
];

function str(v) { return v == null ? '' : String(v); }
function round1(x) { return Math.round(x * 10) / 10; }
// '1 ticket' / '2 tickets' (singular/plural wording for generated text).
function tix(n, noun) { return n + ' ' + (noun || 'ticket') + (n === 1 ? '' : 's'); }
function ms(s) {
  if (typeof s !== 'string' || !s) return null;
  const v = Date.parse(s);
  return isNaN(v) ? null : v;
}
function byCountThenName(nameKey) {
  return (a, b) => (b.count - a.count) || str(a[nameKey]).localeCompare(str(b[nameKey]));
}
// Clock hour (0-23) in America/Denver ("MST" per the repo convention) for a UTC instant.
const _denHourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23' });
function denverHour(t) { return Number(_denHourFmt.format(new Date(t))) % 24; }
function bucketOf(ageMs) {
  for (const b of BUCKETS) if (ageMs <= b.maxH * HOUR_MS) return b.key;
  return 'gt10';
}

// One doc per ShortId (fallback IssueId). Collision: greater q wins; on equal q the greater ResolvedDate
// string wins, which only matters for the resolved set (the created/open reads do not project
// ResolvedDate, so there the comparison is ''>'' and the next tiebreak, first seen, decides).
// Docs with no usable id are dropped and counted in excluded[noIdKey] (per set).
function dedupe(docs, excluded, noIdKey) {
  const map = new Map();
  (Array.isArray(docs) ? docs : []).forEach(d => {
    if (!d) return;
    const key = str(d.ShortId || d.IssueId).trim();
    if (!key) { excluded[noIdKey]++; return; }
    const prev = map.get(key);
    if (!prev) { map.set(key, d); return; }
    const qa = str(d.q), qb = str(prev.q);
    if (qa > qb || (qa === qb && str(d.ResolvedDate) > str(prev.ResolvedDate))) map.set(key, d);
  });
  return Array.from(map, ([id, d]) => ({ id, d }));
}

// Reduce a ticket title to a short incident type ("... - Severity 3 Attack w/ Pet" -> "Attack w/ Pet").
const LABEL_DROP_RE = /^\[?\s*(account id:|no emt\b|repeat$)/i;
const LABEL_SEV_ONLY_RE = /^\[?\s*(severity|sev|category|cat)(?=[\s\d\]:]|$)\s*:?\s*(level\s*)?\d*\s*\]?$/i;
const LABEL_SEV_PREFIX_RE = /^\[*\s*(severity|sev|category|cat)(?=[\s\d:]|$)\s*:?\s*\d*\s*/i;
function incidentLabel(title) {
  let segs = str(title).trim().split(/\s+-\s+/);
  if (segs.length > 1) segs = segs.slice(1);
  segs = segs
    .filter(s => !LABEL_DROP_RE.test(s.trim()) && !LABEL_SEV_ONLY_RE.test(s.trim()))
    .map(s => s.replace(LABEL_SEV_PREFIX_RE, '').replace(/[[\]]/g, '').trim())
    .filter(Boolean);
  const label = segs.join(' - ').replace(/\b(\w+)\s+\1\b/gi, '$1').trim();
  return label || 'Unspecified';
}

function incidentType(title) {
  const t = str(title);
  if (/driver threat/i.test(t)) return 'Driver Threat';
  if (/community member/i.test(t)) return 'Community Member';
  if (/customer incident/i.test(t)) return 'Customer Incident';
  return 'Other';
}

// Issue (incident type) from a ticket's RootCauseDetails. The standard blob (tool-rcd.html) is
// "Issue: <type>\nSID: ..\nDriv: ..\nDate: ..\n..\nRes: ..\nTag: .."; a few legacy rows are one line
// ("Issue: X SID: Y ..."), so the value stops at a newline or at the next known "KEY:". Empty blobs,
// blobs with no Issue line and placeholder values (NA, N/A, none, ...) -> 'Not specified'.
const ISSUE_NOT_SPECIFIED = 'Not specified';
const RCD_NEXT_KEYS = 'SID|Station\\s*ID|TID|Transporter\\s*ID|Driv|Driver\\s*Type|Date|Incident\\s*Date|TBA|Tracking\\s*ID|Cnt|Historical\\s*Incident|Zip|CID|AID|UPID|Res|Resolution|Tag';
const RCD_ISSUE_RE = new RegExp('(?:^|\\s)I?ssue(?:\\s*Type)?[ \\t]*:[ \\t]*([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
// Markdown bold markers ("**Res:** X", pasted from formatted notes) are dropped before matching.
function rcdPlain(rcd) { return str(rcd).replace(/\*\*/g, ''); }
function issueFromRcd(rcd) {
  const m = rcdPlain(rcd).match(RCD_ISSUE_RE);
  const v = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return (!v || /^(n\/?a|none|null|unknown|-+|\u2014)$/i.test(v)) ? ISSUE_NOT_SPECIFIED : v;
}

// Resolution from the same blob: the "Res:" line (live data: 'Res' ~98%, 'Resolution' ~2%). The key must start
// the blob or follow whitespace and be exactly Res/Resolution before the colon, so words such as "Resolved"
// or "Pres" never match; the value stops at a newline or the next known "KEY:" (same list as the Issue regex).
// Placeholder values (NA, N/A, none, null, unknown, dashes) and blobs without the key -> 'Not specified'.
const RCD_RESOLUTION_RE = new RegExp('(?:^|\\s)Res(?:olution)?[ \\t]*:([^\\r\\n]*?)(?=\\s+(?:' + RCD_NEXT_KEYS + ')\\s*:|[\\r\\n]|$)', 'i');
function resolutionFromRcd(rcd) {
  const m = rcdPlain(rcd).match(RCD_RESOLUTION_RE);
  const v = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return (!v || /^(n\/?a|none|null|unknown|-+|\u2014)$/i.test(v)) ? ISSUE_NOT_SPECIFIED : v;
}

const ROOT_CAUSE_NOT_SPECIFIED = 'Not specified';
function isNaCause(rc) {
  const s = str(rc).trim().toLowerCase();
  return s === '' || s === 'n/a' || s === 'na' || s.startsWith('not applicable') || s.includes('no further action');
}

function computePulseReport(input, deps) {
  // The window always ends on a whole UTC hour (input.end is floored; input.start is ignored and
  // derived as end - 24h) so each Section 9 row is exactly one real clock hour and the peak hour
  // names a real single hour even if the caller passes a non-hour-aligned end.
  // input.start (optional) lets the caller pass a calendar-day window (one full MST day, which is 23,
  // 24 or 25 hours on DST days); without it the window is the 24 h ending at `end`. Both edges are
  // floored to the whole hour, so every Section 9 slot is exactly one real clock hour.
  const endMs = Math.floor(input.end.getTime() / HOUR_MS) * HOUR_MS;
  const startMs = input.start ? Math.floor(input.start.getTime() / HOUR_MS) * HOUR_MS : endMs - WINDOW_HOURS * HOUR_MS;
  const start = new Date(startMs), end = new Date(endMs);
  const windowHours = Math.max(1, Math.round((endMs - startMs) / HOUR_MS));
  const excluded = { createdNoId: 0, resolvedNoId: 0, openNoId: 0, createdNoDate: 0, resolvedNoDate: 0, openNoDate: 0 };
  const isAutosim = t => str(t.ResolvedByIdentity).trim() === deps.AUTOSIM_IDENTITY;
  const cc = t => str(t.ClosureCode).trim().toLowerCase();
  const tagsOf = t => {
    const raw = (str(t.Labels).match(deps.HASHTAG_TOKEN_RE) || [])
      .concat(Array.isArray(t.ManualHashtags) ? t.ManualHashtags : []);
    const set = new Set();
    raw.forEach(x => { const n = deps.normHashtag(x); if (n) set.add(n); });
    return set;
  };
  const agentOf = t => {
    if (isAutosim(t)) return 'AutoSIM';
    const s = str(t.ResolvedByIdentity).trim().split('@')[0];
    const tail = s.slice(s.lastIndexOf('/') + 1).trim().toLowerCase();
    return tail || 'Unknown';
  };
  // Current assignee of an OPEN ticket. agentOf() reads ResolvedByIdentity (the resolver), which is blank on
  // open tickets, so this reads AssigneeIdentity (the field My Tickets / Hashtags / SLA pages use) and
  // normalises it exactly like agentOf (strip kerberos:/domain/path, lower-case). Blank -> 'Unassigned'.
  const openAgentOf = t => {
    const raw = str(t.AssigneeIdentity).trim();
    if (!raw) return 'Unassigned';
    if (raw === deps.AUTOSIM_IDENTITY) return 'AutoSIM';
    if (raw.toLowerCase() === '0d1616c8-bcb7-4450-8bc5-f0a296bc01d1') return 'LM-CAP';
    const s = raw.replace(/^kerberos:/i, '').split('@')[0];
    const tail = s.slice(s.lastIndexOf('/') + 1).trim().toLowerCase();
    return tail || 'Unassigned';
  };
  const urlOf = (d, id) => str(d.IssueUrl).trim() || (ISSUE_URL_BASE + id);

  // ---- Prepare the three sets (dedupe, then exact half-open window filter on parsed dates). ----
  const created = [];
  dedupe(input.created, excluded, 'createdNoId').forEach(({ id, d }) => {
    const cd = ms(d.CreateDate);
    if (cd === null) { excluded.createdNoDate++; return; }
    if (cd >= startMs && cd < endMs) created.push({ id, d, cd });
  });
  const resolved = [];
  dedupe(input.resolved, excluded, 'resolvedNoId').forEach(({ id, d }) => {
    const rd = ms(d.ResolvedDate);
    if (rd === null) { excluded.resolvedNoDate++; return; }
    if (rd >= startMs && rd < endMs) resolved.push({ id, d, rd, cd: ms(d.CreateDate) });
  });
  const open = [];
  dedupe(input.open, excluded, 'openNoId').forEach(({ id, d }) => {
    const cd = ms(d.CreateDate);
    if (cd === null || cd > endMs) { excluded.openNoDate++; return; }
    open.push({ id, d, cd, ageMs: endMs - cd });
  });

  // ---- KPIs ----
  let immediate = 0, successful = 0, duplicate = 0;
  const succImm = [];
  resolved.forEach(r => {
    const c = cc(r.d);
    if (c === 'immediately resolved') { immediate++; succImm.push(r); }
    else if (c === 'successful') { successful++; succImm.push(r); }
    else if (c === 'duplicate') duplicate++;
  });
  const successfulImm = immediate + successful;
  // pet_incident_auto_resolved is listed as a normal hashtag entry (label without '#'). A ticket carries it when the
  // AutoSIM tag is in Tags or Labels (the original petAutoResolved rule) or when tagsOf already yields the '#' variant
  // (e.g. via ManualHashtags). Each ticket is counted at most once for it and the '#' variant is dropped, so the entry
  // appears exactly once.
  const autoHashTag = deps.normHashtag(deps.AUTOSIM_TAG);
  const autoLabel = String(deps.AUTOSIM_TAG);
  const carriesAuto = (d, tags) => tags.has(autoHashTag) || deps.tagsToStr(d.Tags).includes(deps.AUTOSIM_TAG)
    || str(d.Labels).toLowerCase().includes(deps.AUTOSIM_TAG);
  const tagCounts = new Map();
  let hashtagsResolved = 0, petAutoResolved = 0;
  // Resolved tickets carrying no hashtag at all (a ticket can carry several tags, so tag counts can sum to more than resolved).
  // A ticket carrying the AutoSIM tag counts as tagged.
  let resolvedUntagged = 0;
  resolved.forEach(r => {
    const tags = tagsOf(r.d);
    const auto = carriesAuto(r.d, tags);
    tags.delete(autoHashTag);
    tags.forEach(tag => { hashtagsResolved++; tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1); });
    if (auto) { petAutoResolved++; hashtagsResolved++; tagCounts.set(autoLabel, (tagCounts.get(autoLabel) || 0) + 1); }
    if (tags.size === 0 && !auto) resolvedUntagged++;
  });
  let hashtagsCreated = 0;
  created.forEach(c => { hashtagsCreated += tagsOf(c.d).size; });

  const reqCounts = new Map();
  created.forEach(c => {
    const r = str(c.d.RequesterIdentity).trim().toLowerCase();
    if (!r || REPEATED_REQUESTER_IGNORE.includes(r)) return;
    reqCounts.set(r, (reqCounts.get(r) || 0) + 1);
  });
  let repeatedRequesters = 0;
  reqCounts.forEach(n => { if (n > 1) repeatedRequesters++; });
  const stationRequests = created.filter(c => /station\s*request/i.test(str(c.d.Labels))).length;

  // Open tickets by current Status: the SAME deduped `open` set that gives kpis.openTotal. The DB field is
  // `Status` (ticket_docs); live values are exactly 'Assigned' / 'Work In Progress' / 'Pending' /
  // 'Researching' (OPEN_STATUSES in server.js). Matched trim + case-insensitive, with 'wip' accepted as
  // an alias of 'Work In Progress'; any other value only counts toward openTotal.
  const openByStatus = { assigned: 0, wip: 0, pending: 0, researching: 0 };
  open.forEach(o => {
    let s = str(o.d.Status).trim().toLowerCase().replace(/\s+/g, ' ');
    if (s === 'wip') s = 'work in progress';
    if (s === 'assigned') openByStatus.assigned++;
    else if (s === 'work in progress') openByStatus.wip++;
    else if (s === 'pending') openByStatus.pending++;
    else if (s === 'researching') openByStatus.researching++;
  });
  // Repeat incident = the dashboard's existing definition (server.js hiCountOf, used by /api/hi-resolved,
  // /api/hi-monthly, the daily summary): RootCauseDetails contains "Cnt: <n>" or "Historical Incident: <n>"
  // with n > 0. Applied to the tickets resolved in the window (any closure code).
  const repeatResolved = resolved.filter(r => deps.hiCountOf(r.d.RootCauseDetails) > 0).length;

  // ---- Status snapshot (current Status of created tickets) ----
  const nCreated = created.length, nResolved = resolved.length;
  const pctOf = (n, d) => (d > 0 ? round1(n / d * 100) : null);
  const groupCount = (arr, keyFn) => {
    const m = new Map();
    arr.forEach(x => { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const statusSnapshot = Array.from(groupCount(created, c => str(c.d.Status).trim() || 'Unknown'),
    ([status, count]) => ({ status, count, pct: pctOf(count, nCreated) })).sort(byCountThenName('status'));

  // ---- Incident types (first match wins; Other last) ----
  const typeMap = groupCount(created, c => incidentType(c.d.Title));
  const incidentTypes = Array.from(typeMap, ([type, count]) => ({ type, count, pct: pctOf(count, nCreated) }))
    .filter(r => r.type !== 'Other').sort(byCountThenName('type'));
  if (typeMap.get('Other')) incidentTypes.push({ type: 'Other', count: typeMap.get('Other'), pct: pctOf(typeMap.get('Other'), nCreated) });

  // ---- Root causes (RootCause field): the single definition shared by Section 6 (Resolution Breakdown) and
  // Section 4 (Root Cause Distribution). N/A-style values (isNaCause) are counted in naCount; the rest are
  // grouped case-insensitively and shown with the first-seen spelling.
  let naCount = 0;
  const causeMap = new Map();
  resolved.forEach(r => {
    if (isNaCause(r.d.RootCause)) { naCount++; return; }
    const disp = str(r.d.RootCause).trim(), k = disp.toLowerCase();
    const g = causeMap.get(k);
    if (g) g.count++; else causeMap.set(k, { cause: disp, count: 1 });
  });
  const rootCauseOf = d => (isNaCause(d.RootCause) ? ROOT_CAUSE_NOT_SPECIFIED : causeMap.get(str(d.RootCause).trim().toLowerCase()).cause);

  // ---- Resolved tickets by issue (RootCauseDetails "Issue:"); EVERY resolved ticket, no cap ----
  // Issues are grouped case-insensitively and shown with the first-seen spelling.
  // Resolutions (RootCauseDetails "Res:") are grouped the same way.
  const issueDisp = new Map(), resDisp = new Map();
  const resolvedList = resolved.map(r => {
    const issue = issueFromRcd(r.d.RootCauseDetails), k = issue.toLowerCase();
    if (!issueDisp.has(k)) issueDisp.set(k, issue);
    const res = resolutionFromRcd(r.d.RootCauseDetails), rk = res.toLowerCase();
    if (!resDisp.has(rk)) resDisp.set(rk, res);
    return { shortId: r.id, url: urlOf(r.d, r.id), issue: issueDisp.get(k), rootCause: rootCauseOf(r.d), resolution: resDisp.get(rk), closureCode: str(r.d.ClosureCode).trim(), resolvedAt: new Date(r.rd).toISOString() };
  }).sort((a, b) => a.issue.localeCompare(b.issue) || a.resolvedAt.localeCompare(b.resolvedAt) || a.shortId.localeCompare(b.shortId));
  const resolvedIssueCounts = Array.from(groupCount(resolvedList, x => x.issue), ([issue, count]) => ({ issue, count, pct: pctOf(count, nResolved) }))
    .sort(byCountThenName('issue'));
  // Every cause (no 'Other' grouping, no cap); counts sum to nResolved.
  const resolvedRootCauseCounts = Array.from(groupCount(resolvedList, x => x.rootCause), ([cause, count]) => ({ cause, count, pct: pctOf(count, nResolved) }))
    .sort(byCountThenName('cause'));
  // Every resolution (no 'Other' grouping, no cap); counts sum to nResolved.
  const resolvedResolutionCounts = Array.from(groupCount(resolvedList, x => x.resolution), ([resolution, count]) => ({ resolution, count, pct: pctOf(count, nResolved) }))
    .sort(byCountThenName('resolution'));

  // ---- Resolution breakdown ----
  const allCauses = Array.from(causeMap.values()).sort(byCountThenName('cause'));
  const singles = allCauses.filter(c => c.count === 1).length;
  const resolution = {
    total: nResolved, immediate, successful, duplicate, naCount, naPct: pctOf(naCount, nResolved),
    rootCauses: allCauses.filter(c => c.count > 1).map(c => ({ cause: c.cause, count: c.count })),
    otherCauses: { causes: singles, count: singles },
  };

  // ---- Agents (Successful + Immediately Resolved only) ----
  const agentMap = new Map();
  succImm.forEach(r => {
    const a = agentOf(r.d);
    const row = agentMap.get(a) || { agent: a, immediate: 0, successful: 0, total: 0, isAutosim: a === 'AutoSIM' };
    if (cc(r.d) === 'immediately resolved') row.immediate++; else row.successful++;
    row.total++;
    agentMap.set(a, row);
  });
  const agentRows = Array.from(agentMap.values())
    .sort((a, b) => (b.total - a.total) || (b.immediate - a.immediate) || a.agent.localeCompare(b.agent));
  const auto = agentMap.get('AutoSIM');
  const autosimResolved = auto ? auto.total : 0;
  const autosimSharePct = successfulImm > 0 ? Math.round(autosimResolved / successfulImm * 100) : null;
  const humans = agentRows.filter(r => !r.isAutosim && r.agent !== 'Unknown')
    .map(r => ({ agent: r.agent, immediate: r.immediate, successful: r.successful, total: r.total }));
  const agents = {
    total: successfulImm,
    rows: agentRows,
    autosimLine: { n: autosimResolved, d: successfulImm, pct: autosimSharePct, allImmediate: !!auto && auto.successful === 0 },
    topHuman: humans[0] || null,
    nextHumans: humans.slice(1, 3),
  };

  // ---- Hashtags (resolved set) ----
  const tagRows = Array.from(tagCounts, ([tag, count]) => ({ tag, count })).sort(byCountThenName('tag'));
  const top5 = tagRows.slice(0, 5).reduce((s, r) => s + r.count, 0);
  const hashtags = {
    onResolved: hashtagsResolved, onCreated: hashtagsCreated, unique: tagRows.length, rows: tagRows, resolvedUntagged,
    topTag: tagRows[0] ? { tag: tagRows[0].tag, count: tagRows[0].count, sharePct: pctOf(tagRows[0].count, hashtagsResolved) } : null,
    top5SharePct: hashtagsResolved > 0 ? Math.round(top5 / hashtagsResolved * 100) : null,
    petAutoResolved,
  };
  // topTag/top5SharePct/unique/onResolved are computed over the merged rows (pet_incident_auto_resolved included, so the
  // table, summary and these figures agree). The '#out-of-scope' action below instead keys on the top real '#' hashtag
  // (the AutoSIM marker is a system tag, not a human tagging signal), so it still fires when AutoSIM volume outranks it;
  // its share uses the same merged denominator as the table.
  const topRealTag = tagRows.find(r => r.tag.charAt(0) === '#') || null;

  // ---- Hourly flow: one slot per real hour from the window start, labelled with its MST clock hour ----
  // Slots are indexed by offset from `start` (not hour-of-day), so a 25-hour DST day keeps both
  // "01" hours apart and a non-midnight window never merges two different clock hours.
  const hourRows = [];
  for (let i = 0; i < windowHours; i++) {
    const t = startMs + i * HOUR_MS;
    hourRows.push({ slot: i, hour: denverHour(t), start: new Date(t).toISOString(), created: 0, resolved: 0 });
  }
  const slotOf = t => Math.min(windowHours - 1, Math.max(0, Math.floor((t - startMs) / HOUR_MS)));
  created.forEach(c => { hourRows[slotOf(c.cd)].created++; });
  resolved.forEach(r => { hourRows[slotOf(r.rd)].resolved++; });
  let peak = null;
  hourRows.forEach(r => { if (r.created > 0 && (!peak || r.created > peak.created)) peak = { slot: r.slot, hour: r.hour, created: r.created }; });
  const hourly = { tz: 'MST', rows: hourRows, totalCreated: nCreated, totalResolved: nResolved, peak };

  // ---- SLA health (all open tickets, aged from `end`) ----
  const bucketCounts = {};
  BUCKETS.forEach(b => { bucketCounts[b.key] = 0; });
  const atRiskList = [];
  open.forEach(o => {
    const k = bucketOf(o.ageMs);
    bucketCounts[k]++;
    if (k === 'd7_10') atRiskList.push(o);
  });
  atRiskList.sort((a, b) => (b.ageMs - a.ageMs) || a.id.localeCompare(b.id));
  const labelMap = new Map();
  atRiskList.forEach(o => {
    const lab = incidentLabel(o.d.Title), k = lab.toLowerCase();
    const g = labelMap.get(k);
    if (g) g.count++; else labelMap.set(k, { type: lab, count: 1 });
  });
  const atRisk = bucketCounts.d7_10, openBreached = bucketCounts.gt10;
  const sla = {
    asOf: end.toISOString(), open: open.length, atRisk, breached: openBreached,
    buckets: BUCKETS.map(b => ({ key: b.key, label: b.label, count: bucketCounts[b.key] })),
    atRiskByStatus: Array.from(groupCount(atRiskList, o => str(o.d.Status).trim() || 'Unknown'),
      ([status, count]) => ({ status, count })).sort(byCountThenName('status')),
    atRiskByAgent: Array.from(groupCount(atRiskList, o => openAgentOf(o.d)),
      ([agent, count]) => ({ agent, count })).sort(byCountThenName('agent')), // ALL at-risk tickets; server.js strips it without canViewSLA
    atRiskTypes: Array.from(labelMap.values()).sort(byCountThenName('type')).slice(0, 3),
    atRiskTop: atRiskList.slice(0, AT_RISK_TOP).map(o => ({
      shortId: o.id, url: urlOf(o.d, o.id), agent: openAgentOf(o.d), status: str(o.d.Status).trim() || 'Unknown',
      ageDays: round1(o.ageMs / HOUR_MS / 24), title: str(o.d.Title),
    })),
    atRiskMore: Math.max(0, atRisk - AT_RISK_TOP),
    detailHidden: false, // server.js sets true (and empties atRiskTop) for callers without canViewSLA
  };

  // ---- Historical breaches (resolved in window, duration > SLA_HOURS) ----
  const slaMs = deps.SLA_HOURS * HOUR_MS;
  const breachList = resolved.filter(r => r.cd !== null && r.rd >= r.cd && (r.rd - r.cd) > slaMs)
    .map(r => ({ id: r.id, d: r.d, hrs: (r.rd - r.cd) / HOUR_MS }))
    .sort((a, b) => (b.hrs - a.hrs) || a.id.localeCompare(b.id));
  const bTotal = breachList.length;
  const worst = bTotal ? breachList[0].hrs : null;
  const breaches = {
    total: bTotal,
    worstHrs: bTotal ? round1(worst) : null,
    worstDays: bTotal ? round1(round1(worst) / 24) : null,
    bestHrs: bTotal ? round1(breachList[bTotal - 1].hrs) : null,
    avgHrs: bTotal ? round1(breachList.reduce((s, b) => s + b.hrs, 0) / bTotal) : null,
    allResolved: true,
    detailHidden: false, // server.js sets true (and empties rows) for callers without canViewSLA
    rows: breachList.slice(0, BREACH_ROWS_CAP).map(b => ({ shortId: b.id, url: urlOf(b.d, b.id), hours: round1(b.hrs) })),
  };

  // ---- Action items (only when the condition holds) ----
  const actions = [];
  if (atRisk > 0) actions.push(atRisk === 1
    ? { severity: 'CRITICAL', title: '1 open ticket is approaching SLA breach.',
      body: 'This ticket is between 7\u201310 days old and will breach the 240-hour SLA limit if not resolved immediately. Assign a dedicated agent to clear this case today.' }
    : { severity: 'CRITICAL', title: atRisk + ' open tickets approaching SLA breach.',
      body: 'These tickets are between 7\u201310 days old and will breach the 240-hour SLA limit if not resolved immediately. Assign dedicated agents to clear these cases today.' });
  if (openBreached > 0) actions.push(openBreached === 1
    ? { severity: 'CRITICAL', title: '1 open ticket has already breached the 240-hour SLA.', body: 'Resolve or escalate this ticket immediately.' }
    : { severity: 'CRITICAL', title: openBreached + ' open tickets have already breached the 240-hour SLA.', body: 'Resolve or escalate these tickets immediately.' });
  if (nCreated > 0 && hashtagsCreated === 0) actions.push({ severity: 'HIGH', title: 'Tagging compliance gap: 0 hashtags on new tickets.',
    body: (nCreated === 1 ? 'The 1 newly created ticket was not tagged with hashtags.' : 'None of the ' + nCreated + ' newly created tickets were tagged with hashtags.')
      + ' Enforce tagging policy to ensure proper categorization and tracking.' });
  if (agents.topHuman || autosimSharePct !== null) {
    const parts = [];
    const th = agents.topHuman;
    if (th) parts.push(th.agent + ' was the top human resolver with ' + tix(th.total) + ' (' + th.immediate + ' Imm + ' + th.successful + ' Successful).');
    if (autosimSharePct !== null) parts.push('AutoSIM handled ' + autosimSharePct + '% of all resolutions (' + autosimResolved + '/' + successfulImm + ')'
      + (autosimSharePct > 0 ? ' \u2014 automation is working effectively.' : '.'));
    actions.push({ severity: 'MEDIUM', title: 'Recognize top performers.', body: parts.join(' ') });
  }
  if (topRealTag && topRealTag.tag === '#out-of-scope') actions.push({ severity: 'MEDIUM', title: 'Review intake process for out-of-scope tickets.',
    body: '#out-of-scope is the most common hashtag at ' + pctOf(topRealTag.count, hashtagsResolved) + '% (' + topRealTag.count + ' of ' + hashtagsResolved + '). Investigate why these tickets are entering the queue and implement upstream filters.' });
  if (bTotal > 0 && openBreached === 0) actions.push({ severity: 'INFO',
    title: bTotal === 1 ? 'The 1 historical SLA breach is now resolved.' : 'All ' + bTotal + ' historical SLA breaches are now resolved.',
    body: 'No currently open tickets have breached the 240-hour SLA.' + (atRisk > 0 ? ' Continue monitoring the ' + atRisk + ' at-risk ' + (atRisk === 1 ? 'ticket' : 'tickets') + ' to maintain this trend.' : '') });

  const latestMs = ms(input.latestCreateDate);
  return {
    generatedAt: new Date().toISOString(),
    window: { start: start.toISOString(), end: end.toISOString() },
    windowHours,
    totalDataset: Number(input.totalDataset) || 0,
    latestCreateDate: latestMs === null ? null : new Date(latestMs).toISOString(),
    excluded,
    kpis: {
      created: nCreated, resolved: nResolved, successfulImm, immediate, successful, duplicate,
      hashtagsResolved, hashtagsCreated, repeatedRequesters, stationRequests,
      slaAtRisk: atRisk, slaBreachedWindow: bTotal, openTotal: open.length, openBreached,
      openAssigned: openByStatus.assigned, openWip: openByStatus.wip, openPending: openByStatus.pending,
      openResearching: openByStatus.researching, repeatResolved,
    },
    summary: {
      resolutionRatePct: pctOf(nResolved, nCreated), autosimResolved, autosimSharePct,
      peakHourMst: peak ? peak.hour : null, peakHourCreated: peak ? peak.created : 0,
    },
    statusSnapshot,
    incidentTypes,
    stationRequestCount: stationRequests,
    resolvedIssueCounts,
    resolvedRootCauseCounts,
    resolvedResolutionCounts,
    resolvedList,
    resolvedDetailHidden: false, // server.js sets true (and empties resolvedList) for callers without canViewSLA
    resolution,
    agents,
    hashtags,
    hourly,
    sla,
    breaches,
    actions,
  };
}

module.exports = { computePulseReport, incidentLabel, issueFromRcd, resolutionFromRcd, REPEATED_REQUESTER_IGNORE, BUCKETS };
