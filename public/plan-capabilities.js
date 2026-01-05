export const PLAN_ORDER = ["starter", "growth", "pro_ai"];

export const PLAN_LABELS = {
  starter: "Starter",
  growth: "Growth",
  pro_ai: "Pro AI Suite",
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
    // AI Agent
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
    overview_predictions: false,
    inbox_ai_reply: true,
    inbox_ai_suggestions: true,
    inbox_escalate_ai_agent: false,
    inbox_auto_handle_unhappy: false,
    aiAutoReplyGoogle: true,
    google_bulk_ai_reply: false,
    google_sentiment: true,
    leadsCrmMini: true,
    leads_ai_drafts: true,
    leads_sequences: true,
    leads_ai_automation: false,
    followups_actions: true,
    followups_ai_recommendations: true,
    followups_ai_escalation: false,
    basicAutomations: true,
    advancedAutomations: true,
    automations_ai_logic: false,
    aiAgent: false,
    settings_basic: true,
    settings_logo_upload: true,
    settings_branding_advanced: false,
    reviewFunnel: true,
    reviewFunnelCustomization: true,
    reviewFunnelRatingRules: true,
    reviewFunnelBrandingLogo: true,
    reviewFunnelAIManaged: false,
    campaigns_manual: true,
    campaigns_automation: false,
  },
  pro_ai: {
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
    reviewFunnelCustomization: false,
    reviewFunnelRatingRules: false,
    reviewFunnelBrandingLogo: true,
    reviewFunnelAIManaged: true,
    campaigns_manual: true,
    campaigns_automation: true,
  },
};

export const PLAN_ENTITLEMENTS = {
  starter: {
    isStarter: true,
    isPro: false,
    isProAI: false,
    allowedNavItems: {
      overview: true,
      askReviews: true,
      feedback: true,
      googleReviews: true,
      customers: true,
      campaigns: false,
      reviewFunnel: true,
      reviewLinks: true,
      alerts: true,
      businessSettings: false,
      accountBilling: true,
      aiPhoneAgent: false,
      proAiSuite: false,
    },
    alerts: {
      newPrivateFeedback: false,
      newGoogleReview: false,
      followUpReminders: false,
      weeklySummary: false,
    },
  },
  pro: {
    isStarter: false,
    isPro: true,
    isProAI: false,
    allowedNavItems: {
      overview: true,
      askReviews: true,
      feedback: true,
      googleReviews: true,
      customers: true,
      campaigns: true,
      reviewFunnel: true,
      reviewLinks: true,
      alerts: true,
      businessSettings: true,
      accountBilling: true,
      aiPhoneAgent: true,
      proAiSuite: true,
    },
    alerts: {
      newPrivateFeedback: true,
      newGoogleReview: true,
      followUpReminders: true,
      weeklySummary: true,
    },
  },
  pro_ai: {
    isStarter: false,
    isPro: true,
    isProAI: true,
    allowedNavItems: {
      overview: true,
      askReviews: true,
      feedback: true,
      googleReviews: true,
      customers: true,
      campaigns: true,
      reviewFunnel: true,
      reviewLinks: true,
      alerts: true,
      businessSettings: true,
      accountBilling: true,
      aiPhoneAgent: true,
      proAiSuite: true,
    },
    alerts: {
      newPrivateFeedback: true,
      newGoogleReview: true,
      followUpReminders: true,
      weeklySummary: true,
    },
  },
};

export function normalizePlan(planId = "starter") {
  const lowered = String(planId || "starter").toLowerCase();
  if (lowered === "pro_ai_suite" || lowered === "pro" || lowered === "advanced") return "pro_ai";
  if (lowered === "growth") return "growth";
  return "starter";
}

export function getPlanCapabilities(planId = "starter") {
  const plan = normalizePlan(planId);
  const isGrowth = plan === "growth";
  const isPro = plan === "pro_ai";

  const features = {
    reviewFunnel: true,
    reviewFunnelCustomization: isGrowth ? true : isPro ? "ai" : false,
    reviewFunnelRatingRules: isGrowth ? true : isPro ? "ai" : false,
    reviewFunnelBrandingLogo: isPro || isGrowth,
    reviewFunnelAIManaged: isPro,
  };

  const reviewFunnel = {
    mode: isPro ? "ai" : isGrowth ? "full" : "starter",
    readOnly: isPro,
    allowSave: !isPro,
    showAdvancedSections: isGrowth || isPro,
    showHappyDetails: true,
    allowedPatchPaths: isPro
      ? []
      : isGrowth
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
      happyHeadline: isGrowth && !isPro,
      happyCta: isGrowth && !isPro,
      happyPrompt: !isPro,
      googleReviewUrl: !isPro,
      routing: isGrowth && !isPro,
      unhappyHeadline: isGrowth && !isPro,
      unhappyMessage: isGrowth && !isPro,
      followupEmail: isGrowth && !isPro,
      branding: isGrowth && !isPro,
    },
  };

  return { plan, features, reviewFunnel };
}

export function getPlanEntitlements(planId = "starter") {
  const normalized = normalizePlan(planId);
  const raw = String(planId || "").toLowerCase();
  if (raw.includes("starter")) return PLAN_ENTITLEMENTS.starter;
  if (normalized === "starter") return PLAN_ENTITLEMENTS.starter;
  if (raw.includes("pro_ai") || raw.includes("ai_suite")) {
    return PLAN_ENTITLEMENTS.pro_ai;
  }
  if (raw.includes("pro")) return PLAN_ENTITLEMENTS.pro;
  if (normalized === "pro_ai") return PLAN_ENTITLEMENTS.pro_ai;
  return PLAN_ENTITLEMENTS.pro;
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
  const needsPro = [
    "aiAgent",
    "inbox_escalate_ai_agent",
    "inbox_auto_handle_unhappy",
    "google_bulk_ai_reply",
    "leads_ai_automation",
    "followups_ai_escalation",
    "overview_predictions",
    "automations_ai_logic",
    "settings_branding_advanced",
  ];
  if (needsPro.includes(feature)) return "pro_ai";
  const needsGrowth = [
    "overview_ai_insights",
    "overview_conversion_metrics",
    "inbox_ai_reply",
    "inbox_ai_suggestions",
    "aiAutoReplyGoogle",
    "google_sentiment",
    "leadsCrmMini",
    "leads_ai_drafts",
    "leads_sequences",
    "followups_actions",
    "followups_ai_recommendations",
    "basicAutomations",
    "advancedAutomations",
    "settings_logo_upload",
  ];
  if (needsGrowth.includes(feature)) return "growth";
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
