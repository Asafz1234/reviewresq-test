const functions = require("firebase-functions");
const sgMail = require("@sendgrid/mail");

// Make sure SENDGRID_API_KEY is already set from environment/secrets
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.sendReviewRequestEmail = functions.https.onRequest(async (req, res) => {
  // --- CORS headers ---
  res.set("Access-Control-Allow-Origin", "https://reviewresq.com");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const { to, subject, text, html } = req.body || {};

    if (!to) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing "to" field' });
    }

    const msg = {
      to,
      from: "ReviewRescue <no-reply@reviewresq.com>",
      subject: subject || "Review Request",
      text: text || "Hi! Please leave us a review.",
      html: html || "<p>Hi! Please leave us a review.</p>",
    };

    console.log("Sending email via SendGrid to:", to);
    await sgMail.send(msg);
    console.log("Email sent successfully");

    // Always respond with JSON and CORS headers
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("sendReviewRequestEmail error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to send email" });
  }
});
