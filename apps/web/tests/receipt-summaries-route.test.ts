import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "summary-owner" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
const { GET } = await import("../app/api/receipts/summary/route");

const request = () => GET();

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "summary-owner", name: "Owner", email: "summary-owner@example.com" },
    { id: "summary-foreign", name: "Foreign", email: "summary-foreign@example.com" },
    { id: "summary-empty-owner", name: "Empty", email: "summary-empty@example.com" },
  ], skipDuplicates: true });
});

beforeEach(async () => {
  identity.userId = "summary-owner";
  await prisma.receipt.updateMany({ where: { id: { startsWith: "summary-" } }, data: { paidByParticipantId: null } });
  await prisma.bill.deleteMany({ where: { receiptId: { startsWith: "summary-" } } });
  await prisma.receiptItem.deleteMany({ where: { receiptId: { startsWith: "summary-" } } });
  await prisma.participant.deleteMany({ where: { receiptId: { startsWith: "summary-" } } });
  await prisma.receipt.deleteMany({ where: { id: { startsWith: "summary-" } } });
  await prisma.receipt.create({ data: {
    id: "summary-draft", ownerId: "summary-owner", title: "Draft receipt",
    imageBlobName: "summary/draft.jpg", imageContentType: "image/jpeg",
    status: "DRAFT", total: "12.50", createdAt: new Date("2026-01-01T00:00:00Z"),
    participants: { create: [{ id: "summary-draft-payer", displayName: "Alex" }, { id: "summary-draft-other", displayName: "Sam" }] },
  } });
  await prisma.receipt.create({ data: {
    id: "summary-final", ownerId: "summary-owner", title: "Dinner",
    imageBlobName: "summary/final.jpg", imageContentType: "image/jpeg",
    status: "FINALIZED", subtotal: "10.00", tax: "0.00", tip: "0.00", total: "10.00",
    finalizedAt: new Date("2026-02-01T00:00:00Z"), createdAt: new Date("2026-02-01T00:00:00Z"),
    participants: { create: [{ id: "summary-final-payer", displayName: "Pat" }, { id: "summary-final-paid", displayName: "Lee" }, { id: "summary-final-zero", displayName: "Jo" }] },
    bills: { create: [
      { id: "summary-bill-payer", participantId: "summary-final-payer", subtotal: "5", taxShare: "0", tipShare: "0", amountOwed: "5" },
      { id: "summary-bill-paid", participantId: "summary-final-paid", subtotal: "5", taxShare: "0", tipShare: "0", amountOwed: "5", paidAt: new Date() },
      { id: "summary-bill-zero", participantId: "summary-final-zero", subtotal: "0", taxShare: "0", tipShare: "0", amountOwed: "0" },
    ] },
  } });
  await prisma.receipt.update({ where: { id: "summary-final" }, data: { paidByParticipantId: "summary-final-payer" } });
  await prisma.receipt.create({ data: {
    id: "summary-unpaid", ownerId: "summary-owner", title: "Unpaid",
    imageBlobName: "summary/unpaid.jpg", imageContentType: "image/jpeg",
    status: "FINALIZED", subtotal: "9.25", tax: "0.00", tip: "0.00", total: "9.25",
    finalizedAt: new Date("2026-03-01T00:00:00Z"), createdAt: new Date("2026-03-01T00:00:00Z"),
    participants: { create: { id: "summary-unpaid-person", displayName: "Kim" } },
    bills: { create: { id: "summary-unpaid-bill", participantId: "summary-unpaid-person", subtotal: "9.25", taxShare: "0", tipShare: "0", amountOwed: "9.25" } },
  } });
  await prisma.receipt.create({ data: {
    id: "summary-foreign-receipt", ownerId: "summary-foreign", title: "Private",
    imageBlobName: "summary/foreign.jpg", imageContentType: "image/jpeg",
  } });
  await prisma.receipt.createMany({ data: ["summary-tie-b", "summary-tie-a"].map((id) => ({
    id, ownerId: "summary-owner", title: id, imageBlobName: `${id}.jpg`,
    imageContentType: "image/jpeg", status: "DRAFT" as const,
    createdAt: new Date("2026-02-15T00:00:00Z"),
  })) });
  await prisma.receipt.create({ data: {
    id: "summary-no-bills", ownerId: "summary-owner", title: "No bills",
    imageBlobName: "summary/no-bills.jpg", imageContentType: "image/jpeg",
    status: "FINALIZED", subtotal: "1.00", tax: "0.00", tip: "0.00", total: "1.00",
    finalizedAt: new Date("2026-02-20T00:00:00Z"), createdAt: new Date("2026-02-20T00:00:00Z"),
  } });
});

describe("GET /api/receipts/summary", () => {
  it("returns only the owner's summaries newest first with raw values and participant counts", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: "summary-unpaid", status: "FINALIZED", merchantName: null, title: "Unpaid", total: "9.25", createdAt: "2026-03-01T00:00:00.000Z", payerName: null, participantCount: 1, settled: false },
      { id: "summary-no-bills", status: "FINALIZED", merchantName: null, title: "No bills", total: "1.00", createdAt: "2026-02-20T00:00:00.000Z", payerName: null, participantCount: 0, settled: null },
      { id: "summary-tie-a", status: "DRAFT", merchantName: null, title: "summary-tie-a", total: null, createdAt: "2026-02-15T00:00:00.000Z", payerName: null, participantCount: 0, settled: null },
      { id: "summary-tie-b", status: "DRAFT", merchantName: null, title: "summary-tie-b", total: null, createdAt: "2026-02-15T00:00:00.000Z", payerName: null, participantCount: 0, settled: null },
      { id: "summary-final", status: "FINALIZED", merchantName: null, title: "Dinner", total: "10.00", createdAt: "2026-02-01T00:00:00.000Z", payerName: "Pat", participantCount: 3, settled: true },
      { id: "summary-draft", status: "DRAFT", merchantName: null, title: "Draft receipt", total: "12.50", createdAt: "2026-01-01T00:00:00.000Z", payerName: null, participantCount: 2, settled: null },
    ]);
  });

  it("excludes soft-deleted receipts", async () => {
    await prisma.receipt.update({ where: { id: "summary-draft" }, data: { deletedAt: new Date() } });
    const response = await request();
    expect((await response.json()).map((receipt: { id: string }) => receipt.id)).not.toContain("summary-draft");
  });

  it("returns an empty list for an owner with no receipts", async () => {
    identity.userId = "summary-empty-owner";
    expect(await (await request()).json()).toEqual([]);
  });

  it("returns the standard 401 envelope for missing or unknown users", async () => {
    for (const userId of ["", "summary-unknown"]) {
      identity.userId = userId;
      const response = await request();
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    }
  });
});
