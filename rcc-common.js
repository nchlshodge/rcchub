// RCC Hub — settings and helpers every page shares. Loaded by each page just before its own script.
// One place to change the Firebase settings or the text-escaping rule, instead of fifteen copies.
(function (global) {
  var RCC = global.RCC = global.RCC || {};

  // Public identifiers for this app (not secrets; access is controlled by the database rules).
  RCC.firebaseConfig = {
    apiKey:            "AIzaSyDFX7_fLi82PqkSUK7mi4bRzOPF1efcAeE",
    authDomain:        "bedsidercc.firebaseapp.com",
    projectId:         "bedsidercc",
    storageBucket:     "bedsidercc.firebasestorage.app",
    messagingSenderId: "950958384975",
    appId:             "1:950958384975:web:6f43dec5a7ba842c69c73a"
  };

  // If a network blocks Firestore's streaming connection, quietly fall back to one that works.
  RCC.tuneFirestore = function (db) {
    try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); }
    catch (e) { /* keep going with the default connection */ }
  };

  // Is an event/media request finished? Yes when an admin marked it complete, OR when it is approved and everything
  // it asked for is done (calendar added, graphic Completed, marketing Completed). An admin who reopened it
  // (completed === false) keeps it open until they complete it again, even if every item is done.
  RCC.isRequestDone = function (r) {
    if (r.completed === true) return true;
    if (r.completed === false || r.status !== 'approved') return false;
    var hasCalendar = r.requestType === 'church_event';
    var hasGraphic = Array.isArray(r.mediaSizes) && r.mediaSizes.length > 0;
    var m = r.marketing, hasMarketing = Array.isArray(m) && m.length > 0 && !(m.length === 1 && m[0] === 'None');
    if (!hasCalendar && !hasGraphic && !hasMarketing) return false;
    return (!hasCalendar || r.calendarAdded === true) &&
           (!hasGraphic || r.graphicStatus === 'Completed') &&
           (!hasMarketing || r.marketingStatus === 'Completed');
  };

  // A short message at the bottom of the screen that is also announced to screen readers. Use it instead of alert():
  //   RCC.notify('Approved "Fall Festival". The requester is being emailed.')
  //   RCC.notify('Could not save: ...', { kind: 'error' })          (errors stay longer and have a close button)
  RCC.notify = function (message, opts) {
    opts = opts || {};
    var isError = opts.kind === 'error', doc = global.document;
    if (!doc.getElementById('rcc-toast-style')) {
      var st = doc.createElement('style'); st.id = 'rcc-toast-style';
      st.textContent = '#rcc-toasts{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:500;display:flex;flex-direction:column;gap:8px;width:min(520px,calc(100vw - 24px));pointer-events:none}' +
        '.rcc-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:12px;font:500 14.5px/1.4 Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(30,20,5,.25);background:#1d5236;color:#fff}' +
        '.rcc-toast.error{background:#7c211c}' +
        '.rcc-toast span{flex:1;white-space:pre-line}' +
        '.rcc-toast button{flex:none;min-width:44px;min-height:44px;margin:-10px -8px -10px 0;border:0;border-radius:10px;background:transparent;color:inherit;font-size:20px;cursor:pointer}' +
        '.rcc-toast button:focus-visible{outline:3px solid #fff;outline-offset:-3px}';
      doc.head.appendChild(st);
    }
    var box = doc.getElementById('rcc-toasts');
    if (!box) { box = doc.createElement('div'); box.id = 'rcc-toasts'; doc.body.appendChild(box); }
    var t = doc.createElement('div'); t.className = 'rcc-toast' + (isError ? ' error' : '');
    t.setAttribute('role', isError ? 'alert' : 'status');
    var text = doc.createElement('span'); text.textContent = String(message);
    var x = doc.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss message'); x.textContent = '\u00d7';
    var gone = function () { if (t.parentNode) t.parentNode.removeChild(t); };
    x.addEventListener('click', gone);
    t.appendChild(text); t.appendChild(x); box.appendChild(t);
    setTimeout(gone, opts.ms || (isError ? 12000 : 5000));
    return gone;
  };

  // Make user-typed text safe to put inside HTML. escAttr also covers single quotes (for '...' attributes).
  RCC.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  RCC.escAttr = function (s) { return RCC.esc(s).replace(/'/g, '&#39;'); };

  /* ---------- keyboard and screen-reader help ---------- */
  var doc = global.document;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function press(el) { el.dispatchEvent(new global.MouseEvent('click', { bubbles: true, cancelable: true, view: global })); }

  // Make a pop-up panel or modal behave like a dialog: announced as one, focus moves in, Tab stays inside,
  // Escape closes it, and focus goes back to what opened it. The page keeps its own open/close code; this watches
  // for it (class "show"/"open", or aria-hidden="false") and adds the rest.
  //   RCC.dialog(panelEl, { label: 'Request details', inert: true })
  //   RCC.dialog(overlayEl, { dialog: overlayEl.querySelector('.modal'), label: 'Request app access' })
  RCC.dialog = function (root, opts) {
    opts = opts || {};
    var dlg = opts.dialog || root, opener = null, was = null;
    if (!dlg.getAttribute('role')) dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    if (opts.label && !dlg.getAttribute('aria-label') && !dlg.getAttribute('aria-labelledby')) dlg.setAttribute('aria-label', opts.label);
    if (!dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
    dlg.style.outline = 'none';
    function isOpen() {
      var ah = root.getAttribute('aria-hidden');
      if (ah !== null) return ah === 'false';
      return root.classList.contains('show') || root.classList.contains('open');
    }
    function closeIt() {
      if (opts.close) return opts.close();
      var b = dlg.querySelector(opts.closeButton || '[aria-label="Close"],.panel-x,.modal-close,.close');
      if (b) press(b);
    }
    function sync() {
      var open = isOpen();
      if (open === was) return;
      var first = was === null; was = open;
      if (open) {
        if (opts.inert) root.removeAttribute('inert');
        opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
        setTimeout(function () { if (isOpen() && !dlg.contains(doc.activeElement)) dlg.focus({ preventScroll: true }); }, 30);
      } else {
        if (opts.inert) root.setAttribute('inert', '');
        if (!first && opener && doc.contains(opener) && visible(opener)) { try { opener.focus({ preventScroll: true }); } catch (e) { /* element gone */ } }
        opener = null;
      }
    }
    new global.MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    sync();
    doc.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeIt(); return; }
      if (e.key !== 'Tab') return;
      var items = Array.prototype.filter.call(dlg.querySelectorAll(FOCUSABLE), visible);
      if (!items.length) { e.preventDefault(); dlg.focus(); return; }
      var first = items[0], last = items[items.length - 1], a = doc.activeElement;
      if (!dlg.contains(a) || a === dlg) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    });
  };

  // Things that react to a click but are not buttons (table rows, map areas): reachable with Tab, and Enter/Space act as a click.
  //   RCC.clickable('table.rooms tr.clickable')                 (a row keeps its row meaning)
  //   RCC.clickable('polygon.room[data-room]', { role: 'button' })
  var clickables = [], tabSets = [];
  RCC.clickable = function (selector, opts) { clickables.push({ sel: selector, role: (opts && opts.role) || null }); scan(); };
  // Tab bars made of plain divs: real tab semantics, one Tab stop, arrow keys move between tabs. The "active" class marks the selected one.
  RCC.tabs = function (selector) { tabSets.push(selector); scan(); };

  function hasName(el) {
    return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length) || el.getAttribute('title');
  }
  function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
  function scan() {
    clickables.forEach(function (c) {
      Array.prototype.forEach.call(doc.querySelectorAll(c.sel), function (el) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        if (c.role && !el.getAttribute('role')) el.setAttribute('role', c.role);
        if (c.role && !hasName(el)) { var t = el.querySelector('title'); if (t && clean(t.textContent)) el.setAttribute('aria-label', clean(t.textContent)); }
      });
    });
    tabSets.forEach(function (sel) {
      var byParent = [];
      Array.prototype.forEach.call(doc.querySelectorAll(sel), function (el) {
        var p = el.parentElement; if (!p) return;
        var i = byParent.findIndex(function (g) { return g.p === p; });
        if (i < 0) byParent.push({ p: p, tabs: [el] }); else byParent[i].tabs.push(el);
      });
      byParent.forEach(function (g) {
        if (!g.p.getAttribute('role')) g.p.setAttribute('role', 'tablist');
        var shown = g.tabs.filter(visible), anyActive = g.tabs.some(function (t) { return t.classList.contains('active'); });
        g.tabs.forEach(function (t, k) {
          t.setAttribute('role', 'tab');
          var on = t.classList.contains('active') || (!anyActive && t === shown[0]);
          t.setAttribute('aria-selected', t.classList.contains('active') ? 'true' : 'false');
          t.setAttribute('tabindex', on ? '0' : '-1');
        });
      });
    });
    // Fields and icon buttons with no accessible name: borrow a nearby or placeholder label.
    Array.prototype.forEach.call(doc.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea'), function (i) {
      if (hasName(i)) return;
      var t = i.getAttribute('placeholder'), p = i.previousElementSibling, k;
      for (k = 0; !t && k < 2 && p; k++, p = p.previousElementSibling) if (p.tagName === 'LABEL') t = p.textContent;
      if (!t && i.parentElement) { var l = i.parentElement.querySelector(':scope > label'); if (l) t = l.textContent; }
      if (!t && i.type === 'file') t = 'Choose a file';
      if (t) i.setAttribute('aria-label', clean(t));
    });
    Array.prototype.forEach.call(doc.querySelectorAll('button:not([aria-label])'), function (b) {
      var l = b.querySelector('.lbl'); if (l && clean(l.textContent)) b.setAttribute('aria-label', clean(l.textContent));
    });
  }
  doc.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || !t.matches) return;
    var isTab = t.getAttribute('role') === 'tab' && tabSets.some(function (s) { return t.matches(s); });
    if (isTab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
      var all = Array.prototype.filter.call(t.parentElement.children, function (x) { return x.getAttribute('role') === 'tab' && visible(x); });
      var i = all.indexOf(t), n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
      e.preventDefault(); all[n].focus(); press(all[n]); return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (isTab || clickables.some(function (c) { return t.matches(c.sel); })) { e.preventDefault(); press(t); }
  });

  // On every page: a "Skip to main content" link, and a main landmark if the page doesn't mark one.
  function initPage() {
    if (!doc.getElementById('rcc-a11y-style')) {
      var st = doc.createElement('style'); st.id = 'rcc-a11y-style';
      st.textContent = '.rcc-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
        '.rcc-skip{position:absolute;left:8px;top:-60px;z-index:1000;background:#183b82;color:#fff;padding:12px 18px;border-radius:10px;font:600 15px Inter,system-ui,sans-serif;text-decoration:none}' +
        '.rcc-skip:focus{top:8px}#rcc-main:focus{outline:none}';
      doc.head.appendChild(st);
    }
    var main = doc.querySelector('main,[role=main]');
    if (!main) { main = doc.querySelector('.wrap,.page,#root,.app,.content'); if (main) main.setAttribute('role', 'main'); }
    if (main && !doc.querySelector('.rcc-skip')) {
      if (!main.id) main.id = 'rcc-main';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      var a = doc.createElement('a'); a.className = 'rcc-skip'; a.href = '#' + main.id; a.textContent = 'Skip to main content';
      doc.body.insertBefore(a, doc.body.firstChild);
    }
    // The "Loading…" screen at the top of the page goes away as soon as the page shows its sign-in or its content.
    var boot = doc.getElementById('rccBoot');
    if (boot) {
      var bootDone = false, bootObs = new global.MutationObserver(bootCheck);
      var bootReady = function () {
        var l = doc.getElementById('loginScreen'), a = doc.getElementById('appShell');
        return (l && visible(l)) || (a && visible(a)) || doc.querySelector('.rcc-nav');
      };
      function bootCheck() { if (!bootDone && bootReady()) { bootDone = true; boot.hidden = true; bootObs.disconnect(); } }
      bootObs.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      bootCheck();
      setTimeout(function () { var t = boot.querySelector('span'); if (!bootDone && t) t.textContent = 'This is taking longer than usual. Check your connection, then refresh the page.'; }, 12000);
    }
    scan();
    var queued = false;
    new global.MutationObserver(function () { if (queued) return; queued = true; global.requestAnimationFrame(function () { queued = false; scan(); }); })
      .observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initPage); else initPage();
})(window);
