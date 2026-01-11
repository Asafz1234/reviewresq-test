import {
  db,
  collection,
  query,
  orderBy,
  onSnapshot,
  where,
  doc,
  updateDoc,
  serverTimestamp,
} from "./firebase-config.js";
import { listenForUser, formatDate, initialsFromName } from "./session-data.js";
import { PLAN_ORDER, normalizePlan } from "./plan-capabilities.js";
import { createCustomer } from "./js/customersApi.js";

const statusFilters = document.getElementById("statusFilters");
const sourceFilters = document.getElementById("sourceFilters");
const searchInput = document.getElementById("customerSearch");
const archivedToggle = document.getElementById("archivedToggle");
const tableBody = document.getElementById("customersTableBody");
const emptyState = document.getElementById("customersEmptyState");
const selectAll = document.getElementById("selectAll");
const customerCount = document.getElementById("customerCount");
const archiveSelectedBtn = document.getElementById("archiveSelectedBtn");
const detailContainer = document.getElementById("customerDetailContent");
const detailPlaceholder = document.getElementById("emptyCustomerState");
const customersShell = document.getElementById("customers");
const planRestrictedElements = Array.from(document.querySelectorAll("[data-plan-requires]"));
const addCustomerBtn = document.getElementById("addCustomerBtn");
const addCustomerModal = document.getElementById("addCustomerModal");
const addCustomerForm = document.getElementById("addCustomerForm");
const addCustomerName = document.getElementById("addCustomerName");
const addCustomerEmail = document.getElementById("addCustomerEmail");
const addCustomerPhone = document.getElementById("addCustomerPhone");
const addCustomerNotes = document.getElementById("addCustomerNotes");
const addCustomerSuccess = document.getElementById("addCustomerSuccess");
const addCustomerError = document.getElementById("addCustomerError");
const addCustomerSubmit = document.getElementById("addCustomerSubmit");

const FEEDBACK_ROUTE = "/feedback";

let businessId = null;
let customers = [];
let filtered = [];
let selectedCustomerId = null;
const selectedRows = new Set();
let unsubscribe = null;
let requestActivityUnsub = null;
let requestActivity = [];
let activityCustomerId = null;
const deepLinkedCustomerId = new URLSearchParams(window.location.search).get("customerId");
let currentStatusFilter = "all";
let currentSourceFilter = "all";
let showArchived = false;
let allowBulkActions = true;
const inviteToastId = "customers-toast";
let addCustomerModalController = null;

function getCustomersCollection() {
  if (!businessId) {
    throw new Error("Missing business id for customers");
  }
  return collection(db, "businesses", businessId, "customers");
}

function showToast(message, isError = false) {
  let toast = document.getElementById(inviteToastId);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = inviteToastId;
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.toggle("toast-error", Boolean(isError));
  toast.classList.add("visible");
  clearTimeout(showToast.hideTimer);
  showToast.hideTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}

function setInlineMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message || "";
  element.hidden = !message;
  element.classList.toggle("pill-error", isError);
  element.classList.toggle("pill-success", !isError);
}

function normalizeFeedbackLinks() {
  const nav = document.querySelector(".global-nav");
  if (!nav) return;
  nav
    .querySelectorAll('.nav-tab[data-route="inbox"], .nav-tab[data-route="feedback"]')
    .forEach((tab) => {
      tab.setAttribute("href", FEEDBACK_ROUTE);
    });
  nav.querySelectorAll('a[href*="/pages/feedback"]').forEach((tab) => {
    tab.setAttribute("href", FEEDBACK_ROUTE);
  });
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

function planRank(planId = "starter") {
  const normalized = normalizePlan(planId);
  const index = PLAN_ORDER.indexOf(normalized);
  return index === -1 ? 0 : index;
}

function setElementHidden(element, hidden) {
  if (!element) return;
  element.style.display = hidden ? "none" : "";
  element.setAttribute("aria-hidden", hidden ? "true" : "false");
}

function resetAddCustomerForm() {
  if (addCustomerForm) addCustomerForm.reset();
  setInlineMessage(addCustomerSuccess, "");
  setInlineMessage(addCustomerError, "");
}

function openAddCustomerModal() {
  if (!addCustomerModalController) return;
  resetAddCustomerForm();
  addCustomerModalController.open();
}

function ensureAllowedSourceFilter() {
  if (currentSourceFilter === "all") return;
  const button = sourceFilters?.querySelector(`[data-source="${currentSourceFilter}"]`);
  if (!button || button.getAttribute("aria-hidden") === "true") {
    currentSourceFilter = "all";
    sourceFilters?.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
    const allButton = sourceFilters?.querySelector('[data-source="all"]');
    allButton?.classList.add("active");
  }
}

function applyPlanGating(planId = "starter") {
  const normalizedPlan = normalizePlan(planId);
  const activeRank = planRank(normalizedPlan);
  const isGrowth = activeRank >= planRank("growth");

  if (customersShell) {
    customersShell.classList.toggle("customers--starter", !isGrowth);
  }

  planRestrictedElements.forEach((element) => {
    const requiredPlan = element.dataset.planRequires || "starter";
    const requiredRank = planRank(requiredPlan);
    setElementHidden(element, activeRank < requiredRank);
  });

  allowBulkActions = isGrowth;
  if (!allowBulkActions) {
    selectedRows.clear();
    archiveSelectedBtn.disabled = true;
    archiveSelectedBtn.setAttribute("aria-disabled", "true");
    selectAll.checked = false;
    selectAll.disabled = true;
    selectAll.setAttribute("aria-disabled", "true");
  } else {
    archiveSelectedBtn.disabled = !selectedRows.size;
    archiveSelectedBtn.removeAttribute("aria-disabled");
    selectAll.disabled = false;
    selectAll.removeAttribute("aria-disabled");
  }

  ensureAllowedSourceFilter();
  renderTable();
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

async function requestInviteLink(customerId) {
  if (!businessId || !customerId) {
    throw new Error("Missing business or customer information");
  }

  const callable = httpsCallable(functions, "createInviteToken");
  const result = await callable({ businessId, customerId, channel: "manual" });
  const portalUrl = result?.data?.portalUrl;
  if (!portalUrl) {
    throw new Error("Unable to generate portal link");
  }
  return portalUrl;
}

async function copyInviteLink(customer) {
  const link = await requestInviteLink(customer.id);
  await copyText(link);
  showToast("Portal link copied");
}

async function downloadInviteQr(customer) {
  const link = await requestInviteLink(customer.id);
  await downloadQrCode(link);
  showToast("QR code downloaded");
}

async function handleAddCustomerSubmit(event) {
  event.preventDefault();
  if (!businessId) return;

  const name = (addCustomerName?.value || "").trim();
  const email = (addCustomerEmail?.value || "").trim().toLowerCase();
  const phone = (addCustomerPhone?.value || "").trim();
  const notes = (addCustomerNotes?.value || "").trim();

  setInlineMessage(addCustomerSuccess, "");
  setInlineMessage(addCustomerError, "");

  if (!name) {
    setInlineMessage(addCustomerError, "Customer name is required.", true);
    return;
  }

  if (!email && !phone) {
    setInlineMessage(addCustomerError, "Provide at least an email or phone number.", true);
    return;
  }

  const defaultLabel = addCustomerSubmit.textContent;
  addCustomerSubmit.disabled = true;
  addCustomerSubmit.textContent = "Saving…";

  try {
    await createCustomer({
      businessId,
      name,
      email,
      phone,
      notes,
      reviewStatus: "none",
    });
    setInlineMessage(addCustomerSuccess, "Customer added.");
    showToast("Customer saved");
    resetAddCustomerForm();
    addCustomerModalController?.close();
  } catch (err) {
    console.error("[customers] add customer failed", err);
    setInlineMessage(addCustomerError, "We couldn’t save that customer. Please try again.", true);
  } finally {
    addCustomerSubmit.disabled = false;
    addCustomerSubmit.textContent = defaultLabel;
  }
}

function formatTimeline(timeline = []) {
  return timeline
    .map((entry) => {
      const timestamp = entry?.timestamp?.toDate
        ? entry.timestamp.toDate()
        : entry?.timestamp
        ? new Date(entry.timestamp)
        : null;
      return {
        type: entry.type,
        metadata: entry.metadata || {},
        timestamp,
      };
    })
    .sort((a, b) => {
      const aTime = a.timestamp ? a.timestamp.getTime() : 0;
      const bTime = b.timestamp ? b.timestamp.getTime() : 0;
      return bTime - aTime;
    });
}

function normalizeCustomer(docSnap) {
  const data = docSnap.data() || {};
  const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
  const lastInteraction = data.lastInteractionAt?.toDate
    ? data.lastInteractionAt.toDate()
    : null;

  return {
    id: docSnap.id,
    name: data.name || "Unnamed",
    phone: data.phone || "",
    email: data.email || "",
    source: data.source || "manual",
    reviewStatus: data.reviewStatus || "none",
    createdAt,
    lastInteraction,
    archived: Boolean(data.archived),
    timeline: formatTimeline(Array.isArray(data.timeline) ? data.timeline : []),
  };
}

function formatSourceLabel(source) {
  const map = {
    manual: "Manual",
    csv: "CSV",
    sheet: "Sheet",
    funnel: "Funnel",
    webhook: "Webhook",
  };
  return map[source] || "Unknown";
}

function resolveTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatNYDateTime(value) {
  if (!value) return "—";
  const timestamp = typeof value === "number" ? value : resolveTimestampMs(value);
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function inferChannel(entry) {
  const explicit = (entry?.channel || entry?.sendChannel || "").toString().trim().toLowerCase();
  if (explicit) return explicit;
  const hasEmailSignals = Boolean(
    entry?.provider ||
      entry?.providerMessageId ||
      entry?.messageId ||
      entry?.emailId ||
      entry?.emailStatus ||
      entry?.deliveredAtMs ||
      entry?.processedAtMs,
  );
  return hasEmailSignals ? "email" : "link";
}

function deriveActivityStatus(entry) {
  const clicked = resolveTimestampMs(entry.clickedAt || entry.clickedAtMs);
  if (clicked) return "Clicked";
  const opened = resolveTimestampMs(entry.openedAt || entry.openedAtMs);
  if (opened) return "Opened";
  const sent = resolveTimestampMs(
    entry.sentAtMs ||
      entry.sentAt ||
      entry.deliveredAtMs ||
      entry.processedAtMs,
  );
  if (sent) return "Sent";
  return "Draft";
}

function statusBadge(status) {
  const labels = {
    none: "No request",
    requested: "Requested",
    reviewed: "Reviewed",
    negative: "Negative",
  };
  const classes = {
    none: "badge",
    requested: "badge badge-warning",
    reviewed: "badge badge-success",
    negative: "badge badge-warning",
  };
  return `<span class="${classes[status] || "badge"}">${labels[status] || status}</span>`;
}

function renderTimeline(customer) {
  if (!customer) {
    detailPlaceholder.style.display = "block";
    detailContainer.style.display = "none";
    detailContainer.innerHTML = "";
    startCustomerActivityFeed(null);
    return;
  }

  detailPlaceholder.style.display = "none";
  detailContainer.style.display = "block";

  const timeline = customer.timeline.length
    ? customer.timeline
    : [];

  const timelineHtml = timeline.length
    ? timeline
        .map((item) => {
          const labelMap = {
            sms_sent: "SMS sent",
            email_sent: "Email sent",
            review_left: "Review link clicked",
            feedback_received: "Feedback captured",
            campaign_message: "Campaign touch",
            automation_step: "Automation step",
          };
          const metaPieces = [];
          if (item.metadata?.reason) metaPieces.push(item.metadata.reason);
          if (item.metadata?.rating) metaPieces.push(`${item.metadata.rating}★`);
          if (item.metadata?.message) metaPieces.push(item.metadata.message);
          const metaText = metaPieces.join(" • ");
          return `
            <div class="timeline-item">
              <div class="timeline-meta">
                <span class="badge">${labelMap[item.type] || item.type}</span>
                <span class="caption">${
                  item.timestamp
                    ? item.timestamp.toLocaleString()
                    : "Unknown time"
                }</span>
              </div>
              <p class="timeline-text">${metaText || "Event recorded"}</p>
            </div>
          `;
        })
        .join("")
    : '<p class="caption">No timeline entries yet.</p>';

  detailContainer.innerHTML = `
    <div class="card">
      <div class="customer-header">
        <div class="avatar">${initialsFromName(customer.name)}</div>
        <div>
          <h3 class="section-title">${customer.name}</h3>
          <p class="card-sub">${customer.email || customer.phone || "No contact info"}</p>
          <div class="chip chip-muted">${formatSourceLabel(customer.source)}</div>
        </div>
      </div>
      <div class="customer-meta">
        <div>
          <div class="caption">Review status</div>
          ${statusBadge(customer.reviewStatus)}
        </div>
        <div>
          <div class="caption">Created</div>
          <div class="card-title">${formatDate(customer.createdAt)}</div>
        </div>
        <div>
          <div class="caption">Last interaction</div>
          <div class="card-title">${formatDate(customer.lastInteraction)}</div>
        </div>
        <div>
          <div class="caption">Archived</div>
          <div class="card-title">${customer.archived ? "Yes" : "No"}</div>
        </div>
      </div>
      <div class="card-title">Customer timeline</div>
      <div class="timeline">${timelineHtml}</div>
      <div class="detail-actions">
        <button class="btn" data-action="copy-link" data-id="${customer.id}">Copy portal link</button>
        <button class="btn btn-outline" data-action="download-qr" data-id="${customer.id}">Download QR</button>
        <button class="btn btn-secondary" data-action="archive" data-id="${customer.id}">
          ${customer.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Request activity</div>
      <div class="timeline" id="customerRequestTimeline"></div>
    </div>
  `;
  renderCustomerRequestTimeline();
}

function renderCustomerRequestTimeline() {
  const container = document.getElementById("customerRequestTimeline");
  if (!container) return;
  if (!requestActivity.length) {
    container.innerHTML = '<p class="caption">No request activity yet.</p>';
    return;
  }

  container.innerHTML = requestActivity
    .map((entry) => {
      const createdAt = resolveTimestampMs(
        entry.createdAtMs || entry.createdAt || entry.updatedAtMs || entry.updatedAt,
      );
      const sentAt = resolveTimestampMs(
        entry.sentAtMs ||
          entry.sentAt ||
          entry.deliveredAtMs ||
          entry.processedAtMs,
      );
      const openedAt = resolveTimestampMs(entry.openedAtMs || entry.openedAt);
      const clickedAt = resolveTimestampMs(entry.clickedAtMs || entry.clickedAt);
      const status = deriveActivityStatus(entry);
      const channel = inferChannel(entry) === "email" ? "Email" : "Link";
      const link = entry.portalLink || entry.portalUrl || entry.linkUrl || "";
      const archivedBadge = entry.archived ? '<span class="badge badge-muted">Archived</span>' : "";

      return `
        <div class="timeline-item">
          <div class="timeline-meta">
            <span class="badge">${status}</span>
            ${archivedBadge}
            <span class="caption">${createdAt ? formatNYDateTime(createdAt) : "Unknown date"}</span>
          </div>
          <p class="timeline-text">Channel: ${channel}</p>
          <p class="caption">Sent: ${formatNYDateTime(sentAt)} · Opened: ${formatNYDateTime(openedAt)} · Clicked: ${formatNYDateTime(clickedAt)}</p>
          ${
            link
              ? `<a class="helper-link" href="${link}" target="_blank" rel="noopener">Open request link</a>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function startCustomerActivityFeed(customerId) {
  if (activityCustomerId === customerId && requestActivityUnsub) {
    renderCustomerRequestTimeline();
    return;
  }
  if (typeof requestActivityUnsub === "function") {
    requestActivityUnsub();
  }
  activityCustomerId = customerId || null;
  requestActivity = [];
  renderCustomerRequestTimeline();

  if (!businessId || !customerId) return;
  const outboundRef = collection(db, "businesses", businessId, "outboundRequests");
  const q = query(outboundRef, where("customerId", "==", customerId), orderBy("createdAtMs", "desc"));
  requestActivityUnsub = onSnapshot(q, (snapshot) => {
    requestActivity = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderCustomerRequestTimeline();
  });
}

function renderTable() {
  const rows = filtered.map((customer) => {
    const selected = selectedRows.has(customer.id);
    const active = selectedCustomerId === customer.id ? "active" : "";
    const contact = customer.email || customer.phone || "—";
    const archivedFlag = customer.archived
      ? '<span class="badge badge-muted">Archived</span>'
      : "";
    const checkboxCell = allowBulkActions
      ? `
        <td class="bulk-cell">
          <input type="checkbox" class="row-checkbox" data-id="${customer.id}" ${
            selected ? "checked" : ""
          } aria-label="Select ${customer.name}" />
        </td>
      `
      : '<td class="bulk-cell" style="display:none;"></td>';

    return `
      <tr class="customer-row ${active}" data-id="${customer.id}">
        ${checkboxCell}
        <td>
          <div class="customer-cell">
            <div class="avatar">${initialsFromName(customer.name)}</div>
            <div>
              <div class="customer-name">${customer.name}</div>
              <div class="customer-contact">${contact}</div>
            </div>
          </div>
        </td>
        <td><span class="chip chip-muted">${formatSourceLabel(customer.source)}</span></td>
        <td>${statusBadge(customer.reviewStatus)} ${archivedFlag}</td>
        <td>${formatDate(customer.createdAt)}</td>
        <td>${formatDate(customer.lastInteraction)}</td>
      </tr>
    `;
  });

  tableBody.innerHTML = rows.join("");
  emptyState.style.display = rows.length ? "none" : "block";
  customerCount.textContent = `${filtered.length} customer${filtered.length === 1 ? "" : "s"}`;
  archiveSelectedBtn.disabled = !allowBulkActions || !selectedRows.size;
  selectAll.checked = allowBulkActions && filtered.length > 0 && selectedRows.size === filtered.length;
}

function applyFilters() {
  const term = (searchInput.value || "").trim().toLowerCase();
  filtered = customers.filter((customer) => {
    const matchesTerm =
      !term ||
      customer.name.toLowerCase().includes(term) ||
      customer.email.toLowerCase().includes(term) ||
      customer.phone.toLowerCase().includes(term);

    const matchesStatus =
      currentStatusFilter === "all" ||
      customer.reviewStatus === currentStatusFilter;

    const matchesSource =
      currentSourceFilter === "all" || customer.source === currentSourceFilter;

    const matchesArchived = showArchived || !customer.archived;

    return matchesTerm && matchesStatus && matchesSource && matchesArchived;
  });

  renderTable();
}

function handleStatusClick(event) {
  const button = event.target.closest("[data-status]");
  if (!button) return;

  currentStatusFilter = button.dataset.status;
  statusFilters.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
  button.classList.add("active");
  applyFilters();
}

function handleSourceClick(event) {
  const button = event.target.closest("[data-source]");
  if (!button) return;

  currentSourceFilter = button.dataset.source;
  sourceFilters.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
  button.classList.add("active");
  applyFilters();
}

function handleRowClick(event) {
  if (event.target.closest(".row-checkbox")) return;
  const row = event.target.closest(".customer-row");
  if (!row) return;
  const id = row.dataset.id;
  const customer = filtered.find((c) => c.id === id);
  selectedCustomerId = id;
  renderTimeline(customer);
  startCustomerActivityFeed(id);
  renderTable();
}

function handleCheckboxChange(event) {
  if (!allowBulkActions) return;
  const checkbox = event.target.closest(".row-checkbox");
  if (!checkbox) return;
  const id = checkbox.dataset.id;
  if (checkbox.checked) {
    selectedRows.add(id);
  } else {
    selectedRows.delete(id);
  }
  archiveSelectedBtn.disabled = !selectedRows.size;
  selectAll.checked = filtered.length > 0 && selectedRows.size === filtered.length;
}

async function archiveCustomers(ids = [], archived = true) {
  const updates = ids.map((id) =>
    updateDoc(doc(getCustomersCollection(), id), {
      archived,
      updatedAt: serverTimestamp(),
    })
  );

  await Promise.all(updates);
}

function attachDetailActions() {
  detailContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    const defaultLabel = button.textContent;

    try {
      button.disabled = true;
      if (action === "archive") {
        await archiveCustomers([id], !customer.archived);
      } else if (action === "copy-link") {
        await copyInviteLink(customer);
      } else if (action === "download-qr") {
        button.textContent = "Preparing QR…";
        await downloadInviteQr(customer);
      }
    } catch (err) {
      console.error("[customers] action failed", err);
      showToast("We couldn’t complete that action. Please try again.", true);
    } finally {
      if (action === "download-qr") {
        button.textContent = defaultLabel;
      }
      button.disabled = false;
    }
  });
}

function attachEvents() {
  if (window.ModalManager && addCustomerModal) {
    addCustomerModalController = window.ModalManager.register(addCustomerModal);
  }
  statusFilters.addEventListener("click", handleStatusClick);
  sourceFilters.addEventListener("click", handleSourceClick);
  tableBody.addEventListener("click", handleRowClick);
  tableBody.addEventListener("change", handleCheckboxChange);
  searchInput.addEventListener("input", applyFilters);
  archivedToggle.addEventListener("change", (e) => {
    showArchived = e.target.checked;
    applyFilters();
  });
  selectAll.addEventListener("change", (e) => {
    if (!allowBulkActions) return;
    if (e.target.checked) {
      filtered.forEach((c) => selectedRows.add(c.id));
    } else {
      filtered.forEach((c) => selectedRows.delete(c.id));
    }
    archiveSelectedBtn.disabled = !selectedRows.size;
    renderTable();
  });
  archiveSelectedBtn.addEventListener("click", async () => {
    if (!allowBulkActions) return;
    if (!selectedRows.size) return;
    await archiveCustomers(Array.from(selectedRows));
    selectedRows.clear();
    archiveSelectedBtn.disabled = true;
  });
  addCustomerBtn?.addEventListener("click", openAddCustomerModal);
  addCustomerForm?.addEventListener("submit", handleAddCustomerSubmit);
  attachDetailActions();
}

function startCustomerFeed(uid) {
  businessId = uid;
  const q = query(
    getCustomersCollection(),
    orderBy("createdAt", "desc")
  );

  unsubscribe = onSnapshot(q, (snapshot) => {
    customers = snapshot.docs.map(normalizeCustomer);
    applyFilters();
    if (deepLinkedCustomerId && !selectedCustomerId) {
      const deepLinkedCustomer = customers.find((c) => c.id === deepLinkedCustomerId);
      if (deepLinkedCustomer) {
        selectedCustomerId = deepLinkedCustomerId;
        renderTimeline(deepLinkedCustomer);
        startCustomerActivityFeed(deepLinkedCustomerId);
        renderTable();
        return;
      }
    }
    if (selectedCustomerId) {
      const current = customers.find((c) => c.id === selectedCustomerId);
      renderTimeline(current);
      startCustomerActivityFeed(selectedCustomerId);
    }
  });
}

listenForUser(({ user, subscription }) => {
  businessId = user.uid;
  applyPlanGating(subscription?.planId || "starter");
  startCustomerFeed(user.uid);
  attachEvents();
  normalizeFeedbackLinks();
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribe === "function") unsubscribe();
  if (typeof requestActivityUnsub === "function") requestActivityUnsub();
});
