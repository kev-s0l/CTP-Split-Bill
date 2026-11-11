// Guest pick links end to end against PGlite: the owner's pick-link routes and
// the token-scoped /api/picks routes. Only auth and cache are mocked.
// See docs/specs/receipts/guest-picks.md.
import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";
import { completeReceiptParsing, replaceReceiptItems } from "@project/domain";

const identity = vi.hoisted(() => ({ userId: "picks-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);
const link = await import("../app/api/receipts/[id]/participants/[participantId]/pick-link/route");
const picks = await import("../app/api/picks/[token]/route");
const done = await import("../app/api/picks/[token]/done/route");
const receiptRoute = await import("../app/api/receipts/[id]/route");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALEX_PHONE = "+12125550111";
const MAYA_EMAIL = "maya-picks@example.com";

// A fresh reviewed draft per test: Alex (phone), Maya (email), Sam; rice,
// mango, dumplings. Alex is the payer.
async function draft(splitMode: "EVEN" | "ITEMIZED" | "SHARED_ITEMS" = "ITEMIZED") {
  const receipt = await prisma.receipt.create({
    data: {
      ownerId: "picks-owner", imageBlobName: "picks.jpg", imageContentType: "image/jpeg",
      merchantName: "Noodle Bar", currency: "USD", splitMode, reviewedAt: new Date(0),
      subtotal: "22.00", tax: "0.00", tip: "0.00", total: "22.00",
      participants: { create: [
        { displayName: "Alex", phone: ALEX_PHONE, joinedAt: new Date(0) },
        { displayName: "Maya", email: MAYA_EMAIL, joinedAt: new Date(1) },
        { displayName: "Sam", joinedAt: new Date(2) },
      ] },
      items: { create: [
        { lineNumber: 1, name: "Rice", quantity: "1", unitPrice: "4.00", totalPrice: "4.00" },
        { lineNumber: 2, name: "Mango", quantity: "1", unitPrice: "6.00", totalPrice: "6.00" },
        { lineNumber: 3, name: "Dumplings", quantity: "1", unitPrice: "12.00", totalPrice: "12.00" },
      ] },
    },
    include: { participants: { orderBy: { joinedAt: "asc" } }, items: { orderBy: { lineNumber: "asc" } } },
  });
  await prisma.receipt.update({ where: { id: receipt.id }, data: { paidByParticipantId: receipt.participants[0].id } });
  const [alex, maya, sam] = receipt.participants;
  const [rice, mango, dumplings] = receipt.items;
  return { receipt, alex, maya, sam, rice, mango, dumplings };
}
type Draft = Awaited<ReturnType<typeof draft>>;

const linkParams = (id: string, participantId: string) => ({ params: Promise.resolve({ id, participantId }) });
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });

const issue = (receiptId: string, participantId: string) =>
  link.POST(new Request(`http://test/api/receipts/${receiptId}/participants/${participantId}/pick-link`, { method: "POST" }),
    linkParams(receiptId, participantId));
const revoke = (receiptId: string, participantId: string) =>
  link.DELETE(new Request(`http://test/api/receipts/${receiptId}/participants/${participantId}/pick-link`, { method: "DELETE" }),
    linkParams(receiptId, participantId));

async function tokenFor(receiptId: string, participantId: string) {
  const res = await issue(receiptId, participantId);
  expect(res.status).toBe(200);
  const { url } = await res.json();
  return new URL(url).pathname.replace("/p/", "");
}

const read = (token: string) => picks.GET(new Request(`http://test/api/picks/${token}`), tokenParams(token));
const save = (token: string, body: unknown) =>
  picks.PUT(new Request(`http://test/api/picks/${token}`, {
    method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body),
  }), tokenParams(token));
const submit = (token: string) =>
  done.POST(new Request(`http://test/api/picks/${token}/done`, { method: "POST" }), tokenParams(token));

// Who holds each item, in the shape the spec's Examples table talks about.
async function holdings(receiptId: string) {
  const items = await prisma.receiptItem.findMany({
    where: { receiptId }, orderBy: { lineNumber: "asc" },
    select: { name: true, assignedParticipantId: true, sharedAllocations: { select: { participantId: true } } },
  });
  return Object.fromEntries(items.map((item) => [item.name, {
    assigned: item.assignedParticipantId,
    shared: item.sharedAllocations.map((a) => a.participantId).sort(),
  }]));
}
const receiptRow = (id: string) => prisma.receipt.findUniqueOrThrow({ where: { id } });
const participantRow = (id: string) => prisma.participant.findUniqueOrThrow({ where: { id } });

// Every key anywhere in a JSON value, for "never returned" checks.
function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { out.add(k); keysDeep(v, out); }
  }
  return out;
}
function expectNoPrivateData(body: unknown) {
  const keys = keysDeep(body);
  for (const k of ["phone", "email", "ownerId", "pickTokenHash", "imageBlobName", "extraction"]) {
    expect(keys.has(k), `token response exposes ${k}`).toBe(false);
  }
  const text = JSON.stringify(body);
  expect(text).not.toContain(ALEX_PHONE);
  expect(text).not.toContain(MAYA_EMAIL);
  expect(text).not.toContain("picks-owner");
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "picks-owner", name: "Owner", email: "picks-owner@example.com" },
    { id: "picks-other", name: "Other", email: "picks-other@example.com" },
  ] });
});

let d: Draft;
beforeEach(async () => {
  identity.userId = "picks-owner";
  cache.revalidatePath.mockClear();
  d = await draft();
});

// ---------------------------------------------------------------------------
// Owner: issue, rotate, revoke
// ---------------------------------------------------------------------------

describe("pick-link owner routes", () => {
  it("issues a link once, stores only the token's hash, and leaves the revision alone", async () => {
    const res = await issue(d.receipt.id, d.sam.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const { url } = await res.json();
    expect(url).toMatch(/^http:\/\/test\/p\/[A-Za-z0-9_-]{43}$/);
    const token = new URL(url).pathname.slice(3);

    const row = await participantRow(d.sam.id);
    expect(row.pickTokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await receiptRow(d.receipt.id)).revision).toBe(1);
  });

  it("rotating invalidates the earlier link immediately", async () => {
    const first = await tokenFor(d.receipt.id, d.sam.id);
    const second = await tokenFor(d.receipt.id, d.sam.id);
    expect(second).not.toBe(first);
    expect((await read(first)).status).toBe(404);
    expect((await read(second)).status).toBe(200);
  });

  it("revoking clears the hash and done state, kills the link, and is idempotent", async () => {
    const token = await tokenFor(d.receipt.id, d.sam.id);
    expect((await submit(token)).status).toBe(200);
    expect((await revoke(d.receipt.id, d.sam.id)).status).toBe(204);
    expect(await participantRow(d.sam.id)).toMatchObject({ pickTokenHash: null, picksSubmittedAt: null });
    expect((await read(token)).status).toBe(404);
    expect((await revoke(d.receipt.id, d.sam.id)).status).toBe(204);
  });

  it("404s for a foreign receipt, an unknown participant, or another receipt's participant, writing nothing", async () => {
    const other = await draft();
    identity.userId = "picks-other";
    expect((await issue(d.receipt.id, d.sam.id)).status).toBe(404);
    expect((await revoke(d.receipt.id, d.sam.id)).status).toBe(404);
    identity.userId = "picks-owner";
    expect((await issue(d.receipt.id, "nobody")).status).toBe(404);
    expect((await issue(d.receipt.id, other.sam.id)).status).toBe(404);
    expect((await issue(d.receipt.id, " ")).status).toBe(404);
    expect((await participantRow(d.sam.id)).pickTokenHash).toBeNull();
    expect((await participantRow(other.sam.id)).pickTokenHash).toBeNull();
  });

  it("still rotates and revokes after finalize", async () => {
    await prisma.receipt.update({ where: { id: d.receipt.id }, data: { status: "FINALIZED", finalizedAt: new Date() } });
    const token = await tokenFor(d.receipt.id, d.sam.id);
    expect((await read(token)).status).toBe(200);
    expect((await revoke(d.receipt.id, d.sam.id)).status).toBe(204);
    expect((await read(token)).status).toBe(404);
  });

  it("receipt detail reports hasPickLink and picksSubmittedAt but never the hash", async () => {
    const token = await tokenFor(d.receipt.id, d.sam.id);
    await submit(token);
    const res = await receiptRoute.GET(new Request(`http://test/api/receipts/${d.receipt.id}`),
      { params: Promise.resolve({ id: d.receipt.id }) });
    const body = await res.json();
    const sam = body.participants.find((p: { id: string }) => p.id === d.sam.id);
    expect(sam).toMatchObject({ hasPickLink: true, picksSubmittedAt: expect.any(String) });
    expect(body.participants.find((p: { id: string }) => p.id === d.maya.id))
      .toMatchObject({ hasPickLink: false, picksSubmittedAt: null, email: MAYA_EMAIL });
    expect(keysDeep(body).has("pickTokenHash")).toBe(false);
    expect(JSON.stringify(body)).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
// Token: reading
// ---------------------------------------------------------------------------

describe("GET /api/picks/:token", () => {
  it("returns the draft projection with no contacts, owner or internals, and changes nothing", async () => {
    const token = await tokenFor(d.receipt.id, d.sam.id);
    await prisma.receiptItem.update({ where: { id: d.rice.id }, data: { assignedParticipantId: d.alex.id } });
    const before = await receiptRow(d.receipt.id);

    const res = await read(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      status: "DRAFT", revision: 1, merchantName: "Noodle Bar", purchasedAt: null, currency: "USD",
      participantId: d.sam.id, picksSubmittedAt: null,
      participants: [
        { id: d.alex.id, displayName: "Alex" },
        { id: d.maya.id, displayName: "Maya" },
        { id: d.sam.id, displayName: "Sam" },
      ],
      items: [
        { id: d.rice.id, lineNumber: 1, name: "Rice", quantity: "1", totalPrice: "4", pickedBy: [d.alex.id] },
        { id: d.mango.id, lineNumber: 2, name: "Mango", quantity: "1", totalPrice: "6", pickedBy: [] },
        { id: d.dumplings.id, lineNumber: 3, name: "Dumplings", quantity: "1", totalPrice: "12", pickedBy: [] },
      ],
    });
    expectNoPrivateData(body);
    expect(await receiptRow(d.receipt.id)).toEqual(before);
  });

  it("returns one indistinguishable 404 for every dead or malformed link", async () => {
    const live = await tokenFor(d.receipt.id, d.sam.id);
    const rotated = await tokenFor(d.receipt.id, d.maya.id);
    await tokenFor(d.receipt.id, d.maya.id);
    const revoked = await tokenFor(d.receipt.id, d.alex.id);
    await revoke(d.receipt.id, d.alex.id);

    const removed = await draft();
    const removedToken = await tokenFor(removed.receipt.id, removed.sam.id);
    await prisma.participant.delete({ where: { id: removed.sam.id } });

    const deleted = await draft();
    const deletedToken = await tokenFor(deleted.receipt.id, deleted.sam.id);
    await prisma.receipt.update({ where: { id: deleted.receipt.id }, data: { deletedAt: new Date() } });

    const parsing = await draft();
    const parsingToken = await tokenFor(parsing.receipt.id, parsing.sam.id);
    await prisma.receipt.update({ where: { id: parsing.receipt.id }, data: { parseStatus: "PARSING" } });

    const dead = ["short", "x".repeat(43), d.sam.id, rotated, revoked, removedToken, deletedToken, parsingToken];
    const bodies = [];
    for (const token of dead) {
      for (const res of [await read(token), await save(token, { itemIds: [] }), await submit(token)]) {
        expect(res.status, token).toBe(404);
        bodies.push(await res.json());
      }
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b)))).toEqual(
      new Set([JSON.stringify({ error: { code: "NOT_FOUND", message: "Link not found" } })]));
    expect((await read(live)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Token: picking
// ---------------------------------------------------------------------------

describe("PUT /api/picks/:token", () => {
  it("makes items picked by the holder alone their individual assignments", async () => {
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    const res = await save(sam, { itemIds: [d.rice.id, d.mango.id] });
    expect(res.status).toBe(200);
    expectNoPrivateData(await res.json());
    expect(await holdings(d.receipt.id)).toEqual({
      Rice: { assigned: d.sam.id, shared: [] },
      Mango: { assigned: d.sam.id, shared: [] },
      Dumplings: { assigned: null, shared: [] },
    });
    const receipt = await receiptRow(d.receipt.id);
    expect(receipt.revision).toBe(2);
    expect(receipt.reviewedAt).toEqual(new Date(0));
    expect(receipt.splitMode).toBe("ITEMIZED");
  });

  it("shares an item two people pick and moves ITEMIZED to SHARED_ITEMS", async () => {
    const maya = await tokenFor(d.receipt.id, d.maya.id);
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await save(maya, { itemIds: [d.dumplings.id] });
    await save(sam, { itemIds: [d.dumplings.id] });
    expect((await holdings(d.receipt.id)).Dumplings).toEqual({ assigned: null, shared: [d.maya.id, d.sam.id].sort() });
    expect((await receiptRow(d.receipt.id)).splitMode).toBe("SHARED_ITEMS");
  });

  it("unpicking a shared item leaves it as the remaining picker's assignment", async () => {
    const maya = await tokenFor(d.receipt.id, d.maya.id);
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await save(maya, { itemIds: [d.dumplings.id] });
    await save(sam, { itemIds: [d.dumplings.id] });
    await save(sam, { itemIds: [] });
    expect((await holdings(d.receipt.id)).Dumplings).toEqual({ assigned: d.maya.id, shared: [] });
  });

  it("never removes other participants' picks, including the owner's assignments", async () => {
    await prisma.receiptItem.update({ where: { id: d.rice.id }, data: { assignedParticipantId: d.alex.id } });
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await save(sam, { itemIds: [] });
    expect((await holdings(d.receipt.id)).Rice).toEqual({ assigned: d.alex.id, shared: [] });
    await save(sam, { itemIds: [d.rice.id] });
    expect((await holdings(d.receipt.id)).Rice).toEqual({ assigned: null, shared: [d.alex.id, d.sam.id].sort() });
  });

  it("moves an EVEN receipt to ITEMIZED on the first pick, and not on an empty save", async () => {
    const even = await draft("EVEN");
    const sam = await tokenFor(even.receipt.id, even.sam.id);
    await save(sam, { itemIds: [] });
    expect((await receiptRow(even.receipt.id)).splitMode).toBe("EVEN");
    await save(sam, { itemIds: [even.rice.id] });
    expect((await receiptRow(even.receipt.id)).splitMode).toBe("ITEMIZED");
  });

  it("404s an item from another receipt and rolls everything back", async () => {
    const other = await draft();
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    const before = await holdings(d.receipt.id);
    const res = await save(sam, { itemIds: [d.rice.id, other.rice.id] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Item not found" } });
    expect(await holdings(d.receipt.id)).toEqual(before);
    expect((await receiptRow(d.receipt.id)).revision).toBe(1);
  });

  it("rejects malformed bodies with 400", async () => {
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    expect((await save(sam, "{not json")).status).toBe(400);
    expect((await save(sam, { itemIds: [d.rice.id, d.rice.id] })).status).toBe(400);
    expect((await save(sam, { itemIds: Array.from({ length: 501 }, (_, i) => `item-${i}`) })).status).toBe(400);
    expect((await save(sam, {})).status).toBe(400);
    expect((await receiptRow(d.receipt.id)).revision).toBe(1);
  });

  it("serializes guests saving at the same moment so both picks land", async () => {
    const maya = await tokenFor(d.receipt.id, d.maya.id);
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    const results = await Promise.all([
      save(maya, { itemIds: [d.dumplings.id, d.mango.id] }),
      save(sam, { itemIds: [d.dumplings.id, d.rice.id] }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await holdings(d.receipt.id)).toEqual({
      Rice: { assigned: d.sam.id, shared: [] },
      Mango: { assigned: d.maya.id, shared: [] },
      Dumplings: { assigned: null, shared: [d.maya.id, d.sam.id].sort() },
    });
    expect((await receiptRow(d.receipt.id)).revision).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Token: done
// ---------------------------------------------------------------------------

describe("POST /api/picks/:token/done", () => {
  it("marks the holder done once, keeps the first time, and leaves the revision alone", async () => {
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    const first = await submit(sam);
    expect(first.status).toBe(200);
    const at = (await participantRow(d.sam.id)).picksSubmittedAt;
    expect(at).toBeInstanceOf(Date);
    expect((await first.json()).picksSubmittedAt).toBe(at!.toISOString());
    expect((await submit(sam)).status).toBe(200);
    expect((await participantRow(d.sam.id)).picksSubmittedAt).toEqual(at);
    expect((await receiptRow(d.receipt.id)).revision).toBe(1);
  });

  it("a later save clears done until the holder presses it again", async () => {
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await submit(sam);
    await save(sam, { itemIds: [d.rice.id] });
    expect((await participantRow(d.sam.id)).picksSubmittedAt).toBeNull();
  });

  it("is cleared for everyone when the owner replaces items or a parse completes", async () => {
    const maya = await tokenFor(d.receipt.id, d.maya.id);
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await submit(maya); await submit(sam);
    await replaceReceiptItems("picks-owner", d.receipt.id, {
      expectedRevision: 1,
      items: [{ lineNumber: 1, name: "Soup", quantity: "1", unitPrice: "5.00", totalPrice: "5.00" }],
    });
    expect((await participantRow(d.maya.id)).picksSubmittedAt).toBeNull();
    expect((await participantRow(d.sam.id)).picksSubmittedAt).toBeNull();

    await submit(sam);
    await prisma.receipt.update({ where: { id: d.receipt.id }, data: { parseStatus: "PARSING" } });
    const { revision } = await receiptRow(d.receipt.id);
    await completeReceiptParsing("picks-owner", d.receipt.id, revision,
      "Merchant: Corner Cafe\n1 x Soup @ 10.00 10.00\nSubtotal 10.00\nTax 0.00\nTotal 10.00");
    expect((await participantRow(d.sam.id)).picksSubmittedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// After finalize
// ---------------------------------------------------------------------------

describe("a finalized receipt", () => {
  async function finalize() {
    await prisma.bill.createMany({ data: [
      { receiptId: d.receipt.id, participantId: d.alex.id, subtotal: "10", taxShare: "0", tipShare: "0", amountOwed: "10" },
      { receiptId: d.receipt.id, participantId: d.maya.id, subtotal: "12", taxShare: "0", tipShare: "0", amountOwed: "12" },
      { receiptId: d.receipt.id, participantId: d.sam.id, subtotal: "0", taxShare: "0", tipShare: "0", amountOwed: "0" },
    ] });
    await prisma.receipt.update({ where: { id: d.receipt.id }, data: { status: "FINALIZED", finalizedAt: new Date() } });
  }

  it("shows everyone's amount owed, settled state and the payer, with no contacts", async () => {
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await finalize();
    const res = await read(sam);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "FINALIZED", paidBy: "Alex", participantId: d.sam.id });
    expect(body.participants).toEqual([
      { id: d.alex.id, displayName: "Alex", amountOwed: "10.00", settled: true },
      { id: d.maya.id, displayName: "Maya", amountOwed: "12.00", settled: false },
      { id: d.sam.id, displayName: "Sam", amountOwed: "0.00", settled: true },
    ]);
    expectNoPrivateData(body);
  });

  it("rejects picks and done with 409 and writes nothing", async () => {
    const sam = await tokenFor(d.receipt.id, d.sam.id);
    await finalize();
    const before = { receipt: await receiptRow(d.receipt.id), holdings: await holdings(d.receipt.id) };
    for (const res of [await save(sam, { itemIds: [d.rice.id] }), await save(sam, { itemIds: ["not-an-item"] }), await submit(sam)]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("CONFLICT");
    }
    expect(await receiptRow(d.receipt.id)).toEqual(before.receipt);
    expect(await holdings(d.receipt.id)).toEqual(before.holdings);
    expect((await participantRow(d.sam.id)).picksSubmittedAt).toBeNull();
  });
});
