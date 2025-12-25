import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
} from "./firebase-config.js";
import { PLAN_LABELS, normalizePlan, hasFeature } from "./plan-capabilities.js";

const DEFAULT_BRAND_COLOR = "#2563EB";
const DEFAULT_SUPPORT_EMAIL = "support@reviewresq.com";

export const PLAN_DETAILS = {
  starter: { label: PLAN_LABELS.starter, priceMonthly: 39 },
  growth: { label: PLAN_LABELS.growth, priceMonthly: 99 },
  pro_ai: { label: PLAN_LABELS.pro_ai, priceMonthly: 149 },
  // Support legacy plan ids
  pro_ai_suite: { label: PLAN_LABELS.pro_ai, priceMonthly: 149 },
};

let cachedProfile = null;
let cachedSubscription = null;
let cachedUser = null;

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
    return { planId: "starter", status: "active", price: PLAN_DETAILS.starter.priceMonthly };
  }
  return { planId: normalizePlan(snap.data().planId || "starter"), status: "active", ...snap.data() };
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

    const brandingState = deriveBranding(cachedProfile || {});
    cachedProfile = { ...cachedProfile, brandingComplete: brandingState.complete, brandingState };

    if (!brandingState.complete && !shouldBypassBrandingGate()) {
      redirectToBrandingSetup();
      return;
    }

    callback({ user, profile: cachedProfile, subscription: cachedSubscription, branding: brandingState });
  });
}

export function getCachedProfile() {
  return cachedProfile;
}

export function getCachedSubscription() {
  if (!cachedSubscription) return null;
  return { ...cachedSubscription, planId: normalizePlan(cachedSubscription.planId) };
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
  return cachedSubscription;
}

export function currentPlanTier() {
  if (cachedSubscription?.planId) return normalizePlan(cachedSubscription.planId);
  return "starter";
}

export function hasPlanFeature(feature) {
  return hasFeature(currentPlanTier(), feature);
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
