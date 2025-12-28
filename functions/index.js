const functions = require("firebase-functions/v1");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");
const crypto = require("crypto");
const {
  getPlanCapabilities: sharedPlanCapabilities,
  normalizePlan: sharedNormalizePlan,
} = require("./plan-capabilities.cjs");

admin.initializeApp();

const db = admin.firestore();

const PUBLIC_BUSINESS_ALLOWED_FIELDS = new Set([
  "businessId",
  "businessName",
  "logoUrl",
  "googleReviewLink",
  "updatedAt",
  "shareKey",
]);


const BUILD_ID = process.env.BUILD_ID || Date.now().toString();
const TEST_MODE = [
  process.env.REVIEWRESQ_TEST_MODE,
  process.env.FORCE_CONNECT_TEST_MODE,
]
  .map((v) => String(v || "").toLowerCase())
  .some((v) => v === "true" || v === "1" || v === "yes");

const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const GOOGLE_OAUTH_REDIRECT_URI = defineString("GOOGLE_OAUTH_REDIRECT_URI");
const GOOGLE_OAUTH_SCOPES = defineString(
  "GOOGLE_OAUTH_SCOPES",
  {
    default: "https://www.googleapis.com/auth/business.manage",
  },
);
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const SENDGRID_SENDER = defineSecret("SENDGRID_SENDER");

const getSecretValue = (secret) => {
  try {
    return secret.value();
  } catch (err) {
    return null;
  }
};

const getSecretOrEnv = (secret, envKey) =>
  getSecretValue(secret) || process.env[envKey] || "";

const getStringOrEnv = (param, envKey, fallback = "") => {
  const value = getSecretValue(param);
  if (value) return value;
  if (process.env[envKey]) return process.env[envKey];
  return fallback;
};

const normalizePlan = (raw = "starter") => {
  return sharedNormalizePlan ? sharedNormalizePlan(raw) : "starter";
};

const planLocationLimit = (planId = "starter") => {
  const normalized = normalizePlan(planId);
  if (normalized === "growth") return 2;
  if (normalized === "pro_ai") return 15;
  return 1;
};

const planUpgradeMessage = (planId = "starter") => {
  const normalized = normalizePlan(planId);
  if (normalized === "starter") {
    return "Upgrade to Growth to connect up to 2 locations.";
  }
  if (normalized === "growth") {
    return "Upgrade to Pro AI Suite to connect up to 15 locations.";
  }
  return "You’ve reached the maximum of 15 locations. Contact support if you need more.";
};

const derivePlanCapabilities = (planId = "starter") => {
  if (sharedPlanCapabilities) {
    return sharedPlanCapabilities(planId);
  }
  const normalized = normalizePlan(planId);
  const isGrowth = normalized === "growth";
  const isPro = normalized === "pro_ai";
  return {
    plan: normalized,
    features: {
      reviewFunnel: true,
      reviewFunnelCustomization: isGrowth ? true : isPro ? "ai" : false,
      reviewFunnelRatingRules: isGrowth ? true : isPro ? "ai" : false,
      reviewFunnelBrandingLogo: isPro || isGrowth,
      reviewFunnelAIManaged: isPro,
      campaigns_manual: isGrowth || isPro,
      campaigns_automation: isPro,
    },
  };
};

const resolveUserPlanId = async (uid, existingProfile = null) => {
  const profileData = existingProfile || {};
  const directPlan = profileData.subscription?.planId || profileData.planId;
  if (directPlan) return normalizePlan(directPlan);

  try {
    const subSnap = await admin.firestore().collection("subscriptions").doc(uid).get();
    if (subSnap.exists && subSnap.data()?.planId) {
      return normalizePlan(subSnap.data().planId);
    }
  } catch (err) {
    console.error("[plan] failed to resolve subscription", err);
  }

  return "starter";
};

const deriveExistingLocations = (profileData = {}) => {
  const sources =
    profileData.googleLocations ||
    profileData.connectedLocations ||
    profileData.googleAccounts ||
    [];
  if (Array.isArray(sources)) return sources.filter(Boolean);
  return [];
};

const isAtPlanLimit = (existingLocations, limit, placeId) => {
  if (!Array.isArray(existingLocations)) return false;
  const alreadyConnected = existingLocations.some(
    (loc) => loc?.placeId === placeId || loc?.googlePlaceId === placeId
  );
  if (alreadyConnected) return false;
  return existingLocations.length >= limit;
};

const upsertGoogleLocation = (existingLocations, newEntry) => {
  const merged = Array.isArray(existingLocations) ? [...existingLocations] : [];
  const idx = merged.findIndex(
    (loc) => loc?.placeId === newEntry.placeId || loc?.googlePlaceId === newEntry.placeId
  );
  if (idx >= 0) {
    merged[idx] = { ...merged[idx], ...newEntry };
  } else {
    merged.push(newEntry);
  }
  return merged;
};

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_REVIEW_FUNNEL_SETTINGS = {
  mode: "manual",
  happy: {
    headline: "Thanks for your visit!",
    prompt: "Share a quick note about your experience so others know what to expect.",
    ctaLabel: "Leave us a Google review",
    googleReviewUrl: "",
  },
  unhappy: {
    headline: "We're here to make it right",
    message: "Tell us what happened and how we can improve. We'll respond quickly.",
    followupEmail: "",
  },
  routing: {
    enabled: true,
    type: "rating",
    thresholds: { googleMin: 4 },
  },
  branding: {
    logoUrl: "",
    primaryColor: "#2563eb",
  },
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};

const resolveBusinessName = (data = {}) =>
  (data.businessName || data.displayName || data.name || "").toString().trim();

const resolveBusinessLogo = (data = {}) =>
  data.logoUrl ||
  data.logoURL ||
  data.businessLogoUrl ||
  data.brandLogoUrl ||
  data.logoDataUrl ||
  null;

const resolveGoogleReviewLink = (data = {}) => {
  const linkCandidate =
    data.googleReviewLink ||
    data.googleReviewUrl ||
    data.googleReview ||
    data.googleLink ||
    data.happy?.googleReviewUrl ||
    "";

  return typeof linkCandidate === "string" ? linkCandidate.trim() : "";
};

const normalizeEmail = (email = "") => email.toString().trim().toLowerCase();

const DEFAULT_BRANDING = {
  name: "Our business",
  color: "#2563EB",
  logoUrl: "",
  senderName: null,
  supportEmail: "support@reviewresq.com",
};

const BRANDING_INCOMPLETE_MESSAGE =
  "Before sending review requests, please complete your business details (takes under 1 minute).";

const deriveBrandingState = (data = {}) => {
  const branding = data.branding || {};
  const baseName = resolveBusinessName(data);
  const rawName =
    (branding.name || branding.displayName || baseName || "").toString().trim();
  const resolvedName = rawName || DEFAULT_BRANDING.name;
  const resolvedColor =
    (branding.color || data.brandColor || DEFAULT_BRANDING.color).toString().trim() ||
    DEFAULT_BRANDING.color;
  const resolvedLogo = branding.logoUrl || resolveBusinessLogo(data) || DEFAULT_BRANDING.logoUrl;
  const rawSenderName = (branding.senderName || rawName || "").toString().trim();
  const resolvedSenderName = rawSenderName || resolvedName;
  const resolvedSupportEmail =
    normalizeEmail(branding.supportEmail || data.supportEmail || DEFAULT_BRANDING.supportEmail) ||
    DEFAULT_BRANDING.supportEmail;

  const missingFields = [];
  if (!rawName) missingFields.push("branding.name");
  if (!rawSenderName) missingFields.push("branding.senderName");

  return {
    branding: {
      name: resolvedName,
      color: resolvedColor,
      logoUrl: resolvedLogo || "",
      senderName: resolvedSenderName || resolvedName,
      supportEmail: resolvedSupportEmail || DEFAULT_BRANDING.supportEmail,
      brandingComplete: Boolean(rawName && rawSenderName),
    },
    brandingComplete: Boolean(rawName && rawSenderName),
    missingFields,
  };
};

const ensureBrandingDefaults = async (ref, data = {}) => {
  if (!ref) return deriveBrandingState(data);

  const { branding, missingFields } = deriveBrandingState(data);
  if (!missingFields.length) {
    return { branding, missingFields, brandingComplete: branding.brandingComplete };
  }

  const payload = {
    branding: {
      ...branding,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    brandingComplete: branding.brandingComplete,
  };

  if (branding.name && !resolveBusinessName(data)) {
    payload.businessName = branding.name;
    payload.displayName = branding.name;
    payload.name = branding.name;
  }

  if (branding.color && !data.brandColor) {
    payload.brandColor = branding.color;
  }

  if (branding.logoUrl && !resolveBusinessLogo(data)) {
    payload.logoUrl = branding.logoUrl;
    payload.logoURL = branding.logoUrl;
    payload.businessLogoUrl = branding.logoUrl;
    payload.brandLogoUrl = branding.logoUrl;
  }

  await ref.set(payload, { merge: true });
  return { branding, missingFields, brandingComplete: branding.brandingComplete };
};

const INVITE_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const normalizeTimestampMs = (raw) => {
  if (!raw) return null;
  if (typeof raw.toMillis === "function") return raw.toMillis();
  if (typeof raw === "number") return raw;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

const fetchBusinessIdentity = async (businessId) => {
  if (!businessId) return null;
  const candidates = [
    db.collection("businesses").doc(businessId),
    db.collection("businessProfiles").doc(businessId),
    db.collection("publicBusinesses").doc(businessId),
  ];

  for (const ref of candidates) {
    const snap = await ref.get();
    if (snap.exists) {
      const data = snap.data() || {};
      const { branding, missingFields } = deriveBrandingState(data);
      const businessName = branding.name || resolveBusinessName(data);
      const logoUrl = branding.logoUrl || resolveBusinessLogo(data);
      const googleReviewLink = resolveGoogleReviewLink(data) || data.googleReviewUrl || "";
      return {
        businessName,
        logoUrl,
        googleReviewLink,
        branding,
        brandingComplete: branding.brandingComplete,
        brandingMissingFields: missingFields,
      };
    }
  }

  return null;
};

const loadBusinessProfileSnapshot = async (businessId) => {
  if (!businessId) return null;
  const candidates = [
    db.collection("publicBusinesses").doc(businessId),
    db.collection("businessProfiles").doc(businessId),
  ];

  for (const ref of candidates) {
    const snap = await ref.get();
    if (snap.exists) {
      return { ref, snap, data: snap.data() || {} };
    }
  }

  return null;
};

async function assertBusinessProfileExists(businessId) {
  const profile = await loadBusinessProfileSnapshot(businessId);
  if (!profile) {
    throw new functions.https.HttpsError(
      "not-found",
      "Business profile not found for this portal link.",
    );
  }

  return profile;
}

const assertBrandingComplete = (brandingState) => {
  if (brandingState?.brandingComplete) return;
  throw new functions.https.HttpsError(
    "failed-precondition",
    BRANDING_INCOMPLETE_MESSAGE,
    { code: "BRANDING_INCOMPLETE", message: BRANDING_INCOMPLETE_MESSAGE },
  );
};

const assertBusinessBrandingComplete = async (businessId) => {
  const profile = await assertBusinessProfileExists(businessId);
  const brandingState = deriveBrandingState(profile.data || {});
  assertBrandingComplete(brandingState);
  return { profile, brandingState };
};

const resolveInviteRecord = async (businessId, inviteToken) => {
  if (!businessId || !inviteToken) {
    throw new Error("businessId and invite token are required");
  }

  const ref = db.collection("businesses").doc(businessId).collection("invites").doc(inviteToken);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Invite token not found");
  }

  const data = snap.data() || {};
  const expiresAtMs = normalizeTimestampMs(data.expiresAt);
  if (expiresAtMs && expiresAtMs < Date.now()) {
    throw new Error("Invite token expired");
  }

  return { ref, data };
};

const createInviteToken = async ({
  businessId,
  customerId = null,
  customerName = "",
  phone = "",
  email = "",
  channel = "manual",
  source = "manual",
}) => {
  if (!businessId) {
    throw new Error("businessId is required to create an invite token");
  }

  await assertBusinessBrandingComplete(businessId);

  const normalizedName = (customerName || "").toString().trim();
  const normalizedPhone = (phone || "").toString().trim();
  const normalizedEmail = (email || "").toString().trim();

  if (!customerId && !normalizedName && !normalizedPhone && !normalizedEmail) {
    throw new Error("Provide a customer id or contact details to create an invite.");
  }

  const inviteToken = crypto.randomBytes(12).toString("hex");
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + INVITE_TOKEN_TTL_MS);
  const createdAtMs = Date.now();
  const resolvedChannel = normalizeChannel(channel);

  const ref = db.collection("businesses").doc(businessId).collection("invites").doc(inviteToken);
  const invitePayload = {
    businessId,
    customerId: customerId || null,
    customerName: normalizedName || null,
    phone: normalizedPhone || null,
    email: normalizedEmail || null,
    channel: resolvedChannel,
    source,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    used: false,
  };

  await ref.set(invitePayload);

  const portalUrl = `https://reviewresq.com/portal.html?businessId=${encodeURIComponent(
    businessId,
  )}&t=${encodeURIComponent(inviteToken)}`;

  try {
    const outboundDefaults = buildOutboundDefaults({
      businessId,
      requestId: inviteToken,
      channel: resolvedChannel,
      customerName: normalizedName || null,
      customerEmail: normalizedEmail || null,
      customerPhone: normalizedPhone || null,
      reviewLink: portalUrl,
      status: "draft",
      provider: resolvedChannel === "email" ? "sendgrid" : null,
    });
    await updateOutboundRequest({
      businessId,
      requestId: inviteToken,
      defaults: outboundDefaults,
      updates: {
        createdAtMs,
        inviteToken,
        source,
        channel: resolvedChannel,
      },
    });
  } catch (err) {
    console.warn("[invite] failed to write outbound request", err);
  }

  return { inviteToken, requestId: inviteToken, portalUrl, expiresAt: expiresAt.toMillis(), customerId: customerId || null };
};

const fetchCustomerProfile = async (businessId, customerId) => {
  if (!businessId || !customerId) return null;

  const primaryRef = db.collection("customers").doc(customerId);
  const primarySnap = await primaryRef.get();
  if (primarySnap.exists && primarySnap.data()?.businessId === businessId) {
    return { ref: primaryRef, data: primarySnap.data() };
  }

  const nestedRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("customers")
    .doc(customerId);
  const nestedSnap = await nestedRef.get();
  if (nestedSnap.exists) {
    return { ref: nestedRef, data: nestedSnap.data() };
  }

  return null;
};

const writeFeedbackDocuments = async (businessId, payload) => {
  if (!businessId) {
    throw new Error("businessId is required for feedback persistence");
  }

  const canonicalRef = db.collection("businesses").doc(businessId).collection("feedback");
  const primaryWrite = canonicalRef.add(payload);
  const legacyWrites = [
    db.collection("feedback").add(payload),
    db.collection("businessProfiles").doc(businessId).collection("feedback").add(payload),
  ];

  const [primaryResult, ...legacyResults] = await Promise.allSettled([primaryWrite, ...legacyWrites]);

  legacyResults.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      console.warn(`[portal-feedback] legacy write ${index} failed`, outcome.reason);
    }
  });

  if (primaryResult.status === "rejected") {
    throw primaryResult.reason;
  }

  return primaryResult.value;
};

const ALLOWED_ORIGINS = new Set([
  "https://reviewresq.com",
  "https://www.reviewresq.com",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);

const resolveCorsOrigin = (origin = "") => {
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
};

const applyCors = (req, res, methods = "GET, POST, OPTIONS") => {
  const requestOrigin = req.headers.origin || "";
  const allowedOrigin = resolveCorsOrigin(requestOrigin);

  const requestedHeaders = (req.headers["access-control-request-headers"] || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const allowHeaders = new Set([
    "Content-Type",
    "Authorization",
    "X-Api-Key",
    "X-Twilio-Email-Event-Webhook-Signature",
    "X-Twilio-Email-Event-Webhook-Timestamp",
    "X-Requested-With",
  ]);

  requestedHeaders.forEach((header) => allowHeaders.add(header));

  res.set("Access-Control-Allow-Methods", methods);
  res.set("Access-Control-Allow-Headers", Array.from(allowHeaders).join(", "));
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Access-Control-Max-Age", "3600");
  res.set("Vary", "Origin");

  if (allowedOrigin) {
    res.set("Access-Control-Allow-Origin", allowedOrigin);
  } else if (!requestOrigin) {
    res.set("Access-Control-Allow-Origin", "https://reviewresq.com");
  }

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }

  if (requestOrigin && !allowedOrigin) {
    res.status(403).json({ error: "origin_not_allowed" });
    return true;
  }

  return false;
};

const sanitizePublicBusinessPayload = ({ businessId, data = {}, existing = {} }) => {
  const businessName = resolveBusinessName(data) || resolveBusinessName(existing) || "";
  const googleReviewLink =
    resolveGoogleReviewLink(data) || resolveGoogleReviewLink(existing) || "";
  const logoUrl = resolveBusinessLogo(data) || resolveBusinessLogo(existing) || null;
  const shareKey = data.shareKey || existing.shareKey || null;

  if (!businessName || !googleReviewLink) return null;

  const payload = {
    businessId: String(businessId),
    businessName,
    googleReviewLink,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (logoUrl) payload.logoUrl = logoUrl;
  if (shareKey) payload.shareKey = shareKey;

  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => PUBLIC_BUSINESS_ALLOWED_FIELDS.has(key)),
  );
};

async function upsertPublicBusiness(businessId, data = {}) {
  if (!businessId) return null;

  const publicRef = db.collection("publicBusinesses").doc(String(businessId));
  const existingSnap = await publicRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() : {};
  const payload = sanitizePublicBusinessPayload({ businessId, data, existing: existingData });

  if (!payload) {
    console.warn("[publicBusiness] missing required fields for upsert", {
      businessId,
      hasName: Boolean(resolveBusinessName(data) || resolveBusinessName(existingData)),
      hasGoogleLink: Boolean(
        resolveGoogleReviewLink(data) || resolveGoogleReviewLink(existingData),
      ),
    });
    return null;
  }

  await publicRef.set(payload, { merge: true });
  return payload;
}

const loadBusinessAccount = async (businessId) => {
  const businessRef = db.collection("businesses").doc(businessId);
  const profileRef = db.collection("businessProfiles").doc(businessId);
  const [businessSnap, profileSnap] = await Promise.all([
    businessRef.get(),
    profileRef.get().catch(() => null),
  ]);

  const businessData = businessSnap.exists ? businessSnap.data() : {};
  const profileData = profileSnap?.exists ? profileSnap.data() : {};
  const combinedProfile = { ...profileData, ...businessData };

  const planId = await resolveUserPlanId(businessId, {
    ...combinedProfile,
    planId: combinedProfile.plan || businessData.planId,
  });

  const capabilities = derivePlanCapabilities(planId);
  const mergedFeatures = { ...businessData.features, ...capabilities.features };

  const brandingState = await ensureBrandingDefaults(businessRef, combinedProfile);
  await ensureBrandingDefaults(profileRef, { ...combinedProfile, branding: combinedProfile.branding || brandingState.branding });

  await businessRef.set(
    {
      plan: planId,
      features: mergedFeatures,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    ref: businessRef,
    data: { ...profileData, ...businessData, plan: planId, features: mergedFeatures },
    capabilities: { ...capabilities, features: mergedFeatures },
  };
};

const mergeDeep = (target = {}, source = {}) => {
  const output = { ...target };
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = mergeDeep(target[key] || {}, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  });
  return output;
};

const CUSTOMER_SOURCE_TYPES = ["manual", "csv", "sheet", "funnel", "webhook"];
const CUSTOMER_REVIEW_STATUSES = ["none", "requested", "reviewed", "negative"];
const CUSTOMER_TIMELINE_TYPES = [
  "sms_sent",
  "email_sent",
  "review_left",
  "feedback_received",
  "campaign_message",
  "automation_step",
];

const normalizeCustomerSource = (source = "manual") =>
  CUSTOMER_SOURCE_TYPES.includes(source) ? source : "manual";

const normalizeReviewStatus = (status = "none") =>
  CUSTOMER_REVIEW_STATUSES.includes(status) ? status : "none";

const normalizePhone = (phone = "") => {
  if (!phone) return "";
  const digits = phone.toString().trim().replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
};

const normalizeChannel = (channel = "link") => {
  if (channel === "email" || channel === "sms" || channel === "link") return channel;
  return "link";
};

const DEFAULT_SENDGRID_SENDER = "support@reviewresq.com";

const resolveSendgridConfig = () => {
  const apiKey = getSecretValue(SENDGRID_API_KEY) || "";
  const senderSecretValue = getSecretValue(SENDGRID_SENDER) || "";
  const sender = senderSecretValue || DEFAULT_SENDGRID_SENDER;

  const hasSecret = Boolean(apiKey || senderSecretValue);
  const source = hasSecret ? "secret" : "none";

  return {
    apiKey,
    sender,
    source,
    sendgridApiKey: apiKey,
    sendgridSender: sender,
  };
};

const maskEmail = (email = "") => {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  if (!user) return `***@${domain}`;
  const maskedUser =
    user.length <= 2
      ? `${user[0] || "*"}***`
      : `${user[0]}***${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
};
const EMAIL_RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000;
const EMAIL_RATE_LIMIT_MAX = 30;

const basicEmailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

const chunkArray = (items = [], size = 10) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const OUTBOUND_STATUS_PRIORITY = {
  draft: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  failed: 99,
};

const resolveStatusProgression = (current = "draft", next = "draft") => {
  if (next === "failed") return "failed";
  const currentPriority = OUTBOUND_STATUS_PRIORITY[current] ?? -1;
  const nextPriority = OUTBOUND_STATUS_PRIORITY[next] ?? -1;
  return nextPriority > currentPriority ? next : current;
};

const buildOutboundDefaults = ({
  businessId,
  requestId,
  channel,
  customerName,
  customerEmail,
  customerPhone,
  reviewLink,
  status = "draft",
  provider = null,
}) => {
  const createdAtMs = Date.now();
  return {
    requestId,
    businessId,
    channel,
    customerName: customerName || null,
    customerEmail: customerEmail || null,
    customerPhone: customerPhone || null,
    reviewLink: reviewLink || null,
    status,
    provider,
    providerMessageId: null,
    createdAtMs,
    updatedAtMs: createdAtMs,
    processedAtMs: null,
    sentAtMs: null,
    deliveredAtMs: null,
    openedAtMs: null,
    clickedAtMs: null,
    error: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
};

async function updateOutboundRequest({ businessId, requestId, updates = {}, defaults = {} }) {
  if (!businessId || !requestId) return null;
  const ref = db.collection("businesses").doc(String(businessId)).collection("outboundRequests").doc(String(requestId));
  const now = Date.now();
  const payload = {
    businessId,
    requestId: String(requestId),
    updatedAtMs: updates.updatedAtMs || now,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...defaults,
    ...updates,
  };
  return ref.set(payload, { merge: true });
}

const buildCustomerDocId = (businessId, identifier) => {
  const base = `${businessId || "unknown"}|${identifier || crypto.randomUUID()}`;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 20);
};

async function upsertCustomerRecord({
  businessId,
  name,
  phone,
  email,
  source = "manual",
  reviewStatus = "none",
  lastInteractionAt = null,
  timelineEntry = null,
  archived = null,
}) {
  if (!businessId) {
    throw new Error("businessId is required to create a customer record");
  }

  const identifier = email || phone || name || Date.now().toString();
  const customerId = buildCustomerDocId(businessId, identifier);
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();

  const payload = {
    businessId,
    name: name || null,
    phone: phone || null,
    email: email || null,
    source: normalizeCustomerSource(source),
    reviewStatus: normalizeReviewStatus(reviewStatus),
    lastInteractionAt:
      lastInteractionAt || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (typeof archived === "boolean") {
    payload.archived = archived;
  }

  if (timelineEntry && CUSTOMER_TIMELINE_TYPES.includes(timelineEntry.type)) {
    const entry = {
      type: timelineEntry.type,
      metadata: timelineEntry.metadata || {},
      timestamp: admin.firestore.Timestamp.now(),
    };
    payload.timeline = admin.firestore.FieldValue.arrayUnion(entry);
  }

  if (!snap.exists || !snap.data()?.createdAt) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await ref.set(payload, { merge: true });
  return customerId;
}

async function findExistingCustomerContacts({
  businessId,
  phones = [],
  emails = [],
}) {
  const normalizedPhones = Array.from(new Set(phones.filter(Boolean)));
  const normalizedEmails = Array.from(new Set(emails.filter(Boolean)));
  const matches = { phones: new Set(), emails: new Set() };

  const queryField = async (field, values, targetSet, normalizer) => {
    const chunks = chunkArray(values, 10);
    for (const batch of chunks) {
      const snap = await db.collection("customers").where(field, "in", batch).get();
      snap.forEach((doc) => {
        const data = doc.data() || {};
        if (data.businessId === businessId && data[field]) {
          targetSet.add(normalizer(data[field]));
        }
      });
    }
  };

  await Promise.all([
    queryField("phone", normalizedPhones, matches.phones, normalizePhone),
    queryField("email", normalizedEmails, matches.emails, normalizeEmail),
  ]);

  return matches;
}

const deriveReviewStatusFromFeedback = (feedbackData = {}) => {
  const rating = Number(feedbackData.rating || 0);
  if (rating >= 4) return "reviewed";
  if (rating && rating <= 3) return "negative";
  return "none";
};

async function recordCustomerFromFeedbackCapture({ businessId, feedback }) {
  if (!businessId) return null;

  try {
    return await upsertCustomerRecord({
      businessId,
      name: feedback.customerName || null,
      phone: feedback.customerPhone || feedback.phone || null,
      email: feedback.customerEmail || feedback.email || null,
      source: "funnel",
      reviewStatus: deriveReviewStatusFromFeedback(feedback),
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
      timelineEntry: {
        type: "feedback_received",
        metadata: {
          rating: feedback.rating || null,
          message: feedback.message || feedback.feedback || null,
        },
      },
    });
  } catch (err) {
    console.error("[customers] failed to record funnel capture", err);
    return null;
  }
}

const sanitizeReviewFunnelPatch = (patch = {}) => {
  const cleaned = {};

  if (patch.mode === "ai" || patch.mode === "manual") {
    cleaned.mode = patch.mode;
  }

  if (patch.happy && typeof patch.happy === "object") {
    const happy = {};
    if (typeof patch.happy.headline === "string") happy.headline = patch.happy.headline;
    if (typeof patch.happy.prompt === "string") happy.prompt = patch.happy.prompt;
    if (typeof patch.happy.ctaLabel === "string") happy.ctaLabel = patch.happy.ctaLabel;
    if (typeof patch.happy.googleReviewUrl === "string")
      happy.googleReviewUrl = patch.happy.googleReviewUrl;
    if (Object.keys(happy).length) cleaned.happy = happy;
  }

  if (patch.unhappy && typeof patch.unhappy === "object") {
    const unhappy = {};
    if (typeof patch.unhappy.headline === "string") unhappy.headline = patch.unhappy.headline;
    if (typeof patch.unhappy.message === "string") unhappy.message = patch.unhappy.message;
    if (typeof patch.unhappy.followupEmail === "string")
      unhappy.followupEmail = patch.unhappy.followupEmail;
    if (Object.keys(unhappy).length) cleaned.unhappy = unhappy;
  }

  if (patch.routing && typeof patch.routing === "object") {
    const routing = {};
    if (typeof patch.routing.enabled === "boolean") routing.enabled = patch.routing.enabled;
    if (typeof patch.routing.type === "string") routing.type = patch.routing.type;

    if (patch.routing.thresholds && typeof patch.routing.thresholds === "object") {
      const googleMin = Number(patch.routing.thresholds.googleMin);
      if (Number.isFinite(googleMin) && googleMin >= 1 && googleMin <= 5) {
        routing.thresholds = { googleMin };
      }
    }

    if (Object.keys(routing).length) cleaned.routing = routing;
  }

  if (patch.branding && typeof patch.branding === "object") {
    const branding = {};
    if (typeof patch.branding.logoUrl === "string") branding.logoUrl = patch.branding.logoUrl;
    if (typeof patch.branding.primaryColor === "string") branding.primaryColor = patch.branding.primaryColor;
    if (Object.keys(branding).length) cleaned.branding = branding;
  }

  return cleaned;
};

const pickAllowedPatch = (patch = {}, allowedPaths = [], prefix = []) => {
  const selected = {};
  Object.entries(patch || {}).forEach(([key, value]) => {
    const path = [...prefix, key].join(".");
    const allowed = allowedPaths.includes(path);
    const leadsToAllowedChild = allowedPaths.some((p) => p.startsWith(`${path}.`));

    if (allowed) {
      selected[key] = value;
      return;
    }

    if (value && typeof value === "object" && !Array.isArray(value) && leadsToAllowedChild) {
      const child = pickAllowedPatch(value, allowedPaths, [...prefix, key]);
      if (Object.keys(child).length) {
        selected[key] = child;
      }
    }
  });
  return selected;
};

const REQUIRED_ENV = {
  GOOGLE_OAUTH_CLIENT_ID:
    "Set GOOGLE_OAUTH_CLIENT_ID as a Cloud Functions environment variable (e.g. `firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_ID`).",
  GOOGLE_OAUTH_CLIENT_SECRET:
    "Set GOOGLE_OAUTH_CLIENT_SECRET as a Cloud Functions secret (`firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET`).",
  GOOGLE_PLACES_API_KEY:
    "Set GOOGLE_PLACES_API_KEY as a Cloud Functions secret (`firebase functions:secrets:set GOOGLE_PLACES_API_KEY`).",
  GOOGLE_OAUTH_REDIRECT_URI:
    "Set GOOGLE_OAUTH_REDIRECT_URI to the production callback URL ending with /oauthCallback.",
};

const getMissingGoogleEnv = ({ requireOAuth = false, requirePlaces = false } = {}) => {
  const missing = [];

  if (requireOAuth) {
    const clientId = getSecretOrEnv(GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = getSecretOrEnv(
      GOOGLE_OAUTH_CLIENT_SECRET,
      "GOOGLE_OAUTH_CLIENT_SECRET",
    );

    const redirectUri = getStringOrEnv(
      GOOGLE_OAUTH_REDIRECT_URI,
      "GOOGLE_OAUTH_REDIRECT_URI",
    );

    if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!redirectUri) {
      missing.push("GOOGLE_OAUTH_REDIRECT_URI");
    }
  }

  if (requirePlaces && !process.env.GOOGLE_PLACES_API_KEY) {
    missing.push("GOOGLE_PLACES_API_KEY");
  }

  return missing;
};

const ensureGoogleEnvForRuntime = (
  res,
  { requireOAuth = false, requirePlaces = false, context = "Google config" } = {},
) => {
  const missing = getMissingGoogleEnv({ requireOAuth, requirePlaces });
  if (!missing.length) {
    return { ok: true, missing: [] };
  }

  const message = `[google-env] Missing required env vars for ${context}: ${missing.join(", ")}`;
  console.error(message);

  if (res) {
    res.status(500).json({ error: "missing_config", missing });
  }

  return { ok: false, missing };
};

const resolveEnvConfig = (() => {
  let cached = null;
  return () => {
    if (cached) return cached;

    const googleClientId =
      getSecretOrEnv(GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID") || "";
    const googleClientSecret =
      getSecretOrEnv(
        GOOGLE_OAUTH_CLIENT_SECRET,
        "GOOGLE_OAUTH_CLIENT_SECRET",
      ) || "";
    const googleRedirectUri =
      getStringOrEnv(GOOGLE_OAUTH_REDIRECT_URI, "GOOGLE_OAUTH_REDIRECT_URI") ||
      "";
    const placesApiKey = process.env.GOOGLE_PLACES_API_KEY || "";

    const scopes =
      getStringOrEnv(
        GOOGLE_OAUTH_SCOPES,
        "GOOGLE_OAUTH_SCOPES",
        "https://www.googleapis.com/auth/business.manage",
      ) || "https://www.googleapis.com/auth/business.manage";

    cached = {
      googleClientId,
      googleClientSecret,
      googleRedirectUri,
      placesApiKey,
      scopes,
    };
    return cached;
  };
})();

const normalizePhoneDigits = (raw = "") => {
  const digits = (raw.match(/\d+/g) || []).join("");
  if (!digits) return "";

  const trimmed = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;

  if (trimmed.length < 10) return "";

  return trimmed.slice(-10);
};

const GOOGLE_CANONICAL_REDIRECT_URI = "https://reviewresq.com/oauth/google/callback";

const redactOAuthUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("state")) {
      parsed.searchParams.set("state", "[REDACTED]");
    }
    if (parsed.searchParams.has("code")) {
      parsed.searchParams.set("code", "[REDACTED]");
    }
    return parsed.toString();
  } catch (err) {
    return url;
  }
};

const toE164US = (digits10 = "") =>
  digits10 && digits10.length === 10 ? `+1${digits10}` : "";

const isForceConnectTestMode = () => TEST_MODE;

const resolveGoogleOAuthServerConfig = () => {
  const env = resolveEnvConfig();
  const redirectUri =
    env.googleRedirectUri || GOOGLE_CANONICAL_REDIRECT_URI;
  return {
    clientId: env.googleClientId || null,
    clientSecret: env.googleClientSecret || null,
    redirectUri,
    canonicalRedirectUri: GOOGLE_CANONICAL_REDIRECT_URI,
    scopes: env.scopes,
  };
};

const extractStateFromAddress = (formattedAddress = "") => {
  const upper = String(formattedAddress || "").toUpperCase();

  const match = upper.match(/,\s*([A-Z]{2})\s+\d{5}/);
  if (match && match[1]) return match[1];

  // Fallback: try to detect a spaced token for common state inputs
  const tokens = upper.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.length === 2 && /^[A-Z]{2}$/.test(token)) return token;
  }

  return null;
};

const normalizeName = (name = "") =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractPlaceIdFromReviewUrl = (url = "") => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const param = parsed.searchParams.get("placeid");
    if (param) return param;
  } catch (err) {
    // fall through to regex parsing for non-standard URLs
  }

  const match = String(url).match(/[?&]placeid=([^&#]+)/i);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

const extractCidFromUrl = (url = "") => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const cid = parsed.searchParams.get("cid");
    if (cid) return cid;
  } catch (err) {
    // ignore parsing errors
  }
  const match = String(url).match(/[?&]cid=([^&#]+)/i);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

const buildGoogleReviewUrl = (placeId) => {
  if (!placeId) return "";
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
};

const extractPlaceIdFromUrl = (raw = "") => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const direct =
      url.searchParams.get("placeid") || url.searchParams.get("place_id") || url.searchParams.get("pid");
    if (direct) return direct;

    const pathParts = url.pathname.split("/").filter(Boolean);
    const placeIndex = pathParts.findIndex((part) => part.toLowerCase() === "place");
    if (placeIndex >= 0 && pathParts[placeIndex + 1]) {
      return decodeURIComponent(pathParts[placeIndex + 1]);
    }
  } catch (err) {
    return null;
  }
  return null;
};

const isValidGoogleBusinessUrl = (raw = "") => {
  if (!raw) return false;
  const trimmed = String(raw || "").trim();
  let url;
  try {
    url = new URL(trimmed);
  } catch (err) {
    return false;
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return false;

  const baseHost = url.host.toLowerCase().startsWith("www.")
    ? url.host.toLowerCase().slice(4)
    : url.host.toLowerCase();
  const allowedHosts = [
    "google.com",
    "maps.app.goo.gl",
    "goo.gl",
    "goo.gl/maps",
    "g.page",
    "search.google.com",
  ];
  const hostAllowed = allowedHosts.some(
    (host) => baseHost === host || baseHost.endsWith(`.${host}`)
  );
  if (!hostAllowed) return false;

  const path = (url.pathname || "").toLowerCase();
  const hasMapsPath =
    path.includes("/maps") || path.includes("/search") || path.includes("/local/") || path.includes("/url");

  if (!hasMapsPath && baseHost !== "g.page" && baseHost !== "goo.gl" && baseHost !== "goo.gl/maps") {
    return false;
  }

  return true;
};

const resolvePlacesApiKey = () => {
  const env = resolveEnvConfig();
  return env.placesApiKey || null;
};

const fetchPlaceDetails = async ({ apiKey, placeId }) => {
  if (!apiKey || !placeId) return null;
  const detailsUrl = new URL(
    "https://maps.googleapis.com/maps/api/place/details/json"
  );
  detailsUrl.searchParams.set("key", apiKey);
  detailsUrl.searchParams.set("place_id", placeId);
  detailsUrl.searchParams.set(
    "fields",
    [
      "place_id",
      "name",
      "formatted_address",
      "formatted_phone_number",
      "international_phone_number",
      "rating",
      "user_ratings_total",
      "url",
      "types",
      "address_components",
    ].join(",")
  );

  const detailsResponse = await fetch(detailsUrl);
  if (!detailsResponse.ok) {
    console.error("[fetchPlaceDetails] HTTP error", detailsResponse.status, {
      placeId,
    });
    return null;
  }

  const detailsData = await detailsResponse.json();
  return detailsData?.result || null;
};

const resolvePlaceIdFromCid = async ({ apiKey, cid }) => {
  if (!apiKey || !cid) return null;
  const findPlaceUrl = new URL(
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
  );
  findPlaceUrl.searchParams.set("key", apiKey);
  findPlaceUrl.searchParams.set("input", cid);
  findPlaceUrl.searchParams.set("inputtype", "textquery");
  findPlaceUrl.searchParams.set(
    "fields",
    [
      "place_id",
      "name",
      "formatted_address",
      "formatted_phone_number",
      "international_phone_number",
      "rating",
      "user_ratings_total",
      "url",
      "types",
    ].join(",")
  );

  const response = await fetch(findPlaceUrl);
  if (!response.ok) {
    console.error("[resolvePlaceIdFromCid] HTTP error", response.status);
    return null;
  }
  const data = await response.json();
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  return candidate?.place_id || null;
};

const fetchGoogleBusinessLocationsWithToken = async (accessToken) => {
  if (!accessToken) {
    const error = new Error("Missing Google access token.");
    error.code = "ACCESS_TOKEN_MISSING";
    throw error;
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
  const accountsResponse = await fetch(
    "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
    { headers }
  );

  if (!accountsResponse.ok) {
    const error = new Error("Unable to load Google Business accounts.");
    error.code = "ACCOUNTS_UNAVAILABLE";
    throw error;
  }

  const accountData = await accountsResponse.json();
  const accounts = Array.isArray(accountData?.accounts) ? accountData.accounts : [];
  const roleMap = new Map();
  accounts.forEach((acct) => {
    if (acct?.name) {
      roleMap.set(acct.name, acct?.role || null);
    }
  });

  const locations = [];
  for (const account of accounts) {
    const accountName = account?.name;
    if (!accountName) continue;
    const locationsUrl = new URL(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`
    );
    locationsUrl.searchParams.set(
      "readMask",
      [
        "name",
        "locationName",
        "storefrontAddress",
        "metadata",
        "primaryCategory",
        "regularHours",
        "phoneNumbers",
        "websiteUri",
      ].join(",")
    );

    const locResponse = await fetch(locationsUrl.toString(), { headers });
    if (!locResponse.ok) {
      console.warn("[exchangeGoogleAuthCode] failed to load locations for account", accountName);
      continue;
    }
    const data = await locResponse.json();
    const locs = Array.isArray(data?.locations) ? data.locations : [];
    locs.forEach((loc) => {
      const placeId = loc?.metadata?.placeId || loc?.metadata?.mapsUriPlaceId || null;
      if (!placeId) return;
      locations.push({
        accountId: accountName,
        locationId: loc?.name || null,
        placeId,
        name: loc?.title || loc?.locationName || "Business",
        address: loc?.storefrontAddress?.addressLines?.join(" ") || "",
        role: roleMap.get(accountName) || null,
        phone:
          loc?.phoneNumbers?.primaryPhone ||
          loc?.phoneNumbers?.additionalPhones?.[0] ||
          "",
      });
    });
  }

  return { accounts, locations };
};

const oauthAllowedOrigins = [
  "https://reviewresq.com",
  "https://www.reviewresq.com",
  "http://localhost:5000",
  "http://localhost:5173",
];

const applyOAuthCors = (req, res) => {
  const origin = req.headers.origin;
  const isAllowed = !origin || oauthAllowedOrigins.includes(origin);
  res.set("Vary", "Origin");
  if (origin && isAllowed) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (origin && !isAllowed) {
    return false;
  }
  return true;
};

const verifyRequestAuth = async (req) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!token) {
    const error = new Error("Authentication required");
    error.code = "UNAUTHENTICATED";
    throw error;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
  } catch (err) {
    const error = new Error("Invalid or expired token");
    error.code = "UNAUTHENTICATED";
    throw error;
  }
};

const setCorsHeaders = (req, res) => {
  const origin = req.headers.origin || "*";
  const allowedOrigins = [
    "https://reviewresq.com",
    "https://www.reviewresq.com",
    "http://localhost:5000",
  ];

  if (allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "https://reviewresq.com");
  }

  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Vary", "Origin");
};

const mapCandidate = (details, fallbackResult, inputDigits) => {
  const phoneNumber =
    details.international_phone_number ||
    details.formatted_phone_number ||
    fallbackResult?.international_phone_number ||
    fallbackResult?.formatted_phone_number ||
    null;

  const googleDigits = normalizePhoneDigits(phoneNumber || "");
  const phoneMatches = Boolean(
    inputDigits && googleDigits && googleDigits === inputDigits
  );

  return {
    placeId: details.place_id || fallbackResult?.place_id,
    name: details.name || fallbackResult?.name || null,
    address:
      details.formatted_address || fallbackResult?.formatted_address || null,
    phoneNumber,
    rating: details.rating ?? fallbackResult?.rating ?? null,
    userRatingsTotal:
      details.user_ratings_total ?? fallbackResult?.user_ratings_total ?? 0,
    googleMapsUrl: details.url || null,
    phoneMatches,
    samePhone: phoneMatches,
  };
};

const searchGooglePlacesWithValidation = async (req, res, { label }) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const getParam = (key) =>
    req.method === "GET" ? req.query?.[key] || "" : req.body?.[key] || "";

  const businessNameRaw = String(
    getParam("businessName") || getParam("query") || ""
  ).trim();
  const stateFilter = String(
    getParam("stateOrCity") || getParam("state") || getParam("region") || ""
  )
    .trim()
    .toUpperCase();
  const phoneRaw = String(
    getParam("phoneNumber") || getParam("phonenumber") || getParam("phone") || ""
  ).trim();

  const normalizedDigits = normalizePhoneDigits(phoneRaw);
  const e164 = toE164US(normalizedDigits);

  if (!businessName && !normalizedDigits) {
    return res.status(400).json({ error: "Missing businessName or phoneNumber" });
  }

  const envCheck = ensureGoogleEnvForRuntime(res, {
    requirePlaces: true,
    context: label,
  });
  if (!envCheck.ok) {
    return;
  }

  const placesApiKey = resolvePlacesApiKey();

  if (!placesApiKey) {
    console.error(`[${label}] missing Places API key`);
    return res.status(500).json({ error: "missing_config" });
  }

  const respondWithShape = (payload, status = 200) =>
    res.status(status).json({
      ok: false,
      reason: "ERROR",
      code: payload?.code || payload?.reason || "ERROR",
      message: "Unexpected error",
      match: null,
      candidates: [],
      ...payload,
    });

  try {
    console.log(`[${label}] inputs`, {
      businessName,
      stateFilter,
      phoneDigits: normalizedDigits,
    });

    const getPlaceDetails = async (placeId, source) => {
      const detailsUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/details/json"
      );
      detailsUrl.searchParams.set("key", placesApiKey);
      detailsUrl.searchParams.set("place_id", placeId);
      detailsUrl.searchParams.set(
        "fields",
        [
          "place_id",
          "name",
          "formatted_address",
          "formatted_phone_number",
          "international_phone_number",
          "address_components",
          "rating",
          "user_ratings_total",
          "types",
          "url",
        ].join(",")
      );

      const detailsResponse = await fetch(detailsUrl);

      if (!detailsResponse.ok) {
        console.error(
          `[${label}] Place Details HTTP error (${source})`,
          detailsResponse.status
        );
        return null;
      }

      const detailsData = await detailsResponse.json();
      return detailsData.result || null;
    };

    // ---------- 1) Phone-first search ----------
    if (normalizedDigits && normalizedDigits.length >= 10 && e164) {
      const findPlaceUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
      );
      findPlaceUrl.searchParams.set("key", placesApiKey);
      findPlaceUrl.searchParams.set("input", e164);
      findPlaceUrl.searchParams.set("inputtype", "phonenumber");
      findPlaceUrl.searchParams.set(
        "fields",
        [
          "place_id",
          "name",
          "formatted_address",
          "formatted_phone_number",
          "international_phone_number",
          "types",
        ].join(",")
      );

      const findResponse = await fetch(findPlaceUrl);

      if (!findResponse.ok) {
        console.error(`[${label}] Find Place HTTP error`, findResponse.status);
      } else {
        const findData = await findResponse.json();
        const findCandidates = Array.isArray(findData.candidates)
          ? findData.candidates
          : [];

        console.log(`[${label}] phone-first candidates`, {
          count: findCandidates.length,
        });

        for (const candidate of findCandidates) {
          const details = await getPlaceDetails(candidate.place_id, "phone");
          if (!details) continue;

          const stateComponent = details.address_components?.find((c) =>
            c.types.includes("administrative_area_level_1")
          );
          const stateCode = stateComponent?.short_name?.toUpperCase() || null;
          const stateMatches = !stateFilter || (stateCode && stateCode === stateFilter);

          console.log(`[${label}] phone candidate details`, {
            placeId: details.place_id,
            name: details.name,
            formattedAddress: details.formatted_address,
            detectedState: stateCode,
            stateMatches,
          });

          if (stateFilter && !stateMatches) {
            console.log(`[${label}] skip phone candidate due to state mismatch`, {
              inputState: stateFilter,
              placeName: details.name,
              detectedState: stateCode,
            });
            continue;
          }

          const mappedCandidate = mapCandidate(details, candidate, normalizedDigits);

          if (mappedCandidate.phoneMatches) {
            console.log(`[${label}] phone-first exact match`, {
              placeId: mappedCandidate.placeId,
              name: mappedCandidate.name,
              state: stateCode,
            });

            return respondWithShape({
              ok: true,
              reason: "EXACT_MATCH",
              code: "EXACT_MATCH",
              message: "Found an exact phone match on Google.",
              match: mappedCandidate,
              candidates: [mappedCandidate],
            });
          }
        }
      }
    }

    // ---------- 2) Text search fallback (multi-query) ----------
    const phone10 = normalizedDigits && normalizedDigits.length === 10 ? normalizedDigits : "";
    const plus1Phone = phone10 ? `+1${phone10}` : "";

    const queries = [];
    const addQuery = (query) => {
      const trimmed = String(query || "").trim();
      if (trimmed && !queries.includes(trimmed)) {
        queries.push(trimmed);
      }
    };

    if (businessName && phone10 && stateFilter)
      addQuery(`${businessName} ${phone10} ${stateFilter}`);
    if (businessName && plus1Phone && stateFilter)
      addQuery(`${businessName} ${plus1Phone} ${stateFilter}`);
    if (businessName && phone10) addQuery(`${businessName} ${phone10}`);
    if (businessName && stateFilter) addQuery(`${businessName} ${stateFilter}`);
    if (businessName) addQuery(businessName);
    if (phone10) addQuery(phone10);
    if (plus1Phone) addQuery(plus1Phone);

    const seenPlaceIds = new Set();
    const candidates = [];

    for (const query of queries) {
      const textUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/textsearch/json"
      );
      textUrl.searchParams.set("key", placesApiKey);
      textUrl.searchParams.set("query", query);
      textUrl.searchParams.set("region", "us");

      console.log(`[${label}] text fallback query`, { query });

      const textResponse = await fetch(textUrl);
      if (!textResponse.ok) {
        console.error(`[${label}] Text Search HTTP error`, textResponse.status, { query });
        continue;
      }

      const textData = await textResponse.json();
      const textResults = Array.isArray(textData?.results) ? textData.results : [];

      console.log(`[${label}] text results`, {
        query,
        resultCount: textResults.length,
      });

      for (const result of textResults) {
        if (!result?.place_id || seenPlaceIds.has(result.place_id)) continue;

        const details = await getPlaceDetails(result.place_id, "text");
        if (!details) continue;
        if (!stateMatches(details)) continue;

        seenPlaceIds.add(result.place_id);
        const candidate = mapCandidate(details, result, normalizedDigits);
        candidates.push(candidate);
      }

      console.log(`[${label}] cumulative candidates`, {
        query,
        total: candidates.length,
        bestCandidate: candidates[0]?.placeId || null,
      });
    }

    if (candidates.length === 0) {
      return respondWithShape({
        ok: false,
        reason: "NO_RESULTS",
        code: "NO_RESULTS",
        message:
          "We couldn’t find any matching business on Google for this name and region.",
        match: null,
        candidates: [],
      });
    }

    const exactMatch = candidates.find((c) => c.phoneMatches);
    if (exactMatch) {
      return respondWithShape({
        ok: true,
        reason: "EXACT_MATCH",
        code: "EXACT_MATCH",
        message: "Found an exact phone match on Google.",
        match: exactMatch,
        candidates,
      });
    }

    return respondWithShape({
      ok: false,
      reason: "NO_PHONE_MATCH",
      code: "NO_PHONE_MATCH",
      message:
        "We found similar businesses on Google, but none of them uses the same phone number as your profile.",
      match: null,
      candidates,
    });
  } catch (err) {
    console.error(`[${label}] unexpected error`, err);
    return respondWithShape(
      {
        ok: false,
        reason: "ERROR",
        message: "Places API error",
        error: { message: err?.message },
      },
      500
    );
  }
};

exports.googlePlacesSearch = functions.https.onRequest(async (req, res) => {
  try {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const getParam = (key) =>
      req.method === "GET" ? req.query?.[key] || "" : req.body?.[key] || "";

    const businessName = String(getParam("businessName") || "").trim();
    const stateRaw = String(getParam("stateOrProvince") || getParam("state") || "")
      .trim()
      .toUpperCase();
    const phoneRaw = String(getParam("phoneNumber") || getParam("phone") || "")
      .trim();

    if (!phoneRaw || !stateRaw) {
      return res.json({ ok: false, error: "MISSING_PARAMS" });
    }

    const normalizedDigits = normalizePhoneDigits(phoneRaw);
    const e164 = normalizedDigits && normalizedDigits.length === 10 ? toE164US(normalizedDigits) : "";

    let placesApiKey;
    try {
      placesApiKey = resolvePlacesApiKey();
    } catch (err) {
      console.error("[googlePlacesSearch] missing Places API key", err);
      return res.json({
        ok: false,
        error: "MISSING_API_KEY",
        message: err?.message,
      });
    }

    if (!placesApiKey) {
      return res.json({ ok: false, error: "MISSING_API_KEY" });
    }

    const filteredCandidates = [];

    const mapDetailsToCandidate = (details) => ({
      placeId: details?.place_id || null,
      name: details?.name || null,
      address: details?.formatted_address || null,
      phoneNumber:
        details?.formatted_phone_number ||
        details?.international_phone_number ||
        null,
      rating: details?.rating ?? null,
      userRatingsTotal: details?.user_ratings_total ?? 0,
      googleMapsUrl: details?.url || null,
      samePhone:
        Boolean(normalizedDigits) &&
        normalizePhoneDigits(
          details?.formatted_phone_number || details?.international_phone_number || ""
        ) === normalizedDigits,
    });

    const fetchPlaceDetails = async (placeId) => {
      if (!placeId) return null;
      const detailsUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/details/json"
      );
      detailsUrl.searchParams.set("key", placesApiKey);
      detailsUrl.searchParams.set("place_id", placeId);
      detailsUrl.searchParams.set(
        "fields",
        [
          "place_id",
          "name",
          "formatted_address",
          "formatted_phone_number",
          "international_phone_number",
          "address_components",
          "user_ratings_total",
          "rating",
          "types",
          "url",
        ].join(",")
      );

      const response = await fetch(detailsUrl);
      if (!response.ok) return null;
      const data = await response.json();
      return data?.result || null;
    };

    const stateMatches = (details) => {
      const stateComp = details?.address_components?.find((c) =>
        Array.isArray(c?.types) && c.types.includes("administrative_area_level_1")
      );
      const stateCode = stateComp?.short_name?.toUpperCase() || null;
      return Boolean(stateCode && stateCode === stateRaw);
    };

    // 1) Phone-first search
    if (normalizedDigits && normalizedDigits.length === 10 && e164) {
      const findUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
      );
      findUrl.searchParams.set("key", placesApiKey);
      findUrl.searchParams.set("input", e164);
      findUrl.searchParams.set("inputtype", "phonenumber");
      findUrl.searchParams.set(
        "fields",
        [
          "place_id",
          "name",
          "formatted_address",
          "formatted_phone_number",
          "international_phone_number",
          "types",
        ].join(",")
      );

      const findResponse = await fetch(findUrl);
      if (findResponse.ok) {
        const findData = await findResponse.json();
        const candidates = Array.isArray(findData?.candidates)
          ? findData.candidates
          : [];

        for (const candidate of candidates) {
          const details = await fetchPlaceDetails({
            apiKey: placesApiKey,
            placeId: candidate?.place_id,
          });
          if (!details) continue;
          if (!stateMatches(details)) continue;

          const googleDigits = normalizePhoneDigits(
            details.international_phone_number || details.formatted_phone_number || ""
          );

          if (googleDigits && normalizedDigits && googleDigits === normalizedDigits) {
            filteredCandidates.push(mapDetailsToCandidate(details));
          }
        }

        if (filteredCandidates.length > 0) {
          return res.json({ ok: true, candidates: filteredCandidates });
        }
      }
    }

    // 2) Text search fallback
    const textQueryParts = [businessName];
    if (stateRaw) textQueryParts.push(stateRaw);
    const textQuery = textQueryParts.join(" ").trim();

    if (textQuery) {
      const textUrl = new URL(
        "https://maps.googleapis.com/maps/api/place/textsearch/json"
      );
      textUrl.searchParams.set("key", placesApiKey);
      textUrl.searchParams.set("query", textQuery);
      textUrl.searchParams.set("region", "us");
      textUrl.searchParams.set("type", "establishment");

      const textResponse = await fetch(textUrl);
      if (textResponse.ok) {
        const textData = await textResponse.json();
        const results = Array.isArray(textData?.results) ? textData.results : [];

        for (const result of results) {
          const details = await fetchPlaceDetails({
            apiKey: placesApiKey,
            placeId: result?.place_id,
          });
          if (!details) continue;
          if (!stateMatches(details)) continue;

          filteredCandidates.push(mapDetailsToCandidate(details));
        }
      }
    }

    if (filteredCandidates.length === 0) {
      return res.json({ ok: false, error: "NO_RESULTS_IN_STATE" });
    }

    filteredCandidates.sort((a, b) => Number(b.samePhone) - Number(a.samePhone));

    return res.json({ ok: true, candidates: filteredCandidates });
  } catch (err) {
    console.error("[googlePlacesSearch] unexpected error", err);
    return res.status(200).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Failed to query Google Places",
    });
  }
});

exports.googlePlacesSearch2 = functions.https.onRequest((req, res) =>
  searchGooglePlacesWithValidation(req, res, { label: "googlePlacesSearch2" })
);

exports.health = functions.https.onRequest((req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  res.json({ ok: true, buildId: BUILD_ID, testMode: TEST_MODE });
});

const isAllowedGoogleAuthOrigin = (origin = "") => {
  const allowedOrigins = new Set([
    "https://reviewresq.com",
    "https://www.reviewresq.com",
    "http://localhost:3000",
    "http://localhost:5000",
  ]);
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
};

const applyGoogleAuthCors = (req, res) => {
  const origin = req.headers.origin || "";
  const allowed = isAllowedGoogleAuthOrigin(origin);
  const allowOrigin = origin
    ? allowed
      ? origin
      : null
    : "https://reviewresq.com";

  if (allowOrigin) {
    res.set("Access-Control-Allow-Origin", allowOrigin);
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Credentials", "true");
  res.set("Vary", "Origin");

  if (origin && !allowed) {
    res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
    return false;
  }

  return true;
};

const googleAuthGetConfigHandler = (req, res) => {
  const corsOk = applyGoogleAuthCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (!corsOk) {
    return; // Response already handled inside applyGoogleAuthCors
  }

  const { clientId, redirectUri, scopes, canonicalRedirectUri } =
    resolveGoogleOAuthServerConfig();
  const effectiveRedirectUri = canonicalRedirectUri || redirectUri;

  if (!clientId || !effectiveRedirectUri) {
    return res.status(200).json({
      ok: false,
      error: "MISSING_GOOGLE_OAUTH_CONFIG",
    });
  }

  return res.status(200).json({
    ok: true,
    clientId,
    redirectUri: effectiveRedirectUri,
    scopes,
  });
};

exports.googleAuthGetConfig = functions
  .region("us-central1")
  .https.onRequest((req, res) => googleAuthGetConfigHandler(req, res));

// Gen2 endpoint for OAuth config (keeps Gen1 endpoint unchanged)
// Quick self-test:
//   curl https://us-central1-reviewresq-app.cloudfunctions.net/googleAuthGetConfigV2
exports.googleAuthGetConfigV2 = onRequest(
  {
    region: "us-central1",
    secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
  },
  googleAuthGetConfigHandler,
);

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const oauthStateCollection = () =>
  admin.firestore().collection("googleOAuthStates");

const googleAuthCreateStateHandler = async (req, res) => {
  const corsOk = applyOAuthCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }
  if (!corsOk) {
    return res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const envCheck = ensureGoogleEnvForRuntime(null, {
      requireOAuth: true,
      requireAuth: false,
      context: "googleAuthCreateState",
    });
    if (!envCheck.ok) {
      return res.status(500).json({
        ok: false,
        reason: "missing_config",
        message: "Google OAuth is not configured.",
        missing: envCheck.missing,
      });
    }

    const oauthConfig = resolveGoogleOAuthServerConfig();
    const chosenRedirectUri = oauthConfig.canonicalRedirectUri || oauthConfig.redirectUri;
    if (!oauthConfig.clientId || !chosenRedirectUri) {
      console.error("[google-oauth] Missing clientId/redirectUri. OAuth disabled.");
      return res.status(500).json({ ok: false, reason: "OAUTH_CONFIG_MISSING" });
    }

    const state = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    const returnTo = req.body?.returnTo || null;
    await oauthStateCollection().doc(state).set({
      uid: req.body?.uid || null,
      createdAt: now,
      expiresAt: now + OAUTH_STATE_TTL_MS,
      returnTo,
    });

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", oauthConfig.clientId);
    authUrl.searchParams.set("redirect_uri", chosenRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set(
      "scope",
      "openid email profile https://www.googleapis.com/auth/business.manage"
    );
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");

    const redactedAuthUrl = redactOAuthUrl(authUrl.toString());
    console.log("[google-oauth] built OAuth consent URL", {
      redirectUri: chosenRedirectUri,
      authUrl: redactedAuthUrl,
    });

    return res.json({
      ok: true,
      state,
      redirectUri: chosenRedirectUri,
      scopes: oauthConfig.scopes,
      authUrl: redactedAuthUrl,
    });
  } catch (err) {
    console.error("[google-oauth] googleAuthCreateState failed", err);
    return res
      .status(500)
      .json({ ok: false, message: err?.message || "OAuth unavailable" });
  }
};

exports.googleAuthCreateState = functions
  .region("us-central1")
  .https.onRequest((req, res) => googleAuthCreateStateHandler(req, res));

// Gen2 endpoint for creating OAuth state (keeps Gen1 endpoint unchanged)
exports.googleAuthCreateStateV2 = onRequest(
  {
    region: "us-central1",
    secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
  },
  googleAuthCreateStateHandler,
);

const exchangeGoogleAuthCodeHandler = async (req, res) => {
  const corsOk = applyOAuthCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }
  if (!corsOk) {
    return res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const code = req.body?.code;
    const state = req.body?.state;
    if (!code || !state) {
      return res
        .status(400)
        .json({ ok: false, reason: "invalid_request", message: "Missing code or state" });
    }

    const envCheck = ensureGoogleEnvForRuntime(null, {
      requireOAuth: true,
      requireAuth: false,
      context: "exchangeGoogleAuthCode",
    });
    if (!envCheck.ok) {
      return res.status(500).json({
        ok: false,
        reason: "missing_config",
        message: "Google OAuth is not configured.",
        missing: envCheck.missing,
      });
    }

    const oauthConfig = resolveGoogleOAuthServerConfig();

    const expectedRedirectUri = oauthConfig.canonicalRedirectUri || GOOGLE_CANONICAL_REDIRECT_URI;
    const configuredRedirectUri = oauthConfig.redirectUri;

    if (!oauthConfig.clientId || !oauthConfig.clientSecret || !configuredRedirectUri) {
      return res.status(500).json({
        ok: false,
        reason: "OAUTH_CONFIG_MISSING",
        message: "Google OAuth is not configured.",
      });
    }

    if (configuredRedirectUri !== expectedRedirectUri) {
      return res.status(400).json({
        ok: false,
        reason: "INVALID_REDIRECT_URI",
        message: `Redirect URI mismatch. Expected ${expectedRedirectUri} but received ${configuredRedirectUri}.`,
        expected: expectedRedirectUri,
        received: configuredRedirectUri,
      });
    }

    const stateRef = oauthStateCollection().doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) {
      return res.status(400).json({
        ok: false,
        reason: "INVALID_STATE",
        message: "OAuth state is invalid or has expired.",
      });
    }
    const stateData = stateSnap.data() || {};
    const expired = stateData.expiresAt && Date.now() > stateData.expiresAt;
    if (expired) {
      await stateRef.delete().catch(() => {});
      return res.status(400).json({
        ok: false,
        reason: "INVALID_STATE",
        message: "OAuth state is invalid or has expired.",
      });
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        redirect_uri: expectedRedirectUri,
        grant_type: "authorization_code",
        access_type: "offline",
        prompt: "consent",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => "");
      return res.status(400).json({
        ok: false,
        reason: "TOKEN_EXCHANGE_FAILED",
        message: "Unable to exchange Google authorization code.",
        details: errorText || null,
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData?.access_token;
    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        reason: "TOKEN_MISSING",
        message: "Google OAuth response did not include an access token.",
      });
    }

    const { accounts, locations } = await fetchGoogleBusinessLocationsWithToken(accessToken);
    const connection = {
      provider: "google",
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      accessToken,
      refreshToken: tokenData?.refresh_token || null,
      expiresAt:
        tokenData?.expires_in && tokenData.expires_in > 0
          ? Date.now() + tokenData.expires_in * 1000
          : null,
      scope: tokenData?.scope || null,
    };
    const cleanedLocations = Array.isArray(locations)
      ? locations.map((loc) => ({
          ...loc,
          provider: "google",
          connectionMethod: "google_oauth",
        }))
      : [];

    const uid = stateData.uid || req.body?.uid || null;
    if (uid) {
      const profileRef = db.collection("businessProfiles").doc(uid);
      await profileRef.set(
        {
          googleOAuth: connection,
          googleAccounts: accounts || [],
          googleLocations: cleanedLocations,
          googleConnectionType: "oauth",
        },
        { merge: true }
      );
    }

    await stateRef.delete().catch(() => {});

    const returnTo = stateData.returnTo || "/google-reviews.html";
    return res.json({ ok: true, accounts, locations, returnTo });
  } catch (err) {
    console.error("[google-oauth] exchangeGoogleAuthCode failed", err);
    return res
      .status(500)
      .json({ ok: false, message: err?.message || "OAuth unavailable" });
  }
};

exports.exchangeGoogleAuthCode = functions
  .region("us-central1")
  .https.onRequest((req, res) => exchangeGoogleAuthCodeHandler(req, res));

// Gen2 endpoint for exchanging OAuth code (keeps Gen1 endpoint unchanged)
exports.exchangeGoogleAuthCodeV2 = onRequest(
  {
    region: "us-central1",
    secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET],
  },
  exchangeGoogleAuthCodeHandler,
);

exports.connectGoogleBusiness = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required to connect Google Business."
    );
  }

  const placeId = data?.placeId || data?.place_id;
  if (!placeId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "placeId is required to connect Google Business."
    );
  }

  const envCheck = ensureGoogleEnvForRuntime(null, {
    requirePlaces: true,
    context: "connectGoogleBusiness",
  });

  if (!envCheck.ok) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "missing_config",
      { missing: envCheck.missing },
    );
  }

  const placesApiKey = resolvePlacesApiKey();

  if (!placesApiKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Server is missing the Google Places API key."
    );
  }

  const details = await fetchPlaceDetails({ apiKey: placesApiKey, placeId });
  if (!details) {
    throw new functions.https.HttpsError(
      "internal",
      "Failed to fetch place details from Google."
    );
  }

  const placePhoneDigits = normalizePhoneDigits(
    details.international_phone_number || details.formatted_phone_number || ""
  );

  const uid = context.auth.uid;
  const profileRef = db.collection("businessProfiles").doc(uid);
  const profileSnap = await profileRef.get();
  const profileData = profileSnap.exists ? profileSnap.data() : {};
  const existingLocations = deriveExistingLocations(profileData);
  const planId = await resolveUserPlanId(uid, profileData);
  const limit = planLocationLimit(planId);
  if (isAtPlanLimit(existingLocations, limit, placeId)) {
    return {
      ok: false,
      reason: "PLAN_LIMIT",
      message: planUpgradeMessage(planId),
      limit,
    };
  }
  const storedPhoneDigits = normalizePhoneDigits(
    profileData?.phone || profileData?.businessPhone || ""
  );

  if (!storedPhoneDigits || !placePhoneDigits) {
    return {
      ok: false,
      reason: "PHONE_MISSING",
      message:
        "We need a 10-digit phone number on both your profile and Google listing to connect.",
      details: {
        storedPhone: profileData?.phone || profileData?.businessPhone || null,
        placePhone:
          details.formatted_phone_number ||
          details.international_phone_number ||
          null,
      },
      placeId,
      googleProfilePreview: {
        name: details.name || null,
        address: details.formatted_address || null,
        phone:
          details.formatted_phone_number ||
          details.international_phone_number ||
          null,
      },
    };
  }

  const phoneMatches = storedPhoneDigits === placePhoneDigits;

  if (!phoneMatches) {
    return {
      ok: false,
      reason: "PHONE_MISMATCH",
      message:
        "The phone number on Google doesn’t match the phone in your ReviewResQ profile. Please update your profile phone and try again.",
      details: {
        storedPhone: profileData?.phone || profileData?.businessPhone || null,
        placePhone:
          details.formatted_phone_number ||
          details.international_phone_number ||
          null,
      },
      placeId,
      googleProfilePreview: {
        name: details.name || null,
        address: details.formatted_address || null,
        phone:
          details.formatted_phone_number ||
          details.international_phone_number ||
          null,
      },
    };
  }

  const googleReviewUrl = `https://search.google.com/local/review?placeid=${encodeURIComponent(
    placeId
  )}`;

  const googleProfile = {
    name: details.name,
    formatted_address: details.formatted_address,
    formatted_phone_number: details.formatted_phone_number,
    international_phone_number: details.international_phone_number,
    rating: details.rating,
    user_ratings_total: details.user_ratings_total,
    types: details.types,
    url: details.url,
  };

  const businessName =
    profileData?.businessName || data?.businessName || details.name || "";

  const phoneMismatch = Boolean(
    storedPhoneDigits && placePhoneDigits && !phoneMatches
  );

  const payload = {
    businessId: uid,
    ownerUid: uid,
    googlePlaceId: placeId,
    googleProfile,
    googleReviewUrl,
    connectionMethod: "candidate",
    verificationMethod: "phone",
    phoneMismatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const newLocationEntry = {
    provider: "google",
    verificationMethod: "phone",
    connectionMethod: "candidate",
    locationId: placeId,
    placeId,
    googlePlaceId: placeId,
    googleProfile,
    googleReviewUrl,
    role: profileData?.role || null,
    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  payload.googleLocations = upsertGoogleLocation(existingLocations, newLocationEntry);

  if (!profileData.googlePlaceId) {
    payload.googlePlaceId = placeId;
  }

  if (businessName) {
    payload.businessName = businessName;
  }

  await profileRef.set(payload, { merge: true });

  try {
    await upsertPublicBusiness(uid, {
      ...payload,
      businessName,
      logoUrl: resolveBusinessLogo(profileData),
      googleReviewLink: googleReviewUrl,
    });
  } catch (err) {
    console.error("[publicBusiness] failed to sync after connect by candidate", err);
  }

  return {
    ok: true,
    reason: "CONNECTED",
    message: "Google profile connected.",
    googleReviewUrl,
    googleProfile,
    placeId,
    phoneMismatch,
  };
});

exports.connectGoogleBusinessByReviewLink = functions.https.onCall(
  async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication required to connect Google Business."
      );
    }

    const reviewUrl = data?.reviewUrl || data?.url || "";
    const providedPlaceId = data?.placeId || null;
    const mapUrl = data?.mapUrl || reviewUrl;
    const dryRun = Boolean(data?.dryRun);
    const source = data?.source || "review_link";

    const envCheck = ensureGoogleEnvForRuntime(null, {
      requirePlaces: true,
      context: "connectGoogleBusinessByReviewLink",
    });

    if (!envCheck.ok) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "missing_config",
        { missing: envCheck.missing },
      );
    }

    const placesApiKey = resolvePlacesApiKey();

    if (!placesApiKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Server is missing the Google Places API key."
      );
    }

    let placeId = providedPlaceId || extractPlaceIdFromReviewUrl(reviewUrl);
    if (!placeId) {
      placeId = extractPlaceIdFromReviewUrl(mapUrl);
    }
    if (!placeId) {
      const cid = extractCidFromUrl(reviewUrl) || extractCidFromUrl(mapUrl);
      if (cid) {
        placeId = await resolvePlaceIdFromCid({ apiKey: placesApiKey, cid });
      }
    }

    if (!placeId) {
      return {
        ok: false,
        reason: "INVALID_REVIEW_URL",
        message: "Please provide a valid Google review link that includes placeid=",
      };
    }

    const details = await fetchPlaceDetails({ apiKey: placesApiKey, placeId });
    if (!details) {
      throw new functions.https.HttpsError(
        "internal",
        "Failed to fetch place details from Google."
      );
    }

    const uid = context.auth.uid;
    const profileRef = db.collection("businessProfiles").doc(uid);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() : {};
    const existingLocations = deriveExistingLocations(profileData);
    const planId = await resolveUserPlanId(uid, profileData);
    const limit = planLocationLimit(planId);
    if (isAtPlanLimit(existingLocations, limit, placeId)) {
      return {
        ok: false,
        reason: "PLAN_LIMIT",
        message: planUpgradeMessage(planId),
        limit,
      };
    }
    const storedPhoneDigits = normalizePhoneDigits(
      profileData?.phone || profileData?.businessPhone || ""
    );
    const placePhoneDigits = normalizePhoneDigits(
      details.international_phone_number || details.formatted_phone_number || ""
    );

    if (!storedPhoneDigits || !placePhoneDigits) {
      return {
        ok: false,
        reason: "PHONE_MISSING",
        message:
          "We need a 10-digit phone number on both your profile and Google listing to connect.",
        placeId,
        googleProfilePreview: {
          name: details.name || null,
          address: details.formatted_address || null,
          phone:
            details.formatted_phone_number ||
            details.international_phone_number ||
            null,
        },
      };
    }

    const phoneMatches = storedPhoneDigits === placePhoneDigits;

    const googleReviewUrl = `https://search.google.com/local/review?placeid=${encodeURIComponent(
      placeId
    )}`;

    const googleProfile = {
      name: details.name,
      formatted_address: details.formatted_address,
      formatted_phone_number: details.formatted_phone_number,
      international_phone_number: details.international_phone_number,
      rating: details.rating,
      user_ratings_total: details.user_ratings_total,
      types: details.types,
      url: details.url,
    };

    const businessName =
      profileData?.businessName || data?.businessName || details.name || "";
    const phoneMismatch = Boolean(
      storedPhoneDigits && placePhoneDigits && !phoneMatches
    );

    const previewPayload = {
      ok: phoneMatches,
      reason: phoneMatches ? "PREVIEW_OK" : "PHONE_MISMATCH",
      message: phoneMatches
        ? "Listing verified."
        : "The phone number on Google doesn’t match the phone in your ReviewResQ profile. Please update your profile phone and try again.",
      placeId,
      phoneMismatch,
      googleProfilePreview: {
        name: details.name || null,
        address: details.formatted_address || null,
        phone:
          details.formatted_phone_number ||
          details.international_phone_number ||
          null,
        rating: details.rating || null,
        user_ratings_total: details.user_ratings_total || null,
      },
    };

    if (dryRun || phoneMismatch) {
      return previewPayload;
    }

    const payload = {
      businessId: uid,
      ownerUid: uid,
      googlePlaceId: placeId,
      googleProfile,
      googleReviewUrl,
      connectionMethod: source,
      verificationMethod: "phone",
      phoneMismatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const newLocationEntry = {
      provider: "google",
      verificationMethod: "phone",
      connectionMethod: source,
      locationId: placeId,
      placeId,
      googlePlaceId: placeId,
      googleProfile,
      googleReviewUrl,
      role: profileData?.role || null,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    payload.googleLocations = upsertGoogleLocation(existingLocations, newLocationEntry);

    if (!profileData.googlePlaceId) {
      payload.googlePlaceId = placeId;
    }

    if (businessName) {
      payload.businessName = businessName;
    }

    await profileRef.set(payload, { merge: true });

    try {
      await upsertPublicBusiness(uid, {
        ...payload,
        businessName,
        logoUrl: resolveBusinessLogo(profileData),
        googleReviewLink: googleReviewUrl,
      });
    } catch (err) {
      console.error("[publicBusiness] failed to sync after review link connect", err);
    }

    return {
      ok: true,
      reason: "CONNECTED",
      message: "Google profile connected.",
      googleReviewUrl,
      googleProfile,
      placeId,
      phoneMismatch,
    };
  }
);

const applyReviewFunnelPatch = async ({ businessId, authUid, rawPatch }) => {
  if (!authUid) {
    const error = new functions.https.HttpsError(
      "unauthenticated",
      "Sign in to update review funnel settings.",
    );
    throw error;
  }

  if (businessId !== authUid) {
    const error = new functions.https.HttpsError(
      "permission-denied",
      "You can only update review funnel settings for your own business.",
    );
    throw error;
  }

  const { ref: businessRef, capabilities, data: businessData } = await loadBusinessAccount(businessId);
  const { features, plan } = capabilities;
  const allowManualOverride = Boolean(businessData?.features?.reviewFunnelAllowManualOverride);

  const sanitizedPatch = sanitizeReviewFunnelPatch(rawPatch || {});

  if (features.reviewFunnelAIManaged && !allowManualOverride) {
    const error = new functions.https.HttpsError(
      "permission-denied",
      "Review funnel is managed by AI on this plan.",
    );
    throw error;
  }

  let allowedPatch = sanitizedPatch;

  if (plan === "starter") {
    const starterPaths = [
      "happy.headline",
      "happy.ctaLabel",
      "happy.prompt",
      "happy.googleReviewUrl",
    ];
    allowedPatch = pickAllowedPatch(sanitizedPatch, starterPaths);
    if (!Object.keys(allowedPatch || {}).length) {
      const error = new functions.https.HttpsError(
        "permission-denied",
        "Starter includes limited review funnel edits. Upgrade for more control.",
      );
      throw error;
    }
  }

  if (!Object.keys(allowedPatch || {}).length) {
    const error = new functions.https.HttpsError("failed-precondition", "No changes supplied.");
    throw error;
  }

  const settingsRef = businessRef.collection("settings").doc("reviewFunnel");
  const settingsSnap = await settingsRef.get();
  const currentSettings = settingsSnap.exists ? settingsSnap.data() : DEFAULT_REVIEW_FUNNEL_SETTINGS;

  const mergedSettings = mergeDeep(currentSettings, allowedPatch);
  mergedSettings.mode =
    features.reviewFunnelAIManaged && !allowManualOverride
      ? "ai"
      : sanitizedPatch.mode === "ai"
        ? "ai"
        : "manual";
  mergedSettings.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await settingsRef.set(mergedSettings, { merge: true });

  return {
    ok: true,
    plan,
    mode: mergedSettings.mode,
    appliedPaths: Object.keys(allowedPatch || {}),
  };
};

const REVIEW_FUNNEL_SETTINGS_BASE = {
  mode: "manual",
  happy: {
    headline: "Thanks for your visit!",
    prompt: "Share a quick note about your experience so others know what to expect.",
    ctaLabel: "Leave us a Google review",
    googleReviewUrl: "",
  },
  unhappy: {
    headline: "We're here to make it right",
    message: "Tell us what happened and how we can improve. We'll respond quickly.",
    followupEmail: "",
  },
  routing: {
    enabled: true,
    type: "rating",
    thresholds: { googleMin: 4 },
  },
  branding: {
    logoUrl: "",
    primaryColor: "#2563eb",
  },
  updatedAt: null,
};

const REVIEW_FUNNEL_ALLOWED_ORIGINS = new Set([
  "https://reviewresq.com",
  "https://www.reviewresq.com",
]);

const isDevOrigin = (origin = "") => /^http:\/\/localhost(:\d+)?$/i.test(origin);

const applyReviewFunnelCors = (req, res) => {
  const origin = req.headers.origin || "";
  const allowedOrigin =
    REVIEW_FUNNEL_ALLOWED_ORIGINS.has(origin) || isDevOrigin(origin)
      ? origin
      : "https://reviewresq.com";

  res.set("Access-Control-Allow-Origin", allowedOrigin);
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Max-Age", "3600");
  res.set("Vary", "Origin");

  return allowedOrigin;
};

exports.updateReviewFunnelSettings = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {
    applyReviewFunnelCors(req, res);

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }

    let authUid = null;
    try {
      const tokenHeader = req.headers.authorization || "";
      const token = tokenHeader.startsWith("Bearer ")
        ? tokenHeader.slice(7)
        : null;

      if (!token) {
        return res.status(401).json({ error: "unauthenticated" });
      }

      const decoded = await admin.auth().verifyIdToken(token);
      authUid = decoded.uid;
    } catch (err) {
      console.error("[reviewFunnel] auth failed", err);
      return res.status(401).json({ error: "unauthenticated" });
    }

    const businessId =
      req.method === "GET"
        ? req.query?.businessId || authUid
        : req.body?.businessId || authUid;

    if (!businessId || businessId !== authUid) {
      return res.status(403).json({ error: "permission_denied" });
    }

    const settingsRef = db
      .collection("businessProfiles")
      .doc(String(businessId))
      .collection("reviewFunnel")
      .doc("settings");

    if (req.method === "GET") {
      try {
        const settingsSnap = await settingsRef.get();
        const settings = settingsSnap.exists ? settingsSnap.data() : {};
        const mergedSettings = mergeDeep(REVIEW_FUNNEL_SETTINGS_BASE, settings || {});
        return res.status(200).json({ ok: true, settings: mergedSettings });
      } catch (err) {
        console.error("[reviewFunnel] load failed", err);
        return res
          .status(500)
          .json({ error: "load_failed", message: "Unable to load review funnel settings" });
      }
    }

    try {
      const rawSettings =
        req.body?.settings || req.body?.patch || (req.body || {});
      const sanitized = sanitizeReviewFunnelPatch(rawSettings || {});

      if (!Object.keys(sanitized).length) {
        return res.status(400).json({ error: "invalid_settings" });
      }

      const settingsSnap = await settingsRef.get();
      const existingSettings = settingsSnap.exists ? settingsSnap.data() : {};
      const mergedSettings = mergeDeep(existingSettings || {}, sanitized);
      const payload = {
        ...mergedSettings,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await settingsRef.set(payload, { merge: true });

      const savedSnap = await settingsRef.get();
      const savedSettings = mergeDeep(
        REVIEW_FUNNEL_SETTINGS_BASE,
        savedSnap.exists ? savedSnap.data() : {},
      );

      return res.status(200).json({ ok: true, settings: savedSettings });
    } catch (err) {
      console.error("[reviewFunnel] update failed", err);
      return res.status(500).json({ error: "update_failed" });
    }
  });

exports.connectGoogleManualLink = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required to connect Google Business."
    );
  }

  const manualLink = (data?.manualLink || data?.link || data?.url || "").trim();
  let normalizedLink = null;
  let normalizedHost = null;
  let placeIdFromLink = null;

  try {
    const parsed = new URL(manualLink);
    normalizedLink = parsed.href;
    normalizedHost = parsed.host;
    placeIdFromLink = extractPlaceIdFromUrl(normalizedLink);
  } catch (err) {
    normalizedLink = null;
  }

  if (!manualLink || !normalizedLink || !isValidGoogleBusinessUrl(manualLink)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Please provide a valid Google Maps business or reviews link."
    );
  }

  const uid = context.auth.uid;
  const profileRef = db.collection("businessProfiles").doc(uid);
  const profileSnap = await profileRef.get();
  const profileData = profileSnap.exists ? profileSnap.data() : {};

  if (
    profileData?.googlePlaceId &&
    profileData?.googleConnectionType !== "manual" &&
    profileData?.connectionMethod !== "manual"
  ) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "A Google profile is already connected automatically."
    );
  }

  await profileRef.set(
    {
      businessId: uid,
      ownerUid: uid,
      googleManualLink: normalizedLink,
      googleReviewUrl: placeIdFromLink ? buildGoogleReviewUrl(placeIdFromLink) : profileData.googleReviewUrl || "",
      googlePlaceId: placeIdFromLink || profileData.googlePlaceId || null,
      googleManualConnection: true,
      googleConnectionType: "manual",
      connectionMethod: "manual",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const googleProfileRef = db.collection("googleProfiles").doc(uid);
  await googleProfileRef.set(
    {
      connectionType: "manual",
      manualBusinessName:
        data?.businessName || profileData?.businessName || profileData?.name || "",
      manualGoogleUrl: normalizedLink,
      normalizedHost,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const businessRef = db.collection("businesses").doc(uid);
  await businessRef.set(
    {
      businessId: uid,
      ownerUid: uid,
      googleManualLink: normalizedLink,
      googleReviewUrl: placeIdFromLink
        ? buildGoogleReviewUrl(placeIdFromLink)
        : profileData.googleReviewUrl || normalizedLink,
      ...(placeIdFromLink ? { googlePlaceId: placeIdFromLink } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await upsertPublicBusiness(uid, {
      businessId: uid,
      businessName:
        data?.businessName || profileData?.businessName || profileData?.name || "",
      logoUrl: resolveBusinessLogo(profileData),
      googleReviewLink: placeIdFromLink
        ? buildGoogleReviewUrl(placeIdFromLink)
        : profileData.googleReviewUrl || normalizedLink,
      shareKey: profileData?.shareKey,
    });
  } catch (err) {
    console.error("[publicBusiness] failed to sync after manual connect", err);
  }

  return {
    ok: true,
    reason: "MANUAL_CONNECTED",
    message: "Google profile connected manually.",
    googleManualLink: normalizedLink,
    googleConnectionType: "manual",
    normalizedHost,
    googleReviewUrl: placeIdFromLink ? buildGoogleReviewUrl(placeIdFromLink) : null,
  };
});

exports.createCustomerManual = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required to add customers manually.",
    );
  }

  const businessId = data?.businessId || context.auth.uid;
  const name = (data?.name || "").toString().trim();
  const phone = (data?.phone || "").toString().trim();
  const email = (data?.email || "").toString().trim();
  const reviewStatus = normalizeReviewStatus(data?.reviewStatus || "none");

  if (!name && !phone && !email) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Provide at least one of name, phone, or email to create a customer.",
    );
  }

  const customerId = await upsertCustomerRecord({
    businessId,
    name: name || null,
    phone: phone || null,
    email: email || null,
    source: "manual",
    reviewStatus,
  });

  return { ok: true, customerId };
});

exports.createInviteToken = functions.https.onCall(async (data = {}, context) => {
  const caller = context.auth?.uid;
  const businessId = data.businessId || caller;
  const customerId = data.customerId;
  const channelRaw = typeof data.channel === "string" ? data.channel.toLowerCase() : "manual";
  const allowedChannels = new Set(["sms", "email", "whatsapp", "manual", "link"]);
  const channel = allowedChannels.has(channelRaw) ? channelRaw : "manual";
  const customerName = data.customerName || data.name || "";
  const phone = data.phone || "";
  const email = data.email || "";
  const source = data.source || "manual";

  if (!caller || !businessId || caller !== businessId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only business owners can create invite tokens.",
    );
  }

  if (!customerId && !customerName && !phone && !email) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Provide a customerId or customer contact details to create an invite token.",
    );
  }

  try {
    return await createInviteToken({
      businessId,
      customerId,
      customerName,
      phone,
      email,
      channel,
      source,
    });
  } catch (err) {
    console.error("[functions.createInviteToken] failed", err);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError("internal", err?.message || "Unable to create invite token");
  }
});

exports.createInviteTokenCallable = functions.https.onCall(async (data = {}, context) => {
  const caller = context.auth?.uid;
  const businessId = data.businessId || caller;
  const customerId = data.customerId;
  const customerName = (data.customerName || data.name || "").toString().trim();
  const phone = (data.phone || "").toString().trim();
  const email = (data.email || "").toString().trim();
  const channelRaw = typeof data.channel === "string" ? data.channel.toLowerCase() : "manual";
  const allowedChannels = new Set(["sms", "email", "whatsapp", "manual", "link"]);
  const channel = allowedChannels.has(channelRaw) ? channelRaw : "manual";
  const source = data.source || "ask-reviews";

  if (!caller) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication is required.");
  }

  if (!businessId || caller !== businessId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only business owners can create invite tokens.",
    );
  }

  if (!customerName) {
    throw new functions.https.HttpsError("invalid-argument", "customerName is required.");
  }

  if (channel === "email" && !email) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Email is required for email invitations.",
    );
  }

  try {
    const inviteResponse = await createInviteToken({
      businessId,
      customerId,
      customerName,
      phone,
      email,
      channel,
      source,
    });

    return { ok: true, ...inviteResponse, portalLink: inviteResponse.portalUrl };
  } catch (err) {
    console.error("[functions.createInviteTokenCallable] failed", err);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError(
      "internal",
      err?.message || "Unable to create invite token",
    );
  }
});

exports.importCustomersCsv = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required to import customers from CSV.",
    );
  }

  const businessId = data?.businessId || context.auth.uid;
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const previewOnly = !!data?.preview;

  if (!rows.length) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "rows must be a non-empty array of customer records",
    );
  }

  const maxRows = Math.min(rows.length, 1000);
  const seenKeys = new Set();
  const duplicatesInUpload = [];
  let skippedEmpty = 0;
  const parsedRows = [];

  for (const row of rows.slice(0, maxRows)) {
    const name = (row?.name || row?.Name || "").toString().trim();
    const phone = (row?.phone || row?.Phone || "").toString().trim();
    const email = (row?.email || row?.Email || "").toString().trim();

    const phoneKey = normalizePhone(phone);
    const emailKey = normalizeEmail(email);

    if (!name && !phoneKey && !emailKey) {
      skippedEmpty += 1;
      continue;
    }

    const keys = [
      phoneKey ? `phone:${phoneKey}` : null,
      emailKey ? `email:${emailKey}` : null,
    ].filter(Boolean);

    const duplicateKey = keys.find((key) => seenKeys.has(key));
    if (duplicateKey) {
      duplicatesInUpload.push({ name, phone, email, reason: "duplicate_in_upload" });
      continue;
    }

    keys.forEach((key) => seenKeys.add(key));
    parsedRows.push({ name: name || null, phone: phone || null, email: email || null, phoneKey, emailKey });
  }

  const existingMatches = await findExistingCustomerContacts({
    businessId,
    phones: parsedRows.map((row) => row.phoneKey).filter(Boolean),
    emails: parsedRows.map((row) => row.emailKey).filter(Boolean),
  });

  const readyRows = [];
  const existingDuplicates = [];

  for (const row of parsedRows) {
    const alreadyExists =
      (row.phoneKey && existingMatches.phones.has(row.phoneKey)) ||
      (row.emailKey && existingMatches.emails.has(row.emailKey));

    if (alreadyExists) {
      existingDuplicates.push({
        name: row.name,
        phone: row.phone,
        email: row.email,
        reason: "already_exists",
      });
      continue;
    }

    readyRows.push(row);
  }

  const preview = {
    totalRows: rows.length,
    acceptedColumns: ["name", "phone", "email"],
    importable: readyRows.length,
    duplicatesInUpload: duplicatesInUpload.length,
    duplicatesExisting: existingDuplicates.length,
    skippedEmpty,
    sample: readyRows.slice(0, 20).map(({ name, phone, email }) => ({ name, phone, email })),
    blocked: [...duplicatesInUpload, ...existingDuplicates].slice(0, 20),
  };

  if (previewOnly) {
    return { ok: true, preview };
  }

  const reviewStatus = normalizeReviewStatus(data?.reviewStatus || "none");
  const savedIds = [];

  for (const row of readyRows) {
    const customerId = await upsertCustomerRecord({
      businessId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      source: "csv",
      reviewStatus,
    });

    savedIds.push(customerId);
  }

  return { ok: true, imported: savedIds.length, customerIds: savedIds, preview };
});

exports.syncCustomersFromSheet = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required to sync customers from Google Sheets.",
    );
  }

  const businessId = data?.businessId || context.auth.uid;
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  if (!rows.length) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "rows must be a non-empty array when syncing from sheets",
    );
  }

  const savedIds = [];

  for (const row of rows) {
    const name = (row?.name || row?.Name || "").toString().trim();
    const phone = (row?.phone || row?.Phone || "").toString().trim();
    const email = (row?.email || row?.Email || "").toString().trim();
    const reviewStatus = normalizeReviewStatus(
      row?.reviewStatus || row?.status || data?.reviewStatus || "none",
    );

    let lastInteractionAt = null;
    if (row?.lastInteractionAt) {
      const parsed = new Date(row.lastInteractionAt);
      if (!Number.isNaN(parsed.getTime())) {
        lastInteractionAt = parsed;
      }
    }

    if (!name && !phone && !email) continue;

    const customerId = await upsertCustomerRecord({
      businessId,
      name: name || null,
      phone: phone || null,
      email: email || null,
      source: "sheet",
      reviewStatus,
      lastInteractionAt,
    });

    savedIds.push(customerId);
  }

  return { ok: true, synced: savedIds.length, customerIds: savedIds };
});

exports.ingestCustomerWebhook = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  res.set("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const expectedToken = process.env.CUSTOMER_WEBHOOK_TOKEN;
  const providedToken =
    req.headers["x-api-key"] || req.query?.token || req.headers.authorization;

  if (expectedToken && providedToken !== expectedToken) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { businessId, name, phone, email, reviewStatus, lastInteractionAt } =
    req.body || {};

  if (!businessId) {
    return res.status(400).json({ error: "missing_business_id" });
  }

  try {
    const parsedLastInteraction = lastInteractionAt
      ? new Date(lastInteractionAt)
      : null;

    const customerId = await upsertCustomerRecord({
      businessId,
      name: name || null,
      phone: phone || null,
      email: email || null,
      source: "webhook",
      reviewStatus: normalizeReviewStatus(reviewStatus || "none"),
      lastInteractionAt: parsedLastInteraction,
    });

    return res.status(200).json({ ok: true, customerId });
  } catch (err) {
    console.error("[customers] webhook ingestion failed", err);
    return res.status(500).json({ error: "ingest_failed" });
  }
});

const extractInviteTokenFromUrl = (url = "") => {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("t");
  } catch (err) {
    return null;
  }
};

const resolvePortalUrl = ({ businessId, inviteToken, portalUrl }) => {
  if (portalUrl) return portalUrl;
  if (businessId && inviteToken) {
    return `https://reviewresq.com/portal.html?businessId=${encodeURIComponent(
      businessId,
    )}&t=${encodeURIComponent(inviteToken)}`;
  }
  return null;
};

async function enforceEmailRateLimit(businessId) {
  if (!businessId) return;
  const windowStart = admin.firestore.Timestamp.fromMillis(
    Date.now() - EMAIL_RATE_LIMIT_WINDOW_MS,
  );

  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("outboundRequests")
    .where("createdAt", ">", windowStart)
    .orderBy("createdAt", "desc")
    .limit(EMAIL_RATE_LIMIT_MAX * 2)
    .get();

  const recentEmails = snap.docs.filter((doc) => (doc.data()?.channel || "") === "email");
  if (recentEmails.length > EMAIL_RATE_LIMIT_MAX) {
    throw new functions.https.HttpsError(
      "resource-exhausted",
      "Too many email requests. Please wait and try again.",
    );
  }
}

async function sendReviewRequestEmailCore({
  businessId,
  toEmail,
  customerName,
  portalUrl,
  customerPhone = null,
  source = "manual",
  requestId: explicitRequestId = null,
}) {
  if (!businessId) {
    throw new functions.https.HttpsError("invalid-argument", "businessId is required");
  }

  const email = normalizeEmail(toEmail);
  if (!email || !basicEmailRegex.test(email)) {
    throw new functions.https.HttpsError("invalid-argument", "A valid email is required.");
  }

  const { profile, brandingState } = await assertBusinessBrandingComplete(businessId);
  const identityData = profile.data || {};
  const brandingDetails = brandingState.branding;
  const identity = {
    businessName: brandingDetails.name || resolveBusinessName(identityData) || "ReviewResq",
    logoUrl: brandingDetails.logoUrl || resolveBusinessLogo(identityData),
    googleReviewLink: resolveGoogleReviewLink(identityData) || identityData.googleReviewUrl || "",
  };

  const sendgrid = resolveSendgridConfig();
  console.log("[sendgrid] config resolved", {
    businessId,
    source: sendgrid.source,
    hasSender: Boolean(sendgrid.sender),
  });

  if (!sendgrid.apiKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "email_sending_not_configured",
    );
  }

  const requestId = explicitRequestId || crypto.randomBytes(12).toString("hex");
  const portal =
    portalUrl || `https://reviewresq.com/portal.html?businessId=${encodeURIComponent(businessId)}`;
  const customerLabel = customerName || null;

  await enforceEmailRateLimit(businessId);

  sgMail.setApiKey(sendgrid.apiKey);

  const businessName = identity.businessName || "ReviewResq";
  const safeCustomerName = customerLabel || "there";
  const subject = `Quick feedback request from ${businessName}`;
  const text =
    `Hi ${safeCustomerName},\n\n` +
    `${businessName} would love a quick note about your experience.\n\n` +
    `Share your feedback securely here: ${portal}\n\n` +
    `If you didn’t request this, you can ignore this email.`;

  const senderEmail = sendgrid.sender || DEFAULT_SENDGRID_SENDER;
  const senderName = brandingDetails.senderName || businessName || "ReviewResq";
  const supportEmail = brandingDetails.supportEmail || DEFAULT_SENDGRID_SENDER;
  const sender = { email: senderEmail, name: senderName };
  const replyTo = { email: supportEmail, name: senderName };

  const logoImgHtml = identity.logoUrl
    ? `<div style="margin-bottom:16px; text-align:center;">
         <img src="${identity.logoUrl}" alt="${businessName} logo"
              style="max-width:160px;height:auto;border-radius:12px;" />
       </div>`
    : "";

  const html = `
    <div style="font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color:#f9fafb; padding:24px;">
      <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(15,23,42,0.12);">
        ${logoImgHtml}
        <h2 style="margin:0 0 12px; color:#0f172a; font-size:20px;">Hi ${safeCustomerName},</h2>
        <p style="margin:0 0 16px; color:#475569; font-size:15px; line-height:1.6;">${businessName} would love a quick note about your experience. Your response helps us improve.</p>
        <div style="text-align:center; margin:24px 0;">
          <a href="${portal}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block; padding:14px 28px; border-radius:999px; background:#2563eb; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; letter-spacing:0.01em;">
            Share feedback
          </a>
        </div>
        <p style="margin:0 0 12px; color:#6b7280; font-size:13px; line-height:1.5;">If the button doesn't work, copy and paste this link:</p>
        <p style="margin:0 0 16px; color:#0f172a; font-size:13px; word-break:break-word;">${portal}</p>
        <p style="margin:0; color:#94a3b8; font-size:12px;">If you didn’t request this, you can ignore this message.</p>
      </div>
    </div>
  `;

  const outboundDefaults = buildOutboundDefaults({
    businessId,
    requestId,
    channel: "email",
    customerName: customerLabel,
    customerEmail: email,
    customerPhone: customerPhone || null,
    reviewLink: portal,
    status: "sending",
    provider: "sendgrid",
  });

  const nowMs = Date.now();

  await updateOutboundRequest({
    businessId,
    requestId,
    defaults: outboundDefaults,
    updates: {
      status: "sending",
      customerName: customerLabel,
      customerEmail: email,
      customerPhone: customerPhone || null,
      reviewLink: portal,
      provider: "sendgrid",
      source,
      error: null,
      processedAtMs: nowMs,
    },
  });

  const msg = {
    to: email,
    from: sender,
    replyTo,
    subject,
    text,
    html,
    customArgs: {
      businessId,
      requestId,
    },
    headers: {
      "List-Unsubscribe": `<mailto:${supportEmail}?subject=unsubscribe>`,
    },
    trackingSettings: {
      clickTracking: { enable: true, enableText: true },
      openTracking: { enable: true },
    },
  };

  console.log("[email] sending review request", {
    businessId,
    businessName,
    to: maskEmail(email),
    sender,
    configSource: sendgrid.source,
  });

  let providerMessageId = null;
  try {
    const [response] = await sgMail.send(msg);
    const rawMessageId =
      response?.headers?.["x-message-id"] || response?.headers?.["X-Message-Id"] || null;
    const headerMap = Object.fromEntries(
      Object.entries(response?.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    providerMessageId = rawMessageId || headerMap["x-message-id"] || headerMap["x-message-id"] || null;

    await updateOutboundRequest({
      businessId,
      requestId,
      defaults: outboundDefaults,
      updates: {
        status: "sent",
        providerMessageId: providerMessageId || null,
        sentAtMs: Date.now(),
        error: null,
      },
    });
    console.log("[email] review request sent", {
      businessId,
      businessName,
      requestId,
      to: maskEmail(email),
      sender,
      configSource: sendgrid.source,
      providerMessageId: providerMessageId || null,
    });
  } catch (err) {
    await updateOutboundRequest({
      businessId,
      requestId,
      defaults: outboundDefaults,
      updates: {
        status: "failed",
        error: { message: err?.message || "Send failed" },
      },
    });
    console.error("[email] review request send failed", {
      businessId,
      businessName,
      to: maskEmail(email),
      sender,
      configSource: sendgrid.source,
      error: err?.message,
    });
    throw err;
  }

  try {
    await upsertCustomerRecord({
      businessId,
      name: customerLabel || null,
      phone: customerPhone || null,
      email,
      source: normalizeCustomerSource(source || "manual"),
      reviewStatus: "requested",
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
      timelineEntry: {
        type: "email_sent",
        metadata: { reason: "review_invite" },
      },
    });
  } catch (err) {
    console.error("[customers] failed to record manual invite", err);
  }

  return {
    success: true,
    ok: true,
    portalUrl: portal,
    requestId,
    providerMessageId: providerMessageId || null,
  };
}

exports.sendReviewRequestEmail = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onCall(async (data, context) => {
    const caller = context.auth?.uid;
    const businessId = data?.businessId || caller;

    if (!caller) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication is required to send review requests.",
      );
    }

    if (!businessId || caller !== businessId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You can only send review requests for your own business.",
      );
    }

    return sendReviewRequestEmailCore({
      businessId,
      toEmail: data?.email || data?.toEmail || data?.customerEmail,
      customerName: data?.customerName,
      portalUrl: data?.portalUrl,
      customerPhone: data?.customerPhone || data?.phone,
      source: data?.source || "ask-reviews",
    });
  });

exports.sendReviewRequestEmailCallable = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onCall(async (data = {}, context) => {
    let logContext = { requestKeys: Object.keys(data || {}) };
    try {
      const caller = context.auth?.uid;
      const businessId = (data.businessId || caller || "").toString().trim();
      const customerName = (data.customerName || data.name || "").toString().trim();
      const email = (data.email || data.toEmail || data.customerEmail || "").toString().trim();
      const phone = (data.customerPhone || data.phone || "").toString().trim();
      let portalLink = data.portalLink || data.portalUrl || null;
      let requestId = data.requestId || null;
      const source = data.source || "ask-reviews";
      logContext = {
        businessId,
        caller,
        source,
        requestKeys: Object.keys(data || {}),
        requestIdPresent: Boolean(requestId),
        portalLinkPresent: Boolean(portalLink),
        maskedEmail: maskEmail(email),
      };

      console.log("[functions.sendReviewRequestEmailCallable] invoked", logContext);

      if (!caller) {
        throw new functions.https.HttpsError(
          "unauthenticated",
          "Authentication is required to send review requests.",
        );
      }

      if (!businessId || caller !== businessId) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You can only send review requests for your own business.",
        );
      }

      if (!customerName) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "customerName is required to send a review request.",
          { missing: ["customerName"] },
        );
      }

      if (!email || !basicEmailRegex.test(email)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "A valid email is required to send a review request.",
          { missing: ["customerEmail"] },
        );
      }

      if (portalLink && typeof portalLink !== "string") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "portalLink must be a string when provided.",
        );
      }

      if (requestId && typeof requestId !== "string") {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "requestId must be a string when provided.",
        );
      }

      const sendgrid = resolveSendgridConfig();
      if (!sendgrid.apiKey) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "email_sending_not_configured",
          { missing: ["SENDGRID_API_KEY"] },
        );
      }

      if (!portalLink) {
        const invite = await createInviteToken({
          businessId,
          customerName,
          phone,
          email,
          channel: "email",
          source,
        });
        portalLink = invite.portalUrl;
        requestId = requestId || invite.requestId;
      }

      const sendResult = await sendReviewRequestEmailCore({
        businessId,
        toEmail: email,
        customerName,
        portalUrl: portalLink,
        customerPhone: phone,
        source,
        requestId,
      });

      return {
        ok: true,
        requestId: sendResult.requestId,
        portalLink: portalLink || sendResult.portalUrl,
        portalUrl: sendResult.portalUrl,
        sendgridMessageId: sendResult.providerMessageId || null,
      };
    } catch (err) {
      console.error("[functions.sendReviewRequestEmailCallable] failed", {
        ...logContext,
        code: err?.code || err?.name,
        message: err?.message,
        stack: err?.stack,
      });
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError(
        "internal",
        err?.message || "Unable to send review request",
      );
    }
  });

exports.sendReviewRequestEmailHttp = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onRequest(async (req, res) => {
    console.log("sendReviewRequestEmail (HTTP) invoked", req.method);

    if (applyCors(req, res, "POST, OPTIONS")) return;

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    try {
      const decoded = await verifyRequestAuth(req);
      const bodyBusinessId = req.body?.businessId;
      const businessId = bodyBusinessId || decoded.uid;

      if (!businessId || decoded.uid !== businessId) {
        return res.status(403).json({ ok: false, error: "permission_denied" });
      }

      const result = await sendReviewRequestEmailCore({
        businessId,
        toEmail: req.body?.email || req.body?.to || req.body?.customerEmail,
        customerName: req.body?.customerName,
        portalUrl: req.body?.portalUrl || req.body?.portalLink,
        customerPhone: req.body?.customerPhone || req.body?.phone,
        source: req.body?.source || "ask-for-reviews",
      });

      const success = Boolean(result?.success);
      return res.status(200).json({ ok: success, success, requestId: result?.requestId });
    } catch (err) {
      console.error("[email] send failed", err);
      if (err instanceof functions.https.HttpsError) {
        const status = err.code === "unauthenticated" ? 401 : 400;
        return res.status(status).json({
          ok: false,
          error: err.message,
          code: err.details?.code || err.code,
        });
      }
      if (err?.code === "UNAUTHENTICATED") {
        return res.status(401).json({ ok: false, error: err.message || "Authentication required" });
      }
      return res.status(500).json({ ok: false, error: "Failed to send email" });
    }
  });

exports.portalDiagnostics = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onCall(async (data = {}, context) => {
    const caller = context.auth?.uid;
    if (!caller) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication is required",
      );
    }

    const businessId = data.businessId || caller;
    const profile = await assertBusinessProfileExists(businessId);
    const profileData = profile.data || {};
    const { branding, missingFields, brandingComplete } = deriveBrandingState(profileData);
    const displayName = branding.name || profileData.businessName || profileData.name || "Our Business";
    const sendgrid = resolveSendgridConfig();

    return {
      ok: true,
      businessId,
      brandingExists: missingFields.length === 0,
      brandingComplete,
      missingFields,
      branding,
      displayName,
      sender: {
        email: sendgrid.sender || DEFAULT_SENDGRID_SENDER,
        name: branding.senderName || displayName || "ReviewResq",
      },
      supportEmail: branding.supportEmail || DEFAULT_BRANDING.supportEmail,
      configSource: sendgrid.source || "none",
      profileSource: profile.ref.parent.id,
    };
  });

exports.createInviteTokenHttp = functions.https.onRequest(async (req, res) => {
  const corsHandled = applyCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    if (!corsHandled) {
      return res.status(204).send("");
    }
    return;
  }

  if (corsHandled) return;

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const decoded = await verifyRequestAuth(req);
    const bodyBusinessId = req.body?.businessId;
    const businessId = bodyBusinessId || decoded.uid;

    if (!businessId || decoded.uid !== businessId) {
      return res.status(403).json({ ok: false, error: "permission_denied" });
    }

    const inviteResponse = await createInviteToken({
      businessId,
      customerId: req.body?.customerId,
      customerName: req.body?.customerName,
      phone: req.body?.phone,
      email: req.body?.email,
      channel: req.body?.channel,
      source: req.body?.source || "manual",
    });

    return res.status(200).json({ ok: true, ...inviteResponse });
  } catch (err) {
    console.error("[invite] http create failed", err);
    const status = err.code === "UNAUTHENTICATED" ? 401 : 400;
    const errorCode = err?.details?.code || err?.code || "unknown";
    return res
      .status(status)
      .json({ ok: false, error: err.message || "Unable to create invite", code: errorCode });
  }
});

const SENDGRID_WEBHOOK_SECRET = process.env.SENDGRID_WEBHOOK_SECRET || "";
const SENDGRID_WEBHOOK_PUBLIC_KEY = (process.env.SENDGRID_WEBHOOK_PUBLIC_KEY || "")
  .replace(/\\n/g, "\n")
  .trim();

const isSendgridSignatureValid = (req) => {
  if (!SENDGRID_WEBHOOK_PUBLIC_KEY) return false;
  const signature = req.headers["x-twilio-email-event-webhook-signature"];
  const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"];
  if (!signature || !timestamp || !req.rawBody) return false;

  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${timestamp}${req.rawBody.toString()}`);
    verifier.end();
    return verifier.verify(SENDGRID_WEBHOOK_PUBLIC_KEY, signature, "base64");
  } catch (err) {
    console.error("[sendgrid] signature verification failed", err);
    return false;
  }
};

async function applySendGridEvent(event = {}) {
  const customArgs = event.custom_args || event.customArgs || {};
  const businessId = customArgs.businessId || customArgs.business_id;
  const requestId = customArgs.requestId || customArgs.request_id || customArgs.inviteToken;
  if (!businessId || !requestId) return;

  const ref = db
    .collection("businesses")
    .doc(String(businessId))
    .collection("outboundRequests")
    .doc(String(requestId));

  const eventMs = event.timestamp ? Number(event.timestamp) * 1000 : Date.now();
  const providerMessageId =
    (event.sg_message_id && event.sg_message_id.split(".")[0]) || event.sg_message_id || null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? snap.data() : {};
    const currentStatus = existing.status || "draft";

    const defaults = snap.exists
      ? {
          businessId: String(businessId),
          requestId: String(requestId),
          channel: existing.channel || "email",
          provider: existing.provider || "sendgrid",
          processedAtMs: existing.processedAtMs ?? null,
          sentAtMs: existing.sentAtMs ?? null,
          deliveredAtMs: existing.deliveredAtMs ?? null,
          openedAtMs: existing.openedAtMs ?? null,
          clickedAtMs: existing.clickedAtMs ?? null,
        }
      : buildOutboundDefaults({
          businessId,
          requestId: String(requestId),
          channel: "email",
          customerName: existing.customerName || null,
          customerEmail: existing.customerEmail || null,
          customerPhone: existing.customerPhone || null,
          reviewLink: existing.reviewLink || null,
          status: currentStatus,
          provider: existing.provider || "sendgrid",
        });

    const updates = {
      businessId: String(businessId),
      requestId: String(requestId),
      channel: existing.channel || "email",
      provider: existing.provider || "sendgrid",
      providerMessageId: existing.providerMessageId || providerMessageId || null,
      updatedAtMs: eventMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (!existing.createdAtMs) updates.createdAtMs = eventMs;
    if (!existing.createdAt) updates.createdAt = admin.firestore.FieldValue.serverTimestamp();

    let nextStatus = currentStatus;
    switch (event.event) {
      case "processed":
        nextStatus = resolveStatusProgression(currentStatus, "sent");
        updates.processedAtMs = existing.processedAtMs || eventMs;
        updates.sentAtMs = existing.sentAtMs || eventMs;
        break;
      case "delivered":
        nextStatus = resolveStatusProgression(currentStatus, "delivered");
        updates.sentAtMs = existing.sentAtMs || eventMs;
        updates.deliveredAtMs = existing.deliveredAtMs || eventMs;
        break;
      case "open":
        nextStatus = resolveStatusProgression(currentStatus, "opened");
        updates.openedAtMs = existing.openedAtMs || eventMs;
        break;
      case "click":
        nextStatus = resolveStatusProgression(currentStatus, "clicked");
        updates.clickedAtMs = existing.clickedAtMs || eventMs;
        if (!existing.openedAtMs) updates.openedAtMs = eventMs;
        break;
      case "bounce":
      case "dropped":
      case "spamreport":
        nextStatus = "failed";
        updates.error = {
          type: event.event,
          reason: event.reason || event.response || event.type || null,
        };
        break;
      default:
        return;
    }

    updates.status = nextStatus;
    tx.set(ref, { ...defaults, ...updates }, { merge: true });
  });
}

exports.sendgridEvents = functions.https.onRequest(async (req, res) => {
  if (applyCors(req, res, "POST, OPTIONS")) return;

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const provided =
    req.headers["x-api-key"] ||
    req.headers["x-sendgrid-signature"] ||
    (req.headers.authorization || "").replace("Bearer ", "");

  const hasSharedSecret = Boolean(SENDGRID_WEBHOOK_SECRET) && provided === SENDGRID_WEBHOOK_SECRET;
  const signatureValid = isSendgridSignatureValid(req);

  if (!hasSharedSecret && !signatureValid) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const events = Array.isArray(req.body) ? req.body : [];
  await Promise.all(events.map((evt) => applySendGridEvent(evt)));
  return res.json({ ok: true, received: events.length });
});

exports.createCampaign = functions.https.onCall(async (data = {}, context) => {
  const caller = context.auth?.uid;
  const businessId = data.businessId || caller;
  if (!businessId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "businessId is required",
    );
  }

  const payload = {
    businessId,
    audienceRules: data.audienceRules || {},
    channel: ["email", "sms", "whatsapp"].includes(data.channel)
      ? data.channel
      : "sms",
    templateId: data.templateId || null,
    templateBody: data.templateBody || data.template || "",
    schedule: data.schedule || null,
    followUpRules: data.followUpRules || "",
    status: data.status || "draft",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const ref = await db.collection("campaigns").add(payload);
  return { id: ref.id };
});

const CHANNEL_METADATA = {
  sms: { timelineType: "sms_sent" },
  whatsapp: { timelineType: "whatsapp_sent" },
  email: { timelineType: "email_sent" },
};

const PLAN_RATE_LIMIT = {
  starter: 0,
  growth: 15,
  pro_ai: 30,
};

const renderTemplateMessage = (template = "", vars = {}) => {
  const replacements = {
    name: vars.name || "there",
    business: vars.business || "our team",
  };

  return (template || "Hi {{name}}, thanks for choosing {{business}}.")
    .replace(/{{\s*name\s*}}/gi, replacements.name)
    .replace(/{{\s*business\s*}}/gi, replacements.business)
    .trim();
};

const deriveRateLimit = (planId = "starter", requestedRate) => {
  const normalized = normalizePlan(planId);
  const base = PLAN_RATE_LIMIT[normalized] ?? 0;
  if (base <= 0) return 0;
  const requested = Number(requestedRate || base);
  const bounded = Math.min(Math.max(requested, 1), base);
  return bounded;
};

async function deliverMessage({ channel, recipient, message, businessName }) {
  const sendgrid = resolveSendgridConfig();
  if (channel === "email") {
    if (!sendgrid.apiKey) throw new Error("Email channel not configured");
    if (!recipient.email) throw new Error("Missing email address");
    sgMail.setApiKey(sendgrid.apiKey);
    const sender = {
      email: sendgrid.sender || DEFAULT_SENDGRID_SENDER,
      name: businessName || "ReviewResq",
    };
    await sgMail.send({
      to: recipient.email,
      from: sender,
      replyTo: sender,
      subject: `A note from ${businessName || "our team"}`,
      text: message,
      headers: {
        "List-Unsubscribe": "<mailto:support@reviewresq.com?subject=unsubscribe>",
      },
    });
    return;
  }

  if (!recipient.phone) throw new Error(`Missing phone for ${channel}`);
  const normalizedPhone = normalizePhone(recipient.phone);
  const metaLabel = channel === "whatsapp" ? "WhatsApp" : "SMS";
  console.log(`[campaign] ${metaLabel} send`, {
    to: normalizedPhone,
    message,
  });
}

async function sendCampaignBatchHandler(data = {}, context) {
  const caller = context.auth?.uid;
  const businessId = data.businessId || caller;
  if (!businessId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "businessId is required",
    );
  }

  const channel = ["email", "sms", "whatsapp"].includes(data.channel)
    ? data.channel
    : "sms";
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  const template = data.template || data.templateBody || "";
  const campaignId = data.campaignId || null;

  const { data: businessData } = await loadBusinessAccount(businessId);
  const businessName = businessData.businessName || businessData.name || "your team";
  const planId = businessData.plan || "starter";
  const rateLimit = deriveRateLimit(planId, data.rateLimit);

  if (rateLimit <= 0) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Upgrade to Growth to unlock campaign sends.",
    );
  }

  const delayMs = Math.ceil(1000 / rateLimit);
  const { timelineType } = CHANNEL_METADATA[channel] || CHANNEL_METADATA.sms;

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    await sleep(delayMs);
    try {
      const message = renderTemplateMessage(template, {
        name: recipient.name,
        business: businessName,
      });

      await deliverMessage({
        channel,
        recipient,
        message,
        businessName,
      });

      await upsertCustomerRecord({
        businessId,
        name: recipient.name,
        phone: normalizePhone(recipient.phone),
        email: normalizeEmail(recipient.email),
        source: recipient.source || "manual",
        reviewStatus: recipient.reviewStatus || "requested",
        timelineEntry: {
          type: timelineType,
          metadata: { campaignId, reason: "campaign_batch", channel },
        },
      });

      sent += 1;
    } catch (err) {
      console.error("[campaign] failed recipient", recipient, err);
      failed += 1;
    }
  }

  return { sent, failed, channel, rateLimit, delayMs, campaignId };
}

exports.sendCampaignBatch = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onCall(sendCampaignBatchHandler);
exports.bulkSendMessages = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onCall(sendCampaignBatchHandler);

exports.saveAutomationFlow = functions.https.onCall(async (data = {}, context) => {
  const caller = context.auth?.uid;
  const businessId = data.businessId || caller;
  if (!businessId) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "businessId is required",
    );
  }

  const steps = Array.isArray(data.steps) ? data.steps : [];
  const allowedStepTypes = new Set([
    "send_message",
    "wait",
    "condition",
    "branch",
  ]);
  const sanitizedSteps = steps
    .filter((step) => allowedStepTypes.has(step.type))
    .map((step) => ({ type: step.type, details: step.details || "" }));

  const payload = {
    businessId,
    name: data.name || "Untitled flow",
    trigger: data.trigger === "manual" ? "manual" : "service_completed",
    steps: sanitizedSteps,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const flowRef = data.id
    ? db.collection("automationFlows").doc(data.id)
    : db.collection("automationFlows").doc();
  const ref = flowRef;
  await ref.set(payload, { merge: true });
  return { id: ref.id };
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const GOOGLE_REVIEW_LINK =
  process.env.GOOGLE_REVIEW_LINK || "https://g.page/reviewresq";

const AUTOMATION_STATES = {
  IDLE: "idle",
  WAITING: "waiting_for_feedback",
  IN_AI: "in_ai_conversation",
  POSITIVE_DONE: "positive_flow_completed",
  RESOLVED: "resolved_flow_completed",
};

function automationStateRef({ businessId, customerIdentifier }) {
  if (!businessId || !customerIdentifier) return null;
  const docId = `${businessId}_${customerIdentifier}`;
  return db.collection("automationStates").doc(docId);
}

async function setAutomationState({
  businessId,
  customerIdentifier,
  state,
  extra = {},
}) {
  const ref = automationStateRef({ businessId, customerIdentifier });
  if (!ref) return null;
  const payload = {
    businessId,
    customerIdentifier,
    automationState: state,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  };

  await ref.set(payload, { merge: true });
  return ref;
}

const CATEGORIES = {
  SERVICE_DELAY: "Service delay",
  PRICE: "Price issue",
  QUALITY: "Quality problem",
  STAFF: "Staff issue",
  MISC: "Miscommunication",
  OTHER: "Other",
};

function classifyCategory(messageText = "") {
  const text = messageText.toLowerCase();
  if (text.includes("wait") || text.includes("delay") || text.includes("late")) {
    return CATEGORIES.SERVICE_DELAY;
  }
  if (text.includes("price") || text.includes("expensive") || text.includes("charge")) {
    return CATEGORIES.PRICE;
  }
  if (text.includes("cold") || text.includes("broken") || text.includes("quality")) {
    return CATEGORIES.QUALITY;
  }
  if (text.includes("rude") || text.includes("staff") || text.includes("employee")) {
    return CATEGORIES.STAFF;
  }
  if (text.includes("wrong order") || text.includes("misunderstand")) {
    return CATEGORIES.MISC;
  }
  return CATEGORIES.OTHER;
}

function baseAiMessage(customerName = "there") {
  return (
    `Hi ${customerName}, thanks for sharing your feedback.\n` +
    "I’m here to help make things right.\n" +
    "Could you tell me a bit more about what happened?"
  );
}

async function generateAIResponse({
  customerName,
  rating,
  history,
  googleReviewLink,
}) {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    return {
      message:
        "Thanks for sharing those details. I'm lining up the fastest fix and will check back once it's resolved.",
      sentiment: rating <= 2 ? -0.45 : -0.2,
      category: classifyCategory(history.at(-1)?.message_text || ""),
    };
  }

  const messages = [
    {
      role: "system",
      content:
        "You are ReviewResQ, an AI agent that rescues unhappy customers. Keep messages concise, empathetic, and action-oriented. Always include one follow-up question. When the customer is satisfied, include a closing line inviting them to leave a Google review at the provided link.",
    },
    {
      role: "user",
      content: `Customer rating: ${rating} stars. Customer name: ${customerName}. Conversation so far: ${history
        .map((h) => `${h.sender}: ${h.message_text}`)
        .join(" | " )}. Google review link: ${googleReviewLink}.`,
    },
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 280,
    }),
  });

  const data = await response.json();
  const message = data?.choices?.[0]?.message?.content;
  return {
    message:
      message ||
      "Thanks for sharing those details. I'm lining up the fastest fix and will check back once it's resolved.",
    sentiment: rating <= 2 ? -0.4 : -0.1,
    category: classifyCategory(message),
  };
}

async function sendAiResponseToCustomer({
  email,
  phone,
  customerName,
  aiMessage,
}) {
  const hasEmail = Boolean(email);
  const sendgrid = resolveSendgridConfig();

  if (hasEmail && sendgrid.apiKey) {
    try {
      sgMail.setApiKey(sendgrid.apiKey);
      const sender = {
        email: sendgrid.sender || DEFAULT_SENDGRID_SENDER,
        name: customerName || "ReviewResq",
      };
      await sgMail.send({
        to: email,
        from: sender,
        replyTo: sender,
        subject: "We're on it — our AI is handling your feedback",
        text: aiMessage,
        html: `<p>Hi ${customerName || "there"},</p><p>${aiMessage}</p>`,
      });
    } catch (err) {
      console.error("Failed to send AI response email", err);
    }
  } else if (phone) {
    console.log("SMS delivery placeholder", { phone, aiMessage });
  } else {
    console.log("No delivery channel for AI response", { aiMessage });
  }
}

async function sendPositiveThankYou({
  email,
  phone,
  customerName,
  businessName,
  googleReviewLink,
}) {
  const message =
    "Thank you for your feedback! We appreciate you taking the time to share your experience. " +
    `If you have a moment, we'd love a public review here: ${googleReviewLink}.`;

  const sendgrid = resolveSendgridConfig();

  if (email && sendgrid.apiKey) {
    try {
      sgMail.setApiKey(sendgrid.apiKey);
      const sender = {
        email: sendgrid.sender || DEFAULT_SENDGRID_SENDER,
        name: businessName || "ReviewResq",
      };
      await sgMail.send({
        to: email,
        from: sender,
        replyTo: sender,
        subject: "Thank you for your feedback",
        text: message,
        html: `<p>Hi ${customerName || "there"},</p><p>${message}</p>`,
      });
    } catch (err) {
      console.error("Failed to send positive thank-you", err);
    }
  } else if (phone) {
    console.log("SMS delivery placeholder", { phone, message });
  } else {
    console.log("No delivery channel for thank-you", { customerName, businessName });
  }
}

function isNegativeFeedback(feedbackData = {}) {
  const rating = Number(feedbackData.rating || 0);
  if (rating && rating <= 3) return true;
  const text = (feedbackData.message || feedbackData.feedback || "").toLowerCase();
  return ["bad", "poor", "terrible", "awful", "horrible", "angry"].some((word) =>
    text.includes(word)
  );
}

function deriveSentimentScore(feedbackData = {}) {
  if (typeof feedbackData.sentimentScore === "number") {
    return feedbackData.sentimentScore;
  }

  const rating = Number(feedbackData.rating || 0);
  if (rating) {
    return Number((rating - 3).toFixed(2));
  }

  return 0;
}

function deriveCustomerIdentifier(feedbackData = {}) {
  return (
    feedbackData.customerId ||
    feedbackData.customerEmail ||
    feedbackData.customerPhone ||
    feedbackData.phone ||
    feedbackData.email ||
    null
  );
}

async function createConversationFromFeedback(feedbackData, feedbackId) {
  const customerName = feedbackData.customerName || "Customer";
  const rating = feedbackData.rating || 1;
  const initialHistory = [];

  if (feedbackData.message) {
    initialHistory.push({
      sender: "customer",
      message_text: feedbackData.message,
      timestamp: new Date().toISOString(),
    });
  }

  const aiResponse = await generateAIResponse({
    customerName,
    rating,
    history: initialHistory,
    googleReviewLink: GOOGLE_REVIEW_LINK,
  });

  const aiMessage = aiResponse.message || baseAiMessage(customerName);
  const nowIso = new Date().toISOString();

  const conversation = {
    businessId: feedbackData.businessId || null,
    customerName,
    customerPhone: feedbackData.phone || feedbackData.customerPhone || null,
    customerEmail: feedbackData.email || feedbackData.customerEmail || null,
    rating,
    status: "open",
    sentiment: aiResponse.sentiment ?? -0.35,
    issueType:
      aiResponse.category || classifyCategory(feedbackData.message || ""),
    messages: [
      ...initialHistory,
      {
        sender: "ai",
        message_text: aiMessage,
        timestamp: nowIso,
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    sourceFeedbackId: feedbackId,
  };

  const ref = await db.collection("ai_conversations").add(conversation);
  await sendAiResponseToCustomer({
    email: conversation.customerEmail,
    phone: conversation.customerPhone,
    customerName,
    aiMessage,
  });

  if (feedbackData.businessId) {
    try {
      await upsertCustomerRecord({
        businessId: feedbackData.businessId,
        name: customerName || null,
        phone: normalizePhone(conversation.customerPhone),
        email: normalizeEmail(conversation.customerEmail),
        source: "funnel",
        reviewStatus: deriveReviewStatusFromFeedback(feedbackData),
        lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
        timelineEntry: {
          type: conversation.customerEmail ? "email_sent" : "sms_sent",
          metadata: {
            reason: "ai_autoresponder",
            conversationId: ref.id,
          },
        },
      });
    } catch (err) {
      console.error("[customers] failed to log AI autoresponder timeline", err);
    }
  }

  return ref.id;
}

async function handlePositiveFeedback({ feedback, feedbackRef, feedbackId }) {
  const googleLink = feedback.googleReviewLink || GOOGLE_REVIEW_LINK;
  await sendPositiveThankYou({
    email: feedback.customerEmail,
    phone: feedback.customerPhone || feedback.phone,
    customerName: feedback.customerName,
    businessName: feedback.businessName,
    googleReviewLink: googleLink,
  });

  const identifier =
    deriveCustomerIdentifier(feedback) || feedback.customerName || feedbackId;

  await setAutomationState({
    businessId: feedback.businessId,
    customerIdentifier: identifier,
    state: AUTOMATION_STATES.POSITIVE_DONE,
    extra: { feedbackId },
  });

  await feedbackRef.set(
    {
      automationState: AUTOMATION_STATES.POSITIVE_DONE,
      sentimentScore: deriveSentimentScore(feedback),
      googleReviewLink: googleLink,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function handleNegativeFeedback({ feedback, feedbackRef, feedbackId }) {
  const identifier =
    deriveCustomerIdentifier(feedback) || feedback.customerName || feedbackId;

  const existing = await db
    .collection("ai_conversations")
    .where("sourceFeedbackId", "==", feedbackId)
    .limit(1)
    .get();

  if (!existing.empty) {
    await setAutomationState({
      businessId: feedback.businessId,
      customerIdentifier: identifier,
      state: AUTOMATION_STATES.IN_AI,
      extra: { feedbackId },
    });
    await feedbackRef.set(
      {
        automationState: AUTOMATION_STATES.IN_AI,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return existing.docs[0].id;
  }

  const conversationId = await createConversationFromFeedback(
    { ...feedback, businessId: feedback.businessId },
    feedbackId
  );

  await setAutomationState({
    businessId: feedback.businessId,
    customerIdentifier: identifier,
    state: AUTOMATION_STATES.IN_AI,
    extra: { feedbackId },
  });

  await feedbackRef.set(
    {
      automationState: AUTOMATION_STATES.IN_AI,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return conversationId;
}

exports.onPortalFeedback = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .firestore.document("businessProfiles/{businessId}/feedback/{feedbackId}")
  .onCreate(async (snap, context) => {
    const data = snap.data() || {};
    const businessId = context.params.businessId;
    const feedbackId = context.params.feedbackId;
    const feedbackRef = snap.ref;

    const rating = Number(data.rating || 0);
    const sentimentScore = deriveSentimentScore(data);

    const baseMerge = {};
    if (typeof data.sentimentScore !== "number") {
      baseMerge.sentimentScore = sentimentScore;
    }
    if (!data.businessId) baseMerge.businessId = businessId;
    if (!data.createdAt) baseMerge.createdAt = admin.firestore.FieldValue.serverTimestamp();

    if (Object.keys(baseMerge).length) {
      await feedbackRef.set(baseMerge, { merge: true });
    }

    await recordCustomerFromFeedbackCapture({
      businessId,
      feedback: { ...data, sentimentScore },
    });

    const isPositive = rating >= 4 || sentimentScore > 0;
    const isNegativeOrNeutral = rating <= 3 || sentimentScore <= 0;

    if (isPositive) {
      return handlePositiveFeedback({
        feedback: { ...data, sentimentScore, businessId },
        feedbackRef,
        feedbackId,
      });
    }

    if (isNegativeOrNeutral) {
      return handleNegativeFeedback({
        feedback: { ...data, sentimentScore, businessId },
        feedbackRef,
        feedbackId,
      });
    }

    return null;
  });

exports.aiAgentReply = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .https.onRequest(async (req, res) => {
  const origin = req.headers.origin || "*";
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { conversationId, customerMessage, customerName, rating } = req.body || {};
  if (!conversationId || !customerMessage) {
    return res.status(400).json({ error: "Missing conversationId or customerMessage" });
  }

  const convoRef = db.collection("ai_conversations").doc(conversationId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const conversation = convoSnap.data();
  const history = conversation.messages || [];
  const updatedHistory = [
    ...history,
    {
      sender: "customer",
      message_text: customerMessage,
      timestamp: new Date().toISOString(),
    },
  ].slice(-20);

  const aiResponse = await generateAIResponse({
    customerName: customerName || conversation.customerName || "there",
    rating: rating || conversation.rating || 1,
    history: updatedHistory,
    googleReviewLink: GOOGLE_REVIEW_LINK,
  });

  const aiMessage = aiResponse.message;
  const finalHistory = [
    ...updatedHistory,
    {
      sender: "ai",
      message_text: aiMessage,
      timestamp: new Date().toISOString(),
    },
  ];

  await convoRef.set(
    {
      issueType: aiResponse.category,
      sentiment: aiResponse.sentiment,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: aiResponse.sentiment > -0.1 ? "needs_review" : "open",
      messages: finalHistory,
    },
    { merge: true }
  );

  const deliveryType = conversation.customerEmail ? "email_sent" : "sms_sent";

  await sendAiResponseToCustomer({
    email: conversation.customerEmail,
    phone: conversation.customerPhone,
    customerName: conversation.customerName,
    aiMessage,
  });

  try {
    await upsertCustomerRecord({
      businessId: conversation.businessId,
      name: conversation.customerName || null,
      phone: normalizePhone(conversation.customerPhone),
      email: normalizeEmail(conversation.customerEmail),
      source: "funnel",
      reviewStatus: deriveReviewStatusFromFeedback({ rating: conversation.rating }),
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
      timelineEntry: {
        type: deliveryType,
        metadata: { reason: "ai_reply", conversationId },
      },
    });
  } catch (err) {
    console.error("[customers] failed to upsert from AI reply", err);
  }

  return res.status(200).json({
    aiMessage,
    category: aiResponse.category,
    sentiment: aiResponse.sentiment,
  });
  });

exports.recordReviewLinkClick = onRequest(async (req, res) => {
  if (applyCors(req, res, "POST, OPTIONS")) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload =
    req.body && typeof req.body === "object"
      ? req.body
      : (() => {
          try {
            return JSON.parse(req.body || "{}") || {};
          } catch (err) {
            return {};
          }
        })();

  const businessId = (payload.businessId || "").toString().trim();
  const rating = Number(payload.rating || 0);
  const customerName = (payload.customerName || "").toString().trim();
  const customerEmail = normalizeEmail(payload.customerEmail || "");
  const customerPhone = normalizePhone(payload.customerPhone || "");

  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }

  try {
    const reviewStatus = rating >= 4 ? "requested" : "none";
    const customerId = await upsertCustomerRecord({
      businessId,
      name: customerName || null,
      phone: customerPhone || null,
      email: customerEmail || null,
      source: "funnel",
      reviewStatus,
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
      timelineEntry: {
        type: "review_left",
        metadata: { rating: rating || null, action: "review_link_click" },
      },
    });

    return res.status(200).json({ ok: true, customerId });
  } catch (err) {
    console.error("[customers] failed to record review click", err);
    return res.status(500).json({ error: "Failed to record review click" });
  }
});

exports.resolveInviteToken = onRequest(async (req, res) => {
  if (applyCors(req, res, "GET, POST, OPTIONS")) return;

  const payload = req.method === "GET" ? req.query : req.body || {};
  const businessId = (payload.businessId || payload.bid || "").toString().trim();
  const inviteToken = (payload.t || payload.inviteToken || "").toString().trim();

  if (!businessId || !inviteToken) {
    return res.status(400).json({ error: "businessId and invite token are required" });
  }

  try {
    const { data } = await resolveInviteRecord(businessId, inviteToken);
    const identity = await fetchBusinessIdentity(businessId);

    if (!identity) {
      return res.status(404).json({ error: "Business not found" });
    }

    const resolvedBranding = deriveBrandingState({
      ...identity,
      branding: identity.branding || {},
      businessName: identity.businessName,
      logoUrl: identity.logoUrl,
    });
    const displayName =
      resolvedBranding.branding.name || identity.businessName || DEFAULT_BRANDING.name;

    return res.status(200).json({
      businessId,
      customerId: data.customerId,
      businessName: displayName,
      logoUrl: resolvedBranding.branding.logoUrl || identity.logoUrl || null,
      googleReviewLink: identity.googleReviewLink || "",
      brandingMissingFields:
        resolvedBranding.missingFields?.length
          ? resolvedBranding.missingFields
          : identity.brandingMissingFields || [],
      branding: resolvedBranding.branding,
    });
  } catch (err) {
    console.error("[portal] failed to resolve invite token", err);
    return res.status(400).json({ error: err.message || "Unable to resolve invite token" });
  }
});

exports.submitPortalFeedback = onRequest(async (req, res) => {
  if (applyCors(req, res, "POST, OPTIONS")) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload =
    req.body && typeof req.body === "object"
      ? req.body
      : (() => {
          try {
            return JSON.parse(req.body || "{}") || {};
          } catch (err) {
            return {};
          }
        })();

  const businessId = (payload.businessId || payload.bid || "").toString().trim();
  const rating = Number(payload.rating || 0);
  const message = (payload.message || payload.feedback || "").toString().trim();
  const inviteToken = (payload.t || payload.inviteToken || "").toString().trim();
  const providedEmail = normalizeEmail(payload.email || payload.customerEmail || "");
  const providedName = (payload.customerName || payload.name || "").toString().trim();

  if (!businessId) {
    return res.status(400).json({ error: "businessId is required" });
  }

  if (!rating) {
    return res.status(400).json({ error: "rating is required" });
  }

  if (rating <= 2 && !message) {
    return res.status(400).json({ error: "message is required for low ratings" });
  }

  let customerProfile = null;
  let customerId = payload.customerId || null;
  let inviteRef = null;
  let inviteData = null;
  const requestId =
    (payload.requestId || payload.reqId || payload.t || payload.inviteToken || "").toString().trim() || null;

  try {
    if (inviteToken) {
      const resolved = await resolveInviteRecord(businessId, inviteToken);
      inviteData = resolved.data || {};
      customerId = resolved.data.customerId || customerId;
      inviteRef = resolved.ref;
    }

    if (customerId) {
      customerProfile = await fetchCustomerProfile(businessId, customerId);
    }
  } catch (err) {
    console.error("[portal] invite validation failed", err);
    return res.status(400).json({ error: err.message || "Invalid invite token" });
  }

  const customerData = customerProfile?.data || {};
  const createdAtMs = Date.now();
  const feedbackPayload = {
    businessId,
    customerId: customerId || null,
    requestId: requestId || inviteToken || null,
    customerName: providedName || customerData.name || inviteData?.customerName || "Anonymous",
    phone: inviteData?.phone || customerData.phone || null,
    customerPhone: inviteData?.phone || customerData.phone || null,
    email: providedEmail || inviteData?.email || customerData.email || null,
    customerEmail: providedEmail || inviteData?.email || customerData.email || null,
    rating,
    message,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: "portal",
    status: "new",
    env: payload.env || "portal",
  };

  try {
    const docRef = await writeFeedbackDocuments(businessId, feedbackPayload);

    if (customerProfile?.ref) {
      await customerProfile.ref.set(
        {
          lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewStatus: deriveReviewStatusFromFeedback(feedbackPayload),
        },
        { merge: true },
      );
    }

    if (inviteRef) {
      await inviteRef.set(
        { used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    }

    return res.status(200).json({ ok: true, feedbackId: docRef.id, customerId: customerId || null });
  } catch (err) {
    console.error("[portal] failed to submit feedback", err);
    return res.status(500).json({ error: "Failed to submit feedback" });
  }
});

exports.onAiConversationResolved = functions
  .runWith({ secrets: [SENDGRID_API_KEY, SENDGRID_SENDER] })
  .firestore.document("ai_conversations/{conversationId}")
  .onUpdate(async (change, context) => {
    const beforeStatus = change.before.data()?.status;
    const afterStatus = change.after.data()?.status;

    if (beforeStatus === afterStatus || afterStatus !== "resolved") return null;

    const conversation = change.after.data();
    const feedbackId = conversation.sourceFeedbackId;
    const businessId = conversation.businessId;
    const customerIdentifier =
      deriveCustomerIdentifier(conversation) || feedbackId || context.params.conversationId;

    if (!businessId || !customerIdentifier) return null;

    const googleLink =
      conversation.googleReviewLink || conversation.reviewLink || GOOGLE_REVIEW_LINK;
    const message =
      "Glad we could resolve this for you. If you’re now happy with the service, " +
      `you can leave a public Google review here: ${googleLink}`;

    const resolutionDelivery = conversation.customerEmail ? "email_sent" : "sms_sent";

    await sendAiResponseToCustomer({
      email: conversation.customerEmail,
      phone: conversation.customerPhone,
      customerName: conversation.customerName,
      aiMessage: message,
    });

    try {
      await upsertCustomerRecord({
        businessId,
        name: conversation.customerName || null,
        phone: normalizePhone(conversation.customerPhone),
        email: normalizeEmail(conversation.customerEmail),
        source: "funnel",
        reviewStatus: "requested",
        lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
        timelineEntry: {
          type: resolutionDelivery,
          metadata: {
            reason: "ai_resolution_followup",
            conversationId: context.params.conversationId,
          },
        },
      });
    } catch (err) {
      console.error("[customers] failed to record resolved follow-up", err);
    }

    await setAutomationState({
      businessId,
      customerIdentifier,
      state: AUTOMATION_STATES.RESOLVED,
      extra: { feedbackId, conversationId: context.params.conversationId },
    });

    return change.after.ref.set(
      {
        automationState: AUTOMATION_STATES.RESOLVED,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

exports.syncPublicBusinessFromBusinessDoc = functions.firestore
  .document("businesses/{businessId}")
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null;

    try {
      await upsertPublicBusiness(context.params.businessId, change.after.data() || {});
    } catch (err) {
      console.error("[publicBusiness] failed to sync from businesses", err);
    }

    return null;
  });

exports.syncPublicBusinessFromProfile = functions.firestore
  .document("businessProfiles/{businessId}")
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null;

    try {
      await upsertPublicBusiness(context.params.businessId, change.after.data() || {});
    } catch (err) {
      console.error("[publicBusiness] failed to sync from businessProfiles", err);
    }

    return null;
  });
