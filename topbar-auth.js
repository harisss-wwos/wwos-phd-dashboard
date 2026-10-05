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
  // Icons were replaced in place (same filenames), which browsers cache hard. We now point at NEW
  // versioned filenames (icons/<name>.v3.png) — a new URL path can't be served from an old cache
  // entry. ivURL() rewrites any 'icons/<name>.png' to its .v3.png twin. Bump the suffix on re-replace.
  var TB_ICON_V = '3';
  function ivURL(src) { return String(src || '').replace(/\.png(\?.*)?$/, '.v3.png'); }
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
      + '.tb-modal-bg{position:fixed;inset:0;background:rgba(20,30,50,.45);z-index:3000;display:none;align-items:center;justify-content:center;padding:20px}'
      + '.tb-modal{background:#fff;border:1px solid #e2e6ea;border-radius:12px;width:50vw;max-width:50vw;min-width:min(92vw,420px);padding:28px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)}'
      + '.tb-modal h2{color:#1b2026;font-size:1.2em;margin:0 0 6px}'
      + '.tb-modal p.sub{color:#5c6773;font-size:.85em;margin:0 0 14px;line-height:1.5}'
      + '.tb-modal label{display:block;color:#5c6773;font-size:.85em;margin:14px 0 6px}'
      + '.tb-modal input[type=text],.tb-modal input[type=password]{width:100%;padding:10px 12px;background:#fff;border:1px solid #d4dade;border-radius:6px;color:#1b2026;font-size:.95em}'
      + '.tb-modal input::placeholder{color:#9aa6b1}'
      + '.tb-pass-wrap{position:relative}'
      + '.tb-pass-wrap input{padding-right:44px!important}'
      + '.tb-pass-eye{position:absolute;top:50%;right:6px;transform:translateY(-50%);background:transparent;border:none;color:#8a94a2;cursor:pointer;padding:6px;display:inline-flex;align-items:center;border-radius:6px}'
      + '.tb-pass-eye:hover{color:#ec7211}'
      + '.tb-modal input:focus{outline:none;border-color:#ec7211;box-shadow:0 0 0 3px rgba(236,114,17,.14)}'
      + '.tb-err{color:#dc2626;font-size:.85em;margin-top:12px;display:none}'
      + '.tb-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}'
      + '.tb-mbtn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:linear-gradient(180deg,#ff9f2e,#f07d0a);color:#fff;border-radius:6px;font-weight:700;font-size:.88em;cursor:pointer;border:none;font-family:inherit}'
      + '.tb-mbtn:hover{filter:brightness(1.05)}'
      + '.tb-mbtn.sec{background:#fff;border:1px solid #d4dade;color:#2a3340}'
      + '.tb-mbtn.sec:hover{border-color:#ec7211;color:#ec7211}'
      + '.tb-mbtn.tb-mbtn-danger{background:#fff;border:1px solid rgba(220,38,38,.4);color:#dc2626}'
      + '.tb-mbtn.tb-mbtn-danger:hover{background:#fef2f2}'
      // login loader
      + '.tb-loader{position:fixed;inset:0;background:rgba(20,30,50,.5);z-index:3200;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px}'
      + '.tb-loader .sp{width:46px;height:46px;border:4px solid #e2e6ea;border-top-color:#ec7211;border-radius:50%;animation:tbspin 1s linear infinite}'
      + '.tb-loader p{color:#1b2026;font-weight:600}'
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
      + '.tb-back-fab{position:fixed;right:calc(5vw - 29px);bottom:22px;z-index:900;width:58px;height:58px;border-radius:50%;background:#ff9900;color:#000;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none}'
      + '.tb-back-fab svg{width:25px;height:25px}'
      // Disabled back button (home page): greyed + inert, so the rail keeps its bottom anchor.
      + '.tb-back-fab.tb-back-disabled{background:#232d3a;color:#6b7681;cursor:not-allowed;box-shadow:none;font-family:inherit}'
      + '.tb-back-fab.tb-back-disabled:hover{transform:none}'
      // Back button when it lives INSIDE the right rail (bottom): drop the fixed positioning so it
      // flows in the column, keep the orange circle look.
      + '.tb-fab-col-right .tb-back-fab{position:static;right:auto;bottom:auto;flex:0 0 58px}'
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
      + '.tb-fab-col{position:fixed;left:4px;top:10px;bottom:10px;width:5vw;min-width:58px;z-index:900;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;gap:9px;padding:0 4px;overflow-y:auto;overflow-x:clip;scrollbar-width:thin;scrollbar-color:#ff9900 transparent;box-sizing:border-box;background:transparent;pointer-events:auto}'
      // Thin ORANGE vertical scrollbar for the (now scrollable) left rail. overflow-x:clip above keeps
      // flyouts (position:fixed on hover) escaping while preventing a horizontal scrollbar.
      + '.tb-fab-col::-webkit-scrollbar{width:4px}'
      + '.tb-fab-col::-webkit-scrollbar-thumb{background:#ff9900;border-radius:4px}'
      + '.tb-fab-col::-webkit-scrollbar-thumb:hover{background:#ec7211}'
      + '.tb-fab-col::-webkit-scrollbar-track{background:transparent}'
      // LEFT rail 3-ZONE layout: logo pinned TOP, nav group CENTERED in the middle, LIVE pinned
      // BOTTOM. The two auto margins (logo margin-bottom:auto + live margin-top:auto) absorb the
      // free space above and below the middle group, centering it. Analytics flows with the group.
      + '.tb-fab-col .tb-fab-item-an{margin-top:0}'
      + '.tb-fab-col .tb-rail-logo,.tb-fab-col .tb-rail-logo-item{margin-bottom:auto!important;margin-top:0!important}'
      + '.tb-fab-col .tb-fab-item-live{margin-top:auto!important;margin-bottom:0!important}'
      // Logo caption: two lines ("WWOS-PHD" / "Dashboard") ALWAYS visible below the logo (no hover
      // reveal). A slow colour blink pulses it once every 2 seconds to draw the eye.
      + '.tb-rail-logo-cap{display:flex;flex-direction:column;align-items:center;gap:0;line-height:1.15;font-size:10px;font-weight:700;letter-spacing:.2px;text-align:center;color:#9fb0c3;animation:tbLogoBlink 2s ease-in-out infinite}'
      + '@keyframes tbLogoBlink{0%,100%{color:#9fb0c3}50%{color:#ff9900}}'
      // Logo item: no top padding so the logo circle starts flush at the rail\'s 10px top (aligning
      // with the main content\'s first card and the profile banner).
      + '.tb-fab-col .tb-rail-logo-item{padding-top:0!important}'
      // Whole rail item is clickable (JS forwards the click) -> show a pointer cursor over the entire
      // item (padding + caption), and let the caption receive the pointer so clicks on it register.
      + '.tb-fab-item{cursor:pointer}'
      + '.tb-fab-item .tb-fab-cap{pointer-events:auto}'
      // Two logos that slide-swap every second inside the home button (GSOC <-> Amazon). The swap box
      // clips; each image is absolutely stacked and animates X-translate on a 2s loop (1s each visible),
      // so the user sees the logo change about once per second, sliding right->left->right.
      + '.tb-logo-swap{position:relative;width:100%;height:100%;display:block;overflow:hidden;border-radius:inherit}'
      + '.tb-logo-swap .tb-rail-logo-img{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:82%;max-height:82%;width:auto;height:auto;object-fit:contain}'
      // SLIDING swap: on a 2s loop, logo A slides UP and out while logo B slides UP into view, then
      // back. Each logo is visible ~1s. translateY is composed with the -50%/-50% centering offset.
      + '.tb-logo-swap .tb-logo-a{animation:tbLogoSlideA 2s ease-in-out infinite}'
      + '.tb-logo-swap .tb-logo-b{animation:tbLogoSlideB 2s ease-in-out infinite}'
      + '@keyframes tbLogoSlideA{0%,38%{transform:translate(-50%,-50%);opacity:1}50%,88%{transform:translate(-50%,-180%);opacity:0}100%{transform:translate(-50%,-50%);opacity:1}}'
      + '@keyframes tbLogoSlideB{0%,38%{transform:translate(-50%,80%);opacity:0}50%,88%{transform:translate(-50%,-50%);opacity:1}100%{transform:translate(-50%,80%);opacity:0}}'
      + '.tb-fab-item-live{margin-top:auto}'         // LIVE at bottom of the LEFT rail; pushes it down
      + '.tb-fab-col>*{pointer-events:auto}'
      // RIGHT rail: mirror of the left, pinned to the right edge. Holds profile (TOP) + flyout groups
      // + Analytics in the MIDDLE + the back button (BOTTOM). Its hover labels slide out to the LEFT.
      + '.tb-fab-col-right{position:fixed;right:0;top:0;bottom:0;width:5vw;min-width:58px;z-index:900;display:flex;flex-direction:column;justify-content:flex-start;align-items:center;gap:9px;padding:14px 4px;overflow:visible;box-sizing:border-box;background:transparent;pointer-events:auto}'
      + '.tb-fab-col-right>*{pointer-events:auto}'
      // RIGHT rail 3-zone layout: profile pinned TOP, group in the MIDDLE, back button pinned BOTTOM.
      + '.tb-fab-col-right .tb-fab-item-profile{margin-top:0;margin-bottom:auto}'  // profile at TOP of right rail
      + '.tb-fab-col-right .tb-fab-item-back{margin-top:auto}'                     // back button at BOTTOM of right rail
      // On the RIGHT rail the rail-badge hover label sits to the LEFT of the circle and slides in leftward.
      + '.tb-fab-col-right .tb-rail-badge-label{left:auto;right:68px;transform:translateY(-50%) translateX(6px)}'
      + '.tb-fab-col-right .tb-rail-badge:hover .tb-rail-badge-label{transform:translateY(-50%) translateX(0)}'
      // RIGHT-rail fly-outs open to the LEFT of their trigger (mirrored).
      + '.tb-fab-col-right .tb-flyout{left:auto;right:46px;align-items:flex-end;padding-left:0;padding-right:14px;transform:translateY(-50%) translateX(8px)}'
      + '.tb-fab-col-right .tb-flyout::before{left:auto;right:0}'
      + '.tb-fab-col-right .tb-flyout-wrap:hover .tb-flyout,.tb-fab-col-right .tb-flyout:hover{transform:translateY(-50%) translateX(0)}'
      // Same short-screen shrink as the left rail.
      + '@media(max-height:820px){.tb-fab-col-right{gap:6px}}'
      // Layout: [66px rail] | 20px gap | content (fills the rest) | 20px right gap.
      // position:relative anchors the (now non-fixed) top-right cluster to the document top-right.
      + 'body{position:relative!important;padding-left:5vw!important;padding-right:5vw!important;box-sizing:border-box!important}'
      // Shared live animated-gradient background for the FAB buttons — a slow moving sheen so the
      // whole left column feels alive. Applied to nav/analytics/history FABs (Live keeps its green).
      + '@keyframes tbFabGrad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'
      + '.tb-fab-grad{background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite}'
      // Agent & Group Analytics FAB. Circular; expands on hover to reveal its label. Admin-gated
      // disabled state = greyed + inert. Lives inside the centered FAB column.
      + '.tb-an-fab{position:relative;height:46px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:23px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#7fdfff;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:46px;transition:max-width .28s ease,border-color .15s,transform .15s}'
      + '.tb-an-fab .tb-an-ic{flex:0 0 58px;width:58px;height:58px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-an-fab .tb-an-ic svg{width:25px;height:25px}'
      + '.tb-an-fab .tb-an-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-an-fab:hover{max-width:320px;border-color:#44b9d6;transform:translateY(-2px)}'
      + '.tb-an-fab:hover .tb-an-label{opacity:1;padding-right:18px}'
      + '.tb-an-fab.tb-an-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655;cursor:not-allowed;pointer-events:none}'
      // Live-quarter FAB. Blinks to signal "LIVE" and links to the live dashboard (app.html).
      // Expands on hover to reveal the quarter label. Lives inside the centered FAB column.
      + '.tb-live-fab{position:relative;height:46px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:23px;background:#12261a;color:#4ade80;border:1px solid #2f7a4a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:46px;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s;animation:tbLiveGlow 1.6s ease-in-out infinite}'
      + '.tb-live-fab .tb-live-ic{flex:0 0 58px;width:58px;height:58px;display:inline-flex;align-items:center;justify-content:center;position:relative}'
      // Bump the Live + Analytics FAB outer size to match the enlarged 58px rail pills.
      + '.tb-an-fab,.tb-live-fab{height:58px!important;max-width:58px!important;border-radius:29px!important}'
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
      + '.tb-nav-fab{position:relative;height:58px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:29px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#e6edf0;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:58px;transition:max-width .28s ease}'
      + '.tb-nav-fab .tb-nav-ic{flex:0 0 58px;width:58px;height:58px;display:inline-flex;align-items:center;justify-content:center;position:relative}'
      + '.tb-nav-fab .tb-nav-ic svg{width:24px;height:24px}'
      // Custom PNG icon (e.g. Unique cases -> important.png). Fit inside the icon slot.
      + '.tb-nav-fab .tb-nav-img{width:28px;height:28px;object-fit:contain;display:block}'
      // The Upload FAB is a <button>; reset the default button chrome so it matches the <a> pills.
      + 'button.tb-nav-fab{font-family:inherit;cursor:pointer;text-align:left}'
      // Upload FAB is highlighted (accent orange) so it stands out as the "add new data" action.
      + '.tb-nav-fab.tb-nav-upload{background:linear-gradient(120deg,#ff9f2e,#f07d0a,#ff9f2e);background-size:220% 220%;animation:tbFabGrad 6s ease infinite;color:#1a1206;border-color:#ffb454}'
      + '.tb-nav-fab.tb-nav-upload .tb-nav-label{color:#1a1206;font-weight:700}'
      + '.tb-nav-fab.tb-nav-upload .tb-nav-ic svg{color:#1a1206}'
      + '.tb-nav-fab.tb-nav-upload.tb-nav-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655}'
      + '.tb-nav-fab.tb-nav-upload.tb-nav-disabled .tb-nav-label,.tb-nav-fab.tb-nav-upload.tb-nav-disabled .tb-nav-ic svg{color:#8b98a5}'
      + '.tb-nav-fab.tb-nav-disabled{cursor:not-allowed}'
      // ---- Reports fly-out (line-chart group) ----
      // Wrapper is the drop anchor. The trigger is a 46px pill (line-chart) that never expands/drags.
      + '.tb-flyout-wrap{position:relative;display:flex;align-items:center}'
      // Trigger pill (Data/Reports/Issue Types/Program History). Has its own flyout -> hover gives it a
      // SKY-BLUE background (per spec). Icon is light so it reads on the dark pill.
      + '.tb-flyout-fab{position:relative;height:58px;width:58px;flex:0 0 58px;display:inline-flex;align-items:center;justify-content:center;border-radius:29px;background:linear-gradient(120deg,#12243a,#2a3f63,#153a4a,#3a2a63,#12243a);background-size:320% 320%;animation:tbFabGrad 6s ease infinite;color:#e6edf0;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);cursor:pointer}'
      // Trigger icon colour matches its border (#3a4f74) at rest (set via the override block below too).
      + '.tb-flyout-fab .tb-nav-ic{flex:0 0 58px;width:58px;height:58px;display:inline-flex;align-items:center;justify-content:center;color:#3a4f74}'
      + '.tb-flyout-fab .tb-nav-ic svg{width:24px;height:24px;color:#3a4f74;stroke:#3a4f74}'
      // Flyout trigger -> SKY-BLUE on hover of the WHOLE item (box + caption), not just the icon.
      + '.tb-fab-col .tb-fab-item:hover .tb-flyout-fab,.tb-fab-col .tb-flyout-wrap:hover .tb-flyout-fab{border-color:#38bdf8!important;background:#0ea5e9!important;color:#06293a!important}'
      + '.tb-fab-col .tb-fab-item:hover .tb-flyout-fab .tb-nav-ic,.tb-fab-col .tb-fab-item:hover .tb-flyout-fab .tb-nav-ic svg,.tb-fab-col .tb-flyout-wrap:hover .tb-flyout-fab .tb-nav-ic,.tb-fab-col .tb-flyout-wrap:hover .tb-flyout-fab .tb-nav-ic svg{color:#06293a!important;stroke:#06293a!important}'
      // Caption darkens on the sky-blue trigger hover too.
      + '.tb-fab-col .tb-fab-item:has(.tb-flyout-fab):hover .tb-fab-cap{color:#06293a!important}'
      // The fly-out PANEL: sits to the RIGHT of the trigger. A real card now — dark background, border,
      // rounded, shadow, padding — holding its items as a horizontal row of icon-above-label cards.
      // The fly-out PANEL: a light (white/gray) card matching the page background, vertical column of
      // items, bordered + rounded + shadow. Fixed-ish width (~1 extra rail worth of room ~ 5vw+) so
      // item labels have space to sit beside their icons and wrap gracefully.
      // Width = FIT-TO-CONTENT, capped so a group with short labels stays compact and one with long
      // labels wraps instead of growing unbounded. (min keeps it from collapsing too narrow.)
      + '.tb-flyout{position:absolute;left:44px;top:50%;transform:translateY(-50%) translateX(-8px);display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:2px;padding:6px;width:max-content;min-width:160px;max-width:240px;max-height:80vh;overflow-y:auto;background:#f5f6f8;border:1px solid #d4dade;border-radius:12px;box-shadow:0 16px 40px rgba(20,30,50,.28);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease,transform .22s ease;z-index:1200}'
      // Invisible bridge spanning the gap between the trigger and the panel so the hover never drops.
      + '.tb-flyout::before{content:"";position:absolute;left:-14px;top:0;bottom:0;width:18px}'
      // Show the flyout when hovering the whole button item (box + caption), the wrap, OR the flyout.
      + '.tb-fab-item:hover .tb-flyout,.tb-flyout-wrap:hover .tb-flyout,.tb-flyout:hover{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(-50%) translateX(0)}'
      // Each fly-out item: a ROW — CIRCULAR bordered icon chip on the LEFT, page name on the RIGHT
      // (always visible, wraps, no slide). Full-width rows in the panel; transparent at rest, ORANGE
      // on hover (it opens a page).
      + '.tb-flyout .tb-flyout-item{flex:0 0 auto!important;display:flex!important;flex-direction:row;align-items:center;justify-content:flex-start;gap:9px;width:100%!important;max-width:100%!important;height:auto!important;min-height:0;padding:3px 8px;border-radius:12px;background:#f5f6f8;border:1px solid transparent;box-shadow:none;overflow:visible;text-decoration:none;transition:background .14s,border-color .14s,color .14s}'
      // The circular icon chip (always bordered -> round button), fixed size so it stays a perfect circle.
      + '.tb-flyout .tb-flyout-item .tb-nav-ic{flex:0 0 36px!important;width:36px!important;height:36px!important;border-radius:50%!important;border:1px solid #c3ccd4;background:#fff;display:inline-flex!important;align-items:center;justify-content:center;color:#2a3f63}'
      + '.tb-flyout .tb-flyout-item .tb-nav-ic svg{width:18px!important;height:18px!important;color:#2a3f63;stroke:#2a3f63}'
      + '.tb-flyout .tb-flyout-item .tb-nav-img{width:18px!important;height:18px!important;object-fit:contain;display:block}'
      // The page name beside the icon — ALWAYS visible, left-aligned, wraps. position:static + no
      // padding transition kills the old slide-in effect.
      + '.tb-flyout .tb-flyout-item .tb-nav-label{display:block!important;opacity:1!important;position:static!important;padding:0!important;margin:0!important;flex:1 1 auto;max-width:none!important;font-size:.82em;font-weight:600;line-height:1.3;color:#1b2026;text-align:left;white-space:normal;word-break:normal;overflow-wrap:anywhere;transition:color .14s!important}'
      // Hover a PAGE item -> ORANGE card (background + border); icon chip stays white, text darkens.
      + '.tb-flyout .tb-flyout-item:hover{background:#ff9900;border-color:#ff9900}'
      + '.tb-flyout .tb-flyout-item:hover .tb-nav-ic{background:#fff;border-color:#fff;color:#b45309}'
      + '.tb-flyout .tb-flyout-item:hover .tb-nav-ic svg{color:#b45309;stroke:#b45309}'
      + '.tb-flyout .tb-flyout-item:hover .tb-nav-label{color:#1a1206}'
      // Disabled flyout item stays muted even on hover.
      + '.tb-flyout .tb-flyout-item.tb-nav-disabled{opacity:.5}'
      + '.tb-flyout .tb-flyout-item.tb-nav-disabled:hover{background:transparent;border-color:transparent}'
      + '.tb-flyout .tb-flyout-item.tb-nav-disabled:hover .tb-nav-ic{background:#fff;border-color:#c3ccd4;color:#9aa6b1}'
      + '.tb-flyout .tb-flyout-item.tb-nav-disabled:hover .tb-nav-ic svg{color:#9aa6b1;stroke:#9aa6b1}'
      + '.tb-flyout .tb-flyout-item.tb-nav-disabled:hover .tb-nav-label{color:#9aa6b1}'
      // Kill the base theme\'s hover width-expand on flyout items (no longer needed; items are static).
      + '.tb-flyout .tb-flyout-item.tb-nav-fab:hover{max-width:none!important;transform:none!important}'
      // Count badge (e.g. open alerts) pinned to the top-right of the FAB icon. Auto-sizes to its
      // content (width:auto + no clipping) so a multi-digit count is shown in full, not hidden.
      + '.tb-nav-badge{display:none;position:absolute;top:-5px;right:-5px;min-width:18px;width:auto;height:18px;padding:0 5px;border-radius:20px;background:#ff5252;color:#fff;font-size:.64em;font-weight:800;line-height:18px;text-align:center;white-space:nowrap;overflow:visible;box-sizing:border-box;box-shadow:0 0 0 2px #1b2430;z-index:3}'
      + '.tb-nav-badge.show{display:block}'
      + '.tb-nav-badge.zero{background:#3a4655;color:#cdd7de}'
      // Loading state: neutral grey pill with a tiny spinner instead of a premature "0".
      + '.tb-nav-badge.loading{background:#3a4655;padding:0;display:flex;align-items:center;justify-content:center}'
      + '.tb-nav-badge-spin{display:inline-block;width:9px;height:9px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:tbBadgeSpin .7s linear infinite}'
      + '@keyframes tbBadgeSpin{100%{transform:rotate(360deg)}}'
      // Captions are always visible now, so the hover-expand label is redundant AND it shifted the
      // centered column on hover. Keep the pill a fixed 46px circle and hide the slide-out label;
      // hover just gives a subtle background/lift instead.
      + '.tb-nav-fab .tb-nav-label{display:none!important}'
      + '.tb-nav-fab:hover{max-width:58px;transform:translateY(-2px);border-color:#3a4f74}'
      // EXCEPT inside a fly-out panel: those items still expand on hover to reveal their label.
      + '.tb-flyout-item.tb-nav-fab .tb-nav-label{display:inline!important;white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-flyout-item.tb-nav-fab:hover{max-width:340px;transform:none}'
      + '.tb-flyout-item.tb-nav-fab:hover .tb-nav-label{opacity:1;padding-right:18px}'
      // Rail item = icon pill on top + an always-visible caption below.
      + '.tb-fab-item{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;padding:6px 2px;border-radius:14px;transition:background .15s}'
      + '.tb-fab-cap{font-size:11px;font-weight:600;line-height:1.15;color:#9fb0c3;text-align:center;max-width:9vw;white-space:normal;word-break:break-word;letter-spacing:.2px;pointer-events:none;transition:transform .15s,color .15s}'
      + '.tb-fab-cap.is-disabled{color:#6b7681}'
      // Hover the whole item: subtle background + scale the caption up a touch.
      + '.tb-fab-item:hover{background:rgba(255,255,255,.06)}'
      + '.tb-fab-item:hover .tb-fab-cap{transform:scale(1.12);color:#e6edf0}'
      // Rail badge (GSOC logo + profile avatar): a fixed 46px circle. Its label is ABSOLUTELY
      // positioned to the RIGHT of the circle and slides in on hover — so it escapes the narrow rail
      // to the right (never clipped) and never changes the column width or position.
      + '.tb-rail-badge{position:relative;width:58px;height:58px;flex:0 0 58px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;overflow:visible;background:#0b1420;border:1px solid #2a3f63;box-shadow:0 6px 18px rgba(0,0,0,.45);cursor:pointer;text-decoration:none;transition:border-color .15s,transform .15s;padding:0;font-family:inherit}'
      + 'button.tb-rail-badge{-webkit-appearance:none;appearance:none}'
      + '.tb-rail-badge:hover{border-color:#ff9900;transform:translateY(-2px)}'
      + '.tb-rail-badge-label{position:absolute;left:68px;top:50%;transform:translateY(-50%) translateX(-6px);white-space:nowrap;background:#121820;border:1px solid #2a3f63;color:#e6edf0;font-size:.86em;font-weight:700;padding:9px 15px;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;z-index:20}'
      + '.tb-rail-badge:hover .tb-rail-badge-label{opacity:1;transform:translateY(-50%) translateX(0)}'
      // GSOC logo image inside its badge.
      + '.tb-rail-logo .tb-rail-logo-img{width:36px;height:36px;object-fit:contain;display:block}'
      // Profile avatar fills its badge circle. The badge stays overflow:visible (so the hover label can
      // escape to the right); the AVATAR itself is clipped to a circle via its own inner wrapper.
      + '.tb-rail-profile .tb-rail-av{width:54px;height:54px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-rail-profile .tb-rail-av img,.tb-rail-profile .avatar-initial{width:54px!important;height:54px!important;border-radius:50%!important;object-fit:cover;display:inline-flex;align-items:center;justify-content:center}'
      // Logged-out state: the "Log in" user icon (wrapped in .tb-nav-ic) needs its own sizing/color
      // inside the rail badge — otherwise the SVG has no size and appears blank.
      + '.tb-rail-profile .tb-nav-ic{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9fb0c3}'
      + '.tb-rail-profile .tb-nav-ic svg{width:24px;height:24px}'
      + '.tb-rail-profile:hover .tb-nav-ic{color:#ff9900}'
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
      // Fill the content area edge-to-edge (drop max-width caps + auto side margins + side padding).
      // .content pages (app.html / index.html) carry their own header row (.js-header-row) which
      // supplies the top gap, so .content keeps padding-top:0. Plain pages use a bare .wrap with NO
      // header row, so .wrap gets a 14px top gap that matches the rail logo/profile offset
      // (rail padding is 14px) — this lines the first content block up with the GSOC + profile
      // avatars on EVERY page. Pages that set their own .wrap padding-top (index.html) still win.
      + '.content{max-width:none!important;width:auto!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;padding-top:0!important}'
      + '.wrap{max-width:none!important;width:auto!important;margin-left:0!important;margin-right:0!important;padding-left:0!important;padding-right:0!important;padding-top:14px!important}'
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
    // ---- PHDBanner: full-width status bar at the top (blue = success/info, red = error) ----
    css += ''
      + '.phd-banner{position:fixed;top:0;left:0;right:0;z-index:4000;display:flex;align-items:center;gap:12px;'
      +   'padding:11px 18px;font-family:inherit;font-size:.9em;font-weight:600;color:#fff;'
      +   'transform:translateY(-100%);opacity:0;transition:transform .28s cubic-bezier(.2,.7,.2,1),opacity .2s;'
      +   'box-shadow:0 6px 20px rgba(0,0,0,.4)}'
      + '.phd-banner.show{transform:translateY(0);opacity:1}'
      + '.phd-banner.ok{background:linear-gradient(90deg,#1668e3,#2f7ff0)}'      // blue (200/info)
      + '.phd-banner.err{background:linear-gradient(90deg,#d92d3a,#e5484d)}'     // red (errors)
      + '.phd-banner.warn{background:linear-gradient(90deg,#c9820a,#e0a020)}'    // amber (warnings)
      + '.phd-banner .pb-ic{flex-shrink:0;display:inline-flex;align-items:center}'
      + '.phd-banner .pb-ic svg{width:18px;height:18px}'
      + '.phd-banner .pb-msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.phd-banner .pb-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:tbspin .8s linear infinite;flex-shrink:0}'
      + '.phd-banner .pb-action{flex-shrink:0;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.5);color:#fff;'
      +   'border-radius:20px;padding:5px 14px;font-size:.9em;font-weight:700;cursor:pointer;font-family:inherit}'
      + '.phd-banner .pb-action:hover{background:rgba(255,255,255,.28)}'
      + '.phd-banner .pb-close{flex-shrink:0;background:transparent;border:none;color:#fff;font-size:1.3em;line-height:1;cursor:pointer;padding:0 4px;opacity:.85}'
      + '.phd-banner .pb-close:hover{opacity:1}'
      // Nudge the fixed left rail + page down while a banner is showing so it doesn\'t cover content.
      + 'body.phd-banner-open{padding-top:46px!important}'
      + 'body.phd-banner-open .tb-fab-col{top:46px}'
      // ---- Smaller rail buttons (narrow 5vw rails). Scale every 58px pill/badge down to 44px and
      //      shrink their icons/captions to match. Appended last so it overrides the sizes above. ----
      + '.tb-nav-fab,.tb-flyout-fab,.tb-rail-badge,.tb-an-fab,.tb-live-fab{height:44px!important;width:44px!important;min-width:44px!important;max-width:44px!important;flex:0 0 44px!important;border-radius:22px!important;justify-content:center!important;transition:transform .15s ease,border-color .15s ease,background .15s ease!important}'
      // (Flyout-item icons are sized by the .tb-flyout block; exclude them here so the round chip holds.)
      + '.tb-nav-fab:not(.tb-flyout-item) .tb-nav-ic,.tb-flyout-fab .tb-nav-ic,.tb-an-fab .tb-an-ic,.tb-live-fab .tb-live-ic{flex:0 0 44px!important;width:44px!important;height:44px!important}'
      + '.tb-nav-fab:not(.tb-flyout-item) .tb-nav-ic svg,.tb-flyout-fab .tb-nav-ic svg,.tb-an-fab .tb-an-ic svg,.tb-rail-badge svg{width:19px!important;height:19px!important}'
      + '.tb-nav-fab .tb-nav-img{width:22px!important;height:22px!important}'
      // Analytics + flyout-trigger custom PNG icons — fit inside the pill like the other rail icons.
      + '.tb-an-fab .tb-an-img{width:22px!important;height:22px!important;object-fit:contain;display:block}'
      + '.tb-flyout-fab .tb-nav-img{width:22px!important;height:22px!important;object-fit:contain;display:block}'
      + '.tb-live-fab .tb-live-ic{position:relative}'
      // Hover should not re-expand the fixed-width rail pills (keep them 44px).
      + '.tb-nav-fab:hover{max-width:44px!important}'
      // ---- Hover = SCALE the ICON to 1.25x, no lift. Remove the translateY from the pill hovers so the
      //      button stays put and only its icon grows. Covers rail nav pills (PHD Tools/Shift Report/
      //      Alerts), flyout triggers (Data/Reports/Issue Types/Program History), Analytics, and the
      //      flyout-panel items. Driven by the parent .tb-fab-item:hover (fires over the whole button).
      + '.tb-nav-fab:hover,.tb-an-fab:hover,.tb-flyout-fab:hover{transform:none!important}'
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab,.tb-fab-col .tb-fab-item:hover .tb-an-fab,.tb-fab-col .tb-fab-item:hover .tb-flyout-fab,.tb-fab-col .tb-flyout-wrap:hover .tb-flyout-fab{transform:none!important}'
      // Give the icon elements a smooth scale transition.
      + '.tb-nav-fab .tb-nav-ic,.tb-flyout-fab .tb-nav-ic,.tb-an-fab .tb-an-ic,.tb-flyout .tb-flyout-item .tb-nav-ic{transition:transform .16s ease!important}'
      // Scale the rail icons 1.5x when the whole item (or wrap) is hovered. Exclude flyout-PANEL items
      // (.tb-flyout-item) — those are .tb-nav-fab too and would otherwise all scale the moment the
      // flyout opens; they get their own per-item hover rule below.
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab:not(.tb-flyout-item) .tb-nav-ic,.tb-fab-col .tb-fab-item:hover .tb-an-fab .tb-an-ic,.tb-fab-col .tb-fab-item:hover .tb-flyout-fab .tb-nav-ic,.tb-fab-col .tb-flyout-wrap:hover .tb-flyout-fab .tb-nav-ic{transform:scale(1.25)!important}'
      // Scale a flyout-panel item\'s icon chip 1.25x on its own hover (keeps the orange card, no lift).
      + '.tb-flyout .tb-flyout-item:hover .tb-nav-ic{transform:scale(1.25)!important}'
      // The rail pills clip with overflow:hidden (to hide their collapsed label) — let the scaled icon
      // spill out on hover instead of being cropped.
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab,.tb-nav-fab:hover{overflow:visible!important}'
      // NOTE: flyout-item sizing is owned by the .tb-flyout block (vertical icon+label cards); do not
      // force width/height on them here (that would flatten the cards).
      // ---- Direct-link rail pills (My Tickets / PHD Tools / Shift Report / Alerts / Analytics) that
      //      navigate straight to a page: TRANSPARENT at rest, ORANGE background on hover. (Exclude the
      //      Upload pill which is already orange, the flyout triggers, flyout items, and the Live pill.) ----
      + '.tb-fab-col .tb-nav-fab:not(.tb-nav-upload):not(.tb-flyout-item):not(.tb-flyout-fab),.tb-fab-col .tb-an-fab,.tb-fab-col .tb-flyout-fab{background:transparent!important;border:none!important;box-shadow:none!important;animation:none!important}'
      // No circular ring on the rail icons — drop the border on every rail pill incl. the orange Upload.
      + '.tb-fab-col .tb-nav-fab.tb-nav-upload{border:none!important}'
      // Upload pill: no orange background at rest — match the other transparent rail pills (icon tint
      // + dark ink on the orange hover fill, which the shared hover rules below provide).
      + '.tb-fab-col .tb-nav-fab.tb-nav-upload{background:transparent!important;animation:none!important}'
      + '.tb-fab-col .tb-nav-fab.tb-nav-upload .tb-nav-ic svg{color:#cfe0f2!important;stroke:#cfe0f2!important}'
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab.tb-nav-upload{background:#ff9900!important}'
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab.tb-nav-upload .tb-nav-ic svg{color:#1a1206!important;stroke:#1a1206!important}'
      // Flyout TRIGGER icons (Data/Reports/Issue Types/Program History) = their border colour (#3a4f74),
      // not white. (Hover turns the whole chip sky-blue + dark icon, handled above.)
      + '.tb-fab-col .tb-flyout-fab .tb-nav-ic,.tb-fab-col .tb-flyout-fab .tb-nav-ic svg{color:#3a4f74!important;stroke:#3a4f74!important}'
      + '.tb-fab-col .tb-nav-fab:not(.tb-nav-upload):not(.tb-flyout-item):not(.tb-flyout-fab) .tb-nav-ic,.tb-fab-col .tb-nav-fab:not(.tb-nav-upload):not(.tb-flyout-item):not(.tb-flyout-fab) .tb-nav-ic svg,.tb-fab-col .tb-an-fab .tb-an-ic,.tb-fab-col .tb-an-fab .tb-an-ic svg{color:#cfe0f2!important;stroke:#cfe0f2!important}'
      // Hover the WHOLE item (padding + caption, not just the icon) -> orange pill. Driven by the
      // parent .tb-fab-item:hover so the colour change fires anywhere over the button.
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab:not(.tb-nav-upload):not(.tb-flyout-item):not(.tb-flyout-fab),.tb-fab-col .tb-fab-item:hover .tb-an-fab{background:#ff9900!important;border-color:#ff9900!important}'
      + '.tb-fab-col .tb-fab-item:hover .tb-nav-fab:not(.tb-nav-upload):not(.tb-flyout-item):not(.tb-flyout-fab) .tb-nav-ic,.tb-fab-col .tb-fab-item:hover .tb-nav-fab:not(.tb-nav-upload):not(.tb-flyout-item):not(.tb-flyout-fab) .tb-nav-ic svg,.tb-fab-col .tb-fab-item:hover .tb-an-fab .tb-an-ic,.tb-fab-col .tb-fab-item:hover .tb-an-fab .tb-an-ic svg{color:#1a1206!important;stroke:#1a1206!important}'
      // Caption also goes dark on the orange item hover.
      + '.tb-fab-col .tb-fab-item:hover .tb-fab-cap{color:#1a1206!important}'
      // Profile + logo avatar images fill the smaller 44px badge.
      + '.tb-rail-logo .tb-rail-logo-img{width:28px!important;height:28px!important}'
      + '.tb-rail-profile .tb-rail-av{width:40px!important;height:40px!important}'
      + '.tb-rail-profile .tb-rail-av img,.tb-rail-profile .avatar-initial{width:40px!important;height:40px!important}'
      // Tighter caption under each pill for the narrower rail.
      + '.tb-fab-cap{font-size:10px!important;max-width:5vw!important}'
      // Back button a touch smaller too.
      + '.tb-back-fab{width:46px!important;height:46px!important}'
      + '.tb-back-fab svg{width:20px!important;height:20px!important}'
      // Let the alert-count badge spill OUTSIDE the pill (the pill clips its label with overflow:hidden,
      // which was hiding the count). A pill that actually contains a badge gets overflow:visible.
      + '.tb-nav-fab:has(.tb-nav-badge){overflow:visible!important}'
      + '.tb-nav-fab:has(.tb-nav-badge) .tb-nav-ic{overflow:visible!important}'
      // ================= RIGHT PROFILE PANEL (3-column shell on app.html) =================
      // Pages that set body[data-profile-panel] get a fixed right-hand PROFILE PANEL (banner with
      // avatar + name + group) instead of the thin right FAB rail. The page reserves ~26vw on the
      // right (center content ~60vw, left rail ~5vw + gaps).
      // 3-column spacing model: all columns start 10px from the top; the horizontal gap between
      // columns is a single value (14px) applied equally on both sides of the center.
      //   left pad  = 10px (nav-rail left) + 5vw (nav width) + 14px (gap)
      //   right pad = 10px (profile right) + 26vw (profile width) + 14px (gap)
      // Layout: [7.5px | nav 6vw | main-col (auto) | 10px gap | profile 34vw | 7.5px].
      // Layout (ALL pages): [4px | nav rail 5vw | 5px gap | main (auto) | 5px gap | profile 25vw | 4px].
      // Left pad = 4 + 5vw + 5 reserves the rail + its 5px gap; right pad = 4 + 25vw + 5 reserves the
      // profile column + its 5px gap.
      + 'body[data-profile-panel]{position:relative;padding-left:calc(4px + 5vw + 5px)!important;padding-right:calc(4px + 25vw + 5px)!important;padding-top:10px!important}'
      + 'body[data-profile-panel] .tb-fab-col-right{display:none!important}'   // hide the old thin right rail
      // Profile column FLOWS WITH THE PAGE: absolutely placed at the top-right (no fixed, no bottom
      // anchor, no own scrollbar) so it scrolls together with the main page instead of having its own
      // independent scroll region.
      + '.tb-profile-panel{position:absolute;top:10px;right:4px;width:25vw;z-index:900;display:flex;flex-direction:column;gap:14px;padding:0;box-sizing:border-box;background:transparent;pointer-events:auto}'
      // Compact banner: orange gradient, rounded. ONE row — avatar + (name·role / handle) + links.
      // No group line, no decorative arc.
      + '.tb-pp-banner{position:relative;overflow:hidden;border-radius:16px;border:1px solid #e2a24a;box-shadow:0 10px 26px -16px rgba(0,0,0,.5);background:linear-gradient(100deg,#f0820f,#ff9f2e 55%,#ffc879)}'
      + '.tb-pp-body{display:flex;align-items:center;gap:13px;padding:14px 16px}'
      + '.tb-pp-av{flex:0 0 auto;width:56px;height:56px;border-radius:50%;overflow:hidden;background:#fff;border:2px solid rgba(255,255,255,.85);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.25)}'
      + '.tb-pp-av img,.tb-pp-av .avatar-initial{width:56px!important;height:56px!important;border-radius:50%!important;object-fit:cover}'
      + '.tb-pp-meta{min-width:0;display:flex;flex-direction:column;gap:2px}'
      + '.tb-pp-namerow{display:flex;align-items:center;gap:8px;min-width:0}'
      + '.tb-pp-name{color:#2a1706;font-size:1.02em;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.tb-pp-handle{color:rgba(42,23,6,.7);font-weight:600;font-size:.8em}'
      + '.tb-pp-badge{flex:0 0 auto;display:inline-flex;align-items:center;background:rgba(42,23,6,.16);color:#2a1706;font-size:.66em;font-weight:800;letter-spacing:.3px;text-transform:uppercase;padding:2px 8px;border-radius:999px}'
      // Links on the RIGHT of the banner: a top row of ghost chips (Profile + Logout) over the
      // solid "My Tickets" pill. The column shrinks to the chip-row width; My Tickets stretches to it.
      + '.tb-pp-links{margin-left:auto;flex:0 0 auto;display:inline-flex;flex-direction:column;align-items:stretch;gap:7px;width:max-content}'
      // Ghost chips (Profile, Logout): translucent-white pill on the orange banner.
      + '.tb-pp-link,.tb-pp-logout{display:inline-flex;align-items:center;gap:5px;font-family:inherit;font-size:.74em;font-weight:800;letter-spacing:.2px;text-decoration:none;cursor:pointer;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.22);color:#2a1706;border:1px solid rgba(255,255,255,.5);transition:background .14s,transform .12s}'
      + '.tb-pp-link:hover,.tb-pp-logout:hover{background:rgba(255,255,255,.42);transform:translateY(-1px)}'
      + '.tb-pp-link svg,.tb-pp-logout svg{width:12px;height:12px}'
      // Logout gets a subtle red tint so it reads as the "exit" action.
      + '.tb-pp-logout{background:rgba(176,32,32,.16);border-color:rgba(176,32,32,.3);color:#7a1414}'
      + '.tb-pp-logout:hover{background:rgba(176,32,32,.28)}'
      + '.tb-pp-links-top{display:inline-flex;align-items:center;gap:6px}'
      // Solid "My Tickets" pill below the chips — stretches to the full links-column width (= the
      // combined Profile + Logout chip-row width).
      + '.tb-pp-mytickets{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;text-decoration:none;background:#fff;color:#b45309;font-weight:800;font-size:.8em;padding:7px 14px;border-radius:999px;box-shadow:0 3px 10px -4px rgba(0,0,0,.45);transition:transform .12s,filter .15s,box-shadow .15s;white-space:nowrap}'
      + '.tb-pp-mytickets:hover{transform:translateY(-1px);filter:brightness(1.02);box-shadow:0 5px 14px -5px rgba(0,0,0,.55)}'
      + '.tb-pp-mytickets svg{width:14px;height:14px}'
      + '.tb-pp-mytickets .tb-pp-ic-img{width:15px;height:15px;object-fit:contain}'
      // Capital (Title) case for ALL toolbar-built buttons + nav links + rail captions, matching the
      // app-wide default (the stylesheet capitalize rule can\'t reach these toolbar-only classes).
      // Visual-only; !important so no per-class rule above wins. Does not touch role/badge pills that
      // are intentionally UPPERCASE (those set their own text-transform:uppercase).
      + '.tb-pp-link,.tb-pp-logout,.tb-pp-mytickets,.tb-pp-login-btn,.tb-fab-cap,.tb-nav-label,.tb-data-btn,.tb-btn,.tb-mbtn,.tb-menuitem,.tb-hist-item,.tb-hist-name,.tb-qbtn,.tb-profile-name,.tb-an-label,.tb-live-label,.tb-hist-label,.tb-av-label,.tb-rail-badge-label{text-transform:capitalize!important}'
      // Vertical stack of SEPARATE section cards.
      + '.tb-pp-stack{display:flex;flex-direction:column;gap:12px}'
      + '.tb-pp-card{background:#fff;border:1px solid #e2e6ea;border-radius:14px;box-shadow:0 1px 3px rgba(20,30,50,.06);overflow:hidden}'
      + '.tb-pp-card-h{display:flex;align-items:center;gap:9px;padding:11px 14px 0}'
      + '.tb-pp-ic{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:#fff4e8;color:#ec7211;flex-shrink:0}'
      + '.tb-pp-ic svg{width:15px;height:15px}'
      + '.tb-pp-ic-img{width:16px;height:16px;object-fit:contain;display:block}'
      + '.tb-pp-ic .tb-pp-ic-fb{display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-pp-card-t{color:#1b2026;font-size:.82em;font-weight:800;letter-spacing:.2px}'
      + '.tb-pp-card-b{padding:12px 14px 14px}'
      // ---- Weekly Performance Summary card (managers + owners) ----
      + '.tb-pp-card-weekly .tb-pp-ic{background:#fff4e8;color:#ec7211}'
      // Collapsible header: the whole row is a button. Reset native button styling; align children.
      + '.tb-ws-head{width:100%;display:flex;flex-wrap:nowrap;align-items:center;gap:9px;padding:11px 14px;background:transparent;border:none;font:inherit;text-align:left;cursor:pointer}'
      + '.tb-ws-head:hover{background:#fafbfc}'
      + '.tb-ws-head-meta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}'
      + '.tb-ws-head-meta .tb-pp-card-t{white-space:normal;line-height:1.25}'
      + '.tb-pp-summ-stack{display:flex;flex-direction:column;gap:12px}'
      + '.tb-ws-caret{flex:0 0 auto;display:inline-flex;color:#9aa5b1;transition:transform .3s ease}'
      + '.tb-pp-card-weekly.open .tb-ws-caret{transform:rotate(180deg)}'
      // Card body collapses by default; expands when the card gets .open (per-card toggle).
      + '.tb-ws-collapse{display:grid;grid-template-rows:0fr;padding:0 14px;transition:grid-template-rows .3s ease,padding .3s ease;overflow:hidden}'
      + '.tb-ws-collapse > *{min-height:0;overflow:hidden}'
      + '.tb-pp-card-weekly.open .tb-ws-collapse{grid-template-rows:1fr;padding:2px 14px 14px}'
      + '.tb-ws-sub{color:#5c6773;font-size:.72em;font-weight:700}'
      + '.tb-ws-export{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-family:inherit;font-size:.66em;font-weight:800;letter-spacing:.2px;text-transform:uppercase;cursor:pointer;padding:5px 11px;border:1px solid #f3d4b0;border-radius:8px;background:#fff4e8;color:#b5560c;box-shadow:0 1px 2px rgba(20,30,50,.06);transition:background .14s,color .14s,border-color .14s,transform .12s}'
      + '.tb-ws-export:hover{background:#ec7211;border-color:#ec7211;color:#fff;transform:translateY(-1px)}'
      + '.tb-ws-export.copied{background:#eafaf0;border-color:#c8efd8;color:#1f9d57}'
      + '.tb-ws-export svg{width:12px;height:12px;flex:0 0 auto}'
      + '.tb-ws-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}'
      + '.tb-ws-kpi{background:#f7f9fb;border:1px solid #eef1f4;border-radius:10px;padding:9px 11px}'
      + '.tb-ws-k{font-size:.64em;font-weight:800;text-transform:uppercase;letter-spacing:.3px;color:#5c6773}'
      + '.tb-ws-vrow{display:flex;align-items:baseline;gap:6px;margin-top:4px;flex-wrap:wrap}'
      + '.tb-ws-v{font-size:1.15em;font-weight:800;color:#1b2026;line-height:1}'
      + '.tb-ws-note{font-size:.68em;font-weight:600;color:#5c6773;margin-top:4px}'
      + '.tb-ws-delta{display:inline-flex;align-items:center;gap:2px;font-size:.64em;font-weight:800;padding:1px 6px;border-radius:999px;white-space:nowrap}'
      + '.tb-ws-delta svg{width:9px;height:9px}'
      + '.tb-ws-delta.good{background:#eafaf0;color:#1f9d57;border:1px solid #c8efd8}'
      + '.tb-ws-delta.bad{background:#fdeaea;color:#d33a3a;border:1px solid #f6cccc}'
      + '.tb-ws-div{height:1px;background:#eef1f4;margin:14px 0}'
      + '.tb-ws-block-h{font-size:.7em;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#1b2026;margin-bottom:9px}'
      + '.tb-ws-rows{display:flex;flex-direction:column;gap:7px}'
      + '.tb-ws-row{padding:9px 11px;border-radius:9px;border:1px solid #eef1f4;background:#fafbfc}'
      + '.tb-ws-row.improving{border-left:3px solid #1f9d57}'
      + '.tb-ws-row.watch{border-left:3px solid #e08a1e}'
      + '.tb-ws-row-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap}'
      + '.tb-ws-row-label{font-size:.8em;font-weight:700;color:#1b2026}'
      + '.tb-ws-row-note{font-size:.74em;line-height:1.5;color:#5c6773;margin-top:5px}'
      + '.tb-ws-tag{font-size:.58em;font-weight:800;text-transform:uppercase;letter-spacing:.3px;padding:2px 7px;border-radius:999px}'
      + '.tb-ws-tag.improving{background:#eafaf0;color:#1f9d57}'
      + '.tb-ws-tag.watch{background:#fff3e0;color:#b5680c}'
      + '.tb-ws-note-line{font-size:.74em;line-height:1.5;color:#5c6773;margin-top:10px;font-style:italic}'
      + '.tb-pp-card-upload .tb-pp-ic{background:#eef5ff;color:#2563eb}'
      // ---- Logged-out (guest) panel: what-you-can-see list + a prominent login button ----
      + '.tb-pp-guest{display:flex;flex-direction:column;gap:9px}'
      + '.tb-pp-g-row{display:flex;align-items:flex-start;gap:9px;color:#2a3340;font-size:.8em;line-height:1.4}'
      + '.tb-pp-g-ic{flex:0 0 24px;width:24px;height:24px;border-radius:7px;background:#f0f3f6;color:#2563eb;display:inline-flex;align-items:center;justify-content:center;margin-top:1px}'
      + '.tb-pp-g-ic svg{width:14px;height:14px}'
      + '.tb-pp-login-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:12px;padding:11px 14px;border:none;border-radius:10px;background:linear-gradient(120deg,#ff9f2e,#ec7211);color:#fff;font-size:.86em;font-weight:800;letter-spacing:.2px;cursor:pointer;box-shadow:0 4px 12px -4px rgba(236,114,17,.6);transition:transform .12s,filter .15s}'
      + '.tb-pp-login-btn:hover{transform:translateY(-1px);filter:brightness(1.04)}'
      + '.tb-pp-login-btn:disabled{opacity:.65;cursor:default;transform:none}'
      + '.tb-pp-login-btn svg{width:15px;height:15px}'
      // Inline login form (replaces the popup) inside the guest "Log in to do more" card.
      + '.tb-pp-login-form{display:flex;flex-direction:column;margin-top:12px;padding-top:12px;border-top:1px solid #eef1f4}'
      + '.tb-pp-lf-label{color:#5c6773;font-size:.72em;font-weight:700;margin:0 0 4px}'
      + '.tb-pp-lf-input{width:100%;padding:9px 11px;margin-bottom:10px;border:1px solid #d4dade;border-radius:8px;background:#fff;color:#1b2026;font-size:.86em}'
      + '.tb-pp-lf-input:focus{outline:none;border-color:#ec7211;box-shadow:0 0 0 3px rgba(236,114,17,.14)}'
      + '.tb-pp-lf-remember{display:flex;align-items:center;gap:7px;color:#5c6773;font-size:.76em;font-weight:600;margin:2px 0 2px}'
      + '.tb-pp-lf-remember input{width:auto;margin:0}'
      + '.tb-pp-lf-err{display:none;color:#dc2626;font-size:.76em;font-weight:600;margin-top:8px}'
      // Collapsible wrapper: hidden by default, expands when the trigger adds .open.
      + '.tb-pp-login-wrap{max-height:0;overflow:hidden;opacity:0;transition:max-height .3s ease,opacity .2s ease}'
      + '.tb-pp-login-wrap.open{max-height:420px;opacity:1}'
      // Actions row (Cancel + Log in) at the bottom of the form.
      + '.tb-pp-lf-actions{display:flex;gap:8px;margin-top:12px}'
      + '.tb-pp-lf-cancel{flex:0 0 auto;padding:11px 14px;border:1px solid #d4dade;border-radius:10px;background:#fff;color:#2a3340;font-weight:800;font-size:.86em;cursor:pointer;transition:background .15s,border-color .15s}'
      + '.tb-pp-lf-cancel:hover{background:#f3f5f7;border-color:#c2cad1}'
      + '.tb-pp-lf-submit{flex:1;margin-top:0}'
      // "Upload log" BUTTON (icon + label) in the upload card header, right corner, vertically
      // centered with the title. The card header is align-items:center so it lines up with the title.
      + '.tb-pp-card-upload .tb-pp-card-t{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}'
      + '.tb-pp-up-loglink{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;text-decoration:none;color:#2563eb;font-size:.66em;font-weight:800;letter-spacing:.2px;text-transform:uppercase;white-space:nowrap;padding:5px 11px;border:1px solid #cfe0f2;border-radius:8px;background:#eef5ff;box-shadow:0 1px 2px rgba(20,30,50,.06);transition:background .14s,color .14s,border-color .14s,transform .12s}'
      + '.tb-pp-up-loglink:hover{background:#2563eb;border-color:#2563eb;color:#fff;transform:translateY(-1px)}'
      + '.tb-pp-up-loglink svg{width:13px;height:13px;flex:0 0 auto}'
      // Per-section REFRESH button in a card header (top-right). A round icon-only button; the icon
      // spins while a reload is in flight (.spinning). Default margin-left:auto pins it to the right.
      + '.tb-pp-reload{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid #e2e6ea;border-radius:8px;background:#fff;color:#5c6773;cursor:pointer;box-shadow:0 1px 2px rgba(20,30,50,.06);transition:background .14s,color .14s,border-color .14s,transform .14s}'
      + '.tb-pp-reload:hover{background:#fff4e8;border-color:#ec7211;color:#ec7211;transform:translateY(-1px)}'
      + '.tb-pp-reload svg{width:14px;height:14px;display:block}'
      + '.tb-pp-reload.spinning{pointer-events:none;color:#ec7211}'
      + '.tb-pp-reload.spinning svg{animation:tbPpSpin .7s linear infinite}'
      + '@keyframes tbPpSpin{to{transform:rotate(360deg)}}'
      // In the upload + agents cards the reload button is the FIRST right-side element (it carries
      // margin-left:auto), and the sibling that follows it (the Upload-log link or the "active today"
      // badge) only needs a small gap, not its own auto-margin.
      + '.tb-pp-card-upload .tb-pp-up-loglink{margin-left:8px}'
      + '.tb-pp-card-agents .tb-pp-ag-active{margin-left:8px}'
      // Stat tile grids.
      + '.tb-pp-grid{display:grid;gap:8px}'
      + '.tb-pp-grid-2{grid-template-columns:repeat(2,1fr)}'
      + '.tb-pp-grid-4{grid-template-columns:repeat(2,1fr)}'
      + '.tb-pp-grid-5{grid-template-columns:repeat(5,1fr)}'
      + '.tb-pp-stat{background:#f5f6f8;border:1px solid #e6eaef;border-radius:10px;padding:9px 8px;text-align:center;min-width:0}'
      + '.tb-pp-stat-n{font-size:1.15em;font-weight:900;line-height:1;color:#1b2026}'
      + '.tb-pp-stat-l{margin-top:4px;font-size:.64em;font-weight:700;letter-spacing:.2px;text-transform:uppercase;color:#5c6773;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.tb-pp-stat.res .tb-pp-stat-n{color:#15803d}'
      + '.tb-pp-stat.c-purple{border-top:3px solid #a78bfa}.tb-pp-stat.c-purple .tb-pp-stat-n{color:#6d28d9}'
      + '.tb-pp-stat.c-black{border-top:3px solid #6b7681}.tb-pp-stat.c-black .tb-pp-stat-n{color:#374151}'
      + '.tb-pp-stat.c-red{border-top:3px solid #ef4444}.tb-pp-stat.c-red .tb-pp-stat-n{color:#dc2626}'
      + '.tb-pp-stat.c-yellow{border-top:3px solid #f59e0b}.tb-pp-stat.c-yellow .tb-pp-stat-n{color:#b45309}'
      + '.tb-pp-stat.c-green{border-top:3px solid #22c55e}.tb-pp-stat.c-green .tb-pp-stat-n{color:#15803d}'
      + '.tb-pp-grid-5 .tb-pp-stat{padding:8px 2px}.tb-pp-grid-5 .tb-pp-stat-n{font-size:1em}.tb-pp-grid-5 .tb-pp-stat-l{font-size:.56em}'
      // Inline "LABEL ....... value | LABEL ....... value" pair rows (My open tickets / My resolved).
      // Each pair pushes its label to the LEFT corner and its value to the RIGHT corner.
      + '.tb-pp-pairs{display:flex;flex-direction:column;gap:7px}'
      + '.tb-pp-pair-row{display:flex;align-items:center;gap:10px}'
      + '.tb-pp-pair{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex:1 1 0;min-width:0}'
      + '.tb-pp-pair-l{font-size:.62em;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:#5c6773;white-space:nowrap}'
      + '.tb-pp-pair-n{font-size:.9em;font-weight:900;line-height:1;color:#1b2026;margin-left:auto}'
      + '.tb-pp-pair.res .tb-pp-pair-n{color:#15803d}'
      + '.tb-pp-pair-sep{flex:0 0 auto;color:#cfd6de;font-weight:400}'
      // Upload-change key/value rows. Fill the full parent width; key + value share the row 50/50
      // so the value no longer flings to the far edge leaving a wide empty gap.
      + '.tb-pp-up{display:flex;flex-direction:column;width:100%}'
      + '.tb-pp-up-row{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:10px;width:100%;padding:7px 2px;border-bottom:1px solid #eef1f4}'
      + '.tb-pp-up-row:last-child{border-bottom:none}'
      + '.tb-pp-up-k{color:#5c6773;font-size:.72em;font-weight:600}'
      + '.tb-pp-up-v{color:#1b2026;font-size:.82em;font-weight:800;text-align:right}'
      // ---- Sliding carousel (upload card <-> agents-activity card), swaps every 3s ----
      // Two slides stacked in a relative box; slide B is offset down + hidden, slide A is in view.
      // Adding .show-b slides A up/out and B into place. The box height tracks the ACTIVE slide via
      // grid-stacking (both occupy the same cell; the visible one dictates height through min-height).
      + '.tb-pp-slider-wrap{display:flex;flex-direction:column;gap:8px}'
      // Only the ACTIVE slide is in the DOM flow, so the slider is exactly as tall as the current
      // slide (NOT the tallest). This prevents the panel/page from growing to fit the biggest slide.
      // Inactive slides are display:none; the active one animates in via a direction-based keyframe.
      + '.tb-pp-slider{position:relative;overflow:hidden;border-radius:14px}'
      + '.tb-pp-slide{display:none}'
      + '.tb-pp-slide.active{display:block}'
      + '.tb-pp-slider[data-dir="next"] .tb-pp-slide.active{animation:tbSlideFromRight .4s ease both}'
      + '.tb-pp-slider[data-dir="prev"] .tb-pp-slide.active{animation:tbSlideFromLeft .4s ease both}'
      + '@keyframes tbSlideFromRight{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:translateX(0)}}'
      + '@keyframes tbSlideFromLeft{from{opacity:0;transform:translateX(-26px)}to{opacity:1;transform:translateX(0)}}'
      // Carousel control bar: prev / dots / next.
      + '.tb-pp-slider-ctrl{display:flex;align-items:center;justify-content:center;gap:12px}'
      + '.tb-pp-sl-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;border:1px solid #d4dade;background:#fff;color:#5c6773;cursor:pointer;padding:0;transition:background .14s,color .14s,border-color .14s,transform .12s}'
      + '.tb-pp-sl-btn:hover{background:#ec7211;border-color:#ec7211;color:#fff;transform:translateY(-1px)}'
      + '.tb-pp-sl-btn svg{width:15px;height:15px;display:block}'
      + '.tb-pp-sl-dots{display:inline-flex;align-items:center;gap:7px}'
      + '.tb-pp-sl-dot{width:7px;height:7px;border-radius:50%;background:#cfd6de;cursor:pointer;transition:background .14s,transform .14s}'
      + '.tb-pp-sl-dot:hover{background:#9aa6b1}'
      + '.tb-pp-sl-dot.active{background:#ec7211;transform:scale(1.25)}'
      // Loading state: while the first section is still fetching, the control bar is GREYED OUT and
      // inert (no hover, no clicks) so it reads as "not ready yet". The real (post-load) control bar
      // omits .is-loading and is fully interactive.
      + '.tb-pp-slider-ctrl.is-loading{opacity:.4;pointer-events:none}'
      + '.tb-pp-slider-ctrl.is-loading .tb-pp-sl-btn{background:#f0f3f6;border-color:#e2e6ea;color:#aab3bd}'
      + '.tb-pp-slider-ctrl.is-loading .tb-pp-sl-dot{background:#d4dade}'
      + '.tb-pp-slider-ctrl.is-loading .tb-pp-sl-dot.active{background:#aab3bd;transform:none}'
      // ---- Agents activity leaderboard ----
      + '.tb-pp-card-agents .tb-pp-ic{background:#eef5ff;color:#2563eb}'
      + '.tb-pp-ag{display:flex;flex-direction:column}'
      // "N active today" badge lives in the CARD HEADER, pushed to the right (margin-left:auto) so
      // the title sits left and the badge sits right on the SAME row. The title must not stretch.
      + '.tb-pp-card-agents .tb-pp-card-t{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}'
      + '.tb-pp-ag-active{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;color:#2563eb;font-size:.62em;font-weight:800;letter-spacing:.2px;text-transform:uppercase;white-space:nowrap}'
      // Shared 4-col grid: agent(avatar+name) | commented | successful | immediate. The three metric
      // columns are FIXED equal widths so each row number centers exactly under its header label.
      + '.tb-pp-ag-head,.tb-pp-ag-row{display:grid;grid-template-columns:1fr 60px 60px 60px;gap:14px;align-items:center}'
      + '.tb-pp-ag-head{padding:0 2px 7px;border-bottom:1px solid #eef1f4;margin-bottom:2px}'
      + '.tb-pp-ag-head .tb-pp-ag-id,.tb-pp-ag-head .tb-pp-ag-metric{color:#8a94a2;font-size:.56em;font-weight:800;letter-spacing:.3px;text-transform:uppercase}'
      + '.tb-pp-ag-head .tb-pp-ag-metric{display:flex;align-items:center;justify-content:center;text-align:center;white-space:nowrap}'
      // Sortable column headers.
      + '.tb-pp-ag-sort{cursor:pointer;user-select:none;border-radius:5px;padding:2px 2px;transition:color .12s,background .12s}'
      + '.tb-pp-ag-sort:hover{color:#ec7211!important;background:#fff4e8}'
      + '.tb-pp-ag-sort.on{color:#ec7211!important}'
      + '.tb-pp-ag-row{padding:6px 2px;border-bottom:1px solid #f3f5f7}'
      + '.tb-pp-ag-row:last-of-type{border-bottom:none}'
      // Rows scroll INTERNALLY (capped height) so a long leaderboard never stretches the panel and
      // hides the banner. Thin orange scrollbar to match the panel.
      + '.tb-pp-ag-rows{overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#ff9900 transparent}'
      + '.tb-pp-ag-rows::-webkit-scrollbar{width:4px}.tb-pp-ag-rows::-webkit-scrollbar-thumb{background:#ff9900;border-radius:4px}'
      // "Show all / Show top 7" toggle below the rows.
      + '.tb-pp-ag-more{display:block;width:100%;margin:7px 0 0;padding:6px 0;background:#f5f6f8;border:1px solid #e6eaef;border-radius:8px;color:#2563eb;font-size:.68em;font-weight:800;letter-spacing:.3px;text-transform:uppercase;cursor:pointer;transition:background .14s,color .14s}'
      + '.tb-pp-ag-more:hover{background:#eef5ff;color:#1d4ed8}'
      // Avatar chip.
      + '.tb-pp-ag-av{flex:0 0 28px;width:28px;height:28px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;background:#e9edf1}'
      + '.tb-pp-ag-av img{width:100%;height:100%;object-fit:cover;display:block}'
      + '.tb-pp-ag-av-i{color:#fff;font-size:.74em;font-weight:800}'
      // Agent cell: avatar + a text block (name over the agent\'s own day/tz). Header reuses .tb-pp-ag-id.
      + '.tb-pp-ag-id{display:flex;align-items:center;gap:8px;min-width:0}'
      + '.tb-pp-ag-idtext{display:flex;flex-direction:column;min-width:0}'
      + '.tb-pp-ag-nm{color:#1b2026;font-size:.78em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}'
      + '.tb-pp-ag-ago{color:#9aa6b1;font-size:.56em;font-weight:600;white-space:nowrap;letter-spacing:.2px;display:inline-flex;align-items:center;gap:5px}'
      // Small green blinking dot next to the tz = analyst worked today (Today card only).
      + '.tb-pp-ag-live{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:tbAgLive 1.4s ease-in-out infinite;flex:0 0 auto}'
      + '@keyframes tbAgLive{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(34,197,94,.55)}50%{opacity:.45;box-shadow:0 0 0 4px rgba(34,197,94,0)}}'
      // Metric cell: a single CENTERED number filling its fixed grid column (centers under the header).
      + '.tb-pp-ag-row .tb-pp-ag-metric{display:flex;align-items:center;justify-content:center;text-align:center;color:#1b2026;font-size:.9em;font-weight:900;line-height:1}'
      // Team footer + the "reflects dashboard data" note.
      + '.tb-pp-ag-foot{margin-top:8px;padding-top:8px;border-top:1px solid #eef1f4;color:#5c6773;font-size:.64em;font-weight:600;text-align:center;line-height:1.4}'
      + '.tb-pp-ag-foot b{color:#1b2026;font-weight:900}'
      + '.tb-pp-ag-note{margin-top:5px;color:#9aa6b1;font-size:.56em;font-style:italic;text-align:center;line-height:1.35}'
      + '.tb-pp-ag-loading{display:flex;align-items:center;justify-content:center;padding:16px 4px}'
      + '.tb-pp-ag-empty{color:#8a94a2;font-size:.78em;text-align:center;padding:14px 0;font-style:italic}'
      // Skeleton shimmer blocks.
      + '.tb-pp-sk{display:inline-block;border-radius:6px;background:#e9edf1;position:relative;overflow:hidden;vertical-align:middle}'
      + '.tb-pp-sk::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:tbPpSk 1.2s infinite}'
      + '@keyframes tbPpSk{100%{transform:translateX(100%)}}'
      // Loader inside the "Change in data due to last upload" card (its data loads separately).
      + '.tb-pp-up-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:16px 4px;color:#8a94a2;font-size:.8em;font-weight:600}'
      + '.tb-pp-spin{display:inline-block;width:16px;height:16px;border:2px solid #e2e6ea;border-top-color:#ec7211;border-radius:50%;animation:tbspin .8s linear infinite;flex-shrink:0}'
      // Small inline spinner that stands in for a single numeric VALUE while its data loads.
      + '.tb-pp-mini-spin{display:inline-block;width:12px;height:12px;border:2px solid #e2e6ea;border-top-color:#ec7211;border-radius:50%;animation:tbspin .8s linear infinite;vertical-align:middle}'
      + '.tb-pp-up-empty{color:#8a94a2;font-size:.8em;text-align:center;padding:14px 0;font-style:italic}'
      + '@media(max-width:1100px){body[data-profile-panel]{padding-left:calc(4px + 5vw + 5px)!important;padding-right:5vw!important;padding-top:10px!important}body[data-profile-panel] .tb-profile-panel{display:none}body[data-profile-panel] .tb-fab-col-right{display:flex!important}}'
      // ===== Expand/collapse caret -> PLUS/MINUS icon (global, every page) =====
      // The dashboard sections (.section.collapsible and .content .dash-collapsible) use a .sec-caret
      // glyph that rotates. Replace it with a MINUS icon when expanded and a PLUS icon when the
      // section carries .collapsed. We hide the text glyph and draw the PNG as a centered background,
      // and cancel the rotate transform (not needed for +/-).
      + '.sec-caret{color:transparent!important;font-size:0!important;width:18px!important;height:18px!important;display:inline-block!important;flex-shrink:0;background-repeat:no-repeat!important;background-position:center!important;background-size:16px 16px!important;transform:none!important;transition:none!important;'
        + 'background-image:url("icons/minus.v3.png")!important}'            // expanded -> minus
      + '.collapsed .sec-caret,.collapsed > h2 .sec-caret,.collapsed > .sec-head .sec-caret{transform:none!important;background-image:url("icons/plus.v3.png")!important}' // collapsed -> plus
      // ===== LIGHT THEME for the HOME (logo) button + ACTIVE DASHBOARD (live) FAB =====
      // These two rail controls were dark; the rest of the app is light mode, so give them a light
      // surface. Placed LAST so they win the cascade over the dark base rules above.
      // Home logo pill: white circle, light border, soft shadow (keeps the orange hover accent).
      + '.tb-rail-logo.tb-rail-badge{background:#ffffff!important;border:1px solid #d4dade!important;box-shadow:0 4px 14px rgba(20,40,70,.12)!important}'
      // Home button hover: no translateY lift — just scale the logo to 1.25x (keeps the orange accent).
      + '.tb-rail-logo.tb-rail-badge:hover{border-color:#ec7211!important;box-shadow:0 6px 18px rgba(236,114,17,.22)!important;transform:none!important}'
      + '.tb-rail-logo .tb-logo-swap{transition:transform .16s ease}'
      + '.tb-rail-logo.tb-rail-badge:hover .tb-logo-swap{transform:scale(1.25)}'
      // Active Dashboard FAB: light green surface, green text/border, light glow ring.
      + '.tb-live-fab{background:#eafaf0!important;color:#1f9d57!important;border:1px solid #9ad9b4!important;box-shadow:0 4px 14px rgba(31,157,87,.16)!important}'
      + '.tb-live-fab .tb-live-dot{background:#1f9d57!important;box-shadow:0 0 8px rgba(31,157,87,.6)!important}'
      + '.tb-live-fab:hover{border-color:#1f9d57!important}'
      + '.tb-live-fab.tb-live-disabled{background:#eef1f4!important;color:#8b98a5!important;border-color:#d4dade!important;box-shadow:0 2px 8px rgba(20,40,70,.08)!important}'
      + '.tb-live-fab.tb-live-disabled .tb-live-dot{background:#8b98a5!important;box-shadow:none!important}'
      // Soften the live glow for the light surface (light-green ring instead of a dark box-shadow).
      + '@keyframes tbLiveGlowLight{0%,100%{box-shadow:0 4px 14px rgba(31,157,87,.16),0 0 0 0 rgba(31,157,87,0)}50%{box-shadow:0 4px 14px rgba(31,157,87,.16),0 0 0 6px rgba(31,157,87,.14)}}'
      + '.tb-live-fab:not(.tb-live-disabled){animation:tbLiveGlowLight 1.6s ease-in-out infinite!important}'
      ;
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
    ov.innerHTML = '<div style="background:#fff;border:1px solid #e2e6ea;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
      '<h2 style="color:#1b2026;font-size:1.2em;margin-bottom:6px">Before you upload</h2>' +
      '<p style="color:#5c6773;font-size:.9em;margin-bottom:14px">For the file to be considered, the CSV <b style="color:#1b2026">must include all of these columns</b>. If any is missing, the upload will be blocked.</p>' +
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
      return '<li style="display:flex;align-items:center;gap:8px;padding:4px 0;color:' + (bad ? '#dc2626' : '#1f9d57') + '">' + (bad ? '✗' : '✓') + ' <span style="font-family:monospace;font-size:.9em">' + c + '</span>' + tbNewTag(c) + (bad ? ' <span style="color:#dc2626;font-size:.78em">(missing)</span>' : '') + '</li>';
    }).join('');
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,30,50,.45);z-index:3400;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div style="background:#fff;border:1px solid #e2e6ea;border-radius:12px;max-width:80vw;width:80vw;max-height:88vh;overflow:auto;padding:26px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
      '<h2 style="color:#dc2626;font-size:1.2em;margin-bottom:6px">Upload blocked — missing required columns</h2>' +
      '<p style="color:#5c6773;font-size:.9em;margin-bottom:14px">The file is missing <b style="color:#dc2626">' + missing.length + '</b> required column' + (missing.length === 1 ? '' : 's') + '. All ' + TB_REQUIRED_COLUMNS.length + ' columns below are mandatory. Fix the export and try again — <b>no data was uploaded</b>.</p>' +
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
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,30,50,.5);z-index:' + (z || 3400) + ';display:flex;align-items:center;justify-content:center;padding:20px';
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
      '<div style="text-align:center;width:90vw;max-width:90vw;min-width:300px;background:#fff;border:1px solid #e2e6ea;border-radius:14px;padding:34px 26px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
        '<div class="sp" style="width:46px;height:46px;border:4px solid #e2e6ea;border-top-color:#ec7211;border-radius:50%;animation:tbspin 1s linear infinite;margin:0 auto"></div>' +
        '<p style="color:#1b2026;margin-top:20px;font-size:1.1em;font-weight:600" id="tbAssessTitle">Reading the file…</p>' +
        '<p style="color:#5c6773;margin-top:6px;font-size:.9em" id="tbAssessSub">The data file is being processed, Please wait...</p>' +
        // Progress bar + ticket ticker (shown while the live data loads).
        '<div id="tbAssessTimerWrap" style="display:none;margin-top:20px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="flex:1;height:10px;background:#eef1f4;border:1px solid #e2e6ea;border-radius:20px;overflow:hidden">' +
              '<div id="tbAssessBar" style="height:100%;width:0%;background:linear-gradient(90deg,#1f9d57,#16a34a);border-radius:20px;transition:width .35s ease"></div>' +
            '</div>' +
            '<div id="tbAssessPct" style="font-size:.95em;font-weight:800;color:#1f9d57;min-width:44px;text-align:right;font-variant-numeric:tabular-nums">0%</div>' +
          '</div>' +
          '<p id="tbAssessTicker" style="color:#1577a0;margin-top:14px;font-size:.9em;font-weight:700;letter-spacing:.4px;font-family:monospace;min-height:1.2em;transition:opacity .15s">&nbsp;</p>' +
          '<p style="color:#8a94a2;margin-top:2px;font-size:.72em">Scanning all the tickets…</p>' +
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
        '<div style="background:#fff;border:1px solid #e2e6ea;border-radius:12px;max-width:80vw;width:80vw;padding:26px;text-align:center;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#1b2026;font-size:1.2em;margin:8px 0 8px">No new changes</h2>' +
          '<p style="color:#5c6773;font-size:.92em;line-height:1.6">No ticket in this file has a newer <b style="color:#1b2026">LastUpdatedDate</b> than what\'s already live, and there are no new tickets. Nothing needs to be uploaded.</p>' +
          '<div style="margin-top:22px"><button class="tb-mbtn" id="tbConfirmClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbConfirmClose').onclick = function () { tbRemove('tbConfirm'); };
      return;
    }
    tbFlowOverlay('tbConfirm',
      '<div style="background:#fff;border:1px solid #e2e6ea;border-radius:12px;max-width:80vw;width:80vw;padding:26px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
        '<h2 style="color:#1b2026;font-size:1.2em;margin-bottom:12px">Assessment complete</h2>' +
        '<div style="background:#f7f9fb;border:1px solid #e2e6ea;border-radius:10px;padding:6px 16px">' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eef1f4"><span style="color:#5c6773">Tickets with newer data</span><span style="color:#1577a0;font-weight:700">' + res.xNewer + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eef1f4"><span style="color:#5c6773">Will be updated (field changes)</span><span style="color:#b5680c;font-weight:700">' + res.yUpdated + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:9px 0"><span style="color:#5c6773">New tickets to add</span><span style="color:#1f9d57;font-weight:700">' + res.zNew + '</span></div>' +
        '</div>' +
        (res.assessSecs != null ? ('<p style="color:#8a94a2;font-size:.78em;margin-top:10px;text-align:center">Fetch &amp; compare took ' + tbFmtDuration(res.assessSecs) + '</p>') : '') +
        '<p style="color:#5c6773;font-size:.82em;margin-top:12px">Confirm to save these changes to the shared database.</p>' +
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
      '<div style="text-align:center;width:90vw;max-width:90vw;min-width:300px;background:#fff;border:1px solid #e2e6ea;border-radius:14px;padding:34px 26px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
        '<div class="sp" style="width:46px;height:46px;border:4px solid #e2e6ea;border-top-color:#ec7211;border-radius:50%;animation:tbspin 1s linear infinite;margin:0 auto"></div>' +
        '<p style="color:#1b2026;margin-top:20px;font-size:1.1em;font-weight:600">New data is being pushed…</p>' +
        '<p style="color:#5c6773;margin-top:8px;font-size:.9em" id="tbPushSub">Saving to the shared database. This may take a moment.</p>' +
        '<div style="margin-top:20px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="flex:1;height:10px;background:#eef1f4;border:1px solid #e2e6ea;border-radius:20px;overflow:hidden">' +
              '<div id="tbPushBar" style="height:100%;width:0%;background:linear-gradient(90deg,#1f9d57,#16a34a);border-radius:20px;transition:width .35s ease"></div>' +
            '</div>' +
            '<div id="tbPushPct" style="font-size:.95em;font-weight:800;color:#1f9d57;min-width:44px;text-align:right;font-variant-numeric:tabular-nums">0%</div>' +
          '</div>' +
          '<p id="tbPushTicker" style="color:#1577a0;margin-top:14px;font-size:.9em;font-weight:700;letter-spacing:.4px;font-family:monospace;min-height:1.2em;transition:opacity .15s">&nbsp;</p>' +
          '<p style="color:#8a94a2;margin-top:2px;font-size:.72em">Writing tickets to the database…</p>' +
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
        '<div style="background:#fff;border:1px solid #e2e6ea;border-radius:12px;max-width:80vw;width:80vw;padding:26px;text-align:center;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#1f9d57;font-size:1.2em;margin:8px 0 6px">Upload complete</h2>' +
          '<p style="color:#5c6773;font-size:.9em">' + res.yUpdated + ' updated · ' + res.zNew + ' added. Live for everyone now.</p>' +
          (_pushSecs ? ('<p style="color:#8a94a2;font-size:.78em;margin-top:8px">Saved in ' + tbFmtDuration(_pushSecs) + '</p>') : '') +
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
        '<div style="background:#fff;border:1px solid #e2e6ea;border-radius:12px;max-width:80vw;width:80vw;padding:26px;text-align:center;box-shadow:0 24px 60px -20px rgba(20,40,70,.5)">' +
          '<h2 style="color:#dc2626;font-size:1.15em;margin-bottom:6px">Upload failed</h2>' +
          '<p style="color:#5c6773;font-size:.9em">' + tbEsc(err.message) + '</p>' +
          '<div style="margin-top:18px"><button class="tb-mbtn" id="tbErrClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbErrClose').onclick = function () { tbRemove('tbErr'); };
    }
  }

  // ---- Shared styled pop-ups: PHDConfirm (OK/Cancel) + PHDAlert (single OK) ----
  // Promise-based replacements for the native confirm()/alert(). Reuse the .tb-modal look. Esc =
  // cancel/close; Enter = OK. opts: { title, body(HTML allowed), okLabel, cancelLabel, danger:bool }.
  // ========================================================================
  // PHDBanner — full-width status bar at the top of the page.
  //   PHDBanner.ok(msg, opts)    -> blue  (success / 2xx / info); auto-dismisses
  //   PHDBanner.error(msg, opts) -> red   (errors); stays until dismissed
  //   PHDBanner.warn(msg, opts)  -> amber (warnings)
  //   PHDBanner.progress(msg, opts) -> blue w/ spinner; stays until you call hide()
  //   PHDBanner.hide()           -> dismiss the current banner
  // opts: { action:{label, onClick}, duration(ms, 0 = sticky), dismissible(bool) }
  // ========================================================================
  var _pbTimer = null;
  function tbBannerIcon(type) {
    if (type === 'err') return ic('alert', 18);
    if (type === 'warn') return ic('alert', 18);
    return ic('check-circle', 18); // ok/info
  }
  function tbShowBanner(type, msg, opts) {
    opts = opts || {};
    if (_pbTimer) { clearTimeout(_pbTimer); _pbTimer = null; }
    var el = document.getElementById('phdBanner');
    if (!el) { el = document.createElement('div'); el.id = 'phdBanner'; document.body.appendChild(el); }
    el.className = 'phd-banner ' + type;
    var lead = opts.progress ? '<span class="pb-spin"></span>' : ('<span class="pb-ic">' + tbBannerIcon(type) + '</span>');
    var actionHtml = (opts.action && opts.action.label)
      ? '<button class="pb-action" type="button">' + tbEsc(opts.action.label) + '</button>' : '';
    var dismissible = (opts.dismissible !== false); // default dismissible except progress
    if (opts.progress && opts.dismissible == null) dismissible = false;
    var closeHtml = dismissible ? '<button class="pb-close" type="button" aria-label="Dismiss">&times;</button>' : '';
    el.innerHTML = lead + '<span class="pb-msg">' + tbEsc(msg) + '</span>' + actionHtml + closeHtml;
    // Wire the action + close.
    var actBtn = el.querySelector('.pb-action');
    if (actBtn) actBtn.onclick = function () { try { if (opts.action.onClick) opts.action.onClick(); } catch (e) {} };
    var closeBtn = el.querySelector('.pb-close');
    if (closeBtn) closeBtn.onclick = tbHideBanner;
    // Show (next frame so the slide-in transition runs).
    document.body.classList.add('phd-banner-open');
    requestAnimationFrame(function () { el.classList.add('show'); });
    // Auto-dismiss: default 3s for ok/info/warn; errors + progress stay unless duration given.
    var dur = (opts.duration != null) ? opts.duration : (type === 'err' || opts.progress ? 0 : 3000);
    if (dur > 0) _pbTimer = setTimeout(tbHideBanner, dur);
    return { hide: tbHideBanner };
  }
  function tbHideBanner() {
    if (_pbTimer) { clearTimeout(_pbTimer); _pbTimer = null; }
    var el = document.getElementById('phdBanner');
    if (!el) return;
    el.classList.remove('show');
    document.body.classList.remove('phd-banner-open');
    setTimeout(function () { if (el && !el.classList.contains('show') && el.parentNode) el.parentNode.removeChild(el); }, 300);
  }
  window.PHDBanner = {
    ok: function (msg, opts) { return tbShowBanner('ok', msg, opts); },
    info: function (msg, opts) { return tbShowBanner('ok', msg, opts); },
    error: function (msg, opts) { return tbShowBanner('err', msg, opts); },
    warn: function (msg, opts) { return tbShowBanner('warn', msg, opts); },
    progress: function (msg, opts) { opts = opts || {}; opts.progress = true; return tbShowBanner('ok', msg, opts); },
    // Convenience: pass an API result {ok,status,data} -> auto blue/red with a sensible message.
    fromResult: function (r, okMsg, errMsg) {
      if (r && r.ok) return tbShowBanner('ok', okMsg || 'Done.', {});
      var m = errMsg || (r && r.data && r.data.error) || ('Request failed' + (r && r.status ? ' (HTTP ' + r.status + ')' : ''));
      return tbShowBanner('err', m, {});
    },
    hide: tbHideBanner
  };

  // Escape helper for popup text (was referenced but never defined — caused PHDConfirm to throw,
  // which silently broke the login-prompt flow). Reuses tbEsc.
  function tbPopupEsc(x) { return tbEsc(x); }
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
  // Logged-out entry point: ask the user to log in FIRST (styled confirm). On "Log in" -> open the
  // login modal; on Cancel/decline -> send them to the profile "not logged in" gate (profile.html).
  window.tbPromptLogin = function () {
    var ask = (window.PHDConfirm)
      ? window.PHDConfirm({ title: 'Log in required', body: 'You need to be logged in to view this. Would you like to log in now?', okLabel: 'Log in', cancelLabel: 'Not now' })
      : Promise.resolve(window.confirm('You need to be logged in. Log in now?'));
    ask.then(function (ok) {
      if (ok) { tbOpenLogin(); }
      else { try { location.href = 'profile.html'; } catch (e) {} }
    });
  };
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

  // Floating circular back button, pinned to the BOTTOM of the right rail. A page sets data-back-href
  // to make it navigate; on pages WITHOUT a back target (e.g. the home page) it still renders but as a
  // Back button removed (per design). No-op: never render the bottom-right back FAB.
  function buildBackButton() {
    var old = document.querySelector('.tb-fab-item-back'); if (old && old.parentNode) old.parentNode.removeChild(old);
    return;
    // eslint-disable-next-line no-unreachable
    if (document.querySelector('.tb-back-fab')) return;
    var backHref = document.body.getAttribute('data-back-href');
    var disabled = !backHref;
    var lbl = document.body.getAttribute('data-back-label') || 'Back';
    var svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
    var fab;
    if (disabled) {
      fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'tb-back-fab tb-back-disabled';
      fab.setAttribute('aria-disabled', 'true');
      fab.disabled = true;
      fab.title = 'Nowhere to go back to';
      fab.setAttribute('aria-label', 'Back (unavailable)');
      fab.innerHTML = svg;
      lbl = 'Back';
    } else {
      fab = document.createElement('a');
      fab.className = 'tb-back-fab';
      fab.href = backHref;
      fab.title = 'Back to ' + lbl;
      fab.setAttribute('aria-label', 'Back to ' + lbl);
      fab.innerHTML = svg;
    }
    // Back button lives at the BOTTOM of the RIGHT rail (opposite the LIVE button on the left rail),
    // wrapped as a captioned rail item. The .tb-fab-col-right override drops its fixed positioning.
    var item = document.createElement('div');
    item.className = 'tb-fab-item tb-fab-item-back';
    item.appendChild(fab);
    var cap = document.createElement('div');
    cap.className = 'tb-fab-cap';
    cap.textContent = lbl;
    item.appendChild(cap);
    tbFabColRight().appendChild(item);
  }

  // Floating top-right control cluster — the only survivor of the retired title bar. Holds (right to
  // left): the profile pill, then the Uploaded data log button to its LEFT. (Upload new data now
  // lives in the left FAB rail.) The profile pill expands leftward on hover (name/Login text slides
  // in). Re-rendered by refreshProfileAvatar() once the full profile loads in the background.
  function buildProfileAvatar() {
    // Top-right cluster (Uploaded data log + name + avatar) retired: the profile avatar now lives at
    // the BOTTOM of the left rail, and "Uploaded data log" lives in the Data fly-out. No-op here.
    // Remove any previously-created cluster (e.g. from a cached earlier build).
    var old = document.getElementById('tbTopRight'); if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  window.PHDRefreshProfileAvatar = buildProfileAvatar;
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
    // Top-right cluster retired (profile avatar is in the left rail; upload log in the Data fly-out).
    // Remove any stale cluster and the auto-injected universal "WWOS-PHD Dashboard" header row.
    var cluster = document.getElementById('tbTopRight'); if (cluster && cluster.parentNode) cluster.parentNode.removeChild(cluster);
    var universal = document.getElementById('tbHeaderRow'); if (universal && universal.parentNode) universal.parentNode.removeChild(universal);
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
    if (!col) { col = document.createElement('div'); col.id = 'tbFabCol'; col.className = 'tb-fab-col'; document.body.appendChild(col); tbMakeRailClickable(col); }
    return col;
  }
  // Make the ENTIRE rail item (its padding + caption + pill) clickable — not just the inner pill.
  // Delegated once per column: a click anywhere inside a .tb-fab-item forwards to that item's inner
  // <a>/<button>. Clicks landing directly on the pill/link/button pass through untouched (no double
  // fire). Flyout-group items (whose pill is a .tb-flyout-fab trigger) open on HOVER, so a click on
  // their caption/box is ignored (there's no single destination).
  function tbMakeRailClickable(col) {
    if (col._railClick) return; col._railClick = true;
    // Also show a pointer cursor + the whole-item hover affordance.
    col.style.cursor = 'default';
    col.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.tb-fab-item');
      if (!item || !col.contains(item)) return;
      // If the real control (or something inside it) was clicked, let it handle itself.
      var ctrl = item.querySelector('a.tb-nav-fab, button.tb-nav-fab, a.tb-rail-badge, button.tb-rail-badge, a.tb-an-fab, a.tb-live-fab');
      if (!ctrl) return;                                   // flyout trigger / nothing to activate
      if (e.target === ctrl || ctrl.contains(e.target)) return; // native click already fired
      if (ctrl.getAttribute('aria-disabled') === 'true' || ctrl.disabled) return;
      // Forward: navigate for links, synthesize a click for buttons.
      if (ctrl.tagName === 'A' && ctrl.href) { if (ctrl.target === '_blank') window.open(ctrl.href, '_blank'); else window.location.href = ctrl.href; }
      else { ctrl.click(); }
    });
  }
  // The RIGHT-edge rail: profile (top) + Data/Reports/History/Admin fly-outs + Analytics (middle) +
  // back button (bottom). Mirror of tbFabCol().
  function tbFabColRight() {
    var col = document.getElementById('tbFabColRight');
    if (!col) { col = document.createElement('div'); col.id = 'tbFabColRight'; col.className = 'tb-fab-col-right'; document.body.appendChild(col); tbMakeRailClickable(col); }
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
    if (!li) return;   // Analytics is HIDDEN for logged-out guests (login-gated).
    var fab = document.createElement('a');
    fab.className = 'tb-an-fab' + (li ? '' : ' tb-an-disabled');
    fab.setAttribute('aria-label', 'Agent & Group Analytics');
    // Custom "group analytics" PNG icon (replaces the old inline group-chart svg).
    fab.innerHTML = '<span class="tb-an-ic"><img class="tb-an-img" src="icons/group-analytics.v3.png" alt="Analytics"></span>';
    if (li) {
      fab.href = 'agent-analytics.html';
    } else {
      fab.setAttribute('aria-disabled', 'true');
      fab.title = 'Log in to view Agent & Group Analytics';
    }
    // Wrap in a captioned column item (matches the nav rail). Now lives on the LEFT rail, just above
    // the LIVE item (i.e. at the bottom of the left-rail nav/group stack).
    var item = document.createElement('div');
    item.className = 'tb-fab-item tb-fab-item-an';
    item.appendChild(fab);
    var cap = document.createElement('div');
    cap.className = 'tb-fab-cap' + (li ? '' : ' is-disabled');
    cap.textContent = 'Analytics';
    item.appendChild(cap);
    var lcol = tbFabCol();
    var liveItem = lcol.querySelector('.tb-fab-item-live');
    if (liveItem) lcol.insertBefore(item, liveItem); else lcol.appendChild(item);
  }
  // Build the LIVE-QUARTER FAB (sits just above Analytics in the centered column). Blinks to signal
  // the live quarter and links to the live dashboard (app.html). Shown on EVERY page.
  function buildLiveButton() {
    if (document.querySelector('.tb-live-fab')) return;
    // The "2026" dashboard button is LOGIN-GATED: hidden entirely for logged-out guests. The profile
    // (right-rail avatar / panel) still builds regardless.
    if (!loggedIn()) { buildRailProfile(); return; }
    var label = document.body.getAttribute('data-live-label') || 'Q3 2026';
    var fab = document.createElement('a');
    fab.className = 'tb-live-fab';
    fab.setAttribute('aria-label', '2026 dashboard');
    fab.innerHTML = '<span class="tb-live-ic"><span class="tb-live-dot"></span></span>';
    fab.href = 'app.html';
    fab.title = 'Go to the 2026 dashboard';
    // Wrap in a captioned column item; "2026" caption. Sits at the BOTTOM of the LEFT rail.
    var item = document.createElement('div');
    item.className = 'tb-fab-item tb-fab-item-live';
    item.appendChild(fab);
    var cap = document.createElement('div');
    cap.className = 'tb-fab-cap';
    cap.textContent = '2026';
    item.appendChild(cap);
    tbFabCol().appendChild(item);
    // Profile now lives at the TOP of the RIGHT rail (built separately by buildRailProfile).
    buildRailProfile();
  }
  // GSOC logo as the FIRST rail item (top). Hover slides out a "WWOS-PHD Dashboard" label. Links home.
  function buildRailLogo() {
    var col = tbFabCol();
    if (col.querySelector('.tb-rail-logo')) return;
    // Wrap the logo pill + a two-line caption below it (like the nav buttons). The caption
    // ("WWOS-PHD" / "Dashboard") reveals on hover of the item.
    var item = document.createElement('div');
    item.className = 'tb-fab-item tb-rail-logo-item';
    var a = document.createElement('a');
    a.className = 'tb-rail-badge tb-rail-logo'; // fixed circle pill
    a.href = 'index.html';
    a.setAttribute('aria-label', 'WWOS-PHD Dashboard — Home');
    a.title = 'Home';
    // Two logos that slide-swap every second (GSOC <-> Amazon). Both link home (the <a> is the link).
    a.innerHTML = '<span class="tb-logo-swap">'
      + '<img class="tb-rail-logo-img tb-logo-a" src="gsoc-logo.svg" alt="GSOC">'
      + '<img class="tb-rail-logo-img tb-logo-b" src="amazon-logo.webp" alt="Amazon">'
      + '</span>';
    var cap = document.createElement('div');
    cap.className = 'tb-fab-cap tb-rail-logo-cap';
    cap.innerHTML = '<span>WWOS-PHD</span><span>Dashboard</span>'; // two lines, like the pattern
    item.appendChild(a);
    item.appendChild(cap);
    col.insertBefore(item, col.firstChild); // pin to the very top of the rail
  }
  // Profile avatar pinned to the TOP of the RIGHT rail (opposite the GSOC logo). Logged in ->
  // profile.html; else a Login button whose label slides out to the LEFT on hover.
  function buildRailProfile() {
    var col = tbFabColRight();
    if (col.querySelector('.tb-fab-item-profile')) return;
    var li = loggedIn();
    var item = document.createElement('div');
    item.className = 'tb-fab-item tb-fab-item-profile';
    var pill = document.createElement(li ? 'a' : 'button');
    // .tb-rail-badge: fixed 46px circle whose label pops OUT to the right on hover (never clipped,
    // never shifts the column). NOT .tb-nav-fab (buildNavFabs early-returns if any exists first).
    pill.className = 'tb-rail-badge tb-rail-profile';
    pill.setAttribute('aria-label', li ? 'Profile' : 'Log in');
    var prof = (A.myProfile && A.myProfile()) || (A.getUser && A.getUser()) || {};
    var name = li ? ((prof && (prof.displayName || prof.username)) || 'Profile') : 'Log in';
    var avatarHtml;
    try {
      if (li && A.avatarHtml) avatarHtml = '<span class="tb-rail-av">' + A.avatarHtml(prof, 38) + '</span>';
      else avatarHtml = '<span class="tb-nav-ic">' + ic('key', 20) + '</span>'; // logged out -> login (key) icon
    } catch (e) { avatarHtml = '<span class="tb-nav-ic">' + ic('key', 20) + '</span>'; }
    pill.innerHTML = avatarHtml + '<span class="tb-rail-badge-label">' + tbEsc(name) + '</span>';
    if (li) { pill.href = 'profile.html'; }
    else { pill.type = 'button'; pill.onclick = function () { if (window.tbPromptLogin) window.tbPromptLogin(); else if (window.tbOpenLogin) window.tbOpenLogin(); }; }
    item.appendChild(pill);
    col.insertBefore(item, col.firstChild); // pin to the very TOP of the right rail
  }
  // Build the RIGHT PROFILE PANEL (3-column shell). A fixed right-hand panel with a title banner
  // (orange gradient) showing the avatar, display name + handle, the group (WWOS-GSOC PHD) and role.
  // Only on pages that opt in via body[data-profile-panel]. Logged-out -> a compact "log in" banner.
  function buildProfilePanel() {
    if (!document.body.hasAttribute('data-profile-panel')) return;
    var existing = document.querySelector('.tb-profile-panel');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing); // rebuild fresh
    var li = loggedIn();
    var panel = document.createElement('aside');
    panel.className = 'tb-profile-panel';
    if (li) {
      var prof = (A.myProfile && A.myProfile()) || (A.getUser && A.getUser()) || {};
      var user = (A.getUser && A.getUser()) || {};
      var name = (prof && (prof.displayName || prof.username)) || user.username || 'Profile';
      var handle = (user.username || prof.username || '');
      var role = (user.role || '');
      var isManager = String(role).toLowerCase() === 'manager';
      var avatarHtml = '';
      try { avatarHtml = A.avatarHtml ? A.avatarHtml(prof, 56) : ''; } catch (e) { avatarHtml = ''; }
      // Compact static banner: avatar + (name·role on one line, handle under it), with Profile + Logout
      // chips (and My Tickets for non-managers) on the right. No expand/collapse.
      panel.innerHTML =
        '<div class="tb-pp-banner' + (isManager ? ' tb-pp-banner-notix' : '') + '">'
        + '<div class="tb-pp-body">'
        +   '<span class="tb-pp-av">' + avatarHtml + '</span>'
        +   '<span class="tb-pp-meta">'
        +     '<span class="tb-pp-namerow"><span class="tb-pp-name">' + tbEsc(name) + '</span>'
        +       (role ? '<span class="tb-pp-badge">' + tbEsc(role) + '</span>' : '') + '</span>'
        +     (handle ? '<span class="tb-pp-handle">' + tbEsc(handle) + '@</span>' : '')
        +   '</span>'
        +   '<span class="tb-pp-links">'
        +     '<span class="tb-pp-links-top">'
        +       '<a class="tb-pp-link" href="profile.html">' + ic('user', 13) + 'Profile</a>'
        +       '<button type="button" class="tb-pp-logout" id="tbPpLogout" title="Log out">' + ic('log-out', 13) + '<span>Logout</span></button>'
        +     '</span>'
        +     (isManager ? '' : '<a class="tb-pp-mytickets" href="my-tickets.html">' + izImg('my-tickets', ic('ticket', 14)) + '<span>My Tickets</span></a>')
        +   '</span>'
        + '</div>'
        + '</div>'
        // Stats container: filled with separate section cards; starts as a skeleton.
        + '<div class="tb-pp-stack" id="tbPpStats">' + tbProfileSkeleton() + '</div>';
    } else {
      // LOGGED-OUT panel: a welcoming banner + what a guest can view + a card inviting login for the
      // features that need an account.
      var guestItem = function (iconHtml, text) {
        return '<div class="tb-pp-g-row"><span class="tb-pp-g-ic">' + iconHtml + '</span><span>' + text + '</span></div>';
      };
      panel.innerHTML =
        '<div class="tb-pp-banner">'
        + '<div class="tb-pp-body">'
        +   '<span class="tb-pp-av"><span class="tb-nav-ic">' + ic('user', 22) + '</span></span>'
        +   '<span class="tb-pp-meta">'
        +     '<span class="tb-pp-namerow"><span class="tb-pp-name">Welcome, Guest</span></span>'
        +     '<span class="tb-pp-handle">Browsing as a visitor</span>'
        +   '</span>'
        +   '<span class="tb-pp-links"><a class="tb-pp-mytickets" href="#" id="tbPpLogin">' + ic('key', 14) + '<span>Log in</span></a></span>'
        + '</div>'
        + '</div>'
        + '<div class="tb-pp-stack">'
        // What a guest CAN see (no login needed).
        + tbProfileCard(ic('eye', 15), 'You can explore \u2014 no login needed',
            '<div class="tb-pp-guest">'
            + guestItem(ic('grid', 14), 'The live quarter dashboard \u2014 queue status, ticket age, SLA, incident types & resolutions')
            + guestItem(ic('bar-chart', 14), 'Program History & per-year trends (2021\u20132026)')
            + guestItem(ic('clipboard', 14), 'Issue-type standardization reference')
            + guestItem(ic('line-chart', 14), 'Reports: SLA breaches, repeat incidents, countries, hashtags')
            + '</div>')
        // What needs a login.
        + tbProfileCard(ic('key', 15), 'Log in to do more',
            '<div class="tb-pp-guest">'
            + guestItem(ic('upload', 14), 'Upload new data & manage the live dashboard')
            + guestItem(ic('ticket', 14), 'See & comment on your assigned tickets (My Tickets)')
            + guestItem(ic('alert', 14), 'Raise and answer help / alert requests')
            + '</div>'
            // Trigger button — visible by default. Clicking it EXPANDS the inline form below.
            + '<button type="button" class="tb-pp-login-btn" id="tbPpLoginToggle">' + ic('key', 15) + '<span>Log in to your account</span></button>'
            // Collapsible inline login form (hidden until the trigger is clicked). No popup.
            + '<div class="tb-pp-login-wrap" id="tbPpLoginWrap">'
            +   '<form class="tb-pp-login-form" id="tbPpLoginForm" autocomplete="on">'
            +     '<label class="tb-pp-lf-label">Username</label>'
            +     '<input class="tb-pp-lf-input" type="text" id="tbPpLoginUser" autocomplete="username" placeholder="username">'
            +     '<label class="tb-pp-lf-label">Password</label>'
            +     '<input class="tb-pp-lf-input" type="password" id="tbPpLoginPass" autocomplete="current-password" placeholder="password">'
            +     '<label class="tb-pp-lf-remember"><input type="checkbox" id="tbPpLoginRemember" checked> Keep me signed in</label>'
            +     '<div class="tb-pp-lf-err" id="tbPpLoginErr"></div>'
            +     '<div class="tb-pp-lf-actions">'
            +       '<button type="button" class="tb-pp-lf-cancel" id="tbPpLoginCancel">Cancel</button>'
            +       '<button type="submit" class="tb-pp-login-btn tb-pp-lf-submit" id="tbPpLoginSubmit">' + ic('key', 15) + '<span>Log in</span></button>'
            +     '</div>'
            +   '</form>'
            + '</div>')
        + '</div>';
    }
    document.body.appendChild(panel);
    try { panel.scrollTop = 0; } catch (e) {}        // always start at the top so the banner is visible
    // Expand the collapsible inline login form + focus the username field.
    var openInlineLogin = function (e) {
      if (e) e.preventDefault();
      var wrap = document.getElementById('tbPpLoginWrap'); if (wrap) wrap.classList.add('open');
      var toggle = document.getElementById('tbPpLoginToggle'); if (toggle) toggle.style.display = 'none';
      var u = document.getElementById('tbPpLoginUser');
      if (u) { setTimeout(function () { u.focus(); u.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60); }
    };
    // Collapse the form back (Cancel).
    var closeInlineLogin = function () {
      var wrap = document.getElementById('tbPpLoginWrap'); if (wrap) wrap.classList.remove('open');
      var toggle = document.getElementById('tbPpLoginToggle'); if (toggle) toggle.style.display = '';
      var errEl = document.getElementById('tbPpLoginErr'); if (errEl) errEl.style.display = 'none';
    };
    // The banner "Log in" link + the "Log in to your account" button both EXPAND the form.
    var lg = document.getElementById('tbPpLogin'); if (lg) lg.onclick = openInlineLogin;
    var toggleBtn = document.getElementById('tbPpLoginToggle'); if (toggleBtn) toggleBtn.onclick = openInlineLogin;
    var cancelBtn = document.getElementById('tbPpLoginCancel'); if (cancelBtn) cancelBtn.onclick = closeInlineLogin;
    // Inline login form submit -> POST /api/login directly (mirrors tbDoLogin, no modal).
    var form = document.getElementById('tbPpLoginForm');
    if (form) form.onsubmit = function (e) {
      e.preventDefault();
      var uEl = document.getElementById('tbPpLoginUser'), pEl = document.getElementById('tbPpLoginPass');
      var remEl = document.getElementById('tbPpLoginRemember'), errEl = document.getElementById('tbPpLoginErr');
      var btn = document.getElementById('tbPpLoginSubmit');
      var u = (uEl.value || '').trim(), p = pEl.value, remember = !!(remEl && remEl.checked);
      if (!u || !p) { errEl.textContent = 'Enter username and password.'; errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';
      var label = btn.querySelector('span'); var oldTxt = label ? label.textContent : '';
      btn.disabled = true; if (label) label.textContent = 'Logging in…';
      A.api('POST', '/api/login', { username: u, password: p }).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.data && r.data.error) || ('Login failed (HTTP ' + (r ? r.status : 0) + ')'));
        A.setSession(r.data.token, r.data.user, remember);
        var pr = (A.loadMyProfile) ? A.loadMyProfile() : Promise.resolve();
        return Promise.resolve(pr).then(function () { location.reload(); });
      }).catch(function (ex) {
        errEl.textContent = ex.message || 'Login failed.'; errEl.style.display = 'block';
        btn.disabled = false; if (label) label.textContent = oldTxt || 'Log in';
      });
    };
    // Logout button in the banner — confirm first, then clear the session and return home.
    var lo = document.getElementById('tbPpLogout');
    if (lo) lo.onclick = function () { tbConfirmLogout(); };
    if (li) tbLoadProfileStats();   // fetch + render the role-aware stats card below the banner
  }
  window.PHDBuildProfilePanel = buildProfilePanel;

  // Shared "Log out?" confirmation popup. Shows a light yes/no dialog; on confirm, clears the session
  // and returns home. Used by the profile-panel banner and any page that calls window.PHDConfirmLogout.
  function tbConfirmLogout() {
    var old = document.getElementById('tbLogoutConfirm'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var ov = document.createElement('div');
    ov.id = 'tbLogoutConfirm';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,30,45,.55);z-index:5000;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="background:#fff;border:1px solid #e2e7eb;border-radius:16px;width:400px;max-width:92vw;padding:24px;box-shadow:0 24px 60px -20px rgba(20,40,70,.5);font-family:inherit">'
      + '<div style="display:flex;align-items:center;gap:11px;margin-bottom:8px">'
      +   '<span style="flex:0 0 auto;width:38px;height:38px;border-radius:50%;background:#fef2f2;color:#dc2626;display:inline-flex;align-items:center;justify-content:center">' + ic('log-out', 18) + '</span>'
      +   '<h2 style="margin:0;color:#1b2026;font-size:1.1em;font-weight:800">Log out?</h2>'
      + '</div>'
      + '<p style="color:#5c6773;font-size:.9em;line-height:1.55;margin:0 0 18px">You\u2019ll need to log in again to access your tickets and tools.</p>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end">'
      +   '<button type="button" id="tbLogoutNo" style="font-family:inherit;font-weight:700;font-size:.86em;padding:9px 16px;border-radius:9px;border:1px solid #d4dade;background:#fff;color:#2a3340;cursor:pointer">No, stay</button>'
      +   '<button type="button" id="tbLogoutYes" style="font-family:inherit;font-weight:800;font-size:.86em;padding:9px 18px;border-radius:9px;border:none;background:#dc2626;color:#fff;cursor:pointer">Yes, log out</button>'
      + '</div></div>';
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.onclick = function (e) { if (e.target === ov) close(); };
    document.body.appendChild(ov);
    var no = document.getElementById('tbLogoutNo'); if (no) no.onclick = close;
    var yes = document.getElementById('tbLogoutYes'); if (yes) yes.onclick = function () { try { A.clear(); } catch (e) {} location.href = 'index.html'; };
    var onEsc = function (e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
    setTimeout(function () { try { yes && yes.focus(); } catch (e) {} }, 40);
  }
  window.PHDConfirmLogout = tbConfirmLogout;

  // Icon helper: use a folder PNG when present, else an inline svg fallback.
  // TB_ICON_V busts the browser's image cache after the PNGs are replaced (same filenames). Bump it
  // whenever the icon files change.
  function izImg(name, fallbackSvg) {
    return '<img class="tb-pp-ic-img" src="icons/' + name + '.v3.png" alt="" onerror="this.style.display=\'none\';var f=this.nextSibling;if(f)f.style.display=\'inline-flex\'"><span class="tb-pp-ic-fb" style="display:none">' + (fallbackSvg || '') + '</span>';
  }
  // One profile section CARD: icon header + body. `headerExtra` (optional) is extra markup placed at
  // the RIGHT of the header row (e.g. a per-section reload button).
  function tbProfileCard(iconHtml, title, bodyHtml, extraClass, headerExtra) {
    return '<section class="tb-pp-card' + (extraClass ? ' ' + extraClass : '') + '">'
      + '<div class="tb-pp-card-h"><span class="tb-pp-ic">' + iconHtml + '</span><span class="tb-pp-card-t">' + title + '</span>' + (headerExtra || '') + '</div>'
      + '<div class="tb-pp-card-b">' + bodyHtml + '</div>'
      + '</section>';
  }
  // Loading skeleton for the profile stats stack. Every card renders its REAL icon header + title
  // and its FIXED labels hardcoded (none of that needs the DB); only the numeric VALUE each cell
  // waits on gets a small inline spinner. This keeps all four cards visually consistent with the
  // upload card instead of mixing shimmer blocks with hardcoded rows.
  function tbProfileSkeleton() {
    var spin = '<span class="tb-pp-mini-spin"></span>';   // the value placeholder while data loads
    // Inline "LABEL ...... <spinner> | LABEL ...... <spinner>" pair (open tickets / resolved).
    var pair = function (label) { return '<span class="tb-pp-pair"><span class="tb-pp-pair-l">' + label + '</span><span class="tb-pp-pair-n">' + spin + '</span></span>'; };
    var pairRow = function (a, b) { return '<div class="tb-pp-pair-row">' + pair(a) + '<span class="tb-pp-pair-sep">|</span>' + pair(b) + '</div>'; };
    // A color-accent tile with the label hardcoded and the number spinning.
    var tile = function (label, tone) { return '<div class="tb-pp-stat' + (tone ? ' ' + tone : '') + '"><div class="tb-pp-stat-n">' + spin + '</div><div class="tb-pp-stat-l">' + label + '</div></div>'; };
    // Upload key/value row: label hardcoded, value spinning.
    var upRow = function (k) { return '<div class="tb-pp-up-row"><span class="tb-pp-up-k">' + k + '</span><span class="tb-pp-up-v">' + spin + '</span></div>'; };

    var openCard = tbProfileCard(izImg('my-tickets', ic('ticket', 15)), 'My open tickets',
      '<div class="tb-pp-pairs">' + pairRow('Assigned', 'WIP') + pairRow('Researching', 'Pending') + '</div>');
    var ageCard = tbProfileCard(ICO_AGE, 'My tickets by age',
      '<div class="tb-pp-grid tb-pp-grid-5">'
      + tile('Purple', 'c-purple') + tile('Black', 'c-black') + tile('Red', 'c-red')
      + tile('Yellow', 'c-yellow') + tile('Green', 'c-green') + '</div>');
    // Upload card built manually so its header can carry the "Upload log" button (same as the live
    // card), keeping the skeleton visually identical to the loaded state.
    var uploadLogBtn = '<a class="tb-pp-up-loglink" href="data-log.html" aria-label="View upload log">' + ic('history', 13) + '<span>Upload log</span></a>';
    var uploadCard = '<section class="tb-pp-card tb-pp-card-upload">'
      + '<div class="tb-pp-card-h"><span class="tb-pp-ic">' + izImg('upload-new-data', ic('upload', 15)) + '</span>'
      +   '<span class="tb-pp-card-t">Change in data due to last upload</span>' + uploadLogBtn + '</div>'
      + '<div class="tb-pp-card-b"><div class="tb-pp-up">'
      + upRow('Uploaded by') + upRow('File') + upRow('When') + upRow('Newly added') + upRow('Updated')
      + upRow('Live \u2192 resolved') + upRow('SLA %') + upRow('Pet resolved by SIM')
      + '</div></div></section>';
    // The last card is the SLIDER shell — same markup as the live layout so the prev/dots/next
    // control bar is present during loading (no layout jump when the real data swaps in). The
    // control bar is inert in the skeleton (gets wired only when tbStartProfileSlider runs post-load).
    // Control bar carries .is-loading in the skeleton so it renders GREYED-OUT + inert until the real
    // data lands (renderProfileStats paints a control bar without that class, so it becomes active).
    var sliderShell = '<div class="tb-pp-slider-wrap">'
      + '<div class="tb-pp-slider"><div class="tb-pp-slide active">' + uploadCard + '</div></div>'
      + '<div class="tb-pp-slider-ctrl is-loading">'
      +   '<button type="button" class="tb-pp-sl-btn" aria-hidden="true" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>'
      +   '<span class="tb-pp-sl-dots"><span class="tb-pp-sl-dot active"></span><span class="tb-pp-sl-dot"></span><span class="tb-pp-sl-dot"></span><span class="tb-pp-sl-dot"></span></span>'
      +   '<button type="button" class="tb-pp-sl-btn" aria-hidden="true" tabindex="-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>'
      + '</div>'
      + '</div>';

    return openCard + ageCard + sliderShell;
  }

  // Icons for the profile section cards (reuse folder PNGs where they fit).
  var ICO_AGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  var ICO_RES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  // ---- Profile-column cross-page cache (localStorage, per-user, SWR) --------------------------
  // The profile column is rebuilt on every page (separate HTML docs), so to avoid re-requesting the
  // same data on each navigation we cache each section's payload in localStorage keyed per-user.
  // Cache-first: a page paints instantly from cache with NO network call. A fresh fetch happens only
  // on (1) a section's own reload button (force), or (2) a cache miss / expired entry. TTLs: the
  // stats + last-upload are long-lived (change only on upload); the 3 agents-activity windows are
  // time-sensitive so they use a short TTL (a day boundary flips the Today/Yesterday labels).
  var TB_PP_TTL_LONG = 6 * 60 * 60 * 1000;   // 6h for open-tickets / tickets-by-age / last-upload
  var TB_PP_TTL_SHORT = 7 * 60 * 1000;       // 7min for the agents-activity windows
  function tbPpCacheKey(key) { var u = (A.getUser && A.getUser()) || {}; return 'phd_pp_' + key + '_' + (u.username || 'anon'); }
  function tbPpCacheGet(key, ttl) {
    try {
      var raw = localStorage.getItem(tbPpCacheKey(key));
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.at || (Date.now() - o.at) > ttl) return null;  // expired -> treat as miss
      return o.data;
    } catch (e) { return null; }
  }
  function tbPpCacheSet(key, data) {
    try { localStorage.setItem(tbPpCacheKey(key), JSON.stringify({ at: Date.now(), data: data })); } catch (e) {}
  }

  // A small reload button for a profile-section card header (top-right). `onReload` is called when
  // clicked; it should re-fetch that section with force:true. Shows a spinning state until done.
  function tbPpReloadBtn(id) {
    return '<button type="button" class="tb-pp-reload" id="' + id + '" aria-label="Refresh this section" title="Refresh">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
      + '</button>';
  }
  // Wire a reload button (by id) living inside `scope` (a card element or document). Spins while the
  // provided fetcher runs. The fetcher returns a Promise; the spin stops when it settles.
  function tbPpWireReload(scope, btnId, fetcher) {
    var root = scope || document;
    var btn = root.querySelector ? root.querySelector('#' + btnId) : document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (btn.classList.contains('spinning')) return;
      btn.classList.add('spinning');
      var done = function () { try { var b = document.getElementById(btnId); if (b) b.classList.remove('spinning'); } catch (x) {} };
      try { Promise.resolve(fetcher()).then(done, done); } catch (x) { done(); }
    };
  }

  // Fetch /api/profile-stats and render role-aware SECTION CARDS into #tbPpStats, then the upload card.
  // `force` bypasses the cross-page cache (used by a section reload button).
  function tbLoadProfileStats(force) {
    var slot = document.getElementById('tbPpStats');
    if (!slot || !A || !A.api) return;
    // Cache-first: paint instantly from the cached payload (no network) unless forced. On a cache
    // hit we still render; on a miss (or force) we fetch, render, and cache.
    if (!force) {
      var cached = tbPpCacheGet('stats', TB_PP_TTL_LONG);
      if (cached) { renderProfileStats(cached); return; }
    }
    A.api('GET', '/api/profile-stats').then(function (r) {
      if (!r || !r.ok || !r.data) { slot.innerHTML = ''; tbLoadLastUpload(slot); return; }
      tbPpCacheSet('stats', r.data);
      renderProfileStats(r.data);
    }).catch(function () { if (slot) { slot.innerHTML = ''; } });

    // Render the stats cards + the upload/agents carousel from a /api/profile-stats payload `d`.
    function renderProfileStats(d) {
      var tile = function (label, val, tone) {
        return '<div class="tb-pp-stat' + (tone ? ' ' + tone : '') + '">'
          + '<div class="tb-pp-stat-n">' + (val != null ? val : 0) + '</div>'
          + '<div class="tb-pp-stat-l">' + label + '</div></div>';
      };
      // One inline "LABEL value" cell inside a pairs row (e.g. ASSIGNED 0 | WIP 12).
      var pair = function (label, val, tone) {
        return '<span class="tb-pp-pair' + (tone ? ' ' + tone : '') + '">'
          + '<span class="tb-pp-pair-l">' + label + '</span>'
          + '<span class="tb-pp-pair-n">' + (val != null ? val : 0) + '</span></span>';
      };
      // A row of two pairs separated by a divider: LABEL v | LABEL v
      var pairRow = function (a, b) {
        return '<div class="tb-pp-pair-row">' + a + '<span class="tb-pp-pair-sep">|</span>' + b + '</div>';
      };
      var html = '';
      // Weekly Performance Summary (managers + owners only). A placeholder card sits right below the
      // name banner; tbLoadWeeklySummary() fills it from weekly-summary.json after render.
      var canWeekly = (A.role && A.role() === 'manager') || atLeast('owner');
      if (canWeekly) {
        html += '<div id="tbPpWbrMbr"></div>';   // WBR + MBR carousel (filled after their JSON loads)
      }
      if (d.view === 'manager') {
        // "Resolved by everyone" card removed for managers per request. The WBR card (above) is their
        // primary summary; no other default card in this branch.
      } else {
        var s = d.statusCounts || {}, c = d.colors || {};
        html += tbProfileCard(izImg('my-tickets', ic('ticket', 15)), 'My open tickets',
          '<div class="tb-pp-pairs">'
          + pairRow(pair('Assigned', s['Assigned'] || 0), pair('WIP', s['Work In Progress'] || 0))
          + pairRow(pair('Researching', s['Researching'] || 0), pair('Pending', s['Pending'] || 0))
          + '</div>', null, tbPpReloadBtn('tbPpReloadOpen'));
        html += tbProfileCard(ICO_AGE, 'My tickets by age',
          '<div class="tb-pp-grid tb-pp-grid-5">'
          + tile('Purple', c.purple || 0, 'c-purple') + tile('Black', c.black || 0, 'c-black')
          + tile('Red', c.red || 0, 'c-red') + tile('Yellow', c.yellow || 0, 'c-yellow')
          + tile('Green', c.green || 0, 'c-green') + '</div>', null, tbPpReloadBtn('tbPpReloadAge'));
        // "My resolved" (Last 12h / Last 24h) card removed per request.
      }
      // The last "card" is a SLIDING CAROUSEL that alternates between the upload-change card and the
      // Agents-activity card every 3s. Both slides render their fixed labels immediately; the values
      // fill in from /api/last-upload and /api/agents-activity respectively.
      var upLoadRow = function (k) { return '<div class="tb-pp-up-row"><span class="tb-pp-up-k">' + k + '</span><span class="tb-pp-up-v"><span class="tb-pp-mini-spin"></span></span></div>'; };
      var uploadCard = tbProfileCard(izImg('upload-new-data', ic('upload', 15)), 'Change in data due to last upload',
        '<div id="tbPpUploadBody"><div class="tb-pp-up">'
        + upLoadRow('Uploaded by') + upLoadRow('File') + upLoadRow('When') + upLoadRow('Newly added') + upLoadRow('Updated')
        + upLoadRow('Live \u2192 resolved') + upLoadRow('SLA %') + upLoadRow('Pet resolved by SIM')
        + '</div></div>', 'tb-pp-card-upload', tbPpReloadBtn('tbPpReloadUpload'));
      // Three agent-activity windows: Today / Yesterday / Last week. Each is its own carousel slide,
      // with its own reload button in the card header.
      var agentSlide = function (bodyId, titleText, reloadId) {
        return tbProfileCard(izImg('group-analytics', ic('users', 15)), titleText,
          '<div id="' + bodyId + '">' + tbAgSkeleton() + '</div>', 'tb-pp-card-agents', tbPpReloadBtn(reloadId));
      };
      var todayCard = agentSlide('tbPpAgToday', 'Agents worked Today(' + tbEsc(tbAgTodayLabel()) + ')', 'tbPpReloadAgToday');
      var ydayCard = agentSlide('tbPpAgYesterday', 'Agents activity for ' + tbEsc(tbAgDayLabel(-1)) + ' (Yesterday)', 'tbPpReloadAgYday');
      var weekCard = agentSlide('tbPpAgLastWeek', 'Agents activity for ' + tbEsc(tbAgLastWeekLabel()) + ' (Last week)', 'tbPpReloadAgWeek');

      var slides = [uploadCard, todayCard, ydayCard, weekCard];
      var dots = '';
      for (var si = 0; si < slides.length; si++) dots += '<span class="tb-pp-sl-dot" data-i="' + si + '"></span>';
      var slideDivs = slides.map(function (c, i) { return '<div class="tb-pp-slide" data-slide="' + i + '">' + c + '</div>'; }).join('');

      html += '<div class="tb-pp-slider-wrap">'
        + '<div class="tb-pp-slider" id="tbPpSlider">' + slideDivs + '</div>'
        + '<div class="tb-pp-slider-ctrl">'
        +   '<button type="button" class="tb-pp-sl-btn tb-pp-sl-prev" id="tbPpSlPrev" aria-label="Previous card" title="Previous"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>'
        +   '<span class="tb-pp-sl-dots">' + dots + '</span>'
        +   '<button type="button" class="tb-pp-sl-btn tb-pp-sl-next" id="tbPpSlNext" aria-label="Next card" title="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>'
        + '</div>'
        + '</div>';
      slot.innerHTML = html;
      if (canWeekly) tbLoadSummaries();                    // weekly + monthly carousel (managers + owners)
      tbLoadLastUpload();                                  // upload card
      tbLoadAgentsActivity('today', 'tbPpAgToday');        // 3 agent windows
      tbLoadAgentsActivity('yesterday', 'tbPpAgYesterday');
      tbLoadAgentsActivity('lastweek', 'tbPpAgLastWeek');
      tbStartProfileSlider();                              // manual N-slide carousel
      // Wire the per-section reload buttons. Open-tickets + tickets-by-age both come from the single
      // /api/profile-stats call, so either button force-refreshes that whole call (re-renders both).
      tbPpWireReload(slot, 'tbPpReloadOpen', function () { return tbLoadProfileStats(true); });
      tbPpWireReload(slot, 'tbPpReloadAge', function () { return tbLoadProfileStats(true); });
      tbPpWireReload(slot, 'tbPpReloadUpload', function () { return tbLoadLastUpload(true); });
      tbPpWireReload(slot, 'tbPpReloadAgToday', function () { return tbLoadAgentsActivity('today', 'tbPpAgToday', true); });
      tbPpWireReload(slot, 'tbPpReloadAgYday', function () { return tbLoadAgentsActivity('yesterday', 'tbPpAgYesterday', true); });
      tbPpWireReload(slot, 'tbPpReloadAgWeek', function () { return tbLoadAgentsActivity('lastweek', 'tbPpAgLastWeek', true); });
    }
  }
  window.PHDLoadProfileStats = tbLoadProfileStats;

  // Repaint ONLY the profile banner's avatar + name/handle/role in place (no refetch of the stats).
  // Called after loadMyProfile() resolves so the stored base64 avatar replaces the initial-letter
  // fallback that was painted synchronously from the (avatar-less) session user on first render.
  function tbRepaintProfileBanner() {
    var panel = document.querySelector('.tb-profile-panel');
    if (!panel || !loggedIn()) return;
    var avSlot = panel.querySelector('.tb-pp-av');
    if (!avSlot) return;
    var prof = (A.myProfile && A.myProfile()) || (A.getUser && A.getUser()) || {};
    try { if (A.avatarHtml) avSlot.innerHTML = A.avatarHtml(prof, 56); } catch (e) {}
    var user = (A.getUser && A.getUser()) || {};
    var name = (prof && (prof.displayName || prof.username)) || user.username || 'Profile';
    var nameEl = panel.querySelector('.tb-pp-name');
    if (nameEl) nameEl.textContent = name;
  }
  window.PHDRepaintProfileBanner = tbRepaintProfileBanner;

  // Clear the cross-page profile-column cache for the current user. Call after a successful data
  // upload/publish so the next render (the full page reload after an upload) refetches every section
  // instead of showing pre-upload numbers.
  function tbClearProfileCache() {
    try {
      var u = (A.getUser && A.getUser()) || {}; var un = u.username || 'anon';
      ['stats', 'lastUpload', 'ag_today', 'ag_yesterday', 'ag_lastweek'].forEach(function (k) {
        try { localStorage.removeItem('phd_pp_' + k + '_' + un); } catch (e) {}
      });
    } catch (e) {}
  }
  window.PHDClearProfileCache = tbClearProfileCache;

  // ---- Weekly Performance Summary card (managers + owners) --------------------------------------
  // Rendered inside the profile column, directly below the name banner. Data comes from the static
  // weekly-summary.json so it can be updated weekly without touching code.
  // Signed WoW delta -> coloured chip. goodWhen ('up'|'down') decides green (good) vs red (bad).
  function tbWsDelta(wow, goodWhen) {
    if (wow == null || isNaN(wow)) return '';
    var up = wow > 0;
    var good = (goodWhen === 'up' && up) || (goodWhen === 'down' && !up);
    var arrow = up
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>';
    return '<span class="tb-ws-delta ' + (good ? 'good' : 'bad') + '">' + arrow + (up ? '+' : '') + wow + '% ' + (tbWsDelta._period || 'WoW') + '</span>';
  }
  // The delta suffix (WoW/MoM) is set transiently per card render via tbWsDelta._period.
  function tbWithPeriod(period, fn) { var prev = tbWsDelta._period; tbWsDelta._period = period; try { return fn(); } finally { tbWsDelta._period = prev; } }
  // Previous FULL calendar MONTH, derived from `today`. E.g. Oct 15 2026 -> "September 2026",
  // Jan 10 2026 -> "December 2025". Always a complete month (not a trailing-30-day window).
  function tbPrevFullMonthLabel(today) {
    var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var t = today || new Date();
    var d = new Date(t.getFullYear(), t.getMonth(), 1);
    d.setMonth(d.getMonth() - 1);
    return MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function tbMonthLabel(d) { return (d && d.month) ? d.month : tbPrevFullMonthLabel(new Date()); }
  // Previous FULL week (Sunday -> Saturday, matching the app's Sunday-aligned week bucket), derived
  // from `today`. E.g. Thu Oct 8 2026 -> Sun Sep 27 .. Sat Oct 3 2026. Returns a formatted label like
  // "Sep 27 – Oct 3, 2026" (one year shown when both ends share it).
  function tbPrevFullWeekLabel(today) {
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var t = today || new Date();
    var d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var curStart = new Date(d); curStart.setDate(d.getDate() - d.getDay());   // this week's Sunday
    var start = new Date(curStart); start.setDate(curStart.getDate() - 7);    // previous Sunday
    var end = new Date(start); end.setDate(start.getDate() + 6);              // previous Saturday
    var sameYear = start.getFullYear() === end.getFullYear();
    var left = MON[start.getMonth()] + ' ' + start.getDate() + (sameYear ? '' : ', ' + start.getFullYear());
    var right = MON[end.getMonth()] + ' ' + end.getDate() + ', ' + end.getFullYear();
    return left + ' \u2013 ' + right;
  }
  // The week label to show: an explicit d.week if provided, else the auto-derived previous full week.
  function tbWeekLabel(d) { return (d && d.week) ? d.week : tbPrevFullWeekLabel(new Date()); }

  // Build the FULL narrative report text (for clipboard export). Shared by the weekly + monthly cards;
  // `period` is the delta suffix ('WoW' | 'MoM'), `periodLabel` the date range / month shown in the title.
  function tbReportText(d, period, periodLabel) {
    if (!d) return '';
    period = period || 'WoW';
    var L = [];
    var title = (d.title || 'PHD Performance Summary');
    L.push(title + (periodLabel ? ' (' + periodLabel + ')' : ''));
    L.push('');
    (d.sections || []).forEach(function (s) { L.push(s.title + ': ' + s.body); L.push(''); });
    var dc = d.defectCodes || {};
    var imp = dc.improving || [], wat = dc.watch || [];
    if (imp.length || wat.length) {
      L.push('Defect Code Trends:');
      L.push('');
      if (imp.length) {
        var names = imp.map(function (x) { return x.label + ' (' + (x.wow > 0 ? '+' : '') + x.wow + '% ' + period + ')'; });
        L.push('\u2022 Improving: ' + names.join(' and ') + ' both showed meaningful improvement.');
      }
      wat.forEach(function (x) {
        var line = '\u2022 Watch Item: ' + x.label + ' increased ' + (x.wow > 0 ? '+' : '') + x.wow + '% ' + period;
        if (x.note) line += ' and ' + x.note.charAt(0).toLowerCase() + x.note.slice(1);
        L.push(line);
      });
      L.push('');
    }
    var addr = d.address || [];
    if (d.addressSentence || addr.length) {
      var core = d.addressSentence
        || (addr.map(function (x) { return x.v + ' ' + x.k.toLowerCase() + ' (' + (x.wow > 0 ? '+' : '') + x.wow + '% ' + period + ')'; }).join(' alongside ') + '.');
      var sentence = 'Address Exclusions & GEO Pins: ' + core;
      if (d.addressNote) sentence += ' ' + d.addressNote;
      L.push(sentence);
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function tbWeeklyReportText(d) { return tbReportText(d, 'WoW', tbWeekLabel(d)); }
  function tbMonthlyReportText(d) { return tbReportText(d, 'MoM', tbMonthLabel(d)); }
  // Copy text to clipboard with a textarea fallback for non-secure contexts. Returns a Promise<bool>.
  function tbCopyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return tbCopyFallback(text); });
    }
    return Promise.resolve(tbCopyFallback(text));
  }
  function tbCopyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-9999px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      var ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch (e) { return false; }
  }
  // The JSON for the currently-rendered weekly card (so the export button can read it on click).
  function tbExportLabel() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Export';
  }
  function tbExportCopy(btn, text) {
    tbCopyToClipboard(text).then(function (ok) {
      if (!btn) return;
      btn.classList.add('copied');
      btn.innerHTML = (ok ? 'Copied' : 'Copy failed');
      setTimeout(function () { btn.classList.remove('copied'); btn.innerHTML = tbExportLabel(); }, 1600);
    });
  }
  var TB_WEEKLY_DATA = null, TB_MONTHLY_DATA = null;
  function tbWeeklyExport(btn) { if (TB_WEEKLY_DATA) tbExportCopy(btn, tbWeeklyReportText(TB_WEEKLY_DATA)); }
  function tbMonthlyExport(btn) { if (TB_MONTHLY_DATA) tbExportCopy(btn, tbMonthlyReportText(TB_MONTHLY_DATA)); }
  window.PHDWeeklyExport = tbWeeklyExport;
  window.PHDMonthlyExport = tbMonthlyExport;

  // Generic metrics-ONLY summary card (shared by weekly + monthly). opts: {cardClass, title, sub,
  // period ('WoW'|'MoM'), toggleFn, exportFn}. Collapsed by default; header is a role=button DIV
  // (NOT a <button>, which must not contain the Export <button>). Export stops propagation.
  function tbSummaryCardHtml(d, opts) {
    if (!d) return '';
    return tbWithPeriod(opts.period, function () {
      var kpis = (d.kpis || []).map(function (x) {
        return '<div class="tb-ws-kpi"><div class="tb-ws-k">' + tbEsc(x.k) + '</div>'
          + '<div class="tb-ws-vrow"><span class="tb-ws-v">' + tbEsc(x.v) + '</span>' + tbWsDelta(x.wow, x.goodWhen) + '</div></div>';
      }).join('');
      var dc = d.defectCodes || {};
      var row = function (x, kind) {
        return '<div class="tb-ws-row ' + kind + '"><div class="tb-ws-row-top">'
          + '<span class="tb-ws-tag ' + kind + '">' + (kind === 'improving' ? 'Improving' : 'Watch') + '</span>'
          + '<span class="tb-ws-row-label">' + tbEsc(x.label) + '</span>' + tbWsDelta(x.wow, 'down') + '</div></div>';
      };
      var improving = (dc.improving || []).map(function (x) { return row(x, 'improving'); }).join('');
      var watch = (dc.watch || []).map(function (x) { return row(x, 'watch'); }).join('');
      var defectBlock = (improving || watch)
        ? '<div class="tb-ws-div"></div><div class="tb-ws-block-h">Defect Code Trends</div><div class="tb-ws-rows">' + improving + watch + '</div>'
        : '';
      var addr = (d.address || []).map(function (x) {
        return '<div class="tb-ws-kpi"><div class="tb-ws-k">' + tbEsc(x.k) + '</div>'
          + '<div class="tb-ws-vrow"><span class="tb-ws-v">' + tbEsc(x.v) + '</span>' + tbWsDelta(x.wow, x.goodWhen) + '</div></div>';
      }).join('');
      var addrBlock = addr
        ? '<div class="tb-ws-div"></div><div class="tb-ws-block-h">Address Exclusions &amp; GEO Pins</div><div class="tb-ws-kpis">' + addr + '</div>'
        : '';
      var sub = opts.sub || '';
      var body = (kpis ? '<div class="tb-ws-kpis">' + kpis + '</div>' : '') + defectBlock + addrBlock;
      // Collapsed by default; the header row toggles THIS card's own collapse. Export stops
      // propagation so it copies without toggling.
      var exportBtn = '<button type="button" class="tb-ws-export" data-label="Export" title="Copy full report to clipboard" onclick="event.stopPropagation();' + opts.exportFn + '(this)">' + tbExportLabel() + '</button>';
      var caret = '<span class="tb-ws-caret">' + ic('chevron-down', 16) + '</span>';
      var header = '<div class="tb-pp-card-h tb-ws-head" role="button" tabindex="0" aria-expanded="false" onclick="PHDSummaryToggle(this)" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();PHDSummaryToggle(this);}">'
        + '<span class="tb-pp-ic">' + ic('bar-chart', 15) + '</span>'
        + '<span class="tb-ws-head-meta"><span class="tb-pp-card-t">' + tbEsc(d.title || opts.title) + '</span>'
        + (sub ? '<span class="tb-ws-sub">' + sub + '</span>' : '') + '</span>'
        + exportBtn + caret + '</div>';
      return '<section class="tb-pp-card ' + opts.cardClass + '">' + header + '<div class="tb-ws-collapse"><div class="tb-ws-inner">' + body + '</div></div></section>';
    });
  }
  function tbWeeklySummaryCardHtml(d) {
    TB_WEEKLY_DATA = d;
    return tbSummaryCardHtml(d, { cardClass: 'tb-pp-card-weekly', title: 'Weekly Performance Summary', sub: tbWeekLabel(d), period: 'WoW', exportFn: 'PHDWeeklyExport' });
  }
  function tbMonthlySummaryCardHtml(d) {
    TB_MONTHLY_DATA = d;
    return tbSummaryCardHtml(d, { cardClass: 'tb-pp-card-weekly tb-pp-card-monthly', title: 'Monthly Performance Summary', sub: tbMonthLabel(d), period: 'MoM', exportFn: 'PHDMonthlyExport' });
  }
  // Summary accordion: expand the clicked card and collapse its siblings in the same stack, so only
  // one of Weekly / Monthly is open at a time. Clicking the already-open card collapses it (allowing
  // a fully-collapsed state too).
  function tbSummaryToggle(btn) {
    var card = btn.closest ? btn.closest('.tb-pp-card-weekly') : null;
    if (!card) return;
    var willOpen = !card.classList.contains('open');
    var stack = card.closest ? card.closest('.tb-pp-summ-stack') : null;
    if (stack) {
      var cards = stack.querySelectorAll('.tb-pp-card-weekly');
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var on = (c === card) && willOpen;
        c.classList.toggle('open', on);
        var h = c.querySelector('.tb-ws-head'); if (h) h.setAttribute('aria-expanded', on ? 'true' : 'false');
      }
    } else {
      card.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }
  }
  window.PHDSummaryToggle = tbSummaryToggle;
  function tbFetchJson(url) {
    return fetch(url + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  // Fetch BOTH summaries, then render them STACKED (Weekly first, Monthly below) inside one accordion
  // group: only one card is expanded at a time. Default = Weekly expanded. Each card keeps its header
  // + Export button. If a JSON is missing its card is skipped.
  function tbLoadSummaries() {
    var box = document.getElementById('tbPpWbrMbr');
    if (!box) return;
    Promise.all([tbFetchJson('weekly-summary.json'), tbFetchJson('monthly-summary.json')]).then(function (res) {
      var cards = [];
      if (res[0]) cards.push(tbWeeklySummaryCardHtml(res[0]));   // Weekly FIRST
      if (res[1]) cards.push(tbMonthlySummaryCardHtml(res[1]));  // Monthly SECOND
      var b = document.getElementById('tbPpWbrMbr');
      if (!b) return;
      if (!cards.length) { b.innerHTML = ''; return; }
      // Both cards start COLLAPSED by default. The accordion still enforces only-one-open once the
      // user expands a card.
      b.innerHTML = '<div class="tb-pp-summ-stack" id="tbPpSummStack">' + cards.join('') + '</div>';
    });
  }

  // Fetch /api/last-upload and fill the #tbPpUploadBody loader shell inside the upload card.
  // Cache-first across pages; `force` bypasses the cache (section reload button). Returns a Promise.
  function tbLoadLastUpload(force) {
    var body = document.getElementById('tbPpUploadBody');
    if (!body || !A || !A.api) return Promise.resolve();
    // Put an "Upload log" BUTTON (icon + label) in the upload card's HEADER, right corner, vertically
    // centered with the title. Links to the data-log page. Injected once per render.
    try {
      var upCard = body.closest ? body.closest('.tb-pp-card') : null;
      var upCardH = upCard ? upCard.querySelector('.tb-pp-card-h') : null;
      if (upCardH && !upCardH.querySelector('.tb-pp-up-loglink')) {
        var a = document.createElement('a');
        a.className = 'tb-pp-up-loglink';
        a.href = 'data-log.html';
        a.setAttribute('aria-label', 'View upload log');
        a.innerHTML = ic('history', 13) + '<span>Upload log</span>';
        upCardH.appendChild(a);
      }
    } catch (e) {}
    // Resolve the account timezone SYNCHRONOUSLY from the already-cached /api/me (A._me), with a
    // hard 'IST' fallback. We must NOT await /api/me here — doing so can leave the loader stuck
    // forever if that request is slow/pending. The upload fetch below runs unconditionally.
    var tz = 'IST';
    try {
      var me = A._me;
      if (!me) { try { var st = A._storeRead && A._storeRead('me'); if (st && st.data) me = st.data; } catch (e0) {} }
      if (me && me.timezone === 'MST') tz = 'MST';
    } catch (e) {}
    var ianaZone = (tz === 'MST') ? 'America/Denver' : 'Asia/Kolkata';
    // Render the upload summary from a /api/last-upload payload `d` into the card body.
    var renderUpload = function (d) {
      if (!d || d.none) { body.innerHTML = '<div class="tb-pp-up-empty">No uploads yet.</div>'; return; }
      // "When" rendered in the ACCOUNT timezone, with the account's label (IST/MST) appended.
      var when = '';
      try {
        var dt = d.at ? new Date(d.at) : null;
        if (dt && !isNaN(dt)) {
          when = dt.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ianaZone }) + ' ' + tz;
        } else { when = d.at || ''; }
      } catch (e) {
        // Fallback: format without an explicit zone but still label with the account tz.
        try { var dt2 = d.at ? new Date(d.at) : null; when = (dt2 && !isNaN(dt2)) ? (dt2.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' ' + tz) : (d.at || ''); } catch (e2) { when = d.at || ''; }
      }
      var row = function (label, val) {
        return '<div class="tb-pp-up-row"><span class="tb-pp-up-k">' + label + '</span><span class="tb-pp-up-v">' + val + '</span></div>';
      };
      var slaTxt = (d.slaPct != null) ? (d.slaPct + '%') : '\u2014';
      body.innerHTML = '<div class="tb-pp-up">'
        + row('Uploaded by', tbEsc(d.user || '\u2014'))
        + row('File', tbEsc(d.fileName || '\u2014'))
        + row('When', tbEsc(when || '\u2014'))
        + row('Newly added', (d.added != null ? d.added : 0))
        + row('Updated', (d.updated != null ? d.updated : 0))
        + row('Live \u2192 resolved', (d.becameResolved != null ? d.becameResolved : 0))
        + row('SLA %', slaTxt)
        + row('Pet resolved by SIM', (d.petResolvedBySim != null ? d.petResolvedBySim : 0))
        + '</div>';
    };
    // Cache-first: paint instantly from cache (no network) unless forced.
    if (!force) {
      var cached = tbPpCacheGet('lastUpload', TB_PP_TTL_LONG);
      if (cached) { renderUpload(cached); return Promise.resolve(); }
    }
    return A.api('GET', '/api/last-upload').then(function (r) {
      if (!r || !r.ok || !r.data) { body.innerHTML = '<div class="tb-pp-up-empty">Could not load upload summary.</div>'; return; }
      tbPpCacheSet('lastUpload', r.data);
      renderUpload(r.data);
    }).catch(function () { body.innerHTML = '<div class="tb-pp-up-empty">Could not load upload summary.</div>'; });
  }

  // Avatar chip for an agent row: a round photo if present, else a coloured initial. The colour is
  // derived from the name so each agent keeps a stable chip colour.
  function tbAgAvatar(a) {
    var nm = a.name || a.username || '?';
    if (a.avatar) return '<span class="tb-pp-ag-av"><img src="' + a.avatar + '" alt=""></span>';
    var letter = nm.trim().charAt(0).toUpperCase() || '?';
    var hues = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5', '#b45309', '#0ea5e9'];
    var h = 0; for (var i = 0; i < nm.length; i++) h = (h + nm.charCodeAt(i)) % hues.length;
    return '<span class="tb-pp-ag-av tb-pp-ag-av-i" style="background:' + hues[h] + '">' + tbEsc(letter) + '</span>';
  }
  // Loading skeleton for an agent slide: the column header + 7 shimmer rows (avatar circle + name
  // bar + three number bars) so the slide shows its real shape while /api/agents-activity loads.
  function tbAgSkeleton() {
    var colHead = '<div class="tb-pp-ag-head">'
      + '<span class="tb-pp-ag-id">Agent</span>'
      + '<span class="tb-pp-ag-metric">Commented</span>'
      + '<span class="tb-pp-ag-metric">Successful</span>'
      + '<span class="tb-pp-ag-metric">Immediate</span>'
      + '</div>';
    var row = '<div class="tb-pp-ag-row">'
      + '<span class="tb-pp-ag-id"><span class="tb-pp-ag-av tb-pp-sk"></span>'
      +   '<span class="tb-pp-ag-idtext"><span class="tb-pp-sk" style="width:72px;height:9px;margin-bottom:4px"></span>'
      +   '<span class="tb-pp-sk" style="width:28px;height:7px"></span></span></span>'
      + '<span class="tb-pp-ag-metric"><span class="tb-pp-sk" style="width:16px;height:11px"></span></span>'
      + '<span class="tb-pp-ag-metric"><span class="tb-pp-sk" style="width:16px;height:11px"></span></span>'
      + '<span class="tb-pp-ag-metric"><span class="tb-pp-sk" style="width:16px;height:11px"></span></span>'
      + '</div>';
    var rows = ''; for (var i = 0; i < 7; i++) rows += row;
    return '<div class="tb-pp-ag">' + colHead + '<div class="tb-pp-ag-rows">' + rows + '</div></div>';
  }
  // Per-window state so each agent slide (today/yesterday/lastweek) keeps its own data + sort column
  // and can re-render instantly on a column-sort click without re-fetching. Keyed by the body id.
  var tbAgState = {};   // bodyId -> { data, sort, window }

  // Viewer's timezone (IST/MST) from the cached /api/me.
  function tbViewerTz() {
    try { var me = A._me || (A._storeRead && A._storeRead('me') && A._storeRead('me').data); if (me && me.timezone === 'MST') return 'MST'; } catch (e) {}
    return 'IST';
  }
  // Today's date label in the viewer's timezone, e.g. "Aug 03, 2026".
  function tbAgTodayLabel() {
    var zone = tbViewerTz() === 'MST' ? 'America/Denver' : 'Asia/Kolkata';
    try { return new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: zone }); } catch (e) { return ''; }
  }
  // Date label for (now + deltaDays) in the viewer's timezone — used for the "Yesterday" title.
  function tbAgDayLabel(deltaDays) {
    var zone = tbViewerTz() === 'MST' ? 'America/Denver' : 'Asia/Kolkata';
    try { var d = new Date(); d.setDate(d.getDate() + deltaDays); return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: zone }); } catch (e) { return ''; }
  }
  // "Jul 26 → Aug 01" label for the previous completed Sun..Sat week in the viewer's timezone.
  function tbAgLastWeekLabel() {
    var zone = tbViewerTz() === 'MST' ? 'America/Denver' : 'Asia/Kolkata';
    try {
      var now = new Date();
      // Day-of-week index (0=Sun) in the viewer's zone, via the SHORT weekday name ('numeric' is not
      // a valid Intl weekday option and would throw).
      var wd = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: zone });
      var dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
      if (dow < 0) dow = now.getDay();
      var sun = new Date(now); sun.setDate(sun.getDate() - (dow + 7));   // previous week's Sunday
      var sat = new Date(sun); sat.setDate(sat.getDate() + 6);           // ...through Saturday
      var fShort = function (dt) { return dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: zone }); };
      var fFull = function (dt) { return dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: zone }); };
      return fShort(sun) + ' \u2192 ' + fFull(sat);   // e.g. "Jul 26 → Aug 01, 2026"
    } catch (e) { return ''; }
  }

  // Render one agent slide (keyed by bodyId) from its cached payload using its own sort column.
  function tbRenderAgents(bodyId) {
    var body = document.getElementById(bodyId);
    var st = tbAgState[bodyId];
    if (!body || !st || !st.data) return;
    var isToday = (st.window === 'today');
    var agents = (st.data.agents || []).slice();
    var n = (st.data.activeCount != null) ? st.data.activeCount : agents.length;

    // The TODAY slide's "N active today" badge sits in the CARD HEADER (same row as the title),
    // pushed to the right. Inject it into the sibling .tb-pp-card-h so title (left) + badge (right)
    // share one row. Past windows have no badge.
    var card = body.closest ? body.closest('.tb-pp-card') : null;
    var cardH = card ? card.querySelector('.tb-pp-card-h') : null;
    if (cardH) {
      var old = cardH.querySelector('.tb-pp-ag-active');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      if (isToday) {
        var badge = document.createElement('span');
        badge.className = 'tb-pp-ag-active';
        badge.textContent = n + ' active today';
        cardH.appendChild(badge);
      }
    }

    if (!agents.length) {
      var emptyMsg = isToday ? 'No agent activity today yet.' : 'No agent activity in this period.';
      body.innerHTML = '<div class="tb-pp-ag-empty">' + emptyMsg + '</div>';
      return;
    }

    var sort = st.sort || 'successful';
    agents.sort(function (a, b) {
      var ka = (sort === 'immediate') ? (a.immediate || 0) : (a.successful || 0);
      var kb = (sort === 'immediate') ? (b.immediate || 0) : (b.successful || 0);
      var oa = (sort === 'immediate') ? (a.successful || 0) : (a.immediate || 0);
      var ob = (sort === 'immediate') ? (b.successful || 0) : (b.immediate || 0);
      return (kb - ka) || (ob - oa) || String(a.name || a.username).localeCompare(String(b.name || b.username));
    });

    var sucArrow = sort === 'successful' ? ' \u25BC' : '';
    var immArrow = sort === 'immediate' ? ' \u25BC' : '';
    var colHead = '<div class="tb-pp-ag-head">'
      + '<span class="tb-pp-ag-id">Agent</span>'
      + '<span class="tb-pp-ag-metric">Commented</span>'
      + '<span class="tb-pp-ag-metric tb-pp-ag-sort' + (sort === 'successful' ? ' on' : '') + '" data-sort="successful" role="button" tabindex="0">Successful' + sucArrow + '</span>'
      + '<span class="tb-pp-ag-metric tb-pp-ag-sort' + (sort === 'immediate' ? ' on' : '') + '" data-sort="immediate" role="button" tabindex="0">Immediate' + immArrow + '</span>'
      + '</div>';

    var tzOnly = function (a) { return a.tz || ''; };   // each row counted in the agent's own tz day
    var rowHtml = function (a) {
      var nm = a.name || a.username || '\u2014';
      // On the Today card, a small green blinking dot next to the timezone marks an analyst who
      // worked today (had any successful / immediate / commented activity).
      var worked = ((a.successful || 0) + (a.immediate || 0) + (a.commented || 0)) > 0;
      var workedDot = (isToday && worked) ? '<span class="tb-pp-ag-live" title="Worked today"></span>' : '';
      return '<div class="tb-pp-ag-row">'
        + '<span class="tb-pp-ag-id">' + tbAgAvatar(a)
        +   '<span class="tb-pp-ag-idtext"><span class="tb-pp-ag-nm">' + tbEsc(nm) + '</span>'
        +   '<span class="tb-pp-ag-ago">' + tbEsc(tzOnly(a)) + workedDot + '</span></span>'
        + '</span>'
        + '<span class="tb-pp-ag-metric">' + (a.commented || 0) + '</span>'
        + '<span class="tb-pp-ag-metric">' + (a.successful || 0) + '</span>'
        + '<span class="tb-pp-ag-metric">' + (a.immediate || 0) + '</span>'
        + '</div>';
    };
    // Show ALL agents (the profile column flows with the page, so no top-7/bottom paging). Rows live
    // in a scrollable container as a safety cap for very long lists.
    var rows = agents.map(rowHtml).join('');
    var moreBtn = '';

    var tm = st.data.team || {};
    var periodWord = isToday ? 'Team today' : (st.window === 'yesterday' ? 'Team that day' : 'Team that week');
    var foot = '<div class="tb-pp-ag-foot">' + periodWord + ': <b>' + (tm.successful || 0) + '</b> resolved successful \u00b7 <b>' + (tm.immediate || 0) + '</b> resolved Immediately \u00b7 <b>' + (tm.commented || 0) + '</b> commented</div>'
      + '<div class="tb-pp-ag-note">Each agent counted on their own local day. Reflects dashboard data \u2014 may differ from actuals until the next upload.</div>';

    // Rows scroll inside a capped container (safety when expanded); the Show-all/less button sits
    // just under them so the top 7 show by default and the rest load on demand.
    body.innerHTML = '<div class="tb-pp-ag">' + colHead + '<div class="tb-pp-ag-rows">' + rows + '</div>' + moreBtn + foot + '</div>';

    // Wire the page toggle (top 7 <-> bottom rest).
    var mb = body.querySelector('.tb-pp-ag-more');
    if (mb) mb.onclick = function (e) { e.preventDefault(); e.stopPropagation(); st.page = (st.page === 1) ? 0 : 1; tbRenderAgents(bodyId); };

    var sorters = body.querySelectorAll('.tb-pp-ag-sort');
    for (var i = 0; i < sorters.length; i++) {
      (function (el) {
        var key = el.getAttribute('data-sort');
        var apply = function () { if (st.sort !== key) { st.sort = key; st.page = 0; tbRenderAgents(bodyId); } };
        el.onclick = apply;
        el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } };
      })(sorters[i]);
    }
  }

  // Fetch /api/agents-activity for a given window ('today'|'yesterday'|'lastweek') and render it into
  // the slide identified by bodyId. Columns: Agent | Commented | Successful | Immediate (last two
  // sortable). Each window keeps its own cached data + sort state.
  // `force` bypasses the cross-page cache (section reload button). Returns a Promise. These windows
  // are time-sensitive, so they use the SHORT cache TTL (a day boundary flips the Today/Yesterday
  // labels — a short TTL keeps a stale label from lingering across pages).
  function tbLoadAgentsActivity(windowName, bodyId, force) {
    var body = document.getElementById(bodyId);
    if (!body || !A || !A.api) return Promise.resolve();
    tbAgState[bodyId] = { data: null, sort: 'successful', window: windowName, page: 0 };
    if (!force) {
      var cached = tbPpCacheGet('ag_' + windowName, TB_PP_TTL_SHORT);
      if (cached) { tbAgState[bodyId].data = cached; tbRenderAgents(bodyId); return Promise.resolve(); }
    }
    // A forced reload shows the skeleton again while the fresh data loads.
    if (force) body.innerHTML = tbAgSkeleton();
    return A.api('GET', '/api/agents-activity?window=' + encodeURIComponent(windowName)).then(function (r) {
      if (!r || !r.ok || !r.data) { body.innerHTML = '<div class="tb-pp-ag-empty">Could not load agents activity.</div>'; return; }
      tbPpCacheSet('ag_' + windowName, r.data);
      tbAgState[bodyId].data = r.data;
      tbRenderAgents(bodyId);
    }).catch(function () { body.innerHTML = '<div class="tb-pp-ag-empty">Could not load agents activity.</div>'; });
  }

  // MANUAL N-slide carousel: all slides are stacked in one grid cell; only the active index is shown
  // (slide in from the right on "next", from the left on "prev"). Prev/next buttons + dots drive it.
  // No auto-advance. The slide count is read from the DOM so adding slides needs no JS change here.
  function tbStartProfileSlider(sliderEl) {
    var slider = sliderEl || document.getElementById('tbPpSlider');
    if (!slider) return;
    // Controls live in the slider's wrapper (.tb-pp-slider-wrap), so this works for ANY slider
    // instance, not just the fixed-ID upload/agents one.
    var wrap = slider.closest ? slider.closest('.tb-pp-slider-wrap') : slider.parentNode;
    var prevBtn = wrap ? wrap.querySelector('.tb-pp-sl-prev') : null;
    var nextBtn = wrap ? wrap.querySelector('.tb-pp-sl-next') : null;
    if (!prevBtn) prevBtn = document.getElementById('tbPpSlPrev');   // legacy fallback (upload slider)
    if (!nextBtn) nextBtn = document.getElementById('tbPpSlNext');
    var dots = wrap ? wrap.querySelectorAll('.tb-pp-sl-dot') : [];
    var slideEls = slider.querySelectorAll('.tb-pp-slide');
    var count = slideEls.length || 1;
    var idx = 0;

    function render(dir) {
      slider.setAttribute('data-dir', dir < 0 ? 'prev' : 'next');
      for (var i = 0; i < slideEls.length; i++) slideEls[i].classList.toggle('active', i === idx);
      for (var j = 0; j < dots.length; j++) dots[j].classList.toggle('active', j === idx);
    }
    function go(dir) { idx = (idx + (dir < 0 ? -1 : 1) + count) % count; render(dir); }

    if (prevBtn) prevBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); go(-1); };
    if (nextBtn) nextBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); go(1); };
    for (var k = 0; k < dots.length; k++) {
      (function (d) { d.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var t = +d.getAttribute('data-i'); if (t === idx) return;
        var dir = t > idx ? 1 : -1; idx = t; render(dir);
      }; })(dots[k]);
    }

    render(1);     // start on the first slide (upload)
  }

  // Repaint the rail profile badge from the CURRENT profile. buildRailProfile() early-returns when
  // the badge already exists, so after the profile (with its base64 avatar) loads we must remove the
  // stale badge and rebuild it — otherwise it stays stuck on the initial-letter fallback until a full
  // page reload. Called after login / profile load.
  function rebuildRailProfile() {
    var col = tbFabColRight();
    var existing = col.querySelector('.tb-fab-item-profile');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    buildRailProfile();
  }
  window.PHDRefreshRailProfile = rebuildRailProfile;
  // Load the full profile (photo + display name) in the background, then repaint the rail badge +
  // role-gated FABs. Shared by every mount branch (app.html, no-toolbar pages, and the normal path)
  // so the avatar photo shows without needing a full reload. Safe to call when logged out (no-op).
  async function hydrateProfileAndRepaint() {
    if (!loggedIn()) return;
    try { if (A.loadMyProfile) await A.loadMyProfile(); } catch (e) {}
    try { if (A._refreshMe) await A._refreshMe(); else if (A.getMe) await A.getMe(); } catch (e) {}
    try { if (window.PHDNav && window.PHDNav.refreshRight) window.PHDNav.refreshRight(); } catch (e) {}
    try { rebuildRailProfile(); } catch (e) {}          // repaint the right-rail avatar badge with the photo
    try { buildProfilePanel(); } catch (e) {}           // repaint the right PROFILE PANEL with the real avatar/name
    try { if (typeof applyAnalyticsFabState === 'function') applyAnalyticsFabState(); } catch (e) {}
    try { if (typeof applyNavFabsState === 'function') applyNavFabsState(); } catch (e) {}
  }
  window.PHDHydrateProfile = hydrateProfileAndRepaint;

  // ---- Presence heartbeat ----
  // While logged in and the tab is VISIBLE, ping /api/presence/ping so the server knows this user
  // is online (drives the "Agents online" list). Pings immediately, then every 30s. Pauses while the
  // Presence heartbeat was RETIRED — the Agents activity card is now productivity-based (each agent
  // credited for work on their own day), so we no longer track who has a tab open. Kept as a no-op
  // so the existing mount-branch calls stay valid; the /api/presence/ping endpoint is left dormant.
  function tbStartPresenceHeartbeat() { /* no-op: presence tracking removed */ }
  window.PHDStartPresence = tbStartPresenceHeartbeat;
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
      // My Tickets moved to the profile column (right panel) — removed from the left rail.
      // Upload new data is a DIRECT rail button (replaces the old "Data" fly-out) — opens the CSV
      // picker on click. The "View upload log" link moved to the profile upload card's header.
      { key: 'upload-new',    label: 'Upload new data',         img: 'icons/upload-new-data.png', type: 'upload',                  need: 'upload' },
      { key: 'tools',         label: 'PHD Tools',               img: 'icons/phd-tools.png',    href: 'tools.html',                 need: 'li' },
      { key: 'shift-report', label: 'Shift Report',            img: 'icons/shift-report.png', href: 'app.html?view=shift-report', need: 'li' },
      { key: 'help-activity', label: 'Alerts',                 img: 'icons/alerts.png',       href: 'alerts.html',                need: 'li', badge: 'alerts' }
      // Repeat Incidents / SLA Breaches / Station Requests / Unique cases now live in the line-chart
      // "Reports" fly-out; Program History (Before WWOS / Moved under WWOS) lives in the calendar
      // fly-out; Users / Database health / Grouping Page live in the user-shield "Admin" fly-out.
    ];
    // Rail order is fixed (drag-and-drop removed) — items stay in their defined order.
    var col = tbFabCol(); // LEFT rail
    // Nav items insert ABOVE the LIVE wrapper item (which is pinned to the bottom of the left rail).
    var anchor = col.querySelector('.tb-fab-item-live'); // insert above LIVE
    var canUpload = A.canUpload && A.canUpload();
    items.forEach(function (it) {
      var enabled = tbNeedMet(it.need, li, isAdmin, isOwner);
      // HIDE (don't just disable) any login-gated item when logged OUT. Items that need no login
      // (need:true/'any') still show. All current nav FABs require login, so they vanish for guests.
      if (!li && it.need !== true && it.need !== 'any') return;
      // Upload is a button (opens the in-place CSV picker); a placeholder is an inert button;
      // everything else is a link.
      var isUpload = it.type === 'upload';
      var isPlaceholder = !!it.placeholder;
      var fab = document.createElement((isUpload || isPlaceholder) ? 'button' : 'a');
      fab.className = 'tb-nav-fab' + (isUpload ? ' tb-nav-upload' : '') + (enabled ? '' : ' tb-nav-disabled');
      fab.setAttribute('aria-label', it.label);
      fab.setAttribute('data-need', it.need === true ? 'any' : it.need);
      fab.setAttribute('data-key', it.key);
      if (it.href) fab.setAttribute('data-href', it.href);
      // Icon: a custom PNG when `img` is set, otherwise an inline SVG icon. ivURL -> .v3.png (new file).
      var iconHtml = it.img ? '<img class="tb-nav-img" src="' + ivURL(it.img) + '" alt="">' : ic(it.icon);
      // Optional count badge on the icon (e.g. open-alert count on the Alerts nav FAB).
      // Start in a "loading" state showing a tiny spinner (not a premature "0") until the real
      // count is fetched by refreshAlertBadge().
      var badgeHtml = it.badge ? '<span class="tb-nav-badge loading show" id="navBadge-' + it.badge + '"><span class="tb-nav-badge-spin"></span></span>' : '';
      fab.innerHTML = '<span class="tb-nav-ic">' + iconHtml + badgeHtml + '</span>'
        + '<span class="tb-nav-label">' + it.label + '</span>';
      if (isPlaceholder) {
        // Inert placeholder (e.g. WFH activity): a button that does nothing yet. No native tooltip;
        // the always-visible caption names it. Kept clickable-looking but performs no action.
        fab.type = 'button';
        fab.setAttribute('data-placeholder', '1');
        fab.onclick = function () { /* WFH activity: not wired up yet */ };
      } else if (isUpload) {
        fab.type = 'button';
        // No title on enabled buttons — the always-visible caption already names them (avoids the
        // redundant native hover tooltip). Disabled state keeps a title explaining why.
        if (enabled) { fab.onclick = function () { if (window.tbUploadIntro) tbUploadIntro('app'); }; }
        else { fab.setAttribute('aria-disabled', 'true'); fab.title = li ? (it.label + ' — you do not have upload access') : ('Log in to ' + it.label); }
      } else if (enabled) {
        fab.href = it.href;
      } else {
        fab.setAttribute('aria-disabled', 'true');
        fab.title = li ? (it.label + ' — you do not have access') : ('Log in to view ' + it.label);
      }
      // Wrap the pill + an always-visible caption in a centered column item.
      var item = document.createElement('div');
      item.className = 'tb-fab-item';
      item.appendChild(fab);
      var cap = document.createElement('div');
      cap.className = 'tb-fab-cap' + (enabled ? '' : ' is-disabled');
      cap.textContent = it.label;
      item.appendChild(cap);
      // Keep list order by inserting each new item just before the anchor (Live/Analytics).
      if (anchor) col.insertBefore(item, anchor); else col.appendChild(item);
    });
    // Hidden file input the Upload FAB feeds (the in-place pipeline binds a delegated #uploadFile listener).
    if (!document.getElementById('uploadFile')) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv'; inp.id = 'uploadFile'; inp.style.display = 'none';
      document.body.appendChild(inp);
    }
    // Fly-out groups now live on the LEFT rail (with the nav FABs). Each trigger slides its stack
    // out to the RIGHT (the default, non-mirrored direction). Flag-gated. Inserted ABOVE the LIVE
    // item so the left-rail order is: logo, nav FABs, [Data, Reports, Issue Types, Program History,
    // Admin, Analytics], LIVE (bottom).
    var rcol = col;                 // left rail (same column as the nav FABs)
    var ranchor = anchor;           // insert above the LIVE wrapper item
    // (Data fly-out removed — "Upload new data" is now a direct nav FAB; "View upload log" moved to
    // the profile upload card header.)
    // (Issue Types fly-out removed from the rail.)
    // Reports + Program History fly-outs are login-gated — HIDDEN entirely for logged-out guests.
    if (li) {
      buildFlyoutGroup(rcol, ranchor, li, isAdmin, isOwner, {
        id: 'reports', triggerIcon: 'line-chart', triggerImg: 'icons/reports.png', triggerLabel: 'Reports', items: [
          { key: 'sla-breach',      label: 'SLA Breaches (>240h)',    img: 'icons/sla-breaches.png',    href: 'sla-breach.html',      need: 'sla' },
          { key: 'station-request', label: 'Station Request Tickets', img: 'icons/station-request.png', href: 'station-request.html', need: 'sr' },
          { key: 'hashtags',        label: 'Hashtags',                img: 'icons/hashtags.png',        href: 'hashtags.html',        need: 'li' },
          { key: 'countries',       label: 'Countries Statistics',    img: 'icons/countries.png',       href: 'countries.html',       need: 'li' },
          { key: 'incident-types',  label: 'Incident Types',          icon: 'bolt',                     href: 'incident-types.html',  need: 'li' },
          { key: 'resolutions',     label: 'Resolutions',             icon: 'target',                   href: 'resolutions.html',     need: 'li' },
          { key: 'hi-resolved',     label: 'Repeat Incidents',        img: 'icons/repeat-incidents.png',href: 'hi-resolved.html',     need: 'repeat' },
          { key: 'unique-cases',    label: 'Unique cases',            img: 'icons/unique-cases.png',    href: 'important-cases.html', need: 'unique' }
        ]
      });
      // (Program History flyout removed from the nav rail per request. The BC-era page at
      //  archive.html still exists and is reachable directly / from the home page.)
    }
    // (Admin flyout removed from the rail — Users / Database health / Grouping Page now live on the
    //  profile page. See profile.html "Admin tools" section.)
    // (Drag-and-drop reordering removed — the rail order is now fixed.)
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
    // No native title — the always-visible caption below the trigger names it. Supports a custom PNG
    // (triggerImg) or an inline SVG (triggerIcon).
    var triggerIconHtml = opts.triggerImg ? '<img class="tb-nav-img" src="' + ivURL(opts.triggerImg) + '" alt="">' : ic(opts.triggerIcon);
    trigger.innerHTML = '<span class="tb-nav-ic">' + triggerIconHtml + '</span>';
    var flyout = document.createElement('div');
    flyout.className = 'tb-flyout';
    opts.items.forEach(function (it) {
      var enabled = tbNeedMet(it.need, li, isAdmin, isOwner);
      // `action:'upload'` -> a button that opens the CSV picker (not a navigation link).
      var isAction = !!it.action;
      var el = document.createElement(isAction ? 'button' : 'a');
      el.className = 'tb-nav-fab tb-flyout-item' + (enabled ? '' : ' tb-nav-disabled');
      el.setAttribute('aria-label', it.label);
      el.setAttribute('data-need', it.need);
      if (it.href) el.setAttribute('data-href', it.href);
      var iconHtml = it.img ? '<img class="tb-nav-img" src="' + ivURL(it.img) + '" alt="">' : ic(it.icon);
      el.innerHTML = '<span class="tb-nav-ic">' + iconHtml + '</span><span class="tb-nav-label">' + it.label + '</span>';
      if (isAction) {
        el.type = 'button';
        if (enabled) { el.title = it.label; el.onclick = function () { if (it.action === 'upload' && window.tbUploadIntro) tbUploadIntro('app'); }; }
        else { el.setAttribute('aria-disabled', 'true'); el.title = li ? (it.label + ' — you do not have upload access') : ('Log in to ' + it.label); }
      } else if (enabled) { el.href = it.href; el.title = it.label; }
      else { el.setAttribute('aria-disabled', 'true'); el.title = li ? (it.label + ' — you do not have access') : ('Log in to view ' + it.label); }
      flyout.appendChild(el);
    });
    wrap.appendChild(trigger);
    wrap.appendChild(flyout);
    // The left rail now scrolls (overflow-y:auto), which would clip a flyout opening to the right.
    // So on hover, pin the flyout with position:fixed at the trigger's right edge (escapes the clip);
    // clear it on leave so the default absolute positioning returns.
    var pinFlyout = function () {
      var r = trigger.getBoundingClientRect();
      flyout.style.position = 'fixed';
      // Small 4px gap from the trigger's right edge (the ::before bridge spans it so hover never drops).
      flyout.style.left = (r.right + 4) + 'px';
      flyout.style.top = (r.top + r.height / 2) + 'px';
      flyout.style.right = 'auto';
    };
    var unpinFlyout = function () {
      flyout.style.position = ''; flyout.style.left = ''; flyout.style.top = ''; flyout.style.right = '';
    };
    // Keep it shown while the cursor is over the trigger wrap or the (fixed) flyout itself.
    wrap.addEventListener('mouseenter', pinFlyout);
    flyout.addEventListener('mouseenter', pinFlyout);
    // Wrap the trigger + an always-visible caption in a centered column item.
    var item = document.createElement('div');
    item.className = 'tb-fab-item';
    item.appendChild(wrap);
    var cap = document.createElement('div');
    cap.className = 'tb-fab-cap';
    cap.textContent = opts.triggerLabel;
    item.appendChild(cap);
    // Open the flyout when hovering ANYWHERE over the whole button item (box + caption), and close
    // when the cursor leaves the item AND the flyout (so moving onto the fixed flyout keeps it open).
    item.addEventListener('mouseenter', pinFlyout);
    item.addEventListener('mouseleave', function (e) {
      var to = e.relatedTarget;
      if (to && (flyout.contains(to) || item.contains(to))) return; // moved onto the flyout -> keep
      unpinFlyout();
    });
    flyout.addEventListener('mouseleave', function (e) {
      var to = e.relatedTarget;
      if (to && (item.contains(to) || flyout.contains(to))) return;
      unpinFlyout();
    });
    if (anchor) col.insertBefore(item, anchor); else col.appendChild(item);
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
  // The badge starts in a "loading" state (a tiny spinner) and only shows a number once the real
  // count arrives — so we never flash a premature "0". If the fetch fails, it keeps spinning rather
  // than showing a wrong count. Always visible thereafter (grey when 0, red when there are alerts).
  function refreshAlertBadge() {
    var badge = document.getElementById('navBadge-alerts');
    if (!badge || !A || !A.api) return;
    badge.classList.add('show'); // keep the pill visible (spinner while loading)
    A.api('GET', '/api/help/open').then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.data)) return; // leave the spinner up on a bad response
      var n = r.data.length;
      badge.classList.remove('loading');                 // stop the spinner — real data is in
      badge.textContent = n; // show the full count (badge auto-sizes; no longer capped/clipped)
      badge.classList.add('show');
      badge.classList.toggle('zero', n === 0); // grey when none, red when there are alerts
    }).catch(function () {}); // network error: keep the spinner, don't show a false 0
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
        fab.removeAttribute('title'); // caption names it; no redundant native tooltip
      } else {
        fab.classList.add('tb-nav-disabled');
        fab.setAttribute('aria-disabled', 'true');
        if (!isBtn) fab.removeAttribute('href');
        fab.title = li ? (label + ' — you do not have access') : ('Log in to view ' + label);
      }
    });
    if (li) refreshAlertBadge(); // refresh the open-alert count once auth is confirmed
    // Live FAB is ALWAYS active (the live dashboard is viewable without logging in).
    var liveFab = document.querySelector('.tb-live-fab');
    if (liveFab) {
      var lbl = document.body.getAttribute('data-live-label') || 'Q3 2026';
      liveFab.classList.remove('tb-live-disabled');
      liveFab.removeAttribute('aria-disabled');
      liveFab.href = 'app.html';
      liveFab.title = 'Go to the live quarter dashboard (' + lbl + ')';
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
        // Embedded: let the content set its OWN height so the parent iframe (auto-sized by tools.html)
        // flows with the parent page — drop the full-viewport min-height + any inner scroll/padding.
        + 'html,body{min-height:0!important;height:auto!important;overflow:visible!important}'
        + 'body{padding:0!important}.wrap{padding-top:16px!important;min-height:0!important}';
      document.head.appendChild(hideCss);
      document.body.setAttribute('data-embedded', 'true');
      return; // no toolbar / FAB build in embedded mode
    }
    injectStyles();
    buildModalAndLoader();
    tbTrackHistory();       // record this page in the recent-history list (runs on every page)
    // Pages with a bespoke top bar (e.g. index.html) opt out of the toolbar swap but still get the
    // recent-history quick-swap button so the feature is on EVERY page.
    if (document.body.getAttribute('data-no-toolbar') === 'true') { buildBackButton(); buildMenuButton(); buildHistoryButton(); buildLiveButton(); buildNavFabs(); buildAnalyticsButton(); buildRailLogo(); buildProfileAvatar(); buildProfilePanel(); hydrateProfileAndRepaint(); tbStartPresenceHeartbeat(); return; }
    if (document.body.getAttribute('data-app') === 'live') { buildBackButton(); buildHistoryButton(); buildLiveButton(); buildNavFabs(); buildAnalyticsButton(); buildRailLogo(); buildProfileAvatar(); buildProfilePanel(); hydrateProfileAndRepaint(); tbStartPresenceHeartbeat(); return; } // app.html: history + live + nav FABs (incl. moved flyout groups) + analytics + logo + right PROFILE PANEL + async profile hydrate

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

    // EVERY standard page gets the 3-column layout: opt it into the profile-panel layout unless the
    // page explicitly opts out with data-no-profile-panel. Set BEFORE buildProfilePanel (which
    // early-returns unless the attribute is present) so the right profile column + body padding apply.
    if (document.body.getAttribute('data-no-profile-panel') !== 'true') {
      document.body.setAttribute('data-profile-panel', '');
    }
    buildBackButton(); // floating back button if data-back-href is set
    buildHistoryButton(); // floating recent-history quick-swap button (bottom-left)
    buildLiveButton(); // LIVE FAB first so it exists as the bottom anchor for the items above it
    buildNavFabs(); // page-navigation FABs + the moved flyout groups (Data/Reports/Issue Types/Program History/Admin), above LIVE
    buildAnalyticsButton(); // Agent & Group Analytics FAB on the LEFT rail, just above LIVE
    buildRailLogo(); // GSOC logo pinned to the very top of the rail (hover reveals the wordmark)
    buildProfileAvatar(); // floating profile avatar (top-right) — the only survivor of the old title bar
    buildProfilePanel(); // RIGHT profile column — now on every standard page (3-column layout)
    tbStartPresenceHeartbeat(); // start the online-presence heartbeat (no-op when logged out)

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
      refreshProfileAvatar();   // (legacy no-op against retired #tbTopRight cluster)
      rebuildRailProfile();     // repaint the RIGHT-rail avatar badge with the full profile (photo/name)
      tbRepaintProfileBanner(); // repaint the RIGHT profile PANEL banner avatar/name with the loaded photo
      applyAnalyticsFabState(); // reflect admin role on the analytics FAB once the profile is in
      applyNavFabsState();      // reflect role gating on the nav FABs once the profile is in
    }

    // Quarter buttons are hardcoded in buildToolbarHtml (Q3 live + Q2), no dynamic fetch needed.
  })();
})();
