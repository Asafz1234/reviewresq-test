import { db, doc, getDoc, setDoc } from "./firebase-config.js";
import { onSession } from "./dashboard-data.js";
import { resolveCanonicalReviewUrl } from "./google-link-utils.js";

const googleInput = document.querySelector("[data-google-link]");
const funnelInput = document.querySelector("[data-funnel-link]");
const toastEl = document.getElementById("copyToast");
const qrButton = document.querySelector("[data-download-qr]");

function setValue(input, value) {
  if (!input) return;
  input.value = value || "—";
}

function showToast(message, isError = false) {
  if (!toastEl) return alert(message);
  toastEl.textContent = message;
  toastEl.classList.toggle("toast-error", Boolean(isError));
  toastEl.classList.add("visible");
  setTimeout(() => toastEl.classList.remove("visible"), 2000);
}

async function copyText(text) {
  if (!text) throw new Error("No text to copy");
  if (navigator?.clipboard?.writeText && window.isSecureContext !== false) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      // fallback below
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function setQrButtonEnabled(enabled) {
  if (!qrButton) return;
  qrButton.disabled = !enabled;
  qrButton.classList.toggle("btn-disabled", !enabled);
}

async function generateQrBlob(url) {
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(url)}`;
  const response = await fetch(qrApiUrl);
  if (!response.ok) {
    throw new Error("QR service unavailable");
  }
  return response.blob();
}

async function downloadQrCode(url) {
  const blob = await generateQrBlob(url);
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "reviewresq-qr.png";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(objectUrl);
}

function bindCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const defaultLabel = btn.dataset.defaultLabel || btn.textContent || "Copy link";
      const type = btn.dataset.copy;
      const targetInput =
        type === "googleReview"
          ? document.querySelector("[data-google-link]")
          : type === "portal"
            ? document.querySelector("[data-funnel-link]")
            : null;

      const value = (targetInput?.value || "").trim();

      if (!value || value === "—") {
        showToast("No link available to copy", true);
        return;
      }

      try {
        await copyText(value);
        showToast("Copied!");
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = defaultLabel;
        }, 1500);
      } catch (err) {
        console.error("[links] copy failed", err);
        showToast("Copy failed", true);
      }
    });
  });
}

function bindQrDownload() {
  if (!qrButton) return;
  const defaultLabel = qrButton.textContent || "Download QR code";

  qrButton.addEventListener("click", async () => {
    const funnelLink = (funnelInput?.value || "").trim();

    if (!funnelLink || funnelLink === "—") {
      showToast("No funnel link available", true);
      return;
    }

    qrButton.disabled = true;
    qrButton.textContent = "Preparing…";

    try {
      await downloadQrCode(funnelLink);
      showToast("QR code downloaded");
    } catch (err) {
      console.error("[links] QR download failed", err);
      showToast("QR download failed", true);
    } finally {
      qrButton.textContent = defaultLabel;
      qrButton.disabled = false;
    }
  });
}

async function loadLinks(user, profile) {
  if (!user) return;
  const businessRef = doc(db, "businesses", user.uid);
  let businessData = null;

  try {
    const snap = await getDoc(businessRef);
    businessData = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("[links] failed to load business doc", err);
  }

  const googleLink =
    resolveCanonicalReviewUrl({ ...businessData, ...profile }) || profile?.googleLink || "";

  if (googleLink && businessRef) {
    try {
      await setDoc(
        businessRef,
        {
          googleReviewUrl: googleLink,
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("[links] unable to persist googleReviewUrl", err);
    }
  }

  const shareKey = businessData?.shareKey || profile?.shareKey || "";
  const funnelLink =
    businessData?.publicFunnelUrl ||
    businessData?.portalUrl ||
    profile?.publicFunnelUrl ||
    profile?.funnelLink ||
    profile?.portalUrl ||
    (shareKey ? `https://reviewresq.com/portal.html?shareKey=${shareKey}` : "") ||
    (user?.uid ? `https://reviewresq.com/portal.html?businessId=${user.uid}` : "");

  setValue(googleInput, googleLink || "—");
  setValue(funnelInput, funnelLink || "—");
  setQrButtonEnabled(Boolean(funnelLink));
}

document.addEventListener("DOMContentLoaded", () => {
  setQrButtonEnabled(false);
  bindCopyButtons();
  bindQrDownload();
  onSession(({ user, profile }) => loadLinks(user, profile));
});
