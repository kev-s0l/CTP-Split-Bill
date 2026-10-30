// PATCH /api/bills/:billsId against PGlite, with only auth and cache mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

// ---------------------------------------------------------------------------
// Fakes
// The tests control who is "logged in" by changing identity.userId.
// vi.hoisted makes these objects exist before the vi.mock calls below run.
// ---------------------------------------------------------------------------
const identity = vi.hoisted(() => ({ userId: "paid-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

// Replace the real auth with one that returns whatever identity.userId is.
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
// Replace Next's cache helper with a spy so we can check it was called.
vi.mock("next/cache", () => cache);

// Import the route AFTER the mocks so it picks up the fake auth and cache.
const { PATCH } = await import("../app/api/bills/[billsId]/route");

const receiptId = "paid-receipt";
const billId = "paid-bill-sam"; // the bill most tests flip paid/unpaid

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Calls the PATCH handler directly, like a browser request would.
// Strings are sent as-is so a test can send broken JSON on purpose.
function patch(body: unknown, id = billId) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return PATCH(
    new Request(`http://test/api/bills/${id}`, { method: "PATCH", body: raw }),
    { params: Promise.resolve({ billsId: id }) },
  );
}

// Reads a bill straight from the database, to check what was actually saved.
const stored = (id = billId) => prisma.bill.findUniqueOrThrow({ where: { id } });

// ---------------------------------------------------------------------------
// Test data, created once for the whole file
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // Two users: the organizer whose receipt we test, and a stranger.
  await prisma.user.createMany({ data: [
    { id: "paid-owner", name: "Owner", email: "paid-owner@example.com" },
    { id: "paid-other", name: "Other", email: "paid-other@example.com" },
  ] });

  // Bills only exist on finalized receipts. The database has a check that
  // finalized receipts have money totals, so the totals have to add up.
  const finalized = {
    status: "FINALIZED" as const, parseStatus: "SUCCEEDED" as const, finalizedAt: new Date(0),
    subtotal: "30.00", tax: "2.70", tip: "6.00", total: "38.70",
    imageBlobName: "paid.jpg", imageContentType: "image/jpeg",
  };

  // The organizer's receipt, with two people on it: Alex and Sam.
  await prisma.receipt.create({ data: {
    id: receiptId, ownerId: "paid-owner", ...finalized,
    participants: { create: [
      { id: "paid-alex", displayName: "Alex", joinedAt: new Date(0) },
      { id: "paid-sam", displayName: "Sam", joinedAt: new Date(1000) },
    ] },
  } });

  // A receipt that belongs to the stranger, used for the "foreign bill" test.
  await prisma.receipt.create({ data: {
    id: "paid-foreign-receipt", ownerId: "paid-other", ...finalized,
    participants: { create: { id: "paid-foreign-person", displayName: "Other" } },
  } });

  // One bill per person. amountOwed must equal subtotal + tax + tip
  // (another database check), so 15.00 + 1.35 + 3.00 = 19.35.
  const amounts = { subtotal: "15.00", taxShare: "1.35", tipShare: "3.00", amountOwed: "19.35" };
  await prisma.bill.createMany({ data: [
    { id: "paid-bill-alex", receiptId, participantId: "paid-alex", ...amounts },
    { id: billId, receiptId, participantId: "paid-sam", ...amounts },
    { id: "paid-foreign-bill", receiptId: "paid-foreign-receipt", participantId: "paid-foreign-person", ...amounts },
  ] });
});

// ---------------------------------------------------------------------------
// Reset before every test so tests can't affect each other
// ---------------------------------------------------------------------------
beforeEach(async () => {
  identity.userId = "paid-owner";                // log back in as the organizer
  cache.revalidatePath.mockClear();              // forget earlier spy calls
  await prisma.bill.updateMany({ data: { paidAt: null } });   // everyone unpaid
  await prisma.receipt.updateMany({ where: { id: receiptId }, data: { deletedAt: null } }); // undelete
});

describe("PATCH /api/bills/:billsId", () => {
  // --- Happy paths -------------------------------------------------------

  it("marks a bill paid without touching its calculated amounts", async () => {
    const before = await stored();
    const res = await patch({ paid: true });
    expect(res.status).toBe(200);

    // The response says Sam is settled and owes nothing more...
    const body = await res.json();
    expect(body).toMatchObject({ id: billId, displayName: "Sam", amountOwed: "19.35", settled: true, outstandingAmount: "0.00" });
    expect(body.paidAt).not.toBeNull();

    // ...and the database agrees: paidAt is set and every other column is
    // identical to before (paidAt and updatedAt are expected to change).
    const after = await stored();
    expect(after.paidAt).not.toBeNull();
    expect({ ...after, paidAt: null, updatedAt: null }).toEqual({ ...before, paidAt: null, updatedAt: null });

    // Alex's bill on the same receipt was not touched.
    expect((await stored("paid-bill-alex")).paidAt).toBeNull();

    // The payments page is told to refresh.
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/receipts/${receiptId}/payments`);
  });

  it("keeps the original paidAt when marked paid twice", async () => {
    await patch({ paid: true });
    const first = (await stored()).paidAt;
    // Wait a moment so a second "now" would be a different time.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await patch({ paid: true });
    expect(res.status).toBe(200);
    expect((await stored()).paidAt).toEqual(first); // date did not move
  });

  it("marks a paid bill unpaid and restores the outstanding amount", async () => {
    await patch({ paid: true });
    const res = await patch({ paid: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paidAt: null, settled: false, outstandingAmount: "19.35", amountOwed: "19.35" });
    expect((await stored()).paidAt).toBeNull();
  });

  // --- Tampering ---------------------------------------------------------

  it("ignores amount fields in the body", async () => {
    // Someone tries to zero out what Sam owes and backdate the payment.
    const res = await patch({ paid: true, amountOwed: "0.00", paidAt: "2000-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    const after = await stored();
    expect(after.amountOwed.toString()).toBe("19.35");          // amount unchanged
    expect(after.paidAt?.getUTCFullYear()).not.toBe(2000);      // server picked the date
  });

  // --- Bad input (400) ---------------------------------------------------
  // it.each runs the same test once per row: [label, body, expected message].

  it.each([
    ["not JSON", "{oops", "Body must be valid JSON"],
    ["missing paid", {}, "paid: Required"],
    ["a non-boolean paid", { paid: "yes" }, "paid: Expected boolean, received string"],
  ])("returns 400 for %s and changes nothing", async (_label, body, message) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID_INPUT", message } });
    expect((await stored()).paidAt).toBeNull(); // still unpaid
  });

  // --- Not logged in (401) -----------------------------------------------

  it("returns 401 for an unknown identity", async () => {
    identity.userId = "paid-missing-user"; // a user that doesn't exist
    const res = await patch({ paid: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unknown user" } });
    expect((await stored()).paidAt).toBeNull();
  });

  // --- Not yours / doesn't exist (404) -----------------------------------
  // The repo rule: foreign and unknown things both return 404, so a stranger
  // can't even tell whether a bill exists.

  it("returns 404 for another organizer's bill and leaves it unpaid", async () => {
    const res = await patch({ paid: true }, "paid-foreign-bill");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Bill not found" } });
    expect((await stored("paid-foreign-bill")).paidAt).toBeNull();
  });

  it("returns 404 when the organizer is asked about by someone else", async () => {
    // The stranger tries to mark the organizer's bill paid.
    identity.userId = "paid-other";
    const res = await patch({ paid: true });
    expect(res.status).toBe(404);
    expect((await stored()).paidAt).toBeNull();
  });

  it("returns 404 for an unknown bill", async () => {
    const res = await patch({ paid: true }, "paid-missing-bill");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Bill not found" } });
  });

  it("returns 404 when the receipt is deleted", async () => {
    // Soft-delete the receipt; its bills should disappear with it.
    await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    const res = await patch({ paid: true });
    expect(res.status).toBe(404);
    expect((await stored()).paidAt).toBeNull();
  });
});