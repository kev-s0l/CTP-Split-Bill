import { currentUserId } from "@project/auth";
import { finalizeReceipt, toApiError } from "@project/domain";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const me = await currentUserId();
    const { receiptId } = await params;
    const receipt = await finalizeReceipt(me, receiptId);
    revalidatePath(`/api/receipts/${receiptId}`);
    revalidatePath(`/api/receipts/${receiptId}/bills`);
    return Response.json(receipt);
  } catch (e) {
    return toApiError(e);
  }
}
