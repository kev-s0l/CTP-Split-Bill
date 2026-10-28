// GET /api/receipts/:id/bills - Return finalized participant bills with settlement and outstanding amounts.

import { currentUserId } from "@project/auth";
import { listReceiptBills, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    const { id } = await params;
    return Response.json(await listReceiptBills(me, id));
  } catch (error) {
    return toApiError(error);
  }
}
