import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "./firebase-config.js";
import { listenForUser, formatDate, initialsFromName } from "./session-data.js";
import { applyPlanBadge } from "./topbar-menu.js";

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

let businessId = null;
let customers = [];
let filtered = [];
let selectedCustomerId = null;
const selectedRows = new Set();
let unsubscribe = null;
let currentStatusFilter = "all";
let currentSourceFilter = "all";
let showArchived = false;

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
      <div class="card-title">Timeline</div>
      <div class="timeline">${timelineHtml}</div>
      <div class="detail-actions">
        <button class="btn btn-secondary" data-action="archive" data-id="${customer.id}">
          ${customer.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  `;
}

function renderTable() {
  const rows = filtered.map((customer) => {
    const selected = selectedRows.has(customer.id);
    const active = selectedCustomerId === customer.id ? "active" : "";
    const contact = customer.email || customer.phone || "—";
    const archivedFlag = customer.archived
      ? '<span class="badge badge-muted">Archived</span>'
      : "";

    return `
      <tr class="customer-row ${active}" data-id="${customer.id}">
        <td>
          <input type="checkbox" class="row-checkbox" data-id="${customer.id}" ${
            selected ? "checked" : ""
          } aria-label="Select ${customer.name}" />
        </td>
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
  archiveSelectedBtn.disabled = !selectedRows.size;
  selectAll.checked = filtered.length > 0 && selectedRows.size === filtered.length;
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
  renderTable();
}

function handleCheckboxChange(event) {
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
    updateDoc(doc(db, "customers", id), {
      archived,
      updatedAt: serverTimestamp(),
    })
  );

  await Promise.all(updates);
}

function attachDetailActions() {
  detailContainer.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='archive']");
    if (!button) return;
    const id = button.dataset.id;
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    await archiveCustomers([id], !customer.archived);
  });
}

function attachEvents() {
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
    if (e.target.checked) {
      filtered.forEach((c) => selectedRows.add(c.id));
    } else {
      filtered.forEach((c) => selectedRows.delete(c.id));
    }
    archiveSelectedBtn.disabled = !selectedRows.size;
    renderTable();
  });
  archiveSelectedBtn.addEventListener("click", async () => {
    if (!selectedRows.size) return;
    await archiveCustomers(Array.from(selectedRows));
    selectedRows.clear();
    archiveSelectedBtn.disabled = true;
  });
  attachDetailActions();
}

function startCustomerFeed(uid) {
  const q = query(
    collection(db, "customers"),
    where("businessId", "==", uid),
    orderBy("createdAt", "desc")
  );

  unsubscribe = onSnapshot(q, (snapshot) => {
    customers = snapshot.docs.map(normalizeCustomer);
    applyFilters();
    if (selectedCustomerId) {
      const current = customers.find((c) => c.id === selectedCustomerId);
      renderTimeline(current);
    }
  });
}

listenForUser(({ user, profile }) => {
  businessId = user.uid;
  applyPlanBadge(profile?.planId || profile?.plan || "starter");
  startCustomerFeed(user.uid);
  attachEvents();
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribe === "function") unsubscribe();
});
