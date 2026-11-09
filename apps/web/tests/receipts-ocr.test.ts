// Opt-in real OCR + real parse route + PGlite. Only identity, blob IO and cache
// are mocked; recognition uses the checked-in raster fixture and local model.
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const blob = vi.hoisted(() => ({ data: new Uint8Array() }));
vi.mock("@project/auth", () => ({ currentUserId: async () => "ocr-drill-owner" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@project/services", async (importOriginal) => ({
  ...await importOriginal<typeof import("@project/services")>(),
  downloadAttachment: async () => ({ data: blob.data, contentType: "image/png" }),
}));
const { POST } = await import("../app/api/receipts/[id]/parse/route");

it.skipIf(process.env.RECEIPT_OCR_DRILL !== "1")("extracts the receipt image with real local OCR and persists unreviewed results", async () => {
  blob.data = new Uint8Array(await readFile(new URL("./fixtures/receipt-ocr.png", import.meta.url)));
  await prisma.user.create({ data: { id: "ocr-drill-owner", name: "Drill", email: "ocr-drill@example.com" } });
  const receipt = await prisma.receipt.create({ data: {
    ownerId: "ocr-drill-owner", imageBlobName: "drill/receipt.png", imageContentType: "image/png",
  } });
  const response = await POST(new Request("http://test/parse", { method: "POST", body: JSON.stringify({ expectedRevision: 1 }) }), {
    params: Promise.resolve({ id: receipt.id }),
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect(await response.json()).toMatchObject({ parseStatus: "SUCCEEDED", reviewedAt: null, revision: 3 });
  const stored = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { items: { orderBy: { lineNumber: "asc" } } } });
  expect([stored.subtotal, stored.tax, stored.tip, stored.total].map((value) => value?.toFixed(2))).toEqual(["13.00", "1.00", "2.00", "16.00"]);
  expect(stored.items.map((item) => [item.name, item.quantity?.toString(), item.unitPrice?.toFixed(2), item.totalPrice?.toFixed(2), item.isVerified])).toEqual([
    ["Soup", "1", "10.00", "10.00", false], ["Tea", "1", "3.00", "3.00", false],
  ]);
}, 75_000);
