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
})(window);
