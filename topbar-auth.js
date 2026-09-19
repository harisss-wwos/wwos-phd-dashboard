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
      + '.tb-avatar img,.tb-avatar .avatar-initial{border-radius:50%}'
      // one combined profile button: name + avatar
      + '.tb-profile-btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:4px 6px 4px 12px;border:1px solid #2a2a2a;border-radius:999px;background:#151b24;color:#d5dbdb;max-width:220px;transition:border-color .15s,background .15s}'
      + '.tb-profile-btn:hover{border-color:#ff9900;background:#1a222d}'
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
      // login loader
      + '.tb-loader{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:3200;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px}'
      + '.tb-loader .sp{width:46px;height:46px;border:4px solid #2a2a2a;border-top-color:#4ade80;border-radius:50%;animation:tbspin 1s linear infinite}'
      + '.tb-loader p{color:#fff;font-weight:600}'
      // floating circular back button (bottom-right)
      + '.tb-back-fab{position:fixed;right:22px;bottom:22px;z-index:900;width:52px;height:52px;border-radius:50%;background:#ff9900;color:#000;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;transition:transform .15s,background .15s}'
      + '.tb-back-fab:hover{background:#ec7211;transform:translateY(-2px)}'
      + '.tb-back-fab svg{width:22px;height:22px}'
      // floating circular RECENT-HISTORY button (bottom-left) + its popup of recently visited pages
      + '.tb-hist-fab{position:fixed;left:22px;bottom:22px;z-index:900;height:52px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:26px;background:#1b2430;color:#ff9900;border:1px solid #2a2a2a;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);overflow:hidden;max-width:52px;font-family:inherit;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s}'
      + '.tb-hist-fab .tb-hist-ic{flex:0 0 52px;width:52px;height:52px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-hist-fab .tb-hist-ic svg{width:22px;height:22px}'
      + '.tb-hist-fab .tb-hist-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-hist-fab:hover{max-width:320px;background:#222d3a;border-color:#ff9900;transform:translateY(-2px)}'
      + '.tb-hist-fab:hover .tb-hist-label{opacity:1;padding-right:18px}'
      // Vertically-centered left-edge FAB column: holds Live + Analytics + page-nav FABs (NOT the
      // Recent Activity FAB, which stays pinned to the bottom-left). align-items:flex-start so each
      // pill grows rightward on hover from the same left edge.
      + '.tb-fab-col{position:fixed;left:22px;top:50%;transform:translateY(-50%);z-index:900;display:flex;flex-direction:column;align-items:flex-start;gap:12px;max-height:calc(100vh - 130px);pointer-events:none}'
      + '.tb-fab-col>*{pointer-events:auto}'
      // Agent & Group Analytics FAB. Circular; expands on hover to reveal its label. Admin-gated
      // disabled state = greyed + inert. Lives inside the centered FAB column.
      + '.tb-an-fab{position:relative;height:52px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:26px;background:#1b2430;color:#44b9d6;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:52px;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s}'
      + '.tb-an-fab .tb-an-ic{flex:0 0 52px;width:52px;height:52px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-an-fab .tb-an-ic svg{width:22px;height:22px}'
      + '.tb-an-fab .tb-an-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-an-fab:hover{max-width:320px;border-color:#44b9d6;transform:translateY(-2px)}'
      + '.tb-an-fab:hover .tb-an-label{opacity:1;padding-right:18px}'
      + '.tb-an-fab.tb-an-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655;cursor:not-allowed;pointer-events:none}'
      // Live-quarter FAB. Blinks to signal "LIVE" and links to the live dashboard (app.html).
      // Expands on hover to reveal the quarter label. Lives inside the centered FAB column.
      + '.tb-live-fab{position:relative;height:52px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:26px;background:#12261a;color:#4ade80;border:1px solid #2f7a4a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:52px;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s;animation:tbLiveGlow 1.6s ease-in-out infinite}'
      + '.tb-live-fab .tb-live-ic{flex:0 0 52px;width:52px;height:52px;display:inline-flex;align-items:center;justify-content:center;position:relative}'
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
      + '.tb-nav-fab{position:relative;height:52px;display:inline-flex;align-items:center;gap:0;padding:0;border-radius:26px;background:#1b2430;color:#cdd7de;border:1px solid #2a2a2a;box-shadow:0 6px 18px rgba(0,0,0,.45);text-decoration:none;overflow:hidden;max-width:52px;transition:max-width .28s ease,background .15s,border-color .15s,transform .15s}'
      + '.tb-nav-fab .tb-nav-ic{flex:0 0 52px;width:52px;height:52px;display:inline-flex;align-items:center;justify-content:center}'
      + '.tb-nav-fab .tb-nav-ic svg{width:21px;height:21px}'
      + '.tb-nav-fab .tb-nav-label{white-space:nowrap;font-size:.86em;font-weight:600;opacity:0;padding-right:0;transition:opacity .2s ease,padding-right .2s ease}'
      + '.tb-nav-fab:hover{max-width:340px;background:#222d3a;border-color:#ff9900;color:#fff;transform:translateY(-2px)}'
      + '.tb-nav-fab:hover .tb-nav-label{opacity:1;padding-right:18px}'
      + '.tb-nav-fab.tb-nav-disabled{background:#232d3a;color:#8b98a5;border-color:#3a4655;cursor:not-allowed;pointer-events:none}'
      // On short screens shrink the FAB column (smaller pills + tighter gap) so it still fits centered.
      + '@media(max-height:760px){.tb-fab-col{gap:8px}.tb-nav-fab,.tb-live-fab,.tb-an-fab{height:44px;max-width:44px}.tb-nav-fab .tb-nav-ic,.tb-an-fab .tb-an-ic,.tb-live-fab .tb-live-ic{flex-basis:44px;width:44px;height:44px}.tb-hist-fab{height:44px}.tb-hist-fab .tb-hist-ic{flex-basis:44px;width:44px;height:44px}}'
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
      + 'img,svg,canvas,video{max-width:100%;height:auto}'
      + 'pre{max-width:100%;overflow-x:auto;white-space:pre-wrap;word-break:break-word}'
      // any data table sits in a scroll container instead of pushing the page wider
      + '.tbl-card{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}'
      + 'table{max-width:100%}'
      // The vertically-centered FAB column hugs the left edge (~74px). Shift the main page content
      // right so those buttons don't overlap it. Applied to the common content wrappers on wider
      // screens; reset inside the ≤920px block where the column shrinks and wrappers go full-width.
      + '.content,.wrap,.tools-subnav{padding-left:88px}'
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
        // FAB column shrinks/relocates on narrow screens -> drop the content-shift padding.
        + '.content,.tools-subnav{padding-left:14px!important}'
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
    if (isAdmin && !inApp) {
      html += '<button type="button" class="tb-btn tb-movable" title="Upload new data" onclick="tbUploadIntro(\'standalone\')">' + ic('upload') + '<span class="tb-btn-label"> Upload new data</span></button><input type="file" accept=".csv" id="uploadFileStandalone" style="display:none">';
    }
    // My Tickets (logged-in). On the live dashboard (app.html) it lives in the page-title row next to
    // Alerts / Upload / Uploaded data log, so it's omitted here to avoid a duplicate.
    if (li && !inApp) html += '<a class="tb-btn tb-movable" href="my-tickets.html" title="My Tickets">' + ic('ticket') + '<span class="tb-btn-label"> My Tickets</span></a>';
    // Users + Database health (owner-only) sit here in the top-right, just left of the avatar.
    var isOwner = atLeast('owner');
    if (isOwner) html += '<a class="tb-btn" href="users.html" title="Users">' + ic('users-gear') + '<span class="tb-btn-label"> Users</span></a>';
    if (isOwner) html += '<a class="tb-btn" href="db-health.html" title="Database health">' + ic('database') + '<span class="tb-btn-label"> Database health</span></a>';
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
        + '<span class="tb-avatar">' + (A.avatarHtml ? A.avatarHtml(prof, 30) : '') + '</span>'
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
    if (isOwner) html += link('users', 'Users', 'users-gear', 'users.html');
    if (isOwner) html += link('db-health', 'Database health', 'database', 'db-health.html');
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
    refreshRight: function () { var s = document.getElementById('tbAuth'); if (s) s.innerHTML = rightControlsHtml(); }
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
    ov.innerHTML = '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:90vw;width:90vw;max-height:88vh;overflow:auto;padding:26px">' +
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
    ov.innerHTML = '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:90vw;width:90vw;max-height:88vh;overflow:auto;padding:26px">' +
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
    reader.onerror = function () { alert('Could not read the file.'); };
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
    catch (err) { tbRemove('tbAssess'); alert('Could not read the CSV file.'); return; }
    if (!rows.length) { tbRemove('tbAssess'); alert('No tickets with a ShortId/IssueId were found in the file.'); return; }

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
    if (!live || !live.ok || !live.data) { tbRemove('tbAssess'); alert('Could not load the live dataset to compare. Try again.'); return; }
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
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:90vw;width:90vw;padding:26px;text-align:center">' +
          '<div style="font-size:2em">✅</div>' +
          '<h2 style="color:#fff;font-size:1.2em;margin:8px 0 8px">No new changes</h2>' +
          '<p style="color:#879596;font-size:.92em;line-height:1.6">No ticket in this file has a newer <b style="color:#d5dbdb">LastUpdatedDate</b> than what\'s already live, and there are no new tickets. Nothing needs to be uploaded.</p>' +
          '<div style="margin-top:22px"><button class="tb-mbtn" id="tbConfirmClose">Close</button></div>' +
        '</div>');
      document.getElementById('tbConfirmClose').onclick = function () { tbRemove('tbConfirm'); };
      return;
    }
    tbFlowOverlay('tbConfirm',
      '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:90vw;width:90vw;padding:26px">' +
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
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:90vw;width:90vw;padding:26px;text-align:center">' +
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
        '<div style="background:#111;border:1px solid #333;border-radius:12px;max-width:90vw;width:90vw;padding:26px;text-align:center">' +
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
    var isAdmin = A && A.atLeast && A.atLeast('admin');
    var fab = document.createElement('a');
    fab.className = 'tb-an-fab' + (isAdmin ? '' : ' tb-an-disabled');
    fab.setAttribute('aria-label', 'Agent & Group Analytics');
    // bar-chart icon (matches icons.js 'bar-chart').
    fab.innerHTML = '<span class="tb-an-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></span>'
      + '<span class="tb-an-label">Agent &amp; Group Analytics</span>';
    if (isAdmin) {
      fab.href = 'agent-analytics.html';
      fab.title = 'Agent & Group Analytics';
    } else {
      fab.setAttribute('aria-disabled', 'true');
      var li = loggedIn();
      fab.title = li ? 'Agent & Group Analytics — admin access required' : 'Log in as admin to view Agent & Group Analytics';
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
  // Build the PAGE-NAVIGATION FABs at the TOP of the centered column (above Live + Analytics). Each
  // is an expand-on-hover pill linking to a page. Role-gated: admin-only items greyed + inert.
  function buildNavFabs() {
    if (document.querySelector('.tb-nav-fab')) return;
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    // Order top -> bottom within the nav group. need: 'li' | 'admin' | true.
    var items = [
      { key: 'shift-report', label: 'Shift Report',              icon: 'clipboard',    href: 'app.html?view=shift-report', need: 'li' },
      { key: 'help-activity', label: 'Help Activity',            icon: 'alert',        href: 'help-activity.html',         need: 'li' },
      { key: 'tools',         label: 'PHD Tools',                 icon: 'tool',        href: 'tools.html',                 need: 'li' },
      { key: 'hi-resolved',   label: 'Resolved Repeat Incidents', icon: 'repeat',      href: 'hi-resolved.html',           need: 'admin' },
      { key: 'sla-breach',    label: 'SLA Breaches (>240h)',      icon: 'clock',       href: 'sla-breach.html',            need: 'admin' },
      { key: 'station-request', label: 'Station Request Tickets', icon: 'map-pin',     href: 'station-request.html',       need: 'li' },
      { key: 'unique-cases',  label: 'Unique cases',              icon: 'hash',        href: 'important-cases.html',       need: 'admin' }
    ];
    var col = tbFabCol();
    var anchor = col.querySelector('.tb-live-fab') || col.querySelector('.tb-an-fab'); // insert above these
    items.forEach(function (it) {
      var enabled = (it.need === true) || (it.need === 'li' && li) || (it.need === 'admin' && isAdmin);
      var fab = document.createElement('a');
      fab.className = 'tb-nav-fab' + (enabled ? '' : ' tb-nav-disabled');
      fab.setAttribute('aria-label', it.label);
      fab.setAttribute('data-need', it.need === true ? 'any' : it.need);
      fab.setAttribute('data-href', it.href);
      fab.innerHTML = '<span class="tb-nav-ic">' + ic(it.icon) + '</span>'
        + '<span class="tb-nav-label">' + it.label + '</span>';
      if (enabled) {
        fab.href = it.href;
        fab.title = it.label;
      } else {
        fab.setAttribute('aria-disabled', 'true');
        fab.title = li ? (it.label + ' — admin access required') : ('Log in to view ' + it.label);
      }
      // Keep list order by inserting each new item just before the anchor (Live/Analytics).
      if (anchor) col.insertBefore(fab, anchor); else col.appendChild(fab);
    });
  }
  // Re-apply the nav FABs' role-gated state after a background profile load (so they enable without reload).
  function applyNavFabsState() {
    var li = loggedIn();
    var isAdmin = atLeast('admin');
    document.querySelectorAll('.tb-nav-fab').forEach(function (fab) {
      var need = fab.getAttribute('data-need');
      if (!need) return;
      var enabled = (need === 'any') || (need === 'li' && li) || (need === 'admin' && isAdmin);
      var href = fab.getAttribute('data-href') || '';
      var label = fab.getAttribute('aria-label') || '';
      if (enabled) {
        fab.classList.remove('tb-nav-disabled');
        fab.removeAttribute('aria-disabled');
        if (href) fab.href = href;
        fab.title = label;
      } else {
        fab.classList.add('tb-nav-disabled');
        fab.setAttribute('aria-disabled', 'true');
        fab.removeAttribute('href');
        fab.title = li ? (label + ' — admin access required') : ('Log in to view ' + label);
      }
    });
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
    var A = window.PHDAuth;
    var isAdmin = A && A.atLeast && A.atLeast('admin');
    if (isAdmin) {
      fab.classList.remove('tb-an-disabled');
      fab.removeAttribute('aria-disabled');
      fab.href = 'agent-analytics.html';
      fab.title = 'Agent & Group Analytics';
    } else {
      fab.classList.add('tb-an-disabled');
      fab.setAttribute('aria-disabled', 'true');
      fab.removeAttribute('href');
      fab.title = loggedIn() ? 'Agent & Group Analytics — admin access required' : 'Log in as admin to view Agent & Group Analytics';
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
      'agent-analytics.html': 'bar-chart', 'last24.html': 'clock', 'help-activity.html': 'alert',
      'alerts.html': 'alert', 'tools.html': 'tool', 'tool-blurbs.html': 'clipboard',
      'tool-hashtags.html': 'hash', 'tool-paging.html': 'mail', 'tool-prompts.html': 'message',
      'important-cases.html': 'hash', 'unique-cases.html': 'hash', 'unique-cases-log.html': 'history',
      'station-request.html': 'map-pin',
      'users.html': 'users-gear', 'db-health.html': 'database', 'profile.html': 'users',
      'data-log.html': 'history', 'blurb-log.html': 'history', 'hashtag-log.html': 'history',
      'paging-log.html': 'history', 'archive.html': 'calendar', 'admin-guide.html': 'book',
      'add-archive.html': 'plus'
    };
    if (file === 'app.html' && view) { key = ({ groups: 'users', 'shift-report': 'clipboard', 'previous-week': 'clock-rewind' })[view] || 'bolt'; }
    else if (map[file]) { key = map[file]; }
    return ic(key);
  }

  // ---- Standalone-page auto-mount: replace the page's .top-bar with the shared toolbar ----
  // Reads data-nav-active on <body> for the active highlight. Skipped on app.html (it builds its own).
  (async function () {
    injectStyles();
    buildModalAndLoader();
    tbTrackHistory();       // record this page in the recent-history list (runs on every page)
    // Pages with a bespoke top bar (e.g. index.html) opt out of the toolbar swap but still get the
    // recent-history quick-swap button so the feature is on EVERY page.
    if (document.body.getAttribute('data-no-toolbar') === 'true') { buildMenuButton(); buildHistoryButton(); buildAnalyticsButton(); buildLiveButton(); buildNavFabs(); return; }
    if (document.body.getAttribute('data-app') === 'live') { buildBackButton(); buildHistoryButton(); buildAnalyticsButton(); buildLiveButton(); buildNavFabs(); return; } // app.html: back + history + analytics + live + nav FABs

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

    // Right controls are already rendered from the cached user (rightControlsHtml uses A.getUser()),
    // so the avatar/role badge show immediately with NO spinner flash. Load the full profile
    // (custom photo/display name) in the background and silently refresh only if it changed something.
    if (loggedIn()) {
      var beforeProfile = A._myProfile;
      try { if (A.loadMyProfile) await A.loadMyProfile(); } catch (e) {}
      // Only re-render if the fetched profile differs from what we already painted.
      if (A._myProfile !== beforeProfile) window.PHDNav.refreshRight();
      applyAnalyticsFabState(); // reflect admin role on the analytics FAB once the profile is in
      applyNavFabsState();      // reflect role gating on the nav FABs once the profile is in
    }

    // Quarter buttons are hardcoded in buildToolbarHtml (Q3 live + Q2), no dynamic fetch needed.
  })();
})();
