import { auth, signOut } from "./firebase-config.js";
import {
  PLAN_DETAILS,
  listenForUser,
  initialsFromName,
  getCachedProfile,
  getPlanBootstrapPromise,
  hasPlanBootstrapResolved,
  refreshSubscription,
} from "./session-data.js";
import { PLAN_LABELS } from "./plan-capabilities.js";
import { applyNavPlanFilter } from "./nav-access-versioned.js";

const planBadge = document.getElementById("planBadge");
const topbarRight = document.querySelector(".topbar-right");
const profileEl = document.querySelector(".topbar .profile");

const profileMenuId = "profileMenu";

const PLAN_CLASS = {
  starter: "plan-chip--starter",
  growth: "plan-chip--growth",
};

let currentPlanBadge = null;

function applyPlanBadge(planId) {
  if (!planBadge) return;
  const resolvedPlan = resolvePlanId(planId);
  if (!resolvedPlan) {
    renderPlanBadgeLoading();
    return;
  }
  if (resolvedPlan === currentPlanBadge) return;
  currentPlanBadge = resolvedPlan;
  const label = PLAN_DETAILS[resolvedPlan]?.label || PLAN_LABELS[resolvedPlan] || "Loading…";
  planBadge.textContent = label;
  planBadge.setAttribute("data-plan", resolvedPlan);
  planBadge.removeAttribute("data-plan-loading");
  planBadge.href = planBadge.getAttribute("href") || "/account.html";

  planBadge.classList.remove(...Object.values(PLAN_CLASS));
  planBadge.classList.add(PLAN_CLASS[resolvedPlan]);
}

function renderPlanBadgeLoading() {
  if (!planBadge) return;
  currentPlanBadge = null;
  planBadge.textContent = "Loading…";
  planBadge.setAttribute("data-plan", "loading");
  planBadge.setAttribute("data-plan-loading", "true");
  planBadge.classList.remove(...Object.values(PLAN_CLASS));
}

function resolvePlanId(planId) {
  const raw = String(planId ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("pro") || raw.includes("advanced")) return "growth";
  if (raw.includes("growth")) return "growth";
  if (raw.includes("starter")) return "starter";
  return null;
}

function syncNavAccessPlan(planId) {
  const normalizedPlan = resolvePlanId(planId);
  applyPlanBadge(normalizedPlan);
  if (normalizedPlan) {
    applyNavPlanFilter(normalizedPlan);
  }
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
      window.location.href = "/account.html";
      return;
    }

    if (action === "settings") {
      window.location.href = "/business-settings.html";
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
  const profile = getCachedProfile();

  if (!hasPlanBootstrapResolved()) {
    renderPlanBadgeLoading();
  }

  getPlanBootstrapPromise().then((planResult) => {
    applyPlanBadge(planResult?.planId);
  });

  if (profile) {
    setProfileAvatar(profile.businessName || profile.name || "");
  }
}

listenForUser(async ({ subscription, profile }) => {
  syncNavAccessPlan(subscription?.planId);
  setProfileAvatar(profile?.businessName || profile?.name || "");
});

window.addEventListener("navaccess:planApplied", (event) => {
  const planId = event.detail?.planId;
  if (planId) {
    applyPlanBadge(planId);
  } else {
    renderPlanBadgeLoading();
  }
});

connectProfileMenu();
hydrateTopbar();

planBadge?.addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = planBadge.href || "/account.html";
});

export async function refreshTopbarSubscription() {
  const subscription = await refreshSubscription();
  applyPlanBadge(subscription?.planId);
}

export { applyPlanBadge };
