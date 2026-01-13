import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
} from "./firebase-config.js";
import {
  PLAN_LABELS,
  normalizePlan,
  hasFeature,
  getPlanEntitlements,
} from "./plan-capabilities.js";

const DEFAULT_BRAND_COLOR = "#2563EB";
const DEFAULT_SUPPORT_EMAIL = "support@reviewresq.com";

export const PLAN_DETAILS = {
  starter: { label: PLAN_LABELS.starter, priceMonthly: 39 },
  growth: { label: PLAN_LABELS.growth, priceMonthly: 99 },
};

const PLAN_CACHE_KEY = "rrPlanCache";
const PLAN_CACHE_TS_KEY = "timestamp";

let cachedProfile = null;
let cachedSubscription = null;
let cachedBusiness = null;
let cachedUser = null;

const isDevEnv =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

function logBootstrapPending() {
  if (!isDevEnv || typeof window === "undefined") return;
  if (window.__rrBootstrapPendingLogged) return;
  console.debug("[rr] bootstrap pending");
  window.__rrBootstrapPendingLogged = true;
}

function logBootstrapResolved(planId) {
  if (!isDevEnv || typeof window === "undefined") return;
  if (window.__rrBootstrapResolvedLogged) return;
  console.debug(`[rr] bootstrap resolved ${planId}`);
  window.__rrBootstrapResolvedLogged = true;
}

const globalPlanState = (() => {
  if (typeof window === "undefined") return null;
  if (!window.__rrPlanState) {
    window.__rrPlanState = {
      planPromise: null,
      planPromiseResolve: null,
      planPromiseReject: null,
      planResolved: null,
      planBootstrapPromise: null,
      planBootstrapResolve: null,
      planBootstrapResolved: null,
    };
  }
  return window.__rrPlanState;
})();

let planPromise = globalPlanState?.planPromise ?? null;
let planPromiseResolve = globalPlanState?.planPromiseResolve ?? null;
let planPromiseReject = globalPlanState?.planPromiseReject ?? null;
let planResolved = globalPlanState?.planResolved ?? null;
let planBootstrapPromise = globalPlanState?.planBootstrapPromise ?? null;
let planBootstrapResolve = globalPlanState?.planBootstrapResolve ?? null;
let planBootstrapResolved = globalPlanState?.planBootstrapResolved ?? null;

function normalizePlanId(planId) {
  if (planId === null || planId === undefined) return null;
  const raw = String(planId).trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  const knownToken =
    lowered.includes("starter") ||
    lowered.includes("growth") ||
    lowered.includes("pro") ||
    lowered.includes("advanced");
  if (!knownToken) return null;
  return normalizePlan(raw);
}

function syncPlanState() {
  if (!globalPlanState) return;
  globalPlanState.planPromise = planPromise;
  globalPlanState.planPromiseResolve = planPromiseResolve;
  globalPlanState.planPromiseReject = planPromiseReject;
  globalPlanState.planResolved = planResolved;
  globalPlanState.planBootstrapPromise = planBootstrapPromise;
  globalPlanState.planBootstrapResolve = planBootstrapResolve;
  globalPlanState.planBootstrapResolved = planBootstrapResolved;
}

function hydratePlanState() {
  if (!globalPlanState) return;
  planPromise ??= globalPlanState.planPromise ?? null;
  planPromiseResolve ??= globalPlanState.planPromiseResolve ?? null;
  planPromiseReject ??= globalPlanState.planPromiseReject ?? null;
  planResolved ??= globalPlanState.planResolved ?? null;
  planBootstrapPromise ??= globalPlanState.planBootstrapPromise ?? null;
  planBootstrapResolve ??= globalPlanState.planBootstrapResolve ?? null;
  planBootstrapResolved ??= globalPlanState.planBootstrapResolved ?? null;
}

function resolveLogo(profile = {}) {
  return (
    profile.branding?.logoUrl ||
    profile.logoUrl ||
    profile.logoURL ||
    profile.businessLogoUrl ||
    profile.brandLogoUrl ||
    ""
  );
}

export function deriveBranding(profile = {}) {
  const branding = profile.branding || {};
  const rawBusinessName =
    branding.name ||
    branding.displayName ||
    profile.businessName ||
    profile.displayName ||
    profile.name ||
    "";
  const rawSenderName = branding.senderName || rawBusinessName || "";
  const brandColor =
    branding.color ||
    profile.brandColor ||
    branding.primaryColor ||
    DEFAULT_BRAND_COLOR;
  const supportEmail = (branding.supportEmail || DEFAULT_SUPPORT_EMAIL).toString().trim().toLowerCase();

  const businessName = (rawBusinessName || "Your business").toString().trim() || "Your business";
  const senderName = (rawSenderName || businessName).toString().trim() || businessName;

  return {
    businessName,
    senderName,
    brandColor: (brandColor || DEFAULT_BRAND_COLOR).toString().trim() || DEFAULT_BRAND_COLOR,
    supportEmail: supportEmail || DEFAULT_SUPPORT_EMAIL,
    logoUrl: resolveLogo(profile),
    complete: Boolean(rawBusinessName && rawSenderName),
  };
}

export function isBrandingComplete(profile = {}) {
  return deriveBranding(profile).complete;
}

async function fetchProfile(uid) {
  const ref = doc(db, "businessProfiles", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: uid, ...snap.data() };
}

async function fetchBusiness(uid) {
  const ref = doc(db, "businesses", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { id: uid };
  const data = snap.data() || {};
  const normalizedPlan = normalizePlanId(data.plan);
  return { id: uid, ...data, plan: normalizedPlan };
}

function shouldBypassBrandingGate() {
  if (typeof window === "undefined") return true;
  const path = window.location.pathname || "";
  return (
    path.includes("business-settings") ||
    path.includes("onboarding") ||
    path.includes("ask-reviews") ||
    path.includes("auth") ||
    path.includes("oauth")
  );
}

function redirectToBrandingSetup() {
  if (typeof window === "undefined") return;
  const redirectUrl = new URL("/business-settings.html", window.location.origin);
  redirectUrl.searchParams.set("return", "dashboard");
  window.location.href = redirectUrl.toString();
}

async function fetchSubscription(uid) {
  const ref = doc(db, "subscriptions", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { planId: null, status: "inactive" };
  }
  const data = snap.data() || {};
  const normalizedPlan = normalizePlanId(data.planId);
  return { ...data, planId: normalizedPlan, status: data.status || "active" };
}

function isPlanDebugEnabled() {
  try {
    return localStorage.getItem("rrDebugPlan") === "1";
  } catch (err) {
    return false;
  }
}

function debugPlanCache(message, data = {}) {
  if (typeof window === "undefined") return;
  if (!isPlanDebugEnabled()) return;
  console.log("[plan-cache]", message, data);
}

function getCacheAgeMs(cache, maxAgeMs) {
  if (!cache?.timestamp || !Number.isFinite(cache.timestamp)) return null;
  const ageMs = Date.now() - cache.timestamp;
  if (!Number.isFinite(ageMs)) return null;
  if (Number.isFinite(maxAgeMs) && ageMs > maxAgeMs) return null;
  return ageMs;
}

function readPlanCache() {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(PLAN_CACHE_KEY);
    if (!cached) return null;
    try {
      const parsed = JSON.parse(cached);
      const planId = normalizePlanId(parsed?.planId ?? parsed?.plan);
      if (!planId) return null;
      const timestamp = Number(parsed?.[PLAN_CACHE_TS_KEY] ?? parsed?.ts ?? parsed?.timestamp);
      return {
        planId,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
      };
    } catch (err) {
      const planId = normalizePlanId(cached);
      return planId ? { planId, timestamp: null } : null;
    }
  } catch (err) {
    console.warn("[session-data] unable to read cached plan", err);
    return null;
  }
}

export function getCachedPlan() {
  const cache = readPlanCache();
  if (!cache?.planId) return null;
  debugPlanCache("read", { planId: cache.planId, timestamp: cache.timestamp });
  return cache.planId;
}

export function setCachedPlan(planId) {
  if (!planId || typeof window === "undefined") return;
  try {
    const normalized = normalizePlan(planId);
    const existing = readPlanCache();
    if (existing?.planId && existing.planId === normalized) {
      debugPlanCache("write-skip", { planId: normalized });
      return;
    }
    const payload = {
      planId: normalized,
      [PLAN_CACHE_TS_KEY]: Date.now(),
    };
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(payload));
    debugPlanCache("write", payload);
  } catch (err) {
    console.warn("[session-data] unable to cache plan", err);
  }
}

function resolvePlanPromise(planId, source = "auth") {
  hydratePlanState();
  const normalized = normalizePlanId(planId);
  if (!normalized) {
    debugPlanCache("resolve-skip", { source });
    return null;
  }
  if (planResolved?.planId && planResolved.planId === normalized) {
    debugPlanCache("resolve-skip-same", { source, planId: normalized });
    return planResolved;
  }
  const payload = { planId: normalized, source };
  planResolved = payload;
  if (planPromiseResolve) {
    planPromiseResolve(payload);
    planPromiseResolve = null;
    planPromiseReject = null;
  }
  planPromise = Promise.resolve(payload);
  if (source !== "cache") {
    planBootstrapResolved = payload;
    if (planBootstrapResolve) {
      planBootstrapResolve(payload);
      planBootstrapResolve = null;
    }
    planBootstrapPromise = Promise.resolve(payload);
    logBootstrapResolved(payload.planId);
  }
  syncPlanState();
  debugPlanCache("resolved", payload);
  return payload;
}

function ensurePlanPromise() {
  hydratePlanState();
  if (!planPromise) {
    planPromise = new Promise((resolve, reject) => {
      planPromiseResolve = resolve;
      planPromiseReject = reject;
    });
    syncPlanState();
  }
  return planPromise;
}

function ensurePlanBootstrapPromise() {
  hydratePlanState();
  if (!planBootstrapPromise) {
    planBootstrapPromise = new Promise((resolve) => {
      planBootstrapResolve = resolve;
    });
    logBootstrapPending();
    syncPlanState();
  }
  return planBootstrapPromise;
}

export function getEffectivePlan({ forceRefresh = false, maxAgeMs = 5 * 60 * 1000 } = {}) {
  hydratePlanState();
  if (!forceRefresh && planResolved?.planId) {
    debugPlanCache("effective-resolved", planResolved);
    return Promise.resolve(planResolved);
  }

  const cache = !forceRefresh ? readPlanCache() : null;
  const cacheAgeMs = getCacheAgeMs(cache, maxAgeMs);
  if (cache?.planId && cacheAgeMs !== null) {
    const payload = resolvePlanPromise(cache.planId, "cache");
    if (payload?.planId) {
      debugPlanCache("effective-hit", {
        planId: payload.planId,
        ageMs: cacheAgeMs,
        maxAgeMs,
      });
      return Promise.resolve(payload);
    }
  }

  if (forceRefresh) {
    planPromise = null;
    planPromiseResolve = null;
    planPromiseReject = null;
    planResolved = null;
    syncPlanState();
  }

  debugPlanCache("effective-pending", { forceRefresh });
  return Promise.resolve(ensurePlanPromise());
}

export function getEffectivePlanPromise(options = {}) {
  const resolved = getEffectivePlan(options);
  if (resolved && typeof resolved.then === "function") {
    return resolved.then((payload) => {
      if (payload?.planId) return payload;
      return ensurePlanPromise();
    });
  }
  return ensurePlanPromise();
}

export function getPlanBootstrapPromise() {
  hydratePlanState();
  if (planBootstrapResolved?.planId) {
    return Promise.resolve(planBootstrapResolved);
  }
  return ensurePlanBootstrapPromise();
}

export function hasPlanBootstrapResolved() {
  hydratePlanState();
  return Boolean(planBootstrapResolved?.planId);
}

export function getPlanBootstrapResolved() {
  hydratePlanState();
  return planBootstrapResolved;
}

export function listenForUser(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/auth.html";
      return;
    }

    cachedUser = user;

    if (!cachedProfile) {
      cachedProfile = (await fetchProfile(user.uid)) || { id: user.uid };
    }

    if (!cachedSubscription) {
      cachedSubscription = await fetchSubscription(user.uid);
    }

    if (!cachedBusiness) {
      cachedBusiness = (await fetchBusiness(user.uid)) || { id: user.uid };
    }

    const resolvedPlan = normalizePlanId(cachedBusiness?.plan || cachedSubscription?.planId);
    if (resolvedPlan) {
      cachedSubscription = { ...cachedSubscription, planId: resolvedPlan };
      cachedBusiness = { ...cachedBusiness, plan: resolvedPlan };
      setCachedPlan(resolvedPlan);
      resolvePlanPromise(resolvedPlan, "auth");
    }

    const brandingState = deriveBranding(cachedProfile || {});
    cachedProfile = { ...cachedProfile, brandingComplete: brandingState.complete, brandingState };

    if (!brandingState.complete && !shouldBypassBrandingGate()) {
      redirectToBrandingSetup();
      return;
    }

    callback({
      user,
      profile: cachedProfile,
      subscription: cachedSubscription,
      branding: brandingState,
      business: cachedBusiness,
    });
  });
}

export function getCachedProfile() {
  return cachedProfile;
}

export function getCachedSubscription() {
  if (!cachedSubscription) return null;
  return { ...cachedSubscription, planId: normalizePlanId(cachedSubscription.planId) };
}

export function getCachedBusiness() {
  if (!cachedBusiness) return null;
  return { ...cachedBusiness, plan: normalizePlanId(cachedBusiness.plan) };
}

export function getCachedUser() {
  return cachedUser;
}

export async function refreshProfile() {
  if (!cachedUser) return null;
  cachedProfile = (await fetchProfile(cachedUser.uid)) || { id: cachedUser.uid };
  const brandingState = deriveBranding(cachedProfile || {});
  cachedProfile = { ...cachedProfile, brandingComplete: brandingState.complete, brandingState };
  return cachedProfile;
}

export async function refreshSubscription() {
  if (!cachedUser) return null;
  cachedSubscription = await fetchSubscription(cachedUser.uid);
  const normalizedPlan = normalizePlanId(cachedBusiness?.plan || cachedSubscription?.planId);
  if (normalizedPlan) {
    cachedSubscription = { ...cachedSubscription, planId: normalizedPlan };
    setCachedPlan(normalizedPlan);
    resolvePlanPromise(normalizedPlan, "subscription");
  }
  return cachedSubscription;
}

export async function refreshBusiness() {
  if (!cachedUser) return null;
  cachedBusiness = (await fetchBusiness(cachedUser.uid)) || { id: cachedUser.uid };
  const normalizedPlan = normalizePlanId(cachedBusiness.plan);
  cachedBusiness = { ...cachedBusiness, plan: normalizedPlan };
  if (cachedSubscription && normalizedPlan) {
    cachedSubscription = { ...cachedSubscription, planId: normalizedPlan };
  }
  if (normalizedPlan) {
    setCachedPlan(normalizedPlan);
    resolvePlanPromise(normalizedPlan, "business");
  }
  return cachedBusiness;
}

export async function updateBusinessPlan(planId) {
  if (!cachedUser) return null;
  const normalizedPlan = normalizePlanId(planId);
  if (!normalizedPlan) return null;
  const ref = doc(db, "businesses", cachedUser.uid);
  await setDoc(ref, { plan: normalizedPlan }, { merge: true });
  cachedBusiness = { ...(cachedBusiness || { id: cachedUser.uid }), plan: normalizedPlan };
  cachedSubscription = { ...(cachedSubscription || {}), planId: normalizedPlan };
  setCachedPlan(normalizedPlan);
  resolvePlanPromise(normalizedPlan, "update");
  return normalizedPlan;
}

export function currentPlanTier() {
  if (cachedBusiness?.plan) return normalizePlan(cachedBusiness.plan);
  if (cachedSubscription?.planId) return normalizePlan(cachedSubscription.planId);
  return null;
}

export function currentEntitlements(planId = null) {
  const resolvedPlan = planId || cachedBusiness?.plan || cachedSubscription?.planId;
  if (!resolvedPlan) return null;
  return getPlanEntitlements(resolvedPlan);
}

export function isStarterPlan(planId) {
  const normalized = String(planId ?? currentPlanTier() ?? "")
    .toLowerCase()
    .trim();

  return (
    normalized === "starter" ||
    normalized.startsWith("starter") ||
    normalized.includes("starter")
  );
}

export function hasPlanFeature(feature) {
  const planId = currentPlanTier();
  if (!planId) return false;
  return hasFeature(planId, feature);
}

export function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "RR";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

export function formatDate(value) {
  if (!value) return "—";
  const date = value.toDate ? value.toDate() : new Date(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
