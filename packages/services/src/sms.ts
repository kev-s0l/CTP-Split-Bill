// The SMS adapter. Sends through Twilio's Messages API when TWILIO_ACCOUNT_SID is
// set; otherwise the dev stand-in logs the message so codes are readable locally.
// Plain fetch keeps the Twilio SDK out of the bundle. See ADR-0015.
import { log } from "@project/log";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export async function sendSms(to: string, message: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) {
    // Logged codes are a credential leak in production, so the stand-in must be opted into.
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEV_SMS) {
      throw new Error("SMS stand-in is disabled in production; set TWILIO_ACCOUNT_SID.");
    }
    log.info({ to, message }, "dev sms (not sent)");
    return;
  }
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!authToken || !from) throw new Error("TWILIO_AUTH_TOKEN and TWILIO_FROM are required when TWILIO_ACCOUNT_SID is set.");

  // TWILIO_FROM is either a sender number (E.164) or a Messaging Service SID (MG...).
  const body = new URLSearchParams({ To: to, Body: message, [from.startsWith("MG") ? "MessagingServiceSid" : "From"]: from });
  const res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
  if (!res.ok) throw new Error(`SMS send failed: ${res.status} ${result.code ?? ""} ${result.message ?? ""}`.trim());
  log.info({ messageSid: result.sid }, "sms sent");
}
