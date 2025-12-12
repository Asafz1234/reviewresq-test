import { getCachedProfile, refreshProfile } from "./session-data.js";
import { functions, httpsCallable } from "./firebase-config.js";

const runtimeEnv = window.RUNTIME_ENV || {};
const toastId = "feedback-toast";
const placesProxyUrl =
  (runtimeEnv && runtimeEnv.GOOGLE_PLACES_PROXY_URL) ||
  "https://us-central1-reviewresq-app.cloudfunctions.net/googlePlacesSearch";

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
    const existingStyle = document.getElementById("confirm-modal-style");
    if (!existingStyle) {
      const style = document.createElement("style");
      style.id = "confirm-modal-style";
      style.textContent = `
        .confirm-modal__overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .confirm-modal { background: #fff; padding: 20px; border-radius: 8px; max-width: 420px; width: calc(100% - 32px); box-shadow: 0 10px 40px rgba(0,0,0,0.15); }
        .confirm-modal__title { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
        .confirm-modal__message { margin: 0 0 16px; color: #333; }
        .confirm-modal__actions { display: flex; justify-content: flex-end; gap: 12px; }
        .confirm-modal__actions .btn-secondary { background: #e5e7eb; color: #111827; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; }
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement("div");
    overlay.className = "confirm-modal__overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    overlay.innerHTML = `
      <div class="confirm-modal">
        <p class="confirm-modal__title">${title}</p>
        <p class="confirm-modal__message">${message}</p>
        <div class="confirm-modal__actions">
          <button type="button" class="btn-secondary" data-confirm-cancel>${cancelLabel}</button>
          <button type="button" class="btn btn-primary" data-confirm-accept>${confirmLabel}</button>
        </div>
      </div>
    `;

    const cleanup = (result) => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });

    overlay
      .querySelector("[data-confirm-cancel]")
      ?.addEventListener("click", () => cleanup(false));
    overlay
      .querySelector("[data-confirm-accept]")
      ?.addEventListener("click", () => cleanup(true));

    document.body.appendChild(overlay);
  });
}

const connectGoogleBusinessCallable = () =>
  httpsCallable(functions, "connectGoogleBusiness");
const connectGoogleBusinessByReviewLinkCallable = () =>
  httpsCallable(functions, "connectGoogleBusinessByReviewLink");

export async function connectPlaceOnBackend(
  place,
  { businessName, forceConnect = false } = {}
) {
  if (!place) {
    throw new Error("Missing place to connect");
  }

  const call = connectGoogleBusinessCallable();
  const placeId = place.place_id || place.placeId;
  const response = await call({
    placeId,
    businessName,
    force: forceConnect,
    forceConnect,
  });
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

async function connectByReviewLink(reviewUrl, { force = false } = {}) {
  const call = connectGoogleBusinessByReviewLinkCallable();
  const response = await call({ reviewUrl, force });
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

async function runWithPhoneMismatchConfirmation(executor, { message }) {
  try {
    return await executor(false);
  } catch (err) {
    if (
      err?.code === "PHONE_MISMATCH" ||
      err?.code === "PHONE_MISMATCH_CONFIRM_REQUIRED"
    ) {
      const confirmed = await showConfirmationModal({
        title: "Connect despite phone mismatch?",
        message:
          message ||
          err?.message ||
          "The phone number does not match your profile. Connect anyway?",
        confirmLabel: "Connect anyway",
        cancelLabel: "Cancel",
      });
      if (!confirmed) throw err;
      return executor(true);
    }
    throw err;
  }
}

export function connectPlaceWithConfirmation(place, { businessName } = {}) {
  if (place?.__alreadyConnected) {
    return Promise.resolve({ ok: true, alreadyConnected: true });
  }
  const executor = (force = false) =>
    connectPlaceOnBackend(place, { businessName, forceConnect: force });
  const confirmMessage =
    "The Google listing phone does not match your profile. Connect anyway?";
  return runWithPhoneMismatchConfirmation(executor, { message: confirmMessage });
}

export function connectReviewLinkWithConfirmation(reviewUrl) {
  const executor = (force = false) => connectByReviewLink(reviewUrl, { force });
  const confirmMessage =
    "The Google listing phone does not match your profile. Connect anyway?";
  return runWithPhoneMismatchConfirmation(executor, { message: confirmMessage });
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

    try {
      const data = await searchPlaces(name, state, phone);
      resultsEl.classList.remove("connect-results--loading");
      resultsEl.innerHTML = "";

      const afterManualConnect = async (result) => {
        if (typeof onConnect === "function") {
          await onConnect({
            place_id: result?.placeId,
            name: result?.googleProfile?.name,
            formatted_address: result?.googleProfile?.formatted_address,
            googleReviewUrl: result?.googleReviewUrl,
            __alreadyConnected: true,
          });
        }
        messageEl.textContent = "Google profile connected!";
        messageEl.style.color = "var(--success)";
      };

      const renderManualCta = (onSuccess) => {
        const cta = document.createElement("div");
        cta.className = "connect-results__cta";
        cta.innerHTML = `
          <p class="card-subtitle">Don’t see your business here?</p>
          <button class="btn btn-link" type="button">Use manual Google review link</button>
        `;
        const btn = cta.querySelector("button");
        if (btn) {
          btn.addEventListener("click", async () => {
            const reviewUrl = window.prompt(
              "Paste your Google review link (contains placeid=)",
              ""
            );
            if (!reviewUrl) return;
            try {
              const result = await connectReviewLinkWithConfirmation(reviewUrl);
              await onSuccess(result);
              showToast("Google profile connected.");
            } catch (err) {
              console.error("[google-connect] manual review link failed", err);
              showToast(
                err?.message ||
                  "Unable to connect with that review link. Please try again.",
                true
              );
            }
          });
        }
        resultsEl.appendChild(cta);
      };

      if (!data?.candidates?.length && !data?.match) {
        resultsEl.textContent =
          data?.message ||
          "We couldn’t find your business on Google based on this name and phone number.";
        renderManualCta(afterManualConnect);
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
          "We found similar businesses, but none of them used the same phone number you entered.";
        messageEl.style.color = "var(--danger)";
      }

      if (data?.reason === "NO_PHONE_MATCH") {
        messageEl.textContent =
          data?.message ||
          "We found similar businesses, but none of them used the same phone number you entered.";
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

      if (data?.reason === "NO_EXACT_MATCH" || data?.reason === "NO_PHONE_MATCH") {
        renderManualCta(afterManualConnect);
      }
    } catch (err) {
      console.error("[google-connect] search failed", err);
      resultsEl.classList.remove("connect-results--loading");

      if (err && (err.code === "NO_MATCHES" || err.code === "NO_RESULTS")) {
        resultsEl.textContent =
          "No matches found on Google. Please check your business name and phone number.";
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
