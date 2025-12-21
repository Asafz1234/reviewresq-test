import { db, doc, getDoc, setDoc } from "./firebase-config.js";
import { onSession } from "./dashboard-data.js";
import { resolveCanonicalReviewUrl } from "./google-link-utils.js";

const googleInput = document.querySelector("[data-google-link]");
const funnelInput = document.querySelector("[data-funnel-link]");
const toastEl = document.getElementById("copyToast");

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
  if (navigator?.clipboard?.writeText) {
    try {
      return await navigator.clipboard.writeText(text);
    } catch (err) {
      if (window?.isSecureContext !== false) {
        throw err;
      }
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

function bindCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.copy;
      const targetInput =
        type === "googleReview"
          ? document.querySelector("[data-google-link]")
          : type === "portal"
            ? document.querySelector("[data-funnel-link]")
            : null;

      const value = targetInput?.value;

      if (!value || value === "—") {
        showToast("No link available to copy", true);
        return;
      }

      try {
        await copyText(value);
        showToast("Copied!");
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy link";
        }, 1200);
      } catch (err) {
        console.error("[links] copy failed", err);
        showToast("Copy failed", true);
      }
    });
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
}

document.addEventListener("DOMContentLoaded", () => {
  bindCopyButtons();
  onSession(({ user, profile }) => loadLinks(user, profile));
});
