import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "image-owner" }));
const storage = vi.hoisted(() => ({ downloadAttachment: vi.fn() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("@project/services", () => storage);
const { GET } = await import("../app/api/receipts/[id]/image/route");

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "image-owner", name: "Owner", email: "image-owner@example.com" },
    { id: "image-other", name: "Other", email: "image-other@example.com" },
  ] });
});

let receiptId: string;
const bytes = Uint8Array.from([137, 80, 78, 71, 0, 255]);
beforeEach(async () => {
  vi.restoreAllMocks();
  identity.userId = "image-owner";
  storage.downloadAttachment.mockReset().mockResolvedValue({ data: bytes, contentType: "text/plain" });
  receiptId = (await prisma.receipt.create({ data: {
    ownerId: "image-owner", imageBlobName: "private/photo.png", imageContentType: "image/png",
  } })).id;
});

const request = (id = receiptId) => GET(new Request("http://test/image"), { params: Promise.resolve({ id }) });

describe("receipt image GET", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("returns exact bytes and trusted %s headers without writes", async (imageContentType) => {
    await prisma.receipt.update({ where: { id: receiptId }, data: { imageContentType } });
    const before = await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } });
    const response = await request();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe(imageContentType);
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(storage.downloadAttachment).toHaveBeenCalledExactlyOnceWith("private/photo.png");
    expect(await prisma.receipt.findUniqueOrThrow({ where: { id: receiptId } })).toEqual(before);
  });

  it.each(["NOT_STARTED", "PARSING", "SUCCEEDED", "FAILED"] as const)("serves finalized photos in parsing state %s", async (parseStatus) => {
    await prisma.receipt.update({ where: { id: receiptId }, data: {
      status: "FINALIZED", parseStatus, subtotal: "1", tax: "0", total: "1", finalizedAt: new Date(),
    } });
    expect((await request()).status).toBe(200);
  });

  it.each(["", "image-unknown"])("rejects identity %j", async (userId) => {
    identity.userId = userId;
    expect((await request()).status).toBe(401);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it.each(["foreign", "deleted", "unknown", "missing"])("returns 404 for %s receipts before storage", async (kind) => {
    if (kind === "foreign") identity.userId = "image-other";
    if (kind === "deleted") await prisma.receipt.update({ where: { id: receiptId }, data: { deletedAt: new Date() } });
    const response = await request(kind === "unknown" ? "unknown" : kind === "missing" ? "" : receiptId);
    expect(response.status).toBe(404);
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing photo", async () => {
    storage.downloadAttachment.mockResolvedValueOnce(null);
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Receipt image not found" } });
  });

  it("hides storage details and returns retryable 503", async () => {
    storage.downloadAttachment.mockRejectedValueOnce(new Error("secret storage connection string"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Image storage is unavailable; try again later" } });
  });

  it("maps unexpected database failures to generic 500", async () => {
    vi.spyOn(prisma.receipt, "findFirst").mockRejectedValueOnce(new Error("secret query"));
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    expect(storage.downloadAttachment).not.toHaveBeenCalled();
  });
});
