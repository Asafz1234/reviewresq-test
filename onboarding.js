// onboarding.js
// Business Setup + auto Google Review link finder

// ----- DOM ELEMENTS -----
const businessNameInput = document.getElementById("businessName");
const googleReviewInput = document.getElementById("googleReviewLink");
const autoFindBtn = document.getElementById("autoFindBtn");

// ----- HELPERS -----
function setAutoBtnLoading(isLoading) {
  if (!autoFindBtn) return;
  autoFindBtn.disabled = isLoading;
  autoFindBtn.textContent = isLoading
    ? "Searching…"
    : "Find Google Review Link Automatically";
}

let placesService = null;

function ensurePlacesService() {
  // משתמשים ב-div "דמי" כדי ליצור שירות Places בלי מפה על המסך
  if (placesService || !window.google || !google.maps || !google.maps.places) {
    return;
  }
  const dummy = document.createElement("div");
  placesService = new google.maps.places.PlacesService(dummy);
}

function findReviewLink() {
  const name = (businessNameInput?.value || "").trim();

  if (!name) {
    alert("Please enter your business name first.");
    return;
  }

  ensurePlacesService();

  if (!placesService) {
    alert("Google Places is not ready yet. Try again in a second.");
    return;
  }

  setAutoBtnLoading(true);

  const request = {
    query: name,
    fields: ["place_id", "name", "formatted_address"],
  };

  placesService.findPlaceFromQuery(request, (results, status) => {
    setAutoBtnLoading(false);

    if (
      status !== google.maps.places.PlacesServiceStatus.OK ||
      !results ||
      !results.length
    ) {
      alert(
        'Could not find a Google listing for that name. Try adding the city, e.g. "Best Pizza Miami".'
      );
      return;
    }

    const place = results[0];
    const placeId = place.place_id;

    if (!placeId) {
      alert("Found a result but it is missing a place_id.");
      return;
    }

    // קישור ישיר למסך כתיבת ביקורת
    const reviewUrl =
      "https://search.google.com/local/writereview?placeid=" +
      encodeURIComponent(placeId);

    if (googleReviewInput) {
      googleReviewInput.value = reviewUrl;
    }

    alert(
      "Found your Google review link and filled it in automatically. Please double-check it and then click Save and Continue."
    );
  });
}

// ----- EVENT BINDING -----
if (autoFindBtn) {
  autoFindBtn.addEventListener("click", (event) => {
    event.preventDefault();
    findReviewLink();
  });
}
