// Phone verification: a texted one-time code proves possession of a phone and
// yields a session scoped to that phone. Codes and tokens are stored only as
// hashes. See ADR-0015 and docs/specs/bills/phone-lookup.md.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const PHONE_SEND_LIMIT = { count: 3, windowMs: 15 * 60 * 1000 };
export const IP_SEND_LIMIT = { count: 10, windowMs: 60 * 60 * 1000 };

// E.164 with North American defaults: 10 digits gain +1, 00 becomes +.
// Anything else must already carry a country code.
export function normalizePhone(input: string): string | null {
  const stripped = input.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(stripped)) return stripped;
  if (/^00[1-9]\d{7,14}$/.test(stripped)) return `+${stripped.slice(2)}`;
  if (/^[2-9]\d{9}$/.test(stripped)) return `+1${stripped}`;
  if (/^1[2-9]\d{9}$/.test(stripped)) return `+${stripped}`;
  return null;
}

export const PhoneNumber = z.string().max(32).transform((value, ctx) => {
  const phone = normalizePhone(value);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number" });
    return z.NEVER;
  }
  return phone;
});

export const StartPhoneVerification = z.object({ phone: PhoneNumber });
export const VerifyPhoneCode = z.object({ phone: PhoneNumber, code: z.string().trim().regex(/^\d{6}$/, "Code is 6 digits") });

function secret() {
  const value = process.env.PHONE_AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("PHONE_AUTH_SECRET is required in production.");
  return "dev-phone-auth-secret";
}

// Keyed so a database leak alone cannot brute-force the 10^6 code space.
const hashCode = (phone: string, code: string) => createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const invalidCode = () => new ApiError("INVALID_INPUT", "Code is invalid or expired", 400);

// Returns the code to text, or null when nothing should be sent: rate-limited,
// or no participant carries this phone. Callers respond identically either way.
export async function createPhoneVerification(phone: string, clientIp: string | null, now = new Date()) {
  const [byPhone, byIp, known] = await Promise.all([
    prisma.phoneVerification.count({
      where: { phone, createdAt: { gt: new Date(now.getTime() - PHONE_SEND_LIMIT.windowMs) } },
    }),
    clientIp === null ? 0 : prisma.phoneVerification.count({
      where: { clientIp, createdAt: { gt: new Date(now.getTime() - IP_SEND_LIMIT.windowMs) } },
    }),
    prisma.participant.findFirst({ where: { phone, receipt: { deletedAt: null } }, select: { id: true } }),
  ]);
  if (byPhone >= PHONE_SEND_LIMIT.count || byIp >= IP_SEND_LIMIT.count || !known) return null;
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.$transaction([
    prisma.phoneVerification.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: now } }),
    prisma.phoneVerification.create({
      data: { phone, clientIp, codeHash: hashCode(phone, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now },
    }),
  ]);
  return code;
}

export async function verifyPhoneCode(phone: string, code: string, now = new Date()) {
  const pending = await prisma.phoneVerification.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_CODE_ATTEMPTS } },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) throw invalidCode();
  // Count the attempt before comparing so a failed guess is never rolled back.
  const counted = await prisma.phoneVerification.updateMany({
    where: { id: pending.id, attempts: { lt: MAX_CODE_ATTEMPTS } }, data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) throw invalidCode();
  const expected = Buffer.from(pending.codeHash, "hex");
  const actual = Buffer.from(hashCode(phone, code), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidCode();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.phoneVerification.updateMany({
      where: { id: pending.id, consumedAt: null }, data: { consumedAt: now },
    });
    if (consumed.count === 0) throw invalidCode();
    await tx.phoneSession.create({ data: { phone, tokenHash: hashToken(token), expiresAt } });
  });
  return { token, expiresAt };
}

export async function requirePhoneSession(token: string | null, now = new Date()) {
  const session = token ? await prisma.phoneSession.findUnique({
    where: { tokenHash: hashToken(token) }, select: { phone: true, expiresAt: true, revokedAt: true },
  }) : null;
  if (!session || session.revokedAt !== null || session.expiresAt <= now) {
    throw new ApiError("UNAUTHENTICATED", "Phone verification required", 401);
  }
  return session.phone;
}

export async function revokePhoneSession(token: string | null, now = new Date()) {
  if (!token) return;
  await prisma.phoneSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now } });
}
