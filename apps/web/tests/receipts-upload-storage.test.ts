// Opt-in drill: real receipt POST, PGlite and an isolated Azurite blob emulator.
import { expect, it, vi } from "vitest";
import { prisma } from "@project/db";
import { deleteAttachment, downloadAttachment } from "@project/services";

vi.mock("@project/auth", () => ({ currentUserId: async () => "upload-storage-owner" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { POST } = await import("../app/api/receipts/route");

it.skipIf(process.env.RECEIPT_UPLOAD_AZURITE !== "1")(
  "initializes fresh storage, creates a draft and downloads the exact photo bytes",
  async () => {
    await prisma.user.create({ data: {
      id: "upload-storage-owner", name: "Storage drill", email: "upload-storage-owner@example.com",
    } });
    const bytes = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ));
    const form = new FormData();
    form.append("file", new File([bytes.buffer], "../receipt photo.png", { type: "image/png" }));
    const response = await POST(new Request("http://test/api/receipts", { method: "POST", body: form }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      ownerId: "upload-storage-owner", status: "DRAFT", parseStatus: "NOT_STARTED", revision: 1,
      participants: [], items: [],
    });
    expect(body).not.toHaveProperty("imageBlobName");
    const saved = await prisma.receipt.findUniqueOrThrow({ where: { id: body.id } });
    try {
      expect(saved.imageBlobName).toBe(`${body.id}/_receipt_photo.png`);
      const stored = await downloadAttachment(saved.imageBlobName);
      expect(stored).not.toBeNull();
      expect(stored!.contentType).toBe("image/png");
      expect(stored!.data).toEqual(bytes);
    } finally {
      await deleteAttachment(saved.imageBlobName);
    }
    expect(await downloadAttachment(saved.imageBlobName)).toBeNull();
  },
  30_000,
);
