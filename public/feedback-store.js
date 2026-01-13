import {
  addDoc,
  collection,
  db,
  getDocs,
  query,
  serverTimestamp,
  orderBy,
  limit,
  startAfter,
  where,
} from "./firebase-config.js";

const FEEDBACK_CACHE_TTL_MS = 60 * 1000;
const feedbackCache = new Map();
const feedbackInflight = new Map();
const isDevEnv =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

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

function resolveEnv(metadata = {}) {
  if (metadata.env) return metadata.env;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  return "unknown";
}

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

function dedupeFeedback(list = []) {
  const seen = new Set();
  const result = [];
  list.forEach((item) => {
    const createdMs = normalizeCreatedAtMs(item) || "";
    const key = item.id || `${item.businessId || ""}|${item.rating || ""}|${item.message || ""}|${createdMs}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function sortFeedback(list = []) {
  return [...list].sort((a, b) => {
    const aMs = normalizeCreatedAtMs(a) || 0;
    const bMs = normalizeCreatedAtMs(b) || 0;
    return bMs - aMs;
  });
}

function normalizeFeedbackItem(input = {}, defaultSource = "canonical") {
  const raw =
    typeof input?.data === "function" ? { id: input.id, ...input.data(), _sourcePath: input._sourcePath } : { ...input };

  const messageValue = raw.message ?? raw.text ?? "";
  const message = typeof messageValue === "string" ? messageValue : String(messageValue ?? "");

  const createdAtMs = normalizeCreatedAtMs(raw) ?? Date.now();

  return {
    ...raw,
    id: raw.id ?? input?.id ?? null,
    businessId: raw.businessId ?? null,
    rating: raw.rating ?? raw.score ?? null,
    message,
    createdAtMs,
    source: raw.source ?? defaultSource,
  };
}

export function buildFeedbackPayload(businessId, data = {}) {
  const rating = Number(data.rating || data.score || 0) || null;
  const createdAtMs = Date.now();
  return {
    businessId,
    rating,
    message: (data.message || data.text || "").trim(),
    customerName: data.customerName || data.name || null,
    customerEmail: data.customerEmail || data.contact || null,
    contact: data.contact || data.customerEmail || null,
    sentimentScore: Number(((Number(rating) || 0) - 3).toFixed(2)),
    type: "private",
    source: data.source || "portal",
    status: data.status || "new",
    createdAt: serverTimestamp(),
    createdAtMs,
    updatedAt: serverTimestamp(),
    writeVersion: data.writeVersion || "v2",
    env: resolveEnv(data),
    migratedFrom: data.migratedFrom || null,
  };
}

async function collectSafe(builder, label, defaultSource = "canonical", fallbackBuilder = null) {
  try {
    const snap = await builder();
    const docs = [];

    const pushNormalized = (entry) => {
      const normalized = normalizeFeedbackItem(entry, defaultSource);
      docs.push(normalized);
    };

    if (Array.isArray(snap)) {
      snap.forEach(pushNormalized);
      return docs;
    }

    if (Array.isArray(snap?.docs)) {
      snap.docs.forEach(pushNormalized);
      return docs;
    }

    if (typeof snap?.forEach === "function") {
      snap.forEach(pushNormalized);
      return docs;
    }

    console.warn(`[feedback-store] Unknown fetch result for ${label}`);
    return docs;
  } catch (err) {
    if (fallbackBuilder) {
      console.warn(`[feedback-store] Falling back for ${label}`, err);
      return collectSafe(fallbackBuilder, `${label}-fallback`, defaultSource, null);
    }
    console.warn(`[feedback-store] Failed to fetch ${label}`, err);
    return [];
  }
}

export async function submitFeedback(businessId, payload, { dualWriteLegacy = true } = {}) {
  if (!businessId) {
    throw new Error("Business id is required for feedback submission");
  }
  const canonicalRef = collection(db, "businesses", businessId, "feedback");
  const writes = [addDoc(canonicalRef, payload)];

  if (dualWriteLegacy) {
    writes.push(addDoc(collection(db, "feedback"), payload));
    writes.push(addDoc(collection(db, "businessProfiles", businessId, "feedback"), payload));
  }

  const results = await Promise.allSettled(writes);
  const [primaryResult, ...rest] = results;

  rest.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      console.warn(`[feedback-store] Legacy write ${index + 1} failed`, outcome.reason);
    }
  });

  if (primaryResult.status === "rejected") {
    throw primaryResult.reason;
  }

  return primaryResult.value;
}

function readCache(cacheKey) {
  const entry = feedbackCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > FEEDBACK_CACHE_TTL_MS) {
    feedbackCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function writeCache(cacheKey, data) {
  feedbackCache.set(cacheKey, { data, timestamp: Date.now() });
}

function buildFeedbackQuery(ref, { businessId, pageSize, startAfterMs, includeBusinessFilter }) {
  const constraints = [];
  if (includeBusinessFilter) {
    constraints.push(where("businessId", "==", businessId));
  }
  constraints.push(orderBy("createdAtMs", "desc"));
  if (Number.isFinite(startAfterMs)) {
    constraints.push(startAfter(startAfterMs));
  }
  constraints.push(limit(pageSize));
  return query(ref, ...constraints);
}

export async function fetchFeedbackForBusiness(
  businessId,
  { includeLegacy = true, logDebug = isDevEnv, pageSize = 200, startAfterMs = null } = {}
) {
  if (!businessId) return [];
  const cacheKey = JSON.stringify({
    businessId,
    includeLegacy,
    pageSize,
    startAfterMs,
  });
  const cached = readCache(cacheKey);
  if (cached) return cached;
  if (feedbackInflight.has(cacheKey)) return feedbackInflight.get(cacheKey);

  const canonicalRef = collection(db, "businesses", businessId, "feedback");
  const legacyRootRef = collection(db, "feedback");
  const legacyProfileRef = collection(db, "businessProfiles", businessId, "feedback");

  const canonicalQuery = () =>
    withTiming("[feedback] canonical fetch", () =>
      getDocs(buildFeedbackQuery(canonicalRef, { businessId, pageSize, startAfterMs, includeBusinessFilter: false }))
    );
  const canonicalFallback = () =>
    withTiming("[feedback] canonical fallback", () => getDocs(query(canonicalRef, limit(pageSize))));

  const legacyRootQuery = () =>
    withTiming("[feedback] legacy root fetch", () =>
      getDocs(
        buildFeedbackQuery(legacyRootRef, {
          businessId,
          pageSize,
          startAfterMs,
          includeBusinessFilter: true,
        })
      )
    );
  const legacyRootFallback = () =>
    withTiming("[feedback] legacy root fallback", () =>
      getDocs(query(legacyRootRef, where("businessId", "==", businessId), limit(pageSize)))
    );

  const legacyProfileQuery = () =>
    withTiming("[feedback] legacy profile fetch", () =>
      getDocs(buildFeedbackQuery(legacyProfileRef, { businessId, pageSize, startAfterMs, includeBusinessFilter: false }))
    );
  const legacyProfileFallback = () =>
    withTiming("[feedback] legacy profile fallback", () => getDocs(query(legacyProfileRef, limit(pageSize))));

  const fetchPromise = (async () => {
    const canonical = await collectSafe(
      canonicalQuery,
      "businesses/{id}/feedback",
      "canonical",
      canonicalFallback
    );

    const legacyRoot = includeLegacy
      ? await collectSafe(legacyRootQuery, "feedback", "legacy", legacyRootFallback)
      : [];

    const legacyProfile = includeLegacy
      ? await collectSafe(legacyProfileQuery, "businessProfiles/{id}/feedback", "legacy", legacyProfileFallback)
      : [];

    const legacy = [...legacyRoot, ...legacyProfile];

    const merged = dedupeFeedback([...canonical, ...legacy]);
    const sorted = sortFeedback(merged);

    if (logDebug && isDevEnv) {
      const newest = sorted[0];
      const newestTimestamp = normalizeCreatedAtMs(newest);
      console.log(
        "[feedback] businessId",
        businessId,
        "canonicalCount",
        canonical.length,
        "legacyCount",
        legacy.length,
        "mergedCount",
        merged.length,
        "newestMs",
        newestTimestamp
      );
    }

    writeCache(cacheKey, sorted);
    return sorted;
  })();

  feedbackInflight.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    feedbackInflight.delete(cacheKey);
  }
}
