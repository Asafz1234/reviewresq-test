
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const sgMail = require("@sendgrid/mail");

admin.initializeApp();

// Set the SendGrid API key from Firebase environment variables
sgMail.setApiKey(functions.config().sendgrid.key);

// Send email on invite
exports.sendEmailOnInvite = functions.firestore
  .document("businesses/{businessId}/invites/{inviteId}")
  .onCreate(async (snap, context) => {
    const inviteData = snap.data();
    const { email, name } = inviteData;
    const { businessId, inviteId } = context.params;
    const funnelUrl = "https://reviewresq.com/?businessId=" + businessId + "&inviteId=" + inviteId;

    // Email content
    const msg = {
      to: email,
      from: "support@reviewresq.com",
      subject: `A review request from ${name}`,
      html: `
        <p>Hello ${name},</p>
        <p>You have been invited to leave a review.</p>
        <p>Click the link below to get started:</p>
        <a href="${funnelUrl}" style="background-color: #4CAF50; color: white; padding: 14px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 4px;">Leave a Review</a>
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

exports.searchBusiness = functions.https.onCall(async (data, context) => {
    const query = data.query;
    const apiKey = functions.config().google.places_key;
    
    if (!query) return { error: "Missing query" };
    if (!apiKey) return { error: "Missing API Key configuration" };

    try {
        const fetch = require("node-fetch");
        const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
        const response = await fetch(url);
        const json = await response.json();
        return json;
    } catch (error) {
        return { error: "Internal Error", details: error.message };
    }
});
