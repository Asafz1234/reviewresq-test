// portal.js
// Loads business profile into the portal and handles feedback submission

import {
  db,
  doc,
  getDoc,
  collection,
  setDoc,
  serverTimestamp,
} from "./firebase.js";

// ----- DOM ELEMENTS -----
const portalEl = document.getElementById("portal");
const ownerToolbar = document.getElementById("ownerToolbar");
const ownerDashboardLink = document.getElementById("ownerDashboardLink");

const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizLogoInitials = document.getElementById("bizLogoInitials");
const bizLogoImgWrapper = document.getElementById("bizLogoImgWrapper");
const bizLogoImg = document.getElementById("bizLogoImg");

const ratingButtons = document.querySelectorAll(".rating-button");
const currentRatingLine = document.getElementById("currentRatingLine");
const currentRatingValue = document.getElementById("currentRatingValue");
const changeRatingLink = document.getElementById("changeRatingLink");

const lowPanel = document.getElementById("lowPanel");
const highPanel = document.getElementById("highPanel");

const feedbackForm = document.getElementById("feedbackForm");
const feedbackMessageInput = document.getElementById("feedbackMessage");
const customerNameInput = document.getElementById("customerNameInput");
const customerEmailInput = document.getElementById("customerEmailInput");
const sendFeedbackBtn = document.getElementById("sendFeedbackBtn");

const thankyouCopy = document.getElementById("thankyouCopy");

const urlParams = new URLSearchParams(window.location.search);
const ownerPreviewParam =
  urlParams.get("ownerPreview") ?? urlParams.get("owner") ?? "";

// ----- STATE -----
let currentRating = 0;
let businessId = null;
let businessName = "Your business";
const isOwnerPreview = ["1", "true", "yes", "on"].includes(
  ownerPreviewParam.toString().toLowerCase()
);

// ----- HELPERS -----
function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "YB";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function showOwnerToolbarIfNeeded() {
  if (!ownerToolbar) return;
  ownerToolbar.classList.toggle("visible", isOwnerPreview);
  ownerToolbar.setAttribute("aria-hidden", isOwnerPreview ? "false" : "true");

  if (isOwnerPreview && ownerDashboardLink) {
    ownerDashboardLink.href = "/dashboard.html";
  }
}

function setPortalClasses() {
  if (!portalEl) return;

  portalEl.classList.add("has-rating");
  portalEl.classList.remove("low-rating", "high-rating");

  if (currentRating <= 3) {
    portalEl.classList.add("low-rating");
  } else if (currentRating >= 4) {
    portalEl.classList.add("high-rating");
  }

  if (currentRatingLine && currentRatingValue) {
    currentRatingValue.textContent = currentRating ? `${currentRating}★` : "–";
  }

  ratingButtons.forEach((btn) => {
    const value = Number(btn.dataset.rating);
    btn.classList.toggle("selected", value === currentRating);
  });
}

function resetRating() {
  currentRating = 0;
  if (!portalEl) return;
  portalEl.classList.remove("has-rating", "low-rating", "high-rating", "feedback-sent");
  if (currentRatingValue) currentRatingValue.textContent = "–";

  ratingButtons.forEach((btn) => btn.classList.remove("selected"));
}

// ----- LOAD BUSINESS PROFILE -----
async function loadBusinessProfile() {
  businessId = urlParams.get("bid");

  if (!businessId) {
    console.warn("No bid parameter in URL. Portal will use default branding.");
    return;
  }

  try {
    const ref = doc(db, "businessProfiles", businessId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.warn("No business profile found for", businessId);
      return;
    }

    const data = snap.data();

    businessName = data.businessName || "Your business";

    if (bizNameDisplay) {
      bizNameDisplay.textContent = businessName;
    }

    // Logo
    const logoUrl = data.logoUrl || data.logoDataUrl || null;
    if (logoUrl && bizLogoImg && bizLogoImgWrapper && bizLogoInitials) {
      bizLogoImg.src = logoUrl;
      bizLogoImg.alt = `${businessName} logo`;
      bizLogoImgWrapper.style.display = "flex";
      bizLogoInitials.style.display = "none";
    } else if (bizLogoInitials && bizLogoImgWrapper) {
      bizLogoImgWrapper.style.display = "none";
      bizLogoInitials.textContent = initialsFromName(businessName);
      bizLogoInitials.style.display = "flex";
    }

    // Update document title
    document.title = `${businessName} • Feedback Portal`;

  } catch (err) {
    console.error("Failed to load business profile:", err);
  }
}

// ----- RATING HANDLERS -----
ratingButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const value = Number(btn.dataset.rating);
    if (!value) return;
    currentRating = value;
    setPortalClasses();
  });
});

if (changeRatingLink) {
  changeRatingLink.addEventListener("click", (event) => {
    event.preventDefault();
    resetRating();
  });
}

// ----- FEEDBACK SUBMISSION (LOW RATINGS) -----
if (feedbackForm) {
  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentRating || currentRating > 3) {
      alert("Please select a rating of 1–3 stars to send private feedback.");
      return;
    }

    const message = (feedbackMessageInput?.value || "").trim();
    const customerName = (customerNameInput?.value || "").trim();
    const customerEmail = (customerEmailInput?.value || "").trim();

    if (!message) {
      alert("Please tell us what we could have done better.");
      return;
    }

    // Prepare payload for Firestore
    const payload = {
      businessId: businessId || null,
      businessName,
      rating: currentRating,
      type: "private", // 1–3 stars -> private feedback
      message,
      customerName: customerName || null,
      customerEmail: customerEmail || null,
      createdAt: serverTimestamp(),
    };

    try {
      if (sendFeedbackBtn) {
        sendFeedbackBtn.disabled = true;
        sendFeedbackBtn.textContent = "Sending…";
      }

      const fbCollection = collection(db, "feedback");
      const newDocRef = doc(fbCollection); // auto-id
      await setDoc(newDocRef, payload);

      if (portalEl) {
        portalEl.classList.add("feedback-sent");
      }

    } catch (err) {
      console.error("Failed to save feedback:", err);
      alert("We could not send your feedback. Please try again in a moment.");
    } finally {
      if (sendFeedbackBtn) {
        sendFeedbackBtn.disabled = false;
        sendFeedbackBtn.textContent = "Send feedback";
      }
    }
  });
}

// ----- INIT -----
showOwnerToolbarIfNeeded();
loadBusinessProfile();
