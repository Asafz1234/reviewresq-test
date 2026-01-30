
// Import initialized instances
import { db } from "./firebase-config.js";
// Import Firestore SDK functions directly
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { listenForUser } from "./session-data.js";
import { fetchFeedbackForBusiness } from "./feedback-store.js";

const REVIEWS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = "dashboardData";
const reviewsInflight = new Map();

// --- Cache Abstraction ---

function getCacheKey(key) {
  return `${CACHE_PREFIX}:${key}`;
}

function readFromCache(key) {
  const cacheKey = getCacheKey(key);
  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > REVIEWS_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return data;
  } catch (error) {
    console.warn(`[Cache] Failed to read from cache for key: ${key}`, error);
    return null;
  }
}

function writeToCache(key, data) {
  const cacheKey = getCacheKey(key);
  try {
    const payload = JSON.stringify({ data, timestamp: Date.now() });
    localStorage.setItem(cacheKey, payload);
  } catch (error) {
    console.warn(`[Cache] Failed to write to cache for key: ${key}`, error);
  }
}

// --- Data Fetching ---

async function fetchGoogleReviews(businessId, { pageSize, startAfterValue }) {
  try {
    const constraints = [
      where("businessId", "==", businessId),
      orderBy("createdAt", "desc"),
      limit(pageSize),
    ];
    if (startAfterValue) {
      constraints.push(startAfter(startAfterValue));
    }
    const q = query(collection(db, "googleReviews"), ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      source: "google",
    }));
  } catch (error) {
    console.error("[Data] Failed to fetch Google Reviews", error);
    return []; // Return an empty array on failure
  }
}

export async function fetchAllReviews(
  businessId,
  { pageSize = 200, startAfterValue = null, forceRefresh = false } = {}
) {
  if (!businessId) return [];

  const cacheKey = JSON.stringify({
    businessId,
    pageSize,
    startAfterValue,
  });
  const inflight = reviewsInflight.get(cacheKey);
  if (inflight) return inflight;

  if (!forceRefresh) {
    const cached = readFromCache(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const fetchPromise = (async () => {
    const [feedback, googleReviews] = await Promise.all([
      fetchFeedbackForBusiness(businessId, {
        pageSize,
        startAfterMs: null,
      }),
      fetchGoogleReviews(businessId, { pageSize, startAfterValue }),
    ]);

    const merged = [
      ...feedback.map((item) => ({ ...item, source: item.source || "feedback" })),
      ...googleReviews,
    ];

    writeToCache(cacheKey, merged);
    return merged;
  })();

  reviewsInflight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    reviewsInflight.delete(cacheKey);
  }
}

// --- Data Transformation and Metrics ---

function normalizeTimestamp(raw) {
  if (!raw) return null;
  if (raw.toDate) return raw.toDate();
  if (typeof raw === 'number' || typeof raw === 'string') {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function extractRating(raw = {}) {
  const rating = Number(raw.rating ?? raw.score ?? raw.ratingValue ?? 0);
  return Number.isFinite(rating) && rating > 0 ? rating : null;
}

function extractSentiment(raw = {}) {
    if (typeof raw.sentimentScore === "number") return raw.sentimentScore;
    const rating = extractRating(raw);
    if (rating === null) return null;
    // Simple sentiment: 5-star scale to -2 to 2
    return Number((rating - 3).toFixed(2));
}

function normalizeStatus(raw = {}) {
    return (raw.status || "open").toString().toLowerCase();
}

export function calculateMetrics(reviews = []) {
  if (!reviews || reviews.length === 0) {
    return { total: 0, positivePercent: 0, averageRating: null, pending: 0 };
  }

  const metrics = reviews.reduce(
    (acc, review) => {
      const rating = extractRating(review);
      const sentiment = extractSentiment(review);
      const status = normalizeStatus(review);

      if (rating !== null) {
        acc.ratingSum += rating;
        acc.ratingCount += 1;
        if (rating >= 4) {
          acc.positive += 1;
        }
      } else if (typeof sentiment === 'number' && sentiment > 0) {
        acc.positive += 1;
      }
      
      if (status !== "resolved" && status !== "closed" && status !== "done") {
        acc.pending += 1;
      }

      return acc;
    },
    { total: reviews.length, positive: 0, pending: 0, ratingSum: 0, ratingCount: 0 }
  );

  const averageRating = metrics.ratingCount > 0 ? metrics.ratingSum / metrics.ratingCount : null;
  const positivePercent = metrics.total > 0 ? Math.round((metrics.positive / metrics.total) * 100) : 0;

  return {
    total: metrics.total,
    positivePercent,
    averageRating,
    pending: metrics.pending,
  };
}

export function buildRatingBreakdown(reviews = []) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalWithRating = 0;

    reviews.forEach((review) => {
        const rating = extractRating(review);
        if (rating && counts[rating] !== undefined) {
            counts[rating]++;
            totalWithRating++;
        }
    });

    const percents = Object.entries(counts).reduce((acc, [key, value]) => {
        acc[key] = totalWithRating > 0 ? Math.round((value / totalWithRating) * 100) : 0;
        return acc;
    }, {});

    return { counts, percents, totalWithRating };
}


export function buildTimeline(reviews = []) {
  const buckets = new Map();
  reviews.forEach((review) => {
    const created = normalizeTimestamp(
      review.createdAt || review.timestamp || review.date
    );
    if (created) {
        const key = created.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

export function describeReview(review = {}) {
    const name = review.customerName || review.reviewerName || review.name || "Anonymous";
    const rating = extractRating(review);
    const message = review.message || review.text || review.reviewText || "";
    const createdAt = normalizeTimestamp(review.createdAt || review.timestamp || review.date || review.createdAtMs);
    
    return {
        ...review,
        displayName: name,
        rating,
        message,
        createdAt
    };
}

export { listenForUser as onSession };
