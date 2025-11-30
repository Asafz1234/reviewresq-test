// =============================
//  onboarding.js (FIXED)
//  Handles loading + saving onboarding data
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

// ------------- DOM ELEMENTS -------------
// ננסה קודם לפי ID, ואם אין – ניקח את ה<form> הראשון בעמוד
const form =
  document.getElementById("onboardingForm") ||
  document.querySelector("form");

const bizNameInput = document.getElementById("bizNameInput");
const bizCategoryInput = document.getElementById("bizCategoryInput");
const bizPhoneInput = document.getElementById("bizPhoneInput");
const bizEmailInput = document.getElementById("bizEmailInput");
const googleLinkInput = document.getElementById("googleLinkInput");
const websiteInput = document.getElementById("websiteInput");
const logoUrlInput = document.getElementById("logoUrlInput");

const errorBanner = document.getElementById("errorBanner");
const errorBannerText = document.getElementById("errorBannerText");

// ננסה למצוא את כפתור השמירה בכמה דרכים שונות
let saveBtn =
  document.getElementById("saveOnboardingBtn") || // אם יש כזה
  document.getElementById("saveBtn") ||            // או זה
  (form
    ? form.querySelector("button[type='submit'], input[type='submit']")
    : null);

// ------------ HELPERS -------------

function showError(msg) {
  if (errorBanner && errorBannerText) {
    errorBanner.style.display = "block";
    errorBannerText.textContent = msg;
  } else {
    alert(msg);
  }
}

function hideError() {
  if (errorBanner && errorBannerText) {
    errorBanner.style.display = "none";
    errorBannerText.textContent = "";
  }
}

// הופך מחרוזת ריקה ל-null
function cleanValue(value) {
  return value && value.trim() !== "" ? value.trim() : null;
}

// --------- LOAD ONBOARDING DATA ----------

async function loadOnboarding(uid) {
  try {
    const ref = doc(db, "businessProfiles", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.log("No onboarding data yet. User will fill the form.");
      return;
    }

    const data = snap.data() || {};

    if (bizNameInput) bizNameInput.value = data.businessName || "";
    if (bizCategoryInput) bizCategoryInput.value = data.category || "";
    if (bizPhoneInput) bizPhoneInput.value = data.phone || "";
    if (bizEmailInput) bizEmailInput.value = data.contactEmail || "";
    if (googleLinkInput) googleLinkInput.value = data.googleReviewLink || "";
    if (websiteInput) websiteInput.value = data.website || "";
    if (logoUrlInput) logoUrlInput.value = data.logoUrl || "";
  } catch (err) {
    console.error("Error loading onboarding:", err);
    showError("Could not load your business details. Please try again.");
  }
}

// --------------- SAVE ONBOARDING ----------------

async function saveOnboarding(uid) {
  if (!form) {
    console.error("Onboarding form not found in DOM.");
    return;
  }

  hideError();

  // אם הדפדפן תומך, נשמור את כפתור הסאבמיט האמיתי
  if (!saveBtn && window.event && window.event.submitter) {
    saveBtn = window.event.submitter;
  }

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

  // ננעל את הכפתור לפני השמירה
  const originalText = saveBtn ? saveBtn.textContent : "";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    const ref = doc(db, "businessProfiles", uid);
    await setDoc(ref, payload, { merge: true });

    // אחרי שמירה – נעבור לדשבורד
    window.location.href = "/dashboard.html";
  } catch (err) {
    console.error("Save onboarding failed:", err);
    showError("Could not save your business details. Please try again.");

    // במקרה של שגיאה נחזיר את הכפתור למצב רגיל
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText || "Save & Continue";
    }
  }
}

// ---------------- AUTH FLOW -----------------

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  // טוענים נתוני אונבורדינג (אם יש)
  loadOnboarding(user.uid);

  // מאזין לסאבמיט של הטופס
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault(); // מונע רענון של הדף
      saveOnboarding(user.uid);
    });
  } else {
    console.warn("Onboarding form not found. Make sure you have a <form> element.");
  }
});
