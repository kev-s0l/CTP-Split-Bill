// Guest pick links: owner-issued per-participant tokens, the token-scoped
// projection, and guest pick writes. The token hash is the only scope on the
// guest side; no user identity is derived. See ADR-0015 and
// docs/specs/receipts/guest-picks.md.

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, type Prisma } from "@project/db";
import { ApiError } from "./errors";
import {
  lockOwnedDraft,
  lockReceiptForGuest,
  pickingPaused,
  receiptScope,
  requireReceiptUser,
} from "./receipt-access";
import { isBillSettled } from "./bills";
import { presentReceipt, receiptDetail } from "./receipt";
import { centsToMoney, toCents } from "./split";

type Db = Pick<typeof prisma, "participant" | "receipt">;
type Tx = Prisma.TransactionClient;

// 32 random bytes in base64url is always 43 characters; anything else can't
// be a token, so it 404s without touching the database.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const linkNotFound = () => new ApiError("NOT_FOUND", "Link not found", 404);

export function hashPickToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- Owner side --------------------------------------------------------------

async function setPickLink(
  userId: string,
  receiptId: string,
  participantId: string,
  data: Prisma.ParticipantUpdateManyMutationInput,
) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  if (typeof participantId !== "string" || participantId.trim() === "") {
    throw new ApiError("NOT_FOUND", "Participant not found", 404);
  }
  // Any receipt state: the owner can still rotate or revoke after finalize.
  // The receipt revision is left alone because receipt content is unchanged.
  const updated = await prisma.participant.updateMany({
    where: { id: participantId, receiptId, receipt: scope },
    data,
  });
  if (updated.count === 0) {
    const receipt = await prisma.receipt.findFirst({
      where: scope,
      select: { id: true },
    });
    throw new ApiError(
      "NOT_FOUND",
      receipt ? "Participant not found" : "Receipt not found",
      404,
    );
  }
}

// Issues a new token, replacing (and so invalidating) any earlier one.
// The raw token is returned here once and never stored.
export async function issuePickLink(
  userId: string,
  receiptId: string,
  participantId: string,
): Promise<string> {
  // The organizer's own row never gets a link (ADR-0018). Its id is fixed at
  // creation, so checking before the write can't race.
  if (typeof receiptId === "string" && receiptId.trim() !== "") {
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, ownerId: userId, deletedAt: null },
      select: { organizerParticipantId: true },
    });
    if (receipt && receipt.organizerParticipantId === participantId) {
      throw new ApiError("INVALID_INPUT", "You can't send yourself a pick link", 400);
    }
  }
  const token = randomBytes(32).toString("base64url");
  await setPickLink(userId, receiptId, participantId, {
    pickTokenHash: hashPickToken(token),
  });
  return token;
}

export async function revokePickLink(
  userId: string,
  receiptId: string,
  participantId: string,
) {
  await setPickLink(userId, receiptId, participantId, {
    pickTokenHash: null,
    picksSubmittedAt: null,
  });
}

// --- Guest side --------------------------------------------------------------

// Unknown, revoked, rotated, removed-participant, deleted-receipt and parsing
// receipts all land on the same 404.
async function findHolder(db: Db, token: unknown) {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw linkNotFound();
  const holder = await db.participant.findFirst({
    where: {
      pickTokenHash: hashPickToken(token),
      receipt: { deletedAt: null, parseStatus: { not: "PARSING" } },
    },
    select: {
      id: true,
      receiptId: true,
      receipt: { select: { status: true, picksOpenedAt: true } },
    },
  });
  if (!holder) throw linkNotFound();
  return holder;
}

// Explicit projection: phones, emails, owner, blob names, extraction and
// token hashes are never selected, so they cannot leak into a token response.
const pickReceipt = {
  status: true,
  revision: true,
  picksOpenedAt: true,
  merchantName: true,
  purchasedAt: true,
  currency: true,
  paidByParticipantId: true,
  participants: {
    select: { id: true, displayName: true, picksSubmittedAt: true },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  },
  items: {
    select: {
      id: true,
      lineNumber: true,
      name: true,
      quantity: true,
      totalPrice: true,
      assignedParticipantId: true,
      sharedAllocations: {
        select: { participantId: true },
        orderBy: [{ participant: { joinedAt: "asc" } }, { participantId: "asc" }],
      },
    },
    orderBy: { lineNumber: "asc" },
  },
  bills: { select: { participantId: true, amountOwed: true, paidAt: true } },
} satisfies Prisma.ReceiptSelect;

const pickersOf = (item: {
  assignedParticipantId: string | null;
  sharedAllocations: { participantId: string }[];
}) =>
  item.assignedParticipantId !== null
    ? [item.assignedParticipantId]
    : item.sharedAllocations.map((allocation) => allocation.participantId);

async function projectPicks(db: Db, receiptId: string, holderId: string) {
  const receipt = await db.receipt.findUniqueOrThrow({
    where: { id: receiptId },
    select: pickReceipt,
  });
  const holder = receipt.participants.find((p) => p.id === holderId);
  const base = {
    status: receipt.status,
    revision: receipt.revision,
    merchantName: receipt.merchantName,
    purchasedAt: receipt.purchasedAt,
    currency: receipt.currency,
    participantId: holderId,
    picksSubmittedAt: holder?.picksSubmittedAt ?? null,
    items: receipt.items.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      name: item.name,
      quantity: item.quantity,
      totalPrice: item.totalPrice,
      pickedBy: pickersOf(item),
    })),
  };
  if (receipt.status !== "FINALIZED") {
    return {
      ...base,
      pickingOpen: receipt.picksOpenedAt !== null,
      participants: receipt.participants.map(({ id, displayName }) => ({ id, displayName })),
    };
  }
  // Same amounts and settled rule as the owner's bill list (bills/list.md).
  const bills = new Map(receipt.bills.map((bill) => [bill.participantId, bill]));
  const payer = receipt.participants.find(
    (p) => p.id === receipt.paidByParticipantId,
  );
  return {
    ...base,
    paidBy: payer?.displayName ?? null,
    participants: receipt.participants.map(({ id, displayName }) => {
      const bill = bills.get(id);
      const owed = bill ? toCents(bill.amountOwed.toString()) : 0n;
      return {
        id,
        displayName,
        amountOwed: centsToMoney(owed),
        settled: bill
          ? isBillSettled(bill, owed, receipt.paidByParticipantId)
          : true,
      };
    }),
  };
}

// GET has no side effects, so link previews from messaging apps change nothing.
export async function getPicks(token: string) {
  const holder = await findHolder(prisma, token);
  return projectPicks(prisma, holder.receiptId, holder.id);
}

const itemId = z.string().trim().min(1).max(200);
export const ReplacePicks = z.object({
  itemIds: z
    .array(itemId)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Items must be unique"),
});
export type ReplacePicksInput = z.infer<typeof ReplacePicks>;

// Moves one holder's rows to match their complete pick set, under a receipt
// row lock the caller already holds. Shared by guest picks and the
// organizer's own picks (ADR-0018). Other participants' picks never move.
async function reconcileHolderPicks(
  tx: Tx,
  receiptId: string,
  holderId: string,
  itemIds: string[],
) {
  const receipt = await tx.receipt.findUniqueOrThrow({
    where: { id: receiptId },
    select: {
      splitMode: true,
      items: {
        select: {
          id: true,
          assignedParticipantId: true,
          sharedAllocations: { select: { participantId: true } },
        },
      },
    },
  });
  const onReceipt = new Set(receipt.items.map((item) => item.id));
  if (itemIds.some((id) => !onReceipt.has(id))) {
    throw new ApiError("NOT_FOUND", "Item not found", 404);
  }

  const wanted = new Set(itemIds);
  let shared = false;
  for (const item of receipt.items) {
    const pickers = pickersOf(item);
    const had = pickers.includes(holderId);
    if (had === wanted.has(item.id)) continue;
    const next = had
      ? pickers.filter((id) => id !== holderId)
      : [...pickers, holderId];
    // One picker is an individual assignment; two or more share equally.
    await tx.sharedItemAllocation.deleteMany({
      where: { receiptId, itemId: item.id },
    });
    await tx.receiptItem.update({
      where: { id: item.id },
      data: { assignedParticipantId: next.length === 1 ? next[0] : null },
    });
    if (next.length >= 2) {
      shared = true;
      await tx.sharedItemAllocation.createMany({
        data: next.map((participantId) => ({
          receiptId,
          itemId: item.id,
          participantId,
        })),
      });
    }
  }

  // Modes only move forward: EVEN -> ITEMIZED on a pick, -> SHARED_ITEMS on a share.
  let splitMode = receipt.splitMode;
  if (splitMode === "EVEN" && wanted.size > 0) splitMode = "ITEMIZED";
  if (shared) splitMode = "SHARED_ITEMS";
  if (splitMode !== receipt.splitMode) {
    await tx.receipt.update({
      where: { id: receiptId },
      data: { splitMode },
    });
  }
}

// The holder's complete pick set. Only the holder's rows move; other
// participants' picks are never removed by a guest write.
export async function replacePicks(token: string, input: ReplacePicksInput) {
  const found = await findHolder(prisma, token);
  return prisma.$transaction(async (tx) => {
    await lockReceiptForGuest(tx, found.receiptId);
    // Re-check under the lock: the link may have been rotated or the
    // participant removed while this write waited.
    const holder = await findHolder(tx, token);
    await reconcileHolderPicks(tx, holder.receiptId, holder.id, input.itemIds);

    // Editing picks means the holder is no longer done.
    await tx.participant.update({
      where: { id: holder.id },
      data: { picksSubmittedAt: null },
    });
    // reviewedAt is kept: receipt content is unchanged.
    return projectPicks(tx, holder.receiptId, holder.id);
  });
}

function assertGuestCanWrite(receipt: { status: string; picksOpenedAt: Date | null }) {
  if (receipt.status === "FINALIZED") {
    throw new ApiError("CONFLICT", "Receipt is finalized", 409);
  }
  if (receipt.picksOpenedAt === null) throw pickingPaused();
}

// Idempotent: a second press keeps the first time. No revision change, since
// only the holder's own done flag moves.
export async function markPicksDone(token: string) {
  const holder = await findHolder(prisma, token);
  assertGuestCanWrite(holder.receipt);
  const updated = await prisma.participant.updateMany({
    where: {
      id: holder.id,
      pickTokenHash: hashPickToken(token),
      picksSubmittedAt: null,
      receipt: {
        deletedAt: null,
        status: "DRAFT",
        parseStatus: { not: "PARSING" },
        picksOpenedAt: { not: null },
      },
    },
    data: { picksSubmittedAt: new Date() },
  });
  if (updated.count === 0) {
    // Already done, or the link, receipt or mode changed in between: re-check.
    assertGuestCanWrite((await findHolder(prisma, token)).receipt);
  }
  return projectPicks(prisma, holder.receiptId, holder.id);
}

// --- Picking switch and the organizer's own picks ----------------------------

export const SetPicking = z.object({ open: z.boolean() });
export type SetPickingInput = z.infer<typeof SetPicking>;

// Opens or pauses picking (ADR-0017). No expected revision, and the revision
// is left alone: receipt content is unchanged, so no owner draft goes stale.
export async function setPicking(
  userId: string,
  receiptId: string,
  input: SetPickingInput,
) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    // Pausing waits here behind any guest write already holding the lock.
    await lockOwnedDraft(tx, userId, receiptId, false);
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: { reviewedAt: true, picksOpenedAt: true, organizerParticipantId: true },
    });
    let picksOpenedAt: Date | null = null;
    if (input.open) {
      if (receipt.reviewedAt === null) {
        throw new ApiError("CONFLICT", "Review the receipt before opening picking", 409);
      }
      const pickers = await tx.participant.count({
        where: {
          receiptId,
          ...(receipt.organizerParticipantId
            ? { id: { not: receipt.organizerParticipantId } }
            : {}),
        },
      });
      if (pickers === 0) {
        throw new ApiError("CONFLICT", "Add someone to pick before opening picking", 409);
      }
      // Opening an open receipt keeps when it was opened.
      picksOpenedAt = receipt.picksOpenedAt ?? new Date();
    }
    // Switching modes clears no picks and no done state.
    return presentReceipt(await tx.receipt.update({
      where: { id: receiptId },
      data: { picksOpenedAt },
      select: receiptDetail,
    }));
  });
}

// The organizer's complete pick set for their own row (ADR-0018). Works in
// either mode, since it moves only the organizer's rows, and takes no
// expected revision, like a guest's. The organizer has no done state.
export async function replaceOrganizerPicks(
  userId: string,
  receiptId: string,
  input: ReplacePicksInput,
) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockOwnedDraft(tx, userId, receiptId, true);
    const { organizerParticipantId } = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: { organizerParticipantId: true },
    });
    if (organizerParticipantId === null) {
      throw new ApiError("CONFLICT", "You aren't on this receipt", 409);
    }
    await reconcileHolderPicks(tx, receiptId, organizerParticipantId, input.itemIds);
    return presentReceipt(await tx.receipt.findFirstOrThrow({
      where: scope,
      select: receiptDetail,
    }));
  });
}
