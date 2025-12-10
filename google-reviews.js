import {
  onSession,
  fetchAllReviews,
  calculateMetrics,
  buildRatingBreakdown,
  describeReview,
} from "./dashboard-data.js";
import { initialsFromName } from "./session-data.js";

const profileNameEl = document.querySelector("[data-google-business-name]");
const profileSubtitleEl = document.querySelector("[data-google-business-subtitle]");
const ratingBadges = {
  rating: document.querySelector("[data-google-rating]"),
  count: document.querySelector("[data-google-count]"),
};
const ratingRows = document.querySelectorAll("[data-rating-row]");
const reviewList = document.querySelector("[data-google-review-list]");
const avatar = document.querySelector("[data-google-avatar]");

function renderProfile(profile, googleMetrics) {
  if (profileNameEl) {
    profileNameEl.textContent = profile?.name || profile?.businessName || "Business";
  }
  if (profileSubtitleEl) {
    const city = profile?.city || profile?.location || profile?.category;
    profileSubtitleEl.textContent = city || "Google profile";
  }
  if (avatar) {
    const initials = initialsFromName(profile?.name || profile?.businessName || "");
    avatar.textContent = initials;
  }
  if (ratingBadges.rating) {
    ratingBadges.rating.textContent = googleMetrics.averageRating
      ? `Google rating ${googleMetrics.averageRating.toFixed(1)}`
      : "No rating yet";
  }
  if (ratingBadges.count) {
    ratingBadges.count.textContent = `${googleMetrics.total || 0} reviews`;
  }
}

function renderRatingBreakdown(breakdown) {
  ratingRows.forEach((row) => {
    const star = row.getAttribute("data-rating-row");
    const valueEl = row.querySelector(".rating-value");
    if (!valueEl) return;
    const percent = breakdown.percents[star] ?? 0;
    valueEl.textContent = `${percent}%`;
  });
}

function renderReviews(items = []) {
  if (!reviewList) return;
  reviewList.innerHTML = "";
  if (!items.length) {
    reviewList.textContent = "No Google reviews connected yet.";
    return;
  }
  items.forEach((review) => {
    const container = document.createElement("div");
    container.className = "review-item";
    const meta = [];
    if (review.rating) meta.push(`${review.rating} stars`);
    const date = review.createdAt
      ? review.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : null;
    if (date) meta.push(date);
    container.innerHTML = `
      <div class="strong">${review.displayName}</div>
      <p class="card-subtitle">${review.message || "—"}${meta.length ? ` · ${meta.join(" · ")}` : ""}</p>
    `;
    reviewList.appendChild(container);
  });
}

onSession(async ({ user, profile }) => {
  if (!user) return;
  const reviews = await fetchAllReviews(user.uid);
  const googleReviews = reviews.filter((r) => r.source === "google").map(describeReview);
  const metrics = calculateMetrics(googleReviews);
  const breakdown = buildRatingBreakdown(googleReviews);
  renderProfile(profile, metrics);
  renderRatingBreakdown(breakdown);
  renderReviews(googleReviews.slice(0, 10));
});
