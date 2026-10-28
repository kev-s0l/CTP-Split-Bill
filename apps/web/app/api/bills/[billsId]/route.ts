// GET /api/bills/:billsId - Return one organizer-owned participant bill and its breakdown.
// Planned PATCH /api/bills/:billsId - Mark the bill paid or unpaid without changing its calculated amounts.

import { currentUserId } from "@project/auth";
import { getBill, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ billsId: string }> }) {
  try {
    const me = await currentUserId();
    const { billsId } = await params;
    return Response.json(await getBill(me, billsId));
  } catch (e) {
    return toApiError(e);
  }
}
