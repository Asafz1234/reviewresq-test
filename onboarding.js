// onboarding.js – שומר / טוען את פרטי העסק ל-Firestore

import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./firebase.js";

const form = document.getElementById("onboarding-form");
const submitBtn = document.getElementById("submit-btn");
const globalMsg = document.getElementById("global-message");
const previewBizName = document.getElementById("preview-biz-name");

const bizNameInput = document.getElementById("biz-name");

// עדכון פריוויו בזמן אמת
if (bizNameInput && previewBizName) {
  bizNameInput.addEventListener("input", () => {
    previewBizName.textContent =
      bizNameInput.value.trim() || "YOUR BUSINESS";
  });
}

// עוזר להודעות כלליות
function showGlobal(type, msg) {
  globalMsg.textContent = msg;
  globalMsg.className = `global-message visible ${type}`;
}

function clearGlobal() {
  globalMsg.textContent = "";
  globalMsg.className = "global-message";
}

function fieldError(id, msg) {
  const el = document.getElementById(id + "-error");
  if (el) el.textContent = msg || "";
}

function clearFieldErrors() {
  document.querySelectorAll(".error-text").forEach((el) => (el.textContent = ""));
}

let currentUser = null;
let bizDocRef = null;

// --- AUTH GUARD + טעינת נתונים קיימים ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // אם אין משתמש – נשלח לעמוד התחברות
    window.location.href = "/auth.html";
    return;
  }

  currentUser = user;
  bizDocRef = doc(db, "businesses", user.uid);

  try {
    const snap = await getDoc(bizDocRef);
    if (snap.exists()) {
      const data = snap.data();

      // מלא טופס מנתונים קיימים
      if (data.bizName) document.getElementById("biz-name").value = data.bizName || "";
      if (data.category) document.getElementById("biz-category").value = data.category || "";
      if (data.phone) document.getElementById("biz-phone").value = data.phone || "";
      if (data.email) document.getElementById("biz-email").value = data.email || "";
      if (data.googleReviewLink) document.getElementById("google-link").value = data.googleReviewLink || "";
      if (data.websiteUrl) document.getElementById("website-url").value = data.websiteUrl || "";
      if (data.logoUrl) document.getElementById("logo-url").value = data.logoUrl || "";
      if (data.cityArea) document.getElementById("biz-city").value = data.cityArea || "";
      if (data.plan) document.getElementById("plan").value = data.plan || "advanced";
      if (data.notes) document.getElementById("notes").value = data.notes || "";

      // עדכון פריוויו
      if (data.bizName) previewBizName.textContent = data.bizName;
    }
  } catch (err) {
    console.error("Failed to load business doc:", err);
    showGlobal("error", "Could not load your business details. Please try again.");
  }
});

// --- SUBMIT ONBOARDING FORM ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearGlobal();
  clearFieldErrors();

  if (!currentUser || !bizDocRef) {
    return showGlobal("error", "You must be logged in to save your onboarding.");
  }

  const bizName = document.getElementById("biz-name").value.trim();
  const category = document.getElementById("biz-category").value.trim();
  const phone = document.getElementById("biz-phone").value.trim();
  const email = document.getElementById("biz-email").value.trim();
  const googleLink = document.getElementById("google-link").value.trim();
  const websiteUrl = document.getElementById("website-url").value.trim();
  const logoUrl = document.getElementById("logo-url").value.trim();
  const cityArea = document.getElementById("biz-city").value.trim();
  const plan = document.getElementById("plan").value || "advanced";
  const notes = document.getElementById("notes").value.trim();

  let hasError = false;

  if (!bizName) {
    fieldError("biz-name", "Business name is required.");
    hasError = true;
  }
  if (!category) {
    fieldError("biz-category", "Please enter your main service or category.");
    hasError = true;
  }
  if (!phone) {
    fieldError("biz-phone", "Phone is required.");
    hasError = true;
  }
  if (!email) {
    fieldError("biz-email", "Contact email is required.");
    hasError = true;
  }
  if (!googleLink) {
    fieldError("google-link", "Google review link is required.");
    hasError = true;
  }

  if (hasError) {
    showGlobal("error", "Please fix the highlighted fields and try again.");
    return;
  }

  submitBtn.disabled = true;

  try {
    // שמירה / עדכון המסמך ב-Firestore
    await setDoc(
      bizDocRef,
      {
        ownerUid: currentUser.uid,
        bizName,
        category,
        phone,
        email,
        googleReviewLink: googleLink,
        websiteUrl: websiteUrl || null,
        logoUrl: logoUrl || null,
        cityArea: cityArea || null,
        plan: plan || "advanced",
        notes: notes || null,
        onboardingComplete: true,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    showGlobal("success", "Saved! Redirecting you to your dashboard…");

    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 800);
  } catch (err) {
    console.error("Onboarding save failed:", err);
    showGlobal("error", "Could not save your details. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
});
