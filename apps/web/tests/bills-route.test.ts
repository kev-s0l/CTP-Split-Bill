// Real receipt-owned bill handlers against PGlite; only auth and cache are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "bill-alice" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);

const { PUT: PUT_ASSIGNMENTS } = await import("../app/api/receipts/[id]/assignments/route");
const { PUT: PUT_ALLOCATIONS } = await import("../app/api/receipts/[id]/shared-allocations/route");
const { POST } = await import("../app/api/receipts/[id]/finalize/route");
const { GET: GET_BILLS } = await import("../app/api/receipts/[id]/bills/route");
const { GET: GET_BILL } = await import("../app/api/bills/[billsId]/route");
const { PUT: PUT_ITEMS } = await import("../app/api/receipts/[id]/items/route");

const receiptId = "bill-receipt";
const alice = "bill-participant-a";
const guest = "bill-participant-b";
const charlie = "bill-participant-c";
const steak = "bill-steak";
const appetizer = "bill-app";
const reviewedAt = new Date("2026-01-01T00:00:00Z");
const writeEndpoints = ["assignments", "allocations", "finalize"] as const;
const receiptEndpoints = [...writeEndpoints, "bills"] as const;
const handlers = { assignments: PUT_ASSIGNMENTS, allocations: PUT_ALLOCATIONS, finalize: POST, bills: GET_BILLS };
type Endpoint = keyof typeof handlers;
const validBodies = {
  assignments: { expectedRevision: 1, assignments: [{ itemId: steak, participantId: alice }] },
  allocations: { expectedRevision: 1, allocations: [{ itemId: appetizer, participantIds: [alice, guest] }] },
  finalize: { expectedRevision: 1 },
  bills: undefined,
};

function request(endpoint: Endpoint, body: unknown = validBodies[endpoint], params = { id: receiptId }) {
  const method = endpoint === "bills" ? "GET" : endpoint === "finalize" ? "POST" : "PUT";
  const path = endpoint === "allocations" ? "shared-allocations" : endpoint;
  return handlers[endpoint](new Request(`http://test/api/receipts/${params.id}/${path}`, {
    method,
    ...(method !== "GET" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve(params) });
}

function billRequest(billsId: string | undefined) {
  return GET_BILL(new Request(`http://test/api/bills/${billsId}`), {
    params: Promise.resolve({ billsId: billsId as string }),
  });
}

function snapshot(id = receiptId) {
  return prisma.receipt.findUniqueOrThrow({
    where: { id },
    include: {
      participants: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] },
      items: { orderBy: { lineNumber: "asc" }, include: { sharedAllocations: { orderBy: { participantId: "asc" } } } },
      bills: { orderBy: { participantId: "asc" } },
    },
  });
}

async function expectError(response: Response, status: number, code: string, message?: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    error: { code, message: message ?? (code === "INTERNAL" ? "Something went wrong" : expect.any(String)) },
  });
}

async function expectUnchanged(response: Response, before: Awaited<ReturnType<typeof snapshot>>, status: number, code: string) {
  await expectError(response, status, code);
  expect(await snapshot()).toEqual(before);
  expect(cache.revalidatePath).not.toHaveBeenCalled();
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "bill-alice", name: "Alice", email: "bill-alice@example.com" },
    { id: "bill-bob", name: "Bob", email: "bill-bob@example.com", phone: "+12125550123" },
  ] });
  for (const [prefix, ownerId] of [["bill-other", "bill-alice"], ["bill-foreign", "bill-bob"]]) {
    await prisma.receipt.create({ data: {
      id: `${prefix}-receipt`, ownerId, imageBlobName: `${prefix}.jpg`, imageContentType: "image/jpeg",
      status: "FINALIZED", subtotal: "1", tax: "0", tip: "0", total: "1",
      participants: { create: { id: `${prefix}-participant`, displayName: "Other" } },
      items: { create: { id: `${prefix}-item`, lineNumber: 1, name: "Other", quantity: "1", unitPrice: "1", totalPrice: "1" } },
    } });
    await prisma.bill.create({ data: {
      id: `${prefix}-bill`, receiptId: `${prefix}-receipt`, participantId: `${prefix}-participant`,
      subtotal: "1", taxShare: "0", tipShare: "0", amountOwed: "1",
    } });
  }
});

beforeEach(async () => {
  identity.userId = "bill-alice";
  cache.revalidatePath.mockClear();
  const fields = {
    ownerId: "bill-alice", status: "DRAFT" as const, parseStatus: "SUCCEEDED" as const,
    splitMode: "SHARED_ITEMS" as const, revision: 1, reviewedAt, finalizedAt: null,
    deletedAt: null, paidByParticipantId: null, subtotal: "30.00", tax: "2.70", tip: "6.00", total: "38.70",
  };
  await prisma.receipt.upsert({
    where: { id: receiptId }, update: fields,
    create: { id: receiptId, ...fields, imageBlobName: "test/bill.jpg", imageContentType: "image/jpeg" },
  });
  await prisma.bill.deleteMany({ where: { receiptId } });
  await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
  await prisma.receiptItem.deleteMany({ where: { receiptId } });
  await prisma.participant.deleteMany({ where: { receiptId } });
  // Reverse insertion order and equal join times exercise joinedAt/id ordering.
  await prisma.participant.createMany({ data: [
    { id: charlie, receiptId, displayName: "Charlie", joinedAt: new Date(1000) },
    { id: guest, receiptId, displayName: "Guest", phone: "+12125550123", joinedAt: new Date(1000) },
    { id: alice, receiptId, displayName: "Alice", joinedAt: new Date(0) },
  ] });
  await prisma.receiptItem.createMany({ data: [
    { id: steak, receiptId, lineNumber: 1, name: "Steak", quantity: "1", unitPrice: "20", totalPrice: "20", isVerified: true, assignedParticipantId: alice },
    { id: appetizer, receiptId, lineNumber: 2, name: "Appetizer", quantity: "1", unitPrice: "10", totalPrice: "10", isVerified: true },
  ] });
  await prisma.sharedItemAllocation.createMany({ data: [alice, guest].map((participantId) => ({
    receiptId, itemId: appetizer, participantId,
  })) });
  await prisma.receipt.update({ where: { id: receiptId }, data: { paidByParticipantId: alice } });
});

describe("receipt endpoint access and revision guards", () => {
  it.each(receiptEndpoints)("%s returns 401 for an unknown identity", async (endpoint) => {
    const before = await snapshot();
    identity.userId = "missing-user";
    await expectUnchanged(await request(endpoint), before, 401, "UNAUTHENTICATED");
  });

  it.each(receiptEndpoints)("%s requires the owner even when a participant phone matches another user", async (endpoint) => {
    const before = await snapshot();
    identity.userId = "bill-bob";
    await expectUnchanged(await request(endpoint), before, 404, "NOT_FOUND");
  });

  it.each(receiptEndpoints)("%s rejects another owner's receipt without writes", async (endpoint) => {
    const foreign = await snapshot("bill-foreign-receipt");
    await expectError(await request(endpoint, validBodies[endpoint], { id: foreign.id }), 404, "NOT_FOUND", "Receipt not found");
    expect(await snapshot(foreign.id)).toEqual(foreign);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(receiptEndpoints)("%s returns 404 for unknown, blank and missing IDs", async (endpoint) => {
    const before = await snapshot();
    for (const id of ["missing-receipt", "", " ", undefined]) {
      await expectUnchanged(await request(endpoint, validBodies[endpoint], { id: id as string }), before, 404, "NOT_FOUND");
    }
  });

  it.each(receiptEndpoints)("%s excludes soft-deleted receipts", async (endpoint) => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    const before = await snapshot();
    await expectUnchanged(await request(endpoint), before, 404, "NOT_FOUND");
  });

  it.each(writeEndpoints)("%s rejects finalized, parsing and stale writes", async (endpoint) => {
    const before = await snapshot();
    await expectUnchanged(await request(endpoint, { ...validBodies[endpoint], expectedRevision: 99 }), before, 409, "CONFLICT");
    await prisma.receipt.update({ where: { id: receiptId }, data: { parseStatus: "PARSING" } });
    const parsing = await snapshot();
    await expectUnchanged(await request(endpoint), parsing, 409, "CONFLICT");
    await prisma.receipt.update({ where: { id: receiptId }, data: { parseStatus: "SUCCEEDED", status: "FINALIZED" } });
    const finalized = await snapshot();
    await expectUnchanged(await request(endpoint), finalized, 409, "CONFLICT");
  });

  it.each(writeEndpoints)("%s requires a valid expectedRevision", async (endpoint) => {
    const before = await snapshot();
    for (const expectedRevision of [undefined, 0, -1, 1.5, "1", 2147483647]) {
      await expectUnchanged(await request(endpoint, { ...validBodies[endpoint], expectedRevision }), before, 400, "INVALID_INPUT");
    }
  });

  it.each(writeEndpoints)("%s rejects malformed JSON and non-object bodies", async (endpoint) => {
    const before = await snapshot();
    const response = await handlers[endpoint](new Request("http://test", {
      method: endpoint === "finalize" ? "POST" : "PUT", body: "{",
    }), { params: Promise.resolve({ id: receiptId }) });
    await expectError(response, 400, "INVALID_INPUT", "Body must be valid JSON");
    for (const body of [null, [], "invalid"]) {
      await expectUnchanged(await request(endpoint, body), before, 400, "INVALID_INPUT");
    }
  });
});

describe("PUT individual assignments", () => {
  it("replaces assignments, clears newly personal sharing and retains review and unrelated receipts", async () => {
    const other = await snapshot("bill-other-receipt");
    const foreign = await snapshot("bill-foreign-receipt");
    const response = await request("assignments", { expectedRevision: 1, assignments: [
      { itemId: ` ${appetizer} `, participantId: ` ${guest} `, extra: true },
    ], ownerId: "bill-bob", revision: 99 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: receiptId, ownerId: "bill-alice", revision: 2, reviewedAt: reviewedAt.toISOString(),
      items: [{ assignedParticipantId: null, sharedAllocations: [] }, { assignedParticipantId: guest, sharedAllocations: [] }],
    });
    expect((await snapshot()).items.map((item) => item.assignedParticipantId)).toEqual([null, guest]);
    expect(await prisma.sharedItemAllocation.count({ where: { receiptId } })).toBe(0);
    expect(await snapshot(other.id)).toEqual(other);
    expect(await snapshot(foreign.id)).toEqual(foreign);
    expect(cache.revalidatePath.mock.calls).toEqual([[`/api/receipts/${receiptId}`]]);
  });

  it("supports ITEMIZED assignments and permits clearing them without clearing shared rows", async () => {
    expect((await request("assignments", { expectedRevision: 1, assignments: [] })).status).toBe(200);
    expect((await snapshot()).items.map((item) => item.assignedParticipantId)).toEqual([null, null]);
    expect(await prisma.sharedItemAllocation.count({ where: { receiptId } })).toBe(2);
    await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
    await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "ITEMIZED" } });
    const response = await request("assignments", { expectedRevision: 2, assignments: [
      { itemId: steak, participantId: alice }, { itemId: appetizer, participantId: guest },
    ] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 3, splitMode: "ITEMIZED", items: [
      { assignedParticipantId: alice }, { assignedParticipantId: guest },
    ] });
  });

  it("rejects assignments in EVEN mode", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "EVEN" } });
    const before = await snapshot();
    await expectUnchanged(await request("assignments"), before, 409, "CONFLICT");
  });

  it.each([
    {}, { assignments: null }, { assignments: [{}] },
    { assignments: [{ itemId: steak, participantId: alice }, { itemId: steak, participantId: guest }] },
    ...[{ itemId: " " }, { participantId: "" }, { itemId: "x".repeat(201) }, { participantId: 1 }]
      .map((fields) => ({ assignments: [{ itemId: steak, participantId: alice, ...fields }] })),
    { assignments: Array.from({ length: 501 }, (_, index) => ({ itemId: `item-${index}`, participantId: alice })) },
  ])("rejects invalid assignments %# without writes", async (input) => {
    const before = await snapshot();
    await expectUnchanged(await request("assignments", { expectedRevision: 1, ...input }), before, 400, "INVALID_INPUT");
  });
});

describe("PUT equal shared allocations", () => {
  it("replaces sharing, clears newly shared assignees and retains review", async () => {
    const other = await snapshot("bill-other-receipt");
    const response = await request("allocations", { expectedRevision: 1, allocations: [
      { itemId: ` ${steak} `, participantIds: [` ${charlie} `, guest], extra: true },
    ], splitMode: "EVEN" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 2, reviewedAt: reviewedAt.toISOString(), splitMode: "SHARED_ITEMS",
      items: [
        { assignedParticipantId: null, sharedAllocations: [{ participantId: guest }, { participantId: charlie }] },
        { assignedParticipantId: null, sharedAllocations: [] },
      ],
    });
    const after = await snapshot();
    expect(after.items[0].assignedParticipantId).toBeNull();
    expect(after.items[0].sharedAllocations).toEqual([guest, charlie].map((participantId) => ({ receiptId, itemId: steak, participantId })));
    expect(after.items[1].sharedAllocations).toEqual([]);
    expect(await snapshot(other.id)).toEqual(other);
    expect(cache.revalidatePath.mock.calls).toEqual([[`/api/receipts/${receiptId}`]]);
  });

  it("clears sharing with an empty array and preserves individual assignments", async () => {
    const response = await request("allocations", { expectedRevision: 1, allocations: [] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 2, reviewedAt: reviewedAt.toISOString(), items: [
      { assignedParticipantId: alice, sharedAllocations: [] }, { assignedParticipantId: null, sharedAllocations: [] },
    ] });
    expect(await prisma.sharedItemAllocation.count({ where: { receiptId } })).toBe(0);
  });

  it.each(["EVEN", "ITEMIZED"] as const)("rejects sharing in %s mode", async (splitMode) => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode } });
    const before = await snapshot();
    await expectUnchanged(await request("allocations"), before, 409, "CONFLICT");
  });

  it.each([
    {}, { shares: [{ itemId: appetizer, memberId: alice, weight: 2 }] }, { allocations: null }, { allocations: [{}] },
    { allocations: [validBodies.allocations.allocations[0], validBodies.allocations.allocations[0]] },
    ...[[], [alice], [alice, alice], [alice, " "], [alice, "x".repeat(201)], [alice, 1],
      Array.from({ length: 201 }, (_, index) => `participant-${index}`)]
      .map((participantIds) => ({ allocations: [{ itemId: appetizer, participantIds }] })),
    { allocations: [{ itemId: " ", participantIds: [alice, guest] }] },
    { allocations: [{ itemId: "x".repeat(201), participantIds: [alice, guest] }] },
    { allocations: Array.from({ length: 501 }, (_, index) => ({ itemId: `item-${index}`, participantIds: [alice, guest] })) },
  ])("rejects invalid shared allocations %# without writes", async (input) => {
    const before = await snapshot();
    await expectUnchanged(await request("allocations", { expectedRevision: 1, ...input }), before, 400, "INVALID_INPUT");
  });
});

describe.each(["assignments", "allocations"] as const)("%s reference checks and transactions", (endpoint) => {
  it.each([
    { itemId: "bill-other-item" }, { itemId: "bill-foreign-item" }, { itemId: "missing-item" },
    { participantId: "bill-other-participant" }, { participantId: "bill-foreign-participant" }, { participantId: "missing-participant" },
  ])("rejects foreign or unknown references %j, including another receipt of the same owner", async (fields) => {
    const before = await snapshot();
    const other = await snapshot("bill-other-receipt");
    const body = endpoint === "assignments"
      ? { expectedRevision: 1, assignments: [
        { itemId: steak, participantId: guest }, { itemId: appetizer, participantId: alice, ...fields },
      ] }
      : { expectedRevision: 1, allocations: [
        { itemId: appetizer, participantIds: [alice, guest] },
        { itemId: fields.itemId ?? steak, participantIds: [alice, fields.participantId ?? charlie] },
      ] };
    await expectUnchanged(await request(endpoint, body), before, 404, "NOT_FOUND");
    expect(await snapshot(other.id)).toEqual(other);
  });

  it("rolls back earlier changes and revision if a later write fails", async () => {
    const before = await snapshot();
    const table = endpoint === "assignments" ? "receipt_items" : "shared_item_allocations";
    const operation = endpoint === "assignments" ? "UPDATE" : "INSERT";
    const condition = endpoint === "assignments"
      ? `NEW.id = '${appetizer}' AND NEW.assigned_participant_id = '${guest}'`
      : `NEW.participant_id = '${charlie}'`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION allocation_test_fail() RETURNS trigger AS $$
      BEGIN IF ${condition} THEN RAISE EXCEPTION 'private allocation failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER allocation_test_fail BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION allocation_test_fail()`);
      const body = endpoint === "assignments"
        ? { expectedRevision: 1, assignments: [{ itemId: steak, participantId: guest }, { itemId: appetizer, participantId: guest }] }
        : { expectedRevision: 1, allocations: [{ itemId: steak, participantIds: [guest, charlie] }] };
      await expectUnchanged(await request(endpoint, body), before, 500, "INTERNAL");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS allocation_test_fail ON ${table}`);
      await prisma.$executeRawUnsafe("DROP FUNCTION allocation_test_fail()");
    }
  });

  it("accepts only one concurrent replacement at a shared revision", async () => {
    const bodies = endpoint === "assignments"
      ? [alice, guest].map((participantId) => ({ expectedRevision: 1, assignments: [{ itemId: steak, participantId }] }))
      : [[alice, guest], [guest, charlie]].map((participantIds) => ({ expectedRevision: 1, allocations: [{ itemId: appetizer, participantIds }] }));
    const responses = await Promise.all(bodies.map((body) => request(endpoint, body)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses.findIndex((response) => response.status === 200);
    const after = await snapshot();
    expect(after).toMatchObject({ revision: 2, status: "DRAFT", reviewedAt });
    if (endpoint === "assignments") {
      expect(after.items.map((item) => item.assignedParticipantId)).toEqual([[alice, guest][winner], null]);
    } else {
      expect(after.items[1].sharedAllocations.map((allocation) => allocation.participantId)).toEqual([[alice, guest], [guest, charlie]][winner]);
    }
    expect(cache.revalidatePath).toHaveBeenCalledTimes(1);
  });

  it("competes with finalization using the same revision lock", async () => {
    const body = endpoint === "assignments"
      ? { expectedRevision: 1, assignments: [{ itemId: steak, participantId: alice }, { itemId: appetizer, participantId: alice }] }
      : { expectedRevision: 1, allocations: [{ itemId: appetizer, participantIds: [guest, charlie] }] };
    const [replace, final] = await Promise.all([request(endpoint, body), request("finalize")]);
    expect([replace.status, final.status].sort()).toEqual([200, 409]);
    const after = await snapshot();
    expect(after.revision).toBe(2);
    expect(after.status).toBe(final.status === 200 ? "FINALIZED" : "DRAFT");
    expect(after.bills).toHaveLength(final.status === 200 ? 3 : 0);
    if (replace.status === 200) expect((await request("finalize", { expectedRevision: 2 })).status).toBe(200);
    const bills = await (await request("bills")).json();
    expect(bills.map((bill: { amountOwed: string }) => bill.amountOwed)).toEqual(final.status === 200
      ? ["32.25", "6.45", "0.00"]
      : endpoint === "assignments" ? ["38.70", "0.00", "0.00"] : ["25.80", "6.45", "6.45"]);
  });
});

describe("POST finalize", () => {
  it.each(["EVEN", "ITEMIZED", "SHARED_ITEMS"] as const)("finalizes exact %s bills and reconciles every monetary column", async (splitMode) => {
    if (splitMode !== "SHARED_ITEMS") {
      await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode } });
      if (splitMode === "EVEN") {
        await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: null } });
      } else {
        await prisma.receiptItem.update({ where: { id: appetizer }, data: { assignedParticipantId: guest } });
      }
    }
    const before = await snapshot();
    const response = await request("finalize", { expectedRevision: 1, bills: [{ participantId: guest, amountOwed: "0" }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: receiptId, status: "FINALIZED", revision: 2, finalizedAt: expect.any(String) });
    const after = await snapshot();
    expect(after.finalizedAt).toBeInstanceOf(Date);
    expect(after.items).toEqual(before.items);
    expect(after.participants).toEqual(before.participants);
    const bills = await (await request("bills")).json();
    expect(bills.map((bill: { participantId: string }) => bill.participantId)).toEqual([alice, guest, charlie]);
    expect(bills.map((bill: { amountOwed: string }) => bill.amountOwed)).toEqual(
      splitMode === "EVEN" ? ["12.90", "12.90", "12.90"] : splitMode === "ITEMIZED" ? ["25.80", "12.90", "0.00"] : ["32.25", "6.45", "0.00"],
    );
    for (const [column, total] of [["subtotal", 3000n], ["taxShare", 270n], ["tipShare", 600n], ["amountOwed", 3870n]] as const) {
      expect(bills.reduce((sum: bigint, bill: Record<string, string>) => sum + BigInt(bill[column].replace(".", "")), 0n)).toBe(total);
    }
    expect(cache.revalidatePath.mock.calls).toEqual([[`/api/receipts/${receiptId}`], [`/api/receipts/${receiptId}/bills`]]);
  });

  it("rounds even splits by joinedAt/id, treats null tip as zero and allows manually reviewed failed OCR", async () => {
    await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
    await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: null } });
    await prisma.receiptItem.update({ where: { id: steak }, data: { totalPrice: "0" } });
    await prisma.receipt.update({ where: { id: receiptId }, data: {
      splitMode: "EVEN", parseStatus: "FAILED", tip: null, paidByParticipantId: null, subtotal: "10", tax: "0", total: "10",
    } });
    expect((await request("finalize")).status).toBe(200);
    const bills = await (await request("bills")).json();
    expect(bills.map((bill: { amountOwed: string }) => bill.amountOwed)).toEqual(["3.34", "3.33", "3.33"]);
    expect(bills.map((bill: { settled: boolean }) => bill.settled)).toEqual([false, false, false]);
  });

  it.each([
    { reviewedAt: null }, { subtotal: null }, { tax: null }, { total: null },
    { subtotal: "31" }, { total: "38.71" }, { subtotal: "0", tax: "0", tip: "0", total: "0" },
  ])("rejects unreviewed or unreconciled receipt data %j", async (data) => {
    await prisma.receipt.update({ where: { id: receiptId }, data });
    const before = await snapshot();
    await expectUnchanged(await request("finalize"), before, 400, "INVALID_INPUT");
  });

  it.each([
    { isVerified: false }, { name: null }, { name: " " }, { quantity: null }, { unitPrice: null }, { totalPrice: null },
  ])("rejects unverified or incomplete items %j", async (data) => {
    await prisma.receiptItem.update({ where: { id: steak }, data });
    const before = await snapshot();
    await expectUnchanged(await request("finalize"), before, 400, "INVALID_INPUT");
  });

  it.each([
    "unassigned", "unassigned ITEMIZED item", "one shared participant", "both personal and shared",
    "sharing in ITEMIZED", "assignments in EVEN", "sharing in EVEN",
  ])("rejects %s representations", async (state) => {
    if (state === "unassigned") await prisma.sharedItemAllocation.deleteMany({ where: { itemId: appetizer } });
    if (state === "unassigned ITEMIZED item") {
      await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "ITEMIZED" } });
    }
    if (state === "one shared participant") await prisma.sharedItemAllocation.deleteMany({ where: { itemId: appetizer, participantId: guest } });
    if (state === "both personal and shared") await prisma.receiptItem.update({ where: { id: appetizer }, data: { assignedParticipantId: alice } });
    if (state === "sharing in ITEMIZED") {
      await prisma.receiptItem.update({ where: { id: appetizer }, data: { assignedParticipantId: guest } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "ITEMIZED" } });
    }
    if (state === "assignments in EVEN") {
      await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "EVEN" } });
    }
    if (state === "sharing in EVEN") {
      await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: null } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode: "EVEN" } });
    }
    const before = await snapshot();
    await expectUnchanged(await request("finalize"), before, 400, "INVALID_INPUT");
  });

  it("rejects a receipt with no participants", async () => {
    await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
    await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: null } });
    await prisma.receipt.update({ where: { id: receiptId }, data: { paidByParticipantId: null, splitMode: "EVEN" } });
    await prisma.participant.deleteMany({ where: { receiptId } });
    const before = await snapshot();
    await expectUnchanged(await request("finalize"), before, 400, "INVALID_INPUT");
  });

  it("rejects repeated finalization without changing the snapshot", async () => {
    expect((await request("finalize")).status).toBe(200);
    const before = await snapshot();
    cache.revalidatePath.mockClear();
    await expectUnchanged(await request("finalize", { expectedRevision: 2 }), before, 409, "CONFLICT");
  });

  it.each(["bill insert", "final status"])("rolls back bills, status and revision after a %s failure", async (stage) => {
    const before = await snapshot();
    const table = stage === "bill insert" ? "bills" : "receipts";
    const operation = stage === "bill insert" ? "INSERT" : "UPDATE";
    const condition = stage === "bill insert" ? `NEW.participant_id = '${guest}'` : `NEW.id = '${receiptId}' AND NEW.status = 'FINALIZED'`;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION finalize_test_fail() RETURNS trigger AS $$
      BEGIN IF ${condition} THEN RAISE EXCEPTION 'private finalization failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER finalize_test_fail BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION finalize_test_fail()`);
      await expectUnchanged(await request("finalize"), before, 500, "INTERNAL");
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS finalize_test_fail ON ${table}`);
      await prisma.$executeRawUnsafe("DROP FUNCTION finalize_test_fail()");
    }
  });

  it("allows only one concurrent finalization", async () => {
    const responses = await Promise.all([request("finalize"), request("finalize")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await snapshot()).toMatchObject({ status: "FINALIZED", revision: 2, bills: [expect.any(Object), expect.any(Object), expect.any(Object)] });
    expect(cache.revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("coordinates item replacement with finalization and invalidates review when replacement wins", async () => {
    const [final, replace] = await Promise.all([
      request("finalize"),
      PUT_ITEMS(new Request(`http://test/api/receipts/${receiptId}/items`, {
        method: "PUT", body: JSON.stringify({ expectedRevision: 1, items: [] }),
      }), { params: Promise.resolve({ id: receiptId }) }),
    ]);
    expect([final.status, replace.status].sort()).toEqual([200, 409]);
    const after = await snapshot();
    expect(after.status).toBe(final.status === 200 ? "FINALIZED" : "DRAFT");
    expect(after.revision).toBe(2);
    expect(after.bills).toHaveLength(final.status === 200 ? 3 : 0);
    expect(after.items).toHaveLength(final.status === 200 ? 2 : 0);
    expect(after.reviewedAt).toEqual(final.status === 200 ? reviewedAt : null);
  });
});

describe("GET receipt bills", () => {
  it("returns an empty collection before finalization", async () => {
    const before = await snapshot();
    const response = await request("bills");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("projects ordered stored amounts, phone and payer/zero settlement without private fields", async () => {
    expect((await request("finalize")).status).toBe(200);
    const before = await snapshot();
    cache.revalidatePath.mockClear();
    const response = await request("bills");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: expect.any(String), receiptId, participantId: alice, displayName: "Alice", phone: null,
        subtotal: "25.00", taxShare: "2.25", tipShare: "5.00", amountOwed: "32.25", paidAt: null,
        settled: true, outstandingAmount: "0.00", createdAt: expect.any(String) },
      { id: expect.any(String), receiptId, participantId: guest, displayName: "Guest", phone: "+12125550123",
        subtotal: "5.00", taxShare: "0.45", tipShare: "1.00", amountOwed: "6.45", paidAt: null,
        settled: false, outstandingAmount: "6.45", createdAt: expect.any(String) },
      { id: expect.any(String), receiptId, participantId: charlie, displayName: "Charlie", phone: null,
        subtotal: "0.00", taxShare: "0.00", tipShare: "0.00", amountOwed: "0.00", paidAt: null,
        settled: true, outstandingAmount: "0.00", createdAt: expect.any(String) },
    ]);
    expect(await snapshot()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unexpected collection read failures to a generic 500", async () => {
    const before = await snapshot();
    const failure = vi.spyOn(prisma.receipt, "findFirst").mockRejectedValueOnce(new Error("private read failure"));
    try {
      await expectUnchanged(await request("bills"), before, 500, "INTERNAL");
    } finally {
      failure.mockRestore();
    }
  });
});

describe("GET individual bill", () => {
  let billId: string;
  beforeEach(async () => {
    expect((await request("finalize")).status).toBe(200);
    billId = (await snapshot()).bills.find((bill) => bill.participantId === guest)!.id;
    cache.revalidatePath.mockClear();
  });

  it("uses a bill ID and returns the same single object as the receipt collection", async () => {
    const before = await snapshot();
    const response = await billRequest(billId);
    expect(response.status).toBe(200);
    const bills = await (await request("bills")).json();
    const body = await response.json();
    expect(body).toEqual(bills[1]);
    expect(body).toMatchObject({ id: billId, receiptId, participantId: guest, amountOwed: "6.45", settled: false, outstandingAmount: "6.45" });
    expect(await snapshot()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 401 for unknown users and 404 for another owner", async () => {
    const before = await snapshot();
    identity.userId = "missing-user";
    await expectUnchanged(await billRequest(billId), before, 401, "UNAUTHENTICATED");
    identity.userId = "bill-bob";
    await expectUnchanged(await billRequest(billId), before, 404, "NOT_FOUND");
  });

  it.each(["bill-foreign-bill", "missing-bill", receiptId, "", " ", undefined])("returns 404 for inaccessible or invalid bill ID %j", async (id) => {
    const before = await snapshot();
    await expectUnchanged(await billRequest(id), before, 404, "NOT_FOUND");
  });

  it("excludes bills of soft-deleted receipts from both reads", async () => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    const before = await snapshot();
    await expectUnchanged(await billRequest(billId), before, 404, "NOT_FOUND");
    await expectUnchanged(await request("bills"), before, 404, "NOT_FOUND");
  });

  it("uses paidAt for binary settlement in both reads without changing calculated amounts", async () => {
    const before = await snapshot();
    const paidAt = new Date("2026-02-01T12:00:00Z");
    await prisma.bill.update({ where: { id: billId }, data: { paidAt } });
    const paid = await snapshot();
    for (const response of [await billRequest(billId), await request("bills")]) {
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body) ? body[1] : body).toMatchObject({
        paidAt: paidAt.toISOString(), amountOwed: "6.45", settled: true, outstandingAmount: "0.00",
      });
    }
    expect(await snapshot()).toEqual(paid);
    await prisma.bill.update({ where: { id: billId }, data: { paidAt: null } });
    expect(await (await billRequest(billId)).json()).toMatchObject({ paidAt: null, settled: false, outstandingAmount: "6.45" });
    const amounts = (bills: typeof before.bills) => bills.map(({ id, participantId, subtotal, taxShare, tipShare, amountOwed }) => ({
      id, participantId, subtotal, taxShare, tipShare, amountOwed,
    }));
    expect(amounts((await snapshot()).bills)).toEqual(amounts(before.bills));
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unexpected individual read failures to a generic 500", async () => {
    const before = await snapshot();
    const failure = vi.spyOn(prisma.bill, "findFirst").mockRejectedValueOnce(new Error("private bill failure"));
    try {
      await expectUnchanged(await billRequest(billId), before, 500, "INTERNAL");
    } finally {
      failure.mockRestore();
    }
  });
});
