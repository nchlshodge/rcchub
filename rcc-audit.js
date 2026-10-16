// The audit trail, from the browser. Call RccAudit.log(...) right after an admin action succeeds:
//   RccAudit.log('event.approve', 'eventRequest', id, 'Approved "Fall Festival"');
// It records WHO (the signed-in person), WHAT, WHICH record and WHEN (the server's clock) in the
// auditLog collection, which only admins can read and nobody can edit or delete. It is
// fire-and-forget: if logging ever fails, the action the person took is never held up.
(function () {
  function clip(v, n) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n); }
  window.RccAudit = {
    log: function (action, target, targetId, summary) {
      try {
        var u = firebase.auth().currentUser;
        if (!u) return;
        firebase.firestore().collection('auditLog').add({
          actorUid: u.uid,
          actorName: clip(u.displayName, 80),
          actorEmail: clip(u.email, 120),
          action: clip(action, 60) || 'unknown',
          target: clip(target, 40),
          targetId: clip(targetId, 120),
          summary: clip(summary, 500),
          page: clip(location.pathname, 80),
          at: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(function () {});
      } catch (e) { /* never get in the way */ }
    },
  };
})();
