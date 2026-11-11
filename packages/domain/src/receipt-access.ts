import { prisma } from "@project/db";
import { ApiError } from "./errors";

export type ReceiptDb = Pick<typeof prisma, "receipt">;

export function receiptScope(userId: string, receiptId: string) {
  // Undefined Prisma filters are omitted; never let a missing route id widen a query.
  if (typeof receiptId !== "string" || receiptId.trim() === "") {
    throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  }
  return {
    id: receiptId,
    ownerId: userId,
    deletedAt: null,
  };
}

export async function requireReceiptUser(userId: string) {
  if (typeof userId !== "string" || userId === "") {
    throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
}

export async function lockEditableReceipt(
  db: ReceiptDb,
  userId: string,
  receiptId: string,
  expectedRevision: number,
) {
  const scope = receiptScope(userId, receiptId);
  // Advancing revision both rejects stale writes and holds the parent row lock.
  const locked = await db.receipt.updateMany({
    where: {
      ...scope,
      status: "DRAFT",
      parseStatus: { not: "PARSING" },
      revision: expectedRevision,
    },
    data: { revision: { increment: 1 } },
  });
  if (locked.count === 0) {
    const receipt = await db.receipt.findFirst({
      where: scope,
      select: { status: true, parseStatus: true },
    });
    if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
    if (receipt.status === "FINALIZED")
      throw new ApiError("CONFLICT", "Receipt is finalized", 409);
    if (receipt.parseStatus === "PARSING")
      throw new ApiError("CONFLICT", "Receipt is parsing", 409);
    throw new ApiError(
      "CONFLICT",
      "Receipt has changed; reload before saving",
      409,
    );
  }
}

// Guest pick writes (ADR-0015): the same DRAFT/not-PARSING guard, row lock and
// revision advance as lockEditableReceipt, but the pick token is the scope, so
// there is no owner, and guests write only their own rows, so no expected revision.
// A receipt that vanished or started parsing is the same 404 as a bad token.
export async function lockReceiptForGuest(db: ReceiptDb, receiptId: string) {
  const live = { id: receiptId, deletedAt: null, parseStatus: { not: "PARSING" as const } };
  const locked = await db.receipt.updateMany({
    where: { ...live, status: "DRAFT" },
    data: { revision: { increment: 1 } },
  });
  if (locked.count === 0) {
    const receipt = await db.receipt.findFirst({ where: live, select: { status: true } });
    if (receipt?.status === "FINALIZED")
      throw new ApiError("CONFLICT", "Receipt is finalized", 409);
    throw new ApiError("NOT_FOUND", "Link not found", 404);
  }
}
