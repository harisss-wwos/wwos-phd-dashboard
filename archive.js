// ============================================================================
// Program History — BC Era (1 Jan 2021 to 31 Dec 2025)
// Year-only checkpoints (2021..2025), no quarters. Light theme. Data comes from the BC-era date
// windows (/api/dash/summary?from&to and /api/dash/timeseries?bucket=year). BC data is FROZEN, so
// every response is cached in localStorage (long TTL) and served instantly on revisit.
// ============================================================================
(function () {
  var A = window.PHDAuth;
  var ic = function (n, s) { return (typeof window.icon === 'function') ? window.icon(n, s || 15) : ''; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var nf = function (n) { return Number(n || 0).toLocaleString(); };

  var BC_YEARS = [2021, 2022, 2023, 2024, 2025];
  var sel = {};                 // year -> true (selected). Default: all years.
  BC_YEARS.forEach(function (y) { sel[y] = true; });

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

  // ---- Fetch (cache-first) the BC summary + per-year timeseries for the current selection ----
  function loadData() {
    var years = selectedYears();
    if (!years.length) { renderEmpty(); return; }
    var win = windowOf(years);
    var key = 'y' + years.join('-');
    var cached = cacheGet(key);
    if (cached) { render(cached, years); return; }
    renderLoading();
    var sUrl = '/api/dash/summary?from=' + win.from + '&to=' + win.to;
    var tUrl = '/api/dash/timeseries?from=' + win.from + '&to=' + win.to + '&bucket=year';
    Promise.all([A.api('GET', sUrl), A.api('GET', tUrl)]).then(function (rs) {
      var summary = (rs[0] && rs[0].ok) ? rs[0].data : null;
      var ts = (rs[1] && rs[1].ok && rs[1].data) ? rs[1].data.buckets : [];
      if (!summary) { gate('Could not load Program History data.'); return; }
      var payload = { summary: summary, buckets: ts };
      cacheSet(key, payload);
      render(payload, years);
    }).catch(function () { gate('Could not load Program History data. The service may be waking up — please try again.'); });
  }

  // ---- Renderers ----
  function gate(msg) { document.getElementById('wrap').innerHTML = '<div class="bc-gate"><h1>Program History</h1><p>' + esc(msg) + '</p><p style="margin-top:16px"><a class="btn" href="index.html">Back to all dashboards</a></p></div>'; }

  function yearChipsHtml() {
    var years = selectedYears();
    var allOn = years.length === BC_YEARS.length;
    var check = '<svg class="bc-chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var chips = '<button type="button" class="bc-chip bc-chip-all' + (allOn ? ' on' : '') + '" onclick="BCAll()"><span class="bc-box">' + check + '</span>All years</button>';
    BC_YEARS.forEach(function (y) {
      chips += '<button type="button" class="bc-chip' + (sel[y] ? ' on' : '') + '" onclick="BCToggle(' + y + ')"><span class="bc-box">' + check + '</span>' + y + '</button>';
    });
    // One single row: label | chips | Clear (all inline).
    return '<div class="bc-years">'
      + '<span class="bc-years-t">' + ic('calendar', 14) + ' Select years</span>'
      + '<span class="bc-year-chips">' + chips + '</span>'
      + '<button class="bc-clear" onclick="BCNone()">Clear</button>'
      + '</div>';
  }

  function heroHtml(total, rangeLabel) {
    return '<div class="bc-hero">'
      + '<div class="hb-left">'
      + '<h1 class="hb-title">' + ic('clock-rewind', 24) + ' Program History</h1>'
      + '<div class="hb-sub">Historical analytics for <b>1 Jan 2021 – 31 Dec 2025</b>. Pick one or more years below to view combined, read-only metrics. Showing <b>' + esc(rangeLabel) + '</b>.</div>'
      + '</div>'
      + '<div class="hb-badge"><span class="n">' + nf(total) + '</span><span class="l">total tickets</span></div>'
      + '</div>';
  }

  function statsHtml(d) {
    var tile = function (cls, icon, lab, val, sub) {
      return '<div class="bc-stat ' + cls + '"><div class="top">' + icon + '<span class="lab">' + lab + '</span></div>'
        + '<div class="val">' + val + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
    };
    return '<div class="bc-stats">'
      + tile('bc-total', ic('ticket', 15), 'Total Tickets', nf(d.total), 'created in range')
      + tile('bc-resolved', ic('check-circle', 15), 'Resolved / Closed', nf(d.resolved), (d.resolvedPct || 0) + '% of total')
      + tile('bc-sla', ic('target', 15), 'SLA (\u2264240h)', (d.slaPct || 0) + '%', nf(d.slaCompliant) + '/' + nf(d.slaBase) + ' successful')
      + tile('bc-repeat', ic('repeat', 15), 'Repeat Incidents', nf(d.repeatIncidents), 'HI Cnt &gt; 0')
      + tile('bc-pet', ic('paw', 15), '1st Pet (by PHD)', nf(d.firstPetByPhd), 'agent-resolved pet')
      + tile('bc-autosim', ic('bolt', 15), 'AutoSIM Resolved', nf(d.autosim), (d.autosimPct || 0) + '% of total')
      + '</div>';
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
        + '<td class="y">' + b.year + '</td>'
        + '<td style="width:150px"><div class="bc-bar"><span style="width:' + w + '%"></span></div></td>'
        + '<td class="n">' + nf(b.created) + '</td>'
        + '<td class="n">' + nf(b.resolved) + '</td>'
        + '<td class="n">' + (b.slaPct != null ? b.slaPct + '%' : '\u2014') + '</td>'
        + '</tr>';
    }).join('');
    var foot = '<tfoot><tr><td class="y">Total</td><td></td><td class="n">' + nf(tc) + '</td><td class="n">' + nf(tr) + '</td><td class="n">\u2014</td></tr></tfoot>';
    return '<div class="bc-sec"><div class="bc-sec-h">' + ic('bar-chart', 16) + ' Year-by-year breakdown</div><div class="bc-sec-b">'
      + '<table class="bc-tbl"><thead><tr><th>Year</th><th>Volume</th><th class="n">Created</th><th class="n">Resolved</th><th class="n">SLA %</th></tr></thead>'
      + '<tbody>' + body + '</tbody>' + foot + '</table></div></div>';
  }

  function chartSecHtml() {
    return '<div class="bc-sec"><div class="bc-sec-h">' + ic('line-chart', 16) + ' Yearly trend \u2014 Created vs Resolved vs SLA %</div>'
      + '<div class="bc-sec-b"><div class="chart-wrap"><canvas id="bcChart"></canvas></div></div></div>';
  }

  function podiumHtml(agents) {
    if (!agents || !agents.length) return '';
    var medals = [{ c: 'g', ico: '\uD83E\uDD47' }, { c: 's', ico: '\uD83E\uDD48' }, { c: 'b', ico: '\uD83E\uDD49' }];
    var init = function (s) { return String(s || '?').trim().charAt(0).toUpperCase() || '?'; };
    var cards = agents.slice(0, 3).map(function (a, i) {
      var m = medals[i] || medals[2];
      var av = a.avatar ? '<span class="bc-av"><img src="' + esc(a.avatar) + '" alt=""></span>' : '<span class="bc-av">' + esc(init(a.name || a.login)) + '</span>';
      var avg = (a.avgResHrs != null) ? (nf(a.avgResHrs) + ' hrs') : '\u2014';
      return '<div class="bc-medal ' + m.c + '"><div class="badge">' + m.ico + '</div>' + av
        + '<div class="id" title="' + esc(a.login) + '">' + esc(a.login) + '</div>'
        + '<div class="m"><b>' + nf(a.successful) + '</b> successful</div>'
        + '<div class="m"><b>' + nf(a.immediate) + '</b> immediate</div>'
        + '<div class="m">avg ' + avg + ' <small>(successful)</small></div>'
        + '</div>';
    }).join('');
    return '<div class="bc-sec"><div class="bc-sec-h">' + ic('target', 16) + ' Top performers \u2014 most successful resolves</div>'
      + '<div class="bc-sec-b"><div class="bc-podium">' + cards + '</div></div></div>';
  }

  function rangeLabel(years) {
    if (years.length === BC_YEARS.length) return 'all years (2021\u20132025)';
    if (years.length === 1) return String(years[0]);
    return years.join(', ');
  }

  var _chart = null;
  function render(payload, years) {
    var d = payload.summary || {};
    var buckets = payload.buckets || [];
    var html = heroHtml(d.total, rangeLabel(years))
      + yearChipsHtml()
      + statsHtml(d)
      + chartSecHtml()
      + yearTableHtml(buckets, years)
      + podiumHtml(d.topAgents);
    document.getElementById('wrap').innerHTML = html;
    drawChart(buckets, years);
  }

  function renderLoading() {
    document.getElementById('wrap').innerHTML = yearChipsHtml()
      + '<div class="bc-sk"><span class="bc-sk-l" style="width:100%"></span></div>'
      + '<div class="bc-sec"><div class="bc-sec-b"><div class="bc-spin"><div class="spinner"></div></div></div></div>';
  }
  function renderEmpty() {
    document.getElementById('wrap').innerHTML = yearChipsHtml()
      + '<div class="bc-sec"><div class="bc-sec-b"><p style="color:#8b96a0;text-align:center;padding:24px">Select at least one year to view analytics.</p></div></div>';
  }

  function drawChart(buckets, years) {
    var rows = buckets.filter(function (b) { return years.indexOf(b.year) >= 0; });
    var cv = document.getElementById('bcChart');
    if (!cv || typeof Chart === 'undefined' || !rows.length) return;
    var labels = rows.map(function (b) { return String(b.year); });
    var created = rows.map(function (b) { return b.created; });
    var resolved = rows.map(function (b) { return b.resolved; });
    var sla = rows.map(function (b) { return b.slaPct; });
    Chart.defaults.color = '#879596'; Chart.defaults.borderColor = 'rgba(0,0,0,0.06)';
    if (_chart) { try { _chart.destroy(); } catch (e) {} _chart = null; }
    var bar = function (label, data, color) { return { type: 'bar', label: label, data: data, yAxisID: 'y', backgroundColor: color, borderRadius: 6, borderSkipped: false, maxBarThickness: 46, order: 2 }; };
    _chart = new Chart(cv, {
      data: {
        labels: labels, datasets: [
          bar('Created', created, 'rgba(37,99,235,.85)'),
          bar('Resolved', resolved, 'rgba(31,157,87,.85)'),
          { type: 'line', label: 'SLA % (\u2264240h)', data: sla, yAxisID: 'ySla', borderColor: '#7c5cf0', backgroundColor: '#7c5cf0', pointBackgroundColor: '#7c5cf0', pointRadius: 4, pointHoverRadius: 6, borderWidth: 3, tension: .3, borderDash: [5, 4], order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: 18, top: 10 } },
        plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 8, padding: 14, font: { size: 12 } } },
          tooltip: { backgroundColor: 'rgba(20,24,30,.96)', borderColor: '#2a3340', borderWidth: 1, padding: 10, cornerRadius: 8, usePointStyle: true,
            callbacks: { label: function (c) { if (c.dataset.label.indexOf('SLA') >= 0) return 'SLA %: ' + (c.raw == null ? '\u2014' : c.raw + '%'); return c.dataset.label + ': ' + nf(c.raw); } } } },
        scales: {
          y: { beginAtZero: true, grace: '8%', position: 'left', grid: { color: 'rgba(0,0,0,.05)' }, border: { display: false }, title: { display: true, text: 'Tickets', color: '#8b96a0', font: { size: 12 } }, ticks: { font: { size: 11 }, precision: 0 } },
          ySla: { beginAtZero: true, max: 110, position: 'right', grid: { drawOnChartArea: false }, border: { display: false }, title: { display: true, text: 'SLA % (\u2264240h)', color: '#7c5cf0', font: { size: 11 } }, ticks: { font: { size: 11 }, stepSize: 10, callback: function (v) { return v > 100 ? '' : v + '%'; } } },
          x: { grid: { display: false }, ticks: { font: { size: 12, weight: '600' } } }
        }
      }
    });
  }

  // ---- Chip handlers (global) ----
  window.BCToggle = function (y) { sel[y] = !sel[y]; loadData(); };
  window.BCAll = function () { BC_YEARS.forEach(function (y) { sel[y] = true; }); loadData(); };
  window.BCNone = function () { BC_YEARS.forEach(function (y) { sel[y] = false; }); renderEmpty(); };

  // Boot.
  loadData();
})();
