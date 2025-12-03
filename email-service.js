import { functions, httpsCallable } from "./firebase.js";

const sendReviewRequestEmailFn = httpsCallable(functions, "sendReviewRequestEmail");

export async function sendReviewRequestEmail({ to, customerName, businessName, reviewLink }) {
  const subject = `Share your experience with ${businessName}`;

  const text = `

Hi ${customerName},

Thank you for choosing ${businessName}! We’d really appreciate it if you could take a moment to share your experience.

You can leave your review here:
${reviewLink}

Thanks,
${businessName} Team
`.trim();

  const html = text.replace(/\n/g, "<br />");

  await sendReviewRequestEmailFn({ to, subject, text, html });
}
