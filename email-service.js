// email-service.js
// שכבה אחת בלבד בצד הלקוח – מדברת עם השרת שישלח אימיילים בפועל.

// ✅ TODO: בשלב 2 נחליף כאן ל-URL האמיתי של השרת שישתמש ב-SendGrid
const EMAIL_BACKEND_URL = "https://YOUR-BACKEND-URL.com/send-automation-email";

/**
 * שולח בקשת אימייל לשרת האחורי.
 * payload = כל המידע שהאוטומציה שלך צריכה:
 *   {
 *     to: "customer@example.com",
 *     subject: "Thanks for your review!",
 *     text: "…",
 *     html: "<p>…</p>",
 *     meta: { ruleId: "...", accountId: "..." }
 *   }
 */
export async function sendAutomationEmail(payload) {
  if (!payload || !payload.to) {
    console.error("sendAutomationEmail: missing 'to' field in payload");
    return;
  }

  try {
    const res = await fetch(EMAIL_BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Email backend error:", res.status, text);
      throw new Error("Failed to send email via backend");
    }

    const data = await res.json().catch(() => ({}));
    console.log("Email sent successfully via backend:", data);
    return data;
  } catch (err) {
    console.error("sendAutomationEmail: network/other error:", err);
    throw err;
  }
}
