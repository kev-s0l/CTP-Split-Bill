// Receipt-local assignments, equal shared allocations and final bill snapshots.
// All draft writes take the same owner/revision lock as receipt corrections.
import { z } from "zod";
import { prisma, type Prisma } from "@project/db";
import { ApiError } from "./errors";
import { ExpectedRevision, receiptDetail, validateReceiptInformation } from "./receipt";
import { lockEditableReceipt, receiptScope, requireReceiptUser } from "./receipt-access";
import { allocateSplit, centsToMoney, toCents } from "./split";

const id = z.string().trim().min(1).max(200);
export const ReplaceAssignments = ExpectedRevision.extend({
  assignments: z.array(z.object({ itemId: id, participantId: id })).max(500),
}).superRefine((input, ctx) => {
  if (new Set(input.assignments.map((assignment) => assignment.itemId)).size !== input.assignments.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assignments"], message: "Each item has at most one assignee" });
  }
});
export type ReplaceAssignmentsInput = z.infer<typeof ReplaceAssignments>;

export const ReplaceSharedAllocations = ExpectedRevision.extend({
  allocations: z.array(z.object({
    itemId: id,
    participantIds: z.array(id).min(2).max(200).refine(
      (ids) => new Set(ids).size === ids.length, "Shared participants must be unique",
    ),
  })).max(500),
}).superRefine((input, ctx) => {
  if (new Set(input.allocations.map((allocation) => allocation.itemId)).size !== input.allocations.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["allocations"], message: "Items must be unique" });
  }
});
export type ReplaceSharedAllocationsInput = z.infer<typeof ReplaceSharedAllocations>;

export async function replaceReceiptAssignments(userId: string, receiptId: string, input: ReplaceAssignmentsInput) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId, input.expectedRevision);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: { splitMode: true, items: { select: { id: true } }, participants: { select: { id: true } } },
    });
    if (receipt.splitMode === "EVEN") throw new ApiError("CONFLICT", "Even splits have no item assignments", 409);
    const items = new Set(receipt.items.map((item) => item.id));
    const participants = new Set(receipt.participants.map((participant) => participant.id));
    if (input.assignments.some((assignment) => !items.has(assignment.itemId) || !participants.has(assignment.participantId))) {
      throw new ApiError("NOT_FOUND", "Item or participant not found", 404);
    }
    await tx.receiptItem.updateMany({ where: { receiptId, receipt: scope }, data: { assignedParticipantId: null } });
    for (const assignment of input.assignments) {
      await tx.sharedItemAllocation.deleteMany({ where: { receiptId, itemId: assignment.itemId, item: { receipt: scope } } });
      await tx.receiptItem.update({
        where: { id: assignment.itemId, receiptId, receipt: scope },
        data: { assignedParticipantId: assignment.participantId },
      });
    }
    return tx.receipt.findFirstOrThrow({ where: scope, select: receiptDetail });
  });
}

export async function replaceReceiptSharedAllocations(userId: string, receiptId: string, input: ReplaceSharedAllocationsInput) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId, input.expectedRevision);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: { splitMode: true, items: { select: { id: true } }, participants: { select: { id: true } } },
    });
    if (receipt.splitMode !== "SHARED_ITEMS") throw new ApiError("CONFLICT", "Shared allocations require SHARED_ITEMS mode", 409);
    const items = new Set(receipt.items.map((item) => item.id));
    const participants = new Set(receipt.participants.map((participant) => participant.id));
    if (input.allocations.some((allocation) => !items.has(allocation.itemId)
      || allocation.participantIds.some((participantId) => !participants.has(participantId)))) {
      throw new ApiError("NOT_FOUND", "Item or participant not found", 404);
    }
    await tx.sharedItemAllocation.deleteMany({ where: { receiptId, item: { receipt: scope } } });
    if (input.allocations.length) {
      await tx.receiptItem.updateMany({
        where: { receiptId, receipt: scope, id: { in: input.allocations.map((allocation) => allocation.itemId) } },
        data: { assignedParticipantId: null },
      });
      await tx.sharedItemAllocation.createMany({
        data: input.allocations.flatMap((allocation) => allocation.participantIds.map((participantId) => ({
          receiptId, itemId: allocation.itemId, participantId,
        }))),
      });
    }
    return tx.receipt.findFirstOrThrow({ where: scope, select: receiptDetail });
  });
}

export async function finalizeReceipt(userId: string, receiptId: string, input: z.infer<typeof ExpectedRevision>) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId, input.expectedRevision);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: {
        splitMode: true, subtotal: true, tax: true, tip: true, total: true,
        paidByParticipantId: true, reviewedAt: true,
        participants: { select: { id: true, joinedAt: true } },
        items: { select: {
          name: true, quantity: true, unitPrice: true, totalPrice: true, isVerified: true,
          assignedParticipantId: true, sharedAllocations: { select: { participantId: true } },
        } },
      },
    });
    if (receipt.reviewedAt === null || receipt.items.some((item) => !item.isVerified)) {
      throw new ApiError("INVALID_INPUT", "Receipt information must be reviewed before finalizing", 400);
    }
    const amounts = validateReceiptInformation(receipt);
    const participantIds = new Set(receipt.participants.map((participant) => participant.id));
    if (receipt.paidByParticipantId !== null && !participantIds.has(receipt.paidByParticipantId)) {
      throw new ApiError("INVALID_INPUT", "Payer must belong to this receipt", 400);
    }
    const items = receipt.items.map((item) => {
      const individual = item.assignedParticipantId;
      const shared = item.sharedAllocations.map((allocation) => allocation.participantId);
      const invalid = () => { throw new ApiError("INVALID_INPUT", "Item assignments do not match the receipt's split mode", 400); };
      if (receipt.splitMode === "EVEN") {
        if (individual !== null || shared.length) invalid();
      } else if (receipt.splitMode === "ITEMIZED") {
        if (individual === null || !participantIds.has(individual) || shared.length) invalid();
      } else if (individual !== null) {
        if (!participantIds.has(individual) || shared.length) invalid();
      } else if (shared.length < 2 || shared.some((id) => !participantIds.has(id))) invalid();
      const assigned = individual === null ? shared : [individual];
      return {
        totalPrice: toCents(item.totalPrice!.toString()),
        shares: assigned.map((memberId) => ({ memberId, weight: 1 })),
      };
    });
    const allocations = allocateSplit({
      splitMode: receipt.splitMode === "EVEN" ? "EVEN" : "ITEMIZED",
      ...amounts, members: receipt.participants, items,
    });
    await tx.bill.createMany({
      data: allocations.map((bill) => ({
        receiptId, participantId: bill.memberId,
        subtotal: centsToMoney(bill.subtotal), taxShare: centsToMoney(bill.taxShare),
        tipShare: centsToMoney(bill.tipShare), amountOwed: centsToMoney(bill.amountOwed),
      })),
    });
    return tx.receipt.update({
      where: { ...scope, status: "DRAFT" },
      data: { status: "FINALIZED", finalizedAt: new Date() }, select: receiptDetail,
    });
  });
}

const billDetail = {
  id: true, receiptId: true, participantId: true, subtotal: true, taxShare: true,
  tipShare: true, amountOwed: true, paidAt: true, createdAt: true,
  participant: { select: { displayName: true, phone: true } },
} satisfies Prisma.BillSelect;

type StoredBill = Prisma.BillGetPayload<{ select: typeof billDetail }>;

function presentBill(bill: StoredBill, paidByParticipantId: string | null) {
  const { participant, ...amounts } = bill;
  const amountOwed = toCents(bill.amountOwed.toString());
  const settled = bill.paidAt !== null || bill.participantId === paidByParticipantId || amountOwed === 0n;
  return {
    ...amounts, displayName: participant.displayName, phone: participant.phone,
    subtotal: centsToMoney(toCents(bill.subtotal.toString())),
    taxShare: centsToMoney(toCents(bill.taxShare.toString())),
    tipShare: centsToMoney(toCents(bill.tipShare.toString())), amountOwed: centsToMoney(amountOwed),
    settled, outstandingAmount: centsToMoney(settled ? 0n : amountOwed),
  };
}

export async function listReceiptBills(userId: string, receiptId: string) {
  await requireReceiptUser(userId);
  const receipt = await prisma.receipt.findFirst({
    where: receiptScope(userId, receiptId),
    select: {
      paidByParticipantId: true,
      bills: { select: billDetail, orderBy: [{ participant: { joinedAt: "asc" } }, { participantId: "asc" }] },
    },
  });
  if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  return receipt.bills.map((bill) => presentBill(bill, receipt.paidByParticipantId));
}

export async function getBill(userId: string, billId: string) {
  await requireReceiptUser(userId);
  if (typeof billId !== "string" || billId.trim() === "") throw new ApiError("NOT_FOUND", "Bill not found", 404);
  const bill = await prisma.bill.findFirst({
    where: { id: billId, receipt: { ownerId: userId, deletedAt: null } },
    select: { ...billDetail, receipt: { select: { paidByParticipantId: true } } },
  });
  if (!bill) throw new ApiError("NOT_FOUND", "Bill not found", 404);
  const { receipt, ...detail } = bill;
  return presentBill(detail, receipt.paidByParticipantId);
}

// adding setBillPaid to package; sets or clears paidAt w/o modifying amounts
export const SetBillPaid = z.object({ paid: z.boolean() });
export type SetBillPaidInput = z.infer<typeof SetBillPaid>;

// Manual paid tracking: only paidAt moves, the calculated snapshot never does.
// Marking an already-paid bill paid keeps its original paidAt, so retries are idempotent.
export async function setBillPaid(userId: string, billId: string, input: SetBillPaidInput) {
  await requireReceiptUser(userId);
  if (typeof billId !== "string" || billId.trim() === "") throw new ApiError("NOT_FOUND", "Bill not found", 404);
  
  const scope = { id: billId, receipt: { ownerId: userId, deletedAt: null } } satisfies Prisma.BillWhereInput;
  const bill = await prisma.bill.findFirst({ where: scope, select: { id: true } });
  
  if (!bill) throw new ApiError("NOT_FOUND", "Bill not found", 404);
  await prisma.bill.updateMany({
    where: input.paid ? { ...scope, paidAt: null } : scope,
    data: { paidAt: input.paid ? new Date() : null },
  });
  return getBill(userId, billId);
}