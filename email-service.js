const SEND_REVIEW_REQUEST_URL =
  "https://us-central1-reviewresq-app.cloudfunctions.net/sendReviewRequestEmail";

export async function sendReviewRequestEmail({
  customerName,
  customerEmail,
  customerPhone,
  portalLink,
  businessName,
  businessLogoUrl,
  portalUrl,
}) {
  const resolvedPortalUrl = portalUrl || portalLink;

  if (!resolvedPortalUrl) {
    throw new Error("A portalUrl is required to send a review request email");
  }

  const response = await fetch(SEND_REVIEW_REQUEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerName,
      customerEmail,
      customerPhone,
      portalLink: resolvedPortalUrl,
      businessName,
      businessLogoUrl,
      portalUrl: resolvedPortalUrl,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("Failed to send review request email", errorText);
    throw new Error("Failed to send review request email");
  }

  return response.json();
}
