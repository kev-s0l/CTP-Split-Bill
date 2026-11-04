// POST /api/phone-auth/start - Text a one-time code to a participant phone. Always 202 so the response never reveals whether the phone is known.

import { clientIp } from "@project/auth";
import { apiError, createPhoneVerification, invalidInput, StartPhoneVerification, toApiError } from "@project/domain";
import { log } from "@project/log";
import { sendSms } from "@project/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = StartPhoneVerification.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const code = await createPhoneVerification(parsed.data.phone, clientIp(req));
    if (code !== null) {
      // A delivery failure must not be distinguishable from an unknown phone.
      await sendSms(parsed.data.phone, `Your Split Bill code is ${code}. It expires in 10 minutes.`)
        .catch((err: unknown) => log.error({ err }, "phone verification sms failed"));
    }
    return new Response(null, { status: 202 });
  } catch (e) {
    return toApiError(e);
  }
}
