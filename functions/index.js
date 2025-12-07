const functions = require("firebase-functions/v1");
const sgMail = require("@sendgrid/mail");

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
    } = req.body || {};

    // איחוד שדות
    const email = customerEmail || to;
    const portal = portalUrl || portalLink;

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
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("SendGrid error", err);
    return res.status(500).json({ error: "Failed to send email" });
  }
});
