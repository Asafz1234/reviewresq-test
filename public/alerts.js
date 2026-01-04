import {
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./firebase-config.js";
import { listenForUser } from "./session-data.js";
import { showUpgradeModal } from "./plan-lock.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";

const toggles = {
  newPrivateFeedback: document.querySelector('[data-toggle="newPrivateFeedback"]'),
  newGoogleReview: document.querySelector('[data-toggle="newGoogleReview"]'),
  followUpReminders: document.querySelector('[data-toggle="followUpReminders"]'),
  weeklySummary: document.querySelector('[data-toggle="weeklySummary"]'),
};

const upgradeHints = {
  newPrivateFeedback: document.querySelector('[data-upgrade-hint="newPrivateFeedback"]'),
  newGoogleReview: document.querySelector('[data-upgrade-hint="newGoogleReview"]'),
  followUpReminders: document.querySelector('[data-upgrade-hint="followUpReminders"]'),
  weeklySummary: document.querySelector('[data-upgrade-hint="weeklySummary"]'),
};

const recipientsInput = document.getElementById("alertRecipients");
const saveRecipientsButton = document.querySelector("[data-save-recipients]");
const statusEl = document.querySelector("[data-alert-status]");
const hintEl = document.querySelector("[data-recipient-hint]");

let businessId = null;
let currentUserId = "";
let currentUserEmail = "";
let brandingSupportEmail = "";
let planId = "starter";
let prefs = {
  newPrivateFeedback: false,
  newGoogleReview: false,
  followUpReminders: false,
  weeklySummary: false,
  recipients: [],
};

const SUPPORT_EMAIL = "support@reviewresq.com";

const ENTITLEMENTS = {
  starter: {
    newPrivateFeedback: true,
    newGoogleReview: false,
    followUpReminders: false,
    weeklySummary: false,
  },
  paid: {
    newPrivateFeedback: true,
    newGoogleReview: true,
    followUpReminders: true,
    weeklySummary: true,
  },
};

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

function setStatus(message = "", isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#b91c1c" : "inherit";
}

function uniqueEmails(list = []) {
  const seen = new Set();
  return list
    .map((email) => (email || "").trim().toLowerCase())
    .filter((email) => email && emailRegex.test(email) && !seen.has(email) && seen.add(email));
}

function parseRecipientsFromInput() {
  if (!recipientsInput) return [];
  const lines = (recipientsInput.value || "")
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return uniqueEmails(lines);
}

function renderRecipients(list = []) {
  if (!recipientsInput) return;
  recipientsInput.value = (list || []).join("\n");
  if (hintEl) {
    hintEl.textContent = list?.length ? `${list.length} recipient${list.length > 1 ? "s" : ""}` : "";
  }
}

function renderPrefs() {
  Object.entries(toggles).forEach(([key, el]) => {
    if (!el) return;
    el.checked = Boolean(prefs[key]);
    el.disabled = false;
  });
  renderRecipients(prefs?.recipients || []);
  applyPlanEntitlements();
}

function resolvePlanTier() {
  const normalized = normalizePlan(planId || "starter");
  if (String(planId || "").toLowerCase().includes("starter")) return "starter";
  if (normalized === "starter") return "starter";
  return "paid";
}

function isToggleAllowed(key) {
  const tier = resolvePlanTier();
  const matrix = tier === "starter" ? ENTITLEMENTS.starter : ENTITLEMENTS.paid;
  return Boolean(matrix[key]);
}

function applyPlanEntitlements() {
  Object.entries(toggles).forEach(([key, el]) => {
    if (!el) return;
    const allowed = isToggleAllowed(key);
    el.disabled = !allowed;
    if (!allowed) {
      el.checked = false;
    }
    const hintEl = upgradeHints[key];
    if (hintEl) {
      hintEl.textContent = allowed ? "" : "Upgrade to Pro to enable.";
    }
  });
}

function buildDefaultPrefs() {
  const defaultRecipients = uniqueEmails([
    currentUserEmail,
    SUPPORT_EMAIL,
    brandingSupportEmail,
  ]);
  return {
    newPrivateFeedback: false,
    newGoogleReview: false,
    followUpReminders: false,
    weeklySummary: false,
    recipients: defaultRecipients,
  };
}

async function loadPrefs() {
  if (!businessId) return;
  const ref = doc(db, "businesses", businessId, "notificationPrefs", "main");
  const defaultPrefs = buildDefaultPrefs();
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          ...defaultPrefs,
          updatedAt: serverTimestamp(),
          updatedBy: currentUserId || "system",
        });
      } catch (createErr) {
        console.error("[alerts] failed to create default prefs", createErr);
      }
      prefs = { ...prefs, ...defaultPrefs };
      renderPrefs();
      setStatus("");
      return;
    }

    const data = snap.data() || {};
    const storedRecipients = Array.isArray(data.recipients)
      ? data.recipients
      : data.recipients?.emails;
    prefs = {
      newPrivateFeedback: Boolean(data.newPrivateFeedback),
      newGoogleReview: Boolean(data.newGoogleReview),
      followUpReminders: Boolean(data.followUpReminders),
      weeklySummary: Boolean(data.weeklySummary),
      recipients: uniqueEmails(storedRecipients?.length ? storedRecipients : defaultPrefs.recipients),
    };
    renderPrefs();
    setStatus("");
  } catch (err) {
    console.error("[alerts] failed to load prefs", err);
    prefs = { ...prefs, ...defaultPrefs };
    renderPrefs();
    setStatus("Unable to load your alert preferences right now.", true);
  }
}

async function savePrefs(next = {}) {
  if (!businessId) return;
  const ref = doc(db, "businesses", businessId, "notificationPrefs", "main");
  const nextRecipients = parseRecipientsFromInput();
  const sanitizedToggles = Object.keys(toggles).reduce((acc, key) => {
    const allowed = isToggleAllowed(key);
    acc[key] = allowed ? Boolean((next ?? {})[key] ?? prefs[key]) : false;
    return acc;
  }, {});
  const mergedPrefs = {
    ...prefs,
    ...sanitizedToggles,
    recipients: nextRecipients.length ? nextRecipients : prefs.recipients,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserId || "system",
  };

  try {
    await setDoc(ref, mergedPrefs, { merge: true });
    prefs = {
      ...prefs,
      ...sanitizedToggles,
      recipients: mergedPrefs.recipients,
    };
    renderPrefs();
    setStatus("Alerts updated.");
  } catch (err) {
    console.error("[alerts] failed to save prefs", err);
    setStatus("Could not save changes. Please try again.", true);
    renderPrefs();
  }
}

function requireUpgrade(feature) {
  const requiredPlan = "pro_ai";
  showUpgradeModal(requiredPlan, planId);
  setStatus(
    `${PLAN_LABELS[requiredPlan]} is required for ${feature}. Toggle was reverted.`,
    true,
  );
}

function bindToggle(key) {
  const el = toggles[key];
  if (!el) return;
  el.addEventListener("change", async (event) => {
    const targetChecked = Boolean(event.target.checked);
    const allowed = isToggleAllowed(key);
    if (targetChecked && !allowed) {
      el.checked = false;
      requireUpgrade(
        key === "followUpReminders"
          ? "follow-up reminders"
          : key === "weeklySummary"
            ? "weekly summaries"
            : "this alert",
      );
      return;
    }

    const previous = prefs[key];
    prefs[key] = targetChecked;
    try {
      await savePrefs({ [key]: targetChecked });
    } catch (err) {
      prefs[key] = previous;
      renderPrefs();
      setStatus("We reverted this change because saving failed.", true);
    }
  });
}

function bindRecipientsSave() {
  if (!saveRecipientsButton) return;
  saveRecipientsButton.addEventListener("click", async () => {
    const nextRecipients = parseRecipientsFromInput();
    if (!nextRecipients.length) {
      setStatus("Add at least one valid email recipient.", true);
      renderRecipients(prefs.recipients);
      return;
    }
    await savePrefs({ recipients: nextRecipients });
  });
}

function init() {
  Object.keys(toggles).forEach(bindToggle);
  bindRecipientsSave();

  listenForUser(({ user, subscription, branding }) => {
    businessId = user?.uid;
    currentUserId = user?.uid || "";
    currentUserEmail = user?.email || "";
    brandingSupportEmail = branding?.supportEmail || "";
    planId = subscription?.planId || "starter";
    setStatus("Loading alert preferences...");
    loadPrefs();
  });
}

init();
