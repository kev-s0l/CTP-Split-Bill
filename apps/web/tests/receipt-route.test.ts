// GET /api/receipts/[receiptId] through the real route handler, against
// in-memory PGlite. Identity is mocked at the @project/auth seam.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "receipt-alice" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));

const { GET } = await import("../app/api/receipts/[receiptId]/route");

function get(receiptId: string) {
  return GET(new Request(`http://test/api/receipts/${receiptId}`), {
    params: Promise.resolve({ receiptId }),
  });
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "receipt-alice", name: "Alice", email: "receipt-alice@example.com" },
      { id: "receipt-bob", name: "Bob", email: "receipt-bob@example.com" },
    ],
  });

  await prisma.party.create({
    data: {
      id: "receipt-party-alice",
      name: "Alice's dinner",
      organizerId: "receipt-alice",
      members: {
        create: { id: "receipt-member-alice", userId: "receipt-alice", displayName: "Alice" },
      },
      receipts: {
        create: {
          id: "receipt-detail-alice",
          uploadedById: "receipt-alice",
          imageBlobName: "test/receipt.jpg",
          imageContentType: "image/jpeg",
          merchantName: "Alice's Bistro",
          address: "123 Main Street",
          purchasedAt: new Date("2026-10-01T18:30:00.000Z"),
          items: {
            create: [
              { lineNumber: 2, name: "Tea", quantity: "1", unitPrice: "3.00", totalPrice: "3.00" },
              { lineNumber: 1, name: "Dinner", quantity: "1", unitPrice: "20.00", totalPrice: "20.00" },
            ],
          },
        },
      },
    },
  });
});

beforeEach(() => {
  identity.userId = "receipt-alice";
});

describe("GET /api/receipts/[receiptId]", () => {
  it("200 with the receipt details and items ordered by line number", async () => {
    const res = await get("receipt-detail-alice");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: "receipt-detail-alice",
      partyId: "receipt-party-alice",
      paidByMemberId: null,
      status: "UPLOADED",
      splitMode: "EVEN",
      merchantName: "Alice's Bistro",
      address: "123 Main Street",
      purchasedAt: "2026-10-01T18:30:00.000Z",
      currency: "USD",
      subtotal: null,
      tax: null,
      tip: null,
      total: null,
      createdAt: expect.any(String),
    });
    expect(body.items.map((item: { lineNumber: number }) => item.lineNumber)).toEqual([1, 2]);
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["Dinner", "Tea"]);
    expect(body).not.toHaveProperty("extraction");
    expect(body).not.toHaveProperty("parseError");
    expect(body).not.toHaveProperty("imageBlobName");
    expect(body).not.toHaveProperty("deletedAt");
  });

  it("404 in the shared error shape when the receipt belongs to another user", async () => {
    identity.userId = "receipt-bob";

    const res = await get("receipt-detail-alice");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Receipt not found" },
    });
  });
});
