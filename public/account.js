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
import { PLAN_ORDER, normalizePlan } from "./plan-capabilities.js";
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
const planComparison = document.getElementById("planComparison");

const cancelModal = document.getElementById("cancelModal");
const planChangeModal = document.getElementById("planChangeModal");
const planChangeSummary = document.getElementById("planChangeSummary");
const planChangeCopy = document.getElementById("planChangeCopy");
const closePlanChange = document.getElementById("closePlanChange");
const confirmPlanChange = document.getElementById("confirmPlanChange");

const managePlanBtn = document.getElementById("managePlan");
const changePlanBtn = document.getElementById("changePlan");
const managePaymentBtn = document.getElementById("managePayment");
const cancelLink = document.getElementById("cancelLink");
const keepSubscription = document.getElementById("keepSubscription");
const confirmCancellation = document.getElementById("confirmCancellation");
const saveProfileBtn = document.getElementById("saveProfile");

const planTaglineEl = document.getElementById("planTagline");
const currentPlanPill = document.getElementById("currentPlanPill");
const currentPlanSummary = document.getElementById("currentPlanSummary");
const billingDetailPlan = document.getElementById("billingDetailPlan");
const billingDetailCadence = document.getElementById("billingDetailCadence");
const billingDetailInvoice = document.getElementById("billingDetailInvoice");
const billingDetailPayment = document.getElementById("billingDetailPayment");
const primaryHeroCta = document.getElementById("primaryHeroCta");
const secondaryHeroCta = document.getElementById("secondaryHeroCta");

const PLAN_TAGLINES = {
  starter: "Essentials to collect and reply to reviews.",
  growth: "AI replies and automations to grow faster.",
  pro_ai: "Full AI Agent automation for your service business.",
};

let currentUser = null;
let currentSubscription = null;
let pendingPlanTarget = null;

function formatCurrency(amount) {
  if (!Number.isFinite(amount)) return "—";
  return `$${amount}/month`;
}

function openModal(modal) {
  modal?.classList.add("visible");
  modal?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  modal?.classList.remove("visible");
  modal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
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
  const cadence = (sub.billingPeriod || "monthly").replace(/\b\w/g, (m) => m.toUpperCase());
  const normalizedPlan = normalizePlan(sub.planId);

  currentPlanEl.textContent = plan.label;
  currentPriceEl.textContent = formatCurrency(sub.price ?? plan.priceMonthly);
  billingPeriodEl.textContent = cadence;
  subscriptionStatus.textContent = (sub.status || "active").toString();
  planStatusPill.textContent = sub.cancelAtPeriodEnd
    ? `Ends ${formatDate(sub.currentPeriodEnd)}`
    : sub.pendingPlanId
    ? `Switching to ${PLAN_DETAILS[sub.pendingPlanId]?.label || sub.pendingPlanId}`
    : "Up to date";
  applyPlanBadge(sub.planId);

  planTaglineEl.textContent = PLAN_TAGLINES[sub.planId] || PLAN_TAGLINES[normalizePlan(sub.planId)] || PLAN_TAGLINES.starter;
  currentPlanPill.textContent = sub.cancelAtPeriodEnd ? "Scheduled to end" : "Current plan";
  currentPlanSummary.textContent = `${plan.label} · ${formatCurrency(sub.price ?? plan.priceMonthly)}`;
  billingDetailPlan.textContent = plan.label;
  billingDetailCadence.textContent = cadence;
  billingDetailInvoice.textContent = sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "—";
  billingDetailPayment.textContent = sub.paymentMethod || "Card on file";

  if (primaryHeroCta && secondaryHeroCta) {
    if (normalizedPlan === "starter") {
      primaryHeroCta.dataset.planTarget = "growth";
      primaryHeroCta.textContent = "Upgrade to Growth";
      primaryHeroCta.dataset.action = "";
      secondaryHeroCta.dataset.planTarget = "pro_ai";
      secondaryHeroCta.textContent = "View Pro AI Suite";
      secondaryHeroCta.dataset.action = "";
    } else if (normalizedPlan === "growth") {
      primaryHeroCta.dataset.planTarget = "pro_ai";
      primaryHeroCta.textContent = "Upgrade to Pro AI Suite";
      primaryHeroCta.dataset.action = "";
      secondaryHeroCta.dataset.planTarget = "";
      secondaryHeroCta.dataset.action = "manage";
      secondaryHeroCta.textContent = "Manage plan";
    } else {
      primaryHeroCta.dataset.planTarget = "";
      primaryHeroCta.dataset.action = "manage";
      primaryHeroCta.textContent = "Manage plan";
      secondaryHeroCta.dataset.planTarget = "";
      secondaryHeroCta.dataset.action = "support";
      secondaryHeroCta.textContent = "Contact support";
    }
  }

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

function renderPlanFeatureList(activePlan = "starter") {
  if (!planComparison) return;
  planComparison.innerHTML = "";
  const features = [
    { label: "Manual replies to reviews", plans: ["starter", "growth", "pro_ai"] },
    { label: "Business overview & basic stats", plans: ["starter", "growth", "pro_ai"] },
    { label: "Google reviews list", plans: ["starter", "growth", "pro_ai"] },
    { label: "Manual SMS to leads", plans: ["starter", "growth", "pro_ai"] },
    { label: "AI reply to reviews", plans: ["growth", "pro_ai"] },
    { label: "AI auto-reply for Google reviews", plans: ["growth", "pro_ai"] },
    { label: "Email & SMS follow-up campaigns", plans: ["growth", "pro_ai"] },
    { label: "Basic automations", plans: ["growth", "pro_ai"] },
    { label: "AI Agent for unhappy customers", plans: ["pro_ai"] },
    { label: "AI CRM automation", plans: ["pro_ai"] },
    { label: "Bulk AI replies & advanced automations", plans: ["pro_ai"] },
    { label: "Inbox sync and 2-way messaging", plans: ["pro_ai"] },
    { label: "Advanced alerts & branding options", plans: ["pro_ai"] },
  ];

  const planCards = ["starter", "growth", "pro_ai"];

  planCards.forEach((planId) => {
    const meta = PLAN_DETAILS[planId];
    const card = document.createElement("div");
    card.className = `plan-tier-card ${planId === "pro_ai" ? "highlight" : ""}`;
    card.innerHTML = `
      <div class="plan-tier-head">
        <div>
          ${planId === "pro_ai" ? '<div class="ribbon">Most popular</div>' : ""}
          <p class="card-title">${meta.label}</p>
          <p class="plan-tier-price">$${meta.priceMonthly} / month</p>
          <p class="plan-tier-sub">${PLAN_TAGLINES[planId]}</p>
        </div>
        <div class="plan-tier-badge">${
          planId === normalizePlan(activePlan)
            ? "Current plan"
            : PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(normalizePlan(activePlan))
            ? "Downgrade"
            : "Upgrade"
        }</div>
      </div>
      <ul class="feature-list"></ul>
      <button class="btn ${planId === normalizePlan(activePlan) ? "btn-secondary" : "btn-primary"}" data-plan-target="${
      planId
    }" ${planId === normalizePlan(activePlan) ? "disabled" : ""}>
        ${planId === normalizePlan(activePlan)
          ? "Current plan"
          : PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(normalizePlan(activePlan))
          ? "Downgrade"
          : `Upgrade to ${meta.label}`}
      </button>
    `;

    const list = card.querySelector(".feature-list");
    features.forEach((feature) => {
      const item = document.createElement("li");
      const enabled = feature.plans.includes(planId);
      item.innerHTML = `
        <span class="feature-icon ${enabled ? "enabled" : "locked"}">${enabled ? "✓" : "✕"}</span>
        <span>${feature.label}</span>
      `;
      list.appendChild(item);
    });
    card.querySelector("button")?.addEventListener("click", () => openPlanChangeDialog(planId));
    planComparison.appendChild(card);
  });
}

async function redirectToBillingPortal(targetPlanId, action = "change-plan") {
  const query = targetPlanId ? `?plan=${targetPlanId}&action=${action}` : "";
  window.location.href = `/account.html${query}`;
}

async function requestPlanCancellation() {
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
}

function openPlanChangeDialog(targetPlanId) {
  if (!currentSubscription) return;
  const normalizedTarget = normalizePlan(targetPlanId);
  const normalizedCurrent = normalizePlan(currentSubscription.planId);
  if (normalizedTarget === normalizedCurrent) return;

  pendingPlanTarget = normalizedTarget;
  const isUpgrade = PLAN_ORDER.indexOf(normalizedTarget) > PLAN_ORDER.indexOf(normalizedCurrent);
  const targetMeta = PLAN_DETAILS[normalizedTarget];
  const copy = isUpgrade
    ? `You’ll unlock ${targetMeta.label} features immediately.`
    : "Downgrades apply at your next renewal date.";
  planChangeCopy.textContent = copy;
  planChangeSummary.innerHTML = `
    <div class="plan-change-row">
      <div>
        <p class="card-title">Current</p>
        <p class="muted-text">${PLAN_DETAILS[normalizedCurrent].label}</p>
      </div>
      <div class="arrow">→</div>
      <div>
        <p class="card-title">New plan</p>
        <p class="muted-text">${targetMeta.label}</p>
        <p class="card-title">$${targetMeta.priceMonthly} / month</p>
      </div>
    </div>
  `;
  confirmPlanChange.textContent = isUpgrade ? `Upgrade to ${targetMeta.label}` : `Schedule downgrade`;
  confirmPlanChange.dataset.planTarget = normalizedTarget;
  openModal(planChangeModal);
}

async function handlePlanChange() {
  if (!pendingPlanTarget || !currentUser || !currentSubscription) return;
  const normalizedCurrent = normalizePlan(currentSubscription.planId);
  const isUpgrade = PLAN_ORDER.indexOf(pendingPlanTarget) > PLAN_ORDER.indexOf(normalizedCurrent);
  if (isUpgrade) {
    await redirectToBillingPortal(pendingPlanTarget, "upgrade");
  } else {
    await redirectToBillingPortal(pendingPlanTarget, "downgrade");
  }
  closeModal(planChangeModal);
}

async function cancelSubscription() {
  await requestPlanCancellation();
  closeModal(cancelModal);
}

function wireEvents() {
  primaryHeroCta?.addEventListener("click", () => {
    if (primaryHeroCta.dataset.action === "manage") {
      redirectToBillingPortal(currentSubscription?.planId, "manage");
      return;
    }
    if (primaryHeroCta.dataset.planTarget) {
      openPlanChangeDialog(primaryHeroCta.dataset.planTarget);
    }
  });

  secondaryHeroCta?.addEventListener("click", () => {
    if (secondaryHeroCta.dataset.action === "manage") {
      redirectToBillingPortal(currentSubscription?.planId, "manage");
      return;
    }
    if (secondaryHeroCta.dataset.action === "support") {
      window.location.href = "mailto:support@reviewresq.com";
      return;
    }
    if (secondaryHeroCta.dataset.planTarget) {
      openPlanChangeDialog(secondaryHeroCta.dataset.planTarget);
    }
  });

  managePlanBtn?.addEventListener("click", () => openPlanChangeDialog(currentSubscription?.planId));
  changePlanBtn?.addEventListener("click", () =>
    openPlanChangeDialog(currentSubscription?.planId === "starter" ? "growth" : "starter")
  );
  managePaymentBtn?.addEventListener("click", () => redirectToBillingPortal(currentSubscription?.planId, "payment-method"));
  closePlanChange?.addEventListener("click", () => closeModal(planChangeModal));
  confirmPlanChange?.addEventListener("click", handlePlanChange);

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
  renderPlanFeatureList(subscription.planId);

  const invoices = await fetchInvoices(user.uid);
  renderInvoices(invoices);

  wireEvents();

  const params = new URLSearchParams(window.location.search);
  const targetPlan = params.get("plan");
  if (targetPlan && normalizePlan(targetPlan) !== normalizePlan(subscription.planId)) {
    openPlanChangeDialog(targetPlan);
  }
});
