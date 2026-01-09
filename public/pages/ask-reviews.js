import {
  db,
  collection,
  query,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
} from "../firebase-config.js";
import { functions, httpsCallable } from "../firebase-config.js";
import { deriveBranding, listenForUser } from "../session-data.js";
import { PLAN_LABELS, normalizePlan } from "../plan-capabilities.js";
import {
  parseCustomerFile,
  buildPreviewRows,
  renderPreviewTable,
  countPreviewRows,
} from "../js/bulkUpload.js";
import { subscribeCustomers, bulkCreateCustomersAndSend } from "../js/customersApi.js";

const planBadge = document.querySelector("[data-plan-label]");
const brandingBlocker = document.getElementById("brandingBlocker");
const brandingBlockerMessage = document.getElementById("brandingBlockerMessage");
const completeSettingsBtn = document.getElementById("completeSettingsBtn");
const setupStatus = document.getElementById("setupStatus");

const bulkSection = document.getElementById("bulkSection");
const bulkExistingSearch = document.getElementById("bulkExistingSearch");
const bulkExistingTableBody = document.getElementById("bulkExistingTableBody");
const bulkExistingSelectedCount = document.getElementById("bulkExistingSelectedCount");
const bulkExistingSendBtn = document.getElementById("bulkExistingSendBtn");
const bulkExistingChannelPanel = document.getElementById("bulkExistingChannelPanel");
const bulkExistingChannelSelect = document.getElementById("bulkExistingChannelSelect");
const bulkExistingConfirmBtn = document.getElementById("bulkExistingConfirmBtn");
const bulkExistingCancelBtn = document.getElementById("bulkExistingCancelBtn");
const bulkExistingSuccess = document.getElementById("bulkExistingSuccess");
const bulkExistingError = document.getElementById("bulkExistingError");

const bulkAddChannelSelect = document.getElementById("bulkAddChannelSelect");
const bulkAddInput = document.getElementById("bulkAddInput");
const bulkAddPreviewBody = document.getElementById("bulkAddPreviewBody");
const bulkAddSendBtn = document.getElementById("bulkAddSendBtn");
const bulkAddSuccess = document.getElementById("bulkAddSuccess");
const bulkAddError = document.getElementById("bulkAddError");

const bulkLinkOutput = document.getElementById("bulkLinkOutput");
const bulkCopyLinksBtn = document.getElementById("bulkCopyLinksBtn");
const bulkDownloadLinksBtn = document.getElementById("bulkDownloadLinksBtn");
const bulkLinkResultsBody = document.getElementById("bulkLinkResultsBody");

const bulkUploadInput = document.getElementById("bulkUploadInput");
const bulkUploadBtn = document.getElementById("bulkUploadBtn");
const bulkUploadFileName = document.getElementById("bulkUploadFileName");
const bulkUploadError = document.getElementById("bulkUploadError");
const bulkUploadSuccess = document.getElementById("bulkUploadSuccess");
const bulkUploadPreview = document.getElementById("bulkUploadPreview");
const bulkUploadPreviewBody = document.getElementById("bulkUploadPreviewBody");
const bulkUploadTotalCount = document.getElementById("bulkUploadTotalCount");
const bulkUploadValidCount = document.getElementById("bulkUploadValidCount");
const bulkUploadInvalidCount = document.getElementById("bulkUploadInvalidCount");
const bulkUploadExcludeInvalid = document.getElementById("bulkUploadExcludeInvalid");
const bulkUploadSendBtn = document.getElementById("bulkUploadSendBtn");
const bulkUploadResults = document.getElementById("bulkUploadResults");
const bulkUploadResultsSummary = document.getElementById("bulkUploadResultsSummary");
const bulkUploadResultsBody = document.getElementById("bulkUploadResultsBody");

const outboundTableBody = document.getElementById("outboundTableBody");
const outboundEmptyRow = document.getElementById("outboundEmptyRow");
const requestRange = document.getElementById("requestRange");
const customStartWrapper = document.getElementById("customStartWrapper");
const customEndWrapper = document.getElementById("customEndWrapper");
const customStartInput = document.getElementById("requestStart");
const customEndInput = document.getElementById("requestEnd");

const toastEl = document.getElementById("askToast");

const BRANDING_REQUIRED_MESSAGE =
  "Before sending review requests, please complete your business details (takes under 1 minute).";

const BRANDING_REDIRECT_NOTICE_KEY = "brandingRedirectNotice";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

let businessId = null;
let plan = "starter";
let customers = [];
let unsubscribe = null;
let outboundUnsub = null;
let bulkLinks = [];
let outboundRequests = [];
let currentUser = null;
let brandingState = { complete: true };
let eventsBound = false;
let bulkSelectedIds = new Set();
let bulkPreviewRows = [];

const createInviteTokenCallable = httpsCallable(functions, "createInviteTokenCallable");
const sendReviewRequestEmailCallable = httpsCallable(functions, "sendReviewRequestEmailCallable");
const createCustomerManualCallable = httpsCallable(functions, "createCustomerManual");
let bulkUploadRows = [];

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

function setPlan(planId) {
  plan = normalizePlan(planId || "starter");
  if (planBadge) {
    planBadge.textContent = PLAN_LABELS[plan] || plan.charAt(0).toUpperCase() + plan.slice(1);
  }
  if (bulkSection) {
    bulkSection.hidden = plan === "starter";
  }
}

function getCustomerContact(customer) {
  return customer.email || customer.phone || "—";
}

function updateBulkSelectedCount() {
  const count = bulkSelectedIds.size;
  if (bulkExistingSelectedCount) {
    bulkExistingSelectedCount.textContent = String(count);
  }
  if (bulkExistingSendBtn) {
    bulkExistingSendBtn.disabled = count === 0;
    bulkExistingSendBtn.textContent = `Send review requests (${count} selected)`;
  }
}

function renderExistingCustomers() {
  if (!bulkExistingTableBody) return;
  const term = (bulkExistingSearch?.value || "").toLowerCase().trim();
  const filtered = customers.filter((customer) => {
    if (!term) return true;
    const haystack = [
      customer.name,
      customer.email,
      customer.phone,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });

  bulkExistingTableBody.innerHTML = "";
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.style.textAlign = "center";
    cell.style.color = "#6b7280";
    cell.style.padding = "16px";
    cell.textContent = "No matching customers";
    row.appendChild(cell);
    bulkExistingTableBody.appendChild(row);
    return;
  }

  filtered.forEach((customer) => {
    const row = document.createElement("tr");
    const selectCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const contactCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = customer.id;
    checkbox.checked = bulkSelectedIds.has(customer.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        bulkSelectedIds.add(customer.id);
      } else {
        bulkSelectedIds.delete(customer.id);
      }
      updateBulkSelectedCount();
    });
    selectCell.appendChild(checkbox);
    nameCell.textContent = customer.name || "Unnamed";
    contactCell.textContent = getCustomerContact(customer);
    row.appendChild(selectCell);
    row.appendChild(nameCell);
    row.appendChild(contactCell);
    bulkExistingTableBody.appendChild(row);
  });
}

function startCustomerFeed(uid) {
  if (!uid || !bulkExistingTableBody) return;
  unsubscribe = subscribeCustomers({
    businessId: uid,
    onChange: (snapshot) => {
      customers = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => {
          const aTime = a?.createdAt?.toMillis?.() || 0;
          const bTime = b?.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
      renderExistingCustomers();
      updateBulkSelectedCount();
    },
  });
}

function getSelectedCustomers() {
  return customers.filter((c) => bulkSelectedIds.has(c.id));
}


function updateSetupStatus(isComplete) {
  if (!setupStatus) return;
  setupStatus.textContent = isComplete ? "Setup: complete" : "Setup: incomplete";
  setupStatus.classList.toggle("setup-complete", isComplete);
  setupStatus.classList.toggle("setup-incomplete", !isComplete);
}

function toggleRequestForms(enabled) {
  const disabled = !enabled;
  [
    bulkExistingSearch,
    bulkExistingSendBtn,
    bulkExistingConfirmBtn,
    bulkExistingCancelBtn,
    bulkExistingChannelSelect,
    bulkAddChannelSelect,
    bulkAddInput,
    bulkAddSendBtn,
    bulkUploadInput,
    bulkUploadBtn,
    bulkUploadExcludeInvalid,
    bulkUploadSendBtn,
    bulkCopyLinksBtn,
    bulkDownloadLinksBtn,
    requestRange,
    customStartInput,
    customEndInput,
  ].forEach((el) => {
    if (el) el.disabled = disabled;
  });
}

function applyBrandingGate(branding) {
  brandingState = branding || { complete: false };
  const isComplete = Boolean(brandingState.complete);
  updateSetupStatus(isComplete);

  if (brandingBlocker) {
    brandingBlocker.hidden = isComplete;
  }
  if (brandingBlockerMessage) {
    brandingBlockerMessage.textContent = BRANDING_REQUIRED_MESSAGE;
  }

  toggleRequestForms(isComplete);
  if (!isComplete) {
    if (bulkLinkOutput) bulkLinkOutput.hidden = true;
  }
}

function requireBrandingOrNotify() {
  if (brandingState.complete) return true;
  showToast(BRANDING_REQUIRED_MESSAGE, true);
  redirectToBrandingSetup();
  return false;
}

function redirectToBrandingSetup() {
  try {
    sessionStorage.setItem(BRANDING_REDIRECT_NOTICE_KEY, BRANDING_REQUIRED_MESSAGE);
  } catch (err) {
    console.warn("[ask-reviews] unable to persist redirect notice", err);
  }
  const redirectUrl = new URL("/business-settings.html", window.location.origin);
  redirectUrl.searchParams.set("return", "ask-reviews");
  window.location.href = redirectUrl.toString();
}

function formatDateLabel(timestampMs) {
  if (!timestampMs) return "—";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "—";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateLabel = `${lookup.month} ${lookup.day}, ${lookup.year}`;
  const timeLabel = `${lookup.hour}:${lookup.minute} ${lookup.dayPeriod || ""}`.trim();
  return `${dateLabel} · ${timeLabel}`;
}

function formatStatus(status) {
  const normalized = (status || "draft").toString();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function markOutboundSent(requestId) {
  if (!businessId || !requestId) return;
  try {
    const outboundRef = doc(db, "businesses", businessId, "outboundRequests", String(requestId));
    await updateDoc(outboundRef, {
      status: "sent",
      sentAtMs: Date.now(),
      sentAt: serverTimestamp(),
      locale: "en-US",
      tz: "America/New_York",
    });
  } catch (err) {
    console.warn("[ask-reviews] unable to mark outbound sent", err);
  }
}

async function ensureCustomerRecord({ name, phone, email }) {
  if (!businessId) return null;
  const response = await createCustomerManualCallable({
    businessId,
    name: name || "",
    phone: phone || "",
    email: email || "",
    reviewStatus: "requested",
  });
  return response?.data?.customerId || null;
}

function setInlineMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
  if (message) {
    element.classList.toggle("pill-error", isError);
    element.classList.toggle("pill-success", !isError);
  }
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

    customerCell.textContent = entry.customerName || entry.customerEmail || "Link visitor";
    channelCell.textContent = entry.channel || "link";
    const sentTimestamp = entry.sentAtMs || entry.deliveredAtMs || entry.processedAtMs;
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

function resetBulkFeedback() {
  setInlineMessage(bulkExistingSuccess, "");
  setInlineMessage(bulkExistingError, "");
  setInlineMessage(bulkAddSuccess, "");
  setInlineMessage(bulkAddError, "");
  setInlineMessage(bulkUploadError, "");
  setInlineMessage(bulkUploadSuccess, "");
}

function updateBulkUploadCounts() {
  const counts = countPreviewRows(bulkUploadRows);
  if (bulkUploadTotalCount) bulkUploadTotalCount.textContent = String(counts.total);
  if (bulkUploadValidCount) bulkUploadValidCount.textContent = String(counts.valid);
  if (bulkUploadInvalidCount) bulkUploadInvalidCount.textContent = String(counts.invalid);
}

function getBulkUploadSendCount() {
  if (!bulkUploadRows.length) return 0;
  if (bulkUploadExcludeInvalid?.checked) {
    return bulkUploadRows.filter((row) => row.isValid).length;
  }
  return bulkUploadRows.length;
}

function updateBulkUploadCta() {
  const count = getBulkUploadSendCount();
  if (bulkUploadSendBtn) {
    bulkUploadSendBtn.disabled = count === 0;
    bulkUploadSendBtn.textContent = `Create customers & send requests (${count})`;
  }
}

function renderBulkUploadPreview() {
  if (bulkUploadPreview) {
    bulkUploadPreview.hidden = bulkUploadRows.length === 0;
  }
  renderPreviewTable(bulkUploadRows, bulkUploadPreviewBody);
  updateBulkUploadCounts();
  updateBulkUploadCta();
}

async function handleBulkUploadSelection(file) {
  if (!file) return;
  resetBulkFeedback();
  if (bulkUploadResults) bulkUploadResults.hidden = true;
  if (bulkUploadResultsBody) bulkUploadResultsBody.innerHTML = "";
  if (bulkUploadResultsSummary) bulkUploadResultsSummary.textContent = "";
  if (bulkUploadFileName) {
    bulkUploadFileName.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  }

  try {
    const rows = await parseCustomerFile(file);
    bulkUploadRows = buildPreviewRows(rows);
    if (!bulkUploadRows.length) {
      setInlineMessage(bulkUploadError, "No rows detected. Please check your file.", true);
    }
    renderBulkUploadPreview();
    if (bulkUploadRows.length) {
      setInlineMessage(bulkUploadSuccess, `Loaded ${bulkUploadRows.length} row(s).`);
    }
  } catch (err) {
    console.error("[ask-reviews] bulk upload parse failed", err);
    bulkUploadRows = [];
    renderBulkUploadPreview();
    setInlineMessage(
      bulkUploadError,
      err?.message || "We couldn’t parse that file. Please try again.",
      true,
    );
  }
}

function renderBulkUploadResults(results = []) {
  if (!bulkUploadResultsBody) return;
  bulkUploadResultsBody.innerHTML = "";
  results.forEach((result) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const contactCell = document.createElement("td");
    const resultCell = document.createElement("td");
    const messageCell = document.createElement("td");

    nameCell.textContent = result.name || "—";
    contactCell.textContent = result.contact || "—";
    resultCell.textContent = result.ok ? "Sent" : "Failed";
    resultCell.style.color = result.ok ? "#047857" : "#b91c1c";
    messageCell.textContent = result.message || "";

    row.appendChild(nameCell);
    row.appendChild(contactCell);
    row.appendChild(resultCell);
    row.appendChild(messageCell);
    bulkUploadResultsBody.appendChild(row);
  });
}

async function handleBulkUploadSend() {
  if (!businessId || !bulkSection || plan === "starter") return;
  if (!requireBrandingOrNotify()) return;

  const excludeInvalid = bulkUploadExcludeInvalid?.checked ?? true;
  const rowsToSend = excludeInvalid
    ? bulkUploadRows.filter((row) => row.isValid)
    : bulkUploadRows;

  if (!rowsToSend.length) {
    showToast("Add at least one valid customer row", true);
    return;
  }

  resetBulkFeedback();
  bulkUploadSendBtn.disabled = true;
  bulkUploadSendBtn.setAttribute("aria-busy", "true");

  if (bulkUploadResults) bulkUploadResults.hidden = false;
  if (bulkUploadResultsSummary) {
    bulkUploadResultsSummary.textContent = "Processing…";
  }

  try {
    const payloadRows = rowsToSend.map((row) => ({
      name: row.name,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
    }));

    const response = await bulkCreateCustomersAndSend({
      businessId,
      rows: payloadRows,
      channel: "email",
      excludeInvalid,
      source: "bulk_upload",
    });

    const results = response.results || [];
    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;

    renderBulkUploadResults(results);
    if (bulkUploadResultsSummary) {
      bulkUploadResultsSummary.textContent = `Sent ${successCount} · Failed ${failureCount}`;
    }
    if (successCount) {
      setInlineMessage(bulkUploadSuccess, `Sent ${successCount} request(s).`);
    }
    if (failureCount) {
      setInlineMessage(bulkUploadError, `${failureCount} request(s) failed.`, true);
    }
  } catch (err) {
    console.error("[ask-reviews] bulk upload send failed", err);
    setInlineMessage(
      bulkUploadError,
      err?.message || "We couldn’t send those requests. Please try again.",
      true,
    );
    if (bulkUploadResultsSummary) {
      bulkUploadResultsSummary.textContent = "Processing failed.";
    }
  } finally {
    bulkUploadSendBtn.disabled = false;
    bulkUploadSendBtn.removeAttribute("aria-busy");
  }
}

function renderBulkLinkResults() {
  if (!bulkLinkResultsBody || !bulkLinkOutput) return;
  bulkLinkResultsBody.innerHTML = "";
  bulkLinks.forEach((entry) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const contactCell = document.createElement("td");
    const linkCell = document.createElement("td");
    nameCell.textContent = entry.name;
    contactCell.textContent = entry.contact || "—";
    const anchor = document.createElement("a");
    anchor.href = entry.link;
    anchor.textContent = "Portal link";
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    linkCell.appendChild(anchor);
    row.appendChild(nameCell);
    row.appendChild(contactCell);
    row.appendChild(linkCell);
    bulkLinkResultsBody.appendChild(row);
  });
  bulkLinkOutput.hidden = !bulkLinks.length;
  bulkCopyLinksBtn.disabled = !bulkLinks.length;
  bulkDownloadLinksBtn.disabled = !bulkLinks.length;
}

function buildBulkCsvContent() {
  const header = ["Name", "Contact", "Link", "Created At"];
  const rows = bulkLinks.map((entry) => [
    entry.name,
    entry.contact,
    entry.link,
    formatDateLabel(entry.createdAtMs),
  ]);
  return [header, ...rows]
    .map((cols) =>
      cols
        .map((value) => {
          const safe = (value || "").toString();
          if (safe.includes(",") || safe.includes("\"")) {
            return `"${safe.replace(/\"/g, '""')}"`;
          }
          return safe;
        })
        .join(","),
    )
    .join("\n");
}

async function handleBulkCopyLinks() {
  if (!bulkLinks.length) return;
  try {
    await copyText(bulkLinks.map((entry) => entry.link).join("\n"));
    await Promise.allSettled(bulkLinks.map((entry) => markOutboundSent(entry.requestId)));
    showToast("Links copied");
  } catch (err) {
    showToast("Copy failed", true);
  }
}

async function handleBulkDownloadLinks() {
  if (!bulkLinks.length) return;
  const csvContent = buildBulkCsvContent();
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "review-requests.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  await Promise.allSettled(bulkLinks.map((entry) => markOutboundSent(entry.requestId)));
  showToast("CSV downloaded");
}

function openBulkExistingChannelPanel() {
  if (!bulkExistingChannelPanel) return;
  bulkExistingChannelPanel.hidden = false;
}

function closeBulkExistingChannelPanel() {
  if (!bulkExistingChannelPanel) return;
  bulkExistingChannelPanel.hidden = true;
}

async function handleBulkExistingConfirm() {
  if (!businessId || !bulkSection || plan === "starter") return;
  if (!requireBrandingOrNotify()) return;

  const selected = getSelectedCustomers();
  if (!selected.length) {
    showToast("Select at least one customer", true);
    return;
  }

  resetBulkFeedback();
  closeBulkExistingChannelPanel();
  bulkExistingSendBtn.disabled = true;
  bulkExistingConfirmBtn.disabled = true;
  const channel = bulkExistingChannelSelect?.value || "email";
  bulkLinks = [];

  let successCount = 0;
  let failureCount = 0;

  for (const customer of selected) {
    try {
      const name = customer.name || "Customer";
      const email = customer.email || "";
      const phone = customer.phone || "";

      if (channel === "email" && (!email || !emailRegex.test(email))) {
        failureCount += 1;
        continue;
      }

      const inviteResponse = await createInviteTokenCallable({
        businessId,
        customerId: customer.id,
        customerName: name,
        phone,
        email,
        channel,
        source: "ask-reviews-bulk-existing",
      });
      const inviteData = inviteResponse?.data || {};
      const portalLink = inviteData.portalLink || inviteData.portalUrl;
      const requestId = inviteData.requestId || inviteData.inviteToken;

      if (!inviteData?.ok || !portalLink) {
        throw new Error(inviteData?.error || "Unable to create invite link");
      }

      if (channel === "email") {
        const sendResponse = await sendReviewRequestEmailCallable({
          businessId,
          customerId: customer.id,
          customerName: name,
          customerEmail: email,
          email,
          customerPhone: phone,
          portalLink,
          requestId,
          source: "ask-reviews-bulk-existing",
        });
        if (!sendResponse?.data?.ok) {
          throw new Error(sendResponse?.data?.error || "Email send failed");
        }
        successCount += 1;
      } else {
        bulkLinks.push({
          name,
          contact: email || phone || "",
          link: portalLink,
          requestId,
          customerId: customer.id,
          createdAtMs: Date.now(),
        });
        successCount += 1;
      }
    } catch (err) {
      console.error("[ask-reviews] bulk existing send failed", err);
      failureCount += 1;
    }
  }

  renderBulkLinkResults();

  if (successCount) {
    setInlineMessage(
      bulkExistingSuccess,
      channel === "email"
        ? `Sent ${successCount} email request${successCount === 1 ? "" : "s"}.`
        : `Generated ${successCount} link${successCount === 1 ? "" : "s"}.`,
    );
  }
  if (failureCount) {
    setInlineMessage(
      bulkExistingError,
      `${failureCount} request${failureCount === 1 ? "" : "s"} failed or missing contact info.`,
      true,
    );
  }

  bulkExistingSendBtn.disabled = false;
  bulkExistingConfirmBtn.disabled = false;
  updateBulkSelectedCount();
}

function parseBulkRows(text, channel) {
  const lines = (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [name = "", email = "", phone = ""] = line.split(",").map((part) => part.trim());
    const errors = [];
    if (!name) {
      errors.push("Missing name");
    }
    if (channel === "email") {
      if (!email) {
        errors.push("Email required");
      } else if (!emailRegex.test(email)) {
        errors.push("Invalid email");
      }
    }
    return {
      name,
      email,
      phone,
      errors,
      isValid: errors.length === 0,
    };
  });
}

function renderBulkAddPreview() {
  if (!bulkAddPreviewBody) return;
  bulkAddPreviewBody.innerHTML = "";
  bulkPreviewRows.forEach((row) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    const emailTd = document.createElement("td");
    const phoneTd = document.createElement("td");
    const statusTd = document.createElement("td");
    nameTd.textContent = row.name || "—";
    emailTd.textContent = row.email || "—";
    phoneTd.textContent = row.phone || "—";
    if (row.isValid) {
      statusTd.textContent = "Ready";
      statusTd.style.color = "#047857";
    } else {
      statusTd.textContent = row.errors.join("; ");
      statusTd.style.color = "#b91c1c";
    }
    tr.appendChild(nameTd);
    tr.appendChild(emailTd);
    tr.appendChild(phoneTd);
    tr.appendChild(statusTd);
    bulkAddPreviewBody.appendChild(tr);
  });

  const validCount = bulkPreviewRows.filter((row) => row.isValid).length;
  bulkAddSendBtn.disabled = validCount === 0;
}

function updateBulkAddPreview() {
  const channel = bulkAddChannelSelect?.value || "email";
  bulkPreviewRows = parseBulkRows(bulkAddInput?.value || "", channel);
  renderBulkAddPreview();
}

async function handleBulkAddSend() {
  if (!businessId || !bulkSection || plan === "starter") return;
  if (!requireBrandingOrNotify()) return;

  const channel = bulkAddChannelSelect?.value || "email";
  const validRows = bulkPreviewRows.filter((row) => row.isValid);
  if (!validRows.length) {
    showToast("Add at least one valid customer row", true);
    return;
  }

  resetBulkFeedback();
  bulkAddSendBtn.disabled = true;
  bulkLinks = [];
  let successCount = 0;
  let failureCount = 0;

  for (const row of validRows) {
    try {
      const customerId = await ensureCustomerRecord({
        name: row.name,
        phone: row.phone,
        email: row.email,
      });
      const inviteResponse = await createInviteTokenCallable({
        businessId,
        customerId,
        customerName: row.name,
        phone: row.phone,
        email: row.email,
        channel,
        source: "ask-reviews-bulk-add",
      });
      const inviteData = inviteResponse?.data || {};
      const portalLink = inviteData.portalLink || inviteData.portalUrl;
      const requestId = inviteData.requestId || inviteData.inviteToken;

      if (!inviteData?.ok || !portalLink) {
        throw new Error(inviteData?.error || "Unable to create invite link");
      }

      if (channel === "email") {
        const sendResponse = await sendReviewRequestEmailCallable({
          businessId,
          customerId,
          customerName: row.name,
          customerEmail: row.email,
          email: row.email,
          customerPhone: row.phone,
          portalLink,
          requestId,
          source: "ask-reviews-bulk-add",
        });
        if (!sendResponse?.data?.ok) {
          throw new Error(sendResponse?.data?.error || "Email send failed");
        }
        successCount += 1;
      } else {
        bulkLinks.push({
          name: row.name,
          contact: row.email || row.phone || "",
          link: portalLink,
          requestId,
          customerId,
          createdAtMs: Date.now(),
        });
        successCount += 1;
      }
    } catch (err) {
      console.error("[ask-reviews] bulk add send failed", err);
      failureCount += 1;
    }
  }

  renderBulkLinkResults();

  if (successCount) {
    setInlineMessage(
      bulkAddSuccess,
      channel === "email"
        ? `Sent ${successCount} email request${successCount === 1 ? "" : "s"}.`
        : `Generated ${successCount} link${successCount === 1 ? "" : "s"}.`,
    );
  }
  if (failureCount) {
    setInlineMessage(
      bulkAddError,
      `${failureCount} request${failureCount === 1 ? "" : "s"} failed.`,
      true,
    );
  }

  bulkAddSendBtn.disabled = false;
}

function attachEvents() {
  if (eventsBound) return;
  eventsBound = true;
  bulkExistingSearch?.addEventListener("input", renderExistingCustomers);
  bulkExistingSendBtn?.addEventListener("click", openBulkExistingChannelPanel);
  bulkExistingConfirmBtn?.addEventListener("click", handleBulkExistingConfirm);
  bulkExistingCancelBtn?.addEventListener("click", closeBulkExistingChannelPanel);
  bulkAddInput?.addEventListener("input", updateBulkAddPreview);
  bulkAddChannelSelect?.addEventListener("change", updateBulkAddPreview);
  bulkAddSendBtn?.addEventListener("click", handleBulkAddSend);
  bulkUploadBtn?.addEventListener("click", () => bulkUploadInput?.click());
  bulkUploadInput?.addEventListener("change", (event) => {
    const file = event.target?.files?.[0];
    handleBulkUploadSelection(file);
  });
  bulkUploadExcludeInvalid?.addEventListener("change", updateBulkUploadCta);
  bulkUploadSendBtn?.addEventListener("click", handleBulkUploadSend);
  bulkCopyLinksBtn?.addEventListener("click", handleBulkCopyLinks);
  bulkDownloadLinksBtn?.addEventListener("click", handleBulkDownloadLinks);
  requestRange?.addEventListener("change", handleRangeChange);
  customStartInput?.addEventListener("change", renderOutboundTable);
  customEndInput?.addEventListener("change", renderOutboundTable);
  completeSettingsBtn?.addEventListener("click", () => {
    try {
      sessionStorage.setItem(BRANDING_REDIRECT_NOTICE_KEY, BRANDING_REQUIRED_MESSAGE);
    } catch (err) {
      console.warn("[ask-reviews] unable to persist redirect notice", err);
    }
    window.location.href = "/business-settings.html?return=dashboard";
  });
  updateBulkAddPreview();
  updateBulkSelectedCount();
  updateBulkUploadCta();
}

function initApp() {
  listenForUser(({ user, profile, subscription, branding }) => {
    if (!user) return;
    currentUser = user;
    businessId = user.uid;
    setPlan(subscription?.planId || subscription?.planTier);
    const brandingDetails = branding || deriveBranding(profile || {});
    applyBrandingGate(brandingDetails);
    attachEvents();
    startCustomerFeed(user.uid);
    startOutboundFeed(user.uid);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribe === "function") unsubscribe();
  if (typeof outboundUnsub === "function") outboundUnsub();
});
