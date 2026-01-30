const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

// Set the SendGrid API key from Firebase environment variables
sgMail.setApiKey(functions.config().sendgrid.key);

exports.sendEmailOnInvite = functions.firestore
  .document("businesses/{businessId}/invites/{inviteId}")
  .onCreate(async (snap, context) => {
    const inviteData = snap.data();
    const { email, name } = inviteData;
    const { businessId, inviteId } = context.params;

    // Email content
    const msg = {
      to: email,
      from: "your_verified_sendgrid_email@example.com", // Replace with your verified sender
      subject: `A review request from ${name}`,
      html: `
        <p>Hello ${name},</p>
        <p>You have been invited to leave a review.</p>
        <p>Click the link below to get started:</p>
        <a href="https://your-app-url.com/review?inviteId=${inviteId}&businessId=${businessId}">Leave a Review</a>
      `,
    };

    try {
      await sgMail.send(msg);
      // Update the status to 'sent'
      return snap.ref.update({ status: "sent" });
    } catch (error) {
      console.error("Error sending email:", error);
      // Update the status to 'error'
      return snap.ref.update({ status: "error", error: error.message });
    }
  });
