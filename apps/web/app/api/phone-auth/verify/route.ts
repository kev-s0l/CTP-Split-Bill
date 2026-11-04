// POST /api/phone-auth/verify - Exchange a valid code for an HttpOnly phone-session cookie.

import { phoneSessionCookie } from "@project/auth";
import { apiError, invalidInput, toApiError, VerifyPhoneCode, verifyPhoneCode } from "@project/domain";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = VerifyPhoneCode.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const { token, expiresAt } = await verifyPhoneCode(parsed.data.phone, parsed.data.code);
    return new Response(null, { status: 204, headers: { "Set-Cookie": phoneSessionCookie(token, expiresAt) } });
  } catch (e) {
    return toApiError(e);
  }
}
