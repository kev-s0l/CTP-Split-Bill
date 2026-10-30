// GET /api/bills/:billsId - Return one organizer-owned participant bill and its breakdown.
// Planned PATCH /api/bills/:billsId - Mark the bill paid or unpaid without changing its calculated amounts.

import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { getBill, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ billsId: string }> }) {
  try {
    const me = await currentUserId();
    const { billsId } = await params;
    return Response.json(await getBill(me, billsId));
  } catch (e) {
    return toApiError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ billsId: string }> }) {
  try {
    const me = await currentUserId();
    const { billsId } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = SetBillPaid.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);
    const bill = await setBillPaid(me, billsId, parsed.data);
    revalidatePath(`/receipts/${bill.receiptId}/payments`);
    return Response.json(bill);
  } catch (e) {
    return toApiError(e);
  }
}