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
  ratingThreshold: document.querySelector("[data-rating-threshold]"),
  ratingChip: document.querySelector("[data-rating-chip]"),
  happyAdvanced: document.querySelector("[data-happy-advanced]"),
  advancedSections: Array.from(document.querySelectorAll("[data-section-advanced]")),
  upgradeCard: document.querySelector("[data-upgrade-card]"),
  saveButton: document.querySelector("[data-save]"),
  saveContainer: document.querySelector("[data-save-container]"),
  saveHint: document.querySelector("[data-save-hint]"),
  aiNote: document.querySelector("[data-ai-note]"),
  aiActivity: document.querySelector("[data-ai-activity]"),
  upgradeModal: document.querySelector("[data-upgrade-modal]"),
  upgradeModalUpgrade: document.querySelector("[data-modal-upgrade]"),
  upgradeModalDismiss: document.querySelector("[data-modal-dismiss]"),
  upgradeOpeners: Array.from(document.querySelectorAll("[data-upgrade-open], [data-plan-upgrade]")),
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
  if (!ui.upgradeModal) return;
  ui.upgradeModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function hideUpgradeModal() {
  if (!ui.upgradeModal) return;
  ui.upgradeModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bindUpgradeModal() {
  if (!ui.upgradeModal || ui.upgradeModal.dataset.bound === "true") return;
  ui.upgradeModal.dataset.bound = "true";

  ui.upgradeModal.addEventListener("click", (event) => {
    if (event.target === ui.upgradeModal) hideUpgradeModal();
  });

  ui.upgradeModalDismiss?.addEventListener("click", hideUpgradeModal);
  ui.upgradeModalUpgrade?.addEventListener("click", () => {
    window.location.href = "/billing.html?plan=growth";
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideUpgradeModal();
  });
}

function renderPlanState(planId, capabilities) {
  currentPlan = planId;
  currentCapabilities = capabilities;
  const features = capabilities.features || {};
  const funnel = capabilities.reviewFunnel || {};
  const editable = funnel.editableFields || {};
  const isStarter = funnel.mode === "starter";
  const isGrowth = funnel.mode === "full";
  const isAi = Boolean(funnel.readOnly || features.reviewFunnelAIManaged);

  if (ui.planBadge) ui.planBadge.textContent = PLAN_LABELS[planId] || planId;
  setHidden(ui.aiBadge, !isAi);
  setHidden(ui.aiNote, !isAi);
  setHidden(ui.aiActivity, !isAi);

  if (ui.callout) {
    setHidden(ui.callout, !isStarter);
    if (isStarter) {
      ui.calloutTitle.textContent = "Review Funnel (Starter)";
      ui.calloutBody.textContent =
        "Starter lets you edit Headline & CTA. Upgrade for routing, branding, and follow-ups.";
    }
  }

  if (ui.happyAdvanced) {
    setHidden(ui.happyAdvanced, !funnel.showHappyDetails);
  }

  ui.advancedSections.forEach((section) => {
    setHidden(section, !funnel.showAdvancedSections);
  });

  setHidden(ui.upgradeCard, !isStarter);
  setHidden(ui.saveContainer, !funnel.allowSave);

  if (ui.ratingChip) {
    ui.ratingChip.textContent = isGrowth ? "Enabled" : isAi ? "AI managed" : "Locked";
    ui.ratingChip.classList.toggle("chip-primary", isGrowth);
  }

  setEditable(ui.happyHeadline, editable.happyHeadline);
  setEditable(ui.happyCta, editable.happyCta);
  setEditable(ui.happyPrompt, editable.happyPrompt);
  setEditable(ui.googleUrl, editable.googleReviewUrl);
  setEditable(ui.ratingThreshold, editable.routing);
  setEditable(ui.unhappyHeadline, editable.unhappyHeadline);
  setEditable(ui.unhappyMessage, editable.unhappyMessage);
  setEditable(ui.followupOwner, editable.followupEmail);
  setEditable(ui.logo, editable.branding);
  setEditable(ui.primaryColor, editable.branding);

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

function setPatchValue(target, path, value) {
  if (value === undefined) return;
  const parts = path.split(".");
  const last = parts.pop();
  let ref = target;
  parts.forEach((part) => {
    if (!ref[part]) ref[part] = {};
    ref = ref[part];
  });
  ref[last] = value;
}

function collectPatch() {
  const funnel = currentCapabilities.reviewFunnel || {};
  const allowed = new Set(funnel.allowedPatchPaths || []);
  if (!allowed.size) return {};

  const patch = {};
  const allow = (path) => allowed.has(path);

  if (allow("happy.headline")) setPatchValue(patch, "happy.headline", ui.happyHeadline?.value?.trim() || "");
  if (allow("happy.ctaLabel")) setPatchValue(patch, "happy.ctaLabel", ui.happyCta?.value?.trim() || "");
  if (allow("happy.prompt")) setPatchValue(patch, "happy.prompt", ui.happyPrompt?.value?.trim() || "");
  if (allow("happy.googleReviewUrl"))
    setPatchValue(patch, "happy.googleReviewUrl", ui.googleUrl?.value?.trim() || "");

  if (allow("routing.thresholds.googleMin")) {
    setPatchValue(patch, "routing.enabled", true);
    setPatchValue(patch, "routing.type", "rating");
    setPatchValue(patch, "routing.thresholds.googleMin", Number(ui.ratingThreshold?.value || 4));
  }

  if (allow("unhappy.headline")) setPatchValue(patch, "unhappy.headline", ui.unhappyHeadline?.value?.trim() || "");
  if (allow("unhappy.message")) setPatchValue(patch, "unhappy.message", ui.unhappyMessage?.value?.trim() || "");
  if (allow("unhappy.followupEmail"))
    setPatchValue(patch, "unhappy.followupEmail", ui.followupOwner?.value?.trim() || "");

  if (allow("branding.primaryColor"))
    setPatchValue(patch, "branding.primaryColor", ui.primaryColor?.value || "#2563eb");

  if (allow("branding.logoUrl") && activeSettings.branding.logoUrl) {
    setPatchValue(patch, "branding.logoUrl", activeSettings.branding.logoUrl);
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
  if (ui.saveHint) ui.saveHint.textContent = "";

  try {
    const patch = collectPatch();
    const logoUrl = await maybeUploadLogo();
    if (logoUrl && (currentCapabilities.reviewFunnel?.allowedPatchPaths || []).includes("branding.logoUrl")) {
      setPatchValue(patch, "branding.logoUrl", logoUrl);
      activeSettings.branding.logoUrl = logoUrl;
    }

    const update = httpsCallable(functions, "updateReviewFunnelSettings");
    await update({ businessId, patch });
    if (ui.saveHint) ui.saveHint.textContent = "Saved. Your review funnel is up to date.";
  } catch (err) {
    console.error("[funnel] save failed", err);
    if (ui.saveHint) {
      ui.saveHint.textContent =
        err?.message || "We couldn't save your changes right now. Please try again.";
    }
  } finally {
    ui.saveButton.disabled = false;
    ui.saveButton.textContent = "Save changes";
  }
}

function bindEvents() {
  ui.saveButton?.addEventListener("click", saveSettings);
  ui.upgradeOpeners.forEach((btn) => btn.addEventListener("click", showUpgradeModal));
  bindUpgradeModal();
}

async function init(user) {
  businessId = user.uid;
  const planInfo = await loadBusinessPlan(user.uid);
  const settings = await loadSettings(user.uid);
  applySettings(settings);
  const planCapabilities = getPlanCapabilities(planInfo.plan);
  renderPlanState(planInfo.plan, {
    plan: planInfo.plan,
    features: planInfo.features || planCapabilities.features,
    reviewFunnel: planCapabilities.reviewFunnel,
  });
}

onSession(async ({ user }) => {
  if (!user) return;
  bindEvents();
  await init(user);
});
