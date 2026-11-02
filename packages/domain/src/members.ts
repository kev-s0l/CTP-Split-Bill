// Party members: adding and removing the people in a split. For the Organizer-only.
// Membership is the access check; non-members get 404, members who aren't the
// organizer get 403 — see docs/specs/parties/members.md, docs/specs/api.md.

import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";

export const AddMember = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(50, "Display name must be 50 characters or fewer"),
  userId: z.string().trim().min(1, "userId must not be empty").optional(), // absent = guest
});
export type AddMemberInput = z.infer<typeof AddMember>;

const memberSummary = {
  id: true,
  partyId: true,
  userId: true,
  displayName: true,
  joinedAt: true,
} as const;

// Load the live party the caller belongs to and checks they organize it.
// Unknown, deleted, or foreign party = 404; member but not organizer gets 403.
export async function requireOrganizer(userId: string, partyId: string) {
  const party = await prisma.party.findFirst({
    where: { id: partyId, deletedAt: null, members: { some: { userId } } },
    select: { id: true, organizerId: true },
  });
  if (!party) throw new ApiError("NOT_FOUND", "Party not found", 404);
  if (party.organizerId !== userId) {
    throw new ApiError("FORBIDDEN", "Only the party organizer can make that change!", 403);
  }
  return party;
}

export async function addMember(userId: string, partyId: string, input: AddMemberInput) {
  await requireOrganizer(userId, partyId);

  if (input.userId) {
    const exists = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!exists) throw new ApiError("INVALID_INPUT", "userId: Unknown user", 400);

    const already = await prisma.partyMember.findFirst({
      where: { partyId, userId: input.userId },
      select: { id: true },
    });
    if (already) throw new ApiError("CONFLICT", "That user is already in this party!", 409);
  }

  // The (partyId, userId) unique index still backstops a race between two adds.
  return prisma.partyMember.create({
    data: { partyId, userId: input.userId ?? null, displayName: input.displayName },
    select: memberSummary,
  });
}

export async function removeMember(userId: string, partyId: string, memberId: string) {
  const party = await requireOrganizer(userId, partyId);

  const member = await prisma.partyMember.findFirst({
    where: { id: memberId, partyId },
    select: {
      id: true,
      userId: true,
      _count: { select: { bills: true, paidReceipts: true } },
    },
  });
  if (!member) throw new ApiError("NOT_FOUND", "Member not found", 404);
  if (member.userId === party.organizerId) {
    throw new ApiError("CONFLICT", "The organizer can't be removed from their party", 409);
  }
  if (member._count.bills > 0 || member._count.paidReceipts > 0) {
    throw new ApiError("CONFLICT", "This member has bills or paid a receipt and can't be removed", 409);
  }

  // Shares reference the member, so they go first, in the same transaction.
  await prisma.$transaction([
    prisma.itemShare.deleteMany({ where: { memberId } }),
    prisma.partyMember.delete({ where: { id: memberId } }),
  ]);
}