// Guest contact addresses: how a party member without an account is reached,
// and the single normalized form that every write and every lookup must agree
// on. A row stored unnormalized is a bill its guest can never retrieve —
// ADR-0014.

import { z } from "zod";
import { ApiError } from "./errors";

// A guest principal: a contact address whose control has been proved. It is
// deliberately NOT a bare string — account-scoped queries take `userId: string`,
// so a verified contact cannot satisfy one by accident (ADR-0014, part 4).
export type VerifiedContact =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string };

const Email = z.string().trim().toLowerCase().email("Not a valid email address");

export function normalizeEmail(raw: string): string {
  const parsed = Email.safeParse(raw);
  if (!parsed.success) throw new ApiError("INVALID_INPUT", "Not a valid email address", 400);
  return parsed.data;
}

// E.164 without the country metadata a full implementation needs: a bare
// 10-digit number is assumed +1, and anything else must carry its own country
// code. Ambiguous input throws rather than storing a form lookup would miss.
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    if (digits.length < 8 || digits.length > 15) {
      throw new ApiError("INVALID_INPUT", "Phone number is not a valid length", 400);
    }
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  throw new ApiError(
    "INVALID_INPUT",
    "Phone number must include a country code, e.g. +1 555 123 4567",
    400
  );
}

// The one constructor for a guest principal. Exactly one of email/phone, both
// normalized — the OTP flow calls this with the address it just verified.
export function verifiedContact(input: { email?: string; phone?: string }): VerifiedContact {
  const hasEmail = input.email !== undefined && input.email.trim() !== "";
  const hasPhone = input.phone !== undefined && input.phone.trim() !== "";

  if (hasEmail === hasPhone) {
    throw new ApiError("INVALID_INPUT", "Provide exactly one of email or phone", 400);
  }
  return hasEmail
    ? { kind: "email", value: normalizeEmail(input.email!) }
    : { kind: "phone", value: normalizePhone(input.phone!) };
}
