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
    try { this._storeClear(); } catch (e) {}       // drop cached me/profile for this user
    this._me = null; this._myProfile = null; this._liveVerCache = undefined;
    sessionStorage.removeItem(this.TOKEN_KEY); sessionStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.TOKEN_KEY); localStorage.removeItem(this.USER_KEY);
  },
  role: function () { var u = this.getUser(); return u ? u.role : 'user'; },
  rank: function (role) { return ({ user: 0, editor: 1, admin: 2, manager: 2, owner: 3 })[role] != null ? ({ user: 0, editor: 1, admin: 2, manager: 2, owner: 3 })[role] : -1; },
  atLeast: function (role) { return this.rank(this.role()) >= this.rank(role); },
  isOwner: function () { return this.role() === 'owner'; },
  // ---- Per-user access flags (roles retired for these two actions). Owner always allowed. ----
  // Read a flag from the freshest source that has it: the in-memory /api/me (_me), the localStorage
  // "me" cache, then the login session user (getUser). This self-heals for users whose session was
  // cached BEFORE the flags existed (their login object lacks them, but /api/me now returns them).
  _flag: function (name) {
    var srcs = [];
    try { srcs.push(this._me); } catch (e) {}
    try { var s = this._storeRead('me'); if (s && s.data) srcs.push(s.data); } catch (e) {}
    try { srcs.push(this.getUser()); } catch (e) {}
    for (var i = 0; i < srcs.length; i++) { var o = srcs[i]; if (o && o[name] !== undefined) return !!o[name]; }
    return false;
  },
  canUpload: function () { return this.isOwner() || this._flag('canUpload'); },
  canManageUsers: function () { return this.isOwner() || this._flag('canCreateUsers'); },
  canDatabase: function () { return this.isOwner() || this._flag('canDatabase'); },
  canEditTools: function () { return this.isOwner() || this._flag('canEditTools'); },
  canViewSR: function () { return this.isOwner() || this._flag('canViewSR'); },
  canViewRepeat: function () { return this.isOwner() || this._flag('canViewRepeat'); },
  canViewUnique: function () { return this.isOwner() || this._flag('canViewUnique'); },
  canViewSLA: function () { return this.isOwner() || this._flag('canViewSLA'); },
  canGroupingPage: function () { return this.isOwner() || this._flag('canGroupingPage'); },

  // ---- Shared page cache (stale-while-revalidate, version-stamped) ----
  // Lets standalone pages paint instantly from localStorage, then refresh in the background.
  // A cache entry is invalidated automatically when its stored `version` no longer matches the
  // current one (we tie quarter-derived pages to the live quarter's publishedAt, so a new upload
  // transparently busts every user's cache on their next visit). Time-based pages omit `version`.
  _liveVerCache: undefined, // in-memory memo for this page load
  // Cheap live-quarter version (id + publishedAt) via /api/live-version — ONLY the current quarter,
  // no ticket payload and no other quarters. Memoized for this page load.
  liveVersion: async function () {
    if (this._liveVerCache !== undefined) return this._liveVerCache;
    try {
      var r = await this.api('GET', '/api/live-version');
      if (r.ok && r.data && r.data.quarter) {
        this._liveVerCache = r.data.quarter + '|' + (r.data.publishedAt || '');
        return this._liveVerCache;
      }
    } catch (e) {}
    this._liveVerCache = null; // unknown (offline / cold) -> don't invalidate existing caches
    return this._liveVerCache;
  },
  _cacheKey: function (key) { var u = this.getUser(); return 'phd_cache_' + key + '_' + ((u && u.username) || 'anon'); },
  _cacheRead: function (key) { try { var raw = localStorage.getItem(this._cacheKey(key)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } },
  _cacheWrite: function (key, version, data) { try { localStorage.setItem(this._cacheKey(key), JSON.stringify({ version: version, at: Date.now(), data: data })); } catch (e) {} },
  // Stale-while-revalidate loader.
  //   opts: { key, fetch:()->{ok,data}, onData:(data,fromCache)->void, version?:string|null,
  //           refreshMsg?:string, updatedMsg?:string, upToDateMsg?:string }
  //
  // VERSION-FIRST (opts.version is a string, e.g. the live quarter's publishedAt = timestamp "a"):
  //   - cached.version === version  -> the cache is current: serve it, flash "up to date", NO fetch.
  //   - version === null (couldn't check, e.g. cold start) -> serve cache SILENTLY, skip fetch.
  //   - cached exists but version differs -> a new upload happened: serve cache, show the "fetching
  //     the latest…" bar, fetch fresh, re-cache with the new version, then flash "Updated".
  //   - no cache -> fetch fresh (with the bar), cache it.
  // VERSIONLESS (opts.version omitted, non-upload pages): serve cache instantly, refresh quietly in
  //   the background, NEVER show a banner.
  swrLoad: async function (opts) {
    var cached = this._cacheRead(opts.key);
    var hasCache = !!(cached && cached.data != null);
    var versioned = (typeof opts.version !== 'undefined');
    var version = versioned ? opts.version : undefined;
    var banner = window.PHDRefreshBanner;

    // ---- VERSION-FIRST path ----
    if (versioned) {
      // Cache is current (a === b): serve it, reassure, and skip the heavy fetch entirely.
      if (hasCache && version !== null && cached.version === version) {
        try { opts.onData(cached.data, true); } catch (e) {}
        if (banner) { try { banner.upToDate(opts.upToDateMsg); } catch (e) {} }
        return { painted: true, ok: true, fromCache: true, upToDate: true, status: 200, data: cached.data };
      }
      // Couldn't determine the version (offline / cold start): show cache silently, don't fetch/nag.
      if (hasCache && version === null) {
        try { opts.onData(cached.data, true); } catch (e) {}
        return { painted: true, ok: true, fromCache: true, upToDate: false, status: 0, data: cached.data };
      }
      // New data (a !== b) or no cache -> fetch. Paint stale cache first (if any) + show the wait bar.
      var painted = false;
      if (hasCache) { try { opts.onData(cached.data, true); painted = true; } catch (e) {} }
      if (banner) { try { banner.show(opts.refreshMsg); } catch (e) {} }
      var res;
      try { res = await opts.fetch(); } catch (e) { res = null; }
      if (!res || !res.ok) { if (banner) { try { banner.hide(); } catch (e) {} } return { painted: painted, ok: false, status: res ? res.status : 0, data: res ? res.data : null }; }
      this._cacheWrite(opts.key, version, res.data);           // b := a
      try { opts.onData(res.data, false); } catch (e) {}
      if (banner) { try { banner.updated(opts.updatedMsg); } catch (e) {} }
      return { painted: true, ok: true, fromCache: false, status: res.status, data: res.data };
    }

    // ---- VERSIONLESS path (silent, no banner) ----
    var painted2 = false;
    if (hasCache) { try { opts.onData(cached.data, true); painted2 = true; } catch (e) {} }
    var r2;
    try { r2 = await opts.fetch(); } catch (e) { r2 = null; }
    if (!r2 || !r2.ok) { return { painted: painted2, ok: false, status: r2 ? r2.status : 0, data: r2 ? r2.data : null }; }
    var changed = !cached || JSON.stringify(cached.data) !== JSON.stringify(r2.data);
    this._cacheWrite(opts.key, null, r2.data);
    if (!painted2 || changed) { try { opts.onData(r2.data, false); } catch (e) {} }
    return { painted: true, ok: true, status: r2.status, data: r2.data };
  },
  // ---- Loading shimmer skeletons (shown while fetching from Atlas) ----
  // Full live-dashboard skeleton matching the current UI: 2-row header (title bar + toolbar),
  // KPI rows, the color-tile row, and chart blocks.
  skeletonDashboard: function (note) {
    var pill = function (w) { return '<div class="shimmer sk-pill" style="width:' + w + 'px"></div>'; };
    var navBtns = pill(90) + pill(70) + pill(110) + pill(100) + pill(120) + pill(100);
    var actBtns = pill(120) + pill(70) + pill(120) + pill(90) + '<div class="shimmer" style="width:34px;height:34px;border-radius:50%"></div>';
    var kpis = ''; for (var i = 0; i < 3; i++) kpis += '<div class="shimmer sk-kpi"></div>';
    // Age tiles: stacked count / name / range placeholders (matches the new tile layout).
    var colors = '';
    for (var c = 0; c < 5; c++) colors += '<div class="sk-age"><div class="shimmer sk-age-val"></div><div class="shimmer sk-age-name"></div><div class="shimmer sk-age-range"></div></div>';
    return '' +
      // Header row 1: logo/title bar
      '<div class="sk-topbar"><div class="shimmer" style="width:210px;height:24px"></div></div>' +
      // Header row 2: toolbar stacked — nav row then actions row (matches the two-row toolbar)
      '<div class="sk-toolbar"><div class="sk-tb-left">' + navBtns + '</div><div class="sk-tb-right">' + actBtns + '</div></div>' +
      '<div class="sk-wrap">' +
      // Title on the left, Alerts button placeholder on the right (one line)
      '<div class="sk-title-row"><div class="shimmer sk-title"></div><div class="shimmer sk-alert"></div></div>' +
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
  // ---- Small localStorage-backed store for per-user values that rarely change ----
  // Caches /api/me (username, role, timezone) and /api/me/profile (displayName, avatar) so every
  // page doesn't re-fetch them on load. Values are served instantly from cache, then revalidated
  // in the BACKGROUND (stale-while-revalidate). Cache is per-user and cleared on logout.
  STORE_TTL_MS: 30 * 60 * 1000, // consider a cached value "fresh enough" to skip even the bg fetch for 30 min
  _storeKey: function (key) { var u = this.getUser(); return 'phd_store_' + key + '_' + ((u && u.username) || 'anon'); },
  _storeRead: function (key) { try { var raw = localStorage.getItem(this._storeKey(key)); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } },
  _storeWrite: function (key, data) { try { localStorage.setItem(this._storeKey(key), JSON.stringify({ at: Date.now(), data: data })); } catch (e) {} },
  _storeClear: function () {
    try {
      var u = this.getUser(); var uname = (u && u.username) || 'anon';
      ['me', 'profile'].forEach(function (k) {
        try { localStorage.removeItem('phd_store_' + k + '_' + uname); } catch (e) {}
      });
    } catch (e) {}
  },

  // GET /api/me (username, role, timezone), cache-first + background revalidate.
  // Returns the cached value immediately if present; otherwise awaits the fetch.
  _me: null,
  getMe: async function () {
    if (!this.getUser()) return null;
    var cached = this._storeRead('me');
    if (cached && cached.data) {
      this._me = cached.data;
      // Fresh within TTL -> skip the network entirely. Stale -> revalidate quietly in the background.
      if ((Date.now() - (cached.at || 0)) > this.STORE_TTL_MS) this._refreshMe();
      return this._me;
    }
    return await this._refreshMe();
  },
  _refreshMe: async function () {
    var self = this;
    try { var r = await this.api('GET', '/api/me'); if (r.ok && r.data) { self._me = r.data; self._storeWrite('me', r.data); return r.data; } } catch (e) {}
    return self._me;
  },
  // Convenience: the user's timezone (IST/MST) from the cached /api/me. Falls back to 'IST'.
  myTimezone: async function () { var me = await this.getMe(); return (me && me.timezone) || 'IST'; },

  // Cache + fetch the logged-in user's profile (displayName/avatar). Used by the toolbar avatar.
  // Cache-first + background revalidate so the avatar shows instantly across pages.
  _myProfile: null,
  loadMyProfile: async function () {
    if (!this.getUser()) return null;
    var cached = this._storeRead('profile');
    if (cached && cached.data) {
      this._myProfile = cached.data;
      if ((Date.now() - (cached.at || 0)) > this.STORE_TTL_MS) this._refreshProfile();
      return this._myProfile;
    }
    return await this._refreshProfile();
  },
  _refreshProfile: async function () {
    var self = this;
    try { var r = await this.api('GET', '/api/me/profile'); if (r.ok && r.data) { self._myProfile = r.data; self._storeWrite('profile', r.data); return r.data; } } catch (e) {}
    return self._myProfile;
  },
  // Overwrite the cached profile after the user edits it (profile.html save).
  setMyProfile: function (data) { this._myProfile = data; this._storeWrite('profile', data); },
  myProfile: function () { return this._myProfile || this.getUser(); },

  // ---- "tally" animation (shared) ----------------------------------------------------------
  // The number-reveal animation used for DB-backed counts across the app:
  //   loading placeholder (dim pulsing dash)  ->  brief scramble  ->  ease-out count-up to value.
  // Usage:
  //   A.tallyPlaceholder(el)   // put a tile into the loading state (call in the static skeleton)
  //   A.tally(el, value)       // once the data lands, animate el up to `value`
  //   A.tallyAll(root)         // shortcut: run A.tally on every [data-tally] under root using its data-tally value
  // Any element given class "tally-ph" gets the pulsing placeholder look (CSS injected once below).
  _tallyCssInjected: false,
  _ensureTallyCss: function () {
    if (this._tallyCssInjected || typeof document === 'undefined') return;
    this._tallyCssInjected = true;
    var s = document.createElement('style');
    // A small self-contained loading spinner (own keyframe so it works on any page), shown in place
    // of a number until its data arrives. Any element with class "tally-ph" hides its own text and
    // renders the spinner via ::before, so existing markup (e.g. a placeholder dash) needs no change.
    // Sized in em so it scales with the number's font-size.
    s.textContent =
      '.tally-ph{color:transparent!important;display:inline-flex;align-items:center;justify-content:center;min-width:1em;height:1em;vertical-align:-.15em;line-height:1}' +
      '.tally-ph::before{content:"";display:inline-block;width:.7em;height:.7em;border:2px solid var(--bd,#2a2a2a);border-top-color:var(--o,#ff9900);border-radius:50%;animation:tallySpin .8s linear infinite}' +
      '@keyframes tallySpin{100%{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  },
  // Put an element into the loading placeholder state (a small spinner).
  tallyPlaceholder: function (el) {
    if (!el) return;
    this._ensureTallyCss();
    el.classList.add('tally-ph');
    if (!el.textContent) el.textContent = '\u2014'; // give ::before something to size against
  },
  // Animate a number element from a brief scramble into its real value (ease-out count-up).
  // Clears the loading placeholder (spinner) first so it stops the moment real data arrives.
  tally: function (el, target) {
    if (!el) return;
    el.classList.remove('tally-ph');
    target = Number(target) || 0;
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(Date.now()); }, 16); };
    var SCRAMBLE_MS = 140, COUNT_MS = 600, scrMax = Math.max(10, target * 1.3), start = null;
    var step = function (ts) {
      if (start === null) start = ts;
      var t = ts - start;
      if (t < SCRAMBLE_MS) { el.textContent = Math.floor(Math.random() * scrMax); raf(step); }
      else if (t < SCRAMBLE_MS + COUNT_MS) { var p = (t - SCRAMBLE_MS) / COUNT_MS; el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); raf(step); }
      else { el.textContent = target; }
    };
    raf(step);
  },
  // Convenience: tally every element carrying a data-tally="<value>" attribute under `root`.
  tallyAll: function (root) {
    var self = this; root = root || document;
    root.querySelectorAll('[data-tally]').forEach(function (el) { self.tally(el, el.getAttribute('data-tally')); });
  },
};

// Inject the tally CSS immediately on load so any static "tally-ph" placeholder in a page's initial
// markup shows the spinner right away (before the first A.tally* call).
try { window.PHDAuth._ensureTallyCss(); } catch (e) {}
