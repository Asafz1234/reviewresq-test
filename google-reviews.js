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
import { formatDate, hasPlanFeature, listenForUser } from "./session-data.js";

const statusFilter = document.getElementById("statusFilter");
const ratingFilter = document.getElementById("ratingFilter");
const searchFilter = document.getElementById("searchFilter");
const reviewList = document.getElementById("reviewList");
const emptyState = document.getElementById("emptyState");
const syncReviewsBtn = document.getElementById("syncReviewsBtn");

let reviews = [];
let allowAutoReply = false;

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
  try {
    const baseRef = collection(db, "feedback");
    const q = query(baseRef, where("businessId", "==", uid), where("source", "==", "google"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    snap.forEach((doc) => results.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn("[google-reviews] primary fetch failed", err);
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

  const gatedHandler = (handler) => () => {
    if (!allowAutoReply) {
      alert("AI auto-reply to Google reviews is available on the Growth plan and above. Upgrade to enable it.");
      window.location.href = "account.html";
      return;
    }
    handler();
  };

  if (review.replyStatus === "none") {
    buttons.push(button("Generate reply", "btn-secondary", gatedHandler(() => showToast("Generating reply…"))));
  } else if (review.replyStatus === "draft") {
    buttons.push(button("Approve & Send", "btn-primary", gatedHandler(() => showToast("Reply sent"))));
    buttons.push(button("Regenerate", "btn-secondary", gatedHandler(() => showToast("Regenerating…"))));
  } else if (review.replyStatus === "auto_sent" || review.replyStatus === "manual_sent") {
    buttons.push(button("View reply", "btn-secondary", () => showToast("Reply already sent")));
  }

  if (review.replyStatus === "failed") {
    buttons.push(button("Retry sending", "btn-primary", () => showToast("Retrying…")));
  }

  return buttons;
}

function renderReviews() {
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
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => toast.remove(), 2600);
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
  allowAutoReply = hasPlanFeature("aiAutoReplyGoogle");
});
