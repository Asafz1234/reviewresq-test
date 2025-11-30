// dashboard.js – טוען פרטי עסק + פידבק לדשבורד

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

// אלמנטים מה-DOM
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");

const dashContent = document.getElementById("dashContent");
const emptyState = document.getElementById("emptyState");

const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizNameText = document.getElementById("bizNameText");
const bizCategoryText = document.getElementById("bizCategoryText");
const bizUpdatedAt = document.getElementById("bizUpdatedAt");
const bizStatusBadge = document.getElementById("bizStatusBadge");
const googleLinkDisplay = document.getElementById("googleLinkDisplay");
const bizLogoImg = document.getElementById("bizLogoImg");
const bizLogoInitials = document.getElementById("bizLogoInitials");

const viewPortalBtn = document.getElementById("viewPortalBtn");

const averageRatingValue = document.getElementById("averageRatingValue");
const totalReviewsValue = document.getElementById("totalReviewsValue");
const privateFeedbackValue = document.getElementById("privateFeedbackValue");

const feedbackBody = document.getElementById("recentFeedbackBody");
const feedbackEmptyState = document.getElementById("feedbackEmptyState");

const globalBanner = document.getElementById("globalBanner");
const globalBannerText = document.getElementById("globalBannerText");

// עזר לבאנר
function showBanner(type, text) {
  globalBannerText.textContent = text;
  globalBanner.className = `global-banner visible ${type}`;
}

function hideBanner() {
  globalBannerText.textContent = "";
  globalBanner.className = "global-banner";
}

// יצירת ראשי תיבות ללוגו
function getInitials(name = "") {
  const parts = name.trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "YB";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (
    parts[0].charAt(0).toUpperCase() + parts[1].charAt(0).toUpperCase()
  );
}

// פורמט תאריך פשוט
function formatDate(timestamp) {
  if (!timestamp) return "recently";
  try {
    const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "recently";
  }
}

// --- LOGOUT ---
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      window.location.href = "/auth.html";
    } catch (err) {
      console.error("Sign out failed:", err);
      alert("Could not log out. Please try again.");
    }
  });
}

// --- AUTH GUARD + LOAD DASHBOARD DATA ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  // הצגת אימייל למעלה
  if (userEmailDisplay) {
    userEmailDisplay.textContent = user.email || "Logged in";
  }

  const bizRef = doc(db, "businesses", user.uid);

  try {
    const snap = await getDoc(bizRef);

    if (!snap.exists() || !snap.data().onboardingComplete) {
      // אין פרטי עסק -> מראים empty state
      if (dashContent) dashContent.style.display = "none";
      if (emptyState) emptyState.classList.add("visible");

      showBanner(
        "warn",
        "We didn’t find your business profile yet. Complete the onboarding to get your portal."
      );
      return;
    }

    // יש פרופיל עסק
    const data = snap.data();

    if (emptyState) emptyState.classList.remove("visible");
    if (dashContent) dashContent.style.display = "block";
    hideBanner();

    // מילוי פרטי עסק
    const bizName = data.bizName || "Your business";
    if (bizNameDisplay) bizNameDisplay.textContent = bizName;
    if (bizNameText) bizNameText.textContent = bizName;
    if (bizCategoryText)
      bizCategoryText.textContent =
        data.category || "Your main service category will appear here…";

    if (bizUpdatedAt)
      bizUpdatedAt.textContent = formatDate(data.updatedAt);

    if (bizStatusBadge) {
      bizStatusBadge.textContent = "Live · Ready";
    }

    // לוגו
    const initials = getInitials(bizName);
    if (bizLogoInitials) bizLogoInitials.textContent = initials;

    if (data.logoUrl && bizLogoImg) {
      bizLogoImg.src = data.logoUrl;
      bizLogoImg.style.display = "block";
      if (bizLogoInitials) bizLogoInitials.style.display = "none";
    } else {
      if (bizLogoImg) bizLogoImg.style.display = "none";
      if (bizLogoInitials) bizLogoInitials.style.display = "block";
    }

    // לינק לגוגל
    if (googleLinkDisplay) {
      if (data.googleReviewLink) {
        googleLinkDisplay.href = data.googleReviewLink;
        googleLinkDisplay.textContent = data.googleReviewLink;
      } else {
        googleLinkDisplay.href = "#";
        googleLinkDisplay.textContent = "Not set yet";
      }
    }

    // "פתח פורטל" – כרגע פשוט נפתח את לינק גוגל (או בעתיד פורטל משלך)
    if (viewPortalBtn) {
      viewPortalBtn.addEventListener("click", () => {
        if (data.googleReviewLink) {
          window.open(data.googleReviewLink, "_blank", "noopener");
        } else {
          alert("Google review link is not set yet. Update it in onboarding.");
        }
      });
    }

    // סטטיסטיקות בסיסיות (אם יש פידבק)
    await loadStatsAndFeedback(user.uid);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    showBanner(
      "warn",
      "We had trouble loading your dashboard. Please refresh the page."
    );
    if (dashContent) dashContent.style.display = "none";
    if (emptyState) emptyState.classList.add("visible");
  }
});

// --- STATISTICS + FEEDBACK ---
// הנחה: תת-קולקשן "feedback" תחת כל business (businesses/{uid}/feedback)
async function loadStatsAndFeedback(uid) {
  const feedbackRef = collection(db, "businesses", uid, "feedback");
  const q = query(feedbackRef, orderBy("createdAt", "desc"), limit(20));

  try {
    const snap = await getDocs(q);

    if (snap.empty) {
      if (feedbackEmptyState) feedbackEmptyState.style.display = "block";
      return;
    }

    if (feedbackEmptyState) feedbackEmptyState.style.display = "none";
    if (feedbackBody) feedbackBody.innerHTML = "";

    let total = 0;
    let count = 0;
    let publicCount = 0;
    let privateCount = 0;

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const rating = Number(d.rating || 0);
      const type = d.type || (rating >= 4 ? "public" : "private");
      const isHigh = rating >= 4;

      if (rating > 0) {
        total += rating;
        count += 1;
      }
      if (type === "public") publicCount += 1;
      if (type === "private") privateCount += 1;

      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.textContent = formatDate(d.createdAt);
      tr.appendChild(tdDate);

      const tdCustomer = document.createElement("td");
      tdCustomer.textContent = d.customerName || "Customer";
      tr.appendChild(tdCustomer);

      const tdRating = document.createElement("td");
      const spanRating = document.createElement("span");
      spanRating.className =
        "rating-pill " + (isHigh ? "rating-high" : "rating-low");
      spanRating.textContent = rating ? `${rating} ★` : "-";
      tdRating.appendChild(spanRating);
      tr.appendChild(tdRating);

      const tdType = document.createElement("td");
      tdType.textContent = type === "public" ? "Google review" : "Private feedback";
      tr.appendChild(tdType);

      const tdMsg = document.createElement("td");
      tdMsg.textContent = d.message || "—";
      tr.appendChild(tdMsg);

      if (feedbackBody) feedbackBody.appendChild(tr);
    });

    // סטטיסטיקות
    if (averageRatingValue) {
      averageRatingValue.textContent =
        count > 0 ? (total / count).toFixed(1) : "–";
    }
    if (totalReviewsValue) {
      totalReviewsValue.textContent = publicCount > 0 ? publicCount : "0";
    }
    if (privateFeedbackValue) {
      privateFeedbackValue.textContent = privateCount > 0 ? privateCount : "0";
    }
  } catch (err) {
    console.error("Failed to load feedback:", err);
    if (feedbackEmptyState) {
      feedbackEmptyState.textContent =
        "We couldn’t load recent feedback. Try refreshing the page.";
      feedbackEmptyState.style.display = "block";
    }
  }
}
// dashboard.js – טוען את פרטי העסק, הסטטיסטיקות והפורטל

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

// ==== DOM ELEMENTS ====
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");

const globalBanner = document.getElementById("globalBanner");
const globalBannerText = document.getElementById("globalBannerText");

const emptyState = document.getElementById("emptyState");
const dashContent = document.getElementById("dashContent");

const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizStatusBadge = document.getElementById("bizStatusBadge");
const bizLogoImg = document.getElementById("bizLogoImg");
const bizLogoInitials = document.getElementById("bizLogoInitials");
const bizNameText = document.getElementById("bizNameText");
const bizCategoryText = document.getElementById("bizCategoryText");
const bizUpdatedAt = document.getElementById("bizUpdatedAt");
const googleLinkDisplay = document.getElementById("googleLinkDisplay");
const viewPortalBtn = document.getElementById("viewPortalBtn");

// Portal card
const portalLinkInput = document.getElementById("portalLinkInput");
const portalCopyBtn = document.getElementById("portalCopyBtn");
const portalPreviewBtn = document.getElementById("portalPreviewBtn");
const planBadge = document.getElementById("planBadge");
const startTrialBtn = document.getElementById("startTrialBtn");

// Stats
const averageRatingValue = document.getElementById("averageRatingValue");
const totalReviewsValue = document.getElementById("totalReviewsValue");
const privateFeedbackValue = document.getElementById("privateFeedbackValue");

// Recent feedback
const recentFeedbackBody = document.getElementById("recentFeedbackBody");
const feedbackEmptyState = document.getElementById("feedbackEmptyState");

// ====== HELPERS ======

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

function setPortalLinkInUI(url) {
  if (portalLinkInput) {
    portalLinkInput.value = url;
  }

  const openPortal = () => window.open(url, "_blank", "noopener");
  if (portalPreviewBtn) portalPreviewBtn.onclick = openPortal;
  if (viewPortalBtn) viewPortalBtn.onclick = openPortal;

  if (portalCopyBtn) {
    portalCopyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        const original = portalCopyBtn.textContent;
        portalCopyBtn.textContent = "Copied!";
        setTimeout(() => (portalCopyBtn.textContent = original), 1500);
      } catch (err) {
        console.error("Clipboard error:", err);
        alert("Could not copy. Please copy the link manually.");
      }
    };
  }
}

function formatDateFromTimestamp(ts) {
  if (!ts) return "just now";
  const date = ts.toDate ? ts.toDate() : ts;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "B";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

// ====== MAIN AUTH FLOW ======

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // לא מחובר → חזרה למסך התחברות
    window.location.href = "/auth.html";
    return;
  }

  // הצגת אימייל למעלה
  if (userEmailDisplay) {
    userEmailDisplay.textContent = user.email || user.phoneNumber || "My account";
  }

  // לוגאאוט
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await signOut(auth);
      window.location.href = "/auth.html";
    };
  }

  try {
    await loadBusinessProfile(user);
    await loadStats(user);
    await loadRecentFeedback(user);
  } catch (err) {
    console.error("Dashboard load error:", err);
    showBanner("We had trouble loading your data. Please refresh the page.", "warn");
  }
});

// ====== LOAD BUSINESS PROFILE ======

async function loadBusinessProfile(user) {
  const ref = doc(db, "businessProfiles", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // אין עדיין אונבורדינג → מציגים empty state
    if (emptyState) emptyState.classList.add("visible");
    if (dashContent) dashContent.style.display = "none";
    showBanner("Finish onboarding so we can build your ReviewResQ portal.", "info");
    return;
  }

  const data = snap.data();

  // מציגים דשבורד
  if (emptyState) emptyState.classList.remove("visible");
  if (dashContent) dashContent.style.display = "";

  const name = data.businessName || "Your business";
  const category = data.category || data.industry || "Business category";
  const googleReviewLink = data.googleReviewLink || "#";
  const logoUrl = data.logoUrl || "";
  const plan = data.plan || "basic";
  const updatedAt = data.updatedAt;

  // טקסטים
  if (bizNameDisplay) bizNameDisplay.textContent = name;
  if (bizNameText) bizNameText.textContent = name;
  if (bizCategoryText) bizCategoryText.textContent = category;
  if (bizUpdatedAt) bizUpdatedAt.textContent = formatDateFromTimestamp(updatedAt);

  // לוגו/ראשי תיבות
  if (logoUrl && bizLogoImg && bizLogoInitials) {
    bizLogoImg.src = logoUrl;
    bizLogoImg.style.display = "block";
    bizLogoInitials.style.display = "none";
  } else if (bizLogoInitials) {
    bizLogoInitials.textContent = initialsFromName(name);
  }

  // גוגל רוויו לינק
  if (googleLinkDisplay) {
    googleLinkDisplay.href = googleReviewLink || "#";
    googleLinkDisplay.textContent =
      googleReviewLink && googleReviewLink !== "#"
        ? googleReviewLink
        : "Not set yet";
  }

  // סטטוס ופלן
  if (bizStatusBadge) {
    bizStatusBadge.textContent = "Live · Ready";
  }

  if (planBadge) {
    if (plan === "advanced") {
      planBadge.textContent = "Advanced plan";
    } else {
      planBadge.textContent = "Basic plan";
    }
  }

  // באנר על הפלן
  hideBanner();
  if (plan === "basic") {
    showBanner(
      "You’re on the Basic plan. Upgrade to Advanced for full branding control and more analytics.",
      "info"
    );
  }

  // לינק לפורטל – אם יש ב־Firestore נשתמש בו, אחרת נבנה ברירת מחדל
  let portalPath =
    data.portalPath ||
    data.portalLink || // גיבוי לשם שדה אחר
    `/portal.html?bid=${encodeURIComponent(user.uid)}`;

  // משלים ל־absolute URL
  const portalUrl = new URL(portalPath, window.location.origin).toString();
  setPortalLinkInUI(portalUrl);

  // כפתור "Start 7-day trial" – כרגע דמו / רידיירקט
  if (startTrialBtn) {
    startTrialBtn.onclick = () => {
      // אם יש לך עמוד מחיר/צ'קאאוט – תחליף את ה-URL פה
      window.location.href = "/pricing.html";
      // או אם אתה מעדיף בינתיים:
      // alert("Advanced plan & free trial will be available soon. For now this button is just a preview 🙂");
    };
  }
}

// ====== LOAD STATS (אופציונלי – אם עוד לא בנית קולקציה, זה פשוט יציג מקפים) ======

async function loadStats(user) {
  try {
    const statsRef = doc(db, "portalStats", user.uid);
    const snap = await getDoc(statsRef);

    if (!snap.exists()) {
      if (averageRatingValue) averageRatingValue.textContent = "–";
      if (totalReviewsValue) totalReviewsValue.textContent = "–";
      if (privateFeedbackValue) privateFeedbackValue.textContent = "–";
      return;
    }

    const data = snap.data();
    if (averageRatingValue)
      averageRatingValue.textContent =
        data.averageRating != null ? data.averageRating.toFixed(1) : "–";
    if (totalReviewsValue)
      totalReviewsValue.textContent =
        data.totalPublicReviews != null ? data.totalPublicReviews : "–";
    if (privateFeedbackValue)
      privateFeedbackValue.textContent =
        data.privateFeedbackCount != null ? data.privateFeedbackCount : "–";
  } catch (err) {
    console.warn("Stats load error:", err);
  }
}

// ====== LOAD RECENT FEEDBACK (גם אופציונלי) ======

async function loadRecentFeedback(user) {
  if (!recentFeedbackBody || !feedbackEmptyState) return;

  feedbackEmptyState.style.display = "block";
  recentFeedbackBody.innerHTML = "";

  try {
    const fbRef = collection(db, "feedback");
    const q = query(
      fbRef,
      // אם יש לך שדה businessId – זה הפילטר
      // where("businessId", "==", user.uid),
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

      const dateCell = document.createElement("td");
      dateCell.textContent = formatDateFromTimestamp(d.createdAt);

      const nameCell = document.createElement("td");
      nameCell.textContent = d.customerName || "Customer";

      const ratingCell = document.createElement("td");
      const rating = d.rating != null ? d.rating : "–";
      const ratingSpan = document.createElement("span");
      ratingSpan.className =
        "rating-pill " + (rating >= 4 ? "rating-high" : "rating-low");
      ratingSpan.textContent = rating + "★";
      ratingCell.appendChild(ratingSpan);

      const typeCell = document.createElement("td");
      typeCell.textContent = d.type || (rating >= 4 ? "Google review" : "Private");

      const msgCell = document.createElement("td");
      msgCell.textContent = d.message || "—";

      tr.appendChild(dateCell);
      tr.appendChild(nameCell);
      tr.appendChild(ratingCell);
      tr.appendChild(typeCell);
      tr.appendChild(msgCell);

      recentFeedbackBody.appendChild(tr);
    });
  } catch (err) {
    console.warn("Feedback load error:", err);
  }
}
// ========= CUSTOMER PORTAL WIRING (SMALL ADD-ON) =========

// נוודא שה-DOM נטען
document.addEventListener("DOMContentLoaded", () => {
  const portalLinkInput = document.getElementById("portalLinkInput");
  const portalCopyBtn = document.getElementById("portalCopyBtn");
  const portalPreviewBtn = document.getElementById("portalPreviewBtn");
  const viewPortalBtn = document.getElementById("viewPortalBtn");

  // אם האלמנטים בכלל לא קיימים – לא עושים כלום
  if (!portalLinkInput) return;

  // מחכים למשתמש מחובר
  onAuthStateChanged(auth, (user) => {
    if (!user) return;

    // בגרסה בסיסית – הפורטל נבנה מה-uid של המשתמש
    const portalUrl =
      `${window.location.origin}/portal.html?bid=` +
      encodeURIComponent(user.uid);

    // מציגים את הלינק בשדה
    portalLinkInput.value = portalUrl;

    // פונקציה לפתיחת הפורטל
    const openPortal = () => {
      window.open(portalUrl, "_blank", "noopener");
    };

    if (portalPreviewBtn) {
      portalPreviewBtn.onclick = openPortal;
    }
    if (viewPortalBtn) {
      viewPortalBtn.onclick = openPortal;
    }

    // כפתור קופי
    if (portalCopyBtn) {
      portalCopyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(portalUrl);
          const original = portalCopyBtn.textContent;
          portalCopyBtn.textContent = "Copied!";
          setTimeout(() => {
            portalCopyBtn.textContent = original;
          }, 1500);
        } catch (err) {
          console.error("Clipboard error:", err);
          alert("Could not copy. Please copy the link manually.");
        }
      };
    }
  });
});
