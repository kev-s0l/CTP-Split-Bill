import { prisma } from "@project/db";
import { ApiError } from "./errors";

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

  return prisma.receipt.findFirst({
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

    include: {
      recieptItems: {
        orderBy: {
          lineNumber: "asc",
        },
      },
    },
  });

  if (!receipt) {
    throw new ApiError("NOT_FOUND", "Receipt not found", 404);
  }

  return receipt;
}