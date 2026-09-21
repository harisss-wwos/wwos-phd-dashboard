// Shared live-dashboard navigation + auth control + login modal.
// Used on app.html (via window.PHDNav.buildToolbarHtml) AND on standalone pages (auto-mounted).
//
// Section 1 (top bar): logo + "Q<label> · LIVE" badge on the left; Users (owner-only) + avatar
//   (Login when logged out / Profile when logged in) on the right.
// Section 2 (nav): a single flex row of Shift Report, Agent and Group Analytics,
//   Help Activity, PHD Tools, Unique cases, Users, Database health — role-gated, active highlighted.
//   (My Tickets + Upload live in the top-bar right controls, not the menu.)
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
      + '.tb-hamburger:disabled{opacity:.4;cursor:not-allowed}'
      + '.tb-hamburger:disabled:hover{border-color:#2a2a2a}'
      + '.tb-hamburger:disabled:hover span{background:#d5dbdb}'
      + '.tb-hamburger span{display:block;height:2px;width:100%;background:#d5dbdb;border-radius:2px;transition:background .15s,transform .28s ease,opacity .2s ease}'
      + '.tb-hamburger:hover span{background:#ff9900}'
      // animate to an X when the menu is open
      + '.tb-hamburger[aria-expanded="true"] span:nth-child(1){transform:translateY(6px) rotate(45deg)}'
      + '.tb-hamburger[aria-expanded="true"] span:nth-child(2){opacity:0}'
      + '.tb-hamburger[aria-expanded="true"] span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}'
      + '.tb-logo{display:flex;align-items:center;gap:10px;text-decoration:none}'
      + '.tb-logo img{height:28px;width:auto;display:block}'
      + '.tb-logo span{font-size:1.12em;font-weight:700;color:#fff;line-height:1}'
      // logo acts as a Home button on every page (-> index.html)
      + '.tb-logo-link{display:flex;align-items:center;gap:10px;text-decoration:none;cursor:pointer}'
      + '.tb-qbtn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:transparent;border:1px solid #2a2a2a;color:#d5dbdb;border-radius:6px;font-weight:600;font-size:.82em;cursor:pointer;text-decoration:none;white-space:nowrap;font-family:inherit;margin-left:8px;transition:border-color .15s,color .15s}'
      + '.tb-qbtn:hover{border-color:#ff9900;color:#ff9900}'
      // Quarter + Upload/My-Tickets buttons now live inside the hamburger menu (all sizes) -> hide from the bar
      + '.tb-qbtn,.tb-movable{display:none!important}'
      + '.tb-right{margin-left:auto;display:flex;align-items:center;gap:10px}'
      + '.tb-avatar{display:inline-flex;align-items:center;text-decoration:none}'
      + '.tb-avatar img,.tb-avatar .avatar-initial{border-radius:50%;width:44px!important;height:44px!important}'
      // one combined profile button: name + avatar
      // Profile button: matches the left FAB buttons — same 52px round height + animated gradient.
      + '.tb-profile-btn{display:inline-flex;align-items:center;gap:10px;text-decoration:none;padding:3px 6px 3px 16px;border:1px solid #2a2a2a;border-radius:999px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#e6edf0;max-width:240px;height:52px;transition:border-color .15s,transform .15s}'
      + '.tb-profile-btn:hover{border-color:#ff9900;transform:translateY(-1px)}'
      + '.tb-profile-name{font-size:.85em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}'
      // refresh button spins its icon while a refresh is in flight
      + '.tb-refresh-btn.spinning svg{animation:tbspin .8s linear infinite}'
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
      + '.tb-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:transparent;border:1px solid #2a2a2a;color:#d5dbdb;border-radius:6px;font-weight:600;font-size:.85em;cursor:pointer;text-decoration:none;font-family:inherit;white-space:nowrap}'
      + '.tb-btn:hover{border-color:#ff9900;color:#ff9900}'
      // Disabled top-bar button (shown to everyone, but not accessible): greyed + inert.
      + '.tb-btn-disabled{color:#5f6b6c;background:#101720;border-color:#242e39;cursor:not-allowed;opacity:.7}'
      + '.tb-btn-disabled:hover{color:#5f6b6c;border-color:#242e39}'
      + '.tb-btn svg{flex-shrink:0}'
      // When the bar gets tight, buttons collapse to icon-only (label hidden; title gives the tooltip).
      + '@media(max-width:1024px){.tb-btn .tb-btn-label{display:none}.tb-btn{padding:8px 10px;gap:0}}'
      // login modal
      + '.tb-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3000;display:none;align-items:center;justify-content:center;padding:20px}'
      + '.tb-modal{background:#111;border:1px solid #333;border-radius:12px;width:50vw;max-width:50vw;min-width:min(92vw,420px);padding:28px}'
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
      + '.tb-mbtn.tb-mbtn-danger{background:#ff5252;color:#fff}'
      + '.tb-mbtn.tb-mbtn-danger:hover{background:#e03e3e}'
      // login loader
      + '.tb-loader{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:3200;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px}'
      + '.tb-loader .sp{width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite}'
      + '.tb-loader p{color:#fff;font-weight:600}'
      // The old sticky title bar is retired: navigation lives in the left rail and the profile avatar
      // floats top-right. Hide the bar and drop the top padding pages reserved for it.
      + '.tb-topbar{display:none!important}'
      // Floating top-right control cluster: data-action buttons (Upload / data log) + the profile pill,
      // pinned to the same right edge (22px) as the back button. Laid out right-to-left so the profile
      // sits on the far right and the data actions sit to its left.
      + '.tb-top-right{position:absolute;right:20px;top:10px;z-index:901;display:flex;align-items:center;gap:10px;flex-direction:row}'
      // When moved inside a page header row, the cluster sits statically as the row\'s right-side child.
      + '.tb-top-right.tb-top-right-inrow{position:static;right:auto;top:auto;margin-left:auto}'
      // Universal header row (injected on pages that do not render their own .js-header-row): title on
      // the left, cluster on the right. Same slim style as the app dashboard header.
      + '.tb-header-row{display:flex;align-items:center;gap:14px;min-height:46px;padding:10px 0 0;margin-bottom:10px}'
      + '.tb-header-name{font-size:1.2em;color:#fff;font-weight:700;letter-spacing:.3px;line-height:1}'
      // Profile pill. Round 46px avatar on the right; the name is a label that slides IN from the LEFT
      // on hover. overflow:hidden clips the label until hover; the label sits BEFORE the avatar in the
      // DOM so the pill grows leftward (right edge stays fixed).
      + '.tb-avatar-fab{display:inline-flex;flex-direction:row;align-items:center;justify-content:flex-end;height:46px;max-width:46px;border-radius:23px;background:#0b1420;border:2px solid #2a3f63;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;transition:max-width .28s ease}'
      + '.tb-avatar-fab:hover{max-width:280px}'
      + '.tb-avatar-fab .tb-av-label{white-space:nowrap;font-size:.86em;font-weight:600;color:#e6edf0;opacity:0;padding-left:0;transition:opacity .2s ease,padding-left .2s ease}'
      + '.tb-avatar-fab:hover .tb-av-label{opacity:1;padding-left:16px}'
      + '.tb-avatar-fab .tb-av-ic{flex:0 0 42px;width:42px;height:42px;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}'
      + '.tb-avatar-fab .tb-av-ic img,.tb-avatar-fab .tb-av-ic .avatar-initial{border-radius:50%;width:42px!important;height:42px!important;display:block}'
      + '.tb-avatar-fab.tb-avatar-login{background:#1b2430}'
      + '.tb-avatar-fab.tb-avatar-login .tb-av-ic{color:#ff9900}'
      + '.tb-avatar-fab.tb-avatar-login .tb-av-ic svg{width:20px;height:20px}'
      // Data-action buttons that live to the LEFT of the profile pill (Upload new data / Uploaded data
      // log). Same 46px height as the rail buttons + profile, vertically centered.
      + '.tb-data-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;padding:0 16px;border-radius:23px;background:#141c28;color:#d5dbdb;border:1px solid #2a3f63;box-shadow:0 6px 18px rgba(0,0,0,.35);text-decoration:none;font-family:inherit;font-size:.84em;font-weight:600;white-space:nowrap;cursor:pointer;transition:border-color .15s,color .15s,transform .15s}'
      + '.tb-data-btn:hover{border-color:#ff9900;color:#fff;transform:translateY(-2px)}'
      + '.tb-data-btn svg{width:16px;height:16px;flex-shrink:0}'
      // floating circular back button (bottom-right) — same 46px size as the left rail buttons
      + '.tb-back-fab{position:fixed;right:22px;bottom:22px;z-index:900;width:46px;height:46px;border-radius:50%;background:#ff9900;color:#000;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none}'
      + '.tb-back-fab svg{width:20px;height:20px}'
      // floating circular RECENT-HISTORY button (bottom-left) + its popup of recently visited pages
      + '.tb-hist-fab{position:fixed;left:5px;bottom:18px;z-index:902;height:52px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:26px;background:#1b2430;color:#ff9900;border:1px solid #2a2a2a;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);overflow:hidden;max-width:52px;font-family:inherit;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s}'
      + '.tb-hist-fab .tb-hist-ic{flex:0 0 52px;width:52px;height:52px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-hist-fab .tb-hist-ic svg{width:22px;height:22px}'
      + '.tb-hist-fab .tb-hist-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-hist-fab:hover{max-width:320px;background:#222d3a;border-color:#ff9900;transform:translateY(-2px)}'
      + '.tb-hist-fab:hover .tb-hist-label{opacity:1;padding-right:18px}'
      // Vertically-centered left-edge FAB column: holds Live + Analytics + page-nav FABs (NOT the
      // Recent Activity FAB, which stays pinned to the bottom-left). align-items:flex-start so each
      // pill grows rightward on hover from the same left edge.
      + '.tb-fab-col{position:fixed;left:0;top:0;bottom:0;width:66px;z-index:900;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:8px;padding:14px 10px;overflow:visible;box-sizing:border-box;background:transparent;pointer-events:auto}'
      + '.tb-fab-col>*{pointer-events:auto}'
      // Layout: [66px rail] | 20px gap | content (fills the rest) | 20px right gap.
      // position:relative anchors the (now non-fixed) top-right cluster to the document top-right.
      + 'body{position:relative!important;padding-left:86px!important;padding-right:20px!important;box-sizing:border-box!important}'
      // Shared live animated-gradient background for the FAB buttons — a slow moving sheen so the
      // whole left column feels alive. Applied to nav/analytics/history FABs (Live keeps its green).
      + '@keyframes tbFabGrad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'
      + '.tb-fab-grad{background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite}'
      // Agent & Group Analytics FAB. Circular; expands on hover to reveal its label. Admin-gated
      // disabled state = greyed + inert. Lives inside the centered FAB column.
      + '.tb-an-fab{position:relative;height:46px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:23px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#7fdfff;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:46px;transition:max-width .28s ease,border-color .15s,transform .15s}'
      + '.tb-an-fab .tb-an-ic{flex:0 0 46px;width:46px;height:46px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-an-fab .tb-an-ic svg{width:20px;height:20px}'
      + '.tb-an-fab .tb-an-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-an-fab:hover{max-width:320px;border-color:#44b9d6;transform:translateY(-2px)}'
      + '.tb-an-fab:hover .tb-an-label{opacity:1;padding-right:18px}'
      + '.tb-an-fab.tb-an-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655;cursor:not-allowed;pointer-events:none}'
      // Live-quarter FAB. Blinks to signal "LIVE" and links to the live dashboard (app.html).
      // Expands on hover to reveal the quarter label. Lives inside the centered FAB column.
      + '.tb-live-fab{position:relative;height:46px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:23px;background:#12261a;color:#4ade80;border:1px solid #2f7a4a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:46px;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s;animation:tbLiveGlow 1.6s ease-in-out infinite}'
      + '.tb-live-fab .tb-live-ic{flex:0 0 46px;width:46px;height:46px;display:inline-flex;align-items:center;justify-content:center;position:relative}'
      + '.tb-live-fab .tb-live-dot{width:12px;height:12px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px #4ade80;animation:tbLiveBlink 1s steps(1,end) infinite}'
      + '.tb-live-fab .tb-live-label{white-space:nowrap;font-size:.86em;font-weight:700;letter-spacing:.3px;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-live-fab:hover{max-width:320px;border-color:#4ade80;transform:translateY(-2px)}'
      + '.tb-live-fab:hover .tb-live-label{opacity:1;padding-right:18px}'
      // Disabled (logged out): greyed + inert, and stop the blink/glow so it reads as inactive.
      + '.tb-live-fab.tb-live-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655;cursor:not-allowed;pointer-events:none;animation:none}'
      + '.tb-live-fab.tb-live-disabled .tb-live-dot{background:#8b98a5;box-shadow:none;animation:none}'
      + '@keyframes tbLiveBlink{0%,50%{opacity:1}51%,100%{opacity:.15}}'
      + '@keyframes tbLiveGlow{0%,100%{box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 0 0 rgba(74,222,128,.0)}50%{box-shadow:0 6px 18px rgba(0,0,0,.45),0 0 0 6px rgba(74,222,128,.16)}}'
      // Page-navigation FABs — same expand-on-hover pill. Live inside the centered FAB column.
      + '.tb-nav-fab{position:relative;height:46px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:23px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#e6edf0;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:46px;transition:max-width .28s ease}'
      + '.tb-nav-fab .tb-nav-ic{flex:0 0 46px;width:46px;height:46px;display:inline-flex;align-items:center;justify-content:center;position:relative}'
      + '.tb-nav-fab .tb-nav-ic svg{width:19px;height:19px}'
      // Custom PNG icon (e.g. Unique cases -> important.png). Fit inside the 46px icon slot.
      + '.tb-nav-fab .tb-nav-img{width:22px;height:22px;object-fit:contain;display:block}'
      // The Upload FAB is a <button>; reset the default button chrome so it matches the <a> pills.
      + 'button.tb-nav-fab{font-family:inherit;cursor:pointer;text-align:left}'
      // Upload FAB is highlighted (accent orange) so it stands out as the "add new data" action.
      + '.tb-nav-fab.tb-nav-upload{background:linear-gradient(120deg,#ff9f2e,#f07d0a,#ff9f2e);background-size:220% 220%;animation:tbFabGrad 6s ease infinite;color:#1a1206;border-color:#ffb454}'
      + '.tb-nav-fab.tb-nav-upload .tb-nav-label{color:#1a1206;font-weight:700}'
      + '.tb-nav-fab.tb-nav-upload .tb-nav-ic svg{color:#1a1206}'
      + '.tb-nav-fab.tb-nav-upload.tb-nav-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655}'
      + '.tb-nav-fab.tb-nav-upload.tb-nav-disabled .tb-nav-label,.tb-nav-fab.tb-nav-upload.tb-nav-disabled .tb-nav-ic svg{color:#8b98a5}'
      // Drag-and-drop: grab cursor + a lifted, semi-transparent look while dragging a pill.
      + '.tb-nav-fab{cursor:grab}'
      + '.tb-nav-fab.tb-nav-disabled{cursor:not-allowed}'
      + '.tb-nav-fab.tb-nav-dragging{opacity:.55;cursor:grabbing;max-width:46px!important}'
      + '.tb-nav-fab.tb-nav-dragging .tb-nav-label{opacity:0!important;padding-right:0!important}'
      // ---- Reports fly-out (line-chart group) ----
      // Wrapper is the drop anchor. The trigger is a 46px pill (line-chart) that never expands/drags.
      + '.tb-flyout-wrap{position:relative;display:flex;align-items:center}'
      + '.tb-flyout-fab{position:relative;height:46px;width:46px;flex:0 0 46px;display:inline-flex;align-items:center;justify-content:center;border-radius:23px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#e6edf0;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);cursor:pointer}'
      + '.tb-flyout-fab .tb-nav-ic{flex:0 0 46px;width:46px;height:46px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-flyout-fab .tb-nav-ic svg{width:19px;height:19px}'
      + '.tb-flyout-wrap:hover .tb-flyout-fab{border-color:#ff9900;color:#fff}'
      // The horizontal fly-out row: sits to the RIGHT of the trigger, hidden until the wrapper is hovered.
      // It slides in (translateX) and reveals the report pills. gap between the 4 pills.
      + '.tb-flyout{position:absolute;left:46px;top:50%;transform:translateY(-50%) translateX(-8px);display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding-left:14px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease,transform .22s ease;z-index:905}'
      // Invisible bridge so moving the cursor from the trigger to the items never crosses a dead gap.
      + '.tb-flyout::before{content:"";position:absolute;left:0;top:0;bottom:0;width:16px}'
      + '.tb-flyout-wrap:hover .tb-flyout,.tb-flyout:hover{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(-50%) translateX(0)}'
      // Each fly-out pill is a normal expand-on-hover nav pill (label slides right on its own hover).
      + '.tb-flyout-item{flex:0 0 auto}'
      // Count badge (e.g. open alerts) pinned to the top-right of the FAB icon.
      + '.tb-nav-badge{display:none;position:absolute;top:6px;right:6px;min-width:17px;height:17px;padding:0 4px;border-radius:20px;background:#ff5252;color:#fff;font-size:.62em;font-weight:800;line-height:17px;text-align:center;box-shadow:0 0 0 2px #1b2430}'
      + '.tb-nav-badge.show{display:block}'
      + '.tb-nav-badge.zero{background:#3a4655;color:#cdd7de}'
      + '.tb-nav-fab .tb-nav-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-nav-fab:hover{max-width:340px}'
      + '.tb-nav-fab:hover .tb-nav-label{opacity:1;padding-right:18px}'
      + '.tb-nav-fab.tb-nav-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655;cursor:not-allowed;pointer-events:none}'
      // On short screens shrink the FAB column (smaller pills + tighter gap) so it still fits centered.
      + '@media(max-height:820px){.tb-fab-col{gap:6px}.tb-nav-fab,.tb-live-fab,.tb-an-fab{height:40px;max-width:40px;border-radius:20px}.tb-nav-fab .tb-nav-ic,.tb-an-fab .tb-an-ic,.tb-live-fab .tb-live-ic{flex-basis:40px;width:40px;height:40px}.tb-nav-fab .tb-nav-ic svg,.tb-an-fab .tb-an-ic svg{width:18px;height:18px}.tb-hist-fab{height:40px}.tb-hist-fab .tb-hist-ic{flex-basis:40px;width:40px;height:40px}}'
      + '.tb-hist-pop{position:fixed;left:22px;bottom:84px;z-index:901;width:280px;max-width:calc(100vw - 44px);max-height:min(70vh,560px);overflow-y:auto;background:#121820;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.55);padding:8px;display:none;flex-direction:column;gap:2px}'
      + '.tb-hist-pop.open{display:flex}'
      + '.tb-hist-title{color:#879596;font-size:.72em;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:6px 10px 8px;position:sticky;top:-8px;background:#121820}'
      + '.tb-hist-item{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:8px;color:#d5dbdb;text-decoration:none;font-size:.86em;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.tb-hist-item:hover{background:#1b2430;color:#fff}'
      + '.tb-hist-item svg{width:15px;height:15px;flex-shrink:0;color:#879596}'
      + '.tb-hist-item .tb-hist-name{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}'
      + '.tb-hist-current{background:#1a2430;color:#fff}'
      + '.tb-hist-current svg{color:#ff9900}'
      + '.tb-hist-badge{flex-shrink:0;font-size:.62em;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#ff9900;background:rgba(255,153,0,.14);border:1px solid rgba(255,153,0,.4);border-radius:20px;padding:2px 7px}'
      + '.tb-hist-empty{color:#5f6b6c;font-size:.82em;font-style:italic;padding:8px 10px}'
      // ---- Home-page MENU fab (bottom-RIGHT; history fab is bottom-left) + its nav popup ----
      + '.tb-menu-fab{position:fixed;right:22px;bottom:22px;z-index:900;width:52px;height:52px;border-radius:50%;background:#1b2430;color:#ff9900;border:1px solid #2a2a2a;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);transition:transform .15s,background .15s,border-color .15s}'
      + '.tb-menu-fab:hover{background:#222d3a;border-color:#ff9900;transform:translateY(-2px)}'
      + '.tb-menu-fab svg{width:22px;height:22px}'
      + '.tb-menu-pop{position:fixed;right:22px;bottom:84px;z-index:901;width:280px;max-width:calc(100vw - 44px);max-height:min(70vh,560px);overflow-y:auto;background:#121820;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.55);padding:8px;display:none;flex-direction:column;gap:2px}'
      + '.tb-menu-pop.open{display:flex}'
      // Menu-item links inside the home MENU popup (left-aligned list, like the history popup).
      + '.tb-menu-pop .tb-menuitem{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:8px;color:#d5dbdb;text-decoration:none;font-size:.86em;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:transparent;border:none;font-family:inherit;width:100%}'
      + '.tb-menu-pop .tb-menuitem:hover{background:#1b2430;color:#fff}'
      + '.tb-menu-pop .tb-menuitem.active{background:#1a2430;color:#ff9900}'
      + '.tb-menu-pop .tb-menuitem svg{width:15px;height:15px;flex-shrink:0;color:#879596}'
      + '.tb-menu-pop .tb-menu-label{display:none}'
      // Disabled FAB (logged out): clearly VISIBLE but muted + not clickable. Popups stay closed.
      + '.tb-fab-disabled{cursor:not-allowed;background:#232d3a;color:#8b98a5;border:1px solid #3a4655;box-shadow:0 4px 12px rgba(0,0,0,.4)}'
      + '.tb-fab-disabled:hover{background:#232d3a;border-color:#3a4655;transform:none}'
      // ---- "Refreshing cached data" banner (just under the top bar; slides in) ----
      // Refresh button loading state: icon spins + turns green, label reads "Refreshing…".
      + '.tb-refresh-btn.refreshing{color:#4ade80;border-color:rgba(74,222,128,.5)}'
      + '.tb-refresh-btn.refreshing svg{color:#4ade80}'
      // ---- Shared responsive guard (kills x-axis scroll; applies on every page) ----
      // NOTE: use overflow-x:clip (NOT hidden). `hidden` makes html/body a scroll container, which
      // breaks `position:sticky` on the top bar (it detaches on scroll, leaving an empty gap where
      // the hamburger/profile were while the fixed menu stays). `clip` prevents x-overflow the same
      // way but does NOT create a scroll container, so sticky keeps working.
      + 'html,body{max-width:100%;overflow-x:clip}'
      + '*{box-sizing:border-box}'
      // App-wide: any disabled control shows the not-allowed cursor. Covers native [disabled],
      // aria-disabled, and the app\'s disabled-state classes. Applied on every page (this stylesheet
      // is injected everywhere). Use pointer-events:auto so the cursor is actually visible on hover.
      + 'button[disabled],input[disabled],select[disabled],textarea[disabled],fieldset[disabled],'
      + '[aria-disabled="true"],.disabled,.tb-nav-disabled,.tb-btn-disabled,.tb-live-disabled,.tb-an-disabled'
      + '{cursor:not-allowed!important}'
      // The rail/toolbar FABs previously set pointer-events:none (which hides the cursor). They are
      // already inert when disabled (no href / no onclick / aria-disabled), so re-enabling pointer
      // events here just lets the not-allowed cursor show without making them actionable. NOTE: this
      // deliberately excludes generic .disabled / index cards, which rely on pointer-events:none.
      + '.tb-nav-disabled,.tb-btn-disabled,.tb-live-disabled,.tb-an-disabled{pointer-events:auto!important}'
      + 'img,svg,canvas,video{max-width:100%;height:auto}'
      + 'pre{max-width:100%;overflow-x:auto;white-space:pre-wrap;word-break:break-word}'
      // any data table sits in a scroll container instead of pushing the page wider
      + '.tbl-card{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}'
      + 'table{max-width:100%}'
      // Layout: [rail] | 20px | content (full remaining width) | 20px. The body handles the rail
      // offset + side gaps (padding-left 86px, padding-right 20px), so the content wrappers just fill
      // the space edge-to-edge: drop their max-width caps and auto side margins.
      // Fill the content area edge-to-edge (drop max-width caps + auto side margins + side padding),
      // and zero the TOP padding so the ONLY top gap comes from the header row (padding-top:10px +
      // margin-bottom:10px). This makes the header->content gap identical on every page. Bottom
      // padding is preserved for breathing room at the end of the page.
      + '.content,.wrap{max-width:none!important;width:auto!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;padding-top:0!important}'
      // Every header row (page-provided .dash-title-row/.home-title-row or the injected .tb-header-row)
      // gets the SAME top+bottom spacing so the gap to content matches everywhere.
      + '.js-header-row{padding-top:10px!important;margin-bottom:10px!important;margin-top:0!important}'
      + '@media(max-width:920px){'
        + '.tb-topbar{padding:10px 12px;gap:8px;flex-wrap:wrap}'
        + '.tb-logo{flex-wrap:wrap;gap:6px}'
        + '.tb-logo span{font-size:.95em}'
        + '.tb-logo img{height:24px}'
        // let the logo/title take the top row with the hamburger + avatar; buttons wrap to next row
        + '.tb-right{gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto}'
        + '.tb-btn,.tb-qbtn{padding:6px 10px;font-size:.76em;gap:4px}'
        + '.tb-menu{left:0;right:0;top:52px}'
        + '.tb-avatar img,.tb-avatar .avatar-initial{width:36px!important;height:36px!important}'
        + '.tb-profile-btn{height:44px;padding:3px 5px 3px 12px}'
        // page wrappers: full width (body still provides the rail offset + 20px gaps).
        + '.wrap{width:auto!important;max-width:100%!important;margin:0!important;padding:20px 0!important}'
        + '.tools-subnav{padding-left:0!important}'
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
    // Each .tb-btn carries a `title` so it stays meaningful when it collapses to icon-only on
    // narrow screens (see the responsive rule that hides .tb-btn-label).
    // Upload new data (admin+, standalone pages only). On the live dashboard (app.html) the Upload
    // button lives in the page-title row between Alerts and Uploaded data log, so it's omitted here.
    // Upload new data — gated by the per-user canUpload flag (owner always allowed). Standalone pages only.
    var canUpload = A.canUpload && A.canUpload();
    var canManageUsers = A.canManageUsers && A.canManageUsers();
    if (canUpload && !inApp) {
      html += '<button type="button" class="tb-btn tb-movable" title="Upload new data" onclick="tbUploadIntro(\'standalone\')">' + ic('upload') + '<span class="tb-btn-label"> Upload new data</span></button><input type="file" accept=".csv" id="uploadFileStandalone" style="display:none">';
    }
    // My Tickets (logged-in). On the live dashboard (app.html) it lives in the page-title row next to
    // Alerts / Upload / Uploaded data log, so it's omitted here to avoid a duplicate.
    if (li && !inApp) html += '<a class="tb-btn tb-movable" href="my-tickets.html" title="My Tickets">' + ic('ticket') + '<span class="tb-btn-label"> My Tickets</span></a>';
    // Users + Database health are shown to EVERY logged-in user, but only enabled for those allowed.
    // Users -> canManageUsers flag; Database health -> canDatabase flag (owner always). Others see a disabled (greyed) button.
    var canDatabase = A.canDatabase && A.canDatabase();
    if (li) {
      if (canManageUsers) html += '<a class="tb-btn" href="users.html" title="Users">' + ic('users-gear') + '<span class="tb-btn-label"> Users</span></a>';
      else html += '<span class="tb-btn tb-btn-disabled" title="You do not have access to manage users." aria-disabled="true">' + ic('users-gear') + '<span class="tb-btn-label"> Users</span></span>';
      if (canDatabase) html += '<a class="tb-btn" href="db-health.html" title="Database health">' + ic('database') + '<span class="tb-btn-label"> Database health</span></a>';
      else html += '<span class="tb-btn tb-btn-disabled" title="You do not have access to Database health." aria-disabled="true">' + ic('database') + '<span class="tb-btn-label"> Database health</span></span>';
    }
    // (Refresh button removed from the top bar per design.)
    if (!li) {
      html += '<button class="tb-btn" onclick="tbOpenLogin()">' + ic('key') + ' Login</button>';
    } else {
      var prof = (A.myProfile && A.myProfile()) || A.getUser();
      // One profile button: display name (or Login ID if none) + avatar. Links to the profile page.
      var name = (prof && (prof.displayName || prof.username)) || 'Profile';
      var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
      html += '<a class="tb-profile-btn" href="profile.html" title="' + esc(name) + ' — Profile">'
        + '<span class="tb-profile-name">' + esc(name) + '</span>'
        + '<span class="tb-avatar">' + (A.avatarHtml ? A.avatarHtml(prof, 44) : '') + '</span>'
        + '</a>';
    }
    return html;
  }

  // ---- Hamburger menu contents (role-gated). Rendered inside the collapsible dropdown. ----
  // active: one of 'groups','previous-week','shift-report','last24',
  //   'help-activity','tools','unique-cases','users' (or '' for none).
  // inApp: true inside app.html (view buttons call nav()); false = standalone (links to app.html?view=).
  function navHtml(active, inApp) {
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    var isOwner = atLeast('owner');
    var hideAttr = (document.body.getAttribute('data-nav-hide') || '').toLowerCase();
    var hide = {}; hideAttr.split(',').forEach(function (k) { k = k.trim(); if (k) hide[k] = true; });
    // Groups / Shift Report / Previous Week are dashboard views. Render them as real anchor links
    // (app.html?view=key) on EVERY page — including inside app.html — so they support right-click /
    // "open in new tab" and shareable URLs like every other menu item. app.js reads ?view= on load.
    function view(key, lbl, icon) {
      var cls = 'tb-menuitem' + (active === key ? ' active' : '');
      var href = 'app.html?view=' + key;
      return '<a class="' + cls + '" href="' + href + '">' + ic(icon) + ' ' + lbl + '</a>';
    }
    function link(key, lbl, icon, href) {
      var cls = 'tb-menuitem' + (active === key ? ' active' : '');
      return '<a class="' + cls + '" href="' + href + '">' + ic(icon) + ' ' + lbl + '</a>';
    }
    var html = '';
    // The page-navigation links now live in the bottom-left FAB stack (buildNavFabs). The menu
    // dropdown is intentionally trimmed to just the two owner-only admin destinations.
    html += '<div class="tb-menu-label">Navigate</div>';
    if (A.canManageUsers && A.canManageUsers()) html += link('users', 'Users', 'users-gear', 'users.html');
    if (A.canDatabase && A.canDatabase()) html += link('db-health', 'Database health', 'database', 'db-health.html');
    return html;
  }

  // ---- Public: build the whole toolbar HTML (Section 1 + Section 2) ----
  // Used by app.html's topBar(). liveLabel e.g. "Q3 2026".
  function buildToolbarHtml(active, opts) {
    opts = opts || {};
    // Hardcoded quarter buttons (regular button look): Q3 live + Q2 report.
    var live = '<a class="tb-qbtn" href="app.html" title="Go to the live dashboard">Q3 2026 · LIVE</a>'
      + '<a class="tb-qbtn" href="archive.html?ds=quarter&qid=2026-Q2" title="Q2 2026 report">Q2 2026</a>';
    // Hamburger menu removed: navigation lives in the left FAB stack + top-right controls now.
    return ''
      + '<div class="tb-topbar">'
        + '<span class="tb-logo"><a class="tb-logo-link" href="index.html" title="Home"><img src="gsoc-logo.svg" alt="GSOC"><span>WWOS-GSOC PHD</span></a>' + live + '</span>'
        + '<div class="tb-right" id="tbAuth">' + rightControlsHtml() + '</div>'
      + '</div>';
  }

  // ---- Hamburger menu removed: keep no-op stubs so any stray onclick references don't error. ----
  window.tbToggleMenu = function () {};
  window.tbCloseMenu = function () {};
  // (No hamburger close-on-outside-click listener needed anymore.)
  document.addEventListener('click', function (e) {
    var m = document.getElementById('tbMenu'); if (!m || !m.classList.contains('open')) return;
    var h = document.getElementById('tbHamburger');
    if (m.contains(e.target) || (h && h.contains(e.target))) return;
    tbCloseMenu();
  });

  window.PHDNav = {
    buildToolbarHtml: buildToolbarHtml,
    rightControlsHtml: rightControlsHtml,
    refreshRight: function () { var s = document.getElementById('tbAuth'); if (s) s.innerHTML = rightControlsHtml(); paintProfileAvatar(); }
  };

  // Refresh button: fetch the latest data on demand. On the live dashboard it refreshes in place
  // (PHDRefreshLive re-pulls the live quarter); on other pages it reloads so the page re-runs its
  // own data load. Spins the icon briefly for feedback.
  // Put the refresh button into its loading state: spin + green icon, label -> "Refreshing…".
  function _refreshBtnStart(btn) {
    if (!btn) return;
    btn.classList.add('spinning', 'refreshing');
    var lbl = btn.querySelector('.tb-btn-label');
    if (lbl) { if (!btn._origLabel) btn._origLabel = lbl.textContent; lbl.textContent = ' Refreshing\u2026'; }
  }
  function _refreshBtnStop(btn) {
    if (!btn) return;
    btn.classList.remove('spinning', 'refreshing');
    var lbl = btn.querySelector('.tb-btn-label');
    if (lbl && btn._origLabel) lbl.textContent = btn._origLabel;
  }
  window.tbRefreshData = async function (btn) {
    try { _refreshBtnStart(btn); } catch (e) {}
    try {
      // Version-check first (a vs b): only do the heavy refresh if a new upload happened.
      var a = (A && A.liveVersion) ? await A.liveVersion() : null;   // live version (a)
      var b = null;                                                  // our cached version (b)
      try { if (window.PHDGetCachedVersion) b = await window.PHDGetCachedVersion(); } catch (e) {}
      if (a && b && a === b) {
        // Already current — no heavy fetch. The spinning icon already signalled the check.
        _refreshBtnStop(btn);
        return;
      }
      // New data (or can't tell) -> fetch it.
      if (typeof window.PHDRefreshLive === 'function') {
        await window.PHDRefreshLive();               // in-place refresh on the live dashboard
        _refreshBtnStop(btn);
      } else {
        location.reload();                            // other pages: reload to re-fetch (version-first init handles the rest)
      }
    } catch (e) {
      _refreshBtnStop(btn);
    }
  };

  // ---- Refresh feedback (banner removed) ----
  // The old "refreshing cached data" banner under the top bar has been removed. Refresh feedback
  // now lives entirely on the Refresh button (spinning green icon + "Refreshing…" label).
  // PHDRefreshBanner is kept as a no-op so existing callers (e.g. my-tickets) don't break.
  (function () {
    var noop = function () {};
    window.PHDRefreshBanner = { show: noop, updated: noop, upToDate: noop, hide: noop };
  })();

  // Full-page loader (reuses .tb-loader). msg optional.
  window.tbShowLoader = function (msg) {
    var l = document.getElementById('tbLoader');
    if (!l) return;
    var p = l.querySelector('p'); if (p && msg) p.textContent = msg;
    l.style.display = 'flex';
  };
  window.tbHideLoader = function () { var l = document.getElementById('tbLoader'); if (l) l.style.display = 'none'; };

  // Required CSV columns (kept in sync with app.js REQUIRED_COLUMNS). Standalone upload validates here.
  // All columns are mandatory (upload blocked unless every one is present). Alphabetical order;
  // columns added beyond the original 18 are tagged "new". Kept in sync with app.js REQUIRED_COLUMNS.
  var TB_REQUIRED_COLUMNS = ['Age','AssignedGroup','AssigneeIdentity','ClosureCode','CreateDate','IssueId','IssueUrl','Labels','LastAssignedDate','LastUpdatedConversationDate','LastUpdatedDate','RequesterIdentity','ResolvedByIdentity','ResolvedDate','RootCause','RootCauseDetails','Severity','ShortId','Status','Tags','Title'];
  var TB_NEW_COLUMNS = { 'Labels': true, 'RequesterIdentity': true, 'Tags': true };
  function tbNewTag(c) { return TB_NEW_COLUMNS[c] ? ' <span style="background:#fbbf24;color:#000;font-size:.66em;font-weight:800;padding:1px 6px;border-radius:9px;text-transform:uppercase;letter-spacing:.4px;vertical-align:middle">new</span>' : ''; }
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
  // Pre-upload intro popup: lists every mandatory column (alphabetical, "new" ones tagged);
  // Proceed opens the file picker.
  window.tbUploadIntro = function (target) {
    var inputId = (target === 'standalone') ? 'uploadFileStandalone' : 'uploadFile';
    var listHtml = TB_REQUIRED_COLUMNS.map(function (c) {
      return '<li style="padding:3px 0;color:#d5dbdb"><span style="color:#4ade80">•</span> <span style="font-family:monospace;font-size:.9em">' + c + '</span>' + tbNewTag(c) + '</li>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'tbUploadIntro';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3400;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px">' +
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
      return '<li style="display:flex;align-items:center;gap:8px;padding:4px 0;color:' + (bad ? '#ff5252' : '#4ade80') + '">' + (bad ? '✗' : '✓') + ' <span style="font-family:monospace;font-size:.9em">' + c + '</span>' + tbNewTag(c) + (bad ? ' <span style="color:#ff5252;font-size:.78em">(missing)</span>' : '') + '</li>';
    }).join('');
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:3400;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px">' +
      '<h2 style="color:#ff5252;font-size:1.2em;margin-bottom:6px">Upload blocked — missing required columns</h2>' +
      '<p style="color:#879596;font-size:.9em;margin-bottom:14px">The file is missing <b style="color:#ff5252">' + missing.length + '</b> required column' + (missing.length === 1 ? '' : 's') + '. All ' + TB_REQUIRED_COLUMNS.length + ' columns below are mandatory. Fix the export and try again — <b>no data was uploaded</b>.</p>' +
      '<ul style="list-style:none;padding:0;margin:0;columns:2;column-gap:24px">' + listHtml + '</ul>' +
      '<div style="margin-top:20px;text-align:right"><button class="tb-mbtn" onclick="this.closest(\'div[style*=fixed]\').remove()">Close</button></div>' +
      '</div>';
    document.body.appendChild(ov);
  }

  // ---- In-place "Upload new data" pipeline (runs on ANY page; the page is retained) ----
  // Fields whose change (on a ticket with a newer LastUpdatedDate) triggers an update.
  var TB_MERGE_FIELDS = ['Title','Status','Severity','AssigneeIdentity','ResolvedDate','Age','ClosureCode','ResolvedByIdentity','RootCause','RootCauseDetails','Labels','RequesterIdentity','Tags'];
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
    // Capture file metadata (name/size/type) up front — recorded on the upload log.
    var fileMeta = { fileName: file.name || '', fileSize: file.size || 0, fileType: file.type || '' };
    var reader = new FileReader();
    reader.onload = function (ev) { tbBeginUpload(String(ev.target.result || ''), fileMeta); };
    reader.onerror = function () { window.PHDAlert({ title: 'Could not read file', body: 'Could not read the file.' }); };
    reader.readAsText(file);
  });

  // Format a seconds count as "Xm Ys" (or "Ys" under a minute) for the total-time readout.
  function tbFmtDuration(secs) {
    secs = Math.max(0, secs | 0);
    if (secs < 60) return secs + ' sec';
    var m = Math.floor(secs / 60), s = secs % 60;
    return m + ' min' + (s ? ' ' + s + ' sec' : '');
  }

  // Rotating lines for the SAVE (delta publish) step — shown one every 30s while writing.
  function tbSaveMessages(zNew, yUpdated) {
    return [
      'Sending ' + ((zNew || 0) + (yUpdated || 0)).toLocaleString() + ' changes to the shared database…',
      'Writing the updated tickets — only the changes, not the whole quarter…',
      'Refreshing the dashboard rollups so everyone sees the new numbers…',
      'Almost done — committing the changes…',
      'Thanks for waiting — finalising the save…',
    ];
  }

  // Rotating "keep the user engaged" lines shown one every 30s during the (slow) live-data fetch.
  // Ordered so each appears once; the last one holds until the response arrives.
  function tbEngageMessages(fileRows) {
    return [
      'Comparing your ' + (fileRows ? fileRows.toLocaleString() + ' rows' : 'file') + ' against the live database…',
      'Downloading the current live dataset (it\u2019s a large quarter)…',
      'Matching tickets by ID and checking which fields changed…',
      'Almost there — tallying new tickets and field updates…',
      'Thanks for your patience — finalising the assessment…',
      'Still working — large uploads can take a couple of minutes…',
    ];
  }

  // Wind a countdown element's number down from `from` to 0 (quick, ~40ms/step) so it lands cleanly.
  async function tbCountdownToZero(from, elId) {
    var el = document.getElementById(elId);
    var n = Math.max(0, from | 0);
    while (n > 0) {
      n -= 1;
      if (el) el.textContent = String(n);
      await new Promise(function (r) { setTimeout(r, 40); });
    }
  }

  // Step A: validate columns, then assess.
  function tbBeginUpload(csvText, fileMeta) {
    var missing = tbMissingColumns(csvText);
    if (missing.length) { tbShowColumnError(missing); return; }
    tbAssessAborted = false;
    tbFlowOverlay('tbAssess',
      '<div style="text-align:center;width:90vw;max-width:90vw;min-width:300px">' +
        '<div class="sp" style="width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite;margin:0 auto"></div>' +
        '<p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600" id="tbAssessTitle">Reading the file…</p>' +
        '<p style="color:#879596;margin-top:6px;font-size:.9em" id="tbAssessSub">The data file is being processed, Please wait...</p>' +
        // Progress bar + ticket ticker (shown while the live data loads).
        '<div id="tbAssessTimerWrap" style="display:none;margin-top:20px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="flex:1;height:10px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;overflow:hidden">' +
              '<div id="tbAssessBar" style="height:100%;width:0%;background:linear-gradient(90deg,#4ade80,#22c55e);border-radius:20px;transition:width .35s ease"></div>' +
            '</div>' +
            '<div id="tbAssessPct" style="font-size:.95em;font-weight:800;color:#4ade80;min-width:44px;text-align:right;font-variant-numeric:tabular-nums">0%</div>' +
          '</div>' +
          '<p id="tbAssessTicker" style="color:#5ecdec;margin-top:14px;font-size:.9em;font-weight:700;letter-spacing:.4px;font-family:monospace;min-height:1.2em;transition:opacity .15s">&nbsp;</p>' +
          '<p style="color:#5f6b6c;margin-top:2px;font-size:.72em">Scanning all the tickets…</p>' +
        '</div>' +
        '<button class="tb-mbtn sec" id="tbAssessCancel" style="margin-top:18px">Cancel</button>' +
      '</div>');
    document.getElementById('tbAssessCancel').onclick = function () { tbAssessAborted = true; tbRemove('tbAssess'); };
    // Defer so the spinner paints before the (sync) parse + fetch.
    setTimeout(function () { tbAssess(csvText, fileMeta); }, 40);
  }

  // Step B: parse + compare LastUpdatedDate vs stored; build the delta; show the confirm popup.
  async function tbAssess(csvText, fileMeta) {
    var rows;
    try { rows = tbParseCSV(csvText).filter(function (r) { return r.ShortId || r.IssueId; }).map(function (r) { if (!r.ShortId && r.IssueId) r.ShortId = r.IssueId; return r; }); }
    catch (err) { tbRemove('tbAssess'); window.PHDAlert({ title: 'Invalid CSV', body: 'Could not read the CSV file.' }); return; }
    if (!rows.length) { tbRemove('tbAssess'); window.PHDAlert({ title: 'No tickets found', body: 'No tickets with a ShortId/IssueId were found in the file.' }); return; }

    // Parsed the file — show the processing message + progress bar, then fetch the live dataset.
    (function () {
      var t = document.getElementById('tbAssessTitle'); if (t) t.textContent = 'Processing…';
      var s = document.getElementById('tbAssessSub'); if (s) s.textContent = 'The data file is being processed, Please wait...';
      var w = document.getElementById('tbAssessTimerWrap'); if (w) w.style.display = 'block';
    })();
    var _t0 = Date.now();                                     // for the total-time readout
    // Progress bar staging (~2 min 19 s of runway before it parks at 98%):
    //   0->60% @1.25s/step (75s), 60->80% @1.5s (30s), 80->90% @1.75s (17.5s), 90->98% @2s (16s).
    // Each stage swaps the sub-line message; at 98% it holds and rotates "almost done" every 3s.
    var _barEl = document.getElementById('tbAssessBar');
    var _pctEl = document.getElementById('tbAssessPct');
    var _msgEl = document.getElementById('tbAssessSub');       // reuse the sub-line for stage messages
    var _pct = 0;
    var _setPct = function (p) { _pct = p; if (_barEl) _barEl.style.width = p + '%'; if (_pctEl) _pctEl.textContent = p + '%'; };
    var _setMsg = function (m) { if (_msgEl) _msgEl.textContent = m; };
    // Per-stage: [ceiling %, sec/step, message-shown-when-entering-this-stage].
    var _stages = [
      { to: 60, delay: 1250, msg: 'Tickets are being processed…' },
      { to: 80, delay: 1500, msg: 'Apologies for the delay, still processing…' },
      { to: 90, delay: 1750, msg: 'Seems like it\u2019s taking longer than expected, apologies…' },
      { to: 98, delay: 2000, msg: 'The processing is almost done…' },
    ];
    // "Almost done" reassurance lines rotated (every 3s) once the bar holds at 98%.
    var _almostMsgs = [
      'Almost done — finalising the assessment…',
      'Nearly there, we promise — just wrapping up…',
      'Hang tight — any moment now…',
      'Thanks for your patience — almost there…',
    ];
    var _almostIdx = 0;
    var _almostTimer = null;
    var _progTimer = null;
    var _stageShown = -1;
    var _scheduleProg = function () {
      // Find the active stage for the current %.
      var si = 0; while (si < _stages.length && _pct >= _stages[si].to) si++;
      if (si >= _stages.length) {
        // Reached 98% — hold and rotate the "almost done" line every 3s until data arrives.
        if (!_almostTimer) {
          _setMsg(_almostMsgs[_almostIdx++ % _almostMsgs.length]);
          _almostTimer = setInterval(function () { _setMsg(_almostMsgs[_almostIdx++ % _almostMsgs.length]); }, 3000);
        }
        return;
      }
      if (si !== _stageShown) { _setMsg(_stages[si].msg); _stageShown = si; }  // announce the stage
      _progTimer = setTimeout(function () { _setPct(_pct + 1); _scheduleProg(); }, _stages[si].delay);
    };
    _setMsg(_stages[0].msg); _stageShown = 0;
    _scheduleProg();
    // Ticket ticker: a fresh random ShortId every 500ms (2 per second) to keep the user engaged.
    var _tickerEl = document.getElementById('tbAssessTicker');
    var _randTicket = function () { var s = ''; for (var i = 0; i < 10; i++) s += Math.floor(Math.random() * 10); return 'V' + s; };
    var _ticker = setInterval(function () {
      if (!_tickerEl) return;
      _tickerEl.style.opacity = '0';
      setTimeout(function () { _tickerEl.textContent = _randTicket(); _tickerEl.style.opacity = '1'; }, 90);
    }, 500);
    if (_tickerEl) _tickerEl.textContent = _randTicket();
    // Fetch the current live-quarter dataset to compare against. Cache-bust so the browser can't
    // answer with a 304 (empty body) — we need the full ticket payload to run the comparison.
    var live;
    try { live = await A.api('GET', '/api/live-quarter?ts=' + Date.now()); } catch (e) { live = null; }
    clearTimeout(_progTimer); clearInterval(_ticker);         // data is here — stop the animations
    if (_almostTimer) clearInterval(_almostTimer);
    var _assessSecs = Math.round((Date.now() - _t0) / 1000);  // total time this fetch+compare took
    // Data arrived — fill the bar straight to 100%.
    _setPct(100);
    _setMsg('Done — preparing your results…');
    if (_tickerEl) _tickerEl.textContent = 'Done';
    await new Promise(function (r) { setTimeout(r, 400); });  // brief beat so 100% is visible
    (function () { var w = document.getElementById('tbAssessTimerWrap'); if (w) w.style.display = 'none'; })();
    if (tbAssessAborted) return;
    if (!live || !live.ok || !live.data) { tbRemove('tbAssess'); window.PHDAlert({ title: 'Could not load data', body: 'Could not load the live dataset to compare. Try again.' }); return; }
    var liveQ = live.data.quarter;
    var storedTix = (live.data.data && live.data.data.tickets) || [];
    var storedMap = {}; storedTix.forEach(function (t) { var id = String(t.ShortId || t.IssueId || ''); if (id) storedMap[id] = t; });

    // Split rows into live-quarter vs non-live (past quarters merged server-side by ShortId).
    var changed = [];    // live tickets to write (field changes) OR new live tickets
    var nonLive = [];
    var xNewer = 0, yUpdated = 0, zNew = 0;
    var lud = function (v) { var d = new Date(v); return isNaN(d) ? null : d.getTime(); };

    // Compare each file row against the stored live data (fast, synchronous — no progress loader).
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
    tbShowConfirm({ xNewer: xNewer, yUpdated: yUpdated, zNew: zNew, changed: changed, nonLive: nonLive, liveQ: liveQ, fileMeta: fileMeta || {}, assessSecs: _assessSecs });
  }

  // Step C: confirmation popup with the counts. On confirm -> delta publish.
  function tbShowConfirm(res) {
    // No newer data at all (0 tickets with a changed LastUpdatedDate) and no new tickets/past-quarter
    // rows -> tell the user there are no new changes and let them close the upload.
    if (res.xNewer === 0 && res.zNew === 0 && res.nonLive.length === 0) {
      tbFlowOverlay('tbConfirm',
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;padding:26px;text-align:center">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#fff;font-size:1.2em;margin:8px 0 8px">No new changes</h2>' +
          '<p style="color:#879596;font-size:.92em;line-height:1.6">No ticket in this file has a newer <b style="color:#d5dbdb">LastUpdatedDate</b> than what\'s already live, and there are no new tickets. Nothing needs to be uploaded.</p>' +
          '<div style="margin-top:22px"><button class="tb-mbtn" id="tbConfirmClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbConfirmClose').onclick = function () { tbRemove('tbConfirm'); };
      return;
    }
    tbFlowOverlay('tbConfirm',
      '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;padding:26px">' +
        '<h2 style="color:#fff;font-size:1.2em;margin-bottom:12px">Assessment complete</h2>' +
        '<div style="background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;padding:6px 16px">' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #2a2a2a"><span style="color:#879596">Tickets with newer data</span><span style="color:#44b9d6;font-weight:700">' + res.xNewer + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #2a2a2a"><span style="color:#879596">Will be updated (field changes)</span><span style="color:#fbbf24;font-weight:700">' + res.yUpdated + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0"><span style="color:#879596">New tickets to add</span><span style="color:#4ade80;font-weight:700">' + res.zNew + '</span></div>' +
        '</div>' +
        (res.assessSecs != null ? ('<p style="color:#5f6b6c;font-size:.78em;margin-top:10px;text-align:center">Fetch &amp; compare took ' + tbFmtDuration(res.assessSecs) + '</p>') : '') +
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
      '<div style="text-align:center;width:90vw;max-width:90vw;min-width:300px">' +
        '<div class="sp" style="width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite;margin:0 auto"></div>' +
        '<p style="color:#fff;margin-top:20px;font-size:1.1em;font-weight:600">New data is being pushed…</p>' +
        '<p style="color:#879596;margin-top:8px;font-size:.9em" id="tbPushSub">Saving to the shared database. This may take a moment.</p>' +
        '<div style="margin-top:20px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="flex:1;height:10px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:20px;overflow:hidden">' +
              '<div id="tbPushBar" style="height:100%;width:0%;background:linear-gradient(90deg,#4ade80,#22c55e);border-radius:20px;transition:width .35s ease"></div>' +
            '</div>' +
            '<div id="tbPushPct" style="font-size:.95em;font-weight:800;color:#4ade80;min-width:44px;text-align:right;font-variant-numeric:tabular-nums">0%</div>' +
          '</div>' +
          '<p id="tbPushTicker" style="color:#5ecdec;margin-top:14px;font-size:.9em;font-weight:700;letter-spacing:.4px;font-family:monospace;min-height:1.2em;transition:opacity .15s">&nbsp;</p>' +
          '<p style="color:#5f6b6c;margin-top:2px;font-size:.72em">Writing tickets to the database…</p>' +
        '</div>' +
      '</div>');
    var _pt0 = Date.now();
    // Progress bar staging (~2 min 19 s runway before it parks at 98%), same as the assess step:
    //   0->60% @1.25s, 60->80% @1.5s, 80->90% @1.75s, 90->98% @2s; hold at 98% w/ rotating lines.
    var _pBarEl = document.getElementById('tbPushBar');
    var _pPctEl = document.getElementById('tbPushPct');
    var _pMsgEl = document.getElementById('tbPushSub');
    var _pPct = 0;
    var _pSetPct = function (p) { _pPct = p; if (_pBarEl) _pBarEl.style.width = p + '%'; if (_pPctEl) _pPctEl.textContent = p + '%'; };
    var _pSetMsg = function (m) { if (_pMsgEl) _pMsgEl.textContent = m; };
    var _pStages = [
      { to: 60, delay: 1250, msg: 'Adding new tickets to the database for a proper fetch…' },
      { to: 80, delay: 1500, msg: 'Updating the changes in the existing tickets…' },
      { to: 90, delay: 1750, msg: 'Oh wow — the changes are more than expected, hang on…' },
      { to: 98, delay: 2000, msg: 'The database update is almost done…' },
    ];
    var _pAlmost = [
      'Almost done — committing the changes…',
      'Nearly there, we promise — finalising the save…',
      'Hang tight — writing the last records…',
      'Thanks for your patience — almost saved…',
    ];
    var _pAlmostIdx = 0, _pAlmostTimer = null, _pProgTimer = null, _pStageShown = -1;
    var _pSchedule = function () {
      var si = 0; while (si < _pStages.length && _pPct >= _pStages[si].to) si++;
      if (si >= _pStages.length) {
        if (!_pAlmostTimer) {
          _pSetMsg(_pAlmost[_pAlmostIdx++ % _pAlmost.length]);
          _pAlmostTimer = setInterval(function () { _pSetMsg(_pAlmost[_pAlmostIdx++ % _pAlmost.length]); }, 3000);
        }
        return;
      }
      if (si !== _pStageShown) { _pSetMsg(_pStages[si].msg); _pStageShown = si; }
      _pProgTimer = setTimeout(function () { _pSetPct(_pPct + 1); _pSchedule(); }, _pStages[si].delay);
    };
    _pSetMsg(_pStages[0].msg); _pStageShown = 0;
    _pSchedule();
    // Random ticket ticker (2 per second) to keep the user engaged during the save.
    var _pTickerEl = document.getElementById('tbPushTicker');
    var _pRandTicket = function () { var s = ''; for (var i = 0; i < 10; i++) s += Math.floor(Math.random() * 10); return 'V' + s; };
    var _pTicker = setInterval(function () {
      if (!_pTickerEl) return;
      _pTickerEl.style.opacity = '0';
      setTimeout(function () { _pTickerEl.textContent = _pRandTicket(); _pTickerEl.style.opacity = '1'; }, 90);
    }, 500);
    if (_pTickerEl) _pTickerEl.textContent = _pRandTicket();
    var _pushSecs = 0;
    try {
      var fm = res.fileMeta || {};
      var body = { changed: res.changed, nonLive: res.nonLive, changeSummary: { added: res.zNew, updated: res.yUpdated }, fileName: fm.fileName || '', fileSize: fm.fileSize || 0, fileType: fm.fileType || '' };
      var r = await A.api('POST', '/api/live-quarter/patch', body);
      clearTimeout(_pProgTimer); clearInterval(_pTicker); if (_pAlmostTimer) clearInterval(_pAlmostTimer);
      _pushSecs = Math.round((Date.now() - _pt0) / 1000);
      _pSetPct(100); _pSetMsg('Done — saved to the shared database.'); if (_pTickerEl) _pTickerEl.textContent = 'Done';
      await new Promise(function (rr) { setTimeout(rr, 400); });   // brief beat so 100% is visible
      if (!r.ok) {
        // Fallback: if there is no live doc yet, a delta can't apply — inform (rare; live quarter exists).
        throw new Error((r.data && r.data.error) || ('Upload failed (HTTP ' + r.status + ')'));
      }
      tbRemove('tbPush');
      tbFlowOverlay('tbDone',
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;padding:26px;text-align:center">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#4ade80;font-size:1.2em;margin:8px 0 6px">Upload complete</h2>' +
          '<p style="color:#879596;font-size:.9em">' + res.yUpdated + ' updated · ' + res.zNew + ' added. Live for everyone now.</p>' +
          (_pushSecs ? ('<p style="color:#5f6b6c;font-size:.78em;margin-top:8px">Saved in ' + tbFmtDuration(_pushSecs) + '</p>') : '') +
          '<div style="margin-top:18px"><button class="tb-mbtn" id="tbDoneClose">Done</button></div>' +
        '</div>');
      document.getElementById('tbDoneClose').onclick = function () {
        tbRemove('tbDone');
        // Refresh in-place if the current page can re-render from the live data.
        if (typeof window.PHDRefreshLive === 'function') { try { window.PHDRefreshLive(); } catch (e) {} }
      };
    } catch (err) {
      try { clearTimeout(_pProgTimer); clearInterval(_pTicker); if (_pAlmostTimer) clearInterval(_pAlmostTimer); } catch (e) {}
      tbRemove('tbPush');
      tbFlowOverlay('tbErr',
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:80vw;width:80vw;padding:26px;text-align:center">' +
          '<h2 style="color:#ff5252;font-size:1.15em;margin-bottom:6px">Upload failed</h2>' +
          '<p style="color:#879596;font-size:.9em">' + tbEsc(err.message) + '</p>' +
          '<div style="margin-top:18px"><button class="tb-mbtn" id="tbErrClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbErrClose').onclick = function () { tbRemove('tbErr'); };
    }
  }

  // ---- Shared styled pop-ups: PHDConfirm (OK/Cancel) + PHDAlert (single OK) ----
  // Promise-based replacements for the native confirm()/alert(). Reuse the .tb-modal look. Esc =
  // cancel/close; Enter = OK. opts: { title, body(HTML allowed), okLabel, cancelLabel, danger:bool }.
  function tbPopupEsc(x) { return String(x == null ? '' : x); }
  function tbShowPopup(opts, withCancel) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var bg = document.createElement('div');
      bg.className = 'tb-modal-bg'; bg.style.display = 'flex';
      var okLabel = opts.okLabel || (withCancel ? 'Confirm' : 'OK');
      var okCls = 'tb-mbtn' + (opts.danger ? ' tb-mbtn-danger' : '');
      var cancelBtn = withCancel ? ('<button class="tb-mbtn sec" data-act="cancel">' + tbPopupEsc(opts.cancelLabel || 'Cancel') + '</button>') : '';
      bg.innerHTML = '<div class="tb-modal" role="dialog" aria-modal="true">' +
        '<h2>' + tbPopupEsc(opts.title || (withCancel ? 'Please confirm' : 'Notice')) + '</h2>' +
        '<p class="sub" style="margin:0 0 4px">' + tbPopupEsc(opts.body || '') + '</p>' +
        '<div class="tb-modal-actions">' + cancelBtn +
          '<button class="' + okCls + '" data-act="ok">' + tbPopupEsc(okLabel) + '</button>' +
        '</div></div>';
      document.body.appendChild(bg);
      function done(val) {
        document.removeEventListener('keydown', onKey);
        if (bg.parentNode) bg.parentNode.removeChild(bg);
        resolve(val);
      }
      function onKey(e) { if (e.key === 'Escape') done(withCancel ? false : true); else if (e.key === 'Enter') { e.preventDefault(); done(true); } }
      bg.addEventListener('click', function (e) {
        var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'ok') done(true);
        else if (act === 'cancel') done(false);
        else if (e.target === bg && withCancel) done(false); // backdrop click cancels (confirm only)
      });
      document.addEventListener('keydown', onKey);
      setTimeout(function () { var b = bg.querySelector('[data-act="ok"]'); if (b) b.focus(); }, 40);
    });
  }
  // Public API: await PHDConfirm({title,body,okLabel,danger}) -> true/false; await PHDAlert({title,body}) -> true.
  window.PHDConfirm = function (opts) { return tbShowPopup(opts, true); };
  window.PHDAlert = function (opts) { return tbShowPopup(typeof opts === 'string' ? { body: opts } : opts, false); };

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
        '<label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:.85em;color:#879596"><input type="checkbox" id="tbRemember" style="width:auto" checked> Keep me signed in</label>' +
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

  // Floating top-right control cluster — the only survivor of the retired title bar. Holds (right to
  // left): the profile pill, then the Uploaded data log button to its LEFT. (Upload new data now
  // lives in the left FAB rail.) The profile pill expands leftward on hover (name/Login text slides
  // in). Re-rendered by refreshProfileAvatar() once the full profile loads in the background.
  function buildProfileAvatar() {
    tbPlaceTopRight(); // creates the cluster if missing, paints it, and anchors it (row or floating)
  }
  // Ensure EVERY page shows the same header div: "WWOS-PHD Dashboard" title on the left + the
  // top-right cluster (Uploaded data log + avatar) on the right. If the page already renders its own
  // header row (.js-header-row — e.g. app.html dashboard, index.html), we reuse it. Otherwise we
  // inject a universal header (#tbHeaderRow) as the first element of <body> so it's constant across
  // every page. Returns the header row element (or null if none/should float).
  function tbEnsureHeaderRow() {
    // A page-provided header row (NOT our injected one) always wins — keep the page's own title.
    var page = null, all = document.querySelectorAll('.js-header-row');
    for (var i = 0; i < all.length; i++) { if (all[i].id !== 'tbHeaderRow') { page = all[i]; break; } }
    var universal = document.getElementById('tbHeaderRow');
    if (page) {
      // A real page header exists -> drop any stale universal header so the title isn't duplicated.
      if (universal) universal.remove();
      return page;
    }
    // Otherwise build (once) a universal header row pinned to the top of the content.
    if (!universal) {
      universal = document.createElement('div');
      universal.id = 'tbHeaderRow';
      universal.className = 'tb-header-row js-header-row';
      universal.innerHTML = '<span class="tb-header-name">WWOS-PHD Dashboard</span>';
      document.body.insertBefore(universal, document.body.firstChild);
    }
    return universal;
  }
  // Unify the header into ONE div: put the cluster INTO the header row (page-provided or the
  // universal one) as the right-side child so title + buttons live in a single flex row. app.js calls
  // this again after it re-renders the dashboard title row (the cluster is a body-level singleton).
  function tbPlaceTopRight() {
    var cluster = document.getElementById('tbTopRight');
    // If a page re-render wiped the cluster (it lived inside #app), rebuild it from current state.
    if (!cluster) {
      cluster = document.createElement('div');
      cluster.id = 'tbTopRight';
      cluster.className = 'tb-top-right';
      document.body.appendChild(cluster);
      paintProfileAvatar();
    }
    var row = tbEnsureHeaderRow();
    if (row) {
      if (cluster.parentNode !== row) row.appendChild(cluster);
      cluster.classList.add('tb-top-right-inrow'); // static, sits inside the flex row
    } else {
      if (cluster.parentNode !== document.body) document.body.appendChild(cluster);
      cluster.classList.remove('tb-top-right-inrow'); // float absolute top-right
    }
  }
  window.PHDPlaceTopRight = tbPlaceTopRight; // let pages re-anchor the cluster after re-rendering the header
  // Escape helper for user-provided strings placed into markup.
  function tbEsc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function paintProfileAvatar() {
    var cluster = document.getElementById('tbTopRight');
    if (!cluster) return;
    var li = loggedIn();
    var html = '';
    // Uploaded data log sits to the LEFT of the profile pill (logged-in only). DOM order = visual
    // left-to-right: [Uploaded data log] [profile pill]. (Upload new data moved to the left rail.)
    if (li) {
      html += '<a class="tb-data-btn" href="data-log.html" title="Uploaded data log">' + ic('history', 16) + '<span>Uploaded data log</span></a>';
    }
    // Profile pill (far right). Logged in -> avatar + name; logged out -> key icon + "Login".
    if (li) {
      var prof = (A.myProfile && A.myProfile()) || A.getUser();
      var name = (prof && (prof.displayName || prof.username)) || 'Profile';
      html += '<a class="tb-avatar-fab" href="profile.html" title="' + tbEsc(name) + ' — Profile" aria-label="' + tbEsc(name) + ' — Profile">'
        + '<span class="tb-av-label">' + tbEsc(name) + '</span>'
        + '<span class="tb-av-ic">' + (A.avatarHtml ? A.avatarHtml(prof, 42) : '') + '</span>'
        + '</a>';
    } else {
      html += '<a class="tb-avatar-fab tb-avatar-login" title="Log in" aria-label="Log in" style="cursor:pointer" onclick="if(window.tbOpenLogin)tbOpenLogin()">'
        + '<span class="tb-av-label">Login</span>'
        + '<span class="tb-av-ic">' + ic('key', 20) + '</span>'
        + '</a>';
    }
    cluster.innerHTML = html;
  }
  function refreshProfileAvatar() { paintProfileAvatar(); }

  // ---- Recent-history quick-swap (bottom-left FAB) ----
  var TB_HISTORY_KEY = 'phd_recent_pages';
  // app.html hosts several views via ?view= — map each to a friendly title.
  var TB_APP_VIEW_TITLES = { '': 'Q3 Live Dashboard', dashboard: 'Q3 Live Dashboard', 'shift-report': 'Shift Report', groups: 'Groups', 'previous-week': 'Previous Week' };
  function tbViewOf(href) {
    try { return (new URLSearchParams(String(href).split('?')[1] || '')).get('view') || ''; } catch (e) { return ''; }
  }
  function tbIsAppPage(href) { return /(^|\/)app\.html$/i.test(String(href || '').split('?')[0]); }
  // Identity key for dedupe: app.html views are distinguished by their ?view=; every other page by path.
  function tbPageKey(href) {
    var path = String(href || '').split('?')[0];
    return tbIsAppPage(href) ? (path + '?view=' + (tbViewOf(href) || 'dashboard')) : path;
  }
  // A friendly title for a page. For app.html use the view map; otherwise document.title / filename.
  function tbTitleFor(href, useDocTitle) {
    if (tbIsAppPage(href)) return TB_APP_VIEW_TITLES[tbViewOf(href)] || 'Q3 Live Dashboard';
    if (useDocTitle) { var t = (document.title || '').split('·')[0].split('|')[0].trim(); if (t) return t; }
    var f = (String(href).split('?')[0].split('/').pop() || '').replace(/\.html?$/i, '');
    return f ? f.replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : 'Page';
  }
  function tbPageTitle() { return tbTitleFor(location.pathname + location.search, true); }
  // Record the current page (path + search) at the front of the recent list; dedupe, cap at 5.
  function tbTrackHistory() {
    try {
      var here = location.pathname + location.search;
      var title = tbPageTitle();
      var list = [];
      try { list = JSON.parse(localStorage.getItem(TB_HISTORY_KEY) || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      // Drop ANY existing entry for this page (dedupe by page key — app.html views count as distinct),
      // then put the current page at the front.
      var hk = tbPageKey(here);
      list = list.filter(function (x) { return x && tbPageKey(x.href) !== hk; });
      list.unshift({ href: here, title: title, at: Date.now() });
      list = list.slice(0, 20); // keep extra so the popup can show all unique pages
      localStorage.setItem(TB_HISTORY_KEY, JSON.stringify(list));
    } catch (e) { /* history is best-effort */ }
  }
  // Recent Activity FAB REMOVED (no longer needed). Kept as a no-op so existing callers don't break;
  // page-visit tracking (tbTrackHistory) still runs harmlessly in the background.
  function buildHistoryButton() { /* recent-activity FAB removed */ }
  // Get (or create) the vertically-centered left-edge FAB column that holds Live + Analytics + nav
  // FABs. Order inside the column, top -> bottom: nav FABs, Live, Analytics.
  function tbFabCol() {
    var col = document.getElementById('tbFabCol');
    if (!col) { col = document.createElement('div'); col.id = 'tbFabCol'; col.className = 'tb-fab-col'; document.body.appendChild(col); }
    return col;
  }
  // Build the vertically-centered Agent & Group Analytics FAB. Admin-gated:
  // clickable for admins, greyed + inert otherwise. Runs on EVERY page.
  function buildAnalyticsButton() {
    if (document.querySelector('.tb-an-fab')) return;
    // Don't duplicate the home page's own hardcoded analytics FAB if it's present.
    if (document.getElementById('analyticsFab')) return;
    var A = window.PHDAuth;
    var li = loggedIn();
    var fab = document.createElement('a');
    fab.className = 'tb-an-fab' + (li ? '' : ' tb-an-disabled');
    fab.setAttribute('aria-label', 'Agent & Group Analytics');
    // group-chart icon (people + chart) for Agent & Group Analytics.
    fab.innerHTML = '<span class="tb-an-ic">' + ic('group-chart', 20) + '</span>'
      + '<span class="tb-an-label">Agent &amp; Group Analytics</span>';
    if (li) {
      fab.href = 'agent-analytics.html';
      fab.title = 'Agent & Group Analytics';
    } else {
      fab.setAttribute('aria-disabled', 'true');
      fab.title = 'Log in to view Agent & Group Analytics';
    }
    tbFabCol().appendChild(fab); // analytics sits at the BOTTOM of the centered column
  }
  // Build the LIVE-QUARTER FAB (sits just above Analytics in the centered column). Blinks to signal
  // the live quarter and links to the live dashboard (app.html). Shown on EVERY page.
  function buildLiveButton() {
    if (document.querySelector('.tb-live-fab')) return;
    // The live quarter label (e.g. "Q3 2026") — from the page attribute if set, else the default.
    var label = document.body.getAttribute('data-live-label') || 'Q3 2026';
    var li = loggedIn();
    var fab = document.createElement('a');
    fab.className = 'tb-live-fab' + (li ? '' : ' tb-live-disabled');
    fab.setAttribute('aria-label', 'Live quarter dashboard — ' + label);
    fab.innerHTML = '<span class="tb-live-ic"><span class="tb-live-dot"></span></span>'
      + '<span class="tb-live-label">' + label + ' &middot; LIVE</span>';
    if (li) {
      fab.href = 'app.html';
      fab.title = 'Go to the live quarter dashboard (' + label + ')';
    } else {
      fab.setAttribute('aria-disabled', 'true');
      fab.title = 'Log in to view the live quarter dashboard';
    }
    // Insert above Analytics if it's already there; otherwise just append.
    var col = tbFabCol(); var an = col.querySelector('.tb-an-fab');
    if (an) col.insertBefore(fab, an); else col.appendChild(fab);
  }
  // Evaluate whether a nav item's `need` token is satisfied. Central place so buildNavFabs and
  // applyNavFabsState stay in sync. Owner passes every flag (the flag helpers force-true for owner).
  function tbNeedMet(need, li, isAdmin, isOwner) {
    switch (need) {
      case true: case 'any': return true;
      case 'li': return li;
      case 'admin': return isAdmin;
      case 'owner': return isOwner;
      case 'upload': return !!(A.canUpload && A.canUpload());
      case 'database': return !!(A.canDatabase && A.canDatabase());
      case 'edittools': return !!(A.canEditTools && A.canEditTools());
      case 'sr': return !!(A.canViewSR && A.canViewSR());
      case 'repeat': return !!(A.canViewRepeat && A.canViewRepeat());
      case 'unique': return !!(A.canViewUnique && A.canViewUnique());
      case 'sla': return !!(A.canViewSLA && A.canViewSLA());
      case 'grouping': return !!(A.canGroupingPage && A.canGroupingPage());
      default: return false;
    }
  }
  // Build the PAGE-NAVIGATION FABs at the TOP of the centered column (above Live + Analytics). Each
  // is an expand-on-hover pill linking to a page. Role-gated: admin-only items greyed + inert.
  function buildNavFabs() {
    if (document.querySelector('.tb-nav-fab')) return;
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    var isOwner = atLeast('owner');
    // Order top -> bottom within the nav group. need: 'li' | 'admin' | 'owner' | true.
    var items = [
      { key: 'my-tickets',    label: 'My Tickets',                icon: 'ticket',      href: 'my-tickets.html',            need: 'li' },
      { key: 'upload',        label: 'Upload new data',           icon: 'upload',      type: 'upload',                     need: 'upload' },
      { key: 'shift-report', label: 'Shift Report',              icon: 'clipboard',    href: 'app.html?view=shift-report', need: 'li' },
      { key: 'help-activity', label: 'Alerts and Help activity', icon: 'alert',        href: 'alerts.html',                need: 'li', badge: 'alerts' },
      { key: 'tools',         label: 'PHD Tools',                 icon: 'tool',        href: 'tools.html',                 need: 'li' }
      // Repeat Incidents / SLA Breaches / Station Requests / Unique cases now live in the line-chart
      // "Reports" fly-out; Program History (Before WWOS / Moved under WWOS) lives in the calendar
      // fly-out; Users / Database health / Grouping Page live in the user-shield "Admin" fly-out.
    ];
    // Restore any saved custom order (drag-and-drop). Unknown/new keys keep their default position.
    items = tbApplyNavOrder(items);
    var col = tbFabCol();
    var anchor = col.querySelector('.tb-live-fab') || col.querySelector('.tb-an-fab'); // insert above these
    var canUpload = A.canUpload && A.canUpload();
    items.forEach(function (it) {
      var enabled = tbNeedMet(it.need, li, isAdmin, isOwner);
      // Upload is a button (opens the in-place CSV picker); everything else is a link.
      var isUpload = it.type === 'upload';
      var fab = document.createElement(isUpload ? 'button' : 'a');
      fab.className = 'tb-nav-fab' + (isUpload ? ' tb-nav-upload' : '') + (enabled ? '' : ' tb-nav-disabled');
      fab.setAttribute('aria-label', it.label);
      fab.setAttribute('data-need', it.need === true ? 'any' : it.need);
      fab.setAttribute('data-key', it.key);
      if (it.href) fab.setAttribute('data-href', it.href);
      fab.setAttribute('draggable', 'true'); // part 7: drag-and-drop reordering
      // Icon: a custom PNG when `img` is set, otherwise an inline SVG icon.
      var iconHtml = it.img ? '<img class="tb-nav-img" src="' + it.img + '" alt="">' : ic(it.icon);
      // Optional count badge on the icon (e.g. open-alert count on the Alerts nav FAB).
      var badgeHtml = it.badge ? '<span class="tb-nav-badge" id="navBadge-' + it.badge + '">0</span>' : '';
      fab.innerHTML = '<span class="tb-nav-ic">' + iconHtml + badgeHtml + '</span>'
        + '<span class="tb-nav-label">' + it.label + '</span>';
      if (isUpload) {
        fab.type = 'button';
        if (enabled) { fab.title = it.label; fab.onclick = function () { if (window.tbUploadIntro) tbUploadIntro('app'); }; }
        else { fab.setAttribute('aria-disabled', 'true'); fab.title = li ? (it.label + ' — you do not have upload access') : ('Log in to ' + it.label); }
      } else if (enabled) {
        fab.href = it.href;
        fab.title = it.label;
      } else {
        fab.setAttribute('aria-disabled', 'true');
        fab.title = li ? (it.label + ' — you do not have access') : ('Log in to view ' + it.label);
      }
      // Keep list order by inserting each new item just before the anchor (Live/Analytics).
      if (anchor) col.insertBefore(fab, anchor); else col.appendChild(fab);
    });
    // Hidden file input the Upload FAB feeds (the in-place pipeline binds a delegated #uploadFile listener).
    if (!document.getElementById('uploadFile')) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv'; inp.id = 'uploadFile'; inp.style.display = 'none';
      document.body.appendChild(inp);
    }
    // Fly-out groups: a single trigger FAB whose hover slides out a vertical stack of pages to the
    // right. Each item is a normal expand-on-hover pill and is flag-gated. Triggers aren't draggable.
    buildFlyoutGroup(col, anchor, li, isAdmin, isOwner, {
      id: 'reports', triggerIcon: 'line-chart', triggerLabel: 'Reports', items: [
        { key: 'sla-breach',      label: 'SLA Breaches (>240h)',    icon: 'clock',        href: 'sla-breach.html',      need: 'sla' },
        { key: 'station-request', label: 'Station Request Tickets', icon: 'map-pin',      href: 'station-request.html', need: 'sr' },
        { key: 'hi-resolved',     label: 'Repeat Incidents',        icon: 'repeat',       href: 'hi-resolved.html',     need: 'repeat' },
        { key: 'unique-cases',    label: 'Unique cases',            img: 'important.png', href: 'important-cases.html', need: 'unique' }
      ]
    });
    buildFlyoutGroup(col, anchor, li, isAdmin, isOwner, {
      id: 'history', triggerIcon: 'calendar', triggerLabel: 'Program History', items: [
        { key: 'archive-before', label: 'Before WWOS',      icon: 'clock-rewind', href: 'archive.html?ds=archive', need: 'li' },
        { key: 'archive-moving', label: 'Moved under WWOS',  icon: 'repeat',       href: 'archive.html?ds=moving',  need: 'li' }
      ]
    });
    buildFlyoutGroup(col, anchor, li, isAdmin, isOwner, {
      id: 'admin', triggerIcon: 'user-shield', triggerLabel: 'Admin', items: [
        { key: 'users',       label: 'Users',           icon: 'users-gear', href: 'users.html',       need: 'admin' },
        { key: 'db-health',   label: 'Database health',  icon: 'database',   href: 'db-health.html',   need: 'database' },
        { key: 'groups-page', label: 'Grouping Page',    icon: 'copy',       href: 'groups-page.html', need: 'grouping' }
      ]
    });
    tbEnableNavDnD(col); // part 7: wire up drag-and-drop reordering
    // Fetch the open-alert count and show it on the Alerts nav FAB (logged-in only).
    if (li) refreshAlertBadge();
  }
  // Build a fly-out group: a single trigger FAB in the rail; hovering it slides out a vertical stack
  // of pages to its right. Each fly-out item is a normal expand-on-hover pill (label slides right on
  // hover) and is flag-gated (disabled + greyed when the viewer lacks access). Not draggable.
  function buildFlyoutGroup(col, anchor, li, isAdmin, isOwner, opts) {
    if (col.querySelector('.tb-flyout-fab[data-group="' + opts.id + '"]')) return;
    var wrap = document.createElement('div');
    wrap.className = 'tb-flyout-wrap';
    var trigger = document.createElement('div');
    trigger.className = 'tb-flyout-fab';
    trigger.setAttribute('data-group', opts.id);
    trigger.setAttribute('aria-label', opts.triggerLabel);
    trigger.title = opts.triggerLabel;
    trigger.innerHTML = '<span class="tb-nav-ic">' + ic(opts.triggerIcon) + '</span>';
    var flyout = document.createElement('div');
    flyout.className = 'tb-flyout';
    opts.items.forEach(function (it) {
      var enabled = tbNeedMet(it.need, li, isAdmin, isOwner);
      var el = document.createElement('a');
      el.className = 'tb-nav-fab tb-flyout-item' + (enabled ? '' : ' tb-nav-disabled');
      el.setAttribute('aria-label', it.label);
      el.setAttribute('data-need', it.need);
      if (it.href) el.setAttribute('data-href', it.href);
      var iconHtml = it.img ? '<img class="tb-nav-img" src="' + it.img + '" alt="">' : ic(it.icon);
      el.innerHTML = '<span class="tb-nav-ic">' + iconHtml + '</span><span class="tb-nav-label">' + it.label + '</span>';
      if (enabled) { el.href = it.href; el.title = it.label; }
      else { el.setAttribute('aria-disabled', 'true'); el.title = li ? (it.label + ' — you do not have access') : ('Log in to view ' + it.label); }
      flyout.appendChild(el);
    });
    wrap.appendChild(trigger);
    wrap.appendChild(flyout);
    if (anchor) col.insertBefore(wrap, anchor); else col.appendChild(wrap);
  }
  // ---- Drag-and-drop reordering of the left nav column (persisted in localStorage) ----
  var TB_NAV_ORDER_KEY = 'phdNavFabOrder';
  // Read the saved key order (array of item keys) or null if none/invalid.
  function tbReadNavOrder() {
    try { var v = JSON.parse(localStorage.getItem(TB_NAV_ORDER_KEY)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  // Reorder `items` to match the saved order; unknown keys keep their relative default position.
  function tbApplyNavOrder(items) {
    var order = tbReadNavOrder();
    if (!order) return items;
    var byKey = {}; items.forEach(function (it) { byKey[it.key] = it; });
    var out = [], seen = {};
    order.forEach(function (k) { if (byKey[k] && !seen[k]) { out.push(byKey[k]); seen[k] = true; } });
    items.forEach(function (it) { if (!seen[it.key]) out.push(it); }); // append any new/unsaved items
    return out;
  }
  // Persist the current DOM order of the nav FABs as an array of their data-key values.
  function tbSaveNavOrder(col) {
    var keys = [];
    col.querySelectorAll('.tb-nav-fab:not(.tb-flyout-item)').forEach(function (f) { var k = f.getAttribute('data-key'); if (k) keys.push(k); });
    try { localStorage.setItem(TB_NAV_ORDER_KEY, JSON.stringify(keys)); } catch (e) {}
  }
  // Wire drag events on every nav FAB in the column. Dragging a pill drops it above/below a sibling.
  function tbEnableNavDnD(col) {
    if (col._navDnd) return; col._navDnd = true; // bind the container listeners once
    var dragging = null;
    col.addEventListener('dragstart', function (e) {
      var fab = e.target.closest && e.target.closest('.tb-nav-fab');
      if (!fab || col !== fab.parentNode) return;
      dragging = fab; fab.classList.add('tb-nav-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', fab.getAttribute('data-key') || ''); } catch (x) {}
    });
    col.addEventListener('dragend', function () {
      if (dragging) dragging.classList.remove('tb-nav-dragging');
      dragging = null; tbSaveNavOrder(col);
    });
    col.addEventListener('dragover', function (e) {
      if (!dragging) return;
      e.preventDefault(); // allow drop
      try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
      var after = tbNavDropTarget(col, e.clientY);
      if (after == null) col.insertBefore(dragging, col.querySelector('.tb-live-fab, .tb-an-fab'));
      else if (after !== dragging) col.insertBefore(dragging, after);
    });
  }
  // Find the nav FAB that the pointer is currently above (the one to insert BEFORE), by vertical midpoint.
  function tbNavDropTarget(col, y) {
    var fabs = Array.prototype.slice.call(col.querySelectorAll('.tb-nav-fab:not(.tb-nav-dragging):not(.tb-flyout-item)'));
    for (var i = 0; i < fabs.length; i++) {
      var r = fabs[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return fabs[i];
    }
    return null; // below all nav FABs -> drop at the end of the nav group
  }
  // Fetch /api/help/open and paint the count onto the Alerts nav FAB badge.
  // Always visible (shows 0 when there are none) so the count is always readable.
  function refreshAlertBadge() {
    var badge = document.getElementById('navBadge-alerts');
    if (!badge || !A || !A.api) return;
    badge.classList.add('show'); // always show the number, even when 0
    A.api('GET', '/api/help/open').then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.data)) return;
      var n = r.data.length;
      badge.textContent = n > 99 ? '99+' : n;
      badge.classList.add('show');
      badge.classList.toggle('zero', n === 0); // grey when none, red when there are alerts
    }).catch(function () {});
  }
  // Re-apply the nav FABs' role-gated state after a background profile load (so they enable without reload).
  function applyNavFabsState() {
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    var isOwner = atLeast('owner');
    var canUpload = A.canUpload && A.canUpload();
    document.querySelectorAll('.tb-nav-fab').forEach(function (fab) {
      var need = fab.getAttribute('data-need');
      if (!need) return;
      var enabled = tbNeedMet(need, li, isAdmin, isOwner);
      var href = fab.getAttribute('data-href') || '';
      var label = fab.getAttribute('aria-label') || '';
      var isBtn = fab.tagName === 'BUTTON'; // the Upload FAB is a button (no href)
      if (enabled) {
        fab.classList.remove('tb-nav-disabled');
        fab.removeAttribute('aria-disabled');
        if (href && !isBtn) fab.href = href;
        fab.title = label;
      } else {
        fab.classList.add('tb-nav-disabled');
        fab.setAttribute('aria-disabled', 'true');
        if (!isBtn) fab.removeAttribute('href');
        fab.title = li ? (label + ' — you do not have access') : ('Log in to view ' + label);
      }
    });
    if (li) refreshAlertBadge(); // refresh the open-alert count once auth is confirmed
    // Live FAB: enabled once logged in, disabled + inert (no blink) when logged out.
    var liveFab = document.querySelector('.tb-live-fab');
    if (liveFab) {
      var lbl = document.body.getAttribute('data-live-label') || 'Q3 2026';
      if (li) {
        liveFab.classList.remove('tb-live-disabled');
        liveFab.removeAttribute('aria-disabled');
        liveFab.href = 'app.html';
        liveFab.title = 'Go to the live quarter dashboard (' + lbl + ')';
      } else {
        liveFab.classList.add('tb-live-disabled');
        liveFab.setAttribute('aria-disabled', 'true');
        liveFab.removeAttribute('href');
        liveFab.title = 'Log in to view the live quarter dashboard';
      }
    }
  }
  // Re-apply the analytics FAB's admin-gated state (after a background profile load / auth change),
  // so it becomes clickable without needing a page reload. No-op on the home page (own FAB).
  function applyAnalyticsFabState() {
    var fab = document.querySelector('.tb-an-fab');
    if (!fab) return;
    if (loggedIn()) {
      fab.classList.remove('tb-an-disabled');
      fab.removeAttribute('aria-disabled');
      fab.href = 'agent-analytics.html';
      fab.title = 'Agent & Group Analytics';
    } else {
      fab.classList.add('tb-an-disabled');
      fab.setAttribute('aria-disabled', 'true');
      fab.removeAttribute('href');
      fab.title = 'Log in to view Agent & Group Analytics';
    }
  }
  // Home-page MENU fab: a floating button that opens the same Navigate links as the toolbar
  // hamburger. REMOVED: the hamburger menu is gone; navigation lives in the left FAB stack and the
  // top-right controls now. Kept as a no-op so existing callers don't break.
  function buildMenuButton() { /* hamburger menu removed */ }
  function tbRenderHistory(pop) {
    var here = location.pathname + location.search;
    var hereKey = tbPageKey(here);
    var list = [];
    try { list = JSON.parse(localStorage.getItem(TB_HISTORY_KEY) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    // Current page's title — derive it directly (handles app.html views correctly).
    var hereTitle = tbTitleFor(here, true);
    // Unique pages OTHER than the current one (deduped by page key, most-recent first), capped at 10.
    var seen = {}; seen[hereKey] = true; var others = [];
    list.forEach(function (x) {
      if (!x || !x.href) return;
      var k = tbPageKey(x.href);
      if (seen[k]) return;
      seen[k] = true; others.push(x);
    });
    others = others.slice(0, 10);
    var html = '<div class="tb-hist-title">Recently visited</div>';
    // Current page pinned at the top.
    html += '<a class="tb-hist-item tb-hist-current" href="' + tbEsc(here) + '" title="' + tbEsc(hereTitle) + '">' + tbPageIcon(here) + '<span class="tb-hist-name">' + tbEsc(hereTitle) + '</span><span class="tb-hist-badge">Current</span></a>';
    if (others.length) {
      html += others.map(function (x) {
        var t = tbTitleFor(x.href, false) || x.title;   // always show the correct label (esp. app.html views)
        return '<a class="tb-hist-item" href="' + tbEsc(x.href) + '" title="' + tbEsc(t) + '">' + tbPageIcon(x.href) + '<span class="tb-hist-name">' + tbEsc(t) + '</span></a>';
      }).join('');
    } else {
      html += '<div class="tb-hist-empty">No other pages visited yet.</div>';
    }
    pop.innerHTML = html;
  }
  // Pick a relevant icon for a page (by filename + ?view=) so the recent list is easy to scan.
  function tbPageIcon(href) {
    var path = String(href || '').split('?')[0];
    var file = (path.split('/').pop() || '').toLowerCase();
    var view = ''; try { view = (new URLSearchParams(String(href).split('?')[1] || '')).get('view') || ''; } catch (e) {}
    var key = 'grid'; // sensible default
    var map = {
      'index.html': 'home', 'app.html': 'bolt', 'my-tickets.html': 'ticket',
      'agent-analytics.html': 'bar-chart', 'help-activity.html': 'alert',
      'alerts.html': 'alert', 'tools.html': 'tool', 'tool-blurbs.html': 'clipboard',
      'tool-hashtags.html': 'hash', 'tool-paging.html': 'mail', 'tool-prompts.html': 'message',
      'important-cases.html': 'hash', 'unique-cases.html': 'hash',
      'station-request.html': 'map-pin',
      'users.html': 'users-gear', 'db-health.html': 'database', 'profile.html': 'users',
      'data-log.html': 'history', 'blurb-log.html': 'history', 'hashtag-log.html': 'history',
      'paging-log.html': 'history', 'archive.html': 'calendar',
      'add-archive.html': 'plus'
    };
    if (file === 'app.html' && view) { key = ({ groups: 'users', 'shift-report': 'clipboard', 'previous-week': 'clock-rewind' })[view] || 'bolt'; }
    else if (map[file]) { key = map[file]; }
    return ic(key);
  }

  // ---- Standalone-page auto-mount: replace the page's .top-bar with the shared toolbar ----
  // Reads data-nav-active on <body> for the active highlight. Skipped on app.html (it builds its own).
  (async function () {
    // EMBEDDED MODE: when a page is loaded inside an iframe with ?embed=1 (e.g. the tool tabs on
    // tools.html), suppress the shared toolbar, the .tools-subnav, and all floating FABs — the parent
    // page already provides the chrome. The embedded page then renders only its own content.
    var isEmbedded = false;
    try { isEmbedded = /[?&]embed=1\b/.test(location.search) || window.self !== window.top; } catch (e) { isEmbedded = /[?&]embed=1\b/.test(location.search); }
    if (isEmbedded) {
      injectStyles();
      var hideCss = document.createElement('style');
      hideCss.textContent = '.top-bar,.tools-subnav{display:none!important}'
        + '.tb-topbar,.tb-menu,.tb-back-fab,.tb-hist-fab,.tb-fab-col,#tbFabCol,.tb-menu-fab{display:none!important}'
        + 'body{padding:0!important}.wrap{padding-top:16px!important}';
      document.head.appendChild(hideCss);
      document.body.setAttribute('data-embedded', 'true');
      return; // no toolbar / FAB build in embedded mode
    }
    injectStyles();
    buildModalAndLoader();
    tbTrackHistory();       // record this page in the recent-history list (runs on every page)
    // Pages with a bespoke top bar (e.g. index.html) opt out of the toolbar swap but still get the
    // recent-history quick-swap button so the feature is on EVERY page.
    if (document.body.getAttribute('data-no-toolbar') === 'true') { buildMenuButton(); buildHistoryButton(); buildAnalyticsButton(); buildLiveButton(); buildNavFabs(); buildProfileAvatar(); return; }
    if (document.body.getAttribute('data-app') === 'live') { buildBackButton(); buildHistoryButton(); buildAnalyticsButton(); buildLiveButton(); buildNavFabs(); buildProfileAvatar(); return; } // app.html: back + history + analytics + live + nav FABs + profile avatar

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
    buildHistoryButton(); // floating recent-history quick-swap button (bottom-left)
    buildAnalyticsButton(); // floating Agent & Group Analytics FAB (bottom-left, above history)
    buildLiveButton(); // floating blinking live-quarter FAB (bottom-left, above analytics)
    buildNavFabs(); // floating page-navigation FABs (bottom-left, above the live FAB)
    buildProfileAvatar(); // floating profile avatar (top-right) — the only survivor of the old title bar

    // Right controls are already rendered from the cached user (rightControlsHtml uses A.getUser()),
    // so the avatar/role badge show immediately with NO spinner flash. Load the full profile
    // (custom photo/display name) in the background and silently refresh only if it changed something.
    if (loggedIn()) {
      var beforeProfile = A._myProfile;
      try { if (A.loadMyProfile) await A.loadMyProfile(); } catch (e) {}
      // Refresh /api/me so the per-user access flags (canUpload/canCreateUsers) are current even for
      // sessions cached before the flags existed. Then re-render the controls + FABs so the Upload /
      // Users buttons enable without needing a re-login.
      try { if (A._refreshMe) await A._refreshMe(); else if (A.getMe) await A.getMe(); } catch (e) {}
      window.PHDNav.refreshRight();
      refreshProfileAvatar();   // repaint the top-right avatar with the full profile (photo/name)
      applyAnalyticsFabState(); // reflect admin role on the analytics FAB once the profile is in
      applyNavFabsState();      // reflect role gating on the nav FABs once the profile is in
    }

    // Quarter buttons are hardcoded in buildToolbarHtml (Q3 live + Q2), no dynamic fetch needed.
  })();
})();
