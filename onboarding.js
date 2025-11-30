// =============================
//  onboarding.js (NEW)
//  Handles loading + saving onboarding data
// =============================

import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "./firebase.js";

// ------------- DOM ELEMENTS -------------
const form = document.getElementById("onboardingForm");

const bizNameInput = document.getElementById("bizNameInput");
const bizCategoryInput = document.getElementById("bizCategoryInput");
const bizPhoneInput = document.getElementById("bizPhoneInput");
const bizEmailInput = document.getElementById("bizEmailInput");
const googleLinkInput = document.getElementById("googleLinkInput");
const websiteInput = document.getElementById("websiteInput");
const logoUrlInput = document.getElementById("logoUrlInput");

const errorBanner = document.getElementById("errorBanner");
const errorBannerText = document.getElementById("errorBannerText");

const saveBtn = document.getElementById("saveBtn");

// ------------ HELPERS -------------

function showError(msg) {
  if (errorBanner) {
    errorBanner.style.display = "block";
    errorBannerText.textContent = msg;
  }
}

function hideError() {
  if (errorBanner) {
    errorBanner.style.display = "none";
    errorBannerText.textContent = "";
  }
}

// Convert blank to null
function cleanValue(value) {
  return value && value.trim() !== "" ? value.trim() : null;
}

// ------------ LOAD ONBOARDING DATA --------------

async function loadOnboarding(uid) {
  try {
    const ref = doc(db, "businessProfiles", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.log("No onboarding data yet. User will fill the form.");
      return;
    }

    const data = snap.data();

    bizNameInput.value = data.businessName || "";
    bizCategoryInput.value = data.category || "";
    bizPhoneInput.value = data.phone || "";
    bizEmailInput.value = data.contactEmail || "";
    googleLinkInput.value = data.googleReviewLink || "";
    websiteInput.value = data.website || "";
    logoUrlInput.value = data.logoUrl || "";

  } catch (err) {
    console.error("Error loading onboarding:", err);
    showError("Could not load your business details. Please try again.");
  }
}

// --------------- SAVE ONBOARDING ----------------

async function saveOnboarding(uid) {
  hideError();

  const payload = {
    businessName: cleanValue(bizNameInput.value),
    category: cleanValue(bizCategoryInput.value),
    phone: cleanValue(bizPhoneInput.value),
    contactEmail: cleanValue(bizEmailInput.value),
    googleReviewLink: cleanValue(googleLinkInput.value),
    website: cleanValue(websiteInput.value),
    logoUrl: cleanValue(logoUrlInput.value),
    onboardingComplete: true,
    updatedAt: serverTimestamp(),
  };

  try {
    const ref = doc(db, "businessProfiles", uid);
    await setDoc(ref, payload, { merge: true });

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 500);

  } catch (err) {
    console.error("Save onboarding failed:", err);
    showError("Could not save your business details. Please try again.");
  }
}

// ---------------- AUTH FLOW -----------------

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  loadOnboarding(user.uid);

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveOnboarding(user.uid);
    });
  }
});
