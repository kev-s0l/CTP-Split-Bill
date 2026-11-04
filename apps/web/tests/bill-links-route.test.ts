// Real bill-link handlers against PGlite, with only organizer auth mocked.
import { createHash } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";
import { BILL_LINK_TTL_MS } from "@project/domain";

const identity = vi.hoisted(() => ({ userId: "bl-alice" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));

const { POST: ISSUE, DELETE: REVOKE } = await import("../app/api/bills/[billsId]/link/route");
const { GET: READ } = await import("../app/api/bill-links/[token]/route");

const billContext = (billsId: string) => ({ params: Promise.resolve({ billsId }) });
const issue = (billsId = "bl-bill-sam") =>
  ISSUE(new Request(`http://test/api/bills/${billsId}/link`, { method: "POST" }), billContext(billsId));
const revoke = (billsId = "bl-bill-sam") =>
  REVOKE(new Request(`http://test/api/bills/${billsId}/link`, { method: "DELETE" }), billContext(billsId));
const read = (token: string) =>
  READ(new Request(`http://test/api/bill-links/${token}`), { params: Promise.resolve({ token }) });
const tokenOf = (url: string) => url.split("/b/")[1];
async function issuedToken(billsId?: string) {
  const res = await issue(billsId);
  expect(res.status).toBe(201);
  return tokenOf((await res.json()).url);
}
const notFound = { error: { code: "NOT_FOUND", message: "Bill not found" } };

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "bl-alice", name: "Alice", email: "bl-alice@example.com" },
    { id: "bl-bob", name: "Bob", email: "bl-bob@example.com" },
  ] });
  await prisma.receipt.create({ data: {
    id: "bl-receipt", ownerId: "bl-alice", status: "FINALIZED", imageBlobName: "bl.jpg", imageContentType: "image/jpeg",
    title: "Friday dinner", merchantName: "Trattoria", purchasedAt: new Date("2026-10-30T00:00:00Z"),
    subtotal: "10.00", tax: "0.00", tip: "0.00", total: "10.00",
    participants: { create: [
      { id: "bl-sam", displayName: "Sam", phone: "+12125550123" },
      { id: "bl-cara", displayName: "Cara" },
    ] },
  } });
  await prisma.bill.createMany({ data: [
    { id: "bl-bill-sam", receiptId: "bl-receipt", participantId: "bl-sam", subtotal: "6.00", taxShare: "0", tipShare: "0", amountOwed: "6.00" },
    { id: "bl-bill-cara", receiptId: "bl-receipt", participantId: "bl-cara", subtotal: "4.00", taxShare: "0", tipShare: "0", amountOwed: "4.00" },
  ] });
});

beforeEach(async () => {
  identity.userId = "bl-alice";
  await prisma.billLink.deleteMany();
  await prisma.bill.updateMany({ data: { paidAt: null } });
  await prisma.receipt.update({ where: { id: "bl-receipt" }, data: { deletedAt: null } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("POST /api/bills/:billsId/link", () => {
  it("issues a link with a prepared text and stores only the token hash", async () => {
    const before = Date.now();
    const res = await issue();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/^http:\/\/test\/b\/[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThanOrEqual(before + BILL_LINK_TTL_MS);
    expect(body.message).toBe(`Hi Sam, your share of Trattoria is $6.00. View your bill: ${body.url}`);
    expect(body.smsHref).toBe(`sms:+12125550123?body=${encodeURIComponent(body.message)}`);
    const [row] = await prisma.billLink.findMany();
    const token = tokenOf(body.url);
    expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.tokenHash).not.toContain(token);
  });

  it("uses PUBLIC_BASE_URL when set and omits smsHref without a phone", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://split.example.com/");
    const body = await (await issue("bl-bill-cara")).json();
    expect(body.url).toMatch(/^https:\/\/split\.example\.com\/b\/[A-Za-z0-9_-]{43}$/);
    expect(body.smsHref).toBeNull();
  });

  it("reissuing revokes the previous link", async () => {
    const first = await issuedToken();
    const second = await issuedToken();
    expect((await read(first)).status).toBe(404);
    expect((await read(second)).status).toBe(200);
    expect(await prisma.billLink.count({ where: { revokedAt: null } })).toBe(1);
  });

  it("404s for another organizer's, unknown and deleted-receipt bills, and 401s an unknown user", async () => {
    identity.userId = "bl-bob";
    const foreign = await issue();
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(notFound);
    identity.userId = "bl-alice";
    expect((await issue("missing-bill")).status).toBe(404);
    await prisma.receipt.update({ where: { id: "bl-receipt" }, data: { deletedAt: new Date() } });
    expect((await issue()).status).toBe(404);
    identity.userId = "missing-user";
    expect((await issue()).status).toBe(401);
    expect(await prisma.billLink.count()).toBe(0);
  });
});

describe("DELETE /api/bills/:billsId/link", () => {
  it("revokes the live link idempotently", async () => {
    const token = await issuedToken();
    expect((await revoke()).status).toBe(204);
    expect((await read(token)).status).toBe(404);
    expect((await revoke()).status).toBe(204);
  });

  it("404s for another organizer and leaves their link working", async () => {
    const token = await issuedToken();
    identity.userId = "bl-bob";
    expect((await revoke()).status).toBe(404);
    expect((await read(token)).status).toBe(200);
  });
});

describe("GET /api/bill-links/:token", () => {
  it("returns only the linked bill's guest projection with private headers", async () => {
    const res = await read(await issuedToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await res.json()).toEqual({
      displayName: "Sam", subtotal: "6.00", taxShare: "0.00", tipShare: "0.00", amountOwed: "6.00",
      paidAt: null, settled: false, outstandingAmount: "6.00",
      receipt: { title: "Friday dinner", merchantName: "Trattoria", purchasedAt: "2026-10-30T00:00:00.000Z", currency: "USD" },
      expiresAt: expect.any(String),
    });
  });

  it("reflects payment marked after the link was sent", async () => {
    const token = await issuedToken();
    await prisma.bill.update({ where: { id: "bl-bill-sam" }, data: { paidAt: new Date() } });
    expect(await (await read(token)).json()).toMatchObject({ amountOwed: "6.00", settled: true, outstandingAmount: "0.00" });
  });

  it("answers the same 404 for malformed, unknown, expired and deleted-receipt links", async () => {
    const lookups = vi.spyOn(prisma.billLink, "findUnique");
    const malformed = await read("not-a-token");
    expect(malformed.status).toBe(404);
    expect(lookups).not.toHaveBeenCalled();
    lookups.mockRestore();
    expect(await malformed.json()).toEqual(notFound);
    expect(malformed.headers.get("cache-control")).toBe("no-store");

    expect(await (await read("A".repeat(43))).json()).toEqual(notFound);

    const expired = await issuedToken();
    await prisma.billLink.updateMany({ data: { createdAt: new Date(0), expiresAt: new Date(1) } });
    expect(await (await read(expired)).json()).toEqual(notFound);

    const live = await issuedToken();
    await prisma.receipt.update({ where: { id: "bl-receipt" }, data: { deletedAt: new Date() } });
    expect(await (await read(live)).json()).toEqual(notFound);
  });

  it("maps unexpected read failures to a generic 500", async () => {
    const failure = vi.spyOn(prisma.billLink, "findUnique").mockRejectedValueOnce(new Error("private read failure"));
    try {
      const res = await read("B".repeat(43));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    } finally {
      failure.mockRestore();
    }
  });
});
