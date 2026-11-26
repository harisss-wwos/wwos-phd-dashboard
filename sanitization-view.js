// Sanitization Tracker ticket view (sanitization-tracker.html): one contractor's tickets from
// GET /api/my-sanitization, split into 1 Tickets to sanitize / 2 Temporarily cleared / 3 Tickets
// sanitized successfully, plus the page's two top-level error sections - errorSectionHtml
// ("Error detected", GET /api/sanitization-errors, grouped by agent) and
// approvalSectionHtml ("Error tickets that need approval", GET /api/my-sanitization/approvals).
// Both of those two group BY AGENT. Pure string builders (no DOM, no network), so they also run
// under node for unit tests.
// The server sets each ticket's status: 'needs-correction' (to sanitize) | 'awaiting' (temporarily
// cleared) | 'error-detected' | 'error-ticket' | 'cleared' (sanitized) | 'not-found' | 'excluded'
// (sanitization-assign.js evalTicket). After every data upload the server validates each ticket on its
// UPLOADED closure code (server/sanitization-validate.js): Immediately Resolved -> the 3 title checks
// (country code, issue type, severity) and nothing else; Successful -> those 3 plus the ten Sim Root
// Cause Details fields (Issue, Date and Res need a real value - N/A does not count -, Cnt a number or
// N/A, the other six a value or N/A); Duplicate -> nothing is checked; ANY OTHER CODE -> the code
// itself is the one error raised. A valid issue type in the Sim Root Cause Details Issue field stands
// in for the title's, so the title's issue type is then never reported. Only a ticket the contractor
// has already marked is validated. A ticket with anything missing becomes 'error-detected' and
// is listed in the page's top-level Error detected section (errorSectionHtml, above the Sanitization
// Center), which every viewer sees - the contractor their own tickets, the owner and the view-all
// logins every agent - but where only the owner gets the two actions: [Accept Sanitized error] clears
// the WHOLE ticket in one click (it is never validated again) and [Rework] sends it back naming
// everything still missing. Those tickets count in neither the sanitized nor the to-sanitize total
// until the owner acts.
// A ticket the contractor marked Error with a typed reason waits for the owner's approval in the
// page's OTHER top-level section (approvalSectionHtml, "Error tickets that need approval", directly
// below Error detected): every viewer sees it - the contractor their own rows, the owner and the
// view-all logins every agent - and only the owner gets [Approve] / [Send back] and the bulk
// Approve. The agent's own card keeps only the count (the Errors awaiting approval tile); its rows
// are not a section here. A ticket stays there until approved or sent back (`returned` note on the
// to-sanitize row). The three sections are a one-open-at-a-time accordion
// (nextOpen). Errors in Resolved (and hi-resolved.html) reuse the small helpers (hue, missText,
// defect / pill / pager / codeTag).
// Markup reuses the .tb-asg-card / .tb-san-card base styles from topbar-auth.js; .stv-* rules live in
// sanitization-tracker.html.
(function (root) {
  'use strict';
  // Top score = the server's maxScore (MAX_SCORE in sanitization-score.js); viewHtml takes it from the
  // payload (v.maxScore), 11 until then.
  var MAX = 11;
  function setMax(m) { m = Number(m); if (m > 0 && Math.floor(m) === m) MAX = m; return MAX; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 0 red (0) -> half amber (38) -> MAX green (142).
  function hueOf(s) { var h = MAX / 2; s = Math.max(0, Math.min(MAX, Number(s) || 0)); return s <= h ? Math.round(s / h * 38) : Math.round(38 + (s - h) / (MAX - h) * 104); }
  function plural(n, one, many) { n = Number(n) || 0; return n.toLocaleString('en-US') + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Missing criteria chips ('Title: no severity', 'RCD: Issue', ...) grouped by prefix, one bracket per
  // group, short names joined by ' | ', empty groups left out:
  //   '[Title: no severity | no issue type] [RCD: Issue | SID | Driv | Date | Cnt | Zip | Res]
  //    [ClosureCode: change to Successful]'
  function missText(chips) {
    var order = [], by = {};
    (chips || []).forEach(function (c) {
      c = String(c == null ? '' : c).trim(); if (!c) return;
      var i = c.indexOf(':'), g = i > 0 ? c.slice(0, i).trim() : '', name = i > 0 ? c.slice(i + 1).trim() : c;
      if (!by[g]) { by[g] = []; order.push(g); }
      by[g].push(name);
    });
    return order.map(function (g) { return '[' + (g ? g + ': ' : '') + by[g].join(' | ') + ']'; }).join(' ');
  }
  // Defect messages (closure-code rule / claim mismatch), joined for one line.
  function defectText(list) { return (list || []).map(function (d) { return String(d == null ? '' : d).trim(); }).filter(Boolean).join(' \u00b7 '); }
  // Missing / Defect cell content: the defects first (red), then the grouped missing checks.
  // -> { html, text } (text = the tooltip).
  function missDef(defects, chips) {
    var d = defectText(defects), m = missText(chips);
    return {
      html: (d ? '<span class="stv-def">' + esc(d) + '</span>' : '') + (d && m ? ' ' : '') + (m ? esc(m) : '') || '\u2014',
      text: [d, m].filter(Boolean).join(' ') || '\u2014',
    };
  }
  // Required checks per ticket (server: the closure-code rule). The pill is 'passed / required'
  // (passedNow / requiredNow), hue by the passed / required ratio; tickets without them fall back to
  // the raw score out of MAX.
  function hasReq(t) { return !!t && typeof t.passedNow === 'number' && typeof t.requiredNow === 'number' && t.requiredNow > 0; }
  function ratioOf(t) {
    if (hasReq(t)) return t.passedNow / t.requiredNow;
    if (t && t.defects && t.defects.length) return 0;
    return typeof (t && t.scoreNow) === 'number' ? t.scoreNow / MAX : -1;
  }
  // 0 red -> half amber (38) -> all green (142), the same scale as hueOf.
  function hueRatio(r) { r = Math.max(0, Math.min(1, Number(r) || 0)); return r <= 0.5 ? Math.round(r / 0.5 * 38) : Math.round(38 + (r - 0.5) / 0.5 * 104); }
  function ratioHtml(p, n) {
    if (typeof p !== 'number' || !(n > 0)) return '<span class="tb-san-muted">\u2014</span>';
    return '<span class="tb-san-sc" style="--sc-h:' + hueRatio(p / n) + '">' + p + ' / ' + n + '</span>';
  }
  function pillHtml(t) { return hasReq(t) ? ratioHtml(t.passedNow, t.requiredNow) : scoreHtml(t && t.scoreNow); }
  // Contractor stats (tracker cards + the selected contractor's summary). The 6 buckets:
  // [cls, full label (sr-only / tooltip), short label, tooltip, value]. T = contractor totals
  // { assigned, needsCorrection, awaiting, cleared, errorTickets, errorDetected }; showErr: include the
  // error bucket (the owner, or the contractor's own view).
  function buckets(T, showErr) {
    var n = function (v) { return Number(v) || 0; };
    var b = {
      tot: ['is-tot', 'Total tickets assigned to sanitize', 'Total assigned', '', n(T.assigned)],
      bad: ['is-bad', 'Tickets that need to be sanitized', 'To sanitize', '', n(T.needsCorrection)],
      wait: ['is-wait', 'Temporarily sanitized (waiting for new upload)', 'Temp. sanitized', 'Waiting for the next data upload', n(T.awaiting)],
      ok: ['is-ok', 'Tickets sanitized successfully', 'Successfully sanitized', '', n(T.cleared)],
      err: ['is-errn', 'Error tickets that need approval to be marked as sanitized', 'Errors needing approvals', 'Marked Error \u2014 waiting for owner approval', n(T.errorTickets)],
      // Error detected (sections().ded): counted in neither To sanitize nor Sanitized. A count the
      // server did not send (an older server without totals.errorDetected) reads as 0, not a dash.
      ded: ['is-ded', 'Tickets with errors detected on the last upload', 'Errors detected', 'Tickets with errors detected on the last upload, waiting for the owner', n(T.errorDetected)],
    };
    if (!showErr) delete b.err;
    return b;
  }
  function pctOf(v, a) { return a ? Math.round((Number(v) || 0) / a * 100) : 0; }
  function numTxt(v) { return (Number(v) || 0).toLocaleString('en-US'); }
  // Stacked bar (green sanitized, blue temp, amber error tickets, red errors detected, light red to
  // sanitize) + '% sanitized'. Errors detected are their own segment: they are in neither To sanitize
  // nor Sanitized, so the bar would not add up without them.
  // Only the selected contractor's summary (sumStatsHtml, 'is-sum') draws it; the tracker's agent rows
  // show counts only (neither the bar nor a percentage was helping there).
  function barHtml(B, a, cls) {
    var seg = function (k) { var r = B[k]; return r && r[4] ? '<span class="' + r[0] + '" style="width:' + (a ? Math.min(100, r[4] / a * 100).toFixed(2) : 0) + '%"></span>' : ''; };
    return '<div class="stv-sbar' + (cls ? ' ' + cls : '') + '"><span class="stv-sbar-t" aria-hidden="true">' + seg('ok') + seg('wait') + seg('err') + seg('ded') + seg('bad')
      + '</span><b>' + pctOf(B.ok[4], a) + '% sanitized</b></div>';
  }
  // Agent row (the tracker's contractor list): three zones on one grid line, one <dl> of counts each.
  //   left   o.lead (the select button: avatar + login) and the sr-only total (no visible counts: the
  //          Temp. sanitized / Successfully sanitized badges live only in the expanded card's tiles)
  //   centre Errors needing approvals, then Errors detected
  //   right  'N needs work' flush right, then o.tail (the expand chevron)
  // The row grid gives the two side zones equal weight (1fr auto 1fr), so the centre pair sits on the
  // middle of the row itself and does not drift as the left-hand numbers get wider. Counts only, no
  // percentages; a missing count reads as 0. Short labels on screen, the full label as sr-only text
  // and the title tooltip. o.showErr: include the approvals badge; o.id: id stem for the three <dl>s
  // (the card button's aria-describedby, one id per zone).
  function cardStatsHtml(T, o) {
    T = T || {}; o = o || {};
    var B = buckets(T, o.showErr), a = B.tot[4], bad = B.bad;
    var chip = function (r) {
      return '<div class="stv-chip ' + r[0] + '" title="' + esc(r[3] || r[1]) + '">'
        + '<dt><span aria-hidden="true">' + esc(r[2]) + '</span><span class="stv-sr">' + esc(r[1]) + '</span></dt>'
        + '<dd><b>' + numTxt(r[4]) + '</b></dd></div>';
    };
    // One zone: [before] <dl of counts> [after]. The button and the chevron stay outside the <dl>
    // (a <dl> takes only dt / dd groups, and a <button> takes only phrasing content).
    var zone = function (k, before, inner, after) {
      return '<div class="stv-cz is-c' + k + '">' + before
        + '<dl class="stv-cst"' + (o.id ? ' id="' + esc(o.id + '-' + k) + '"' : '') + '>' + inner + '</dl>' + after + '</div>';
    };
    return '<div class="stv-crow">'
      + zone('l', o.lead || '', '<div class="stv-sr"><dt>' + esc(B.tot[1]) + '</dt><dd>' + numTxt(a) + '</dd></div>', '')
      + zone('c', '', (B.err ? chip(B.err) : '') + chip(B.ded), '')
      + zone('r', '', '<div class="stv-hero" title="' + esc(bad[1]) + '"><dt><span class="stv-sr">' + esc(bad[1]) + '</span></dt>'
        + '<dd><b>' + numTxt(bad[4]) + '</b> <span class="stv-hero-r" aria-hidden="true">needs work</span></dd></div>', o.tail || '')
      + '</div>';
  }
  // Selected contractor's summary: one strip of KPI tiles (Total assigned | To sanitize | Temporarily
  // sanitized | Sanitized successfully | Errors awaiting approval), each label / big number / % of
  // assigned, then the stacked bar full width with a legend and 'Data as of' (o.asOf) at the right.
  function sumStatsHtml(T, o) {
    T = T || {}; o = o || {};
    var B = buckets(T, o.showErr), a = B.tot[4];
    var tiles = [[B.tot, 'Total assigned'], [B.bad, 'To sanitize'], [B.wait, 'Temporarily sanitized'], [B.ok, 'Sanitized successfully']];
    if (B.err) tiles.push([B.err, 'Errors awaiting approval']);
    tiles.push([B.ded, 'Errors detected on the last upload']);
    var leg = [[B.ok, 'Sanitized'], [B.wait, 'Temporarily sanitized'], [B.err, 'Errors awaiting approval'], [B.ded, 'Errors detected'], [B.bad, 'To sanitize']].filter(function (l) { return l[0]; });
    return '<dl class="stv-kpis' + (B.err ? '' : ' is-k5') + '">' + tiles.map(function (t) {
      var r = t[0], tot = r === B.tot;
      return '<div class="stv-kpi ' + r[0] + (r[4] || tot ? '' : ' is-zero') + '" title="' + esc(r[3] || r[1]) + '">'
        + '<dt><span aria-hidden="true">' + esc(t[1]) + '</span><span class="stv-sr">' + esc(r[1]) + '</span></dt>'
        + '<dd><b>' + numTxt(r[4]) + '</b><span class="stv-kpi-p">' + (tot ? 'tickets' : pctOf(r[4], a) + '% of assigned') + '</span></dd></div>';
    }).join('') + '</dl>'
      + barHtml(B, a, 'is-sum')
      + '<div class="stv-leg"><ul class="stv-leg-l" aria-hidden="true">' + leg.map(function (l) { return '<li class="' + l[0][0] + '">' + esc(l[1]) + '</li>'; }).join('') + '</ul>'
      + (o.asOf ? '<small class="stv-asof">Data as of ' + esc(o.asOf) + '</small>' : '') + '</div>';
  }
  // Status marks and their labels. 'successful' reads as 'Sanitized' so "Marked as" matches the button
  // the contractor pressed; 'immediate' no longer has a button but is kept for the 622 existing marks
  // that carry it, and old 'completed' marks carry no claim.
  var STATUS_LABEL = { successful: 'Sanitized', immediate: 'Immediately Resolved', duplicate: 'Duplicate', error: 'Error', completed: 'Completed' };
  var CLAIM = { successful: 1, immediate: 1, duplicate: 1 };
  // Needs correction order: passed / required ascending (dir 'asc', the default) or descending, then
  // fewer passed; ties oldest assigned first, then ticket ID. Returns a new array.
  // viewHtml calls it without a dir since the Tickets to sanitize table lost its sort control with the
  // Score column; the dir argument is kept for callers of the exported helper.
  function sortNeed(list, dir) {
    var d = dir === 'desc' ? -1 : 1;
    return (list || []).slice().sort(function (a, b) {
      var pa = hasReq(a) ? a.passedNow : (typeof a.scoreNow === 'number' ? a.scoreNow : -1), pb = hasReq(b) ? b.passedNow : (typeof b.scoreNow === 'number' ? b.scoreNow : -1);
      return ((ratioOf(a) - ratioOf(b)) * d) || ((pa - pb) * d) || String(a.assignedAt || '').localeCompare(String(b.assignedAt || '')) || String(a.shortId).localeCompare(String(b.shortId));
    });
  }
  // Tickets per section (server order inside each). ded = Error detected: the last upload found items
  // missing and the owner has not approved them yet (server status 'error-detected', owner-only rows);
  // need = the tickets to sanitize.
  function sections(v) {
    var out = { ded: [], need: [], wait: [], err: [], ok: [], nf: [], ex: [] };
    var key = { 'needs-correction': 'need', awaiting: 'wait', 'error-detected': 'ded', 'error-ticket': 'err', cleared: 'ok', 'not-found': 'nf', excluded: 'ex' };
    ((v && v.tickets) || []).forEach(function (t) { var k = key[t.status]; if (k) out[k].push(t); });
    return out;
  }
  // Needs-correction reasons (server: sanitization-assign.js NEED_REASONS).
  var NEED_REASONS = ['mark', 'closure', 'ir', 'missing'];
  // Totals from the tickets (used after a local status change; same rules as the server's totals).
  // v.errHidden = error tickets the server counted but did not send (contractors never get the rows).
  function totalsOf(v) {
    var s = sections(v), all = (v && v.tickets) || [], hid = Math.max(0, Number(v && v.errHidden) || 0);
    var needBy = {}; NEED_REASONS.forEach(function (k) { needBy[k] = 0; });
    s.need.forEach(function (t) { if (needBy[t.reason] != null) needBy[t.reason]++; });
    // Error detected tickets are in NEITHER needsCorrection NOR cleared: they add nothing to the
    // agent's sanitization total until the owner approves their items (same rule as the server).
    return { assigned: all.length + hid, cleared: s.ok.length, needsCorrection: s.need.length, needBy: needBy, awaiting: s.wait.length,
      errorDetected: s.ded.length,
      errorTickets: s.err.length + hid, notFound: s.nf.length, excluded: s.ex.length, pending: all.filter(function (t) { return !t.verified; }).length,
      legacyCompleted: all.filter(function (t) { return t.legacyCompleted; }).length };
  }
  // One-open-at-a-time accordion over the sections ('need' | 'wait' | 'ok'; null = all closed).
  // Opening a section makes it the open one; closing the open one leaves none open; closing any other
  // changes nothing. Neither 'ded' nor 'err' is here any more: the tickets the upload flagged
  // (errorSectionHtml) and the tickets the contractor marked Error (approvalSectionHtml) are both
  // top-level sections of the page, not sections of this view.
  var SECTIONS = ['need', 'wait', 'ok'], DEFAULT_OPEN = 'need';
  function nextOpen(cur, sec, open) {
    if (SECTIONS.indexOf(sec) < 0) return cur;
    return open ? sec : (cur === sec ? null : cur);
  }
  // Select-all state for the owner's Error tickets: 'none' | 'some' | 'all' (sel = {shortId:true}).
  function selState(rows, sel) {
    var n = 0; (rows || []).forEach(function (t) { if (sel && sel[t.shortId]) n++; });
    return { n: n, state: !n ? 'none' : (n === (rows || []).length ? 'all' : 'some') };
  }
  // Shift-click range: the shortIds from index a to b (inclusive, either order).
  function rangeIds(rows, a, b) {
    var lo = Math.max(0, Math.min(a, b)), hi = Math.min((rows || []).length - 1, Math.max(a, b)), out = [];
    for (var i = lo; i <= hi; i++) out.push(rows[i].shortId);
    return out;
  }
  // Status after a successful mark / undo when the server sent no `ticket` row (fallback).
  function statusAfter(t, mark) {
    if (mark && CLAIM[mark.status]) return 'awaiting';
    if (mark && mark.status === 'error') return 'error-ticket';
    return 'needs-correction';   // unmarked: never sanitized until a mark is verified by an upload
  }

  // ---- HTML ----
  // h = { ic(name,size), when(iso), url(ticket) }.
  function scoreHtml(s) {
    if (typeof s !== 'number') return '<span class="tb-san-muted">\u2014</span>';
    return '<span class="tb-san-sc" style="--sc-h:' + hueOf(s) + '">' + s + ' / ' + MAX + '</span>';
  }
  function idCell(t, h) {
    var u = h.url ? h.url(t) : (t.url || '');
    return '<td class="stv-id stv-fit"><span class="tb-asg-id"><a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(t.shortId) + '<span class="tb-asg-sr"> (opens in a new tab)</span></a></span></td>';
  }
  // Old 'completed' mark (no claim any more): a small muted note.
  var LEGACY_NOTE = 'Previously marked Completed';
  function legacyNote(t) { return t && t.legacyCompleted ? ' <span class="stv-legacy">' + LEGACY_NOTE + '</span>' : ''; }
  function pager(sec, page, size, total, label) {
    if (!size || total <= size) return '';
    var last = Math.ceil(total / size) - 1, from = page * size + 1, to = Math.min(total, (page + 1) * size);
    return '<div class="tb-san-pager" role="group" aria-label="' + esc(label) + ' pages">'
      + '<button type="button" class="tb-san-btn" data-sanpage="' + sec + ':' + (page - 1) + '"' + (page <= 0 ? ' disabled' : '') + ' aria-label="Previous ' + size + ' ' + esc(label.toLowerCase()) + '"><span aria-hidden="true">\u2039</span>Prev</button>'
      + '<span class="tb-san-pg">Rows ' + from + '\u2013' + to + ' of ' + total + '</span>'
      + '<button type="button" class="tb-san-btn" data-sanpage="' + sec + ':' + (page + 1) + '"' + (page >= last ? ' disabled' : '') + ' aria-label="Next ' + size + ' ' + esc(label.toLowerCase()) + '">Next<span aria-hidden="true">\u203a</span></button></div>';
  }
  // The contractor's three marking buttons, in place of the old status dropdown: Mark error opens the
  // inline "Why is this an error ticket?" form, Sanitized marks the ticket 'successful' (temporarily
  // sanitized until the next upload) and Duplicate marks it 'duplicate'. Which checks run is decided
  // by the UPLOADED closure code, never by the button pressed.
  var MARK_BTNS = [['error', 'Mark error'], ['successful', 'Sanitized'], ['duplicate', 'Duplicate']];
  function markBtns(t, busy) {
    var sid = esc(t.shortId);
    return '<span class="stv-mkb" role="group" aria-label="Mark ' + sid + '">' + MARK_BTNS.map(function (b) {
      return '<button type="button" class="tb-san-btn' + (b[0] === 'successful' ? ' stv-save' : '') + '" data-stvmark="' + b[0] + ':' + sid + '"'
        + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(b[1]) + '<span class="tb-asg-sr"> ' + sid + '</span></button>';
    }).join('') + '</span>';
  }
  // Inline "Why is this an error ticket?" form (f = { shortId, text, err, busy }).
  function errFormRow(t, f, span) {
    var sid = esc(t.shortId), id = 'stvWhy-' + sid;
    return '<tr class="stv-l3"><td colspan="' + (span || 6) + '"><div class="stv-why" role="group" aria-labelledby="' + id + 'L">'
      + '<label class="stv-why-l" id="' + id + 'L" for="' + id + '">Why is this an error ticket? <span class="stv-req" aria-hidden="true">*</span></label>'
      + '<textarea class="stv-why-t" id="' + id + '" data-stvwhy="' + sid + '" maxlength="500" rows="2" required aria-required="true" aria-describedby="' + id + 'H ' + id + 'E"' + (f.err ? ' aria-invalid="true"' : '') + (f.busy ? ' disabled' : '') + '>' + esc(f.text || '') + '</textarea>'
      + '<span class="stv-why-h" id="' + id + 'H">' + String(f.text || '').length + ' / 500</span>'
      + '<span class="stv-why-e" id="' + id + 'E" role="alert">' + esc(f.err || '') + '</span>'
      + '<span class="stv-why-a"><button type="button" class="tb-san-btn" data-stvcancel="' + sid + '"' + (f.busy ? ' disabled' : '') + '>Cancel</button>'
      + '<button type="button" class="tb-san-btn stv-save" data-stvsave="' + sid + '"' + (f.busy ? ' disabled aria-busy="true"' : '') + '>' + (f.busy ? 'Saving\u2026' : 'Save') + '</button></span>'
      + '</div></td></tr>';
  }
  // Read-only status cell (o.readOnly: viewing another contractor's tickets): the mark text or a dash.
  function statusText(t) {
    var m = t.mark;
    return '<span class="stv-ro">' + (m && STATUS_LABEL[m.status] ? esc(STATUS_LABEL[m.status]) : '\u2014') + '</span>';
  }
  // Single-line cell with ellipsis; the full text is in the title tooltip.
  function clipCell(cls, text, extra) {
    return '<td class="stv-clip ' + cls + '" title="' + esc(text) + '">' + esc(text) + (extra || '') + '</td>';
  }
  // Small ClosureCode tag ('(blank)' when empty).
  function codeTag(code) { var c = String(code == null ? '' : code).trim(); return '<span class="stv-cc">' + esc(c || '(blank)') + '</span>'; }
  // Tickets to sanitize: one line per ticket, THREE columns:
  //   Ticket ID | MISSING FIELDS | the three marking buttons
  // (the error-reason form opens on a second row under it while editing). A failed verification shows
  // its defect in red first; unmarked rows only list the missing Title / RCD checks.
  // The Score, Title and Current Closure Code columns were all removed on the owner's instruction (the
  // closure code the checks run on comes from the upload, not from this table, so showing the current
  // one only confused the two), and with the Score column went the only sort control this table had:
  // the rows keep sortNeed's order (worst ratio first), which is also the order the server sends them
  // in (sanitization-assign.js contractorView).
  // lbl: the table's region / caption name (default 'Tickets to sanitize').
  function needTable(rows, o, h, lbl) {
    var f = o.errForm || null, busy = o.busy || {}, ro = !!o.readOnly, span = 3;
    lbl = lbl || 'Tickets to sanitize';
    return '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="' + lbl + '" tabindex="0"><table class="stv-tbl is-line">'
      + '<caption class="tb-asg-sr">' + lbl + ', the ones furthest from done first.</caption>'
      + '<thead><tr><th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-mc">MISSING FIELDS</th>'
      + '<th scope="col" class="stv-fit">Status</th></tr></thead>'
      + rows.map(function (t) {
        var md = missDef(t.defects, t.missingNow), open = !ro && f && f.shortId === t.shortId;
        return '<tbody class="stv-t' + (open ? ' is-open' : '') + '"><tr class="stv-l1">'
          + idCell(t, h)
          + '<td class="stv-clip stv-mc" title="' + esc(md.text + (t.legacyCompleted ? ' \u00b7 ' + LEGACY_NOTE : '')) + '">' + md.html + legacyNote(t) + '</td>'
          + '<td class="stv-stc stv-fit">' + (ro ? statusText(t) : markBtns(t, !!busy[t.shortId] || open)) + '</td></tr>'
          + (t.returned ? '<tr class="stv-l3"><td colspan="' + span + '"><p class="stv-ret">Sent back by ' + esc(t.returned.by || 'the owner') + ': ' + esc(t.returned.note || '')
            + (t.returned.at ? ' \u00b7 ' + esc(h.when(t.returned.at)) : '') + '</p></td></tr>' : '')
          + (open ? errFormRow(t, f, span) : '') + '</tbody>';
      }).join('') + '</table></div>';
  }
  // Temporarily cleared: Score | Ticket ID | Title | Closure code (SIM now) | Marked as | Marked at | Undo.
  function waitTable(rows, o, h) {
    var busy = o.busy || {}, ro = !!o.readOnly;
    return '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="Temporarily cleared tickets" tabindex="0"><table class="stv-tbl is-flat is-line">'
      + '<caption class="tb-asg-sr">Tickets marked with a closure status, waiting for the next data upload, most recently marked first</caption>'
      + '<thead><tr><th scope="col" class="stv-fit">Score</th><th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-ttl">Title</th>'
      + '<th scope="col" class="stv-fit">Closure code</th><th scope="col" class="stv-fit">Marked as</th>'
      + '<th scope="col" class="stv-fit">Marked at</th>' + (ro ? '' : '<th scope="col" class="stv-fit"><span class="tb-asg-sr">Action</span></th>') + '</tr></thead><tbody>'
      + rows.map(function (t) {
        var m = t.mark || {}, sid = esc(t.shortId), lab = STATUS_LABEL[m.status] || '\u2014';
        return '<tr><td class="stv-sc stv-fit">' + pillHtml(t) + '</td>' + idCell(t, h) + clipCell('stv-ttl', t.title || 'No title')
          + '<td class="stv-fit">' + codeTag(t.closureCode) + '</td>'
          + '<td class="stv-fit stv-mk">' + esc(lab) + '</td>'
          + '<td class="tb-asg-nw stv-fit">' + esc(h.when(m.at)) + (m.by && o.login && m.by !== o.login ? ' <small class="stv-by">by ' + esc(m.by) + '</small>' : '') + '</td>'
          + (ro ? '' : '<td class="stv-act stv-fit"><button type="button" class="tb-san-btn" data-stvundo="' + sid + '"' + (busy[t.shortId] ? ' disabled aria-busy="true"' : '') + '>'
          + (busy[t.shortId] ? 'Undoing\u2026' : 'Undo') + '<span class="tb-asg-sr"> ' + esc(lab) + ' for ' + sid + '</span></button></td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  // Owner's Error tickets toolbar (top right): Open all (every listed error ticket) / Open selected,
  // each in a new tab (the tracker's click handler opens them; data-stvopen = 'all' | 'sel').
  function errOpenHtml(rows, o) {
    var ss = selState(rows, o.sel || {}), n = rows.length, ic = (o.h && o.h.ic) ? o.h.ic('external-link', 14) : '';
    return '<div class="stv-errtop" role="group" aria-label="Open error tickets">'
      + '<p class="tb-asg-note stv-open-note" id="stvOpenNote" role="status" hidden></p>'
      + (ss.n ? '<button type="button" class="tb-san-btn" data-stvopen="sel">' + ic + 'Open selected (' + ss.n + ')</button>' : '')
      + '<button type="button" class="tb-san-btn" data-stvopen="all"' + (n ? '' : ' disabled') + '>' + ic + 'Open all (' + n + ')</button></div>';
  }
  // Owner-only "Approved errors" (collapsible) with Restore per row.
  function approvedHtml(list, o, h) {
    list = list || []; var busy = o.busy || {};
    return '<details class="stv-appr" data-stvappr="1"' + (o.apprOpen ? ' open' : '') + '><summary>Approved errors <b>' + list.length + '</b></summary>'
      + (list.length ? '<p class="stv-help">Counted as sanitized on the tracker (Tickets sanitized successfully, with the Approved error tag) and left out of the Assignment Center, assignment picking and Errors in Resolved. Restore puts a ticket back under review.</p>'
        + '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="Approved errors" tabindex="0"><table class="stv-tbl is-flat is-line">'
        + '<caption class="tb-asg-sr">Error tickets you approved, most recent first</caption>'
        + '<thead><tr><th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-ttl">Title</th><th scope="col" class="stv-mc">Reason</th>'
        + '<th scope="col" class="stv-fit">Approved</th><th scope="col" class="stv-fit"><span class="tb-asg-sr">Action</span></th></tr></thead><tbody>'
        + list.map(function (a) {
          var sid = esc(a.shortId);
          return '<tr>' + idCell(a, h) + clipCell('stv-ttl', a.title || 'No title') + clipCell('stv-mc', a.reason + (a.note ? ' \u00b7 Note: ' + a.note : ''))
            + '<td class="tb-asg-nw stv-fit">' + esc(h.when(a.approvedAt)) + (a.approvedBy ? ' <small class="stv-by">by ' + esc(a.approvedBy) + '</small>' : '') + '</td>'
            + '<td class="stv-act stv-fit"><button type="button" class="tb-san-btn" data-stvrestore="' + sid + '"' + (busy['r:' + a.shortId] ? ' disabled aria-busy="true"' : '') + '>'
            + (busy['r:' + a.shortId] ? 'Restoring\u2026' : 'Restore') + '<span class="tb-asg-sr"> ' + sid + '</span></button></td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<p class="tb-asg-empty">No approved errors for this contractor.</p>')
      + '</details>';
  }
  // The rules in one sentence, for the section help texts. KEEP IN SYNC with
  // server/sanitization-validate.js RULES.
  var RULES_TEXT = 'The uploaded closure code picks the checks: Immediately Resolved \u2014 the 3 title checks '
    + '(country code, issue type, severity) and nothing else; Successful \u2014 those 3 plus the ten Sim Root Cause Details '
    + 'fields, where Issue, Date and Res must have a real value (N/A does not count), Cnt must be a number or N/A, '
    + 'and the other six may be a value or N/A; Duplicate \u2014 nothing is checked; any other closure code is itself '
    + 'the error, named as it was uploaded. A valid issue type in the Sim Root Cause Details Issue field stands in '
    + 'for the title\u2019s, so the title\u2019s issue type is not reported when that field is right.';
  // ---- The page's top-level "Error detected" section (above the Sanitization Center) ----
  // payload = GET /api/sanitization-errors: { owner, viewer, canReview, dataAsOf, tickets:[{ shortId,
  // url, title, login, displayName, closureCode, detectedAt, missing:[{key,label,message}] }] }, the
  // rows already flat and sorted detectedAt DESC. Grouped BY AGENT, exactly like its sibling
  // approvalSectionHtml below: one <details> per agent (logins A-Z, the first open, one open at a
  // time) holding that agent's table of Closure Code | Ticket ID | Missing Fields. The upload-date
  // accordion this section used to carry is gone on the owner's instruction - they want the agent
  // name and that agent's ticket list, the way the approvals section reads. The owner (o.review, the
  // server's canReview) also gets the two whole-ticket actions per row: [Rework] (data-stvfix) sends
  // it back naming everything missing, [Accept Sanitized error] (data-stvacc) counts it as sanitized
  // for good.
  // One agent's table is CAPPED at ERR_ROW_CAP rows, the way needTable and the other ticket tables
  // stop at a page: the section has no pager of its own and is built as one string, and a single
  // upload can flag thousands of tickets (a closure code outside the three is an error, and
  // 'Automatically Closed' alone is common in the data). The hidden rows surface here as soon as the
  // shown ones are reviewed; the agent's summary still counts every ticket.
  var ERR_ROW_CAP = 100;
  // openAgent = the agent the viewer has open (the tracker keeps it, the way APVSEC.open keeps the
  // approvals section's), so that acting on a row - which re-renders the whole section - does not
  // throw the viewer back to the first agent. Nothing open yet: the first agent.
  // o = { review, busy:{shortId:true}, openAgent, h:{ ic, when, url } }.
  function errorSectionHtml(payload, o) {
    o = o || {}; var h = o.h || {}, rev = !!o.review, busy = o.busy || {};
    var openAg = o.openAgent ? String(o.openAgent) : '';
    var rows = (payload && payload.tickets) || [];
    if (!rows.length) return '<p class="tb-asg-empty">No errors were detected on the last data upload.</p>';
    // Group by agent, keeping the server's row order (detectedAt DESC) inside each agent.
    var logins = [], by = {};
    rows.forEach(function (t) {
      var lg = String(t.login || '');
      if (!by[lg]) { by[lg] = { login: lg, name: t.displayName || lg, rows: [] }; logins.push(lg); }
      by[lg].rows.push(t);
    });
    logins.sort(function (a, b) { return a.localeCompare(b); });
    return logins.map(function (lg, i) {
      var ag = by[lg];
      return '<details class="st-err-d" data-stverrag="' + esc(lg) + '"' + (openAg === lg || (!openAg && i === 0) ? ' open' : '') + '>'
        + '<summary><span class="st-err-agh">' + esc(ag.login)
        + (ag.name && ag.name !== ag.login ? ' <span class="st-err-agn">' + esc(ag.name) + '</span>' : '') + '</span>'
        + '<b>' + plural(ag.rows.length, 'ticket') + '</b></summary>'
        + '<div class="st-err-in"><div class="tb-asg-scroll stv-scroll" role="region" aria-label="Errors detected for ' + esc(ag.login) + '" tabindex="0">'
        + '<table class="stv-tbl is-flat is-line st-err-t">'
        + '<caption class="tb-asg-sr">Tickets of ' + esc(ag.login) + ' the last data upload found incomplete</caption>'
        + '<thead><tr><th scope="col" class="stv-fit">Closure Code</th><th scope="col" class="stv-fit">Ticket ID</th>'
        + '<th scope="col" class="stv-mc">Missing Fields</th>'
        + (rev ? '<th scope="col" class="stv-fit"><span class="tb-asg-sr">Actions</span></th>' : '') + '</tr></thead><tbody>'
        + ag.rows.slice(0, ERR_ROW_CAP).map(function (t) {
          var sid = esc(t.shortId), ms = t.missing || [], b = !!busy[t.shortId];
          return '<tr><td class="stv-fit">' + codeTag(t.closureCode) + '</td>' + idCell(t, h)
            + '<td class="stv-mc">' + (ms.length ? '<ul class="stv-items">' + ms.map(function (f) {
              return '<li title="' + esc(f.message || '') + '"><b>' + esc(f.label) + '</b></li>';
            }).join('') + '</ul>' : '\u2014') + '</td>'
            + (rev ? '<td class="stv-act stv-fit"><button type="button" class="tb-san-btn" data-stvfix="' + sid + '"' + (b ? ' disabled aria-busy="true"' : '') + '>Rework<span class="tb-asg-sr"> ' + sid + ', send it back to ' + esc(ag.login) + '</span></button> '
              + '<button type="button" class="tb-san-btn stv-save" data-stvacc="' + sid + '"' + (b ? ' disabled' : '') + '>Accept Sanitized error<span class="tb-asg-sr"> on ' + sid + '</span></button></td>' : '')
            + '</tr>';
        }).join('')
        + (ag.rows.length > ERR_ROW_CAP ? '<tr class="st-err-more"><td colspan="' + (rev ? 4 : 3) + '">'
          + '<p class="tb-asg-empty">Showing the first ' + ERR_ROW_CAP + ' of ' + ag.rows.length
          + ' errors for ' + esc(ag.login) + ' \u00b7 the rest appear here once these are reviewed.</p></td></tr>' : '')
        + '</tbody></table></div></div></details>';
    }).join('');
  }
  // ---- The page's top-level "Error tickets that need approval" section ----
  // Directly below Error detected, so the two error sections sit together. payload =
  // GET /api/my-sanitization/approvals: { owner, viewer, canReview, dataAsOf, total, agents:[{ login,
  // displayName, tickets:[{ shortId, url, title, note (the contractor's typed reason), at (when they
  // marked it) }] }] }, the agents sorted by login and each agent's tickets newest mark first.
  // Grouped BY AGENT, not by upload date: a contractor marks a ticket Error whenever they hit one, so
  // an upload date would say nothing here. Only agents with a ticket awaiting approval are in the
  // payload, so only they are listed. Every viewer sees the rows (a contractor only their own); the
  // owner (o.review, the server's canReview) also gets a checkbox per row with a per-agent tri-state
  // select-all (the tracker sets `indeterminate` from data-stvmixed), [Approve] / [Send back] per row
  // and the bulk Approve bar over the whole selection. One agent's table stops at ERR_ROW_CAP rows
  // with the same notice as the Error detected section, so a large backlog cannot blow up the render.
  // openAgent = the agent the viewer has open (the tracker keeps it, the way OPEN/nextOpen keeps the
  // view's open section), so that ticking a row - which re-renders the whole section - does not throw
  // the viewer back to the first agent. Nothing open yet: the first agent.
  // o = { review, sel:{shortId:true}, revBusy, openAgent, h:{ ic, when, url } }.
  function approvalSectionHtml(payload, o) {
    o = o || {}; var h = o.h || {}, rev = !!o.review, sel = o.sel || {}, rb = !!o.revBusy;
    var openAg = o.openAgent ? String(o.openAgent) : '';
    var agents = ((payload && payload.agents) || []).filter(function (a) { return a && (a.tickets || []).length; });
    if (!agents.length) return '<p class="tb-asg-empty">No tickets are waiting for error approval.</p>';
    var all = []; agents.forEach(function (a) { a.tickets.forEach(function (t) { all.push(t); }); });
    var ss = selState(all, sel), span = (rev ? 2 : 0) + 4;
    var bar = !rev ? '' : (ss.n
      ? '<div class="stv-bulk" role="group" aria-label="Actions for the selected error tickets"><span class="stv-bulk-n">' + plural(ss.n, 'ticket') + ' selected</span>'
        + '<button type="button" class="tb-san-btn stv-save" data-stvrev="approve:*"' + (rb ? ' disabled' : '') + '>Approve ' + ss.n + '</button>'
        + '<button type="button" class="tb-san-btn stv-link" data-stvclear="1"' + (rb ? ' disabled' : '') + '>Clear selection</button></div>'
      : '');
    return bar + (rev ? errOpenHtml(all, o) : '') + agents.map(function (a, i) {
      var rows = a.tickets, lg = String(a.login || ''), name = a.displayName || '', as = selState(rows, sel);
      return '<details class="st-apv-d" data-stvagent="' + esc(lg) + '"' + (openAg === lg || (!openAg && i === 0) ? ' open' : '') + '>'
        + '<summary><span class="st-apv-agh">' + esc(lg)
        + (name && name !== lg ? ' <span class="st-apv-agn">' + esc(name) + '</span>' : '') + '</span>'
        + '<b>' + plural(rows.length, 'ticket') + '</b>'
        + (as.n ? '<span class="st-apv-p">' + as.n + ' selected</span>' : '') + '</summary>'
        + '<div class="st-apv-in"><div class="tb-asg-scroll stv-scroll" role="region" aria-label="Error tickets of ' + esc(lg) + ' waiting for approval" tabindex="0">'
        + '<table class="stv-tbl is-flat is-line st-apv-t">'
        + '<caption class="tb-asg-sr">Tickets ' + esc(lg) + ' marked as an error, waiting for the owner\u2019s approval, most recently marked first</caption>'
        + '<thead><tr>'
        + (rev ? '<th scope="col" class="stv-fit stv-ck"><input type="checkbox" data-stvall="' + esc(lg) + '"' + (as.state === 'all' ? ' checked' : '')
          + (as.state === 'some' ? ' data-stvmixed="1" aria-checked="mixed"' : '') + (rb ? ' disabled' : '')
          + ' aria-label="Select all ' + rows.length + ' error tickets of ' + esc(lg) + '"></th>' : '')
        + '<th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-ttl">Title</th>'
        + '<th scope="col" class="stv-mc">Reason</th><th scope="col" class="stv-fit">Marked at</th>'
        + (rev ? '<th scope="col" class="stv-fit"><span class="tb-asg-sr">Actions</span></th>' : '') + '</tr></thead><tbody>'
        + rows.slice(0, ERR_ROW_CAP).map(function (t) {
          var sid = esc(t.shortId), on = !!sel[t.shortId];
          return '<tr' + (on ? ' class="is-sel"' : '') + '>'
            + (rev ? '<td class="stv-fit stv-ck"><input type="checkbox" data-stvpick="' + sid + '" data-stvag="' + esc(lg) + '"' + (on ? ' checked' : '')
              + (rb ? ' disabled' : '') + ' aria-label="Select ' + sid + '"></td>' : '')
            + idCell(t, h) + clipCell('stv-ttl', t.title || 'No title') + clipCell('stv-mc', t.note || '')
            + '<td class="tb-asg-nw stv-fit">' + esc(h.when(t.at)) + '</td>'
            + (rev ? '<td class="stv-act stv-fit"><button type="button" class="tb-san-btn stv-save" data-stvrev="approve:' + sid + '"' + (rb ? ' disabled' : '') + '>Approve<span class="tb-asg-sr"> ' + sid + '</span></button> '
              + '<button type="button" class="tb-san-btn" data-stvrev="return:' + sid + '"' + (rb ? ' disabled' : '') + '>Send back<span class="tb-asg-sr"> ' + sid + ' to ' + esc(lg) + '</span></button></td>' : '')
            + '</tr>';
        }).join('')
        + (rows.length > ERR_ROW_CAP ? '<tr class="st-apv-more"><td colspan="' + span + '">'
          + '<p class="tb-asg-empty">Showing the first ' + ERR_ROW_CAP + ' of ' + rows.length
          + ' tickets waiting for approval for ' + esc(lg) + ' \u00b7 the rest appear here once these are reviewed.</p></td></tr>' : '')
        + '</tbody></table></div></div></details>';
    }).join('');
  }
  // v = the contractor's view; o = { who, login, pageSize, page:{need, ok}, open ('need'|'wait'|'ok'|null,
  // default 'need'), errForm, busy:{shortId:true}, readOnly (no marking buttons / Undo: the
  // viewer may not mark this contractor's tickets), review (owner: the Approved errors list with
  // Restore), apprOpen, h }.
  // Neither the tickets the last upload flagged nor the tickets the contractor marked Error are a
  // section here: they live in the page's own top-level sections (errorSectionHtml,
  // approvalSectionHtml). Only their counts stay, in the KPI strip.
  function viewHtml(v, o) {
    o = o || {}; var h = o.h || {};
    if (v && v.maxScore != null) setMax(v.maxScore);
    if (!h.when) h.when = function (iso) { return iso ? String(iso).slice(0, 10) : ''; };
    var T = v.totals || totalsOf(v), S = sections(v);
    // The Error detected count: from the rows for the owner (so a local review updates it at once),
    // from the server's totals for everyone else - they are sent the count but none of the rows.
    if (o.review || T.errorDetected == null) T.errorDetected = S.ded.length;
    if (!T.assigned) return '<p class="tb-asg-empty">' + (o.who ? ('No sanitization tickets assigned to ' + esc(o.who)) : 'No sanitization tickets assigned to you') + '</p>';
    var size = o.pageSize || 0, pg = o.page || {};
    var clampPg = function (p, n) { return size ? Math.max(0, Math.min(Number(p) || 0, Math.ceil(n / size) - 1)) : 0; };
    // Both lists keep sortNeed's default order (worst passed/required ratio first). There is no sort
    // control any more: it lived in the Score column header, which the owner had removed.
    var need = sortNeed(S.need), needPg = clampPg(pg.need, need.length), okPg = clampPg(pg.ok, S.ok.length);
    var needRows = size ? need.slice(needPg * size, (needPg + 1) * size) : need;
    var okRows = size ? S.ok.slice(okPg * size, (okPg + 1) * size) : S.ok;
    var asOf = v.dataAsOf ? h.when(v.dataAsOf) : '';
    var rev = !!o.review, errN = T.errorTickets || 0;
    var openSec = o.open === undefined ? DEFAULT_OPEN : o.open;
    var sec = function (key, cls, label, n, extra) {
      return '<details class="tb-san-sec ' + cls + '" data-stvsec="' + key + '"' + (extra || '') + (openSec === key ? ' open' : '') + '><summary>' + label + ' <b>' + n + '</b></summary><div class="tb-san-in">';
    };
    // Every bucket: Errors (pending owner approval) for the owner and for the contractor's own view
    // (readOnly = someone else's tickets); Sanitized includes owner-approved errors.
    var html = '<div class="tb-san-sum stv-sum">' + sumStatsHtml(T, { showErr: rev || !o.readOnly, asOf: asOf })
      + (!rev && errN ? '<p class="tb-san-muted stv-sent">' + plural(errN, 'ticket') + ' sent to the owner for error review</p>' : '') + '</div>';
    // The tickets the last upload flagged have their own section at the top of the page (above the
    // Sanitization Center); here only their count is left, in the KPI strip.
    var dedLbl = 'Error detected', dedN = T.errorDetected || 0;
    html += sec('need', 'is-bad', 'Tickets to sanitize', need.length)
      + (need.length ? '<p class="stv-help">Fix the title and Sim Root Cause Details, close the ticket in SIM, then press Sanitized (or Duplicate, or Mark error with a reason). The checks run on the next data upload, on the closure code the upload carries. ' + RULES_TEXT + '</p>'
        + needTable(needRows, o, h) + pager('need', needPg, size, need.length, 'Tickets to sanitize')
        : '<p class="tb-asg-empty">' + (dedN ? 'No other tickets to sanitize. The tickets in ' + dedLbl + ', at the top of the page, are waiting for the owner.' : (S.wait.length || errN ? 'Nothing left to sanitize. Temporarily cleared tickets are checked after the next data upload.' : 'Everything is sanitized \ud83c\udf89')) + '</p>')
      + '</div></details>';
    html += sec('wait', 'is-temp', 'Temporarily cleared', S.wait.length)
      + '<p class="stv-help">Checked on the next data upload, on the closure code the upload carries. ' + RULES_TEXT
      + ' Nothing missing: the ticket moves to Tickets sanitized successfully. Something missing: it is listed in ' + dedLbl + ' at the top of the page, with everything it is missing, until the owner accepts it as a sanitized error or sends it back to you for rework.</p>'
      + (S.wait.length ? waitTable(S.wait, o, h) : '<p class="tb-asg-empty">No tickets waiting for the next upload.</p>') + '</div></details>';
    html += sec('ok', 'is-ok', 'Tickets sanitized successfully', S.ok.length, ' id="tbSanOkSec"');
    if (!S.ok.length) html += '<p class="tb-asg-empty">No sanitized tickets yet.</p>';
    else {
      html += '<div class="tb-asg-scroll" role="region" aria-label="Tickets sanitized successfully" tabindex="0"><table><caption class="tb-asg-sr">Tickets sanitized successfully (marked, then verified on the SIM closure code after an upload, or approved by the owner as error tickets), most recently assigned first</caption>'
        + '<thead><tr><th scope="col">Ticket ID</th><th scope="col">Title</th><th scope="col">Marked</th><th scope="col">SIM closure code</th><th scope="col">Score</th><th scope="col">Assigned</th></tr></thead><tbody>'
        + okRows.map(function (t) {
          var ae = t.approvedError;
          if (ae) {
            // Owner-approved error: counted as sanitized; tag + approved by / at + the contractor's reason.
            var ttl = (ae.reason ? 'Reason: ' + ae.reason : '') + (ae.note ? (ae.reason ? ' \u00b7 ' : '') + 'Note: ' + ae.note : '');
            return '<tr>' + idCell(t, h) + '<td class="tb-asg-t">' + esc(t.title || 'No title')
              + (ttl ? '<small class="stv-appr-why">' + esc(ttl) + '</small>' : '') + '</td>'
              + '<td class="tb-asg-nw"><span class="stv-appr-tag">Approved error</span>'
              + (ae.by || ae.at ? ' <small class="stv-by">' + esc([ae.by ? 'by ' + ae.by : '', ae.at ? h.when(ae.at) : ''].filter(Boolean).join(' \u00b7 ')) + '</small>' : '') + '</td>'
              + '<td><span class="tb-san-muted">\u2014</span></td><td>' + pillHtml(t) + '</td>'
              + '<td class="tb-asg-nw">' + esc(h.when(t.assignedAt)) + '</td></tr>';
          }
          var vm = t.verifiedMark && STATUS_LABEL[t.verifiedMark.status];
          return '<tr>' + idCell(t, h) + '<td class="tb-asg-t">' + esc(t.title || 'No title') + legacyNote(t) + '</td>'
            + '<td class="tb-asg-nw">' + (vm ? esc(vm) : '<span class="tb-san-muted">\u2014</span>') + (t.note ? ' <small class="stv-by">' + esc(t.note) + '</small>' : '') + '</td>'
            + '<td>' + codeTag(t.closureCode) + '</td><td>' + pillHtml(t) + '</td>'
            + '<td class="tb-asg-nw">' + esc(h.when(t.assignedAt)) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        + pager('ok', okPg, size, S.ok.length, 'Tickets sanitized successfully');
    }
    html += '</div></details>';
    // The tickets this contractor marked Error are reviewed in the page's top-level "Error tickets
    // that need approval" section; what is left here for the owner is the Approved errors list, the
    // Restore safety net for a ticket approved by mistake.
    if (rev) html += approvedHtml(v.approved, o, h);
    if (S.nf.length || S.ex.length) {
      var ids = function (l) { return l.map(function (t) { return esc(t.shortId); }).join(', '); };
      html += '<p class="tb-san-muted">'
        + (S.nf.length ? ('Not found in the current data (' + S.nf.length + '): ' + ids(S.nf) + '. ') : '')
        + (S.ex.length ? ('Excluded from scoring (' + S.ex.length + '): ' + S.ex.map(function (t) { return esc(t.shortId) + (t.excludedReason ? ' (' + esc(t.excludedReason) + ')' : ''); }).join(', ') + '.') : '')
        + '</p>';
    }
    return html;
  }

  var api = { setMax: setMax, max: function () { return MAX; }, hue: hueOf, missText: missText, defectText: defectText, missDef: missDef, scoreHtml: scoreHtml, pager: pager,
    sortNeed: sortNeed, sections: sections, totalsOf: totalsOf, statusAfter: statusAfter, viewHtml: viewHtml, plural: plural,
    nextOpen: nextOpen, DEFAULT_OPEN: DEFAULT_OPEN, selState: selState, rangeIds: rangeIds,
    hueRatio: hueRatio, ratioHtml: ratioHtml, cardStatsHtml: cardStatsHtml, sumStatsHtml: sumStatsHtml, pillHtml: pillHtml, codeTag: codeTag,
    errorSectionHtml: errorSectionHtml, approvalSectionHtml: approvalSectionHtml, RULES_TEXT: RULES_TEXT,
    STATUS_LABEL: STATUS_LABEL, NEED_REASONS: NEED_REASONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHDSanView = api;
})(typeof window !== 'undefined' ? window : this);
