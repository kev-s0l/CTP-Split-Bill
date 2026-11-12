// The picking/editing switch (ADR-0017) and the organizer's own row (ADR-0018)
// end to end against PGlite. Only auth, cache and storage are mocked.
// See docs/specs/receipts/guest-picks.md and receipts/participants.md.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "switch-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const storage = vi.hoisted(() => ({ downloadAttachment: vi.fn(), recognizeReceipt: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);
vi.mock("@project/services", () => storage);

const picking = await import("../app/api/receipts/[id]/picking/route");
const ownerPicks = await import("../app/api/receipts/[id]/picks/route");
const receiptRoute = await import("../app/api/receipts/[id]/route");
const itemsRoute = await import("../app/api/receipts/[id]/items/route");
const rosterRoute = await import("../app/api/receipts/[id]/participants/route");
const assignmentsRoute = await import("../app/api/receipts/[id]/assignments/route");
const sharedRoute = await import("../app/api/receipts/[id]/shared-allocations/route");
const parseRoute = await import("../app/api/receipts/[id]/parse/route");
const finalizeRoute = await import("../app/api/receipts/[id]/finalize/route");
const link = await import("../app/api/receipts/[id]/participants/[participantId]/pick-link/route");
const guestPicks = await import("../app/api/picks/[token]/route");
const guestDone = await import("../app/api/picks/[token]/done/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A reviewed draft in Editing: the organizer's own row ("You"), Maya and Sam;
// rice, mango, dumplings, each already assigned so finalize would succeed.
async function draft(opts: { organizer?: boolean; guests?: string[]; reviewed?: boolean } = {}) {
  const { organizer = true, guests = ["Maya", "Sam"], reviewed = true } = opts;
  const names = [...(organizer ? ["You"] : []), ...guests];
  const receipt = await prisma.receipt.create({
    data: {
      ownerId: "switch-owner", imageBlobName: "switch.jpg", imageContentType: "image/jpeg",
      merchantName: "Noodle Bar", currency: "USD", splitMode: "SHARED_ITEMS",
      reviewedAt: reviewed ? new Date(0) : null,
      subtotal: "22.00", tax: "0.00", tip: "0.00", total: "22.00",
      participants: { create: names.map((displayName, i) => ({ displayName, joinedAt: new Date(i) })) },
      items: { create: [
        { lineNumber: 1, name: "Rice", quantity: "1", unitPrice: "4.00", totalPrice: "4.00", isVerified: true },
        { lineNumber: 2, name: "Mango", quantity: "1", unitPrice: "6.00", totalPrice: "6.00", isVerified: true },
        { lineNumber: 3, name: "Dumplings", quantity: "1", unitPrice: "12.00", totalPrice: "12.00", isVerified: true },
      ] },
    },
    include: { participants: { orderBy: { joinedAt: "asc" } }, items: { orderBy: { lineNumber: "asc" } } },
  });
  const people = receipt.participants;
  const me = organizer ? people[0] : null;
  const [maya, sam] = organizer ? people.slice(1) : people;
  const [rice, mango, dumplings] = receipt.items;
  await prisma.receipt.update({
    where: { id: receipt.id },
    data: { organizerParticipantId: me?.id ?? null, paidByParticipantId: people[0].id },
  });
  for (const item of receipt.items) {
    await prisma.receiptItem.update({ where: { id: item.id }, data: { assignedParticipantId: people[0].id } });
  }
  return { id: receipt.id, me, maya, sam, rice, mango, dumplings };
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body: unknown) => ({
  method, body: typeof body === "string" ? body : JSON.stringify(body),
});

const setPicking = (id: string, body: unknown) =>
  picking.POST(new Request(`http://test/api/receipts/${id}/picking`, json("POST", body)), idParams(id));
const saveOwnPicks = (id: string, body: unknown) =>
  ownerPicks.PUT(new Request(`http://test/api/receipts/${id}/picks`, json("PUT", body)), idParams(id));
const saveRoster = (id: string, body: unknown) =>
  rosterRoute.PUT(new Request(`http://test/api/receipts/${id}/participants`, json("PUT", body)), idParams(id));

async function tokenFor(id: string, participantId: string) {
  const res = await link.POST(
    new Request(`http://test/api/receipts/${id}/participants/${participantId}/pick-link`, { method: "POST" }),
    { params: Promise.resolve({ id, participantId }) });
  expect(res.status).toBe(200);
  return new URL((await res.json()).url).pathname.replace("/p/", "");
}
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });
const guestRead = (token: string) =>
  guestPicks.GET(new Request(`http://test/api/picks/${token}`), tokenParams(token));
const guestSave = (token: string, itemIds: string[]) =>
  guestPicks.PUT(new Request(`http://test/api/picks/${token}`, json("PUT", { itemIds })), tokenParams(token));
const guestDoneReq = (token: string) =>
  guestDone.POST(new Request(`http://test/api/picks/${token}/done`, { method: "POST" }), tokenParams(token));

const row = (id: string) => prisma.receipt.findUniqueOrThrow({ where: { id } });
// Everything an owner write could change, to prove a refused write wrote nothing.
const snapshot = (id: string) => prisma.receipt.findUniqueOrThrow({
  where: { id },
  include: {
    participants: { orderBy: { id: "asc" } },
    items: { orderBy: { id: "asc" }, include: { sharedAllocations: true } },
    bills: true,
  },
});

async function expectConflict(res: Response, message: string) {
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: { code: "CONFLICT", message } });
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "switch-owner", name: "Owner", email: "switch-owner@example.com" },
    { id: "switch-other", name: "Other", email: "switch-other@example.com" },
  ] });
});

let d: Awaited<ReturnType<typeof draft>>;
beforeEach(async () => {
  identity.userId = "switch-owner";
  cache.revalidatePath.mockReset();
  storage.downloadAttachment.mockReset().mockResolvedValue({ data: Uint8Array.from([1]), contentType: "image/png" });
  storage.recognizeReceipt.mockReset()
    .mockResolvedValue("Merchant: Corner Cafe\n1 x Soup @ 10.00 10.00\nSubtotal 10.00\nTax 0.00\nTotal 10.00");
  d = await draft();
});

// ---------------------------------------------------------------------------
// Opening and pausing
// ---------------------------------------------------------------------------

describe("POST /api/receipts/:id/picking", () => {
  it("opens and pauses without changing the revision, keeping the first open time", async () => {
    const opened = await setPicking(d.id, { open: true });
    expect(opened.status).toBe(200);
    const body = await opened.json();
    expect(body.picksOpenedAt).toEqual(expect.any(String));
    expect(body.revision).toBe(1);
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/api/receipts/${d.id}`);

    const again = await (await setPicking(d.id, { open: true })).json();
    expect(again.picksOpenedAt).toBe(body.picksOpenedAt);

    const paused = await (await setPicking(d.id, { open: false })).json();
    expect(paused.picksOpenedAt).toBeNull();
    expect(paused.revision).toBe(1);
    expect((await setPicking(d.id, { open: false })).status).toBe(200);
    expect((await row(d.id)).revision).toBe(1);
  });

  it("refuses to open an unreviewed receipt", async () => {
    const unreviewed = await draft({ reviewed: false });
    await expectConflict(await setPicking(unreviewed.id, { open: true }),
      "Review the receipt before opening picking");
    expect((await row(unreviewed.id)).picksOpenedAt).toBeNull();
  });

  it("refuses to open with only the organizer's row, but opens once a guest is added", async () => {
    const alone = await draft({ guests: [] });
    await expectConflict(await setPicking(alone.id, { open: true }),
      "Add someone to pick before opening picking");
    expect((await row(alone.id)).picksOpenedAt).toBeNull();

    // A receipt from before the organizer row counts every participant.
    const legacy = await draft({ organizer: false, guests: ["Maya"] });
    expect((await setPicking(legacy.id, { open: true })).status).toBe(200);
  });

  it("keeps everyone's picks and done state across a pause", async () => {
    await setPicking(d.id, { open: true });
    const maya = await tokenFor(d.id, d.maya.id);
    expect((await guestSave(maya, [d.mango.id])).status).toBe(200);
    expect((await guestDoneReq(maya)).status).toBe(200);
    const before = await snapshot(d.id);

    await setPicking(d.id, { open: false });
    const after = await snapshot(d.id);
    expect(after.items).toEqual(before.items);
    expect(after.participants).toEqual(before.participants);
  });

  it("409s on finalized and parsing receipts, 404s a foreign one, 400s a bad body", async () => {
    await prisma.receipt.update({ where: { id: d.id }, data: { parseStatus: "PARSING" } });
    await expectConflict(await setPicking(d.id, { open: true }), "Receipt is parsing");
    await prisma.receipt.update({ where: { id: d.id }, data: { parseStatus: "SUCCEEDED", status: "FINALIZED" } });
    await expectConflict(await setPicking(d.id, { open: false }), "Receipt is finalized");

    const other = await draft();
    identity.userId = "switch-other";
    expect((await setPicking(other.id, { open: true })).status).toBe(404);
    identity.userId = "switch-owner";

    for (const body of ["{", {}, { open: "yes" }]) {
      expect((await setPicking(other.id, body)).status).toBe(400);
    }
    expect((await row(other.id)).picksOpenedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Picking open: owner writes refused
// ---------------------------------------------------------------------------

describe("while picking is open", () => {
  const ownerWrites: [string, (id: string, revision: number) => Promise<Response>][] = [
    ["receipt PATCH", (id, expectedRevision) => receiptRoute.PATCH(
      new Request(`http://test/api/receipts/${id}`, json("PATCH", { expectedRevision, tip: "2.00" })), idParams(id))],
    ["item replacement", (id, expectedRevision) => itemsRoute.PUT(
      new Request(`http://test/api/receipts/${id}/items`, json("PUT", { expectedRevision, items: [] })), idParams(id))],
    ["roster", (id, expectedRevision) => saveRoster(id, {
      expectedRevision, participants: [{ id: d.me!.id }, { id: d.maya.id }, { id: d.sam.id }, { displayName: "Lee" }] })],
    ["assignments", (id, expectedRevision) => assignmentsRoute.PUT(
      new Request(`http://test/api/receipts/${id}/assignments`, json("PUT", { expectedRevision, assignments: [] })), idParams(id))],
    ["shared allocations", (id, expectedRevision) => sharedRoute.PUT(
      new Request(`http://test/api/receipts/${id}/shared-allocations`, json("PUT", { expectedRevision, allocations: [] })), idParams(id))],
    ["parse", (id, expectedRevision) => parseRoute.POST(
      new Request(`http://test/api/receipts/${id}/parse`, json("POST", { expectedRevision })), idParams(id))],
    ["finalize", (id, expectedRevision) => finalizeRoute.POST(
      new Request(`http://test/api/receipts/${id}/finalize`, json("POST", { expectedRevision })), idParams(id))],
  ];

  it.each(ownerWrites)("refuses %s with 409 and writes nothing, even with a stale revision", async (_name, write) => {
    await setPicking(d.id, { open: true });
    const before = await snapshot(d.id);
    await expectConflict(await write(d.id, 1), "Pause picking to make changes");
    await expectConflict(await write(d.id, 99), "Pause picking to make changes");
    expect(await snapshot(d.id)).toEqual(before);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();

    // Pausing lets the same write through.
    await setPicking(d.id, { open: false });
    expect((await write(d.id, 1)).status).toBe(200);
  });

  it("still issues, rotates and revokes pick links", async () => {
    await setPicking(d.id, { open: true });
    const first = await tokenFor(d.id, d.sam.id);
    const second = await tokenFor(d.id, d.sam.id);
    expect(second).not.toBe(first);
    const revoked = await link.DELETE(
      new Request(`http://test/api/receipts/${d.id}/participants/${d.sam.id}/pick-link`, { method: "DELETE" }),
      { params: Promise.resolve({ id: d.id, participantId: d.sam.id }) });
    expect(revoked.status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Editing: guest writes refused
// ---------------------------------------------------------------------------

describe("while editing", () => {
  it("refuses guest picks and done with 409, while the link still reads", async () => {
    const sam = await tokenFor(d.id, d.sam.id);
    const before = await snapshot(d.id);
    await expectConflict(await guestSave(sam, [d.rice.id]), "The organizer is making changes");
    await expectConflict(await guestDoneReq(sam), "The organizer is making changes");
    expect(await snapshot(d.id)).toEqual(before);

    const read = await guestRead(sam);
    expect(read.status).toBe(200);
    expect((await read.json()).pickingOpen).toBe(false);

    await setPicking(d.id, { open: true });
    expect((await (await guestRead(sam)).json()).pickingOpen).toBe(true);
    expect((await guestSave(sam, [d.rice.id])).status).toBe(200);
    expect((await guestDoneReq(sam)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The organizer's own picks
// ---------------------------------------------------------------------------

describe("PUT /api/receipts/:id/picks", () => {
  it.each([["editing", false], ["picking open", true]] as const)(
    "reconciles the organizer's row like a guest's while %s, advancing the revision",
    async (_mode, open) => {
      await prisma.receiptItem.updateMany({ where: { receiptId: d.id }, data: { assignedParticipantId: null } });
      await prisma.receiptItem.update({ where: { id: d.dumplings.id }, data: { assignedParticipantId: d.maya.id } });
      if (open) await setPicking(d.id, { open: true });

      const res = await saveOwnPicks(d.id, { itemIds: [d.rice.id, d.dumplings.id] });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revision).toBe(2);
      const byName = Object.fromEntries(body.items.map((item: {
        name: string; assignedParticipantId: string | null; sharedAllocations: { participantId: string }[];
      }) => [item.name, {
        assigned: item.assignedParticipantId,
        shared: item.sharedAllocations.map((a) => a.participantId).sort(),
      }]));
      expect(byName).toEqual({
        Rice: { assigned: d.me!.id, shared: [] },
        Mango: { assigned: null, shared: [] },
        Dumplings: { assigned: null, shared: [d.me!.id, d.maya.id].sort() },
      });
      expect(body.picksOpenedAt === null).toBe(!open);

      // Unpicking leaves Maya's share as her own assignment.
      const after = await (await saveOwnPicks(d.id, { itemIds: [] })).json();
      expect(after.items.find((i: { name: string }) => i.name === "Dumplings").assignedParticipantId).toBe(d.maya.id);
      expect((await prisma.participant.findUniqueOrThrow({ where: { id: d.me!.id } })).picksSubmittedAt).toBeNull();
    });

  it("409s without an organizer row or once finalized, 404s foreign receipts and items", async () => {
    const legacy = await draft({ organizer: false });
    await expectConflict(await saveOwnPicks(legacy.id, { itemIds: [] }), "You aren't on this receipt");

    const other = await draft();
    expect((await saveOwnPicks(d.id, { itemIds: [other.rice.id] })).status).toBe(404);
    identity.userId = "switch-other";
    expect((await saveOwnPicks(d.id, { itemIds: [] })).status).toBe(404);
    identity.userId = "switch-owner";

    await prisma.receipt.update({ where: { id: d.id }, data: { status: "FINALIZED" } });
    await expectConflict(await saveOwnPicks(d.id, { itemIds: [] }), "Receipt is finalized");
    expect((await row(d.id)).revision).toBe(1);
    expect((await saveOwnPicks(other.id, { itemIds: ["a", "a"] })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The organizer's row on the roster and links
// ---------------------------------------------------------------------------

describe("the organizer's row", () => {
  it("never gets a pick link", async () => {
    const res = await link.POST(
      new Request(`http://test/api/receipts/${d.id}/participants/${d.me!.id}/pick-link`, { method: "POST" }),
      { params: Promise.resolve({ id: d.id, participantId: d.me!.id }) });
    expect(res.status).toBe(400);
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: d.me!.id } })).pickTokenHash).toBeNull();
  });

  it("can't be removed from the roster, but can be renamed and moved", async () => {
    const before = await snapshot(d.id);
    await expectConflict(await saveRoster(d.id, {
      expectedRevision: 1, participants: [{ id: d.maya.id }, { id: d.sam.id }],
    }), "You can't remove yourself from the roster");
    expect(await snapshot(d.id)).toEqual(before);

    const res = await saveRoster(d.id, {
      expectedRevision: 1,
      participants: [
        { id: d.maya.id, displayName: "Maya" }, { id: d.me!.id, displayName: "Andrew" },
        { id: d.sam.id, displayName: "Sam" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizerParticipantId).toBe(d.me!.id);
    expect(body.participants.map((p: { displayName: string }) => p.displayName)).toEqual(["Maya", "Andrew", "Sam"]);
  });

  it("is skipped when numbering unnamed guests", async () => {
    const res = await saveRoster(d.id, {
      expectedRevision: 1,
      participants: [{ id: d.me!.id }, { id: d.maya.id, displayName: "" }, { id: d.sam.id, displayName: "" }, {}],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).participants.map((p: { displayName: string }) => p.displayName))
      .toEqual(["You", "Guest 1", "Guest 2", "Guest 3"]);
  });
});
