// Sanitization Tracker ticket view (sanitization-tracker.html): one contractor's tickets from
// GET /api/my-sanitization, split into 0 Error Deducted tickets after verification/new Upload (marked,
// then failed the check after a newer upload: verifiedFailed) / 1 Tickets to sanitize / 2 Temporarily
// cleared / 3 Error tickets that need approval / 4 Tickets sanitized successfully. Sections 0 + 1 make
// up the 'to sanitize' totals. Pure string builders (no DOM, no network), so
// they also run under node for unit tests.
// The server sets each ticket's status: 'needs-correction' (to sanitize) | 'awaiting' (temporarily
// cleared) | 'error-ticket' | 'cleared' (sanitized) | 'not-found' | 'excluded' (sanitization-assign.js
// evalTicket). A ticket is verified ONLY once the agent marks it (Successful / Immediately Resolved /
// Duplicate) and a newer upload arrives; then the SIM closure code is checked (rule A): pass ->
// sanitized, fail -> back to to-sanitize with the defect (the mark is consumed). Before that there is
// no closure-code check: unmarked rows show the raw score out of 11 and the missing Title / RCD checks.
// Error tickets go to the owner for review (owner-only section; contractors get only the count) and
// stay until approved or sent back (`returned` note on the to-sanitize row). The four sections are a one-open-at-a-time accordion
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
  // Contractor stats (tracker cards + the selected contractor's summary). The 5 buckets:
  // [cls, full label (sr-only / tooltip), short label, tooltip, value]. T = contractor totals
  // { assigned, needsCorrection, awaiting, cleared, errorTickets }; showErr: include the error bucket
  // (the owner, or the contractor's own view).
  function buckets(T, showErr) {
    var n = function (v) { return Number(v) || 0; };
    var b = {
      tot: ['is-tot', 'Total tickets assigned to sanitize', 'Total assigned', '', n(T.assigned)],
      bad: ['is-bad', 'Tickets that need to be sanitized', 'To sanitize', '', n(T.needsCorrection)],
      wait: ['is-wait', 'Temporarily sanitized (waiting for new upload)', 'Temp sanitized', 'Waiting for the next data upload', n(T.awaiting)],
      ok: ['is-ok', 'Tickets sanitized successfully', 'Sanitized', '', n(T.cleared)],
      err: ['is-errn', 'Error tickets that need approval to be marked as sanitized', 'Errors', 'Marked Error \u2014 waiting for owner approval', n(T.errorTickets)],
      // Error Deducted tickets after verification/new Upload (sections().ded; part of To sanitize).
      // null = not known yet (an older server without totals.errorDeducted): shown as a dash.
      ded: ['is-ded', 'Error Deducted tickets after verification/new Upload', 'Error deducted', 'Marked, then failed the check after a newer data upload (still to sanitize)', T.errorDeducted == null ? null : n(T.errorDeducted)],
    };
    if (!showErr) delete b.err;
    return b;
  }
  function pctOf(v, a) { return a ? Math.round((Number(v) || 0) / a * 100) : 0; }
  function numTxt(v) { return (Number(v) || 0).toLocaleString('en-US'); }
  // Stacked bar (green sanitized, blue temp, amber errors, light red to sanitize) + '% sanitized'.
  function barHtml(B, a, cls) {
    var seg = function (k) { var r = B[k]; return r && r[4] ? '<span class="' + r[0] + '" style="width:' + (a ? Math.min(100, r[4] / a * 100).toFixed(2) : 0) + '%"></span>' : ''; };
    return '<div class="stv-sbar' + (cls ? ' ' + cls : '') + '"><span class="stv-sbar-t" aria-hidden="true">' + seg('ok') + seg('wait') + seg('err') + seg('bad')
      + '</span><b>' + pctOf(B.ok[4], a) + '% sanitized</b></div>';
  }
  // Card stats: a <dl> laid out as a grid: total assigned (sr-only; the card header shows it), the hero
  // row ('To sanitize' number left, '% tickets to sanitize' right), then 2-3 equal stat chips (Sanitized | Temp sanitized | Errors), then the
  // stacked bar. Short labels on screen; the full labels are sr-only text and title tooltips.
  // o.showErr: the error chip / segment; o.id: dl id (the card button's aria-describedby).
  function cardStatsHtml(T, o) {
    T = T || {}; o = o || {};
    var B = buckets(T, o.showErr), a = B.tot[4], bad = B.bad;
    var chip = function (r) {
      return '<div class="stv-chip ' + r[0] + (r[4] ? '' : ' is-zero') + '" title="' + esc(r[3] || r[1]) + '">'
        + '<dt><span aria-hidden="true">' + esc(r[2]) + '</span><span class="stv-sr">' + esc(r[1]) + '</span></dt>'
        + '<dd>' + (r[4] == null ? '<b>\u2014</b>' : '<b>' + numTxt(r[4]) + '</b> <span class="stv-chip-p">' + pctOf(r[4], a) + '%</span>') + '</dd></div>';
    };
    return '<dl class="stv-cst' + (o.showErr ? '' : ' is-k3') + '"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + '>'
      + '<div class="stv-sr"><dt>' + esc(B.tot[1]) + '</dt><dd>' + numTxt(a) + '</dd></div>'
      + '<div class="stv-hero' + (bad[4] ? '' : ' is-zero') + '" title="' + esc(bad[1]) + '"><dt><span class="stv-sr">' + esc(bad[1]) + '</span></dt>'
      + '<dd><b>' + numTxt(bad[4]) + '</b> <span class="stv-hero-r"><span class="stv-hero-p">' + pctOf(bad[4], a) + '%</span> <span aria-hidden="true">tickets to sanitize</span></span></dd></div>'
      + chip(B.ok) + chip(B.wait) + (B.err ? chip(B.err) : '') + chip(B.ded) + '</dl>'
      + barHtml(B, a, 'is-card');
  }
  // Selected contractor's summary: one strip of KPI tiles (Total assigned | To sanitize | Temporarily
  // sanitized | Sanitized successfully | Errors awaiting approval), each label / big number / % of
  // assigned, then the stacked bar full width with a legend and 'Data as of' (o.asOf) at the right.
  function sumStatsHtml(T, o) {
    T = T || {}; o = o || {};
    var B = buckets(T, o.showErr), a = B.tot[4];
    var tiles = [[B.tot, 'Total assigned'], [B.bad, 'To sanitize'], [B.wait, 'Temporarily sanitized'], [B.ok, 'Sanitized successfully']];
    if (B.err) tiles.push([B.err, 'Errors awaiting approval']);
    tiles.push([B.ded, 'Error deducted after verification']);
    var leg = [[B.ok, 'Sanitized'], [B.wait, 'Temporarily sanitized'], [B.err, 'Errors awaiting approval'], [B.bad, 'To sanitize']].filter(function (l) { return l[0]; });
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
  function sortNeed(list, dir) {
    var d = dir === 'desc' ? -1 : 1;
    return (list || []).slice().sort(function (a, b) {
      var pa = hasReq(a) ? a.passedNow : (typeof a.scoreNow === 'number' ? a.scoreNow : -1), pb = hasReq(b) ? b.passedNow : (typeof b.scoreNow === 'number' ? b.scoreNow : -1);
      return ((ratioOf(a) - ratioOf(b)) * d) || ((pa - pb) * d) || String(a.assignedAt || '').localeCompare(String(b.assignedAt || '')) || String(a.shortId).localeCompare(String(b.shortId));
    });
  }
  // Tickets per section (server order inside each). ded = to-sanitize tickets whose mark failed the
  // check after a newer upload (server verifiedFailed); need = the other to-sanitize tickets.
  function sections(v) {
    var out = { ded: [], need: [], wait: [], err: [], ok: [], nf: [], ex: [] };
    var key = { 'needs-correction': 'need', awaiting: 'wait', 'error-ticket': 'err', cleared: 'ok', 'not-found': 'nf', excluded: 'ex' };
    ((v && v.tickets) || []).forEach(function (t) { var k = key[t.status]; if (k === 'need' && t.verifiedFailed) k = 'ded'; if (k) out[k].push(t); });
    return out;
  }
  // Needs-correction reasons (server: sanitization-assign.js NEED_REASONS).
  var NEED_REASONS = ['mark', 'closure', 'ir', 'missing'];
  // Totals from the tickets (used after a local status change; same rules as the server's totals).
  // v.errHidden = error tickets the server counted but did not send (contractors never get the rows).
  function totalsOf(v) {
    var s = sections(v), all = (v && v.tickets) || [], hid = Math.max(0, Number(v && v.errHidden) || 0);
    var needBy = {}; NEED_REASONS.forEach(function (k) { needBy[k] = 0; });
    s.ded.concat(s.need).forEach(function (t) { if (needBy[t.reason] != null) needBy[t.reason]++; });
    // To sanitize = both lists (error-deducted tickets still count as to sanitize).
    return { assigned: all.length + hid, cleared: s.ok.length, needsCorrection: s.ded.length + s.need.length, needBy: needBy, awaiting: s.wait.length,
      errorDeducted: s.ded.length,
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
  // Tickets to sanitize: one line per ticket: Score | Ticket ID | Title | Closure code | Missing / Defect |
  // Status (the error-reason form opens on a second row under it while editing). A failed verification
  // shows its defect in red first; unmarked rows only list the missing Title / RCD checks.
  // lbl: the table's region / caption name (default 'Tickets to sanitize').
  function needTable(rows, o, h, lbl) {
    var dir = o.sortDir === 'desc' ? 'desc' : 'asc', f = o.errForm || null, busy = o.busy || {}, ro = !!o.readOnly, span = 6;
    var sortLbl = dir === 'asc' ? 'lowest first' : 'highest first';
    lbl = lbl || 'Tickets to sanitize';
    return '<div class="tb-asg-scroll stv-scroll" role="region" aria-label="' + lbl + '" tabindex="0"><table class="stv-tbl is-line">'
      + '<caption class="tb-asg-sr">' + lbl + ', score ' + sortLbl + '.</caption>'
      + '<thead><tr><th scope="col" class="stv-fit" aria-sort="' + (dir === 'asc' ? 'ascending' : 'descending') + '"><button type="button" class="stv-sort" data-stvsort="1">Score'
      + '<span class="stv-sort-ic" aria-hidden="true">' + (dir === 'asc' ? '\u25b2' : '\u25bc') + '</span>'
      + '<span class="tb-asg-sr">, required checks passed, sorted ' + sortLbl + '. Activate to sort ' + (dir === 'asc' ? 'highest' : 'lowest') + ' first.</span></button></th>'
      + '<th scope="col" class="stv-fit">Ticket ID</th><th scope="col" class="stv-ttl">Title</th><th scope="col" class="stv-fit">Closure code</th><th scope="col" class="stv-mc">Missing / Defect</th>'
      + '<th scope="col" class="stv-fit">Status</th></tr></thead>'
      + rows.map(function (t) {
        var md = missDef(t.defects, t.missingNow), open = !ro && f && f.shortId === t.shortId;
        return '<tbody class="stv-t' + (open ? ' is-open' : '') + '"><tr class="stv-l1">'
          + '<td class="stv-sc stv-fit">' + pillHtml(t) + '</td>' + idCell(t, h)
          + clipCell('stv-ttl', t.title || 'No title')
          + '<td class="stv-fit">' + codeTag(t.closureCode) + '</td>'
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
  // v = the contractor's view; o = { who, login, pageSize, page:{ded, need, ok}, open ('ded'|'need'|'wait'|'err'|'ok'|null,
  // default 'need'), sortDir, errForm, busy:{shortId:true}, readOnly (no status dropdown / Undo: the
  // viewer may not mark this contractor's tickets), review (owner: Error tickets section + review
  // actions), sel {shortId:true}, revBusy, apprOpen, h }.
  function viewHtml(v, o) {
    o = o || {}; var h = o.h || {};
    if (v && v.maxScore != null) setMax(v.maxScore);
    if (!h.when) h.when = function (iso) { return iso ? String(iso).slice(0, 10) : ''; };
    var T = v.totals || totalsOf(v), S = sections(v);
    T.errorDeducted = S.ded.length;   // the Error Deducted section's count (also when the server's totals lack it)
    if (!T.assigned) return '<p class="tb-asg-empty">' + (o.who ? ('No sanitization tickets assigned to ' + esc(o.who)) : 'No sanitization tickets assigned to you') + '</p>';
    var size = o.pageSize || 0, pg = o.page || {};
    var clampPg = function (p, n) { return size ? Math.max(0, Math.min(Number(p) || 0, Math.ceil(n / size) - 1)) : 0; };
    var need = sortNeed(S.need, o.sortDir), needPg = clampPg(pg.need, need.length), okPg = clampPg(pg.ok, S.ok.length);
    var needRows = size ? need.slice(needPg * size, (needPg + 1) * size) : need;
    var ded = sortNeed(S.ded, o.sortDir), dedPg = clampPg(pg.ded, ded.length);
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
    // First: tickets marked Successful / Immediately Resolved / Duplicate that failed the check after a
    // newer upload (still counted as to sanitize; listed here instead of Tickets to sanitize).
    var dedLbl = 'Error Deducted tickets after verification/new Upload';
    html += sec('ded', 'is-ded', dedLbl, ded.length)
      + (ded.length ? '<p class="stv-help">You marked these tickets, but the SIM closure code check after a newer data upload failed (the defect is in red). Fix the ticket in SIM, then set its status again.</p>'
        + needTable(dedRows, o, h, dedLbl) + pager('ded', dedPg, size, ded.length, dedLbl)
        : '<p class="tb-asg-empty">No marked tickets failed the check after the last data upload.</p>')
      + '</div></details>';
    html += sec('need', 'is-bad', 'Tickets to sanitize', need.length)
      + (need.length ? '<p class="stv-help">Fix the title and Root Cause Details, close the ticket in SIM, then set the status you closed it with. The closure code is checked only after the next data upload: Successful needs all 11 checks (a valid RCD Issue covers a missing title issue type), Immediately Resolved or Automatically Closed (an Out of Scope of PHD issue type, or a pet type other than Attack w/pet with Sev 3\u20135) the 3 title checks, Duplicate none. Defects from that check are in red.</p>'
        + needTable(needRows, o, h) + pager('need', needPg, size, need.length, 'Tickets to sanitize')
        : '<p class="tb-asg-empty">' + (ded.length ? 'No other tickets to sanitize. Fix the tickets in ' + dedLbl + '.' : (S.wait.length || errN ? 'Nothing left to sanitize. Temporarily cleared tickets are checked after the next data upload.' : 'Everything is sanitized \ud83c\udf89')) + '</p>')
      + '</div></details>';
    html += sec('wait', 'is-temp', 'Temporarily cleared', S.wait.length)
      + '<p class="stv-help">Checked after the next data upload against the SIM closure code: if it passes, the ticket moves to Tickets sanitized successfully; otherwise it moves to Error Deducted tickets after verification/new Upload with the defect, and you mark it again after fixing.</p>'
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
    hueRatio: hueRatio, ratioHtml: ratioHtml, cardStatsHtml: cardStatsHtml, sumStatsHtml: sumStatsHtml, pillHtml: pillHtml, codeTag: codeTag, STATUS_OPTS: STATUS_OPTS, STATUS_LABEL: STATUS_LABEL, NEED_REASONS: NEED_REASONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHDSanView = api;
})(typeof window !== 'undefined' ? window : this);
