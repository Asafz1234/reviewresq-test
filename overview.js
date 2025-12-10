import {
  collection,
  db,
  getDocs,
  query,
  where,
} from "./firebase-config.js";
import { listenForUser } from "./session-data.js";

const statElements = {
  totalReviews: document.querySelector('[data-metric="total-reviews"]'),
  positiveFeedback: document.querySelector('[data-metric="positive-feedback"]'),
  averageRating: document.querySelector('[data-metric="average-rating"]'),
  pendingFollowUps: document.querySelector('[data-metric="pending-followups"]'),
};

function setLoadingState() {
  Object.values(statElements).forEach((el) => {
    if (el) {
      el.textContent = "—";
    }
  });
}

function extractRating(raw = {}) {
  const rating = Number(raw.rating ?? raw.score ?? raw.ratingValue ?? 0);
  if (Number.isFinite(rating) && rating > 0) return rating;
  return null;
}

function extractSentiment(raw = {}) {
  if (typeof raw.sentimentScore === "number") return raw.sentimentScore;
  const rating = extractRating(raw);
  if (rating === null) return null;
  return Number((rating - 3).toFixed(2));
}

function normalizeStatus(raw = {}) {
  const status = (raw.status || "open").toString().toLowerCase();
  return status;
}

async function fetchFeedbackDocs(businessId) {
  const reviews = [];
  const seenRefs = new Set();

  async function safeCollect(refBuilder) {
    try {
      const snap = await refBuilder();
      snap.forEach((docSnap) => {
        const path = docSnap.ref?.path || docSnap.id;
        if (seenRefs.has(path)) return;
        seenRefs.add(path);
        reviews.push({ id: docSnap.id, ...docSnap.data() });
      });
    } catch (err) {
      console.warn("[overview] Failed to fetch feedback", err);
    }
  }

  await safeCollect(() => {
    const baseRef = collection(db, "feedback");
    return getDocs(query(baseRef, where("businessId", "==", businessId)));
  });

  await safeCollect(() => {
    const nestedRef = collection(db, "businessProfiles", businessId, "feedback");
    return getDocs(nestedRef);
  });

  await safeCollect(() => {
    const googleRef = collection(db, "googleReviews");
    return getDocs(query(googleRef, where("businessId", "==", businessId)));
  });

  return reviews;
}

function calculateMetrics(reviews = []) {
  const total = reviews.length;
  let positive = 0;
  let pending = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  reviews.forEach((review) => {
    const rating = extractRating(review);
    const sentiment = extractSentiment(review);
    const status = normalizeStatus(review);

    if (rating !== null) {
      ratingSum += rating;
      ratingCount += 1;
    }

    if (status !== "resolved" && status !== "closed" && status !== "done") {
      pending += 1;
    }

    if (rating !== null && rating >= 4) {
      positive += 1;
    } else if (rating === null && typeof sentiment === "number" && sentiment > 0) {
      positive += 1;
    }
  });

  const averageRating = ratingCount ? ratingSum / ratingCount : null;
  const positivePercent = total ? Math.round((positive / total) * 100) : 0;

  return {
    total,
    positivePercent,
    averageRating,
    pending,
  };
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

setLoadingState();

listenForUser(async ({ user }) => {
  if (!user) return;
  setLoadingState();
  const reviews = await fetchFeedbackDocs(user.uid);
  const metrics = calculateMetrics(reviews);
  renderMetrics(metrics);
});
