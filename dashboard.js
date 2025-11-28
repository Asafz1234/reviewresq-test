// dashboard.js
// לוגיקה מלאה של דשבורד ReviewResQ

import {
  auth,
  db,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "./firebase.js";

document.addEventListener("DOMContentLoaded", () => {
  // DOM REFS
  const userEmailDisplay = document.getElementById("userEmailDisplay");
  const logoutBtn = document.getElementById("logoutBtn");

  const globalBanner = document.getElementById("globalBanner");
  const globalBannerText = document.getElementById("globalBannerText");

  const emptyState = document.getElementById("emptyState");
  const dashContent = document.getElementById("dashContent");

  const bizNameDisplay = document.getElementById("bizNameDisplay");
  const bizNameText = document.getElementById("bizNameText");
  const bizCategoryText = document.getElementById("bizCategoryText");
  const bizUpdatedAt = document.getElementById("bizUpdatedAt");
  const bizStatusBadge = document.getElementById("bizStatusBadge");

  const bizLogoImg = document.getElementById("bizLogoImg");
  const bizLogoInitials = document.getElementById("bizLogoInitials");

  const googleLinkDisplay = document.getElementById("googleLinkDisplay");
  const viewPortalBtn = document.getElementById("viewPortalBtn");

  const averageRatingValue = document.getElementById("averageRatingValue");
  const totalReviewsValue = document.getElementById("totalReviewsValue");
  const privateFeedbackValue = document.getElementById("privateFeedbackValue");

  const recentFeedbackBody = document.getElementById("recentFeedbackBody");
  const feedbackEmptyState = document.getElementById("feedbackEmptyState");

  /* ---------------------------------------------------
     עוזרים כלליים
  --------------------------------------------------- */

  function showBanner(type, text) {
    if (!globalBanner || !globalBannerText) return;
    globalBannerText.textContent = text;
    globalBanner.className = "global-banner visible " + type; // info / warn
  }

  function hideBanner() {
    if (!globalBanner) return;
    globalBanner.className = "global-banner";
    if (globalBannerText) globalBannerText.textContent = "";
  }

  function showEmptyState() {
    if (emptyState) emptyState.classList.add("visible");
    if (dashContent) dashContent.style.display = "none";
  }

  function showDashboard() {
    if (emptyState) emptyState.classList.remove("visible");
    if (dashContent) dashContent.style.display = "";
  }

  function formatDate(ts) {
    if (!ts) return "recently";

    // אם זה Timestamp של Firestore
    try {
      const date =
        typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);

      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "recently";
    }
  }

  function computeInitials(name) {
    if (!name) return "YB";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    const first = parts[0][0] || "";
    const last = parts[parts.length - 1][0] || "";
    return (first + last).toUpperCase();
  }

  function clearFeedbackTable() {
    if (!recentFeedbackBody) return;
    recentFeedbackBody.innerHTML = "";
  }

  /* ---------------------------------------------------
     AUTH STATE
  --------------------------------------------------- */

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        // אין משתמש – הולכים להתחברות
        window.location.href = "/auth.html";
        return;
      }

      // מציג אימייל למעלה
      if (userEmailDisplay) {
        userEmailDisplay.textContent = user.email || "Logged in";
      }

      hideBanner();

      // טוען ביזנס
      await loadBusinessProfile(user.uid);

      // טוען סטטיסטיקות
      await loadStats(user.uid);

      // טוען פידבקים אחרונים
      await loadRecentFeedback(user.uid);
    } catch (err) {
      console.error("Error in auth state handler:", err);
      showBanner(
        "warn",
        "Something went wrong while loading your dashboard. Please refresh the page."
      );
    }
  });

  /* ---------------------------------------------------
     LOGOUT
  --------------------------------------------------- */

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "/auth.html";
      } catch (err) {
        console.error("Logout error:", err);
        showBanner("warn", "Could not log out. Please try again.");
      }
    });
  }

  /* ---------------------------------------------------
     LOAD BUSINESS PROFILE
  --------------------------------------------------- */

  async function loadBusinessProfile(uid) {
    const ref = doc(db, "businesses", uid);

    const snap = await getDoc(ref);

    if (!snap.exists()) {
      // אין מסמך עסק – מבקשים לסיים אונבורדינג
      showEmptyState();
      showBanner(
        "warn",
        "We couldn’t find your business profile yet. Please complete the onboarding form."
      );
      return;
    }

    const data = snap.data() || {};
    showDashboard();

    const businessName = data.businessName || "Your business";
    const category = data.businessCategory || "Category not set yet";
    const googleLink = data.googleReviewLink || "";
    const status = data.status || "Live · Ready";
    const updatedAtValue = data.updatedAt || data.createdAt || null;

    // שם עסק בכותרת
    if (bizNameDisplay) {
      bizNameDisplay.textContent = businessName + " – dashboard";
    }
    if (bizNameText) {
      bizNameText.textContent = businessName;
    }

    if (bizCategoryText) {
      bizCategoryText.textContent = category;
    }

    if (bizUpdatedAt) {
      bizUpdatedAt.textContent = formatDate(updatedAtValue);
    }

    if (bizStatusBadge) {
      bizStatusBadge.textContent = status;
    }

    // לוגו / ראשי תיבות
    const logoUrl = data.logoUrl || "";
    if (logoUrl && bizLogoImg && bizLogoInitials) {
      bizLogoImg.src = logoUrl;
      bizLogoImg.style.display = "block";
      bizLogoInitials.style.display = "none";
    } else if (bizLogoInitials) {
      bizLogoInitials.textContent = computeInitials(businessName);
      if (bizLogoImg) bizLogoImg.style.display = "none";
      bizLogoInitials.style.display = "block";
    }

    // Google review link
    if (googleLinkDisplay) {
      if (googleLink) {
        googleLinkDisplay.href = googleLink;
        googleLinkDisplay.textContent = googleLink;
      } else {
        googleLinkDisplay.removeAttribute("href");
        googleLinkDisplay.textContent = "Not set yet";
      }
    }

    // customer portal url (אם הגדרנו)
    const portalUrl =
      data.portalUrl ||
      data.feedbackPortalUrl ||
      ""; // שדות אופציונליים – רק אם בנית אותם באונבורדינג

    if (viewPortalBtn) {
      if (portalUrl) {
        viewPortalBtn.disabled = false;
        viewPortalBtn.addEventListener("click", () => {
          window.open(portalUrl, "_blank", "noopener");
        });
      } else if (googleLink) {
        // fallback נחמד – אם אין portalUrl אבל יש Google link
        viewPortalBtn.disabled = false;
        viewPortalBtn.addEventListener("click", () => {
          window.open(googleLink, "_blank", "noopener");
        });
      } else {
        viewPortalBtn.disabled = false;
        viewPortalBtn.addEventListener("click", () => {
          alert(
            "Your customer portal link is not configured yet. Please contact support or update your onboarding details."
          );
        });
      }
    }

    // אפשר גם לשים באנר מידע חיובי:
    showBanner(
      "info",
      "Your business profile is loaded. Share your ReviewResQ link with customers to start getting more reviews."
    );
  }

  /* ---------------------------------------------------
     LOAD STATS FROM FEEDBACK COLLECTION
     businesses/{uid}/feedback
  --------------------------------------------------- */

  async function loadStats(uid) {
    try {
      const feedbackRef = collection(db, "businesses", uid, "feedback");
      const q = query(feedbackRef, orderBy("createdAt", "desc"), limit(100));
      const snap = await getDocs(q);

      if (snap.empty) {
        // אין עדיין פידבקים
        if (averageRatingValue) averageRatingValue.textContent = "–";
        if (totalReviewsValue) totalReviewsValue.textContent = "0";
        if (privateFeedbackValue) privateFeedbackValue.textContent = "0";
        return;
      }

      let total = 0;
      let sumRating = 0;
      let publicCount = 0;
      let privateCount = 0;

      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const rating = typeof data.rating === "number" ? data.rating : null;
        const type = data.type || ""; // "public" | "private" (אם אתה שומר ככה)

        if (rating != null) {
          total += 1;
          sumRating += rating;

          if (type === "public" || rating >= 4) {
            publicCount += 1;
          } else if (type === "private" || rating <= 3) {
            privateCount += 1;
          }
        }
      });

      const avg =
        total > 0 ? (Math.round((sumRating / total) * 10) / 10).toFixed(1) : "–";

      if (averageRatingValue) averageRatingValue.textContent = avg;
      if (totalReviewsValue) totalReviewsValue.textContent = String(publicCount);
      if (privateFeedbackValue)
        privateFeedbackValue.textContent = String(privateCount);
    } catch (err) {
      console.error("Error loading stats:", err);
      // לא שוברים את הדשבורד – פשוט משאירים את הערכים ריקים
      if (averageRatingValue) averageRatingValue.textContent = "–";
      if (totalReviewsValue) totalReviewsValue.textContent = "–";
      if (privateFeedbackValue) privateFeedbackValue.textContent = "–";
    }
  }

  /* ---------------------------------------------------
     LOAD RECENT FEEDBACK (TABLE)
     businesses/{uid}/feedback
  --------------------------------------------------- */

  async function loadRecentFeedback(uid) {
    if (!recentFeedbackBody || !feedbackEmptyState) return;

    clearFeedbackTable();
    feedbackEmptyState.style.display = "block";

    try {
      const feedbackRef = collection(db, "businesses", uid, "feedback");
      const q = query(feedbackRef, orderBy("createdAt", "desc"), limit(20));
      const snap = await getDocs(q);

      if (snap.empty) {
        // נשאר עם empty state
        return;
      }

      feedbackEmptyState.style.display = "none";

      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const tr = document.createElement("tr");

        const createdAt = formatDate(data.createdAt);
        const customerName = data.customerName || "Customer";
        const message = data.message || "";
        const rating = typeof data.rating === "number" ? data.rating : null;
        const type = data.type || (rating != null && rating >= 4 ? "public" : "private");

        // Date
        const tdDate = document.createElement("td");
        tdDate.textContent = createdAt;

        // Customer
        const tdCustomer = document.createElement("td");
        tdCustomer.textContent = customerName;

        // Rating
        const tdRating = document.createElement("td");
        if (rating != null) {
          const pill = document.createElement("span");
          pill.classList.add("rating-pill");
          if (rating >= 4) {
            pill.classList.add("rating-high");
          } else {
            pill.classList.add("rating-low");
          }
          pill.textContent = rating.toFixed(1);
          tdRating.appendChild(pill);
        } else {
          tdRating.textContent = "–";
        }

        // Type
        const tdType = document.createElement("td");
        tdType.textContent = type === "public" ? "Public (Google)" : "Private";

        // Message – קיצור טקסט אם ארוך
        const tdMsg = document.createElement("td");
        let shortMsg = message;
        if (shortMsg.length > 120) {
          shortMsg = shortMsg.slice(0, 117) + "...";
        }
        tdMsg.textContent = shortMsg || "—";

        tr.appendChild(tdDate);
        tr.appendChild(tdCustomer);
        tr.appendChild(tdRating);
        tr.appendChild(tdType);
        tr.appendChild(tdMsg);

        recentFeedbackBody.appendChild(tr);
      });
    } catch (err) {
      console.error("Error loading recent feedback:", err);
      // במקרה כזה – נשאיר את ה־empty state
      feedbackEmptyState.style.display = "block";
    }
  }
});
