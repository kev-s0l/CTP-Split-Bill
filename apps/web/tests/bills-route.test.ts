// Real assignment, shared-allocation, finalize and bill handlers against PGlite, with only auth and cache mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "bill-alice" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);

const { PUT: ASSIGN } = await import("../app/api/receipts/[id]/assignments/route");
const { PUT: SHARE } = await import("../app/api/receipts/[id]/shared-allocations/route");
const { POST: FINALIZE } = await import("../app/api/receipts/[id]/finalize/route");
const { GET: BILLS } = await import("../app/api/receipts/[id]/bills/route");
const { GET: BILL } = await import("../app/api/bills/[billsId]/route");

const receiptId = "bill-receipt";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const send = (handler: typeof ASSIGN, body: unknown, id = receiptId) =>
  handler(new Request(`http://test/api/receipts/${id}`, { method: "PUT", body: JSON.stringify(body) }), context(id));

const assign = (assignments: unknown[], expectedRevision = 1, id = receiptId) =>
  send(ASSIGN, { expectedRevision, assignments }, id);
const share = (allocations: unknown[], expectedRevision = 1, id = receiptId) =>
  send(SHARE, { expectedRevision, allocations }, id);
const finalize = (expectedRevision = 1, id = receiptId) => send(FINALIZE, { expectedRevision }, id);
const bills = (id = receiptId) => BILLS(new Request(`http://test/api/receipts/${id}/bills`), context(id));
const bill = (billsId: string) =>
  BILL(new Request(`http://test/api/bills/${billsId}`), { params: Promise.resolve({ billsId }) });

function snapshot(id = receiptId) {
  return prisma.receipt.findUniqueOrThrow({
    where: { id },
    include: {
      items: { orderBy: { lineNumber: "asc" }, include: { sharedAllocations: { orderBy: { participantId: "asc" } } } },
      bills: { orderBy: { participantId: "asc" } },
    },
  });
}

async function setMode(splitMode: "EVEN" | "ITEMIZED" | "SHARED_ITEMS") {
  await prisma.receipt.update({ where: { id: receiptId }, data: { splitMode } });
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "bill-alice", name: "Alice", email: "bill-alice@example.com" },
    { id: "bill-bob", name: "Bob", email: "bill-bob@example.com" },
  ] });
  await prisma.receipt.create({ data: {
    id: "bill-foreign", ownerId: "bill-bob", imageBlobName: "foreign.jpg", imageContentType: "image/jpeg",
    participants: { create: { id: "bill-foreign-person", displayName: "Bob" } },
    items: { create: { id: "bill-foreign-item", lineNumber: 1, name: "Foreign", unitPrice: "1", totalPrice: "1" } },
  } });
});

beforeEach(async () => {
  identity.userId = "bill-alice";
  cache.revalidatePath.mockClear();
  const fields = {
    ownerId: "bill-alice", status: "DRAFT" as const, parseStatus: "SUCCEEDED" as const,
    revision: 1, deletedAt: null, reviewedAt: new Date(0), finalizedAt: null,
    paidByParticipantId: null, splitMode: "ITEMIZED" as const,
    subtotal: "30.00", tax: "2.70", tip: "6.00", total: "38.70",
  };
  await prisma.receipt.upsert({
    where: { id: receiptId }, update: fields,
    create: { id: receiptId, ...fields, imageBlobName: "bill.jpg", imageContentType: "image/jpeg" },
  });
  await prisma.bill.deleteMany({ where: { receiptId } });
  await prisma.sharedItemAllocation.deleteMany({ where: { receiptId } });
  await prisma.receiptItem.deleteMany({ where: { receiptId } });
  await prisma.participant.deleteMany({ where: { receiptId } });
  await prisma.participant.createMany({ data: [
    { id: "bill-alex", receiptId, displayName: "Alex", phone: "+12125550123", joinedAt: new Date(0) },
    { id: "bill-sam", receiptId, displayName: "Sam", joinedAt: new Date(1000) },
    { id: "bill-cara", receiptId, displayName: "Cara", joinedAt: new Date(2000) },
  ] });
  await prisma.receiptItem.createMany({ data: [
    { id: "bill-steak", receiptId, lineNumber: 1, name: "Steak", quantity: "1", unitPrice: "20", totalPrice: "20", isVerified: true },
    { id: "bill-app", receiptId, lineNumber: 2, name: "Appetizer", quantity: "1", unitPrice: "10", totalPrice: "10", isVerified: true },
  ] });
});

describe("owner scoping", () => {
  const calls = {
    assignments: (id: string) => assign([], 1, id),
    "shared-allocations": (id: string) => share([], 1, id),
    finalize: (id: string) => finalize(1, id),
    bills: (id: string) => bills(id),
  };
  const endpoints = Object.keys(calls) as (keyof typeof calls)[];

  it.each(endpoints)("%s returns 401 for an unknown identity", async (endpoint) => {
    identity.userId = "missing-user";
    const before = await snapshot();
    const res = await calls[endpoint](receiptId);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unknown user" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each(endpoints)("%s returns 404 for another owner's, unknown and deleted receipts", async (endpoint) => {
    identity.userId = "bill-bob";
    const before = await snapshot();
    expect((await calls[endpoint](receiptId)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
    identity.userId = "bill-alice";
    expect((await calls[endpoint]("missing-receipt")).status).toBe(404);
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    const deleted = await snapshot();
    const res = await calls[endpoint](receiptId);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    expect(await snapshot()).toEqual(deleted);
  });
});

describe("PUT assignments", () => {
  it("replaces assignments, advances revision, keeps review and revalidates", async () => {
    const res = await assign([{ itemId: "bill-steak", participantId: "bill-alex" }, { itemId: "bill-app", participantId: "bill-sam" }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(2);
    expect(body.items.map((item: { assignedParticipantId: string }) => item.assignedParticipantId)).toEqual(["bill-alex", "bill-sam"]);
    const after = await snapshot();
    expect(after.reviewedAt).toEqual(new Date(0));
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${receiptId}`);

    expect((await assign([{ itemId: "bill-app", participantId: "bill-cara" }], 2)).status).toBe(200);
    expect((await snapshot()).items.map((item) => item.assignedParticipantId)).toEqual([null, "bill-cara"]);
  });

  it("clears an item's sharing when it becomes personal in SHARED_ITEMS mode", async () => {
    await setMode("SHARED_ITEMS");
    expect((await share([{ itemId: "bill-app", participantIds: ["bill-alex", "bill-sam"] }])).status).toBe(200);
    expect((await assign([{ itemId: "bill-app", participantId: "bill-cara" }], 2)).status).toBe(200);
    const app = (await snapshot()).items[1];
    expect(app.assignedParticipantId).toBe("bill-cara");
    expect(app.sharedAllocations).toEqual([]);
  });

  it("rejects EVEN receipts with 409", async () => {
    await setMode("EVEN");
    const before = await snapshot();
    const res = await assign([{ itemId: "bill-steak", participantId: "bill-alex" }]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { itemId: "bill-foreign-item", participantId: "bill-alex" },
    { itemId: "bill-steak", participantId: "bill-foreign-person" },
    { itemId: "missing", participantId: "bill-alex" },
  ])("404 without changes for a reference outside the receipt %j", async (assignment) => {
    const before = await snapshot();
    const res = await assign([{ itemId: "bill-app", participantId: "bill-sam" }, assignment]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Item or participant not found" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { assignments: [{ itemId: "bill-steak", participantId: "bill-alex" }, { itemId: "bill-steak", participantId: "bill-sam" }] },
    { assignments: [{ itemId: " ", participantId: "bill-alex" }] },
    { assignments: null },
  ])("400 without changes for invalid input %j", async (input) => {
    const before = await snapshot();
    const res = await send(ASSIGN, { expectedRevision: 1, ...input });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await snapshot()).toEqual(before);
  });

  it("409 for stale revisions and finalized receipts", async () => {
    const res = await assign([], 7);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "CONFLICT", message: "Receipt has changed; reload before saving" } });
    await prisma.receipt.update({ where: { id: receiptId }, data: { status: "FINALIZED" } });
    expect(await (await assign([])).json()).toEqual({ error: { code: "CONFLICT", message: "Receipt is finalized" } });
  });
});

describe("PUT shared-allocations", () => {
  it("writes equal shared rows and clears assignees on newly shared items", async () => {
    await prisma.receiptItem.update({ where: { id: "bill-app" }, data: { assignedParticipantId: "bill-cara" } });
    await setMode("SHARED_ITEMS");
    const res = await share([{ itemId: "bill-app", participantIds: ["bill-sam", "bill-alex"] }]);
    expect(res.status).toBe(200);
    const app = (await snapshot()).items[1];
    expect(app.assignedParticipantId).toBeNull();
    expect(app.sharedAllocations.map((row) => row.participantId)).toEqual(["bill-alex", "bill-sam"]);
  });

  it("requires SHARED_ITEMS mode", async () => {
    const res = await share([{ itemId: "bill-app", participantIds: ["bill-alex", "bill-sam"] }]);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "CONFLICT", message: "Shared allocations require SHARED_ITEMS mode" } });
  });

  it.each([
    [["bill-alex"]],
    [["bill-alex", "bill-alex"]],
  ])("400 for a group of %j", async (participantIds) => {
    await setMode("SHARED_ITEMS");
    const res = await share([{ itemId: "bill-app", participantIds }]);
    expect(res.status).toBe(400);
  });

  it("404 for a foreign participant", async () => {
    await setMode("SHARED_ITEMS");
    const res = await share([{ itemId: "bill-app", participantIds: ["bill-alex", "bill-foreign-person"] }]);
    expect(res.status).toBe(404);
  });

  it("restores old rows and revision when an insert fails", async () => {
    await setMode("SHARED_ITEMS");
    expect((await share([{ itemId: "bill-steak", participantIds: ["bill-alex", "bill-cara"] }])).status).toBe(200);
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION shared_test_fail() RETURNS trigger AS $$
      BEGIN IF NEW.participant_id = 'bill-sam' THEN RAISE EXCEPTION 'private allocation failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe("CREATE TRIGGER shared_test_fail BEFORE INSERT ON shared_item_allocations FOR EACH ROW EXECUTE FUNCTION shared_test_fail()");
      const res = await share([{ itemId: "bill-app", participantIds: ["bill-alex", "bill-sam"] }], 2);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS shared_test_fail ON shared_item_allocations");
      await prisma.$executeRawUnsafe("DROP FUNCTION shared_test_fail()");
    }
  });
});

describe("POST finalize", () => {
  const owed = async () => (await snapshot()).bills.map((row) => [row.participantId, row.amountOwed.toFixed(2)]);

  it("ITEMIZED: writes reconciled bills and marks the receipt FINALIZED", async () => {
    await prisma.receiptItem.update({ where: { id: "bill-steak" }, data: { assignedParticipantId: "bill-alex" } });
    await prisma.receiptItem.update({ where: { id: "bill-app" }, data: { assignedParticipantId: "bill-sam" } });
    const res = await finalize();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: receiptId, status: "FINALIZED" });
    expect(await owed()).toEqual([["bill-alex", "25.80"], ["bill-cara", "0.00"], ["bill-sam", "12.90"]]);
    expect((await snapshot()).finalizedAt).not.toBeNull();
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${receiptId}/bills`);
  });

  it("SHARED_ITEMS: splits a shared item equally", async () => {
    await setMode("SHARED_ITEMS");
    await prisma.receiptItem.update({ where: { id: "bill-steak" }, data: { assignedParticipantId: "bill-alex" } });
    await prisma.sharedItemAllocation.createMany({ data: [
      { receiptId, itemId: "bill-app", participantId: "bill-alex" },
      { receiptId, itemId: "bill-app", participantId: "bill-sam" },
    ] });
    expect((await finalize()).status).toBe(200);
    expect(await owed()).toEqual([["bill-alex", "32.25"], ["bill-cara", "0.00"], ["bill-sam", "6.45"]]);
  });

  it("EVEN: distributes leftover cents by joinedAt", async () => {
    await setMode("EVEN");
    await prisma.receipt.update({ where: { id: receiptId }, data: { subtotal: "10", tax: "0", tip: null, total: "10" } });
    await prisma.receiptItem.update({ where: { id: "bill-steak" }, data: { totalPrice: "0" } });
    expect((await finalize()).status).toBe(200);
    expect(await owed()).toEqual([["bill-alex", "3.34"], ["bill-cara", "3.33"], ["bill-sam", "3.33"]]);
  });

  it.each([
    ["an unassigned item", async () => {
      await prisma.receiptItem.update({ where: { id: "bill-steak" }, data: { assignedParticipantId: "bill-alex" } });
    }],
    ["an unreviewed receipt", async () => {
      await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: "bill-alex" } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { reviewedAt: null } });
    }],
    ["amounts that do not sum to total", async () => {
      await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: "bill-alex" } });
      await prisma.receipt.update({ where: { id: receiptId }, data: { total: "38.71" } });
    }],
  ])("400 without bills for %s", async (_label, arrange) => {
    await arrange();
    const before = await snapshot();
    const res = await finalize();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(await snapshot()).toEqual(before);
  });

  it("concurrent finalization succeeds exactly once", async () => {
    await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: "bill-alex" } });
    const responses = await Promise.all([finalize(), finalize()]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await snapshot()).bills).toHaveLength(3);
  });

  it("rolls back inserted bills when the status write fails", async () => {
    await prisma.receiptItem.updateMany({ where: { receiptId }, data: { assignedParticipantId: "bill-alex" } });
    const before = await snapshot();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION final_status_test_fail() RETURNS trigger AS $$
      BEGIN IF NEW.id = 'bill-receipt' AND NEW.status = 'FINALIZED' THEN RAISE EXCEPTION 'private status failure'; END IF; RETURN NEW; END;
    $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe("CREATE TRIGGER final_status_test_fail BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION final_status_test_fail()");
      const res = await finalize();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
      expect(await snapshot()).toEqual(before);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS final_status_test_fail ON receipts");
      await prisma.$executeRawUnsafe("DROP FUNCTION final_status_test_fail()");
    }
  });
});

describe("GET bills", () => {
  async function finalizeItemized() {
    await prisma.receipt.update({ where: { id: receiptId }, data: { paidByParticipantId: "bill-alex" } });
    await prisma.receiptItem.update({ where: { id: "bill-steak" }, data: { assignedParticipantId: "bill-alex" } });
    await prisma.receiptItem.update({ where: { id: "bill-app" }, data: { assignedParticipantId: "bill-sam" } });
    expect((await finalize()).status).toBe(200);
  }

  it("returns [] before finalization", async () => {
    const res = await bills();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("projects ordered bills with payer, zero-owed and unpaid settlement", async () => {
    await finalizeItemized();
    const res = await bills();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((row: { participantId: string }) => row.participantId)).toEqual(["bill-alex", "bill-sam", "bill-cara"]);
    expect(body[0]).toEqual({
      id: expect.any(String), receiptId, participantId: "bill-alex", displayName: "Alex", phone: "+12125550123",
      subtotal: "20.00", taxShare: "1.80", tipShare: "4.00", amountOwed: "25.80", paidAt: null,
      createdAt: expect.any(String), settled: true, outstandingAmount: "0.00",
    });
    expect(body[1]).toMatchObject({ amountOwed: "12.90", settled: false, outstandingAmount: "12.90" });
    expect(body[2]).toMatchObject({ amountOwed: "0.00", settled: true, outstandingAmount: "0.00" });
  });

  it("treats paidAt as settled without changing amounts", async () => {
    await finalizeItemized();
    await prisma.bill.updateMany({ where: { receiptId, participantId: "bill-sam" }, data: { paidAt: new Date() } });
    const sam = (await (await bills()).json())[1];
    expect(sam).toMatchObject({ amountOwed: "12.90", settled: true, outstandingAmount: "0.00" });
  });

  it("individual GET returns an owned bill and 404s for foreign owners and deleted receipts", async () => {
    await finalizeItemized();
    const sam = (await snapshot()).bills.find((row) => row.participantId === "bill-sam")!;
    const res = await bill(sam.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: sam.id, displayName: "Sam", amountOwed: "12.90" });

    identity.userId = "bill-bob";
    const foreign = await bill(sam.id);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { code: "NOT_FOUND", message: "Bill not found" } });

    identity.userId = "bill-alice";
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    expect((await bill(sam.id)).status).toBe(404);
    expect((await bill("missing-bill")).status).toBe(404);
  });

  it("maps unexpected read failures to a generic 500", async () => {
    const failure = vi.spyOn(prisma.receipt, "findFirst").mockRejectedValueOnce(new Error("private read failure"));
    try {
      const res = await bills();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    } finally {
      failure.mockRestore();
    }
  });
});
