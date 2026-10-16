// RCC Hub — shared header. One navigation for every page, built from who is signed in.
//   RccShell.render(document.getElementById('rccNav'), { active: 'timeline', user, roles, onSignOut })
// `roles` = { isAdmin, graphics, marketing, vanAdmin, bedsideAdmin, overview, commissioner, benevolence }
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function linksFor(roles) {
    roles = roles || {};
    const staff = roles.isAdmin || roles.graphics || roles.marketing;
    const anyAdmin = roles.isAdmin || roles.vanAdmin || roles.bedsideAdmin || roles.overview || roles.commissioner || roles.benevolence;
    return [
      { key: 'home',     label: 'Home',              href: 'index.html',          show: true },
      { key: 'requests', label: 'Event requests',    href: 'event-requests.html', show: staff },
      { key: 'timeline', label: 'Creative timeline', href: 'queue-timeline.html', show: staff },
      { key: 'rooms',    label: 'Room map',          href: 'rooms.html',          show: true },
      { key: 'admin',    label: 'Admin',             href: 'admin.html',          show: anyAdmin },
    ].filter(l => l.show);
  }

  function render(el, opts) {
    if (!el) return;
    opts = opts || {};
    const links = linksFor(opts.roles).map(l =>
      `<a href="${l.href}" class="${l.key === opts.active ? 'active' : ''}"${l.key === opts.active ? ' aria-current="page"' : ''}>${l.label}</a>`).join('');
    const name = opts.user ? (opts.user.displayName || opts.user.email || '') : '';
    el.className = 'rcc-nav';
    el.innerHTML =
      `<a class="rcc-brand" href="index.html"><img src="assets/rcc-logo-plain.png" alt=""><b>RCC</b><span>Ministry hub</span></a>` +
      `<nav class="rcc-links" aria-label="Main">${links}</nav>` +
      `<div class="rcc-user"><span class="who">${esc(name)}</span><button type="button" id="rccSignOut">Sign out</button></div>`;
    const out = el.querySelector('#rccSignOut');
    if (out && opts.onSignOut) out.addEventListener('click', opts.onSignOut);
  }

  window.RccShell = { render, linksFor };
})();
