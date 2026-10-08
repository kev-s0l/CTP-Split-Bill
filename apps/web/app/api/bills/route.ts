import { currentUserId } from "@project/auth";
import {toApiError,listBills, getBill } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await currentUserId();
    const { billId } = await params;
    return Response.json(await listBills(me));
  } catch (e) {
    return toApiError(e);
  }
}
