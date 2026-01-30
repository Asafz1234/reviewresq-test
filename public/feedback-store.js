
// Import the initialized db instance
import { db } from "./firebase-config.js";
// Import Firestore functions directly from the CDN
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const FEEDBACK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PREFIX = "feedbackStore";
const feedbackInflight = new Map();

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
    if (Date.now() - timestamp > FEEDBACK_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return data;
  } catch (error) {
    console.warn(`[Cache] Failed to read from feedback cache for key: ${key}`, error);
    return null;
  }
}

function writeToCache(key, data) {
  const cacheKey = getCacheKey(key);
  try {
    const payload = JSON.stringify({ data, timestamp: Date.now() });
    localStorage.setItem(cacheKey, payload);
  } catch (error) {
    console.warn(`[Cache] Failed to write to feedback cache for key: ${key}`, error);
  }
}

// --- Utility Functions ---

function normalizeCreatedAtMs(doc = {}) {
  const createdAt = doc.createdAt;
  if (createdAt?.toMillis) return createdAt.toMillis();
  if (typeof createdAt === "number") return createdAt;
  if (doc.createdAtMs) return doc.createdAtMs;
  if (createdAt) {
    const parsed = Date.parse(createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function dedupeAndSortFeedback(list = []) {
  const seen = new Map();
  list.forEach((item) => {
    const createdMs = normalizeCreatedAtMs(item) || "";
    // Prefer canonical ID, but create a composite key for items without one
    const key = item.id || `${item.businessId || ""}|${item.rating || ""}|${item.message || ""}|${createdMs}`;
    // Always prefer the canonical source if a duplicate is found
    if (!seen.has(key) || item.source === "canonical") {
        seen.set(key, item);
    }
  });
  return Array.from(seen.values()).sort((a, b) => {
    const aMs = normalizeCreatedAtMs(a) || 0;
    const bMs = normalizeCreatedAtMs(b) || 0;
    return bMs - aMs;
  });
}

function normalizeFeedbackItem(input = {}, defaultSource) {
  const raw = typeof input?.data === "function" ? { id: input.id, ...input.data() } : { ...input };
  return {
    ...raw,
    id: raw.id ?? input?.id ?? null,
    businessId: raw.businessId ?? null,
    rating: raw.rating ?? raw.score ?? null,
    message: String(raw.message ?? raw.text ?? ""),
    createdAtMs: normalizeCreatedAtMs(raw) ?? Date.now(),
    source: raw.source ?? defaultSource,
  };
}

// --- Public API ---

export function buildFeedbackPayload(businessId, data = {}) {
  const rating = Number(data.rating || data.score || 0) || null;
  return {
    businessId,
    rating,
    message: (data.message || data.text || "").trim(),
    customerName: data.customerName || data.name || null,
    customerEmail: data.customerEmail || data.contact || null,
    sentimentScore: rating ? Number((rating - 3).toFixed(2)) : null,
    type: "private",
    source: data.source || "portal",
    status: data.status || "new",
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    updatedAt: serverTimestamp(),
    writeVersion: "v2",
    env: (data.env || (typeof window !== 'undefined' && window.location?.hostname) || 'unknown'),
  };
}

export async function submitFeedback(businessId, payload) {
  if (!businessId) {
    throw new Error("[Feedback] Business ID is required for submission.");
  }

  const writes = [];
  // Canonical write
  writes.push(addDoc(collection(db, "businesses", businessId, "feedback"), payload));
  // Legacy writes for backwards compatibility
  writes.push(addDoc(collection(db, "feedback"), payload));
  writes.push(addDoc(collection(db, "businessProfiles", businessId, "feedback"), payload));

  try {
    const results = await Promise.allSettled(writes);
    const primaryResult = results[0];

    if (primaryResult.status === "rejected") {
        console.error("[Feedback] Primary write failed!", primaryResult.reason);
        // Re-throw the main error to signal submission failure
        throw primaryResult.reason;
    }
    
    // Log failures for legacy writes but don't treat them as a critical failure
    results.slice(1).forEach((outcome, index) => {
        if (outcome.status === "rejected") {
            console.warn(`[Feedback] Legacy write #${index + 1} failed.`, outcome.reason);
        }
    });

    return primaryResult.value; // Return the result of the primary write

  } catch (error) {
    console.error("[Feedback] An unexpected error occurred during submission.", error);
    throw error;
  }
}


async function _fetchCollection(
  ref,
  { businessId, pageSize, startAfterMs, includeBusinessFilter = false },
  source
) {
  try {
    const constraints = [orderBy("createdAtMs", "desc"), limit(pageSize)];
    if (includeBusinessFilter) {
      constraints.unshift(where("businessId", "==", businessId));
    }
    if (Number.isFinite(startAfterMs)) {
      constraints.push(startAfter(startAfterMs));
    }
    const q = query(ref, ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => normalizeFeedbackItem(doc, source));
  } catch (error) {
    console.error(`[Feedback] Failed to fetch from ${source} collection:`, error);
    return [];
  }
}

export async function fetchFeedbackForBusiness(
  businessId,
  { includeLegacy = true, pageSize = 200, startAfterMs = null, forceRefresh = false } = {}
) {
  if (!businessId) return [];

  const cacheKey = JSON.stringify({ businessId, includeLegacy, pageSize, startAfterMs });
  const inflight = feedbackInflight.get(cacheKey);
  if (inflight) return inflight;
  
  if (!forceRefresh) {
      const cached = readFromCache(cacheKey);
      if (cached) return cached;
  }

  const fetchPromise = (async () => {
    const collections = [
      // Canonical collection
      _fetchCollection(
        collection(db, "businesses", businessId, "feedback"),
        { businessId, pageSize, startAfterMs },
        "canonical"
      ),
    ];

    if (includeLegacy) {
      // Legacy root collection
      collections.push(
        _fetchCollection(
          collection(db, "feedback"),
          { businessId, pageSize, startAfterMs, includeBusinessFilter: true },
          "legacy"
        )
      );
      // Legacy profile collection
      collections.push(
        _fetchCollection(
          collection(db, "businessProfiles", businessId, "feedback"),
          { businessId, pageSize, startAfterMs },
          "legacy"
        )
      );
    }

    const results = await Promise.all(collections);
    const merged = [].concat(...results);
    const final = dedupeAndSortFeedback(merged);

    writeToCache(cacheKey, final);
    return final;
  })();

  feedbackInflight.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    feedbackInflight.delete(cacheKey);
  }
}
