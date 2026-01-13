import { collection, db, getDocs, query, where, orderBy, limit, startAfter } from "./firebase-config.js";
import { listenForUser } from "./session-data.js";
import { fetchFeedbackForBusiness } from "./feedback-store.js";

const REVIEWS_CACHE_TTL_MS = 60 * 1000;
const reviewsCache = new Map();
const reviewsInflight = new Map();
const isDevEnv =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

export function onSession(callback) {
  return listenForUser(callback);
}

function withTiming(label, fn) {
  if (isDevEnv) {
    console.time(label);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (isDevEnv) {
        console.timeEnd(label);
      }
    });
}

function normalizeTimestamp(raw) {
  if (!raw) return null;
  if (raw.toDate) return raw.toDate();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  return (raw.status || "open").toString().toLowerCase();
}

async function collect(queryBuilder, fallbackBuilder = null) {
  const results = [];
  try {
    const snap = await queryBuilder();
    snap.forEach((docSnap) => {
      results.push({ id: docSnap.id, ...docSnap.data() });
    });
  } catch (err) {
    if (fallbackBuilder) {
      console.warn("[dashboard-data] fetch failed, trying fallback", err);
      return collect(fallbackBuilder, null);
    }
    console.warn("[dashboard-data] fetch failed", err);
  }
  return results;
}

function readCache(cacheKey) {
  const cached = reviewsCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > REVIEWS_CACHE_TTL_MS) {
    reviewsCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

function writeCache(cacheKey, data) {
  reviewsCache.set(cacheKey, { data, timestamp: Date.now() });
}

function buildGoogleQuery({ businessId, pageSize, startAfterValue, orderField }) {
  const constraints = [where("businessId", "==", businessId), orderBy(orderField, "desc")];
  if (startAfterValue !== null && startAfterValue !== undefined) {
    constraints.push(startAfter(startAfterValue));
  }
  constraints.push(limit(pageSize));
  return query(collection(db, "googleReviews"), ...constraints);
}

export async function fetchAllReviews(
  businessId,
  { pageSize = 200, startAfterValue = null } = {}
) {
  if (!businessId) return [];
  const cacheKey = JSON.stringify({ businessId, pageSize, startAfterValue });
  const cached = readCache(cacheKey);
  if (cached) return cached;
  if (reviewsInflight.has(cacheKey)) return reviewsInflight.get(cacheKey);

  const fetchPromise = (async () => {
    const feedback = await fetchFeedbackForBusiness(businessId, {
      includeLegacy: true,
      logDebug: isDevEnv,
      pageSize,
      startAfterMs: null,
    });
    const googleReviews = await collect(
      () =>
        withTiming("[dashboard-data] google reviews fetch", () =>
          getDocs(buildGoogleQuery({ businessId, pageSize, startAfterValue, orderField: "createdAt" }))
        ),
      () =>
        withTiming("[dashboard-data] google reviews fallback", () =>
          getDocs(buildGoogleQuery({ businessId, pageSize, startAfterValue, orderField: "timestamp" }))
        )
    );

    const merged = [
      ...feedback.map((item) => ({ ...item, source: item.source || "feedback" })),
      ...googleReviews.map((item) => ({ ...item, source: "google" })),
    ];
    writeCache(cacheKey, merged);
    return merged;
  })();

  reviewsInflight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    reviewsInflight.delete(cacheKey);
  }
}

export function calculateMetrics(reviews = []) {
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

  return { total, positivePercent, averageRating, pending };
}

export function buildRatingBreakdown(reviews = []) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach((review) => {
    const rating = extractRating(review);
    if (rating && counts[rating] !== undefined) {
      counts[rating] += 1;
    }
  });
  const totalWithRating = Object.values(counts).reduce((a, b) => a + b, 0);
  const percents = {};
  Object.entries(counts).forEach(([key, value]) => {
    percents[key] = totalWithRating ? Math.round((value / totalWithRating) * 100) : 0;
  });
  return { counts, percents, totalWithRating };
}

export function buildTimeline(reviews = []) {
  const buckets = new Map();
  reviews.forEach((review) => {
    const created = normalizeTimestamp(review.createdAt || review.timestamp || review.date);
    const keyDate = created || new Date();
    const key = keyDate.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, count]) => ({ date, count }));
}

export function describeReview(review = {}) {
  const name = review.customerName || review.reviewerName || review.name || "Anonymous";
  const rating = extractRating(review);
  const message = review.message || review.text || review.reviewText || "";
  const createdAt = normalizeTimestamp(
    review.createdAt || review.timestamp || review.date || review.createdAtMs
  );
  return { ...review, displayName: name, rating, message, createdAt };
}
