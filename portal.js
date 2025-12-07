// portal.js
// Loads business profile into the portal and handles feedback submission

import {
  db,
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "./firebase-config.js";

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
const portalHeadlineText = document.getElementById("portalHeadlineText");
const portalSubheadlineText = document.getElementById("portalSubheadlineText");
const lowCtaLabel = document.getElementById("lowCtaLabel");
const highCtaButton = document.getElementById("highCtaButton");
const highCtaLabel = document.getElementById("highCtaLabel");
const thankyouTitleText = document.getElementById("thankyouTitleText");
const thankyouBodyText = document.getElementById("thankyouBodyText");

const urlParams = new URLSearchParams(window.location.search);
const ownerPreviewParam =
  urlParams.get("ownerPreview") ?? urlParams.get("owner") ?? "";

// ----- STATE -----
let currentRating = 0;
let businessId = null;
let businessName = "Your business";
let portalSettings = null;
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
  businessId = urlParams.get("bid") || urlParams.get("b");

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

    document.title = `${businessName} • Feedback Portal`;

    await loadPortalSettings();

  } catch (err) {
    console.error("Failed to load business profile:", err);
  }
}

async function loadPortalSettings() {
  if (!businessId) return;
  const ref = doc(db, "portalSettings", businessId);
  const snap = await getDoc(ref);
  portalSettings = snap.exists()
    ? snap.data()
    : {
        primaryColor: "#2563eb",
        accentColor: "#7c3aed",
        backgroundStyle: "gradient",
        headline: "How was your experience today?",
        subheadline: "Your feedback helps us improve and keeps our team on point.",
        ctaLabelHighRating: "Leave a Google review",
        ctaLabelLowRating: "Send private feedback",
        thankYouTitle: "Thank you for the feedback!",
        thankYouBody: "We read every note and follow up where needed.",
      };
  applyPortalSettings();
}

function applyPortalSettings() {
  if (!portalSettings) return;
  const root = document.documentElement;
  if (portalSettings.primaryColor) root.style.setProperty("--accent", portalSettings.primaryColor);
  if (portalSettings.accentColor) root.style.setProperty("--accent-strong", portalSettings.accentColor);
  if (portalSettings.backgroundStyle === "dark") {
    root.style.setProperty("--bg", "#0b1224");
    document.body.classList.add("dark-portal");
  } else if (portalSettings.backgroundStyle === "light") {
    document.body.classList.remove("dark-portal");
  }
  if (portalHeadlineText) portalHeadlineText.textContent = portalSettings.headline || portalHeadlineText.textContent;
  if (portalSubheadlineText) portalSubheadlineText.textContent = portalSettings.subheadline || portalSubheadlineText.textContent;
  if (lowCtaLabel) lowCtaLabel.textContent = portalSettings.ctaLabelLowRating || lowCtaLabel.textContent;
  if (highCtaLabel) highCtaLabel.textContent = portalSettings.ctaLabelHighRating || highCtaLabel.textContent;
  if (thankyouTitleText) thankyouTitleText.textContent = portalSettings.thankYouTitle || thankyouTitleText.textContent;
  if (thankyouBodyText) thankyouBodyText.textContent = portalSettings.thankYouBody || thankyouBodyText.textContent;
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

if (highCtaButton) {
  highCtaButton.addEventListener("click", async () => {
    try {
      const settingsRef = doc(db, "portalSettings", businessId);
      const settingsSnap = await getDoc(settingsRef);

      if (!settingsSnap.exists()) {
        alert("Google Review link not set yet.");
        return;
      }

      const data = settingsSnap.data();
      const googleUrl = data.googleReviewUrl;

      if (!googleUrl || googleUrl.trim() === "") {
        alert("This business has not set a Google Review link yet.");
        return;
      }

      // Open Google Review page
      window.location.href = googleUrl;
    } catch (err) {
      console.error("Failed to open Google review link:", err);
    }
  });
}

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

    const currentBusinessId = businessId || urlParams.get("bid") || urlParams.get("b");
    const message = (feedbackMessageInput?.value || "").trim();
    const customerName = (customerNameInput?.value || "").trim();
    const customerEmail = (customerEmailInput?.value || "").trim();

    if (!currentBusinessId) {
      alert("This feedback link is missing a business id. Please ask the business for a new link.");
      return;
    }

    if (!currentRating || currentRating > 3) {
      alert("Please select a rating of 1–3 stars to send private feedback.");
      return;
    }

    if (!message) {
      alert("Please tell us what we could have done better.");
      return;
    }

    try {
      if (sendFeedbackBtn) {
        sendFeedbackBtn.disabled = true;
        sendFeedbackBtn.textContent = "Sending…";
      }

      const fbCollection = collection(db, "feedback");
      await addDoc(fbCollection, {
        businessId: currentBusinessId,
        rating: currentRating,
        message: message || "",
        customerName: customerName || "Anonymous",
        customerEmail: customerEmail || "",
        type: "private", // 1–3 stars -> private feedback
        source: "portal",
        createdAt: serverTimestamp(),
      });

      if (portalEl) {
        portalEl.classList.add("feedback-sent");
      }

      if (feedbackForm) {
        feedbackForm.reset();
      }
    } catch (err) {
      console.error("Portal feedback submit error", err);

      if (
        err?.code === "permission-denied" ||
        (typeof err?.message === "string" && err.message.includes("permission-denied"))
      ) {
        alert(
          "We could not save your feedback because of a security rule. Please contact the business owner."
        );
      } else {
        alert("We could not send your feedback. Please try again in a moment.");
      }
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
