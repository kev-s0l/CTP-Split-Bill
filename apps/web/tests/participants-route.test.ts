// Participant reads and payer edits through real receipt routes against PGlite.
// Participant roster writes have no implemented HTTP handler yet.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "participant-route-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("next/cache", () => cache);
const { GET, PATCH } = await import("../app/api/receipts/[id]/route");

const ownerId = "participant-route-owner";
const otherId = "participant-route-other";
const phone = "+12125550123";

function receiptFor(userId = ownerId) {
  return prisma.receipt.create({
    data: {
      ownerId: userId, imageBlobName: "participants.jpg", imageContentType: "image/jpeg",
      participants: { create: [
        { displayName: "Sam", phone, joinedAt: new Date(0) },
        { displayName: "Sam", phone, joinedAt: new Date(1000) },
      ] },
    },
    include: { participants: { orderBy: { joinedAt: "asc" } } },
  });
}

let receipt: Awaited<ReturnType<typeof receiptFor>>;
let foreign: Awaited<ReturnType<typeof receiptFor>>;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id = receipt.id) => GET(new Request(`http://test/api/receipts/${id}`), context(id));
const stored = () => prisma.receipt.findUniqueOrThrow({
  where: { id: receipt.id }, include: { participants: { orderBy: { joinedAt: "asc" } } },
});

function patch(body: Record<string, unknown> | string, id = receipt.id) {
  return PATCH(new Request(`http://test/api/receipts/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify({ expectedRevision: 1, ...body }),
  }), context(id));
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: ownerId, name: "Owner", email: "participant-route-owner@example.com" },
    { id: otherId, name: "Sam", email: "participant-route-other@example.com", phone },
  ] });
  foreign = await receiptFor(otherId);
});

beforeEach(async () => {
  identity.userId = ownerId;
  cache.revalidatePath.mockClear();
  receipt = await receiptFor();
});

describe("receipt participant reads and payer edits", () => {
  it("returns the receipt-local roster, including repeated contacts, without account fields", async () => {
    const before = await stored();
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).participants).toEqual(receipt.participants.map(({ id, displayName, phone, joinedAt }) => ({
      id, displayName, phone, joinedAt: joinedAt.toISOString(),
    })));
    expect(await stored()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sets a payer without changing the roster and returns the updated receipt", async () => {
    const before = await stored();
    const payerId = receipt.participants[0].id;
    const response = await patch({ paidByParticipantId: payerId, ownerId: otherId });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: receipt.id, ownerId, paidByParticipantId: payerId, revision: 2 });
    expect(await stored()).toEqual({ ...before, paidByParticipantId: payerId, revision: 2, updatedAt: expect.any(Date) });
    expect(cache.revalidatePath.mock.calls).toEqual([[`/api/receipts/${receipt.id}`]]);
  });

  it("clears the payer without deleting the participant", async () => {
    expect((await patch({ paidByParticipantId: receipt.participants[0].id })).status).toBe(200);
    const response = await patch({ expectedRevision: 2, paidByParticipantId: null });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ paidByParticipantId: null, revision: 3 });
    expect((await stored()).participants).toEqual(receipt.participants);
  });

  it.each([
    {}, { paidByParticipantId: " " }, { paidByParticipantId: 7 }, "{broken json",
  ])("rejects invalid payer input %j without writes or revalidation", async (body) => {
    const before = await stored();
    await expectError(await patch(body), 400, "INVALID_INPUT");
    expect(await stored()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown user on reads and payer edits", async () => {
    const before = await stored();
    identity.userId = "missing-user";

    await expectError(await get(), 401, "UNAUTHENTICATED");
    await expectError(await patch({ paidByParticipantId: receipt.participants[0].id }), 401, "UNAUTHENTICATED");
    expect(await stored()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 404 even when the caller's phone matches a receipt contact", async () => {
    const before = await stored();
    identity.userId = otherId;

    await expectError(await get(), 404, "NOT_FOUND");
    await expectError(await patch({ paidByParticipantId: receipt.participants[0].id }), 404, "NOT_FOUND");
    expect(await stored()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign and unknown receipts without changing either roster", async () => {
    const before = await stored();
    const foreignBefore = await prisma.receipt.findUniqueOrThrow({ where: { id: foreign.id }, include: { participants: true } });

    for (const id of [foreign.id, "missing-receipt"]) {
      await expectError(await get(id), 404, "NOT_FOUND");
      await expectError(await patch({ paidByParticipantId: receipt.participants[0].id }, id), 404, "NOT_FOUND");
    }
    expect(await stored()).toEqual(before);
    expect(await prisma.receipt.findUniqueOrThrow({ where: { id: foreign.id }, include: { participants: true } })).toEqual(foreignBefore);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("hides soft-deleted receipts and rejects payer changes", async () => {
    await prisma.receipt.update({ where: { id: receipt.id }, data: { deletedAt: new Date() } });
    const before = await stored();

    await expectError(await get(), 404, "NOT_FOUND");
    await expectError(await patch({ paidByParticipantId: receipt.participants[0].id }), 404, "NOT_FOUND");
    expect(await stored()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects payers from other receipts, including another receipt owned by the same user", async () => {
    const second = await receiptFor();
    const before = await stored();

    for (const paidByParticipantId of [second.participants[0].id, foreign.participants[0].id, "missing-participant"]) {
      await expectError(await patch({ paidByParticipantId }), 404, "NOT_FOUND");
      expect(await stored()).toEqual(before);
    }
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a stale payer edit without changing the receipt", async () => {
    const before = await stored();

    await expectError(await patch({ expectedRevision: 99, paidByParticipantId: receipt.participants[0].id }), 409, "CONFLICT");
    expect(await stored()).toEqual(before);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
