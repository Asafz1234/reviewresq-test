import { onSession } from "./dashboard-data.js";
import { db, doc, getDoc } from "./firebase-config.js";

const inputs = {
  happyHeadline: document.querySelector("[data-happy-headline]"),
  happyCta: document.querySelector("[data-happy-cta]"),
  happyPrompt: document.querySelector("[data-happy-prompt]"),
  unhappyHeadline: document.querySelector("[data-unhappy-headline]"),
  followupOwner: document.querySelector("[data-followup-owner]"),
  unhappyMessage: document.querySelector("[data-unhappy-message]"),
  primaryColor: document.querySelector("[data-brand-primary]"),
  logo: document.querySelector("[data-brand-logo]"),
};

function applySettings(settings = {}) {
  if (inputs.happyHeadline) inputs.happyHeadline.value = settings.headline || inputs.happyHeadline.value;
  if (inputs.happyCta) inputs.happyCta.value = settings.ctaLabelHighRating || settings.ctaLabel || inputs.happyCta.value;
  if (inputs.happyPrompt)
    inputs.happyPrompt.value = settings.subheadline || settings.prompt || inputs.happyPrompt.value;
  if (inputs.unhappyHeadline)
    inputs.unhappyHeadline.value = settings.thankYouTitle || settings.lowRatingHeadline || inputs.unhappyHeadline.value;
  if (inputs.followupOwner) inputs.followupOwner.value = settings.followupOwner || settings.owner || inputs.followupOwner.value;
  if (inputs.unhappyMessage)
    inputs.unhappyMessage.value = settings.thankYouBody || settings.lowRatingMessage || inputs.unhappyMessage.value;
  if (inputs.primaryColor && settings.primaryColor) inputs.primaryColor.value = settings.primaryColor;
  if (inputs.logo && settings.logoUrl) inputs.logo.setAttribute("data-existing-logo", settings.logoUrl);
}

onSession(async ({ user }) => {
  if (!user) return;
  const ref = doc(db, "portalSettings", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    applySettings(snap.data());
  }
});
