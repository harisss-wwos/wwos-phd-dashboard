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
      + '.tb-hamburger{display:inline-flex;flex-direction:column;justify-content:center;gap:4px;width:38px;height:34px;padding:8px 9px;background:transparent;border:1px solid #2a2a2a;border-radius:6px;cursor:pointer;flex-shrink:0}'
      + '.tb-hamburger:hover{border-color:#ff9900}'
      + '.tb-hamburger span{display:block;height:2px;width:100%;background:#d5dbdb;border-radius:2px;transition:background .15s,transform .28s ease,opacity .2s ease}'
      + '.tb-hamburger:hover span{background:#ff9900}'
      // animate to an X when the menu is open
      + '.tb-hamburger[aria-expanded="true"] span:nth-child(1){transform:translateY(6px) rotate(45deg)}'
      + '.tb-hamburger[aria-expanded="true"] span:nth-child(2){opacity:0}'
      + '.tb-hamburger[aria-expanded="true"] span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}'
      + '.tb-logo{display:flex;align-items:center;gap:10px;text-decoration:none}'
      + '.tb-logo img{height:28px;width:auto;display:block}'
      + '.tb-logo span{font-size:1.12em;font-weight:700;color:#fff;line-height:1}'
      + '.tb-qbtn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:transparent;border:1px solid #2a2a2a;color:#d5dbdb;border-radius:6px;font-weight:600;font-size:.82em;cursor:pointer;text-decoration:none;white-space:nowrap;font-family:inherit;margin-left:8px;transition:border-color .15s,color .15s}'
      + '.tb-qbtn:hover{border-color:#ff9900;color:#ff9900}'
      // Quarter + Upload/My-Tickets buttons now live inside the hamburger menu (all sizes) -> hide from the bar
      + '.tb-qbtn,.tb-movable{display:none!important}'
      + '.tb-right{margin-left:auto;display:flex;align-items:center;gap:10px}'
      + '.tb-avatar{display:inline-flex;align-items:center;text-decoration:none}'
      + '.tb-avatar img,.tb-avatar .avatar-initial{border-radius:50%}'
      // role badge (pill) shown to the LEFT of the avatar for logged-in users
      + '.tb-role{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;line-height:1;border:1px solid #2a2a2a;background:#1a2230;color:#9fb0c3;white-space:nowrap}'
      + '.tb-role-owner{background:#2a1d10;color:#f0b45a;border-color:#5a3d18}'
      + '.tb-role-admin{background:#101f2a;color:#57b6e6;border-color:#1c3d52}'
      + '.tb-role-manager{background:#1a1030;color:#b087f0;border-color:#392561}'
      + '.tb-role-editor{background:#0f1f14;color:#4ade80;border-color:#1c4029}'
      + '.tb-spinner{display:inline-block;width:30px;height:30px;border:3px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin .8s linear infinite}'
      + '@keyframes tbspin{100%{transform:rotate(360deg)}}'
      // hamburger dropdown menu (collapsible) — FULL WIDTH across the page at all sizes, items centered
      // Slides down on open / up on close (animated via transform + opacity + max-height).
      // OUTER: full-width, flush under the top bar (no side gaps) — looks like the bar expanding down.
      // Animates height only; ALWAYS overflow:hidden so no scrollbar flashes during the slide.
      + '.tb-menu{position:fixed;top:53px;left:0;right:0;z-index:99;background:#121820;border-bottom:0 solid #2a2a2a;box-shadow:none;max-height:0;overflow:hidden;opacity:1;transform:none;pointer-events:none;transition:max-height .3s ease}'
      + '.tb-menu.open{max-height:85vh;pointer-events:auto;border-bottom-width:1px;box-shadow:0 10px 30px rgba(0,0,0,.5)}'
      // INNER: centered content column; the padding animates away with the bar so it collapses flush.
      + '.tb-menu-inner{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 16px}'
      + '.tb-menu .tb-menuitem{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:11px 18px;border-radius:6px;font-weight:600;font-size:.9em;cursor:pointer;border:none;background:transparent;color:#d5dbdb;text-decoration:none;font-family:inherit;text-align:center;width:100%;max-width:420px}'
      + '.tb-menu .tb-menuitem:hover{background:#1a2430;color:#ff9900}'
      + '.tb-menu .tb-menuitem.active{background:#ff9900;color:#000}'
      + '.tb-menu .tb-menu-mobile,.tb-menu .tb-menu-label,.tb-menu .tb-menu-divider{width:100%;max-width:420px;text-align:center}'
      + '.tb-menu-mobile{display:flex;flex-direction:column;align-items:center;gap:4px}'  // shown in the menu at all sizes
      + '.tb-menu-label{color:#5f6b6c;font-size:.68em;font-weight:700;text-transform:uppercase;letter-spacing:.6px;padding:6px 14px 2px}'
      + '.tb-menu-divider{height:1px;background:#2a2a2a;margin:6px 8px}'
      + '.tb-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:transparent;border:1px solid #2a2a2a;color:#d5dbdb;border-radius:6px;font-weight:600;font-size:.85em;cursor:pointer;text-decoration:none;font-family:inherit}'
      + '.tb-btn:hover{border-color:#ff9900;color:#ff9900}'
      // login modal
      + '.tb-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3000;display:none;align-items:center;justify-content:center;padding:20px}'
      + '.tb-modal{background:#111;border:1px solid #333;border-radius:12px;max-width:420px;width:100%;padding:28px}'
      + '.tb-modal h2{color:#fff;font-size:1.2em;margin:0 0 6px}'
      + '.tb-modal p.sub{color:#879596;font-size:.85em;margin:0 0 14px;line-height:1.5}'
      + '.tb-modal label{display:block;color:#879596;font-size:.85em;margin:14px 0 6px}'
      + '.tb-modal input[type=text],.tb-modal input[type=password]{width:100%;padding:10px 12px;background:#000;border:1px solid #2a2a2a;border-radius:6px;color:#fff;font-size:.95em}'
      + '.tb-pass-wrap{position:relative}'
      + '.tb-pass-wrap input{padding-right:44px!important}'
      + '.tb-pass-eye{position:absolute;top:50%;right:6px;transform:translateY(-50%);background:transparent;border:none;color:#879596;cursor:pointer;padding:6px;display:inline-flex;align-items:center;border-radius:6px}'
      + '.tb-pass-eye:hover{color:#ff9900}'
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
      + '.tb-back-fab svg{width:22px;height:22px}'
      // ---- Shared responsive guard (kills x-axis scroll; applies on every page) ----
      + 'html,body{max-width:100%;overflow-x:hidden}'
      + '*{box-sizing:border-box}'
      + 'img,svg,canvas,video{max-width:100%;height:auto}'
      + 'pre{max-width:100%;overflow-x:auto;white-space:pre-wrap;word-break:break-word}'
      // any data table sits in a scroll container instead of pushing the page wider
      + '.tbl-card{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}'
      + 'table{max-width:100%}'
      + '@media(max-width:920px){'
        + '.tb-topbar{padding:10px 12px;gap:8px;flex-wrap:wrap}'
        + '.tb-logo{flex-wrap:wrap;gap:6px}'
        + '.tb-logo span{font-size:.95em}'
        + '.tb-logo img{height:24px}'
        // let the logo/title take the top row with the hamburger + avatar; buttons wrap to next row
        + '.tb-right{gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto}'
        + '.tb-btn,.tb-qbtn{padding:6px 10px;font-size:.76em;gap:4px}'
        + '.tb-menu{left:0;right:0;top:52px}'
        + '.tb-avatar img,.tb-avatar .avatar-initial{width:28px!important;height:28px!important}'
        // page wrappers: full width with small gutters (overrides fixed 80% / 80vw / big max-widths)
        + '.wrap{width:auto!important;max-width:100%!important;margin:0!important;padding:20px 14px!important}'
        // the index.html centering trick (80vw + translateX) overflows on mobile -> neutralize
        + '.about,.grid{width:auto!important;max-width:100%!important;left:auto!important;margin-left:0!important;transform:none!important}'
        // collapse multi-column grids to a single column
        + '.grid,.kpi-grid,.change-grid{grid-template-columns:1fr!important}'
        // shrink oversized hero text so it fits narrow screens
        + '.hero h1{font-size:1.6em!important}'
        // any bare data table becomes its own horizontal-scroll container (never widens the page).
        // Tables already inside a .tbl-card scroll via that card, so exclude those (reset to normal).
        + 'table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}'
        + '.tbl-card>table,.tbl-card table{display:table;overflow:visible}'
      + '}';
    var st = document.createElement('style');
    st.id = 'tbAuthStyles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---- Section 1: right-side controls (Upload + My Tickets + avatar/Login) ----
  function rightControlsHtml() {
    var html = '';
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    var inApp = document.body.getAttribute('data-app') === 'live';
    // Upload new data (admin+) — same in-place pipeline; app vs standalone input id.
    if (isAdmin) {
      if (inApp) html += '<button type="button" class="tb-btn tb-movable" onclick="tbUploadIntro(\'app\')">' + ic('upload') + ' Upload new data</button><input type="file" accept=".csv" id="uploadFile" style="display:none">';
      else html += '<button type="button" class="tb-btn tb-movable" onclick="tbUploadIntro(\'standalone\')">' + ic('upload') + ' Upload new data</button><input type="file" accept=".csv" id="uploadFileStandalone" style="display:none">';
    }
    if (li) html += '<a class="tb-btn tb-movable" href="my-tickets.html">' + ic('ticket') + ' My Tickets</a>';
    if (!li) {
      html += '<button class="tb-btn" onclick="tbOpenLogin()">' + ic('key') + ' Login</button>';
    } else {
      var prof = (A.myProfile && A.myProfile()) || A.getUser();
      // Role badge to the LEFT of the avatar. Editors are shown as "User"; everyone else uses their own role name.
      var rl = (A.role && A.role()) || 'user';
      var rlLabel = (rl === 'editor') ? 'User' : (rl.charAt(0).toUpperCase() + rl.slice(1));
      html += '<span class="tb-role tb-role-' + rl + '">' + rlLabel + '</span>';
      html += '<a class="tb-avatar" href="profile.html" title="Profile">' + (A.avatarHtml ? A.avatarHtml(prof, 32) : '') + '</a>';
    }
    return html;
  }

  // ---- Hamburger menu contents (role-gated). Rendered inside the collapsible dropdown. ----
  // active: one of 'groups','previous-week','shift-report','agent-analytics','last24',
  //   'help-activity','tools','unique-cases','users' (or '' for none).
  // inApp: true inside app.html (view buttons call nav()); false = standalone (links to app.html?view=).
  function navHtml(active, inApp) {
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    var isOwner = atLeast('owner');
    var hideAttr = (document.body.getAttribute('data-nav-hide') || '').toLowerCase();
    var hide = {}; hideAttr.split(',').forEach(function (k) { k = k.trim(); if (k) hide[k] = true; });
    function view(key, lbl, icon) {
      var cls = 'tb-menuitem' + (active === key ? ' active' : '');
      if (inApp) return '<button class="' + cls + '" onclick="tbCloseMenu();nav(\'' + key + '\')">' + ic(icon) + ' ' + lbl + '</button>';
      var href = 'app.html?view=' + key;
      return '<a class="' + cls + '" href="' + href + '">' + ic(icon) + ' ' + lbl + '</a>';
    }
    function link(key, lbl, icon, href) {
      var cls = 'tb-menuitem' + (active === key ? ' active' : '');
      return '<a class="' + cls + '" href="' + href + '">' + ic(icon) + ' ' + lbl + '</a>';
    }
    var html = '';
    // MOBILE ONLY: the top-bar quick actions (Q3 LIVE, Q2, Upload, My Tickets) move into the menu.
    // Hidden on desktop via CSS (.tb-menu-mobile{display:none} until <=768px).
    var mob = '<div class="tb-menu-mobile"><div class="tb-menu-label">Quick actions</div>';
    mob += '<a class="tb-menuitem" href="app.html">' + ic('bolt') + ' Q3 2026 · LIVE</a>';
    mob += '<a class="tb-menuitem" href="archive.html?ds=quarter&qid=2026-Q2">' + ic('calendar') + ' Q2 2026</a>';
    if (isAdmin) mob += '<button type="button" class="tb-menuitem" onclick="tbCloseMenu();tbUploadIntro(\'' + (inApp ? 'app' : 'standalone') + '\')">' + ic('upload') + ' Upload new data</button>';
    if (li) mob += '<a class="tb-menuitem" href="my-tickets.html">' + ic('ticket') + ' My Tickets</a>';
    mob += '<div class="tb-menu-divider"></div><div class="tb-menu-label">Navigate</div></div>';
    html += mob;
    if (isAdmin) html += link('agent-analytics', 'Agent Analytics', 'bar-chart', 'agent-analytics.html');
    if (li) {
      html += view('groups', 'Groups', 'users');
      html += view('shift-report', 'Shift Report', 'clipboard');
      html += view('previous-week', 'Previous Week', 'clock-rewind');
    }
    if (isAdmin) html += link('last24', 'Last 24 Hours', 'clock', 'last24.html');
    if (li) html += link('help-activity', 'Help Activity', 'alert', 'help-activity.html');
    if (li && !hide.tools) html += link('tools', 'PHD Tools', 'tool', 'tools.html');
    if (isAdmin) html += link('unique-cases', 'Unique cases', 'bar-chart', 'important-cases.html');
    if (isOwner) html += link('users', 'Users', 'users-gear', 'users.html');
    return html;
  }

  // ---- Public: build the whole toolbar HTML (Section 1 + Section 2) ----
  // Used by app.html's topBar(). liveLabel e.g. "Q3 2026".
  function buildToolbarHtml(active, opts) {
    opts = opts || {};
    // Hardcoded quarter buttons (regular button look): Q3 live + Q2 report.
    var live = '<a class="tb-qbtn" href="app.html" title="Go to the live dashboard">Q3 2026 · LIVE</a>'
      + '<a class="tb-qbtn" href="archive.html?ds=quarter&qid=2026-Q2" title="Q2 2026 report">Q2 2026</a>';
    // Menu items live in a collapsible dropdown behind the hamburger (unless noNav).
    var menu = opts.noNav ? '' : ('<div class="tb-menu" id="tbMenu"><div class="tb-menu-inner">' + navHtml(active, !!opts.inApp) + '</div></div>');
    return ''
      + '<div class="tb-topbar">'
        + '<button type="button" class="tb-hamburger" id="tbHamburger" aria-label="Menu" aria-expanded="false" title="Menu" onclick="tbToggleMenu()"><span></span><span></span><span></span></button>'
        + '<span class="tb-logo"><img src="gsoc-logo.svg" alt="GSOC"><span>WWOS-GSOC PHD</span>' + live + '</span>'
        + '<div class="tb-right" id="tbAuth">' + rightControlsHtml() + '</div>'
      + '</div>'
      + menu;
  }

  // ---- Hamburger menu open/close ----
  window.tbToggleMenu = function () {
    var m = document.getElementById('tbMenu'); if (!m) return;
    var open = m.classList.toggle('open');
    var h = document.getElementById('tbHamburger'); if (h) h.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  window.tbCloseMenu = function () {
    var m = document.getElementById('tbMenu'); if (m) m.classList.remove('open');
    var h = document.getElementById('tbHamburger'); if (h) h.setAttribute('aria-expanded', 'false');
  };
  // Close the menu when clicking outside it (but not on the hamburger).
  document.addEventListener('click', function (e) {
    var m = document.getElementById('tbMenu'); if (!m || !m.classList.contains('open')) return;
    var h = document.getElementById('tbHamburger');
    if (m.contains(e.target) || (h && h.contains(e.target))) return;
    tbCloseMenu();
  });

  window.PHDNav = {
    buildToolbarHtml: buildToolbarHtml,
    rightControlsHtml: rightControlsHtml,
    refreshRight: function () { var s = document.getElementById('tbAuth'); if (s) s.innerHTML = rightControlsHtml(); }
  };

  // Full-page loader (reuses .tb-loader). msg optional.
  window.tbShowLoader = function (msg) {
    var l = document.getElementById('tbLoader');
    if (!l) return;
    var p = l.querySelector('p'); if (p && msg) p.textContent = msg;
    l.style.display = 'flex';
  };
  window.tbHideLoader = function () { var l = document.getElementById('tbLoader'); if (l) l.style.display = 'none'; };

  // Required CSV columns (kept in sync with app.js REQUIRED_COLUMNS). Standalone upload validates here.
  var TB_REQUIRED_COLUMNS = ['IssueId','IssueUrl','ShortId','Title','Status','CreateDate','Severity','AssigneeIdentity','ResolvedDate','Age','ClosureCode','ResolvedByIdentity','RootCause','RootCauseDetails','AssignedGroup','LastAssignedDate','LastUpdatedConversationDate','LastUpdatedDate'];
  function tbMissingColumns(text) {
    var cells = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) { var ch = text[i];
      if (ch === '"') { if (inQ && text[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
      else if ((ch === '\n' || ch === '\r') && !inQ) { break; }
      else { cur += ch; } }
    cells.push(cur);
    var have = {}; cells.forEach(function (h) { have[String(h || '').trim().toLowerCase()] = true; });
    return TB_REQUIRED_COLUMNS.filter(function (c) { return !have[c.toLowerCase()]; });
  }
  // Pre-upload intro popup: lists the 18 mandatory columns; Proceed opens the file picker.
  window.tbUploadIntro = function (target) {
    var inputId = (target === 'standalone') ? 'uploadFileStandalone' : 'uploadFile';
    var listHtml = TB_REQUIRED_COLUMNS.map(function (c) {
      return '<li style="padding:3px 0;color:#d5dbdb"><span style="color:#4ade80">•</span> <span style="font-family:monospace;font-size:.9em">' + c + '</span></li>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'tbUploadIntro';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3400;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:580px;width:100%;max-height:88vh;overflow:auto;padding:26px">' +
      '<h2 style="color:#fff;font-size:1.2em;margin-bottom:6px">Before you upload</h2>' +
      '<p style="color:#879596;font-size:.9em;margin-bottom:14px">For the file to be considered, the CSV <b style="color:#fff">must include all of these columns</b>. If any is missing, the upload will be blocked.</p>' +
      '<ul style="list-style:none;padding:0;margin:0;columns:2;column-gap:24px">' + listHtml + '</ul>' +
      '<div style="margin-top:22px;display:flex;gap:10px;justify-content:flex-end">' +
        '<button class="tb-mbtn sec" id="tbUploadCancel">Cancel</button>' +
        '<button class="tb-mbtn" id="tbUploadProceed">Proceed &amp; choose file</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    document.getElementById('tbUploadCancel').onclick = function () { ov.remove(); };
    document.getElementById('tbUploadProceed').onclick = function () {
      ov.remove();
      var inp = document.getElementById(inputId);
      if (inp) inp.click();
    };
  };

  function tbShowColumnError(missing) {
    var listHtml = TB_REQUIRED_COLUMNS.map(function (c) {
      var bad = missing.indexOf(c) !== -1;
      return '<li style="display:flex;align-items:center;gap:8px;padding:4px 0;color:' + (bad ? '#ff5252' : '#4ade80') + '">' + (bad ? '✗' : '✓') + ' <span style="font-family:monospace;font-size:.9em">' + c + '</span>' + (bad ? ' <span style="color:#ff5252;font-size:.78em">(missing)</span>' : '') + '</li>';
    }).join('');
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3400;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:26px">' +
      '<h2 style="color:#ff5252;font-size:1.2em;margin-bottom:6px">Upload blocked — missing required columns</h2>' +
      '<p style="color:#879596;font-size:.9em;margin-bottom:14px">The file is missing <b style="color:#ff5252">' + missing.length + '</b> required column' + (missing.length === 1 ? '' : 's') + '. All 18 columns below are mandatory. Fix the export and try again — <b>no data was uploaded</b>.</p>' +
      '<ul style="list-style:none;padding:0;margin:0;columns:2;column-gap:24px">' + listHtml + '</ul>' +
      '<div style="margin-top:20px;text-align:right"><button class="tb-mbtn" onclick="this.closest(\'div[style*=fixed]\').remove()">Close</button></div>' +
      '</div>';
    document.body.appendChild(ov);
  }

  // ---- In-place "Upload new data" pipeline (runs on ANY page; the page is retained) ----
  // Fields whose change (on a ticket with a newer LastUpdatedDate) triggers an update.
  var TB_MERGE_FIELDS = ['Title','Status','Severity','AssigneeIdentity','ResolvedDate','Age','ClosureCode','ResolvedByIdentity','RootCause','RootCauseDetails'];
  var TB_TS_FIELDS = ['LastAssignedDate','LastUpdatedConversationDate','LastUpdatedDate'];
  var tbAssessAborted = false;

  // CSV parser (handles quoted commas / escaped quotes). Returns array of row objects keyed by header.
  function tbParseCSV(text) {
    var cells = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) { var ch = text[i];
      if (ch === '"') { if (inQ && text[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (ch === ',' && !inQ) { cells.push(cur); cur = ''; }
      else if ((ch === '\n' || ch === '\r') && !inQ) { if (ch === '\r' && text[i + 1] === '\n') i++; cells.push(cur); cur = ''; cells.push('__ROW__'); }
      else { cur += ch; } }
    if (cur !== '') cells.push(cur); cells.push('__ROW__');
    var rows = [], row = [];
    for (var k = 0; k < cells.length; k++) { if (cells[k] === '__ROW__') { if (row.length) rows.push(row); row = []; } else row.push(cells[k]); }
    if (!rows.length) return [];
    var H = rows[0].map(function (h) { return String(h || '').trim(); });
    var data = [];
    for (var r = 1; r < rows.length; r++) { var o = {}; for (var j = 0; j < H.length; j++) o[H[j]] = rows[r][j] || ''; data.push(o); }
    return data;
  }
  function tbQuarterOf(d) { var x = new Date(d); return isNaN(x) ? null : (x.getFullYear() + '-Q' + (Math.floor(x.getMonth() / 3) + 1)); }
  function tbEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // Small full-page overlay helpers for this flow.
  function tbFlowOverlay(id, inner, z) {
    var ov = document.createElement('div'); ov.id = id;
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:' + (z || 3400) + ';display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = inner; document.body.appendChild(ov); return ov;
  }
  function tbRemove(id) { var el = document.getElementById(id); if (el) el.remove(); }

  // Single delegated listener for BOTH upload inputs (app.html #uploadFile + standalone).
  document.addEventListener('change', function (e) {
    if (!e.target || (e.target.id !== 'uploadFile' && e.target.id !== 'uploadFileStandalone')) return;
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) { tbBeginUpload(String(ev.target.result || '')); };
    reader.onerror = function () { alert('Could not read the file.'); };
    reader.readAsText(file);
  });

  // Step A: validate columns, then assess.
  function tbBeginUpload(csvText) {
    var missing = tbMissingColumns(csvText);
    if (missing.length) { tbShowColumnError(missing); return; }
    tbAssessAborted = false;
    tbFlowOverlay('tbAssess',
      '<div style="text-align:center">' +
        '<div class="sp" style="width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite;margin:0 auto"></div>' +
        '<p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">The file is being assessed for new data, please wait…</p>' +
        '<p style="color:#879596;margin-top:8px;font-size:.9em">Comparing against the live data. This may take a moment.</p>' +
        '<button class="tb-mbtn sec" id="tbAssessCancel" style="margin-top:18px">Cancel</button>' +
      '</div>');
    document.getElementById('tbAssessCancel').onclick = function () { tbAssessAborted = true; tbRemove('tbAssess'); };
    // Defer so the spinner paints before the (sync) parse + fetch.
    setTimeout(function () { tbAssess(csvText); }, 40);
  }

  // Step B: parse + compare LastUpdatedDate vs stored; build the delta; show the confirm popup.
  async function tbAssess(csvText) {
    var rows;
    try { rows = tbParseCSV(csvText).filter(function (r) { return r.ShortId || r.IssueId; }).map(function (r) { if (!r.ShortId && r.IssueId) r.ShortId = r.IssueId; return r; }); }
    catch (err) { tbRemove('tbAssess'); alert('Could not read the CSV file.'); return; }
    if (!rows.length) { tbRemove('tbAssess'); alert('No tickets with a ShortId/IssueId were found in the file.'); return; }

    // Fetch the current live-quarter dataset to compare against.
    var live;
    try { live = await A.api('GET', '/api/live-quarter'); } catch (e) { live = null; }
    if (tbAssessAborted) return;
    if (!live || !live.ok || !live.data) { tbRemove('tbAssess'); alert('Could not load the live dataset to compare. Try again.'); return; }
    var liveQ = live.data.quarter;
    var storedTix = (live.data.data && live.data.data.tickets) || [];
    var storedMap = {}; storedTix.forEach(function (t) { var id = String(t.ShortId || t.IssueId || ''); if (id) storedMap[id] = t; });

    // Split rows into live-quarter vs non-live (past quarters merged server-side by ShortId).
    var changed = [];    // live tickets to write (field changes) OR new live tickets
    var nonLive = [];
    var xNewer = 0, yUpdated = 0, zNew = 0;
    var lud = function (v) { var d = new Date(v); return isNaN(d) ? null : d.getTime(); };

    rows.forEach(function (nr) {
      var q = tbQuarterOf(nr.CreateDate);
      if (q && liveQ && q !== liveQ) { nonLive.push(nr); return; }
      var old = storedMap[String(nr.ShortId)];
      if (!old) { changed.push(nr); zNew++; return; }        // new live ticket -> add whole
      // Not-older = file LastUpdatedDate >= stored. (Equal is allowed so a status change that didn't
      // bump the timestamp — e.g. a resolution — still applies. An OLDER file row is ignored.)
      var a = lud(nr.LastUpdatedDate), b = lud(old.LastUpdatedDate);
      var notOlder = (a != null) && (b == null || a >= b);
      if (!notOlder) return;                                  // older -> ignore
      var fieldChanged = TB_MERGE_FIELDS.some(function (f) { return String(nr[f] == null ? '' : nr[f]) !== String(old[f] == null ? '' : old[f]); });
      if (!fieldChanged) return;                              // no field change -> ignore (nothing to update)
      xNewer++;                                               // has newer-or-equal data AND a real change
      // Update: overwrite the 10 fields + refresh all 3 timestamps; keep other stored fields.
      var merged = {}; for (var k in old) merged[k] = old[k];
      TB_MERGE_FIELDS.forEach(function (f) { merged[f] = nr[f]; });
      TB_TS_FIELDS.forEach(function (f) { merged[f] = nr[f]; });
      changed.push(merged); yUpdated++;
    });

    if (tbAssessAborted) return;
    tbRemove('tbAssess');
    tbShowConfirm({ xNewer: xNewer, yUpdated: yUpdated, zNew: zNew, changed: changed, nonLive: nonLive, liveQ: liveQ });
  }

  // Step C: confirmation popup with the counts. On confirm -> delta publish.
  function tbShowConfirm(res) {
    var nonLiveNote = res.nonLive.length ? ('<p style="color:#fbbf24;font-size:.82em;margin-top:10px">' + res.nonLive.length + ' ticket(s) from past quarters will be merged into their own quarter dashboards.</p>') : '';
    // No newer data at all (0 tickets with a changed LastUpdatedDate) and no new tickets/past-quarter
    // rows -> tell the user there are no new changes and let them close the upload.
    if (res.xNewer === 0 && res.zNew === 0 && res.nonLive.length === 0) {
      tbFlowOverlay('tbConfirm',
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:480px;width:100%;padding:26px;text-align:center">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#fff;font-size:1.2em;margin:8px 0 8px">No new changes</h2>' +
          '<p style="color:#879596;font-size:.92em;line-height:1.6">No ticket in this file has a newer <b style="color:#d5dbdb">LastUpdatedDate</b> than what\'s already live, and there are no new tickets. Nothing needs to be uploaded.</p>' +
          '<div style="margin-top:22px"><button class="tb-mbtn" id="tbConfirmClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbConfirmClose').onclick = function () { tbRemove('tbConfirm'); };
      return;
    }
    tbFlowOverlay('tbConfirm',
      '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:520px;width:100%;padding:26px">' +
        '<h2 style="color:#fff;font-size:1.2em;margin-bottom:12px">Assessment complete</h2>' +
        '<div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:6px 16px">' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #2a2a2a"><span style="color:#879596">Tickets with newer data</span><span style="color:#44b9d6;font-weight:700">' + res.xNewer + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #2a2a2a"><span style="color:#879596">Will be updated (field changes)</span><span style="color:#fbbf24;font-weight:700">' + res.yUpdated + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0"><span style="color:#879596">New tickets to add</span><span style="color:#4ade80;font-weight:700">' + res.zNew + '</span></div>' +
        '</div>' + nonLiveNote +
        '<p style="color:#879596;font-size:.82em;margin-top:12px">Confirm to save these changes to the shared database.</p>' +
        '<div style="margin-top:18px;display:flex;gap:10px;justify-content:flex-end">' +
          '<button class="tb-mbtn sec" id="tbConfirmCancel">Cancel</button>' +
          '<button class="tb-mbtn" id="tbConfirmGo">Confirm &amp; upload</button>' +
        '</div>' +
      '</div>');
    document.getElementById('tbConfirmCancel').onclick = function () { tbRemove('tbConfirm'); };
    document.getElementById('tbConfirmGo').onclick = function () { tbRemove('tbConfirm'); tbPublish(res); };
  }

  // Step D: delta publish (only changed/new + non-live). Stays on the current page.
  async function tbPublish(res) {
    tbFlowOverlay('tbPush',
      '<div style="text-align:center">' +
        '<div class="sp" style="width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite;margin:0 auto"></div>' +
        '<p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">New data is being pushed…</p>' +
        '<p style="color:#879596;margin-top:8px;font-size:.9em">Saving to the shared database. This may take a moment.</p>' +
      '</div>');
    try {
      var body = { changed: res.changed, nonLive: res.nonLive, changeSummary: { added: res.zNew, updated: res.yUpdated } };
      var r = await A.api('POST', '/api/live-quarter/patch', body);
      if (!r.ok) {
        // Fallback: if there is no live doc yet, a delta can't apply — inform (rare; live quarter exists).
        throw new Error((r.data && r.data.error) || ('Upload failed (HTTP ' + r.status + ')'));
      }
      tbRemove('tbPush');
      tbFlowOverlay('tbDone',
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:460px;width:100%;padding:26px;text-align:center">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#4ade80;font-size:1.2em;margin:8px 0 6px">Upload complete</h2>' +
          '<p style="color:#879596;font-size:.9em">' + res.yUpdated + ' updated · ' + res.zNew + ' added. Live for everyone now.</p>' +
          '<div style="margin-top:18px"><button class="tb-mbtn" id="tbDoneClose">Done</button></div>' +
        '</div>');
      document.getElementById('tbDoneClose').onclick = function () {
        tbRemove('tbDone');
        // Refresh in-place if the current page can re-render from the live data.
        if (typeof window.PHDRefreshLive === 'function') { try { window.PHDRefreshLive(); } catch (e) {} }
      };
    } catch (err) {
      tbRemove('tbPush');
      tbFlowOverlay('tbErr',
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:460px;width:100%;padding:26px;text-align:center">' +
          '<h2 style="color:#ff5252;font-size:1.15em;margin-bottom:6px">Upload failed</h2>' +
          '<p style="color:#879596;font-size:.9em">' + tbEsc(err.message) + '</p>' +
          '<div style="margin-top:18px"><button class="tb-mbtn" id="tbErrClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbErrClose').onclick = function () { tbRemove('tbErr'); };
    }
  }

  // ---- Login modal + loader ----
  window.tbOpenLogin = function () {
    document.getElementById('tbLoginModal').style.display = 'flex';
    setTimeout(function () { var u = document.getElementById('tbUser'); if (u) u.focus(); }, 40);
  };
  window.tbCloseLogin = function () { document.getElementById('tbLoginModal').style.display = 'none'; };
  // Toggle password visibility in the login modal (eye <-> eye-off).
  window.tbTogglePass = function () {
    var inp = document.getElementById('tbPass');
    var btn = document.getElementById('tbPassEye');
    if (!inp || !btn) return;
    var show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = ic(show ? 'eye-off' : 'eye');
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.setAttribute('title', show ? 'Hide password' : 'Show password');
    inp.focus();
  };
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
        '<label>Password</label>' +
        '<div class="tb-pass-wrap"><input type="password" id="tbPass" autocomplete="current-password">' +
          '<button type="button" class="tb-pass-eye" id="tbPassEye" onclick="tbTogglePass()" aria-label="Show password" title="Show password">' + ic('eye') + '</button>' +
        '</div>' +
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
    var noNav = (document.body.getAttribute('data-nav') || '') === 'none'; // hide the nav row entirely
    var wrap = document.createElement('div');
    wrap.innerHTML = buildToolbarHtml(active, { inApp: false, liveLabel: liveLabel, noNav: noNav });
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

    // Quarter buttons are hardcoded in buildToolbarHtml (Q3 live + Q2), no dynamic fetch needed.
  })();
})();
