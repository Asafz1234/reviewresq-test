import { normalizePlan, hasFeature, upgradeTargetForFeature, PLAN_LABELS } from "./plan-capabilities.js";

let activePlan = "starter";
const UPGRADE_PATH = "/account.html";

function ensureUpgradeModal() {
  let modal = document.getElementById("upgrade-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "upgrade-modal";
  modal.className = "rr-upgrade-modal hidden";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-chrome"></div>
      <button class="close-btn" type="button" aria-label="Close upgrade dialog">×</button>
      <div class="modal-header">
        <div class="modal-badge">Premium plans</div>
        <h2 class="modal-title">Unlock This Feature</h2>
        <p class="modal-subtitle">
          This feature is available on higher plans. Choose the plan that fits your business best.
        </p>
      </div>

      <div class="plan-options">
        <div class="plan-card" data-plan="growth" id="plan-growth">
          <h3>Growth Plan</h3>
          <p class="price">$99 / month</p>
          <ul>
            <li>AI-powered replies</li>
            <li>Advanced insights</li>
            <li>Lead management tools</li>
            <li>Email & SMS follow-ups</li>
          </ul>
          <button class="select-plan" data-plan-cta="growth">Upgrade to Growth</button>
        </div>

        <div class="plan-card highlight" data-plan="pro_ai" id="plan-pro">
          <div class="ribbon">Most Popular</div>
          <h3>Pro AI Suite</h3>
          <p class="price">$149 / month</p>
          <ul>
            <li>Full AI Agent automation</li>
            <li>AI CRM (lead follow-up)</li>
            <li>Auto unhappy-customer recovery</li>
            <li>Inbox sync + 2-way messaging</li>
            <li>Automation flows</li>
          </ul>
          <button class="select-plan primary" data-plan-cta="pro_ai">Upgrade to Pro AI Suite</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

function closeUpgradeModal() {
  const modal = document.getElementById("upgrade-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  const cards = modal.querySelectorAll(".plan-card");
  cards.forEach((card) => card.classList.remove("highlight"));
}

function bindUpgradeModalEvents(modal) {
  if (modal.dataset.bound === "true") return;
  modal.dataset.bound = "true";
  const closeBtn = modal.querySelector(".close-btn");
  closeBtn?.addEventListener("click", closeUpgradeModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeUpgradeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeUpgradeModal();
    }
  });

  const ctaButtons = modal.querySelectorAll("[data-plan-cta]");
  ctaButtons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const planTarget = btn.dataset.planCta;
      window.location.href = planTarget ? `${UPGRADE_PATH}?plan=${planTarget}` : UPGRADE_PATH;
    });
  });
}

export function showUpgradeModal(requiredPlan = "growth", currentPlan = activePlan) {
  const normalizedCurrent = normalizePlan(currentPlan);
  if (normalizedCurrent === "pro_ai") return;

  const modal = ensureUpgradeModal();
  bindUpgradeModalEvents(modal);

  const growthCard = modal.querySelector('[data-plan="growth"]');
  const proCard = modal.querySelector('[data-plan="pro_ai"]');

  growthCard?.classList.remove("hidden", "highlight");
  proCard?.classList.remove("hidden", "highlight");

  const normalizedRequired = normalizePlan(requiredPlan);

  if (normalizedCurrent === "growth") {
    growthCard?.classList.add("hidden");
    proCard?.classList.add("highlight");
  } else {
    if (normalizedRequired === "pro_ai") {
      proCard?.classList.add("highlight");
    } else {
      growthCard?.classList.add("highlight");
    }
  }

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function attachUpgradeHandler(target, upgradePlan) {
  if (!target || target.dataset.upgradeBound === "true") return;
  target.dataset.upgradeBound = "true";
  target.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showUpgradeModal(upgradePlan, activePlan);
  });
}

function ensureLockedPreview(target, feature, upgradePlan, message) {
  let preview = target.querySelector(".locked-preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.className = "locked-preview";
    preview.innerHTML = `
      <div class="locked-pill">${PLAN_LABELS[upgradePlan] || "Upgrade"}</div>
      <p class="locked-title">Locked preview</p>
      <p class="locked-desc">${message}</p>
      <button type="button" class="btn btn-primary" data-upgrade-cta="${upgradePlan}">
        Upgrade to ${PLAN_LABELS[upgradePlan] || "Growth"}
      </button>
    `;
    target.appendChild(preview);
  } else {
    const pill = preview.querySelector(".locked-pill");
    if (pill) pill.textContent = PLAN_LABELS[upgradePlan] || "Upgrade";
    const desc = preview.querySelector(".locked-desc");
    if (desc) desc.textContent = message;
  }
}

function unlockPreview(target) {
  target.classList.remove("rr-locked");
  const preview = target.querySelector(".locked-preview");
  if (preview) {
    const host = preview.parentElement;
    preview.remove();
    host?.classList.remove("rr-locked");
  }
  if (target.matches("button, input, select, textarea")) {
    target.disabled = false;
    target.removeAttribute("aria-disabled");
  }
}

export function lockUI(planId = "starter", root = document) {
  const normalized = normalizePlan(planId);
  activePlan = normalized;
  window.__RR_ACTIVE_PLAN = normalized;
  const nodes = Array.from(root.querySelectorAll("[data-feature]"));
  nodes.forEach((node) => {
    const feature = node.dataset.feature;
    if (!feature) return;
    const allowed = hasFeature(normalized, feature);
    if (allowed) {
      unlockPreview(node);
      return;
    }

    const upgradePlan = node.dataset.upgradePlan || upgradeTargetForFeature(feature);
    const desc =
      node.dataset.lockMessage ||
      `Upgrade to ${PLAN_LABELS[upgradePlan] || PLAN_LABELS.growth} to unlock this feature.`;

    const overlayTarget = node.dataset.lockOverlay === "parent" ? node.parentElement || node : node;
    overlayTarget.classList.add("rr-locked");
    node.setAttribute("data-locked", "true");
    if (node.matches("button, input, select, textarea")) {
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
    }

    ensureLockedPreview(overlayTarget, feature, upgradePlan, desc);
    attachUpgradeHandler(overlayTarget, upgradePlan);
    const previewOverlay = overlayTarget.querySelector(".locked-preview");
    attachUpgradeHandler(previewOverlay, upgradePlan);
    const previewButton = overlayTarget.querySelector("[data-upgrade-cta]");
    attachUpgradeHandler(previewButton, upgradePlan);
  });
}

if (typeof window !== "undefined") {
  window.showUpgradeModal = showUpgradeModal;
}

export function decorateLockedButtons(root = document) {
  const lockedButtons = Array.from(root.querySelectorAll("[data-lock-button]")).filter((btn) => !btn.dataset.feature);
  lockedButtons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add("btn-disabled");
    btn.setAttribute("aria-disabled", "true");
  });
}
