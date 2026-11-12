// POST /api/picks/:token/done - Mark the holder's picks submitted; idempotent. See docs/specs/receipts/guest-picks.md.
import { markPicksDone, toApiError } from "@project/domain";
import { withGuestHeaders } from "../headers";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return withGuestHeaders(Response.json(await markPicksDone(token)));
  } catch (e) {
    return withGuestHeaders(toApiError(e));
  }
}
