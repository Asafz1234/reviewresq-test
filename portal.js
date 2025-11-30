// portal.js – loads business design + handles rating + feedback

import {
  db,
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "./firebase.js";

// ===== UTILITIES =====

// Get "bid" from URL
function getBusinessId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("bid") || null;
}

// Show/hide helpers
function show(el) {
  el.style.display = "block";
}
function hide(el) {
  el.style.display = "none";
}

// ===== MAIN =====
document.addEventListener("DOMContentLoaded", async () => {
  const bizId = getBusinessId();

  if (!bizId) {
    alert("Missing business ID in link.");
    return;
  }

  // DOM elements
  const portalBizName = document.getElementById("portalBizName");
  const portalLogo = document.getElementById("portalLogo");
  const portalHeader = document.getElementById("portalHeader");

  const feedbackBox = document.getElementById("feedbackBox");
  const feedbackMsg = document.getElementById("feedbackMsg");
  const feedbackSubmit = document.getElementById("feedbackSubmit");
  const thankYou = document.getElementById("thankYou");

  // ===== LOAD BUSINESS DESIGN SETTINGS =====
  try {
    const ref = doc(db, "businessProfiles", bizId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      alert("Invalid business link.");
      return;
    }

    const data = snap.data();

    // Business name
    portalBizName.textContent = data.businessName || "Your business";

    // Logo
    if (data.logoUrl) {
      portalLogo.src = data.logoUrl;
      portalLogo.style.display = "block";
    }

    // Brand color
    if (data.brandColor) {
      document.documentElement.style.setProperty("--brand-color", data.brandColor);
    }

  } catch (err) {
    console.error("Portal load error:", err);
    alert("Could not load business settings.");
    return;
  }

  // ===== STAR RATING LOGIC =====
  document.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rating = Number(btn.dataset.rating);

      if (rating >= 4) {
        // Redirect happy customers to Google review
        redirectToGoogle(bizId);
      } else {
        // Show feedback box
        show(feedbackBox);
        feedbackBox.dataset.rating = rating;
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
    });
  });

  // ===== SUBMIT FEEDBACK =====
  feedbackSubmit.addEventListener("click", async () => {
    const rating = Number(feedbackBox.dataset.rating);
    const message = feedbackMsg.value.trim();

    if (!message) {
      alert("Please enter a message.");
      return;
    }

    try {
      await addDoc(collection(db, "feedback"), {
        businessId: bizId,
        rating,
        message,
        createdAt: serverTimestamp(),
      });

      hide(feedbackBox);
      show(thankYou);

    } catch (err) {
      console.error("Feedback submit error:", err);
      alert("Could not send feedback. Try again.");
    }
  });
});

// ===== REDIRECT TO GOOGLE REVIEW =====
async function redirectToGoogle(bizId) {
  try {
    const ref = doc(db, "businessProfiles", bizId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      alert("Invalid business.");
      return;
    }

    const data = snap.data();
    const googleUrl = data.googleReviewLink;

    if (!googleUrl) {
      alert("Google review link is not configured.");
      return;
    }

    window.location.href = googleUrl;
  } catch (err) {
    console.error("Redirect error:", err);
    alert("Could not redirect.");
  }
}
