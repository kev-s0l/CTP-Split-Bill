// Draft roster writes: who is splitting a receipt, with optional phone or email.
// Uses the same owner/DRAFT/revision lock as every other draft mutation.
// See docs/specs/receipts/participants.md.

import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";
import {
  lockEditableReceipt,
  receiptScope,
  requireReceiptUser,
} from "./receipt-access";
import { ExpectedRevision, presentReceipt, receiptDetail } from "./receipt";

// US numbers may skip the +1; anything else must start with + and a country code.
// The spec allows parentheses, spaces, and hyphens, but strips them out in the string.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

// One address, local@domain, no spaces; trimmed and lowercased for storage.
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

// checks request body for 50 characters or less, no duplicate ids, and valid phone numbers.
// Returns a normalized phone number or null.
export const ReplaceParticipants = ExpectedRevision.extend({
  participants: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        displayName: z.string().max(200).optional(),
        phone: z.string().max(32).optional(),
        email: z.string().max(320).optional(),
      }),
    )
    .min(1, "Add at least one person")
    .max(50, "A receipt can have at most 50 people"),
}).superRefine((input, ctx) => {
  const ids = new Set<string>();
  input.participants.forEach((p, i) => {
    if (p.id !== undefined) {
      if (ids.has(p.id))
        ctx.addIssue({
          code: "custom",
          path: ["participants", i, "id"],
          message: "Duplicate participant id",
        });
      ids.add(p.id);
    }
    if (p.displayName !== undefined && p.displayName.trim().length > 50) {
      ctx.addIssue({
        code: "custom",
        path: ["participants", i, "displayName"],
        message: "Name must be 50 characters or fewer",
      });
    }
    // Spec wording: the message names the field, not the row.
    if (
      p.phone !== undefined &&
      p.phone.trim() !== "" &&
      normalizePhone(p.phone) === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Enter a valid phone number",
      });
    }
    if (
      p.email !== undefined &&
      p.email.trim() !== "" &&
      normalizeEmail(p.email) === null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter a valid email address",
      });
    }
  });
});
export type ReplaceParticipantsInput = z.infer<typeof ReplaceParticipants>;

export async function replaceReceiptParticipants(
  userId: string,
  receiptId: string,
  input: ReplaceParticipantsInput,
) {
  await requireReceiptUser(userId);
  const scope = receiptScope(userId, receiptId);
  return prisma.$transaction(async (tx) => {
    await lockEditableReceipt(tx, userId, receiptId, input.expectedRevision);

    const current = await tx.participant.findMany({
      where: { receiptId },
      select: {
        id: true,
        joinedAt: true,
        _count: { select: { assignedItems: true, sharedAllocations: true } },
      },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    });
    const currentIds = new Set(current.map((p) => p.id));

    // An id we don't own on this receipt looks the same as one that doesn't exist.
    for (const p of input.participants) {
      if (p.id !== undefined && !currentIds.has(p.id)) {
        throw new ApiError("NOT_FOUND", "Participant not found", 404);
      }
    }

    // Removing someone who still owns money on the receipt would orphan it.
    const kept = new Set(
      input.participants.flatMap((p) => (p.id ? [p.id] : [])),
    );
    const removed = current.filter((p) => !kept.has(p.id));
    const receipt = await tx.receipt.findFirstOrThrow({
      where: scope,
      select: { paidByParticipantId: true },
    });
    for (const p of removed) {
      if (p.id === receipt.paidByParticipantId) {
        throw new ApiError(
          "CONFLICT",
          "Choose a different payer before removing this person",
          409,
        );
      }
      if (p._count.assignedItems > 0 || p._count.sharedAllocations > 0) {
        throw new ApiError(
          "CONFLICT",
          "Unassign this person's items before removing them",
          409,
        );
      }
    }
    if (removed.length) {
      await tx.participant.deleteMany({
        where: { receiptId, id: { in: removed.map((p) => p.id) } },
      });
    }

    // joinedAt is the display order, so rewrite it to match the order sent.
    const base = current[0]?.joinedAt.getTime() ?? Date.now();
    for (const [i, p] of input.participants.entries()) {
      const displayName = p.displayName?.trim() || `Guest ${i + 1}`;
      // Omitted phone keeps what's stored; "" clears it.
      const phone =
        p.phone === undefined
          ? undefined
          : p.phone.trim() === ""
            ? null
            : normalizePhone(p.phone);
      // Same rule for email: omitted keeps it, "" clears it.
      const email =
        p.email === undefined
          ? undefined
          : p.email.trim() === ""
            ? null
            : normalizeEmail(p.email);
      const data = { displayName, phone, email, joinedAt: new Date(base + i) };
      if (p.id) await tx.participant.update({ where: { id: p.id }, data });
      else
        await tx.participant.create({
          data: { receiptId, ...data, phone: phone ?? null, email: email ?? null },
        });
    }

    // Names, phones and emails don't change what was reviewed, so reviewedAt is kept.
    // Removed participants' pick-token hashes went with their rows: the link is revoked.
    return presentReceipt(await tx.receipt.findFirstOrThrow({ where: scope, select: receiptDetail }));
  });
}
