// Bills: validation and queries.

import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";

export const CreateBill = z.object({
  receiptId: z.string(),
  memberId: z.string(),
  subtotal: z.number(),
  taxShare: z.number(),
  tipShare: z.number(),
  amountOwed: z.number(),
});
export type CreateBillInput = z.infer<typeof CreateBill>;


const BillSummary = {
  receiptId: true,
  memberId: true,
  subtotal: true,
  taxShare: true,
  tipShare: true,
  amountOwed: true,
  createdAt: true
} as const;

export async function listBills(userId: string) {
  const member = await prisma.partyMember.findMany({
    where: {userId},
    select:{ id: true},
  });

  const memberIds = member.map(m => m.id);
  if (memberIds.length === 0){ return []; }
  
  return prisma.bill.findMany({
    where: { memberId: { in memberIds } },
    select: BillSummary,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

export async function getBill(userId: string, billId: string) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      receiptId: true,
      memberId: true,
      subtotal: true,
      taxShare: true,
      tipShare: true,
      amountOwed: true,
      createdAt: true,
      receipt: { select: { partyId: true } }
    }
  });

  if (!bill) throw new ApiError("NOT_FOUND", "Bill not found", 404);

  return bill;
}

export async function createBill(userId: string, input: CreateBillInput) {
  const { receiptId, memberId, subtotal, taxShare, tipShare, amountOwed } = input;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true }, });
  if (!user){ throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);}
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId }, select: { id: true, partyId: true, deletedAt: true }, });
  if (!receipt || receipt.deletedAt){ throw new ApiError("Receipt not found", 404);}
  const member = await prisma.partyMember.findUnique({ where: { id: memberId }, select: { id: true, partyId:true }, });
  if (!member){ throw new ApiError("Party member not found", 404);}
  if (member.partyId !== receipt.partyId){ throw new ApiError("Member does not belong to this receipt", 403);}

  return prisma.bill.create({
    data: {
      receiptId,
      memberId,
      subtotal,
      taxShare,
      tipShare,
      amountOwed,
    },
    select: BillSummary,
  });
}
