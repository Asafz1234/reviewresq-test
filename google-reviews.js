import {
  auth,
  onAuthStateChanged,
  db,
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "./firebase-config.js";
import { PLAN_LABELS, normalizePlan, upgradeTargetForFeature } from "./plan-capabilities.js";
import { formatDate, hasPlanFeature, listenForUser, currentPlanTier } from "./session-data.js";
import { lockUI } from "./plan-lock.js";

const statusFilter = document.getElementById("statusFilter");
const ratingFilter = document.getElementById("ratingFilter");
const searchFilter = document.getElementById("searchFilter");
const reviewList = document.getElementById("reviewList");
const emptyState = document.getElementById("emptyState");
const syncReviewsBtn = document.getElementById("syncReviewsBtn");
const heroSync = document.getElementById("heroSync");
const aiUpsellPanel = document.getElementById("aiUpsellPanel");
const aiAccessPanel = document.getElementById("aiAccessPanel");
const pageRoot = document.getElementById("google-reviews") || document.getElementById("google-reviews-root");

let reviews = [];
let allowAutoReply = false;
let upgradeTarget = "growth";
let primaryIndexError = false;
let activePlan = normalizePlan(currentPlanTier());

const statusMap = {
  none: { label: "Needs reply", tone: "badge-warning" },
  draft: { label: "Draft pending", tone: "badge-muted" },
  auto_sent: { label: "Auto replied", tone: "badge-success" },
  manual_sent: { label: "Replied manually", tone: "badge" },
  failed: { label: "Failed", tone: "badge-danger" },
};

function formatStars(rating) {
  const safe = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)));
  return "★★★★★".slice(0, safe) + "☆☆☆☆☆".slice(safe).slice(0, 5 - safe);
}

function normalizeReview(raw) {
  const createdAt = raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(raw.createdAt || Date.now());
  return {
    id: raw.id,
    reviewerName: raw.reviewerName || raw.name || raw.customerName || "Customer",
    rating: Number(raw.rating) || 0,
    text: raw.text || raw.message || "",
    replyText: raw.replyText || raw.aiReplyText || "",
    replyStatus: raw.replyStatus || raw.aiReplyStatus || "none",
    replySource: raw.replySource || "",
    needsAttention: raw.needsAttention || false,
    createdAt,
    sentimentScore: raw.sentimentScore,
    source: raw.source || raw.type || "google",
  };
}

async function fetchFeedback(uid) {
  const results = [];
  primaryIndexError = false;
  if (pageRoot) pageRoot.removeAttribute("data-error");
  let primaryError = null;
  try {
    const baseRef = collection(db, "feedback");
    // Index requirement: feedback where businessId == uid AND source == "google" ordered by createdAt desc.
    // Composite index fields: businessId (ASC), source (ASC), createdAt (DESC).
    const q = query(baseRef, where("businessId", "==", uid), where("source", "==", "google"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    snap.forEach((doc) => results.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    primaryError = err;
    primaryIndexError =
      err && err.code === "failed-precondition" && String(err.message || "").includes("requires an index");
    console.error("[google-reviews] primary fetch failed", err);
  }

  try {
    const nestedRef = collection(db, "businessProfiles", uid, "feedback");
    const nested = await getDocs(nestedRef);
    nested.forEach((doc) => {
      const data = doc.data();
      if (data.source === "google" || data.type === "google") {
        results.push({ id: doc.id, ...data });
      }
    });
  } catch (err) {
    console.warn("[google-reviews] nested fetch failed", err);
  }

  reviews = results.map(normalizeReview);

  if (!reviews.length && primaryError) {
    const isIndexError = primaryIndexError;
    renderFriendlyError(
      isIndexError
        ? {
            title: "We’re setting up your Google reviews",
            message: "Please try again in a few minutes. If this keeps happening, reach out to support.",
          }
        : {
            title: "Couldn’t load Google reviews",
            message: "Please refresh the page or try again later.",
          }
    );
  }
}

function buildActions(review) {
  const buttons = [];
  const button = (label, variant, handler) => {
    const btn = document.createElement("button");
    btn.className = `btn ${variant}`;
    btn.textContent = label;
    btn.addEventListener("click", handler);
    return btn;
  };

  const lockedButton = (label) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-disabled";
    btn.textContent = label;
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
    btn.title = "AI auto-replies to Google reviews are available on Growth and Pro AI Suite.";
    btn.dataset.feature = "aiAutoReplyGoogle";
    return btn;
  };

  if (review.replyStatus === "none") {
    buttons.push(
      allowAutoReply
        ? button("Generate reply", "btn-secondary", () => showToast("Generating reply…"))
        : lockedButton("AI reply (Growth)")
    );
  } else if (review.replyStatus === "draft") {
    if (allowAutoReply) {
      buttons.push(button("Approve & Send", "btn-primary", () => showToast("Reply sent")));
      buttons.push(button("Regenerate", "btn-secondary", () => showToast("Regenerating…")));
    } else {
      buttons.push(lockedButton("AI reply (Growth)"));
    }
  } else if (review.replyStatus === "auto_sent" || review.replyStatus === "manual_sent") {
    buttons.push(button("View reply", "btn-secondary", () => showToast("Reply already sent")));
  }

  if (review.replyStatus === "failed") {
    buttons.push(button("Retry sending", "btn-primary", () => showToast("Retrying…")));
  }

  return buttons;
}

function renderReviews() {
  if (pageRoot?.dataset.error === "true" && !reviews.length) {
    emptyState.style.display = "none";
    return;
  }

  reviewList.innerHTML = "";

  const filtered = reviews.filter((review) => {
    const statusValue = statusFilter.value;
    const ratingValue = ratingFilter.value;
    const searchValue = searchFilter.value.toLowerCase();

    const matchesStatus =
      statusValue === "all" ||
      (statusValue === "needs" && (review.replyStatus === "none" || review.needsAttention)) ||
      (statusValue === "auto" && review.replySource === "ai_auto") ||
      (statusValue === "manual" && (review.replySource === "ai_manual" || review.replySource === "user_manual")) ||
      (statusValue === "failed" && review.replyStatus === "failed");

    const matchesRating = ratingValue === "all" || review.rating === Number(ratingValue);
    const matchesSearch =
      !searchValue ||
      review.reviewerName.toLowerCase().includes(searchValue) ||
      review.text.toLowerCase().includes(searchValue) ||
      review.replyText.toLowerCase().includes(searchValue);

    return matchesStatus && matchesRating && matchesSearch;
  });

  emptyState.style.display = filtered.length === 0 ? "block" : "none";

  filtered.forEach((review) => {
    const tpl = document.getElementById("review-row-template");
    const node = tpl.content.cloneNode(true);
    node.querySelector(".reviewer").textContent = review.reviewerName;
    node.querySelector(".stars").textContent = formatStars(review.rating);
    node.querySelector(".caption").textContent = `${formatDate(review.createdAt)} · Google`;
    node.querySelector(".review-text").textContent = review.text;

    const status = statusMap[review.replyStatus] || statusMap.none;
    const badge = node.querySelector("[data-role='status-badge']");
    badge.textContent = review.needsAttention ? "Needs attention" : status.label;
    badge.className = `badge ${status.tone}`;

    const replyTextEl = node.querySelector(".reply-text");
    if (review.replyText) {
      replyTextEl.textContent = `${review.replyStatus === "draft" ? "Draft:" : "Reply:"} ${review.replyText}`;
    } else {
      replyTextEl.style.display = "none";
    }

    const actions = node.querySelector("[data-role='action-buttons']");
    actions.append(...buildActions(review));
    reviewList.appendChild(node);
  });

  lockUI(activePlan, reviewList);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => toast.remove(), 2600);
}

function renderFriendlyError({ title, message }) {
  if (!reviewList) return;
  emptyState.style.display = "none";
  const card = document.createElement("div");
  card.className = "card rr-empty-state";
  card.innerHTML = `
    <h3 class="section-title">${title}</h3>
    <p class="card-sub">${message}</p>
  `;
  reviewList.innerHTML = "";
  reviewList.appendChild(card);
  if (pageRoot) pageRoot.dataset.error = "true";
}

function renderAiPanels(planId) {
  const normalizedPlan = normalizePlan(planId || "starter");
  upgradeTarget = upgradeTargetForFeature("aiAutoReplyGoogle") || "growth";

  if (!aiUpsellPanel || !aiAccessPanel) return;
  const upgradeCta = aiUpsellPanel.querySelector(".btn-primary");
  if (upgradeCta) {
    upgradeCta.textContent = `Upgrade to ${PLAN_LABELS[upgradeTarget] || PLAN_LABELS.growth}`;
  }

  if (allowAutoReply) {
    aiUpsellPanel.style.display = "none";
    aiAccessPanel.style.display = "flex";
    return;
  }

  aiUpsellPanel.style.display = "flex";
  aiAccessPanel.style.display = "none";
  aiUpsellPanel.querySelector(".card-title").textContent =
    normalizedPlan === "starter"
      ? "AI auto-replies are available on Growth and Pro AI Suite."
      : "AI auto-replies unlock with your next plan upgrade.";
}

function wireFilters() {
  statusFilter?.addEventListener("change", renderReviews);
  ratingFilter?.addEventListener("change", renderReviews);
  searchFilter?.addEventListener("input", renderReviews);
  syncReviewsBtn?.addEventListener("click", async () => {
    showToast("Syncing Google reviews…");
    if (currentUser) {
      await fetchFeedback(currentUser.uid);
      renderReviews();
    }
  });

  heroSync?.addEventListener("click", (event) => {
    event.preventDefault();
    syncReviewsBtn?.click();
  });
}

let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }
  currentUser = user;
  await fetchFeedback(user.uid);
  renderReviews();
  wireFilters();
});

listenForUser(({ subscription }) => {
  const normalizedPlan = normalizePlan(subscription?.planId || "starter");
  activePlan = normalizedPlan;
  allowAutoReply = hasPlanFeature("aiAutoReplyGoogle");
  renderAiPanels(normalizedPlan);
  renderReviews();
});
