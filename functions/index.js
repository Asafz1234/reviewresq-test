const functions = require('firebase-functions');
const sgMail = require('@sendgrid/mail');
const cors = require('cors')({ origin: true });

const sendgridApiKey = process.env.SENDGRID_API_KEY || functions.config().sendgrid?.key;

if (!sendgridApiKey) {
  console.warn('SENDGRID_API_KEY is not configured. Emails will fail.');
} else {
  sgMail.setApiKey(sendgridApiKey);
}

exports.sendReviewRequestEmail = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    const { customerName, customerEmail, customerPhone, portalLink } =
      req.body || {};

    if (!customerEmail || !customerName || !portalLink) {
      return res.status(400).json({
        error: 'Missing required fields for review request email',
      });
    }

    const phoneLine = customerPhone ? `<br>Phone: ${customerPhone}` : '';

    try {
      await sgMail.send({
        to: customerEmail,
        from: "no-reply@reviewresq.com",
        subject: "Share your experience",
        html: `
      Hi ${customerName},<br><br>
      Thanks for your feedback. Here's your link:<br>
      <a href="${portalLink}">${portalLink}</a><br>${phoneLine}<br>
      Best regards,<br>
      ReviewResQ
    `,
      });
      return res.json({ status: "ok" });
    } catch (error) {
      console.error("Email error:", error);
      return res.status(500).json({ error: 'Failed to send email' });
    }
  });
});
