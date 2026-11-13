import { currentUserId } from "@project/auth";
import { listReceiptSummaries, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await currentUserId();
    return Response.json(await listReceiptSummaries(userId));
  } catch (error) {
    return toApiError(error);
  }
}
