const functions = require('firebase-functions');
const sgMail = require('@sendgrid/mail');

const sendgridApiKey = process.env.SENDGRID_API_KEY || functions.config().sendgrid?.key;

if (!sendgridApiKey) {
  console.warn('SENDGRID_API_KEY is not configured. Emails will fail.');
} else {
  sgMail.setApiKey(sendgridApiKey);
}

exports.sendReviewRequestEmail = functions.https.onCall(async (data) => {
  const { to, subject, text, html } = data || {};

  if (!to) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing "to" email address');
  }

  const msg = {
    to,
    from: 'no-reply@reviewresq.com',
    subject,
    text,
    html,
  };

  try {
    await sgMail.send(msg);
    return { success: true };
  } catch (err) {
    console.error('Error sending review request email', err);
    throw new functions.https.HttpsError('internal', 'Failed to send email');
  }
});
