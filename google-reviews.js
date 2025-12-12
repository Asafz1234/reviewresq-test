import {
  onSession,
  fetchAllReviews,
  calculateMetrics,
  buildRatingBreakdown,
  describeReview,
} from "./dashboard-data.js";
import { initialsFromName, formatDate } from "./session-data.js";
import { normalizePlan } from "./plan-capabilities.js";

const buildId = window.__REVIEWRESQ_BUILD_ID || "dev";

let googleConnectModulePromise;

async function getGoogleConnectModule() {
  if (!googleConnectModulePromise) {
    const moduleUrl = new URL("./google-connect.js", import.meta.url);
    moduleUrl.searchParams.set("v", buildId);
    googleConnectModulePromise = import(moduleUrl.toString());
  }
  return googleConnectModulePromise;
}

const profileNameEl = document.querySelector("[data-google-business-name]");
const profileSubtitleEl = document.querySelector("[data-google-business-subtitle]");
const ratingBadges = {
  rating: document.querySelector("[data-google-rating]"),
  count: document.querySelector("[data-google-count]"),
};
const ratingRows = document.querySelectorAll("[data-rating-row]");
const reviewList = document.querySelector("[data-google-review-list]");
const avatar = document.querySelector("[data-google-avatar]");
const connectContainer = document.querySelector("[data-google-connect-slot]");
const connectedContainer = document.querySelector("[data-google-connected]");
const changeProfileBtn = document.querySelector("[data-change-google]");
const planBadge = document.querySelector("[data-plan-badge]");
const upsellContainer = document.querySelector("[data-google-upsell]");

const toastId = "feedback-toast";
let sessionState = { user: null, profile: null, subscription: null };
let changeListenerAttached = false;

function planLabel(plan) {
  switch (plan) {
    case "growth":
      return "Growth";
    case "pro_ai":
      return "Pro AI Suite";
    default:
      return "Starter";
  }
}

function showToast(message, isError = false) {
  let toast = document.getElementById(toastId);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = toastId;
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2400);
}

function renderProfile(profile, googleMetrics) {
  const source = profile?.googleProfile || profile || {};
  const displayName = source.name || source.businessName || "Business";
  if (profileNameEl) {
    profileNameEl.textContent = displayName;
  }
  if (profileSubtitleEl) {
    const city = source.city || source.location || source.category || source.formatted_address;
    profileSubtitleEl.textContent = city || "Google profile";
  }
  if (avatar) {
    const initials = initialsFromName(displayName || "");
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

renderEnvBadge();

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
    reviewList.textContent = "No Google reviews yet.";
    return;
  }
  items.forEach((review) => {
    const container = document.createElement("div");
    container.className = "review-item";
    const meta = [];
    if (review.rating) meta.push(`${review.rating} stars`);
    const date = formatDate(review.createdAt);
    if (date && date !== "—") meta.push(date);
    container.innerHTML = `
      <div class="strong">${review.displayName}</div>
      <p class="card-subtitle">${review.message || "—"}${meta.length ? ` · ${meta.join(" · ")}` : ""}</p>
    `;
    reviewList.appendChild(container);
  });
}

function toggleViews(isConnected) {
  if (connectedContainer) {
    connectedContainer.style.display = isConnected ? "block" : "none";
  }
  if (connectContainer) {
    connectContainer.style.display = isConnected ? "none" : "block";
  }
  if (changeProfileBtn) {
    changeProfileBtn.style.display = isConnected ? "inline-flex" : "none";
  }
}

function renderUpsell(planId = "starter") {
  if (!upsellContainer) return;
  upsellContainer.innerHTML = "";
  const plan = normalizePlan(planId);
  const card = document.createElement("section");
  card.className = "card growth-upsell";
  if (plan === "starter") {
    card.innerHTML = `
      <p class="card-title">Respond to Google reviews with AI</p>
      <p class="card-subtitle">Keep your Starter plan for analytics, or upgrade to Growth to unlock AI-powered responses and automations directly from your dashboard.</p>
      <div class="growth-upsell__actions">
        <a class="btn btn-primary" href="billing.html">View plans</a>
        <a class="btn btn-link" href="billing.html">Learn more</a>
      </div>
    `;
  } else {
    card.innerHTML = `
      <p class="card-title">You’re on ${planLabel(plan)}</p>
      <p class="card-subtitle">AI replies to Google reviews are enabled for your account.</p>
    `;
  }
  upsellContainer.appendChild(card);
}

async function persistGoogleSelection(place) {
  if (!sessionState.user) return;
  try {
    const { refetchProfileAfterConnect, connectPlaceWithConfirmation } =
      await getGoogleConnectModule();

    if (place?.__alreadyConnected) {
      sessionState.profile = await refetchProfileAfterConnect();
      showToast("Google profile connected.");
      loadGoogleData();
      return;
    }

    const businessName =
      sessionState.profile?.businessName || place.name || sessionState.profile?.name || "Business";
    await connectPlaceWithConfirmation(place, { businessName });
    sessionState.profile = await refetchProfileAfterConnect();
    showToast("Google profile connected.");
    loadGoogleData();
  } catch (err) {
    console.error("[google-reviews] failed to connect Google profile", err);
    const message =
      err?.message ||
      "Unable to connect Google profile. Please ensure the phone number matches your business profile.";
    showToast(message, true);
  }
}

async function renderConnectCard() {
  const { renderGoogleConnect } = await getGoogleConnectModule();
  toggleViews(false);
  renderGoogleConnect(connectContainer, {
    title: "Connect your Google Reviews",
    subtitle:
      "Link your Google Business Profile to see your live rating, distribution, and recent reviews here.",
    helperText: "Start typing your business name as it appears on Google.",
    defaultQuery: sessionState.profile?.businessName || "",
    onConnect: persistGoogleSelection,
  });
}

async function loadGoogleData() {
  const isConnected = Boolean(sessionState.profile?.googlePlaceId);
  toggleViews(isConnected);
  if (!isConnected) {
    await renderConnectCard();
    return;
  }
  const reviews = await fetchAllReviews(sessionState.user.uid);
  const googleReviews = reviews.filter((r) => r.source === "google").map(describeReview);
  const metrics = calculateMetrics(googleReviews);
  const breakdown = buildRatingBreakdown(googleReviews);
  renderProfile(sessionState.profile, metrics);
  renderRatingBreakdown(breakdown);
  renderReviews(googleReviews.slice(0, 10));
}

onSession(async ({ user, profile, subscription }) => {
  sessionState = { user, profile, subscription };
  if (!user) return;
  const plan = normalizePlan(subscription?.planId || "starter");
  if (planBadge) {
    planBadge.textContent = planLabel(plan);
  }
  renderUpsell(plan);
  if (changeProfileBtn) {
    if (!changeListenerAttached) {
      changeProfileBtn.addEventListener("click", () => {
        renderConnectCard();
      });
      changeListenerAttached = true;
    }
  }
  await loadGoogleData();
});
