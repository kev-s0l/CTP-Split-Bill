// PUT /api/receipts/:id/shared-allocations - Replace equal item-sharing allocations in SHARED_ITEMS mode.

import { currentUserId } from "@project/auth";
import { apiError, invalidInput, ReplaceSharedAllocations, replaceReceiptSharedAllocations, toApiError } from "@project/domain";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    const { id: receiptId } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = ReplaceSharedAllocations.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const result = await replaceReceiptSharedAllocations(me, receiptId, parsed.data);
    revalidatePath(`/api/receipts/${receiptId}`);
    return Response.json(result);
  } catch (e) {
    return toApiError(e);
  }
}
