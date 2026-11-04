// DELETE /api/phone-auth/session - Revoke the current phone session and clear its cookie. Idempotent.

import { clearedPhoneSessionCookie, phoneSessionToken } from "@project/auth";
import { revokePhoneSession, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  try {
    await revokePhoneSession(phoneSessionToken(req));
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearedPhoneSessionCookie() } });
  } catch (e) {
    return toApiError(e);
  }
}
