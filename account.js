import {
  auth,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
} from "./firebase-config.js";
import { PLAN_DETAILS, formatDate } from "./session-data.js";
import { PLAN_LABELS, normalizePlan } from "./plan-capabilities.js";
import { applyPlanBadge } from "./topbar-menu.js";

const profileName = document.getElementById("profileName");
const profileIndustry = document.getElementById("profileIndustry");
const profileTimezone = document.getElementById("profileTimezone");
const profilePhone = document.getElementById("profilePhone");
const profileEmail = document.getElementById("profileEmail");
const profileLogo = document.getElementById("profileLogo");
const profileStatus = document.getElementById("profileStatus");

const currentPlanEl = document.getElementById("currentPlan");
const currentPriceEl = document.getElementById("currentPrice");
const nextBillingEl = document.getElementById("nextBilling");
const billingPeriodEl = document.getElementById("billingPeriod");
const paymentMethodEl = document.getElementById("paymentMethod");
const planStatusPill = document.getElementById("planStatusPill");
const subscriptionStatus = document.getElementById("subscriptionStatus");
const cancelNotice = document.getElementById("cancelNotice");
const invoicesBody = document.getElementById("invoicesBody");
const planOptions = document.getElementById("planOptions");

const planModal = document.getElementById("planModal");
const cancelModal = document.getElementById("cancelModal");
const closePlanModal = document.getElementById("closePlanModal");

const managePlanBtn = document.getElementById("managePlan");
const changePlanBtn = document.getElementById("changePlan");
const cancelLink = document.getElementById("cancelLink");
const keepSubscription = document.getElementById("keepSubscription");
const confirmCancellation = document.getElementById("confirmCancellation");
const saveProfileBtn = document.getElementById("saveProfile");

let currentUser = null;
let currentSubscription = null;

function formatCurrency(amount) {
  if (!Number.isFinite(amount)) return "—";
  return `$${amount}/month`;
}

function openModal(modal) {
  modal?.classList.add("visible");
  modal?.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal?.classList.remove("visible");
  modal?.setAttribute("aria-hidden", "true");
}

async function loadProfile(uid) {
  const ref = doc(db, "businessProfiles", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: uid, ...snap.data() };
}

function populateProfile(profile) {
  if (!profile) return;
  profileName.value = profile.businessName || profile.name || "";
  profileIndustry.value = profile.industry || profile.category || "";
  profileTimezone.value = profile.timezone || "";
  profilePhone.value = profile.phone || "";
  profileEmail.value = profile.email || "";
  profileStatus.textContent = (profile.status || "Live").toString();
}

async function saveProfile() {
  if (!currentUser) return;
  const ref = doc(db, "businessProfiles", currentUser.uid);
  const payload = {
    businessName: profileName.value || "",
    industry: profileIndustry.value || "",
    timezone: profileTimezone.value || "",
    phone: profilePhone.value || "",
    email: profileEmail.value || "",
    status: profileStatus.textContent || "Live",
    updatedAt: new Date(),
  };

  if (profileLogo?.files?.[0]) {
    payload.logoFileName = profileLogo.files[0].name;
  }

  await setDoc(ref, payload, { merge: true });
}

async function loadSubscription(uid) {
  const ref = doc(db, "subscriptions", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return {
      planId: "starter",
      status: "active",
      billingPeriod: "monthly",
      price: PLAN_DETAILS.starter.priceMonthly,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
  }
  return { planId: normalizePlan(snap.data().planId || "starter"), billingPeriod: "monthly", ...snap.data() };
}

function renderSubscription(sub) {
  currentSubscription = sub;
  const plan = PLAN_DETAILS[sub.planId] || PLAN_DETAILS[normalizePlan(sub.planId)] || PLAN_DETAILS.starter;
  currentPlanEl.textContent = plan.label;
  currentPriceEl.textContent = formatCurrency(sub.price ?? plan.priceMonthly);
  billingPeriodEl.textContent = (sub.billingPeriod || "monthly").replace(/\b\w/g, (m) => m.toUpperCase());
  subscriptionStatus.textContent = (sub.status || "active").toString();
  planStatusPill.textContent = sub.cancelAtPeriodEnd
    ? `Ends ${formatDate(sub.currentPeriodEnd)}`
    : sub.pendingPlanId
    ? `Switching to ${PLAN_DETAILS[sub.pendingPlanId]?.label || sub.pendingPlanId}`
    : "Up to date";
  applyPlanBadge(sub.planId);

  if (cancelNotice) {
    if (sub.cancelAtPeriodEnd) {
      cancelNotice.style.display = "block";
      cancelNotice.textContent = `Your subscription will end on ${formatDate(
        sub.currentPeriodEnd
      )}. You’ll still have access to all features until then.`;
    } else if (sub.pendingPlanId) {
      cancelNotice.style.display = "block";
      cancelNotice.textContent = `Your plan will change to ${PLAN_DETAILS[sub.pendingPlanId]?.label || sub.pendingPlanId} on ${
        formatDate(sub.currentPeriodEnd)
      }.`;
    } else {
      cancelNotice.style.display = "none";
      cancelNotice.textContent = "";
    }
  }

  nextBillingEl.textContent = sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "—";
  paymentMethodEl.textContent = sub.paymentMethod || "Card on file";
}

async function fetchInvoices(uid) {
  try {
    const invoicesRef = collection(db, "businessProfiles", uid, "invoices");
    const snap = await getDocs(invoicesRef);
    let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!docs.length) {
      const fallback = await getDocs(collection(db, "invoices"));
      docs = fallback.docs.filter((d) => d.data().businessId === uid).map((d) => ({ id: d.id, ...d.data() }));
    }

    return docs;
  } catch (err) {
    console.error("[account] failed to load invoices", err);
    return [];
  }
}

function renderInvoices(list = []) {
  invoicesBody.innerHTML = "";
  if (!list.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="4" class="table-empty">No invoices yet. Your first invoice will appear here after your initial payment.</td>`;
    invoicesBody.appendChild(row);
    return;
  }

  list
    .sort((a, b) => {
      const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return bDate - aDate;
    })
    .forEach((inv) => {
      const row = document.createElement("tr");
      const date = inv.createdAt ? formatDate(inv.createdAt) : "—";
      const amount = inv.amount ? `$${Number(inv.amount).toFixed(2)}` : "—";
      const status = (inv.status || "Paid").toString();
      row.innerHTML = `
        <td>${date}</td>
        <td>${inv.description || "Subscription"}</td>
        <td>${amount}</td>
        <td>${status}</td>
      `;
      invoicesBody.appendChild(row);
    });
}

function buildPlanCards(activePlan) {
  planOptions.innerHTML = "";
  const order = ["starter", "growth", "pro_ai"];

  Object.entries(PLAN_DETAILS).forEach(([planId, meta]) => {
    if (!order.includes(planId)) return;
    const card = document.createElement("div");
    card.className = "plan-card";
    const isActive = planId === activePlan;
    const isDowngrade = order.indexOf(planId) < order.indexOf(activePlan);
    const cta = isActive ? "Current plan" : isDowngrade ? "Schedule downgrade" : "Upgrade now";

    card.innerHTML = `
      <div class="plan-card__header">
        <div>
          <p class="card-title">${meta.label}</p>
          <p class="muted-text">$${meta.priceMonthly}/month</p>
        </div>
        ${isActive ? '<span class="pill-ghost">Active</span>' : ""}
      </div>
      <button class="btn ${isActive ? "btn-secondary" : "btn-primary"}" data-plan="${planId}" ${
      isActive ? "disabled" : ""
    }>${cta}</button>
    `;

    card.querySelector("button")?.addEventListener("click", () => handlePlanChange(planId));
    planOptions.appendChild(card);
  });
}

async function handlePlanChange(planId) {
  if (!currentUser || !currentSubscription) return;
  const ref = doc(db, "subscriptions", currentUser.uid);
  const order = ["starter", "growth", "pro_ai"];
  const isUpgrade = order.indexOf(planId) > order.indexOf(normalizePlan(currentSubscription.planId) || "starter");

  const payload = {
    planId: isUpgrade ? planId : currentSubscription.planId,
    pendingPlanId: isUpgrade ? null : planId,
    cancelAtPeriodEnd: false,
    status: "active",
    price: PLAN_DETAILS[planId]?.priceMonthly,
    currentPeriodEnd:
      currentSubscription.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  if (isUpgrade) {
    payload.planId = planId;
    payload.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  await setDoc(ref, payload, { merge: true });
  const updated = await loadSubscription(currentUser.uid);
  renderSubscription(updated);
  closeModal(planModal);
}

async function cancelSubscription() {
  if (!currentUser) return;
  const ref = doc(db, "subscriptions", currentUser.uid);
  await setDoc(
    ref,
    {
      cancelAtPeriodEnd: true,
      status: "active",
    },
    { merge: true }
  );
  const updated = await loadSubscription(currentUser.uid);
  renderSubscription(updated);
  closeModal(cancelModal);
}

function wireEvents() {
  changePlanBtn?.addEventListener("click", () => {
    buildPlanCards(currentSubscription?.planId || "starter");
    openModal(planModal);
  });
  managePlanBtn?.addEventListener("click", () => {
    buildPlanCards(currentSubscription?.planId || "starter");
    openModal(planModal);
  });
  closePlanModal?.addEventListener("click", () => closeModal(planModal));

  cancelLink?.addEventListener("click", (e) => {
    e.preventDefault();
    openModal(cancelModal);
  });
  keepSubscription?.addEventListener("click", () => closeModal(cancelModal));
  confirmCancellation?.addEventListener("click", cancelSubscription);
  saveProfileBtn?.addEventListener("click", saveProfile);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/auth.html";
    return;
  }
  currentUser = user;

  const profile = await loadProfile(user.uid);
  populateProfile(profile);

  const subscription = await loadSubscription(user.uid);
  renderSubscription(subscription);

  const invoices = await fetchInvoices(user.uid);
  renderInvoices(invoices);

  wireEvents();
});
