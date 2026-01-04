import { listenForUser, getCachedSubscription, isStarterPlan } from "./session-data.js";

const STARTER_BLOCKED_ROUTES = new Set(["campaigns", "ai-agent"]);
const PRO_SUITE_ANCHOR = "ai-agent.html#pro-suite";

let currentPlan = "starter";
let navObserver = null;

function isBlockedTab(tab) {
  const route = (tab.dataset.route || "").toLowerCase();
  const href = (tab.getAttribute("href") || "").toLowerCase();
  return STARTER_BLOCKED_ROUTES.has(route) || href.includes(PRO_SUITE_ANCHOR);
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

  getBlockedTabs().forEach((tab) => {
    setTabVisibility(tab, hideBlocked);
    if (hideBlocked && forceRemove) {
      tab.remove();
    }
  });
}

function ensureNavObserver() {
  if (navObserver || typeof MutationObserver === "undefined") return;
  const nav = document.querySelector(".global-nav");
  if (!nav) return;

  navObserver = new MutationObserver(() => {
    const enforceRemoval = isStarterPlan(currentPlan);
    applyNavPlanFilter(currentPlan, { forceRemove: enforceRemoval });
  });

  navObserver.observe(nav, { childList: true });
}

export function initNavPlanFilter() {
  const cachedPlan = getCachedSubscription()?.planId || "starter";
  applyNavPlanFilter(cachedPlan);
  ensureNavObserver();

  listenForUser(({ subscription }) => {
    const planId = subscription?.planId || "starter";
    const forceRemoval = isStarterPlan(planId);
    applyNavPlanFilter(planId, { forceRemove: forceRemoval });
  });
}
