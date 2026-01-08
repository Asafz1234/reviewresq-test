export const PLAN_ORDER = ["starter", "growth"];

export const PLAN_LABELS = {
  starter: "Starter",
  growth: "Growth",
  pro_ai: "Growth",
};

export const PLAN_CAPABILITIES = {
  starter: {
    // Overview
    overview_ai_insights: false,
    overview_conversion_metrics: false,
    overview_predictions: false,
    // Inbox
    inbox_ai_reply: false,
    inbox_ai_suggestions: false,
    inbox_escalate_ai_agent: false,
    inbox_auto_handle_unhappy: false,
    // Google Reviews
    aiAutoReplyGoogle: false,
    google_bulk_ai_reply: false,
    google_sentiment: false,
    // Leads
    leadsCrmMini: false,
    leads_ai_drafts: false,
    leads_sequences: false,
    leads_ai_automation: false,
    // Follow-ups
    followups_actions: false,
    followups_ai_recommendations: false,
    followups_ai_escalation: false,
    // Automations
    basicAutomations: false,
    advancedAutomations: false,
    automations_ai_logic: false,
    // AI Suite
    aiAgent: false,
    // Settings / branding
    settings_basic: true,
    settings_logo_upload: false,
    settings_branding_advanced: false,
    // Review funnel
    reviewFunnel: true,
    reviewFunnelCustomization: false,
    reviewFunnelRatingRules: false,
    reviewFunnelBrandingLogo: false,
    reviewFunnelAIManaged: false,
    campaigns_manual: false,
    campaigns_automation: false,
  },
  growth: {
    overview_ai_insights: true,
    overview_conversion_metrics: true,
    overview_predictions: true,
    inbox_ai_reply: true,
    inbox_ai_suggestions: true,
    inbox_escalate_ai_agent: true,
    inbox_auto_handle_unhappy: true,
    aiAutoReplyGoogle: true,
    google_bulk_ai_reply: true,
    google_sentiment: true,
    leadsCrmMini: true,
    leads_ai_drafts: true,
    leads_sequences: true,
    leads_ai_automation: true,
    followups_actions: true,
    followups_ai_recommendations: true,
    followups_ai_escalation: true,
    basicAutomations: true,
    advancedAutomations: true,
    automations_ai_logic: true,
    aiAgent: true,
    settings_basic: true,
    settings_logo_upload: true,
    settings_branding_advanced: true,
    reviewFunnel: true,
    reviewFunnelCustomization: true,
    reviewFunnelRatingRules: true,
    reviewFunnelBrandingLogo: true,
    reviewFunnelAIManaged: false,
    campaigns_manual: true,
    campaigns_automation: true,
  },
};

export const PLAN_ENTITLEMENTS = {
  starter: {
    isStarter: true,
    allowedNavItems: {
      overview: true,
      askReviews: true,
      feedback: true,
      googleReviews: true,
      customers: true,
      reviewFunnel: false,
      reviewLinks: false,
      automations: false,
      aiSuite: false,
      team: false,
      businessSettings: true,
      accountBilling: true,
    },
  },
  growth: {
    isStarter: false,
    allowedNavItems: {
      overview: true,
      askReviews: true,
      feedback: true,
      googleReviews: true,
      customers: true,
      reviewFunnel: true,
      reviewLinks: true,
      automations: true,
      aiSuite: true,
      team: true,
      businessSettings: true,
      accountBilling: true,
    },
  },
};

export function normalizePlan(planId = "starter") {
  const lowered = String(planId || "starter").toLowerCase();
  if (lowered === "pro_ai_suite" || lowered === "pro_ai" || lowered === "pro" || lowered === "advanced") {
    return "growth";
  }
  if (lowered === "growth") return "growth";
  return "starter";
}

export function getPlanCapabilities(planId = "starter") {
  const plan = normalizePlan(planId);
  const isGrowth = plan === "growth";

  const features = {
    reviewFunnel: true,
    reviewFunnelCustomization: isGrowth,
    reviewFunnelRatingRules: isGrowth,
    reviewFunnelBrandingLogo: isGrowth,
    reviewFunnelAIManaged: false,
  };

  const reviewFunnel = {
    mode: isGrowth ? "full" : "starter",
    readOnly: false,
    allowSave: true,
    showAdvancedSections: isGrowth,
    showHappyDetails: true,
    allowedPatchPaths: isGrowth
      ? [
          "happy.headline",
          "happy.ctaLabel",
          "happy.prompt",
          "happy.googleReviewUrl",
          "routing.enabled",
          "routing.type",
          "routing.thresholds.googleMin",
          "unhappy.headline",
          "unhappy.message",
          "unhappy.followupEmail",
          "branding.logoUrl",
          "branding.primaryColor",
        ]
      : ["happy.prompt", "happy.googleReviewUrl"],
    editableFields: {
      happyHeadline: isGrowth,
      happyCta: isGrowth,
      happyPrompt: true,
      googleReviewUrl: true,
      routing: isGrowth,
      unhappyHeadline: isGrowth,
      unhappyMessage: isGrowth,
      followupEmail: isGrowth,
      branding: isGrowth,
    },
  };

  return { plan, features, reviewFunnel };
}

export function getPlanEntitlements(planId = "starter") {
  const normalized = normalizePlan(planId);
  return normalized === "growth" ? PLAN_ENTITLEMENTS.growth : PLAN_ENTITLEMENTS.starter;
}

export function hasFeature(planOrSession, feature) {
  const planId = typeof planOrSession === "string" ? planOrSession : planOrSession?.planTier || planOrSession?.planId;
  const normalized = normalizePlan(planId);
  const cap = PLAN_CAPABILITIES[normalized];
  if (!cap) return false;
  return Boolean(cap[feature]);
}

export function upgradeTargetForFeature(feature) {
  return "growth";
}

if (typeof module !== "undefined") {
  module.exports = {
    PLAN_CAPABILITIES,
    PLAN_ENTITLEMENTS,
    PLAN_LABELS,
    PLAN_ORDER,
    normalizePlan,
    hasFeature,
    upgradeTargetForFeature,
    getPlanCapabilities,
    getPlanEntitlements,
  };
}
