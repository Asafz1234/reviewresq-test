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

async function collectSafe(builder, label, defaultSource = "canonical") {
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
    "businesses/{id}/feedback",
    "canonical"
  );

  const legacyRoot = includeLegacy
    ? await collectSafe(
        () => getDocs(query(collection(db, "feedback"), where("businessId", "==", businessId))),
        "feedback",
        "legacy"
      )
    : [];

  const legacyProfile = includeLegacy
    ? await collectSafe(
        () => getDocs(collection(db, "businessProfiles", businessId, "feedback")),
        "businessProfiles/{id}/feedback",
        "legacy"
      )
    : [];

  const legacy = [...legacyRoot, ...legacyProfile];

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
      "mergedCount",
      merged.length,
      "newestMs",
      newestTimestamp
    );
  }

  return sorted;
}
