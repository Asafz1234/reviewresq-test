const functions = require('firebase-functions');
const sgMail = require('@sendgrid/mail');

const sendgridApiKey = process.env.SENDGRID_API_KEY || functions.config().sendgrid?.key;

if (!sendgridApiKey) {
  console.warn('SENDGRID_API_KEY is not configured. Emails will fail.');
} else {
  sgMail.setApiKey(sendgridApiKey);
}

exports.sendReviewRequestEmail = functions.https.onCall(async (data, context) => {
  const { customerName, customerEmail, customerPhone, portalLink } = data || {};

  if (!customerEmail || !customerName || !portalLink) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required fields for review request email'
    );
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
    return { status: "ok" };
  } catch (error) {
    console.error("Email error:", error);
    throw new functions.https.HttpsError('internal', 'Failed to send email');
  }
});
