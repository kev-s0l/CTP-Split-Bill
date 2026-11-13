// POST /api/receipts/:id/picking - Open or pause picking ({ open }) without changing the revision (ADR-0017).
import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { apiError, invalidInput, SetPicking, setPicking, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentUserId();
    const { id: receiptId } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = SetPicking.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const receipt = await setPicking(me, receiptId, parsed.data);
    revalidatePath(`/api/receipts/${receiptId}`);
    return Response.json(receipt);
  } catch (e) {
    return toApiError(e);
  }
}
