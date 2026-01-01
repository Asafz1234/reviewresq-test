import { onSession, fetchAllReviews, calculateMetrics, buildRatingBreakdown, buildTimeline } from "./dashboard-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";

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

function renderBusinessCard(profile, subscription) {
  if (businessElements.name) {
    businessElements.name.textContent =
      profile?.name || profile?.businessName || "Your business";
  }
  if (businessElements.category) {
    businessElements.category.textContent = profile?.category || profile?.businessType || "Business";
  }
  if (businessElements.plan) {
    const normalized = normalizePlan(subscription?.planId || subscription?.planTier || "starter");
    businessElements.plan.textContent = PLAN_LABELS[normalized] || "Starter";
  }
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

onSession(async ({ user, profile, subscription }) => {
  if (!user) return;
  setLoadingState();
  renderBusinessCard(profile, subscription);
  const reviews = await fetchAllReviews(user.uid);
  const metrics = calculateMetrics(reviews);
  const breakdown = buildRatingBreakdown(reviews);
  const timeline = buildTimeline(reviews);
  renderMetrics(metrics);
  renderRatingBreakdown(breakdown);
  renderTimeline(timeline);
});
