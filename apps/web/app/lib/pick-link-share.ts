// Builds the message and the sms:/mailto: hrefs the organizer sends a pick
// link with (docs/specs/receipts/participants-screen.md, "Pick links").
// The app sends nothing itself; these hand off to the organizer's own apps.

export const PICK_LINK_EMAIL_SUBJECT = "Split Bill";

// Names the merchant when there is one; never names people or amounts.
export function pickLinkMessage(url: string, merchantName: string | null): string {
  const merchant = merchantName?.trim();
  return merchant ? `Pick what you had at ${merchant}: ${url}` : `Tap the items you had: ${url}`;
}

// phone is stored E.164 (+ and digits), which is safe in the href as is;
// encoding the + would break it in some messaging apps.
export function smsHref(phone: string, message: string): string {
  return `sms:${phone}?body=${encodeURIComponent(message)}`;
}

export function mailtoHref(email: string, message: string): string {
  const to = encodeURIComponent(email).replace(/%40/g, "@");
  return `mailto:${to}?subject=${encodeURIComponent(PICK_LINK_EMAIL_SUBJECT)}&body=${encodeURIComponent(message)}`;
}
