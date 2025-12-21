import {
  onSession,
  fetchAllReviews,
  calculateMetrics,
  buildRatingBreakdown,
  describeReview,
} from "./dashboard-data.js";
import { initialsFromName, formatDate } from "./session-data.js";
import {
  db,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "./firebase-config.js";
import { normalizePlan } from "./plan-capabilities.js";

const buildId = window.__REVIEWRESQ_BUILD_ID || "dev";
const allowDebugBadges =
  window.location.hostname === "localhost" ||
  new URLSearchParams(window.location.search || "").get("debug") === "1";

let googleConnectModulePromise;

async function getGoogleConnectModule() {
  if (!googleConnectModulePromise) {
    const moduleUrl = new URL("./google-connect.js", import.meta.url);
    moduleUrl.searchParams.set("v", buildId);
    googleConnectModulePromise = import(moduleUrl.toString());
  }
  return googleConnectModulePromise;
}

const profileNameEl = document.querySelector("[data-google-business-name]");
const profileSubtitleEl = document.querySelector("[data-google-business-subtitle]");
const ratingBadges = {
  rating: document.querySelector("[data-google-rating]"),
  count: document.querySelector("[data-google-count]"),
};
const ratingRows = document.querySelectorAll("[data-rating-row]");
const reviewList = document.querySelector("[data-google-review-list]");
const avatar = document.querySelector("[data-google-avatar]");
const connectContainer = document.querySelector("[data-google-connect-slot]");
const noProfileNoticeContainer = document.querySelector("[data-google-no-profile-notice]");
const connectedContainer = document.querySelector("[data-google-connected]");
const changeProfileBtn = document.querySelector("[data-change-google]");
const planBadge = document.querySelector("[data-plan-badge]");
const upsellContainer = document.querySelector("[data-google-upsell]");
const connectionStateBadge = document.querySelector("[data-google-connection-state]");
const verificationBadge = document.querySelector("[data-google-verification]");
const pageHeaderActions = document.querySelector(".page-header-actions");
let locationSelectorEl = null;

const debugBadgeLabels = ["project", "origin", "build", "test mode"];

function removeDebugBadges() {
  if (allowDebugBadges) return;
  const badges = document.querySelectorAll(".badge");
  badges.forEach((badge) => {
    const label = (badge.textContent || "").trim().toLowerCase();
    if (debugBadgeLabels.some((needle) => label.includes(needle))) {
      badge.remove();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", removeDebugBadges);
} else {
  removeDebugBadges();
}

const toastId = "feedback-toast";
let sessionState = { user: null, profile: null, subscription: null };
let changeListenerAttached = false;
let activeLocationId = null;
let manualConnection = null;

function resolveConnectBusinessName(place = {}) {
  const inputName = (place.__inputBusinessName || "").trim();
  const profile = sessionState.profile || {};
  return (
    inputName ||
    place.name ||
    profile.businessName ||
    profile.name ||
    "Business"
  );
}

function planLabel(plan) {
  switch (plan) {
    case "growth":
      return "Growth";
    case "pro_ai":
      return "Pro AI Suite";
    default:
      return "Starter";
  }
}

function planLocationLimit(plan) {
  switch (plan) {
    case "growth":
      return 2;
    case "pro_ai":
      return 15;
    default:
      return 1;
  }
}

function deriveConnectedLocations(profile = {}) {
  const sources =
    profile.googleLocations ||
    profile.connectedLocations ||
    profile.googleAccounts ||
    [];
  if (Array.isArray(sources) && sources.length) {
    return sources
      .map((item) => ({
        id: item.locationId || item.placeId || item.googlePlaceId || item.id || item.name,
        placeId: item.placeId || item.googlePlaceId || item.id,
        googleProfile: item.googleProfile || item,
        verificationMethod: item.verificationMethod || item.connectionMethod,
        provider: item.provider || "google",
        role: item.role || item.userRole || null,
        phoneVerified: item.verificationMethod === "phone",
        googleReviewUrl: item.googleReviewUrl || profile.googleReviewUrl || "",
      }))
      .filter((loc) => loc.placeId || loc.id);
  }

  if (profile.googlePlaceId || profile.googleProfile) {
    return [
      {
        id: profile.googlePlaceId || profile.id || "primary",
        placeId: profile.googlePlaceId || profile.id,
        googleProfile: profile.googleProfile || profile,
        verificationMethod: profile.connectionMethod || profile.verificationMethod || "google_oauth",
        provider: "google",
        googleReviewUrl: profile.googleReviewUrl || "",
      },
    ];
  }
  return [];
}

function storeActiveLocation(id) {
  activeLocationId = id || null;
  try {
    if (id) {
      sessionStorage.setItem("rrq_active_google_location", id);
    } else {
      sessionStorage.removeItem("rrq_active_google_location");
    }
  } catch (err) {
    console.warn("[google-reviews] unable to persist active location", err);
  }
}

function resolveStoredLocationId() {
  try {
    return sessionStorage.getItem("rrq_active_google_location");
  } catch (err) {
    return null;
  }
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
  setTimeout(() => toast.classList.remove("visible"), 2400);
}

function renderConnectStatus({ manualConnected = false, googleConnected = false } = {}) {
  const statusEl = document.getElementById("googleConnectStatus");
  if (!statusEl) return;
  if (manualConnected) {
    statusEl.textContent = "Connected (Manual)";
    return;
  }
  if (googleConnected) {
    statusEl.textContent = "Connected (Google)";
    return;
  }
  statusEl.textContent = "Not connected";
}

function getManualInputs() {
  return {
    name: document.querySelector("[data-google-name]") || document.querySelector("[data-google-query]") || null,
    state: document.querySelector("[data-google-state]") || null,
    phone: document.querySelector("[data-google-phone]") || null,
  };
}

function applyManualValuesToForm(connection = manualConnection) {
  if (!connection) return;
  const inputs = getManualInputs();
  if (inputs.name && !inputs.name.value) inputs.name.value = connection.businessName || "";
  if (inputs.state && !inputs.state.value) inputs.state.value = connection.state || "";
  if (inputs.phone && !inputs.phone.value) inputs.phone.value = connection.phone || "";
}

function buildManualPayload(manualResponse = {}) {
  const inputs = getManualInputs();
  const businessName =
    manualResponse.businessName ||
    manualResponse.name ||
    (inputs.name?.value || "").trim() ||
    sessionState.profile?.businessName ||
    "";
  const state = manualResponse.state || manualResponse.region || (inputs.state?.value || "").trim();
  const phone =
    manualResponse.phone ||
    manualResponse.phoneNumber ||
    manualResponse.formatted_phone_number ||
    (inputs.phone?.value || "").trim();
  const placeId =
    manualResponse.placeId ||
    manualResponse.place_id ||
    manualResponse.googlePlaceId ||
    manualResponse.locationId ||
    "";
  return {
    businessName,
    state,
    phone,
    placeId: placeId || "",
  };
}

function validateManualPayload(payload = {}) {
  const errors = [];
  if (!payload.businessName) {
    errors.push("Enter your business name.");
  }
  const hasLocationDetails = payload.placeId || (payload.state && payload.phone);
  if (!hasLocationDetails) {
    errors.push("Add your state and phone number or a Google place ID.");
  }
  return { ok: errors.length === 0, errors };
}

function toggleManualButtons(disabled) {
  const manualButtons = document.querySelectorAll(
    "[data-manual-connect], [data-manual-launch], [data-google-search]"
  );
  manualButtons.forEach((btn) => {
    btn.disabled = disabled;
  });
}

function augmentProfileWithManual(baseProfile = {}, connection = manualConnection) {
  if (!connection) return baseProfile;
  const profile = baseProfile || {};
  const googleProfile = {
    ...(profile.googleProfile || {}),
    connectionType: "manual",
    manualConnected: true,
    manualGoogleUrl: connection.manualGoogleUrl || profile.googleProfile?.manualGoogleUrl,
    name: connection.businessName || profile.googleProfile?.name || profile.businessName,
    businessName: connection.businessName || profile.businessName,
    location: connection.state || profile.location || profile.city,
    phone: connection.phone || profile.phone,
    placeId: connection.placeId || profile.googlePlaceId,
  };
  return {
    ...profile,
    googleConnectionType: "manual",
    googleManualConnection: true,
    googleManualLink: connection.manualGoogleUrl || profile.googleManualLink || true,
    googleManualUrl: connection.manualGoogleUrl || profile.googleManualUrl,
    googleProfile,
    googlePlaceId: connection.placeId || profile.googlePlaceId || null,
  };
}

async function loadManualConnectionFromFirestore() {
  if (!sessionState.user) return null;
  try {
    const profileRef = doc(db, "googleProfiles", sessionState.user.uid);
    const profileSnap = await getDoc(profileRef);
    const userRef = doc(db, "users", sessionState.user.uid);
    const userSnap = await getDoc(userRef);

    let connection = null;
    if (profileSnap.exists()) {
      const data = profileSnap.data() || {};
      if (data.connectionType === "manual" || data.type === "manual") {
        connection = {
          businessName: data.manualBusinessName || data.businessName || "",
          manualGoogleUrl: data.manualGoogleUrl || data.url || "",
          normalizedHost: data.normalizedHost || "",
          connectionType: "manual",
          placeId: data.placeId || "",
        };
      }
    }

    if (!connection && userSnap.exists()) {
      const data = userSnap.data() || {};
      const selected = data.selectedBusiness || {};
      if (selected.connectionType === "manual") {
        connection = {
          businessName: selected.businessName || "",
          state: selected.state || "",
          phone: selected.phone || "",
          placeId: selected.placeId || "",
          connectionType: "manual",
        };
      }
    }

    manualConnection = connection;
    applyManualValuesToForm();
    renderConnectStatus({ manualConnected: Boolean(manualConnection), googleConnected: false });
    return manualConnection;
  } catch (err) {
    console.error("[google-reviews] failed to load manual connection", err);
    return null;
  }
}

async function saveManualConnection(manualResponse = {}) {
  if (!sessionState.user) {
    showToast("You need to be signed in to connect manually.", true);
    return { ok: false };
  }

  const businessName =
    manualResponse.businessName ||
    manualResponse.name ||
    sessionState.profile?.businessName ||
    "";
  const manualGoogleUrl =
    manualResponse.manualGoogleUrl ||
    manualResponse.manualLink ||
    manualResponse.googleManualLink ||
    "";

  if (!manualGoogleUrl) {
    showToast("Please paste a valid Google Maps or Google Reviews link.", true);
    return { ok: false };
  }

  if (!businessName) {
    showToast("Enter your business name to continue.", true);
    return { ok: false };
  }

  toggleManualButtons(true);
  try {
    const payload = {
      connectionType: "manual",
      manualBusinessName: businessName,
      manualGoogleUrl,
      normalizedHost: manualResponse.normalizedHost || "",
      updatedAt: serverTimestamp(),
    };
    const ref = doc(db, "googleProfiles", sessionState.user.uid);
    await setDoc(ref, payload, { merge: true });

    manualConnection = {
      businessName,
      manualGoogleUrl,
      normalizedHost: manualResponse.normalizedHost || "",
      connectionType: "manual",
    };
    applyManualValuesToForm();
    renderConnectStatus({ manualConnected: true, googleConnected: false });
    showToast("Manual connection saved successfully.");
    return { ok: true, data: manualConnection };
  } catch (err) {
    console.error("[google-reviews] unable to save manual connection", err);
    showToast("Unable to save manual connection. Please try again.", true);
    return { ok: false, error: err };
  } finally {
    toggleManualButtons(false);
  }
}

function renderProfile(profile, googleMetrics = {}) {
  const source = profile?.googleProfile || profile || {};
  const displayName = source.name || source.businessName || "Business";
  const metrics = googleMetrics || {};
  const manualConnected = Boolean(
    source?.connectionType === "manual" ||
      source?.manualConnected ||
      profile?.googleConnectionType === "manual" ||
      profile?.googleManualConnection === true ||
      profile?.googleReviewLink ||
      profile?.googleManualLink
  );
  if (profileNameEl) {
    profileNameEl.textContent = displayName;
  }
  if (profileSubtitleEl) {
    const city = source.city || source.location || source.category || source.formatted_address;
    profileSubtitleEl.textContent = city || "Google profile";
  }
  if (avatar) {
    const initials = initialsFromName(displayName || "");
    avatar.textContent = initials;
  }
  if (ratingBadges.rating) {
    ratingBadges.rating.textContent = metrics.averageRating
      ? `Google rating ${metrics.averageRating.toFixed(1)}`
      : "No rating yet";
  }
  if (ratingBadges.count) {
    ratingBadges.count.textContent = `${metrics.total || 0} reviews`;
  }
  if (connectionStateBadge) {
    if (manualConnected) {
      connectionStateBadge.textContent = "Connected manually";
      connectionStateBadge.style.display = "inline-block";
    } else {
      connectionStateBadge.textContent = "";
      connectionStateBadge.style.display = "none";
    }
  }
  if (verificationBadge) {
    verificationBadge.textContent = manualConnected
      ? "Verified via phone"
      : "Verified by Google";
    verificationBadge.style.display = "inline-block";
  }
}

function renderRatingBreakdown(breakdown) {
  if (!breakdown || !breakdown.percents) return;
  ratingRows.forEach((row) => {
    const star = row.getAttribute("data-rating-row");
    const valueEl = row.querySelector(".rating-value");
    if (!valueEl) return;
    const percent = breakdown.percents[star] ?? 0;
    valueEl.textContent = `${percent}%`;
  });
}

function renderReviews(items = []) {
  if (!reviewList) return;
  reviewList.innerHTML = "";
  if (!items.length) {
    reviewList.textContent = "No Google reviews yet.";
    return;
  }
  items.forEach((review) => {
    const container = document.createElement("div");
    container.className = "review-item";
    const meta = [];
    if (review.rating) meta.push(`${review.rating} stars`);
    const date = formatDate(review.createdAt);
    if (date && date !== "—") meta.push(date);
    container.innerHTML = `
      <div class="strong">${review.displayName}</div>
      <p class="card-subtitle">${review.message || "—"}${meta.length ? ` · ${meta.join(" · ")}` : ""}</p>
    `;
    reviewList.appendChild(container);
  });
}

function renderLocationSelector(locations = [], plan = "starter") {
  if (!pageHeaderActions) return;
  const normalizedPlan = normalizePlan(plan);
  const shouldShowSelector =
    (normalizedPlan === "growth" && locations.length >= 2) ||
    (normalizedPlan === "pro_ai" && locations.length >= 2);

  if (!shouldShowSelector) {
    if (locationSelectorEl?.parentNode) {
      locationSelectorEl.parentNode.removeChild(locationSelectorEl);
    }
    locationSelectorEl = null;
    return;
  }

  if (!locationSelectorEl) {
    locationSelectorEl = document.createElement("div");
    locationSelectorEl.className = "input-row";
    locationSelectorEl.innerHTML = `
      <label class="strong" for="active-google-location">Active location</label>
      <select class="input" id="active-google-location" data-active-location></select>
    `;
    pageHeaderActions.appendChild(locationSelectorEl);
  }

  const select = locationSelectorEl.querySelector("select[data-active-location]");
  if (!select) return;
  select.innerHTML = "";
  locations.forEach((loc) => {
    const option = document.createElement("option");
    option.value = loc.id || loc.placeId;
    option.textContent = loc.googleProfile?.name || loc.name || "Location";
    if (option.value === activeLocationId) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  select.onchange = (event) => {
    const value = event.target?.value || null;
    storeActiveLocation(value);
    loadGoogleData();
  };
}

function toggleViews(isConnected) {
  if (connectedContainer) {
    connectedContainer.style.display = isConnected ? "block" : "none";
  }
  if (connectContainer) {
    connectContainer.style.display = isConnected ? "none" : "block";
  }
  if (changeProfileBtn) {
    changeProfileBtn.style.display = isConnected ? "inline-flex" : "none";
  }
}

async function renderNoProfileNotice(locations = [], { manualConnected = false } = {}) {
  if (!noProfileNoticeContainer) return;
  const {
    getNoBusinessProfileNoticeState,
    dismissNoBusinessProfileNotice,
    clearNoBusinessProfileNotice,
  } = await getGoogleConnectModule();

  const noticeState = getNoBusinessProfileNoticeState?.();
  const hasConnectedProfile = manualConnected || (Array.isArray(locations) && locations.length > 0);

  if (hasConnectedProfile) {
    clearNoBusinessProfileNotice?.();
  }

  if (!noticeState || noticeState.dismissed || hasConnectedProfile) {
    noProfileNoticeContainer.innerHTML = "";
    noProfileNoticeContainer.style.display = "none";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "notice";
  wrapper.setAttribute("role", "status");
  wrapper.innerHTML = `
    <div>
      <p class="strong">Connected to Google — no Business Profile found</p>
      <p class="card-subtitle">
        Your Google account is connected to ReviewResq, but we couldn’t find a Google Business Profile (Google Maps listing) associated with this account.
      </p>
      <p class="card-subtitle">
        To see ratings and reviews here, please connect a Google account that owns/manages a Business Profile, or create/claim your business on Google Maps.
      </p>
      <div class="button-row">
        <a class="btn btn-link" href="https://www.google.com/business/" target="_blank" rel="noopener">Create or claim a Business Profile</a>
      </div>
    </div>
    <button class="btn btn-link" type="button" aria-label="Dismiss notice">×</button>
  `;

  const dismissBtn = wrapper.querySelector("button");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      dismissNoBusinessProfileNotice?.();
      noProfileNoticeContainer.innerHTML = "";
      noProfileNoticeContainer.style.display = "none";
    });
  }

  noProfileNoticeContainer.innerHTML = "";
  noProfileNoticeContainer.appendChild(wrapper);
  noProfileNoticeContainer.style.display = "block";
}

function renderUpsell(planId = "starter") {
  if (!upsellContainer) return;
  upsellContainer.innerHTML = "";
  const plan = normalizePlan(planId);
  const card = document.createElement("section");
  card.className = "card growth-upsell";
  if (plan === "starter") {
    card.innerHTML = `
      <p class="card-title">Respond to Google reviews with AI</p>
      <p class="card-subtitle">Keep your Starter plan for analytics, or upgrade to Growth to unlock AI-powered responses and automations directly from your dashboard.</p>
      <div class="growth-upsell__actions">
        <a class="btn btn-primary" href="billing.html">View plans</a>
        <a class="btn btn-link" href="billing.html">Learn more</a>
      </div>
    `;
  } else {
    card.innerHTML = `
      <p class="card-title">You’re on ${planLabel(plan)}</p>
      <p class="card-subtitle">AI replies to Google reviews are enabled for your account.</p>
    `;
  }
  upsellContainer.appendChild(card);
}

async function persistGoogleSelection(place) {
  if (!sessionState.user) {
    return {
      ok: false,
      reason: "NO_USER",
      message: "You need to be signed in to connect your Google profile.",
    };
  }
  const phoneMismatchMessage =
    "We can’t connect this Google profile because the phone number doesn’t match your business profile.";
  const defaultErrorMessage =
    "Unable to connect Google profile. Please ensure the phone number matches your business profile.";
  try {
    const { refetchProfileAfterConnect, connectPlaceWithConfirmation } =
      await getGoogleConnectModule();

    if (place?.__alreadyConnected) {
      sessionState.profile = await refetchProfileAfterConnect();
      showToast("Google profile connected.");
      loadGoogleData();
      return { ok: true, alreadyConnected: true };
    }

    const businessName = resolveConnectBusinessName(place);
    const response = await connectPlaceWithConfirmation(place, { businessName });
    if (!response?.ok) {
      return {
        ok: false,
        reason: response?.reason,
        message: response?.message ||
          (response?.reason === "PHONE_MISMATCH"
            ? phoneMismatchMessage
            : defaultErrorMessage),
      };
    }

    sessionState.profile = await refetchProfileAfterConnect();
    if (place?.place_id || place?.placeId) {
      storeActiveLocation(place.place_id || place.placeId);
    }
    showToast("Google profile connected.");
    loadGoogleData();
    return { ok: true };
  } catch (err) {
    const message =
      err?.reason === "PHONE_MISMATCH" || err?.code === "PHONE_MISMATCH"
        ? phoneMismatchMessage
        : err?.message || defaultErrorMessage;
    console.error("[google-reviews] failed to connect Google profile", message);
    return {
      ok: false,
      reason: err?.code || err?.reason || "ERROR",
      message,
    };
  }
}

async function persistManualGoogleLink(manualResponse = {}) {
  const result = await saveManualConnection(manualResponse);
  if (result?.ok) {
    showToast("Manual connection saved successfully.");
    sessionState.profile = augmentProfileWithManual(sessionState.profile);
    await loadGoogleData();
    return result;
  }
  const error = new Error(
    result?.error?.message ||
      manualResponse?.message ||
      "Unable to save manual connection. Please try again."
  );
  throw error;
}

async function renderConnectCard() {
  const { renderGoogleConnect } = await getGoogleConnectModule();
  toggleViews(false);
  renderGoogleConnect(connectContainer, {
    title: "Connect your Google Reviews",
    subtitle: "Securely connect businesses you own or manage on Google.",
    helperText: "Start typing your business name as it appears on Google.",
    defaultQuery: sessionState.profile?.businessName || "",
    onConnect: persistGoogleSelection,
    onManualConnect: persistManualGoogleLink,
    planId: normalizePlan(sessionState.subscription?.planId || "starter"),
  });
  applyManualValuesToForm();
  renderConnectStatus({
    manualConnected: Boolean(manualConnection),
    googleConnected: Boolean(sessionState.profile?.googlePlaceId),
  });
}

async function loadGoogleData() {
  const plan = normalizePlan(sessionState.subscription?.planId || "starter");
  const profileWithManual = augmentProfileWithManual(sessionState.profile);
  const locations = deriveConnectedLocations(profileWithManual || {});
  if (!activeLocationId) {
    activeLocationId = resolveStoredLocationId();
  }
  const selected =
    locations.find((loc) => loc.id === activeLocationId || loc.placeId === activeLocationId) ||
    locations[0] ||
    null;
  if (selected && selected.id !== activeLocationId) {
    storeActiveLocation(selected.id);
  }
  renderLocationSelector(locations, plan);
  const profileView = selected?.googleProfile
    ? { ...profileWithManual, googleProfile: selected.googleProfile, googlePlaceId: selected.placeId }
    : profileWithManual;

  const manualConnected = Boolean(
    profileView?.googleConnectionType === "manual" ||
      profileView?.googleProfile?.connectionType === "manual" ||
      profileView?.googleProfile?.manualConnected ||
      profileView?.googleManualConnection === true ||
      profileView?.googleReviewLink ||
      profileView?.googleManualLink ||
      selected?.verificationMethod === "phone"
  );
  const googleConnected = Boolean(profileView?.googlePlaceId || locations.length);
  const isConnected = Boolean(profileView?.googlePlaceId || manualConnected);
  renderConnectStatus({ manualConnected, googleConnected });
  await renderNoProfileNotice(locations, { manualConnected });
  toggleViews(isConnected);
  if (!isConnected) {
    await renderConnectCard();
    return;
  }
  const shouldSkipGoogleData = manualConnected && !profileView?.googlePlaceId;
  if (shouldSkipGoogleData) {
    renderProfile(profileView, {});
    if (ratingBadges.rating) {
      ratingBadges.rating.textContent = "Google rating unavailable";
    }
    if (ratingBadges.count) {
      ratingBadges.count.textContent = "Reviews unavailable";
    }
    if (reviewList) {
      reviewList.textContent =
        "Google reviews aren’t available for manual connections. Use your saved link to view reviews on Google.";
    }
    return;
  }
  const reviews = await fetchAllReviews(sessionState.user.uid);
  const googleReviews = reviews.filter((r) => r.source === "google").map(describeReview);
  const metrics = calculateMetrics(googleReviews);
  const breakdown = buildRatingBreakdown(googleReviews);
  renderProfile(profileView, metrics);
  renderRatingBreakdown(breakdown);
  renderReviews(googleReviews.slice(0, 10));
}

onSession(async ({ user, profile, subscription }) => {
  sessionState = { user, profile, subscription };
  if (!user) return;
  removeDebugBadges();
  const plan = normalizePlan(subscription?.planId || "starter");
  if (planBadge) {
    planBadge.textContent = planLabel(plan);
  }
  renderUpsell(plan);
  if (changeProfileBtn) {
    if (!changeListenerAttached) {
      changeProfileBtn.addEventListener("click", () => {
        renderConnectCard();
      });
      changeListenerAttached = true;
    }
  }
  await loadManualConnectionFromFirestore();
  await loadGoogleData();
});
