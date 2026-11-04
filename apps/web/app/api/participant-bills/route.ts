// GET /api/participant-bills - Bills across all receipts for the phone proven by the phone-session cookie.

import { phoneSessionToken } from "@project/auth";
import { listVerifiedPhoneBills, requirePhoneSession, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const phone = await requirePhoneSession(phoneSessionToken(req));
    return Response.json(await listVerifiedPhoneBills(phone));
  } catch (e) {
    return toApiError(e);
  }
}
