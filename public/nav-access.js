import {
  listenForUser,
  getCachedSubscription,
  isStarterPlan,
  currentEntitlements,
} from "./session-data.js";

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

const SETTINGS_ROUTES = ["alerts", "business-settings", "account", "settings"];
const SETTINGS_TARGET = "settings.html";

let initialized = false;

let currentPlan = "starter";
let currentEntitlementState = currentEntitlements();
let navObserver = null;

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

function getEntitlementForRoute(route = "", entitlements = null) {
  const key = navKeyForRoute(route);
  if (!key || !entitlements?.allowedNavItems) return true;
  return entitlements.allowedNavItems[key] !== false;
}

function setTabVisibility(tab, hidden) {
  tab.style.display = hidden ? "none" : "";
  tab.setAttribute("aria-hidden", hidden ? "true" : "false");
}

export function applyNavPlanFilter(planId = "starter", { forceRemove = false } = {}) {
  currentPlan = planId || "starter";
  currentEntitlementState = currentEntitlements(currentPlan);
  const navTabs = Array.from(document.querySelectorAll(".nav-tab"));

  navTabs.forEach((tab) => {
    const route = (tab.dataset.route || tab.getAttribute("href") || "").toLowerCase();
    const allowed = getEntitlementForRoute(route, currentEntitlementState);
    const shouldHide = allowed === false;
    setTabVisibility(tab, shouldHide);
    if (shouldHide && forceRemove) {
      tab.remove();
    }
  });

  const businessTab = document.querySelector('.settings-tab[data-panel="business"]');
  if (businessTab) {
    const allowed = currentEntitlementState?.allowedNavItems?.businessSettings !== false;
    setTabVisibility(businessTab, !allowed);
  }
}

function ensureNavObserver() {
  if (navObserver || typeof MutationObserver === "undefined") return true;
  const nav = document.querySelector(".global-nav");
  if (!nav) return false;

  navObserver = new MutationObserver(() => {
    const enforceRemoval = isStarterPlan(currentPlan);
    applyNavPlanFilter(currentPlan, { forceRemove: enforceRemoval });
    unifySettingsNav();
  });

  navObserver.observe(nav, { childList: true, subtree: true });
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
  const allowed = getEntitlementForRoute(pathRoute, currentEntitlementState);
  if (allowed) return;
  renderUpgradeGuard("This page is available on higher plans.");
}

function unifySettingsNav() {
  const nav = document.querySelector(".global-nav");
  if (!nav) return;

  const existingSettings = nav.querySelector('.nav-tab[data-route="settings"]');
  const legacyTabs = SETTINGS_ROUTES.flatMap((route) =>
    Array.from(nav.querySelectorAll(`.nav-tab[data-route="${route}"]`))
  );

  const visibleLegacy = legacyTabs.filter((tab) => tab.dataset.route !== "settings");
  const primaryTab = existingSettings || visibleLegacy[0];

  if (!existingSettings) {
    const settingsTab = primaryTab ? primaryTab.cloneNode(true) : document.createElement("a");
    settingsTab.classList.add("nav-tab");
    settingsTab.dataset.route = "settings";
    settingsTab.setAttribute("href", SETTINGS_TARGET);
    settingsTab.textContent = "Settings";
    const icon = settingsTab.querySelector(".nav-icon");
    if (icon) {
      icon.textContent = "⚙️";
      if (!icon.nextElementSibling) {
        const label = document.createElement("span");
        label.textContent = "Settings";
        icon.after(label);
      }
    } else {
      settingsTab.innerHTML = `<span class="nav-icon">⚙️</span><span>Settings</span>`;
    }
    nav.appendChild(settingsTab);
  }

  legacyTabs.forEach((tab) => {
    if (tab.dataset.route !== "settings") {
      tab.style.display = "none";
      tab.setAttribute("aria-hidden", "true");
    }
    if (SETTINGS_ROUTES.includes(tab.dataset.route || "")) {
      tab.setAttribute("href", SETTINGS_TARGET);
      tab.dataset.route = "settings";
    }
  });
}

export function initNavPlanFilter() {
  if (initialized) return;
  initialized = true;

  const cachedPlan = getCachedSubscription()?.planId || "starter";
  applyNavPlanFilter(cachedPlan, { forceRemove: isStarterPlan(cachedPlan) });
  unifySettingsNav();
  guardCurrentPage();

  const maxAttempts = 5;
  const observeWithRetry = (attempt = 0) => {
    const attached = ensureNavObserver();
    if (attached) {
      applyNavPlanFilter(currentPlan, { forceRemove: isStarterPlan(currentPlan) });
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
}
