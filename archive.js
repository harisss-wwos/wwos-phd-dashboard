// ============================================================================
// Program History — BC Era (1 Jan 2021 to 31 Dec 2025)
// Year-only checkpoints (2021..2025), no quarters. Light theme. Data comes from the BC-era date
// windows (/api/dash/summary?from&to and /api/dash/timeseries?bucket=year). BC data is FROZEN, so
// every response is cached in localStorage (long TTL) and served instantly on revisit.
//
// Layout (all scoped under .arc, styles live in archive.html):
//   dark hero (eyebrow, title, meta chips, year picker) -> KPI cards overlapping the hero ->
//   trend chart -> year-by-year table + top performers.
// The hero + year picker stay interactive while data loads; everything fetched from the server shows
// a skeleton (aria-busy + polite live region) and a friendly error with Retry on failure.
// ============================================================================
(function () {
  var A = window.PHDAuth;
  var ic = function (n, s) { return (typeof window.icon === 'function') ? window.icon(n, s || 15) : ''; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var nf = function (n) { return Number(n || 0).toLocaleString(); };
  var $ = function (id) { return document.getElementById(id); };

  var BC_YEARS = [2021, 2022, 2023, 2024, 2025];
  var sel = {};                 // year -> true (selected). Default: all years.
  BC_YEARS.forEach(function (y) { sel[y] = true; });

  // Chart / legend palette (matches the KPI accents).
  var C_CREATED = '#1f5fbf', C_RESOLVED = '#1f9d57', C_SLA = '#ec7211';

  // ---- localStorage cache (BC era never changes) ----
  var TTL = 30 * 24 * 60 * 60 * 1000;   // 30 days
  function ck(key) { return 'phd_bc_' + key; }
  function cacheGet(key) {
    try { var raw = localStorage.getItem(ck(key)); if (!raw) return null; var o = JSON.parse(raw); if (!o || (Date.now() - o.at) > TTL) return null; return o.data; } catch (e) { return null; }
  }
  function cacheSet(key, data) { try { localStorage.setItem(ck(key), JSON.stringify({ at: Date.now(), data: data })); } catch (e) {} }

  // Selected years -> contiguous? We fetch a window spanning min..max selected year, then (for the
  // table + chart) keep only the selected years. Window end is exclusive (Jan 1 of maxYear+1).
  function selectedYears() { return BC_YEARS.filter(function (y) { return sel[y]; }); }
  function windowOf(years) {
    if (!years.length) return null;
    var lo = Math.min.apply(null, years), hi = Math.max.apply(null, years);
    return { from: lo + '-01-01', to: (hi + 1) + '-01-01', lo: lo, hi: hi };
  }

  // ---- View state ----
  var STATE = 'loading';        // 'loading' | 'ready' | 'error' | 'empty'
  var PAYLOAD = null, ERR = '', FIRST = true, REQ = 0;

  // ---- Fetch (cache-first) the BC summary + per-year timeseries for the current selection ----
  function loadData() {
    var years = selectedYears();
    if (!years.length) { renderEmpty(); return; }
    var win = windowOf(years);
    var key = 'y' + years.join('-');
    var cached = cacheGet(key);
    if (cached) { render(cached, years); return; }
    renderLoading();
    var my = ++REQ;               // ignore responses for an older selection
    var sUrl = '/api/dash/summary?from=' + win.from + '&to=' + win.to;
    var tUrl = '/api/dash/timeseries?from=' + win.from + '&to=' + win.to + '&bucket=year';
    Promise.all([A.api('GET', sUrl), A.api('GET', tUrl)]).then(function (rs) {
      if (my !== REQ) return;
      var summary = (rs[0] && rs[0].ok) ? rs[0].data : null;
      var ts = (rs[1] && rs[1].ok && rs[1].data) ? rs[1].data.buckets : [];
      if (!summary) {
        gate((rs[0] && rs[0].status === 401) ? 'Your session has expired. Please log in again.' : 'Could not load Program History data.');
        return;
      }
      var payload = { summary: summary, buckets: ts };
      cacheSet(key, payload);
      render(payload, years);
    }).catch(function () { if (my === REQ) gate('Could not load Program History data. The service may be waking up \u2014 please try again.'); });
  }

  // ---- Pieces ----
  function rangeLabel(years) {
    if (years.length === BC_YEARS.length) return 'All years (2021\u20132025)';
    if (years.length === 1) return String(years[0]);
    return years.join(', ');
  }
  function skel(w, h, dark, extra) { return '<span class="arc-skel' + (dark ? ' arc-skel-d' : '') + '" style="width:' + w + ';height:' + h + (extra ? ';' + extra : '') + '"></span>'; }

  function yearChipsHtml() {
    var years = selectedYears();
    var allOn = years.length === BC_YEARS.length;
    var check = '<svg class="arc-chk" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var chip = function (attr, on, label, cls) {
      return '<button type="button" class="arc-chip' + (cls ? ' ' + cls : '') + (on ? ' on' : '') + '" ' + attr + ' aria-pressed="' + (on ? 'true' : 'false') + '"><span class="arc-box" aria-hidden="true">' + check + '</span>' + label + '</button>';
    };
    var chips = chip('data-year-all', allOn, 'All years', 'arc-chip-all');
    BC_YEARS.forEach(function (y) { chips += chip('data-year="' + y + '"', !!sel[y], String(y)); });
    return '<div class="arc-years" role="group" aria-labelledby="arcYearsL">'
      + '<span class="arc-years-t" id="arcYearsL">' + ic('calendar', 14) + ' Years</span>'
      + '<span class="arc-year-chips">' + chips + '</span>'
      + '<button type="button" class="arc-clear" data-year-none' + (years.length ? '' : ' disabled') + '>Clear</button>'
      + '</div>';
  }

  function heroHtml(years, total) {
    var tot = STATE === 'ready' ? nf(total) : (STATE === 'loading' ? skel('90px', '14px', true) : '\u2014');
    return '<header class="arc-hero"><div class="arc-hero-in">'
      + '<div class="arc-hero-main"><span class="arc-hero-ic" aria-hidden="true">' + ic('clock-rewind', 24) + '</span><div>'
      + '<p class="arc-eyebrow">Archive analytics \u00b7 BC era</p>'
      + '<h1>Program History</h1>'
      + '<p class="arc-hero-sub">Historical PHD analytics for 1 Jan 2021 \u2013 31 Dec 2025. Pick the years to compare; the archive is frozen, so results are cached in this browser.</p>'
      + '</div></div>'
      + '<dl class="arc-meta">'
      + '<div class="arc-meta-wide"><dt>Showing</dt><dd>' + esc(years.length ? rangeLabel(years) : 'No years selected') + '</dd></div>'
      + '<div><dt>Total tickets</dt><dd>' + tot + '</dd></div>'
      + '<div><dt>Years</dt><dd>' + years.length + ' of ' + BC_YEARS.length + '</dd></div>'
      + '</dl></div>'
      + yearChipsHtml()
      + '</header>';
  }

  function kpiCard(cls, icon, lab, val, sub, ratio) {
    return '<div class="arc-kpi ' + cls + '"><p class="arc-kpi-l"><span class="arc-kpi-ic" aria-hidden="true">' + icon + '</span>' + lab + '</p>'
      + '<p class="arc-kpi-v">' + val + '</p>' + (sub ? '<p class="arc-kpi-s">' + sub + '</p>' : '')
      + (ratio == null ? '' : '<div class="arc-kpi-bar" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, ratio)).toFixed(1) + '%"></i></div>')
      + '</div>';
  }
  function statsHtml(d) {
    return '<div class="arc-kpis">'
      + kpiCard('k-total', ic('ticket', 15), 'Total Tickets', nf(d.total), 'created in range', null)
      + kpiCard('k-resolved', ic('check-circle', 15), 'Resolved / Closed', nf(d.resolved), '<b>' + (d.resolvedPct || 0) + '%</b> of total', d.resolvedPct || 0)
      + kpiCard('k-sla', ic('target', 15), 'SLA (\u2264240h)', (d.slaPct || 0) + '%', '<b>' + nf(d.slaCompliant) + '/' + nf(d.slaBase) + '</b> successful', d.slaPct || 0)
      + kpiCard('k-repeat', ic('repeat', 15), 'Repeat Incidents', nf(d.repeatIncidents), 'HI Cnt &gt; 0', null)
      + kpiCard('k-pet', ic('paw', 15), '1st Pet (by PHD)', nf(d.firstPetByPhd), 'agent-resolved pet', null)
      + kpiCard('k-autosim', ic('bolt', 15), 'AutoSIM Resolved', nf(d.autosim), '<b>' + (d.autosimPct || 0) + '%</b> of total', d.autosimPct || 0)
      + '</div>';
  }
  function statsSkel() {
    var k = '<div class="arc-kpi is-skel" aria-hidden="true">' + skel('58%', '11px') + skel('46%', '28px', false, 'margin-top:14px') + skel('70%', '10px', false, 'margin-top:10px') + '</div>';
    return '<div class="arc-kpis">' + k + k + k + k + k + k + '</div>';
  }

  function cardHead(icon, id, title, help, extra) {
    return '<div class="arc-card-head"><div class="arc-card-tt"><span class="arc-card-ic" aria-hidden="true">' + ic(icon, 16) + '</span><div>'
      + '<h2 id="' + id + '">' + title + '</h2>' + (help ? '<p class="arc-help">' + help + '</p>' : '') + '</div></div>' + (extra || '') + '</div>';
  }

  function legendHtml() {
    var it = function (c, l, line) { return '<li><span class="arc-lg' + (line ? ' is-line' : '') + '" style="--c:' + c + '" aria-hidden="true"></span>' + l + '</li>'; };
    return '<ul class="arc-legend" aria-label="Chart legend">' + it(C_CREATED, 'Created') + it(C_RESOLVED, 'Resolved') + it(C_SLA, 'SLA % (\u2264240h)', true) + '</ul>';
  }
  function chartSecHtml(buckets, years) {
    var rows = buckets.filter(function (b) { return years.indexOf(b.year) >= 0; });
    var summary = rows.map(function (b) { return b.year + ': ' + nf(b.created) + ' created, ' + nf(b.resolved) + ' resolved, SLA ' + (b.slaPct != null ? b.slaPct + '%' : 'n/a'); }).join('; ');
    return '<section class="arc-card arc-chart-card" aria-labelledby="arcChartH">'
      + cardHead('line-chart', 'arcChartH', 'Yearly trend', 'Created vs resolved tickets (bars) with SLA % on the right axis (line).', legendHtml())
      + '<div class="arc-chart-wrap">' + (rows.length
        ? '<canvas id="bcChart" role="img" aria-label="' + esc('Yearly trend. ' + summary) + '"></canvas>'
        : '<p class="arc-none">No yearly data for this selection.</p>') + '</div></section>';
  }
  function chartSkel() {
    var hs = [62, 78, 54, 88, 70];
    var bars = hs.map(function (h) { return '<span class="arc-skb"><span class="arc-skel" style="height:' + h + '%"></span><span class="arc-skel" style="height:' + Math.round(h * .82) + '%"></span></span>'; }).join('');
    return '<section class="arc-card arc-chart-card" aria-hidden="true">'
      + '<div class="arc-card-head"><div class="arc-card-tt">' + skel('32px', '32px', false, 'border-radius:8px') + '<div>' + skel('140px', '16px') + skel('300px', '10px', false, 'margin-top:8px;max-width:60vw') + '</div></div></div>'
      + '<div class="arc-chart-wrap arc-skbars">' + bars + '</div></section>';
  }

  // Per-year table (only the selected years), with a volume bar + totals footer.
  function yearTableHtml(buckets, years) {
    var rows = buckets.filter(function (b) { return years.indexOf(b.year) >= 0; });
    if (!rows.length) return '';
    var maxC = rows.reduce(function (m, r) { return Math.max(m, r.created || 0); }, 0) || 1;
    var tc = 0, tr = 0;
    var body = rows.map(function (b) {
      tc += (b.created || 0); tr += (b.resolved || 0);
      var w = Math.round(((b.created || 0) / maxC) * 100);
      return '<tr>'
        + '<th scope="row" class="y">' + b.year + '</th>'
        + '<td class="v"><div class="arc-bar" role="img" aria-label="' + w + '% of the busiest year"><span style="width:' + w + '%"></span></div></td>'
        + '<td class="n">' + nf(b.created) + '</td>'
        + '<td class="n">' + nf(b.resolved) + '</td>'
        + '<td class="n">' + (b.slaPct != null ? '<span class="arc-pill">' + b.slaPct + '%</span>' : '\u2014') + '</td>'
        + '</tr>';
    }).join('');
    var foot = '<tfoot><tr><th scope="row" class="y">Total</th><td></td><td class="n">' + nf(tc) + '</td><td class="n">' + nf(tr) + '</td><td class="n">\u2014</td></tr></tfoot>';
    return '<section class="arc-card" aria-labelledby="arcTblH">' + cardHead('bar-chart', 'arcTblH', 'Year-by-year breakdown', 'Volume is relative to the busiest selected year.')
      + '<div class="arc-scroll" tabindex="0" role="region" aria-labelledby="arcTblH"><table class="bc-tbl arc-tbl"><thead><tr><th scope="col">Year</th><th scope="col">Volume</th><th scope="col" class="n">Created</th><th scope="col" class="n">Resolved</th><th scope="col" class="n">SLA %</th></tr></thead>'
      + '<tbody>' + body + '</tbody>' + foot + '</table></div></section>';
  }
  function tableSkel(n) {
    var r = ''; for (var i = 0; i < n; i++) r += '<div class="arc-skrow">' + skel('44px', '12px') + skel('100%', '8px') + skel('60px', '12px') + skel('60px', '12px') + skel('44px', '12px') + '</div>';
    return '<section class="arc-card" aria-hidden="true"><div class="arc-card-head"><div class="arc-card-tt">' + skel('32px', '32px', false, 'border-radius:8px') + '<div>' + skel('180px', '16px') + '</div></div></div>'
      + '<div class="arc-skrows">' + r + '</div></section>';
  }

  function hueOf(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return [24, 205, 165, 265, 335, 45, 190, 120][h % 8]; }
  function podiumHtml(agents) {
    if (!agents || !agents.length) return '';
    var medals = ['g', 's', 'b'], names = ['Gold', 'Silver', 'Bronze'];
    var init = function (s) { return String(s || '?').trim().charAt(0).toUpperCase() || '?'; };
    var cards = agents.slice(0, 3).map(function (a, i) {
      var av = a.avatar ? '<span class="arc-av"><img src="' + esc(a.avatar) + '" alt=""></span>' : '<span class="arc-av" style="--h:' + hueOf(a.login) + '" aria-hidden="true">' + esc(init(a.name || a.login)) + '</span>';
      var avg = (a.avgResHrs != null) ? (nf(a.avgResHrs) + ' hrs') : '\u2014';
      return '<li class="arc-medal ' + medals[i] + '">'
        + '<span class="arc-rank" role="img" aria-label="' + names[i] + ', rank ' + (i + 1) + '">' + (i + 1) + '</span>' + av
        + '<div class="arc-medal-id"><span class="id" title="' + esc(a.login) + '">' + esc(a.login) + '</span>'
        + '<span class="m">avg ' + avg + ' <small>(successful)</small></span></div>'
        + '<dl class="arc-medal-st"><div><dt>Successful</dt><dd>' + nf(a.successful) + '</dd></div><div><dt>Immediate</dt><dd>' + nf(a.immediate) + '</dd></div></dl>'
        + '</li>';
    }).join('');
    return '<section class="arc-card" aria-labelledby="arcTopH">' + cardHead('star', 'arcTopH', 'Top performers', 'Most successful resolves in the selected years.')
      + '<ol class="arc-podium">' + cards + '</ol></section>';
  }
  function podiumSkel() {
    var r = ''; for (var i = 0; i < 3; i++) r += '<div class="arc-skrow is-p">' + skel('26px', '26px', false, 'border-radius:50%') + skel('40px', '40px', false, 'border-radius:50%') + '<span style="flex:1">' + skel('60%', '12px') + skel('40%', '10px', false, 'margin-top:7px') + '</span>' + skel('70px', '24px') + '</div>';
    return '<section class="arc-card" aria-hidden="true"><div class="arc-card-head"><div class="arc-card-tt">' + skel('32px', '32px', false, 'border-radius:8px') + '<div>' + skel('150px', '16px') + '</div></div></div><div class="arc-skrows">' + r + '</div></section>';
  }

  // ---- Shell: the live region lives outside the re-rendered view so announcements are read. ----
  function shell() {
    var w = $('wrap'); if (!w) return null;
    var v = $('arcView');
    if (!v) {
      w.innerHTML = '<div class="arc"><div id="arcView"></div><p class="arc-sr" id="arcLive" role="status" aria-live="polite"></p></div>';
      v = $('arcView');
    }
    return v;
  }
  function announce(msg) { var l = $('arcLive'); if (l) { l.textContent = ''; setTimeout(function () { l.textContent = msg; }, 40); } }
  function paint(html) {
    var v = shell(); if (!v) return;
    var root = v.parentNode;
    root.classList.toggle('is-anim', FIRST && STATE === 'ready');
    v.innerHTML = html;
  }

  // ---- Renderers ----
  var _chart = null;
  function destroyChart() { if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; } }

  function render(payload, years) {
    var wasLoading = STATE === 'loading';
    STATE = 'ready'; PAYLOAD = payload; ERR = '';
    var d = payload.summary || {};
    var buckets = payload.buckets || [];
    destroyChart();
    paint(heroHtml(years, d.total)
      + '<div class="arc-body" aria-busy="false">'
      + statsHtml(d)
      + chartSecHtml(buckets, years)
      + '<div class="arc-split">' + yearTableHtml(buckets, years) + podiumHtml(d.topAgents) + '</div>'
      + '</div>');
    FIRST = false;
    drawChart(buckets, years);
    if (wasLoading) announce('Program History loaded for ' + rangeLabel(years) + '.');
  }

  function renderLoading() {
    STATE = 'loading';
    destroyChart();
    var years = selectedYears();
    paint(heroHtml(years)
      + '<div class="arc-body" aria-busy="true" aria-label="Loading Program History">'
      + statsSkel() + chartSkel()
      + '<div class="arc-split">' + tableSkel(Math.max(2, years.length)) + podiumSkel() + '</div>'
      + '<div class="phd-load arc-loadnote" aria-hidden="true"><span class="phd-spin sm"></span> Loading\u2026</div>'
      + '</div>');
    announce('Loading Program History\u2026');
  }

  function stateCard(icCls, icon, title, text, btns) {
    return '<section class="arc-card arc-state"><div class="arc-empty"><span class="arc-empty-ic ' + icCls + '" aria-hidden="true">' + ic(icon, 26) + '</span>'
      + '<h2 class="arc-empty-t">' + title + '</h2>' + (text ? '<p>' + text + '</p>' : '') + (btns ? '<div class="arc-btns">' + btns + '</div>' : '') + '</div></section>';
  }
  function gate(msg) {
    STATE = 'error'; ERR = msg;
    destroyChart();
    paint(heroHtml(selectedYears())
      + '<div class="arc-body arc-body-flat" aria-busy="false">'
      + stateCard('is-err', 'alert-triangle', 'Couldn\u2019t load Program History', '<span role="alert">' + esc(msg) + '</span>',
        '<button type="button" class="arc-btn" data-retry>' + ic('refresh', 14) + 'Retry</button><a class="arc-btn is-sec" href="index.html">Back to all dashboards</a>')
      + '</div>');
    announce('Program History failed to load.');
  }
  function renderEmpty() {
    STATE = 'empty';
    REQ++;                        // drop any in-flight response
    destroyChart();
    paint(heroHtml([])
      + '<div class="arc-body arc-body-flat" aria-busy="false">'
      + stateCard('is-mute', 'calendar', 'Select at least one year', 'Pick one or more years above to view analytics.',
        '<button type="button" class="arc-btn" data-year-all-btn>Show all years</button>')
      + '</div>');
  }

  function drawChart(buckets, years) {
    var rows = buckets.filter(function (b) { return years.indexOf(b.year) >= 0; });
    var cv = document.getElementById('bcChart');
    if (!cv || typeof Chart === 'undefined' || !rows.length) return;
    var labels = rows.map(function (b) { return String(b.year); });
    var created = rows.map(function (b) { return b.created; });
    var resolved = rows.map(function (b) { return b.resolved; });
    var sla = rows.map(function (b) { return b.slaPct; });
    Chart.defaults.color = '#5c6773'; Chart.defaults.borderColor = 'rgba(27,32,38,.08)';
    Chart.defaults.font.family = "'Inter',-apple-system,sans-serif";
    destroyChart();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var bar = function (label, data, color) { return { type: 'bar', label: label, data: data, yAxisID: 'y', backgroundColor: color, hoverBackgroundColor: color, borderRadius: 6, borderSkipped: false, maxBarThickness: 44, categoryPercentage: .62, barPercentage: .86, order: 2 }; };
    _chart = new Chart(cv, {
      data: {
        labels: labels, datasets: [
          bar('Created', created, C_CREATED),
          bar('Resolved', resolved, C_RESOLVED),
          { type: 'line', label: 'SLA % (\u2264240h)', data: sla, yAxisID: 'ySla', borderColor: C_SLA, backgroundColor: C_SLA, pointBackgroundColor: '#fff', pointBorderColor: C_SLA, pointBorderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5, tension: .3, borderDash: [6, 4], order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        animation: reduce ? false : { duration: 600 },
        layout: { padding: { right: 6, top: 8 } },
        plugins: { legend: { display: false },
          tooltip: { backgroundColor: '#131a2a', borderColor: 'rgba(236,114,17,.5)', borderWidth: 1, padding: 11, cornerRadius: 10, usePointStyle: true, titleFont: { weight: '800' },
            callbacks: { label: function (c) { if (c.dataset.label.indexOf('SLA') >= 0) return ' SLA %: ' + (c.raw == null ? '\u2014' : c.raw + '%'); return ' ' + c.dataset.label + ': ' + nf(c.raw); } } } },
        scales: {
          y: { beginAtZero: true, grace: '8%', position: 'left', grid: { color: 'rgba(27,32,38,.06)' }, border: { display: false }, title: { display: true, text: 'Tickets', color: '#5c6773', font: { size: 11, weight: '700' } }, ticks: { font: { size: 11 }, precision: 0, padding: 6 } },
          ySla: { beginAtZero: true, max: 110, position: 'right', grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'SLA % (\u2264240h)', color: '#9a4100', font: { size: 11, weight: '700' } }, ticks: { font: { size: 11 }, color: '#9a4100', stepSize: 20, callback: function (v) { return v > 100 ? '' : v + '%'; } } },
          x: { grid: { display: false }, border: { color: 'rgba(27,32,38,.12)' }, ticks: { font: { size: 12, weight: '700' }, color: '#1b2026' } }
        }
      }
    });
  }

  // ---- Year picker / retry handlers ----
  function refocus(selector) { var n = document.querySelector(selector); if (n) n.focus(); }
  window.BCToggle = function (y) { sel[y] = !sel[y]; loadData(); };
  window.BCAll = function () { BC_YEARS.forEach(function (y) { sel[y] = true; }); loadData(); };
  window.BCNone = function () { BC_YEARS.forEach(function (y) { sel[y] = false; }); renderEmpty(); };

  document.addEventListener('click', function (ev) {
    var t = ev.target; if (!t || !t.closest || !t.closest('.arc')) return;
    var b;
    if ((b = t.closest('[data-year]'))) { var y = +b.getAttribute('data-year'); window.BCToggle(y); refocus('[data-year="' + y + '"]'); return; }
    if (t.closest('[data-year-all]')) { window.BCAll(); refocus('[data-year-all]'); return; }
    if (t.closest('[data-year-all-btn]')) { window.BCAll(); refocus('[data-year-all]'); return; }
    if (t.closest('[data-year-none]')) { window.BCNone(); refocus('[data-year-all]'); return; }
    if (t.closest('[data-retry]')) { loadData(); refocus('[data-year-all]'); }
  });

  // Boot.
  loadData();
})();
