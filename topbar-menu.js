import { auth, signOut } from "./firebase-config.js";
import {
  PLAN_DETAILS,
  listenForUser,
  initialsFromName,
  formatDate,
  getCachedProfile,
  getCachedSubscription,
  refreshSubscription,
} from "./session-data.js";
import { PLAN_LABELS, hasFeature, normalizePlan } from "./plan-capabilities.js";
import { lockUI } from "./plan-lock.js";

const planBadge = document.getElementById("planBadge");
const topbarRight = document.querySelector(".topbar-right");
const profileEl = document.querySelector(".topbar .profile");

const profileMenuId = "profileMenu";

const PLAN_CLASS = {
  starter: "plan-chip--starter",
  growth: "plan-chip--growth",
  pro_ai: "plan-chip--pro",
  pro_ai_suite: "plan-chip--pro",
};

const NAV_FEATURE_REQUIREMENTS = {
  "ai-agent": {
    feature: "aiAgent",
    badge: PLAN_LABELS.pro_ai,
    upgradePlan: "pro_ai",
    title: "AI Agent",
    bullets: [
      "Automatic unhappy customer recovery",
      "Hands-free follow-up with two-way messaging",
      "Inbox sync so you always stay in the loop",
    ],
  },
  leads: {
    feature: "leadsCrmMini",
    badge: PLAN_LABELS.growth,
    upgradePlan: "growth",
    title: "Leads CRM Mini",
    bullets: [
      "Capture new leads automatically",
      "Keep outreach sequences organized",
      "Unlock richer lead tracking on Growth",
    ],
  },
  automations: {
    feature: "advancedAutomations",
    badge: PLAN_LABELS.growth,
    upgradePlan: "growth",
    title: "Advanced automations",
    bullets: [
      "Multi-step reminders and guardrails",
      "Quiet hours and rate limits",
      "Growth unlocks advanced flows",
    ],
  },
};

function applyPlanBadge(planId) {
  if (!planBadge) return;
  const safePlan = PLAN_DETAILS[planId] ? planId : normalizePlan(planId);
  const label = PLAN_DETAILS[safePlan]?.label || PLAN_LABELS.starter;
  planBadge.textContent = label;
  planBadge.setAttribute("data-plan", safePlan);
  planBadge.href = planBadge.getAttribute("href") || "account.html";

  planBadge.classList.remove(...Object.values(PLAN_CLASS));
  planBadge.classList.add(PLAN_CLASS[safePlan]);
}

  function deriveRoute() {
    const { pathname, hash } = window.location;
    if (hash && hash.toLowerCase().includes("inbox")) return "inbox";
    if (hash && hash.toLowerCase().includes("overview")) return "overview";
    if (hash && hash.toLowerCase().includes("google-reviews")) return "google-reviews";
    if (hash && hash.toLowerCase().includes("leads")) return "leads";
    if (hash && hash.toLowerCase().includes("account")) return "account";
    if (hash && hash.toLowerCase().includes("alerts")) return "alerts";
    if (hash && hash.toLowerCase().includes("links")) return "links";
    if (hash && hash.toLowerCase().includes("funnel")) return "funnel";

    if (pathname.includes("overview")) return "overview";
    if (pathname.includes("feedback")) return "inbox";
    if (pathname.includes("inbox")) return "inbox";
    if (pathname.includes("alerts")) return "alerts";
    if (pathname.includes("links")) return "links";
    if (pathname.includes("funnel")) return "funnel";
    if (pathname.includes("automations")) return "automations";
    if (pathname.includes("follow")) return "follow-ups";
    if (pathname.includes("google-reviews")) return "google-reviews";
    if (pathname.includes("leads")) return "leads";
    if (pathname.includes("ai-agent")) return "ai-agent";
    if (pathname.includes("settings")) return "settings";
    if (pathname.includes("account") || pathname.includes("billing")) return "account";
    return "overview";
  }

function buildUpsellCard({ title, upgradePlan, bullets }) {
  const fragment = document.createElement("div");
  fragment.innerHTML = `
    <section class="section">
      <div class="card">
        <p class="card-title">${title} is locked on your plan</p>
        <p class="card-sub">Upgrade to ${PLAN_LABELS[upgradePlan] || "the next plan"} to unlock this feature.</p>
        <ul class="list-plain">
          ${bullets.map((item) => `<li>• ${item}</li>`).join("")}
        </ul>
        <div class="button-row" style="justify-content:flex-start;">
          <a class="btn btn-primary" href="account.html" aria-label="Upgrade plan">Upgrade to ${PLAN_LABELS[upgradePlan] || "Pro"}</a>
        </div>
      </div>
    </section>
  `;
  return fragment;
}

function renderLockedFeatureView(route, planId) {
  const requirement = NAV_FEATURE_REQUIREMENTS[route];
  if (!requirement) return;
  const allowed = hasFeature(planId, requirement.feature);
  if (allowed) return;
  const main = document.querySelector("main.page-container") || document.querySelector("main");
  if (!main) return;
  main.innerHTML = "";
  main.appendChild(
    buildUpsellCard({
      title: requirement.title,
      upgradePlan: requirement.upgradePlan,
      bullets: requirement.bullets,
    })
  );
}

function decorateNav(planId) {
  const tabs = Array.from(document.querySelectorAll(".nav-tab"));
  const normalizedPlan = normalizePlan(planId);
  tabs.forEach((tab) => {
    const route = tab.dataset.route;
    const requirement = NAV_FEATURE_REQUIREMENTS[route];
    const badge = tab.querySelector(".nav-plan-badge");
    if (badge) badge.remove();

    if (requirement && !hasFeature(normalizedPlan, requirement.feature)) {
      tab.classList.add("nav-tab--locked");
      const badgeEl = document.createElement("span");
      badgeEl.className = "nav-plan-badge";
      badgeEl.textContent = requirement.badge;
      tab.appendChild(badgeEl);

      tab.addEventListener("click", (event) => {
        event.preventDefault();
        renderLockedFeatureView(route, normalizedPlan);
        window.history.replaceState({}, "", tab.getAttribute("href") || window.location.href);
      });
    }
  });
}

function buildProfileMenu() {
  if (!topbarRight || document.getElementById(profileMenuId)) return;

  const menu = document.createElement("div");
  menu.id = profileMenuId;
  menu.className = "profile-menu";
  menu.innerHTML = `
    <button class="profile-menu__item" data-nav="account">Account & billing</button>
    <button class="profile-menu__item" data-nav="settings">Business settings</button>
    <div class="profile-menu__divider"></div>
    <button class="profile-menu__item profile-menu__logout" data-nav="logout">Log out</button>
  `;
  topbarRight.appendChild(menu);

  menu.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-nav]");
    if (!target) return;
    const action = target.dataset.nav;

    if (action === "account") {
      window.location.href = window.location.pathname.includes("ai-agent")
        ? "../account.html"
        : "account.html";
      return;
    }

    if (action === "settings") {
      window.location.href = window.location.pathname.includes("ai-agent")
        ? "../settings.html#business"
        : "settings.html#business";
      return;
    }

    if (action === "logout") {
      await signOut(auth);
      window.location.href = "/auth.html";
    }
  });
}

function toggleMenu(open) {
  const menu = document.getElementById(profileMenuId);
  if (!menu) return;
  const shouldOpen = open ?? !menu.classList.contains("open");
  menu.classList.toggle("open", shouldOpen);
  if (shouldOpen) {
    document.addEventListener("click", outsideClickHandler);
  } else {
    document.removeEventListener("click", outsideClickHandler);
  }
}

function outsideClickHandler(event) {
  const menu = document.getElementById(profileMenuId);
  if (!menu) return;
  if (!menu.contains(event.target) && event.target !== profileEl) {
    toggleMenu(false);
  }
}

function setProfileAvatar(name = "") {
  if (!profileEl) return;
  profileEl.textContent = initialsFromName(name);
  profileEl.setAttribute("role", "button");
  profileEl.setAttribute("tabindex", "0");
}

function connectProfileMenu() {
  if (!profileEl) return;
  buildProfileMenu();
  profileEl.addEventListener("click", () => toggleMenu());
  profileEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleMenu();
    }
  });
}

async function hydrateTopbar() {
  const subscription = getCachedSubscription();
  const profile = getCachedProfile();

  if (subscription) {
    applyPlanBadge(subscription.planId);
    decorateNav(subscription.planId);
    renderLockedFeatureView(deriveRoute(), subscription.planId);
  } else {
    applyPlanBadge("starter");
    decorateNav("starter");
    renderLockedFeatureView(deriveRoute(), "starter");
  }

  if (profile) {
    setProfileAvatar(profile.businessName || profile.name || "");
  }
}

listenForUser(async ({ subscription, profile }) => {
  const planId = subscription?.planId || "starter";
  applyPlanBadge(planId);
  decorateNav(planId);
  renderLockedFeatureView(deriveRoute(), planId);
  lockUI(planId);
  setProfileAvatar(profile?.businessName || profile?.name || "");
});

connectProfileMenu();
hydrateTopbar();

planBadge?.addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = planBadge.href || "account.html";
});

export async function refreshTopbarSubscription() {
  const subscription = await refreshSubscription();
  const planId = subscription?.planId || "starter";
  applyPlanBadge(planId);
  decorateNav(planId);
  renderLockedFeatureView(deriveRoute(), planId);
}

export { formatDate, applyPlanBadge };
