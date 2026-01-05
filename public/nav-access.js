import { listenForUser, getCachedSubscription, isStarterPlan } from "./session-data.js";

const STARTER_BLOCKED_ROUTES = new Set([
  "campaigns",
  "ai-agent",
  "business-settings",
]);
const STARTER_BLOCKED_ANCHORS = [
  "ai-agent.html#pro-suite",
  "ai-agent.html#phone",
  "ai-agent.html#phone-agent",
  "ai-agent.html#ai-phone-agent",
  "ai-phone-agent",
  "pro-suite",
];

const SETTINGS_ROUTES = ["alerts", "business-settings", "account", "settings"];
const SETTINGS_TARGET = "settings.html";

let initialized = false;

let currentPlan = "starter";
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

function isBlockedTab(tab) {
  const route = (tab.dataset.route || "").toLowerCase();
  const href = String(tab.getAttribute("href") || "").toLowerCase();
  const normalizedRoute = normalizeRouteFromHref(href) || normalizeRouteFromHref(route) || route;

  const routeBlocked = STARTER_BLOCKED_ROUTES.has(normalizedRoute);
  const anchorBlocked = STARTER_BLOCKED_ANCHORS.some((anchor) => href.includes(anchor));

  return routeBlocked || anchorBlocked;
}

function getBlockedTabs() {
  return Array.from(document.querySelectorAll(".nav-tab")).filter(isBlockedTab);
}

function setTabVisibility(tab, hidden) {
  tab.style.display = hidden ? "none" : "";
  tab.setAttribute("aria-hidden", hidden ? "true" : "false");
}

export function applyNavPlanFilter(planId = "starter", { forceRemove = false } = {}) {
  currentPlan = planId || "starter";
  const hideBlocked = isStarterPlan(currentPlan);

  console.log("[plan]", currentPlan);
  console.log("[isStarter]", hideBlocked);

  getBlockedTabs().forEach((tab) => {
    setTabVisibility(tab, hideBlocked);
    if (hideBlocked && forceRemove) {
      tab.remove();
    }
  });

  const businessTab = document.querySelector('.settings-tab[data-panel="business"]');
  if (businessTab) {
    setTabVisibility(businessTab, hideBlocked);
  }

  if (hideBlocked) {
    console.log("[nav] hiding blocked items for starter");
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

  const maxAttempts = 5;
  const observeWithRetry = (attempt = 0) => {
    const attached = ensureNavObserver();
    if (attached) {
      applyNavPlanFilter(currentPlan, { forceRemove: isStarterPlan(currentPlan) });
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
  });
}
