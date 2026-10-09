import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "bill-alice" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);

const { PUT } = await import("../app/api/receipts/[receiptId]/allocations/route");
const { POST } = await import("../app/api/receipts/[receiptId]/finalize/route");
const { GET } = await import("../app/api/receipts/[receiptId]/bills/route");
const { PUT: PUT_ITEMS } = await import("../app/api/receipts/[receiptId]/items/route");

const receiptId = "bill-receipt";
const first = { itemId: "bill-steak", memberId: "bill-member-a", weight: 1 };
const initialShares = [first,
  { itemId: "bill-app", memberId: "bill-member-a", weight: 1 },
  { itemId: "bill-app", memberId: "bill-member-b", weight: 1 },
];
const handlers = { allocations: PUT, finalize: POST, bills: GET };
type Endpoint = keyof typeof handlers;

function request(endpoint: Endpoint, body: unknown = { shares: [] }, id = receiptId) {
  const method = endpoint === "allocations" ? "PUT" : endpoint === "finalize" ? "POST" : "GET";
  return handlers[endpoint](new Request(`http://test/api/receipts/${id}/${endpoint}`, {
    method,
    ...(endpoint === "allocations" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve({ receiptId: id }) });
}

function snapshot(id = receiptId) {
  return prisma.receipt.findUniqueOrThrow({
    where: { id },
    include: {
      items: { orderBy: { lineNumber: "asc" }, include: { shares: { orderBy: { memberId: "asc" } } } },
      bills: { orderBy: { memberId: "asc" }, include: { payments: true } },
    },
  });
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "bill-alice", name: "Alice", email: "bill-alice@example.com" },
    { id: "bill-bob", name: "Bob", email: "bill-bob@example.com" },
    { id: "bill-charlie", name: "Charlie", email: "bill-charlie@example.com" },
  ] });
  await prisma.party.create({ data: {
    id: "bill-party", name: "Dinner", organizerId: "bill-alice",
    members: { create: [
      { id: "bill-member-a", userId: "bill-alice", displayName: "Alice", joinedAt: new Date("2026-01-01") },
      { id: "bill-member-b", displayName: "Guest", joinedAt: new Date("2026-01-02") },
      { id: "bill-member-c", userId: "bill-charlie", displayName: "Charlie", joinedAt: new Date("2026-01-03") },
    ] },
    receipts: { create: [
      { id: receiptId, uploadedById: "bill-alice", imageBlobName: "test/bill.jpg", imageContentType: "image/jpeg" },
      { id: "bill-other-receipt", uploadedById: "bill-alice", imageBlobName: "test/other.jpg", imageContentType: "image/jpeg",
        items: { create: { id: "bill-other-item", lineNumber: 1, name: "Other", unitPrice: "1", totalPrice: "1",
          shares: { create: { memberId: "bill-member-a", weight: 1 } } } } },
    ] },
  } });
  await prisma.party.create({ data: {
    id: "bill-foreign-party", name: "Foreign", organizerId: "bill-bob",
    members: { create: { id: "bill-foreign-member", userId: "bill-bob", displayName: "Bob" } },
    receipts: { create: {
      id: "bill-foreign-receipt", uploadedById: "bill-bob", imageBlobName: "test/foreign.jpg", imageContentType: "image/jpeg",
      items: { create: { id: "bill-foreign-item", lineNumber: 1, name: "Foreign", unitPrice: "1", totalPrice: "1" } },
    } },
  } });
});

beforeEach(async () => {
  identity.userId = "bill-alice";
  cache.revalidatePath.mockClear();
  await prisma.party.update({ where: { id: "bill-party" }, data: { deletedAt: null } });
  await prisma.payment.deleteMany({ where: { bill: { receiptId } } });
  await prisma.bill.deleteMany({ where: { receiptId } });
  await prisma.itemShare.deleteMany({ where: { item: { receiptId } } });
  await prisma.receiptItem.deleteMany({ where: { receiptId } });
  await prisma.receipt.update({ where: { id: receiptId }, data: {
    status: "PARSED", deletedAt: null, splitMode: "ITEMIZED", paidByMemberId: "bill-member-a",
    subtotal: "30.00", tax: "2.70", tip: "6.00", total: "38.70",
    items: { create: [
      { id: "bill-steak", lineNumber: 1, name: "Steak", quantity: "1", unitPrice: "20", totalPrice: "20" },
      { id: "bill-app", lineNumber: 2, name: "Appetizer", quantity: "1", unitPrice: "10", totalPrice: "10" },
    ] },
  } });
  await prisma.itemShare.createMany({ data: initialShares });
});

describe("shared receipt access", () => {
  it.each(["allocations", "finalize", "bills"] as const)("%s returns 401 for an unknown identity", async (endpoint) => {
    const before = await snapshot();
    identity.userId = "missing-user";
    const res = await request(endpoint);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unknown user" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["allocations", "finalize", "bills"] as const)("%s returns 404 to another party's member", async (endpoint) => {
    const before = await snapshot();
    identity.userId = "bill-bob";
    const res = await request(endpoint);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["allocations", "finalize", "bills"] as const)("%s returns 404 for an unknown receipt", async (endpoint) => {
    const res = await request(endpoint, { shares: [] }, "missing-receipt");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
  });

  it.each([
    ["allocations", "receipt"], ["finalize", "receipt"], ["bills", "receipt"],
    ["allocations", "party"], ["finalize", "party"], ["bills", "party"],
  ] as const)("%s returns 404 when the %s is deleted", async (endpoint, resource) => {
    if (resource === "receipt") await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    else await prisma.party.update({ where: { id: "bill-party" }, data: { deletedAt: new Date() } });
    const before = await snapshot();
    const res = await request(endpoint);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await snapshot()).toEqual(before);
  });
});

describe("PUT allocations", () => {
  it("replaces shares in order, accepts guest members and ignores unknown fields", async () => {
    const other = await snapshot("bill-other-receipt");
    identity.userId = "bill-charlie";
    const shares = [
      { itemId: "bill-app", memberId: "bill-member-b", weight: 2 },
      { itemId: "bill-app", memberId: "bill-member-a", weight: 1 },
      { ...first, weight: 3 },
    ];
    const res = await request("allocations", { shares: shares.map((share) => ({ ...share, extra: true })), splitMode: "EVEN" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shares: [shares[2], shares[1], shares[0]] });
    const after = await snapshot();
    expect(after.splitMode).toBe("ITEMIZED");
    expect(after.items.flatMap((item) => item.shares)).toEqual([shares[2], shares[1], shares[0]]);
    expect(await snapshot("bill-other-receipt")).toEqual(other);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${receiptId}`);
  });

  it("allows empty arrays to clear all allocations", async () => {
    const res = await request("allocations", { shares: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shares: [] });
    expect((await snapshot()).items.flatMap((item) => item.shares)).toEqual([]);
  });

  it("accepts the largest integer weight", async () => {
    const res = await request("allocations", { shares: [{ ...first, weight: 2147483647 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shares: [{ ...first, weight: 2147483647 }] });
  });

  it.each([
    {}, null, [], { shares: null }, { shares: [{}] }, { shares: [first, first] },
    ...[{ weight: 0 }, { weight: -1 }, { weight: 1.5 }, { weight: "1" }, { weight: 2147483648 },
      { itemId: " " }, { memberId: "" }].map((fields) => ({ shares: [{ ...first, ...fields }] })),
  ])("400 without changes for invalid allocations %j", async (input) => {
    const before = await snapshot();
    const res = await request("allocations", input);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT", message: expect.any(String) } });
    expect(await snapshot()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("400 for malformed JSON", async () => {
    const res = await PUT(new Request("http://test/allocations", { method: "PUT", body: "{" }), {
      params: Promise.resolve({ receiptId }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID_INPUT", message: "Body must be valid JSON" } });
  });

  it.each([
    { itemId: "bill-other-item" }, { itemId: "bill-foreign-item" }, { itemId: "missing-item" },
    { memberId: "bill-foreign-member" }, { memberId: "missing-member" },
  ])("404 and no changes for invalid ownership %j", async (fields) => {
    const before = await snapshot();
    const res = await request("allocations", { shares: [first, { ...first, ...fields, weight: 2 }] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Item or member not found" } });
    expect(await snapshot()).toEqual(before);
  });

  it("409 for finalized receipts", async () => {
    expect((await request("finalize")).status).toBe(200);
    const before = await snapshot();
    const res = await request("allocations");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await snapshot()).toEqual(before);
  });

  it("restores old shares when replacement inserts fail", async () => {
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION allocation_test_fail() RETURNS trigger AS $$
      BEGIN IF NEW.weight = 7 THEN RAISE EXCEPTION 'private allocation failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe("CREATE TRIGGER allocation_test_fail BEFORE INSERT ON item_shares FOR EACH ROW EXECUTE FUNCTION allocation_test_fail()");
      const res = await request("allocations", { shares: [{ ...first, weight: 7 }] });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS allocation_test_fail ON item_shares");
      await prisma.$executeRawUnsafe("DROP FUNCTION allocation_test_fail()");
    }
  });

  it("concurrent requests leave one complete set of allocations", async () => {
    const sets = [initialShares, [{ ...first, weight: 2 }, { itemId: "bill-app", memberId: "bill-member-c", weight: 3 }]];
    const responses = await Promise.all(sets.map((shares) => request("allocations", { shares })));
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    const bodies = await Promise.all(responses.map((res) => res.json()));
    expect(bodies.map((body) => body.shares)).toEqual(sets);
    const saved = (await snapshot()).items.flatMap((item) => item.shares);
    expect(sets).toContainEqual(saved);
  });
});

describe("POST finalize", () => {
  it("writes exact itemized bills, finalizes, and returns receipt details for a non-organizer", async () => {
    identity.userId = "bill-charlie";
    const before = await snapshot();
    const res = await request("finalize");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: receiptId, status: "FINALIZED", items: [{ name: "Steak" }, { name: "Appetizer" }] });
    const after = await snapshot();
    expect(after.status).toBe("FINALIZED");
    expect(after.items).toEqual(before.items);
    expect(after.bills.map((bill) => [bill.memberId, bill.subtotal.toString(), bill.taxShare.toString(), bill.tipShare.toString(), bill.amountOwed.toString()])).toEqual([
      ["bill-member-a", "25", "2.25", "5", "32.25"],
      ["bill-member-b", "5", "0.45", "1", "6.45"],
      ["bill-member-c", "0", "0", "0", "0"],
    ]);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${receiptId}/bills`);
  });

  it("supports even splitting, nullable tip and nullable payer", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: {
      splitMode: "EVEN", tip: null, paidByMemberId: null, subtotal: "10", tax: "0", total: "10",
    } });
    await prisma.receiptItem.update({ where: { id: "bill-steak" }, data: { totalPrice: "0" } });
    const res = await request("finalize");
    expect(res.status).toBe(200);
    const bills = await (await request("bills")).json();
    expect(bills.map((bill: { amountOwed: string }) => bill.amountOwed)).toEqual(["3.34", "3.33", "3.33"]);
    expect(bills.every((bill: { settled: boolean }) => !bill.settled)).toBe(true);
  });

  it.each(["UPLOADED", "PARSING", "PARSE_FAILED"] as const)("rejects %s receipts with 400", async (status) => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { status } });
    const before = await snapshot();
    const res = await request("finalize");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { subtotal: null }, { tax: null }, { total: null }, { subtotal: "31" }, { total: "38.71" },
    { subtotal: "0", tax: "0", tip: "0", total: "0" }, { tax: "-1" }, { paidByMemberId: "bill-foreign-member" },
  ])("rejects invalid preconditions %j without bills or state changes", async (data) => {
    await prisma.receipt.update({ where: { id: receiptId }, data });
    const before = await snapshot();
    const res = await request("finalize");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects an unassigned item", async () => {
    await prisma.itemShare.deleteMany({ where: { itemId: "bill-app" } });
    const before = await snapshot();
    const res = await request("finalize");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects stored shares for foreign members", async () => {
    await prisma.itemShare.create({ data: { itemId: "bill-app", memberId: "bill-foreign-member", weight: 1 } });
    const before = await snapshot();
    const res = await request("finalize");
    expect(res.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("returns 409 on repeated finalization without changing bills", async () => {
    expect((await request("finalize")).status).toBe(200);
    const before = await snapshot();
    const res = await request("finalize");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "CONFLICT", message: "Receipt is finalized" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back partial bill inserts and keeps PARSED when a later insert fails", async () => {
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION bill_test_fail() RETURNS trigger AS $$
      BEGIN IF NEW.member_id = 'bill-member-b' THEN RAISE EXCEPTION 'private bill failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe("CREATE TRIGGER bill_test_fail BEFORE INSERT ON bills FOR EACH ROW EXECUTE FUNCTION bill_test_fail()");
      const res = await request("finalize");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS bill_test_fail ON bills");
      await prisma.$executeRawUnsafe("DROP FUNCTION bill_test_fail()");
    }
  });

  it("concurrent finalization succeeds exactly once", async () => {
    const responses = await Promise.all([request("finalize"), request("finalize")]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const after = await snapshot();
    expect(after.status).toBe("FINALIZED");
    expect(after.bills).toHaveLength(3);
  });

  it("rolls back successfully inserted bills if the final status write fails", async () => {
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION final_status_test_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = 'bill-receipt' AND NEW.status = 'FINALIZED' THEN
          RAISE EXCEPTION 'private status failure';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe("CREATE TRIGGER final_status_test_fail BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION final_status_test_fail()");
      const res = await request("finalize");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS final_status_test_fail ON receipts");
      await prisma.$executeRawUnsafe("DROP FUNCTION final_status_test_fail()");
    }
  });

  it("coordinates allocation replacement with finalization", async () => {
    const shares = [first, { itemId: "bill-app", memberId: "bill-member-a", weight: 1 }];
    const [replace, final] = await Promise.all([request("allocations", { shares }), request("finalize")]);
    expect(final.status).toBe(200);
    expect([200, 409]).toContain(replace.status);
    const bills = (await snapshot()).bills;
    expect(bills[1].amountOwed.toString()).toBe(replace.status === 200 ? "0" : "6.45");
  });

  it("coordinates item replacement with finalization", async () => {
    const [final, replace] = await Promise.all([
      request("finalize"),
      PUT_ITEMS(new Request("http://test/items", { method: "PUT", body: '{"items":[]}' }), { params: Promise.resolve({ receiptId }) }),
    ]);
    expect([[200, 409], [400, 200]]).toContainEqual([final.status, replace.status]);
    const after = await snapshot();
    expect(after.status).toBe(final.status === 200 ? "FINALIZED" : "PARSED");
    expect(after.bills).toHaveLength(final.status === 200 ? 3 : 0);
    expect(after.items).toHaveLength(final.status === 200 ? 2 : 0);
  });
});

describe("GET bills", () => {
  it("returns an empty array before finalization", async () => {
    const res = await request("bills");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("projects ordered bill amounts, marks payer and zero owed settled, and exposes no private fields", async () => {
    expect((await request("finalize")).status).toBe(200);
    const before = await snapshot();
    const res = await request("bills");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: expect.any(String), receiptId, memberId: "bill-member-a", displayName: "Alice", subtotal: "25.00",
        taxShare: "2.25", tipShare: "5.00", amountOwed: "32.25", amountPaid: "0.00", settled: true, createdAt: expect.any(String) },
      { id: expect.any(String), receiptId, memberId: "bill-member-b", displayName: "Guest", subtotal: "5.00",
        taxShare: "0.45", tipShare: "1.00", amountOwed: "6.45", amountPaid: "0.00", settled: false, createdAt: expect.any(String) },
      { id: expect.any(String), receiptId, memberId: "bill-member-c", displayName: "Charlie", subtotal: "0.00",
        taxShare: "0.00", tipShare: "0.00", amountOwed: "0.00", amountPaid: "0.00", settled: true, createdAt: expect.any(String) },
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it("sums payments and detects partial, full and overpayment settlement", async () => {
    expect((await request("finalize")).status).toBe(200);
    const bill = (await snapshot()).bills.find((row) => row.memberId === "bill-member-b")!;
    await prisma.payment.createMany({ data: [{ billId: bill.id, amount: "1.11" }, { billId: bill.id, amount: "2.22" }] });
    let bills = await (await request("bills")).json();
    expect(bills[1]).toMatchObject({ amountPaid: "3.33", settled: false });
    await prisma.payment.create({ data: { billId: bill.id, amount: "3.12" } });
    bills = await (await request("bills")).json();
    expect(bills[1]).toMatchObject({ amountPaid: "6.45", settled: true });
    await prisma.payment.create({ data: { billId: bill.id, amount: "0.01" } });
    bills = await (await request("bills")).json();
    expect(bills[1]).toMatchObject({ amountPaid: "6.46", settled: true });
  });

  it("maps unexpected read failures to a generic 500", async () => {
    const failure = vi.spyOn(prisma.receipt, "findFirst").mockRejectedValueOnce(new Error("private read failure"));
    try {
      const res = await request("bills");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    } finally {
      failure.mockRestore();
    }
  });
});
