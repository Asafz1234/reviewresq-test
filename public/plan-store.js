import { normalizePlan } from "./plan-capabilities.js";

const PLAN_CACHE_PREFIX = "rrPlanCache";
const PLAN_CACHE_LAST_KEY = `${PLAN_CACHE_PREFIX}:last`;

const store = {
  state: { planId: null, businessId: null, updatedAt: null, source: null },
  listeners: new Set()
};

function notify() {
  const snapshot = { ...store.state };
  store.listeners.forEach(l => l(snapshot));
}

function saveToStorage(planId, businessId) {
  try {
    const payload = JSON.stringify({ planId, businessId, timestamp: Date.now() });
    localStorage.setItem(PLAN_CACHE_LAST_KEY, payload);
    if (businessId) localStorage.setItem(`${PLAN_CACHE_PREFIX}:${businessId}`, payload);
    localStorage.setItem('userPlanId', planId); 
  } catch (e) {}
}

export function getPlanSnapshot() { return { ...store.state }; }

export function subscribePlan(listener) {
  store.listeners.add(listener);
  listener({ ...store.state });
  return () => store.listeners.delete(listener);
}

export function setCachedPlan(planId, businessId) {
  if (!planId) return;
  saveToStorage(planId, businessId);
}

export function setPlan(planId, { source = "manual", businessId } = {}) {
  const normalized = normalizePlan(planId);
  if (!normalized) return { ...store.state };
  
  store.state = { 
    planId: normalized, 
    businessId: businessId || store.state.businessId, 
    source, 
    updatedAt: Date.now() 
  };
  
  saveToStorage(normalized, businessId);
  notify();

  // CRITICAL FIX: Notify the global window so the UI (Badge) updates immediately
  if (typeof window !== "undefined") {
      window.navAccess = { plan: normalized, planPending: false };
      window.dispatchEvent(new CustomEvent('navaccess:planApplied', { 
          detail: { plan: normalized, source } 
      }));
  }

  return { ...store.state };
}

export function hydratePlanCache({ businessId } = {}) {
  try {
    const key = businessId ? `${PLAN_CACHE_PREFIX}:${businessId}` : PLAN_CACHE_LAST_KEY;
    const raw = localStorage.getItem(key) || localStorage.getItem(PLAN_CACHE_LAST_KEY);
    if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.planId) setPlan(parsed.planId, { source: 'cache', businessId: parsed.businessId });
    }
  } catch (e) {}
  return { ...store.state };
}

export function getEffectivePlan() { return Promise.resolve({ ...store.state }); }