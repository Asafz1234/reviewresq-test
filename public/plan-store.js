import { normalizePlan } from "./plan-capabilities.js";

const PLAN_CACHE_PREFIX = "rrPlanCache";
const PLAN_CACHE_LAST_KEY = `${PLAN_CACHE_PREFIX}:last`;
const DEFAULT_PLAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const globalStore = (() => {
  if (typeof window === "undefined") return null;
  if (!window.__rrPlanStore) {
    window.__rrPlanStore = {
      state: {
        planId: null,
        status: "idle",
        source: null,
        businessId: null,
        updatedAt: null,
      },
      listeners: new Set(),
      inFlight: null,
    };
  }
  return window.__rrPlanStore;
})();

const fallbackStore = {
  state: {
    planId: null,
    status: "idle",
    source: null,
    businessId: null,
    updatedAt: null,
  },
  listeners: new Set(),
  inFlight: null,
};

const store = globalStore || fallbackStore;

function getCacheKey(businessId) {
  if (businessId) return `${PLAN_CACHE_PREFIX}:${businessId}`;
  return PLAN_CACHE_LAST_KEY;
}

function readCache(businessId, maxAgeMs = DEFAULT_PLAN_MAX_AGE_MS) {
  if (typeof window === "undefined") return null;
  try {
    const key = getCacheKey(businessId);
    const raw = localStorage.getItem(key);
    if (!raw && businessId) {
      return readCache(null, maxAgeMs);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const planId = normalizePlan(parsed?.planId ?? parsed?.plan);
    if (!planId) return null;
    const timestamp = Number(parsed?.timestamp ?? parsed?.ts ?? null);
    if (Number.isFinite(timestamp) && maxAgeMs && Date.now() - timestamp > maxAgeMs) {
      return null;
    }
    return {
      planId,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      businessId: parsed?.businessId || businessId || null,
    };
  } catch (err) {
    return null;
  }
}

function writeCache(planId, businessId) {
  if (typeof window === "undefined" || !planId) return;
  const normalized = normalizePlan(planId);
  if (!normalized) return;
  const payload = {
    planId: normalized,
    businessId: businessId || null,
    timestamp: Date.now(),
  };
  try {
    if (businessId) {
      localStorage.setItem(getCacheKey(businessId), JSON.stringify(payload));
    }
    localStorage.setItem(PLAN_CACHE_LAST_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[plan-store] failed to write cache", err);
  }
}

function notify() {
  const snapshot = { ...store.state };
  store.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (err) {
      console.warn("[plan-store] listener failed", err);
    }
  });
}

export function getPlanSnapshot() {
  return { ...store.state };
}

export function subscribePlan(listener) {
  if (typeof listener !== "function") return () => {};
  store.listeners.add(listener);
  listener({ ...store.state });
  return () => store.listeners.delete(listener);
}

export function hydratePlanCache({ businessId, maxAgeMs } = {}) {
  if (store.state.planId) return { ...store.state };
  const cached = readCache(businessId, maxAgeMs);
  if (!cached?.planId) return { ...store.state };
  store.state = {
    ...store.state,
    planId: cached.planId,
    status: "ready",
    source: "cache",
    businessId: cached.businessId || businessId || null,
    updatedAt: cached.timestamp || Date.now(),
  };
  notify();
  return { ...store.state };
}

export function setPlan(planId, { source = "manual", businessId } = {}) {
  const normalized = normalizePlan(planId);
  if (!normalized) return { ...store.state };
  if (store.state.planId === normalized && store.state.businessId === businessId) {
    return { ...store.state };
  }
  store.state = {
    ...store.state,
    planId: normalized,
    status: "ready",
    source,
    businessId: businessId || store.state.businessId || null,
    updatedAt: Date.now(),
  };
  writeCache(normalized, businessId || store.state.businessId);
  notify();
  return { ...store.state };
}

export function markPlanPending() {
  store.state = {
    ...store.state,
    status: "loading",
  };
  notify();
}

export function getPlan({ businessId, fetchPlan, forceRefresh = false, maxAgeMs } = {}) {
  if (!forceRefresh) {
    hydratePlanCache({ businessId, maxAgeMs });
    if (store.state.planId) {
      return Promise.resolve({ ...store.state });
    }
  }

  if (store.inFlight) return store.inFlight;
  if (typeof fetchPlan !== "function") return Promise.resolve({ ...store.state });

  markPlanPending();
  store.inFlight = Promise.resolve(fetchPlan())
    .then((planId) => {
      store.inFlight = null;
      if (planId) {
        return setPlan(planId, { source: "fetch", businessId });
      }
      store.state = {
        ...store.state,
        status: "idle",
      };
      notify();
      return { ...store.state };
    })
    .catch((err) => {
      store.inFlight = null;
      store.state = {
        ...store.state,
        status: "error",
      };
      notify();
      console.warn("[plan-store] fetch failed", err);
      return { ...store.state, error: err };
    });

  return store.inFlight;
}

export function clearPlan() {
  store.state = {
    planId: null,
    status: "idle",
    source: null,
    businessId: null,
    updatedAt: null,
  };
  store.inFlight = null;
  notify();
}
