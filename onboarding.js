import { app } from "./firebase-config.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const googleApiKey = "YOUR_GOOGLE_API_KEY"; // תחליף פעם אחת – וזהו.

const auth = getAuth(app);
const db = getFirestore(app);

const businessNameInput = document.getElementById("business-name");
const googleReviewLinkInput = document.getElementById("google-review-link");
const saveBtn = document.getElementById("save-and-continue");
const statusEl = document.getElementById("onboarding-status");

const loadingEl = document.getElementById("loading");
const resultsWrapper = document.getElementById("resultsWrapper");
const resultsList = document.getElementById("resultsList");

let selectedPlaceId = null;

function initGoogleReviewAutoFinder() {
  const nameInput = document.getElementById("business-name");
  const linkInput = document.getElementById("google-review-link");
  const autoBtn = document.getElementById("autoFindBtn");

  if (!nameInput || !linkInput || !autoBtn) {
    console.warn("Auto finder elements not found on page");
    return;
  }

  autoBtn.addEventListener("click", () => {
    const query = nameInput.value.trim();
    if (!query) {
      alert("Please enter your business name first.");
      return;
    }

    autoBtn.disabled = true;
    const originalLabel = autoBtn.textContent;
    autoBtn.textContent = "Searching…";

    // Create Places service without an actual map
    const service = new google.maps.places.PlacesService(
      document.createElement("div")
    );

    const request = {
      query,
      fields: ["place_id", "name"],
    };

    service.textSearch(request, (results, status) => {
      autoBtn.disabled = false;
      autoBtn.textContent = originalLabel;

      if (
        status !== google.maps.places.PlacesServiceStatus.OK ||
        !results ||
        !results.length
      ) {
        alert(
          "We could not find this business on Google Maps. Please paste your Google review link manually."
        );
        return;
      }

      const placeId = results[0].place_id;
      const reviewUrl =
        "https://search.google.com/local/writereview?placeid=" + placeId;

      linkInput.value = reviewUrl;
    });
  });
}

window.addEventListener("load", () => {
  if (window.google && google.maps && google.maps.places) {
    initGoogleReviewAutoFinder();
  } else {
    // Fallback: wait briefly for Maps to finish loading
    window.setTimeout(() => {
      if (window.google && google.maps && google.maps.places) {
        initGoogleReviewAutoFinder();
      }
    }, 1000);
  }
});

async function saveBusinessProfileAndPortalSettings() {
  const user = auth.currentUser;
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  const uid = user.uid;
  const businessName = businessNameInput?.value.trim() || "";
  const googleReviewUrl = googleReviewLinkInput?.value.trim() || "";

  if (!businessName || !googleReviewUrl) {
    statusEl.textContent =
      "Please fill in the business name and make sure a Google review link was found.";
    statusEl.style.color = "#dc2626";
    return;
  }

  statusEl.textContent = "Saving…";
  statusEl.style.color = "#4b5563";

  const businessDocRef = doc(db, "businessProfiles", uid);
  const portalSettingsRef = doc(db, "portalSettings", uid);

  try {
    await setDoc(
      businessDocRef,
      {
        businessId: uid,
        ownerUid: uid,
        businessName,
        googleReviewUrl,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    const portalSnap = await getDoc(portalSettingsRef);

    if (!portalSnap.exists()) {
      await setDoc(portalSettingsRef, {
        businessId: uid,
        googleReviewUrl,
        accentColor: "#36058a",
        backgroundStyle: "gradient",
        primaryColor: "#171a21",
        headline: "Share your experience",
        subheadline: "Your voice shapes how we improve.",
        ctaLabelHighRating: "Leave a Google review",
        ctaLabelLowRating: "Send private feedback",
        thankYouTitle: "Thank you!",
        thankYouBody: "We appreciate you taking the time to help us improve.",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        portalSettingsRef,
        {
          googleReviewUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    statusEl.textContent = "Saved successfully!";
    statusEl.style.color = "#16a34a";
    window.location.href = "/dashboard.html";
  } catch (err) {
    console.error("Error while saving onboarding data:", err);
    statusEl.textContent = "Error while saving. Please try again.";
    statusEl.style.color = "#dc2626";
  }
}

if (saveBtn) {
  saveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveBusinessProfileAndPortalSettings();
  });
}
