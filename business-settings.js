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
const supportEmailValue = document.getElementById("supportEmailValue");
const brandColorInput = document.getElementById("brandColorInput");
const brandColorHex = document.getElementById("brandColorHex");
const resetColorButton = document.getElementById("resetColorButton");
const logoInput = document.getElementById("logoInput");
const logoPreview = document.getElementById("logoPreview");
const logoPreviewWrapper = document.getElementById("logoPreviewWrapper");
const logoPreviewText = document.getElementById("logoPreviewText");
const logoUploadStatus = document.getElementById("logoUploadStatus");
const saveButton = document.getElementById("saveBranding");
const diagnosticsButton = document.getElementById("diagnosticsBtn");
const diagnosticsOutput = document.getElementById("diagnosticsOutput");
const diagnosticsPanel = document.getElementById("diagnosticsPanel");
const toggleDiagnosticsButton = document.getElementById("toggleDiagnostics");
const statusMessage = document.getElementById("statusMessage");

const previewBusinessName = document.getElementById("previewBusinessName");
const previewSenderName = document.getElementById("previewSenderName");
const previewEmailHeader = document.getElementById("previewEmailHeader");
const previewEmailButton = document.getElementById("previewEmailButton");
const previewEmailSubject = document.getElementById("previewEmailSubject");
const previewPortalTitle = document.getElementById("previewPortalTitle");
const previewPortalButton = document.getElementById("previewPortalButton");
const previewLogo = document.getElementById("previewLogo");
const previewLogoCircle = document.getElementById("previewLogoCircle");

const DEFAULT_COLOR = "#2563EB";
const DEFAULT_SUPPORT_EMAIL = "support@reviewresq.com";

let currentUserId = null;
let currentLogoUrl = "";
let currentLogoPath = "";
let currentBranding = null;

function setStatus(message, isError = false) {
  if (!statusMessage) return;
  statusMessage.hidden = !message;
  statusMessage.textContent = message || "";
  statusMessage.classList.toggle("error", Boolean(isError));
}

function updateColorDisplay(color) {
  const safeColor = color || DEFAULT_COLOR;
  if (brandColorHex) {
    brandColorHex.textContent = safeColor.toUpperCase();
  }
  if (brandColorInput && brandColorInput.value !== safeColor) {
    brandColorInput.value = safeColor;
  }
}

function setUploadStatus(message, type = "info", detail = "") {
  if (!logoUploadStatus) return;
  logoUploadStatus.textContent = message;
  logoUploadStatus.classList.remove("error", "success");
  if (type === "error") logoUploadStatus.classList.add("error");
  if (type === "success") logoUploadStatus.classList.add("success");

  const details = logoUploadStatus.querySelector("details");
  if (details) {
    details.remove();
  }

  if (detail) {
    const detailsEl = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "More details";
    const body = document.createElement("div");
    body.textContent = detail;
    detailsEl.appendChild(summary);
    detailsEl.appendChild(body);
    logoUploadStatus.appendChild(detailsEl);
  }
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
    if (previewLogo) {
      previewLogo.src = url;
      previewLogo.style.display = "block";
    }
    if (previewLogoCircle) {
      previewLogoCircle.style.background = "#fff";
      previewLogoCircle.style.border = "1px solid #e2e8f0";
    }
    if (logoPreviewText) {
      logoPreviewText.textContent = "";
    }
  } else {
    logoPreview.src = "";
    logoPreviewWrapper.style.display = "none";
    if (previewLogo) {
      previewLogo.removeAttribute("src");
      previewLogo.style.display = "none";
    }
    if (previewLogoCircle) {
      previewLogoCircle.style.background = "#e2e8f0";
      previewLogoCircle.style.border = "none";
    }
    if (logoPreviewText) {
      logoPreviewText.textContent = "No logo uploaded";
    }
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
  currentLogoPath = data.branding?.logoPath || "";

  if (businessNameInput) businessNameInput.value = branding.name || "";
  if (senderNameInput) senderNameInput.value = branding.senderName || branding.name || "";
  if (supportEmailValue) supportEmailValue.textContent = branding.supportEmail || DEFAULT_SUPPORT_EMAIL;
  updateColorDisplay(branding.color || DEFAULT_COLOR);

  applyLogoPreview(currentLogoUrl);
  updatePreview();
}

function updatePreview() {
  const businessName = (businessNameInput?.value || "Your business").trim() || "Your business";
  const senderName = (senderNameInput?.value || businessName).trim() || businessName;
  const color = (brandColorInput?.value || DEFAULT_COLOR).trim() || DEFAULT_COLOR;

  if (previewBusinessName) previewBusinessName.textContent = businessName;
  if (previewPortalTitle) previewPortalTitle.textContent = `${businessName} portal`;
  if (previewSenderName) previewSenderName.textContent = senderName;
  if (previewEmailSubject) previewEmailSubject.textContent = `${businessName} would love your feedback`;
  if (previewEmailHeader) previewEmailHeader.style.background = color;
  if (previewEmailButton) previewEmailButton.style.background = color;
  if (previewPortalButton) previewPortalButton.style.background = color;
  if (previewLogoCircle) previewLogoCircle.style.borderColor = color;
  updateColorDisplay(color);
}

function validateFileType(file) {
  const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
  const allowedExt = ["png", "jpg", "jpeg", "webp"];
  const ext = (file.name || "").split(".").pop()?.toLowerCase();
  if (!allowedTypes.includes(file.type) && !allowedExt.includes(ext)) {
    throw new Error("Please upload a PNG, JPG, or WebP file.");
  }
}

function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height, dataUrl: reader.result });
      img.onerror = () => reject(new Error("Unable to read the image. Please try another file."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Unable to read the file."));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas, mimeType, quality = 0.82) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to process the image."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

async function processLogo(file) {
  validateFileType(file);
  const { width, height, dataUrl } = await readImageDimensions(file);
  const maxDimension = 768;
  const needsResize = file.size > 700 * 1024 || Math.max(width, height) > 800;

  if (!needsResize) {
    return { file, note: "Ready to upload" };
  }

  const canvas = document.createElement("canvas");
  const ratio = Math.min(maxDimension / width, maxDimension / height, 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve) => {
    img.onload = resolve;
  });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const qualitySteps = [0.82, 0.74, 0.68];
  for (const quality of qualitySteps) {
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    if (blob.size <= 500 * 1024) {
      const optimizedFile = new File([blob], `${file.name.split(".")[0] || "logo"}.webp`, {
        type: "image/webp",
      });
      return { file: optimizedFile, note: "Optimized for fast loading" };
    }
  }

  const fallbackBlob = await canvasToBlob(canvas, "image/png");
  const optimizedFile = new File([fallbackBlob], `${file.name.split(".")[0] || "logo"}.png`, {
    type: "image/png",
  });
  return { file: optimizedFile, note: "Compressed for upload" };
}

function getLogoPath(fileName) {
  const ext = (fileName || "").split(".").pop();
  const safeExt = ext && ext.length < 8 ? `.${ext}` : "";
  return `logos/${currentUserId}/portal-logo${safeExt}`;
}

async function persistLogoReference(url, path) {
  const payload = {
    branding: {
      ...(currentBranding || {}),
      logoUrl: url,
      logoPath: path || currentLogoPath || "",
      updatedAt: serverTimestamp(),
    },
    logoUrl: url,
    logoURL: url,
    businessLogoUrl: url,
    brandLogoUrl: url,
  };

  await Promise.all([
    setDoc(doc(db, "businesses", currentUserId), payload, { merge: true }),
    setDoc(doc(db, "businessProfiles", currentUserId), payload, { merge: true }),
  ]);
}

async function handleLogoUpload(file) {
  if (!file || !currentUserId) return null;

  setUploadStatus("Uploading…");

  if (file.size > 6 * 1024 * 1024) {
    const message = "File is too large to process (max 6MB).";
    setUploadStatus(message, "error");
    throw new Error(message);
  }

  if (file.size > 2 * 1024 * 1024) {
    setUploadStatus("Optimizing large file before upload…");
  }

  try {
    const { file: processedFile, note } = await processLogo(file);
    const url = await uploadLogoAndGetURL(processedFile, currentUserId, { timeoutMs: 25000 });
    currentLogoUrl = url;
    currentLogoPath = getLogoPath(processedFile.name);
    applyLogoPreview(url);
    await persistLogoReference(url, currentLogoPath);
    currentBranding = { ...(currentBranding || {}), logoUrl: url, logoPath: currentLogoPath };
    setUploadStatus(`Saved ✓ ${note}`, "success");
    setStatus("Logo uploaded", false);
    updatePreview();
    return url;
  } catch (err) {
    console.error("[branding] logo upload failed", err);
    setUploadStatus(
      "Upload failed. Try a different file or smaller image.",
      "error",
      err?.message || ""
    );
    setStatus(err?.message || "Logo upload failed. Please try a smaller file.", true);
    throw err;
  }
}

async function saveBranding() {
  if (!currentUserId) return;
  const businessName = (businessNameInput?.value || "").trim();
  if (!businessName || businessName.length < 2) {
    setStatus("Business name must be at least 2 characters.", true);
    return;
  }

  const senderName = (senderNameInput?.value || businessName).trim();
  const supportEmail = DEFAULT_SUPPORT_EMAIL;
  const color = (brandColorInput?.value || DEFAULT_COLOR).trim() || DEFAULT_COLOR;
  const brandingPayload = {
    name: businessName,
    senderName,
    supportEmail: supportEmail || DEFAULT_SUPPORT_EMAIL,
    color,
    logoUrl: currentLogoUrl || "",
    logoPath: currentLogoPath || "",
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
  if (diagnosticsPanel) diagnosticsPanel.hidden = false;
  if (toggleDiagnosticsButton)
    toggleDiagnosticsButton.textContent = diagnosticsPanel.hidden
      ? "Troubleshoot (advanced)"
      : "Hide advanced panel";
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

  businessNameInput?.addEventListener("input", updatePreview);
  senderNameInput?.addEventListener("input", updatePreview);

  brandColorInput?.addEventListener("input", () => {
    const color = brandColorInput.value || DEFAULT_COLOR;
    updateColorDisplay(color);
    updatePreview();
  });

  resetColorButton?.addEventListener("click", () => {
    updateColorDisplay(DEFAULT_COLOR);
    updatePreview();
  });

  saveButton?.addEventListener("click", saveBranding);
  diagnosticsButton?.addEventListener("click", runDiagnostics);

  toggleDiagnosticsButton?.addEventListener("click", () => {
    if (!diagnosticsPanel) return;
    diagnosticsPanel.hidden = !diagnosticsPanel.hidden;
    toggleDiagnosticsButton.textContent = diagnosticsPanel.hidden
      ? "Troubleshoot (advanced)"
      : "Hide advanced panel";
  });
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
