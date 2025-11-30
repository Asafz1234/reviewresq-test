// portal-customize.js
// Handles loading/saving portal design + live preview updates

import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  uploadLogoAndGetURL,
} from "./firebase.js";

// ===== DOM ELEMENTS =====
const bizNameInput = document.getElementById("bizNameInput");
const brandColorInput = document.getElementById("brandColorInput");
const brandColorHex = document.getElementById("brandColorHex");
const logoUpload = document.getElementById("logoUpload");
const saveBtn = document.getElementById("saveBtn");

// PREVIEW
const previewHeader = document.getElementById("previewHeader");
const previewLogo = document.getElementById("previewLogo");
const previewBizName = document.getElementById("previewBizName");

// GLOBAL STATE
let currentUser = null;
let currentLogoUrl = "";
let profileCreatedAt = null;

// ===== LIVE PREVIEW FUNCTIONS =====
function updatePreview() {
  const name = bizNameInput.value || "Your Business";
  previewBizName.textContent = name;

  const color = brandColorHex.value || "#2563eb";
  previewHeader.style.backgroundColor = color;

  if (currentLogoUrl) {
    previewLogo.src = currentLogoUrl;
    previewLogo.style.display = "block";
  } else {
    previewLogo.style.display = "none";
  }
}

// ===== COLOR HANDLING =====
brandColorInput.addEventListener("input", () => {
  brandColorHex.value = brandColorInput.value;
  updatePreview();
});

brandColorHex.addEventListener("input", () => {
  if (brandColorHex.value.match(/^#([0-9A-F]{3}){1,2}$/i)) {
    brandColorInput.value = brandColorHex.value;
    updatePreview();
  }
});

// ===== LOGO UPLOAD =====
logoUpload.addEventListener("change", async () => {
  if (!logoUpload.files.length || !currentUser) return;

  const file = logoUpload.files[0];

  try {
    const url = await uploadLogoAndGetURL(file, currentUser.uid);

    currentLogoUrl = url;
    await setDoc(
      doc(db, "businessProfiles", currentUser.uid),
      {
        logoUrl: url,
        updatedAt: serverTimestamp(),
        createdAt: profileCreatedAt || serverTimestamp(),
      },
      { merge: true }
    );
    updatePreview();
  } catch (err) {
    console.error("Failed to upload logo:", err);
    alert("We couldn't upload your logo. Please try again.");
  }
});

// ===== LOAD EXISTING DATA =====
async function loadPortalSettings(uid) {
  const ref = doc(db, "businessProfiles", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    console.log("No existing profile. Using defaults.");
    updatePreview();
    return;
  }

  const data = snap.data();
  profileCreatedAt = data.createdAt || null;

  // Fill UI
  bizNameInput.value = data.businessName || "";

  // Color
  const color = data.brandColor || "#2563eb";
  brandColorInput.value = color;
  brandColorHex.value = color;

  // Logo
  if (data.logoUrl) {
    currentLogoUrl = data.logoUrl;
  }

  updatePreview();
}

// ===== SAVE SETTINGS =====
async function saveSettings() {
  if (!currentUser) return;

  const name = bizNameInput.value.trim();
  const color = brandColorHex.value.trim();

  if (!name) {
    alert("Business name is required.");
    return;
  }

  const ref = doc(db, "businessProfiles", currentUser.uid);

  await setDoc(
    ref,
    {
      businessName: name,
      brandColor: color,
      logoUrl: currentLogoUrl || "",
      updatedAt: serverTimestamp(),
      createdAt: profileCreatedAt || serverTimestamp(),
      portalPath: `/portal.html?bid=${currentUser.uid}`,
    },
    { merge: true }
  );

  alert("Portal updated successfully!");
}

// ===== SAVE BUTTON =====
saveBtn.addEventListener("click", saveSettings);

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  currentUser = user;
  loadPortalSettings(user.uid);
});
