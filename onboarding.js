import { app } from "./firebase-config.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  renderGoogleConnect,
  refetchProfileAfterConnect,
  connectPlaceOnBackend,
} from "./google-connect.js";

const auth = getAuth(app);
const db = getFirestore(app);

const businessNameInput = document.getElementById("business-name");
const saveBtn = document.getElementById("save-and-continue");
const skipBtn = document.getElementById("skip-connect");
const statusEl = document.getElementById("onboarding-status");
const connectContainer = document.querySelector("[data-google-connect]");

let selectedPlace = null;

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#dc2626" : "#4b5563";
}

async function ensureUser() {
  const user = auth.currentUser;
  if (!user) {
    window.location.href = "/auth.html";
  }
  return user;
}

async function upsertPortalSettings(uid, googleReviewUrl) {
  const portalSettingsRef = doc(db, "portalSettings", uid);
  const portalSnap = await getDoc(portalSettingsRef);
  const basePayload = { updatedAt: serverTimestamp() };
  if (googleReviewUrl) {
    basePayload.googleReviewUrl = googleReviewUrl;
  }
  if (!portalSnap.exists()) {
    await setDoc(portalSettingsRef, {
      businessId: uid,
      googleReviewUrl: googleReviewUrl || "",
      accentColor: "#36058a",
      backgroundStyle: "gradient",
      primaryColor: "#171a21",
      headline: "Share your experience",
      subheadline: "Your voice shapes how we improve.",
      ctaLabelHighRating: "Leave a Google review",
      ctaLabelLowRating: "Send private feedback",
      thankYouTitle: "Thank you!",
      thankYouBody: "We appreciate you taking the time to help us improve.",
      createdAt: serverTimestamp(),
      ...basePayload,
    });
  } else {
    await setDoc(portalSettingsRef, basePayload, { merge: true });
  }
}

async function saveBusinessProfile(place, { redirect = false } = {}) {
  const user = await ensureUser();
  if (!user) return;
  const uid = user.uid;
  const businessName = (businessNameInput?.value || place?.name || "Your business").trim();
  setStatus("Saving…");

  try {
    const businessDocRef = doc(db, "businessProfiles", uid);
    const payload = {
      businessId: uid,
      ownerUid: uid,
      businessName,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    await setDoc(businessDocRef, payload, { merge: true });
    let connectResult = null;
    if (place) {
      selectedPlace = place;
      connectResult = await connectPlaceOnBackend(place, { businessName });
    }

    await upsertPortalSettings(uid, connectResult?.googleReviewUrl || null);

    await refetchProfileAfterConnect();
    setStatus("Saved successfully!");
    if (redirect) {
      window.location.href = "/dashboard.html";
    }
  } catch (err) {
    console.error("[onboarding] failed to save profile", err);
    const message =
      err?.message ||
      "Error while saving. Please verify your phone number matches your Google profile and try again.";
    setStatus(message, true);
  }
}

function setupConnectCard() {
  renderGoogleConnect(connectContainer, {
    title: "Connect your Google Business Profile",
    subtitle: "We’ll use this to pull your Google rating and reviews into your dashboard.",
    helperText: "Start typing your business name as it appears on Google.",
    showSkip: true,
    onSkip: () => saveBusinessProfile(null, { redirect: true }),
    onConnect: async (place) => {
      await saveBusinessProfile(place, { redirect: false });
      if (businessNameInput && !businessNameInput.value) {
        businessNameInput.value = place.name || "";
      }
    },
  });
}

if (saveBtn) {
  saveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveBusinessProfile(selectedPlace, { redirect: true });
  });
}

if (skipBtn) {
  skipBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveBusinessProfile(null, { redirect: true });
  });
}

setupConnectCard();
