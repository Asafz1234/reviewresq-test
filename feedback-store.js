import {
  addDoc,
  collection,
  db,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "./firebase-config.js";

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

async function collectSafe(builder, label) {
  try {
    const snap = await builder();
    const docs = [];
    snap.forEach((docSnap) => docs.push({ id: docSnap.id, ...docSnap.data(), _sourcePath: label }));
    return docs;
  } catch (err) {
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

export async function fetchFeedbackForBusiness(businessId, { includeLegacy = true, logDebug = true } = {}) {
  if (!businessId) return [];
  const canonical = await collectSafe(
    () => getDocs(collection(db, "businesses", businessId, "feedback")),
    "businesses/{id}/feedback"
  );

  const legacy = includeLegacy
    ? await collectSafe(
        () =>
          Promise.all([
            getDocs(query(collection(db, "feedback"), where("businessId", "==", businessId))),
            getDocs(collection(db, "businessProfiles", businessId, "feedback")),
          ]).then(([rootSnap, profileSnap]) => {
            const combined = [];
            rootSnap.forEach((docSnap) => combined.push({ id: docSnap.id, ...docSnap.data(), _sourcePath: "feedback" }));
            profileSnap.forEach((docSnap) =>
              combined.push({ id: docSnap.id, ...docSnap.data(), _sourcePath: "businessProfiles/{id}/feedback" })
            );
            return combined;
          }),
        "legacy"
      )
    : [];

  const merged = dedupeFeedback([...canonical, ...legacy]);
  const sorted = sortFeedback(merged);

  if (logDebug) {
    const newest = sorted[0];
    const newestTimestamp = normalizeCreatedAtMs(newest);
    console.log(
      "[feedback] businessId",
      businessId,
      "canonicalCount",
      canonical.length,
      "legacyCount",
      legacy.length,
      "newestMs",
      newestTimestamp
    );
  }

  return sorted;
}
