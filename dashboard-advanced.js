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

const kpiPublicReviews = document.getElementById("kpiPublicReviews");
const kpiAvgRating = document.getElementById("kpiAvgRating");
const kpiLowRating = document.getElementById("kpiLowRating");
const kpiHighRating = document.getElementById("kpiHighRating");
const kpiGoogleTagged = document.getElementById("kpiGoogleTagged");
const kpiSentiment = document.getElementById("kpiSentiment");
const trendChart = document.getElementById("trendChart");
const ratingDistribution = document.getElementById("ratingDistribution");

const aiSummary = document.getElementById("aiSummary");
const aiThemes = document.getElementById("aiThemes");
const aiRecommendations = document.getElementById("aiRecommendations");
const aiSentiment = document.getElementById("aiSentiment");
const refreshInsightsBtn = document.getElementById("refreshInsightsBtn");
const refreshInsightsSecondary = document.getElementById("refreshInsightsSecondary");
const askReviewsBtn = document.getElementById("askReviewsBtn");

const advancedFeedbackBody = document.getElementById("advancedFeedbackBody");
const advancedFeedbackEmpty = document.getElementById("advancedFeedbackEmpty");
const feedbackModal = document.getElementById("feedbackModal");
const feedbackModalClose = document.getElementById("feedbackModalClose");
const modalDate = document.getElementById("modalDate");
const modalCustomer = document.getElementById("modalCustomer");
const modalRating = document.getElementById("modalRating");
const modalType = document.getElementById("modalType");
const modalMessage = document.getElementById("modalMessage");
const modalAiReply = document.getElementById("modalAiReply");
const copyReplyBtn = document.getElementById("copyReplyBtn");
const createTaskBtn = document.getElementById("createTaskBtn");

const automationList = document.getElementById("automationList");
const automationForm = document.getElementById("automationForm");
const automationId = document.getElementById("automationId");
const automationTrigger = document.getElementById("automationTrigger");
const automationChannel = document.getElementById("automationChannel");
const automationDelay = document.getElementById("automationDelay");
const automationNoResponseDays = document.getElementById("automationNoResponseDays");
const automationTemplate = document.getElementById("automationTemplate");
const automationPreview = document.getElementById("automationPreview");
const automationCancel = document.getElementById("automationCancel");
const automationDelete = document.getElementById("automationDelete");

const tasksList = document.getElementById("tasksList");
const taskDetail = document.getElementById("taskDetail");

const notificationForm = document.getElementById("notificationForm");
const prefEmailLow = document.getElementById("prefEmailLow");
const prefEmailHigh = document.getElementById("prefEmailHigh");
const prefEmailGoogle = document.getElementById("prefEmailGoogle");
const prefDaily = document.getElementById("prefDaily");
const prefWeekly = document.getElementById("prefWeekly");
const prefSmsLow = document.getElementById("prefSmsLow");
const prefSmsHigh = document.getElementById("prefSmsHigh");

const reviewRequestForm = document.getElementById("reviewRequestForm");
const reqName = document.getElementById("reqName");
const reqPhone = document.getElementById("reqPhone");
const reqEmail = document.getElementById("reqEmail");
const reqChannel = document.getElementById("reqChannel");
const reviewRequestsBody = document.getElementById("reviewRequestsBody");

let currentUser = null;
let currentProfile = null;
let feedbackCache = [];
let automationCache = [];
let taskCache = [];
let currentModalFeedback = null;

function showBanner(text, type = "info") {
  if (!globalBanner) return;
  globalBannerText.textContent = text;
  globalBanner.className = `global-banner visible ${type}`;
}

function hideBanner() {
  if (!globalBanner) return;
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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }
  currentUser = user;
  if (userEmailDisplay) userEmailDisplay.textContent = user.email || "My account";
  logoutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/auth.html";
  });

  const canContinue = await loadProfile();
  if (!canContinue) return;

  await loadAutomations();
  await loadFeedback();
  await Promise.all([loadTasks(), loadNotifications(), loadReviewRequests(), loadAiInsights()]);
});

async function loadProfile() {
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
  bizNameDisplay.textContent = data.businessName || "Your business";
  bizCategoryText.textContent = data.category || "Category";
  bizUpdatedAt.textContent = formatDate(data.updatedAt);
  bizAvatar.textContent = initialsFromName(data.businessName || "RR");
  if (planBadge) planBadge.textContent = "Advanced plan";
  return true;
}

function filterFeedbackByRange(rangeValue) {
  if (rangeValue === "all") return feedbackCache;
  const days = Number(rangeValue) || 7;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return feedbackCache.filter((f) => {
    const created = f.createdAt?.toMillis ? f.createdAt.toMillis() : new Date(f.createdAt).getTime();
    return created >= cutoff;
  });
}

async function loadFeedback() {
  const ref = collection(db, "feedback");
  const q = query(ref, where("businessId", "==", currentUser.uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  feedbackCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderFeedback();
  evaluateAutomations(feedbackCache);
  updateKPIs();
}

function renderFeedback() {
  if (!advancedFeedbackBody) return;
  advancedFeedbackBody.innerHTML = "";
  const filtered = filterFeedbackByRange(dateRangeSelect?.value || "7");
  if (!filtered.length) {
    advancedFeedbackEmpty.style.display = "block";
    return;
  }
  advancedFeedbackEmpty.style.display = "none";
  filtered.forEach((f) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(f.createdAt)}</td>
      <td>${f.customerName || "Customer"}</td>
      <td><span class="rating-pill ${f.rating >= 4 ? "rating-high" : "rating-low"}">${formatRating(f.rating)}</span></td>
      <td>${f.type || "private"}</td>
      <td>${(f.message || "").slice(0, 80)}${(f.message || "").length > 80 ? "…" : ""}</td>
      <td><button class="btn ghost" data-action="ai" data-id="${f.id}">AI reply</button></td>
    `;
    tr.querySelector("button")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openFeedbackModal(f);
    });
    tr.addEventListener("click", () => openFeedbackModal(f));
    advancedFeedbackBody.appendChild(tr);
  });
}

function updateKPIs() {
  const filtered = filterFeedbackByRange(dateRangeSelect?.value || "7");
  let publicCount = 0;
  let lowCount = 0;
  let highCount = 0;
  let googleCount = 0;
  let ratingSum = 0;
  let sentimentTotal = 0;
  const trendMap = new Map();
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  filtered.forEach((f) => {
    const rating = Number(f.rating || 0);
    distribution[rating] = (distribution[rating] || 0) + 1;
    ratingSum += rating;
    sentimentTotal += sentimentFromRating(rating);
    if (rating >= 4) {
      publicCount += 1;
      highCount += 1;
    } else if (rating <= 3) {
      lowCount += 1;
    }
    if ((f.type || "").toLowerCase() === "google") googleCount += 1;
    const key = formatDateKey(f.createdAt);
    trendMap.set(key, (trendMap.get(key) || 0) + 1);
  });

  const avgRating = filtered.length ? (ratingSum / filtered.length).toFixed(2) : "–";
  const avgSentiment = filtered.length ? (sentimentTotal / filtered.length).toFixed(2) : "–";

  kpiPublicReviews.textContent = publicCount;
  kpiAvgRating.textContent = avgRating;
  kpiLowRating.textContent = lowCount;
  kpiHighRating.textContent = highCount;
  kpiGoogleTagged.textContent = googleCount;
  kpiSentiment.textContent = avgSentiment;

  renderTrendChart(trendMap);
  renderDistribution(distribution, filtered.length || 1);
}

function renderTrendChart(trendMap) {
  if (!trendChart) return;
  const ctx = trendChart.getContext("2d");
  const entries = Array.from(trendMap.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1));
  const labels = entries.map((e) => e[0]);
  const values = entries.map((e) => e[1]);
  const max = Math.max(...values, 5);

  const width = trendChart.width;
  const height = trendChart.height;
  ctx.clearRect(0, 0, width, height);
  if (!entries.length) return;
  const stepX = width / Math.max(values.length - 1, 1);
  ctx.strokeStyle = "rgba(124, 58, 237, 0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * stepX + 10;
    const y = height - (v / max) * (height - 30) - 10;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  values.forEach((v, i) => {
    const x = i * stepX + 10;
    const y = height - (v / max) * (height - 30) - 10;
    ctx.fillStyle = "#c4b5fd";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
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

function keywordsForFeedback(message = "") {
  const lower = message.toLowerCase();
  const tags = [];
  const themes = [
    { key: "price", words: ["price", "expensive", "cheap", "cost"] },
    { key: "speed", words: ["wait", "slow", "fast", "delay"] },
    { key: "staff", words: ["staff", "service", "team", "employee", "support"] },
    { key: "quality", words: ["quality", "excellent", "poor", "bad"] },
    { key: "clean", words: ["clean", "dirty", "mess"] },
  ];
  themes.forEach((t) => {
    if (t.words.some((w) => lower.includes(w))) tags.push(t.key);
  });
  if (!tags.length) tags.push("general");
  return tags;
}

function buildInsights(feedbackList) {
  const themesCount = new Map();
  let sentimentTotal = 0;
  feedbackList.forEach((f) => {
    const tags = keywordsForFeedback(f.message || "");
    tags.forEach((t) => themesCount.set(t, (themesCount.get(t) || 0) + 1));
    sentimentTotal += sentimentFromRating(Number(f.rating || 0));
  });

  const sortedThemes = Array.from(themesCount.entries()).sort((a, b) => b[1] - a[1]);
  const topThemes = sortedThemes.slice(0, 5).map(([label, count]) => ({ label, count }));
  const overallSentiment = feedbackList.length
    ? Number((sentimentTotal / feedbackList.length).toFixed(2))
    : 0;
  const summary = feedbackList.length
    ? `Customers recently mentioned ${topThemes.map((t) => t.label).join(", ")} with an overall sentiment of ${overallSentiment}.`
    : "Not enough feedback yet for insights.";
  const recommendations = topThemes.map((t) => `Act on ${t.label} mentions; respond within the same day.`);
  if (!recommendations.length) recommendations.push("Collect more feedback to unlock insights.");

  return { summary, topThemes, sentimentScore: overallSentiment, recommendations };
}

async function loadAiInsights() {
  const ref = doc(db, "aiInsights", currentUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    renderInsights(snap.data());
  } else {
    await refreshInsights();
  }
}

async function refreshInsights() {
  const feedbackSample = feedbackCache.slice(0, 100);
  const insights = buildInsights(feedbackSample);
  const payload = {
    businessId: currentUser.uid,
    generatedAt: serverTimestamp(),
    summary: insights.summary,
    topThemes: insights.topThemes,
    sentimentScore: insights.sentimentScore,
    topRecommendations: insights.recommendations,
  };
  await setDoc(doc(db, "aiInsights", currentUser.uid), payload, { merge: true });
  renderInsights(payload);
  console.log("AI insights refreshed (heuristic)", payload);
}

function renderInsights(data) {
  aiSummary.textContent = data.summary || "Not enough data yet.";
  aiThemes.innerHTML = "";
  (data.topThemes || []).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = `${t.label} (${t.count})`;
    aiThemes.appendChild(li);
  });
  aiRecommendations.innerHTML = "";
  (data.topRecommendations || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    aiRecommendations.appendChild(li);
  });
  aiSentiment.textContent = data.sentimentScore != null ? data.sentimentScore : "–";
}

function generateAIReply(feedback) {
  const rating = Number(feedback.rating || 0);
  const message = feedback.message || "";
  const keywords = keywordsForFeedback(message).join(", ");
  if (rating <= 3) {
    return `Hi ${feedback.customerName || "there"}, I appreciate you sharing this. I'm sorry about the issues (${keywords}). I want to fix this for you immediately—please reply or call us so we can make it right.`;
  }
  return `Hi ${feedback.customerName || "there"}, thank you for the ${rating}★ feedback! We love hearing about ${keywords}. We'd be grateful if you shared this on Google and we hope to see you again soon.`;
}

function openFeedbackModal(feedback) {
  currentModalFeedback = feedback;
  modalDate.textContent = formatDate(feedback.createdAt);
  modalCustomer.textContent = feedback.customerName || "Customer";
  modalRating.textContent = formatRating(feedback.rating);
  modalType.textContent = feedback.type || "private";
  modalMessage.textContent = feedback.message || "—";
  modalAiReply.value = generateAIReply(feedback);
  feedbackModal.classList.add("visible");
  feedbackModal.setAttribute("aria-hidden", "false");
}

function closeFeedbackModal() {
  feedbackModal.classList.remove("visible");
  feedbackModal.setAttribute("aria-hidden", "true");
}

feedbackModalClose?.addEventListener("click", closeFeedbackModal);
feedbackModal?.addEventListener("click", (e) => {
  if (e.target === feedbackModal) closeFeedbackModal();
});

copyReplyBtn?.addEventListener("click", async () => {
  if (!modalAiReply.value) return;
  try {
    await navigator.clipboard.writeText(modalAiReply.value);
    copyReplyBtn.textContent = "Copied";
    setTimeout(() => (copyReplyBtn.textContent = "Copy reply"), 1200);
  } catch (err) {
    alert("Could not copy reply");
  }
});

createTaskBtn?.addEventListener("click", async () => {
  if (!currentModalFeedback) return;
  const f = currentModalFeedback;
  const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
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
  await loadTasks();
  closeFeedbackModal();
  console.log("Created follow-up task from feedback", f.id);
});

dateRangeSelect?.addEventListener("change", () => {
  renderFeedback();
  updateKPIs();
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
  return fillTemplate(templateOverride ?? automationTemplate.value, sample);
}

automationTemplate?.addEventListener("input", () => {
  automationPreview.textContent = automationPreviewText();
});

automationCancel?.addEventListener("click", () => {
  automationForm.reset();
  automationId.value = "";
  automationPreview.textContent = "Preview will appear here.";
});

automationDelete?.addEventListener("click", async () => {
  if (!automationId.value) return;
  await updateDoc(doc(db, "automations", automationId.value), { deleted: true, enabled: false });
  automationForm.reset();
  automationId.value = "";
  await loadAutomations();
});

automationForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    businessId: currentUser.uid,
    type: automationChannel.value,
    trigger: automationTrigger.value,
    delayHours: automationDelay.value ? Number(automationDelay.value) : null,
    minRating: automationTrigger.value === "low_rating" ? 1 : null,
    maxRating: automationTrigger.value === "low_rating" ? 3 : null,
    enabled: true,
    template: automationTemplate.value,
    channelConfig: {},
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    noResponseDays: automationNoResponseDays.value ? Number(automationNoResponseDays.value) : null,
  };

  if (automationId.value) {
    await updateDoc(doc(db, "automations", automationId.value), payload);
  } else {
    await addDoc(collection(db, "automations"), payload);
  }
  automationForm.reset();
  automationId.value = "";
  await loadAutomations();
});

async function loadAutomations() {
  const q = query(collection(db, "automations"), where("businessId", "==", currentUser.uid));
  const snap = await getDocs(q);
  automationCache = snap.docs
    .filter((d) => !d.data().deleted)
    .map((d) => ({ id: d.id, ...d.data() }));
  renderAutomations();
}

function renderAutomations() {
  automationList.innerHTML = "";
  if (!automationCache.length) {
    automationList.textContent = "No automations yet. Create one to respond automatically.";
    return;
  }
  automationCache.forEach((auto) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <div class="title">${auto.trigger} → ${auto.type}</div>
      <div class="meta">${(auto.template || "").split("\n")[0]}</div>
      <div class="meta">${auto.enabled ? "On" : "Off"} · Updated ${formatDate(auto.updatedAt)}</div>
    `;
    div.addEventListener("click", () => {
      automationId.value = auto.id;
      automationTrigger.value = auto.trigger;
      automationChannel.value = auto.type;
      automationDelay.value = auto.delayHours || "";
      automationNoResponseDays.value = auto.noResponseDays || "";
      automationTemplate.value = auto.template || "";
      automationPreview.textContent = automationPreviewText();
    });
    const toggle = document.createElement("button");
    toggle.className = "btn ghost";
    toggle.textContent = auto.enabled ? "Disable" : "Enable";
    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      await updateDoc(doc(db, "automations", auto.id), { enabled: !auto.enabled, updatedAt: serverTimestamp() });
      await loadAutomations();
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
        }
      }
    });
  });
}

async function loadTasks() {
  const q = query(collection(db, "tasks"), where("businessId", "==", currentUser.uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  taskCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTasks();
}

function renderTasks() {
  tasksList.innerHTML = "";
  if (!taskCache.length) {
    tasksList.textContent = "No tasks yet.";
    return;
  }
  taskCache.forEach((t) => {
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
  const dueMs = task.dueDate.toMillis ? task.dueDate.toMillis() : new Date(task.dueDate).getTime();
  return dueMs < Date.now();
}

function showTaskDetail(task) {
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
    await updateDoc(doc(db, "tasks", task.id), { status: statusSelect.value, updatedAt: serverTimestamp() });
    await loadTasks();
  });

  const detail = document.createElement("div");
  detail.innerHTML = `
    <p class="title">${task.title}</p>
    <p class="meta">Priority: ${task.priority} · Due: ${task.dueDate ? formatDate(task.dueDate) : "None"}</p>
    <p>${task.description || ""}</p>
    <div class="meta">Linked rating: ${feedback ? formatRating(feedback.rating) : "—"}</div>
    <div class="meta">Customer: ${feedback?.customerName || ""}</div>
  `;
  taskDetail.appendChild(detail);
  taskDetail.appendChild(statusSelect);
  const aiNext = document.createElement("div");
  aiNext.className = "ai-summary";
  aiNext.textContent = generateAIReply(feedback || { rating: 3, customerName: "customer" });
  taskDetail.appendChild(aiNext);
}

notificationForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    businessId: currentUser.uid,
    emailAlertsLowRating: prefEmailLow.checked,
    emailAlertsHighRating: prefEmailHigh.checked,
    emailAlertsNewGoogleReview: prefEmailGoogle.checked,
    smsAlertsLowRating: prefSmsLow.checked,
    smsAlertsHighRating: prefSmsHigh.checked,
    dailySummaryEmail: prefDaily.checked,
    weeklySummaryEmail: prefWeekly.checked,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, "notificationPrefs", currentUser.uid), payload, { merge: true });
  showBanner("Notification preferences saved", "success");
});

async function loadNotifications() {
  const snap = await getDoc(doc(db, "notificationPrefs", currentUser.uid));
  if (!snap.exists()) return;
  const d = snap.data();
  prefEmailLow.checked = !!d.emailAlertsLowRating;
  prefEmailHigh.checked = !!d.emailAlertsHighRating;
  prefEmailGoogle.checked = !!d.emailAlertsNewGoogleReview;
  prefSmsLow.checked = !!d.smsAlertsLowRating;
  prefSmsHigh.checked = !!d.smsAlertsHighRating;
  prefDaily.checked = !!d.dailySummaryEmail;
  prefWeekly.checked = !!d.weeklySummaryEmail;
}

reviewRequestForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    businessId: currentUser.uid,
    customerName: reqName.value,
    customerPhone: reqPhone.value || null,
    customerEmail: reqEmail.value || null,
    channel: reqChannel.value,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await addDoc(collection(db, "reviewRequests"), payload);
  console.log(`Would send ${payload.channel} review request to`, payload.customerName);
  reviewRequestForm.reset();
  await loadReviewRequests();
});

askReviewsBtn?.addEventListener("click", () => {
  reviewRequestForm?.scrollIntoView({ behavior: "smooth" });
  reqName?.focus();
});

async function loadReviewRequests() {
  const q = query(
    collection(db, "reviewRequests"),
    where("businessId", "==", currentUser.uid),
    orderBy("createdAt", "desc"),
    limit(10)
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  reviewRequestsBody.innerHTML = "";
  if (!rows.length) {
    reviewRequestsBody.innerHTML = '<tr><td colspan="4">No review requests yet.</td></tr>';
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.customerName || "Customer"}</td>
      <td>${r.channel}</td>
      <td><span class="rating-chip-small">${r.status}</span></td>
      <td><button class="btn ghost" data-id="${r.id}">Mark sent</button></td>
    `;
    tr.querySelector("button")?.addEventListener("click", async () => {
      await updateDoc(doc(db, "reviewRequests", r.id), { status: "sent", updatedAt: serverTimestamp() });
      console.log(`Marked request ${r.id} as sent`);
      await loadReviewRequests();
    });
    reviewRequestsBody.appendChild(tr);
  });
}

refreshInsightsBtn?.addEventListener("click", refreshInsights);
refreshInsightsSecondary?.addEventListener("click", refreshInsights);

if (feedbackModal) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFeedbackModal();
  });
}

export {};
