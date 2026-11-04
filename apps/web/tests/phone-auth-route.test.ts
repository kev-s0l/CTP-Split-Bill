// Real phone-auth and participant-bills handlers against PGlite, with only the SMS sender mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";
import { MAX_CODE_ATTEMPTS } from "@project/domain";

const sms = vi.hoisted(() => ({ sendSms: vi.fn(async (_to: string, _message: string) => {}) }));
vi.mock("@project/services", () => sms);

const { POST: START } = await import("../app/api/phone-auth/start/route");
const { POST: VERIFY } = await import("../app/api/phone-auth/verify/route");
const { DELETE: SIGN_OUT } = await import("../app/api/phone-auth/session/route");
const { GET: BILLS } = await import("../app/api/participant-bills/route");

const PHONE = "+12125550123";
const post = (handler: typeof START, body: unknown, headers: Record<string, string> = {}) =>
  handler(new Request("http://test/api/phone-auth", { method: "POST", body: JSON.stringify(body), headers }));
const start = (phone: string, ip = "203.0.113.1") => post(START, { phone }, { "x-forwarded-for": `${ip}, 10.0.0.1` });
const verify = (phone: string, code: string) => post(VERIFY, { phone, code });
const withCookie = (cookie: string | null) => new Request("http://test/api", { headers: cookie ? { cookie } : {} });
const bills = (cookie: string | null) => BILLS(withCookie(cookie));
const lastCode = () => /\b(\d{6})\b/.exec(String(sms.sendSms.mock.lastCall?.[1]))![1];

async function signIn(phone = PHONE) {
  expect((await start(phone)).status).toBe(202);
  const res = await verify(phone, lastCode());
  expect(res.status).toBe(204);
  return res.headers.get("set-cookie")!.split(";")[0];
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "pa-alice", name: "Alice", email: "pa-alice@example.com" },
    { id: "pa-bob", name: "Bob", email: "pa-bob@example.com" },
  ] });
  const finalized = (id: string, ownerId: string, createdAt: Date, deletedAt: Date | null = null) => ({
    id, ownerId, status: "FINALIZED" as const, imageBlobName: `${id}.jpg`, imageContentType: "image/jpeg",
    title: `Dinner ${id}`, merchantName: "Trattoria", subtotal: "10.00", tax: "0.00", tip: "0.00", total: "10.00",
    createdAt, deletedAt,
  });
  await prisma.receipt.createMany({ data: [
    finalized("pa-alice-receipt", "pa-alice", new Date(1000)),
    finalized("pa-bob-receipt", "pa-bob", new Date(2000)),
    finalized("pa-deleted-receipt", "pa-bob", new Date(3000), new Date()),
  ] });
  await prisma.participant.createMany({ data: [
    { id: "pa-sam-a", receiptId: "pa-alice-receipt", displayName: "Sam", phone: PHONE },
    { id: "pa-cara-a", receiptId: "pa-alice-receipt", displayName: "Cara", phone: "+13125550000" },
    { id: "pa-sam-b", receiptId: "pa-bob-receipt", displayName: "Sammy", phone: PHONE },
    { id: "pa-sam-d", receiptId: "pa-deleted-receipt", displayName: "Sam", phone: PHONE },
  ] });
  const bill = (id: string, receiptId: string, participantId: string, amount: string, createdAt: Date) =>
    ({ id, receiptId, participantId, subtotal: amount, taxShare: "0", tipShare: "0", amountOwed: amount, createdAt });
  await prisma.bill.createMany({ data: [
    bill("pa-bill-sam-a", "pa-alice-receipt", "pa-sam-a", "6.00", new Date(1000)),
    bill("pa-bill-cara-a", "pa-alice-receipt", "pa-cara-a", "4.00", new Date(1000)),
    bill("pa-bill-sam-b", "pa-bob-receipt", "pa-sam-b", "10.00", new Date(2000)),
    bill("pa-bill-sam-d", "pa-deleted-receipt", "pa-sam-d", "10.00", new Date(3000)),
  ] });
});

beforeEach(async () => {
  sms.sendSms.mockReset();
  sms.sendSms.mockImplementation(async () => {});
  await prisma.phoneSession.deleteMany();
  await prisma.phoneVerification.deleteMany();
});

describe("POST /api/phone-auth/start", () => {
  it("normalizes the phone, texts a code and stores only its hash", async () => {
    const res = await start("(212) 555-0123");
    expect(res.status).toBe(202);
    expect(sms.sendSms).toHaveBeenCalledOnce();
    expect(sms.sendSms.mock.lastCall![0]).toBe(PHONE);
    const [row] = await prisma.phoneVerification.findMany();
    expect(row).toMatchObject({ phone: PHONE, clientIp: "203.0.113.1", attempts: 0, consumedAt: null });
    expect(row.codeHash).not.toContain(lastCode());
  });

  it("answers 202 without texting or storing for a phone on no live receipt", async () => {
    const res = await start("+14155550199");
    expect(res.status).toBe(202);
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect(await prisma.phoneVerification.count()).toBe(0);
  });

  it("rejects malformed phones and bodies with 400", async () => {
    expect((await start("12345")).status).toBe(400);
    const bad = await START(new Request("http://test", { method: "POST", body: "{" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: "INVALID_INPUT", message: "Body must be valid JSON" } });
  });

  it("stops texting after the per-phone limit but still answers 202", async () => {
    for (let i = 0; i < 3; i++) expect((await start(PHONE)).status).toBe(202);
    expect((await start(PHONE)).status).toBe(202);
    expect(sms.sendSms).toHaveBeenCalledTimes(3);
  });

  it("stops texting after the per-IP limit", async () => {
    await prisma.phoneVerification.createMany({ data: Array.from({ length: 10 }, (_, i) => ({
      phone: `+1312555${String(i).padStart(4, "0")}`, codeHash: "x", clientIp: "198.51.100.9", expiresAt: new Date(Date.now() + 60_000),
    })) });
    expect((await start(PHONE, "198.51.100.9")).status).toBe(202);
    expect(sms.sendSms).not.toHaveBeenCalled();
    expect((await start(PHONE, "198.51.100.10")).status).toBe(202);
    expect(sms.sendSms).toHaveBeenCalledOnce();
  });

  it("answers 202 when delivery fails", async () => {
    sms.sendSms.mockRejectedValueOnce(new Error("provider down"));
    expect((await start(PHONE)).status).toBe(202);
  });
});

describe("POST /api/phone-auth/verify", () => {
  it("sets an HttpOnly session cookie for the right code, once", async () => {
    await start(PHONE);
    const code = lastCode();
    const res = await verify("212-555-0123", code);
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^phone_session=[\w-]{43}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect(Number(/Max-Age=(\d+)/.exec(cookie)![1])).toBeGreaterThan(604_790);
    expect(await prisma.phoneSession.count()).toBe(1);
    const reused = await verify(PHONE, code);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toEqual({ error: { code: "INVALID_INPUT", message: "Code is invalid or expired" } });
  });

  it("locks the code after the maximum wrong attempts", async () => {
    await start(PHONE);
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) expect((await verify(PHONE, wrong)).status).toBe(400);
    expect((await verify(PHONE, code)).status).toBe(400);
    expect(await prisma.phoneSession.count()).toBe(0);
  });

  it("rejects expired codes and codes superseded by a newer one", async () => {
    await start(PHONE);
    const first = lastCode();
    await start(PHONE);
    expect(await prisma.phoneVerification.count({ where: { consumedAt: null } })).toBe(1);
    expect((await verify(PHONE, first)).status).toBe(first === lastCode() ? 204 : 400);
    await prisma.phoneVerification.updateMany({ data: { expiresAt: new Date(0) } });
    expect((await verify(PHONE, lastCode())).status).toBe(400);
  });

  it("rejects a code issued for a different phone", async () => {
    await start(PHONE);
    expect((await verify("+13125550000", lastCode())).status).toBe(400);
  });
});

describe("GET /api/participant-bills", () => {
  it("returns the verified phone's bills across organizers, newest first, excluding deleted receipts", async () => {
    const res = await bills(await signIn());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((row: { id: string }) => row.id)).toEqual(["pa-bill-sam-b", "pa-bill-sam-a"]);
    expect(body[1]).toEqual({
      id: "pa-bill-sam-a", receiptId: "pa-alice-receipt", participantId: "pa-sam-a", displayName: "Sam", phone: PHONE,
      subtotal: "6.00", taxShare: "0.00", tipShare: "0.00", amountOwed: "6.00", paidAt: null,
      createdAt: new Date(1000).toISOString(), settled: false, outstandingAmount: "6.00",
      receipt: { title: "Dinner pa-alice-receipt", merchantName: "Trattoria", purchasedAt: null, currency: "USD" },
    });
  });

  it("returns 401 without, with a forged, an expired or a revoked session", async () => {
    const unauthorized = { error: { code: "UNAUTHENTICATED", message: "Phone verification required" } };
    const none = await bills(null);
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual(unauthorized);
    expect((await bills("phone_session=forged")).status).toBe(401);

    const cookie = await signIn();
    await prisma.phoneSession.updateMany({ data: { expiresAt: new Date(0) } });
    expect((await bills(cookie)).status).toBe(401);

    const fresh = await signIn();
    expect((await bills(fresh)).status).toBe(200);
    const out = await SIGN_OUT(withCookie(fresh));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await bills(fresh)).status).toBe(401);
  });
});
