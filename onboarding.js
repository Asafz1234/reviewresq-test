import {
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./firebase.js";

const googleApiKey = "YOUR_GOOGLE_API_KEY"; // תחליף פעם אחת – וזהו.

const businessNameInput = document.getElementById("businessNameInput");
const googleReviewLinkInput = document.getElementById("googleReviewLinkInput");
const saveBtn = document.getElementById("saveBtn");

const loadingEl = document.getElementById("loading");
const resultsWrapper = document.getElementById("resultsWrapper");
const resultsList = document.getElementById("resultsList");
const saveStatus = document.getElementById("saveStatus");

let selectedPlaceId = null;

function initGoogleReviewAutoFinder() {
  const nameInput = document.getElementById("businessNameInput");
  const linkInput = document.getElementById("googleReviewLinkInput");
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

function getInputs() {
  return {
    bizNameInput: document.getElementById("bizNameInput"),
    bizCategoryInput: document.getElementById("bizCategoryInput"),
    bizPhoneInput: document.getElementById("bizPhoneInput"),
    bizEmailInput: document.getElementById("bizEmailInput"),
    websiteInput: document.getElementById("websiteInput"),
    logoUrlInput: document.getElementById("logoUrlInput"),
    googleReviewLinkInput: document.getElementById("googleReviewLinkInput"),
    planSelect: document.getElementById("plan"),
  };
}

async function loadOnboarding(uid) {
  const {
    bizNameInput,
    bizCategoryInput,
    bizPhoneInput,
    bizEmailInput,
    websiteInput,
    logoUrlInput,
    googleReviewLinkInput,
    planSelect,
  } = getInputs();

  try {
    const response = await fetch(url);
    const data = await response.json();

    loadingEl.style.display = "none";

    if (!data.candidates || data.candidates.length === 0) {
      alert("No matching business was found. Try adding city or address.");
      return;
    }

    resultsWrapper.style.display = "block";

    // Make selectable list
    data.candidates.forEach((biz) => {
      const div = document.createElement("div");
      div.className = "result-item";
      div.innerHTML = `<strong>${biz.name}</strong><br><small>${biz.formatted_address}</small>`;
      div.onclick = () => selectBusiness(biz);
      resultsList.appendChild(div);
    });

  } catch (err) {
    console.error(err);
    alert("Failed to search Google.");
  }
}

// ---------- SAVE DATA ----------

async function saveOnboarding(uid) {
  hideError();

  const {
    bizNameInput,
    bizCategoryInput,
    bizPhoneInput,
    bizEmailInput,
    websiteInput,
    logoUrlInput,
    googleReviewLinkInput,
    planSelect,
  } = getInputs();

  const selectedPlan = planSelect?.value === "advanced" ? "advanced" : "basic";

  const payload = {
    businessName: cleanValue(bizNameInput?.value),
    category: cleanValue(bizCategoryInput?.value),
    phone: cleanValue(bizPhoneInput?.value),
    contactEmail: cleanValue(bizEmailInput?.value),
    website: cleanValue(websiteInput?.value),
    logoUrl: cleanValue(logoUrlInput?.value),
    plan: selectedPlan,
    onboardingComplete: true,
    updatedAt: serverTimestamp(),
  };

  console.log("[onboarding] Saving payload:", payload);

  const saveBtn =
    document.getElementById("saveOnboardingBtn") ||
    document.getElementById("saveBtn") ||
    document.querySelector("button[type='submit'], input[type='submit']");

  const originalText = saveBtn ? saveBtn.textContent : "";

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
  }

  try {
    const ref = doc(db, "businessProfiles", uid);
    await setDoc(ref, payload, { merge: true });

    const portalSettingsRef = doc(db, "portalSettings", uid);
    const portalSettingsSnap = await getDoc(portalSettingsRef);

    // כאשר נרשם עסק חדש ושמרנו את businessProfile
    if (!portalSettingsSnap.exists()) {
      await setDoc(portalSettingsRef, {
        googleReviewUrl: googleReviewLinkInput?.value || "",
        primaryColor: "#2563eb",
        accentColor: "#7c3aed",
        backgroundStyle: "gradient",
        headline: "How was your experience?",
        subheadline: "Your feedback helps us improve.",
        ctaLabelHighRating: "Leave a Google review",
        ctaLabelLowRating: "Send private feedback",
        thankYouTitle: "Thank you!",
        thankYouBody: "We review every message.",
        updatedAt: serverTimestamp(),
      });
    }
    console.log(
      `[onboarding] Saved OK with plan="${selectedPlan}" – redirecting to dashboard`
    );
    const redirectPath =
      selectedPlan === "advanced" ? "/dashboard-advanced.html" : "/dashboard.html";
    window.location.href = redirectPath;
  } catch (err) {
    console.error("[onboarding] Save failed:", err);
    showError("Could not save your business details. Please try again.");
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText || "Save & Continue";
    }
  }
}

/* ---------------------------------------------------
   3. שמירת העסק ל-Firestore
--------------------------------------------------- */
saveBtn.addEventListener("click", async () => {
  const businessName = businessNameInput.value.trim();
  const googleReviewUrl = googleReviewLinkInput.value.trim();

  if (!businessName) {
    alert("Business name is required.");
    return;
  }

  if (!googleReviewUrl) {
    alert("Google Review URL is required.");
    return;
  }

  saveStatus.textContent = "Saving…";

  const businessId = crypto.randomUUID();

  try {
    await setDoc(doc(db, "businessProfiles", businessId), {
      businessId,
      businessName,
      googleReviewUrl,
      createdAt: serverTimestamp(),
    });

    saveStatus.textContent = "Saved successfully!";
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    saveStatus.textContent = "Error while saving.";
  }
});
