import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
} from "./firebase-config.js";

export const PLAN_DETAILS = {
  starter: { label: "Starter", priceMonthly: 39 },
  growth: { label: "Growth", priceMonthly: 99 },
  pro_ai_suite: { label: "Pro AI Suite", priceMonthly: 149 },
};

let cachedProfile = null;
let cachedSubscription = null;
let cachedUser = null;

async function fetchProfile(uid) {
  const ref = doc(db, "businessProfiles", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: uid, ...snap.data() };
}

async function fetchSubscription(uid) {
  const ref = doc(db, "subscriptions", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { planId: "starter", status: "active", price: PLAN_DETAILS.starter.priceMonthly };
  }
  return { planId: "starter", status: "active", ...snap.data() };
}

export function listenForUser(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/auth.html";
      return;
    }

    cachedUser = user;

    if (!cachedProfile) {
      cachedProfile = await fetchProfile(user.uid);
    }

    if (!cachedSubscription) {
      cachedSubscription = await fetchSubscription(user.uid);
    }

    callback({ user, profile: cachedProfile, subscription: cachedSubscription });
  });
}

export function getCachedProfile() {
  return cachedProfile;
}

export function getCachedSubscription() {
  return cachedSubscription;
}

export function getCachedUser() {
  return cachedUser;
}

export async function refreshProfile() {
  if (!cachedUser) return null;
  cachedProfile = await fetchProfile(cachedUser.uid);
  return cachedProfile;
}

export async function refreshSubscription() {
  if (!cachedUser) return null;
  cachedSubscription = await fetchSubscription(cachedUser.uid);
  return cachedSubscription;
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
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
