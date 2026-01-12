const NAV_SECTIONS = [
  {
    id: 'main',
    items: [
      { route: 'dashboard', icon: '🏠', label: 'Overview', href: 'dashboard.html' },
      { route: 'ask-reviews', icon: '✉️', label: 'Ask for reviews', href: 'ask-reviews.html' },
      { route: 'inbox', icon: '💬', label: 'Customer Feedback', href: 'feedback.html' },
      { route: 'google-reviews', icon: '★', label: 'Google Reviews', href: 'pages/google-reviews.html' },
      { route: 'customers', icon: '👥', label: 'Customers', href: '/customers' },
      { route: 'funnel', icon: '↗', label: 'Review Funnel', href: 'funnel-settings.html', disallowStarter: true },
      { route: 'links', icon: '🔗', label: 'Review Links', href: 'links.html', disallowStarter: true },
      { route: 'automations', icon: '⚙️', label: 'Automations', href: 'automations.html', disallowStarter: true },
      { route: 'ai-suite', icon: '✨', label: 'AI Suite', href: 'ai-suite.html', disallowStarter: true },
      { route: 'team', icon: '🧑‍🤝‍🧑', label: 'Team & Roles', href: 'team.html', disallowStarter: true },
    ],
  },
  {
    id: 'settings',
    items: [
      { route: 'account', icon: '💳', label: 'Account & Billing', href: 'account.html' },
      { route: 'business-settings', icon: '🎨', label: 'Business Settings', href: 'business-settings.html' },
    ],
  },
];

(function () {
  const nav = document.querySelector('.global-nav');
  if (!nav) return;

  const { pathname, hash } = window.location;
  let lastRenderedPlan = null;

  function createTab({ route, icon, label, href }) {
    const tab = document.createElement('a');
    tab.className = 'nav-tab';
    tab.dataset.route = route;
    tab.href = href;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'nav-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icon;

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;

    tab.append(iconSpan, labelSpan);
    return tab;
  }

  function renderNav() {
    const resolvedPlan = (window.navAccess?.plan || '').toLowerCase();
    const isPending = window.navAccess?.planPending || !resolvedPlan;
    const isStarter = !isPending && resolvedPlan === 'starter';
    const hideDisallowed = isPending || isStarter;
    const fragment = document.createDocumentFragment();

    NAV_SECTIONS.forEach((section) => {
      // Starter plan hides Campaigns in nav (feature still exists).
      const visibleItems = section.items.filter(
        (item) => !hideDisallowed || !item.disallowStarter
      );
      if (!visibleItems.length) return;

      if (section.id === 'main') {
        visibleItems.forEach((item) => fragment.appendChild(createTab(item)));
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'nav-section nav-section--settings';
      wrapper.dataset.navSection = section.id;

      const heading = document.createElement('p');
      heading.className = 'nav-section__label';
      heading.textContent = 'Settings';
      wrapper.appendChild(heading);

      const list = document.createElement('div');
      list.className = 'nav-section__items';
      list.dataset.navSectionItems = section.id;

      visibleItems.forEach((item) => list.appendChild(createTab(item)));
      wrapper.appendChild(list);
      fragment.appendChild(wrapper);
    });

    nav.innerHTML = '';
    nav.appendChild(fragment);
    lastRenderedPlan = resolvedPlan || 'pending';
  }

  function deriveRoute() {
    if (hash && hash.toLowerCase().includes('inbox')) return 'inbox';
    if (hash && hash.toLowerCase().includes('overview')) return 'overview';
    if (hash && hash.toLowerCase().includes('dashboard')) return 'dashboard';
    if (hash && hash.toLowerCase().includes('google-reviews')) return 'google-reviews';
    if (hash && hash.toLowerCase().includes('leads')) return 'leads';
    if (hash && hash.toLowerCase().includes('customers')) return 'customers';
    if (hash && hash.toLowerCase().includes('ask-reviews')) return 'ask-reviews';
    if (hash && hash.toLowerCase().includes('campaigns')) return 'campaigns';
    if (hash && hash.toLowerCase().includes('business-settings')) return 'settings';
    if (hash && hash.toLowerCase().includes('account')) return 'settings';
    if (hash && hash.toLowerCase().includes('alerts')) return 'settings';
    if (hash && hash.toLowerCase().includes('links')) return 'links';
    if (hash && hash.toLowerCase().includes('funnel')) return 'funnel';

    if (pathname.includes('dashboard.html') || pathname.endsWith('dashboard')) return 'dashboard';
    if (pathname.includes('overview')) return 'overview';
    if (pathname.includes('ask-reviews')) return 'ask-reviews';
    if (pathname.includes('feedback')) return 'inbox';
    if (pathname.includes('inbox')) return 'inbox';
    if (pathname.includes('automations')) return 'automations';
    if (pathname.includes('links')) return 'links';
    if (pathname.includes('funnel')) return 'funnel';
    if (pathname.includes('ai-suite')) return 'ai-suite';
    if (pathname.includes('team')) return 'team';
    if (pathname.includes('google-reviews')) return 'google-reviews';
    if (pathname.includes('customers')) return 'customers';
    if (pathname.includes('business-settings')) return 'settings';
    if (pathname.includes('settings')) return 'settings';
    if (pathname.includes('account') || pathname.includes('billing')) return 'settings';
    return 'overview';
  }

  function markActiveRoute() {
    const activeRoute = deriveRoute();
    const links = nav.querySelectorAll('[data-route]');
    links.forEach((link) => {
      const route = link.getAttribute('data-route');
      const isSettingsChild =
        activeRoute === 'settings' &&
        ['account', 'billing', 'business-settings', 'alerts', 'settings'].includes(route);
      const isActive = route === activeRoute || isSettingsChild;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  renderNav();
  markActiveRoute();

  window.addEventListener('navaccess:planApplied', () => {
    const nextPlan = (window.navAccess?.plan || '').toLowerCase() || 'pending';
    if (nextPlan !== lastRenderedPlan) {
      renderNav();
    }
    markActiveRoute();
  });
})();
