// Real upload route and domain queries against PGlite; external seams are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "upload-owner" }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const storage = vi.hoisted(() => ({
  MAX_ATTACHMENT_BYTES: 5 * 1024 * 1024,
  storageAvailable: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));
vi.mock("@project/services", () => storage);
vi.mock("next/cache", () => cache);

const { POST } = await import("../app/api/receipts/route");
const { GET: getReceipt } = await import("../app/api/receipts/[id]/route");

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
));
// These fixtures exercise format signatures; this feature does not decode images.
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]);
const webp = Uint8Array.from(Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
));

function photo(bytes = png, type = "image/png", name = "receipt.png") {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type });
}

function request(form: FormData, headers?: HeadersInit) {
  return new Request("http://test/api/receipts", { method: "POST", body: form, headers });
}

function upload(file = photo()) {
  const form = new FormData();
  form.append("file", file);
  return request(form);
}

const countReceipts = () => prisma.receipt.count({ where: { ownerId: "upload-owner", deletedAt: null } });
let receiptsBefore = 0;

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: "upload-owner", name: "Owner", email: "upload-owner@example.com" },
    { id: "upload-other", name: "Other", email: "upload-other@example.com" },
  ] });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  identity.userId = "upload-owner";
  cache.revalidatePath.mockReset();
  storage.storageAvailable.mockReset().mockResolvedValue(true);
  storage.uploadAttachment.mockReset().mockImplementation(async (id: string) => `${id}/stored-photo`);
  storage.deleteAttachment.mockReset().mockResolvedValue(undefined);
  receiptsBefore = await countReceipts();
});

async function expectRejectedUpload(req: Request) {
  const response = await POST(req);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "INVALID_INPUT", message: expect.any(String) },
  });
  expect(storage.storageAvailable).not.toHaveBeenCalled();
  expect(storage.uploadAttachment).not.toHaveBeenCalled();
  expect(storage.deleteAttachment).not.toHaveBeenCalled();
  expect(cache.revalidatePath).not.toHaveBeenCalled();
  expect(await countReceipts()).toBe(receiptsBefore);
}

describe("receipt photo uploads", () => {
  it("stores an owned draft with schema defaults and returns only receipt detail", async () => {
    const response = await POST(upload());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      id: expect.any(String), ownerId: "upload-owner", title: null, paidByParticipantId: null,
      status: "DRAFT", parseStatus: "NOT_STARTED", splitMode: "EVEN", revision: 1,
      reviewedAt: null, finalizedAt: null, merchantName: null, address: null,
      purchasedAt: null, currency: "USD", subtotal: null, tax: null, tip: null,
      total: null, createdAt: expect.any(String), updatedAt: expect.any(String),
      participants: [], items: [],
    });
    expect(response.headers.get("Location")).toBe(`/api/receipts/${body.id}`);
    expect(storage.uploadAttachment).toHaveBeenCalledWith(body.id, "receipt.png", "image/png", expect.any(ArrayBuffer));
    expect(new Uint8Array(storage.uploadAttachment.mock.calls[0][3])).toEqual(png);
    const saved = await prisma.receipt.findUniqueOrThrow({ where: { id: body.id } });
    expect(saved).toMatchObject({
      ownerId: "upload-owner", imageBlobName: `${body.id}/stored-photo`, imageContentType: "image/png",
      status: "DRAFT", parseStatus: "NOT_STARTED", revision: 1, reviewedAt: null, deletedAt: null,
    });
    expect(await prisma.bill.count({ where: { receiptId: body.id } })).toBe(0);
    expect(await countReceipts()).toBe(receiptsBefore + 1);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/api/receipts");
    expect(storage.deleteAttachment).not.toHaveBeenCalled();

    identity.userId = "upload-other";
    const foreign = await getReceipt(new Request(`http://test/api/receipts/${body.id}`), {
      params: Promise.resolve({ id: body.id }),
    });
    expect(foreign.status).toBe(404);
  });

  it.each([
    ["JPEG", jpeg, "image/jpeg"],
    ["PNG", png, "image/png"],
    ["WebP", webp, "image/webp"],
  ] as const)("accepts the %s signature with its matching content type", async (_format, bytes, type) => {
    const response = await POST(upload(photo(Uint8Array.from(bytes), type)));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: body.id } })).imageContentType).toBe(type);
  });

  it("accepts exactly the size limit", async () => {
    const bytes = new Uint8Array(storage.MAX_ATTACHMENT_BYTES);
    bytes.set(png);
    const response = await POST(upload(photo(bytes)));
    expect(response.status).toBe(201);
    expect(storage.uploadAttachment.mock.calls[0][3].byteLength).toBe(storage.MAX_ATTACHMENT_BYTES);
  });

  it("uses the session owner even when a request header names a different user", async () => {
    const req = upload();
    req.headers.set("x-user-id", "upload-other");
    const response = await POST(req);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ownerId: "upload-owner" });
  });

  it("creates distinct server-generated IDs for separate uploads", async () => {
    const first = await POST(upload());
    const second = await POST(upload());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await first.json()).id).not.toBe((await second.json()).id);
  });

  it.each(["", "upload-unknown"])("rejects identity %j before reading the body or calling storage", async (userId) => {
    identity.userId = userId;
    const req = new Request("http://test/api/receipts", { method: "POST", body: "malformed" });
    const parse = vi.spyOn(req, "formData");
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Unknown user" } });
    expect(parse).not.toHaveBeenCalled();
    expect(storage.storageAvailable).not.toHaveBeenCalled();
    expect(storage.uploadAttachment).not.toHaveBeenCalled();
    expect(await countReceipts()).toBe(receiptsBefore);
  });

  it("rejects malformed multipart bodies", async () => {
    await expectRejectedUpload(new Request("http://test/api/receipts", {
      method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=broken" }, body: "not multipart",
    }));
  });

  it("rejects a JSON body", async () => {
    await expectRejectedUpload(new Request("http://test/api/receipts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }));
  });

  it("requires a file field", async () => {
    await expectRejectedUpload(request(new FormData()));
  });

  it("rejects text in place of the file", async () => {
    const form = new FormData();
    form.append("file", "receipt.png");
    await expectRejectedUpload(request(form));
  });

  it("rejects duplicate files", async () => {
    const form = new FormData();
    form.append("file", photo());
    form.append("file", photo());
    await expectRejectedUpload(request(form));
  });

  it.each(["ownerId", "id", "imageBlobName", "status", "otherFile"])("rejects an extra %s field", async (field) => {
    const form = new FormData();
    form.append("file", photo());
    form.append(field, field === "otherFile" ? photo() : "client-supplied");
    await expectRejectedUpload(request(form));
  });

  it.each([
    ["empty", () => photo(new Uint8Array())],
    ["over limit", () => {
      const bytes = new Uint8Array(storage.MAX_ATTACHMENT_BYTES + 1);
      bytes.set(png);
      return photo(bytes);
    }],
    ["unsupported MIME type", () => photo(png, "image/gif")],
    ["SVG", () => photo(Uint8Array.from(Buffer.from("<svg/>")), "image/svg+xml")],
    ["missing MIME type", () => photo(png, "")],
    ["text labelled PNG", () => photo(Uint8Array.from(Buffer.from("this is not a photo")))],
    ["JPEG labelled PNG", () => photo(jpeg, "image/png")],
    ["PNG labelled WebP", () => photo(png, "image/webp")],
    ["truncated signature", () => photo(png.slice(0, 4))],
  ] as const)("rejects a file that is %s", async (_label, makePhoto) => {
    await expectRejectedUpload(upload(makePhoto()));
  });

  it("returns a shaped 503 when storage is unavailable without creating a receipt", async () => {
    storage.storageAvailable.mockResolvedValueOnce(false);
    const response = await POST(upload());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL", message: "Image storage is unavailable; try again later" },
    });
    expect(storage.uploadAttachment).not.toHaveBeenCalled();
    expect(storage.deleteAttachment).not.toHaveBeenCalled();
    expect(await countReceipts()).toBe(receiptsBefore);
  });

  it("returns a shaped 503 for upload failure and does not create a receipt", async () => {
    storage.uploadAttachment.mockRejectedValueOnce(new Error("private Azure connection details"));
    const response = await POST(upload());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL", message: "Image storage is unavailable; try again later" },
    });
    expect(await countReceipts()).toBe(receiptsBefore);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("cleans up the uploaded image when database creation fails", async () => {
    vi.spyOn(prisma.receipt, "create").mockRejectedValueOnce(new Error("private database failure"));
    const response = await POST(upload());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    const receiptId = storage.uploadAttachment.mock.calls[0][0];
    expect(storage.deleteAttachment).toHaveBeenCalledExactlyOnceWith(`${receiptId}/stored-photo`);
    expect(await countReceipts()).toBe(receiptsBefore);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves the mapped database error when image cleanup also fails", async () => {
    vi.spyOn(prisma.receipt, "create").mockRejectedValueOnce({ code: "P2002", message: "private duplicate details" });
    storage.deleteAttachment.mockRejectedValueOnce(new Error("private cleanup failure"));
    const response = await POST(upload());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "CONFLICT", message: "That already exists" } });
    expect(storage.deleteAttachment).toHaveBeenCalledOnce();
    expect(await countReceipts()).toBe(receiptsBefore);
  });

  it("preserves a successful creation and its image when cache invalidation fails", async () => {
    cache.revalidatePath.mockImplementationOnce(() => { throw new Error("private cache failure"); });
    const response = await POST(upload());
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(await prisma.receipt.findUnique({ where: { id: body.id } })).not.toBeNull();
    expect(storage.deleteAttachment).not.toHaveBeenCalled();
    expect(await countReceipts()).toBe(receiptsBefore + 1);
  });
});
