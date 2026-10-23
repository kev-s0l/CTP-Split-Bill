import { currentUserId } from "@project/auth";
import {toApiError,listBills } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await currentUserId();
    return Response.json(await listBills(me));
  } catch (e) {
    return toApiError(e);
  }
}
