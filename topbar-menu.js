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

const planBadge = document.getElementById("planBadge");
const topbarRight = document.querySelector(".topbar-right");
const profileEl = document.querySelector(".topbar .profile");

const profileMenuId = "profileMenu";

const PLAN_CLASS = {
  starter: "plan-chip--starter",
  growth: "plan-chip--growth",
  pro_ai_suite: "plan-chip--pro",
};

function applyPlanBadge(planId) {
  if (!planBadge) return;
  const safePlan = PLAN_DETAILS[planId] ? planId : "starter";
  const label = PLAN_DETAILS[safePlan].label;
  planBadge.textContent = label;
  planBadge.setAttribute("data-plan", safePlan);
  planBadge.href = planBadge.getAttribute("href") || "account.html";

  planBadge.classList.remove(...Object.values(PLAN_CLASS));
  planBadge.classList.add(PLAN_CLASS[safePlan]);
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
  } else {
    applyPlanBadge("starter");
  }

  if (profile) {
    setProfileAvatar(profile.businessName || profile.name || "");
  }
}

listenForUser(async ({ subscription, profile }) => {
  applyPlanBadge(subscription?.planId || "starter");
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
  applyPlanBadge(subscription?.planId || "starter");
}

export { formatDate, applyPlanBadge };
