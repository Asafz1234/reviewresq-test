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
} from "./firebase-config.js";
import { listenForUser, formatDate, initialsFromName } from "./session-data.js";
import { applyPlanBadge } from "./topbar-menu.js";

const statusFilter = document.getElementById("statusFilter");
const dateFilter = document.getElementById("dateFilter");
const threadListEl = document.getElementById("threadList");
const detailEl = document.getElementById("threadDetail");

let threads = [];
let filteredThreads = [];
let selectedThreadId = null;
let currentUserId = null;

const STATUS_LABELS = {
  open: "Open",
  resolved: "Resolved",
  snoozed: "Snoozed",
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
    messages,
  };
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

  const actionRow = document.createElement("div");
  actionRow.className = "detail-actions";
  const sendBtn = document.createElement("button");
  sendBtn.className = "btn btn-primary";
  sendBtn.textContent = "Send reply";
  sendBtn.addEventListener("click", () => sendReply(thread, textarea));

  const aiBtn = document.createElement("button");
  aiBtn.className = "btn btn-secondary";
  aiBtn.textContent = "Reply with AI";
  aiBtn.addEventListener("click", async () => {
    aiBtn.disabled = true;
    aiBtn.textContent = "Generating…";
    try {
      const suggestion = `Thanks for the feedback, ${thread.customerName}! We appreciate you taking the time to share.`;
      textarea.value = suggestion;
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = "Reply with AI";
    }
  });

  actionRow.append(sendBtn, aiBtn);
  replyBox.append(textarea, actionRow);

  detailEl.append(header, convo, replyBox);
}

async function selectThread(id) {
  selectedThreadId = id;
  const thread = filteredThreads.find((t) => t.id === id);
  if (thread) renderThreadDetail(thread);
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
  applyPlanBadge(subscription?.planId || "starter");
});
