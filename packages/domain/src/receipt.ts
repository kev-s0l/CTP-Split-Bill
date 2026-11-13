// Receipt corrections and reads. Ownership, revisions and review state are
// checked in the same transaction as each draft mutation.
import { z } from "zod";
import { prisma, type Prisma } from "@project/db";
import { ApiError } from "./errors";
import { lockEditableReceipt, receiptScope, requireReceiptUser } from "./receipt-access";
import { toCents } from "./split";

export const ExpectedRevision = z.object({
  expectedRevision: z.number().int().positive().max(2147483646),
});

const money = z.string().max(64)
  .regex(/^\d+(\.\d{1,2})?$/, "Must be a non-negative decimal with at most two fractional digits")
  .refine((value) => value.split(".")[0].replace(/^0+/, "").length <= 10, "Amount must fit within 10 integer digits");

const itemQuantity = z.string().max(64)
  .regex(/^\d+(\.\d{1,3})?$/, "Quantity must be a decimal with at most three fractional digits")
  .refine((value) => /[1-9]/.test(value), "Quantity must be greater than zero")
  .refine((value) => value.split(".")[0].replace(/^0+/, "").length <= 7, "Quantity must fit within 7 integer digits");

export const ReplaceItems = ExpectedRevision.extend({
  items: z.array(z.object({
    lineNumber: z.number().int().positive().max(2147483647),
    name: z.string().trim().min(1, "Item name is required").max(200),
    quantity: itemQuantity,
    unitPrice: money,
    totalPrice: money,
  })).max(500).superRefine((items, ctx) => {
    const lines = new Set<number>();
    items.forEach((item, index) => {
      if (lines.has(item.lineNumber)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "lineNumber"], message: "Line numbers must be unique" });
      }
      lines.add(item.lineNumber);
    });
  }),
});
export type ReplaceItemsInput = z.infer<typeof ReplaceItems>;

export const UpdateReceipt = ExpectedRevision.extend({
  title: z.string().trim().min(1).max(100).nullable().optional(),
  merchantName: z.string().trim().min(1).max(200).nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  purchasedAt: z.string().datetime({ offset: true }).nullable().optional(),
  subtotal: money.nullable().optional(),
  tax: money.nullable().optional(),
  tip: money.nullable().optional(),
  total: money.nullable().optional(),
  paidByParticipantId: z.string().trim().min(1).nullable().optional(),
  splitMode: z.enum(["EVEN", "ITEMIZED", "SHARED_ITEMS"]).optional(),
  reviewConfirmed: z.literal(true).optional(),
}).refine((input) => Object.entries(input).some(([key, value]) => key !== "expectedRevision" && value !== undefined), {
  message: "At least one editable field is required",
});
export type UpdateReceiptInput = z.infer<typeof UpdateReceipt>;

export const receiptDetail = {
  id: true, ownerId: true, title: true, paidByParticipantId: true,
  organizerParticipantId: true, picksOpenedAt: true,
  status: true, parseStatus: true, splitMode: true, revision: true,
  reviewedAt: true, finalizedAt: true, merchantName: true, address: true,
  purchasedAt: true, currency: true, subtotal: true, tax: true, tip: true,
  total: true, createdAt: true, updatedAt: true,
  participants: {
    select: {
      id: true, displayName: true, phone: true, email: true, joinedAt: true,
      pickTokenHash: true, picksSubmittedAt: true,
    },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  },
  items: {
    select: {
      id: true, lineNumber: true, name: true, quantity: true, unitPrice: true,
      totalPrice: true, isVerified: true, assignedParticipantId: true,
      sharedAllocations: {
        select: { participantId: true },
        orderBy: [{ participant: { joinedAt: "asc" } }, { participantId: "asc" }],
      },
    },
    orderBy: { lineNumber: "asc" },
  },
} satisfies Prisma.ReceiptSelect;

// Every receiptDetail read goes through here: the pick-token hash is reduced to
// hasPickLink and never leaves the domain (receipts/detail.md).
type PresentedParticipant<P> = Omit<P, "pickTokenHash"> & { hasPickLink: boolean };

export function presentReceipt<P extends { pickTokenHash: string | null }, R extends { participants: P[] }>(
  receipt: R & { participants: P[] },
): Omit<R, "participants"> & { participants: PresentedParticipant<P>[] } {
  const { participants, ...rest } = receipt;
  return {
    ...rest,
    participants: participants.map(({ pickTokenHash, ...participant }) => ({
      ...participant,
      hasPickLink: pickTokenHash !== null,
    })),
  };
}

type StoredMoney = { toString(): string } | null;

// Used at confirmation and finalization; the pure allocator only receives
// complete, validated integer cents.
export function validateReceiptInformation(receipt: {
  subtotal: StoredMoney; tax: StoredMoney; tip: StoredMoney; total: StoredMoney;
  items: { name: string | null; quantity: StoredMoney; unitPrice: StoredMoney; totalPrice: StoredMoney }[];
}) {
  if (receipt.subtotal === null || receipt.tax === null || receipt.total === null) {
    throw new ApiError("INVALID_INPUT", "Subtotal, tax, and total are required", 400);
  }
  if (receipt.items.length === 0 || receipt.items.some((item) =>
    !item.name?.trim() || item.quantity === null || !itemQuantity.safeParse(item.quantity.toString()).success
    || item.unitPrice === null || item.totalPrice === null)) {
    throw new ApiError("INVALID_INPUT", "Every item needs a name, positive quantity, unit price, and total price", 400);
  }
  const subtotal = toCents(receipt.subtotal.toString());
  const tax = toCents(receipt.tax.toString());
  const tip = receipt.tip === null ? 0n : toCents(receipt.tip.toString());
  const total = toCents(receipt.total.toString());
  const itemTotal = receipt.items.reduce((sum, item) => {
    toCents(item.unitPrice!.toString());
    return sum + toCents(item.totalPrice!.toString());
  }, 0n);
  if (subtotal <= 0n || itemTotal !== subtotal || subtotal + tax + tip !== total) {
    throw new ApiError("INVALID_INPUT", "Items, subtotal, tax, tip, and total must reconcile", 400);
  }
  return { subtotal, tax, tip, total };
}

export async function listReceipts(userId: string) {
  await requireReceiptUser(userId);
  return prisma.receipt.findMany({
    where: { ownerId: userId, deletedAt: null },
    select: { id: true, title: true, merchantName: true, purchasedAt: true, status: true, total: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

export async function getReceipt(userId: string, receiptId: string) {
  await requireReceiptUser(userId);
  const receipt = await prisma.receipt.findFirst({ where: receiptScope(userId, receiptId), select: receiptDetail });
  if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  return presentReceipt(receipt);
}

export async function getReceiptImage(userId: string, receiptId: string) {
  await requireReceiptUser(userId);
  const image = await prisma.receipt.findFirst({
    where: receiptScope(userId, receiptId),
    select: { imageBlobName: true, imageContentType: true },
  });
  if (!image) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  if (!["image/jpeg", "image/png", "image/webp"].includes(image.imageContentType)) {
    throw new ApiError("INTERNAL", "Receipt image is unavailable", 500);
  }
  return image;
}

export async function updateReceipt(userId: string, receiptId: string, input: UpdateReceiptInput) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId, input.expectedRevision);
    const current = await tx.receipt.findFirstOrThrow({ where: scope, select: { splitMode: true } });
    if (input.paidByParticipantId != null) {
      const payer = await tx.participant.findFirst({
        where: { id: input.paidByParticipantId, receiptId, receipt: scope }, select: { id: true },
      });
      if (!payer) throw new ApiError("NOT_FOUND", "Participant not found", 404);
    }
    if (input.splitMode !== undefined && input.splitMode !== current.splitMode) {
      if (input.splitMode !== "SHARED_ITEMS") {
        await tx.sharedItemAllocation.deleteMany({ where: { receiptId, item: { receipt: scope } } });
      }
      if (input.splitMode === "EVEN") {
        await tx.receiptItem.updateMany({ where: { receiptId, receipt: scope }, data: { assignedParticipantId: null } });
      }
    }
    const changesContent = ["title", "merchantName", "address", "purchasedAt", "subtotal", "tax", "tip", "total"]
      .some((key) => input[key as keyof UpdateReceiptInput] !== undefined);
    const receipt = await tx.receipt.update({
      where: scope,
      data: {
        title: input.title, merchantName: input.merchantName, address: input.address,
        purchasedAt: input.purchasedAt === undefined ? undefined : input.purchasedAt === null ? null : new Date(input.purchasedAt),
        subtotal: input.subtotal, tax: input.tax, tip: input.tip, total: input.total,
        paidByParticipantId: input.paidByParticipantId, splitMode: input.splitMode,
        reviewedAt: changesContent ? null : undefined,
      },
      select: receiptDetail,
    });
    if (input.reviewConfirmed) {
      validateReceiptInformation(receipt);
      await tx.receiptItem.updateMany({ where: { receiptId, receipt: scope }, data: { isVerified: true } });
      return presentReceipt(await tx.receipt.update({ where: scope, data: { reviewedAt: new Date() }, select: receiptDetail }));
    }
    return presentReceipt(receipt);
  });
}

export async function replaceReceiptItems(userId: string, receiptId: string, input: ReplaceItemsInput) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId, input.expectedRevision);
    await tx.sharedItemAllocation.deleteMany({ where: { receiptId, item: { receipt: scope } } });
    await tx.receiptItem.deleteMany({ where: { receiptId, receipt: scope } });
    // Picks went with the old items, so nobody is done picking any more.
    await tx.participant.updateMany({ where: { receiptId }, data: { picksSubmittedAt: null } });
    if (input.items.length) {
      await tx.receiptItem.createMany({
        data: input.items.map((item) => ({ receiptId, ...item, isVerified: true })),
      });
    }
    return presentReceipt(await tx.receipt.update({ where: scope, data: { reviewedAt: null }, select: receiptDetail }));
  });
}

export function validateReceiptUpload(form: FormData, maxBytes: number): File {
  const entries = Array.from(form.entries());
  if (entries.length !== 1 || entries[0][0] !== "file" || typeof entries[0][1] === "string") {
    throw new ApiError("INVALID_INPUT", "Provide exactly one receipt photo in the file field", 400);
  }

  const file = entries[0][1];
  const metadata = z.object({
    type: z.enum(["image/jpeg", "image/png", "image/webp"], {
      errorMap: () => ({ message: "Receipt photo must be JPEG, PNG or WebP" }),
    }),
    size: z.number().int().min(1, "Receipt photo must not be empty")
      .max(maxBytes, `Receipt photo must be at most ${maxBytes} bytes`),
  }).safeParse({ type: file.type, size: file.size });
  if (!metadata.success) {
    throw new ApiError("INVALID_INPUT", metadata.error.issues[0].message, 400);
  }
  return file;
}

export function validateReceiptImage(data: ArrayBuffer, contentType: string): void {
  const bytes = new Uint8Array(data);
  const matches = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);
  const valid = contentType === "image/jpeg" ? matches([0xff, 0xd8, 0xff])
    : contentType === "image/png" ? matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : contentType === "image/webp" && matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8);
  if (!valid) {
    throw new ApiError("INVALID_INPUT", "Photo contents do not match its content type", 400);
  }
}

export async function createReceipt(
  userId: string,
  input: { id: string; imageBlobName: string; imageContentType: string },
) {
  await requireReceiptUser(userId);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true },
  });

  // The organizer is on their own roster from the start (ADR-0018).
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.create({
      data: {
        id: input.id,
        ownerId: userId,
        imageBlobName: input.imageBlobName,
        imageContentType: input.imageContentType,
        participants: { create: { displayName: organizerName(user.name) } },
      },
      select: { participants: { select: { id: true } } },
    });
    return presentReceipt(await tx.receipt.update({
      where: { id: input.id },
      data: { organizerParticipantId: receipt.participants[0].id },
      select: receiptDetail,
    }));
  });
}

// The account name, trimmed to the roster's 50-character limit, or "You" when blank.
export function organizerName(name: string | null): string {
  const trimmed = name?.trim().slice(0, 50).trim();
  return trimmed ? trimmed : "You";
}
