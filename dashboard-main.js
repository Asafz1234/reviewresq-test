// dashboard-main.js (merged dashboard)

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
} from "./firebase-config.js";

const SEND_REVIEW_FUNCTION_URL =
  "https://us-central1-reviewresq-app.cloudfunctions.net/sendReviewRequestEmail";
const PORTAL_BASE_URL = "https://reviewresq.com/portal.html";

// ---------- DOM ELEMENTS ----------

// Top / global
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");
const planBadge = document.getElementById("planBadge");
const bizNameDisplay = document.getElementById("bizNameDisplay");
const bizNameHeading = document.getElementById("bizNameHeading");
const bizCategoryText = document.getElementById("bizCategoryText");
const bizUpdatedAt = document.getElementById("bizUpdatedAt");
const bizAvatar = document.getElementById("bizAvatar");
const heroAvatar = document.getElementById("heroAvatar");
const topbarViewLabel = document.getElementById("topbarViewLabel");
const dateRangeSelect = document.getElementById("dateRangeSelect");
const globalBanner = document.getElementById("globalBanner");
const globalBannerText = document.getElementById("globalBannerText");
const bannerDismiss = document.getElementById("bannerDismiss");
const navButtons = Array.from(document.querySelectorAll(".nav-link[data-view]"));
const navTriggers = Array.from(document.querySelectorAll("[data-view]"));
const mobileMoreBtn = document.getElementById("mobileMoreBtn");
const mobileMoreSheet = document.getElementById("mobileMoreSheet");
const mobileSheetClose = document.getElementById("mobileSheetClose");
const insightsUpdated = document.getElementById("insightsUpdated");
const planBanner = document.getElementById("plan-banner");
const upgradeModal = document.getElementById("upgradeModal");
const upgradeModalClose = document.getElementById("upgradeModalClose");
const upgradeModalBtn = document.getElementById("upgradeModalBtn");

const FEATURE_FLAGS = {
  aiInsights: {
    plan: "advanced",
    selector: "#view-ai-insights",
  },
  automations: {
    plan: "advanced",
    selector: "#view-automations",
  },
  tasks: {
    plan: "advanced",
    selector: "#view-followups",
  },
};

let currentBusiness = null;
let currentPlan = "basic";
let currentView = "view-overview";
const NON_BLOCKING_MESSAGE =
  "Some dashboard data could not be loaded. Please try refreshing.";

const dashboardViews = Array.from(document.querySelectorAll(".dashboard-view"));
const VIEW_HASH_MAP = {
  "#overview": "view-overview",
  "#inbox": "view-inbox",
  "#reviews-inbox": "view-inbox",
  "#ai-insights": "view-ai-insights",
  "#automations": "view-automations",
  "#followups": "view-followups",
  "#follow-ups": "view-followups",
  "#review-requests": "view-review-requests",
  "#portal-branding": "view-portal-branding",
  "#alerts": "view-alerts",
};

function setActiveNav(viewId) {
  navButtons.forEach((btn) => {
    const isActive = btn.dataset.view === viewId;
    btn.classList.toggle("active", isActive);
  });
}

function showView(viewId) {
  if (!viewId) return;
  currentView = viewId;

  const activeNav = navButtons.find((btn) => btn.dataset.view === viewId);
  if (activeNav && topbarViewLabel) {
    topbarViewLabel.textContent = activeNav.textContent.trim();
  }

  dashboardViews.forEach((view) => {
    view.classList.toggle("hidden", view.id !== viewId);
  });

  setActiveNav(viewId);
}

function hashForView(viewId) {
  const match = Object.entries(VIEW_HASH_MAP).find(([, id]) => id === viewId);
  return match ? match[0] : "#overview";
}

function viewFromHash(hash) {
  if (!hash) return "view-overview";
  const normalized = hash.startsWith("#") ? hash.toLowerCase() : `#${hash.toLowerCase()}`;
  return VIEW_HASH_MAP[normalized] || "view-overview";
}

function handleHashChange() {
  const hash = window.location.hash || "#overview";
  const nextView = viewFromHash(hash);
  showView(nextView);
}

function setRoute(hash) {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    handleHashChange();
  }
}

function updateSidebarUserInfo(user) {
  if (userEmailDisplay) {
    userEmailDisplay.textContent = user?.email || "My account";
  }
  if (planBadge) {
    planBadge.textContent =
      currentPlan === "advanced" ? "Advanced plan" : "Basic plan";
  }
}

async function safeLoad(loader, label) {
  try {
    return await loader();
  } catch (err) {
    console.error(`${label || "Loader"} error:`, err);
    showBanner(NON_BLOCKING_MESSAGE, "warn");
    return null;
  }
}

function initNavigation() {
  handleHashChange();

  navTriggers.forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      const targetView = trigger.dataset.view;
      if (!targetView) return;
      setRoute(hashForView(targetView));

      if (mobileMoreSheet) {
        mobileMoreSheet.setAttribute("aria-hidden", "true");
        mobileMoreSheet.classList.remove("open");
      }
    });
  });

  if (mobileMoreBtn && mobileMoreSheet) {
    mobileMoreBtn.addEventListener("click", () => {
      mobileMoreSheet.classList.add("open");
      mobileMoreSheet.setAttribute("aria-hidden", "false");
    });
  }

  if (mobileSheetClose && mobileMoreSheet) {
    mobileSheetClose.addEventListener("click", () => {
      mobileMoreSheet.classList.remove("open");
      mobileMoreSheet.setAttribute("aria-hidden", "true");
    });
  }

  mobileMoreSheet?.addEventListener("click", (event) => {
    if (event.target === mobileMoreSheet) {
      mobileMoreSheet.classList.remove("open");
      mobileMoreSheet.setAttribute("aria-hidden", "true");
    }
  });

  window.addEventListener("hashchange", handleHashChange);
}

function renderPlanBanner(plan) {
  if (!planBanner) return;

  if (plan === "advanced") {
    planBanner.innerHTML = "";
    planBanner.style.display = "none";
    return;
  }

  planBanner.style.display = "flex";
  planBanner.innerHTML = `
    <div class="plan-banner__text">
      You’re on the <strong>Basic</strong> plan.
      Unlock Automations & AI Insights with the <strong>Advanced</strong> plan.
    </div>
    <button id="upgrade-btn" class="btn primary btn-small">
      Upgrade to Advanced
    </button>
  `;

  document.getElementById("upgrade-btn")?.addEventListener("click", () => {
    openUpgradeModal("Upgrade");
  });
}

function applyPlanToUI(plan) {
  const isAdvanced = plan === "advanced";

  Object.values(FEATURE_FLAGS).forEach((feature) => {
    const el = document.querySelector(feature.selector);
    if (!el) return;

    if (!isAdvanced && feature.plan === "advanced") {
      el.classList.add("locked-feature");
    } else {
      el.classList.remove("locked-feature");
    }
  });

  document.querySelectorAll(".locked-feature").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openUpgradeModal("Advanced feature");
    });
  });

  renderPlanBanner(plan);
}

function openUpgradeModal(featureName = "Advanced feature") {
  if (!upgradeModal) return;
  const titleEl = document.getElementById("upgradeModalTitle");
  if (titleEl) {
    titleEl.textContent = `${featureName} is an Advanced feature`;
  }

  upgradeModal.classList.add("visible");
  upgradeModal.setAttribute("aria-hidden", "false");
}

function closeUpgradeModal() {
  if (!upgradeModal) return;
  upgradeModal.classList.remove("visible");
  upgradeModal.setAttribute("aria-hidden", "true");
}

function requireAdvanced(featureName) {
  if (currentPlan === "advanced") return true;
  openUpgradeModal(featureName);
  return false;
}

// יוצר משימת follow-up מקושרת ל-feedback
async function createFollowupTaskForFeedback(feedback, options = { openTasksAfter: false }) {
  if (!currentUser || !feedback) return;
  if (!requireAdvanced("Follow-ups")) return;

  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // עוד 3 ימים

  try {
    await addDoc(collection(db, "tasks"), {
      businessId: currentUser.uid,
      feedbackId: feedback.id,
      title: `Follow up with ${feedback.customerName || "customer"} (${feedback.rating}★)`,
      description: feedback.message || "",
      status: "open",
      assignee: null,
      priority: feedback.rating <= 2 ? "high" : "medium",
      dueDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // מעדכן את ה-feedback כ-followup
    await updateFeedbackStatus(feedback.id, "followup");
    await loadFeedback(); // <-- חדש: מרענן את רשימת הביקורות מיד
    await loadTasks();

    if (currentModalFeedback?.id === feedback.id) {
      currentModalFeedback.status = "followup";
      refreshFeedbackModal();
    }

    // פותח את מסך ה-Follow-ups אם ביקשנו
    if (options.openTasksAfter) {
      showView("view-followups");
    }

    showBanner("Follow-up task created.", "success");
  } catch (err) {
    console.error("createFollowupTaskForFeedback error:", err);
    showBanner("Could not create follow-up task.", "warn");
  }
}

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
const aiSentiment = document.getElementById("aiSentiment");
const aiSentimentCard = document.getElementById("aiSentimentCard");
const aiTotalCount = document.getElementById("aiTotalCount");
const aiPositiveCount = document.getElementById("aiPositiveCount");
const aiNegativeCount = document.getElementById("aiNegativeCount");
const aiNeutralCount = document.getElementById("aiNeutralCount");
const aiPosNegRatio = document.getElementById("aiPosNegRatio");
const aiPriorityAlert = document.getElementById("aiPriorityAlert");
const aiThemes = document.getElementById("aiThemes");
const aiKeywords = document.getElementById("aiKeywords");
const aiRecommendations = document.getElementById("aiRecommendations");
const aiTrendCanvas = document.getElementById("sentimentTrendChart");
const aiTrendEmpty = document.getElementById("aiTrendEmpty");
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
const useRecommendedTemplateBtn = document.getElementById(
  "useRecommendedTemplate"
);

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
const reqNameInput = document.getElementById("reqName");
const reqEmailInput = document.getElementById("reqEmail");
const reqChannelSelect = document.getElementById("reqChannel");
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
let selectedAutomationId = "";
let taskCache = [];
let currentModalFeedback = null;

const DEFAULT_AUTOMATION_PREVIEW = "Preview will appear here.";

const RECOMMENDED_AUTOMATION_TEMPLATES = {
  low_rating_email:
    "Hi {{customerName}},\n\nThank you for your feedback. I'm really sorry your experience wasn’t perfect.\nI’d love to understand what happened and see how we can make it right.\n\nIf you’re open to it, you can reply directly to this email or call us at {{businessPhone}}.\n\nThanks,\n{{ownerName}}\n{{businessName}}",
  low_rating_sms:
    "Hi {{customerName}}, thanks for your feedback. I’m sorry your experience wasn’t perfect. Can you reply with a bit more detail so we can make it right? – {{businessName}}",
  low_rating_whatsapp:
    "Hi {{customerName}}, sorry to hear we missed the mark. Can you share more about what happened? We’ll fix it ASAP. – {{businessName}}",
  high_rating_email:
    "Hi {{customerName}},\n\nThank you so much for your positive feedback! It really means a lot to us.\nIf you have a moment, we’d appreciate a quick 5-star review on Google – it helps other customers discover us.\n\nThank you again,\n{{ownerName}}\n{{businessName}}",
  high_rating_sms:
    "Hi {{customerName}}, thanks for the great feedback! 🙏 If you have 30 seconds, a quick 5★ review on Google would help us a lot. Thank you! – {{businessName}}",
  high_rating_whatsapp:
    "Hi {{customerName}}, thank you for the awesome rating! Could you drop us a quick 5★ review on Google? It helps more customers find us. – {{businessName}}",
  new_google_review_email:
    "Hi {{customerName}},\n\nWe saw your Google review – thank you so much! If you have any other thoughts, reply here anytime.\n\nCheers,\n{{ownerName}}\n{{businessName}}",
  new_google_review_sms:
    "Thanks for the Google review, {{customerName}}! We appreciate you. If there’s anything else we can do, just reply to this text. – {{businessName}}",
  no_response_x_days_email:
    "Hi {{customerName}},\n\nChecking in to see if you received our last message. If you still need help, reply here or call {{businessPhone}} and we’ll take care of it.\n\nThanks,\n{{ownerName}}\n{{businessName}}",
  no_response_x_days_sms:
    "Hi {{customerName}}, just following up. Let us know if you still need help or call us at {{businessPhone}}. Thanks! – {{businessName}}",
};

async function getBusinessDocForUser(uid) {
  if (!uid) return null;
  const ref = doc(db, "businesses", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: ref.id, ...snap.data() };
}

async function loadBusinessForCurrentUser(uid) {
  const businessDoc = await getBusinessDocForUser(uid);
  if (businessDoc) {
    currentBusiness = businessDoc;
    currentPlan = businessDoc.plan || "basic";
  } else {
    currentBusiness = null;
    currentPlan = "basic";
  }
  return businessDoc;
}

// ---------- AI SERVICE (heuristic, ללא API חיצוני) ----------
const AIService = {
  async generateInsights(feedbackList) {
    const themesMap = new Map();
    const keywordCounts = new Map();
    const trendMap = new Map();
    let sentimentTotal = 0;
    let positives = 0;
    let negatives = 0;
    let neutrals = 0;

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
      if (rating === 3) neutrals += 1;

      const dateKey = formatDateKey(fb.createdAt || Date.now());
      const sentiment = sentimentFromRating(rating);

      const trendEntry = trendMap.get(dateKey) || { sum: 0, count: 0 };
      trendEntry.sum += sentiment;
      trendEntry.count += 1;
      trendMap.set(dateKey, trendEntry);

      const matched = [];
      keywords.forEach((k) => {
        if (k.tokens.some((t) => message.includes(t))) matched.push(k.label);
      });
      if (!matched.length) matched.push("general experience");
      matched.forEach((m) => themesMap.set(m, (themesMap.get(m) || 0) + 1));

      const keywordTags = keywordsForFeedback(message);
      keywordTags.forEach((tag) => keywordCounts.set(tag, (keywordCounts.get(tag) || 0) + 1));
    });

    const topThemes = Array.from(themesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    const sentimentScore = feedbackList.length
      ? Number((sentimentTotal / feedbackList.length).toFixed(2))
      : 0;

    const totalCount = feedbackList.length;

    const summaryParts = [];
    if (feedbackList.length) {
      summaryParts.push(
        `You received ${totalCount} feedback items recently (${positives} positive, ${negatives} negative).`
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

    const sentimentTrend = Array.from(trendMap.entries())
      .map(([dateKey, val]) => ({
        dateKey,
        avgSentiment: Number((val.sum / val.count).toFixed(2)),
        count: val.count,
      }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    const keywordsList = Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

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
      totalCount,
      positiveCount: positives,
      negativeCount: negatives,
      neutralCount: neutrals,
      sentimentTrend,
      keywords: keywordsList,
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

// ---------- NAVIGATION BUTTONS ----------

initNavigation();

upgradeModalClose?.addEventListener("click", closeUpgradeModal);
upgradeModal?.addEventListener("click", (e) => {
  if (e.target === upgradeModal) closeUpgradeModal();
});
upgradeModalBtn?.addEventListener("click", () => {
  window.location.href = "/index.html#pricing";
});

// ---------- AUTH & INITIAL LOAD ----------

async function loadDashboard(user) {
  try {
    currentUser = user;
    updateSidebarUserInfo(user);

    await safeLoad(() => loadBusinessForCurrentUser(user.uid), "loadBusinessForCurrentUser");
    updateSidebarUserInfo(user);
    applyPlanToUI(currentPlan);

    const canContinue = await safeLoad(() => loadProfile(), "loadProfile");
    if (canContinue === false) return;

    await safeLoad(() => loadAutomations(), "loadAutomations");
    await safeLoad(() => loadFeedback(), "loadFeedback");
    updatePortalPreviewSrc();

    const loaders = [
      ["loadTasks", loadTasks],
      ["loadNotifications", loadNotifications],
      ["loadReviewRequests", loadReviewRequests],
      ["loadAiInsights", loadAiInsights],
      ["loadPortalSettings", loadPortalSettings],
    ];

    const results = await Promise.allSettled(loaders.map(([, fn]) => fn()));
    results.forEach((res, idx) => {
      if (res.status === "rejected") {
        console.error(`${loaders[idx][0]} error:`, res.reason);
        showBanner(NON_BLOCKING_MESSAGE, "warn");
      }
    });
  } catch (err) {
    console.error("Dashboard init error:", err);
    showBanner("We had trouble loading your dashboard.", "warn");
  } finally {
    updateSidebarUserInfo(user);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "/auth.html";
    });
  }

  await loadDashboard(user);
});

async function loadProfile() {
  try {
    if (!currentUser) return false;
    const ref = doc(db, "businessProfiles", currentUser.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      showBanner("Finish onboarding to access your dashboard.", "warn");
      setTimeout(() => (window.location.href = "/onboarding.html"), 1500);
      return false;
    }

    const data = snap.data();
    currentProfile = data;

    if (bizNameDisplay) bizNameDisplay.textContent = data.businessName || "Your business";
    if (bizNameHeading) bizNameHeading.textContent = data.businessName || "Your business";
    if (bizCategoryText) bizCategoryText.textContent = data.category || "Category";
    if (bizUpdatedAt) bizUpdatedAt.textContent = formatDate(data.updatedAt);
    if (bizAvatar) bizAvatar.textContent = initialsFromName(data.businessName || "RR");
    if (heroAvatar) heroAvatar.textContent = initialsFromName(data.businessName || "RR");
    if (planBadge)
      planBadge.textContent =
        currentPlan === "advanced" ? "Advanced plan" : "Basic plan";

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

function getDateRangeBounds(rangeValue) {
  if (rangeValue === "all") {
    return { startDate: null, endDate: null };
  }

  const days = Number(rangeValue) || 7;
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
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

async function refreshInsightsFromFirestore() {
  const user = auth.currentUser;
  if (!user) return;

  const rangeValue = dateRangeSelect?.value || "7";
  const { startDate, endDate } = getDateRangeBounds(rangeValue);

  const constraints = [where("businessId", "==", user.uid), orderBy("createdAt", "desc")];
  if (startDate) constraints.push(where("createdAt", ">=", startDate));
  if (endDate) constraints.push(where("createdAt", "<=", endDate));

  try {
    const feedbackRef = collection(db, "feedback");
    const snap = await getDocs(query(feedbackRef, ...constraints));

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
    console.error("refreshInsightsFromFirestore error:", err);
    showBanner("Could not refresh insights right now.", "warn");
    throw err;
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
      <td data-label="Date">${formatDate(f.createdAt)}</td>
      <td data-label="Customer">${f.customerName || "Customer"}</td>
      <td data-label="Rating"><span class="rating-pill ${ratingClass}">${formatRating(
        f.rating
      )}</span></td>
      <td data-label="Type">${f.type || "private"}</td>
      <td data-label="Message">${(f.message || "").slice(0, 80)}${(f.message || "").length > 80 ? "…" : ""}</td>
      <td data-label="Status"><span class="status-chip status-${f.status || "new"}">${statusLabel}</span></td>
      <td data-label="Actions" class="actions-cell">
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
      await createFollowupTaskForFeedback(f, { openTasksAfter: true });
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
    if (aiSummary) {
      aiSummary.textContent = "Insights are not available right now.";
    }
  }
}

async function refreshInsights() {
  try {
    const feedbackSample = feedbackCache.slice(0, 100);

    if (!feedbackSample.length) {
      renderInsights({
        summary: "No data yet. Start collecting reviews to unlock insights.",
        sentimentScore: 0,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        totalCount: 0,
      });
      return;
    }
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
    renderInsights({
      summary: "Insights are not available right now.",
      totalCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      sentimentScore: null,
    });
  }
}

async function handleInsightsRefresh(btn) {
  if (!requireAdvanced("AI Insights")) return;
  const originalLabel = btn?.textContent || "Refresh insights";
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Refreshing…";
    }
    await refreshInsightsFromFirestore();

    // Then regenerate AI insights based on the updated feedbackCache
    await refreshInsights();
  } catch (err) {
    console.error("Error refreshing AI insights:", err);
    alert("Something went wrong while refreshing insights. Please try again.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
}

function renderInsights(data) {
  const totalCount =
    data.totalCount ?? data.feedbackCount ?? data.total ?? feedbackCache.length;
  const positiveCount = data.positiveCount ?? 0;
  const negativeCount = data.negativeCount ?? 0;
  const neutralCount = data.neutralCount ?? 0;
  const sentimentScore =
    data.sentimentScore != null ? Number(data.sentimentScore) : null;

  if (aiSummary) aiSummary.textContent = data.summary || "Not enough data yet.";

  if (aiTotalCount) aiTotalCount.textContent = totalCount || "0";
  if (aiPositiveCount) aiPositiveCount.textContent = positiveCount || "0";
  if (aiNegativeCount) aiNegativeCount.textContent = negativeCount || "0";
  if (aiNeutralCount) aiNeutralCount.textContent = neutralCount || "0";

  if (aiPosNegRatio) {
    if (totalCount > 0) {
      const ratio = Math.round((positiveCount / totalCount) * 100);
      aiPosNegRatio.textContent = `${ratio}% positive`;
    } else {
      aiPosNegRatio.textContent = "–";
    }
  }

  if (aiPriorityAlert) {
    if (negativeCount >= 2) {
      aiPriorityAlert.textContent =
        "You’ve received several low ratings recently — prioritize outreach to unhappy customers.";
    } else if (positiveCount >= 3) {
      aiPriorityAlert.textContent =
        "Your customers are mostly happy — ask for more Google reviews this week.";
    } else {
      aiPriorityAlert.textContent =
        "Collect more feedback to unlock stronger insights.";
    }
  }

  if (aiThemes) {
    aiThemes.innerHTML = "";
    const themes = data.topThemes || [];
    if (themes.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Not enough data yet.";
      aiThemes.appendChild(li);
    } else {
      themes.forEach((t) => {
        const li = document.createElement("li");
        li.textContent = `${t.label} (${t.count})`;
        aiThemes.appendChild(li);
      });
    }
  }

  if (aiKeywords) {
    aiKeywords.innerHTML = "";
    const keywords = data.keywords || [];
    if (!keywords.length) {
      const empty = document.createElement("div");
      empty.className = "muted-text";
      empty.textContent = "No keyword signals yet.";
      aiKeywords.appendChild(empty);
    } else {
      keywords.forEach((k) => {
        const chip = document.createElement("span");
        chip.className = "keyword-chip";
        chip.textContent = `${k.label} (${k.count})`;
        aiKeywords.appendChild(chip);
      });
    }
  }

  if (aiRecommendations) {
    aiRecommendations.innerHTML = "";
    const recs = data.topRecommendations || [];
    if (!recs.length) {
      const li = document.createElement("li");
      li.textContent = "Once you receive a bit more feedback, we’ll suggest specific actions here.";
      aiRecommendations.appendChild(li);
    } else {
      recs.forEach((r) => {
        const li = document.createElement("li");
        li.textContent = r;
        aiRecommendations.appendChild(li);
      });
    }
  }

  if (aiSentiment) {
    if (sentimentScore == null) {
      aiSentiment.textContent = "–";
      aiSentiment.className = "sentiment-pill";
    } else {
      aiSentiment.textContent = sentimentScore.toFixed(2);
      aiSentiment.className =
        "sentiment-pill " +
        (sentimentScore >= 0.2
          ? "sentiment-positive"
          : sentimentScore <= -0.2
          ? "sentiment-negative"
          : "sentiment-neutral");
    }
  }

  if (aiSentimentCard) {
    if (sentimentScore == null) {
      aiSentimentCard.textContent = "–";
      aiSentimentCard.className = "ai-metric-value sentiment-value";
    } else {
      aiSentimentCard.textContent = sentimentScore.toFixed(2);
      aiSentimentCard.className =
        "ai-metric-value sentiment-value " +
        (sentimentScore >= 0.2
          ? "sentiment-positive"
          : sentimentScore <= -0.2
          ? "sentiment-negative"
          : "sentiment-neutral");
    }
  }

  renderSentimentTrend(data.sentimentTrend || []);

  if (data.generatedAt && insightsUpdated) {
    const d = data.generatedAt.toDate
      ? data.generatedAt.toDate()
      : new Date(data.generatedAt);
    insightsUpdated.textContent = `Last updated ${d.toLocaleString()}`;
  }
}

function renderSentimentTrend(points) {
  if (!aiTrendCanvas || !aiTrendEmpty) return;

  const ctx = aiTrendCanvas.getContext("2d");
  const hasData = points && points.length;

  aiTrendCanvas.classList.toggle("hidden", !hasData);
  aiTrendEmpty.classList.toggle("hidden", hasData);

  if (!hasData) {
    ctx.clearRect(0, 0, aiTrendCanvas.width, aiTrendCanvas.height);
    return;
  }

  const deviceRatio = window.devicePixelRatio || 1;
  const width = aiTrendCanvas.clientWidth * deviceRatio;
  const height = aiTrendCanvas.clientHeight * deviceRatio;
  aiTrendCanvas.width = width;
  aiTrendCanvas.height = height;
  ctx.clearRect(0, 0, width, height);

  const padding = 20 * deviceRatio;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const sentiments = points.map((p) => p.avgSentiment);
  const maxVal = Math.max(...sentiments, 1);
  const minVal = Math.min(...sentiments, -1);
  const range = maxVal - minVal || 1;

  ctx.strokeStyle = "rgba(99, 102, 241, 0.6)";
  ctx.lineWidth = 2 * deviceRatio;
  ctx.beginPath();

  points.forEach((p, idx) => {
    const x = padding + (usableWidth * idx) / Math.max(points.length - 1, 1);
    const y = padding + usableHeight * (1 - (p.avgSentiment - minVal) / range);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  ctx.fillStyle = "rgba(99, 102, 241, 0.15)";
  ctx.beginPath();
  points.forEach((p, idx) => {
    const x = padding + (usableWidth * idx) / Math.max(points.length - 1, 1);
    const y = padding + usableHeight * (1 - (p.avgSentiment - minVal) / range);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(padding + usableWidth, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.font = `${12 * deviceRatio}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("Date", padding, height - 4 * deviceRatio);
  ctx.textAlign = "right";
  ctx.fillText("Sentiment", width - padding, padding);
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

function refreshFeedbackModal() {
  if (!feedbackModal || !currentModalFeedback) return;

  if (modalDate) modalDate.textContent = formatDate(currentModalFeedback.createdAt);
  if (modalCustomer)
    modalCustomer.textContent = currentModalFeedback.customerName || "Customer";
  if (modalRating) modalRating.textContent = formatRating(currentModalFeedback.rating);
  if (modalType) modalType.textContent = currentModalFeedback.type || "private";
  if (modalMessage) modalMessage.textContent = currentModalFeedback.message || "—";

  const statusChip = feedbackModal.querySelector(".status-chip");
  if (statusChip) {
    const statusLabel = (currentModalFeedback.status || "new").replace("_", " ");
    statusChip.textContent = statusLabel;
    statusChip.className = `status-chip status-${currentModalFeedback.status || "new"}`;
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
  if (!currentModalFeedback) return;
  await createFollowupTaskForFeedback(currentModalFeedback, { openTasksAfter: true });
  closeFeedbackModal();
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
    .replace(/{{ownerName}}/g, sample.ownerName)
    .replace(/{{businessPhone}}/g, sample.businessPhone);
}

function automationPreviewText(templateOverride) {
  const sample = {
    customerName: "Alex",
    businessName: currentProfile?.businessName || "Your business",
    rating: 5,
    feedbackSnippet: "Loved the service!",
    ownerName: currentProfile?.ownerName || "Team",
    businessPhone:
      currentProfile?.phone ||
      currentProfile?.businessPhone ||
      "(555) 123-4567",
  };
  return fillTemplate(templateOverride ?? automationTemplate?.value, sample);
}

function getAutomationTemplateKey(trigger, channel) {
  if (!trigger || !channel) return null;
  return `${trigger}_${channel}`.toLowerCase();
}

function applyRecommendedTemplate(force = false) {
  const trigger = automationTrigger?.value;
  const channel = automationChannel?.value;
  const key = getAutomationTemplateKey(trigger, channel);
  if (!key) return null;
  const template = RECOMMENDED_AUTOMATION_TEMPLATES[key];
  if (!template) return null;

  const hasExistingContent = (automationTemplate?.value || "").trim().length > 0;
  if (!force) {
    if (automationId?.value) return null;
    if (hasExistingContent) return null;
  }

  if (automationTemplate) {
    automationTemplate.value = template;
    setAutomationPreview(automationPreviewText(template));
  }
  return template;
}

function setAutomationPreview(text) {
  if (!automationPreview) return;
  automationPreview.textContent = text;
}

automationTemplate?.addEventListener("input", () => {
  const text = automationTemplate.value.trim()
    ? automationPreviewText()
    : DEFAULT_AUTOMATION_PREVIEW;
  setAutomationPreview(text);
});

automationTrigger?.addEventListener("change", () => {
  applyRecommendedTemplate();
  const text = automationTemplate?.value.trim()
    ? automationPreviewText()
    : DEFAULT_AUTOMATION_PREVIEW;
  setAutomationPreview(text);
});

automationChannel?.addEventListener("change", () => {
  applyRecommendedTemplate();
  const text = automationTemplate?.value.trim()
    ? automationPreviewText()
    : DEFAULT_AUTOMATION_PREVIEW;
  setAutomationPreview(text);
});

useRecommendedTemplateBtn?.addEventListener("click", () => {
  const applied = applyRecommendedTemplate(true);
  if (!applied) {
    alert("No recommended template for this trigger/channel yet.");
  }
});

automationCancel?.addEventListener("click", () => {
  automationForm?.reset();
  if (automationId) automationId.value = "";
  selectedAutomationId = "";
  setAutomationPreview(DEFAULT_AUTOMATION_PREVIEW);
});

// ---------- AUTOMATIONS ----------

async function softDeleteAutomation(autoId) {
  if (!autoId || !currentUser) return;
  if (!requireAdvanced("Automations")) return;
  try {
    await updateDoc(doc(db, "automations", autoId), {
      deleted: true,
      enabled: false,
      updatedAt: serverTimestamp(),
    });
    if (automationId?.value === autoId) {
      automationForm?.reset();
      automationId.value = "";
      selectedAutomationId = "";
      setAutomationPreview(DEFAULT_AUTOMATION_PREVIEW);
    }
    await loadAutomations();
  } catch (err) {
    console.error("automationDelete error:", err);
  }
}

automationDelete?.addEventListener("click", async () => {
  if (!automationId?.value || !currentUser) return;
  const confirmDelete = confirm(
    "Delete this rule? This cannot be undone."
  );
  if (!confirmDelete) return;
  await softDeleteAutomation(automationId.value);
});

automationForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  if (!requireAdvanced("Automations")) return;

  if (!automationTrigger?.value) {
    alert("Please choose a trigger.");
    return;
  }

  if (!automationChannel?.value) {
    alert("Please choose a channel.");
    return;
  }

  if (!automationTemplate?.value.trim()) {
    alert("Template cannot be empty.");
    return;
  }

  if (automationTrigger.value === "no_response_x_days") {
    const days = Number(automationNoResponseDays?.value || 0);
    if (!days || days < 0) {
      alert("Please enter a positive number of days for this trigger.");
      return;
    }
  }

  const existing = automationCache.find((a) => a.id === automationId?.value);

  const delayHoursVal =
    automationDelay?.value !== undefined && automationDelay.value !== ""
      ? Number(automationDelay.value)
      : null;
  const noResponseVal =
    automationNoResponseDays?.value !== undefined &&
    automationNoResponseDays.value !== ""
      ? Number(automationNoResponseDays.value)
      : null;

  const payload = {
    businessId: currentUser.uid,
    type: automationChannel?.value,
    trigger: automationTrigger?.value,
    delayHours:
      delayHoursVal !== null && Number.isFinite(delayHoursVal)
        ? Math.max(0, delayHoursVal)
        : null,
    minRating: automationTrigger?.value === "low_rating" ? 1 : null,
    maxRating: automationTrigger?.value === "low_rating" ? 3 : null,
    enabled: existing?.enabled ?? true,
    template: automationTemplate?.value,
    channelConfig: {},
    updatedAt: serverTimestamp(),
    noResponseDays:
      noResponseVal !== null && Number.isFinite(noResponseVal)
        ? Math.max(0, noResponseVal)
        : null,
  };

  try {
    if (automationId?.value) {
      await updateDoc(doc(db, "automations", automationId.value), payload);
    } else {
      await addDoc(collection(db, "automations"), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
    automationForm?.reset();
    if (automationId) automationId.value = "";
    selectedAutomationId = "";
    setAutomationPreview(DEFAULT_AUTOMATION_PREVIEW);
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
    if (selectedAutomationId) {
      const stillExists = automationCache.some(
        (a) => a.id === selectedAutomationId
      );
      if (!stillExists) {
        selectedAutomationId = "";
        setAutomationPreview(DEFAULT_AUTOMATION_PREVIEW);
      }
    }
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
    const empty = document.createElement("div");
    empty.className = "automation-empty";
    empty.textContent = "No rules yet. Create your first automation on the right.";
    automationList.appendChild(empty);
    return;
  }

  automationCache.forEach((auto) => {
    const div = document.createElement("div");
    const templateLine =
      (auto.template || "")
        .split("\n")
        .find((line) => line.trim().length > 0) || "No template yet.";
    div.className = `list-item${
      selectedAutomationId === auto.id ? " active" : ""
    }`;

    const content = document.createElement("div");
    content.className = "automation-copy";
    content.innerHTML = `
      <div class="title">${describeTrigger(auto)} <span class="arrow">→</span> <span class="automation-chip">${
      (auto.type || "").toUpperCase()
    }</span></div>
      <div class="meta">${templateLine}</div>
      <div class="meta">${auto.enabled ? "On" : "Off"} · Updated ${formatDate(
      auto.updatedAt
    )}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "actions";

    div.addEventListener("click", () => {
      if (!automationId) return;
      automationId.value = auto.id;
      if (automationTrigger) automationTrigger.value = auto.trigger;
      if (automationChannel) automationChannel.value = auto.type;
      if (automationDelay) automationDelay.value = auto.delayHours || "";
      if (automationNoResponseDays)
        automationNoResponseDays.value = auto.noResponseDays || "";
      if (automationTemplate) automationTemplate.value = auto.template || "";
      selectedAutomationId = auto.id;
      setAutomationPreview(
        automationTemplate?.value.trim()
          ? automationPreviewText()
          : DEFAULT_AUTOMATION_PREVIEW
      );
      document
        .querySelectorAll("#automationList .list-item")
        .forEach((item) => item.classList.remove("active"));
      div.classList.add("active");
    });

    const toggle = document.createElement("button");
    toggle.className = "btn ghost";
    toggle.textContent = auto.enabled ? "Disable" : "Enable";
    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!requireAdvanced("Automations")) return;
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

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const confirmDelete = confirm(
        "Delete this rule? This cannot be undone."
      );
      if (!confirmDelete) return;
      await softDeleteAutomation(auto.id);
    });

    actions.appendChild(toggle);
    actions.appendChild(deleteBtn);
    div.appendChild(content);
    div.appendChild(actions);
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
        const daysSince = Number(f.daysSinceRequest || 0);
        shouldFire = daysSince >= Number(auto.noResponseDays || 0);
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
              description: automationPreviewText(auto.template),
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

  const columns = [
    { key: "open", label: "Open" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Completed" },
  ];

  const board = document.createElement("div");
  board.className = "tasks-board";

  columns.forEach((col) => {
    const colEl = document.createElement("div");
    colEl.className = "kanban-column";
    colEl.innerHTML = `<div class="kanban-title">${col.label}<span class="pill muted"></span></div>`;

    const list = document.createElement("div");
    list.className = "kanban-list";

    const colTasks = filtered.filter((t) => t.status === col.key);
    if (!colTasks.length) {
      const empty = document.createElement("div");
      empty.className = "section-sub";
      empty.textContent = "No tasks";
      list.appendChild(empty);
    } else {
      colTasks.forEach((t) => {
        const card = document.createElement("div");
        const due = t.dueDate ? formatDate(t.dueDate) : "No due date";
        card.className = "task-card" + (isOverdue(t) ? " task-overdue" : "");
        card.innerHTML = `
          <div class="title">${t.title}</div>
          <div class="task-meta">
            <span class="priority ${t.priority}">${t.priority}</span>
            <span>${due}</span>
          </div>
        `;
        card.addEventListener("click", () => showTaskDetail(t));
        list.appendChild(card);
      });
    }

    colEl.querySelector(".pill")?.textContent = `${colTasks.length}`;
    colEl.appendChild(list);
    board.appendChild(colEl);
  });

  tasksList.appendChild(board);
}

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  const dueMs = task.dueDate.toMillis
    ? task.dueDate.toMillis()
    : new Date(task.dueDate).getTime();
  return dueMs < Date.now();
}

async function updateTaskField(taskId, payload) {
  if (!requireAdvanced("Tasks")) return;
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

if (reviewRequestForm) {
  reviewRequestForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = reqNameInput.value.trim();
    const email = reqEmailInput.value.trim();
    const channel = reqChannelSelect.value;

    if (!email) {
      showBanner("Please enter an email address.", "error");
      return;
    }

    // Use the business name shown in the header if available
    const bizName =
      document.getElementById("bizNameDisplay")?.textContent || "your business";
    const businessName =
      (currentProfile && currentProfile.businessName) || bizName || "your business";
    const businessLogoUrl =
      (currentProfile && (currentProfile.logoUrl || currentProfile.logoDataUrl)) ||
      "";

    // Build portal link for THIS business
    const businessId = currentUser?.uid || "";
    const portalUrl =
      (currentProfile && currentProfile.portalPath
        ? currentProfile.portalPath.startsWith("http")
          ? currentProfile.portalPath
          : `${window.location.origin}${currentProfile.portalPath}`
        : null) ||
      (businessId
        ? `${PORTAL_BASE_URL}?bid=${encodeURIComponent(businessId)}`
        : PORTAL_BASE_URL);

    const customerName = name || email;

    // --------- EMAIL TEMPLATE (TEXT + HTML) ---------
    const plainTextMessage =
      `Hi${name ? " " + name : ""},

` +
      `Thank you for choosing ${bizName}.

` +
      `We’d really appreciate it if you could take a moment to share your experience in a quick review.

` +
      `Just click the link below:
` +
      `${portalUrl}

` +
      `Thank you so much,
` +
      `${bizName} team`;

    const htmlMessage = `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #111827;">
        <p>Hi${name ? " " + name : ""},</p>
        <p>Thank you for choosing <strong>${bizName}</strong>.</p>
        <p>We’d really appreciate it if you could take a moment to share your experience in a quick review.</p>
        <p style="margin: 24px 0;">
          <a href="${portalUrl}"
             style="
               display: inline-block;
               padding: 12px 22px;
               border-radius: 999px;
               background: #2563eb;
               color: #ffffff;
               text-decoration: none;
               font-weight: 600;
             ">
            Click here to leave your review
          </a>
        </p>
        <p style="font-size: 13px; color: #6b7280; margin-top: 16px;">
          Or copy and paste this link into your browser:<br>
          <a href="${portalUrl}" style="color: #2563eb;">${portalUrl}</a>
        </p>
        <p>
          Thank you so much,<br/>
          <strong>${bizName}</strong> team
        </p>
      </div>
    `;

    if (channel === "email") {
      try {
        const emailSubject = `How was your experience with ${
          businessName || "our business"
        }?`;

        const response = await fetch(SEND_REVIEW_FUNCTION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            subject: emailSubject,
            text: plainTextMessage,
            html: htmlMessage,
            businessName,
            businessLogoUrl,
            portalUrl,
            customerName,
          }),
        });

        if (!response.ok) {
          await addDoc(collection(db, "reviewRequests"), {
            businessId: currentUser.uid,
            customerName,
            customerEmail: email,
            channel: "email",
            status: "error",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          console.error(
            "sendReviewRequestEmail failed:",
            response.status,
            await response.text()
          );

          showBanner(
            "Could not send the email request. Please try again.",
            "error"
          );
          return;
        }

        // success
        await addDoc(collection(db, "reviewRequests"), {
          businessId: currentUser.uid,
          customerName,
          customerEmail: email,
          channel: "email",
          status: "sent",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        showBanner("Email request sent successfully ✅", "success");
        reviewRequestForm.reset();
        await loadReviewRequests();
      } catch (err) {
        console.error("Network error while sending review request:", err);

        await addDoc(collection(db, "reviewRequests"), {
          businessId: currentUser.uid,
          customerName,
          customerEmail: email,
          channel: "email",
          status: "error",
          errorMessage: String(err && err.message ? err.message : err),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        showBanner(
          "Could not send the email request. Please try again.",
          "error"
        );
      }
    }
  });
}

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

refreshInsightsBtn?.addEventListener("click", async () => {
  const originalLabel = refreshInsightsBtn.textContent || "Refresh insights";
  try {
    refreshInsightsBtn.disabled = true;
    refreshInsightsBtn.textContent = "Refreshing…";
    await refreshInsightsFromFirestore();
  } catch (err) {
    console.error("Failed to refresh insights:", err);
    alert("Could not refresh insights. Please try again.");
  } finally {
    refreshInsightsBtn.disabled = false;
    refreshInsightsBtn.textContent = originalLabel;
  }
});
refreshInsightsSecondary?.addEventListener("click", () => {
  handleInsightsRefresh(refreshInsightsSecondary);
});

// ---------- ASK FOR REVIEWS BUTTON ----------

askReviewsBtn?.addEventListener("click", () => {
  // בטאב־סרגל – לעבור ל-Review requests
  showView("view-review-requests");

  const section = document.getElementById("view-review-requests");
  if (section) {
    section.scrollIntoView({ behavior: "smooth" });
  }

  // אחרי שהעמוד מוצג – פוקוס לשם הלקוח
  setTimeout(() => {
    reqNameInput?.focus();
  }, 200);
});

// Module marker so the file is treated as an ES module.
export {};
