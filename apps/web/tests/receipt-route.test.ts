// Receipt read, edit, and item replacement through the real route handlers, against
// in-memory PGlite. Identity is mocked at the @project/auth seam.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "receipt-alice" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const { GET, PATCH } = await import("../app/api/receipts/[receiptId]/route");
const { PUT } = await import("../app/api/receipts/[receiptId]/items/route");

function get(receiptId: string) {
  return GET(new Request(`http://test/api/receipts/${receiptId}`), {
    params: Promise.resolve({ receiptId }),
  });
}

function patch(receiptId: string, body: unknown) {
  return PATCH(new Request(`http://test/api/receipts/${receiptId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ receiptId }) });
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "receipt-alice", name: "Alice", email: "receipt-alice@example.com" },
      { id: "receipt-bob", name: "Bob", email: "receipt-bob@example.com" },
      { id: "receipt-charlie", name: "Charlie", email: "receipt-charlie@example.com" },
    ],
  });

  await prisma.party.create({
    data: {
      id: "receipt-party-alice",
      name: "Alice's dinner",
      organizerId: "receipt-alice",
      members: {
        create: { id: "receipt-member-alice", userId: "receipt-alice", displayName: "Alice" },
      },
      receipts: {
        create: {
          id: "receipt-detail-alice",
          uploadedById: "receipt-alice",
          imageBlobName: "test/receipt.jpg",
          imageContentType: "image/jpeg",
          merchantName: "Alice's Bistro",
          address: "123 Main Street",
          purchasedAt: new Date("2026-10-01T18:30:00.000Z"),
          items: {
            create: [
              { lineNumber: 2, name: "Tea", quantity: "1", unitPrice: "3.00", totalPrice: "3.00" },
              { lineNumber: 1, name: "Dinner", quantity: "1", unitPrice: "20.00", totalPrice: "20.00" },
            ],
          },
        },
      },
    },
  });

  await prisma.partyMember.createMany({
    data: [
      { id: "receipt-member-guest", partyId: "receipt-party-alice", displayName: "Guest" },
      { id: "receipt-member-charlie", partyId: "receipt-party-alice", userId: "receipt-charlie", displayName: "Charlie" },
    ],
  });
  await prisma.party.create({
    data: {
      id: "receipt-party-bob", name: "Bob's dinner", organizerId: "receipt-bob",
      members: { create: { id: "receipt-member-bob", userId: "receipt-bob", displayName: "Bob" } },
    },
  });
  await prisma.receipt.create({
    data: {
      id: "receipt-edit-alice", partyId: "receipt-party-alice", uploadedById: "receipt-alice",
      imageBlobName: "test/edit.jpg", imageContentType: "image/jpeg",
      items: {
        create: [
          { lineNumber: 2, name: "Tea", unitPrice: "3.00", totalPrice: "3.00" },
          { lineNumber: 1, name: "Dinner", unitPrice: "20.00", totalPrice: "20.00" },
        ],
      },
    },
  });
});

beforeEach(async () => {
  identity.userId = "receipt-alice";
  await prisma.party.update({ where: { id: "receipt-party-alice" }, data: { deletedAt: null } });
  await prisma.receipt.update({
    where: { id: "receipt-edit-alice" },
    data: {
      status: "PARSED", deletedAt: null, merchantName: "Original Bistro",
      purchasedAt: new Date("2026-10-01T18:30:00.000Z"), paidByMemberId: "receipt-member-alice",
      splitMode: "EVEN", subtotal: "23.00", tax: "2.00", tip: "4.00", total: "29.00",
    },
  });
});

describe("PATCH /api/receipts/[receiptId]", () => {
  it("200 with a partial update, trimmed name, ignored unknown fields, and the GET shape", async () => {
    const before = await (await get("receipt-edit-alice")).json();
    const res = await patch("receipt-edit-alice", {
      merchantName: "  Corrected Bistro  ", tax: "2.66", total: "29.66",
      status: "FINALIZED", partyId: "receipt-party-bob", currency: "EUR", items: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...before, merchantName: "Corrected Bistro", tax: "2.66", total: "29.66" });
    expect(body.items.map((item: { lineNumber: number }) => item.lineNumber)).toEqual([1, 2]);
    expect(await (await get("receipt-edit-alice")).json()).toEqual(body);
  });

  it("allows another party member to change the date, money fields, payer, and split mode", async () => {
    identity.userId = "receipt-charlie";
    const res = await patch("receipt-edit-alice", {
      purchasedAt: "2026-10-02T12:30:00-04:00", subtotal: "0", tax: "0.0", tip: "0.00", total: "0",
      paidByMemberId: "receipt-member-guest", splitMode: "ITEMIZED",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      purchasedAt: "2026-10-02T16:30:00.000Z", subtotal: "0", tax: "0", tip: "0", total: "0",
      paidByMemberId: "receipt-member-guest", splitMode: "ITEMIZED",
    });
  });

  it("400 for malformed JSON", async () => {
    const res = await PATCH(new Request("http://test/api/receipts/receipt-edit-alice", {
      method: "PATCH", body: "{",
    }), { params: Promise.resolve({ receiptId: "receipt-edit-alice" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID_INPUT", message: "Body must be valid JSON" } });
  });

  it.each([
    {}, { currency: "EUR" }, [], null,
    { merchantName: "  " }, { merchantName: null },
    { purchasedAt: "2026-10-02" }, { purchasedAt: "2026-02-30T12:00:00Z" },
    { tax: "-1.00" }, { tip: "1.001" }, { total: 10 }, { subtotal: "1e2" },
    { paidByMemberId: "" }, { splitMode: "CUSTOM" },
  ])("400 and no change for invalid input %j", async (input) => {
    const before = await (await get("receipt-edit-alice")).json();
    const res = await patch("receipt-edit-alice", input);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: expect.any(String) } });
    expect(await (await get("receipt-edit-alice")).json()).toEqual(before);
  });

  it.each(["receipt-member-bob", "unknown-member"])("400 and no change for payer %s", async (paidByMemberId) => {
    const before = await (await get("receipt-edit-alice")).json();
    const res = await patch("receipt-edit-alice", { paidByMemberId, merchantName: "Changed" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await (await get("receipt-edit-alice")).json()).toEqual(before);
  });

  it("404 and no change for another party's member", async () => {
    const before = await (await get("receipt-edit-alice")).json();
    identity.userId = "receipt-bob";
    const res = await patch("receipt-edit-alice", { merchantName: "Changed" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    identity.userId = "receipt-alice";
    expect(await (await get("receipt-edit-alice")).json()).toEqual(before);
  });

  it("404 for an unknown receipt", async () => {
    const res = await patch("unknown-receipt", { merchantName: "Changed" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
  });

  it.each(["receipt", "party"])("404 and no change when the %s is soft-deleted", async (resource) => {
    if (resource === "receipt") {
      await prisma.receipt.update({ where: { id: "receipt-edit-alice" }, data: { deletedAt: new Date() } });
    } else {
      await prisma.party.update({ where: { id: "receipt-party-alice" }, data: { deletedAt: new Date() } });
    }
    const res = await patch("receipt-edit-alice", { merchantName: "Changed" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: "receipt-edit-alice" } });
    expect(receipt.merchantName).toBe("Original Bistro");
  });

  it("409 and no change for a finalized receipt", async () => {
    await prisma.receipt.update({ where: { id: "receipt-edit-alice" }, data: { status: "FINALIZED" } });
    const before = await (await get("receipt-edit-alice")).json();
    const res = await patch("receipt-edit-alice", { merchantName: "Changed" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "CONFLICT", message: "Receipt is finalized" } });
    expect(await (await get("receipt-edit-alice")).json()).toEqual(before);
  });

  it("401 for an identity without a user row", async () => {
    identity.userId = "unknown-user";
    const res = await patch("receipt-edit-alice", { merchantName: "Changed" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unknown user" } });
  });
});

describe("GET /api/receipts/[receiptId]", () => {
  it("200 with the receipt details and items ordered by line number", async () => {
    const res = await get("receipt-detail-alice");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: "receipt-detail-alice",
      partyId: "receipt-party-alice",
      paidByMemberId: null,
      status: "UPLOADED",
      splitMode: "EVEN",
      merchantName: "Alice's Bistro",
      address: "123 Main Street",
      purchasedAt: "2026-10-01T18:30:00.000Z",
      currency: "USD",
      subtotal: null,
      tax: null,
      tip: null,
      total: null,
      createdAt: expect.any(String),
    });
    expect(body.items.map((item: { lineNumber: number }) => item.lineNumber)).toEqual([1, 2]);
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["Dinner", "Tea"]);
    expect(body).not.toHaveProperty("extraction");
    expect(body).not.toHaveProperty("parseError");
    expect(body).not.toHaveProperty("imageBlobName");
    expect(body).not.toHaveProperty("deletedAt");
  });

  it("404 in the shared error shape when the receipt belongs to another user", async () => {
    identity.userId = "receipt-bob";

    const res = await get("receipt-detail-alice");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Receipt not found" },
    });
  });
});

describe("PUT /api/receipts/[receiptId]/items", () => {
  const receiptId = "receipt-items-alice";
  const item = { lineNumber: 1, name: "Dinner", quantity: "1", unitPrice: "20.00", totalPrice: "20.00" };

  function put(body: unknown, id = receiptId) {
    return PUT(new Request(`http://test/api/receipts/${id}/items`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ receiptId: id }) });
  }

  function snapshot(id = receiptId) {
    return prisma.receipt.findUniqueOrThrow({
      where: { id },
      include: { items: { orderBy: { lineNumber: "asc" }, include: { shares: true } } },
    });
  }

  beforeAll(async () => {
    await prisma.receipt.create({
      data: {
        id: receiptId, partyId: "receipt-party-alice", uploadedById: "receipt-alice",
        imageBlobName: "test/items.jpg", imageContentType: "image/jpeg",
        merchantName: "Original Bistro", subtotal: "23.00", tax: "2.00", tip: "4.00", total: "29.00",
      },
    });
    await prisma.receipt.create({
      data: {
        id: "receipt-items-bob", partyId: "receipt-party-bob", uploadedById: "receipt-bob",
        imageBlobName: "test/bob.jpg", imageContentType: "image/jpeg",
        items: { create: { ...item, shares: { create: { memberId: "receipt-member-bob", weight: 1 } } } },
      },
    });
  });

  beforeEach(async () => {
    cache.revalidatePath.mockClear();
    await prisma.receipt.update({ where: { id: receiptId }, data: { status: "PARSED", deletedAt: null } });
    await prisma.itemShare.deleteMany({ where: { item: { receiptId } } });
    await prisma.receiptItem.deleteMany({ where: { receiptId } });
    await prisma.receiptItem.create({
      data: { ...item, receiptId, shares: { create: { memberId: "receipt-member-alice", weight: 2 } } },
    });
  });

  it("replaces all items, clears their shares, returns the GET shape, and revalidates", async () => {
    const before = await (await get(receiptId)).json();
    const other = await snapshot("receipt-items-bob");
    const res = await put({
      items: [
        { ...item, lineNumber: 3, name: "  Tea  ", quantity: "0.125", unitPrice: "0", totalPrice: "0.00", id: "client-id", isVerified: false },
        { ...item, lineNumber: 1, name: "Soup" },
      ],
      status: "FINALIZED", partyId: "receipt-party-bob", total: "999.00",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ...before, items: [
      { id: expect.any(String), lineNumber: 1, name: "Soup", quantity: "1", unitPrice: "20", totalPrice: "20", isVerified: true },
      { id: expect.any(String), lineNumber: 3, name: "Tea", quantity: "0.125", unitPrice: "0", totalPrice: "0", isVerified: true },
    ] });
    expect(body.items.map((row: { id: string }) => row.id)).not.toContain(before.items[0].id);
    expect(body.items.map((row: { id: string }) => row.id)).not.toContain("client-id");
    expect(await prisma.itemShare.count({ where: { item: { receiptId } } })).toBe(0);
    expect(await (await get(receiptId)).json()).toEqual(body);
    expect(await snapshot("receipt-items-bob")).toEqual(other);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${receiptId}`);
  });

  it("allows a non-organizer member to clear the collection", async () => {
    identity.userId = "receipt-charlie";
    const res = await put({ items: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [], status: "PARSED", total: "29" });
    expect((await snapshot()).items).toEqual([]);
  });

  it("accepts the largest database values without rounding", async () => {
    const res = await put({ items: [{
      ...item, lineNumber: 2147483647, quantity: "9999999.999", unitPrice: "9999999999.99", totalPrice: "9999999999.99",
    }] });
    expect(res.status).toBe(200);
    expect((await res.json()).items[0]).toMatchObject({
      lineNumber: 2147483647, quantity: "9999999.999", unitPrice: "9999999999.99", totalPrice: "9999999999.99",
    });
  });

  it("400 for malformed JSON without changing items or shares", async () => {
    const before = await snapshot();
    const res = await PUT(new Request("http://test/items", { method: "PUT", body: "{" }), {
      params: Promise.resolve({ receiptId }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID_INPUT", message: "Body must be valid JSON" } });
    expect(await snapshot()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    {}, null, [], { items: null }, { items: {} }, { items: [{}] },
    { items: [item, item] },
    ...[
      { lineNumber: 0 }, { lineNumber: -1 }, { lineNumber: 1.5 }, { lineNumber: "1" }, { lineNumber: 2147483648 },
      { name: "  " }, { quantity: "0" }, { quantity: "0.000" }, { quantity: "-1" }, { quantity: 1 },
      { quantity: "1.0001" }, { quantity: "10000000" }, { quantity: "1e2" },
      { unitPrice: "-1.00" }, { unitPrice: "1.001" }, { unitPrice: 1 }, { unitPrice: "10000000000" },
      { totalPrice: "10000000000.00" }, { totalPrice: "1e2" }, { totalPrice: null },
    ].map((fields) => ({ items: [{ ...item, ...fields }] })),
  ])("400 and no changes for invalid input %j", async (body) => {
    const before = await snapshot();
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: expect.any(String) } });
    expect(await snapshot()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("401 for an unknown identity", async () => {
    const before = await snapshot();
    identity.userId = "unknown-user";
    const res = await put({ items: [] });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unknown user" } });
    expect(await snapshot()).toEqual(before);
  });

  it("404 for a foreign receipt without changing its items or shares", async () => {
    const before = await snapshot();
    identity.userId = "receipt-bob";
    const res = await put({ items: [] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    expect(await snapshot()).toEqual(before);
  });

  it("404 for an unknown receipt", async () => {
    const res = await put({ items: [] }, "unknown-receipt");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
  });

  it.each(["receipt", "party"])("404 when the %s is soft-deleted", async (resource) => {
    if (resource === "receipt") {
      await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    } else {
      await prisma.party.update({ where: { id: "receipt-party-alice" }, data: { deletedAt: new Date() } });
    }
    const before = await snapshot();
    const res = await put({ items: [] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    expect(await snapshot()).toEqual(before);
  });

  it("409 for a finalized receipt without changing items or shares", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { status: "FINALIZED" } });
    const before = await snapshot();
    const res = await put({ items: [] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "CONFLICT", message: "Receipt is finalized" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back deleted items and shares when insertion fails and hides the database error", async () => {
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION receipt_items_test_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.receipt_id = 'receipt-items-alice' AND NEW.name = 'Fail insert' THEN
          RAISE EXCEPTION 'private database failure';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER receipt_items_test_fail
        BEFORE INSERT ON receipt_items FOR EACH ROW EXECUTE FUNCTION receipt_items_test_fail()`);
      const res = await put({ items: [{ ...item, name: "Fail insert" }] });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS receipt_items_test_fail ON receipt_items");
      await prisma.$executeRawUnsafe("DROP FUNCTION receipt_items_test_fail()");
    }
  });

  it("concurrent replacements leave one complete collection", async () => {
    const sets = [
      [{ ...item, name: "A1" }, { ...item, lineNumber: 2, name: "A2" }],
      [{ ...item, name: "B1" }, { ...item, lineNumber: 3, name: "B3" }],
    ];
    const responses = await Promise.all(sets.map((items) => put({ items })));
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((res) => res.json()));
    expect(bodies.map((body) => body.items.map((row: { name: string }) => row.name))).toEqual([
      ["A1", "A2"], ["B1", "B3"],
    ]);
    const names = (await snapshot()).items.map((row) => row.name);
    expect([["A1", "A2"], ["B1", "B3"]]).toContainEqual(names);
  });
});
