import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  uploadLogoAndGetURL,
  functions,
  httpsCallable,
} from "./firebase-config.js";

const businessNameInput = document.getElementById("businessNameInput");
const senderNameInput = document.getElementById("senderNameInput");
const supportEmailInput = document.getElementById("supportEmailInput");
const brandColorInput = document.getElementById("brandColorInput");
const logoInput = document.getElementById("logoInput");
const logoPreview = document.getElementById("logoPreview");
const logoPreviewWrapper = document.getElementById("logoPreviewWrapper");
const saveButton = document.getElementById("saveBranding");
const diagnosticsButton = document.getElementById("diagnosticsBtn");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");
const statusMessage = document.getElementById("statusMessage");

const DEFAULT_COLOR = "#2563EB";
const DEFAULT_SUPPORT_EMAIL = "support@reviewresq.com";

let currentUserId = null;
let currentLogoUrl = "";
let currentBranding = null;

function setStatus(message, isError = false) {
  if (!statusMessage) return;
  statusMessage.hidden = !message;
  statusMessage.textContent = message || "";
  statusMessage.classList.toggle("error", Boolean(isError));
}

function deriveBranding(data = {}) {
  const branding = data.branding || {};
  const baseName = (data.businessName || data.displayName || data.name || "").toString().trim();
  const name = (branding.name || branding.displayName || baseName || "Our business").toString().trim();
  const color = (branding.color || data.brandColor || DEFAULT_COLOR).toString().trim() || DEFAULT_COLOR;
  const logoUrl =
    branding.logoUrl ||
    data.logoUrl ||
    data.logoURL ||
    data.businessLogoUrl ||
    data.brandLogoUrl ||
    "";
  const senderName = (branding.senderName || name).toString().trim();
  const supportEmail = (branding.supportEmail || DEFAULT_SUPPORT_EMAIL).toString().trim().toLowerCase();

  return { name, color, logoUrl, senderName, supportEmail };
}

function applyLogoPreview(url) {
  if (!logoPreview || !logoPreviewWrapper) return;
  if (url) {
    logoPreview.src = url;
    logoPreviewWrapper.style.display = "inline-flex";
  } else {
    logoPreview.src = "";
    logoPreviewWrapper.style.display = "none";
  }
}

async function loadBranding(uid) {
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
      : {};

  const branding = deriveBranding(data);
  currentBranding = branding;
  currentLogoUrl = branding.logoUrl || "";

  if (businessNameInput) businessNameInput.value = branding.name || "";
  if (senderNameInput) senderNameInput.value = branding.senderName || branding.name || "";
  if (supportEmailInput) supportEmailInput.value = branding.supportEmail || DEFAULT_SUPPORT_EMAIL;
  if (brandColorInput) brandColorInput.value = branding.color || DEFAULT_COLOR;

  applyLogoPreview(currentLogoUrl);
}

async function handleLogoUpload(file) {
  if (!file || !currentUserId) return null;
  setStatus("Uploading logo…");
  const url = await uploadLogoAndGetURL(file, currentUserId);
  currentLogoUrl = url;
  applyLogoPreview(url);
  setStatus("Logo uploaded");
  return url;
}

async function saveBranding() {
  if (!currentUserId) return;
  const businessName = (businessNameInput?.value || "").trim();
  if (!businessName || businessName.length < 2) {
    setStatus("Business name must be at least 2 characters.", true);
    return;
  }

  const senderName = (senderNameInput?.value || businessName).trim();
  const supportEmail = (supportEmailInput?.value || DEFAULT_SUPPORT_EMAIL).trim().toLowerCase();
  const color = (brandColorInput?.value || DEFAULT_COLOR).trim() || DEFAULT_COLOR;
  const brandingPayload = {
    name: businessName,
    senderName,
    supportEmail: supportEmail || DEFAULT_SUPPORT_EMAIL,
    color,
    logoUrl: currentLogoUrl || "",
    updatedAt: serverTimestamp(),
  };

  setStatus("Saving…");
  saveButton?.setAttribute("disabled", "true");

  const payload = {
    branding: brandingPayload,
    brandColor: brandingPayload.color,
    businessName,
    displayName: businessName,
    name: businessName,
    updatedAt: serverTimestamp(),
    ...(brandingPayload.logoUrl
      ? {
          logoUrl: brandingPayload.logoUrl,
          logoURL: brandingPayload.logoUrl,
          brandLogoUrl: brandingPayload.logoUrl,
          businessLogoUrl: brandingPayload.logoUrl,
        }
      : {}),
  };

  try {
    await Promise.all([
      setDoc(doc(db, "businesses", currentUserId), payload, { merge: true }),
      setDoc(doc(db, "businessProfiles", currentUserId), payload, { merge: true }),
    ]);
    currentBranding = brandingPayload;
    setStatus("Branding saved successfully.");
  } catch (err) {
    console.error("[branding] failed to save", err);
    setStatus(err?.message || "Unable to save branding right now.", true);
  } finally {
    saveButton?.removeAttribute("disabled");
  }
}

async function runDiagnostics() {
  if (!currentUserId) return;
  setStatus("Running diagnostics…");
  diagnosticsButton?.setAttribute("disabled", "true");
  try {
    const callable = httpsCallable(functions, "portalDiagnostics");
    const result = await callable({ businessId: currentUserId });
    diagnosticsOutput.textContent = JSON.stringify(result.data || {}, null, 2);
    setStatus("Diagnostics completed.");
  } catch (err) {
    console.error("[branding] diagnostics failed", err);
    setStatus(err?.message || "Diagnostics failed.", true);
  } finally {
    diagnosticsButton?.removeAttribute("disabled");
  }
}

function wireEvents() {
  logoInput?.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      await handleLogoUpload(file);
    } catch (err) {
      console.error("[branding] logo upload failed", err);
      setStatus("Logo upload failed. Please try a smaller file.", true);
    }
  });

  saveButton?.addEventListener("click", saveBranding);
  diagnosticsButton?.addEventListener("click", runDiagnostics);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  currentUserId = user.uid;
  wireEvents();
  await loadBranding(user.uid);
});
