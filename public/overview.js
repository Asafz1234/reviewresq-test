import { onSession, fetchAllReviews, calculateMetrics, buildRatingBreakdown, buildTimeline } from "./dashboard-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";
import { getCachedPlan, getEffectivePlan, setCachedPlan } from "./session-data.js";

const statElements = {
  totalReviews: document.querySelector('[data-metric="total-reviews"]'),
  positiveFeedback: document.querySelector('[data-metric="positive-feedback"]'),
  averageRating: document.querySelector('[data-metric="average-rating"]'),
  pendingFollowUps: document.querySelector('[data-metric="pending-followups"]'),
};

const businessElements = {
  name: document.querySelector('[data-business="name"]'),
  category: document.querySelector('[data-business="category"]'),
  plan: document.querySelector('[data-business="plan"]'),
  status: document.querySelector('[data-business="status"]'),
};

const ratingRows = document.querySelectorAll("[data-rating-row]");
const timelineContainer = document.querySelector("[data-reviews-timeline]");
const signalPageDataReady = (() => {
  let sent = false;
  return () => {
    if (sent) return;
    sent = true;
    window.__rrPageDataReady?.();
  };
})();

function setLoadingState() {
  Object.values(statElements).forEach((el) => {
    if (el) {
      el.textContent = "—";
    }
  });
  ratingRows.forEach((row) => {
    const value = row.querySelector(".rating-value");
    if (value) value.textContent = "—";
  });
  if (timelineContainer) {
    timelineContainer.textContent = "Loading...";
  }
}

function renderPlanLoadingState() {
  if (businessElements.plan) {
    businessElements.plan.textContent = "Loading...";
    businessElements.plan.setAttribute("data-plan-loading", "true");
  }
}

function applyPlan(planId) {
  if (!businessElements.plan) return;
  if (!planId) {
    renderPlanLoadingState();
    return;
  }
  const normalized = normalizePlan(planId);
  businessElements.plan.textContent = PLAN_LABELS[normalized] || "Loading...";
  businessElements.plan.removeAttribute("data-plan-loading");
  setCachedPlan(normalized);
}

async function renderBusinessCard(profile, subscription) {
  if (businessElements.name) {
    businessElements.name.textContent =
      profile?.name || profile?.businessName || "Your business";
  }
  if (businessElements.category) {
    businessElements.category.textContent = profile?.category || profile?.businessType || "Business";
  }
  const cachedPlanResult = await getEffectivePlan({ maxAgeMs: 5 * 60 * 1000 });
  const resolvedPlan =
    subscription?.planId ||
    subscription?.planTier ||
    cachedPlanResult?.planId ||
    getCachedPlan();
  applyPlan(resolvedPlan);
  if (businessElements.status) {
    businessElements.status.textContent = profile?.status || "Live";
  }
}

function renderMetrics({ total, positivePercent, averageRating, pending }) {
  if (statElements.totalReviews) statElements.totalReviews.textContent = total;
  if (statElements.positiveFeedback)
    statElements.positiveFeedback.textContent = `${positivePercent}%`;
  if (statElements.pendingFollowUps) statElements.pendingFollowUps.textContent = pending;

  if (statElements.averageRating) {
    if (averageRating === null) {
      statElements.averageRating.textContent = "—";
    } else {
      statElements.averageRating.textContent = averageRating.toFixed(1);
    }
  }
}

function renderRatingBreakdown(breakdown) {
  ratingRows.forEach((row) => {
    const star = row.getAttribute("data-rating-row");
    const valueEl = row.querySelector(".rating-value");
    if (!valueEl || !star) return;
    const percent = breakdown.percents[star] ?? 0;
    valueEl.textContent = `${percent}%`;
  });
}

function renderTimeline(timeline = []) {
  if (!timelineContainer) return;
  if (!timeline.length) {
    timelineContainer.textContent = "No reviews yet";
    return;
  }
  const list = document.createElement("ul");
  list.className = "list";
  timeline.slice(-6).forEach(({ date, count }) => {
    const item = document.createElement("li");
    item.textContent = `${date}: ${count}`;
    list.appendChild(item);
  });
  timelineContainer.innerHTML = "";
  timelineContainer.appendChild(list);
}

setLoadingState();

let initialResolved = false;
getEffectivePlan({ maxAgeMs: 5 * 60 * 1000 }).then(({ planId }) => {
  initialResolved = true;
  if (planId) {
    applyPlan(planId);
  } else {
    renderPlanLoadingState();
  }
});
Promise.resolve().then(() => {
  if (!initialResolved) {
    renderPlanLoadingState();
  }
});

onSession(async ({ user, profile, subscription }) => {
  if (!user) return;
  setLoadingState();
  await renderBusinessCard(profile, subscription);
  try {
    const reviews = await fetchAllReviews(user.uid);
    const metrics = calculateMetrics(reviews);
    const breakdown = buildRatingBreakdown(reviews);
    const timeline = buildTimeline(reviews);
    renderMetrics(metrics);
    renderRatingBreakdown(breakdown);
    renderTimeline(timeline);
  } finally {
    signalPageDataReady();
  }
});
