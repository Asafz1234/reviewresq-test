import { listenForUser, getCachedSubscription, isStarterPlan } from "./session-data.js";

const STARTER_BLOCKED_ROUTES = new Set(["campaigns", "ai-agent"]);
const STARTER_BLOCKED_ANCHORS = [
  "ai-agent.html#pro-suite",
  "ai-agent.html#phone",
  "ai-agent.html#phone-agent",
  "ai-agent.html#ai-phone-agent",
  "ai-phone-agent",
];

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
  });

  navObserver.observe(nav, { childList: true, subtree: true });
  return true;
}

export function initNavPlanFilter() {
  const cachedPlan = getCachedSubscription()?.planId || "starter";
  applyNavPlanFilter(cachedPlan, { forceRemove: isStarterPlan(cachedPlan) });

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
