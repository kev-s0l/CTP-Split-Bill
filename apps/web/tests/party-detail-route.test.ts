// GET /api/parties/[partyId] through the real route handler, against in-memory PGlite.
// Identity is mocked at the @project/auth seam, the same place real auth will plug in.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "alice" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));

const { GET } = await import("../app/api/parties/[partyId]/route");

function get(partyId: string) {
  return GET(new Request(`http://test/api/parties/${partyId}`), { params: Promise.resolve({ partyId }) });
}

const notFound = { error: { code: "NOT_FOUND", message: "Party not found" } };

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ],
  });
  await prisma.party.create({
    data: {
      id: "alices-party",
      name: "Sushi night",
      organizerId: "alice",
      members: {
        create: [
          { userId: "alice", displayName: "Alice", joinedAt: new Date("2026-01-01T00:00:00Z") },
          { displayName: "Sam (guest)", joinedAt: new Date("2026-01-02T00:00:00Z") },
        ],
      },
    },
  });
});

beforeEach(() => {
  identity.userId = "alice";
});

describe("GET /api/parties/[partyId]", () => {
  it("200 with the party and its members", async () => {
    const res = await get("alices-party");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: "alices-party", name: "Sushi night", organizerId: "alice" });
    expect(body.members.map((m: { userId: string | null; displayName: string }) => [m.userId, m.displayName])).toEqual([
      ["alice", "Alice"],
      [null, "Sam (guest)"],
    ]);
  });

  it("404 for a second user who is not a member", async () => {
    identity.userId = "bob";
    const res = await get("alices-party");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFound);
  });

  it("404 for an unknown party, same body", async () => {
    const res = await get("no-such-party");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFound);
  });

  it("500 with a generic message when something unexpected fails, never the raw error", async () => {
    const spy = vi.spyOn(prisma.party, "findFirst").mockRejectedValueOnce(new Error("connection refused at 10.0.0.5"));

    const res = await get("alices-party");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    spy.mockRestore();
  });
});
