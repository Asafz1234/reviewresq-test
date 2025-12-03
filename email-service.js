import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const functions = getFunctions(app);
const sendEmailFn = httpsCallable(functions, "sendReviewRequestEmail");

export async function sendReviewRequestEmail({ to, customerName, businessName, reviewLink }) {
  const subject = `Share your experience with ${businessName}`;
  const text = `
Hi ${customerName},

Thank you for choosing ${businessName}!
Please share your experience at the link below:

${reviewLink}

Thanks,
${businessName} Team
  `.trim();

  const html = text.replace(/\n/g, "<br>");

  return await sendEmailFn({
    to,
    subject,
    text,
    html,
  });
}
