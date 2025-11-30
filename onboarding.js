// =============================
//  onboarding.js – simple & robust
// =============================

import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./firebase.js";

console.log("[onboarding] file loaded");

// ---------- HELPERS ----------

function showError(msg) {
  const errorBanner = document.getElementById("errorBanner");
  const errorBannerText = document.getElementById("errorBannerText");
  if (errorBanner && errorBannerText) {
    errorBanner.style.display = "block";
    errorBannerText.textContent = msg;
  } else {
    alert(msg);
  }
}

function hideError() {
  const errorBanner = document.getElementById("errorBanner");
  const errorBannerText = document.getElementById("errorBannerText");
  if (errorBanner && errorBannerText) {
    errorBanner.style.display = "none";
    errorBannerText.textContent = "";
  }
}

function cleanValue(value) {
  return value && value.trim() !== "" ? value.trim() : null;
}

function getInputs() {
  return {
    bizNameInput: document.getElementById("bizNameInput"),
    bizCategoryInput: document.getElementById("bizCategoryInput"),
    bizPhoneInput: document.getElementById("bizPhoneInput"),
    bizEmailInput: document.getElementById("bizEmailInput"),
    googleLinkInput: document.getElementById("googleLinkInput"),
    websiteInput: document.getElementById("websiteInput"),
    logoUrlInput: document.getElementById("logoUrlInput"),
  };
}

// ---------- LOAD EXISTING DATA ----------

async function loadOnboarding(uid) {
  const {
    bizNameInput,
    bizCategoryInput,
    bizPhoneInput,
    bizEmailInput,
    googleLinkInput,
    websiteInput,
    logoUrlInput,
  } = getInputs();

  try {
    const ref = doc(db, "businessProfiles", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.log("[onboarding] No onboarding data yet – empty form");
      return;
    }

    const data = snap.data() || {};
    console.log("[onboarding] Loaded data:", data);

    if (bizNameInput) bizNameInput.value = data.businessName || "";
    if (bizCategoryInput) bizCategoryInput.value = data.category || "";
    if (bizPhoneInput) bizPhoneInput.value = data.phone || "";
    if (bizEmailInput) bizEmailInput.value = data.contactEmail || "";
    if (googleLinkInput) googleLinkInput.value = data.googleReviewLink || "";
    if (websiteInput) websiteInput.value = data.website || "";
    if (logoUrlInput) logoUrlInput.value = data.logoUrl || "";
  } catch (err) {
    console.error("[onboarding] Error loading data:", err);
    showError("Could not load your business details. Please try again.");
  }
}

// ---------- SAVE DATA ----------

async function saveOnboarding(uid) {
  hideError();

  const {
    bizNameInput,
    bizCategoryInput,
    bizPhoneInput,
    bizEmailInput,
    googleLinkInput,
    websiteInput,
    logoUrlInput,
  } = getInputs();

  const payload = {
    businessName: cleanValue(bizNameInput?.value),
    category: cleanValue(bizCategoryInput?.value),
    phone: cleanValue(bizPhoneInput?.value),
    contactEmail: cleanValue(bizEmailInput?.value),
    googleReviewLink: cleanValue(googleLinkInput?.value),
    website: cleanValue(websiteInput?.value),
    logoUrl: cleanValue(logoUrlInput?.value),
    onboardingComplete: true,
    updatedAt: serverTimestamp(),
  };

  console.log("[onboarding] Saving payload:", payload);

  const saveBtn =
    document.getElementById("saveOnboardingBtn") ||
    document.getElementById("saveBtn") ||
    document.querySelector("button[type='submit'], input[type='submit']");

  const originalText = saveBtn ? saveBtn.textContent : "";

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    const ref = doc(db, "businessProfiles", uid);
    await setDoc(ref, payload, { merge: true });
    console.log("[onboarding] Saved OK, redirecting to dashboard");
    window.location.href = "/dashboard.html";
  } catch (err) {
    console.error("[onboarding] Save failed:", err);
    showError("Could not save your business details. Please try again.");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText || "Save & Continue";
    }
  }
}

// ---------- AUTH + EVENT WIRING ----------

onAuthStateChanged(auth, (user) => {
  if (!user) {
    console.log("[onboarding] No user – redirecting to auth");
    window.location.href = "/auth.html";
    return;
  }

  console.log("[onboarding] Authenticated as", user.uid);

  // בשלב הזה ה־HTML כבר נטען (הסקריפט בסוף ה־body)
  const form =
    document.getElementById("onboardingForm") ||
    document.querySelector("form");
  const saveBtn =
    document.getElementById("saveOnboardingBtn") ||
    document.getElementById("saveBtn") ||
    (form
      ? form.querySelector("button[type='submit'], input[type='submit']")
      : null);

  console.log(
    "[onboarding] form found?",
    !!form,
    "saveBtn found?",
    !!saveBtn
  );

  // טוען נתונים קיימים
  loadOnboarding(user.uid);

  // מאזין ל-submit של הטופס – כאן חייבים למנוע רענון
  if (form) {
    form.addEventListener("submit", (e) => {
      console.log("[onboarding] FORM SUBMIT");
      e.preventDefault();
      saveOnboarding(user.uid);
    });
  }

  // וגם ל-click על הכפתור, ליתר ביטחון
  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      console.log("[onboarding] SAVE BUTTON CLICK");
      e.preventDefault();
      // אם הכפתור לא בתוך form, עדיין נקרא ל־save
      saveOnboarding(user.uid);
    });
  }
});
