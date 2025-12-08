import {
  auth,
  onAuthStateChanged,
  db,
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "./firebase-config.js";
import {
  listenForUser,
  initialsFromName,
  formatDate,
} from "./session-data.js";
import { applyPlanBadge } from "./topbar-menu.js";

const heroName = document.getElementById("heroBusinessName");
const heroStatusChip = document.getElementById("heroStatusChip");
const heroIndustryChip = document.getElementById("heroIndustryChip");
const heroUpdated = document.getElementById("heroUpdatedText");
const heroAvatar = document.getElementById("heroAvatar");
const heroMeta = document.getElementById("heroMeta");
const dateRangeSelect = document.getElementById("dateRangeSelect");
const refreshOverviewBtn = document.getElementById("refreshOverview");
const askReviewsBtn = document.getElementById("askForReviews");

const insightTitle = document.getElementById("insightTitle");
const insightText = document.getElementById("insightText");

const kpiTotal = document.getElementById("kpiTotalReviews");
const kpiPosNeg = document.getElementById("kpiPositiveNegative");
const kpiSentiment = document.getElementById("kpiAvgSentiment");
const kpiPending = document.getElementById("kpiPendingFollowups");
const kpiConversion = document.getElementById("kpiConversionGoogle");

const reviewsChart = document.getElementById("reviewsChart");
const ratingEls = {
  1: document.getElementById("rating1"),
  2: document.getElementById("rating2"),
  3: document.getElementById("rating3"),
  4: document.getElementById("rating4"),
  5: document.getElementById("rating5"),
};

const guidanceInbox = document.getElementById("guidanceInbox");
const guidanceFollowups = document.getElementById("guidanceFollowups");
const guidanceAutomations = document.getElementById("guidanceAutomations");

let feedbackCache = [];
let currentUserId = null;
let latestRangeData = null;

function formatPercent(value) {
  if (Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

function safeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function filterByRange(list, days) {
  if (!days || days === "all") return list;
  const countDays = Number(days) || 7;
  const now = Date.now();
  const start = now - countDays * 24 * 60 * 60 * 1000;
  return list.filter((item) => {
    const created = item.createdAt?.toMillis
      ? item.createdAt.toMillis()
      : new Date(item.createdAt || item.updatedAt || now).getTime();
    return created >= start;
  });
}

function getPrevPeriodBounds(days) {
  const countDays = Number(days) || 7;
  const end = Date.now() - countDays * 24 * 60 * 60 * 1000;
  const start = end - countDays * 24 * 60 * 60 * 1000;
  return { start, end };
}

function filterByBounds(list, start, end) {
  return list.filter((item) => {
    const created = item.createdAt?.toMillis
      ? item.createdAt.toMillis()
      : new Date(item.createdAt || item.updatedAt || Date.now()).getTime();
    return created >= start && created <= end;
  });
}

function topKeyword(messages = []) {
  const stopwords = new Set([
    "the",
    "and",
    "that",
    "with",
    "have",
    "this",
    "from",
    "your",
    "about",
    "their",
    "would",
    "could",
    "there",
    "were",
    "they",
    "them",
    "just",
    "really",
    "service",
    "great",
    "good",
  ]);
  const counts = new Map();
  messages.forEach((msg) => {
    const words = (msg || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopwords.has(w));
    words.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
  });
  const [word] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] || [];
  return word || "recent work";
}

function sentimentForList(list) {
  if (!list.length) return null;
  const scores = list.map((item) => {
    if (Number.isFinite(item.sentimentScore)) return item.sentimentScore;
    if (item.rating) return Number((Number(item.rating) - 3).toFixed(2));
    return 0;
  });
  const total = scores.reduce((sum, val) => sum + safeNumber(val), 0);
  return Number((total / scores.length).toFixed(2));
}

function updateInsight(rangeValue) {
  const filtered = latestRangeData?.range === rangeValue
    ? latestRangeData.filtered
    : filterByRange(feedbackCache, rangeValue);
  const prevBounds = getPrevPeriodBounds(rangeValue);
  const prev = filterByBounds(feedbackCache, prevBounds.start, prevBounds.end);

  const currentSent = sentimentForList(filtered);
  const prevSent = sentimentForList(prev);

  let title = "Sentiment stable";
  let desc = "Collect more feedback to see trendlines.";
  const delta =
    currentSent !== null && prevSent !== null ? Number((currentSent - prevSent).toFixed(2)) : null;

  if (currentSent !== null) {
    if (prevSent === null || currentSent > prevSent + 0.05) {
      title = "Sentiment improving";
      const keyword = topKeyword(
        filtered
          .filter((f) => (f.rating || 0) >= 4)
          .map((f) => f.message || f.text || "")
      );
      desc = `Up ${delta ?? 0} vs prior period. Customers mention "${keyword}" — keep momentum with follow-ups.`;
    } else if (prevSent < currentSent + 0.05 && prevSent > currentSent - 0.05) {
      title = "Sentiment stable";
      desc = "Scores are steady. Keep inviting happy customers to review you on Google.";
    } else if (prevSent !== null) {
      title = "Sentiment down";
      const keyword = topKeyword(
        filtered
          .filter((f) => (f.rating || 0) <= 3)
          .map((f) => f.message || f.text || "")
      );
      desc = `Down ${Math.abs(delta ?? 0)} vs prior period. Customers mention "${keyword}" — consider reaching out to recent jobs.`;
    }
  }

  if (insightTitle) insightTitle.textContent = title;
  if (insightText) insightText.textContent = desc;
}

function buildRangeData(rangeValue) {
  const filtered = filterByRange(feedbackCache, rangeValue);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byDay = new Map();

  let positive = 0;
  let pending = 0;
  let googleCount = 0;

  filtered.forEach((f) => {
    const rating = Number(f.rating) || 0;
    if (rating >= 1 && rating <= 5) distribution[rating] += 1;
    if (rating >= 4) positive += 1;
    const status = (f.status || "").toLowerCase();
    if (["new", "needs_reply", "followup", "open", "pending"].includes(status)) pending += 1;
    if ((f.type || f.source) === "google") googleCount += 1;

    const created = f.createdAt?.toMillis
      ? f.createdAt.toMillis()
      : new Date(f.createdAt || f.updatedAt || Date.now()).getTime();
    const dayKey = new Date(created).toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1);
  });

  const reviewsByDay = Array.from(byDay.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const total = filtered.length;
  const sentimentAvg = sentimentForList(filtered);
  const percentPositive = total ? (positive / total) * 100 : NaN;
  const conversionRate = total ? (googleCount / total) * 100 : NaN;

  const data = {
    range: rangeValue,
    filtered,
    total,
    positive,
    pending,
    googleCount,
    distribution,
    reviewsByDay,
    sentimentAvg,
    percentPositive,
    conversionRate,
  };

  latestRangeData = data;
  return data;
}

function updateKPIs(rangeData) {
  if (!rangeData) return;
  const {
    total,
    percentPositive,
    sentimentAvg,
    pending,
    conversionRate,
  } = rangeData;

  if (kpiTotal) kpiTotal.textContent = total || "0";
  if (kpiPosNeg) kpiPosNeg.textContent = total ? `${formatPercent(percentPositive)} positive` : "—";
  if (kpiSentiment) kpiSentiment.textContent =
    sentimentAvg === null ? "—" : sentimentAvg.toFixed(2);
  if (kpiPending) kpiPending.textContent = pending || "0";
  if (kpiConversion) kpiConversion.textContent =
    Number.isNaN(conversionRate) ? "—" : `${formatPercent(conversionRate)} to Google`;
}

async function loadFeedback(uid) {
  currentUserId = uid;
  try {
    const ref = collection(db, "feedback");
    const q = query(ref, where("businessId", "==", uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    feedbackCache = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const nestedRef = collection(db, "businessProfiles", uid, "feedback");
    const nestedSnap = await getDocs(nestedRef);
    nestedSnap.forEach((doc) => feedbackCache.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error("[overview] Failed to load feedback", err);
    feedbackCache = [];
  }
}

function updateBusinessIdentity(profile) {
  if (!profile) return;
  const name = profile.businessName || profile.name || "Your business";
  const industry = profile.industry || profile.category || "Local services";
  const status = (profile.status || "Live").toString();

  if (heroName) heroName.textContent = name;
  if (heroIndustryChip) heroIndustryChip.textContent = industry;
  if (heroStatusChip) heroStatusChip.textContent = status;
  if (heroUpdated) heroUpdated.textContent = profile.updatedAt
    ? `Updated ${formatDate(profile.updatedAt)}`
    : "Updated recently";
  if (heroAvatar) heroAvatar.textContent = initialsFromName(name);
}

function attachEvents() {
  dateRangeSelect?.addEventListener("change", () => {
    const rangeValue = dateRangeSelect.value || "7";
    refreshOverview(rangeValue);
  });

  heroMeta?.addEventListener("click", () => {
    window.location.href = "settings.html#business";
  });

  refreshOverviewBtn?.addEventListener("click", async () => {
    if (!currentUserId) return;
    await loadFeedback(currentUserId);
    refreshOverview(dateRangeSelect?.value || "7");
  });

  askReviewsBtn?.addEventListener("click", () => {
    window.location.href = "portal.html";
  });

  guidanceInbox?.addEventListener("click", () => {
    window.location.href = "inbox.html";
  });

  guidanceFollowups?.addEventListener("click", () => {
    window.location.href = "follow-ups.html";
  });

  guidanceAutomations?.addEventListener("click", () => {
    window.location.href = "automations.html";
  });
}

function renderReviewsOverTime(rangeData) {
  if (!reviewsChart) return;
  const { total, reviewsByDay } = rangeData || {};
  const chartCard = reviewsChart.closest(".chart-card");
  reviewsChart.innerHTML = "";

  if (!total) {
    reviewsChart.textContent = "No reviews yet for this period";
    return;
  }

  const series = reviewsByDay?.length ? reviewsByDay : [{ date: new Date().toISOString().slice(0, 10), count: total }];
  if (!reviewsByDay?.length && total > 0) {
    console.warn("[overview] Missing chart data despite total reviews > 0; using fallback.");
  }

  const max = Math.max(...series.map((d) => d.count), 1);
  const list = document.createElement("div");
  list.className = "chart-bars";

  series.forEach(({ date, count }) => {
    const row = document.createElement("div");
    row.className = "chart-bar-row";

    const label = document.createElement("span");
    label.className = "chart-bar-label";
    const labelDate = new Date(`${date}T00:00:00`);
    label.textContent = labelDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const track = document.createElement("div");
    track.className = "chart-bar-track";

    const fill = document.createElement("div");
    fill.className = "chart-bar-fill";
    fill.style.width = `${Math.max((count / max) * 100, 8)}%`;

    const value = document.createElement("span");
    value.className = "chart-bar-value";
    value.textContent = count;

    track.appendChild(fill);
    row.append(label, track, value);
    list.appendChild(row);
  });

  reviewsChart.appendChild(list);
  if (chartCard) chartCard.classList.add("chart-card--has-data");
}

function renderRatingBreakdown(rangeData) {
  if (!rangeData) return;
  const { distribution, total } = rangeData;
  Object.keys(ratingEls).forEach((key) => {
    const el = ratingEls[key];
    if (!el) return;
    const count = distribution?.[key] || 0;
    const percent = total ? Math.round((count / total) * 100) : 0;
    el.textContent = `${percent}%`;
  });
}

function refreshOverview(rangeValue) {
  const data = buildRangeData(rangeValue);
  updateKPIs(data);
  updateInsight(rangeValue);
  renderReviewsOverTime(data);
  renderRatingBreakdown(data);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  await loadFeedback(user.uid);
  refreshOverview(dateRangeSelect?.value || "7");
});

listenForUser(async ({ profile, subscription }) => {
  updateBusinessIdentity(profile);
  applyPlanBadge(subscription?.planId || "starter");
  attachEvents();
});
