// Shared live-dashboard navigation + auth control + login modal.
// Used on app.html (via window.PHDNav.buildToolbarHtml) AND on standalone pages (auto-mounted).
//
// Section 1 (top bar): logo + "Q<label> · LIVE" badge on the left; Users (owner-only) + avatar
//   (Login when logged out / Profile when logged in) on the right.
// Section 2 (nav): a single flex row of Dashboard, Groups, Previous Week, Shift Report,
//   Agent Analytics, Last 24 Hours, Upload new data, My Tickets, Update data log, PHD Tools —
//   role-gated, with the active item highlighted.
//
// Requires api-config.js (window.PHDAuth) and icons.js (window.icon) loaded first.
(function () {
  var A = window.PHDAuth;
  function ic(n, s) { return (typeof window.icon === 'function') ? window.icon(n, s || 15) : ''; }
  function loggedIn() { return !!(A && A.getUser && A.getUser()); }
  function atLeast(r) { return !!(A && A.atLeast && A.atLeast(r)); }

  // ---- Styles ----
  function injectStyles() {
    if (document.getElementById('tbAuthStyles')) return;
    var css = ''
      // top bar (section 1) — fixed at top, highlighted background
      + '.tb-topbar{background:#121820;border-bottom:1px solid #2a2a2a;padding:12px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:100}'
      + '.tb-logo{display:flex;align-items:center;gap:10px;text-decoration:none}'
      + '.tb-logo img{height:28px;width:auto;display:block}'
      + '.tb-logo span{font-size:1.12em;font-weight:700;color:#fff;line-height:1}'
      + '.tb-live{font-size:.68em;font-weight:700;letter-spacing:.5px;color:#4ade80;background:rgba(74,222,128,.14);border:1px solid rgba(74,222,128,.4);border-radius:20px;padding:3px 10px;text-transform:uppercase;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}'
      + '.tb-live::before{content:"";width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80}'
      + '.tb-right{margin-left:auto;display:flex;align-items:center;gap:10px}'
      + '.tb-avatar{display:inline-flex;align-items:center;text-decoration:none}'
      + '.tb-avatar img,.tb-avatar .avatar-initial{border-radius:50%}'
      + '.tb-spinner{display:inline-block;width:30px;height:30px;border:3px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin .8s linear infinite}'
      + '@keyframes tbspin{100%{transform:rotate(360deg)}}'
      // nav (section 2) — fixed below section 1, subtly different highlighted background
      + '.tb-nav{background:#0e141b;border-bottom:1px solid #2a2a2a;box-shadow:0 2px 8px rgba(0,0,0,.35);padding:12px 24px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px;position:sticky;top:53px;z-index:99}'
      + '.tb-nav .tb-navbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 12px;border-radius:6px;font-weight:600;font-size:.85em;cursor:pointer;border:1px solid #2a2a2a;background:transparent;color:#d5dbdb;text-decoration:none;font-family:inherit;text-align:center}'
      + '.tb-nav .tb-navbtn:hover{border-color:#ff9900;color:#ff9900}'
      + '.tb-nav .tb-navbtn.active{background:#ff9900;color:#000;border-color:#ff9900}'
      + '.tb-nav .tb-navbtn.upload{background:rgba(74,222,128,.12);color:#4ade80;border-color:rgba(74,222,128,.45)}'
      + '.tb-nav .tb-navbtn.upload:hover{background:rgba(74,222,128,.20);color:#4ade80;border-color:#4ade80}'
      + '@media(max-width:1100px){.tb-nav{grid-template-columns:repeat(3,1fr)}}'
      + '@media(max-width:680px){.tb-nav{grid-template-columns:repeat(2,1fr)}}'
      + '@media(max-width:420px){.tb-nav{grid-template-columns:1fr}}'
      + '.tb-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:transparent;border:1px solid #2a2a2a;color:#d5dbdb;border-radius:6px;font-weight:600;font-size:.85em;cursor:pointer;text-decoration:none;font-family:inherit}'
      + '.tb-btn:hover{border-color:#ff9900;color:#ff9900}'
      // login modal
      + '.tb-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3000;display:none;align-items:center;justify-content:center;padding:20px}'
      + '.tb-modal{background:#111;border:1px solid #333;border-radius:12px;max-width:420px;width:100%;padding:28px}'
      + '.tb-modal h2{color:#fff;font-size:1.2em;margin:0 0 6px}'
      + '.tb-modal p.sub{color:#879596;font-size:.85em;margin:0 0 14px;line-height:1.5}'
      + '.tb-modal label{display:block;color:#879596;font-size:.85em;margin:14px 0 6px}'
      + '.tb-modal input[type=text],.tb-modal input[type=password]{width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.95em}'
      + '.tb-modal input:focus{outline:none;border-color:#ff9900}'
      + '.tb-err{color:#ff5252;font-size:.85em;margin-top:12px;display:none}'
      + '.tb-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}'
      + '.tb-mbtn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:#ff9900;color:#000;border-radius:6px;font-weight:600;font-size:.88em;cursor:pointer;border:none;font-family:inherit}'
      + '.tb-mbtn:hover{background:#ec7211}'
      + '.tb-mbtn.sec{background:transparent;border:1px solid #2a2a2a;color:#d5dbdb}'
      + '.tb-mbtn.sec:hover{border-color:#ff9900;color:#ff9900}'
      // login loader
      + '.tb-loader{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:3200;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px}'
      + '.tb-loader .sp{width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite}'
      + '.tb-loader p{color:#fff;font-weight:600}'
      // floating circular back button (bottom-right)
      + '.tb-back-fab{position:fixed;right:22px;bottom:22px;z-index:900;width:52px;height:52px;border-radius:50%;background:#ff9900;color:#000;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;transition:transform .15s,background .15s}'
      + '.tb-back-fab:hover{background:#ec7211;transform:translateY(-2px)}'
      + '.tb-back-fab svg{width:22px;height:22px}';
    var st = document.createElement('style');
    st.id = 'tbAuthStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---- Section 1: right-side controls (Users owner-only + avatar/Login) ----
  function rightControlsHtml() {
    var html = '';
    if (loggedIn() && atLeast('owner')) {
      html += '<a class="tb-btn" href="users.html">' + ic('users-gear') + ' Users</a>';
    }
    if (!loggedIn()) {
      html += '<button class="tb-btn" onclick="tbOpenLogin()">' + ic('key') + ' Login</button>';
    } else {
      var prof = (A.myProfile && A.myProfile()) || A.getUser();
      html += '<a class="tb-avatar" href="profile.html" title="Profile">' + (A.avatarHtml ? A.avatarHtml(prof, 32) : '') + '</a>';
    }
    return html;
  }

  // ---- Section 2: the full nav row (role-gated, active highlight) ----
  // active: one of 'dashboard','groups','previous-week','shift-report','agent-analytics',
  //   'last24','my-tickets','data-log','tools' (or '' for none).
  // inApp: true when rendered inside app.html (view buttons use nav()); false = standalone (links).
  function navHtml(active, inApp) {
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    // Per-page opt-out: body[data-nav-hide="home,dashboard,tools"] hides those nav buttons.
    var hideAttr = (document.body.getAttribute('data-nav-hide') || '').toLowerCase();
    var hide = {}; hideAttr.split(',').forEach(function (k) { k = k.trim(); if (k) hide[k] = true; });
    // View buttons (live-dashboard views). In app.html these call nav(); elsewhere link to app.html?view=.
    function view(key, lbl, icon) {
      var cls = 'tb-navbtn' + (active === key ? ' active' : '');
      if (inApp) return '<button class="' + cls + '" onclick="nav(\'' + key + '\')">' + ic(icon) + ' ' + lbl + '</button>';
      var href = (key === 'dashboard') ? 'app.html' : ('app.html?view=' + key);
      return '<a class="' + cls + '" href="' + href + '">' + ic(icon) + ' ' + lbl + '</a>';
    }
    function link(key, lbl, icon, href, extraCls) {
      var cls = 'tb-navbtn' + (active === key ? ' active' : '') + (extraCls ? ' ' + extraCls : '');
      return '<a class="' + cls + '" href="' + href + '">' + ic(icon) + ' ' + lbl + '</a>';
    }
    // Help Activity -> dedicated full-history page.
    function helpActivityBtn() {
      var cls = 'tb-navbtn' + (active === 'help-activity' ? ' active' : '');
      return '<a class="' + cls + '" href="help-activity.html">' + ic('alert') + ' Help Activity</a>';
    }
    var html = '';
    // Home, Dashboard, PHD Tools show only for LOGGED-IN users (and can be hidden per-page).
    if (li && !hide.home) html += '<a class="tb-navbtn" href="index.html">' + ic('home') + ' Home</a>';
    // Fixed order requested by the team.
    if (isAdmin) { // Upload new data (admin+). Lives on app.html; from elsewhere, go there first.
      if (inApp) html += '<label class="tb-navbtn upload" style="cursor:pointer">' + ic('upload') + ' Upload new data<input type="file" accept=".csv" id="uploadFile" style="display:none"></label>';
      else html += '<a class="tb-navbtn upload" href="app.html">' + ic('upload') + ' Upload new data</a>';
    }
    if (li) html += link('data-log', 'Update data log', 'history', 'data-log.html');
    if (li && !hide.dashboard) html += view('dashboard', 'Dashboard', 'grid');
    if (li) html += link('my-tickets', 'My Tickets', 'ticket', 'my-tickets.html');
    if (isAdmin) html += link('agent-analytics', 'Agent Analytics', 'bar-chart', 'agent-analytics.html');
    if (li) {
      html += view('groups', 'Groups', 'users');
      html += view('shift-report', 'Shift Report', 'clipboard');
      html += view('previous-week', 'Previous Week', 'clock-rewind');
    }
    if (isAdmin) html += link('last24', 'Last 24 Hours', 'clock', 'last24.html');
    if (li) html += helpActivityBtn();
    if (li && !hide.tools) html += link('tools', 'PHD Tools', 'tool', 'tools.html');
    return html;
  }

  // ---- Public: build the whole toolbar HTML (Section 1 + Section 2) ----
  // Used by app.html's topBar(). liveLabel e.g. "Q3 2026".
  function buildToolbarHtml(active, opts) {
    opts = opts || {};
    var live = opts.liveLabel ? '<span class="tb-live">' + opts.liveLabel + ' · LIVE</span>' : '';
    return ''
      + '<div class="tb-topbar">'
        + '<span class="tb-logo"><img src="gsoc-logo.svg" alt="GSOC"><span>WWOS-GSOC PHD Dashboard</span>' + live + '</span>'
        + '<div class="tb-right" id="tbAuth">' + rightControlsHtml() + '</div>'
      + '</div>'
      + '<div class="tb-nav">' + navHtml(active, !!opts.inApp) + '</div>';
  }

  window.PHDNav = {
    buildToolbarHtml: buildToolbarHtml,
    rightControlsHtml: rightControlsHtml,
    refreshRight: function () { var s = document.getElementById('tbAuth'); if (s) s.innerHTML = rightControlsHtml(); }
  };

  // ---- Login modal + loader ----
  window.tbOpenLogin = function () {
    document.getElementById('tbLoginModal').style.display = 'flex';
    setTimeout(function () { var u = document.getElementById('tbUser'); if (u) u.focus(); }, 40);
  };
  window.tbCloseLogin = function () { document.getElementById('tbLoginModal').style.display = 'none'; };
  window.tbDoLogin = async function () {
    var u = document.getElementById('tbUser').value.trim();
    var p = document.getElementById('tbPass').value;
    var remember = document.getElementById('tbRemember').checked;
    var err = document.getElementById('tbErr');
    if (!u || !p) { err.textContent = 'Enter username and password.'; err.style.display = 'block'; return; }
    err.style.display = 'none';
    var btn = document.getElementById('tbLoginBtn'); btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      var r = await A.api('POST', '/api/login', { username: u, password: p });
      if (!r.ok) throw new Error((r.data && r.data.error) || ('Login failed (HTTP ' + r.status + ')'));
      A.setSession(r.data.token, r.data.user, remember);
      tbCloseLogin();
      document.getElementById('tbLoader').style.display = 'flex';
      if (A.loadMyProfile) await A.loadMyProfile();
      location.reload();
    } catch (e) {
      err.textContent = e.message; err.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Log in';
    }
  };

  function buildModalAndLoader() {
    if (document.getElementById('tbLoginModal')) return;
    var modal = document.createElement('div');
    modal.className = 'tb-modal-bg';
    modal.id = 'tbLoginModal';
    modal.onclick = function (e) { if (e.target === modal) tbCloseLogin(); };
    modal.innerHTML =
      '<div class="tb-modal">' +
        '<h2>Log in</h2>' +
        '<p class="sub">Log in to publish or manage data. Viewing needs no login.</p>' +
        '<label>Username</label><input type="text" id="tbUser" autocomplete="username">' +
        '<label>Password</label><input type="password" id="tbPass" autocomplete="current-password">' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:.85em;color:#879596"><input type="checkbox" id="tbRemember" style="width:auto"> Keep me signed in</label>' +
        '<div class="tb-err" id="tbErr"></div>' +
        '<div class="tb-modal-actions"><button class="tb-mbtn sec" onclick="tbCloseLogin()">Cancel</button><button class="tb-mbtn" id="tbLoginBtn" onclick="tbDoLogin()">Log in</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    var loader = document.createElement('div');
    loader.className = 'tb-loader'; loader.id = 'tbLoader';
    loader.innerHTML = '<div class="sp"></div><p>Signing you in…</p>';
    document.body.appendChild(loader);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var m = document.getElementById('tbLoginModal'); if (m && m.style.display === 'flex') tbDoLogin(); }
    });
  }

  // Floating circular back button (bottom-right) when a page sets data-back-href. Works on any page.
  function buildBackButton() {
    var backHref = document.body.getAttribute('data-back-href');
    if (!backHref || document.querySelector('.tb-back-fab')) return;
    var lbl = document.body.getAttribute('data-back-label') || 'Back';
    var fab = document.createElement('a');
    fab.className = 'tb-back-fab';
    fab.href = backHref;
    fab.title = 'Back to ' + lbl;
    fab.setAttribute('aria-label', 'Back to ' + lbl);
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
    document.body.appendChild(fab);
  }

  // ---- Standalone-page auto-mount: replace the page's .top-bar with the shared toolbar ----
  // Reads data-nav-active on <body> for the active highlight. Skipped on app.html (it builds its own).
  (async function () {
    injectStyles();
    buildModalAndLoader();
    if (document.body.getAttribute('data-app') === 'live') { buildBackButton(); return; } // app.html: only the back button

    var oldBar = document.querySelector('.top-bar');
    var active = document.body.getAttribute('data-nav-active') || '';
    var liveLabel = document.body.getAttribute('data-live-label') || '';
    var wrap = document.createElement('div');
    wrap.innerHTML = buildToolbarHtml(active, { inApp: false, liveLabel: liveLabel });
    var nodes = []; while (wrap.firstChild) nodes.push(wrap.firstChild), wrap.removeChild(wrap.firstChild);
    if (oldBar) {
      nodes.forEach(function (n) { oldBar.parentNode.insertBefore(n, oldBar); });
      oldBar.remove();
    } else {
      // No existing bar: insert at the very top of <body>, in order.
      for (var i = nodes.length - 1; i >= 0; i--) document.body.insertBefore(nodes[i], document.body.firstChild);
    }

    buildBackButton(); // floating back button if data-back-href is set

    // Show avatar spinner while the profile loads, then refresh the right controls.
    if (loggedIn()) {
      var slot = document.getElementById('tbAuth');
      if (slot) slot.innerHTML = '<span class="tb-spinner" title="Loading profile…"></span>';
      try { if (A.loadMyProfile) await A.loadMyProfile(); } catch (e) {}
      window.PHDNav.refreshRight();
    }

    // Fill the live-quarter badge from /api/quarters (unless already set via data-live-label).
    if (!liveLabel) {
      try {
        var qr = await A.api('GET', '/api/quarters');
        if (qr.ok && qr.data && qr.data.liveLabel) {
          var logo = document.querySelector('.tb-logo');
          if (logo && !logo.querySelector('.tb-live')) {
            var b = document.createElement('span');
            b.className = 'tb-live';
            b.textContent = qr.data.liveLabel + ' · LIVE';
            logo.appendChild(b);
          }
        }
      } catch (e) {}
    }
  })();
})();
