// dashboard-advanced.js (fixed & hardened)

import {
  auth,
  onAuthStateChanged,
  signOut,
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  limit,
  serverTimestamp,
} from "./firebase.js";

// ---------- DOM ELEMENTS ----------

// Top / global
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");
const planBadge = document.getElementById("planBadge");
const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizCategoryText = document.getElementById("bizCategoryText");
const bizUpdatedAt = document.getElementById("bizUpdatedAt");
const bizAvatar = document.getElementById("bizAvatar");
const dateRangeSelect = document.getElementById("dateRangeSelect");
const globalBanner = document.getElementById("globalBanner");
const globalBannerText = document.getElementById("globalBannerText");
const bannerDismiss = document.getElementById("bannerDismiss");
const navButtons = document.querySelectorAll(".nav-link[data-target]");
const navTriggers = document.querySelectorAll("[data-target]");
const mobileMoreBtn = document.getElementById("mobileMoreBtn");
const mobileMoreSheet = document.getElementById("mobileMoreSheet");
const mobileSheetClose = document.getElementById("mobileSheetClose");
const insightsUpdated = document.getElementById("insightsUpdated");

// כל הסקשנים – לטאבים
const sections = document.querySelectorAll(".section");

// KPIs + charts
const kpiPublicReviews = document.getElementById("kpiPublicReviews");
const kpiAvgRating = document.getElementById("kpiAvgRating");
const kpiLowRating = document.getElementById("kpiLowRating");
const kpiHighRating = document.getElementById("kpiHighRating");
const kpiGoogleTagged = document.getElementById("kpiGoogleTagged");
const kpiSentiment = document.getElementById("kpiSentiment");
const kpiSavedPositives = document.getElementById("kpiSavedPositives");
const kpiPreventedNegatives = document.getElementById("kpiPreventedNegatives");
const kpiPrivateFeedback = document.getElementById("kpiPrivateFeedback");
const kpiConversionRate = document.getElementById("kpiConversionRate");
const trendChart = document.getElementById("trendChart");
const ratingDistribution = document.getElementById("ratingDistribution");

// AI insights
const aiSummary = document.getElementById("aiSummary");
const aiThemes = document.getElementById("aiThemes");
const aiRecommendations = document.getElementById("aiRecommendations");
const aiSentiment = document.getElementById("aiSentiment");
const refreshInsightsBtn = document.getElementById("refreshInsightsBtn");
const refreshInsightsSecondary = document.getElementById(
  "refreshInsightsSecondary"
);
const askReviewsBtn = document.getElementById("askReviewsBtn");

// Feedback inbox
const advancedFeedbackBody = document.getElementById("advancedFeedbackBody");
const advancedFeedbackEmpty = document.getElementById("advancedFeedbackEmpty");
const filterRating = document.getElementById("filterRating");
const filterType = document.getElementById("filterType");
const filterStatus = document.getElementById("filterStatus");
const feedbackModal = document.getElementById("feedbackModal");
const feedbackModalClose = document.getElementById("feedbackModalClose");
const modalDate = document.getElementById("modalDate");
const modalCustomer = document.getElementById("modalCustomer");
const modalRating = document.getElementById("modalRating");
const modalType = document.getElementById("modalType");
const modalMessage = document.getElementById("modalMessage");
const modalAiReply = document.getElementById("modalAiReply");
const modalNextAction = document.getElementById("modalNextAction");
const copyReplyBtn = document.getElementById("copyReplyBtn");
const createTaskBtn = document.getElementById("createTaskBtn");
const markRepliedBtn = document.getElementById("markRepliedBtn");

// Automations
const automationList = document.getElementById("automationList");
const automationForm = document.getElementById("automationForm");
const automationId = document.getElementById("automationId");
const automationTrigger = document.getElementById("automationTrigger");
const automationChannel = document.getElementById("automationChannel");
const automationDelay = document.getElementById("automationDelay");
const automationNoResponseDays = document.getElementById(
  "automationNoResponseDays"
);
const automationTemplate = document.getElementById("automationTemplate");
const automationPreview = document.getElementById("automationPreview");
const automationCancel = document.getElementById("automationCancel");
const automationDelete = document.getElementById("automationDelete");

// Tasks
const tasksList = document.getElementById("tasksList");
const taskDetail = document.getElementById("taskDetail");
const taskStatusFilter = document.getElementById("taskStatusFilter");
const taskPriorityFilter = document.getElementById("taskPriorityFilter");

// Notifications
const notificationForm = document.getElementById("notificationForm");
const prefEmailLow = document.getElementById("prefEmailLow");
const prefEmailHigh = document.getElementById("prefEmailHigh");
const prefEmailGoogle = document.getElementById("prefEmailGoogle");
const prefDaily = document.getElementById("prefDaily");
const prefWeekly = document.getElementById("prefWeekly");
const prefSmsLow = document.getElementById("prefSmsLow");
const prefSmsHigh = document.getElementById("prefSmsHigh");

// Review requests
const reviewRequestForm = document.getElementById("reviewRequestForm");
const reqName = document.getElementById("reqName");
const reqPhone = document.getElementById("reqPhone");
const reqEmail = document.getElementById("reqEmail");
const reqChannel = document.getElementById("reqChannel");
const reviewRequestsBody = document.getElementById("reviewRequestsBody");

// Portal customize
const portalSettingsForm = document.getElementById("portalSettingsForm");
const portalPrimary = document.getElementById("portalPrimary");
const portalAccent = document.getElementById("portalAccent");
const portalBackground = document.getElementById("portalBackground");
const portalHeadline = document.getElementById("portalHeadline");
const portalSubheadline = document.getElementById("portalSubheadline");
const portalCtaHigh = document.getElementById("portalCtaHigh");
const portalCtaLow = document.getElementById("portalCtaLow");
const portalThanksTitle = document.getElementById("portalThanksTitle");
const portalThanksBody = document.getElementById("portalThanksBody");
const portalPreviewFrame = document.getElementById("portalPreviewFrame");

// ---------- STATE ----------
let currentUser = null;
let currentProfile = null;
let feedbackCache = [];
let automationCache = [];
let taskCache = [];
let currentModalFeedback = null;

// ---------- AI SERVICE (heuristic, ללא API חיצוני) ----------
const AIService = {
  async generateInsights(feedbackList) {
    const themesMap = new Map();
    let sentimentTotal = 0;
    let positives = 0;
    let negatives = 0;

    const keywords = [
      { label: "price", tokens: ["price", "expensive", "cheap", "cost"] },
      { label: "speed", tokens: ["wait", "slow", "fast", "delay", "time"] },
      { label: "staff", tokens: ["staff", "team", "employee", "support", "service"] },
      { label: "quality", tokens: ["quality", "excellent", "poor", "bad", "amazing"] },
      { label: "cleanliness", tokens: ["clean", "dirty", "mess"] },
      { label: "booking", tokens: ["book", "schedule", "appointment"] },
    ];

    feedbackList.forEach((fb) => {
      const message = (fb.message || "").toLowerCase();
      const rating = Number(fb.rating || 0);

      sentimentTotal += sentimentFromRating(rating);
      if (rating >= 4) positives += 1;
      if (rating <= 2) negatives += 1;

      const matched = [];
      keywords.forEach((k) => {
        if (k.tokens.some((t) => message.includes(t))) matched.push(k.label);
      });
      if (!matched.length) matched.push("general experience");
      matched.forEach((m) => themesMap.set(m, (themesMap.get(m) || 0) + 1));
    });

    const topThemes = Array.from(themesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    const sentimentScore = feedbackList.length
      ? Number((sentimentTotal / feedbackList.length).toFixed(2))
      : 0;

    const summaryParts = [];
    if (feedbackList.length) {
      summaryParts.push(
        `You received ${feedbackList.length} feedback items recently (${positives} positive, ${negatives} negative).`
      );
      if (topThemes.length) {
        summaryParts.push(`Top themes: ${topThemes.map((t) => t.label).join(", ")}.`);
      }
      summaryParts.push(
        sentimentScore >= 0.2
          ? "Overall sentiment is trending positive—keep reinforcing what people praise."
          : sentimentScore <= -0.2
          ? "Sentiment is dipping—prioritize outreach to unhappy customers."
          : "Sentiment is mixed—stay close to customers and close the loop quickly."
      );
    } else {
      summaryParts.push("Not enough feedback yet for insights.");
    }

    const recommendations = [];
    if (negatives) recommendations.push("Call low-rating customers within 24h and acknowledge their issues.");
    if (positives) recommendations.push("Invite happy customers to leave a Google review using your portal link.");
    if (topThemes.some((t) => t.label === "speed")) recommendations.push("Audit wait times and set clear SLAs.");
    if (topThemes.some((t) => t.label === "staff")) {
      recommendations.push("Celebrate staff shout-outs publicly and coach where service dipped.");
    }
    if (!recommendations.length) {
      recommendations.push("Collect more feedback to unlock tailored actions.");
    }

    return {
      summary: summaryParts.join(" "),
      topThemes,
      sentimentScore,
      topRecommendations: recommendations.slice(0, 5),
    };
  },

  async suggestReply(feedback) {
    const name = feedback.customerName || "there";
    const rating = Number(feedback.rating || 0);
    const keywords = keywordsForFeedback(feedback.message || "").join(", ");

    if (rating <= 3) {
      return `Hi ${name}, I'm sorry we fell short. I hear your concerns about ${keywords}. I'd love to fix this—please reply or call me directly so we can make it right.`;
    }

    return `Hi ${name}, thank you for the ${rating}★ feedback! Your notes about ${keywords} made our day. We’d appreciate a Google review and look forward to welcoming you back.`;
  },

  async suggestNextAction(feedback) {
    const rating = Number(feedback.rating || 0);
    const tags = keywordsForFeedback(feedback.message || "");

    if (rating <= 2) {
      return "Call the customer within 24h, acknowledge the issue, and offer a make-good (credit or priority booking).";
    }
    if (rating === 3) {
      return "Send a quick check-in email to learn what would turn this into a 5★ experience and schedule a follow-up.";
    }
    if (tags.includes("staff")) {
      return "Share praise with the team member mentioned and invite the customer back to meet them again.";
    }
    return "Thank them personally and invite them to share the story on Google—include your portal link.";
  },
};

// ---------- HELPERS ----------

function showBanner(text, type = "info") {
  if (!globalBanner || !globalBannerText) return;
  globalBannerText.textContent = text;
  globalBanner.className = `global-banner visible ${type}`;
}

function hideBanner() {
  if (!globalBanner || !globalBannerText) return;
  globalBanner.className = "global-banner";
  globalBannerText.textContent = "";
}

if (bannerDismiss) bannerDismiss.onclick = hideBanner;

function initialsFromName(name = "") {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "RR";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function formatDate(ts) {
  if (!ts) return "–";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateKey(ts) {
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}

function formatRating(rating) {
  return rating ? `${rating}★` : "–";
}

function sentimentFromRating(rating) {
  if (!rating) return 0;
  if (rating <= 2) return -0.7;
  if (rating === 3) return 0;
  return rating >= 5 ? 1 : 0.6;
}

function keywordsForFeedback(message = "") {
  const lower = message.toLowerCase();
  const tags = [];
  const themes = [
    { key: "price", words: ["price", "expensive", "cheap", "cost"] },
    { key: "speed", words: ["wait", "slow", "fast", "delay", "time"] },
    { key: "staff", words: ["staff", "service", "team", "employee", "support"] },
    { key: "quality", words: ["quality", "excellent", "poor", "bad", "amazing"] },
    { key: "clean", words: ["clean", "dirty", "mess"] },
    { key: "booking", words: ["book", "schedule", "appointment"] },
  ];

  themes.forEach((t) => {
    if (t.words.some((w) => lower.includes(w))) tags.push(t.key);
  });

  if (!tags.length) tags.push("general");
  return tags;
}

// ---------- NAVIGATION (tabs behavior) ----------

function showSection(targetKey) {
  const targetId = `section-${targetKey}`;
  sections.forEach((sec) => {
    if (sec.id === targetId) {
      sec.classList.remove("section-hidden");
    } else {
      sec.classList.add("section-hidden");
    }
  });
}

function setActiveNav(targetKey) {
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === targetKey);
  });
}

function closeMobileSheet() {
  if (mobileMoreSheet) {
    mobileMoreSheet.classList.remove("open");
    mobileMoreSheet.setAttribute("aria-hidden", "true");
  }
}

function navigateTo(targetKey) {
  if (!targetKey) return;
  setActiveNav(targetKey);
  showSection(targetKey);
  closeMobileSheet();
}

navTriggers.forEach((trigger) => {
  trigger.addEventListener("click", () => navigateTo(trigger.dataset.target));
});

if (mobileMoreBtn && mobileMoreSheet) {
  mobileMoreBtn.addEventListener("click", () => {
    mobileMoreSheet.classList.add("open");
    mobileMoreSheet.setAttribute("aria-hidden", "false");
  });
}

if (mobileMoreSheet) {
  mobileMoreSheet.addEventListener("click", (event) => {
    if (event.target === mobileMoreSheet) closeMobileSheet();
  });
}

if (mobileSheetClose) {
  mobileSheetClose.addEventListener("click", closeMobileSheet);
}

// מצב התחלתי – רק Overview
navigateTo("overview");

// ---------- AUTH & INITIAL LOAD ----------

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      window.location.href = "/auth.html";
      return;
    }

    currentUser = user;

    if (userEmailDisplay) userEmailDisplay.textContent = user.email || "My account";

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = "/auth.html";
      });
    }

    const canContinue = await loadProfile();
    if (!canContinue) return;

    await loadAutomations();
    await loadFeedback();
    updatePortalPreviewSrc();

    await Promise.all([
      loadTasks(),
      loadNotifications(),
      loadReviewRequests(),
      loadAiInsights(),
      loadPortalSettings(),
    ]);
  } catch (err) {
    console.error("Advanced dashboard init error:", err);
    showBanner("We had trouble loading your Advanced dashboard.", "warn");
  }
});

async function loadProfile() {
  try {
    if (!currentUser) return false;
    const ref = doc(db, "businessProfiles", currentUser.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      showBanner("Finish onboarding to access the Advanced dashboard.", "warn");
      setTimeout(() => (window.location.href = "/onboarding.html"), 1500);
      return false;
    }

    const data = snap.data();

    if (data.plan !== "advanced") {
      showBanner("Advanced features require the Advanced plan. Redirecting to Basic view…", "warn");
      window.location.href = "/dashboard.html";
      return false;
    }

    currentProfile = data;

    if (bizNameDisplay) bizNameDisplay.textContent = data.businessName || "Your business";
    if (bizCategoryText) bizCategoryText.textContent = data.category || "Category";
    if (bizUpdatedAt) bizUpdatedAt.textContent = formatDate(data.updatedAt);
    if (bizAvatar) bizAvatar.textContent = initialsFromName(data.businessName || "RR");
    if (planBadge) planBadge.textContent = "Advanced plan";

    return true;
  } catch (err) {
    console.error("loadProfile error:", err);
    showBanner("Could not load your profile.", "warn");
    return false;
  }
}

// ---------- FEEDBACK + KPIs ----------

function filterFeedbackByRange(rangeValue) {
  if (rangeValue === "all") return feedbackCache;
  const days = Number(rangeValue) || 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return feedbackCache.filter((f) => {
    const created = f.createdAt?.toMillis
      ? f.createdAt.toMillis()
      : new Date(f.createdAt).getTime();
    return created >= cutoff;
  });
}

async function loadFeedback() {
  try {
    if (!currentUser) return;
    const ref = collection(db, "feedback");
    const q = query(
      ref,
      where("businessId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);

    feedbackCache = snap.docs.map((d) => ({
      id: d.id,
      status: "new",
      ...d.data(),
      statusOverride: d.data().status,
    }));

    feedbackCache = feedbackCache.map((f) => ({
      ...f,
      status: f.statusOverride || f.status || "new",
    }));

    renderFeedback();
    evaluateAutomations(feedbackCache);
    updateKPIs();
  } catch (err) {
    console.error("loadFeedback error:", err);
    showBanner("Could not load feedback.", "warn");
  }
}

function getFilteredFeedback() {
  const byRange = filterFeedbackByRange(dateRangeSelect?.value || "7");
  return byRange.filter((f) => {
    const ratingOk =
      !filterRating ||
      filterRating.value === "all" ||
      Number(filterRating.value) === Number(f.rating);
    const typeOk =
      !filterType ||
      filterType.value === "all" ||
      (f.type || "private").toLowerCase() === filterType.value;
    const statusOk =
      !filterStatus ||
      filterStatus.value === "all" ||
      (f.status || "new") === filterStatus.value;
    return ratingOk && typeOk && statusOk;
  });
}

function renderFeedback() {
  if (!advancedFeedbackBody || !advancedFeedbackEmpty) return;

  advancedFeedbackBody.innerHTML = "";
  const filtered = getFilteredFeedback();

  if (!filtered.length) {
    advancedFeedbackEmpty.style.display = "block";
    return;
  }

  advancedFeedbackEmpty.style.display = "none";

  filtered.forEach((f) => {
    const tr = document.createElement("tr");
    const statusLabel = (f.status || "new").replace("_", " ");

    const rating = Number(f.rating || 0);
    const ratingClass = rating >= 4 ? "rating-high" : "rating-low";

    tr.innerHTML = `
      <td>${formatDate(f.createdAt)}</td>
      <td>${f.customerName || "Customer"}</td>
      <td><span class="rating-pill ${ratingClass}">${formatRating(
        f.rating
      )}</span></td>
      <td>${f.type || "private"}</td>
      <td>${(f.message || "").slice(0, 80)}${(f.message || "").length > 80 ? "…" : ""}</td>
      <td><span class="status-chip status-${f.status || "new"}">${statusLabel}</span></td>
      <td class="actions-cell">
        <button class="btn ghost" data-action="reply" data-id="${f.id}">Open</button>
        <button class="btn ghost" data-action="markFollow" data-id="${f.id}">Follow-up</button>
      </td>
    `;

    tr.querySelector('[data-action="reply"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      openFeedbackModal(f);
    });

    tr.querySelector('[data-action="markFollow"]')?.addEventListener("click", async (e) => {
      e.stopPropagation();
      await updateFeedbackStatus(f.id, "followup");
      await loadTasks();
      renderFeedback();
    });

    tr.addEventListener("click", () => openFeedbackModal(f));
    advancedFeedbackBody.appendChild(tr);
  });
}

async function updateFeedbackStatus(id, status) {
  try {
    await updateDoc(doc(db, "feedback", id), { status, updatedAt: serverTimestamp() });
    feedbackCache = feedbackCache.map((f) => (f.id === id ? { ...f, status } : f));
  } catch (err) {
    console.error("updateFeedbackStatus error:", err);
  }
}

function updateKPIs() {
  const filtered = filterFeedbackByRange(dateRangeSelect?.value || "7");
  let publicCount = 0;
  let lowCount = 0;
  let highCount = 0;
  let googleCount = 0;
  let ratingSum = 0;
  let sentimentTotal = 0;
  let savedPositives = 0;
  let preventedNegatives = 0;
  let privateFeedbackCount = 0;
  let googleHigh = 0;
  let happyViaPortal = 0;
  const trendMap = new Map();
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  filtered.forEach((f) => {
    const rating = Number(f.rating || 0);
    const type = (f.type || "private").toLowerCase();

    if (type !== "google") {
      privateFeedbackCount += 1;
    }

    if (rating >= 4 && type !== "google") {
      savedPositives += 1;
      happyViaPortal += 1;
    }

    if (rating > 0 && rating <= 3 && type !== "google") {
      preventedNegatives += 1;
    }

    if (type === "google" && rating >= 4) {
      googleHigh += 1;
    }
    if (rating) distribution[rating] = (distribution[rating] || 0) + 1;
    ratingSum += rating;
    sentimentTotal += sentimentFromRating(rating);

    if (rating >= 4) {
      publicCount += 1;
      highCount += 1;
    } else if (rating <= 3) {
      lowCount += 1;
    }

    if (type === "google") googleCount += 1;

    const key = formatDateKey(f.createdAt);
    trendMap.set(key, (trendMap.get(key) || 0) + 1);
  });

  const avgRating = filtered.length ? (ratingSum / filtered.length).toFixed(2) : "–";
  const avgSentiment = filtered.length ? (sentimentTotal / filtered.length).toFixed(2) : "–";
  const totalHappy = happyViaPortal + googleHigh;
  let conversionRateText = "–";
  if (totalHappy > 0) {
    const conversionPercent = Math.round((googleHigh / totalHappy) * 100);
    conversionRateText = `${conversionPercent}%`;
  }

  if (kpiPublicReviews) kpiPublicReviews.textContent = String(publicCount);
  if (kpiAvgRating) kpiAvgRating.textContent = avgRating;
  if (kpiLowRating) kpiLowRating.textContent = String(lowCount);
  if (kpiHighRating) kpiHighRating.textContent = String(highCount);
  if (kpiGoogleTagged) kpiGoogleTagged.textContent = String(googleCount);
  if (kpiSentiment) kpiSentiment.textContent = avgSentiment;
  if (kpiSavedPositives) kpiSavedPositives.textContent = String(savedPositives);
  if (kpiPreventedNegatives)
    kpiPreventedNegatives.textContent = String(preventedNegatives);
  if (kpiPrivateFeedback) kpiPrivateFeedback.textContent = String(privateFeedbackCount);
  if (kpiConversionRate) kpiConversionRate.textContent = conversionRateText;

  renderTrendChart(trendMap);
  renderDistribution(distribution, filtered.length || 1);
}

function renderTrendChart(trendMap) {
  if (!trendChart) return;
  const card = trendChart.closest(".chart-card") || trendChart.parentElement;
  let messageEl = card?.querySelector(".chart-empty");
  if (!messageEl && card) {
    messageEl = document.createElement("div");
    messageEl.className = "chart-empty";
    card.appendChild(messageEl);
  }
  if (messageEl) {
    messageEl.textContent = "";
    messageEl.style.display = "none";
  }

  const trendTable = document.getElementById("trendTable");
  if (trendTable) trendTable.innerHTML = "";

  const ctx = trendChart.getContext("2d");
  if (!ctx) return;

  const entries = Array.from(trendMap.entries()).sort((a, b) =>
    a[0] > b[0] ? 1 : -1
  );
  const values = entries.map((e) => e[1]);
  const max = Math.max(...values, 5);

  const width = trendChart.width || trendChart.clientWidth;
  const height = trendChart.height || trendChart.clientHeight;
  ctx.clearRect(0, 0, width, height);
  if (trendTable) {
    const tableEntries = entries
      .slice()
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 5);

    if (!tableEntries.length) {
      trendTable.innerHTML = `<div class="trend-row"><span>No reviews yet</span><span class="count">–</span></div>`;
    } else {
      const rows = tableEntries
        .map(([date, count]) => {
          const label = new Date(`${date}T00:00:00`);
          const formatted = label.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
          return `<div class="trend-row"><span>${formatted}</span><span class="count">${count}</span></div>`;
        })
        .join("");
      trendTable.innerHTML = rows;
    }
  }

  if (!entries.length) {
    if (messageEl) {
      messageEl.textContent = "No reviews yet in this date range.";
      messageEl.style.display = "flex";
    }
    return;
  }

  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  ctx.strokeStyle = "rgba(124, 58, 237, 0.7)";
  ctx.lineWidth = 2;
  if (values.length > 1) {
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * stepX;
      const y = height - (v / max) * (height - 30) - 10;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  values.forEach((v, i) => {
    const x = values.length === 1 ? width / 2 : i * stepX;
    const y = height - (v / max) * (height - 30) - 10;
    ctx.fillStyle = "#c4b5fd";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  if (values.length === 1 && messageEl) {
    const [singleDate, singleCount] = entries[0];
    const labelDate = new Date(`${singleDate}T00:00:00`);
    const formatted = labelDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    messageEl.textContent = `${singleCount} review${singleCount === 1 ? "" : "s"} on ${formatted}`;
    messageEl.style.display = "flex";
  }
}

function renderDistribution(dist, total) {
  if (!ratingDistribution) return;
  ratingDistribution.innerHTML = "";

  Object.keys(dist)
    .sort((a, b) => Number(b) - Number(a))
    .forEach((rating) => {
      const count = dist[rating];
      const percent = Math.round((count / total) * 100) || 0;
      const row = document.createElement("div");
      row.className = "rating-bar";
      row.innerHTML = `
        <span class="label">${rating}★</span>
        <div class="bar"><span class="fill" style="width:${percent}%"></span></div>
        <span class="label">${percent}%</span>
      `;
      ratingDistribution.appendChild(row);
    });
}

// ---------- AI INSIGHTS ----------

async function loadAiInsights() {
  try {
    if (!currentUser) return;
    const ref = doc(db, "aiInsights", currentUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      renderInsights(snap.data());
    } else {
      await refreshInsights();
    }
  } catch (err) {
    console.error("loadAiInsights error:", err);
  }
}

async function refreshInsights() {
  try {
    const feedbackSample = feedbackCache.slice(0, 100);
    const insights = await AIService.generateInsights(feedbackSample);
    const payload = {
      businessId: currentUser.uid,
      generatedAt: serverTimestamp(),
      ...insights,
    };
    await setDoc(doc(db, "aiInsights", currentUser.uid), payload, { merge: true });
    renderInsights({ ...insights, generatedAt: new Date() });
    console.log("AI insights refreshed (heuristic)", payload);
  } catch (err) {
    console.error("refreshInsights error:", err);
    showBanner("Could not refresh insights.", "warn");
  }
}

function renderInsights(data) {
  if (aiSummary) aiSummary.textContent = data.summary || "Not enough data yet.";

  if (aiThemes) {
    aiThemes.innerHTML = "";
    (data.topThemes || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = `${t.label} (${t.count})`;
      aiThemes.appendChild(li);
    });
  }

  if (aiRecommendations) {
    aiRecommendations.innerHTML = "";
    (data.topRecommendations || []).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      aiRecommendations.appendChild(li);
    });
  }

  if (aiSentiment) {
    aiSentiment.textContent =
      data.sentimentScore != null ? data.sentimentScore : "–";
  }

  if (data.generatedAt && insightsUpdated) {
    const d = data.generatedAt.toDate
      ? data.generatedAt.toDate()
      : new Date(data.generatedAt);
    insightsUpdated.textContent = `Last updated ${d.toLocaleString()}`;
  }
}

// ---------- FEEDBACK MODAL ----------

async function openFeedbackModal(feedback) {
  if (!feedbackModal) return;

  currentModalFeedback = feedback;

  if (modalDate) modalDate.textContent = formatDate(feedback.createdAt);
  if (modalCustomer) modalCustomer.textContent = feedback.customerName || "Customer";
  if (modalRating) modalRating.textContent = formatRating(feedback.rating);
  if (modalType) modalType.textContent = feedback.type || "private";
  if (modalMessage) modalMessage.textContent = feedback.message || "—";

  if (modalAiReply)
    modalAiReply.value = await AIService.suggestReply(feedback);
  if (modalNextAction)
    modalNextAction.textContent = await AIService.suggestNextAction(feedback);

  feedbackModal.classList.add("visible");
  feedbackModal.setAttribute("aria-hidden", "false");

  if (feedback.status === "new") {
    await updateFeedbackStatus(feedback.id, "needs_reply");
    renderFeedback();
  }
}

function closeFeedbackModal() {
  if (!feedbackModal) return;
  feedbackModal.classList.remove("visible");
  feedbackModal.setAttribute("aria-hidden", "true");
}

feedbackModalClose?.addEventListener("click", closeFeedbackModal);
feedbackModal?.addEventListener("click", (e) => {
  if (e.target === feedbackModal) closeFeedbackModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFeedbackModal();
});

copyReplyBtn?.addEventListener("click", async () => {
  if (!modalAiReply?.value) return;
  try {
    await navigator.clipboard.writeText(modalAiReply.value);
    copyReplyBtn.textContent = "Copied";
    setTimeout(() => (copyReplyBtn.textContent = "Copy reply"), 1200);
  } catch (err) {
    alert("Could not copy reply");
  }
});

markRepliedBtn?.addEventListener("click", async () => {
  if (!currentModalFeedback) return;
  await updateFeedbackStatus(currentModalFeedback.id, "replied");
  renderFeedback();
  closeFeedbackModal();
});

createTaskBtn?.addEventListener("click", async () => {
  if (!currentModalFeedback || !currentUser) return;
  const f = currentModalFeedback;
  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  try {
    await addDoc(collection(db, "tasks"), {
      businessId: currentUser.uid,
      feedbackId: f.id,
      title: `Follow up with ${f.customerName || "customer"} (${f.rating}★)`,
      description: f.message || "",
      status: "open",
      assignee: null,
      priority: f.rating <= 2 ? "high" : "medium",
      dueDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateFeedbackStatus(f.id, "followup");
    await loadTasks();
    closeFeedbackModal();
    console.log("Created follow-up task from feedback", f.id);
  } catch (err) {
    console.error("createTask error:", err);
  }
});

// Filters
dateRangeSelect?.addEventListener("change", () => {
  renderFeedback();
  updateKPIs();
});

[filterRating, filterType, filterStatus].forEach((el) => {
  el?.addEventListener("change", renderFeedback);
});

// ---------- PORTAL CUSTOMIZE ----------

portalSettingsForm?.addEventListener("input", applyPortalPreviewStyling);
portalPreviewFrame?.addEventListener("load", applyPortalPreviewStyling);

portalSettingsForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const payload = {
    businessId: currentUser.uid,
    primaryColor: portalPrimary?.value,
    accentColor: portalAccent?.value,
    backgroundStyle: portalBackground?.value,
    headline: portalHeadline?.value,
    subheadline: portalSubheadline?.value,
    ctaLabelHighRating: portalCtaHigh?.value,
    ctaLabelLowRating: portalCtaLow?.value,
    thankYouTitle: portalThanksTitle?.value,
    thankYouBody: portalThanksBody?.value,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "portalSettings", currentUser.uid), payload, {
      merge: true,
    });
    applyPortalPreviewStyling();
    showBanner("Portal settings saved", "success");
  } catch (err) {
    console.error("save portal settings error:", err);
    showBanner("Could not save portal settings.", "warn");
  }
});

function fillTemplate(template, sample) {
  return (template || "")
    .replace(/{{customerName}}/g, sample.customerName)
    .replace(/{{businessName}}/g, sample.businessName)
    .replace(/{{rating}}/g, sample.rating)
    .replace(/{{feedbackSnippet}}/g, sample.feedbackSnippet)
    .replace(/{{ownerName}}/g, sample.ownerName);
}

function automationPreviewText(templateOverride) {
  const sample = {
    customerName: "Alex",
    businessName: currentProfile?.businessName || "Your business",
    rating: 5,
    feedbackSnippet: "Loved the service!",
    ownerName: currentProfile?.ownerName || "Team",
  };
  return fillTemplate(templateOverride ?? automationTemplate?.value, sample);
}

automationTemplate?.addEventListener("input", () => {
  if (automationPreview) automationPreview.textContent = automationPreviewText();
});

automationCancel?.addEventListener("click", () => {
  automationForm?.reset();
  if (automationId) automationId.value = "";
  if (automationPreview)
    automationPreview.textContent = "Preview will appear here.";
});

// ---------- AUTOMATIONS ----------

automationDelete?.addEventListener("click", async () => {
  if (!automationId?.value || !currentUser) return;
  try {
    await updateDoc(doc(db, "automations", automationId.value), {
      deleted: true,
      enabled: false,
      updatedAt: serverTimestamp(),
    });
    automationForm?.reset();
    automationId.value = "";
    await loadAutomations();
  } catch (err) {
    console.error("automationDelete error:", err);
  }
});

automationForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const payload = {
    businessId: currentUser.uid,
    type: automationChannel?.value,
    trigger: automationTrigger?.value,
    delayHours: automationDelay?.value ? Number(automationDelay.value) : null,
    minRating: automationTrigger?.value === "low_rating" ? 1 : null,
    maxRating: automationTrigger?.value === "low_rating" ? 3 : null,
    enabled: true,
    template: automationTemplate?.value,
    channelConfig: {},
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    noResponseDays: automationNoResponseDays?.value
      ? Number(automationNoResponseDays.value)
      : null,
  };

  try {
    if (automationId?.value) {
      await updateDoc(doc(db, "automations", automationId.value), payload);
    } else {
      await addDoc(collection(db, "automations"), payload);
    }
    automationForm?.reset();
    if (automationId) automationId.value = "";
    await loadAutomations();
  } catch (err) {
    console.error("save automation error:", err);
  }
});

async function loadAutomations() {
  if (!automationList || !currentUser) return;
  try {
    const qObj = query(
      collection(db, "automations"),
      where("businessId", "==", currentUser.uid)
    );
    const snap = await getDocs(qObj);
    automationCache = snap.docs
      .filter((d) => !d.data().deleted)
      .map((d) => ({ id: d.id, ...d.data() }));
    renderAutomations();
  } catch (err) {
    console.error("loadAutomations error:", err);
  }
}

function describeTrigger(auto) {
  switch (auto.trigger) {
    case "low_rating":
      return "Low rating (1–3★)";
    case "high_rating":
      return "High rating (4–5★)";
    case "new_google_review":
      return "New Google review";
    case "no_response_x_days":
      return `No follow-up after ${auto.noResponseDays || 3} days`;
    default:
      return auto.trigger;
  }
}

function renderAutomations() {
  if (!automationList) return;

  automationList.innerHTML = "";

  if (!automationCache.length) {
    automationList.textContent =
      "No automations yet. Create one to respond automatically.";
    return;
  }

  automationCache.forEach((auto) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <div class="title">${describeTrigger(auto)} → ${auto.type.toUpperCase()}</div>
      <div class="meta">${(auto.template || "").split("\n")[0]}</div>
      <div class="meta">${auto.enabled ? "On" : "Off"} · Updated ${formatDate(
      auto.updatedAt
    )}</div>
    `;

    div.addEventListener("click", () => {
      if (!automationId) return;
      automationId.value = auto.id;
      if (automationTrigger) automationTrigger.value = auto.trigger;
      if (automationChannel) automationChannel.value = auto.type;
      if (automationDelay) automationDelay.value = auto.delayHours || "";
      if (automationNoResponseDays)
        automationNoResponseDays.value = auto.noResponseDays || "";
      if (automationTemplate) automationTemplate.value = auto.template || "";
      if (automationPreview)
        automationPreview.textContent = automationPreviewText();
    });

    const toggle = document.createElement("button");
    toggle.className = "btn ghost";
    toggle.textContent = auto.enabled ? "Disable" : "Enable";
    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await updateDoc(doc(db, "automations", auto.id), {
          enabled: !auto.enabled,
          updatedAt: serverTimestamp(),
        });
        await loadAutomations();
      } catch (err) {
        console.error("toggle automation error:", err);
      }
    });

    div.appendChild(toggle);
    automationList.appendChild(div);
  });
}

function evaluateAutomations(feedbackList) {
  feedbackList.forEach((f) => {
    automationCache.forEach(async (auto) => {
      if (!auto.enabled) return;
      const rating = Number(f.rating || 0);
      const type = (f.type || "").toLowerCase();
      let shouldFire = false;

      if (auto.trigger === "low_rating" && rating <= 3) shouldFire = true;
      if (auto.trigger === "high_rating" && rating >= 4) shouldFire = true;
      if (auto.trigger === "new_google_review" && type === "google") shouldFire = true;
      if (auto.trigger === "no_response_x_days" && auto.noResponseDays) {
        shouldFire = rating <= 3;
      }

      if (shouldFire) {
        const delayText = auto.delayHours ? `after ${auto.delayHours}h` : "immediately";
        console.log(
          `Would send ${auto.type} ${delayText} for feedback ${f.id}:`,
          automationPreviewText(auto.template)
        );

        if (auto.type === "internal_task") {
          try {
            await addDoc(collection(db, "tasks"), {
              businessId: currentUser.uid,
              feedbackId: f.id,
              title: `Auto task for ${f.customerName || "customer"}`,
              description: auto.template,
              status: "open",
              assignee: null,
              priority: rating <= 2 ? "high" : "medium",
              dueDate: null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            await loadTasks();
          } catch (err) {
            console.error("auto task creation error:", err);
          }
        }
      }
    });
  });
}

// ---------- TASKS ----------

async function loadTasks() {
  if (!tasksList || !currentUser) return;
  try {
    const qObj = query(
      collection(db, "tasks"),
      where("businessId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(qObj);
    taskCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTasks();
  } catch (err) {
    console.error("loadTasks error:", err);
  }
}

function renderTasks() {
  if (!tasksList) return;
  tasksList.innerHTML = "";

  const filtered = taskCache.filter((t) => {
    const statusOk =
      !taskStatusFilter ||
      taskStatusFilter.value === "all" ||
      t.status === taskStatusFilter.value;
    const priorityOk =
      !taskPriorityFilter ||
      taskPriorityFilter.value === "all" ||
      t.priority === taskPriorityFilter.value;
    return statusOk && priorityOk;
  });

  if (!filtered.length) {
    tasksList.textContent = "No tasks yet.";
    return;
  }

  filtered.forEach((t) => {
    const div = document.createElement("div");
    const due = t.dueDate ? formatDate(t.dueDate) : "No due date";
    div.className = "list-item" + (isOverdue(t) ? " task-overdue" : "");
    div.innerHTML = `
      <div class="title">${t.title}</div>
      <div class="meta">${t.status} · ${t.priority} · ${due}</div>
    `;
    div.addEventListener("click", () => showTaskDetail(t));
    tasksList.appendChild(div);
  });
}

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  const dueMs = task.dueDate.toMillis
    ? task.dueDate.toMillis()
    : new Date(task.dueDate).getTime();
  return dueMs < Date.now();
}

async function updateTaskField(taskId, payload) {
  try {
    await updateDoc(doc(db, "tasks", taskId), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    await loadTasks();
  } catch (err) {
    console.error("updateTaskField error:", err);
  }
}

async function showTaskDetail(task) {
  if (!taskDetail) return;

  taskDetail.innerHTML = "";

  const feedback = feedbackCache.find((f) => f.id === task.feedbackId);

  const statusSelect = document.createElement("select");
  ["open", "in_progress", "done"].forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s.replace("_", " ");
    if (task.status === s) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener("change", async () => {
    await updateTaskField(task.id, { status: statusSelect.value });
  });

  const dueInput = document.createElement("input");
  dueInput.type = "date";
  if (task.dueDate) {
    const d = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
    dueInput.value = d.toISOString().slice(0, 10);
  }
  dueInput.addEventListener("change", async () => {
    const newDate = dueInput.value ? new Date(`${dueInput.value}T12:00:00`) : null;
    await updateTaskField(task.id, { dueDate: newDate });
  });

  const detail = document.createElement("div");
  detail.innerHTML = `
    <p class="title">${task.title}</p>
    <p class="meta">Priority: ${task.priority} · Due: ${
    task.dueDate ? formatDate(task.dueDate) : "None"
  }</p>
    <p>${task.description || ""}</p>
    <div class="meta">Linked rating: ${feedback ? formatRating(feedback.rating) : "—"}</div>
    <div class="meta">Customer: ${feedback?.customerName || ""}</div>
  `;
  taskDetail.appendChild(detail);

  const controls = document.createElement("div");
  controls.className = "button-row";
  controls.appendChild(statusSelect);
  controls.appendChild(dueInput);
  taskDetail.appendChild(controls);

  const aiNext = document.createElement("div");
  aiNext.className = "ai-summary";
  aiNext.textContent = await AIService.suggestNextAction(
    feedback || { rating: 3, customerName: "customer" }
  );
  taskDetail.appendChild(aiNext);
}

taskStatusFilter?.addEventListener("change", renderTasks);
taskPriorityFilter?.addEventListener("change", renderTasks);

// ---------- NOTIFICATIONS ----------

notificationForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const payload = {
    businessId: currentUser.uid,
    emailLowRating: !!prefEmailLow?.checked,
    emailHighRating: !!prefEmailHigh?.checked,
    emailGoogle: !!prefEmailGoogle?.checked,
    smsLowRating: !!prefSmsLow?.checked,
    smsHighRating: !!prefSmsHigh?.checked,
    emailDailySummary: !!prefDaily?.checked,
    emailWeeklySummary: !!prefWeekly?.checked,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, "notificationPrefs", currentUser.uid), payload, {
      merge: true,
    });
    showBanner("Notification preferences saved", "success");
  } catch (err) {
    console.error("save notificationPrefs error:", err);
  }
});

async function loadNotifications() {
  if (!notificationForm || !currentUser) return;
  try {
    const snap = await getDoc(doc(db, "notificationPrefs", currentUser.uid));
    if (!snap.exists()) return;
    const d = snap.data();

    if (prefEmailLow)
      prefEmailLow.checked = !!(d.emailLowRating ?? d.emailAlertsLowRating);
    if (prefEmailHigh)
      prefEmailHigh.checked = !!(d.emailHighRating ?? d.emailAlertsHighRating);
    if (prefEmailGoogle)
      prefEmailGoogle.checked =
        !!(d.emailGoogle ?? d.emailAlertsNewGoogleReview);
    if (prefSmsLow)
      prefSmsLow.checked = !!(d.smsLowRating ?? d.smsAlertsLowRating);
    if (prefSmsHigh)
      prefSmsHigh.checked = !!(d.smsHighRating ?? d.smsAlertsHighRating);
    if (prefDaily)
      prefDaily.checked = !!(d.emailDailySummary ?? d.dailySummaryEmail);
    if (prefWeekly)
      prefWeekly.checked = !!(d.emailWeeklySummary ?? d.weeklySummaryEmail);
  } catch (err) {
    console.error("loadNotifications error:", err);
  }
}

// ---------- PORTAL SETTINGS ----------

async function loadPortalSettings() {
  if (!portalSettingsForm || !currentUser) return;
  try {
    const snap = await getDoc(doc(db, "portalSettings", currentUser.uid));
    const data = snap.exists()
      ? snap.data()
      : {
          primaryColor: "#2563eb",
          accentColor: "#7c3aed",
          backgroundStyle: "gradient",
          headline: "Share your experience",
          subheadline: "Your voice shapes how we improve.",
          ctaLabelHighRating: "Leave a Google review",
          ctaLabelLowRating: "Send private feedback",
          thankYouTitle: "Thank you!",
          thankYouBody: "We appreciate you taking the time to help us improve.",
        };

    if (portalPrimary) portalPrimary.value = data.primaryColor || "#2563eb";
    if (portalAccent) portalAccent.value = data.accentColor || "#7c3aed";
    if (portalBackground)
      portalBackground.value = data.backgroundStyle || "gradient";
    if (portalHeadline) portalHeadline.value = data.headline || "";
    if (portalSubheadline) portalSubheadline.value = data.subheadline || "";
    if (portalCtaHigh) portalCtaHigh.value = data.ctaLabelHighRating || "";
    if (portalCtaLow) portalCtaLow.value = data.ctaLabelLowRating || "";
    if (portalThanksTitle) portalThanksTitle.value = data.thankYouTitle || "";
    if (portalThanksBody) portalThanksBody.value = data.thankYouBody || "";
    applyPortalPreviewStyling();
  } catch (err) {
    console.error("loadPortalSettings error:", err);
  }
}

function updatePortalPreviewSrc() {
  if (!portalPreviewFrame || !currentUser) return;
  const params = new URLSearchParams({
    ownerPreview: "1",
    bid: currentUser.uid || "",
  });
  portalPreviewFrame.src = `/portal.html?${params.toString()}`;
}

function applyPortalPreviewStyling() {
  if (!portalPreviewFrame?.contentWindow) return;
  try {
    const docRef = portalPreviewFrame.contentWindow.document;
    const root = docRef.documentElement;

    root.style.setProperty("--accent", portalPrimary?.value || "#2563eb");
    root.style.setProperty("--accent-strong", portalAccent?.value || "#7c3aed");

    if (portalBackground?.value === "dark") {
      root.style.setProperty("--bg", "#0b1224");
      docRef.body?.classList.add("custom-dark");
    } else {
      root.style.removeProperty("--bg");
      docRef.body?.classList.remove("custom-dark");
    }

    const headlineEl = docRef.getElementById("portalHeadlineText");
    if (headlineEl)
      headlineEl.textContent =
        portalHeadline?.value || "Share your experience";

    const subEl = docRef.getElementById("portalSubheadlineText");
    if (subEl)
      subEl.textContent =
        portalSubheadline?.value || "We value your honesty.";

    const lowBtn = docRef.getElementById("lowCtaLabel");
    if (lowBtn)
      lowBtn.textContent =
        portalCtaLow?.value || "Send private feedback";

    const highBtn = docRef.getElementById("highCtaLabel");
    if (highBtn)
      highBtn.textContent =
        portalCtaHigh?.value || "Leave a Google review";

    const thanksTitle = docRef.getElementById("thankyouTitleText");
    if (thanksTitle)
      thanksTitle.textContent = portalThanksTitle?.value || "Thank you";

    const thanksBody = docRef.getElementById("thankyouBodyText");
    if (thanksBody)
      thanksBody.textContent =
        portalThanksBody?.value || "We appreciate your feedback.";
  } catch (err) {
    console.warn("Preview styling not applied", err);
  }
}

// ---------- REVIEW REQUESTS ----------

reviewRequestForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const payload = {
    businessId: currentUser.uid,
    customerName: reqName?.value,
    customerPhone: reqPhone?.value || null,
    customerEmail: reqEmail?.value || null,
    channel: reqChannel?.value,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, "reviewRequests"), payload);
    const portalLink = `${window.location.origin}/portal.html?bid=${currentUser.uid}`;
    console.log(
      `Would send ${payload.channel} review request to`,
      payload.customerName,
      "with link",
      portalLink
    );
    reviewRequestForm.reset();
    await loadReviewRequests();
  } catch (err) {
    console.error("reviewRequest submit error:", err);
  }
});

async function loadReviewRequests() {
  if (!reviewRequestsBody || !currentUser) return;
  try {
    const qObj = query(
      collection(db, "reviewRequests"),
      where("businessId", "==", currentUser.uid),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const snap = await getDocs(qObj);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    reviewRequestsBody.innerHTML = "";

    if (!rows.length) {
      reviewRequestsBody.innerHTML =
        '<tr><td colspan="4">No review requests yet.</td></tr>';
      return;
    }

    rows.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.customerName || "Customer"}</td>
        <td>${r.channel}</td>
        <td><span class="rating-chip-small">${r.status}</span></td>
        <td><button class="btn ghost" data-id="${r.id}">${
        r.status === "sent" ? "Mark completed" : "Mark sent"
      }</button></td>
      `;

      tr.querySelector("button")?.addEventListener("click", async () => {
        const newStatus = r.status === "sent" ? "completed" : "sent";
        try {
          await updateDoc(doc(db, "reviewRequests", r.id), {
            status: newStatus,
            updatedAt: serverTimestamp(),
          });
          console.log(`Marked request ${r.id} as ${newStatus}`);
          await loadReviewRequests();
        } catch (err) {
          console.error("update reviewRequest error:", err);
        }
      });

      reviewRequestsBody.appendChild(tr);
    });
  } catch (err) {
    console.error("loadReviewRequests error:", err);
  }
}

// ---------- INSIGHTS REFRESH BUTTONS ----------

refreshInsightsBtn?.addEventListener("click", refreshInsights);
refreshInsightsSecondary?.addEventListener("click", refreshInsights);

// ---------- ASK FOR REVIEWS BUTTON ----------

function goToReviewRequestsSection() {
  // highlight the "Review requests" tab in the left nav
  const requestsNav = document.querySelector('.nav-link[data-target="requests"]');
  if (requestsNav) {
    navButtons.forEach((btn) => btn.classList.remove("active"));
    requestsNav.classList.add("active");
  }

  // scroll to the Review requests section
  const requestsSection = document.getElementById("section-requests");
  if (requestsSection) {
    requestsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (reviewRequestForm) {
    reviewRequestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // put the cursor in the "Customer name" field
  if (reqName) {
    reqName.focus();
  }
}

// make the purple button use this behavior
askReviewsBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  goToReviewRequestsSection();
});

// Module marker so the file is treated as an ES module.
export {};
