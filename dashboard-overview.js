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
const heroMeta = document.querySelector(".hero-meta");
const dateRangeSelect = document.getElementById("dateRangeSelect");

const insightTitle = document.getElementById("insightTitle");
const insightText = document.getElementById("insightText");

const kpiTotal = document.getElementById("kpiTotalReviews");
const kpiPosNeg = document.getElementById("kpiPositiveNegative");
const kpiSentiment = document.getElementById("kpiAvgSentiment");
const kpiPending = document.getElementById("kpiPendingFollowups");
const kpiConversion = document.getElementById("kpiConversionGoogle");

let feedbackCache = [];

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
  const filtered = filterByRange(feedbackCache, rangeValue);
  const prevBounds = getPrevPeriodBounds(rangeValue);
  const prev = filterByBounds(feedbackCache, prevBounds.start, prevBounds.end);

  const currentSent = sentimentForList(filtered);
  const prevSent = sentimentForList(prev);

  let title = "Sentiment stable";
  let desc = "Collect more feedback to see trendlines.";

  if (currentSent !== null) {
    if (prevSent === null || currentSent > prevSent + 0.05) {
      title = "Sentiment improving";
      const keyword = topKeyword(
        filtered.filter((f) => (f.rating || 0) >= 4).map((f) => f.message)
      );
      desc = `Customers mention "${keyword}" — keep momentum with follow-ups.`;
    } else if (prevSent < currentSent + 0.05 && prevSent > currentSent - 0.05) {
      title = "Sentiment stable";
      desc = "Scores are steady. Keep inviting happy customers to review you on Google.";
    } else if (prevSent !== null) {
      title = "Sentiment down";
      const keyword = topKeyword(
        filtered.filter((f) => (f.rating || 0) <= 3).map((f) => f.message)
      );
      desc = `Customers mention "${keyword}" — consider reaching out to recent jobs.`;
    }
  }

  if (insightTitle) insightTitle.textContent = title;
  if (insightText) insightText.textContent = desc;
}

function updateKPIs(rangeValue) {
  const filtered = filterByRange(feedbackCache, rangeValue);
  const total = filtered.length;
  const positive = filtered.filter((f) => Number(f.rating) >= 4).length;
  const pending = filtered.filter((f) => {
    const status = (f.status || "").toLowerCase();
    return ["new", "needs_reply", "followup", "open", "pending"].includes(status);
  }).length;
  const googleCount = filtered.filter((f) => (f.type || f.source) === "google").length;

  const percentPositive = total ? (positive / total) * 100 : NaN;
  const sentimentAvg = sentimentForList(filtered);
  const conversionRate = total ? (googleCount / total) * 100 : NaN;

  if (kpiTotal) kpiTotal.textContent = total || "0";
  if (kpiPosNeg) kpiPosNeg.textContent = total ? `${formatPercent(percentPositive)} positive` : "—";
  if (kpiSentiment) kpiSentiment.textContent =
    sentimentAvg === null ? "—" : sentimentAvg.toFixed(2);
  if (kpiPending) kpiPending.textContent = pending || "0";
  if (kpiConversion) kpiConversion.textContent =
    Number.isNaN(conversionRate) ? "—" : `${formatPercent(conversionRate)} to Google`;
}

async function loadFeedback(uid) {
  try {
    const ref = collection(db, "feedback");
    const q = query(ref, where("businessId", "==", uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    feedbackCache = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
    updateKPIs(rangeValue);
    updateInsight(rangeValue);
  });

  heroMeta?.addEventListener("click", () => {
    window.location.href = "settings.html#business";
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }

  await loadFeedback(user.uid);
  updateKPIs(dateRangeSelect?.value || "7");
  updateInsight(dateRangeSelect?.value || "7");
});

listenForUser(async ({ profile, subscription }) => {
  updateBusinessIdentity(profile);
  applyPlanBadge(subscription?.planId || "starter");
  attachEvents();
});
