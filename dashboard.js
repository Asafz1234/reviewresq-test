// =========================
// dashboard.js — CLEAN VERSION
// =========================

// -------- IMPORTS --------
import {
  auth,
  onAuthStateChanged,
  signOut,
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  getDocs,
  where,
  uploadLogoAndGetURL,
} from "./firebase.js";

// -------- DOM ELEMENTS --------

// Top bar
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");

// Banners
const globalBanner = document.getElementById("globalBanner");
const globalBannerText = document.getElementById("globalBannerText");
const bannerDismissBtn = document.getElementById("bannerDismiss");

// Containers
const emptyState = document.getElementById("emptyState");
const dashContent = document.getElementById("dashContent");

// Business profile
const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizStatusBadge = document.getElementById("bizStatusBadge");
const bizLogoImg = document.getElementById("bizLogoImg");
const bizLogoInitials = document.getElementById("bizLogoInitials");
const bizCategoryText = document.getElementById("bizCategoryText");
const bizUpdatedAt = document.getElementById("bizUpdatedAt");
const googleLinkDisplay = document.getElementById("googleLinkDisplay");
const bindBizNameEls = document.querySelectorAll('[data-bind="bizName"]');
const bindBizCategoryEls = document.querySelectorAll('[data-bind="bizCategory"]');
const bindBizStatusEls = document.querySelectorAll('[data-bind="bizStatus"]');
const bindBizUpdatedEls = document.querySelectorAll('[data-bind="bizUpdated"]');

// Customer portal block
const portalLinkInput = document.getElementById("portalLinkInput");
const portalCopyBtn = document.getElementById("portalCopyBtn");
const portalPreviewButtons = document.querySelectorAll('[data-action="portal-preview"]');
const portalOpenButtons = document.querySelectorAll('[data-action="portal-open"]');
const planBadge = document.getElementById("planBadge");
const startTrialBtn = document.getElementById("startTrialBtn");

// Stats
const averageRatingValue = document.getElementById("averageRatingValue");
const totalReviewsValue = document.getElementById("totalReviewsValue");
const privateFeedbackValue = document.getElementById("privateFeedbackValue");

// Table
const recentFeedbackBody = document.getElementById("recentFeedbackBody");
const feedbackEmptyState = document.getElementById("feedbackEmptyState");
let currentBusinessName = "Your business";
let businessJoinedAt = null;
let lastPortalUrl = "";
let currentUser = null;
const feedbackModal = document.getElementById("feedbackModal");
const feedbackModalClose = document.getElementById("feedbackModalClose");
const modalDate = document.getElementById("modalDate");
const modalCustomer = document.getElementById("modalCustomer");
const modalRating = document.getElementById("modalRating");
const modalType = document.getElementById("modalType");
const modalBusiness = document.getElementById("modalBusiness");
const modalMessage = document.getElementById("modalMessage");
const modalPhone = document.getElementById("modalPhone");
const modalEmail = document.getElementById("modalEmail");
const modalNotes = document.getElementById("modalNotes");
const modalNextAction = document.getElementById("modalNextAction");
const reviewTotalsNote = document.getElementById("reviewTotalsNote");
const logoUploadInput = document.getElementById("dashLogoUpload");
const logoUploadPreview = document.getElementById("logoUploadPreview");
const logoUploadPlaceholder = document.getElementById("logoUploadPlaceholder");
const logoUploadStatus = document.getElementById("logoUploadStatus");

// -------- HELPERS --------

// Show banner
function showBanner(text, type = "info") {
  if (!globalBanner) return;
  globalBannerText.textContent = text;
  globalBanner.className = "global-banner visible " + type;
}

// Hide banner
function hideBanner() {
  if (!globalBanner) return;
  globalBanner.className = "global-banner";
  globalBannerText.textContent = "";
}

if (bannerDismissBtn) {
  bannerDismissBtn.onclick = hideBanner;
}

// Create initials from business name
function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "B";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Format timestamps with an English locale for consistency
function formatDate(ts) {
  if (!ts) return "just now";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Mirror text content to multiple bound elements
function syncText(collection, value) {
  collection.forEach((el) => {
    if (el) el.textContent = value;
  });
}

// Update logo preview in the branding card
function updateLogoPreview(url, bizName) {
  if (!logoUploadPlaceholder || !logoUploadPreview || !logoUploadStatus) return;

  const initials = initialsFromName(bizName);
  logoUploadPlaceholder.textContent = initials;

  if (url) {
    logoUploadPreview.src = url;
    logoUploadPreview.alt = `${bizName} logo`;
    logoUploadPreview.style.display = "block";
    logoUploadPlaceholder.style.display = "none";
    logoUploadStatus.textContent = "Logo saved. Upload a new file to replace it.";
  } else {
    logoUploadPreview.removeAttribute("src");
    logoUploadPreview.style.display = "none";
    logoUploadPlaceholder.style.display = "flex";
    logoUploadStatus.textContent =
      "PNG or JPG works best. Upload a square image for the cleanest result.";
  }
}

async function uploadLogoForUser(file) {
  if (!file || !currentUser) return;

  try {
    if (logoUploadStatus) logoUploadStatus.textContent = "Uploading logo…";

    const url = await uploadLogoAndGetURL(file, currentUser.uid);

    await setDoc(
      doc(db, "businessProfiles", currentUser.uid),
      { logoUrl: url, updatedAt: new Date() },
      { merge: true }
    );

    if (bizLogoImg) {
      bizLogoImg.src = url;
      bizLogoImg.alt = `${currentBusinessName} logo`;
      bizLogoImg.style.display = "block";
    }
    if (bizLogoInitials) bizLogoInitials.style.display = "none";

    updateLogoPreview(url, currentBusinessName);

    if (logoUploadStatus)
      logoUploadStatus.textContent = "Logo saved. Upload a new file to replace it.";
  } catch (err) {
    console.error("Logo upload failed:", err);
    if (logoUploadStatus)
      logoUploadStatus.textContent = "Could not upload logo. Please try again with a smaller image.";
    alert("We could not upload your logo. Please try again with a smaller image.");
  } finally {
    if (logoUploadInput) logoUploadInput.value = "";
  }
}

// Build an owner-only preview URL without affecting the shareable link
function buildOwnerPreviewUrl(baseUrl) {
  const preview = new URL(baseUrl);
  preview.searchParams.set("ownerPreview", "1");
  return preview.toString();
}

function formatDisplayPortalUrl(fullUrl, businessId) {
  try {
    const urlObj = new URL(fullUrl);
    if (businessId) {
      return new URL(`/p/${businessId}`, urlObj.origin).toString();
    }

    if (urlObj.search) {
      urlObj.search = "";
    }
    return urlObj.toString();
  } catch (err) {
    console.warn("Could not format portal URL", err);
    return fullUrl;
  }
}

function renderRatingLabel(rating) {
  return rating ? `${rating}★` : "–";
}
// =========================
// AUTH + LOAD BUSINESS PROFILE
// =========================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  if (userEmailDisplay) {
    userEmailDisplay.textContent = user.email || "My account";
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await signOut(auth);
      window.location.href = "/auth.html";
    };
  }

  currentUser = user;

  try {
    const profile = await loadBusinessProfile(user);

    // If onboarding is complete, load stats + feedback in parallel for faster render
    if (profile) {
      await loadFeedbackAndStats(user.uid);
    }
  } catch (err) {
    console.error("Dashboard load error:", err);
    showBanner("We had trouble loading your dashboard. Please refresh.", "warn");
  }
});


// =========================
// LOAD BUSINESS PROFILE
// =========================

async function loadBusinessProfile(user) {
  const ref = doc(db, "businessProfiles", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // No onboarding yet → show empty state
    if (emptyState) emptyState.classList.add("visible");
    if (dashContent) dashContent.style.display = "none";

    showBanner("Finish onboarding so we can build your ReviewResQ portal.", "info");
    return null;
  }

  // Show dashboard
  if (emptyState) emptyState.classList.remove("visible");
  if (dashContent) dashContent.style.display = "";

  hideBanner();

  const data = snap.data();

  const name = data.businessName || "Your business";
  const category = data.category || data.industry || "Business category";
  const googleReviewLink = data.googleReviewLink || "";
  const logoUrl = data.logoUrl || "";
  const updatedAt = data.updatedAt;
  const plan = data.plan || "basic";
  businessJoinedAt = data.createdAt || data.subscriptionStart || updatedAt || null;
  currentBusinessName = name;

  // === Fill UI ===

  if (bizNameDisplay) bizNameDisplay.textContent = name;
  syncText(bindBizNameEls, name);
  if (bizCategoryText) bizCategoryText.textContent = category;
  syncText(bindBizCategoryEls, category);

  const formattedDate = formatDate(updatedAt);
  if (bizUpdatedAt) bizUpdatedAt.textContent = formattedDate;
  syncText(bindBizUpdatedEls, formattedDate);

  // Status badge
  const statusText = "Live · Ready";
  if (bizStatusBadge) {
    bizStatusBadge.textContent = statusText;
  }
  syncText(bindBizStatusEls, statusText);

  // Logo
  if (logoUrl && bizLogoImg) {
    bizLogoImg.src = logoUrl;
    bizLogoImg.alt = `${name} logo`;
    bizLogoImg.style.display = "block";
    if (bizLogoInitials) bizLogoInitials.style.display = "none";
  } else {
    if (bizLogoImg) bizLogoImg.style.display = "none";
    if (bizLogoInitials) {
      bizLogoInitials.textContent = initialsFromName(name);
      bizLogoInitials.style.display = "flex";
    }
  }

  updateLogoPreview(logoUrl, name);

  // Google review link
  if (googleLinkDisplay) {
    if (googleReviewLink) {
      googleLinkDisplay.href = googleReviewLink;
      googleLinkDisplay.textContent = googleReviewLink;
    } else {
      googleLinkDisplay.href = "#";
      googleLinkDisplay.textContent = "Not set yet";
    }
  }

  // Plan badge
  if (planBadge) {
    planBadge.textContent = plan === "advanced" ? "Advanced plan" : "Basic plan";
  }

  // === Build Portal URL ===
  let portalPath =
    data.portalPath || `/portal.html?bid=${encodeURIComponent(user.uid)}`;

  const portalUrl = new URL(portalPath, window.location.origin).toString();
  lastPortalUrl = portalUrl;

  setPortalLinkInUI(portalUrl, user.uid);

  // Trial button (placeholder)
  if (startTrialBtn) {
    startTrialBtn.onclick = () => {
      alert("Advanced plan will be available soon.");
    };
  }

  return data;
}


// =========================
// SET PORTAL LINK IN UI
// =========================

function setPortalLinkInUI(url, businessId) {
  const displayValue = formatDisplayPortalUrl(url, businessId);
  if (portalLinkInput) {
    portalLinkInput.value = displayValue;
    portalLinkInput.title = url;
    portalLinkInput.dataset.fullUrl = url;
  }

  const previewUrl = buildOwnerPreviewUrl(url);

  const openPreview = () => window.open(previewUrl, "_blank", "noopener");
  const openShared = () => window.open(url, "_blank", "noopener");

  portalPreviewButtons.forEach((btn) => (btn.onclick = openPreview));
  portalOpenButtons.forEach((btn) => (btn.onclick = openShared));

  if (portalCopyBtn) {
    portalCopyBtn.onclick = async () => {
      const valueToCopy = portalLinkInput?.dataset.fullUrl || url;
      try {
        await navigator.clipboard.writeText(valueToCopy);
        const original = portalCopyBtn.textContent;
        portalCopyBtn.textContent = "Copied!";
        setTimeout(() => (portalCopyBtn.textContent = original), 1200);
      } catch {
        alert("Could not copy. Please copy manually.");
      }
    };
  }
}
// =========================
// LOAD FEEDBACK + STATS
// =========================

async function loadFeedbackAndStats(uid) {
  if (!recentFeedbackBody || !feedbackEmptyState) return;

  feedbackEmptyState.style.display = "block";
  recentFeedbackBody.innerHTML = "";

  let publicReviews = 0;
  let privateFeedback = 0;
  let ratingSum = 0;
  const feedbackRows = [];

  try {
    const ref = collection(db, "feedback");
    const q = query(ref, where("businessId", "==", uid));
    const snap = await getDocs(q);

    if (snap.empty) {
      updateStatsUI({ publicReviews, privateFeedback, ratingSum });
      updateReviewTotalsNote(publicReviews);
      return;
    }

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const rating = d.rating || 0;
      const type = (d.type || "").toLowerCase();
      const isPublic = type === "public" || type === "google" || rating >= 4;

      if (isPublic) {
        publicReviews += 1;
        ratingSum += rating;
      } else {
        privateFeedback += 1;
      }

      if (feedbackRows.length < 20) {
        feedbackRows.push({
          ...d,
          rating,
          type: isPublic ? "Public" : "Private",
          id: docSnap.id,
        });
      }
    });

    const sortedRows = feedbackRows.sort((a, b) => {
      const aTs = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
      const bTs = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
      return bTs - aTs;
    });

    renderFeedbackTable(sortedRows);
    updateStatsUI({ publicReviews, privateFeedback, ratingSum });
    updateReviewTotalsNote(publicReviews);
  } catch (err) {
    console.error("Feedback load error:", err);

    feedbackEmptyState.style.display = "block";
    feedbackEmptyState.textContent = "Could not load feedback.";
    updateStatsUI({ publicReviews: 0, privateFeedback: 0, ratingSum: 0 });
  }
}

function updateStatsUI({ publicReviews, privateFeedback, ratingSum }) {
  if (totalReviewsValue) totalReviewsValue.textContent = String(publicReviews);
  if (privateFeedbackValue) privateFeedbackValue.textContent = String(privateFeedback);

  const average = publicReviews > 0 ? ratingSum / publicReviews : 0;
  if (averageRatingValue)
    averageRatingValue.textContent = publicReviews ? average.toFixed(1) : "–";
}

function updateReviewTotalsNote(publicReviews) {
  if (!reviewTotalsNote) return;
  const joinedText = businessJoinedAt ? formatDate(businessJoinedAt) : "you joined";
  const suffix = businessJoinedAt ? `since ${joinedText}` : "since you joined ReviewResQ";
  reviewTotalsNote.textContent = `${publicReviews} public reviews ${suffix}`;
}

function renderFeedbackTable(rows) {
  if (!recentFeedbackBody || !feedbackEmptyState) return;

  if (!rows.length) {
    feedbackEmptyState.style.display = "block";
    return;
  }

  feedbackEmptyState.style.display = "none";
  recentFeedbackBody.innerHTML = "";

  rows.forEach((d) => {
    const tr = document.createElement("tr");
    tr.dataset.feedbackId = d.id;

    const tdDate = document.createElement("td");
    tdDate.textContent = formatDate(d.createdAt);
    tr.appendChild(tdDate);

    const tdName = document.createElement("td");
    tdName.textContent = d.customerName || "Customer";
    tr.appendChild(tdName);

    const tdRating = document.createElement("td");
    const span = document.createElement("span");
    span.className = "rating-pill " + (d.rating >= 4 ? "rating-high" : "rating-low");
    span.textContent = renderRatingLabel(d.rating);
    tdRating.appendChild(span);
    tr.appendChild(tdRating);

    const tdType = document.createElement("td");
    tdType.textContent = d.type || "Private";
    tr.appendChild(tdType);

    const tdMsg = document.createElement("td");
    tdMsg.textContent = d.message || "—";
    tr.appendChild(tdMsg);

    tr.addEventListener("click", () => openFeedbackModal(d));

    recentFeedbackBody.appendChild(tr);
  });
}

function openFeedbackModal(feedback) {
  if (!feedbackModal) return;

  if (modalDate) modalDate.textContent = formatDate(feedback.createdAt);
  if (modalCustomer) modalCustomer.textContent = feedback.customerName || "Customer";
  if (modalRating) modalRating.textContent = renderRatingLabel(feedback.rating);
  if (modalType) modalType.textContent = feedback.type || "Private";
  if (modalBusiness) modalBusiness.textContent = feedback.businessName || currentBusinessName;
  if (modalMessage) modalMessage.textContent = feedback.message || "—";
  if (modalPhone) modalPhone.textContent = feedback.customerPhone || "Not provided";
  if (modalEmail) modalEmail.textContent = feedback.customerEmail || "Not provided";
  if (modalNotes) modalNotes.textContent = feedback.internalNotes || "No notes yet";
  if (modalNextAction) modalNextAction.textContent = feedback.nextAction || "To review";

  feedbackModal.classList.add("visible");
  feedbackModal.setAttribute("aria-hidden", "false");
}

function closeFeedbackModal() {
  if (!feedbackModal) return;
  feedbackModal.classList.remove("visible");
  feedbackModal.setAttribute("aria-hidden", "true");
}

if (feedbackModalClose) {
  feedbackModalClose.addEventListener("click", closeFeedbackModal);
}

if (feedbackModal) {
  feedbackModal.addEventListener("click", (event) => {
    if (event.target === feedbackModal) closeFeedbackModal();
  });
}

if (logoUploadInput) {
  logoUploadInput.addEventListener("change", () => {
    const file = logoUploadInput.files?.[0];
    if (!file) return;
    if (!currentUser) {
      alert("Please sign in again to upload a logo.");
      return;
    }
    uploadLogoForUser(file);
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeFeedbackModal();
  }
});
