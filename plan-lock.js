import { normalizePlan, hasFeature, upgradeTargetForFeature, PLAN_LABELS } from "./plan-capabilities.js";

function ensureLockedPreview(target, feature, upgradePlan, message) {
  let preview = target.querySelector(".locked-preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.className = "locked-preview";
    preview.innerHTML = `
      <div class="locked-pill">${PLAN_LABELS[upgradePlan] || "Upgrade"}</div>
      <p class="locked-title">Locked preview</p>
      <p class="locked-desc">${message}</p>
      <a class="btn btn-primary" href="account.html">Upgrade to ${PLAN_LABELS[upgradePlan] || "Growth"}</a>
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
  });
}

export function decorateLockedButtons(root = document) {
  const lockedButtons = Array.from(root.querySelectorAll("[data-lock-button]")).filter((btn) => !btn.dataset.feature);
  lockedButtons.forEach((btn) => {
    btn.disabled = true;
    btn.classList.add("btn-disabled");
    btn.setAttribute("aria-disabled", "true");
  });
}
