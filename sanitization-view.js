// Sanitization Tracker ticket view (sanitization-tracker.html): one contractor's tickets from
// GET /api/my-sanitization, split into 0 Error detected (owner only: the items the last data upload
// found missing, waiting for the owner) / 1 Tickets to sanitize / 2 Temporarily cleared / 3 Error
// tickets that need approval / 4 Tickets sanitized successfully. Pure string builders (no DOM, no
// network), so they also run under node for unit tests.
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
// carries row.validation = { closureCode, scope, detectedAt, failures, fields }: the owner approves
// single items (errDetTable + apvFieldsHtml, one ticket at a time) or sends it back for rework. Those
// tickets count in neither the sanitized nor the to-sanitize total until the owner acts, and the items
// themselves are owner-only - the contractor sees the count until a Rework brings the ticket back with
// the owner's note.
// Error tickets go to the owner for review (owner-only section; contractors get only the count) and
// stay until approved or sent back (`returned` note on the to-sanitize row). The five sections are a one-open-at-a-time accordion
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
  //   left   o.lead (the select button: avatar + login), then Temp. sanitized, Successfully sanitized
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
      + zone('l', o.lead || '', '<div class="stv-sr"><dt>' + esc(B.tot[1]) + '</dt><dd>' + numTxt(a) + '</dd></div>' + chip(B.wait) + chip(B.ok), '')
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
  // Status marks (the dropdown) and their labels; old 'completed' marks carry no claim.
  var STATUS_OPTS = [['successful', 'Successful'], ['immediate', 'Immediately Resolved'], ['duplicate', 'Duplicate'], ['error', 'Error']];
  var STATUS_LABEL = { successful: 'Successful', immediate: 'Immediately Resolved', duplicate: 'Duplicate', error: 'Error', completed: 'Completed' };
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
  // One-open-at-a-time accordion over the sections ('ded' | 'need' | 'wait' | 'err' | 'ok'; null = all
  // closed). Opening a section makes it the open one; closing the open one leaves none open; closing
  // any other changes nothing.
  var SECTIONS = ['ded', 'need', 'wait', 'err', 'ok'], DEFAULT_OPEN = 'need';
  function nextOpen(cur, sec, open) {
    if (SECTIONS.indexOf(sec) < 0) return cur;
    return open ? sec : (cur === sec ? null : cur);
  }
  // Header select-all state for the owner's Error tickets: 'none' | 'some' | 'all' (sel = {shortId:true}).
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
  function statusSelect(t, busy) {
    var sid = esc(t.shortId);
    return '<select class="stv-st" data-stvst="' + sid + '" aria-label="Status for ' + sid + '"' + (busy ? ' disabled aria-busy="true"' : '') + '>'
      + '<option value="" selected>\u2014 Select status \u2014</option>'
      + STATUS_OPTS.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>';
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
  // Tickets to sanitize: one line per ticket, FOUR columns:
  //   Current Closure Code | Ticket ID | MISSING FIELDS | Status
  // (the error-reason form opens on a second row under it while editing). A failed verification shows
  // its defect in red first; unmarked rows only list the missing Title / RCD checks.
  // The Score and Title columns were removed on the owner's instruction, and with the Score column went
  // the only sort control this table had: the rows keep sortNeed's order (worst ratio first), which is
  // also the order the server sends them in (sanitization-assign.js contractorView).
  // lbl: the table's region / caption name (default 'Tickets to sanitize').
  function needTable(rows, o, h, lbl) {
    var f = o.errForm || null, busy = o.busy || {}, ro = !!o.readOnly, span = 4;
    lbl = lbl || 'Tickets to sanitize';
    return '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="' + lbl + '" tabindex="0"><table class="stv-tbl is-line">'
      + '<caption class="tb-asg-sr">' + lbl + ', the ones furthest from done first.</caption>'
      + '<thead><tr><th scope="col" class="stv-fit">Current Closure Code</th>'
      + '<th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-mc">MISSING FIELDS</th>'
      + '<th scope="col" class="stv-fit">Status</th></tr></thead>'
      + rows.map(function (t) {
        var md = missDef(t.defects, t.missingNow), open = !ro && f && f.shortId === t.shortId;
        return '<tbody class="stv-t' + (open ? ' is-open' : '') + '"><tr class="stv-l1">'
          + '<td class="stv-fit">' + codeTag(t.closureCode) + '</td>' + idCell(t, h)
          + '<td class="stv-clip stv-mc" title="' + esc(md.text + (t.legacyCompleted ? ' \u00b7 ' + LEGACY_NOTE : '')) + '">' + md.html + legacyNote(t) + '</td>'
          + '<td class="stv-stc stv-fit">' + (ro ? statusText(t) : statusSelect(t, !!busy[t.shortId] || open)) + '</td></tr>'
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
  // Owner-only Error tickets review: checkbox per row (+ tri-state select-all; the tracker sets
  // `indeterminate` from data-stvmixed), Ticket ID | Title | Score | Marked by | Reason | Marked at,
  // Approve / Send back per row, and a bulk toolbar for the selected rows.
  function errReviewHtml(rows, o, h) {
    var sel = o.sel || {}, rb = !!o.revBusy, ss = selState(rows, sel);
    var bar = ss.n
      ? '<div class="stv-bulk" role="group" aria-label="Actions for the selected error tickets"><span class="stv-bulk-n">' + plural(ss.n, 'ticket') + ' selected</span>'
        + '<button type="button" class="tb-san-btn stv-save" data-stvrev="approve:*"' + (rb ? ' disabled' : '') + '>Approve ' + ss.n + '</button>'
        + '<button type="button" class="tb-san-btn" data-stvrev="return:*"' + (rb ? ' disabled' : '') + '>Send back ' + ss.n + '</button>'
        + '<button type="button" class="tb-san-btn stv-link" data-stvclear="1"' + (rb ? ' disabled' : '') + '>Clear selection</button></div>'
      : '<p class="stv-help">Select tickets to approve or send back several at once (Shift+click selects a range).</p>';
    return bar + '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="Error tickets for review" tabindex="0"><table class="stv-tbl is-flat is-line stv-rev">'
      + '<caption class="tb-asg-sr">Tickets marked as error tickets, waiting for your review, most recently marked first</caption>'
      + '<thead><tr><th scope="col" class="stv-fit stv-ck"><input type="checkbox" data-stvall="1"' + (ss.state === 'all' ? ' checked' : '') + (ss.state === 'some' ? ' data-stvmixed="1" aria-checked="mixed"' : '')
      + (rb ? ' disabled' : '') + ' aria-label="Select all ' + rows.length + ' error tickets"></th>'
      + '<th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-ttl">Title</th><th scope="col" class="stv-fit">Score</th>'
      + '<th scope="col" class="stv-fit">Marked by</th><th scope="col" class="stv-mc">Reason</th><th scope="col" class="stv-fit">Marked at</th>'
      + '<th scope="col" class="stv-fit"><span class="tb-asg-sr">Actions</span></th></tr></thead><tbody>'
      + rows.map(function (t) {
        var m = t.mark || {}, sid = esc(t.shortId), on = !!sel[t.shortId];
        return '<tr' + (on ? ' class="is-sel"' : '') + '><td class="stv-fit stv-ck"><input type="checkbox" data-stvpick="' + sid + '"' + (on ? ' checked' : '') + (rb ? ' disabled' : '') + ' aria-label="Select ' + sid + '"></td>'
          + idCell(t, h) + clipCell('stv-ttl', t.title || 'No title') + '<td class="stv-sc stv-fit">' + pillHtml(t) + '</td>'
          + '<td class="stv-fit">' + esc(m.by || '\u2014') + '</td>' + clipCell('stv-mc', m.reason || '')
          + '<td class="tb-asg-nw stv-fit">' + esc(h.when(m.at)) + '</td>'
          + '<td class="stv-act stv-fit"><button type="button" class="tb-san-btn stv-save" data-stvrev="approve:' + sid + '"' + (rb ? ' disabled' : '') + '>Approve<span class="tb-asg-sr"> ' + sid + '</span></button> '
          + '<button type="button" class="tb-san-btn" data-stvrev="return:' + sid + '"' + (rb ? ' disabled' : '') + '>Send back<span class="tb-asg-sr"> ' + sid + '</span></button></td></tr>';
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
      + (list.length ? '<p class="stv-help">Counted as sanitized on the tracker (Tickets sanitized successfully, tagged Approved error) and left out of the sanitization scores, assignment picking and Errors in Resolved. Restore puts a ticket back under review.</p>'
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
  // The ten Sim Root Cause Details fields, in rule order. KEEP IN SYNC with
  // server/sanitization-validate.js RCD_FIELDS (the page cannot require the server module).
  var RCD_KEYS = ['Issue', 'SID', 'TID', 'Driv', 'Date', 'Cnt', 'Zip', 'CID', 'UPID', 'Res'];
  // The rules in one sentence, for the section help texts. KEEP IN SYNC with
  // server/sanitization-validate.js RULES.
  var RULES_TEXT = 'The uploaded closure code picks the checks: Immediately Resolved \u2014 the 3 title checks '
    + '(country code, issue type, severity) and nothing else; Successful \u2014 those 3 plus the ten Sim Root Cause Details '
    + 'fields, where Issue, Date and Res must have a real value (N/A does not count), Cnt must be a number or N/A, '
    + 'and the other six may be a value or N/A; Duplicate \u2014 nothing is checked; any other closure code is itself '
    + 'the error, named as it was uploaded. A valid issue type in the Sim Root Cause Details Issue field stands in '
    + 'for the title\u2019s, so the title\u2019s issue type is not reported when that field is right.';
  // The items the last upload found missing and the owner has not approved yet.
  function failList(t) { return (t && t.validation && t.validation.failures) || []; }
  // Owner-only Error detected: Ticket ID | Title | Closure code | Missing items | Detected at |
  // Rework / Approve. No row checkbox, no select-all and no bulk toolbar on purpose (unlike
  // errReviewHtml): a detected error is reviewed one ticket at a time, item by item.
  function errDetTable(rows, o, h) {
    o = o || {}; var busy = o.busy || {}, rb = !!o.revBusy;
    return '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="Tickets with errors detected" tabindex="0"><table class="stv-tbl is-flat is-line stv-errdet">'
      + '<caption class="tb-asg-sr">Tickets whose items the last data upload found missing, waiting for your review</caption>'
      + '<thead><tr><th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-ttl">Title</th><th scope="col" class="stv-fit">Closure code</th>'
      + '<th scope="col" class="stv-mc">Missing items</th><th scope="col" class="stv-fit">Detected at</th>'
      + '<th scope="col" class="stv-fit"><span class="tb-asg-sr">Actions</span></th></tr></thead><tbody>'
      + rows.map(function (t) {
        var sid = esc(t.shortId), val = t.validation || {}, fs = failList(t), b = !!busy[t.shortId] || rb;
        return '<tr>' + idCell(t, h) + clipCell('stv-ttl', t.title || 'No title')
          + '<td class="stv-fit">' + codeTag(val.closureCode == null ? t.closureCode : val.closureCode) + '</td>'
          + '<td class="stv-mc">' + (fs.length ? '<ul class="stv-items">' + fs.map(function (f) {
            return '<li title="' + esc(f.message || '') + '"><b>' + esc(f.label) + '</b></li>';
          }).join('') + '</ul>' : '\u2014') + '</td>'
          + '<td class="tb-asg-nw stv-fit">' + esc(h.when(val.detectedAt)) + '</td>'
          + '<td class="stv-act stv-fit"><button type="button" class="tb-san-btn" data-stvfix="' + sid + '"' + (b ? ' disabled aria-busy="true"' : '') + '>Rework<span class="tb-asg-sr"> ' + sid + ', send it back to the contractor</span></button> '
          + '<button type="button" class="tb-san-btn stv-save" data-stvapv="' + sid + '"' + (b ? ' disabled' : '') + '>Approve\u2026<span class="tb-asg-sr"> items of ' + sid + '</span></button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // Body of the per-ticket Approve pop-up (sanitization-tracker.html #stFldModal): EVERY missing item
  // with its own checkbox (ticked = approved for good, left for rework otherwise), then the ten stored
  // Sim Root Cause Details values for reference. No select-all and no bulk approve: one ticket only.
  function apvFieldsHtml(t, o) {
    o = o || {}; var h = o.h || {}, val = (t && t.validation) || {}, fs = failList(t), sid = esc(t && t.shortId);
    var when = h.when || function (iso) { return iso ? String(iso).slice(0, 10) : ''; };
    var f = val.fields || {};
    return '<p class="stv-apvf-m">' + sid + ' \u00b7 ' + codeTag(val.closureCode == null ? (t && t.closureCode) : val.closureCode)
      + (val.detectedAt ? ' \u00b7 <span class="stv-by">detected ' + esc(when(val.detectedAt)) + '</span>' : '') + '</p>'
      + '<fieldset class="stv-apvf"><legend>Items to approve</legend>'
      + (fs.length ? '<ul class="stv-apvf-l">' + fs.map(function (x) {
        var id = 'stvApvF-' + String(x.key).replace(/[^A-Za-z0-9_-]/g, '');
        return '<li><input type="checkbox" id="' + id + '" data-stvapvf="' + esc(x.key) + '">'
          + '<label for="' + id + '"><b>' + esc(x.label) + '</b><span class="stv-apvf-msg">' + esc(x.message || '') + '</span></label></li>';
      }).join('') + '</ul>' : '<p class="tb-asg-empty">Nothing is waiting for approval on this ticket.</p>')
      + '</fieldset>'
      + '<details class="stv-apvf-rcd"><summary>Sim Root Cause Details on the last upload</summary>'
      + '<dl class="stv-apvf-d">' + RCD_KEYS.map(function (k) {
        return '<div><dt>' + esc(k) + '</dt><dd>' + esc(f[k] == null ? 'N/A' : f[k]) + '</dd></div>';
      }).join('') + '</dl></details>';
  }
  // v = the contractor's view; o = { who, login, pageSize, page:{ded, need, ok}, open ('ded'|'need'|'wait'|'err'|'ok'|null,
  // default 'need'), errForm, busy:{shortId:true}, readOnly (no status dropdown / Undo: the
  // viewer may not mark this contractor's tickets), review (owner: Error tickets section + review
  // actions), sel {shortId:true}, revBusy, apprOpen, h }.
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
    var ded = sortNeed(S.ded), dedPg = clampPg(pg.ded, ded.length);
    var dedRows = size ? ded.slice(dedPg * size, (dedPg + 1) * size) : ded;
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
    // First, for the owner only: the tickets whose items the last data upload found missing. The count
    // is in the KPI strip for everyone; the rows and the two actions are the owner's.
    var dedLbl = 'Error detected';
    if (rev) {
      html += sec('ded', 'is-ded', dedLbl, ded.length)
        + (ded.length ? '<p class="stv-help">The last data upload found these items missing on tickets the contractor had marked. ' + RULES_TEXT
          + ' Approve lists the ticket\u2019s items one by one: an approved item is never raised again. Rework sends the ticket back to the contractor, naming the items still missing. Until you do one of the two, the ticket counts as neither sanitized nor to sanitize. The items are yours only: the contractor sees the count and gets the list when you send the ticket back.</p>'
          + errDetTable(dedRows, o, h) + pager('ded', dedPg, size, ded.length, dedLbl)
          : '<p class="tb-asg-empty">No errors detected on the last data upload.</p>')
        + '</div></details>';
    }
    html += sec('need', 'is-bad', 'Tickets to sanitize', need.length)
      + (need.length ? '<p class="stv-help">Fix the title and Sim Root Cause Details, close the ticket in SIM, then set the status you closed it with. The checks run on the next data upload, on the closure code the upload carries. ' + RULES_TEXT + '</p>'
        + needTable(needRows, o, h) + pager('need', needPg, size, need.length, 'Tickets to sanitize')
        : '<p class="tb-asg-empty">' + (ded.length ? 'No other tickets to sanitize. The tickets in ' + dedLbl + ' are waiting for the owner.' : (S.wait.length || errN ? 'Nothing left to sanitize. Temporarily cleared tickets are checked after the next data upload.' : 'Everything is sanitized \ud83c\udf89')) + '</p>')
      + '</div></details>';
    html += sec('wait', 'is-temp', 'Temporarily cleared', S.wait.length)
      + '<p class="stv-help">Checked on the next data upload, on the closure code the upload carries. ' + RULES_TEXT
      + ' Nothing missing: the ticket moves to Tickets sanitized successfully. Something missing: the owner sees it under ' + dedLbl + ' and either approves the items or sends the ticket back to you with what is missing \u2014 until then you see only the count, not the items.</p>'
      + (S.wait.length ? waitTable(S.wait, o, h) : '<p class="tb-asg-empty">No tickets waiting for the next upload.</p>') + '</div></details>';
    if (rev) {
      html += sec('err', 'is-err', 'Error tickets that need approval', S.err.length) + errOpenHtml(S.err, o)
        + '<p class="stv-help">Marked as error tickets by the contractor. Approve counts a ticket as sanitized here (tagged Approved error) and leaves it out of the sanitization scores; Send back returns it to Tickets to sanitize with your message.</p>'
        + (S.err.length ? errReviewHtml(S.err, o, h) : '<p class="tb-asg-empty">No tickets waiting for error review.</p>')
        + approvedHtml(v.approved, o, h) + '</div></details>';
    }
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
    errDetTable: errDetTable, apvFieldsHtml: apvFieldsHtml, RCD_KEYS: RCD_KEYS, RULES_TEXT: RULES_TEXT,
    STATUS_OPTS: STATUS_OPTS, STATUS_LABEL: STATUS_LABEL, NEED_REASONS: NEED_REASONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHDSanView = api;
})(typeof window !== 'undefined' ? window : this);
