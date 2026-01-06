import {
  listenForUser,
  getCachedSubscription,
  isStarterPlan,
  currentEntitlements,
} from "./session-data.js";
import { showUpgradeModal } from "./plan-lock.js";

const ROUTE_KEYS = {
  dashboard: "overview",
  overview: "overview",
  "ask-reviews": "askReviews",
  inbox: "feedback",
  feedback: "feedback",
  "google-reviews": "googleReviews",
  customers: "customers",
  campaigns: "campaigns",
  funnel: "reviewFunnel",
  links: "reviewLinks",
  alerts: "alerts",
  "business-settings": "businessSettings",
  settings: "businessSettings",
  account: "accountBilling",
  billing: "accountBilling",
  "ai-agent": "proAiSuite",
};

const ROUTE_PATHS = {
  dashboard: "/dashboard.html",
  overview: "/overview.html",
  "ask-reviews": "/pages/ask-reviews.html",
  inbox: "/feedback.html",
  feedback: "/feedback.html",
  "google-reviews": "/pages/google-reviews.html",
  customers: "/customers.html",
  campaigns: "/campaigns.html",
  funnel: "/funnel-settings.html",
  links: "/links.html",
  alerts: "/alerts.html",
  "business-settings": "/business-settings.html",
  settings: "/business-settings.html",
  account: "/account.html",
  billing: "/account.html",
  "ai-agent": "/ai-agent.html",
};

const UPGRADE_PLAN_BY_ROUTE = {
  alerts: "growth",
  "ai-agent": "pro_ai",
};

const SETTINGS_ROUTES = ["account", "business-settings", "settings", "alerts"];
const STARTER_REMOVED_ROUTES = ["alerts", "ai-agent"];

const globalNavAccessState = (() => {
  if (typeof window === "undefined") return null;
  if (!window.__navAccessState) {
    window.__navAccessState = {
      initialized: false,
      currentPlan: "starter",
      currentEntitlementState: currentEntitlements(),
      navObserver: null,
      navElement: null,
      version: window.__NAV_ACCESS_VERSION || "unversioned",
    };
  }
  return window.__navAccessState;
})();

const navState =
  globalNavAccessState || {
    initialized: false,
    currentPlan: "starter",
    currentEntitlementState: currentEntitlements(),
    navObserver: null,
    navElement: null,
    version: "unscoped",
  };

function ensureWindowNavAccess() {
  if (typeof window === "undefined") return null;
  if (!window.navAccess) {
    window.navAccess = {
      plan: null,
      entitlements: null,
      version: navState.version,
      ready: false,
    };
  } else {
    window.navAccess.plan ??= null;
    window.navAccess.entitlements ??= null;
    window.navAccess.version ??= navState.version;
    window.navAccess.ready ??= false;
  }

  return window.navAccess;
}

ensureWindowNavAccess();

function normalizeRouteFromHref(href = "") {
  const lowerHref = String(href || "").toLowerCase();

  try {
    const url = new URL(lowerHref, window.location.origin);
    const file = (url.pathname || "").split("/").pop() || "";
    const base = file.split("#")[0].split("?")[0];
    return base.endsWith(".html") ? base.slice(0, -5) : base;
  } catch (e) {
    const file = lowerHref.split("/").pop() || "";
    const base = file.split("#")[0].split("?")[0];
    return base.endsWith(".html") ? base.slice(0, -5) : base;
  }
}

function navKeyForRoute(route = "") {
  const normalized = normalizeRouteFromHref(route) || route;
  return ROUTE_KEYS[normalized] || null;
}

function resolveNavHref(route = "", existingHref = "") {
  const normalized = normalizeRouteFromHref(route) || normalizeRouteFromHref(existingHref);
  return ROUTE_PATHS[normalized] || existingHref || "#";
}

function getEntitlementForRoute(route = "", entitlements = null) {
  const key = navKeyForRoute(route);
  if (!key || !entitlements?.allowedNavItems) return true;
  return entitlements.allowedNavItems[key] !== false;
}

export function safeNavigate(event, url, isBlocked, upgradePlan = "growth") {
  if (isBlocked) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    showUpgradeModal(upgradePlan, navState.currentPlan);
    return false;
  }

  if (!event && url) {
    window.location.href = url;
  }

  return true;
}

function setTabVisibility(tab, hidden) {
  tab.style.display = hidden ? "none" : "";
  tab.setAttribute("aria-hidden", hidden ? "true" : "false");
}

export function applyNavPlanFilter(planId = "starter", { forceRemove = false } = {}) {
  const resumeNavObserver = () => {
    if (navState.navObserver && navState.navElement) {
      navState.navObserver.observe(navState.navElement, {
        childList: true,
        subtree: true,
      });
    }
  };

  if (navState.navObserver) {
    navState.navObserver.disconnect();
  }

  try {
    navState.currentPlan = planId || "starter";
    navState.currentEntitlementState = currentEntitlements(navState.currentPlan);
    const navAccess = ensureWindowNavAccess();
    if (navAccess) {
      navAccess.plan = navState.currentPlan;
      navAccess.entitlements = navState.currentEntitlementState;
      navAccess.version = navState.version;
      navAccess.ready = true;
    }
    const navTabs = Array.from(document.querySelectorAll(".nav-tab"));
    const planIsStarter = isStarterPlan(navState.currentPlan);
    const enforceRemoval = forceRemove || planIsStarter;

    navTabs.forEach((tab) => {
      const route = (tab.dataset.route || tab.getAttribute("href") || "").toLowerCase();
      const resolvedHref = resolveNavHref(route, tab.getAttribute("href"));
      if (resolvedHref) {
        tab.setAttribute("href", resolvedHref);
      }

      const normalizedRoute = normalizeRouteFromHref(route);
      if (enforceRemoval && STARTER_REMOVED_ROUTES.includes(normalizedRoute)) {
        setTabVisibility(tab, true);
        return;
      }

      const allowed = getEntitlementForRoute(route, navState.currentEntitlementState);
      const isBlocked = allowed === false;

      tab.style.display = "";
      tab.setAttribute("aria-hidden", "false");
      tab.classList.toggle("nav-tab--locked", isBlocked);
      tab.setAttribute("aria-disabled", isBlocked ? "true" : "false");
      tab.dataset.navBlocked = isBlocked ? "true" : "false";

      const upgradePlan = UPGRADE_PLAN_BY_ROUTE[normalizedRoute] || "growth";
      if (!tab.dataset.navBound) {
        tab.addEventListener("click", (event) => {
          const blocked = tab.dataset.navBlocked === "true";
          safeNavigate(event, tab.getAttribute("href"), blocked, upgradePlan);
        });
        tab.dataset.navBound = "true";
      }
    });

    const businessTab = document.querySelector('.settings-tab[data-panel="business"]');
    if (businessTab) {
      const allowed =
        navState.currentEntitlementState?.allowedNavItems?.businessSettings !== false;
      setTabVisibility(businessTab, !allowed);
    }

    unifySettingsNav();

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("navaccess:planApplied", {
          detail: {
            planId: navState.currentPlan,
            entitlements: navState.currentEntitlementState,
          },
        })
      );
    }
  } finally {
    resumeNavObserver();
  }
}

function ensureNavObserver() {
  if (navState.navObserver || typeof MutationObserver === "undefined") return true;
  const nav = document.querySelector(".global-nav");
  if (!nav) return false;

  navState.navObserver = new MutationObserver(() => {
    const enforceRemoval = isStarterPlan(navState.currentPlan);
    applyNavPlanFilter(navState.currentPlan, { forceRemove: enforceRemoval });
  });

  navState.navElement = nav;

  navState.navObserver.observe(nav, { childList: true, subtree: true });
  return true;
}

function renderUpgradeGuard(reason = "") {
  const main = document.querySelector("main.page-container") || document.querySelector("main");
  if (!main) return;
  const message = reason || "This section is not available on your plan.";
  const notice = document.createElement("section");
  notice.className = "section";
  notice.innerHTML = `
    <div class="card">
      <p class="card-title">Upgrade required</p>
      <p class="card-sub">${message}</p>
      <div class="button-row" style="justify-content:flex-start;">
        <a class="btn btn-primary" href="/account.html">See upgrade options</a>
      </div>
    </div>
  `;
  if (!main.querySelector(".card")) {
    main.innerHTML = "";
  }
  main.prepend(notice);

  Array.from(main.querySelectorAll("button, input, select, textarea"))
    .forEach((node) => {
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
    });
}

function guardCurrentPage() {
  const pathRoute = normalizeRouteFromHref(window.location.pathname || "");
  const allowed = getEntitlementForRoute(pathRoute, navState.currentEntitlementState);
  if (allowed) return;
  renderUpgradeGuard("This page is available on higher plans.");
}

function unifySettingsNav() {
  const nav = document.querySelector(".global-nav");
  if (!nav) return;

  const settingsTabs = SETTINGS_ROUTES.flatMap((route) =>
    Array.from(nav.querySelectorAll(`.nav-tab[data-route="${route}"]`))
  );

  if (!settingsTabs.length) return;

  const setNavLabel = (tab, label) => {
    const labelSpan = tab.querySelector("span:not(.nav-icon)");
    if (labelSpan) {
      labelSpan.textContent = label;
      return;
    }

    const icon = tab.querySelector(".nav-icon");
    if (icon) {
      if (icon.nextElementSibling) {
        icon.nextElementSibling.textContent = label;
      } else {
        const span = document.createElement("span");
        span.textContent = label;
        icon.after(span);
      }
      return;
    }

    tab.textContent = label;
  };

  let section = nav.querySelector('[data-nav-section="settings"]');
  if (!section) {
    section = document.createElement("div");
    section.className = "nav-section nav-section--settings";
    section.dataset.navSection = "settings";

    const heading = document.createElement("p");
    heading.className = "nav-section__label";
    heading.textContent = "Settings";
    section.appendChild(heading);

    const list = document.createElement("div");
    list.className = "nav-section__items";
    list.dataset.navSectionItems = "settings";
    section.appendChild(list);

    nav.appendChild(section);
  }

  const list = section.querySelector('[data-nav-section-items="settings"]');
  if (!list) return;

  const labelByRoute = {
    account: "Account & Billing",
    "business-settings": "Business Settings",
    settings: "Business Settings",
    alerts: "Alerts & Notifications",
  };

  // Preserve desired ordering
  const orderedTabs = SETTINGS_ROUTES.flatMap((route) =>
    settingsTabs.filter((tab) => {
      const tabRoute = (tab.dataset.route || "").toLowerCase();
      if (tabRoute !== route) return false;

      const label = labelByRoute[tabRoute];
      if (label) setNavLabel(tab, label);

      if (tabRoute === "settings") {
        tab.setAttribute("href", resolveNavHref("business-settings", tab.getAttribute("href")));
      }

      return true;
    })
  );

  list.innerHTML = "";
  orderedTabs.forEach((tab) => list.appendChild(tab));

  const visibleSettings = orderedTabs.some((tab) => tab.style.display !== "none");
  section.style.display = visibleSettings ? "" : "none";
  section.setAttribute("aria-hidden", visibleSettings ? "false" : "true");
}

export function initNavPlanFilter() {
  if (navState.initialized) return;
  navState.initialized = true;

  const navAccess = ensureWindowNavAccess();

  const cachedPlan = getCachedSubscription()?.planId || "starter";
  applyNavPlanFilter(cachedPlan, { forceRemove: isStarterPlan(cachedPlan) });
  unifySettingsNav();
  guardCurrentPage();

  const maxAttempts = 5;
  const observeWithRetry = (attempt = 0) => {
    const attached = ensureNavObserver();
    if (attached) {
      applyNavPlanFilter(navState.currentPlan, { forceRemove: isStarterPlan(navState.currentPlan) });
      guardCurrentPage();
    }
    if (!attached && attempt < maxAttempts) {
      setTimeout(() => observeWithRetry(attempt + 1), 200);
    }
  };

  observeWithRetry();

  listenForUser(({ subscription }) => {
    const planId = subscription?.planId || "starter";
    const forceRemoval = isStarterPlan(planId);
    applyNavPlanFilter(planId, { forceRemove: forceRemoval });
    guardCurrentPage();
  });

  console.debug("[navAccess] ready", { plan: window.navAccess?.plan });
}
