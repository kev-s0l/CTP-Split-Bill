import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";
import { receiptDetail } from "./receipt";
import { lockEditableReceipt, receiptScope, requireReceiptUser } from "./receipt-access";
import { allocateSplit, centsToMoney, toCents } from "./split";

export const ReplaceShares = z.object({
  shares: z.array(z.object({
    itemId: z.string().trim().min(1),
    memberId: z.string().trim().min(1),
    weight: z.number().int().positive().max(2147483647),
  })).superRefine((shares, ctx) => {
    const pairs = new Set<string>();
    shares.forEach((share, index) => {
      const key = JSON.stringify([share.itemId, share.memberId]);
      if (pairs.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Item/member pairs must be unique" });
      }
      pairs.add(key);
    });
  }),
});

export type ReplaceSharesInput = z.infer<typeof ReplaceShares>;

export async function replaceReceiptShares(userId: string, receiptId: string, input: ReplaceSharesInput) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: { items: { select: { id: true } }, party: { select: { members: { select: { id: true } } } } },
    });
    const items = new Set(receipt.items.map((item) => item.id));
    const members = new Set(receipt.party.members.map((member) => member.id));
    if (input.shares.some((share) => !items.has(share.itemId) || !members.has(share.memberId))) {
      throw new ApiError("NOT_FOUND", "Item or member not found", 404);
    }
    await tx.itemShare.deleteMany({ where: { item: { receiptId, receipt: scope } } });
    if (input.shares.length > 0) await tx.itemShare.createMany({ data: input.shares });
    const shares = await tx.itemShare.findMany({
      where: { item: { receiptId, receipt: scope } },
      select: { itemId: true, memberId: true, weight: true },
      orderBy: [{ item: { lineNumber: "asc" } }, { member: { joinedAt: "asc" } }, { memberId: "asc" }],
    });
    return { shares };
  });
}

export async function finalizeReceipt(userId: string, receiptId: string) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: {
        status: true, splitMode: true, subtotal: true, tax: true, tip: true, total: true, paidByMemberId: true,
        party: { select: { members: { select: { id: true, joinedAt: true } } } },
        items: { select: { totalPrice: true, shares: { select: { memberId: true, weight: true } } } },
      },
    });
    if (receipt.status !== "PARSED") throw new ApiError("INVALID_INPUT", "Receipt must be parsed before finalizing", 400);
    if (receipt.subtotal === null || receipt.tax === null || receipt.total === null) {
      throw new ApiError("INVALID_INPUT", "Subtotal, tax, and total are required", 400);
    }
    if (receipt.paidByMemberId !== null && !receipt.party.members.some((member) => member.id === receipt.paidByMemberId)) {
      throw new ApiError("INVALID_INPUT", "Payer must belong to the receipt's party", 400);
    }
    const subtotal = toCents(receipt.subtotal.toString());
    const tax = toCents(receipt.tax.toString());
    const tip = receipt.tip === null ? 0n : toCents(receipt.tip.toString());
    const total = toCents(receipt.total.toString());
    if (subtotal + tax + tip !== total) throw new ApiError("INVALID_INPUT", "Receipt amounts must sum to total", 400);
    const allocations = allocateSplit({
      splitMode: receipt.splitMode, subtotal, tax, tip,
      members: receipt.party.members,
      items: receipt.items.map((item) => ({ totalPrice: toCents(item.totalPrice.toString()), shares: item.shares })),
    });
    await tx.bill.createMany({
      data: allocations.map((bill) => ({
        receiptId, memberId: bill.memberId,
        subtotal: centsToMoney(bill.subtotal), taxShare: centsToMoney(bill.taxShare),
        tipShare: centsToMoney(bill.tipShare), amountOwed: centsToMoney(bill.amountOwed),
      })),
    });
    return tx.receipt.update({
      where: { ...scope, status: "PARSED" }, data: { status: "FINALIZED" }, select: receiptDetail,
    });
  });
}

export async function listReceiptBills(userId: string, receiptId: string) {
  await requireReceiptUser(userId);
  const receipt = await prisma.receipt.findFirst({
    where: receiptScope(userId, receiptId),
    select: {
      paidByMemberId: true,
      bills: {
        select: {
          id: true, receiptId: true, memberId: true, subtotal: true, taxShare: true, tipShare: true,
          amountOwed: true, createdAt: true,
          member: { select: { displayName: true } }, payments: { select: { amount: true } },
        },
        orderBy: [{ member: { joinedAt: "asc" } }, { memberId: "asc" }],
      },
    },
  });
  if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  return receipt.bills.map(({ member, payments, ...bill }) => {
    const amountPaid = payments.reduce((sum, payment) => sum + toCents(payment.amount.toString()), 0n);
    const amountOwed = toCents(bill.amountOwed.toString());
    return {
      ...bill, displayName: member.displayName,
      subtotal: centsToMoney(toCents(bill.subtotal.toString())),
      taxShare: centsToMoney(toCents(bill.taxShare.toString())),
      tipShare: centsToMoney(toCents(bill.tipShare.toString())), amountOwed: centsToMoney(amountOwed),
      amountPaid: centsToMoney(amountPaid), settled: bill.memberId === receipt.paidByMemberId || amountPaid >= amountOwed,
    };
  });
}
