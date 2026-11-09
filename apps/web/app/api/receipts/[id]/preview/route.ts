// POST /api/receipts/:id/preview - Calculate a breakdown for the current draft revision without creating bills.
import { currentUserId } from "@project/auth";
import { apiError, ExpectedRevision, invalidInput, previewReceipt, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await currentUserId();
    const { id } = await params;

    const body = await req.json().catch(() => null);
    if (body == null){
        return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    }

    const parsed = ExpectedRevision.safeParse(body);
    if(!parsed.success) return invalidInput(parsed.error);

    return Response.json(await previewReceipt(userId, id, parsed.data),);
  } catch (e) {
    return toApiError(e);
  }
}
