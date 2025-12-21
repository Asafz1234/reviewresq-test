(function () {
  const nav = document.querySelector('.global-nav');
  if (!nav) return;

  const links = nav.querySelectorAll('[data-route]');
  const { pathname, hash } = window.location;

  function deriveRoute() {
    if (hash && hash.toLowerCase().includes('inbox')) return 'inbox';
    if (hash && hash.toLowerCase().includes('overview')) return 'overview';
    if (hash && hash.toLowerCase().includes('dashboard')) return 'dashboard';
    if (hash && hash.toLowerCase().includes('google-reviews')) return 'google-reviews';
    if (hash && hash.toLowerCase().includes('leads')) return 'leads';
    if (hash && hash.toLowerCase().includes('customers')) return 'customers';
    if (hash && hash.toLowerCase().includes('campaigns')) return 'campaigns';
    if (hash && hash.toLowerCase().includes('account')) return 'account';
    if (hash && hash.toLowerCase().includes('alerts')) return 'alerts';
    if (hash && hash.toLowerCase().includes('links')) return 'links';
    if (hash && hash.toLowerCase().includes('funnel')) return 'funnel';

    if (pathname.includes('dashboard.html') || pathname.endsWith('dashboard')) return 'dashboard';
    if (pathname.includes('overview')) return 'overview';
    if (pathname.includes('feedback')) return 'inbox';
    if (pathname.includes('inbox')) return 'inbox';
    if (pathname.includes('alerts')) return 'alerts';
    if (pathname.includes('links')) return 'links';
    if (pathname.includes('funnel')) return 'funnel';
    if (pathname.includes('automations')) return 'automations';
    if (pathname.includes('follow')) return 'follow-ups';
    if (pathname.includes('google-reviews')) return 'google-reviews';
    if (pathname.includes('leads')) return 'leads';
    if (pathname.includes('customers')) return 'customers';
    if (pathname.includes('campaigns')) return 'campaigns';
    if (pathname.includes('ai-agent')) return 'ai-agent';
    if (pathname.includes('settings')) return 'settings';
    if (pathname.includes('account') || pathname.includes('billing')) return 'account';
    return 'overview';
  }

  const activeRoute = deriveRoute();
  links.forEach((link) => {
    const route = link.getAttribute('data-route');
    if (route === activeRoute) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
})();
