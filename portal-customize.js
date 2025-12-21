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
} from "./firebase-config.js";

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

const hasRequiredElements = [
  bizNameInput,
  brandColorInput,
  brandColorHex,
  logoUpload,
  saveBtn,
  previewHeader,
  previewLogo,
  previewBizName,
].every(Boolean);

if (!hasRequiredElements) {
  console.warn("Portal customization UI not found on this page. Skipping portal-customize.js.");
} else {
  // GLOBAL STATE
  let currentUser = null;
  let currentLogoUrl = "";
  let profileCreatedAt = null;

  function buildNameAliases(name) {
    if (!name) return {};
    return {
      businessName: name,
      displayName: name,
      name,
    };
  }

  async function persistBrandFields({ name, logoUrl, brandColor } = {}) {
    if (!currentUser) return;

    const timestamps = {
      updatedAt: serverTimestamp(),
      createdAt: profileCreatedAt || serverTimestamp(),
    };

    const businessPayload = {
      ...timestamps,
      portalPath: `/portal.html?businessId=${currentUser.uid}`,
      ...(brandColor ? { brandColor } : {}),
      ...(logoUrl !== undefined
        ? {
            logoUrl,
            logoURL: logoUrl,
            businessLogoUrl: logoUrl,
          }
        : {}),
      ...buildNameAliases(name),
    };

    const profilePayload = {
      ...timestamps,
      portalPath: `/portal.html?bid=${currentUser.uid}`,
      ...(brandColor ? { brandColor } : {}),
      ...(logoUrl !== undefined ? { logoUrl, logoDataUrl: logoUrl } : {}),
      ...(name ? { businessName: name } : {}),
    };

    await Promise.all([
      setDoc(doc(db, "businesses", currentUser.uid), businessPayload, { merge: true }),
      setDoc(doc(db, "businessProfiles", currentUser.uid), profilePayload, { merge: true }),
    ]);
  }

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
      await persistBrandFields({ logoUrl: url });
      updatePreview();
    } catch (err) {
      console.error("Failed to upload logo:", err);

      try {
        const dataUrl = await fileToDataUrl(file);
        currentLogoUrl = dataUrl;
        await persistBrandFields({ logoUrl: dataUrl });
        updatePreview();
        alert("Logo saved using a backup method.");
      } catch (fallbackError) {
        console.error("Logo fallback failed:", fallbackError);
        alert("We couldn't upload your logo. Please try again.");
      }
    }
  });

  // ===== LOAD EXISTING DATA =====
  async function loadPortalSettings(uid) {
    const businessRef = doc(db, "businesses", uid);
    const profileRef = doc(db, "businessProfiles", uid);
    const [businessSnap, profileSnap] = await Promise.all([
      getDoc(businessRef),
      getDoc(profileRef),
    ]);

    const data = businessSnap.exists()
      ? businessSnap.data()
      : profileSnap.exists()
        ? profileSnap.data()
        : null;

    if (!data) {
      console.log("No existing profile. Using defaults.");
      updatePreview();
      return;
    }

    profileCreatedAt = data.createdAt || null;

    // Fill UI
    bizNameInput.value = data.businessName || data.displayName || data.name || "";

    // Color
    const color = data.brandColor || data.branding?.primary || "#2563eb";
    brandColorInput.value = color;
    brandColorHex.value = color;

    // Logo
    if (data.logoUrl || data.logoDataUrl || data.logoURL || data.businessLogoUrl) {
      currentLogoUrl =
        data.logoUrl || data.logoDataUrl || data.logoURL || data.businessLogoUrl;
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

    await persistBrandFields({ name, brandColor: color, logoUrl: currentLogoUrl || "" });

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
}
