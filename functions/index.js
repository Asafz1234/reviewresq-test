const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();

exports.googlePlacesSearch = functions.https.onRequest(async (req, res) => {
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

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const getParam = (key) =>
    req.method === "GET" ? (req.query?.[key] || "") : (req.body?.[key] || "");

  const rawName = String(
    getParam("businessName") || getParam("query") || ""
  ).trim();
  const phoneRaw = String(
    getParam("phone") || getParam("phonenumber") || ""
  ).trim();
  const state = String(getParam("state") || "").trim();

  const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "");
  const normalizedPhone = normalizePhone(phoneRaw);

  if (!rawName || !phoneRaw) {
    return res.status(400).json({
      error: "Missing fields",
      details: "Both businessName and phone are required",
    });
  }

  const placesApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.PLACES_API_KEY ||
    functions.config().google?.places_api_key;

  if (!placesApiKey) {
    console.error("[googlePlacesSearch] missing Places API key");
    return res.status(500).json({ error: "Server configuration missing" });
  }

  const mapCandidate = (place = {}) => ({
    placeId: place.place_id,
    name: place.name,
    address: place.formatted_address,
    rating: place.rating || null,
    userRatingsTotal: place.user_ratings_total || 0,
    phoneNumber: place.formatted_phone_number || null,
    types: place.types || [],
  });

  const callFindPlace = async (input) => {
    const params = new URLSearchParams({
      input,
      inputtype: "textquery",
      fields:
        "place_id,name,formatted_address,rating,user_ratings_total,formatted_phone_number,types",
      region: "us",
      key: placesApiKey,
    });

    const url =
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
      params.toString();

    const response = await fetch(url);
    const data = await response.json();
    return { response, data, url };
  };

  try {
    const textQuery = `${rawName} ${normalizedPhone}`.trim();

    const { response, data, url } = await callFindPlace(textQuery);
    console.log("[googlePlacesSearch] lookup", {
      textQuery,
      url,
      httpStatus: response.status,
      status: data.status,
      candidateCount: data.candidates?.length || 0,
    });

    if (!response.ok) {
      console.error("[googlePlacesSearch] Places API HTTP error", response.status);
      return res.status(502).json({ error: "Places API error" });
    }

    if (data.status && !["OK", "ZERO_RESULTS"].includes(data.status)) {
      console.error("[googlePlacesSearch] Places API status error", data.status);
      return res.status(502).json({ error: data.status || "Places API error" });
    }

    const candidates = Array.isArray(data.candidates) ? data.candidates : [];

    const phoneMatches = candidates.filter((place) => {
      const placePhone = normalizePhone(
        place.national_phone_number ||
          place.international_phone_number ||
          place.formatted_phone_number ||
          ""
      );

      const last10 = normalizedPhone.slice(-10);
      return last10 && placePhone.endsWith(last10);
    });

    let finalMatches = phoneMatches;

    if (phoneMatches.length > 1 && state) {
      const stateUpper = state.toUpperCase();
      finalMatches = phoneMatches.filter((place) => {
        const address = (place.formatted_address || "").toUpperCase();
        return address.includes(stateUpper);
      });
    }

    if (finalMatches.length === 0) {
      return res.status(200).json({
        ok: false,
        code: "NO_MATCHES",
        message: "No matching business found",
      });
    }

    if (finalMatches.length > 1) {
      return res.status(200).json({
        ok: false,
        code: "MULTIPLE_MATCHES",
        message: "Multiple matching businesses found",
      });
    }

    const match = mapCandidate(finalMatches[0]);

    return res.json({ candidates: [match] });
  } catch (err) {
    console.error("[googlePlacesSearch] unexpected error", err);
    return res.status(502).json({ error: "Places API error" });
  }
});

exports.googlePlacesSearch2 = functions.https.onRequest(async (req, res) => {
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

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const getParam = (key) =>
    req.method === "GET" ? req.query?.[key] || "" : req.body?.[key] || "";

  const query = String(getParam("query") || "").trim();
  const phoneRaw = String(getParam("phone") || "").trim();

  if (!query && !phoneRaw) {
    return res.status(400).json({ error: "Missing query" });
  }

  const digits = phoneRaw.replace(/\D/g, "");
  const hasPhoneDigits = digits.length >= 7;

  const placesApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.PLACES_API_KEY ||
    functions.config().google?.places_api_key;

  if (!placesApiKey) {
    console.error("googlePlacesSearch missing Places API key");
    return res.status(500).json({ error: "Server configuration missing" });
  }

  try {
    if (hasPhoneDigits) {
      const phoneParams = new URLSearchParams({
        input: `+1${digits}`,
        inputtype: "phonenumber",
        fields:
          "place_id,name,formatted_address,formatted_phone_number,rating,user_ratings_total,types",
        key: placesApiKey,
      });

      const phoneUrl =
        "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
        phoneParams.toString();
      const phoneResponse = await fetch(phoneUrl);
      const phoneData = await phoneResponse.json();

      if (phoneResponse.ok && phoneData.status === "OK" && phoneData.candidates?.length) {
        const candidates = phoneData.candidates.map((place) => ({
          placeId: place.place_id,
          name: place.name,
          address: place.formatted_address,
          rating: place.rating,
          userRatingsTotal: place.user_ratings_total,
          phone: place.formatted_phone_number,
          types: place.types || [],
        }));

        return res.json({ candidates });
      }

      console.warn("Phone lookup failed, falling back to text query", phoneData);
    }

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const params = new URLSearchParams({
      input: query,
      inputtype: "textquery",
      fields: "place_id,name,formatted_address,rating,user_ratings_total,types",
      region: "us",
      key: placesApiKey,
    });

    const url =
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?" +
      params.toString();

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("Places API HTTP error", response.status, data);
      return res.status(502).json({ error: "Places API HTTP error" });
    }

    if (data.status && data.status !== "OK") {
      console.error("Places API status error", data.status, data);
      return res.status(502).json({ error: data.status || "Places API error" });
    }

    const candidates = Array.isArray(data.candidates)
      ? data.candidates.map((place) => ({
          placeId: place.place_id,
          name: place.name,
          address: place.formatted_address,
          rating: place.rating,
          userRatingsTotal: place.user_ratings_total,
          phone: place.formatted_phone_number,
          types: place.types || [],
        }))
      : [];

    return res.status(200).json({
      status: data.status || "OK",
      candidates,
    });
  } catch (err) {
    console.error("googlePlacesSearch failed", err);
    return res.status(500).json({ error: "Failed to search Places" });
  }
});

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
