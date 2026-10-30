// PUT /api/receipts/:id/assignments - Replace individual item assignments, with at most one participant per item.

import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { apiError, invalidInput, ReplaceAssignments, replaceReceiptAssignments, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = ReplaceAssignments.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const receipt = await replaceReceiptAssignments(me, id, parsed.data);
    revalidatePath(`/api/receipts/${id}`);
    return Response.json(receipt);
  } catch (error) {
    return toApiError(error);
  }
}
