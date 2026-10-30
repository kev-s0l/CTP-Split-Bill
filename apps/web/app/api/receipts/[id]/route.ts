// GET /api/receipts/:id - Return receipt details, items, participants, assignments, and parsing state.
// PATCH /api/receipts/:id - Correct draft fields, choose a split mode, or confirm review.

import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { 
    apiError, 
    getReceipt, 
    invalidInput, 
    toApiError, 
    UpdateReceipt, 
    updateReceipt 
} from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request,
    { params }: { params: Promise<{ id: string }> }){    
        try{
            const me = await currentUserId();
            const { id: receiptId } = await params;
            const receipt = await getReceipt(me, receiptId)
            return Response.json(receipt);

        } catch (e) {
            return toApiError(e);
        }
    }   

export async function PATCH(req: Request,
    { params }: { params: Promise<{ id: string }> }){
        try {
            const me = await currentUserId();
            const { id: receiptId } = await params;

            const body = await req.json().catch(() => null);
            if (body === null) {
                return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
            }

            const parsed = UpdateReceipt.safeParse(body);
            if (!parsed.success) {
                return invalidInput(parsed.error);
            }

            const receipt = await updateReceipt(me, receiptId, parsed.data);
            revalidatePath(`/api/receipts/${receiptId}`);

            return Response.json(receipt);
        } catch (e) {
            return toApiError(e);
        }
    }
