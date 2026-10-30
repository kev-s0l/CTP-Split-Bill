// Parties: validation and queries. Every query is scoped by the caller's user id;
// membership (a PartyMember row) is the access check — docs/specs/api.md.

import { z } from "zod";
import { prisma } from "@project/db";
import { ApiError } from "./errors";

export const CreateParty = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
});
export type CreatePartyInput = z.infer<typeof CreateParty>;

// shareToken is deliberately left out: it is a capability, not display data.
const partySummary = {
  id: true,
  name: true,
  organizerId: true,
  createdAt: true,
} as const;

export function listParties(userId: string) {
  return prisma.party.findMany({
    where: { deletedAt: null, members: { some: { userId } } },
    select: partySummary,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

// Unknown, foreign, and soft-deleted parties are one 404 — docs/specs/parties/detail.md.
export async function getParty(userId: string, partyId: string) {
  const party = await prisma.party.findFirst({
    where: { id: partyId, deletedAt: null, members: { some: { userId } } },
    select: {
      ...partySummary,
      members: {
        select: { id: true, userId: true, displayName: true, joinedAt: true },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!party) throw new ApiError("NOT_FOUND", "Party not found", 404);
  return party;
}

export async function createParty(userId: string, input: CreatePartyInput) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new ApiError("UNAUTHENTICATED", "Unknown user", 401);

  // Nested create: the party and the organizer's membership land in one transaction.
  return prisma.party.create({
    data: {
      name: input.name,
      organizerId: userId,
      members: { create: { userId, displayName: user.name } },
    },
    select: partySummary,
  });
}
