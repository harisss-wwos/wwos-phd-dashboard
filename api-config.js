// Central API configuration for the PHD dashboard frontend.
// After deploying the API on Render, set API_BASE to your service URL, e.g.:
//   window.PHD_API_BASE = 'https://wwos-phd-api.onrender.com';
// For local dev against the server folder, it falls back to http://127.0.0.1:3000.
(function () {
  var override = window.PHD_API_BASE;
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  window.PHD_API_BASE = override || (isLocal ? 'http://127.0.0.1:3000' : 'https://REPLACE-WITH-RENDER-URL.onrender.com');
})();

// ---- Auth session helpers (shared across pages) ----
window.PHDAuth = {
  TOKEN_KEY: 'phd_token',
  USER_KEY: 'phd_user',
  getToken: function () { return sessionStorage.getItem(this.TOKEN_KEY) || localStorage.getItem(this.TOKEN_KEY) || ''; },
  getUser: function () { try { return JSON.parse(sessionStorage.getItem(this.USER_KEY) || localStorage.getItem(this.USER_KEY) || 'null'); } catch (e) { return null; } },
  setSession: function (token, user, remember) {
    var store = remember ? localStorage : sessionStorage;
    store.setItem(this.TOKEN_KEY, token);
    store.setItem(this.USER_KEY, JSON.stringify(user));
  },
  clear: function () {
    sessionStorage.removeItem(this.TOKEN_KEY); sessionStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.TOKEN_KEY); localStorage.removeItem(this.USER_KEY);
  },
  role: function () { var u = this.getUser(); return u ? u.role : 'user'; },
  rank: function (role) { return ({ user: 0, editor: 1, admin: 2, owner: 3 })[role] != null ? ({ user: 0, editor: 1, admin: 2, owner: 3 })[role] : -1; },
  atLeast: function (role) { return this.rank(this.role()) >= this.rank(role); },
  // ---- Loading shimmer skeletons (shown while fetching from Atlas) ----
  // A full report/dashboard skeleton: title, KPIs, charts.
  skeletonDashboard: function (note) {
    var kpis = '';
    for (var i = 0; i < 5; i++) kpis += '<div class="shimmer sk-kpi"></div>';
    return '' +
      '<div class="sk-wrap">' +
      '<div class="shimmer sk-title"></div>' +
      '<div class="shimmer sk-sub"></div>' +
      (note ? '<div class="sk-note"><span class="sk-dot"></span>' + note + '</div>' : '') +
      '<div class="sk-row">' + kpis + '</div>' +
      '<div class="sk-row"><div class="shimmer sk-chart"></div><div class="shimmer sk-chart"></div></div>' +
      '<div class="sk-row"><div class="shimmer sk-chart tall"></div></div>' +
      '<div class="sk-row"><div class="shimmer sk-chart"></div><div class="shimmer sk-chart"></div></div>' +
      '</div>';
  },
  // A grid of card skeletons (for the home page).
  skeletonCards: function (n) {
    n = n || 3;
    var cards = '';
    for (var i = 0; i < n; i++) cards += '<div class="shimmer sk-card"></div>';
    return '<div class="sk-row">' + cards + '</div>';
  },

  // fetch wrapper that attaches the bearer token and JSON headers
  api: async function (method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var t = this.getToken(); if (t) headers.Authorization = 'Bearer ' + t;
    var resp = await fetch(window.PHD_API_BASE + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = null; try { data = await resp.json(); } catch (e) {}
    if (resp.status === 401) { /* token invalid/expired */ this.clear(); }
    return { status: resp.status, ok: resp.ok, data: data };
  },
};
