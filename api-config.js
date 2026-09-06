// Central API configuration for the PHD dashboard frontend.
// After deploying the API on Render, set API_BASE to your service URL, e.g.:
//   window.PHD_API_BASE = 'https://wwos-phd-api.onrender.com';
// For local dev against the server folder, it falls back to http://127.0.0.1:3000.
(function () {
  var override = window.PHD_API_BASE;
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  window.PHD_API_BASE = override || (isLocal ? 'http://127.0.0.1:3000' : 'https://wwos-phd-api.onrender.com');
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
  // Full live-dashboard skeleton matching the current UI: 2-row header (title bar + toolbar),
  // KPI rows, the color-tile row, and chart blocks.
  skeletonDashboard: function (note) {
    var pill = function (w) { return '<div class="shimmer sk-pill" style="width:' + w + 'px"></div>'; };
    var navBtns = pill(90) + pill(70) + pill(110) + pill(100) + pill(120) + pill(100);
    var actBtns = pill(120) + pill(70) + pill(120) + pill(90) + '<div class="shimmer" style="width:34px;height:34px;border-radius:50%"></div>';
    var kpis = ''; for (var i = 0; i < 3; i++) kpis += '<div class="shimmer sk-kpi"></div>';
    var colors = ''; for (var c = 0; c < 5; c++) colors += '<div class="shimmer sk-kpi" style="min-width:120px"></div>';
    return '' +
      // Header row 1: logo/title bar
      '<div class="sk-topbar"><div class="shimmer" style="width:210px;height:24px"></div></div>' +
      // Header row 2: toolbar (nav on left, actions/avatar on right)
      '<div class="sk-toolbar"><div class="sk-tb-left">' + navBtns + '</div><div class="sk-tb-right">' + actBtns + '</div></div>' +
      '<div class="sk-wrap">' +
      '<div class="shimmer sk-title"></div>' +
      (note ? '<div class="sk-note"><span class="sk-dot"></span>' + note + '</div>' : '') +
      '<div class="sk-row">' + kpis + '</div>' +
      '<div class="sk-row" style="flex-wrap:wrap">' + colors + '</div>' +
      '<div class="sk-row"><div class="shimmer sk-chart"></div><div class="shimmer sk-chart"></div></div>' +
      '<div class="sk-row"><div class="shimmer sk-chart tall"></div></div>' +
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
  // ---- Avatars ----
  _avatarColor: function (s) {
    var colors = ['#ff9900', '#2074d5', '#1d8102', '#8c6bb1', '#1b9cb0', '#d13212', '#3ecf4a', '#5b9bd5', '#e67e22', '#9b59b6'];
    var h = 0; s = String(s || '?');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
  },
  _initial: function (person) {
    var base = (person && (person.displayName || person.username)) || '?';
    return String(base).trim().charAt(0).toUpperCase() || '?';
  },
  // Avatar HTML: <img> if person.avatar set, else a colored initial circle. size = px diameter.
  avatarHtml: function (person, size) {
    size = size || 32;
    var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
    if (person && person.avatar) {
      return '<img class="phd-avatar" src="' + esc(person.avatar) + '" alt="avatar" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;display:block">';
    }
    var ch = this._initial(person);
    var col = this._avatarColor((person && (person.displayName || person.username)) || ch);
    var fs = Math.round(size * 0.46);
    return '<span class="phd-avatar" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + col + ';color:#000;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:' + fs + 'px;line-height:1;flex-shrink:0">' + esc(ch) + '</span>';
  },
  // Cache + fetch the logged-in user's profile (displayName/avatar). Used by the toolbar avatar.
  _myProfile: null,
  loadMyProfile: async function () {
    if (!this.getUser()) return null;
    try { var r = await this.api('GET', '/api/me/profile'); if (r.ok && r.data) { this._myProfile = r.data; return r.data; } } catch (e) {}
    return null;
  },
  myProfile: function () { return this._myProfile || this.getUser(); },
};
