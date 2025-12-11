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

function extractShortAddress(place = {}) {
  if (place.formatted_address) return place.formatted_address;
  if (place.address) return place.address;
  return "Address unavailable";
}

function createResultCard(place, onConnect) {
  const totalRatings = place.user_ratings_total ?? place.userRatingsTotal;
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
        ${totalRatings ? ` · ${totalRatings} reviews` : ""}
      </p>
    </div>
  `;

  const action = document.createElement("button");
  action.className = "btn btn-primary";
  action.textContent = "Connect";
  action.addEventListener("click", async () => {
    const originalText = action.textContent;
    action.disabled = true;
    action.textContent = "Connecting…";
    try {
      await onConnect(place);
      action.textContent = "Connected";
    } catch (err) {
      console.error("[google-connect] failed to connect", err);
      action.disabled = false;
      action.textContent = originalText;
      showToast("Unable to connect Google profile. Please try again.", true);
    }
  });
  item.appendChild(action);
  return item;
}

async function searchPlaces(name, state, phone) {
  const response = await fetch(placesProxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: name.trim(),
      state: state.trim(),
      phonenumber: phone.trim(),
    }),
  });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error("[google-connect] failed to parse Places response", err);
    throw new Error("Unable to read response from Places search");
  }

  if (data && data.error) {
    throw new Error(data.error || "Places search failed");
  }

  if (data && Array.isArray(data.candidates)) {
    return data.candidates.slice(0, 5);
  }

  return [];
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

    if (!name.trim() && !phone.trim()) {
      messageEl.textContent = "Enter a business name or phone number, then try again.";
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
      const matches = await searchPlaces(name, state, phone);
      resultsEl.classList.remove("connect-results--loading");
      resultsEl.innerHTML = "";

      if (!matches.length) {
        resultsEl.textContent =
          "No matches found on Google. Check the name, state, and phone number.";
        return;
      }

      matches.forEach((place) => {
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
      showToast("Unable to search right now. Please try again.", true);
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
