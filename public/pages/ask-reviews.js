import {
  db,
  collection,
  query,
  onSnapshot,
  orderBy,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "../firebase-config.js";
import { functions, httpsCallable } from "../firebase-config.js";
import {
  deriveBranding,
  listenForUser,
  refreshSubscription,
  getCachedPlan,
  setCachedPlan,
  getCachedSubscription,
} from "../session-data.js";
import { PLAN_LABELS, normalizePlan } from "../plan-capabilities.js";
import {
  parseCustomerFile,
  buildPreviewRows,
  renderPreviewTable,
  countPreviewRows,
} from "../js/bulkUpload.js";
import { subscribeCustomers } from "../js/customersApi.js";

const shouldInit = typeof window === "undefined" || !window.__rrAskReviewsInit;
if (typeof window !== "undefined" && shouldInit) {
  window.__rrAskReviewsInit = true;
}

const planBadge = document.querySelector("[data-plan-label]");
const brandingBlocker = document.getElementById("brandingBlocker");
const brandingBlockerMessage = document.getElementById("brandingBlockerMessage");
const completeSettingsBtn = document.getElementById("completeSettingsBtn");
const setupStatus = document.getElementById("setupStatus");

const singleCustomerName = document.getElementById("singleCustomerName");
const singleCustomerEmail = document.getElementById("singleCustomerEmail");
const singleCustomerPhone = document.getElementById("singleCustomerPhone");
const singleChannelSelect = document.getElementById("singleChannelSelect");
const singleSendBtn = document.getElementById("singleSendBtn");
const singleSuccess = document.getElementById("singleSuccess");
const singleError = document.getElementById("singleError");
const singleLinkOutput = document.getElementById("singleLinkOutput");
const singleCopyLinkBtn = document.getElementById("singleCopyLinkBtn");
const singleOpenLinkBtn = document.getElementById("singleOpenLinkBtn");
const singleLinkValue = document.getElementById("singleLinkValue");

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
const bulkUploadChannelSelect = document.getElementById("bulkUploadChannelSelect");
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
const requestArchiveFilter = document.getElementById("requestArchiveFilter");
const customStartWrapper = document.getElementById("customStartWrapper");
const customEndWrapper = document.getElementById("customEndWrapper");
const customStartInput = document.getElementById("requestStart");
const customEndInput = document.getElementById("requestEnd");

const toastEl = document.getElementById("askToast");

const BRANDING_REQUIRED_MESSAGE =
  "Before sending review requests, please complete your business details (takes under 1 minute).";

const BRANDING_REDIRECT_NOTICE_KEY = "brandingRedirectNotice";
const CUSTOMERS_ROUTE = "/customers";
const FEEDBACK_ROUTE = "/feedback";
const PLAN_WARNING_ID = "rr-plan-warning";
const PLAN_LOADING_ID = "rr-plan-loading";
const PLAN_RETRY_LIMIT = 3;
const PLAN_RETRY_BASE_DELAY_MS = 800;
const DEBUG = (() => {
  try {
    return localStorage.getItem("rrDebug") === "1";
  } catch (err) {
    return false;
  }
})();

function debugLog(...args) {
  if (DEBUG) {
    console.log("[ask-reviews]", ...args);
  }
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const initialPlan = getCachedPlan() || getCachedSubscription()?.planId;
let businessId = null;
let plan = normalizePlan(initialPlan || "starter");
let customers = [];
let unsubscribe = null;
let outboundUnsub = null;
let bulkLinks = [];
let outboundRequests = [];
let currentUser = null;
let outboundCustomerCache = new Map();
let brandingState = { complete: true };
let eventsBound = false;
let bulkSelectedIds = new Set();
let bulkPreviewRows = [];
let bulkUploadBaseRows = [];
let bulkUploadFileMeta = null;
let lastBulkRun = null;
let lastSingleLink = null;
let planSource = "fresh";
let planRetryCount = 0;
let planRetryTimer = null;
let navNormalized = false;
let planWarningBanner = null;
let listenerCount = 0;

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

function splitHref(href = "") {
  const match = href.match(/^[^?#]+/);
  const path = match ? match[0] : href;
  const suffix = href.slice(path.length);
  return { path, suffix };
}

function ensurePlanWarningBanner() {
  if (planWarningBanner) return planWarningBanner;
  planWarningBanner = document.getElementById(PLAN_WARNING_ID);
  if (planWarningBanner) return planWarningBanner;
  planWarningBanner = document.createElement("div");
  planWarningBanner.id = PLAN_WARNING_ID;
  planWarningBanner.textContent = "Unable to load plan. Retrying...";
  planWarningBanner.style.background = "#fef3c7";
  planWarningBanner.style.color = "#92400e";
  planWarningBanner.style.padding = "8px 12px";
  planWarningBanner.style.fontSize = "12px";
  planWarningBanner.style.borderRadius = "8px";
  planWarningBanner.style.margin = "12px 0";
  planWarningBanner.style.display = "none";
  const target = document.querySelector(".page-content") || document.body;
  target.prepend(planWarningBanner);
  return planWarningBanner;
}

function setPlanWarningVisible(visible) {
  const banner = ensurePlanWarningBanner();
  banner.style.display = visible ? "block" : "none";
}

function ensurePlanLoadingNotice() {
  let notice = document.getElementById(PLAN_LOADING_ID);
  if (notice) return notice;
  notice = document.createElement("div");
  notice.id = PLAN_LOADING_ID;
  notice.className = "card muted-card";
  notice.style.margin = "12px 0";
  notice.innerHTML = `
    <p class="card-title">Loading plan access…</p>
    <p class="card-subtitle text-muted">Checking your subscription details.</p>
  `;
  const parent = bulkSection?.parentElement || document.querySelector(".page-shell");
  if (parent && bulkSection && parent.contains(bulkSection)) {
    parent.insertBefore(notice, bulkSection);
  } else if (parent) {
    parent.prepend(notice);
  } else {
    document.body.prepend(notice);
  }
  return notice;
}

function renderPlanLoadingState() {
  if (planBadge) {
    planBadge.textContent = "Loading...";
    planBadge.setAttribute("data-plan-loading", "true");
  }
  if (bulkSection) {
    bulkSection.hidden = true;
    bulkSection.setAttribute("aria-busy", "true");
  }
  const notice = ensurePlanLoadingNotice();
  notice.style.display = "block";
}

function clearPlanLoadingState() {
  const notice = document.getElementById(PLAN_LOADING_ID);
  if (notice) notice.style.display = "none";
  if (planBadge) {
    planBadge.removeAttribute("data-plan-loading");
  }
  if (bulkSection) {
    bulkSection.removeAttribute("aria-busy");
  }
}

function normalizeRouteHref(href = "") {
  const { path, suffix } = splitHref(href);
  const lowerPath = path.toLowerCase();
  if (
    lowerPath.endsWith("/pages/customers.html") ||
    lowerPath.endsWith("/pages/customers") ||
    lowerPath.endsWith("/customers.html") ||
    lowerPath.endsWith("customers.html")
  ) {
    return `${CUSTOMERS_ROUTE}${suffix}`;
  }
  if (
    lowerPath.endsWith("/pages/feedback.html") ||
    lowerPath.endsWith("/pages/feedback") ||
    lowerPath.endsWith("/feedback.html") ||
    lowerPath.endsWith("feedback.html")
  ) {
    return `${FEEDBACK_ROUTE}${suffix}`;
  }
  return "";
}

function setHrefIfNeeded(link, href) {
  if (!link || !href) return false;
  const current = link.getAttribute("href");
  if (current === href) return false;
  link.setAttribute("href", href);
  return true;
}

function normalizeNavLinkHrefs() {
  const nav = document.querySelector(".global-nav");
  if (!nav) return 0;
  let updates = 0;

  nav.querySelectorAll('.nav-tab[data-route="customers"]').forEach((tab) => {
    if (tab.dataset.rrNormalized === "1") return;
    if (setHrefIfNeeded(tab, CUSTOMERS_ROUTE)) {
      tab.dataset.rrNormalized = "1";
      updates += 1;
    }
  });
  nav
    .querySelectorAll('.nav-tab[data-route="inbox"], .nav-tab[data-route="feedback"]')
    .forEach((tab) => {
      if (tab.dataset.rrNormalized === "1") return;
      if (setHrefIfNeeded(tab, FEEDBACK_ROUTE)) {
        tab.dataset.rrNormalized = "1";
        updates += 1;
      }
    });

  nav.querySelectorAll("a[href]").forEach((link) => {
    if (link.dataset.rrNormalized === "1") return;
    const href = link.getAttribute("href") || "";
    const normalized = normalizeRouteHref(href);
    if (normalized && normalized !== href) {
      link.setAttribute("href", normalized);
      link.dataset.rrNormalized = "1";
      updates += 1;
    }
  });

  if (updates) {
    debugLog("normalized nav links", { updates });
  }

  return updates;
}

function safeNormalizeNavLinks() {
  try {
    return normalizeNavLinkHrefs();
  } catch (err) {
    console.error("[ask-reviews] nav normalization failed", err);
    return 0;
  }
}

function normalizeEmail(value = "") {
  return value.toString().trim().toLowerCase();
}

function normalizePhone(value = "") {
  const digits = value.toString().replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  if (digits.length === 10) return digits;
  return digits ? digits : "";
}

function isValidEmail(value = "") {
  return emailRegex.test(normalizeEmail(value));
}

function isValidPhone(value = "") {
  const digits = normalizePhone(value);
  if (!digits) return false;
  if (digits.length === 10) return true;
  return digits.length === 11 && digits.startsWith("1");
}

function applyPlan(planId) {
  if (!planId) return;
  plan = normalizePlan(planId || "starter");
  if (planBadge) {
    planBadge.textContent = PLAN_LABELS[plan] || plan.charAt(0).toUpperCase() + plan.slice(1);
  }
  if (bulkSection) {
    bulkSection.hidden = plan === "starter";
  }
  clearPlanLoadingState();
}

function setPlanWithSource(planId, source) {
  planSource = source;
  applyPlan(planId);
  if (source === "fresh") {
    setCachedPlan(planId);
  }
  debugLog("plan set", { plan, source });
}

function schedulePlanRetry() {
  if (planRetryCount >= PLAN_RETRY_LIMIT) return;
  const attempt = planRetryCount + 1;
  const delay = PLAN_RETRY_BASE_DELAY_MS * Math.pow(2, planRetryCount);
  planRetryCount = attempt;
  clearTimeout(planRetryTimer);
  planRetryTimer = setTimeout(async () => {
    try {
      const refreshed = await refreshSubscription();
      const refreshedPlan = normalizePlan(refreshed?.planId || "");
      const cachedPlan = getCachedPlan();
      if (refreshedPlan && (refreshedPlan !== "starter" || !cachedPlan)) {
        setPlanWithSource(refreshedPlan, "fresh");
        setPlanWarningVisible(false);
        return;
      }
    } catch (err) {
      debugLog("plan refresh failed", err);
    }
    if (planRetryCount < PLAN_RETRY_LIMIT) {
      schedulePlanRetry();
    }
  }, delay);
}

function getCustomerContact(customer) {
  return customer.email || customer.phone || "—";
}

function buildCustomerLookup(list = []) {
  const byEmail = new Map();
  const byPhone = new Map();
  list.forEach((customer) => {
    const email = normalizeEmail(customer.email || "");
    const phone = normalizePhone(customer.phone || "");
    if (email) byEmail.set(email, customer);
    if (phone) byPhone.set(phone, customer);
  });
  return { byEmail, byPhone };
}

function findExistingCustomer({ email = "", phone = "" }, lookup) {
  const emailKey = normalizeEmail(email);
  const phoneKey = normalizePhone(phone);
  if (emailKey && lookup.byEmail.has(emailKey)) return lookup.byEmail.get(emailKey);
  if (phoneKey && lookup.byPhone.has(phoneKey)) return lookup.byPhone.get(phoneKey);
  return null;
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
  if (typeof unsubscribe === "function") unsubscribe();
  debugLog("customer feed start", { businessId: uid });
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
      customers.forEach((customer) => {
        outboundCustomerCache.set(customer.id, customer);
      });
      renderExistingCustomers();
      updateBulkSelectedCount();
      debugLog("customer feed update", { count: customers.length });
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
    singleCustomerName,
    singleCustomerEmail,
    singleCustomerPhone,
    singleChannelSelect,
    singleSendBtn,
    singleCopyLinkBtn,
    singleOpenLinkBtn,
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
    bulkUploadChannelSelect,
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
    if (singleLinkOutput) singleLinkOutput.hidden = true;
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

function resolveTimestampMs(value) {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return null;
}

function formatNY(timestampMs) {
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
    name: (name || "").toString().trim(),
    phone: normalizePhone(phone || ""),
    email: normalizeEmail(email || ""),
    reviewStatus: "requested",
  });
  return response?.data?.customerId || null;
}

async function updateOutboundLocale(requestId) {
  if (!businessId || !requestId) return;
  try {
    const outboundRef = doc(db, "businesses", businessId, "outboundRequests", String(requestId));
    await updateDoc(outboundRef, {
      locale: "en-US",
      tz: "America/New_York",
      updatedAtMs: Date.now(),
    });
  } catch (err) {
    console.warn("[ask-reviews] unable to update outbound locale", err);
  }
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

async function hydrateOutboundCustomers() {
  if (!businessId) return;
  const ids = Array.from(
    new Set(outboundRequests.map((entry) => entry.customerId).filter(Boolean)),
  ).filter((id) => !outboundCustomerCache.has(id));
  if (!ids.length) return;

  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        const customerRef = doc(db, "businesses", businessId, "customers", String(id));
        const snap = await getDoc(customerRef);
        outboundCustomerCache.set(id, snap.exists() ? { id, ...snap.data() } : null);
      } catch (err) {
        console.warn("[ask-reviews] unable to fetch customer", err);
        outboundCustomerCache.set(id, null);
      }
    }),
  );
}

function getCustomerDisplay(entry) {
  if (!entry?.customerId) return "Link visitor";
  const customer = outboundCustomerCache.get(entry.customerId);
  if (customer) return customer.name || customer.email || customer.phone || "—";
  return entry.customerName || entry.customerEmail || entry.customerPhone || "—";
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

async function archiveOutboundRequest(requestId) {
  if (!businessId || !requestId) return;
  try {
    const outboundRef = doc(db, "businesses", businessId, "outboundRequests", String(requestId));
    await updateDoc(outboundRef, {
      archived: true,
      archivedAt: serverTimestamp(),
      archivedAtMs: Date.now(),
    });
    showToast("Archived");
  } catch (err) {
    console.error("[ask-reviews] unable to archive request", err);
    showToast("Unable to archive this request.", true);
  }
}

function renderOutboundTable() {
  if (!outboundTableBody) return;
  const range = requestRange?.value || "thisMonth";
  const archiveFilter = requestArchiveFilter?.value || "active";
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

  const archiveFiltered = filtered.filter((item) => {
    const isArchived = Boolean(item.archived);
    if (archiveFilter === "all") return true;
    if (archiveFilter === "archived") return isArchived;
    return !isArchived;
  });

  outboundTableBody.innerHTML = "";
  if (!archiveFiltered.length) {
    const emptyCell = outboundEmptyRow?.querySelector("td");
    if (emptyCell) {
      emptyCell.textContent =
        archiveFilter === "archived"
          ? "No archived requests yet"
          : "No requests yet";
    }
    outboundEmptyRow?.removeAttribute("hidden");
    outboundTableBody.appendChild(outboundEmptyRow);
    return;
  }

  outboundEmptyRow?.setAttribute("hidden", "true");
  archiveFiltered.forEach((entry) => {
    const row = document.createElement("tr");
    const customerCell = document.createElement("td");
    const channelCell = document.createElement("td");
    const sentCell = document.createElement("td");
    const openedCell = document.createElement("td");
    const clickedCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const dateCell = document.createElement("td");
    const actionCell = document.createElement("td");

    const customerName = getCustomerDisplay(entry);
    if (entry.customerId) {
      const link = document.createElement("a");
      link.href = `/customers?customerId=${encodeURIComponent(entry.customerId)}`;
      link.className = "helper-link";
      link.textContent = customerName;
      customerCell.appendChild(link);
    } else {
      customerCell.textContent = customerName;
    }
    const resolvedChannel = inferChannel(entry);
    channelCell.textContent = resolvedChannel === "email" ? "Email" : "Link";
    const sentTimestamp = resolveTimestampMs(
      entry.sentAtMs ||
        entry.sentAt ||
        entry.deliveredAtMs ||
        entry.processedAtMs ||
        entry.createdAtMs ||
        entry.createdAt ||
        entry.updatedAtMs ||
        entry.updatedAt,
    );
    sentCell.textContent = sentTimestamp ? formatNY(sentTimestamp) : "—";
    const openedTimestamp = resolveTimestampMs(entry.openedAtMs || entry.openedAt);
    openedCell.textContent = openedTimestamp ? formatNY(openedTimestamp) : "—";
    const clickedTimestamp = resolveTimestampMs(entry.clickedAtMs || entry.clickedAt);
    clickedCell.textContent = clickedTimestamp ? formatNY(clickedTimestamp) : "—";
    statusCell.textContent = deriveActivityStatus(entry);
    if (entry.archived) {
      const badge = document.createElement("span");
      badge.className = "badge badge-muted";
      badge.style.marginLeft = "6px";
      badge.textContent = "Archived";
      statusCell.appendChild(badge);
    }
    const createdTimestamp = resolveTimestampMs(
      entry.createdAtMs || entry.createdAt || entry.updatedAtMs || entry.updatedAt,
    );
    dateCell.textContent = createdTimestamp ? formatNY(createdTimestamp) : "—";

    if (entry.archived) {
      actionCell.textContent = "Archived";
      actionCell.style.color = "#6b7280";
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline";
      button.style.padding = "4px 10px";
      button.style.fontSize = "12px";
      button.textContent = "Archive";
      button.dataset.action = "archive";
      button.dataset.id = entry.id;
      actionCell.appendChild(button);
    }

    row.appendChild(customerCell);
    row.appendChild(channelCell);
    row.appendChild(sentCell);
    row.appendChild(openedCell);
    row.appendChild(clickedCell);
    row.appendChild(statusCell);
    row.appendChild(dateCell);
    row.appendChild(actionCell);
    outboundTableBody.appendChild(row);
  });
}

function startOutboundFeed(uid) {
  if (!uid || !outboundTableBody) return;
  const outboundRef = collection(db, "businesses", uid, "outboundRequests");
  const q = query(outboundRef, orderBy("createdAtMs", "desc"));
  if (typeof outboundUnsub === "function") outboundUnsub();
  debugLog("outbound feed start", { businessId: uid });
  outboundUnsub = onSnapshot(q, (snapshot) => {
    outboundRequests = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    hydrateOutboundCustomers().then(renderOutboundTable);
    debugLog("outbound feed update", { count: outboundRequests.length });
  });
}

function handleRangeChange() {
  renderOutboundTable();
}

function handleOutboundTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action !== "archive") return;
  const requestId = button.dataset.id;
  button.disabled = true;
  archiveOutboundRequest(requestId).finally(() => {
    button.disabled = false;
  });
}

function resetBulkFeedback() {
  setInlineMessage(singleSuccess, "");
  setInlineMessage(singleError, "");
  setInlineMessage(bulkExistingSuccess, "");
  setInlineMessage(bulkExistingError, "");
  setInlineMessage(bulkAddSuccess, "");
  setInlineMessage(bulkAddError, "");
  setInlineMessage(bulkUploadError, "");
  setInlineMessage(bulkUploadSuccess, "");
}

function updateSingleCta() {
  if (!singleSendBtn) return;
  const name = (singleCustomerName?.value || "").trim();
  const email = normalizeEmail(singleCustomerEmail?.value || "");
  const phone = normalizePhone(singleCustomerPhone?.value || "");
  const channel = singleChannelSelect?.value || "email";

  let canSend = false;
  if (channel === "email") {
    canSend = Boolean(name) && isValidEmail(email);
  } else {
    canSend = Boolean(name);
  }

  singleSendBtn.disabled = !canSend;
}

function setSingleLinkOutput(link, requestId = null) {
  lastSingleLink = link ? { link, requestId } : null;
  if (singleLinkValue) singleLinkValue.textContent = link || "";
  if (singleLinkOutput) singleLinkOutput.hidden = !link;
  if (singleCopyLinkBtn) singleCopyLinkBtn.disabled = !link;
  if (singleOpenLinkBtn) singleOpenLinkBtn.disabled = !link;
}

async function handleSingleSend() {
  if (!businessId) return;
  if (!requireBrandingOrNotify()) return;

  const name = (singleCustomerName?.value || "").trim();
  const channel = singleChannelSelect?.value || "email";
  const emailInput = singleCustomerEmail?.value || "";
  const phoneInput = singleCustomerPhone?.value || "";
  const email = normalizeEmail(emailInput);
  const phone = normalizePhone(phoneInput);

  resetBulkFeedback();
  setSingleLinkOutput("");

  if (!name) {
    setInlineMessage(singleError, "Customer name is required.", true);
    return;
  }

  if (emailInput && !isValidEmail(email)) {
    setInlineMessage(singleError, "Enter a valid email address.", true);
    return;
  }

  if (phoneInput && !isValidPhone(phone)) {
    setInlineMessage(singleError, "Enter a valid US phone number.", true);
    return;
  }

  if (channel === "email" && !email) {
    setInlineMessage(singleError, "Email is required for email requests.", true);
    return;
  }

  singleSendBtn.disabled = true;
  singleSendBtn.setAttribute("aria-busy", "true");

  try {
    const lookup = buildCustomerLookup(customers);
    const existingCustomer = findExistingCustomer({ email, phone }, lookup);
    const customerId = existingCustomer?.id
      ? existingCustomer.id
      : await ensureCustomerRecord({ name, phone, email });

    if (!customerId) {
      throw new Error("Unable to create customer record");
    }

    const inviteResponse = await createInviteTokenCallable({
      businessId,
      customerId,
      customerName: name,
      phone,
      email,
      channel,
      source: "ask-reviews-single",
    });
    const inviteData = inviteResponse?.data || {};
    const portalLink = inviteData.portalLink || inviteData.portalUrl;
    const requestId = inviteData.requestId || inviteData.inviteToken;

    if (!inviteData?.ok || !portalLink) {
      throw new Error(inviteData?.error || "Unable to create invite link");
    }

    await updateOutboundLocale(requestId);

    if (channel === "email") {
      const sendResponse = await sendReviewRequestEmailCallable({
        businessId,
        customerId,
        customerName: name,
        customerEmail: email,
        email,
        customerPhone: phone,
        portalLink,
        requestId,
        source: "ask-reviews-single",
      });
      if (!sendResponse?.data?.ok) {
        throw new Error(sendResponse?.data?.error || "Email send failed");
      }
      setInlineMessage(singleSuccess, "Email request sent.");
    } else {
      setSingleLinkOutput(portalLink, requestId);
      setInlineMessage(singleSuccess, "Link ready to share.");
    }
  } catch (err) {
    console.error("[ask-reviews] single send failed", err);
    setInlineMessage(singleError, err?.message || "Unable to send request.", true);
  } finally {
    singleSendBtn.disabled = false;
    singleSendBtn.removeAttribute("aria-busy");
  }
}

async function handleSingleCopyLink() {
  if (!lastSingleLink?.link) return;
  try {
    await copyText(lastSingleLink.link);
    if (singleLinkOutput?.hidden === false && lastSingleLink.requestId) {
      await markOutboundSent(lastSingleLink.requestId);
    }
    showToast("Link copied");
  } catch (err) {
    showToast("Copy failed", true);
  }
}

function handleSingleOpenLink() {
  if (!lastSingleLink?.link) return;
  window.open(lastSingleLink.link, "_blank", "noopener,noreferrer");
}

function updateBulkUploadCounts() {
  const counts = countPreviewRows(bulkUploadRows);
  if (bulkUploadTotalCount) bulkUploadTotalCount.textContent = String(counts.total);
  if (bulkUploadValidCount) bulkUploadValidCount.textContent = String(counts.valid);
  if (bulkUploadInvalidCount) bulkUploadInvalidCount.textContent = String(counts.invalid);
}

function buildBulkUploadRowsForChannel(rows = [], channel = "email") {
  return rows.map((row) => {
    const name = (row.name || "").toString().trim();
    const email = normalizeEmail(row.email || "");
    const phone = normalizePhone(row.phone || "");
    const errors = [];
    const hasEmail = Boolean(email);
    const hasPhone = Boolean(phone);
    const validEmail = hasEmail ? isValidEmail(email) : false;
    const validPhone = hasPhone ? isValidPhone(phone) : false;

    if (!name) {
      errors.push("Missing name");
    }

    if (channel === "email") {
      if (!hasEmail) {
        errors.push("Email required");
      } else if (!validEmail) {
        errors.push("Invalid email");
      }
    } else {
      if (!hasEmail && !hasPhone) {
        errors.push("Missing email/phone");
      }
      if (hasEmail && !validEmail && !validPhone) {
        errors.push("Invalid email");
      }
      if (hasPhone && !validPhone && !validEmail) {
        errors.push("Invalid phone");
      }
    }

    const isValid = errors.length === 0;
    return {
      ...row,
      name,
      email,
      phone,
      isValid,
      status: isValid ? "Ready" : errors.join("; "),
    };
  });
}

function updateBulkUploadPreview() {
  const channel = bulkUploadChannelSelect?.value || "email";
  bulkUploadRows = buildBulkUploadRowsForChannel(bulkUploadBaseRows, channel);
  renderBulkUploadPreview();
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
    bulkUploadSendBtn.textContent = `Send bulk requests (${count})`;
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
  bulkUploadFileMeta = file
    ? {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }
    : null;
  if (bulkUploadResults) bulkUploadResults.hidden = true;
  if (bulkUploadResultsBody) bulkUploadResultsBody.innerHTML = "";
  if (bulkUploadResultsSummary) bulkUploadResultsSummary.textContent = "";
  if (bulkUploadFileName) {
    bulkUploadFileName.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  }

  try {
    const rows = await parseCustomerFile(file);
    bulkUploadBaseRows = buildPreviewRows(rows);
    if (!bulkUploadBaseRows.length) {
      setInlineMessage(bulkUploadError, "No rows detected. Please check your file.", true);
    }
    updateBulkUploadPreview();
    if (bulkUploadBaseRows.length) {
      setInlineMessage(bulkUploadSuccess, `Loaded ${bulkUploadBaseRows.length} row(s).`);
    }
  } catch (err) {
    console.error("[ask-reviews] bulk upload parse failed", err);
    bulkUploadRows = [];
    bulkUploadBaseRows = [];
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
    const channelCell = document.createElement("td");
    const resultCell = document.createElement("td");
    const messageCell = document.createElement("td");

    nameCell.textContent = result.name || "—";
    contactCell.textContent = result.contact || "—";
    channelCell.textContent = result.channel || "—";
    resultCell.textContent = result.ok ? "Sent" : "Failed";
    resultCell.style.color = result.ok ? "#047857" : "#b91c1c";
    messageCell.textContent = result.message || "";

    row.appendChild(nameCell);
    row.appendChild(contactCell);
    row.appendChild(channelCell);
    row.appendChild(resultCell);
    row.appendChild(messageCell);
    bulkUploadResultsBody.appendChild(row);
  });
}

async function handleBulkUploadSend() {
  if (!businessId || !bulkSection || plan === "starter") return;
  if (!requireBrandingOrNotify()) return;

  const channel = bulkUploadChannelSelect?.value || "email";
  const excludeInvalid = bulkUploadExcludeInvalid?.checked ?? true;
  const rowsToSend = excludeInvalid
    ? bulkUploadRows.filter((row) => row.isValid)
    : bulkUploadRows;

  if (!rowsToSend.length) {
    showToast("Add at least one valid customer row", true);
    return;
  }

  const now = Date.now();
  const runHash = JSON.stringify({ file: bulkUploadFileMeta, channel });
  if (lastBulkRun && lastBulkRun.hash === runHash && now - lastBulkRun.timestamp < 120000) {
    const confirmed = window.confirm(
      "You just sent this file with the same channel. Do you want to send it again?",
    );
    if (!confirmed) return;
  }
  lastBulkRun = { hash: runHash, timestamp: now };

  resetBulkFeedback();
  bulkUploadSendBtn.disabled = true;
  bulkUploadSendBtn.setAttribute("aria-busy", "true");

  if (bulkUploadResults) bulkUploadResults.hidden = false;
  if (bulkUploadResultsSummary) {
    bulkUploadResultsSummary.textContent = `Processing 0 of ${rowsToSend.length}…`;
  }
  if (bulkUploadResultsBody) {
    bulkUploadResultsBody.innerHTML = "";
  }
  if (bulkLinkOutput) bulkLinkOutput.hidden = true;
  bulkLinks = [];

  try {
    const results = [];
    let processed = 0;
    const lookup = buildCustomerLookup(customers);

    for (const row of rowsToSend) {
      processed += 1;
      const result = {
        name: row.name,
        contact: row.email || row.phone || "",
        channel,
        ok: false,
        message: "",
      };

      if (!row.isValid) {
        result.message = "Invalid row";
        results.push(result);
        if (bulkUploadResultsSummary) {
          bulkUploadResultsSummary.textContent = `Processing ${processed} of ${rowsToSend.length}…`;
        }
        continue;
      }

      try {
        const existingCustomer = findExistingCustomer(
          { email: row.email, phone: row.phone },
          lookup,
        );
        const customerId = existingCustomer?.id
          ? existingCustomer.id
          : await ensureCustomerRecord({
              name: row.name,
              phone: row.phone,
              email: row.email,
            });

        if (!customerId) {
          throw new Error("Unable to create customer record");
        }

        if (!existingCustomer) {
          if (row.email) lookup.byEmail.set(normalizeEmail(row.email), { id: customerId });
          if (row.phone) lookup.byPhone.set(normalizePhone(row.phone), { id: customerId });
        }

        const inviteResponse = await createInviteTokenCallable({
          businessId,
          customerId,
          customerName: row.name,
          phone: row.phone,
          email: row.email,
          channel,
          source: "ask-reviews-bulk-upload",
        });
        const inviteData = inviteResponse?.data || {};
        const portalLink = inviteData.portalLink || inviteData.portalUrl;
        const requestId = inviteData.requestId || inviteData.inviteToken;

        if (!inviteData?.ok || !portalLink) {
          throw new Error(inviteData?.error || "Unable to create invite link");
        }

        await updateOutboundLocale(requestId);

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
            source: "ask-reviews-bulk-upload",
          });
          if (!sendResponse?.data?.ok) {
            throw new Error(sendResponse?.data?.error || "Email send failed");
          }
          result.ok = true;
          result.message = "Sent";
        } else {
          bulkLinks.push({
            name: row.name,
            contact: row.email || row.phone || "",
            link: portalLink,
            requestId,
            customerId,
            createdAtMs: Date.now(),
          });
          result.ok = true;
          result.message = "Link created";
        }
      } catch (err) {
        console.error("[ask-reviews] bulk upload send failed", err);
        result.message = err?.message || "Send failed";
      }

      results.push(result);
      if (bulkUploadResultsSummary) {
        bulkUploadResultsSummary.textContent = `Processing ${processed} of ${rowsToSend.length}…`;
      }
    }

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

    if (channel === "link") {
      renderBulkLinkResults();
    } else if (bulkLinkOutput) {
      bulkLinkOutput.hidden = true;
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
    formatNY(resolveTimestampMs(entry.createdAtMs)),
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

      await updateOutboundLocale(requestId);

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

      await updateOutboundLocale(requestId);

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
  let added = 0;
  const bindListener = (target, event, handler) => {
    if (!target) return 0;
    target.addEventListener(event, handler);
    return 1;
  };
  added += bindListener(singleCustomerName, "input", updateSingleCta);
  added += bindListener(singleCustomerEmail, "input", updateSingleCta);
  added += bindListener(singleCustomerPhone, "input", updateSingleCta);
  added += bindListener(singleChannelSelect, "change", () => {
    updateSingleCta();
    setSingleLinkOutput("");
  });
  added += bindListener(singleSendBtn, "click", handleSingleSend);
  added += bindListener(singleCopyLinkBtn, "click", handleSingleCopyLink);
  added += bindListener(singleOpenLinkBtn, "click", handleSingleOpenLink);
  added += bindListener(bulkExistingSearch, "input", renderExistingCustomers);
  added += bindListener(bulkExistingSendBtn, "click", openBulkExistingChannelPanel);
  added += bindListener(bulkExistingConfirmBtn, "click", handleBulkExistingConfirm);
  added += bindListener(bulkExistingCancelBtn, "click", closeBulkExistingChannelPanel);
  added += bindListener(bulkAddInput, "input", updateBulkAddPreview);
  added += bindListener(bulkAddChannelSelect, "change", updateBulkAddPreview);
  added += bindListener(bulkAddSendBtn, "click", handleBulkAddSend);
  added += bindListener(bulkUploadBtn, "click", () => bulkUploadInput?.click());
  added += bindListener(bulkUploadInput, "change", (event) => {
    const file = event.target?.files?.[0];
    handleBulkUploadSelection(file);
  });
  added += bindListener(bulkUploadChannelSelect, "change", updateBulkUploadPreview);
  added += bindListener(bulkUploadExcludeInvalid, "change", updateBulkUploadCta);
  added += bindListener(bulkUploadSendBtn, "click", handleBulkUploadSend);
  added += bindListener(bulkCopyLinksBtn, "click", handleBulkCopyLinks);
  added += bindListener(bulkDownloadLinksBtn, "click", handleBulkDownloadLinks);
  added += bindListener(requestRange, "change", handleRangeChange);
  added += bindListener(requestArchiveFilter, "change", renderOutboundTable);
  added += bindListener(customStartInput, "change", renderOutboundTable);
  added += bindListener(customEndInput, "change", renderOutboundTable);
  added += bindListener(outboundTableBody, "click", handleOutboundTableClick);
  added += bindListener(completeSettingsBtn, "click", () => {
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
  updateSingleCta();
  listenerCount = added;
  debugLog("listeners attached", { count: listenerCount });
}

function initApp() {
  debugLog("init start");
  const initialCachedPlan = getCachedPlan() || getCachedSubscription()?.planId;
  if (initialCachedPlan) {
    setPlanWithSource(initialCachedPlan, "cached");
  } else {
    renderPlanLoadingState();
  }
  listenForUser(({ user, profile, subscription, branding }) => {
    if (!user) return;
    currentUser = user;
    businessId = user.uid;
    const cachedPlan = getCachedPlan() || getCachedSubscription()?.planId;
    const incomingPlan = normalizePlan(subscription?.planId || subscription?.planTier || "");
    const hasIncomingPlan = Boolean(subscription?.planId || subscription?.planTier);
    if (hasIncomingPlan) {
      if (cachedPlan && incomingPlan === "starter" && cachedPlan !== "starter") {
        setPlanWithSource(cachedPlan, "cached");
        setPlanWarningVisible(true);
        schedulePlanRetry();
      } else {
        setPlanWithSource(incomingPlan || "starter", "fresh");
        setPlanWarningVisible(false);
      }
    } else if (cachedPlan) {
      setPlanWithSource(cachedPlan, "cached");
      setPlanWarningVisible(true);
      schedulePlanRetry();
    } else {
      renderPlanLoadingState();
      setPlanWarningVisible(true);
      schedulePlanRetry();
    }
    const brandingDetails = branding || deriveBranding(profile || {});
    applyBrandingGate(brandingDetails);
    attachEvents();
    startCustomerFeed(user.uid);
    startOutboundFeed(user.uid);
    debugLog("init end", {
      initGuard: window.__rrAskReviewsInit,
      navNormalized,
      planSource,
      plan,
    });
  });
}

if (shouldInit) {
  document.addEventListener("DOMContentLoaded", () => {
    navNormalized = true;
    safeNormalizeNavLinks();
    setTimeout(safeNormalizeNavLinks, 500);
    initApp();
  });

  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") unsubscribe();
    if (typeof outboundUnsub === "function") outboundUnsub();
    if (planRetryTimer) clearTimeout(planRetryTimer);
  });
}
