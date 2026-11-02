// POST/DELETE /api/parties/[partyId]/members through the real route handlers,
// against local PGlite. Identity is mocked at @project/auth.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "alice" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));

const { POST } = await import("../app/api/parties/[partyId]/members/route");
const { DELETE } = await import("../app/api/parties/[partyId]/members/[memberId]/route");

function add(partyId: string, body: string) {
  return POST(
    new Request(`http://test/api/parties/${partyId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ partyId }) }
  );
}

function remove(partyId: string, memberId: string) {
  return DELETE(new Request(`http://test/api/parties/${partyId}/members/${memberId}`, { method: "DELETE" }), {
    params: Promise.resolve({ partyId, memberId }),
  });
}

let partyId: string;

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ],
  });
  const party = await prisma.party.create({
    data: { name: "Sushi night", organizerId: "alice", members: { create: { userId: "alice", displayName: "Alice" } } },
  });
  partyId = party.id;
});

beforeEach(() => {
  identity.userId = "alice";
});

describe("POST /api/parties/[partyId]/members", () => {
  it("201 with the new guest", async () => {
    const res = await add(partyId, JSON.stringify({ displayName: "Sam" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ partyId, userId: null, displayName: "Sam" });
  });

  it("409 in the shared error shape when the same user is added twice", async () => {
    expect((await add(partyId, JSON.stringify({ displayName: "Bob", userId: "bob" }))).status).toBe(201);

    const res = await add(partyId, JSON.stringify({ displayName: "Bob", userId: "bob" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
  });

  it("400 when the display name is blank", async () => {
    const res = await add(partyId, JSON.stringify({ displayName: " " }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "displayName: Display name is required" },
    });
  });

  it("400 on malformed JSON", async () => {
    const res = await add(partyId, "{not json");

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Body must be valid JSON");
  });

  it("404 for someone outside the party", async () => {
    identity.userId = "stranger";
    const res = await add(partyId, JSON.stringify({ displayName: "Sneak" }));

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("403 for a member who is not the organizer", async () => {
    identity.userId = "bob"; // added by the 409 test above
    const res = await add(partyId, JSON.stringify({ displayName: "Bob's friend" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });
});

describe("DELETE /api/parties/[partyId]/members/[memberId]", () => {
  it("204 with no body, and the member is gone", async () => {
    const guest = await (await add(partyId, JSON.stringify({ displayName: "Temp" }))).json();

    const res = await remove(partyId, guest.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await prisma.partyMember.findUnique({ where: { id: guest.id } })).toBeNull();
  });

  it("404 for an unknown member id", async () => {
    const res = await remove(partyId, "no-such-member");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Member not found" } });
  });

  it("409 when the organizer tries to remove themself", async () => {
    const me = await prisma.partyMember.findFirstOrThrow({ where: { partyId, userId: "alice" } });

    const res = await remove(partyId, me.id);
    expect(res.status).toBe(409);
  });

  it("404 for someone outside the party, and nothing is deleted", async () => {
    const guest = await (await add(partyId, JSON.stringify({ displayName: "Keep me" }))).json();

    identity.userId = "stranger";
    expect((await remove(partyId, guest.id)).status).toBe(404);
    expect(await prisma.partyMember.findUnique({ where: { id: guest.id } })).not.toBeNull();
  });
});