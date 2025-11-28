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
