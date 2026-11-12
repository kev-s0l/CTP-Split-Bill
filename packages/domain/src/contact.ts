// Phone and email normalization for participants (docs/specs/receipts/participants.md).
// No database import, so client code can validate with the same rules the API
// applies: import from "@project/domain/contact".

// US numbers may skip the +1; anything else must start with + and a country code.
// Spaces, parentheses, dots and hyphens are stripped before checking.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

// One address, local@domain, no spaces; trimmed and lowercased for storage.
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}
