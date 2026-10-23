import { headers } from "next/headers";

export type GuestClaim = { email?: string; phone?: string };

export async function currentGuestContact(): Promise<GuestClaim | null> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEV_IDENTITY) {
    throw new Error(
      "Guest identity stand-in is disabled in production. (OTP verification replaces it.)"
    );
  }

const raw = (await headers()).get("x-guest-contact");
  if (!raw) return null;
const [kind, ...rest] = raw.split(":");
  const value = rest.join(":").trim();
  if (!value) return null;

  if (kind === "email") return { email: value };
  if (kind === "phone") return { phone: value };
  return null;
}
