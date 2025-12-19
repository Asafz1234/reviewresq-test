import { onSession } from "./dashboard-data.js";
import {
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  httpsCallable,
  functions,
  uploadLogoAndGetURL,
} from "./firebase-config.js";
import { PLAN_LABELS, normalizePlan, getPlanCapabilities } from "./plan-capabilities.js";

const DEFAULT_SETTINGS = {
  mode: "manual",
  happy: {
    headline: "Thanks for your visit!",
    prompt: "Share a quick note about your experience so others know what to expect.",
    ctaLabel: "Leave us a Google review",
    googleReviewUrl: "",
  },
  unhappy: {
    headline: "We're here to make it right",
    message: "Tell us what happened and how we can improve. We'll respond quickly.",
    followupEmail: "",
  },
  routing: {
    enabled: true,
    type: "rating",
    thresholds: { googleMin: 4 },
  },
  branding: {
    logoUrl: "",
    primaryColor: "#2563eb",
  },
};

const ui = {
  planBadge: document.querySelector("[data-plan-badge]"),
  aiBadge: document.querySelector("[data-ai-badge]"),
  callout: document.querySelector("[data-plan-callout]"),
  calloutTitle: document.querySelector("[data-plan-callout-title]"),
  calloutBody: document.querySelector("[data-plan-callout-body]"),
  calloutCta: document.querySelector("[data-plan-upgrade]"),
  happyHeadline: document.querySelector("[data-happy-headline]"),
  happyCta: document.querySelector("[data-happy-cta]"),
  happyPrompt: document.querySelector("[data-happy-prompt]"),
  googleUrl: document.querySelector("[data-google-url]"),
  unhappyHeadline: document.querySelector("[data-unhappy-headline]"),
  followupOwner: document.querySelector("[data-followup-owner]"),
  unhappyMessage: document.querySelector("[data-unhappy-message]"),
  primaryColor: document.querySelector("[data-brand-primary]"),
  logo: document.querySelector("[data-brand-logo]"),
  advancedOverlay: document.querySelector("[data-advanced-overlay]"),
  advancedBody: document.querySelector("[data-advanced-body]"),
  advancedLockLabel: document.querySelector("[data-advanced-lock-label]"),
  ratingThreshold: document.querySelector("[data-rating-threshold]"),
  ratingChip: document.querySelector("[data-rating-chip]"),
  upgradeCluster: document.querySelector("[data-upgrade-cluster]"),
  saveButton: document.querySelector("[data-save]"),
  saveRow: document.querySelector("[data-save-row]"),
  saveHint: document.querySelector("[data-save-hint]"),
  aiNote: document.querySelector("[data-ai-note]"),
};

let businessId = null;
let currentPlan = "starter";
let currentCapabilities = getPlanCapabilities(currentPlan);
let activeSettings = { ...DEFAULT_SETTINGS };

function setHidden(element, hidden = true) {
  if (!element) return;
  element.classList.toggle("hidden", hidden);
}

function setEditable(input, editable) {
  if (!input) return;
  input.disabled = !editable;
  if (editable) {
    input.removeAttribute("aria-disabled");
  } else {
    input.setAttribute("aria-disabled", "true");
  }
}

function applySettings(settings = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings,
    happy: { ...DEFAULT_SETTINGS.happy, ...(settings.happy || {}) },
    unhappy: { ...DEFAULT_SETTINGS.unhappy, ...(settings.unhappy || {}) },
    routing: { ...DEFAULT_SETTINGS.routing, ...(settings.routing || {}) },
    branding: { ...DEFAULT_SETTINGS.branding, ...(settings.branding || {}) },
  };

  activeSettings = merged;

  if (ui.happyHeadline) ui.happyHeadline.value = merged.happy.headline || "";
  if (ui.happyCta) ui.happyCta.value = merged.happy.ctaLabel || "";
  if (ui.happyPrompt) ui.happyPrompt.value = merged.happy.prompt || "";
  if (ui.googleUrl) ui.googleUrl.value = merged.happy.googleReviewUrl || "";

  if (ui.unhappyHeadline) ui.unhappyHeadline.value = merged.unhappy.headline || "";
  if (ui.followupOwner) ui.followupOwner.value = merged.unhappy.followupEmail || "";
  if (ui.unhappyMessage) ui.unhappyMessage.value = merged.unhappy.message || "";

  if (ui.ratingThreshold) ui.ratingThreshold.value = merged.routing.thresholds?.googleMin || 4;
  if (ui.primaryColor) ui.primaryColor.value = merged.branding.primaryColor || "#2563eb";
}

function showUpgradeModal() {
  const modal = document.getElementById("funnel-upgrade-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function hideUpgradeModal() {
  const modal = document.getElementById("funnel-upgrade-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bindUpgradeModal() {
  const modal = document.getElementById("funnel-upgrade-modal");
  if (!modal || modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";

  modal.querySelector(".close-btn")?.addEventListener("click", hideUpgradeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) hideUpgradeModal();
  });
  const dismissBtn = modal.querySelector('[data-plan-cta="dismiss"]');
  dismissBtn?.addEventListener("click", hideUpgradeModal);
  const upgradeBtn = modal.querySelector('[data-plan-cta="growth"]');
  upgradeBtn?.addEventListener("click", () => {
    window.location.href = "/billing.html?plan=growth";
  });
}

function renderPlanState(planId, capabilities) {
  currentPlan = planId;
  currentCapabilities = capabilities;
  const { features } = capabilities;
  const isStarter = planId === "starter";
  const isGrowth = planId === "growth";
  const isAi = Boolean(features.reviewFunnelAIManaged);

  if (ui.planBadge) ui.planBadge.textContent = PLAN_LABELS[planId] || planId;
  setHidden(ui.aiBadge, !isAi);

  if (ui.callout) {
    setHidden(ui.callout, !isStarter);
    if (isStarter) {
      ui.calloutTitle.textContent = "Review Funnel (Starter)";
      ui.calloutBody.textContent =
        "Collect feedback and send happy customers to Google automatically.";
    }
  }

  if (ui.advancedOverlay) {
    if (isStarter) {
      ui.advancedOverlay.querySelector(".card-title").textContent = "Available in Growth";
      ui.advancedOverlay.querySelector(".card-subtitle").textContent =
        "Customize messages, set rating rules, and add branding.";
      ui.advancedOverlay.classList.remove("hidden");
      ui.advancedOverlay.dataset.mode = "locked";
    } else if (isAi) {
      ui.advancedOverlay.querySelector(".card-title").textContent = "Managed by ReviewResq AI";
      ui.advancedOverlay.querySelector(".card-subtitle").textContent =
        "AI is handling routing and follow-ups automatically.";
      ui.advancedOverlay.classList.remove("hidden");
      ui.advancedOverlay.dataset.mode = "ai";
    } else {
      ui.advancedOverlay.classList.add("hidden");
      ui.advancedOverlay.dataset.mode = "unlocked";
    }
  }

  if (ui.advancedBody) {
    ui.advancedBody.classList.toggle("is-preview", isStarter || isAi);
  }

  if (ui.advancedLockLabel) {
    ui.advancedLockLabel.textContent = isStarter ? "Available in Growth" : isAi ? "Managed by AI" : "";
    setHidden(ui.advancedLockLabel, !(isStarter || isAi));
  }

  if (ui.ratingChip) {
    ui.ratingChip.textContent = isGrowth ? "Enabled" : isAi ? "AI-optimized" : "Available in Growth";
    ui.ratingChip.classList.toggle("chip-primary", isGrowth);
  }

  const starterEditable = !isAi && !isGrowth;
  const fullEditable = isGrowth && !isAi;

  setEditable(ui.happyHeadline, !isAi);
  setEditable(ui.happyCta, !isAi);
  setEditable(ui.happyPrompt, fullEditable);
  setEditable(ui.googleUrl, fullEditable);

  setEditable(ui.unhappyHeadline, fullEditable && !isAi && !isStarter);
  setEditable(ui.unhappyMessage, fullEditable && !isAi && !isStarter);
  setEditable(ui.followupOwner, fullEditable || starterEditable);
  setEditable(ui.ratingThreshold, fullEditable);
  setEditable(ui.logo, fullEditable && Boolean(features.reviewFunnelBrandingLogo));
  setEditable(ui.primaryColor, fullEditable && Boolean(features.reviewFunnelBrandingLogo));

  setHidden(ui.saveRow, isAi);
  setHidden(ui.aiNote, !isAi);

  if (ui.saveHint) {
    if (isStarter) {
      ui.saveHint.textContent = "Starter lets you edit the headline and CTA. Upgrade for more control.";
    } else if (isAi) {
      ui.saveHint.textContent = "Managed by AI.";
    } else {
      ui.saveHint.textContent = "";
    }
  }
}

async function loadBusinessPlan(uid) {
  const businessRef = doc(db, "businesses", uid);
  const snap = await getDoc(businessRef);
  if (!snap.exists()) {
    const plan = "starter";
    const capabilities = getPlanCapabilities(plan);
    await setDoc(
      businessRef,
      { plan, features: capabilities.features, updatedAt: serverTimestamp() },
      { merge: true },
    );
    return { plan, features: capabilities.features };
  }

  const data = snap.data() || {};
  const plan = normalizePlan(data.plan || data.planId || data.subscription?.planId || "starter");
  const capabilities = getPlanCapabilities(plan);
  const mergedFeatures = { ...(data.features || {}), ...capabilities.features };
  await setDoc(businessRef, { plan, features: mergedFeatures }, { merge: true });
  return { plan, features: mergedFeatures };
}

async function loadSettings(uid) {
  const ref = doc(db, "businesses", uid, "settings", "reviewFunnel");
  const snap = await getDoc(ref);
  if (!snap.exists()) return DEFAULT_SETTINGS;
  return snap.data();
}

function collectPatch() {
  const features = currentCapabilities.features;
  const isAi = Boolean(features.reviewFunnelAIManaged);
  const isGrowth = currentPlan === "growth";
  const isStarter = currentPlan === "starter";

  if (isAi) return {};

  const patch = { happy: {}, unhappy: {}, routing: {}, branding: {} };

  if (ui.happyHeadline) patch.happy.headline = ui.happyHeadline.value.trim();
  if (ui.happyCta) patch.happy.ctaLabel = ui.happyCta.value.trim();

  if (isGrowth) {
    patch.happy.prompt = ui.happyPrompt?.value?.trim() || "";
    patch.happy.googleReviewUrl = ui.googleUrl?.value?.trim() || "";
    patch.unhappy.headline = ui.unhappyHeadline?.value?.trim() || "";
    patch.unhappy.message = ui.unhappyMessage?.value?.trim() || "";
    patch.routing = {
      enabled: true,
      type: "rating",
      thresholds: { googleMin: Number(ui.ratingThreshold?.value || 4) },
    };
    patch.branding.logoUrl = activeSettings.branding.logoUrl || "";
    patch.branding.primaryColor = ui.primaryColor?.value || "#2563eb";
  }

  patch.unhappy.followupEmail = ui.followupOwner?.value?.trim() || "";

  if (isStarter) {
    return {
      happy: { headline: patch.happy.headline, ctaLabel: patch.happy.ctaLabel },
      unhappy: { followupEmail: patch.unhappy.followupEmail },
    };
  }

  return patch;
}

async function maybeUploadLogo() {
  if (!ui.logo || !ui.logo.files || !ui.logo.files.length) return null;
  const file = ui.logo.files[0];
  if (!businessId) return null;
  return uploadLogoAndGetURL(file, businessId);
}

async function saveSettings() {
  if (!businessId || !ui.saveButton) return;
  ui.saveButton.disabled = true;
  ui.saveButton.textContent = "Saving...";
  ui.saveHint.textContent = "";

  try {
    const patch = collectPatch();
    const logoUrl = await maybeUploadLogo();
    if (logoUrl) {
      patch.branding = { ...(patch.branding || {}), logoUrl };
      activeSettings.branding.logoUrl = logoUrl;
    }

    const update = httpsCallable(functions, "updateReviewFunnelSettings");
    await update({ businessId, patch });
    ui.saveHint.textContent = "Saved. Your review funnel is up to date.";
  } catch (err) {
    console.error("[funnel] save failed", err);
    ui.saveHint.textContent =
      err?.message || "We couldn't save your changes right now. Please try again.";
  } finally {
    ui.saveButton.disabled = false;
    ui.saveButton.textContent = "Save changes";
  }
}

function bindEvents() {
  ui.saveButton?.addEventListener("click", saveSettings);
  ui.calloutCta?.addEventListener("click", showUpgradeModal);
  ui.upgradeCluster?.addEventListener("click", showUpgradeModal);
  ui.advancedOverlay?.addEventListener("click", () => {
    if (ui.advancedOverlay?.dataset.mode === "locked") showUpgradeModal();
  });
  bindUpgradeModal();
}

async function init(user) {
  businessId = user.uid;
  const planInfo = await loadBusinessPlan(user.uid);
  const settings = await loadSettings(user.uid);
  applySettings(settings);
  renderPlanState(planInfo.plan, { plan: planInfo.plan, features: planInfo.features });
}

onSession(async ({ user }) => {
  if (!user) return;
  bindEvents();
  await init(user);
});
