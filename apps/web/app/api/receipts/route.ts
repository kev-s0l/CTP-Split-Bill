//GET /api/receipts - List the organizer's receipt history and outstanding balances.

import { currentUserId } from "@project/auth";
import { listReceipts, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await currentUserId();
    const receipts = await listReceipts(userId);
    return Response.json(receipts);
  } catch (error) {
    return toApiError(error);
  }
}
// Planned POST /api/receipts - Upload a receipt photo and create an organizer-owned draft.
