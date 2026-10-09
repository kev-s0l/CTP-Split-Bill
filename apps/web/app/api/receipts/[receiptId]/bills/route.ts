import { currentUserId } from "@project/auth";
import { listReceiptBills, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const me = await currentUserId();
    const { receiptId } = await params;
    return Response.json(await listReceiptBills(me, receiptId));
  } catch (e) {
    return toApiError(e);
  }
}
