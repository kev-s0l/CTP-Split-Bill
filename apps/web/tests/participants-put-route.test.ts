// PUT /api/receipts/:id/participants against PGlite, with only auth and cache mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

// ---------------------------------------------------------------------------
// Fakes: tests pick who is "logged in" by changing identity.userId.
// ---------------------------------------------------------------------------
const identity = vi.hoisted(() => ({ userId: "roster-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);
const { PUT } = await import("../app/api/receipts/[id]/participants/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A fresh draft receipt per test with Alex, Sam and one unassigned item,
// so tests can't leak into each other.
async function draft(ownerId = "roster-owner") {
  return prisma.receipt.create({
    data: {
      ownerId, imageBlobName: "roster.jpg", imageContentType: "image/jpeg",
      reviewedAt: new Date(0),
      participants: { create: [
        { displayName: "Alex", phone: "+12125550100", joinedAt: new Date(0) },
        { displayName: "Sam", joinedAt: new Date(1) },
      ] },
      items: { create: { lineNumber: 1, name: "Ramen", quantity: "1", unitPrice: "12.00", totalPrice: "12.00" } },
    },
    include: { participants: { orderBy: { joinedAt: "asc" } }, items: true },
  });
}
type Draft = Awaited<ReturnType<typeof draft>>;

// Calls the handler like a browser would. Strings go as-is (for broken JSON);
// objects get expectedRevision 1 unless the test sets its own.
function put(receiptId: string, body: Record<string, unknown> | string) {
  const raw = typeof body === "string" ? body : JSON.stringify({ expectedRevision: 1, ...body });
  return PUT(
    new Request(`http://test/api/receipts/${receiptId}/participants`, { method: "PUT", body: raw }),
    { params: Promise.resolve({ id: receiptId }) },
  );
}

// What's actually saved, in display order.
const roster = (receiptId: string) => prisma.participant.findMany({
  where: { receiptId }, orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  select: { id: true, displayName: true, phone: true },
});
const revisionOf = async (receiptId: string) =>
  (await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).revision;

// Asserts a failed request left the receipt exactly as it was.
async function unchanged(r: Draft) {
  expect(await revisionOf(r.id)).toBe(1);
  expect(await roster(r.id)).toEqual(r.participants.map(({ id, displayName, phone }) => ({ id, displayName, phone })));
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "roster-owner", name: "Owner", email: "roster-owner@example.com" },
    { id: "roster-other", name: "Other", email: "roster-other@example.com" },
  ] });
});

let r: Draft;
beforeEach(async () => {
  identity.userId = "roster-owner";
  cache.revalidatePath.mockClear();
  r = await draft();
});
const [alex, sam] = [0, 1];

describe("PUT /api/receipts/:id/participants", () => {
  // --- Saving the roster -------------------------------------------------

  it("names blank and missing entries Guest N by position", async () => {
    const res = await put(r.id, { participants: [{}, { displayName: "  " }, {}, {}] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.participants.map((p: { displayName: string }) => p.displayName))
      .toEqual(["Guest 1", "Guest 2", "Guest 3", "Guest 4"]);
    expect(body.revision).toBe(2);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${r.id}`);
  });

  it("trims names and stores phones in E.164", async () => {
    const res = await put(r.id, { participants: [
      { displayName: "  Maya ", phone: "(555) 201-3344" },
      { displayName: "Lee", phone: "1-555-201-9999" },
      { displayName: "Ana", phone: "+44 20 7946 0958" },
    ] });
    expect(res.status).toBe(200);
    expect((await roster(r.id)).map(({ displayName, phone }) => ({ displayName, phone }))).toEqual([
      { displayName: "Maya", phone: "+15552013344" },
      { displayName: "Lee", phone: "+15552019999" },
      { displayName: "Ana", phone: "+442079460958" },
    ]);
  });

  it("keeps sent ids, creates new entries, removes missing ones, in the order sent", async () => {
    const res = await put(r.id, { participants: [
      { displayName: "Newcomer" },
      { id: r.participants[sam].id, displayName: "Samuel" },
    ] });
    expect(res.status).toBe(200);
    const saved = await roster(r.id);
    expect(saved.map((p) => p.displayName)).toEqual(["Newcomer", "Samuel"]);
    expect(saved[1].id).toBe(r.participants[sam].id);                // Sam kept his id
    expect(saved.some((p) => p.id === r.participants[alex].id)).toBe(false); // Alex removed
  });

  it("keeps a phone when it's omitted and clears it on an empty string", async () => {
    await put(r.id, { participants: [
      { id: r.participants[alex].id, displayName: "Alex" },     // phone omitted → kept
      { id: r.participants[sam].id, displayName: "Sam", phone: "" },
    ] });
    expect((await roster(r.id)).map((p) => p.phone)).toEqual(["+12125550100", null]);
    await put(r.id, { expectedRevision: 2, participants: [{ id: r.participants[alex].id, phone: "" }] });
    expect((await roster(r.id))[0].phone).toBeNull();
  });

  it("keeps reviewedAt when names change", async () => {
    await put(r.id, { participants: [{ id: r.participants[alex].id, displayName: "Alexandra" }, { id: r.participants[sam].id }] });
    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.reviewedAt).toEqual(new Date(0));
  });

  // --- Bad input (400): nothing changes -----------------------------------

  it.each([
    ["not JSON", "{oops", "Body must be valid JSON"],
    ["an invalid phone", { participants: [{ phone: "12" }] }, "phone: Enter a valid phone number"],
    ["no people", { participants: [] }, "participants: Add at least one person"],
    ["more than 50 people", { participants: Array.from({ length: 51 }, () => ({})) }, "participants: A receipt can have at most 50 people"],
    ["a 51-character name", { participants: [{ displayName: "x".repeat(51) }] }, "participants.0.displayName: Name must be 50 characters or fewer"],
    ["the same id twice", "dup", "participants.1.id: Duplicate participant id"],
    ["a missing expectedRevision", JSON.stringify({ participants: [{}] }), "expectedRevision: Required"],
  ])("returns 400 for %s", async (_label, body, message) => {
    const sent = body === "dup"
      ? { participants: [{ id: r.participants[alex].id }, { id: r.participants[alex].id }] }
      : body;
    const res = await put(r.id, sent as Record<string, unknown> | string);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID_INPUT", message } });
    await unchanged(r);
  });

  // --- Removal guards (409): the whole save rolls back -------------------

  it("refuses to remove someone assigned an item", async () => {
    await prisma.receiptItem.update({ where: { id: r.items[0].id }, data: { assignedParticipantId: r.participants[sam].id } });
    const res = await put(r.id, { participants: [{ id: r.participants[alex].id, displayName: "Renamed" }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("Unassign this person's items before removing them");
    await unchanged(r); // Alex's rename rolled back too
  });

  it("refuses to remove someone in a shared item", async () => {
    await prisma.sharedItemAllocation.create({ data: { receiptId: r.id, itemId: r.items[0].id, participantId: r.participants[sam].id } });
    const res = await put(r.id, { participants: [{ id: r.participants[alex].id }] });
    expect(res.status).toBe(409);
    await unchanged(r);
  });

  it("refuses to remove the payer", async () => {
    await prisma.receipt.update({ where: { id: r.id }, data: { paidByParticipantId: r.participants[sam].id } });
    const res = await put(r.id, { participants: [{ id: r.participants[alex].id }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("Choose a different payer before removing this person");
    await unchanged(r);
  });

  // --- Receipt state (409) -----------------------------------------------

  it("returns 409 for a stale expectedRevision", async () => {
    const res = await put(r.id, { expectedRevision: 7, participants: [{}] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("Receipt has changed; reload before saving");
    await unchanged(r);
  });

  it("returns 409 for a finalized receipt", async () => {
    await prisma.receipt.update({ where: { id: r.id }, data: {
      status: "FINALIZED", finalizedAt: new Date(), parseStatus: "SUCCEEDED",
      subtotal: "12.00", tax: "0.00", tip: "0.00", total: "12.00",
    } });
    const res = await put(r.id, { participants: [{}] });
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("Receipt is finalized");
  });

  // --- Access (401 / 404) ------------------------------------------------

  it("returns 401 for an unknown identity", async () => {
    identity.userId = "roster-missing-user";
    const res = await put(r.id, { participants: [{}] });
    expect(res.status).toBe(401);
    await unchanged(r);
  });

  it("returns 404 for another organizer's receipt", async () => {
    identity.userId = "roster-other";
    const res = await put(r.id, { participants: [{}] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt not found" } });
    await unchanged(r);
  });

  it("returns 404 for a participant id from a different receipt", async () => {
    const other = await draft();
    const res = await put(r.id, { participants: [{ id: other.participants[0].id, displayName: "Stolen" }] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Participant not found" } });
    await unchanged(r);
    expect((await roster(other.id))[0].displayName).toBe("Alex"); // the other receipt is untouched
  });
});