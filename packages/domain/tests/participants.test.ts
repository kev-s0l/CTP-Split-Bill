// Receipt-local contacts, payer selection and owner-only access against PGlite.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@project/db";
import { finalizeReceipt, getReceipt, listReceiptBills, updateReceipt } from "../src";

const ownerId = "participant-owner";
const otherId = "participant-other";
const phone = "+12125550123";

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: ownerId, name: "Owner", email: "participant-owner@example.com" },
    { id: otherId, name: "Sam", email: "participant-other@example.com", phone },
  ] });
});

function receiptFor(userId = ownerId) {
  return prisma.receipt.create({
    data: {
      ownerId: userId, imageBlobName: "participants.jpg", imageContentType: "image/jpeg",
      parseStatus: "SUCCEEDED", reviewedAt: new Date(0),
      subtotal: "12.00", tax: "0.00", tip: "0.00", total: "12.00",
      participants: { create: [
        { displayName: "Sam", phone, joinedAt: new Date(0) },
        { displayName: "Sam", phone, joinedAt: new Date(1000) },
      ] },
      items: { create: {
        lineNumber: 1, name: "Ramen", quantity: "1", unitPrice: "12.00",
        totalPrice: "12.00", isVerified: true,
      } },
    },
    include: { participants: { orderBy: { joinedAt: "asc" } } },
  });
}

describe("receipt participants", () => {
  it("returns distinct contacts with repeated names and phones and no account relation", async () => {
    const receipt = await receiptFor();
    const detail = await getReceipt(ownerId, receipt.id);

    expect(detail.participants).toEqual(receipt.participants.map(({ id, displayName, phone, joinedAt }) => ({
      id, displayName, phone, joinedAt,
    })));
    expect(new Set(detail.participants.map((participant) => participant.id)).size).toBe(2);
    expect(detail.participants.map((participant) => Object.keys(participant).sort())).toEqual([
      ["displayName", "id", "joinedAt", "phone"], ["displayName", "id", "joinedAt", "phone"],
    ]);
  });

  it("keeps the same contact's participant IDs separate on different receipts", async () => {
    const first = await receiptFor();
    const second = await receiptFor();
    const firstDetail = await getReceipt(ownerId, first.id);
    const secondDetail = await getReceipt(ownerId, second.id);

    expect(firstDetail.participants.map((participant) => participant.id)).toEqual(first.participants.map((participant) => participant.id));
    expect(secondDetail.participants.map((participant) => participant.id)).toEqual(second.participants.map((participant) => participant.id));
    expect(new Set([...firstDetail.participants, ...secondDetail.participants].map((participant) => participant.id)).size).toBe(4);
  });

  it("allows contacts without phone numbers or accounts", async () => {
    const receipt = await receiptFor();
    const guest = await prisma.participant.create({ data: { receiptId: receipt.id, displayName: "Guest" } });

    expect((await getReceipt(ownerId, receipt.id)).participants).toContainEqual({
      id: guest.id, displayName: "Guest", phone: null, joinedAt: guest.joinedAt,
    });
  });

  it("does not grant read or payer-edit access to an account matching a contact's phone", async () => {
    const receipt = await receiptFor();
    const before = await getReceipt(ownerId, receipt.id);

    await expect(getReceipt(otherId, receipt.id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(updateReceipt(otherId, receipt.id, {
      expectedRevision: 1, paidByParticipantId: receipt.participants[0].id,
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await getReceipt(ownerId, receipt.id)).toEqual(before);
  });

  it("requires an existing user to read contacts or choose a payer", async () => {
    const receipt = await receiptFor();
    const before = await getReceipt(ownerId, receipt.id);

    await expect(getReceipt("missing-user", receipt.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(updateReceipt("missing-user", receipt.id, {
      expectedRevision: 1, paidByParticipantId: receipt.participants[0].id,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(await getReceipt(ownerId, receipt.id)).toEqual(before);
  });

  it("sets and clears a local payer without changing the roster or amounts", async () => {
    const receipt = await receiptFor();
    const before = await getReceipt(ownerId, receipt.id);
    const paid = await updateReceipt(ownerId, receipt.id, {
      expectedRevision: 1, paidByParticipantId: receipt.participants[0].id,
    });

    expect(paid).toEqual({ ...before, paidByParticipantId: receipt.participants[0].id, revision: 2, updatedAt: expect.any(Date) });
    const cleared = await updateReceipt(ownerId, receipt.id, { expectedRevision: 2, paidByParticipantId: null });
    expect(cleared).toEqual({ ...before, revision: 3, updatedAt: expect.any(Date) });
  });

  it.each([ownerId, otherId])("rejects a payer from another receipt owned by %s and rolls back the revision", async (userId) => {
    const receipt = await receiptFor();
    const other = await receiptFor(userId);
    const before = await getReceipt(ownerId, receipt.id);

    await expect(updateReceipt(ownerId, receipt.id, {
      expectedRevision: 1, paidByParticipantId: other.participants[0].id,
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await getReceipt(ownerId, receipt.id)).toEqual(before);
  });

  it("rejects an unknown payer without changing the receipt", async () => {
    const receipt = await receiptFor();
    const before = await getReceipt(ownerId, receipt.id);

    await expect(updateReceipt(ownerId, receipt.id, {
      expectedRevision: 1, paidByParticipantId: "missing-participant",
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await getReceipt(ownerId, receipt.id)).toEqual(before);
  });

  it("hides contacts and rejects payer changes on soft-deleted receipts", async () => {
    const receipt = await receiptFor();
    await prisma.receipt.update({ where: { id: receipt.id }, data: { deletedAt: new Date() } });
    const before = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { participants: true } });

    await expect(getReceipt(ownerId, receipt.id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(updateReceipt(ownerId, receipt.id, {
      expectedRevision: 1, paidByParticipantId: receipt.participants[0].id,
    })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { participants: true } })).toEqual(before);
  });

  it("finalizes separate bills for repeated contacts and settles only the selected payer", async () => {
    const receipt = await receiptFor();
    const payerId = receipt.participants[0].id;
    await updateReceipt(ownerId, receipt.id, { expectedRevision: 1, paidByParticipantId: payerId });
    await finalizeReceipt(ownerId, receipt.id, { expectedRevision: 2 });

    const bills = await listReceiptBills(ownerId, receipt.id);
    expect(bills).toHaveLength(2);
    expect(bills.map(({ receiptId, participantId, amountOwed, settled, outstandingAmount }) => ({
      receiptId, participantId, amountOwed, settled, outstandingAmount,
    }))).toEqual(receipt.participants.map((participant) => ({
      receiptId: receipt.id, participantId: participant.id, amountOwed: "6.00",
      settled: participant.id === payerId, outstandingAmount: participant.id === payerId ? "0.00" : "6.00",
    })));
    await expect(listReceiptBills(otherId, receipt.id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
