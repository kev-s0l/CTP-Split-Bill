import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";
import { lockEditableReceipt, receiptScope, requireReceiptUser } from "./receipt-access";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a non-negative decimal with at most two fractional digits");

const itemMoney = money.refine(
  (value) => value.split(".")[0].replace(/^0+/, "").length <= 10,
  "Amount must fit within 10 integer digits",
);

const itemQuantity = z.string()
  .regex(/^\d+(\.\d{1,3})?$/, "Quantity must be a decimal with at most three fractional digits")
  .refine((value) => /[1-9]/.test(value), "Quantity must be greater than zero")
  .refine(
    (value) => value.split(".")[0].replace(/^0+/, "").length <= 7,
    "Quantity must fit within 7 integer digits",
  );

export const ReplaceItems = z.object({
  items: z.array(z.object({
    lineNumber: z.number().int().positive().max(2147483647),
    name: z.string().trim().min(1, "Item name is required"),
    quantity: itemQuantity,
    unitPrice: itemMoney,
    totalPrice: itemMoney,
  })).superRefine((items, ctx) => {
    const lines = new Set<number>();
    items.forEach((item, index) => {
      if (lines.has(item.lineNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "lineNumber"],
          message: "Line numbers must be unique",
        });
      }
      lines.add(item.lineNumber);
    });
  }),
});

export type ReplaceItemsInput = z.infer<typeof ReplaceItems>;

export const UpdateReceipt = z.object({
  merchantName: z.string().trim().min(1, "Merchant name is required").optional(),
  purchasedAt: z.string().datetime({ offset: true }).optional(),
  subtotal: money.optional(),
  tax: money.optional(),
  tip: money.optional(),
  total: money.optional(),
  paidByMemberId: z.string().min(1).optional(),
  splitMode: z.enum(["EVEN", "ITEMIZED"]).optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: "At least one editable field is required",
});

export type UpdateReceiptInput = z.infer<typeof UpdateReceipt>;

export const receiptDetail = {
  id: true,
  partyId: true,
  paidByMemberId: true,
  status: true,
  splitMode: true,
  merchantName: true,
  address: true,
  purchasedAt: true,
  currency: true,
  subtotal: true,
  tax: true,
  tip: true,
  total: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      lineNumber: true,
      name: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      isVerified: true,
    },
    orderBy: { lineNumber: "asc" },
  },
} as const;

export async function listReceipts(userId: string, partyId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
  }

  const party = await prisma.party.findFirst({
    where: {
      id: partyId,
      deletedAt: null,
      members: {
        some: {
          userId,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!party) {
    throw new ApiError("NOT_FOUND", "Party not found", 404);
  }

  return prisma.receipt.findMany({
    where: {
      partyId,
      deletedAt: null,
    },
    select: {
      id: true,
      partyId: true,
      createdAt: true,
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
}

export async function getReceipt(userId: string, receiptId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
  }

  const receipt = await prisma.receipt.findFirst({
    where: {
      id: receiptId,
      deletedAt: null,

      party: {
        deletedAt: null,

        members: {
          some: {
            userId,
          },
        },
      },
    },

    select: receiptDetail,
  });

  if (!receipt) {
    throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  }
  return receipt;
}


export async function updateReceipt(userId: string, receiptId: string, input: UpdateReceiptInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
  }

  const scope = {
    id: receiptId,
    deletedAt: null,
    party: { deletedAt: null, members: { some: { userId } } },
  };
  const receipt = await prisma.receipt.findFirst({
    where: scope,
    select: { partyId: true, status: true },
  });
  if (!receipt) {
    throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  }
  if (receipt.status === "FINALIZED") {
    throw new ApiError("CONFLICT", "Receipt is finalized", 409);
  }

  if (input.paidByMemberId !== undefined) {
    const payer = await prisma.partyMember.findFirst({
      where: {
        id: input.paidByMemberId,
        partyId: receipt.partyId,
        party: { deletedAt: null, members: { some: { userId } } },
      },
      select: { id: true },
    });
    if (!payer) {
      throw new ApiError("INVALID_INPUT", "Payer must belong to the receipt's party", 400);
    }
  }

  return prisma.receipt.update({
    // Recheck access and state in the write to avoid updating a finalized receipt.
    where: { ...scope, status: { not: "FINALIZED" } },
    data: {
      merchantName: input.merchantName,
      purchasedAt: input.purchasedAt === undefined ? undefined : new Date(input.purchasedAt),
      subtotal: input.subtotal,
      tax: input.tax,
      tip: input.tip,
      total: input.total,
      paidByMemberId: input.paidByMemberId,
      splitMode: input.splitMode,
    },
    select: receiptDetail,
  });
}

export async function replaceReceiptItems(userId: string, receiptId: string, input: ReplaceItemsInput) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);

  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId);

    await tx.itemShare.deleteMany({
      where: { item: { receiptId, receipt: scope } },
    });
    await tx.receiptItem.deleteMany({
      where: { receiptId, receipt: scope },
    });
    if (input.items.length > 0) {
      await tx.receiptItem.createMany({
        data: input.items.map((item) => ({
          receiptId,
          lineNumber: item.lineNumber,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          isVerified: true,
        })),
      });
    }
    return tx.receipt.findFirstOrThrow({ where: scope, select: receiptDetail });
  });
}
