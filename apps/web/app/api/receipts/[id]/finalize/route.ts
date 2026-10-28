// POST /api/receipts/:id/finalize - Validate the reviewed draft, calculate bills server-side, and finalize atomically.

import { currentUserId } from "@project/auth";
import { apiError, ExpectedRevision, finalizeReceipt, invalidInput, toApiError } from "@project/domain";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    const { id: receiptId } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = ExpectedRevision.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const receipt = await finalizeReceipt(me, receiptId, parsed.data);
    revalidatePath(`/api/receipts/${receiptId}`);
    revalidatePath(`/api/receipts/${receiptId}/bills`);
    return Response.json(receipt);
  } catch (e) {
    return toApiError(e);
  }
}
