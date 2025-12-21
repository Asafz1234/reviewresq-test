import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  functions,
  httpsCallable,
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
const planBadge = document.querySelector("[data-plan-label]");

const bulkSection = document.getElementById("bulkSection");
const bulkForm = document.getElementById("bulkRequestForm");
const bulkCustomerList = document.getElementById("bulkCustomerList");
const bulkGenerateBtn = document.getElementById("generateBulkBtn");
const bulkDownloadBtn = document.getElementById("downloadCsvBtn");
const bulkResults = document.getElementById("bulkResults");
const bulkResultsBody = document.getElementById("bulkResultsBody");

const toastEl = document.getElementById("askToast");

let businessId = null;
let plan = "starter";
let customers = [];
let unsubscribe = null;
let bulkLinks = [];

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
  const q = query(collection(db, "customers"), where("businessId", "==", uid), orderBy("createdAt", "desc"));
  unsubscribe = onSnapshot(q, (snapshot) => {
    customers = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
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
  if (emailSuccessBanner && !emailRequired) emailSuccessBanner.hidden = true;
}

async function handleSingleSubmit(event) {
  event.preventDefault();
  if (!businessId) return;

  const name = singleNameInput?.value.trim();
  const phone = singlePhoneInput?.value.trim();
  const email = singleEmailInput?.value.trim();
  const channel = channelSelect?.value || "link";
  const isEmailChannel = channel === "email";

  if (!name) {
    showToast("Customer name is required", true);
    return;
  }

  if (isEmailChannel && !email) {
    showToast("Email is required for email requests", true);
    return;
  }

  if (emailSuccessBanner) emailSuccessBanner.hidden = true;

  const defaultLabel = generateSingleBtn.textContent;
  generateSingleBtn.disabled = true;
  generateSingleBtn.textContent = isEmailChannel ? "Sending…" : "Generating…";

  try {
    const callable = httpsCallable(functions, "createInviteToken");
    const result = await callable({
      businessId,
      customerName: name,
      phone,
      email,
      channel,
      source: "ask-reviews",
    });
    const portalUrl = result?.data?.portalUrl;
    const inviteToken = result?.data?.inviteToken;
    if (!portalUrl) throw new Error("No portal URL returned");
    if (singleLinkOutput) singleLinkOutput.value = portalUrl;
    if (singleResult) singleResult.hidden = false;
    if (isEmailChannel) {
      const sendCallable = httpsCallable(functions, "sendReviewRequestEmail");
      await sendCallable({
        businessId,
        inviteToken,
        toEmail: email,
        customerName: name,
      });
      if (emailSuccessBanner) emailSuccessBanner.hidden = false;
      showToast("Email sent");
    } else {
      await copyText(portalUrl);
      showToast("Link generated and copied");
    }
  } catch (err) {
    console.error("[ask-reviews] single generate failed", err);
    const configMissing = err?.message?.includes("email_sending_not_configured");
    if (configMissing) {
      showToast("Email sending isn’t configured. Please contact support.", true);
    } else {
      showToast(isEmailChannel ? "Unable to send email" : "Unable to generate link", true);
    }
  } finally {
    generateSingleBtn.disabled = false;
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
    const callable = httpsCallable(functions, "createInviteToken");
    for (const customer of selected) {
      try {
        const result = await callable({
          businessId,
          customerId: customer.id,
          customerName: customer.name,
          phone: customer.phone,
          email: customer.email,
          channel: "link",
          source: "ask-reviews",
        });
        const portalUrl = result?.data?.portalUrl;
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
  channelSelect?.addEventListener("change", updateChannelUi);
  singleForm?.addEventListener("submit", handleSingleSubmit);
  copySingleLinkBtn?.addEventListener("click", handleCopySingle);
  downloadSingleQrBtn?.addEventListener("click", handleSingleQr);
  bulkForm?.addEventListener("submit", handleBulkSubmit);
  bulkDownloadBtn?.addEventListener("click", downloadCsv);
  updateChannelUi();
}

listenForUser(({ user, subscription }) => {
  if (!user) return;
  businessId = user.uid;
  setPlan(subscription?.planId || subscription?.planTier);
  attachEvents();
  startCustomerFeed(user.uid);
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribe === "function") unsubscribe();
});
