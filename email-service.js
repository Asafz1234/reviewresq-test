import { functions, httpsCallable } from "./firebase-config.js";
const sendEmailFn = httpsCallable(functions, "sendReviewRequestEmail");

export async function sendReviewRequestEmail({
  customerName,
  customerEmail,
  customerPhone,
  portalLink,
}) {
  return await sendEmailFn({
    customerName,
    customerEmail,
    customerPhone,
    portalLink,
  });
}
