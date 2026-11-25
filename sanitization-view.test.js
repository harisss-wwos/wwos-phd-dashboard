// Tests for sanitization-view.js (the Sanitization Tracker ticket view), run with
//   node --test sanitization-view.test.js
// The file is a browser IIFE with a module.exports branch, so it loads here without a DOM. Everything
// is asserted against a synthetic GET /api/my-sanitization payload: no network, no DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const V = require('./sanitization-view.js');
const eng = require('./server/sanitization-validate.js');

const DETECTED = '2026-02-11T07:30:00.000Z';
const FAILURES = [
  { key: 'country', group: 'title', label: 'Title: country code', message: 'The title does not start with a known country code.' },
  { key: 'Res', group: 'rcd', label: 'Sim Root Cause Details: Res', message: 'Res: has no value (it is required).' },
];
const FIELDS = { Issue: 'Verbal abuse', SID: 'DAB5', TID: 'A1V1CPQ92KVCZG', Driv: 'DSP DA', Date: '02/11/26', Cnt: '0', Zip: '98109', CID: 'N/A', UPID: 'N/A', Res: 'N/A' };

// One 'error-detected' ticket, one sanitized, one to sanitize.
function ticket(o) {
  return Object.assign({ shortId: 'T0', url: 'https://sim/T0', title: 'Customer Incident Escalation - Verbal abuse', assignedAt: '2026-02-01T00:00:00.000Z',
    scoreNow: 7, passedNow: null, requiredNow: null, defects: [], missingNow: [], closureCode: 'Successful', status: 'needs-correction',
    verified: false, verifiedFailed: false, mark: null, verifiedMark: null, returned: null, validation: null }, o);
}
function payload(o) {
  const v = { login: 'chousoud', dataAsOf: DETECTED, maxScore: 11, tickets: [
    ticket({ shortId: 'BAD', status: 'error-detected', verified: true,
      validation: { closureCode: 'Successful', scope: 'title+rcd', detectedAt: DETECTED, failures: FAILURES, fields: FIELDS } }),
    ticket({ shortId: 'OK1', status: 'cleared', verified: true, scoreNow: 11, verifiedMark: { status: 'successful', at: DETECTED } }),
    ticket({ shortId: 'NEED', status: 'needs-correction', reason: 'missing', missingNow: ['Title: no severity'] }),
  ], approved: [] };
  return Object.assign(v, o || {});
}
const when = iso => (iso ? String(iso).slice(0, 10) : '');
const opts = o => Object.assign({ h: { when, ic: () => '', url: t => t.url } }, o || {});

test("sections() puts an 'error-detected' ticket in ded", () => {
  const s = V.sections(payload());
  assert.deepEqual(s.ded.map(t => t.shortId), ['BAD']);
  assert.deepEqual(s.need.map(t => t.shortId), ['NEED']);
  assert.deepEqual(s.ok.map(t => t.shortId), ['OK1']);
});

test('totalsOf() reports errorDetected and keeps it out of cleared and needsCorrection', () => {
  const T = V.totalsOf(payload());
  assert.equal(T.errorDetected, 1);
  assert.equal(T.cleared, 1);
  assert.equal(T.needsCorrection, 1);
  assert.equal(T.assigned, 3);
  assert.equal(T.needBy.missing, 1);   // only the to-sanitize row counts towards a reason
});

test('viewHtml keeps the Error detected count in the KPI strip but has no Error detected section', () => {
  // The rows moved to the page's own top-level section (errorSectionHtml); the view keeps the tile.
  const html = V.viewHtml(payload(), opts({ review: true }));
  assert.match(html, /Errors detected on the last upload<\/span>[\s\S]*?<dd><b>1<\/b>/);
  assert.equal(html.includes('data-stvsec="ded"'), false);
  assert.equal(html.includes('data-stvacc'), false);
  assert.equal(html.includes('data-stvfix'), false);
  assert.deepEqual(V.sections(payload()).ded.map(t => t.shortId), ['BAD']);   // the bucket itself stays
});

test('viewHtml with review:false still shows the count the server sent', () => {
  // A contractor's payload: the server sends the count in totals and withholds the rows.
  const v = payload();
  v.tickets = v.tickets.filter(t => t.status !== 'error-detected');
  v.totals = V.totalsOf(payload());
  const html = V.viewHtml(v, opts({ review: false }));
  assert.match(html, /Errors detected on the last upload<\/span>[\s\S]*?<dd><b>1<\/b>/);
  // ...and the Temporarily cleared help points at the new section instead of the old pop-up.
  assert.match(html, /Error detected at the top of the page/);
});

test('needTable has three columns and the three marking buttons, and no closure-code cell', () => {
  const html = V.viewHtml(payload(), opts({ review: false }));
  const head = html.match(/<thead><tr>(.*?)<\/tr><\/thead>\s*<tbody class="stv-t/);
  assert.ok(head, 'the Tickets to sanitize header row is there');
  assert.equal((head[1].match(/<th /g) || []).length, 3);
  assert.equal(head[1].includes('Current Closure Code'), false);
  assert.match(head[1], /Ticket ID[\s\S]*MISSING FIELDS[\s\S]*Status/);
  ['error', 'successful', 'duplicate'].forEach(s => assert.match(html, new RegExp('data-stvmark="' + s + ':NEED"')));
  assert.equal(html.includes('data-stvst'), false);
  assert.equal(html.includes('<select'), false);
  // The closure-code tag is gone from the to-sanitize row (Temporarily cleared still shows one).
  const row = html.match(/<tbody class="stv-t[^"]*"><tr class="stv-l1">([\s\S]*?)<\/tr>/);
  assert.ok(row && !row[1].includes('stv-cc'), 'no closure-code cell on the to-sanitize row');
  // A read-only viewer gets the mark text instead of the buttons.
  const ro = V.viewHtml(payload(), opts({ readOnly: true }));
  assert.equal(ro.includes('data-stvmark'), false);
  assert.match(ro, /stv-ro/);
});

test("STATUS_LABEL.successful reads 'Sanitized' and 'immediate' is kept for the legacy marks", () => {
  assert.equal(V.STATUS_LABEL.successful, 'Sanitized');
  assert.equal(V.STATUS_LABEL.immediate, 'Immediately Resolved');
  assert.equal(V.STATUS_LABEL.duplicate, 'Duplicate');
});

test('the browser copies of the rules still match the engine', () => {
  // The rule text lives in three hand-kept places: the engine (server/sanitization-validate.js RULES),
  // the checklist card (sanitization-checklist.js TS_RULES) and the section help texts here
  // (RULES_TEXT). The literal is read out of the browser file, so a rule change that is not mirrored
  // leaves the card or the help describing the old behaviour and fails here.
  const src = fs.readFileSync(path.join(__dirname, 'sanitization-checklist.js'), 'utf8');
  const m = src.match(/var TS_RULES\s*=\s*(\[[\s\S]*?\n\]);/);
  assert.ok(m, 'TS_RULES literal found in sanitization-checklist.js');
  // Back through JSON: the vm realm has its own Array / Object, which deepEqual refuses to match.
  const TS_RULES = JSON.parse(JSON.stringify(vm.runInNewContext(m[1])));
  assert.deepEqual(TS_RULES.map(r => r.key), eng.RULES.map(r => 'r-' + r.key));
  assert.deepEqual(TS_RULES.map(r => r.label), eng.RULES.map(r => r.title));
  assert.deepEqual(TS_RULES.map(r => r.lines), eng.RULES.map(r => r.lines.slice()));
  // RULES_TEXT says the same in one sentence: every closure code the rules name, the required fields,
  // the Cnt rule and the number of plain optional fields left.
  eng.RULES.filter(r => r.code).forEach(r => assert.ok(V.RULES_TEXT.includes(r.code), 'RULES_TEXT names ' + r.code));
  const req = eng.REQUIRED_FIELDS;
  assert.ok(V.RULES_TEXT.includes(req.slice(0, -1).join(', ') + ' and ' + req[req.length - 1]), 'RULES_TEXT names the required fields');
  assert.ok(V.RULES_TEXT.includes('N/A does not count'), 'RULES_TEXT says N/A does not count for them');
  assert.equal(eng.RCD_FIELDS.length - req.length - 1, 6);   // the optional fields without the Cnt rule
  assert.ok(V.RULES_TEXT.includes('the other six'), 'RULES_TEXT counts the plain optional fields');
});

// ---- errorSectionHtml: the page's top-level Error detected section ----
// GET /api/sanitization-errors rows: flat, detectedAt DESC, grouped here by day then agent.
const ERR_NEW = '2026-11-25T02:37:33.469Z';
const ERR_OLD = '2026-11-24T21:10:00.000Z';
function errRow(o) {
  return Object.assign({ shortId: 'E0', url: 'https://sim/E0', title: 'A ticket', login: 'tanviroo', displayName: 'Tanvir',
    closureCode: 'Successful', detectedAt: ERR_NEW, missing: [{ key: 'Res', label: 'Sim Root Cause Details: Res', message: 'Res: has no value (it is required).' }] }, o);
}
// The page's day formatter: the calendar day in the viewer's timezone.
const errOpts = o => Object.assign({ h: { when, ic: () => '', url: t => t.url, day: iso => String(iso || '').slice(0, 10) } }, o || {});
const errPayload = () => ({ owner: true, canReview: true, dataAsOf: ERR_NEW, tickets: [
  errRow({ shortId: 'E1' }),
  errRow({ shortId: 'E2', login: 'chousoud', displayName: 'Chou' }),
  errRow({ shortId: 'E3', detectedAt: ERR_OLD }),
] });

test('errorSectionHtml groups by upload date, newest first and only the newest open', () => {
  const html = V.errorSectionHtml(errPayload(), errOpts({ review: true }));
  const dates = [...html.matchAll(/<details class="st-err-d" data-stvdate="([^"]+)"( open)?>/g)].map(m => [m[1], !!m[2]]);
  assert.deepEqual(dates, [['2026-11-25', true], ['2026-11-24', false]]);
});

test('errorSectionHtml lists one block per agent that has rows, and none for the others', () => {
  const html = V.errorSectionHtml(errPayload(), errOpts({ review: true }));
  const d25 = html.slice(html.indexOf('data-stvdate="2026-11-25"'), html.indexOf('data-stvdate="2026-11-24"'));
  // 25th: both agents, sorted by login; 24th: only tanviroo, who is the single agent with a row there.
  assert.deepEqual([...d25.matchAll(/class="st-err-agh">([a-z]+)/g)].map(m => m[1]), ['chousoud', 'tanviroo']);
  const d24 = html.slice(html.indexOf('data-stvdate="2026-11-24"'));
  assert.deepEqual([...d24.matchAll(/class="st-err-agh">([a-z]+)/g)].map(m => m[1]), ['tanviroo']);
  assert.equal(d24.includes('chousoud'), false);
});

test('errorSectionHtml shows Closure Code | Ticket ID | Missing Fields', () => {
  const html = V.errorSectionHtml({ tickets: [errRow()] }, errOpts({ review: false }));
  const head = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  assert.ok(head);
  assert.equal((head[1].match(/<th /g) || []).length, 3);
  assert.match(head[1], /Closure Code[\s\S]*Ticket ID[\s\S]*Missing Fields/);
  assert.match(html, /Sim Root Cause Details: Res/);
  assert.match(html, /Successful/);
});

test('errorSectionHtml puts both actions on each row for the owner and neither for a contractor', () => {
  const own = V.errorSectionHtml({ tickets: [errRow()] }, errOpts({ review: true }));
  assert.match(own, /data-stvfix="E0"/);
  assert.match(own, /data-stvacc="E0"/);
  assert.match(own, /Accept Sanitized error/);
  assert.match(own, /Rework/);
  const con = V.errorSectionHtml({ tickets: [errRow()] }, errOpts({ review: false }));
  assert.equal(con.includes('data-stvfix'), false);
  assert.equal(con.includes('data-stvacc'), false);
  // A busy row disables both of the owner's buttons.
  const busy = V.errorSectionHtml({ tickets: [errRow()] }, errOpts({ review: true, busy: { E0: true } }));
  assert.equal((busy.match(/ disabled/g) || []).length, 2);
});

test('errorSectionHtml caps one agent block at 100 rows and says how many are held back', () => {
  // The section has no pager, so it must not try to render an upload that flagged thousands of
  // tickets in one string: the first 100 per agent per date, with the true count in the summary.
  const rows = [];
  for (let i = 0; i < 150; i++) rows.push(errRow({ shortId: 'E' + i }));
  const html = V.errorSectionHtml({ tickets: rows }, errOpts({ review: true }));
  assert.equal((html.match(/data-stvacc="/g) || []).length, 100);
  assert.match(html, /Showing the first 100 of 150 errors for tanviroo on 2026-11-25/);
  assert.match(html, /<b>150 tickets<\/b>/);
  // Under the cap nothing is held back and no notice is rendered.
  assert.equal(V.errorSectionHtml({ tickets: rows.slice(0, 100) }, errOpts({ review: true })).includes('Showing the first'), false);
});

// ---- approvalSectionHtml: the page's top-level Error tickets that need approval section ----
// GET /api/my-sanitization/approvals: agents sorted by login, each agent's tickets newest mark first.
const APV_AT = '2026-11-25T06:12:00.000Z';
const apvRow = (o) => Object.assign({ shortId: 'A0', url: 'https://sim/A0', title: 'A ticket', note: 'The requester closed it himself', at: APV_AT }, o);
const apvPayload = () => ({ owner: true, canReview: true, dataAsOf: APV_AT, total: 3, agents: [
  { login: 'chousoud', displayName: 'Chou', tickets: [apvRow({ shortId: 'A1' })] },
  { login: 'tanviroo', displayName: 'Tanvir', tickets: [apvRow({ shortId: 'A2' }), apvRow({ shortId: 'A3', note: 'Duplicate of A2' })] },
] });

test('approvalSectionHtml groups by agent, lists only the agents it was sent and opens the first', () => {
  const html = V.approvalSectionHtml(apvPayload(), opts({ review: true }));
  const ags = [...html.matchAll(/<details class="st-apv-d" data-stvagent="([^"]+)"( open)?>/g)].map(m => [m[1], !!m[2]]);
  assert.deepEqual(ags, [['chousoud', true], ['tanviroo', false]]);
  assert.match(html, /<b>1 ticket<\/b>/);
  assert.match(html, /<b>2 tickets<\/b>/);
  // No upload-date grouping anywhere: a contractor's Error mark is not tied to an upload.
  assert.equal(html.includes('data-stvdate'), false);
});

test('approvalSectionHtml shows Ticket ID | Title | Reason | Marked at', () => {
  const html = V.approvalSectionHtml(apvPayload(), opts({ review: false }));
  const head = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
  assert.ok(head);
  assert.equal((head[1].match(/<th /g) || []).length, 4);          // no checkbox and no actions column
  assert.match(head[1], /Ticket ID[\s\S]*Title[\s\S]*Reason[\s\S]*Marked at/);
  assert.match(html, /The requester closed it himself/);
  assert.match(html, />2026-11-25</);                              // the marked date on the row
});

test('approvalSectionHtml gives the owner the row actions, the checkboxes and the bulk Approve', () => {
  const own = V.approvalSectionHtml(apvPayload(), opts({ review: true }));
  assert.match(own, /data-stvrev="approve:A1"/);
  assert.match(own, /data-stvrev="return:A1"/);
  assert.match(own, /data-stvall="tanviroo"/);
  assert.match(own, /data-stvpick="A2" data-stvag="tanviroo"/);
  // Nothing selected: the help line, no bulk bar.
  assert.equal(own.includes('data-stvrev="approve:*"'), false);
  const sel = V.approvalSectionHtml(apvPayload(), opts({ review: true, sel: { A2: true, A3: true } }));
  assert.match(sel, /2 tickets selected/);
  assert.match(sel, /data-stvrev="approve:\*"[^>]*>Approve 2</);
  assert.match(sel, /data-stvclear="1"/);
  assert.match(sel, /data-stvall="tanviroo" checked/);             // that agent is fully selected
  // A contractor sees the rows and nothing to act with.
  const con = V.approvalSectionHtml(apvPayload(), opts({ review: false }));
  ['data-stvrev', 'data-stvpick', 'data-stvall', 'data-stvopen', 'stv-bulk'].forEach(s => assert.equal(con.includes(s), false, 'no ' + s));
  assert.match(con, /data-stvagent="tanviroo"/);
  // Every button is disabled while a review request is running.
  const busy = V.approvalSectionHtml(apvPayload(), opts({ review: true, revBusy: true }));
  assert.ok((busy.match(/ disabled/g) || []).length >= 8);
});

test('approvalSectionHtml caps one agent at 100 rows and renders the empty state', () => {
  const rows = [];
  for (let i = 0; i < 150; i++) rows.push(apvRow({ shortId: 'A' + i }));
  const html = V.approvalSectionHtml({ agents: [{ login: 'tanviroo', tickets: rows }] }, opts({ review: true }));
  assert.equal((html.match(/data-stvrev="approve:A/g) || []).length, 100);
  assert.match(html, /Showing the first 100 of 150 tickets waiting for approval for tanviroo/);
  assert.match(html, /<b>150 tickets<\/b>/);
  assert.equal(V.approvalSectionHtml({ agents: [{ login: 'tanviroo', tickets: rows.slice(0, 100) }] }, opts({ review: true })).includes('Showing the first'), false);
  // Empty payloads and an agent sent with no ticket at all read as the empty state.
  assert.match(V.approvalSectionHtml({ agents: [] }, opts({ review: true })), /tb-asg-empty/);
  assert.match(V.approvalSectionHtml(null, opts()), /tb-asg-empty/);
  assert.match(V.approvalSectionHtml({ agents: [{ login: 'tanviroo', tickets: [] }] }, opts({ review: true })), /tb-asg-empty/);
});

test('approvalSectionHtml escapes every interpolation', () => {
  const html = V.approvalSectionHtml({ agents: [{ login: 'a<s>', displayName: '<i>n', tickets: [apvRow({ shortId: 'X"><s>', note: '<b>why' })] }] }, opts({ review: true }));
  ['a<s>', '<i>n', 'X"><s>', '<b>why'].forEach(s => assert.equal(html.includes(s), false, 'escaped: ' + s));
  assert.match(html, /&lt;b&gt;why/);
  assert.match(html, /data-stvrev="approve:X&quot;&gt;&lt;s&gt;"/);
});

test('viewHtml keeps the Errors awaiting approval tile but has no error-ticket section', () => {
  // The rows moved to the page's own top-level section (approvalSectionHtml); the tile stays.
  const v = payload();
  v.tickets.push(ticket({ shortId: 'ERR1', status: 'error-ticket', mark: { status: 'error', reason: 'bad data', at: DETECTED, by: 'chousoud' } }));
  const html = V.viewHtml(v, opts({ review: true }));
  assert.match(html, /Errors awaiting approval<\/span>[\s\S]*?<dd><b>1<\/b>/);
  assert.equal(html.includes('data-stvsec="err"'), false);
  // The phrase is left only on the tile's own label, never as a section summary.
  assert.equal(/<summary>Error tickets that need approval/.test(html), false);
  assert.equal(html.includes('data-stvrev'), false);
  assert.equal(html.includes('data-stvpick'), false);
  assert.deepEqual(V.sections(v).err.map(t => t.shortId), ['ERR1']);   // the bucket itself stays
  // The owner keeps the Approved errors list (Restore) in the agent's card.
  const appr = V.viewHtml(Object.assign(payload(), { approved: [{ shortId: 'AP1', title: 'x', reason: 'r', approvedAt: DETECTED, approvedBy: 'harisss' }] }), opts({ review: true }));
  assert.match(appr, /data-stvappr="1"/);
  assert.match(appr, /data-stvrestore="AP1"/);
});

test('errorSectionHtml renders the empty state and escapes every interpolation', () => {
  assert.match(V.errorSectionHtml({ tickets: [] }, errOpts({ review: true })), /tb-asg-empty/);
  assert.match(V.errorSectionHtml(null, errOpts()), /tb-asg-empty/);
  const html = V.errorSectionHtml({ tickets: [errRow({ shortId: 'X"><s>', login: 'a<s>', closureCode: '<i>x' })] }, errOpts({ review: true }));
  ['X"><s>', 'a<s>', '<i>x'].forEach(s => assert.equal(html.includes(s), false, 'escaped: ' + s));
  assert.match(html, /&lt;i&gt;x/);
  assert.match(html, /data-stvacc="X&quot;&gt;&lt;s&gt;"/);
});
