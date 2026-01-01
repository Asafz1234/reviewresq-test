// portal.js
// Loads business profile into the portal and handles feedback submission without client Firestore access

const API_BASE = "/api";

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

ratingButtons.forEach((btn) => {
  btn.disabled = true;
  btn.classList.add("disabled");
});

const lowPanel = document.getElementById("lowPanel");
const highPanel = document.getElementById("highPanel");

const feedbackForm = document.getElementById("feedbackForm");
const feedbackMessageInput = document.getElementById("feedbackMessage");
const customerNameInput = document.getElementById("customerNameInput");
const customerEmailInput = document.getElementById("customerEmailInput");
const contactFieldsRow = document.getElementById("contactFields");
const sendFeedbackBtn = document.getElementById("sendFeedbackBtn");

const thankyouCopy = document.getElementById("thankyouCopy");
const portalHeadlineText = document.getElementById("portalHeadlineText");
const portalSubheadlineText = document.getElementById("portalSubheadlineText");
const lowCtaLabel = document.getElementById("lowCtaLabel");
const highCtaButton = document.getElementById("highCtaButton");
const highCtaLabel = document.getElementById("highCtaLabel");
const highDefaultCopy = document.getElementById("highDefaultCopy");
const fiveStarCopy = document.getElementById("fiveStarCopy");
const redirectHint = document.getElementById("redirectHint");
const googleLinkErrorMessage = document.getElementById("googleLinkErrorMessage");
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
const inviteTokenParam = urlParams.get("t") || urlParams.get("token") || "";
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
let businessName = "";
let businessTagline = "";
let portalSettings = null;
let businessLogoUrl = null;
let googleReviewUrl = "";
let didRedirect = false;
let inviteToken = inviteTokenParam || "";
let resolvedCustomerId = null;
let brandingColor = "#2563eb";
let businessSnapshot = null;
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

function buildFunctionsUrl(path, params = {}) {
  const origin = window?.location?.origin || "";
  const url = new URL(`${API_BASE}${path}`, origin || undefined);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, value);
  });
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let data = {};
  try {
    data = await response.json();
  } catch (err) {
    data = {};
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.message || data?.error || "Request failed");
    error.code = data?.code || response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function fetchPortalContext(businessId, token) {
  const url = buildFunctionsUrl("/portalContext");
  return fetchJson(url, {
    method: "POST",
    body: JSON.stringify({ businessId, t: token }),
  });
}

async function submitFeedbackToBackend(payload) {
  const url = `${API_BASE}/portalSubmit`;
  return fetchJson(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function setContactFieldsVisible(isVisible) {
  if (!contactFieldsRow) return;

  contactFieldsRow.hidden = !isVisible;
  if (!isVisible) {
    if (customerNameInput) customerNameInput.value = "";
    if (customerEmailInput) customerEmailInput.value = "";
  }
}

function handleMissingBusinessData(message) {
  setRatingEnabled(false);
  if (sendFeedbackBtn) {
    sendFeedbackBtn.disabled = true;
  }
  setPortalStatus("error", message);
}

function safeRedirect(url) {
  try {
    if (window?.location?.assign) {
      window.location.assign(url);
      return;
    }
  } catch (err) {
    console.warn("[portal] location.assign failed, falling back", err);
  }

  window.location.href = url;
}

function setGoogleLinkError(isVisible, message) {
  if (!googleLinkErrorMessage) return;

  googleLinkErrorMessage.textContent =
    message ||
    "Google review link is not configured. Please ask the owner to update their profile.";
  googleLinkErrorMessage.hidden = !isVisible;
}

function clearRedirectTimer() {
  // auto-redirect behavior has been removed; this is a no-op retained for safety
}

function resetRedirectFlow() {
  clearRedirectTimer();
  didRedirect = false;
}

function toggleFiveStarUi(isFiveStar) {
  if (portalEl) {
    portalEl.classList.toggle("five-star-flow", isFiveStar);
  }

  if (highDefaultCopy) highDefaultCopy.hidden = isFiveStar;
  if (fiveStarCopy) fiveStarCopy.hidden = !isFiveStar;
  if (redirectHint) redirectHint.hidden = !isFiveStar;
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
    const initials = (businessName || "")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    bizLogoInitials.textContent = initials || businessName?.slice(0, 2)?.toUpperCase() || "";
    bizLogoInitials.style.display = initials ? "flex" : "none";
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

  if (currentRating && currentRating < 5) {
    portalEl.classList.add("low-rating");
  } else if (currentRating === 5) {
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

function showBrandingFallbackNotice() {
  if (!portalStatus) return;
  portalStatus.textContent = "Branding defaults applied (owner/internal notice).";
  portalStatus.hidden = false;
  portalStatus.classList.add("notice");
  portalEl?.classList.remove("is-loading", "has-error");
}

function updateMessageRequirement() {
  if (!feedbackMessageInput) return;
  const requireMessage = currentRating > 0 && currentRating <= 2;
  feedbackMessageInput.required = requireMessage;
  feedbackMessageInput.placeholder = requireMessage
    ? "Tell us what happened so we can help"
    : "Optional note (helps the team improve)";
}

function setRatingEnabled(isEnabled) {
  ratingButtons.forEach((btn) => {
    btn.disabled = !isEnabled;
    btn.classList.toggle("disabled", !isEnabled);
  });

  if (highCtaButton) {
    const hasGoogleLink = Boolean(googleReviewUrl);
    const shouldDisableHighCta = !isEnabled || !hasGoogleLink;
    highCtaButton.disabled = shouldDisableHighCta;
    highCtaButton.classList.toggle("disabled", shouldDisableHighCta);
  }
}

function updateHighRatingUi() {
  const isFiveStar = currentRating === 5;

  toggleFiveStarUi(isFiveStar);

  if (!isFiveStar) {
    setGoogleLinkError(false);
    clearRedirectTimer();
  } else if (!googleReviewUrl) {
    setGoogleLinkError(true);
  }
}

function startFiveStarRedirectFlow() {
  const googleUrl = (googleReviewUrl || "").trim();

  toggleFiveStarUi(true);

  if (!googleUrl) {
    if (redirectHint) redirectHint.hidden = true;
    setGoogleLinkError(true);
    return;
  }

  setGoogleLinkError(false);
}

function resetRating() {
  currentRating = 0;
  if (!portalEl) return;
  portalEl.classList.remove("has-rating", "low-rating", "high-rating", "feedback-sent");
  if (currentRatingValue) currentRatingValue.textContent = "–";

  ratingButtons.forEach((btn) => btn.classList.remove("selected"));

  resetRedirectFlow();
  toggleFiveStarUi(false);
  setGoogleLinkError(false);
  updateMessageRequirement();
}

function showThankYouState() {
  if (portalEl) {
    portalEl.classList.add("feedback-sent");
  }

  if (feedbackForm) {
    feedbackForm.reset();
  }
}

function redirectToGoogleReview(selectedRating = null) {
  const googleUrl = (googleReviewUrl || "").trim();

  if (!googleUrl) {
    const missingMessage =
      "Google review link is not configured. Please ask the owner to update their profile.";
    setGoogleLinkError(true, missingMessage);
    handleMissingBusinessData(
      missingMessage
    );
    console.error("[portal] Attempted redirect without googleReviewLink", {
      businessId,
      snapshot: businessSnapshot?.data?.() || businessSnapshot,
      selectedRating,
    });
    return;
  }

  if (didRedirect) return;
  didRedirect = true;
  clearRedirectTimer();

  const currentBusinessId = businessId || getBusinessIdFromUrl();
  if (currentBusinessId) {
    const payload = {
      businessId: currentBusinessId,
      rating: selectedRating,
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
        fetch(trackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("[portal] Failed to record review click", err);
    }
  }

  safeRedirect(googleUrl);
}

// ----- LOAD BUSINESS PROFILE -----

function buildDefaultPortalSettings(accentColor = brandingColor || "#2563eb") {
  return {
    primaryColor: accentColor,
    accentColor: "#7c3aed",
    backgroundStyle: "gradient",
    headline: "How was your experience today?",
    subheadline: "Your feedback helps us improve and keeps our team on point.",
    ctaLabelHighRating: "Leave a Google review",
    ctaLabelLowRating: "Send private feedback",
    thankYouTitle: "Thank you for the feedback!",
    thankYouBody: "We read every note and follow up where needed.",
  };
}

function applyPortalSettingsFromPayload(settings = null) {
  const accentColor = brandingColor || "#2563eb";
  portalSettings = { ...buildDefaultPortalSettings(accentColor), ...(settings || {}) };
  if (!portalSettings.primaryColor) {
    portalSettings.primaryColor = accentColor;
  }
  renderBusinessIdentity();
  applyPortalSettings();
}

function applyPortalSettings() {
  if (!portalSettings) return;
  const root = document.documentElement;
  const accentColor = portalSettings.primaryColor || brandingColor || "#2563eb";
  if (accentColor) root.style.setProperty("--accent", accentColor);
  const strongAccent = portalSettings.accentColor || accentColor;
  if (strongAccent) root.style.setProperty("--accent-strong", strongAccent);
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

async function resolveInviteTokenOnLoad() {
  setPortalStatus("loading", "Loading your invite…");

  const requestedBusinessId = getBusinessIdFromUrl();
  if (!requestedBusinessId || !inviteToken) {
    handleMissingBusinessData(
      "This invite link is missing required details. Please ask the business owner to resend it."
    );
    return;
  }

  try {
    const data = await fetchPortalContext(requestedBusinessId, inviteToken);

    businessId = data.businessId || requestedBusinessId;
    businessName = (data.businessName || "Our Business").trim();
    businessTagline = data.businessTagline || "";
    businessLogoUrl =
      data.businessLogoUrl || data.logoUrl || data.portalSettings?.businessLogoUrl || null;
    googleReviewUrl = data.googleReviewLink || "";
    brandingColor = data.brandingColor || data.brandColor || brandingColor;
    resolvedCustomerId = data.customerId || null;

    if (bizNameDisplay) bizNameDisplay.textContent = businessName;
    if (bizSubtitleDisplay) bizSubtitleDisplay.textContent = businessTagline || "";
    if (customerNameInput && data.customerName) {
      customerNameInput.value = data.customerName;
    }
    if (customerEmailInput && data.customerEmail) {
      customerEmailInput.value = data.customerEmail;
    }

    setRatingEnabled(true);
    setContactFieldsVisible(!data.customerName && !data.customerEmail);

    if (!googleReviewUrl) {
      setGoogleLinkError(true);
    }

    document.title = `${businessName} • Feedback Portal`;
    applyPortalSettingsFromPayload(data.portalSettings || {});
    businessSnapshot = data;
    setPortalStatus("ready");
  } catch (err) {
    console.error("[portal] failed to resolve invite", err);
    const isPermission = err?.code === "permission-denied" || err?.code === 403;
    const errorCode = err?.code || err?.data?.code;
    const friendlyMessage =
      errorCode === "expired"
        ? "This link has expired. Please request a new one from the business."
        : errorCode === "used"
          ? "This link has already been used. Please request a fresh one from the business."
          : isPermission
            ? "This link has expired or is invalid. Please request a new one from the business."
            : err?.message ||
              "We could not load this invite. Please ask the business owner for a new link.";
    handleMissingBusinessData(friendlyMessage);
  }
}

// ----- RATING HANDLERS -----
ratingButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;

    const value = Number(btn.dataset.rating);
    if (!value) return;
    resetRedirectFlow();
    currentRating = value;
    updateMessageRequirement();
    setPortalClasses();
    updateHighRatingUi();

    if (value === 5) {
      startFiveStarRedirectFlow();
    }
  });
});

if (highCtaButton) {
  highCtaButton.addEventListener("click", () => {
    clearRedirectTimer();
    redirectToGoogleReview(currentRating || null);
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
    setPortalStatus(
      "error",
      "We couldn’t send your feedback because this link is missing the business id. Please try the original link again."
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

  if (rating <= 2 && !message) {
    alert("Please share a few details so we can make things right.");
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

    const payload = {
      businessId: currentBusinessId,
      rating,
      feedbackText: message,
    };

    if (inviteToken) payload.token = inviteToken;
    if (customerName) payload.customerName = customerName;
    if (customerEmail) payload.customerEmail = customerEmail;

    const result = await submitFeedbackToBackend(payload);
    if (result?.customerId) {
      resolvedCustomerId = result.customerId;
    }

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
updateMessageRequirement();
showOwnerToolbarIfNeeded();
if (inviteToken) {
  resolveInviteTokenOnLoad();
} else {
  handleMissingBusinessData(
    "This feedback link is missing a token. Please request a new one from the business owner."
  );
}
