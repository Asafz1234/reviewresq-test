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
  serverTimestamp,
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
const upgradeCtaBtn = document.getElementById("upgradeCtaBtn");
const editProfileBtn = document.getElementById("editProfileBtn");
const editModal = document.getElementById("editProfileModal");
const editForm = document.getElementById("editProfileForm");
const editClose = document.getElementById("editModalClose");
const editCancelBtn = document.getElementById("editCancelBtn");

const editFields = {
  name: document.getElementById("editBizName"),
  category: document.getElementById("editBizCategory"),
  phone: document.getElementById("editBizPhone"),
  email: document.getElementById("editBizEmail"),
  website: document.getElementById("editBizWebsite"),
  plan: document.getElementById("editPlanSelect"),
};

// Stats
const averageRatingValue = document.getElementById("averageRatingValue");
const totalReviewsValue = document.getElementById("totalReviewsValue");
const privateFeedbackValue = document.getElementById("privateFeedbackValue");
const googleAverageValue = document.getElementById("googleAverageValue");
const badAverageValue = document.getElementById("badAverageValue");
const totalReviewsSinceValue = document.getElementById("totalReviewsSinceValue");

// Table
const recentFeedbackBody = document.getElementById("recentFeedbackBody");
const feedbackEmptyState = document.getElementById("feedbackEmptyState");
let currentBusinessName = "Your business";
let businessJoinedAt = null;
let lastPortalUrl = "";
let currentUser = null;
let currentProfile = {};

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

function showBanner(text, type = "info") {
  if (!globalBanner) return;
  globalBannerText.textContent = text;
  globalBanner.className = "global-banner visible " + type;
}

function hideBanner() {
  if (!globalBanner) return;
  globalBanner.className = "global-banner";
  globalBannerText.textContent = "";
}

if (bannerDismissBtn) {
  bannerDismissBtn.onclick = hideBanner;
}

function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "B";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(ts) {
  if (!ts) return "just now";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function syncText(collection, value) {
  collection.forEach((el) => {
    if (el) el.textContent = value;
  });
}

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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function uploadLogoForUser(file) {
  if (!file || !currentUser) return;

  // הגבלת גודל – כדי שלא נעמיס על Firestore
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    if (logoUploadStatus) {
      logoUploadStatus.textContent =
        "Please choose an image under 2MB for best results.";
    }
    showBanner("Logo too large. Pick a smaller image (under 2MB).", "warn");
    if (logoUploadInput) logoUploadInput.value = "";
    return;
  }

  try {
    if (logoUploadStatus) logoUploadStatus.textContent = "Saving logo…";

    // במקום Firebase Storage – קוראים את הקובץ כ-data URL ושומרים אותו ישירות ב-Firestore
    const logoUrlToSave = await fileToDataUrl(file);

    await setDoc(
      doc(db, "businessProfiles", currentUser.uid),
      {
        logoUrl: logoUrlToSave,
        updatedAt: serverTimestamp(),
        logoUploadFallback: true, // מציין שאנחנו בשיטת ה-fallback
      },
      { merge: true }
    );

    // עדכון לוגו בדשבורד
    if (bizLogoImg) {
      bizLogoImg.src = logoUrlToSave;
      bizLogoImg.alt = `${currentBusinessName} logo`;
      bizLogoImg.style.display = "block";
    }
    if (bizLogoInitials) bizLogoInitials.style.display = "none";

    // עדכון כרטיס ה-Branding
    updateLogoPreview(logoUrlToSave, currentBusinessName);

    if (logoUploadStatus) {
      logoUploadStatus.textContent =
        "Logo saved. Upload a new file to replace it.";
    }
  } catch (err) {
    console.error("Logo upload failed:", err);
    if (logoUploadStatus) {
      logoUploadStatus.textContent =
        "Could not upload logo. Please try again with a smaller image.";
    }
    showBanner("We could not upload your logo. Please try again.", "warn");
    updateLogoPreview(null, currentBusinessName);
  } finally {
    if (logoUploadInput) logoUploadInput.value = "";
  }
}

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
    if (urlObj.search) urlObj.search = "";
    return urlObj.toString();
  } catch (err) {
    console.warn("Could not format portal URL", err);
    return fullUrl;
  }
}

function renderRatingLabel(rating) {
  return rating ? `${rating}★` : "–";
}

function populateEditForm(data = {}) {
  if (!editForm) return;

  editFields.name.value = data.businessName || "";
  editFields.category.value = data.category || "";
  editFields.phone.value = data.phone || "";
  editFields.email.value = data.contactEmail || "";
  editFields.website.value = data.website || "";
  editFields.plan.value = data.plan || "basic";
}

function toggleEditModal(show) {
  if (!editModal) return;
  editModal.classList.toggle("visible", show);
  editModal.setAttribute("aria-hidden", show ? "false" : "true");
}
async function saveProfileEdits(event) {
  event?.preventDefault();
  if (!currentUser) return;

  const payload = {
    businessName: editFields.name?.value.trim() || null,
    category: editFields.category?.value.trim() || null,
    phone: editFields.phone?.value.trim() || null,
    contactEmail: editFields.email?.value.trim() || null,
    website: editFields.website?.value.trim() || null,
    plan: editFields.plan?.value || "basic",
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "businessProfiles", currentUser.uid), payload, { merge: true });
    showBanner("Business details updated.", "success");
    toggleEditModal(false);
    await loadBusinessProfile(currentUser);
  } catch (err) {
    console.error("Profile update failed", err);
    showBanner("Could not save changes. Please try again.", "warn");
  }
}

async function setPlanToAdvanced() {
  if (!currentUser) return;
  await setDoc(
    doc(db, "businessProfiles", currentUser.uid),
    { plan: "advanced", updatedAt: serverTimestamp() },
    { merge: true }
  );
  showBanner("Advanced plan enabled. Enjoy upgraded features!", "success");
  if (planBadge) planBadge.textContent = "Advanced plan";
  if (editFields.plan) editFields.plan.value = "advanced";
  currentProfile.plan = "advanced";
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

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await signOut(auth);
      window.location.href = "/auth.html";
    };
  }

  currentUser = user;

  try {
    const profile = await loadBusinessProfile(user);
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
    if (emptyState) emptyState.classList.add("visible");
    if (dashContent) dashContent.style.display = "none";
    showBanner("Finish onboarding so we can build your ReviewResQ portal.", "info");
    return null;
  }

  if (emptyState) emptyState.classList.remove("visible");
  if (dashContent) dashContent.style.display = "";

  hideBanner();

  const data = snap.data();

  const name = data.businessName || "Your business";
  const category = data.category || data.industry || "Business category";
  const logoUrl = data.logoUrl || "";
  const updatedAt = data.updatedAt;
  const plan = data.plan || "basic";

  businessJoinedAt = data.createdAt || data.subscriptionStart || updatedAt || null;
  currentBusinessName = name;

  currentProfile = {
    businessName: name,
    category,
    phone: data.phone || "",
    contactEmail: data.contactEmail || "",
    website: data.website || "",
    plan,
  };

  if (bizNameDisplay) bizNameDisplay.textContent = name;
  syncText(bindBizNameEls, name);

  if (bizCategoryText) bizCategoryText.textContent = category;
  syncText(bindBizCategoryEls, category);

  const formattedDate = formatDate(updatedAt);
  if (bizUpdatedAt) bizUpdatedAt.textContent = formattedDate;
  syncText(bindBizUpdatedEls, formattedDate);

  const statusText = "Live · Ready";
  if (bizStatusBadge) bizStatusBadge.textContent = statusText;
  syncText(bindBizStatusEls, statusText);

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

  if (planBadge) {
    planBadge.textContent = plan === "advanced" ? "Advanced plan" : "Basic plan";
  }

  populateEditForm(currentProfile);

  let portalPath = data.portalPath || `/portal.html?bid=${encodeURIComponent(user.uid)}`;
  const portalUrl = new URL(portalPath, window.location.origin).toString();
  lastPortalUrl = portalUrl;

  setPortalLinkInUI(portalUrl, user.uid);

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
  let googleReviews = 0;
  let googleRatingSum = 0;
  let badReviews = 0;
  let badRatingSum = 0;
  let publicReviewsSinceJoin = 0;

  const feedbackRows = [];

  const joinMs = businessJoinedAt
    ? businessJoinedAt.toMillis
      ? businessJoinedAt.toMillis()
      : new Date(businessJoinedAt).getTime()
    : null;

  const toMillis = (ts) =>
    ts?.toMillis ? ts.toMillis() : new Date(ts || 0).getTime();

  try {
    const ref = collection(db, "feedback");
    const q = query(ref, where("businessId", "==", uid));
    const snap = await getDocs(q);

    if (snap.empty) {
      updateStatsUI({
        publicReviews,
        privateFeedback,
        ratingSum,
        googleReviews,
        googleRatingSum,
        badReviews,
        badRatingSum,
        publicReviewsSinceJoin,
      });
      updateReviewTotalsNote(publicReviews, publicReviewsSinceJoin);
      return;
    }

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const rating = d.rating || 0;
      const type = (d.type || "").toLowerCase();
      const isPublic = type === "public" || type === "google" || rating >= 4;

      const createdAtMs = toMillis(d.createdAt);
      const countedForJoin = joinMs ? createdAtMs >= joinMs : true;

      if (isPublic) {
        publicReviews++;
        ratingSum += rating;
        if (countedForJoin) publicReviewsSinceJoin++;
      } else {
        privateFeedback++;
      }

      if (type === "google") {
        googleReviews++;
        googleRatingSum += rating;
      }

      if (rating > 0 && rating <= 3) {
        badReviews++;
        badRatingSum += rating;
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

    const sorted = feedbackRows.sort((a, b) => {
      const aTs = toMillis(a.createdAt);
      const bTs = toMillis(b.createdAt);
      return bTs - aTs;
    });

    renderFeedbackTable(sorted);

    updateStatsUI({
      publicReviews,
      privateFeedback,
      ratingSum,
      googleReviews,
      googleRatingSum,
      badReviews,
      badRatingSum,
      publicReviewsSinceJoin,
    });

    updateReviewTotalsNote(publicReviews, publicReviewsSinceJoin);
  } catch (err) {
    console.error("Feedback load error:", err);

    feedbackEmptyState.style.display = "block";
    feedbackEmptyState.textContent = "Could not load feedback.";

    updateStatsUI({
      publicReviews: 0,
      privateFeedback: 0,
      ratingSum: 0,
      googleReviews: 0,
      googleRatingSum: 0,
      badReviews: 0,
      badRatingSum: 0,
      publicReviewsSinceJoin: 0,
    });
  }
}
function updateStatsUI({
  publicReviews,
  privateFeedback,
  ratingSum,
  googleReviews,
  googleRatingSum,
  badReviews,
  badRatingSum,
  publicReviewsSinceJoin,
}) {
  if (totalReviewsValue) totalReviewsValue.textContent = String(publicReviews);
  if (privateFeedbackValue) privateFeedbackValue.textContent = String(privateFeedback);

  const average = publicReviews > 0 ? ratingSum / publicReviews : 0;
  if (averageRatingValue)
    averageRatingValue.textContent = publicReviews ? average.toFixed(1) : "–";

  const googleAverage = googleReviews > 0 ? googleRatingSum / googleReviews : 0;
  if (googleAverageValue)
    googleAverageValue.textContent = googleReviews ? googleAverage.toFixed(1) : "–";

  const badAverage = badReviews > 0 ? badRatingSum / badReviews : 0;
  if (badAverageValue)
    badAverageValue.textContent = badReviews ? badAverage.toFixed(1) : "–";

  if (totalReviewsSinceValue)
    totalReviewsSinceValue.textContent = String(publicReviewsSinceJoin || 0);
}

function updateReviewTotalsNote(publicReviews, publicReviewsSinceJoin) {
  if (!reviewTotalsNote) return;
  const joinedText = businessJoinedAt ? formatDate(businessJoinedAt) : "you joined";
  const suffix = businessJoinedAt
    ? `${publicReviewsSinceJoin || 0} collected since ${joinedText}`
    : "collected since you joined ReviewResQ";

  reviewTotalsNote.textContent = `${publicReviews} public reviews total · ${suffix}`;
}

// =========================
// RENDER FEEDBACK TABLE
// =========================

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

// =========================
// FEEDBACK MODAL
// =========================

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

// =========================
// LOGO UPLOAD
// =========================

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

// =========================
// EDIT PROFILE MODAL
// =========================

if (editProfileBtn) {
  editProfileBtn.addEventListener("click", () => {
    populateEditForm(currentProfile);
    toggleEditModal(true);
  });
}

if (editClose) editClose.addEventListener("click", () => toggleEditModal(false));
if (editCancelBtn) editCancelBtn.addEventListener("click", () => toggleEditModal(false));

if (editModal) {
  editModal.addEventListener("click", (event) => {
    if (event.target === editModal) toggleEditModal(false);
  });
}

if (editForm) {
  editForm.addEventListener("submit", saveProfileEdits);
}

// =========================
// PLAN UPGRADE CTA
// =========================

if (startTrialBtn) startTrialBtn.onclick = setPlanToAdvanced;
if (upgradeCtaBtn) upgradeCtaBtn.onclick = setPlanToAdvanced;

// =========================
// ESC SHORTCUT
// =========================

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeFeedbackModal();
    toggleEditModal(false);
  }
});
