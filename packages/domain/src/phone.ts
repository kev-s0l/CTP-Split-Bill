// Participant phones are stored and compared in E.164 so prepared texts and
// organizer lookups address the same number however it was typed.
import { z } from "zod";

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
