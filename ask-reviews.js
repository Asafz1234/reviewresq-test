import {
  db,
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
} from "./firebase-config.js";
import { listenForUser } from "./session-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";

const singleForm = document.getElementById("singleRequestForm");
const singleNameInput = document.getElementById("singleName");
const singlePhoneInput = document.getElementById("singlePhone");
const singleEmailInput = document.getElementById("singleEmail");
const singleEmailHint = document.getElementById("singleEmailHint");
const channelSelect = document.getElementById("channelSelect");
const generateSingleBtn = document.getElementById("generateSingleBtn");
const singleResult = document.getElementById("singleResult");
const singleLinkOutput = document.getElementById("singleLinkOutput");
const copySingleLinkBtn = document.getElementById("copySingleLink");
const downloadSingleQrBtn = document.getElementById("downloadSingleQr");
const emailSuccessBanner = document.getElementById("emailSuccess");
const emailErrorBanner = document.getElementById("emailError");
const planBadge = document.querySelector("[data-plan-label]");

const bulkSection = document.getElementById("bulkSection");
const bulkForm = document.getElementById("bulkRequestForm");
const bulkCustomerList = document.getElementById("bulkCustomerList");
const bulkGenerateBtn = document.getElementById("generateBulkBtn");
const bulkDownloadBtn = document.getElementById("downloadCsvBtn");
const bulkResults = document.getElementById("bulkResults");
const bulkResultsBody = document.getElementById("bulkResultsBody");

const outboundTableBody = document.getElementById("outboundTableBody");
const outboundEmptyRow = document.getElementById("outboundEmptyRow");
const requestRange = document.getElementById("requestRange");
const customStartWrapper = document.getElementById("customStartWrapper");
const customEndWrapper = document.getElementById("customEndWrapper");
const customStartInput = document.getElementById("requestStart");
const customEndInput = document.getElementById("requestEnd");

const toastEl = document.getElementById("askToast");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

let businessId = null;
let plan = "starter";
let customers = [];
let unsubscribe = null;
let outboundUnsub = null;
let bulkLinks = [];
let emailSuccessTimer = null;
let outboundRequests = [];
let currentUser = null;

async function callApi(path, payload = {}) {
  const token = await currentUser?.getIdToken?.();
  if (!token) {
    throw new Error("You need to be signed in to send requests.");
  }

  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      console.warn(`[ask-reviews] failed to parse response from ${path}`, err);
    }
  }

  if (!response.ok || body?.ok === false) {
    const message = body?.error || body?.message || response.statusText || "Request failed";
    const error = new Error(message);
    error.details = body;
    throw error;
  }

  if (body?.ok !== true) {
    const message = body?.error || body?.message || response.statusText || "Request failed";
    const error = new Error(message);
    error.details = body;
    throw error;
  }

  return body;
}

function showToast(message, isError = false) {
  if (!toastEl) return alert(message);
  toastEl.textContent = message;
  toastEl.classList.toggle("toast-error", Boolean(isError));
  toastEl.classList.add("visible");
  clearTimeout(showToast.hideTimer);
  showToast.hideTimer = setTimeout(() => toastEl.classList.remove("visible"), 2200);
}

async function copyText(text) {
  if (!text) throw new Error("Nothing to copy");
  if (navigator?.clipboard?.writeText && window.isSecureContext !== false) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
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
  anchor.download = "reviewresq-portal-qr.png";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function setPlan(planId) {
  plan = normalizePlan(planId || "starter");
  if (planBadge) {
    planBadge.textContent = PLAN_LABELS[plan] || plan.charAt(0).toUpperCase() + plan.slice(1);
  }
  if (bulkSection) {
    bulkSection.hidden = plan === "starter";
  }
}

function renderCustomers(list) {
  if (!bulkCustomerList) return;
  bulkCustomerList.innerHTML = "";
  list.forEach((customer) => {
    const option = document.createElement("option");
    option.value = customer.id;
    option.textContent = customer.name || "Unnamed";
    const contact = customer.email || customer.phone;
    if (contact) {
      option.textContent += ` — ${contact}`;
    }
    bulkCustomerList.appendChild(option);
  });
  bulkGenerateBtn.disabled = !bulkCustomerList.selectedOptions.length;
}

function startCustomerFeed(uid) {
  if (!uid || !bulkCustomerList) return;
  const q = query(collection(db, "customers"), where("businessId", "==", uid));
  unsubscribe = onSnapshot(q, (snapshot) => {
    customers = snapshot.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => {
        const aTime = a?.createdAt?.toMillis?.() || 0;
        const bTime = b?.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
    renderCustomers(customers);
  });
}

function getSelectedCustomers() {
  if (!bulkCustomerList) return [];
  const ids = Array.from(bulkCustomerList.selectedOptions).map((opt) => opt.value);
  return customers.filter((c) => ids.includes(c.id));
}

function updateChannelUi() {
  const channel = channelSelect?.value || "link";
  const emailRequired = channel === "email";

  if (singleEmailInput) singleEmailInput.required = emailRequired;
  if (singleEmailHint)
    singleEmailHint.textContent = emailRequired ? "(required for email)" : "(optional)";
  if (generateSingleBtn)
    generateSingleBtn.textContent = emailRequired ? "Send email request" : "Generate & Copy Link";
  resetStatusBanners();
}

function hideEmailBanners() {
  if (emailSuccessTimer) {
    clearTimeout(emailSuccessTimer);
    emailSuccessTimer = null;
  }

  if (emailSuccessBanner) {
    emailSuccessBanner.hidden = true;
    emailSuccessBanner.style.display = "none";
    emailSuccessBanner.textContent = "";
  }

  if (emailErrorBanner) {
    emailErrorBanner.hidden = true;
    emailErrorBanner.style.display = "none";
    emailErrorBanner.textContent = "";
  }
}

function showEmailSuccess() {
  if (!emailSuccessBanner) return;
  emailSuccessBanner.textContent = "Email sent";
  emailSuccessBanner.hidden = false;
  emailSuccessBanner.style.removeProperty("display");
  emailSuccessTimer = setTimeout(() => {
    if (emailSuccessBanner) emailSuccessBanner.hidden = true;
  }, 5000);
}

function resetStatusBanners() {
  hideEmailBanners();
}

function setErrorBanner(message = "") {
  if (!emailErrorBanner) return;
  emailErrorBanner.textContent = message || "";
  emailErrorBanner.hidden = !message;
  emailErrorBanner.style.display = message ? "" : "none";
  if (message && emailSuccessBanner && !emailSuccessBanner.hidden) {
    emailSuccessBanner.hidden = true;
  }
}

function formatDateLabel(timestampMs) {
  if (!timestampMs) return "—";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatStatus(status) {
  const normalized = (status || "draft").toString();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function renderOutboundTable() {
  if (!outboundTableBody) return;
  const range = requestRange?.value || "thisMonth";
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let startMs = range === "thisMonth" ? startOfMonth : null;
  let endMs = null;

  if (range === "custom") {
    customStartWrapper.hidden = false;
    customEndWrapper.hidden = false;
    startMs = customStartInput?.value ? new Date(customStartInput.value).getTime() : null;
    endMs = customEndInput?.value ? new Date(customEndInput.value).getTime() + 24 * 60 * 60 * 1000 : null;
  } else {
    customStartWrapper.hidden = true;
    customEndWrapper.hidden = true;
  }

  const filtered = outboundRequests.filter((item) => {
    if (!startMs && !endMs) return true;
    const createdMs = item.createdAtMs || item.updatedAtMs || 0;
    if (startMs && createdMs < startMs) return false;
    if (endMs && createdMs > endMs) return false;
    return true;
  });

  outboundTableBody.innerHTML = "";
  if (!filtered.length) {
    outboundEmptyRow?.removeAttribute("hidden");
    outboundTableBody.appendChild(outboundEmptyRow);
    return;
  }

  outboundEmptyRow?.setAttribute("hidden", "true");
  filtered.forEach((entry) => {
    const row = document.createElement("tr");
    const customerCell = document.createElement("td");
    const channelCell = document.createElement("td");
    const sentCell = document.createElement("td");
    const openedCell = document.createElement("td");
    const clickedCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const dateCell = document.createElement("td");

    customerCell.textContent = entry.customerName || entry.customerEmail || "Unknown";
    channelCell.textContent = entry.channel || "link";
    const sentTimestamp = entry.deliveredAtMs || entry.sentAtMs || entry.processedAtMs;
    sentCell.textContent = sentTimestamp ? formatDateLabel(sentTimestamp) : "—";
    openedCell.textContent = entry.openedAtMs ? formatDateLabel(entry.openedAtMs) : "—";
    clickedCell.textContent = entry.clickedAtMs ? formatDateLabel(entry.clickedAtMs) : "—";
    statusCell.textContent = formatStatus(entry.status);
    dateCell.textContent = formatDateLabel(entry.createdAtMs || entry.updatedAtMs);

    row.appendChild(customerCell);
    row.appendChild(channelCell);
    row.appendChild(sentCell);
    row.appendChild(openedCell);
    row.appendChild(clickedCell);
    row.appendChild(statusCell);
    row.appendChild(dateCell);
    outboundTableBody.appendChild(row);
  });
}

function startOutboundFeed(uid) {
  if (!uid || !outboundTableBody) return;
  const outboundRef = collection(db, "businesses", uid, "outboundRequests");
  const q = query(outboundRef, orderBy("createdAtMs", "desc"));
  if (typeof outboundUnsub === "function") outboundUnsub();
  outboundUnsub = onSnapshot(q, (snapshot) => {
    outboundRequests = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderOutboundTable();
  });
}

function handleRangeChange() {
  renderOutboundTable();
}

async function handleSingleSubmit(event) {
  event.preventDefault();
  if (!businessId) return;

  const name = singleNameInput?.value.trim();
  const phone = singlePhoneInput?.value.trim();
  const email = singleEmailInput?.value.trim();
  const channel = channelSelect?.value || "link";
  const isEmailChannel = channel === "email";

  resetStatusBanners();

  if (!name) {
    showToast("Customer name is required", true);
    setErrorBanner("Customer name is required");
    return;
  }

  if (isEmailChannel && !email) {
    showToast("Email is required for email requests", true);
    setErrorBanner("Email is required for email requests");
    return;
  }

  if (isEmailChannel && email && !emailRegex.test(email)) {
    showToast("Enter a valid email address", true);
    setErrorBanner("Enter a valid email address");
    return;
  }

  const defaultLabel = generateSingleBtn.textContent;
  generateSingleBtn.disabled = true;
  generateSingleBtn.setAttribute("aria-busy", "true");
  generateSingleBtn.textContent = isEmailChannel ? "Sending…" : "Generating…";

  try {
    if (isEmailChannel) {
      const sendResult = await callApi("/api/sendReviewRequestEmail", {
        businessId,
        customerName: name,
        email,
        phone,
        source: "ask-for-reviews",
      });

      const sendSuccess = Boolean(sendResult?.ok);
      if (!sendSuccess) {
        throw new Error(sendResult?.error || "Email send failed");
      }

      if (singleLinkOutput) singleLinkOutput.value = "";
      if (singleResult) singleResult.hidden = true;
      showEmailSuccess();
      showToast("Email sent");
    } else {
      const inviteResponse = await callApi("/api/createInviteToken", {
        businessId,
        customerName: name,
        phone,
        email,
        channel,
        source: "ask-reviews",
      });
      const portalUrl = inviteResponse?.portalUrl;
      if (!inviteResponse?.ok || !portalUrl) throw new Error("No portal URL returned");
      if (singleLinkOutput) singleLinkOutput.value = portalUrl;
      if (singleResult) singleResult.hidden = false;
      await copyText(portalUrl);
      showToast("Link generated and copied");
    }
  } catch (err) {
    console.error("[ask-reviews] single generate failed", err);
    const configMissing = err?.message?.includes("email_sending_not_configured");
    setErrorBanner(
      configMissing
        ? "Email sending isn’t configured. Please contact support."
        : err?.message || (isEmailChannel ? "Unable to send email" : "Unable to generate link"),
    );
    if (configMissing) {
      showToast("Email sending isn’t configured. Please contact support.", true);
    } else {
      showToast(isEmailChannel ? "Unable to send email" : "Unable to generate link", true);
    }
  } finally {
    generateSingleBtn.disabled = false;
    generateSingleBtn.setAttribute("aria-busy", "false");
    generateSingleBtn.textContent = defaultLabel;
  }
}

async function handleCopySingle() {
  const link = singleLinkOutput?.value || "";
  if (!link) return;
  try {
    await copyText(link);
    showToast("Link copied");
  } catch (err) {
    showToast("Copy failed", true);
  }
}

async function handleSingleQr() {
  const link = singleLinkOutput?.value || "";
  if (!link) return;
  const defaultLabel = downloadSingleQrBtn.textContent;
  downloadSingleQrBtn.disabled = true;
  downloadSingleQrBtn.textContent = "Preparing…";
  try {
    await downloadQrCode(link);
    showToast("QR code downloaded");
  } catch (err) {
    console.error("[ask-reviews] QR download failed", err);
    showToast("QR download failed", true);
  } finally {
    downloadSingleQrBtn.disabled = false;
    downloadSingleQrBtn.textContent = defaultLabel;
  }
}

async function handleBulkSubmit(event) {
  event.preventDefault();
  if (!businessId || !bulkSection || plan === "starter") return;

  const selected = getSelectedCustomers();
  if (!selected.length) {
    showToast("Select at least one customer", true);
    return;
  }

  const defaultLabel = bulkGenerateBtn.textContent;
  bulkGenerateBtn.disabled = true;
  bulkGenerateBtn.textContent = "Generating…";
  bulkDownloadBtn.disabled = true;
  bulkLinks = [];

  try {
    for (const customer of selected) {
      try {
        const result = await callApi("/api/createInviteToken", {
          businessId,
          customerId: customer.id,
          customerName: customer.name,
          phone: customer.phone,
          email: customer.email,
          channel: "link",
          source: "ask-reviews",
        });
        const portalUrl = result?.portalUrl;
        if (portalUrl) {
          bulkLinks.push({
            name: customer.name || "Unnamed",
            contact: customer.email || customer.phone || "",
            link: portalUrl,
          });
        }
      } catch (err) {
        console.error("[ask-reviews] bulk link failed", err);
      }
    }

    renderBulkResults();
    if (bulkLinks.length) {
      showToast(`Generated ${bulkLinks.length} link${bulkLinks.length > 1 ? "s" : ""}`);
    } else {
      showToast("No links generated", true);
    }
  } finally {
    bulkGenerateBtn.disabled = false;
    bulkGenerateBtn.textContent = defaultLabel;
  }
}

function renderBulkResults() {
  if (!bulkResultsBody || !bulkResults) return;
  bulkResultsBody.innerHTML = "";
  bulkLinks.forEach((entry) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    const contactTd = document.createElement("td");
    const linkTd = document.createElement("td");
    nameTd.textContent = entry.name;
    contactTd.textContent = entry.contact || "—";
    const linkAnchor = document.createElement("a");
    linkAnchor.href = entry.link;
    linkAnchor.textContent = "Portal link";
    linkAnchor.target = "_blank";
    linkAnchor.rel = "noopener noreferrer";
    linkTd.appendChild(linkAnchor);
    tr.appendChild(nameTd);
    tr.appendChild(contactTd);
    tr.appendChild(linkTd);
    bulkResultsBody.appendChild(tr);
  });
  bulkResults.hidden = !bulkLinks.length;
  bulkDownloadBtn.disabled = !bulkLinks.length;
}

function downloadCsv() {
  if (!bulkLinks.length) return;
  const header = ["Name", "Contact", "Link"];
  const rows = bulkLinks.map((entry) => [entry.name, entry.contact, entry.link]);
  const csvContent = [header, ...rows]
    .map((cols) =>
      cols
        .map((value) => {
          const safe = (value || "").toString();
          if (safe.includes(",") || safe.includes("\"")) {
            return `"${safe.replace(/\"/g, '""')}"`;
          }
          return safe;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "review-requests.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("CSV downloaded");
}

function attachEvents() {
  bulkCustomerList?.addEventListener("change", () => {
    bulkGenerateBtn.disabled = !bulkCustomerList.selectedOptions.length;
  });
  [singleNameInput, singlePhoneInput, singleEmailInput, channelSelect].forEach((input) => {
    input?.addEventListener("input", resetStatusBanners);
    input?.addEventListener("change", resetStatusBanners);
  });
  channelSelect?.addEventListener("change", updateChannelUi);
  singleForm?.addEventListener("submit", handleSingleSubmit);
  copySingleLinkBtn?.addEventListener("click", handleCopySingle);
  downloadSingleQrBtn?.addEventListener("click", handleSingleQr);
  bulkForm?.addEventListener("submit", handleBulkSubmit);
  bulkDownloadBtn?.addEventListener("click", downloadCsv);
  requestRange?.addEventListener("change", handleRangeChange);
  customStartInput?.addEventListener("change", renderOutboundTable);
  customEndInput?.addEventListener("change", renderOutboundTable);
  resetStatusBanners();
  updateChannelUi();
}

function initApp() {
  listenForUser(({ user, subscription }) => {
    if (!user) return;
    currentUser = user;
    businessId = user.uid;
    setPlan(subscription?.planId || subscription?.planTier);
    attachEvents();
    startCustomerFeed(user.uid);
    startOutboundFeed(user.uid);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  hideEmailBanners();
  updateChannelUi();
  initApp();
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribe === "function") unsubscribe();
  if (typeof outboundUnsub === "function") outboundUnsub();
});
