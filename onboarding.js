import {
  db,
  doc,
  setDoc,
  serverTimestamp
} from "./firebase.js";

const googleApiKey = "YOUR_GOOGLE_API_KEY"; // תחליף פעם אחת – וזהו.

const businessNameInput = document.getElementById("businessNameInput");
const googleReviewUrlInput = document.getElementById("googleReviewUrlInput");

const findBusinessBtn = document.getElementById("findBusinessBtn");
const saveBtn = document.getElementById("saveBtn");

const loadingEl = document.getElementById("loading");
const resultsWrapper = document.getElementById("resultsWrapper");
const resultsList = document.getElementById("resultsList");
const saveStatus = document.getElementById("saveStatus");

let selectedPlaceId = null;

/* ---------------------------------------------------
   1. חיפוש אוטומטי ב-Google Places API
--------------------------------------------------- */
findBusinessBtn.addEventListener("click", async () => {

  const query = businessNameInput.value.trim();
  if (!query) {
    alert("Please enter a business name");
    return;
  }

  loadingEl.style.display = "block";
  resultsWrapper.style.display = "none";
  resultsList.innerHTML = "";

  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(
    query
  )}&inputtype=textquery&fields=place_id,name,formatted_address&key=${googleApiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    loadingEl.style.display = "none";

    if (!data.candidates || data.candidates.length === 0) {
      alert("No matching business was found. Try adding city or address.");
      return;
    }

    resultsWrapper.style.display = "block";

    // Make selectable list
    data.candidates.forEach((biz) => {
      const div = document.createElement("div");
      div.className = "result-item";
      div.innerHTML = `<strong>${biz.name}</strong><br><small>${biz.formatted_address}</small>`;
      div.onclick = () => selectBusiness(biz);
      resultsList.appendChild(div);
    });

  } catch (err) {
    console.error(err);
    alert("Failed to search Google.");
  }
});

/* ---------------------------------------------------
   2. בחירת עסק → יצירת Google Review Link
--------------------------------------------------- */
function selectBusiness(biz) {
  selectedPlaceId = biz.place_id;

  const reviewUrl =
    "https://search.google.com/local/writereview?placeid=" + selectedPlaceId;

  googleReviewUrlInput.value = reviewUrl;

  resultsWrapper.style.display = "none";

  alert("Business selected! Review link added automatically.");
}

/* ---------------------------------------------------
   3. שמירת העסק ל-Firestore
--------------------------------------------------- */
saveBtn.addEventListener("click", async () => {
  const businessName = businessNameInput.value.trim();
  const googleReviewUrl = googleReviewUrlInput.value.trim();

  if (!businessName) {
    alert("Business name is required.");
    return;
  }

  if (!googleReviewUrl) {
    alert("Google Review URL is required.");
    return;
  }

  saveStatus.textContent = "Saving…";

  const businessId = crypto.randomUUID();

  try {
    await setDoc(doc(db, "businessProfiles", businessId), {
      businessId,
      businessName,
      googleReviewUrl,
      createdAt: serverTimestamp(),
    });

    saveStatus.textContent = "Saved successfully!";
  } catch (err) {
    console.error(err);
    saveStatus.textContent = "Error while saving.";
  }
});
