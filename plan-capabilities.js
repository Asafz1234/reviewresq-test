export const PLAN_ORDER = ["starter", "growth", "pro_ai"];

export const PLAN_LABELS = {
  starter: "Starter",
  growth: "Growth",
  pro_ai: "Pro AI Suite",
};

export const PLAN_CAPABILITIES = {
  starter: {
    aiAgent: false,
    aiAutoReplyGoogle: false,
    leadsCrmMini: false,
    advancedAutomations: false,
    basicAutomations: true,
    replyWithAI: true,
  },
  growth: {
    aiAgent: false,
    aiAutoReplyGoogle: true,
    leadsCrmMini: true,
    advancedAutomations: true,
    basicAutomations: true,
    replyWithAI: true,
  },
  pro_ai: {
    aiAgent: true,
    aiAutoReplyGoogle: true,
    leadsCrmMini: true,
    advancedAutomations: true,
    basicAutomations: true,
    replyWithAI: true,
  },
};

export function normalizePlan(planId = "starter") {
  const lowered = String(planId || "starter").toLowerCase();
  if (lowered === "pro_ai_suite" || lowered === "pro" || lowered === "advanced") return "pro_ai";
  if (lowered === "growth") return "growth";
  return "starter";
}

export function hasFeature(planOrSession, feature) {
  const planId = typeof planOrSession === "string" ? planOrSession : planOrSession?.planTier || planOrSession?.planId;
  const normalized = normalizePlan(planId);
  const cap = PLAN_CAPABILITIES[normalized];
  if (!cap) return false;
  return Boolean(cap[feature]);
}

export function upgradeTargetForFeature(feature) {
  if (!feature) return "growth";
  const needsPro = ["aiAgent"];
  if (needsPro.includes(feature)) return "pro_ai";
  const needsGrowth = ["aiAutoReplyGoogle", "leadsCrmMini", "advancedAutomations"];
  if (needsGrowth.includes(feature)) return "growth";
  return "growth";
}

if (typeof module !== "undefined") {
  module.exports = { PLAN_CAPABILITIES, PLAN_LABELS, PLAN_ORDER, normalizePlan, hasFeature, upgradeTargetForFeature };
}
