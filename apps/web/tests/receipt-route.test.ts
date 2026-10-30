// Real receipt handlers against PGlite, with only auth and cache mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "receipt-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);
const { GET, PATCH } = await import("../app/api/receipts/[id]/route");
const { PUT } = await import("../app/api/receipts/[id]/items/route");

const receiptId = "receipt-test";
const item = { lineNumber: 1, name: "Dinner", quantity: "1", unitPrice: "20.00", totalPrice: "20.00" };
const context = (id = receiptId) => ({ params: Promise.resolve({ id }) });
const get = (id = receiptId) => GET(new Request("http://test/api/receipts/" + id), context(id));

function request(method: "PATCH" | "PUT", body: unknown, id = receiptId) {
  const input = body !== null && typeof body === "object" && !Array.isArray(body)
    ? { expectedRevision: 1, ...body } : body;
  const req = new Request("http://test/api/receipts/" + id, { method, body: JSON.stringify(input) });
  return method === "PATCH" ? PATCH(req, context(id)) : PUT(req, context(id));
}
const snapshot = () => prisma.receipt.findUniqueOrThrow({
  where: { id: receiptId },
  include: { items: { orderBy: { lineNumber: "asc" }, include: { sharedAllocations: true } } },
});

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "receipt-owner", name: "Owner", email: "receipt-owner@example.com" },
    { id: "receipt-other", name: "Other", email: "receipt-other@example.com" },
  ] });
  await prisma.receipt.create({ data: {
    id: "receipt-foreign", ownerId: "receipt-other", imageBlobName: "foreign.jpg", imageContentType: "image/jpeg",
    participants: { create: { id: "receipt-foreign-person", displayName: "Other" } },
    items: { create: { ...item, id: "receipt-foreign-item" } },
  } });
});
beforeEach(async () => {
  identity.userId = "receipt-owner";
  cache.revalidatePath.mockClear();
  const fields = {
    ownerId: "receipt-owner", status: "DRAFT" as const, parseStatus: "SUCCEEDED" as const,
    revision: 1, deletedAt: null, reviewedAt: new Date(0), finalizedAt: null,
    paidByParticipantId: null, splitMode: "EVEN" as const, title: "Dinner",
    merchantName: "Bistro", address: "123 Main", purchasedAt: new Date(0),
    subtotal: "30.00", tax: "2.70", tip: "6.00", total: "38.70",
  };
  await prisma.receipt.upsert({
    where: { id: receiptId }, update: fields,
    create: { id: receiptId, ...fields, imageBlobName: "receipt.jpg", imageContentType: "image/jpeg" },
  });
  await prisma.bill.deleteMany({ where: { receiptId } });
  await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
  await prisma.receiptItem.deleteMany({ where: { receiptId } });
  await prisma.participant.deleteMany({ where: { receiptId } });
  await prisma.participant.createMany({ data: [
    { id: "receipt-alex", receiptId, displayName: "Alex", phone: "+12125550123", joinedAt: new Date(0) },
    { id: "receipt-sam", receiptId, displayName: "Sam", joinedAt: new Date(1000) },
  ] });
  await prisma.receiptItem.createMany({ data: [
    { ...item, id: "receipt-dinner", receiptId, isVerified: true },
    { ...item, id: "receipt-app", receiptId, lineNumber: 2, name: "Appetizer", unitPrice: "10.00", totalPrice: "10.00", isVerified: true },
  ] });
});

describe("owned receipt reads and corrections", () => {
  it("returns the ordered draft, participants and parsing state without private parser/blob data", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: receiptId, ownerId: "receipt-owner", revision: 1, status: "DRAFT", parseStatus: "SUCCEEDED" });
    expect(body.items.map((row: { lineNumber: number }) => row.lineNumber)).toEqual([1, 2]);
    expect(body.participants.map((row: { id: string }) => row.id)).toEqual(["receipt-alex", "receipt-sam"]);
    for (const field of ["partyId", "extraction", "parseError", "imageBlobName", "deletedAt"]) expect(body).not.toHaveProperty(field);
  });

  it("updates nullable metadata, clears review, advances revision and ignores protected fields", async () => {
    const res = await request("PATCH", {
      merchantName: "  Corrected  ", title: null, address: null, purchasedAt: null,
      ownerId: "receipt-other", status: "FINALIZED", revision: 99,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      merchantName: "Corrected", title: null, address: null, purchasedAt: null,
      ownerId: "receipt-owner", status: "DRAFT", revision: 2, reviewedAt: null,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/api/receipts/" + receiptId);
  });

  it("accepts all split modes, clears incompatible allocations and preserves personal assignments when appropriate", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "SHARED_ITEMS" } });
    await prisma.receiptItem.update({ where: { id: "receipt-dinner" }, data: { assignedParticipantId: "receipt-alex" } });
    await prisma.sharedItemAllocation.createMany({ data: ["receipt-alex", "receipt-sam"].map((participantId) => ({
      receiptId, itemId: "receipt-app", participantId,
    })) });
    expect((await request("PATCH", { splitMode: "ITEMIZED" })).status).toBe(200);
    expect(await prisma.sharedItemAllocation.count({ where: { receiptId } })).toBe(0);
    expect((await snapshot()).items[0].assignedParticipantId).toBe("receipt-alex");
    expect((await request("PATCH", { expectedRevision: 2, splitMode: "EVEN" })).status).toBe(200);
    expect((await snapshot()).items.every((row) => row.assignedParticipantId === null)).toBe(true);
  });

  it("confirms a complete manually corrected receipt after failed OCR", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { parseStatus: "FAILED", reviewedAt: null } });
    await prisma.receiptItem.updateMany({ where: { receiptId }, data: { isVerified: false } });
    const res = await request("PATCH", { reviewConfirmed: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviewedAt).not.toBeNull();
    expect(body.parseStatus).toBe("FAILED");
    expect(body.items.every((row: { isVerified: boolean }) => row.isVerified)).toBe(true);
  });

  it("rolls back field edits and revision when review cannot reconcile", async () => {
    const before = await snapshot();
    const res = await request("PATCH", { total: "99.00", reviewConfirmed: true });
    expect(res.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    {}, null, [], { expectedRevision: undefined, tax: "1" }, { expectedRevision: 0, tax: "1" },
    { title: " " }, { merchantName: " " }, { address: "x".repeat(501) },
    { purchasedAt: "2026-02-30T12:00:00Z" }, { tax: "-1" }, { tip: "1.001" },
    { total: 10 }, { subtotal: "1e2" }, { total: "10000000000" }, { splitMode: "CUSTOM" },
    { reviewConfirmed: false }, { paidByParticipantId: "" },
  ])("rejects invalid correction %j without writes", async (input) => {
    const before = await snapshot();
    expect((await request("PATCH", input)).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("uses a receipt-local payer and permits clearing it", async () => {
    expect((await request("PATCH", { paidByParticipantId: "receipt-alex" })).status).toBe(200);
    expect((await request("PATCH", { expectedRevision: 2, paidByParticipantId: null })).status).toBe(200);
    const before = await snapshot();
    expect((await request("PATCH", { expectedRevision: 3, paidByParticipantId: "receipt-foreign-person" })).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("returns 404 for another owner, deleted, unknown and missing receipt IDs", async () => {
    expect((await get("receipt-foreign")).status).toBe(404);
    expect((await get("missing")).status).toBe(404);
    const missing = await GET(new Request("http://test/api/receipts/missing"), { params: Promise.resolve({ id: undefined as unknown as string }) });
    expect(missing.status).toBe(404);
    identity.userId = "receipt-other";
    expect((await get()).status).toBe(404);
    expect((await request("PATCH", { tax: "2" })).status).toBe(404);
    identity.userId = "receipt-owner";
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    expect((await get()).status).toBe(404);
    expect((await request("PATCH", { tax: "2" })).status).toBe(404);
  });

  it.each(["FINALIZED", "PARSING"] as const)("blocks writes in %s state", async (state) => {
    await prisma.receipt.update({ where: { id: receiptId }, data: state === "FINALIZED" ? { status: state } : { parseStatus: state } });
    expect((await request("PATCH", { tax: "2" })).status).toBe(409);
  });

  it("returns 401 for an unknown identity and 400 for malformed JSON", async () => {
    identity.userId = "missing";
    expect((await get()).status).toBe(401);
    expect((await request("PATCH", { tax: "2" })).status).toBe(401);
    identity.userId = "receipt-owner";
    expect((await PATCH(new Request("http://test", { method: "PATCH", body: "{" }), context())).status).toBe(400);
  });

  it("allows exactly one correction for a shared expected revision", async () => {
    const responses = await Promise.all(["One", "Two"].map((title) => request("PATCH", { title })));
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await snapshot()).revision).toBe(2);
  });
});

describe("item replacement", () => {
  it("replaces items, clears assignments/sharing/review, and preserves unrelated data", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "SHARED_ITEMS" } });
    await prisma.receiptItem.update({ where: { id: "receipt-dinner" }, data: { assignedParticipantId: "receipt-alex" } });
    await prisma.sharedItemAllocation.createMany({ data: ["receipt-alex", "receipt-sam"].map((participantId) => ({
      receiptId, itemId: "receipt-app", participantId,
    })) });
    const foreign = await prisma.receiptItem.findUniqueOrThrow({ where: { id: "receipt-foreign-item" } });
    const res = await request("PUT", { items: [{ ...item, name: "  Soup  " }] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ revision: 2, reviewedAt: null, items: [{ name: "Soup", assignedParticipantId: null, sharedAllocations: [] }] });
    expect(body.items[0].id).not.toBe("receipt-dinner");
    expect(await prisma.sharedItemAllocation.count({ where: { receiptId } })).toBe(0);
    expect(await prisma.receiptItem.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
  });

  it("permits clearing items and database-sized decimal inputs", async () => {
    expect((await request("PUT", { items: [] })).status).toBe(200);
    const res = await request("PUT", { expectedRevision: 2, items: [{
      ...item, quantity: "9999999.999", unitPrice: "9999999999.99", totalPrice: "9999999999.99",
    }] });
    expect(res.status).toBe(200);
    expect((await res.json()).items[0].quantity).toBe("9999999.999");
  });

  it.each([
    {}, null, { items: null }, { items: [item, item] },
    ...[{ lineNumber: 0 }, { name: " " }, { quantity: "0" }, { quantity: "1.0001" },
      { quantity: "10000000" }, { unitPrice: "-1" }, { totalPrice: "10000000000" },
      { unitPrice: 2 }].map((fields) => ({ items: [{ ...item, ...fields }] })),
  ])("rejects invalid items %j without writes", async (input) => {
    const before = await snapshot();
    expect((await request("PUT", input)).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("checks identity, ownership, deletion, parsing, finalization and stale revisions", async () => {
    expect((await request("PUT", { items: [] }, "receipt-foreign")).status).toBe(404);
    expect((await request("PUT", { items: [] }, "missing")).status).toBe(404);
    identity.userId = "missing";
    expect((await request("PUT", { items: [] })).status).toBe(401);
    identity.userId = "receipt-owner";
    expect((await request("PUT", { expectedRevision: 99, items: [] })).status).toBe(409);
    await prisma.receipt.update({ where: { id: receiptId }, data: { parseStatus: "PARSING" } });
    expect((await request("PUT", { items: [] })).status).toBe(409);
    await prisma.receipt.update({ where: { id: receiptId }, data: { parseStatus: "SUCCEEDED", status: "FINALIZED" } });
    expect((await request("PUT", { items: [] })).status).toBe(409);
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    expect((await request("PUT", { items: [] })).status).toBe(404);
  });

  it("restores deleted items and revision after a later insert fails", async () => {
    const before = await snapshot();
    await prisma.$executeRawUnsafe("CREATE FUNCTION receipt_insert_fail() RETURNS trigger AS $$ BEGIN IF NEW.name = 'Fail' THEN RAISE EXCEPTION 'private failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql");
    await prisma.$executeRawUnsafe("CREATE TRIGGER receipt_insert_fail BEFORE INSERT ON receipt_items FOR EACH ROW EXECUTE FUNCTION receipt_insert_fail()");
    try {
      const res = await request("PUT", { items: [{ ...item, name: "Fail" }] });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER receipt_insert_fail ON receipt_items");
      await prisma.$executeRawUnsafe("DROP FUNCTION receipt_insert_fail()");
    }
  });

  it("serializes concurrent replacements using their expected revision", async () => {
    const responses = await Promise.all(["A", "B"].map((name) => request("PUT", { items: [{ ...item, name }] })));
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await snapshot()).items).toHaveLength(1);
  });
});
