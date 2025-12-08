(function () {
  const nav = document.querySelector('.global-nav');
  if (!nav) return;

  const links = nav.querySelectorAll('[data-route]');
  const { pathname, hash } = window.location;

  function deriveRoute() {
    if (hash && hash.toLowerCase().includes('inbox')) return 'inbox';
    if (hash && hash.toLowerCase().includes('overview')) return 'overview';
    if (hash && hash.toLowerCase().includes('google-reviews')) return 'google-reviews';
    if (hash && hash.toLowerCase().includes('leads')) return 'leads';

    if (pathname.includes('inbox')) return 'inbox';
    if (pathname.includes('automations')) return 'automations';
    if (pathname.includes('follow')) return 'follow-ups';
    if (pathname.includes('google-reviews')) return 'google-reviews';
    if (pathname.includes('leads')) return 'leads';
    if (pathname.includes('ai-agent')) return 'ai-agent';
    if (pathname.includes('settings')) return 'settings';
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
