// The guest principal seam: who, if anyone, has proved control of a contact
// address on this request. Mirrors currentUserId() — ADR-0014 part 2.
//
// Today this is a dev stand-in (an `x-guest-contact` header), because the OTP
// verification flow does not exist yet. When it lands it sets a guest session
// and this function reads it; no route changes. Stand-in by default, blocked
// in production — docs/specs/seams.md.
//
// The return value is a raw CLAIM, not a normalized contact: callers pass it
// through verifiedContact() in @project/domain, which normalizes and validates.
// The claim type is declared here rather than imported because packages/auth
// must not depend on @project/domain (ADR-0009); the shapes match structurally.

import { headers } from "next/headers";

export type GuestClaim = { email?: string; phone?: string };

// Null when no guest principal is present — the caller returns 401 rather
// than falling back to an account identity.
export async function currentGuestContact(): Promise<GuestClaim | null> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEV_IDENTITY) {
    throw new Error(
      "Guest identity stand-in is disabled in production. (OTP verification replaces it.)"
    );
  }

  const raw = (await headers()).get("x-guest-contact");
  if (!raw) return null;

  // "email:a@b.com" or "phone:+15551234567" — the channel is explicit so a
  // value is never guessed at.
  const [kind, ...rest] = raw.split(":");
  const value = rest.join(":").trim();
  if (!value) return null;

  if (kind === "email") return { email: value };
  if (kind === "phone") return { phone: value };
  return null;
}
