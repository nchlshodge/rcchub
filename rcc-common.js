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

  // Make user-typed text safe to put inside HTML. escAttr also covers single quotes (for '...' attributes).
  RCC.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  RCC.escAttr = function (s) { return RCC.esc(s).replace(/'/g, '&#39;'); };
})(window);
