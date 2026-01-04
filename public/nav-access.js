import { listenForUser, getCachedSubscription, isStarterPlan } from "./session-data.js";

const STARTER_BLOCKED_ROUTES = new Set(["campaigns", "ai-agent"]);

function shouldHideTab(tab) {
  const route = tab.dataset.route;
  const href = tab.getAttribute("href") || "";
  return STARTER_BLOCKED_ROUTES.has(route) || href.includes("ai-agent.html#pro-suite");
}

export function applyNavPlanFilter(planId = "starter") {
  const hideBlocked = isStarterPlan(planId);
  const tabs = Array.from(document.querySelectorAll(".nav-tab"));

  tabs.forEach((tab) => {
    if (!shouldHideTab(tab)) return;
    tab.style.display = hideBlocked ? "none" : "";
    tab.setAttribute("aria-hidden", hideBlocked ? "true" : "false");
  });
}

export function initNavPlanFilter() {
  const cachedPlan = getCachedSubscription()?.planId || "starter";
  applyNavPlanFilter(cachedPlan);

  listenForUser(({ subscription }) => {
    const planId = subscription?.planId || "starter";
    applyNavPlanFilter(planId);
  });
}
