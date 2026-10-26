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

  // Make user-typed text safe to put inside HTML. escAttr also covers single quotes (for '...' attributes).
  RCC.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  RCC.escAttr = function (s) { return RCC.esc(s).replace(/'/g, '&#39;'); };
})(window);
