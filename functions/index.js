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

const loadBusinessAccount = async (businessId) => {
  const businessRef = db.collection("businesses").doc(businessId);
  const [businessSnap, profileSnap] = await Promise.all([
    businessRef.get(),
    db.collection("businessProfiles").doc(businessId).get().catch(() => null),
  ]);

  const businessData = businessSnap.exists ? businessSnap.data() : {};
  const profileData = profileSnap?.exists ? profileSnap.data() : {};

  const planId = await resolveUserPlanId(businessId, {
    ...profileData,
    ...businessData,
    planId: businessData.plan || profileData.plan || businessData.planId,
  });

  const capabilities = derivePlanCapabilities(planId);
  const mergedFeatures = { ...businessData.features, ...capabilities.features };

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

const normalizePhone = (raw = "") => (raw || "").replace(/[^\d]/g, "");

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

  const GOOGLE_MANUAL_LINK_REGEX =
    /^https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|google\.com\/maps|google\.com\/search|www\.google\.com\/maps|www\.google\.com\/search|search\.google\.com\/local\/writereview)\b/i;

  return GOOGLE_MANUAL_LINK_REGEX.test(url.href);
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

  try {
    const parsed = new URL(manualLink);
    normalizedLink = parsed.href;
    normalizedHost = parsed.host;
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

  return {
    ok: true,
    reason: "MANUAL_CONNECTED",
    message: "Google profile connected manually.",
    googleManualLink: normalizedLink,
    googleConnectionType: "manual",
    normalizedHost,
  };
});

exports.sendReviewRequestEmail = functions.https.onRequest(async (req, res) => {
  console.log("sendReviewRequestEmail invoked", req.method);

  // ---------- CORS ----------
  const origin = req.headers.origin || "*";
  const allowedOrigins = [
    "https://reviewresq.com",
    "https://www.reviewresq.com",
  ];

  if (allowedOrigins.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "https://reviewresq.com");
  }

  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Vary", "Origin");

  if (req.method === "OPTIONS") {
    console.log("Handled OPTIONS preflight");
    return res.status(204).send("");
  }

  // ---------- SENDGRID ----------
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error("Missing SENDGRID_API_KEY");
    return res.status(500).json({ error: "Server key missing" });
  }

  sgMail.setApiKey(apiKey);

  try {
    // נקבל גם את הפורמט החדש וגם את הישן
    let {
      to,
      customerEmail,
      customerName,
      businessName,
      businessLogoUrl,
      portalUrl,
      portalLink,
      subject,
      text,
      html,
      businessId,
      customerId,
    } = req.body || {};

    // איחוד שדות
    const email = customerEmail || to;
    const portal = portalUrl || portalLink;

    const customerIdentifier =
      customerId || email || req.body?.customerPhone || "anonymous";

    const safeBusinessName = businessName || "our business";
    const safeCustomerName = customerName || "there";

    if (!email || !portal) {
      console.error("Missing required fields", {
        email,
        portal,
        body: req.body,
      });
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (businessId && customerIdentifier) {
      const stateRef = automationStateRef({
        businessId,
        customerIdentifier,
      });
      const stateSnap = stateRef ? await stateRef.get() : null;
      const existingState = stateSnap?.data()?.automationState;
      if (existingState === AUTOMATION_STATES.IN_AI) {
        return res.status(409).json({
          error: "Customer is currently in an AI conversation. Suppressing invite.",
        });
      }
    }

    // אם אין subject / text / html – נבנה אותם לבד
    if (!subject) {
      subject = `How was your experience with ${safeBusinessName}?`;
    }

    if (!text) {
      text =
        `Hi ${safeCustomerName},\n\n` +
        `Thanks for choosing ${safeBusinessName}.\n\n` +
        `We'd really appreciate it if you could take a moment to leave us a review:\n` +
        `${portal}\n\n` +
        `Thank you!\n${safeBusinessName} Team`;
    }

    if (!html) {
      const logoImgHtml = businessLogoUrl
        ? `<div style="margin-bottom:16px;">
             <img src="${businessLogoUrl}"
                  alt="${safeBusinessName} logo"
                  style="max-width:160px;height:auto;border-radius:8px;" />
           </div>`
        : "";

      html = `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color:#f4f4f5; padding:24px;">
          <div style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(15,23,42,0.12);">
            ${logoImgHtml}
            <h2 style="margin:0 0 12px; color:#111827; font-size:20px;">
              Hi ${safeCustomerName},
            </h2>
            <p style="margin:0 0 12px; color:#4b5563; font-size:14px;">
              Thanks for choosing <strong>${safeBusinessName}</strong>.
            </p>
            <p style="margin:0 0 16px; color:#4b5563; font-size:14px;">
              We'd really appreciate it if you could take a moment to share your experience.
            </p>
            <div style="text-align:center; margin:24px 0;">
              <a href="${portal}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-block; padding:12px 24px; border-radius:999px; background:#4f46e5; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px;">
                Leave a review
              </a>
            </div>
            <p style="margin:0; color:#9ca3af; font-size:12px;">
              If the button above doesn't work, copy and paste this link into your browser:<br />
              <span style="word-break:break-all;">${portal}</span>
            </p>
          </div>
        </div>
      `;
    }

    const msg = {
      to: email,
      from: "support@reviewresq.com",
      subject,
      text,
      html,
    };

    console.log("Sending email via SendGrid", { to: email, subject });

    await sgMail.send(msg);

    console.log("Email sent successfully");

    if (businessId && customerIdentifier) {
      await setAutomationState({
        businessId,
        customerIdentifier,
        state: AUTOMATION_STATES.WAITING,
        extra: {
          portalUrl: portal,
          lastInviteChannel: "email",
        },
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("SendGrid error", err);
    return res.status(500).json({ error: "Failed to send email" });
  }
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
  const apiKey = process.env.SENDGRID_API_KEY;

  if (hasEmail && apiKey) {
    try {
      sgMail.setApiKey(apiKey);
      await sgMail.send({
        to: email,
        from: "support@reviewresq.com",
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

  if (email && process.env.SENDGRID_API_KEY) {
    try {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      await sgMail.send({
        to: email,
        from: "support@reviewresq.com",
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

exports.onPortalFeedback = functions.firestore
  .document("businessProfiles/{businessId}/feedback/{feedbackId}")
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

exports.aiAgentReply = functions.https.onRequest(async (req, res) => {
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

  await sendAiResponseToCustomer({
    email: conversation.customerEmail,
    phone: conversation.customerPhone,
    customerName: conversation.customerName,
    aiMessage,
  });

  return res.status(200).json({
    aiMessage,
    category: aiResponse.category,
    sentiment: aiResponse.sentiment,
  });
});

exports.onAiConversationResolved = functions.firestore
  .document("ai_conversations/{conversationId}")
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

    await sendAiResponseToCustomer({
      email: conversation.customerEmail,
      phone: conversation.customerPhone,
      customerName: conversation.customerName,
      aiMessage: message,
    });

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
