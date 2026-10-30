import { prisma } from "@project/db";
import { ApiError } from "./errors";

export type ReceiptDb = Pick<typeof prisma, "receipt">;

export function receiptScope(userId: string, receiptId: string) {
  return {
    id: receiptId,
    deletedAt: null,
    party: { deletedAt: null, members: { some: { userId } } },
  };
}

export async function requireReceiptUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);
}

export async function lockEditableReceipt(db: ReceiptDb, userId: string, receiptId: string) {
  const scope = receiptScope(userId, receiptId);
  // The no-op write checks state and holds the parent row lock until commit.
  const locked = await db.receipt.updateMany({
    where: { ...scope, status: { not: "FINALIZED" } },
    data: { id: receiptId },
  });
  if (locked.count === 0) {
    const receipt = await db.receipt.findFirst({ where: scope, select: { id: true } });
    if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
    throw new ApiError("CONFLICT", "Receipt is finalized", 409);
  }
}
