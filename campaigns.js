import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  httpsCallable,
  functions,
} from "./firebase-config.js";
import { listenForUser, currentPlanTier, hasPlanFeature } from "./session-data.js";
import { PLAN_LABELS } from "./plan-capabilities.js";

const form = document.getElementById("campaignForm");
const audienceStatus = document.getElementById("audienceStatus");
const audienceSource = document.getElementById("audienceSource");
const channelSelect = document.getElementById("channelSelect");
const templateBody = document.getElementById("templateBody");
const scheduleInput = document.getElementById("scheduleInput");
const followUpRules = document.getElementById("followUpRules");
const campaignStatusBadge = document.getElementById("campaignStatus");
const previewCampaignBtn = document.getElementById("previewCampaign");
const campaignsTableBody = document.getElementById("campaignsTableBody");
const refreshCampaignsBtn = document.getElementById("refreshCampaigns");

const rateLimitInput = document.getElementById("rateLimit");
const loadCustomersBtn = document.getElementById("loadCustomers");
const selectAll = document.getElementById("selectAllCustomers");
const audienceTableBody = document.getElementById("audienceTableBody");
const messagePreview = document.getElementById("messagePreview");
const previewCount = document.getElementById("previewCount");
const sendBulkBtn = document.getElementById("sendBulkBtn");
const sendResults = document.getElementById("sendResults");
const planNotice = document.getElementById("campaignPlanNotice");
const planBadge = document.getElementById("planBadge");

let businessId = null;
let customers = [];
const selected = new Set();
let campaignUnsubscribe = null;
let allowManualCampaigns = false;

function syncPlanState(plan = "starter") {
  allowManualCampaigns = hasPlanFeature("campaigns_manual");
  if (planBadge) {
    planBadge.textContent = PLAN_LABELS[plan] || planBadge.textContent;
  }

  const controls = [
    sendBulkBtn,
    previewCampaignBtn,
    form?.querySelector('button[type="submit"]'),
    loadCustomersBtn,
  ];

  controls.forEach((control) => {
    if (!control) return;
    control.disabled = !allowManualCampaigns;
    if (allowManualCampaigns) {
      control.removeAttribute("aria-disabled");
    } else {
      control.setAttribute("aria-disabled", "true");
    }
  });

  if (planNotice) {
    if (!allowManualCampaigns) {
      planNotice.textContent =
        "Campaigns are available on Growth and Pro AI Suite. Upgrade to send messages.";
      planNotice.style.display = "block";
    } else if (plan === "pro_ai") {
      planNotice.textContent = "Automated campaign triggers available on Pro AI Suite.";
      planNotice.style.display = "block";
    } else {
      planNotice.textContent = "Manual campaign sending enabled.";
      planNotice.style.display = "block";
    }
  }
}

function renderCampaigns(list = []) {
  if (!list.length) {
    campaignsTableBody.innerHTML =
      '<tr><td colspan="5" class="caption">No campaigns yet.</td></tr>';
    return;
  }

  campaignsTableBody.innerHTML = list
    .map((campaign) => {
      const audience = `${campaign.audienceRules?.status || "any"} / ${
        campaign.audienceRules?.source || "any"
      }`;
      const sched = campaign.schedule
        ? new Date(campaign.schedule).toLocaleString()
        : "Send now";
      const follow = campaign.followUpRules || "—";
      return `
        <tr>
          <td>${campaign.name || "Untitled"}</td>
          <td>${campaign.channel}</td>
          <td>${audience}</td>
          <td>${sched}</td>
          <td>${follow}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAudience() {
  if (!customers.length) {
    audienceTableBody.innerHTML =
      '<tr><td colspan="5" class="caption">Load customers to start.</td></tr>';
    return;
  }

  audienceTableBody.innerHTML = customers
    .map((c) => {
      const contact = c.email || c.phone || "—";
      const checked = selected.has(c.id) ? "checked" : "";
      return `
        <tr data-id="${c.id}">
          <td><input type="checkbox" data-id="${c.id}" ${checked} /></td>
          <td>${c.name || "Unnamed"}</td>
          <td>${contact}</td>
          <td>${c.reviewStatus || "none"}</td>
          <td>${c.source || "manual"}</td>
        </tr>
      `;
    })
    .join("");
}

function updatePreview() {
  const recipientCount = selected.size;
  previewCount.textContent = `${recipientCount} recipients selected`;
  const template = templateBody.value || "Hi {{name}}, thanks for choosing {{business}}.";
  const example = template
    .replace(/{{\s*name\s*}}/gi, "Jordan")
    .replace(/{{\s*business\s*}}/gi, "your business");
  messagePreview.textContent = example;
}

function bindAudienceSelection() {
  audienceTableBody.addEventListener("change", (evt) => {
    const id = evt.target.getAttribute("data-id");
    if (!id) return;
    if (evt.target.checked) {
      selected.add(id);
    } else {
      selected.delete(id);
    }
    updatePreview();
  });

  selectAll?.addEventListener("change", (evt) => {
    if (evt.target.checked) {
      customers.forEach((c) => selected.add(c.id));
    } else {
      selected.clear();
    }
    renderAudience();
    updatePreview();
  });
}

async function loadCampaigns() {
  if (!businessId) return;
  const q = query(
    collection(db, "campaigns"),
    where("businessId", "==", businessId),
    orderBy("createdAt", "desc"),
  );
  if (campaignUnsubscribe) campaignUnsubscribe();
  campaignUnsubscribe = onSnapshot(q, (snap) => {
    const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderCampaigns(rows);
  });
}

async function loadCustomers() {
  if (!businessId) return;
  const q = query(
    collection(db, "customers"),
    where("businessId", "==", businessId),
    orderBy("lastInteractionAt", "desc"),
  );
  const snap = await getDocs(q);
  customers = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  selected.clear();
  renderAudience();
  updatePreview();
}

function audienceRulesFromForm() {
  return {
    status: audienceStatus.value,
    source: audienceSource.value,
  };
}

function filteredAudience() {
  const rules = audienceRulesFromForm();
  return customers.filter((c) => {
    const statusOk = rules.status === "any" || c.reviewStatus === rules.status;
    const sourceOk = rules.source === "any" || c.source === rules.source;
    return statusOk && sourceOk;
  });
}

function handlePreviewAudience() {
  const matches = filteredAudience();
  selected.clear();
  matches.forEach((c) => selected.add(c.id));
  renderAudience();
  updatePreview();
}

async function handleSaveCampaign(evt) {
  evt.preventDefault();
  if (!allowManualCampaigns) {
    campaignStatusBadge.textContent = "Upgrade to send";
    return;
  }
  if (!businessId) return;

  const campaignPayload = {
    businessId,
    name: `Campaign – ${new Date().toLocaleDateString()}`,
    audienceRules: audienceRulesFromForm(),
    channel: channelSelect.value,
    templateId: null,
    templateBody: templateBody.value,
    schedule: scheduleInput.value ? new Date(scheduleInput.value).toISOString() : null,
    followUpRules: followUpRules.value,
    status: "draft",
  };

  try {
    campaignStatusBadge.textContent = "Saving...";
    const createCampaign = httpsCallable(functions, "createCampaign");
    await createCampaign(campaignPayload);
    campaignStatusBadge.textContent = "Saved";
  } catch (err) {
    console.error("Failed to save campaign", err);
    campaignStatusBadge.textContent = "Error";
  }
}

async function sendBulk() {
  if (!businessId || selected.size === 0) return;
  if (!allowManualCampaigns) {
    sendResults.textContent = "Upgrade to Growth to send campaigns.";
    return;
  }
  const recipients = customers
    .filter((c) => selected.has(c.id))
    .map((c) => ({
      customerId: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      reviewStatus: c.reviewStatus,
      source: c.source,
    }));

  const payload = {
    businessId,
    channel: channelSelect.value,
    template: templateBody.value,
    recipients,
    rateLimit: Number(rateLimitInput.value || 10),
  };

  sendResults.textContent = "Sending...";
  try {
    const fn = httpsCallable(functions, "sendCampaignBatch");
    const res = await fn(payload);
    sendResults.textContent = `Sent ${res.data?.sent || 0} of ${recipients.length}. Failed: ${
      res.data?.failed || 0
    }`;
  } catch (err) {
    console.error("Bulk send failed", err);
    sendResults.textContent = "Bulk send failed";
  }
}

function init() {
  listenForUser(async (session) => {
    if (!session) return;
    businessId = session.user.uid;
    const plan = currentPlanTier();
    syncPlanState(plan);
    loadCampaigns();
  });

  previewCampaignBtn?.addEventListener("click", handlePreviewAudience);
  form?.addEventListener("submit", handleSaveCampaign);
  loadCustomersBtn?.addEventListener("click", loadCustomers);
  templateBody?.addEventListener("input", updatePreview);
  sendBulkBtn?.addEventListener("click", sendBulk);
  refreshCampaignsBtn?.addEventListener("click", loadCampaigns);
  bindAudienceSelection();
  updatePreview();
}

init();
