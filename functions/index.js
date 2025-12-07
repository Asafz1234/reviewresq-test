const functions = require("firebase-functions");
const sgMail = require("@sendgrid/mail");

// Make sure SENDGRID_API_KEY is already set from environment/secrets
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.sendReviewRequestEmail = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const {
      to,
      subject,
      text,
      html,
      businessName,
      businessLogoUrl,
      portalUrl,
      customerName,
      textCustomerName,
    } = req.body || {};

    if (!to) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing "to" field' });
    }

    if (!portalUrl) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing "portalUrl" field' });
    }

    const safeBusinessName = businessName || "Your Business";
    const customerGreeting = textCustomerName || customerName || "";
    const emailSubject =
      subject || `How was your experience with ${safeBusinessName}?`;
    const emailText =
      text ||
      `Hi ${customerGreeting || "there"},\n\nThanks for choosing ${safeBusinessName}.\nWe’d really appreciate it if you could take a moment to share your experience.\n\nLeave a review here: ${portalUrl}\n\nThis link is unique to your review request from ${safeBusinessName}.`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; background:#f5f5f5; padding:24px;">
        <div style="max-width:520px; margin:0 auto; background:#ffffff; padding:24px; border-radius:12px;">
          ${businessLogoUrl ? `
            <div style="text-align:center; margin-bottom:16px;">
              <img src="${businessLogoUrl}" alt="${safeBusinessName} logo"
                   style="max-height:60px; max-width:180px; object-fit:contain;" />
            </div>` : ""}

          <h2 style="margin:0 0 12px; font-size:20px; color:#111827;">
            Hi ${customerGreeting || "there"},
          </h2>

          <p style="margin:0 0 12px; color:#4b5563; font-size:14px;">
            Thanks for choosing <strong>${safeBusinessName}</strong>.
          </p>

          <p style="margin:0 0 16px; color:#4b5563; font-size:14px;">
            We’d really appreciate it if you could take a moment to share your experience.
          </p>

          <div style="text-align:center; margin:24px 0;">
            <a href="${portalUrl}"
               style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none;
                      padding:12px 24px; border-radius:999px; font-weight:600; font-size:14px;">
              Click here to leave a review
            </a>
          </div>

          <p style="margin:0; color:#9ca3af; font-size:12px; line-height:1.5;">
            This link is unique to your review request from ${safeBusinessName}.
          </p>
        </div>
      </div>
    `;

    const msg = {
      to,
      from: "ReviewRescue <no-reply@reviewresq.com>",
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    };

    console.log("Sending email via SendGrid to:", to);
    await sgMail.send(msg);
    console.log("Email sent successfully");

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("sendReviewRequestEmail error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to send email" });
  }
});
