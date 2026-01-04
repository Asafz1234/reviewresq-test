import {
  db,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./firebase-config.js";
import { listenForUser, isStarterPlan } from "./session-data.js";
import { showUpgradeModal } from "./plan-lock.js";
import { PLAN_LABELS } from "./plan-capabilities.js";

const toggles = {
  newPrivateFeedback: document.querySelector('[data-toggle="newPrivateFeedback"]'),
  newGoogleReview: document.querySelector('[data-toggle="newGoogleReview"]'),
  followUpReminders: document.querySelector('[data-toggle="followUpReminders"]'),
  weeklySummary: document.querySelector('[data-toggle="weeklySummary"]'),
};

const recipientsInput = document.getElementById("alertRecipients");
const saveRecipientsButton = document.querySelector("[data-save-recipients]");
const statusEl = document.querySelector("[data-alert-status]");
const hintEl = document.querySelector("[data-recipient-hint]");

let businessId = null;
let currentUserEmail = "";
let brandingSupportEmail = "";
let planId = "starter";
let prefs = {
  newPrivateFeedback: false,
  newGoogleReview: false,
  followUpReminders: false,
  weeklySummary: false,
  channels: { email: true },
  recipients: { emails: [] },
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
  renderRecipients(prefs?.recipients?.emails || []);
}

async function loadPrefs() {
  if (!businessId) return;
  const ref = doc(db, "businesses", businessId, "notificationPrefs", "main");
  try {
    const snap = await getDoc(ref);
    const fallbackRecipients = uniqueEmails([
      currentUserEmail,
      brandingSupportEmail,
    ]);
    if (!snap.exists()) {
      prefs = {
        ...prefs,
        recipients: { emails: fallbackRecipients },
      };
      renderPrefs();
      return;
    }

    const data = snap.data() || {};
    prefs = {
      newPrivateFeedback: Boolean(data.newPrivateFeedback),
      newGoogleReview: Boolean(data.newGoogleReview),
      followUpReminders: Boolean(data.followUpReminders),
      weeklySummary: Boolean(data.weeklySummary),
      channels: { email: data.channels?.email !== false },
      recipients: {
        emails: uniqueEmails(data.recipients?.emails || fallbackRecipients),
      },
    };
    renderPrefs();
    setStatus("");
  } catch (err) {
    console.error("[alerts] failed to load prefs", err);
    setStatus("Unable to load your alert preferences right now.", true);
  }
}

async function savePrefs(next = {}) {
  if (!businessId) return;
  const ref = doc(db, "businesses", businessId, "notificationPrefs", "main");
  const nextRecipients = parseRecipientsFromInput();
  const mergedPrefs = {
    ...prefs,
    ...next,
    channels: { email: true },
    recipients: { emails: nextRecipients.length ? nextRecipients : prefs.recipients.emails },
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, mergedPrefs, { merge: true });
    prefs = {
      ...prefs,
      ...next,
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

    const gated =
      isStarterPlan(planId) && (key === "followUpReminders" || key === "weeklySummary");
    if (targetChecked && gated) {
      el.checked = false;
      requireUpgrade(key === "followUpReminders" ? "follow-up reminders" : "weekly summaries");
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
      renderRecipients(prefs.recipients.emails);
      return;
    }
    await savePrefs({ recipients: { emails: nextRecipients } });
  });
}

function init() {
  Object.keys(toggles).forEach(bindToggle);
  bindRecipientsSave();

  listenForUser(({ user, subscription, branding }) => {
    businessId = user?.uid;
    currentUserEmail = user?.email || "";
    brandingSupportEmail = branding?.supportEmail || "";
    planId = subscription?.planId || "starter";
    setStatus("Loading alert preferences...");
    loadPrefs();
  });
}

init();
