import {
  listenForUser,
  PLAN_DETAILS,
  updateBusinessPlan,
  getPlanBootstrapPromise,
} from "./session-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";
import { applyNavPlanFilter } from "./nav-access-versioned.js";

const planSummary = document.getElementById("planSummary");
const planStatus = document.getElementById("planStatus");
const planRenewal = document.getElementById("planRenewal");
const paymentMethod = document.getElementById("paymentMethod");
const billingEmail = document.getElementById("billingEmail");
const upgradeButton = document.getElementById("upgradeButton");
const growthEnabledBadge = document.getElementById("growthEnabledBadge");
const signalPageDataReady = (() => {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    window.__rrPageDataReady?.();
  };
})();

let currentPlan = null;

function renderPlanSummary(planId, subscription) {
  if (!planId) {
    currentPlan = null;
    if (planSummary) {
      planSummary.textContent = "Loading…";
    }
    if (upgradeButton) {
      upgradeButton.textContent = "Loading…";
      upgradeButton.disabled = true;
      upgradeButton.setAttribute("aria-disabled", "true");
    }
  } else {
    const normalizedPlan = normalizePlan(planId);
    currentPlan = normalizedPlan;
    const planDetails = PLAN_DETAILS[normalizedPlan] || PLAN_DETAILS.starter;
    const label = PLAN_LABELS[normalizedPlan] || PLAN_LABELS.starter;
    const price = planDetails?.priceMonthly ?? PLAN_DETAILS.starter.priceMonthly;

    if (planSummary) {
      planSummary.textContent = `${label} plan · $${price}/month`;
    }

    if (normalizedPlan === "growth") {
      upgradeButton.textContent = "Growth enabled";
      upgradeButton.disabled = true;
      upgradeButton.setAttribute("aria-disabled", "true");
      if (growthEnabledBadge) growthEnabledBadge.style.display = "inline-flex";
    } else {
      upgradeButton.textContent = "Upgrade to Growth";
      upgradeButton.disabled = false;
      upgradeButton.removeAttribute("aria-disabled");
      if (growthEnabledBadge) growthEnabledBadge.style.display = "none";
    }
  }
  if (planStatus) {
    planStatus.textContent = (subscription?.status || "active").toString();
  }
  if (planRenewal) {
    const periodEnd = subscription?.currentPeriodEnd?.toDate
      ? subscription.currentPeriodEnd.toDate()
      : subscription?.currentPeriodEnd;
    planRenewal.textContent = subscription?.currentPeriodEnd
      ? `Next renewal: ${new Date(periodEnd).toLocaleDateString()}`
      : "Next renewal: —";
  }
  if (paymentMethod) {
    paymentMethod.textContent = subscription?.paymentMethod || "Card on file";
  }
  if (billingEmail) {
    billingEmail.textContent = subscription?.billingEmail || "billing@reviewresq.com";
  }
}

upgradeButton?.addEventListener("click", async () => {
  if (currentPlan === "growth") return;
  upgradeButton.disabled = true;
  upgradeButton.textContent = "Upgrading...";
  try {
    const updatedPlan = await updateBusinessPlan("growth");
    renderPlanSummary(updatedPlan, {});
    applyNavPlanFilter(updatedPlan, { forceRemove: false });
  } catch (error) {
    console.error("Failed to upgrade plan", error);
    upgradeButton.disabled = false;
    upgradeButton.textContent = "Upgrade to Growth";
  }
});

const sessionPromise = new Promise((resolve) => {
  listenForUser(({ subscription, business }) => {
    resolve({ subscription, business });
  });
});

Promise.all([getPlanBootstrapPromise(), sessionPromise]).then(([planResult, session]) => {
  renderPlanSummary(planResult?.planId || null, session.subscription);
  signalPageDataReady();
});
