import {
  isStarterPlan,
  currentEntitlements,
  getPlanBootstrapPromise,
} from "./session-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";
import { getCachedPlanSync, hydratePlanCache, subscribePlan } from "./plan-store.js";

const ROUTE_KEYS = {
  dashboard: "overview",
  overview: "overview",
  "ask-reviews": "askReviews",
  inbox: "feedback",
  feedback: "feedback",
  "google-reviews": "googleReviews",
  customers: "customers",
  funnel: "reviewFunnel",
  links: "reviewLinks",
  automations: "automations",
  "ai-agent": "aiSuite",
  "ai-suite": "aiSuite",
  team: "team",
  "business-settings": "businessSettings",
  settings: "businessSettings",
  account: "accountBilling",
  billing: "accountBilling",
};

const ROUTE_PATHS = {
  dashboard: "/dashboard.html",
  overview: "/overview.html",
  "ask-reviews": "/ask-reviews",
  inbox: "/feedback.html",
  feedback: "/feedback.html",
  "google-reviews": "/google-reviews",
  customers: "/customers",
  funnel: "/funnel-settings.html",
  links: "/links",
  automations: "/automations.html",
  "ai-agent": "/ai-suite.html",
  "ai-suite": "/ai-suite.html",
  team: "/team.html",
  "business-settings": "/business-settings.html",
  settings: "/business-settings.html",
  account: "/account.html",
  billing: "/account.html",
};

const SETTINGS_ROUTES = ["account", "business-settings", "settings"];
const STARTER_REMOVED_ROUTES = ["funnel", "links", "automations", "ai-suite", "team", "ai-agent"];

const globalNavAccessState = (() => {
  if (typeof window === "undefined") return null;
  if (!window.__navAccessState) {
    window.__navAccessState = {
      initialized: false,
      currentPlan: null,
      currentEntitlementState: null,
      navObserver: null,
      navElement: null,
      version: window.__NAV_ACCESS_VERSION || "unversioned",
      planPending: false,
    };
  }
  return window.__navAccessState;
})();

const navState =
  globalNavAccessState || {
    initialized: false,
    currentPlan: null,
    currentEntitlementState: null,
    navObserver: null,
    navElement: null,
    version: "unscoped",
    planPending: false,
  };

const isDevEnv =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

function ensureWindowNavAccess() {
  if (typeof window === "undefined") return null;
  if (!window.navAccess) {
    window.navAccess = {
      plan: null,
      entitlements: null,
      version: navState.version,
      ready: false,
      planPending: false,
    };
  } else {
    window.navAccess.plan ??= null;
    window.navAccess.entitlements ??= null;
    window.navAccess.version ??= navState.version;
    window.navAccess.ready ??= false;
    window.navAccess.planPending ??= false;
  }

  return window.navAccess;
}

ensureWindowNavAccess();

function logNavPlanApplied(planId) {
  if (!isDevEnv || typeof window === "undefined") return;
  if (window.__rrNavPlanAppliedLogged) return;
  console.debug(`[rr] nav plan applied ${planId}`);
  window.__rrNavPlanAppliedLogged = true;
}

function logNavPlanAttempt(planId, source) {
  if (!isDevEnv) return;
  console.debug("[rr] nav plan set attempt", { planId, source });
}

function shouldIgnoreStarterDowngrade(nextPlan, source) {
  if (!nextPlan) return false;
  if (nextPlan !== "starter") return false;
  if (!navState.currentPlan || navState.currentPlan === "starter") return false;
  return !["billing", "subscription", "business", "update", "auth"].includes(source);
}

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

export function safeNavigate(event, url, isBlocked) {
  if (isBlocked) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    window.location.href = "/account.html";
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

export function applyNavPlanFilter(planId, { forceRemove = false, source } = {}) {
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
    if (!planId) return;
    const nextPlan = normalizePlan(planId);
    logNavPlanAttempt(nextPlan, source);
    if (shouldIgnoreStarterDowngrade(nextPlan, source)) {
      if (isDevEnv) {
        console.debug("[rr] nav plan downgrade blocked", {
          attemptedPlan: nextPlan,
          currentPlan: navState.currentPlan,
          source,
        });
      }
      return;
    }
    if (navState.currentPlan === nextPlan) return;
    navState.currentPlan = nextPlan;
    navState.planPending = false;
    navState.currentEntitlementState = currentEntitlements(navState.currentPlan);
    logNavPlanApplied(navState.currentPlan);
    const navAccess = ensureWindowNavAccess();
    if (navAccess) {
      navAccess.plan = navState.currentPlan;
      navAccess.entitlements = navState.currentEntitlementState;
      navAccess.version = navState.version;
      navAccess.ready = true;
      navAccess.planPending = false;
    }
    const navTabs = Array.from(document.querySelectorAll(".nav-tab"));
    const planIsStarter = isStarterPlan(navState.currentPlan);
    const enforceRemoval = forceRemove || planIsStarter;

    const normalizedPlan = normalizePlan(navState.currentPlan);
    const planLabel = PLAN_LABELS[normalizedPlan] || normalizedPlan || "Loading…";
    document.querySelectorAll("[data-plan-badge]").forEach((badge) => {
      badge.textContent = planLabel;
      badge.setAttribute("data-plan", normalizedPlan);
      badge.removeAttribute("data-plan-loading");
    });

    navTabs.forEach((tab) => {
      const route = (tab.dataset.route || tab.getAttribute("href") || "").toLowerCase();
      const resolvedHref = resolveNavHref(route, tab.getAttribute("href"));
      if (resolvedHref) {
        tab.setAttribute("href", resolvedHref);
      }

      const normalizedRoute = normalizeRouteFromHref(route);
      const allowed = getEntitlementForRoute(route, navState.currentEntitlementState);
      const shouldHide =
        (enforceRemoval && STARTER_REMOVED_ROUTES.includes(normalizedRoute)) || allowed === false;

      if (shouldHide) {
        setTabVisibility(tab, true);
        return;
      }

      tab.style.display = "";
      tab.setAttribute("aria-hidden", "false");
      tab.dataset.navBlocked = "false";
      if (!tab.dataset.navBound) {
        tab.addEventListener("click", (event) => {
          const blocked = tab.dataset.navBlocked === "true";
          safeNavigate(event, tab.getAttribute("href"), blocked);
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

    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("rr-plan-pending");
      document.documentElement.dataset.planReady = "true";
      if (isDevEnv) {
        console.debug("[rr] ui shown (resolved)", navState.currentPlan);
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("navaccess:planApplied", {
          detail: {
            planId: navState.currentPlan,
            entitlements: navState.currentEntitlementState,
            pending: false,
          },
        })
      );
    }
  } finally {
    resumeNavObserver();
  }
}

function renderPlanLoadingState() {
  document.querySelectorAll("[data-plan-badge]").forEach((badge) => {
    badge.textContent = "Loading…";
    badge.setAttribute("data-plan", "loading");
    badge.setAttribute("data-plan-loading", "true");
  });
}

function applyNavPendingState() {
  navState.currentPlan = null;
  navState.planPending = true;
  navState.currentEntitlementState = null;
  if (typeof document !== "undefined") {
    document.documentElement.classList.add("rr-plan-pending");
    document.documentElement.dataset.planReady = "false";
    if (isDevEnv) {
      console.debug("[rr] ui hidden (pending)");
    }
  }
  const navAccess = ensureWindowNavAccess();
  if (navAccess) {
    navAccess.plan = null;
    navAccess.entitlements = null;
    navAccess.ready = false;
    navAccess.planPending = true;
  }
  renderPlanLoadingState();
}

function renderUpgradeGuard(reason = "") {
  const main = document.querySelector("main.page-container") || document.querySelector("main");
  if (!main) return;
  const message = reason || "Upgrade to Growth to access this section.";
  const notice = document.createElement("section");
  notice.className = "section";
  notice.innerHTML = `
    <div class="card">
      <p class="card-title">Upgrade required</p>
      <p class="card-sub">${message}</p>
      <div class="button-row" style="justify-content:flex-start;">
        <a class="btn btn-primary" href="/account.html">Upgrade to Growth</a>
      </div>
    </div>
  `;
  main.innerHTML = "";
  main.prepend(notice);

  Array.from(main.querySelectorAll("button, input, select, textarea"))
    .forEach((node) => {
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
    });
}

function guardCurrentPage() {
  if (navState.planPending || !navState.currentEntitlementState) return;
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
  if (typeof window !== "undefined") {
    if (window.__rrNavPlanInit) return;
    window.__rrNavPlanInit = true;
  }
  navState.initialized = true;

  const cachedState = getCachedPlanSync();
  const cachedPlan = cachedState?.planId;
  if (cachedPlan) {
    applyNavPlanFilter(cachedPlan, {
      forceRemove: isStarterPlan(cachedPlan),
      source: cachedState?.source,
    });
    guardCurrentPage();
  } else {
    applyNavPendingState();
  }

  hydratePlanCache();

  subscribePlan((state) => {
    const nextPlan = state?.planId;
    if (!nextPlan) return;
    applyNavPlanFilter(nextPlan, {
      forceRemove: isStarterPlan(nextPlan),
      source: state?.source,
    });
    guardCurrentPage();
  });

  getPlanBootstrapPromise().then((planResult = {}) => {
    const planId = planResult?.planId;
    if (!planId) return;
    applyNavPlanFilter(planId, {
      forceRemove: isStarterPlan(planId),
      source: planResult?.source || "bootstrap",
    });
    guardCurrentPage();
  });
}
