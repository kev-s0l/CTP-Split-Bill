import { currentUserId } from "@project/auth";
import { getReceipt, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ receiptId: string }> }){
    try{
        const me = await currentUserId();
        const {receiptId} = await params;
        const receipt = await getReceipt(me, receiptId)
          
        return Response.json(receipt);

    } catch (e) {
        return toApiError(e);
    }
}