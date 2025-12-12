import { getCachedProfile, refreshProfile } from "./session-data.js";
import { functions, httpsCallable } from "./firebase-config.js";

const runtimeEnv = window.RUNTIME_ENV || {};
const toastId = "feedback-toast";
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

export { functionsBaseUrl };

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

function showConfirmationModal({
  title = "Confirm connection",
  message = "Are you sure?",
  confirmLabel = "Connect anyway",
  cancelLabel = "Cancel",
} = {}) {
  return new Promise((resolve) => {
    console.warn("Confirmation modal is disabled for production flow", {
      title,
      message,
      confirmLabel,
      cancelLabel,
    });
    resolve(false);
  });
}

const connectGoogleBusinessCallable = () =>
  httpsCallable(functions, "connectGoogleBusiness");
const connectGoogleBusinessByReviewLinkCallable = () =>
  httpsCallable(functions, "connectGoogleBusinessByReviewLink");
const connectGoogleManualLinkCallable = () =>
  httpsCallable(functions, "connectGoogleManualLink");

export async function connectPlaceOnBackend(
  place,
  { businessName } = {}
) {
  if (!place) {
    throw new Error("Missing place to connect");
  }

  const call = connectGoogleBusinessCallable();
  const placeId = place.place_id || place.placeId;
  const requestPayload = {
    placeId,
    businessName,
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
        err?.message ||
        message ||
        "The phone number on Google doesn’t match your profile.";
      showToast(mismatchMessage, true);
      throw err;
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
    "The phone number on Google doesn’t match the phone in your ReviewResQ profile. Please update your profile phone and try again.";
  return runWithPhoneMismatchConfirmation(executor, { message: confirmMessage });
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

async function connectManualLink(manualLink) {
  const call = connectGoogleManualLinkCallable();
  const response = await call({ manualLink });
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
        await onConnect(place);
        action.textContent = "Connected";
        document
          .querySelectorAll(".connect-result button.btn-primary")
          .forEach((btn) => {
            if (btn !== action) {
              btn.disabled = true;
            }
          });
      } catch (err) {
        console.error("[google-connect] failed to connect", err);
        action.disabled = false;
        action.textContent = originalText;
        showToast(
          err?.message || "Unable to connect Google profile. Please try again.",
          true
        );
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
    subtitle = "Link your Google Business Profile to see your live rating, distribution, and recent reviews here.",
    helperText = "Start typing your business name as it appears on Google.",
    onConnect = () => {},
    onSkip,
    showSkip = false,
    defaultQuery = "",
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
          <button class="btn btn-primary" type="button" data-google-search>Search</button>
        </div>
        <div class="connect-results" data-google-results></div>
        <p class="card-subtitle" data-connect-message></p>
      </div>
    </section>
  `;

  const searchBtn = container.querySelector("[data-google-search]");
  const nameInput = container.querySelector("#google-business-input") ||
    container.querySelector("[data-google-name]") ||
    container.querySelector("[data-google-query]");
  const stateInput = container.querySelector("#google-business-state") ||
    container.querySelector("[data-google-state]");
  const phoneInput = container.querySelector("#google-business-phone") ||
    container.querySelector("[data-google-phone]");
  const resultsEl = container.querySelector("[data-google-results]");
  const messageEl = container.querySelector("[data-connect-message]");
  const skipBtn = container.querySelector("[data-connect-skip]");

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
          <label class="strong">Google link</label>
          <input class="input" type="url" data-manual-input placeholder="https://www.google.com/maps/place/… or local/review?placeid=…" value="${defaultInput}" />
          <p class="card-subtitle">We’ll validate the link format and save it to your profile without requiring phone verification.</p>
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
    const statusEl = overlay.querySelector("[data-manual-status]");

    const setStatus = (text, isError = false) => {
      statusEl.textContent = text || "";
      statusEl.style.color = isError ? "var(--danger)" : "";
    };

    const finalizeManualConnect = async () => {
      const value = (reviewInput?.value || "").trim();
      if (!value) {
        setStatus("Paste your Google Maps business link or Google Reviews link.", true);
        return;
      }

      if (!isValidGoogleManualLink(value)) {
        setStatus("That doesn’t look like a Google business or reviews link.", true);
        return;
      }

      connectBtn.disabled = true;
      setStatus("Saving your manual connection…");
      try {
        const response = await connectManualLink(value);
        if (response?.ok) {
          setStatus("Connected manually.");
          if (typeof onSuccess === "function") {
            await onSuccess({ ...response, manualLink: value });
          }
          closeManualOverlay();
        } else {
          setStatus(response?.message || "Unable to save that link right now.", true);
        }
      } catch (err) {
        console.error("[google-connect] manual connect failed", err);
        setStatus(err?.message || "Unable to save that link right now.", true);
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

    const afterManualConnect = async () => {
      if (typeof onConnect === "function") {
        await onConnect({ __alreadyConnected: true });
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
          async () => {
            await afterManualConnect();
            showToast("Google profile connected.");
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
        const primaryCard = createResultCard(primary, async (selected) => {
          await onConnect(selected);
          messageEl.textContent = "Google profile connected!";
          messageEl.style.color = "var(--success)";
        });
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
          async (selected) => {
            await onConnect(selected);
            messageEl.textContent = "Google profile connected!";
            messageEl.style.color = "var(--success)";
          },
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
