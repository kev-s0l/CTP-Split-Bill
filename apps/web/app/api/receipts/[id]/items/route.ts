// PUT /api/receipts/:id/items - Replace corrected draft items and clear their assignments and shared allocations.

import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { 
  apiError, 
  invalidInput, 
  ReplaceItems, 
  replaceReceiptItems, 
  toApiError } from "@project/domain";


export const dynamic = "force-dynamic";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const me = await currentUserId();
    const { id: receiptId } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) {
      return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    }

    const parsed = ReplaceItems.safeParse(body);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const receipt = await replaceReceiptItems(me, receiptId, parsed.data);
    revalidatePath(`/api/receipts/${receiptId}`);
    return Response.json(receipt);
  } catch (e) {
    return toApiError(e);
  }
}
