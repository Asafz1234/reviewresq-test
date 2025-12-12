const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();


const normalizePhone = (raw = "") => (raw || "").replace(/[^\d]/g, "");

const normalizePhoneDigits = (raw = "") => {
  const digits = (raw.match(/\d+/g) || []).join("");
  if (!digits) return "";
  return digits.slice(-10);
};

const toE164US = (digits10 = "") =>
  digits10 && digits10.length === 10 ? `+1${digits10}` : "";

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

const resolvePlacesApiKey = () =>
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.PLACES_API_KEY ||
  functions.config().google?.places_api_key;

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

  const placesApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.PLACES_API_KEY ||
    functions.config().google?.places_api_key;

  if (!placesApiKey) {
    console.error(`[${label}] missing Places API key`);
    return res.status(500).json({ error: "Server configuration missing" });
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

    const placesApiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.PLACES_API_KEY ||
      functions.config().google?.places_api_key;

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
          const details = await fetchPlaceDetails(candidate?.place_id);
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
          const details = await fetchPlaceDetails(result?.place_id);
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

exports.connectGoogleBusiness = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required to connect Google Business."
    );
  }

  const placeId = data?.placeId || data?.place_id;
  const force = Boolean(data?.force);
  if (!placeId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "placeId is required to connect Google Business."
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
  const storedPhoneDigits = normalizePhoneDigits(
    profileData?.phone || profileData?.businessPhone || ""
  );
  const phoneMatches =
    storedPhoneDigits &&
    placePhoneDigits &&
    (placePhoneDigits.endsWith(storedPhoneDigits) ||
      storedPhoneDigits.endsWith(placePhoneDigits));

  if (storedPhoneDigits && placePhoneDigits && !phoneMatches && !force) {
    return {
      ok: false,
      reason: "PHONE_MISMATCH_CONFIRM_REQUIRED",
      message:
        "Phone does not match profile. Confirm to connect anyway.",
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
    connectionMethod: force && phoneMismatch ? "force_candidate_confirm" : "candidate",
    phoneMismatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

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
    const force = Boolean(data?.force);
    const placeId = extractPlaceIdFromReviewUrl(reviewUrl);

    if (!placeId) {
      return {
        ok: false,
        reason: "INVALID_REVIEW_URL",
        message: "Please provide a valid Google review link that includes placeid=",
      };
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

    const uid = context.auth.uid;
    const profileRef = db.collection("businessProfiles").doc(uid);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() : {};
    const storedPhoneDigits = normalizePhoneDigits(
      profileData?.phone || profileData?.businessPhone || ""
    );
    const placePhoneDigits = normalizePhoneDigits(
      details.international_phone_number || details.formatted_phone_number || ""
    );
    const phoneMatches =
      storedPhoneDigits &&
      placePhoneDigits &&
      (placePhoneDigits.endsWith(storedPhoneDigits) ||
        storedPhoneDigits.endsWith(placePhoneDigits));

    if (storedPhoneDigits && placePhoneDigits && !phoneMatches && !force) {
      return {
        ok: false,
        reason: "PHONE_MISMATCH_CONFIRM_REQUIRED",
        message:
          "Phone does not match profile. Confirm to connect anyway.",
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
      connectionMethod: "review_link",
      phoneMismatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (force && phoneMismatch) {
      payload.connectionMethod = "review_link_force";
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

const db = admin.firestore();
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
