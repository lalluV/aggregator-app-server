const EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send";

const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const APP_NAME = process.env.APP_NAME || "SafeAven";

export function isEmailJsConfigured() {
  return Boolean(
    EMAILJS_SERVICE_ID &&
      EMAILJS_TEMPLATE_ID &&
      EMAILJS_PUBLIC_KEY &&
      EMAILJS_PRIVATE_KEY,
  );
}

/**
 * Sends a 6-digit OTP for password reset (EmailJS only; no link/token flow).
 * Template: {{verification_code}}, {{expires_in_minutes}}, {{to_email}},
 * {{to_name}}, {{app_name}}, {{account_type}}, optional {{info_url}}.
 */
export async function sendPasswordResetOtpEmail({
  toEmail,
  toName,
  verificationCode,
  infoUrl = "",
  expiresInMinutes,
  accountType = "customer",
}) {
  if (!isEmailJsConfigured()) {
    throw new Error(
      "EmailJS is not configured. Set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, and EMAILJS_PRIVATE_KEY.",
    );
  }

  const payload = {
    service_id: EMAILJS_SERVICE_ID,
    template_id: EMAILJS_TEMPLATE_ID,
    user_id: EMAILJS_PUBLIC_KEY,
    accessToken: EMAILJS_PRIVATE_KEY,
    template_params: {
      app_name: APP_NAME,
      to_email: toEmail,
      to_name: toName || toEmail,
      verification_code: String(verificationCode),
      info_url: infoUrl || "",
      expires_in_minutes: String(expiresInMinutes),
      account_type: accountType,
    },
  };

  const response = await fetch(EMAILJS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`EmailJS request failed (${response.status}): ${errBody}`);
  }
}
