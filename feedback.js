import { db, doc, updateDoc } from "./firebase-config.js";
import { onSession, fetchAllReviews, describeReview } from "./dashboard-data.js";
import { currentPlanTier, formatDate } from "./session-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";

const tbody = document.querySelector("[data-feedback-table]");
const modalEl = document.querySelector("[data-feedback-modal]");
const modalController = window.ModalManager?.register(modalEl);
const nameEl = modalEl?.querySelector("[data-feedback-name]");
const contactEl = modalEl?.querySelector("[data-feedback-contact]");
const ratingEl = modalEl?.querySelector("[data-feedback-rating]");
const statusEl = modalEl?.querySelector("[data-feedback-status]");
const messageEl = modalEl?.querySelector("[data-feedback-message]");
const dateEl = modalEl?.querySelector("[data-feedback-date]");
const titleEl = modalEl?.querySelector("[data-feedback-title]");
const copyButton = modalEl?.querySelector("[data-copy-feedback]");
const emailLink = modalEl?.querySelector("[data-email-link]");
const callLink = modalEl?.querySelector("[data-call-link]");
const toggleStatusButton = modalEl?.querySelector("[data-toggle-status]");
const upgradeHint = modalEl?.querySelector("[data-upgrade-hint]");
const advancedArea = modalEl?.querySelector("[data-advanced-reply-area]");
const planBadge = document.querySelector(".topbar-right .badge");
const toastId = "feedback-toast";
const dateFilter = document.querySelector(".filter-row select");
const searchInput = document.querySelector('.filter-row input[type="search"]');

const feedbackCache = new Map();
let currentPlan = normalizePlan(currentPlanTier());
let currentBusinessId = null;
let activeFeedbackId = null;
let allFeedback = [];

function updatePlanUI() {
  if (upgradeHint) {
    upgradeHint.hidden = currentPlan !== "starter";
  }
  if (advancedArea) {
    advancedArea.hidden = currentPlan === "starter";
  }
  if (planBadge) {
    planBadge.textContent = PLAN_LABELS[currentPlan] || PLAN_LABELS.starter;
  }
}

function badgeClass(rating) {
  if (rating >= 4) return "badge badge-success";
  if (rating <= 2) return "badge badge-danger";
  return "badge";
}

function sentimentLabel(rating) {
  if (rating >= 4) return "Positive";
  if (rating <= 2) return "Negative";
  return "Neutral";
}

function displayStatus(status = "open") {
  const normalized = (status || "open").toLowerCase();
  if (["resolved", "closed", "done"].includes(normalized)) return "Resolved";
  if (["pending", "open", "new"].includes(normalized)) return "Pending";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildCopyText(feedback) {
  const lines = [
    `Customer: ${feedback.displayName || "Anonymous"}`,
    `Contact: ${feedback.email || feedback.phone || "—"}`,
    `Rating: ${feedback.rating ? `${feedback.rating} / 5 (${sentimentLabel(feedback.rating)})` : sentimentLabel(feedback.rating || 0)}`,
    `Message: ${feedback.message || "—"}`,
    `Date: ${feedback.createdAt ? formatDate(feedback.createdAt) : "—"}`,
  ];
  return lines.join("\n");
}

async function copyFeedback(feedback) {
  const text = buildCopyText(feedback);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    }
    return true;
  } catch (err) {
    console.error("Copy failed", err);
    return false;
  }
}

function setLinkState(linkEl, href) {
  if (!linkEl) return;
  const isActive = Boolean(href);
  linkEl.dataset.linkHref = href || "";
  if (isActive) {
    linkEl.href = href;
    linkEl.classList.remove("disabled", "btn--disabled");
    linkEl.removeAttribute("disabled");
    linkEl.setAttribute("aria-disabled", "false");
    linkEl.tabIndex = 0;
  } else {
    linkEl.removeAttribute("href");
    linkEl.classList.add("disabled", "btn--disabled");
    linkEl.setAttribute("disabled", "true");
    linkEl.setAttribute("aria-disabled", "true");
    linkEl.tabIndex = -1;
  }
  linkEl.target = "_self";
}

async function updateStatus(feedback, nextStatus) {
  const targets = [doc(db, "feedback", feedback.id)];
  const businessId = feedback.businessId || currentBusinessId;
  if (businessId) {
    targets.push(doc(db, "businessProfiles", businessId, "feedback", feedback.id));
  }

  let updated = false;
  for (const ref of targets) {
    try {
      await updateDoc(ref, { status: nextStatus });
      updated = true;
    } catch (err) {
      console.warn("Failed to update status on", ref.path, err);
    }
  }
  return updated;
}

function showToast(message, isError = false) {
  if (!message) return;
  let toast = document.getElementById(toastId);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = toastId;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");
  clearTimeout(showToast.hideTimer);
  showToast.hideTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 2500);
}

function populateDetails(feedback) {
  if (!modalEl) return;
  const sentiment = sentimentLabel(feedback.rating || 0);
  const ratingText = feedback.rating ? `${sentiment} · ${feedback.rating}★` : sentiment;
  const statusText = displayStatus(feedback.status);
  if (titleEl) titleEl.textContent = `Feedback from ${feedback.displayName || "Anonymous"}`;
  if (nameEl) nameEl.textContent = feedback.displayName || "Anonymous";
  if (contactEl) {
    contactEl.innerHTML = "";
    const pieces = [];
    if (feedback.email) {
      const link = document.createElement("a");
      link.href = `mailto:${encodeURIComponent(feedback.email)}`;
      link.textContent = feedback.email;
      link.target = "_blank";
      link.rel = "noopener";
      pieces.push(link);
    }
    if (feedback.phone) {
      const link = document.createElement("a");
      link.href = `tel:${feedback.phone}`;
      link.textContent = feedback.phone;
      pieces.push(link);
    }
    if (!pieces.length) {
      contactEl.textContent = "—";
    } else {
      pieces.forEach((node, index) => {
        contactEl.appendChild(node);
        if (index < pieces.length - 1) {
          contactEl.appendChild(document.createTextNode(" · "));
        }
      });
    }
  }
  if (ratingEl) {
    ratingEl.textContent = ratingText;
    ratingEl.className = `pill ${feedback.rating >= 4 ? "pill-success" : feedback.rating <= 2 ? "pill-danger" : "pill-muted"}`;
  }
  if (statusEl) {
    statusEl.textContent = statusText;
  }
  if (messageEl) messageEl.textContent = feedback.message || "—";
  if (dateEl) dateEl.textContent = feedback.createdAt ? formatDate(feedback.createdAt) : "—";

  if (copyButton) {
    copyButton.disabled = false;
    copyButton.classList.remove("btn--disabled");
  }

  const mailto = feedback.email
    ? `mailto:${encodeURIComponent(feedback.email)}?subject=${encodeURIComponent("Reply to your recent feedback")}`
    : null;
  if (emailLink) {
    emailLink.dataset.email = feedback.email || "";
  }
  setLinkState(emailLink, mailto);

  const tel = feedback.phone ? `tel:${feedback.phone}` : null;
  if (callLink) {
    callLink.dataset.phone = feedback.phone || "";
  }
  setLinkState(callLink, tel);

  if (toggleStatusButton) {
    const isResolved = displayStatus(feedback.status) === "Resolved";
    toggleStatusButton.textContent = isResolved ? "Mark as pending" : "Mark as resolved";
    toggleStatusButton.dataset.nextStatus = isResolved ? "open" : "resolved";
  }

  if (copyButton) {
    copyButton.onclick = async () => {
      const success = await copyFeedback(feedback);
      showToast(success ? "Feedback details copied" : "We couldn’t copy the details. Please try again.", !success);
    };
  }
}

function openFeedbackDetails(feedbackId) {
  const feedback = feedbackCache.get(feedbackId);
  if (!feedback) {
    showToast("We couldn’t load this feedback. Please try again.", true);
    return;
  }
  activeFeedbackId = feedbackId;
  populateDetails(feedback);
  modalController?.open();
}

function renderFeedback(rows = []) {
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No feedback yet";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const enriched = { ...row, businessId: row.businessId || currentBusinessId };
    feedbackCache.set(enriched.id, enriched);
    const tr = document.createElement("tr");
    const date = enriched.createdAt ? formatDate(enriched.createdAt) : "—";
    tr.innerHTML = `
      <td>${enriched.displayName}</td>
      <td>${enriched.email || enriched.phone || "—"}</td>
      <td><span class="${badgeClass(enriched.rating || 0)}">${sentimentLabel(enriched.rating || 0)}</span></td>
      <td>${enriched.message || "—"}</td>
      <td>${date}</td>
      <td><button class="btn btn-link" type="button" data-feedback-id="${enriched.id}">Reply</button></td>
    `;
    tr.dataset.feedbackId = enriched.id;
    tr.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openFeedbackDetails(enriched.id);
    });
    tr.querySelector("button")?.addEventListener("click", (event) => {
      event.stopPropagation();
      openFeedbackDetails(enriched.id);
    });
    tbody.appendChild(tr);
  });
}

function normalizeCreatedDate(feedback) {
  if (!feedback) return null;
  if (feedback.createdAt instanceof Date) return feedback.createdAt;
  if (typeof feedback.createdAt === "number") return new Date(feedback.createdAt);
  if (feedback.createdAtMs) {
    const asNumber = Number(feedback.createdAtMs);
    if (!Number.isNaN(asNumber)) return new Date(asNumber);
  }
  const parsed = Date.parse(feedback.createdAt);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function applyFilters() {
  let filtered = [...allFeedback];
  const query = (searchInput?.value || "").trim().toLowerCase();
  if (query) {
    filtered = filtered.filter((item) => {
      return (
        (item.displayName || "").toLowerCase().includes(query) ||
        (item.email || "").toLowerCase().includes(query) ||
        (item.phone || "").toLowerCase().includes(query) ||
        (item.message || "").toLowerCase().includes(query)
      );
    });
  }

  const selectedRange = dateFilter?.value || "This month";
  if (selectedRange !== "All time") {
    const today = new Date();
    let startDate = null;
    if (selectedRange === "This month") {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (selectedRange === "Last 30 days") {
      startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    if (startDate) {
      filtered = filtered.filter((item) => {
        const created = normalizeCreatedDate(item);
        if (!created) return true;
        return created >= startDate;
      });
    }
  }

  renderFeedback(filtered);
}

onSession(async ({ user, subscription, profile }) => {
  if (!user) return;
  currentBusinessId = profile?.id || user.uid;
  currentPlan = normalizePlan(subscription?.planId || currentPlanTier());
  updatePlanUI();
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6">Loading...</td></tr>`;
  }
  const reviews = await fetchAllReviews(currentBusinessId || user.uid);
  const feedbackOnly = reviews.filter((r) => r.source !== "google").map(describeReview);
  allFeedback = feedbackOnly;
  applyFilters();
});

if (toggleStatusButton) {
  toggleStatusButton.addEventListener("click", async () => {
    const activeFeedback = activeFeedbackId ? feedbackCache.get(activeFeedbackId) : null;
    if (!activeFeedback) {
      showToast("We couldn’t load this feedback. Please try again.", true);
      return;
    }
    const nextStatus = toggleStatusButton.dataset.nextStatus || "resolved";
    toggleStatusButton.disabled = true;
    const success = await updateStatus(activeFeedback, nextStatus);
    toggleStatusButton.disabled = false;
    if (success) {
      activeFeedback.status = nextStatus;
      feedbackCache.set(activeFeedback.id, activeFeedback);
      populateDetails(activeFeedback);
      showToast(`Marked as ${displayStatus(nextStatus).toLowerCase()}.`);
    } else {
      showToast("We couldn’t update the status. Please try again.", true);
    }
  });
}

if (emailLink) {
  emailLink.addEventListener("click", (event) => {
    const href = emailLink.dataset.linkHref;
    if (!href) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    window.location.href = href;
  });
}

if (callLink) {
  callLink.addEventListener("click", (event) => {
    const href = callLink.dataset.linkHref;
    if (!href) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    window.location.href = href;
  });
}

if (dateFilter) {
  dateFilter.addEventListener("change", applyFilters);
}

if (searchInput) {
  searchInput.addEventListener("input", applyFilters);
}
