import { getCachedProfile, getCachedSubscription, refreshProfile } from "./session-data.js";
import { functions, httpsCallable } from "./firebase-config.js";

const runtimeEnv = window.RUNTIME_ENV || {};
const toastId = "feedback-toast";
const GOOGLE_OAUTH_SCOPE =
  runtimeEnv.GOOGLE_OAUTH_SCOPES || "https://www.googleapis.com/auth/business.manage";
const baseOAuthConfig = {
  clientId: runtimeEnv.GOOGLE_OAUTH_CLIENT_ID || runtimeEnv.GOOGLE_CLIENT_ID || "",
  redirectUri: runtimeEnv.GOOGLE_OAUTH_REDIRECT_URI || "",
  scopes: GOOGLE_OAUTH_SCOPE,
};
const placesProxyUrl =
  (runtimeEnv && runtimeEnv.GOOGLE_PLACES_PROXY_URL) ||
  "https://us-central1-reviewresq-app.cloudfunctions.net/googlePlacesSearch";

const defaultFunctionsBase = (() => {
  try {
    return new URL(placesProxyUrl).origin;
  } catch (err) {
    return "https://us-central1-reviewresq-app.cloudfunctions.net";
  }
})();

const functionsBaseUrl =
  runtimeEnv.FUNCTIONS_BASE_URL ||
  runtimeEnv.GOOGLE_FUNCTIONS_BASE_URL ||
  defaultFunctionsBase;
let cachedOAuthConfig = { ...baseOAuthConfig };
let oauthConfigPromise = null;
let oauthAvailabilityLogged = false;

function logOAuthAvailability(hasConfig) {
  if (oauthAvailabilityLogged) return;
  const message = hasConfig
    ? "[google-oauth] ready if config exists"
    : "[google-oauth] unavailable if missing config";
  (hasConfig ? console.log : console.warn)(message);
  oauthAvailabilityLogged = true;
}

async function ensureOAuthConfig({ logAvailability = false } = {}) {
  if (cachedOAuthConfig.clientId && cachedOAuthConfig.redirectUri) {
    if (logAvailability) logOAuthAvailability(true);
    return cachedOAuthConfig;
  }

  if (!oauthConfigPromise) {
    oauthConfigPromise = (async () => {
      try {
        const callable = httpsCallable(functions, "googleAuthGetConfig");
        const response = await callable();
        const data = response?.data || {};
        if (data?.clientId) {
          cachedOAuthConfig.clientId = data.clientId;
        }
        if (data?.redirectUri) {
          cachedOAuthConfig.redirectUri = data.redirectUri;
        }
        if (data?.scopes) {
          cachedOAuthConfig.scopes = data.scopes;
        }
      } catch (err) {
        // Swallow errors so the UI can still offer the phone fallback.
      }
      const hasConfig = Boolean(
        cachedOAuthConfig.clientId && cachedOAuthConfig.redirectUri
      );
      if (logAvailability) logOAuthAvailability(hasConfig);
      return cachedOAuthConfig;
    })();
  }

  const resolved = await oauthConfigPromise;
  if (logAvailability) {
    const hasConfig = Boolean(resolved?.clientId && resolved?.redirectUri);
    logOAuthAvailability(hasConfig);
  }
  return resolved;
}

export { functionsBaseUrl };

// Trigger a config lookup on load to emit the readiness log once.
ensureOAuthConfig({ logAvailability: true }).catch(() => {
  // Swallow errors here; the UI will offer fallback options when unavailable.
});

function normalizePlan(planId = "starter") {
  const value = (planId || "starter").toString().toLowerCase();
  if (value === "growth") return "growth";
  if (value === "pro_ai" || value === "pro" || value === "pro_ai_suite") return "pro_ai";
  return "starter";
}

function planLocationLimit(planId = "starter") {
  const normalized = normalizePlan(planId);
  if (normalized === "growth") return 2;
  if (normalized === "pro_ai") return 15;
  return 1;
}

function planUpgradeMessage(planId = "starter", attempted = 1) {
  const normalized = normalizePlan(planId);
  if (normalized === "starter" && attempted > 1) {
    return "Upgrade to Growth to connect up to 2 locations.";
  }
  if (normalized === "growth" && attempted > 2) {
    return "Upgrade to Pro AI Suite to connect up to 15 locations.";
  }
  if (normalized === "pro_ai" && attempted > 15) {
    return "You’ve reached the maximum of 15 locations. Contact support if you need more.";
  }
  return "";
}

async function loadGoogleOAuthClient() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return;
  }

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google OAuth")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google OAuth"));
    document.head.appendChild(script);
  });
}

function encodeBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createPkcePair() {
  const randomBytes = new Uint8Array(32);
  (window.crypto || crypto).getRandomValues(randomBytes);
  const verifier = encodeBase64Url(randomBytes);

  try {
    const digest = await (window.crypto || crypto).subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = encodeBase64Url(digest);
    return { verifier, challenge };
  } catch (err) {
    // Fallback to plain verifier if hashing is unavailable.
    return { verifier, challenge: verifier };
  }
}

async function requestGoogleAuthorizationCode() {
  const config = await ensureOAuthConfig({ logAvailability: true });
  if (!config?.clientId || !config?.redirectUri) {
    console.warn("[google-oauth] Missing clientId/redirectUri (no stack spam)");
    const error = new Error("Google OAuth unavailable.");
    error.code = "OAUTH_UNAVAILABLE";
    throw error;
  }

  await loadGoogleOAuthClient();
  const { verifier, challenge } = await createPkcePair();
  const scopeString = (config.scopes || GOOGLE_OAUTH_SCOPE)
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

  return new Promise((resolve, reject) => {
    try {
      const client = window.google.accounts.oauth2.initCodeClient({
        client_id: config.clientId,
        scope: scopeString,
        ux_mode: "popup",
        redirect_uri: config.redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        callback: (response) => {
          if (!response || response.error || !response.code) {
            reject(new Error("Unable to authorize with Google."));
            return;
          }
          resolve({ code: response.code, codeVerifier: verifier });
        },
      });
      client.requestCode();
    } catch (err) {
      reject(err);
    }
  });
}

function gatherAccountData() {
  const cachedProfile = (typeof getCachedProfile === "function" && getCachedProfile()) || {};
  const globals =
    window.currentAccount ||
    window.sessionData ||
    window.accountData ||
    window.portalSettings ||
    {};

  return { cachedProfile, globals };
}

function currentConnectionCount() {
  const { cachedProfile } = gatherAccountData();
  const multi =
    cachedProfile?.googleLocations ||
    cachedProfile?.connectedLocations ||
    cachedProfile?.googleAccounts ||
    [];
  if (Array.isArray(multi) && multi.length) {
    return multi.length;
  }
  return cachedProfile?.googlePlaceId ? 1 : 0;
}

function buildLocationString() {
  const { cachedProfile, globals } = gatherAccountData();
  const googleProfile = cachedProfile.googleProfile || globals.googleProfile || {};

  const address =
    cachedProfile.address ||
    cachedProfile.businessAddress ||
    googleProfile.formatted_address ||
    globals.address ||
    globals.businessAddress ||
    globals.companyAddress ||
    "";

  const city =
    cachedProfile.city ||
    cachedProfile.businessCity ||
    globals.city ||
    globals.businessCity ||
    "";
  const state =
    cachedProfile.state ||
    cachedProfile.businessState ||
    globals.state ||
    globals.businessState ||
    "";
  const country =
    cachedProfile.country ||
    cachedProfile.businessCountry ||
    globals.country ||
    globals.businessCountry ||
    "";

  const locationParts = [address, city, state, country]
    .map((part) => (part || "").toString().trim())
    .filter(Boolean);

  const uniqueParts = locationParts.filter((part, index) => locationParts.indexOf(part) === index);
  return uniqueParts.join(" ").trim();
}

function resolveBusinessName(place = {}, explicitName = "") {
  const inputBusinessName = (explicitName || place.__inputBusinessName || "").trim();
  const { cachedProfile, globals } = gatherAccountData();

  const profileBusinessName =
    cachedProfile.businessName ||
    cachedProfile.name ||
    globals.businessName ||
    globals.name ||
    "";

  return (
    inputBusinessName ||
    (place && (place.name || place.businessName)) ||
    profileBusinessName ||
    "Business"
  );
}

function getStateValue() {
  const stateInput = document.querySelector("[data-google-state]");
  return stateInput?.value ? stateInput.value.trim() : "";
}

function getPhoneValue() {
  const phoneInput = document.querySelector("[data-google-phone]");
  return phoneInput?.value ? phoneInput.value.trim() : "";
}

function buildPlacesQuery(name = "", stateOverride = "") {
  const trimmedName = (name || "").trim();
  const state = (stateOverride || getStateValue() || "").trim();

  const parts = [trimmedName, state]
    .map((part) => (part || "").trim())
    .filter(Boolean);

  return parts.join(" ");
}

function extractPlaceIdFromInput(raw = "") {
  const input = (raw || "").trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    const param = url.searchParams.get("placeid");
    if (param) return param;
  } catch (err) {
    // non-URL input is allowed
  }

  const queryMatch = input.match(/[?&]placeid=([^&#]+)/i);
  if (queryMatch && queryMatch[1]) return decodeURIComponent(queryMatch[1]);

  if (/^[A-Za-z0-9_-]{10,}$/.test(input)) {
    return input;
  }

  return null;
}

function showToast(message, isError = false) {
  let toast = document.getElementById(toastId);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = toastId;
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");
  setTimeout(() => {
    toast.classList.remove("visible");
  }, 2400);
}

function showConfirmationModal() {
  return Promise.resolve(false);
}

const connectGoogleBusinessCallable = () =>
  httpsCallable(functions, "connectGoogleBusiness");
const connectGoogleBusinessByReviewLinkCallable = () =>
  httpsCallable(functions, "connectGoogleBusinessByReviewLink");
const connectGoogleManualLinkCallable = () =>
  httpsCallable(functions, "connectGoogleManualLink");
const exchangeGoogleAuthCodeCallable = () =>
  httpsCallable(functions, "exchangeGoogleAuthCode");

export async function connectPlaceOnBackend(
  place,
  { businessName } = {}
) {
  if (!place) {
    throw new Error("Missing place to connect");
  }

  const call = connectGoogleBusinessCallable();
  const placeId = place.place_id || place.placeId;
  const resolvedBusinessName = resolveBusinessName(place, businessName);
  const requestPayload = {
    placeId,
    businessName: resolvedBusinessName,
  };

  console.log("[google-connect] connectPlace request", requestPayload);

  const response = await call(requestPayload);
  console.log("[google-connect] connectPlace response", response?.data || response);
  const data = response?.data || {};

  if (!data.ok) {
    const error = new Error(
      data.message || "Unable to connect this Google profile right now."
    );
    error.code = data.reason || "ERROR";
    error.payload = data;
    throw error;
  }

  return data;
}

async function connectByReviewLink(
  reviewUrl,
  {
    force = false,
    dryRun = false,
    source = "review_link",
    mapUrl,
    placeId,
    businessName,
  } = {}
) {
  const call = connectGoogleBusinessByReviewLinkCallable();
  const response = await call({
    reviewUrl,
    force,
    dryRun,
    source,
    mapUrl,
    placeId,
    businessName,
  });
  const data = response?.data || {};

  if (!data.ok && !dryRun) {
    const error = new Error(
      data.message || "Unable to connect this Google profile right now."
    );
    error.code = data.reason || "ERROR";
    error.payload = data;
    throw error;
  }

  return data;
}

async function runWithPhoneMismatchConfirmation(executor, { message }) {
  try {
    return await executor(false);
  } catch (err) {
    if (
      err?.code === "PHONE_MISMATCH" ||
      err?.code === "PHONE_MISMATCH_CONFIRM_REQUIRED"
    ) {
      const mismatchMessage =
        message ||
        err?.message ||
        "We can’t connect this Google profile because the phone number doesn’t match your business profile.";
      return {
        ok: false,
        reason: err?.code || "PHONE_MISMATCH",
        message: mismatchMessage,
        payload: err?.payload || null,
      };
    }
    throw err;
  }
}

export function connectPlaceWithConfirmation(place, { businessName } = {}) {
  if (place?.__alreadyConnected) {
    return Promise.resolve({ ok: true, alreadyConnected: true });
  }
  const executor = () =>
    connectPlaceOnBackend(place, {
      businessName,
    });
  const confirmMessage =
    "We can’t connect this Google profile because the phone number doesn’t match your business profile.";
  return runWithPhoneMismatchConfirmation(executor, { message: confirmMessage });
}

async function connectSelectedLocations(locations = [], { onConnect, statusEl }) {
  if (!Array.isArray(locations) || !locations.length) {
    return { ok: false, reason: "NO_SELECTION", message: "Select at least one location." };
  }

  const results = [];
  for (const loc of locations) {
    if (statusEl) {
      statusEl.textContent = `Connecting ${loc.name || "location"}…`;
    }
    const connectPayload = {
      name: loc.name,
      place_id: loc.placeId,
      placeId: loc.placeId,
      phoneNumber: loc.phone || "",
      role: loc.role || null,
      accountId: loc.accountId || null,
      locationId: loc.locationId || null,
    };
    const response = await onConnect(connectPayload);
    if (!response?.ok) {
      return {
        ok: false,
        reason: response?.reason || "ERROR",
        message:
          response?.message ||
          "Unable to connect this Google profile right now. Please try again.",
      };
    }
    results.push({ location: loc, response });
  }

  if (statusEl) {
    statusEl.textContent = "Connected";
  }

  return { ok: true, results };
}

export function connectReviewLinkWithConfirmation(reviewUrl) {
  const executor = () => connectByReviewLink(reviewUrl, { force: false });
  const confirmMessage =
    "The phone number on Google doesn’t match the phone in your ReviewResQ profile. Please update your profile phone and try again.";
  return runWithPhoneMismatchConfirmation(executor, { message: confirmMessage });
}

const isValidGoogleManualLink = (raw = "") => {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const search = url.search.toLowerCase();

    const googleHost =
      host.includes("google.com") ||
      host.includes("googleusercontent.com") ||
      host.includes("goo.gl") ||
      host.includes("g.page") ||
      host.includes("maps.app.goo.gl");

    if (!googleHost) return false;

    const hasPlaceId = url.searchParams.has("placeid") || /placeid=/.test(search);
    const hasCid = url.searchParams.has("cid") || /cid=/.test(search);
    const hasReviewKeyword =
      path.includes("/local/review") ||
      path.includes("/local/reviews") ||
      path.includes("/maps") ||
      path.includes("/place") ||
      path.includes("/search");

    return hasPlaceId || hasCid || hasReviewKeyword;
  } catch (err) {
    return false;
  }
};

async function connectManualLink(manualLink, businessName = "") {
  const call = connectGoogleManualLinkCallable();
  const response = await call({ manualLink, businessName });
  const data = response?.data || {};

  if (!data.ok) {
    const error = new Error(
      data.message || "Unable to connect this Google profile right now."
    );
    error.code = data.reason || "ERROR";
    error.payload = data;
    throw error;
  }

  return data;
}

function extractShortAddress(place = {}) {
  if (place.formatted_address) return place.formatted_address;
  if (place.address) return place.address;
  return "Address unavailable";
}

function createResultCard(
  place,
  onConnect,
  { showConnect = true, buttonLabel = "Connect" } = {}
) {
  const totalRatings = place.user_ratings_total ?? place.userRatingsTotal;
  const item = document.createElement("div");
  item.className = "connect-result";
  const phoneBadge =
    typeof place.phoneMatches === "boolean"
      ? `<span class="badge ${
          place.phoneMatches ? "badge-success" : "badge-muted"
        }">${place.phoneMatches ? "Phone matches" : "Different phone"}</span>`
      : "";

  item.innerHTML = `
    <div class="connect-result__body">
      <div class="connect-result__header">
        <p class="strong">${place.name || "Unnamed place"}</p>
        ${phoneBadge}
      </div>
      <p class="card-subtitle">
        ${place.types?.[0] || "Business"} · ${extractShortAddress(place)}
      </p>
      <p class="card-subtitle">
        ${
          place.phoneNumber ||
          place.formatted_phone_number ||
          place.international_phone_number ||
          "Phone unavailable"
        }
      </p>
      <p class="card-subtitle">
        ${place.rating ? `${Number(place.rating).toFixed(1)} stars` : "No rating yet"}
        ${totalRatings ? ` · ${totalRatings} reviews` : ""}
      </p>
    </div>
  `;

  if (showConnect) {
    const action = document.createElement("button");
    action.className = "btn btn-primary";
    action.textContent = buttonLabel;
    action.addEventListener("click", async () => {
      const originalText = action.textContent;
      action.disabled = true;
      action.textContent = "Connecting…";
      try {
        const result = await onConnect(place);
        if (!result?.ok) {
          const failureMessage =
            result?.message || "Unable to connect Google profile. Please try again.";
          showToast(failureMessage, true);
          action.disabled = false;
          action.textContent = originalText;
          return;
        }

        action.textContent = "Connected";
        document
          .querySelectorAll(".connect-result button.btn-primary")
          .forEach((btn) => {
            if (btn !== action) {
              btn.disabled = true;
            }
          });
      } catch (err) {
        const failureMessage =
          err?.message || "Unable to connect Google profile. Please try again.";
        console.error("[google-connect] failed to connect", failureMessage);
        action.disabled = false;
        action.textContent = originalText;
        showToast(failureMessage, true);
      }
    });
    item.appendChild(action);
  }
  return item;
}

async function searchPlaces(name, state, phone) {
  const response = await fetch(placesProxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: name.trim(),
      stateOrCity: (state || "").trim() || null,
      phoneNumber: (phone || "").trim(),
    }),
  });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error("[google-connect] failed to parse Places response", err);
    throw new Error("Unable to read response from Places search");
  }

  if (!response.ok) {
    const codedError = new Error(
      data?.message || data?.error?.message || "Places search failed"
    );
    codedError.code = data?.reason || data?.error?.code;
    throw codedError;
  }

  if (data?.reason === "ERROR") {
    const codedError = new Error(data?.message || "Places search failed");
    codedError.code = data?.reason;
    throw codedError;
  }

  return {
    ok: Boolean(data?.ok),
    reason: data?.reason,
    message: data?.message,
    match: data?.match || null,
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
  };
}

export function buildGoogleReviewLink(placeId) {
  if (!placeId) return "";
  return `https://search.google.com/local/review?placeid=${encodeURIComponent(placeId)}`;
}

export function renderGoogleConnect(container, options = {}) {
  if (!container) return;
  const {
    title = "Connect your Google Reviews",
    subtitle = "Securely connect businesses you own or manage on Google.",
    helperText = "Start typing your business name as it appears on Google.",
    onConnect = () => {},
    onManualConnect = null,
    onSkip,
    showSkip = false,
    defaultQuery = "",
    planId: providedPlanId = "starter",
  } = options;

  container.innerHTML = `
    <section class="card connect-card">
      <div class="card-header">
        <div>
          <p class="card-title">${title}</p>
          <p class="card-subtitle">${subtitle}</p>
        </div>
        ${
          showSkip
            ? '<button type="button" class="btn btn-link" data-connect-skip>Skip for now</button>'
            : ""
        }
      </div>
      <div class="stacked">
        <div class="stacked">
          <button class="btn btn-primary" type="button" data-google-oauth>Connect with Google</button>
          <p class="card-subtitle">Securely connect businesses you own or manage on Google.</p>
          <p class="card-subtitle" data-google-oauth-status></p>
          <div class="connect-results" data-google-oauth-results></div>
        </div>
        <div class="divider"></div>
        <label class="strong" for="google-business-input">Business name</label>
        <input
          id="google-business-input"
          class="input"
          type="text"
          placeholder="Business name"
          data-google-name
          data-google-query
          value="${defaultQuery}"
        />
        <label class="strong" for="google-business-state">State / Province</label>
        <input
          id="google-business-state"
          class="input"
          type="text"
          placeholder="State (e.g. FL)"
          data-google-state
        />
        <label class="strong" for="google-business-phone">Phone number</label>
        <input
          id="google-business-phone"
          class="input"
          type="text"
          placeholder="Business phone (as shown on Google Maps)"
          data-google-phone
        />
        <p class="card-subtitle">${helperText}</p>
        <div class="input-row">
          <button class="btn btn-outline" type="button" data-google-search>Use phone verification</button>
        </div>
        <div class="connect-results" data-google-results></div>
        <p class="card-subtitle" data-connect-message></p>
      </div>
    </section>
  `;

  const searchBtn = container.querySelector("[data-google-search]");
  const oauthBtn = container.querySelector("[data-google-oauth]");
  const nameInput = container.querySelector("#google-business-input") ||
    container.querySelector("[data-google-name]") ||
    container.querySelector("[data-google-query]");
  const stateInput = container.querySelector("#google-business-state") ||
    container.querySelector("[data-google-state]");
  const phoneInput = container.querySelector("#google-business-phone") ||
    container.querySelector("[data-google-phone]");
  const resultsEl = container.querySelector("[data-google-results]");
  const oauthResultsEl = container.querySelector("[data-google-oauth-results]");
  const oauthStatusEl = container.querySelector("[data-google-oauth-status]");
  const messageEl = container.querySelector("[data-connect-message]");
  const skipBtn = container.querySelector("[data-connect-skip]");
  const subscription = getCachedSubscription?.();
  const planId = normalizePlan(providedPlanId || subscription?.planId || "starter");
  const limit = planLocationLimit(planId);

  const connectAndReport = async (place) => {
    const enrichedPlace = {
      ...place,
      __inputBusinessName: (nameInput?.value || "").trim(),
    };
    const result = await onConnect(enrichedPlace);
    if (result?.ok) {
      if (messageEl) {
        messageEl.textContent = "Google profile connected!";
        messageEl.style.color = "var(--success)";
      }
      return result;
    }

    const error = new Error(
      result?.message || "Unable to connect Google profile. Please try again."
    );
    error.payload = result;
    throw error;
  };

  let activeManualOverlay = null;

  const closeManualOverlay = () => {
    if (activeManualOverlay?.parentNode) {
      activeManualOverlay.parentNode.removeChild(activeManualOverlay);
    }
    activeManualOverlay = null;
  };


  const renderManualOverlay = (
    { defaultInput = "", onRetrySearch } = {},
    onSuccess
  ) => {
    const { cachedProfile } = gatherAccountData();
    if (
      cachedProfile?.googlePlaceId &&
      cachedProfile?.googleConnectionType !== "manual" &&
      cachedProfile?.connectionMethod !== "manual"
    ) {
      showToast("A Google profile is already connected automatically.", true);
      return;
    }

    closeManualOverlay();
    const overlay = document.createElement("div");
    overlay.className = "manual-modal__overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="manual-modal">
      <div class="manual-modal__header">
        <div>
          <p class="manual-modal__title">Connect manually</p>
          <p class="manual-modal__subtitle">Paste your Google Maps business link or Google Reviews link to continue.</p>
        </div>
        <button type="button" class="btn btn-link" data-manual-close aria-label="Close manual connect">✕</button>
      </div>
      <div class="stacked">
        <label class="strong">Business name</label>
        <input class="input" type="text" data-manual-business-name placeholder="Business name" />
        <label class="strong">Google link</label>
        <input class="input" type="url" data-manual-input placeholder="https://www.google.com/maps/place/… or local/review?placeid=…" value="${defaultInput}" />
        <p class="card-subtitle">We’ll validate the link details with Google before saving it to your profile.</p>
        <div class="manual-actions">
          <button type="button" class="btn btn-primary" data-manual-connect>Connect manually</button>
            <button type="button" class="btn btn-outline" data-manual-cancel>Cancel</button>
          </div>
          <p class="card-subtitle" data-manual-status></p>
          <a class="helper-link" href="#" data-manual-helper>How do I find my link?</a>
          <div class="helper-steps" data-manual-helper-steps hidden>
            <ol>
              <li>Open your business on Google Maps.</li>
              <li>Copy the URL from the address bar or the “Write a review” link.</li>
              <li>Paste that link here to connect manually.</li>
            </ol>
          </div>
        </div>
      </div>
    `;

  const helperLink = overlay.querySelector("[data-manual-helper]");
  const helperSteps = overlay.querySelector("[data-manual-helper-steps]");
  const closeBtn = overlay.querySelector("[data-manual-close]");
  const cancelBtn = overlay.querySelector("[data-manual-cancel]");
  const connectBtn = overlay.querySelector("[data-manual-connect]");
  const reviewInput = overlay.querySelector("[data-manual-input]");
  const businessNameInput = overlay.querySelector("[data-manual-business-name]");
  const statusEl = overlay.querySelector("[data-manual-status]");

    const setStatus = (text, isError = false) => {
      statusEl.textContent = text || "";
      statusEl.style.color = isError ? "var(--danger)" : "";
    };

  const finalizeManualConnect = async () => {
    const value = (reviewInput?.value || "").trim();
    const businessName = (businessNameInput?.value || "").trim();
    if (!value) {
      setStatus("Paste your Google Maps business link or Google Reviews link.", true);
      return;
    }

    if (!businessName) {
      setStatus("Enter your business name to continue.", true);
      return;
    }

    if (!isValidGoogleManualLink(value)) {
      setStatus("That doesn’t look like a Google business or reviews link.", true);
      return;
    }

    connectBtn.disabled = true;
    setStatus("Saving your manual connection…");
    try {
      const response = await connectManualLink(value, businessName);
        if (response?.ok) {
          setStatus("Connected manually.");
          if (typeof onSuccess === "function") {
            await onSuccess({ ...response, manualLink: value, businessName });
          }
          closeManualOverlay();
        } else {
          const message = response?.message || "Unable to save that link right now.";
          setStatus(message, true);
          showToast(message, true);
        }
      } catch (err) {
        console.error("[google-connect] manual connect failed", err);
        const message = err?.message || "Unable to save that link right now.";
        setStatus(message, true);
        showToast(message, true);
      } finally {
        connectBtn.disabled = false;
      }
    };

    helperLink?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!helperSteps) return;
      helperSteps.hidden = !helperSteps.hidden;
    });

    closeBtn?.addEventListener("click", () => {
      closeManualOverlay();
      if (typeof onRetrySearch === "function") {
        onRetrySearch();
      }
    });
    cancelBtn?.addEventListener("click", () => {
      closeManualOverlay();
      if (typeof onRetrySearch === "function") {
        onRetrySearch();
      }
    });
    connectBtn?.addEventListener("click", finalizeManualConnect);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeManualOverlay();
        if (typeof onRetrySearch === "function") {
          onRetrySearch();
        }
      }
    });

    activeManualOverlay = overlay;
    document.body.appendChild(overlay);
  };
  if (showSkip && skipBtn && typeof onSkip === "function") {
    skipBtn.addEventListener("click", () => onSkip());
  }

  const renderOAuthLocations = (locations = []) => {
    if (!oauthResultsEl) return;
    oauthResultsEl.innerHTML = "";
    const info = document.createElement("p");
    info.className = "card-subtitle";
    info.textContent = `Select up to ${limit} location${limit > 1 ? "s" : ""} based on your plan.`;
    oauthResultsEl.appendChild(info);

    if (!locations.length) {
      const empty = document.createElement("p");
      empty.className = "card-subtitle";
      empty.textContent = "We couldn’t find any Google Business locations for this account.";
      oauthResultsEl.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "stacked";
    locations.forEach((loc) => {
      const row = document.createElement("label");
      row.className = "connect-result__row";
      row.innerHTML = `
        <input type="checkbox" value="${loc.placeId}" data-google-oauth-location />
        <div>
          <p class="strong">${loc.name || "Business"}</p>
          <p class="card-subtitle">${loc.address || "Address unavailable"}</p>
          <p class="card-subtitle">${loc.role ? `Role: ${loc.role}` : ""}</p>
        </div>
      `;
      const checkbox = row.querySelector("input[type=checkbox]");
      if (checkbox) {
        checkbox.dataset.accountId = loc.accountId || "";
        checkbox.dataset.locationId = loc.locationId || "";
        checkbox.dataset.name = loc.name || "";
        checkbox.dataset.phone = loc.phone || "";
      }
      list.appendChild(row);
    });
    oauthResultsEl.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "input-row";
    const connectBtn = document.createElement("button");
    connectBtn.className = "btn btn-primary";
    connectBtn.textContent = "Connect selected";
    const status = document.createElement("p");
    status.className = "card-subtitle";
    status.dataset.status = "";

    const handleSelection = async () => {
      const selectedBoxes = Array.from(
        list.querySelectorAll('input[type="checkbox"]:checked') || []
      );
      const selectedLocations = selectedBoxes.map((box) => ({
        placeId: box.value,
        accountId: box.dataset.accountId || "",
        locationId: box.dataset.locationId || "",
        name: box.dataset.name || "",
        phone: box.dataset.phone || "",
      }));

      const attempted = selectedLocations.length + currentConnectionCount();
      const overLimit = attempted > limit;
      if (!selectedLocations.length || overLimit) {
        const upgrade = planUpgradeMessage(planId, attempted || limit + 1);
        const message = upgrade || "Select at least one location to continue.";
        if (status) {
          status.textContent = message;
          status.style.color = "var(--danger)";
        }
        if (upgrade) {
          showToast(upgrade, true);
        }
        return;
      }

      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting…";
      status.textContent = "";
      status.style.color = "";
      try {
        const response = await connectSelectedLocations(selectedLocations, {
          onConnect: connectAndReport,
          statusEl: status,
        });
        if (!response?.ok) {
          const failure =
            response?.message ||
            "Unable to connect this Google profile right now. Please try again.";
          status.textContent = failure;
          status.style.color = "var(--danger)";
          showToast(failure, true);
          connectBtn.disabled = false;
          connectBtn.textContent = "Connect selected";
          return;
        }

        status.textContent = "Connected";
        status.style.color = "var(--success)";
        showToast("Google profile connected.");
      } catch (err) {
        const failure =
          err?.message || "Unable to connect Google profile right now. Please try again.";
        status.textContent = failure;
        status.style.color = "var(--danger)";
        showToast(failure, true);
      } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect selected";
      }
    };

    connectBtn.addEventListener("click", handleSelection);
    actions.appendChild(connectBtn);
    oauthResultsEl.appendChild(actions);
    oauthResultsEl.appendChild(status);
  };

  const startOAuthFlow = async () => {
    if (!oauthBtn) return;
    const oauthConfig = await ensureOAuthConfig({ logAvailability: true });
    if (!oauthConfig?.clientId || !oauthConfig?.redirectUri) {
      const unavailable = "Google OAuth unavailable.";
      if (oauthStatusEl) {
        oauthStatusEl.textContent = unavailable;
        oauthStatusEl.style.color = "var(--danger)";
      }
      oauthBtn.textContent = unavailable;
      oauthBtn.disabled = false;
      return;
    }
    if (currentConnectionCount() >= limit) {
      const upgradeMessage = planUpgradeMessage(planId, limit + 1);
      if (oauthStatusEl) {
        oauthStatusEl.textContent = upgradeMessage;
        oauthStatusEl.style.color = "var(--danger)";
      }
      showToast(upgradeMessage || "Plan limit reached.", true);
      return;
    }
    if (oauthStatusEl) {
      oauthStatusEl.textContent = "";
      oauthStatusEl.style.color = "";
    }
    if (oauthResultsEl) {
      oauthResultsEl.innerHTML = "";
    }
    oauthBtn.disabled = true;
    const originalText = oauthBtn.textContent;
    oauthBtn.textContent = "Authorizing…";

    try {
      const { code, codeVerifier } = await requestGoogleAuthorizationCode();
      const exchange = exchangeGoogleAuthCodeCallable();
      const response = await exchange({
        code,
        codeVerifier,
        redirectUri: oauthConfig.redirectUri,
        scopes: oauthConfig.scopes || GOOGLE_OAUTH_SCOPE,
      });
      const payload = response?.data || {};
      if (!payload.ok) {
        const error = new Error(
          payload?.message || "We couldn’t start Google OAuth. Try phone verification instead."
        );
        error.code = payload?.reason || "OAUTH_FAILED";
        throw error;
      }

      const locations = Array.isArray(payload.locations) ? payload.locations : [];
      renderOAuthLocations(locations);
    } catch (err) {
      const message =
        err?.message || "We couldn’t start Google OAuth. Try phone verification instead.";
      if (oauthStatusEl) {
        oauthStatusEl.textContent = message;
        oauthStatusEl.style.color = "var(--danger)";
      }
      showToast(message, true);
    } finally {
      oauthBtn.disabled = false;
      oauthBtn.textContent = originalText || "Connect with Google";
    }
  };

  async function handleSearch() {
    const name = nameInput ? nameInput.value.trim() : "";
    const state = stateInput ? stateInput.value.trim() : "";
    const phone = phoneInput ? phoneInput.value.trim() : "";

    messageEl.textContent = "";
    messageEl.style.color = "";
    resultsEl.classList.remove("connect-results--loading");
    resultsEl.innerHTML = "";

    if (!name.trim()) {
      messageEl.textContent = "Enter your business name, then try again.";
      messageEl.style.color = "var(--danger)";
      return;
    }

    resultsEl.textContent = "Searching Google…";
    resultsEl.classList.add("connect-results--loading");
    const originalButtonText = searchBtn ? searchBtn.textContent : "";
    if (searchBtn) {
      searchBtn.disabled = true;
      searchBtn.textContent = "Searching…";
    }

    const afterManualConnect = async (response = {}) => {
      const handler = typeof onManualConnect === "function" ? onManualConnect : onConnect;
      if (typeof handler === "function") {
        await handler({ ...response, __manual: true });
      }
      messageEl.textContent = "Connected manually.";
      messageEl.style.color = "var(--success)";
    };

    const renderManualCta = ({ headline }) => {
      const cta = document.createElement("div");
      cta.className = "connect-results__cta";
      cta.innerHTML = `
        <p class="card-subtitle">${headline || "Can’t find your business? You can connect manually."}</p>
        <div class="input-row">
          <button class="btn btn-primary" type="button" data-manual-launch>Manual Connect</button>
          <button class="btn btn-outline" type="button" data-search-again>Try search again</button>
        </div>
      `;
      cta.querySelector("[data-manual-launch]")?.addEventListener("click", () => {
        renderManualOverlay(
          {
            defaultInput: "",
            onRetrySearch: () => {
              resultsEl.innerHTML = "";
              messageEl.textContent = "";
              nameInput?.focus();
            },
          },
          async (response) => {
            await afterManualConnect(response);
            showToast(response?.message || "Google profile connected.");
          }
        );
      });
      cta.querySelector("[data-search-again]")?.addEventListener("click", () => {
        resultsEl.innerHTML = "";
        messageEl.textContent = "";
        nameInput?.focus();
      });
      resultsEl.appendChild(cta);
    };

    try {
      const data = await searchPlaces(name, state, phone);
      resultsEl.classList.remove("connect-results--loading");
      resultsEl.innerHTML = "";

      if (!data?.candidates?.length && !data?.match) {
        renderManualCta({
          headline: "Can’t find your business? You can connect manually.",
        });
        return;
      }

      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      const normalizePlace = (place) => ({
        ...place,
        place_id: place.place_id || place.placeId,
      });

      if (data?.reason === "EXACT_MATCH" && data.match) {
        const primary = normalizePlace(data.match);
        const primaryCard = createResultCard(primary, connectAndReport);
        const heading = document.createElement("p");
        heading.className = "strong";
        heading.textContent = "Best match";
        resultsEl.appendChild(heading);
        resultsEl.appendChild(primaryCard);

        const others = candidates
          .filter((c) => (c.placeId || c.place_id) !== primary.place_id)
          .map(normalizePlace);
        if (others.length) {
          const otherHeading = document.createElement("p");
          otherHeading.className = "card-subtitle";
          otherHeading.textContent = "Other similar businesses";
          resultsEl.appendChild(otherHeading);
          others.forEach((candidate) => {
            const row = createResultCard(candidate, onConnect, { showConnect: false });
            resultsEl.appendChild(row);
          });
        }
        return;
      }

      if (data?.reason === "NO_EXACT_MATCH") {
        messageEl.textContent =
          data?.message ||
          "We couldn’t find your business automatically. You can connect manually by pasting your Google review link.";
        messageEl.style.color = "var(--danger)";
      }

      if (data?.reason === "NO_PHONE_MATCH") {
        messageEl.textContent =
          data?.message ||
          "The phone number on Google doesn’t match the phone in your ReviewResQ profile. Please update your profile phone and try again.";
        messageEl.style.color = "var(--danger)";
      }

      const list = candidates.map(normalizePlace);
      list.forEach((place) => {
        const row = createResultCard(
          place,
          connectAndReport,
          {
            buttonLabel:
              data?.reason === "NO_PHONE_MATCH" ? "This is my business" : "Connect",
          }
        );
        resultsEl.appendChild(row);
      });

      if (data?.reason === "NO_EXACT_MATCH") {
        renderManualCta({ headline: messageEl.textContent });
      }
    } catch (err) {
      console.error("[google-connect] search failed", err);
      resultsEl.classList.remove("connect-results--loading");

      if (err && (err.code === "NO_MATCHES" || err.code === "NO_RESULTS")) {
        resultsEl.innerHTML = "";
        renderManualCta({
          headline: "Can’t find your business? You can connect manually.",
        });
        return;
      }

      if (err && err.code === "MULTIPLE_MATCHES") {
        resultsEl.textContent =
          "We found multiple possible matches on Google. Please refine your business name, phone number, or add a state to narrow it down.";
        return;
      }

      const friendlyMessage =
        err?.message || "Unable to search right now. Please try again.";
      resultsEl.textContent = friendlyMessage;
      showToast(friendlyMessage, true);
    } finally {
      if (searchBtn) {
        searchBtn.disabled = false;
        searchBtn.textContent = originalButtonText || "Search";
      }
    }
  }

  if (searchBtn) searchBtn.addEventListener("click", handleSearch);
  if (oauthBtn) oauthBtn.addEventListener("click", startOAuthFlow);
  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      }
    });
  }
}

export async function refetchProfileAfterConnect() {
  return refreshProfile();
}
