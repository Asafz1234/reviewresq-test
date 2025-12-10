import { refreshProfile } from "./session-data.js";

const runtimeEnv = window.RUNTIME_ENV || {};
const toastId = "feedback-toast";
let placesPromise = null;

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

function loadGooglePlaces() {
  if (placesPromise) return placesPromise;
  placesPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }

    const apiKey = runtimeEnv.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      reject(new Error("Missing Google Maps API key"));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps Places"));
    document.head.appendChild(script);
  });
  return placesPromise;
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
  await loadGooglePlaces();
  return new Promise((resolve, reject) => {
    const service = new google.maps.places.PlacesService(document.createElement("div"));
    service.textSearch(
      {
        query,
        fields: [
          "place_id",
          "name",
          "formatted_address",
          "types",
          "rating",
          "user_ratings_total",
        ],
      },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(results)) {
          resolve(results);
        } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
        } else {
          reject(new Error(`Places search failed: ${status}`));
        }
      }
    );
  });
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
        <input id="google-business-input" class="input" type="text" placeholder="Business name" data-google-query value="${defaultQuery}" />
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
  const queryInput = container.querySelector("[data-google-query]");
  const resultsEl = container.querySelector("[data-google-results]");
  const messageEl = container.querySelector("[data-connect-message]");
  const skipBtn = container.querySelector("[data-connect-skip]");

  if (showSkip && skipBtn && typeof onSkip === "function") {
    skipBtn.addEventListener("click", () => onSkip());
  }

  async function handleSearch() {
    const query = (queryInput?.value || "").trim();
    if (!query) {
      messageEl.textContent = "Enter a business name to search.";
      messageEl.style.color = "var(--danger)";
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
        resultsEl.textContent = "No matching profiles found. Try a different name.";
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
      showToast("Unable to search Google. Check your API key and try again.", true);
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "Search";
    }
  }

  if (searchBtn) searchBtn.addEventListener("click", handleSearch);
  if (queryInput) {
    queryInput.addEventListener("keydown", (e) => {
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

