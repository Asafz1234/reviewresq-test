const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();

const normalizePhone = (phone = "") => {
  const digits = String(phone || "").replace(/\D/g, "");

  // If we have 11 digits starting with "1", drop the country code for comparison
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits;
};

const normalizeName = (name = "") =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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

const mapCandidate = (details, textResult) => ({
  placeId: details.place_id || textResult.place_id,
  name: details.name || textResult.name || null,
  address: details.formatted_address || textResult.formatted_address || null,
  phoneNumber:
    details.formatted_phone_number ||
    details.international_phone_number ||
    textResult.formatted_phone_number ||
    null,
  rating: details.rating ?? textResult.rating ?? null,
  userRatingsTotal: details.user_ratings_total ?? textResult.user_ratings_total ?? 0,
  googleMapsUrl: details.url || null,
  rawTextSearchResult: textResult,
});

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

  const businessName = String(
    getParam("businessName") || getParam("query") || ""
  ).trim();
  const state = String(getParam("state") || "").trim();
  const phoneNumber = String(
    getParam("phoneNumber") || getParam("phonenumber") || getParam("phone") || ""
  ).trim();

  if (!businessName) {
    return res.status(400).json({ error: "Missing businessName" });
  }

  const placesApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.PLACES_API_KEY ||
    functions.config().google?.places_api_key;

  if (!placesApiKey) {
    console.error(`[${label}] missing Places API key`);
    return res.status(500).json({ error: "Server configuration missing" });
  }

  const normalizedPhone = normalizePhone(phoneNumber);
  const searchQuery = `${businessName}${state ? `, ${state}` : ""}`.trim();

  try {
    console.log(`[${label}] text search query`, searchQuery);

    const textUrl = new URL(
      "https://maps.googleapis.com/maps/api/place/textsearch/json"
    );
    textUrl.searchParams.set("key", placesApiKey);
    textUrl.searchParams.set("query", `${searchQuery} USA`.trim());
    textUrl.searchParams.set("region", "us");

    const textResponse = await fetch(textUrl);

    if (!textResponse.ok) {
      console.error(`[${label}] Text Search HTTP error`, textResponse.status);
      return res.status(500).json({ error: "Places Text Search failed" });
    }

    const textData = await textResponse.json();
    const textResults = Array.isArray(textData.results) ? textData.results : [];

    console.log(`[${label}] text search results`, {
      query: searchQuery,
      resultCount: textResults.length,
    });

    if (!textResults.length) {
      return res.status(200).json({
        ok: false,
        status: "NO_RESULTS",
        message:
          "No Google Business matches were found for this name / state / phone.",
      });
    }

    const resultsToInspect = textResults.slice(0, 10);
    const candidates = [];

    for (const textResult of resultsToInspect) {
      const placeId = textResult.place_id;

      if (!placeId) {
        continue;
      }

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
          "rating",
          "user_ratings_total",
          "url",
        ].join(",")
      );

      const detailsResponse = await fetch(detailsUrl);

      if (!detailsResponse.ok) {
        console.error(`[${label}] Place Details HTTP error`, detailsResponse.status);
        continue;
      }

      const detailsData = await detailsResponse.json();
      const details = detailsData.result;

      if (!details) {
        continue;
      }

      const candidate = mapCandidate(details, textResult);
      const candidatePhones = [
        details.formatted_phone_number,
        details.international_phone_number,
      ]
        .map((phone) => normalizePhone(phone))
        .filter(Boolean);

      const normalizedUserSuffix = normalizedPhone
        ? normalizedPhone.slice(-Math.max(7, Math.min(10, normalizedPhone.length)))
        : "";

      const phoneMatched =
        normalizedUserSuffix.length >= 7 &&
        candidatePhones.some((phone) => phone.endsWith(normalizedUserSuffix));

      const normalizedUserName = normalizeName(businessName);
      const normalizedCandidateName = normalizeName(candidate.name);

      let nameMatchType = "none";
      if (normalizedUserName && normalizedCandidateName) {
        if (normalizedUserName === normalizedCandidateName) {
          nameMatchType = "exact";
        } else if (
          normalizedUserName.includes(normalizedCandidateName) ||
          normalizedCandidateName.includes(normalizedUserName)
        ) {
          nameMatchType = "contains";
        }
      }

      console.log(`[${label}] candidate comparison`, {
        placeId: candidate.placeId,
        name: candidate.name,
        normalizedCandidatePhones: candidatePhones,
        normalizedUserPhone: normalizedPhone,
        normalizedUserSuffix,
        phoneMatched,
        nameMatchType,
      });

      candidates.push({
        ...candidate,
        phoneMatched,
        nameMatchType,
      });
    }

    const phoneMatchedCandidates = candidates.filter((c) => c.phoneMatched);
    const nameMatches = candidates.filter((c) => c.nameMatchType !== "none");

    console.log(`[${label}] candidate summary`, {
      totalCandidates: candidates.length,
      phoneMatchedCount: phoneMatchedCandidates.length,
      nameMatchedCount: nameMatches.length,
    });

    // Prefer exact phone matches; if none, allow candidates list for manual selection
    if (phoneMatchedCandidates.length) {
      const scored = phoneMatchedCandidates.map((candidate) => ({
        candidate,
        nameScore:
          candidate.nameMatchType === "exact"
            ? 2
            : candidate.nameMatchType === "contains"
            ? 1
            : 0,
      }));

      scored.sort((a, b) => {
        if (b.nameScore !== a.nameScore) return b.nameScore - a.nameScore;
        return (b.candidate.userRatingsTotal || 0) - (a.candidate.userRatingsTotal || 0);
      });

      const best = scored[0].candidate;

      console.log(`[${label}] returning branch`, {
        branch: "EXACT_MATCH",
        placeId: best.placeId,
      });

      return res.status(200).json({
        ok: true,
        status: "EXACT_MATCH",
        placeId: best.placeId,
        name: best.name,
        address: best.address,
        phoneNumber: best.phoneNumber,
        rating: best.rating,
        userRatingsTotal: best.userRatingsTotal,
        googleMapsUrl: best.googleMapsUrl,
        rawTextSearchResult: best.rawTextSearchResult,
      });
    }

    const fallbackFromTextSearch = textResults.slice(0, 10).map((textResult) => ({
      placeId: textResult.place_id,
      name: textResult.name,
      address: textResult.formatted_address || null,
      phoneNumber: textResult.formatted_phone_number || null,
      rating: textResult.rating ?? null,
      userRatingsTotal: textResult.user_ratings_total ?? 0,
      googleMapsUrl: textResult.url || null,
    }));

    const candidatesForSelection =
      nameMatches.length || candidates.length
        ? nameMatches.length
          ? nameMatches
          : candidates
        : fallbackFromTextSearch;

    console.log(`[${label}] returning branch`, {
      branch: candidatesForSelection.length ? "CANDIDATES" : "NO_RESULTS",
    });

    if (candidatesForSelection.length) {
      return res.status(200).json({
        ok: true,
        status: "CANDIDATES",
        candidates: candidatesForSelection.map((candidate) => ({
          placeId: candidate.placeId,
          name: candidate.name,
          address: candidate.address,
          phoneNumber: candidate.phoneNumber,
          rating: candidate.rating,
          userRatingsTotal: candidate.userRatingsTotal,
          googleMapsUrl: candidate.googleMapsUrl,
        })),
      });
    }

    // This should only occur if text search also returned no results (handled earlier)
    return res.status(200).json({
      ok: false,
      status: "NO_RESULTS",
      message:
        "No Google Business matches were found for this name / state / phone.",
    });
  } catch (err) {
    console.error(`[${label}] unexpected error`, err);
    return res.status(500).json({ error: "Places API error" });
  }
};

exports.googlePlacesSearch = functions.https.onRequest((req, res) =>
  searchGooglePlacesWithValidation(req, res, { label: "googlePlacesSearch" })
);

exports.googlePlacesSearch2 = functions.https.onRequest((req, res) =>
  searchGooglePlacesWithValidation(req, res, { label: "googlePlacesSearch2" })
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
