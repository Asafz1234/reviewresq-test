// onboarding.js
import {
  auth,
  db,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
} from "./firebase.js";

// ---------- DOM ELEMENTS ----------
const bizNameInput = document.getElementById("bizName");
const logoUrlInput = document.getElementById("logoUrl");
const googleLinkInput = document.getElementById("googleLink");
const categoryInput = document.getElementById("category");

const bizNameErr = document.getElementById("bizNameErr");
const googleLinkErr = document.getElementById("googleLinkErr");

const btnSubmit = document.getElementById("btnSubmit");

// Preview elements
const prevName = document.getElementById("prevName");
const prevCat = document.getElementById("prevCat");
const prevLogo = document.getElementById("prevLogo");
const prevGoogle = document.getElementById("prevGoogle");

let currentUser = null;

// ---------- LIVE PREVIEW ----------
function updatePreview() {
  const name = bizNameInput.value.trim();
  const cat = categoryInput.value.trim();
  const logo = logoUrlInput.value.trim();
  const gLink = googleLinkInput.value.trim();

  prevName.textContent = name || "YOUR BUSINESS";
  prevCat.textContent = cat ? `Category: ${cat}` : "Category will appear here…";

  if (logo) {
    prevLogo.src = logo;
    prevLogo.style.display = "block";
  } else {
    prevLogo.src = "";
    prevLogo.style.display = "none";
  }

  prevGoogle.textContent = gLink || "Your Google review link will appear here…";
}

[bizNameInput, logoUrlInput, googleLinkInput, categoryInput].forEach((input) => {
  if (!input) return;
  input.addEventListener("input", updatePreview);
});

// ---------- ERROR HANDLING ----------
function clearErrors() {
  bizNameErr.textContent = "";
  googleLinkErr.textContent = "";
}

function validateForm() {
  clearErrors();
  let valid = true;

  const name = bizNameInput.value.trim();
  const gLink = googleLinkInput.value.trim();

  if (!name) {
    bizNameErr.textContent = "Business name is required.";
    valid = false;
  }

  if (!gLink) {
    googleLinkErr.textContent = "Google review link is required.";
    valid = false;
  } else if (!gLink.startsWith("http")) {
    googleLinkErr.textContent = "Please enter a valid link starting with http or https.";
    valid = false;
  }

  return valid;
}

// ---------- LOAD EXISTING DATA ----------
async function loadExistingBusiness(user) {
  try {
    const ref = doc(db, "businesses", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      updatePreview();
      return;
    }

    const data = snap.data();

    if (data.businessName) bizNameInput.value = data.businessName;
    if (data.logoUrl) logoUrlInput.value = data.logoUrl;
    if (data.googleReviewLink) googleLinkInput.value = data.googleReviewLink;
    if (data.category) categoryInput.value = data.category;

    updatePreview();
  } catch (err) {
    console.error("Error loading business document:", err);
    updatePreview();
  }
}

// ---------- SAVE DATA ----------
async function saveBusiness() {
  if (!currentUser) {
    alert("Please log in again.");
    window.location.href = "/auth.html";
    return;
  }

  if (!validateForm()) return;

  btnSubmit.disabled = true;
  btnSubmit.textContent = "Saving…";

  const businessName = bizNameInput.value.trim();
  const logoUrl = logoUrlInput.value.trim();
  const googleReviewLink = googleLinkInput.value.trim();
  const category = categoryInput.value.trim();

  try {
    const ref = doc(db, "businesses", currentUser.uid);
    await setDoc(
      ref,
      {
        ownerUid: currentUser.uid,
        businessName,
        logoUrl: logoUrl || null,
        googleReviewLink,
        category: category || null,
        onboardingCompleted: true,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // Redirect to dashboard after successful save
    window.location.href = "/dashboard.html";
  } catch (err) {
    console.error("Error saving business data:", err);
    alert("We couldn't save your details. Please try again.");
    btnSubmit.disabled = false;
    btnSubmit.textContent = "Continue →";
  }
}

// ---------- AUTH CHECK ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // not logged in → send back to auth
    window.location.href = "/auth.html";
    return;
  }

  currentUser = user;

  // When we have the user, load his business data if exists
  await loadExistingBusiness(user);
});

// ---------- EVENTS ----------
btnSubmit.addEventListener("click", (e) => {
  e.preventDefault();
  saveBusiness();
});

// Initial preview in case inputs are empty
updatePreview();
