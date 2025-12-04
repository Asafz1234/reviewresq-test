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
    // ✅ תגובה לבקשות OPTIONS (בדיקת הרשאות)
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).send('');
    }

    // ✅ נוודא שגם התגובה עצמה כוללת את הכותרות האלו
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    const { customerName, customerEmail, customerPhone, portalLink } = req.body || {};

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
          Thanks for your feedback!<br>
          Please share your experience here:<br>
          <a href="${portalLink}">${portalLink}</a><br>${phoneLine}<br>
          Best regards,<br>
          ReviewResQ Team
        `,
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Email error:", error);
      return res.status(500).json({ error: 'Failed to send email' });
    }
  });
});
