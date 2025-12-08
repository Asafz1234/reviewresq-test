import {
  auth,
  onAuthStateChanged,
  db,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  addDoc,
  doc,
  onSnapshot,
} from "./firebase-config.js";
import { listenForUser, formatDate, initialsFromName, hasPlanFeature } from "./session-data.js";
import { applyPlanBadge } from "./topbar-menu.js";

const statusFilter = document.getElementById("statusFilter");
const dateFilter = document.getElementById("dateFilter");
const threadListEl = document.getElementById("threadList");
const detailEl = document.getElementById("threadDetail");

let threads = [];
let filteredThreads = [];
let selectedThreadId = null;
let currentUserId = null;
let currentPlanTier = "starter";
const aiConversationListeners = new Map();

const STATUS_LABELS = {
  open: "Open",
  resolved: "Resolved",
  snoozed: "Snoozed",
  ai_agent_active: "AI Agent",
  handled_by_ai: "Handled by AI",
};

function formatRelative(date) {
  if (!date) return "Recently";
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function ratingBadge(rating) {
  const safe = Number(rating) || 0;
  if (safe >= 4) return "badge badge-success";
  if (safe <= 2) return "badge badge-warning";
  return "badge";
}

function normalizeThread(raw, ref) {
  const created = raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(raw.createdAt || Date.now());
  const updated = raw.updatedAt?.toDate ? raw.updatedAt.toDate() : created;
  const status = (raw.status || "open").toLowerCase();
  const messages = Array.isArray(raw.messages) ? raw.messages : [];

  if (!messages.length && (raw.text || raw.message)) {
    messages.push({
      author: raw.customerName || raw.reviewerName || "Customer",
      role: "customer",
      text: raw.text || raw.message,
      timestamp: created,
    });
  }

  return {
    id: raw.id,
    ref,
    customerName: raw.customerName || raw.reviewerName || raw.name || "Customer",
    rating: raw.rating || raw.score || 0,
    status,
    updatedAt: updated,
    createdAt: created,
    preview: raw.text || raw.message || (messages[0]?.text ?? ""),
    source: raw.source || raw.type || "portal",
    sentimentScore: raw.sentimentScore,
    automationState: raw.automationState,
    aiConversationId: raw.aiConversationId,
    reviewText: raw.text || raw.message || (messages[0]?.text ?? ""),
    messages,
  };
}

function deriveThreadSentiment(thread) {
  if (typeof thread.sentimentScore === "number") {
    return thread.sentimentScore;
  }
  const rating = Number(thread.rating || 0);
  if (rating) return Number((rating - 3).toFixed(2));
  return 0;
}

function isUnhappyThread(thread) {
  const rating = Number(thread.rating || 0);
  const sentimentScore = deriveThreadSentiment(thread);
  return rating <= 3 || sentimentScore <= 0;
}

function summarizeIssue(text = "") {
  const trimmed = text.trim();
  if (!trimmed) return "the issue you ran into";
  if (trimmed.length <= 140) return trimmed;
  return `${trimmed.slice(0, 137)}...`;
}

function extractPositiveSnippet(text = "") {
  const lowered = text.toLowerCase();
  const pivot = lowered.indexOf("but ");
  if (pivot > 0) {
    return text.slice(0, pivot).trim();
  }
  return "the parts that went well";
}

function buildTemplateReply(thread) {
  const rating = Number(thread.rating || 0);
  const sentimentScore = deriveThreadSentiment(thread);
  const name = thread.customerName || "there";
  const reviewText = thread.reviewText || thread.preview || "";
  const issueSummary = summarizeIssue(reviewText);
  const positiveSnippet = extractPositiveSnippet(reviewText);

  if (rating >= 4 || sentimentScore > 0.15) {
    return `Thank you so much for the ${Math.round(rating) || 5}★ review, ${name}! We're thrilled you had a great experience and hope to serve you again soon.`;
  }

  if (rating === 3 || (sentimentScore <= 0.15 && sentimentScore >= -0.15)) {
    return `Thanks for the feedback, ${name}. I'm glad to hear ${positiveSnippet}, but I'm sorry that ${issueSummary}. Your feedback helps us improve and we'll be working on this right away.`;
  }

  return `Hi ${name}, I'm really sorry to hear that ${issueSummary}. This isn't the experience we want for our customers. I'd love the chance to make this right — please reply here or email support@reviewresq.com so we can help.`;
}

async function generateAiReply(thread) {
  const fallback = () => {
    const rating = Number(thread.rating || 0);
    if (rating <= 2) {
      return `Hi ${thread.customerName || "there"}, I'm sorry for the trouble and want to make this right. Please reply here so we can help immediately.`;
    }
    if (rating >= 5) {
      return `Thank you for the 5★ review, ${thread.customerName || "there"}! We appreciate you choosing us.`;
    }
    return buildTemplateReply(thread);
  };

  try {
    const suggestion = buildTemplateReply(thread);
    if (!suggestion) return fallback();
    return suggestion;
  } catch (err) {
    console.error("[inbox] AI reply failed, using fallback", err);
    return fallback();
  }
}

async function loadThreads(uid) {
  const results = [];
  try {
    const baseRef = collection(db, "feedback");
    const q = query(baseRef, where("businessId", "==", uid), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    snap.forEach((doc) => results.push(normalizeThread({ id: doc.id, ...doc.data() }, doc.ref)));
  } catch (err) {
    console.warn("[inbox] primary fetch failed", err);
  }

  try {
    const nestedRef = collection(db, "businessProfiles", uid, "feedback");
    const nestedSnap = await getDocs(nestedRef);
    nestedSnap.forEach((doc) => results.push(normalizeThread({ id: doc.id, ...doc.data() }, doc.ref)));
  } catch (err) {
    console.warn("[inbox] nested fetch failed", err);
  }

  threads = results;
  applyFilters();
}

function applyFilters() {
  const statusValue = statusFilter?.value || "all";
  const days = dateFilter?.value || "30";
  const now = Date.now();
  const start = days === "all" ? 0 : now - Number(days) * 24 * 60 * 60 * 1000;

  filteredThreads = threads
    .filter((thread) => {
      const updated = thread.updatedAt?.getTime ? thread.updatedAt.getTime() : now;
      const withinRange = updated >= start;
      const matchesStatus =
        statusValue === "all" || (statusValue === "open" && thread.status !== "resolved") || thread.status === statusValue;
      return withinRange && matchesStatus;
    })
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

  renderThreadList();
  if (selectedThreadId) {
    const active = filteredThreads.find((t) => t.id === selectedThreadId);
    if (active) {
      renderThreadDetail(active);
      return;
    }
    selectedThreadId = null;
  }
  renderEmptyDetail();
}

function renderThreadList() {
  if (!threadListEl) return;
  threadListEl.innerHTML = "";

  if (!filteredThreads.length) {
    const empty = document.createElement("p");
    empty.className = "page-subtitle";
    empty.textContent = "No conversations match these filters.";
    threadListEl.appendChild(empty);
    return;
  }

  filteredThreads.forEach((thread) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-item";
    if (thread.id === selectedThreadId) item.classList.add("active");

    const meta = document.createElement("div");
    meta.className = "meta-row";

    const nameChip = document.createElement("span");
    nameChip.className = "badge";
    nameChip.textContent = thread.customerName;

    const ratingChip = document.createElement("span");
    ratingChip.className = ratingBadge(thread.rating);
    ratingChip.textContent = `${Math.round(thread.rating || 0)}★`;

    const statusChip = document.createElement("span");
    statusChip.className = "badge";
    statusChip.textContent = STATUS_LABELS[thread.status] || thread.status || "Open";

    const updated = document.createElement("span");
    updated.className = "caption";
    updated.textContent = `Updated ${formatRelative(thread.updatedAt)}`;

    meta.append(nameChip, ratingChip, statusChip, updated);

    const preview = document.createElement("p");
    preview.className = "page-subtitle";
    preview.textContent = thread.preview || "(No message)";

    item.append(meta, preview);
    item.addEventListener("click", () => selectThread(thread.id));
    threadListEl.appendChild(item);
  });
}

function renderEmptyDetail() {
  if (!detailEl) return;
  detailEl.innerHTML = `
    <div class="detail-empty">
      <h3 class="card-title">Conversation details</h3>
      <p class="card-sub">Select a conversation on the left to view messages and reply.</p>
    </div>
  `;
}

function attachAiConversationListener(thread) {
  const existing = aiConversationListeners.get(thread.id);
  if (existing) existing();
  if (!thread.aiConversationId) return;

  const ref = doc(db, "ai_conversations", thread.aiConversationId);
  const unsub = onSnapshot(ref, (snap) => {
    const data = snap.data();
    if (!data) return;

    const mappedMessages = (data.messages || []).map((msg) => ({
      author: msg.sender === "ai" ? "AI Agent" : thread.customerName || "Customer",
      role: msg.sender === "ai" ? "business" : "customer",
      text: msg.message_text || msg.text || "",
      timestamp: msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp || Date.now()),
    }));

    if (mappedMessages.length) {
      thread.messages = mappedMessages;
      thread.preview = mappedMessages[mappedMessages.length - 1].text || thread.preview;
    }

    if (data.status === "resolved") {
      thread.status = "handled_by_ai";
    }

    thread.updatedAt = new Date();
    if (selectedThreadId === thread.id) {
      renderThreadDetail(thread);
    }
    renderThreadList();
  });

  aiConversationListeners.set(thread.id, unsub);
}

function renderThreadDetail(thread) {
  if (!detailEl) return;
  detailEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "detail-header";

  const left = document.createElement("div");
  left.className = "detail-meta";

  const avatar = document.createElement("div");
  avatar.className = "brand-mark";
  avatar.textContent = initialsFromName(thread.customerName);
  avatar.title = thread.customerName;

  const title = document.createElement("h3");
  title.className = "detail-title";
  title.textContent = thread.customerName;

  const metaChips = document.createElement("div");
  metaChips.className = "detail-meta";

  const rating = document.createElement("span");
  rating.className = ratingBadge(thread.rating);
  rating.textContent = `${Math.round(thread.rating || 0)}★`;

  const statusChip = document.createElement("span");
  statusChip.className = "badge";
  statusChip.textContent = STATUS_LABELS[thread.status] || thread.status || "Open";

  const updated = document.createElement("span");
  updated.className = "caption";
  updated.textContent = `Updated ${formatDate(thread.updatedAt)}`;

  metaChips.append(rating, statusChip, updated);
  left.append(avatar, title, metaChips);

  const actions = document.createElement("div");
  actions.className = "detail-actions";

  const resolveBtn = document.createElement("button");
  resolveBtn.className = "btn btn-secondary";
  resolveBtn.textContent = thread.status === "resolved" ? "Reopen" : "Mark as resolved";
  resolveBtn.addEventListener("click", () => toggleResolved(thread));

  actions.append(resolveBtn);

  header.append(left, actions);

  const convo = document.createElement("div");
  convo.className = "conversation-body";
  const sortedMessages = [...(thread.messages || [])].sort((a, b) => {
    const aTime = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || thread.updatedAt).getTime();
    const bTime = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || thread.updatedAt).getTime();
    return aTime - bTime;
  });

  if (!sortedMessages.length) {
    const empty = document.createElement("p");
    empty.className = "page-subtitle";
    empty.textContent = "No messages yet.";
    convo.appendChild(empty);
  } else {
    sortedMessages.forEach((msg) => {
      const row = document.createElement("div");
      row.className = "message-row";

      const head = document.createElement("div");
      head.className = "message-header";
      const author = document.createElement("span");
      author.textContent = msg.author || (msg.role === "business" ? "You" : "Customer");
      const ts = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp || thread.updatedAt);
      const time = document.createElement("span");
      time.textContent = formatRelative(ts);
      head.append(author, time);

      const body = document.createElement("p");
      body.className = "message-text";
      body.textContent = msg.text || "(No text)";

      row.append(head, body);
      convo.appendChild(row);
    });
  }

  const replyBox = document.createElement("div");
  replyBox.className = "reply-box";
  const textarea = document.createElement("textarea");
  textarea.className = "textarea";
  textarea.rows = 3;
  textarea.placeholder = "Write a reply";
  textarea.id = "replyBox";

  const unhappy = isUnhappyThread(thread);
  const aiAgentEnabled = hasPlanFeature("aiAgent");

  if (unhappy && aiAgentEnabled) {
    const hint = document.createElement("div");
    hint.className = "card-sub";
    hint.textContent =
      "This looks like an unhappy customer. Your AI Agent can handle the follow-up automatically.";
    replyBox.appendChild(hint);
  }

  const actionRow = document.createElement("div");
  actionRow.className = "detail-actions";
  const sendBtn = document.createElement("button");
  sendBtn.className = unhappy && aiAgentEnabled ? "btn btn-secondary" : "btn btn-primary";
  sendBtn.textContent = "Send reply";
  sendBtn.addEventListener("click", () => sendReply(thread, textarea));

  const aiBtn = document.createElement("button");
  aiBtn.className = "btn btn-secondary";
  aiBtn.textContent = "Reply with AI";
  aiBtn.addEventListener("click", async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = "Generating…";
    try {
      const suggestion = await generateAiReply({
        ...thread,
        planTier: currentPlanTier,
      });
      textarea.value = suggestion;
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = "Reply with AI";
    }
  });

  if (unhappy && aiAgentEnabled) {
    const handoffBtn = document.createElement("button");
    handoffBtn.className = "btn btn-primary";
    handoffBtn.textContent = thread.status === "ai_agent_active" ? "AI Agent active" : "Hand off to AI Agent";
    handoffBtn.disabled = thread.status === "ai_agent_active";
    handoffBtn.addEventListener("click", () => handoffToAiAgent(thread, handoffBtn, textarea));
    actionRow.append(handoffBtn, aiBtn, sendBtn);
  } else if (unhappy) {
    const upsell = document.createElement("button");
    upsell.className = "btn btn-primary";
    upsell.textContent = "AI Agent (upgrade)";
    upsell.addEventListener("click", () => {
      alert("Automatic AI Agent recovery is part of the Pro AI Suite. Upgrade to let the AI handle unhappy customers for you.");
      window.location.href = "account.html";
    });
    actionRow.append(upsell, aiBtn, sendBtn);
  } else {
    actionRow.append(sendBtn, aiBtn);
  }
  replyBox.append(textarea, actionRow);

  detailEl.append(header, convo, replyBox);
}

async function selectThread(id) {
  selectedThreadId = id;
  const thread = filteredThreads.find((t) => t.id === id);
  if (thread) {
    attachAiConversationListener(thread);
    renderThreadDetail(thread);
  }
  renderThreadList();
}

async function toggleResolved(thread) {
  try {
    const newStatus = thread.status === "resolved" ? "open" : "resolved";
    await updateDoc(thread.ref, {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
    thread.status = newStatus;
    thread.updatedAt = new Date();
    applyFilters();
  } catch (err) {
    console.error("[inbox] failed to update status", err);
  }
}

async function sendReply(thread, textarea) {
  const message = (textarea.value || "").trim();
  if (!message) return;
  try {
    await updateDoc(thread.ref, {
      messages: arrayUnion({
        author: "Business",
        role: "business",
        text: message,
        timestamp: serverTimestamp(),
      }),
      updatedAt: serverTimestamp(),
      status: "resolved",
    });
    thread.messages = thread.messages || [];
    thread.messages.push({
      author: "Business",
      role: "business",
      text: message,
      timestamp: new Date(),
    });
    thread.status = "resolved";
    thread.updatedAt = new Date();
    textarea.value = "";
    applyFilters();
    selectThread(thread.id);
  } catch (err) {
    console.error("[inbox] failed to send reply", err);
  }
}

async function handoffToAiAgent(thread, button, textarea) {
  if (!thread?.ref) return;
  const nowIso = new Date().toISOString();
  const sentimentScore = deriveThreadSentiment(thread);
  button.disabled = true;
  button.textContent = "Handing off…";

  const baseMessages = (thread.messages || []).map((msg) => ({
    sender: msg.role === "business" ? "business" : "customer",
    message_text: msg.text || "",
    timestamp: msg.timestamp?.toDate ? msg.timestamp.toDate().toISOString() : msg.timestamp || nowIso,
  }));

  const aiNote = {
    sender: "ai",
    message_text: "AI Agent is reviewing this case now and will follow up automatically.",
    timestamp: nowIso,
  };

  try {
    let conversationId = thread.aiConversationId;
    if (conversationId) {
      await updateDoc(doc(db, "ai_conversations", conversationId), {
        status: "open",
        updatedAt: serverTimestamp(),
        messages: arrayUnion(aiNote),
      });
    } else {
      const conversationRef = await addDoc(collection(db, "ai_conversations"), {
        businessId: currentUserId,
        customerName: thread.customerName || "Customer",
        rating: thread.rating || 1,
        status: "open",
        sentiment: sentimentScore,
        issueType: "Inbox handoff",
        messages: [...baseMessages, aiNote].slice(-20),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        sourceFeedbackId: thread.id,
      });
      conversationId = conversationRef.id;
    }

    await updateDoc(thread.ref, {
      status: "ai_agent_active",
      automationState: "IN_AI",
      aiConversationId: conversationId,
      updatedAt: serverTimestamp(),
      messages: arrayUnion({
        author: "Business",
        role: "business",
        text: "Handed off to AI Agent for follow-up.",
        timestamp: serverTimestamp(),
      }),
    });

    thread.status = "ai_agent_active";
    thread.automationState = "IN_AI";
    thread.aiConversationId = conversationId;
    thread.messages = thread.messages || [];
    thread.messages.push({
      author: "Business",
      role: "business",
      text: "Handed off to AI Agent for follow-up.",
      timestamp: new Date(),
    });
    textarea.value = "";
    button.textContent = "AI Agent active";
    applyFilters();
    selectThread(thread.id);
  } catch (err) {
    console.error("[inbox] failed to hand off to AI Agent", err);
    alert(
      "Automatic recovery for unhappy customers is part of the Pro AI Suite. Upgrade to enable AI Agent or try again."
    );
  } finally {
    button.disabled = thread.status === "ai_agent_active";
  }
}

function wireFilters() {
  statusFilter?.addEventListener("change", applyFilters);
  dateFilter?.addEventListener("change", applyFilters);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }
  currentUserId = user.uid;
  await loadThreads(user.uid);
  wireFilters();
});

listenForUser(({ subscription }) => {
  currentPlanTier = subscription?.planId || "starter";
  applyPlanBadge(currentPlanTier);
});
