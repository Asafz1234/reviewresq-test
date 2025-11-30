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
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "./firebase.js";

// -------- DOM ELEMENTS --------

// Top bar
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");

// Banners
const globalBanner = document.getElementById("globalBanner");
const globalBannerText = document.getElementById("globalBannerText");

// Containers
const emptyState = document.getElementById("emptyState");
const dashContent = document.getElementById("dashContent");

// Business profile
const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizStatusBadge = document.getElementById("bizStatusBadge");
const bizLogoImg = document.getElementById("bizLogoImg");
const bizLogoInitials = document.getElementById("bizLogoInitials");
const bizNameText = document.getElementById("bizNameText");
const bizCategoryText = document.getElementById("bizCategoryText");
const bizUpdatedAt = document.getElementById("bizUpdatedAt");
const googleLinkDisplay = document.getElementById("googleLinkDisplay");

// Customer portal block
const portalLinkInput = document.getElementById("portalLinkInput");
const portalCopyBtn = document.getElementById("portalCopyBtn");
const portalPreviewBtn = document.getElementById("portalPreviewBtn");
const viewPortalBtn = document.getElementById("viewPortalBtn");
const planBadge = document.getElementById("planBadge");
const startTrialBtn = document.getElementById("startTrialBtn");

// Stats
const averageRatingValue = document.getElementById("averageRatingValue");
const totalReviewsValue = document.getElementById("totalReviewsValue");
const privateFeedbackValue = document.getElementById("privateFeedbackValue");

// Table
const recentFeedbackBody = document.getElementById("recentFeedbackBody");
const feedbackEmptyState = document.getElementById("feedbackEmptyState");

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

// Create initials from business name
function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "B";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Format timestamps
function formatDate(ts) {
  if (!ts) return "just now";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
// =========================
// AUTH + LOAD BUSINESS PROFILE
// =========================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  // הצג אימייל למעלה
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

  try {
    const profile = await loadBusinessProfile(user);

    // If onboarding is complete, load stats + feedback in parallel for faster render
    if (profile) {
      await Promise.all([
        loadStats(user.uid),
        loadRecentFeedback(user.uid),
      ]);
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

  // === Fill UI ===

  if (bizNameDisplay) bizNameDisplay.textContent = name;
  if (bizNameText) bizNameText.textContent = name;
  if (bizCategoryText) bizCategoryText.textContent = category;
  if (bizUpdatedAt) bizUpdatedAt.textContent = formatDate(updatedAt);

  // Status badge
  if (bizStatusBadge) {
    bizStatusBadge.textContent = "Live · Ready";
  }

  // Logo
  if (logoUrl && bizLogoImg) {
    bizLogoImg.src = logoUrl;
    bizLogoImg.style.display = "block";
    bizLogoInitials.style.display = "none";
  } else {
    bizLogoImg.style.display = "none";
    bizLogoInitials.textContent = initialsFromName(name);
    bizLogoInitials.style.display = "flex";
  }

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

  setPortalLinkInUI(portalUrl);

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

function setPortalLinkInUI(url) {
  if (portalLinkInput) portalLinkInput.value = url;

  const previewUrl = (() => {
    const preview = new URL(url);
    preview.searchParams.set("ownerPreview", "1");
    return preview.toString();
  })();

  const openPortal = () => window.open(previewUrl, "_blank", "noopener");

  if (portalPreviewBtn) portalPreviewBtn.onclick = openPortal;
  if (viewPortalBtn) viewPortalBtn.onclick = openPortal;

  if (portalCopyBtn) {
    portalCopyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
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
// LOAD STATS (optional)
// =========================

async function loadStats(uid) {
  try {
    const statsRef = doc(db, "portalStats", uid);
    const snap = await getDoc(statsRef);

    if (!snap.exists()) {
      if (averageRatingValue) averageRatingValue.textContent = "–";
      if (totalReviewsValue) totalReviewsValue.textContent = "0";
      if (privateFeedbackValue) privateFeedbackValue.textContent = "0";
      return;
    }

    const data = snap.data();

    if (averageRatingValue)
      averageRatingValue.textContent =
        data.averageRating ? data.averageRating.toFixed(1) : "–";

    if (totalReviewsValue)
      totalReviewsValue.textContent =
        data.totalPublicReviews != null ? data.totalPublicReviews : "0";

    if (privateFeedbackValue)
      privateFeedbackValue.textContent =
        data.privateFeedbackCount != null ? data.privateFeedbackCount : "0";
  } catch (err) {
    console.warn("Stats load error:", err);
  }
}


// =========================
// LOAD RECENT FEEDBACK
// =========================

async function loadRecentFeedback(uid) {
  if (!recentFeedbackBody || !feedbackEmptyState) return;

  // Default: empty visible
  feedbackEmptyState.style.display = "block";
  recentFeedbackBody.innerHTML = "";

  try {
    // אם אתה שומר קולקציה לכל עסק — תפעיל את זה:
    // const ref = collection(db, "businesses", uid, "feedback");

    // כרגע — קולקציה גלובלית:
    const ref = collection(db, "feedback");

    const q = query(
      ref,
        // אם אתה משתמש ב־businessId
        // where("businessId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(10)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      return;
    }

    feedbackEmptyState.style.display = "none";

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const tr = document.createElement("tr");

      // Date
      const tdDate = document.createElement("td");
      tdDate.textContent = formatDate(d.createdAt);
      tr.appendChild(tdDate);

      // Customer name
      const tdName = document.createElement("td");
      tdName.textContent = d.customerName || "Customer";
      tr.appendChild(tdName);

      // Rating
      const tdRating = document.createElement("td");
      const r = d.rating || 0;
      const span = document.createElement("span");
      span.className =
        "rating-pill " + (r >= 4 ? "rating-high" : "rating-low");
      span.textContent = r ? `${r}★` : "-";
      tdRating.appendChild(span);
      tr.appendChild(tdRating);

      // Type
      const tdType = document.createElement("td");
      tdType.textContent = d.type || (r >= 4 ? "Google review" : "Private");
      tr.appendChild(tdType);

      // Message
      const tdMsg = document.createElement("td");
      tdMsg.textContent = d.message || "—";
      tr.appendChild(tdMsg);

      recentFeedbackBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Feedback load error:", err);

    feedbackEmptyState.style.display = "block";
    feedbackEmptyState.textContent = "Could not load feedback.";
  }
}
