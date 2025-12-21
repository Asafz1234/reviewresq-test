// portal.js
// Loads business profile into the portal and handles feedback submission

import {
  db,
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  setDoc,
} from "./firebase-config.js";
import { resolveCanonicalReviewUrl } from "./google-link-utils.js";

// ----- DOM ELEMENTS -----
const portalEl = document.getElementById("portal");
const ownerToolbar = document.getElementById("ownerToolbar");
const ownerDashboardLink = document.getElementById("ownerDashboardLink");

const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizSubtitleDisplay = document.getElementById("bizSubtitleDisplay");
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
const portalStatus = document.getElementById("portalStatus");

const urlParams = new URLSearchParams(window.location.search);
const businessIdFromParams =
  urlParams.get("businessId") ||
  urlParams.get("bid") ||
  urlParams.get("id") ||
  urlParams.get("portalId") ||
  urlParams.get("shareKey");
const shareKeyParam =
  urlParams.get("shareKey") ||
  urlParams.get("portalId") ||
  urlParams.get("businessId") ||
  urlParams.get("bid");
const ownerPreviewParam =
  urlParams.get("ownerPreview") ?? urlParams.get("owner") ?? "";

// ----- STATE -----
let currentRating = 0;
let businessId = null;
let businessName = "Your Business";
let businessTagline = "Private Feedback Portal";
let portalSettings = null;
let businessLogoUrl = null;
let googleReviewUrl = "";
const isOwnerPreview = ["1", "true", "yes", "on"].includes(
  ownerPreviewParam.toString().toLowerCase()
);

// ----- HELPERS -----
function getBusinessIdFromUrl() {
  const id = businessIdFromParams;

  if (!id) {
    console.warn("[portal] Missing business identifier in URL", window.location.href);
  }

  return id;
}

function setPortalStatus(status, message = "") {
  if (!portalEl || !portalStatus) return;

  portalStatus.textContent = message;
  portalStatus.hidden = status === "ready";
  portalEl.classList.toggle("is-loading", status === "loading");
  portalEl.classList.toggle("has-error", status === "error");
}

function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "YB";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function renderBusinessIdentity() {
  const logoFromSettings = portalSettings?.businessLogoUrl;
  const effectiveLogo = logoFromSettings || businessLogoUrl;

  if (effectiveLogo && bizLogoImg && bizLogoImgWrapper && bizLogoInitials) {
    bizLogoImg.src = effectiveLogo;
    bizLogoImg.alt = `${businessName} logo`;
    bizLogoImgWrapper.style.display = "flex";
    bizLogoInitials.style.display = "none";
  } else if (bizLogoInitials && bizLogoImgWrapper) {
    bizLogoImgWrapper.style.display = "none";
    bizLogoInitials.textContent = initialsFromName(businessName);
    bizLogoInitials.style.display = "flex";

    console.warn("[portal] Missing business logo, showing initials avatar", {
      businessId,
    });
  }
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

function showThankYouState() {
  if (portalEl) {
    portalEl.classList.add("feedback-sent");
  }

  if (feedbackForm) {
    feedbackForm.reset();
  }
}

// ----- LOAD BUSINESS PROFILE -----
async function loadBusinessProfile() {
  setPortalStatus("loading", "Loading your feedback portal…");
  businessId = getBusinessIdFromUrl();

  if (!businessId) {
    alert(
      "This feedback link is missing a business id. Please open the review link from the email again."
    );
    setPortalStatus(
      "error",
      "We could not load this feedback portal (missing business id). Please try the link again."
    );
    return;
  }

  try {
    let ref = doc(db, "businesses", businessId);
    let snap = await getDoc(ref);
    let data = snap.exists() ? snap.data() : null;

    if (!data && shareKeyParam) {
      const shareKeyQuery = query(
        collection(db, "businesses"),
        where("shareKey", "==", shareKeyParam)
      );
      const shareKeySnap = await getDocs(shareKeyQuery);
      if (!shareKeySnap.empty) {
        const matchedDoc = shareKeySnap.docs[0];
        data = matchedDoc.data();
        businessId = matchedDoc.id;
        ref = doc(db, "businesses", businessId);
      }
    }

    if (!data) {
      const legacyRef = doc(db, "businessProfiles", businessId);
      const legacySnap = await getDoc(legacyRef);
      if (legacySnap.exists()) {
        data = legacySnap.data();
        ref = legacyRef;
      } else if (shareKeyParam) {
        const legacyShareKeyQuery = query(
          collection(db, "businessProfiles"),
          where("shareKey", "==", shareKeyParam)
        );
        const legacyShareKeySnap = await getDocs(legacyShareKeyQuery);
        if (!legacyShareKeySnap.empty) {
          const matchedDoc = legacyShareKeySnap.docs[0];
          data = matchedDoc.data();
          businessId = matchedDoc.id;
          ref = doc(db, "businessProfiles", businessId);
        }
      }
    }

    if (!data) {
      console.warn("[portal] No business profile found for", businessId);
      setPortalStatus(
        "error",
        "We couldn’t find this business. Please ask the business owner for a new link."
      );
      return;
    }

    const resolvedBusinessName = data.businessName || data.displayName || "";

    if (!resolvedBusinessName) {
      console.warn("[portal] Business name missing in document", {
        businessId,
      });
    }

    businessName = resolvedBusinessName || "Your Business";
    businessTagline = data.tagline || data.businessTagline || "Private Feedback Portal";

    if (bizNameDisplay) {
      bizNameDisplay.textContent = businessName;
    }

    if (bizSubtitleDisplay) {
      bizSubtitleDisplay.textContent = businessTagline;
    }

    const resolvedLogoUrl =
      data.logoUrl ||
      data.brandLogoUrl ||
      data.businessLogoUrl ||
      data.logoDataUrl ||
      data.logoURL ||
      null;

    businessLogoUrl = resolvedLogoUrl;
    renderBusinessIdentity();

    googleReviewUrl = resolveCanonicalReviewUrl(data);
    if (highCtaButton) {
      highCtaButton.disabled = !googleReviewUrl;
      highCtaButton.classList.toggle("disabled", !googleReviewUrl);
    }

    if (googleReviewUrl && ref && ref.id) {
      try {
        const primaryRef = ref.path.startsWith("businessProfiles")
          ? doc(db, "businesses", ref.id)
          : ref;
        await setDoc(
          primaryRef,
          { googleReviewUrl },
          { merge: true }
        );
      } catch (err) {
        console.warn("[portal] unable to persist googleReviewUrl", err);
      }
    }

    document.title = `${businessName} • Feedback Portal`;

    await loadPortalSettings();

    setPortalStatus("ready");

  } catch (err) {
    const permissionDenied = err?.code === "permission-denied";
    if (permissionDenied) {
      console.warn("[portal] Permission denied while loading business profile", {
        businessId,
        error: err,
      });
    } else {
      console.error("Failed to load business profile:", err);
    }

    setPortalStatus(
      "error",
      permissionDenied
        ? "We don’t have permission to load this business. Please ask the owner to resend your link."
        : "Something went wrong loading this portal. Please try again."
    );
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
  renderBusinessIdentity();
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
      const googleUrl = googleReviewUrl;

      if (!googleUrl || googleUrl.trim() === "") {
        alert("This business has not set a Google Review link yet.");
        return;
      }

      const currentBusinessId = businessId || getBusinessIdFromUrl();
      if (currentBusinessId) {
        const payload = {
          businessId: currentBusinessId,
          rating: currentRating || null,
          customerName: (customerNameInput?.value || "").trim(),
          customerEmail: (customerEmailInput?.value || "").trim(),
        };

        try {
          const trackUrl =
            "https://us-central1-reviewresq-app.cloudfunctions.net/recordReviewLinkClick";
          const body = JSON.stringify(payload);

          if (navigator.sendBeacon) {
            navigator.sendBeacon(trackUrl, new Blob([body], { type: "application/json" }));
          } else {
            await fetch(trackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            });
          }
        } catch (err) {
          console.warn("[portal] Failed to record review click", err);
        }
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
async function handleFeedbackSubmit(event) {
  event.preventDefault();

  const currentBusinessId = businessId || getBusinessIdFromUrl();

  if (!currentBusinessId) {
    console.error("[portal] Missing ?bid= in URL", window.location.href);
    alert(
      "We couldn’t send your feedback (missing business id in the link). Please open the review link from the email again."
    );
    return;
  }

  const rating = currentRating;
  const message = (feedbackMessageInput?.value || "").trim();
  const customerName = (customerNameInput?.value || "").trim();
  const customerEmail = (customerEmailInput?.value || "").trim();

  if (!rating) {
    alert("Please select a rating before sending your feedback.");
    return;
  }

  try {
    if (sendFeedbackBtn) {
      sendFeedbackBtn.disabled = true;
      sendFeedbackBtn.textContent = "Sending…";
    }

    console.log("[portal] Submitting feedback", {
      businessId: currentBusinessId,
      rating,
      message,
      customerName,
      customerEmail,
    });

    const feedbackCollection = collection(
      db,
      "businessProfiles",
      currentBusinessId,
      "feedback"
    );

    await addDoc(feedbackCollection, {
      businessId: currentBusinessId,
      rating,
      message,
      customerName: customerName || null,
      customerEmail: customerEmail || null,
      sentimentScore: Number((Number(rating || 0) - 3).toFixed(2)),
      type: "private",
      source: "portal",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    console.log("[portal] Feedback submitted successfully");
    showThankYouState();
  } catch (err) {
    console.error("[portal] Error while submitting feedback", err);
    alert(
      "We could not send your feedback (" +
        (err.code || err.message || "unknown error") +
        "). Please try again in a moment."
    );
  } finally {
    if (sendFeedbackBtn) {
      sendFeedbackBtn.disabled = false;
      sendFeedbackBtn.textContent = "Send feedback";
    }
  }
}

if (feedbackForm) {
  feedbackForm.addEventListener("submit", handleFeedbackSubmit);
}

// ----- INIT -----
showOwnerToolbarIfNeeded();
loadBusinessProfile();
