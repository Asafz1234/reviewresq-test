import { normalizePlan, hasFeature, upgradeTargetForFeature, PLAN_LABELS } from "./plan-capabilities.js";

let activePlan = "starter";
const UPGRADE_PATH = "/account.html";

export function showUpgradeModal(requiredPlan = "growth", currentPlan = activePlan) {
  const normalizedCurrent = normalizePlan(currentPlan);
  if (normalizedCurrent === "growth") return;
  const normalizedRequired = normalizePlan(requiredPlan);
  const target = normalizedRequired === "growth" ? UPGRADE_PATH : UPGRADE_PATH;
  window.location.href = target;
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
  if (!preview) return;
  preview.remove();
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
    overlayTarget.style.display = "none";
    overlayTarget.setAttribute("aria-hidden", "true");
    node.setAttribute("data-locked", "true");
    if (node.matches("button, input, select, textarea")) {
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
    }

    ensureLockedPreview(overlayTarget, feature, upgradePlan, desc);
    attachUpgradeHandler(overlayTarget, upgradePlan);
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
