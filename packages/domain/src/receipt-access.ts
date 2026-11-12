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
      // Picking and editing lock each other out (ADR-0017).
      picksOpenedAt: null,
      revision: expectedRevision,
    },
    data: { revision: { increment: 1 } },
  });
  if (locked.count === 0) {
    const receipt = await db.receipt.findFirst({
      where: scope,
      select: { status: true, parseStatus: true, picksOpenedAt: true },
    });
    if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
    if (receipt.status === "FINALIZED")
      throw new ApiError("CONFLICT", "Receipt is finalized", 409);
    if (receipt.parseStatus === "PARSING")
      throw new ApiError("CONFLICT", "Receipt is parsing", 409);
    // Before the revision check: pausing is what the owner can act on.
    if (receipt.picksOpenedAt !== null) throw pickingOpen();
    throw new ApiError(
      "CONFLICT",
      "Receipt has changed; reload before saving",
      409,
    );
  }
}

export const pickingOpen = () =>
  new ApiError("CONFLICT", "Pause picking to make changes", 409);
export const pickingPaused = () =>
  new ApiError("CONFLICT", "The organizer is making changes", 409);

// Guest pick writes (ADR-0015): the same DRAFT/not-PARSING guard, row lock and
// revision advance as lockEditableReceipt, but the pick token is the scope, so
// there is no owner, and guests write only their own rows, so no expected revision.
// It requires picking open, where lockEditableReceipt requires it paused (ADR-0017).
// A receipt that vanished or started parsing is the same 404 as a bad token.
// advanceRevision is false for done, which advances it only when the flag
// actually changes; setting revision to itself still takes the row lock.
export async function lockReceiptForGuest(db: ReceiptDb, receiptId: string, advanceRevision = true) {
  const live = { id: receiptId, deletedAt: null, parseStatus: { not: "PARSING" as const } };
  const locked = await db.receipt.updateMany({
    where: { ...live, status: "DRAFT", picksOpenedAt: { not: null } },
    data: { revision: { increment: advanceRevision ? 1 : 0 } },
  });
  if (locked.count === 0) {
    const receipt = await db.receipt.findFirst({ where: live, select: { status: true } });
    if (receipt?.status === "FINALIZED")
      throw new ApiError("CONFLICT", "Receipt is finalized", 409);
    // The token is still good; only the mode is wrong, so this is not the 404.
    if (receipt) throw pickingPaused();
    throw new ApiError("NOT_FOUND", "Link not found", 404);
  }
}

// Owner writes that take no expected revision and work in either mode: the
// organizer's own picks (ADR-0018) and the picking switch. Same row lock.
// advanceRevision is false for the switch, which leaves receipt content alone.
export async function lockOwnedDraft(
  db: ReceiptDb,
  userId: string,
  receiptId: string,
  advanceRevision: boolean,
) {
  const scope = receiptScope(userId, receiptId);
  // Setting revision to itself still takes the row lock.
  const locked = await db.receipt.updateMany({
    where: { ...scope, status: "DRAFT", parseStatus: { not: "PARSING" } },
    data: { revision: { increment: advanceRevision ? 1 : 0 } },
  });
  if (locked.count === 0) {
    const receipt = await db.receipt.findFirst({ where: scope, select: { status: true } });
    if (!receipt) throw new ApiError("NOT_FOUND", "Receipt not found", 404);
    if (receipt.status === "FINALIZED")
      throw new ApiError("CONFLICT", "Receipt is finalized", 409);
    throw new ApiError("CONFLICT", "Receipt is parsing", 409);
  }
}
