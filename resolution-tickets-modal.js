/* Shared "Resolution tickets" pop-up (used by performance-summary.html and resolutions.html).
   Click a Resolution Distribution Count -> an accessible modal (role=dialog, focus trap, Esc) listing
   every ticket counted under that "Res" value for the same window: Country | Ticket ID link | Title |
   Resolved By | Created Date (newest first), 20 per page, plus a CSV Extract of ALL rows.
   Data: GET /api/perf-summary/resolution-tickets?view=week|month|ytd&from=YYYY-MM-DD&to=YYYY-MM-DD
   (to exclusive) — the same server selection that produced the count, so they never disagree.
   The page supplies the .psm* CSS. Calendar days are passed as LOCAL-midnight Date objects that
   name the calendar day (start inclusive, end inclusive); only their Y/M/D parts are used.

   API: window.PHDResTickets.open({ opener, resolution, count, view, start, end })
        window.PHDResTickets.close()
        window.PHDResTickets.pure  -> the pure helpers (labels, CSV, pagination) */
(function () {
  'use strict';
  var MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function A() { return window.PHDAuth; }
  function ic(n, s) { return window.icon ? window.icon(n, s || 14) : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function num(n) { return (Number(n) || 0).toLocaleString('en-US'); }

  /* PSM-PURE-START */
  var PSM_PAGE_SIZE = 20;
  var PSM_TZ_IANA = { IST: 'Asia/Kolkata', MST: 'America/Denver' };
  function psmTzLabel(tz) { return String(tz || '').toUpperCase() === 'MST' ? 'MST' : 'IST'; }
  // "24 Oct 2026, 14:05" in the account timezone (same IST/MST convention as the title-bar clock).
  function psmFmtDate(iso, tz) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: PSM_TZ_IANA[psmTzLabel(tz)], day: '2-digit', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    } catch (e) { return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
    var hh = p.hour === '24' ? '00' : p.hour;
    return p.day + ' ' + MON[(parseInt(p.month, 10) || 1) - 1].slice(0, 3) + ' ' + p.year + ', ' + hh + ':' + p.minute;
  }
  function psmYmd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function psmNextDay(d) { var x = new Date(d); x.setDate(x.getDate() + 1); return x; }
  // 'Week 19\u201325 Oct 2026' / 'Week 26 Oct \u2013 1 Nov 2026' / 'October 2026' / 'YTD 2026 \u00b7 1 Jan \u2013 28 Oct 2026'
  function psmPeriodLabel(view, start, end) {
    var m3 = function (d) { return MON[d.getMonth()].slice(0, 3); };
    if (view === 'month') return MON[start.getMonth()] + ' ' + start.getFullYear();
    if (view === 'ytd') return 'YTD ' + start.getFullYear() + ' \u00b7 ' + start.getDate() + ' ' + m3(start) + ' \u2013 ' + end.getDate() + ' ' + m3(end) + ' ' + end.getFullYear();
    if (start.getFullYear() !== end.getFullYear()) return 'Week ' + start.getDate() + ' ' + m3(start) + ' ' + start.getFullYear() + ' \u2013 ' + end.getDate() + ' ' + m3(end) + ' ' + end.getFullYear();
    if (start.getMonth() !== end.getMonth()) return 'Week ' + start.getDate() + ' ' + m3(start) + ' \u2013 ' + end.getDate() + ' ' + m3(end) + ' ' + end.getFullYear();
    return 'Week ' + start.getDate() + '\u2013' + end.getDate() + ' ' + m3(end) + ' ' + end.getFullYear();
  }
  function psmPeriodKey(view, start, end) { return view === 'month' ? psmYmd(start).slice(0, 7) : psmYmd(start) + '_' + psmYmd(end); }
  function psmSlug(s) { var v = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, ''); return v || 'resolution'; }
  function psmFileName(resolution, view, periodKey) { return 'resolution_' + psmSlug(resolution) + '_' + view + '_' + periodKey + '.csv'; }
  function psmPageCount(n) { return Math.max(1, Math.ceil((Number(n) || 0) / PSM_PAGE_SIZE)); }
  function psmShowing(page, n) {
    n = Number(n) || 0; if (!n) return 'Showing 0 of 0';
    return 'Showing ' + ((page - 1) * PSM_PAGE_SIZE + 1) + '\u2013' + Math.min(page * PSM_PAGE_SIZE, n) + ' of ' + n;
  }
  // Page buttons: numbers with '\u2026' gaps, always first/last + a window around the current page.
  function psmPageItems(cur, total) {
    if (total <= 7) { var all = []; for (var i = 1; i <= total; i++) all.push(i); return all; }
    if (cur <= 4) return [1, 2, 3, 4, 5, '\u2026', total];
    if (cur >= total - 3) return [1, '\u2026', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '\u2026', cur - 1, cur, cur + 1, '\u2026', total];
  }
  // One CSV cell: neutralise spreadsheet formulas (leading = + - @, tab, CR) with an apostrophe, then
  // quote when the value holds a comma, quote or line break.
  function psmCsvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  // UTF-8 BOM + CRLF rows so Excel opens it correctly.
  function psmBuildCsv(tickets, tz) {
    var label = psmTzLabel(tz);
    var lines = [['Country', 'Ticket ID', 'Ticket URL', 'Title', 'Resolved By', 'Created Date'].map(psmCsvCell).join(',')];
    (tickets || []).forEach(function (t) {
      var when = t.createdDate ? (psmFmtDate(t.createdDate, tz) + ' ' + label) : '';
      lines.push([t.country, t.shortId, t.url, t.title, t.resolvedBy, when].map(psmCsvCell).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  /* PSM-PURE-END */

  var PSM = { view: '', start: null, end: null, resolution: '', count: 0, tickets: [], page: 1, tz: 'IST', state: 'idle', seq: 0, opener: null, pgFocus: false, err: '' };
  function psmEnsure() {
    var bg = document.getElementById('psmBg'); if (bg) return bg;
    bg = document.createElement('div'); bg.id = 'psmBg'; bg.className = 'psm-bg';
    bg.innerHTML = '<div class="psm" role="dialog" aria-modal="true" aria-labelledby="psmTitle" aria-describedby="psmSub">' +
      '<div class="psm-head"><div class="psm-hd-t"><div class="psm-title" id="psmTitle"></div><div class="psm-sub" id="psmSub"></div></div>' +
        '<div class="psm-hd-a"><button type="button" class="ps-export psm-extract" id="psmExtract" disabled>' + ic('download', 15) + '<span>Extract</span></button>' +
        '<button type="button" class="psm-x" id="psmClose" aria-label="Close">\u00d7</button></div></div>' +
      '<div class="psm-body" id="psmBody" aria-live="polite"></div>' +
      '<div class="psm-foot" id="psmFoot"></div></div>';
    bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) psmClose(); });
    bg.querySelector('#psmClose').addEventListener('click', psmClose);
    bg.querySelector('#psmExtract').addEventListener('click', psmExtract);
    bg.addEventListener('click', function (ev) {
      var pg = ev.target.closest && ev.target.closest('[data-psm-page]');
      if (pg && !pg.disabled) { PSM.page = Math.max(1, Math.min(psmPageCount(PSM.tickets.length), parseInt(pg.getAttribute('data-psm-page'), 10) || 1)); PSM.pgFocus = true; psmRender(); return; }
      if (ev.target.closest && ev.target.closest('#psmRetry')) psmLoad();
    });
    document.body.appendChild(bg);
    return bg;
  }
  function psmFocusables(bg) {
    return Array.prototype.filter.call(bg.querySelectorAll('button,a[href],[tabindex="0"]'), function (el) { return !el.disabled && el.offsetParent !== null; });
  }
  // Esc closes; Tab / Shift+Tab loop inside the dialog.
  function psmKey(ev) {
    var bg = document.getElementById('psmBg'); if (!bg || !bg.classList.contains('open')) return;
    if (ev.key === 'Escape') { ev.preventDefault(); psmClose(); return; }
    if (ev.key !== 'Tab') return;
    var f = psmFocusables(bg); if (!f.length) { ev.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (!bg.contains(cur)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && cur === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', psmKey);
  function psmClose() {
    var bg = document.getElementById('psmBg'); if (!bg || !bg.classList.contains('open')) return;
    bg.classList.remove('open'); PSM.seq++; PSM.state = 'idle';
    document.body.style.overflow = '';
    var o = PSM.opener; PSM.opener = null;
    if (o && document.body.contains(o)) o.focus();
  }
  // opts: { opener, resolution, count, view:'week'|'month'|'ytd', start:Date, end:Date (inclusive) }
  function psmOpen(opts) {
    if (!opts || !opts.resolution || !opts.start || !opts.end) return;
    var bg = psmEnsure();
    PSM.view = opts.view; PSM.start = opts.start; PSM.end = opts.end;
    PSM.resolution = String(opts.resolution); PSM.count = Number(opts.count) || 0; PSM.tickets = []; PSM.page = 1; PSM.opener = opts.opener || null;
    bg.classList.add('open'); document.body.style.overflow = 'hidden';
    psmLoad();
  }
  async function psmLoad() {
    var seq = ++PSM.seq, auth = A();
    PSM.state = 'loading'; PSM.err = ''; PSM.tickets = []; PSM.page = 1; PSM.pgFocus = false; psmRender();
    var close = document.getElementById('psmClose'); if (close) close.focus();
    var tzP = (auth && auth.myTimezone ? auth.myTimezone() : Promise.resolve('IST')).catch(function () { return 'IST'; });
    var r = null;
    try {
      r = await auth.api('GET', '/api/perf-summary/resolution-tickets?view=' + encodeURIComponent(PSM.view) + '&from=' + psmYmd(PSM.start) + '&to=' + psmYmd(psmNextDay(PSM.end)) + '&resolution=' + encodeURIComponent(PSM.resolution));
    } catch (e) {}
    var tz = await tzP;
    if (seq !== PSM.seq) return;   // closed or superseded while loading
    PSM.tz = psmTzLabel(tz);
    if (!(r && r.ok && r.data && Array.isArray(r.data.tickets))) { PSM.state = 'error'; PSM.err = (r && r.status) ? (' (HTTP ' + r.status + ')') : ''; psmRender(); return; }
    PSM.tickets = r.data.tickets; PSM.count = PSM.tickets.length; PSM.state = 'done'; psmRender();
  }
  function psmRender() {
    var n = PSM.tickets.length, shown = (PSM.state === 'done') ? n : PSM.count;
    document.getElementById('psmTitle').textContent = PSM.resolution + ' \u2014 ' + num(shown) + ' ticket' + (shown === 1 ? '' : 's');
    document.getElementById('psmSub').textContent = PSM.start ? psmPeriodLabel(PSM.view, PSM.start, PSM.end) : '';
    var body = document.getElementById('psmBody'), foot = document.getElementById('psmFoot'), ex = document.getElementById('psmExtract');
    ex.disabled = !(PSM.state === 'done' && n > 0);
    foot.className = 'psm-foot'; foot.innerHTML = '';
    if (PSM.state === 'loading') { body.innerHTML = '<div class="psm-msg" role="status">Loading tickets\u2026</div>'; return; }
    if (PSM.state === 'error') {
      body.innerHTML = '<div class="psm-msg err" role="alert">Could not load the tickets' + esc(PSM.err || '') + '.<br><button type="button" class="psm-retry" id="psmRetry">Retry</button></div>';
      var rb = document.getElementById('psmRetry'); if (rb) rb.focus();
      return;
    }
    if (!n) { body.innerHTML = '<div class="psm-msg">No tickets</div>'; return; }
    var pages = psmPageCount(n); if (PSM.page > pages) PSM.page = pages;
    var slice = PSM.tickets.slice((PSM.page - 1) * PSM_PAGE_SIZE, PSM.page * PSM_PAGE_SIZE);
    body.innerHTML = '<div class="psm-tblwrap" tabindex="0" role="region" aria-label="Tickets for ' + esc(PSM.resolution) + '"><table class="psm-tbl">' +
      '<thead><tr><th scope="col">Country</th><th scope="col">Ticket ID</th><th scope="col">Title</th><th scope="col">Resolved By</th><th scope="col">Created Date (' + PSM.tz + ')</th></tr></thead><tbody>' +
      slice.map(function (t) {
        var id = esc(t.shortId || '\u2014');
        var link = (t.url && /^https?:\/\//i.test(t.url)) ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener">' + id + '</a>' : id;
        return '<tr><td class="c-cty"><span class="psm-cc">' + esc(t.country || 'Unknown') + '</span></td><td class="c-id">' + link + '</td>' +
          '<td class="c-title">' + esc(t.title || '\u2014') + '</td><td>' + esc(t.resolvedBy || '\u2014') + '</td><td class="c-dt">' + esc(psmFmtDate(t.createdDate, PSM.tz) || '\u2014') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (pages > 1) {
      var cur = PSM.page;
      foot.innerHTML = '<div class="psm-showing">' + esc(psmShowing(cur, n)) + '</div>' +
        '<nav class="psm-pager" aria-label="Pagination">' +
          '<button type="button" class="psm-pg" data-psm-page="' + (cur - 1) + '"' + (cur <= 1 ? ' disabled' : '') + '>Prev</button>' +
          psmPageItems(cur, pages).map(function (it) {
            return it === '\u2026' ? '<span class="psm-gap" aria-hidden="true">\u2026</span>'
              : '<button type="button" class="psm-pg" data-psm-page="' + it + '"' + (it === cur ? ' aria-current="page"' : '') + ' aria-label="Page ' + it + '">' + it + '</button>';
          }).join('') +
          '<button type="button" class="psm-pg" data-psm-page="' + (cur + 1) + '"' + (cur >= pages ? ' disabled' : '') + '>Next</button>' +
        '</nav>';
      foot.className = 'psm-foot on';
    } else {
      foot.innerHTML = '<div class="psm-showing">' + esc(psmShowing(1, n)) + '</div>'; foot.className = 'psm-foot on';
    }
    if (PSM.pgFocus) {
      PSM.pgFocus = false;
      var b = foot.querySelector('[aria-current="page"]'); if (b) b.focus();
      body.scrollTop = 0;
    }
  }
  // Download ALL tickets for this resolution (not just the current page) as an Excel-friendly CSV.
  function psmExtract() {
    if (PSM.state !== 'done' || !PSM.tickets.length) return;
    var blob = new Blob([psmBuildCsv(PSM.tickets, PSM.tz)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = psmFileName(PSM.resolution, PSM.view, psmPeriodKey(PSM.view, PSM.start, PSM.end));
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.PHDResTickets = {
    open: psmOpen,
    close: psmClose,
    pure: {
      PAGE_SIZE: PSM_PAGE_SIZE, tzLabel: psmTzLabel, fmtDate: psmFmtDate, ymd: psmYmd, nextDay: psmNextDay,
      periodLabel: psmPeriodLabel, periodKey: psmPeriodKey, slug: psmSlug, fileName: psmFileName,
      pageCount: psmPageCount, showing: psmShowing, pageItems: psmPageItems, csvCell: psmCsvCell, buildCsv: psmBuildCsv
    }
  };
})();
