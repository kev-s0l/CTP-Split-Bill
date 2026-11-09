import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";
import { completeReceiptParsing, failReceiptParsing, startReceiptParsing } from "@project/domain";

const identity = vi.hoisted(() => ({ userId: "parse-owner" }));
const storage = vi.hoisted(() => ({ downloadAttachment: vi.fn(), recognizeReceipt: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("@project/services", () => storage);
vi.mock("next/cache", () => cache);
const { POST } = await import("../app/api/receipts/[id]/parse/route");
const text = "Merchant: Corner Cafe\n1 x Soup @ 10.00 10.00\n1 x Tea @ 3.00 3.00\nSubtotal 13.00\nTax 1.00\nTip 2.00\nTotal 16.00";

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "parse-owner", name: "Owner", email: "parse-owner@example.com" },
    { id: "parse-other", name: "Other", email: "parse-other@example.com" },
  ] });
});

let id: string;
const snapshot = () => prisma.receipt.findUniqueOrThrow({ where: { id }, include: {
  items: { include: { sharedAllocations: true }, orderBy: { lineNumber: "asc" } },
  participants: { orderBy: { id: "asc" } }, bills: true,
} });
beforeEach(async () => {
  vi.restoreAllMocks();
  identity.userId = "parse-owner";
  cache.revalidatePath.mockReset();
  storage.downloadAttachment.mockReset().mockResolvedValue({ data: Uint8Array.from([1, 2, 3]), contentType: "image/png" });
  storage.recognizeReceipt.mockReset().mockResolvedValue(text);
  const receipt = await prisma.receipt.create({ data: {
    ownerId: "parse-owner", imageBlobName: "parse/private.png", imageContentType: "image/png",
    splitMode: "SHARED_ITEMS", reviewedAt: new Date(0), merchantName: "Previous",
    subtotal: "9.00", tax: "0.00", tip: null, total: "9.00",
    items: { create: { lineNumber: 1, name: "Previous", quantity: "1", unitPrice: "9", totalPrice: "9", isVerified: true } },
    participants: { create: [{ displayName: "Alice" }, { displayName: "Bob" }] },
  }, include: { participants: true, items: true } });
  id = receipt.id;
  await prisma.receipt.update({ where: { id }, data: { paidByParticipantId: receipt.participants[0].id } });
  await prisma.sharedItemAllocation.createMany({ data: receipt.participants.map((p) => ({
    receiptId: id, itemId: receipt.items[0].id, participantId: p.id,
  })) });
});

const request = (body: unknown = { expectedRevision: 1 }, receiptId = id) => POST(new Request("http://test/parse", {
  method: "POST", body: JSON.stringify(body),
}), { params: Promise.resolve({ id: receiptId }) });

describe("receipt parsing POST", () => {
  it("persists extracted fields and unverified items, clearing old sharing while keeping the roster/payer", async () => {
    const before = await snapshot();
    const response = await request({ expectedRevision: 1, ownerId: "parse-other", total: "0.01" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ revision: 3, parseStatus: "SUCCEEDED", reviewedAt: null, merchantName: "Corner Cafe", total: "16" });
    for (const field of ["imageBlobName", "parseError", "extraction"]) expect(body).not.toHaveProperty(field);
    const saved = await snapshot();
    expect(saved.participants).toEqual(before.participants);
    expect(saved.paidByParticipantId).toBe(before.paidByParticipantId);
    expect(saved.items.map((item) => [item.name, item.totalPrice?.toFixed(2), item.isVerified, item.assignedParticipantId, item.sharedAllocations])).toEqual([
      ["Soup", "10.00", false, null, []], ["Tea", "3.00", false, null, []],
    ]);
    expect(saved.items.map((item) => item.id)).not.toContain(before.items[0].id);
    expect(saved.extraction).toEqual({ text });
    expect(saved.bills).toEqual([]);
    expect(storage.downloadAttachment).toHaveBeenCalledExactlyOnceWith("parse/private.png");
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${id}`);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/api/receipts");
  });

  it.each(["", "unknown-user"])("rejects identity %j before reading JSON", async (userId) => {
    identity.userId = userId;
    const req = new Request("http://test", { method: "POST", body: "{" });
    const json = vi.spyOn(req, "json");
    expect((await POST(req, { params: Promise.resolve({ id }) })).status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { expectedRevision: 0 }, { expectedRevision: "1" }, { expectedRevision: 1.5 }, { expectedRevision: 2147483646 }, { expectedRevision: 2147483647 }])("rejects invalid body %j without writes", async (body) => {
    const before = await snapshot();
    expect((await request(body)).status).toBe(400);
    expect(await snapshot()).toEqual(before);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://test", { method: "POST", body: "{" }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(400);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it.each(["foreign", "deleted", "missing", "unknown"])("rejects %s receipts before storage", async (kind) => {
    if (kind === "foreign") identity.userId = "parse-other";
    if (kind === "deleted") await prisma.receipt.update({ where: { id }, data: { deletedAt: new Date() } });
    const before = await snapshot();
    expect((await request(undefined, kind === "missing" ? "" : kind === "unknown" ? "unknown" : id)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it.each(["finalized", "parsing", "stale"])("rejects %s attempts without writes", async (kind) => {
    if (kind === "finalized") await prisma.receipt.update({ where: { id }, data: { status: "FINALIZED" } });
    if (kind === "parsing") await prisma.receipt.update({ where: { id }, data: { parseStatus: "PARSING" } });
    const before = await snapshot();
    expect((await request({ expectedRevision: kind === "stale" ? 99 : 1 })).status).toBe(409);
    expect(await snapshot()).toEqual(before);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it.each(["missing photo", "storage outage", "OCR timeout", "no items", "oversized output"])("preserves corrections on %s failure and allows a revision-bearing retry", async (kind) => {
    if (kind === "missing photo") storage.downloadAttachment.mockResolvedValueOnce(null);
    if (kind === "storage outage") storage.downloadAttachment.mockRejectedValueOnce(new Error("private storage error"));
    if (kind === "OCR timeout") storage.recognizeReceipt.mockRejectedValueOnce(new Error("private OCR timeout"));
    if (kind === "no items") storage.recognizeReceipt.mockResolvedValueOnce("Unreadable photo");
    if (kind === "oversized output") storage.recognizeReceipt.mockResolvedValueOnce("x".repeat(100_001));
    const before = await snapshot();
    const response = await request();
    expect(response.status).toBe(kind === "missing photo" ? 404 : kind === "storage outage" || kind === "OCR timeout" ? 503 : 400);
    expect(JSON.stringify(await response.json())).not.toContain("private");
    expect(await snapshot()).toEqual({ ...before, revision: 3, parseStatus: "FAILED", updatedAt: expect.any(Date), parseError: "Receipt parsing failed; retry or correct manually" });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
    expect((await request({ expectedRevision: 3 })).status).toBe(200);
    expect((await snapshot()).revision).toBe(5);
  });

  it("commits PARSING before OCR so competing attempts and edits cannot overwrite it", async () => {
    storage.recognizeReceipt.mockImplementationOnce(async () => {
      expect(await snapshot()).toMatchObject({ revision: 2, parseStatus: "PARSING" });
      expect((await request({ expectedRevision: 2 })).status).toBe(409);
      return text;
    });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(storage.recognizeReceipt).toHaveBeenCalledOnce();
  });

  it("recovers an abandoned attempt and prevents its completion/failure from touching the retry", async () => {
    const first = await startReceiptParsing("parse-owner", id, 1);
    await prisma.receipt.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 300_001) } });
    const second = await startReceiptParsing("parse-owner", id, first.revision);
    expect(second.revision).toBe(3);
    await expect(completeReceiptParsing("parse-owner", id, first.revision, text)).rejects.toMatchObject({ status: 409 });
    expect(await failReceiptParsing("parse-owner", id, first.revision)).toEqual({ count: 0 });
    expect(await snapshot()).toMatchObject({ revision: 3, parseStatus: "PARSING" });
    await completeReceiptParsing("parse-owner", id, second.revision, text);
    expect(await snapshot()).toMatchObject({ revision: 4, parseStatus: "SUCCEEDED" });
  });

  it("rolls back all extraction changes if item insertion fails", async () => {
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION parse_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'private insert error'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe("CREATE TRIGGER parse_test_fail BEFORE INSERT ON receipt_items FOR EACH ROW EXECUTE FUNCTION parse_test_fail()");
    try {
      const response = await request();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual({ ...before, revision: 3, parseStatus: "FAILED", updatedAt: expect.any(Date), parseError: "Receipt parsing failed; retry or correct manually" });
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER parse_test_fail ON receipt_items");
      await prisma.$executeRawUnsafe("DROP FUNCTION parse_test_fail()");
    }
  });

  it("preserves committed success if cache invalidation fails", async () => {
    cache.revalidatePath.mockImplementationOnce(() => { throw new Error("cache is down"); });
    expect((await request()).status).toBe(200);
    expect(await snapshot()).toMatchObject({ revision: 3, parseStatus: "SUCCEEDED" });
  });
});
