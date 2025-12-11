import { getCachedProfile, refreshProfile } from "./session-data.js";

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

  // Remove duplicates while preserving order
  const uniqueParts = locationParts.filter((part, index) => locationParts.indexOf(part) === index);
  return uniqueParts.join(" ").trim();
}

function buildPlacesQuery(name = "", phone = "", state = "") {
  const trimmedName = (name || "").trim();
  const trimmedPhone = (phone || "").trim();
  const trimmedState = (state || "").trim();

  if (!trimmedName || !trimmedPhone || !trimmedState) return "";

  const params = new URLSearchParams({
    businessName: trimmedName,
    phone: trimmedPhone,
    state: trimmedState,
  });

  return params.toString();
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

function extractShortAddress(place = {}) {
  if (place.formatted_address) return place.formatted_address;
  if (Array.isArray(place.terms)) {
    const parts = place.terms.map((t) => t.value).filter(Boolean);
    return parts.join(", ");
  }
  return "Address unavailable";
}

function createResultCard(place, onConnect) {
  const item = document.createElement("div");
  item.className = "connect-result";
  item.innerHTML = `
    <div class="connect-result__body">
      <p class="strong">${place.name || "Unnamed place"}</p>
      <p class="card-subtitle">
        ${place.types?.[0] || "Business"} · ${extractShortAddress(place)}
      </p>
      <p class="card-subtitle">
        ${place.rating ? `${place.rating.toFixed(1)} stars` : "No rating yet"}
        ${place.user_ratings_total ? ` · ${place.user_ratings_total} reviews` : ""}
      </p>
    </div>
  `;

  const action = document.createElement("button");
  action.className = "btn btn-primary";
  action.textContent = "Connect";
  action.addEventListener("click", async () => {
    try {
      action.disabled = true;
      action.textContent = "Connecting…";
      await onConnect(place, action);
    } catch (err) {
      console.error("[google-connect] failed to connect", err);
      showToast("Unable to connect Google profile. Please try again.", true);
    } finally {
      action.disabled = false;
      action.textContent = "Connect";
    }
  });
  item.appendChild(action);
  return item;
}

async function searchPlaces(query) {
  const url = `${placesProxyUrl}?${query}`;

  const response = await fetch(url);

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    console.error("[google-connect] failed to parse Places response", parseErr);
    throw new Error("Unable to read response from Places search");
  }

  if (!response.ok || data?.error) {
    const apiMessage = data?.error;
    const message = apiMessage
      ? `Places search failed: ${apiMessage}`
      : `Places search HTTP error ${response.status}`;
    throw new Error(message);
  }

  const candidates = data?.candidates || [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.debug("[google-connect] query", query);
    console.debug("[google-connect] candidates", []);
    return [];
  }

  const mapped = candidates.map((place) => ({
    place_id: place.placeId,
    name: place.name,
    formatted_address: place.address,
    rating: place.rating,
    user_ratings_total: place.userRatingsTotal,
    types: place.types,
  }));
  console.debug("[google-connect] query", query);
  console.debug("[google-connect] candidates", mapped);
  return mapped;
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
        <label class="strong" for="google-state-input">State / Province</label>
        <input
          id="google-state-input"
          class="input"
          type="text"
          placeholder="State (e.g. FL)"
          data-google-state
        />
        <label class="strong" for="google-phone-input">Phone number</label>
        <input
          id="google-phone-input"
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
  const nameInput =
    container.querySelector("[data-google-name]") || container.querySelector("[data-google-query]");
  const phoneInput = container.querySelector("[data-google-phone]");
  const stateInput = container.querySelector("[data-google-state]");
  const resultsEl = container.querySelector("[data-google-results]");
  const messageEl = container.querySelector("[data-connect-message]");
  const skipBtn = container.querySelector("[data-connect-skip]");

  if (showSkip && skipBtn && typeof onSkip === "function") {
    skipBtn.addEventListener("click", () => onSkip());
  }

  async function handleSearch() {
    const name = (nameInput?.value || "").trim();
    const phoneRaw = (phoneInput?.value || "").trim();
    const state = (stateInput?.value || "").trim();

    // Basic validation
    if (!name || !state || !phoneRaw) {
      messageEl.textContent =
        "Please fill in business name, state, and phone number before searching.";
      messageEl.style.color = "var(--danger)";
      resultsEl.innerHTML = "";
      return;
    }

    const phone = phoneRaw.replace(/[^\d+]/g, "");
    const query = buildPlacesQuery(name, phone, state);
    if (!query) {
      messageEl.textContent = "All fields are required to search on Google.";
      messageEl.style.color = "var(--danger)";
      resultsEl.innerHTML = "";
      return;
    }
    messageEl.textContent = "";
    resultsEl.innerHTML = "Searching Google…";
    resultsEl.classList.add("connect-results--loading");
    searchBtn.disabled = true;
    searchBtn.textContent = "Searching…";

    try {
      const matches = await searchPlaces(query);
      resultsEl.classList.remove("connect-results--loading");
      resultsEl.innerHTML = "";
      if (!matches.length) {
        resultsEl.textContent = "No matches found on Google. Try a different name.";
        return;
      }
      matches.slice(0, 5).forEach((place) => {
        const row = createResultCard(place, async (selected) => {
          await onConnect(selected);
          messageEl.textContent = "Google profile connected!";
          messageEl.style.color = "var(--success)";
        });
        resultsEl.appendChild(row);
      });
    } catch (err) {
      console.error("[google-connect] search failed", err);
      resultsEl.classList.remove("connect-results--loading");
      resultsEl.textContent = "Unable to search right now. Please try again.";
      const message = err?.message || "Unable to search Google right now.";
      showToast(message, true);
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "Search";
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

