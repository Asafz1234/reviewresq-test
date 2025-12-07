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

  if (!customerEmail) {
    throw new Error("A customerEmail is required to send a review request email");
  }

  const safeBusinessName = businessName || "our team";
  const safeCustomerName = customerName || "";
  const subject = `How was your experience with ${safeBusinessName}?`;

  const plainText = `
Hi ${safeCustomerName || "there"},

Thanks for choosing ${safeBusinessName}.
We’d really appreciate it if you could take a moment to leave us a quick review.

You can share your feedback here:
${resolvedPortalUrl}

Thank you!
${safeBusinessName}
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="left" style="font-size:18px;font-weight:600;color:#111827;">
                      ${safeBusinessName}
                    </td>
                    <td align="right">
                      ${
                        businessLogoUrl
                          ? `<img src="${businessLogoUrl}" alt="${safeBusinessName} logo" style="height:32px;width:auto;border-radius:6px;" />`
                          : ""
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 24px 8px 24px;font-size:16px;color:#111827;">
                Hi ${safeCustomerName || "there"},
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 8px 24px;font-size:14px;line-height:1.6;color:#374151;">
                Thanks for choosing <strong>${safeBusinessName}</strong>.  
                We’d really appreciate it if you could take a moment to share your experience with us.
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 24px 24px;font-size:14px;line-height:1.6;color:#374151;">
                Your feedback helps us improve and keeps our team on point.
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 24px 24px 24px;">
                <a href="${resolvedPortalUrl}"
                   style="display:inline-block;padding:12px 24px;border-radius:999px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
                  Leave a quick review
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 24px 24px;font-size:12px;line-height:1.6;color:#6b7280;">
                If the button doesn’t work, you can paste this link into your browser: <br />
                <span style="word-break:break-all;color:#2563eb;">${resolvedPortalUrl}</span>
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 24px 24px;font-size:14px;line-height:1.6;color:#374151;">
                Thank you, <br />
                <strong>${safeBusinessName}</strong>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin-top:12px;">
            <tr>
              <td style="font-size:11px;color:#9ca3af;text-align:center;">
                You’re receiving this email because you recently interacted with ${safeBusinessName}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const response = await fetch(SEND_REVIEW_REQUEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: customerEmail,
      subject,
      text: plainText,
      html,
      businessName: safeBusinessName,
      businessLogoUrl,
      portalUrl: resolvedPortalUrl,
      customerName: safeCustomerName,
      textCustomerName: safeCustomerName,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("Failed to send review request email", errorText);
    throw new Error("Failed to send review request email");
  }

  return response.json();
}
