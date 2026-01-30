import { db, auth } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { setPlan as setPlanStore, hydratePlanCache, setCachedPlan, getEffectivePlan as getStorePlan } from "./plan-store.js";

const DEFAULT_BRAND_COLOR = "#2563EB";
let cachedProfile = null;
let cachedUser = null;

let bootstrapResolver = null;
const planBootstrapPromise = new Promise((resolve) => { bootstrapResolver = resolve; });

async function fetchDoc(collection, uid) {
  try {
    const snap = await getDoc(doc(db, collection, uid));
    return snap.exists() ? { id: uid, ...snap.data() } : null;
  } catch (e) { return null; }
}

export function deriveBranding(profile = {}) {
  return {
    businessName: profile.businessName || profile.name || "Your Business",
    logoUrl: profile.logoUrl || profile.branding?.logoUrl || "",
    brandColor: profile.brandColor || DEFAULT_BRAND_COLOR
  };
}

export function listenForUser(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (!window.location.pathname.includes('auth.html')) window.location.href = "/auth.html";
      return;
    }
    cachedUser = user;

    hydratePlanCache({ businessId: user.uid });

    const [profile, business, sub] = await Promise.all([
        fetchDoc("businessProfiles", user.uid),
        fetchDoc("businesses", user.uid),
        fetchDoc("subscriptions", user.uid)
    ]);

    cachedProfile = profile || { id: user.uid };
    
    const finalPlan = business?.plan || sub?.planId;

    setPlanStore(finalPlan, { 
        source: 'fresh', 
        businessId: user.uid 
    });

    if (bootstrapResolver) { 
        bootstrapResolver({ planId: finalPlan, user, profile: cachedProfile }); 
        bootstrapResolver = null; 
    }

    if (callback) callback({ user, profile: cachedProfile, plan: finalPlan });
  });
}

export function getPlanBootstrapPromise() { return planBootstrapPromise; }
export function getEffectivePlan() { return getStorePlan(); }
export { cachedUser, cachedProfile };