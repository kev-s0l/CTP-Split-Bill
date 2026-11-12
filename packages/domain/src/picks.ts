// Guest pick links: owner-issued per-participant tokens, the token-scoped
// projection, and guest pick writes. The token hash is the only scope on the
// guest side; no user identity is derived. See ADR-0015 and
// docs/specs/receipts/guest-picks.md.

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, type Prisma } from "@project/db";
import { ApiError } from "./errors";
import {
  lockReceiptForGuest,
  receiptScope,
  requireReceiptUser,
} from "./receipt-access";
import { isBillSettled } from "./bills";
import { centsToMoney, toCents } from "./split";

type Db = Pick<typeof prisma, "participant" | "receipt">;

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
    select: { id: true, receiptId: true, receipt: { select: { status: true } } },
  });
  if (!holder) throw linkNotFound();
  return holder;
}

// Explicit projection: phones, emails, owner, blob names, extraction and
// token hashes are never selected, so they cannot leak into a token response.
const pickReceipt = {
  status: true,
  revision: true,
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

// The holder's complete pick set. Only the holder's rows move; other
// participants' picks are never removed by a guest write.
export async function replacePicks(token: string, input: ReplacePicksInput) {
  const found = await findHolder(prisma, token);
  return prisma.$transaction(async (tx) => {
    await lockReceiptForGuest(tx, found.receiptId);
    // Re-check under the lock: the link may have been rotated or the
    // participant removed while this write waited.
    const holder = await findHolder(tx, token);
    const receipt = await tx.receipt.findUniqueOrThrow({
      where: { id: holder.receiptId },
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
    if (input.itemIds.some((id) => !onReceipt.has(id))) {
      throw new ApiError("NOT_FOUND", "Item not found", 404);
    }

    const wanted = new Set(input.itemIds);
    let shared = false;
    for (const item of receipt.items) {
      const pickers = pickersOf(item);
      const had = pickers.includes(holder.id);
      if (had === wanted.has(item.id)) continue;
      const next = had
        ? pickers.filter((id) => id !== holder.id)
        : [...pickers, holder.id];
      // One picker is an individual assignment; two or more share equally.
      await tx.sharedItemAllocation.deleteMany({
        where: { receiptId: holder.receiptId, itemId: item.id },
      });
      await tx.receiptItem.update({
        where: { id: item.id },
        data: { assignedParticipantId: next.length === 1 ? next[0] : null },
      });
      if (next.length >= 2) {
        shared = true;
        await tx.sharedItemAllocation.createMany({
          data: next.map((participantId) => ({
            receiptId: holder.receiptId,
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
        where: { id: holder.receiptId },
        data: { splitMode },
      });
    }

    // Editing picks means the holder is no longer done.
    await tx.participant.update({
      where: { id: holder.id },
      data: { picksSubmittedAt: null },
    });
    // reviewedAt is kept: receipt content is unchanged.
    return projectPicks(tx, holder.receiptId, holder.id);
  });
}

// Idempotent: a second press keeps the first time. No revision change, since
// only the holder's own done flag moves.
export async function markPicksDone(token: string) {
  const holder = await findHolder(prisma, token);
  if (holder.receipt.status === "FINALIZED") {
    throw new ApiError("CONFLICT", "Receipt is finalized", 409);
  }
  const updated = await prisma.participant.updateMany({
    where: {
      id: holder.id,
      pickTokenHash: hashPickToken(token),
      picksSubmittedAt: null,
      receipt: { deletedAt: null, status: "DRAFT", parseStatus: { not: "PARSING" } },
    },
    data: { picksSubmittedAt: new Date() },
  });
  if (updated.count === 0) {
    // Already done, or the link/receipt changed in between: re-check.
    const again = await findHolder(prisma, token);
    if (again.receipt.status === "FINALIZED") {
      throw new ApiError("CONFLICT", "Receipt is finalized", 409);
    }
  }
  return projectPicks(prisma, holder.receiptId, holder.id);
}
