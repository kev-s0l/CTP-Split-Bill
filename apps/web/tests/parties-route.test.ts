// GET/POST /api/parties through the real route handler, against in-memory PGlite.
// Identity is mocked at the @project/auth seam, the same place real auth will plug in.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "alice" }));
vi.mock("@project/auth", () => ({ currentUserId: async () => identity.userId }));

const { GET, POST } = await import("../app/api/parties/route");

function post(body: string) {
  return POST(
    new Request("http://test/api/parties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
  );
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ],
  });
});

beforeEach(() => {
  identity.userId = "alice";
});

describe("POST /api/parties", () => {
  it("201 with the new party", async () => {
    const res = await post(JSON.stringify({ name: "Sushi night" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Sushi night", organizerId: "alice" });
  });

  it("400 in the shared error shape when the name is blank", async () => {
    const res = await post(JSON.stringify({ name: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "name: Name is required" },
    });
  });

  it("400 on malformed JSON", async () => {
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_INPUT", message: "Body must be valid JSON" },
    });
  });

  it("ignores a client-supplied organizerId", async () => {
    const res = await post(JSON.stringify({ name: "Sneaky", organizerId: "bob" }));

    expect((await res.json()).organizerId).toBe("alice");
  });

  it("401 when the identity has no user row", async () => {
    identity.userId = "ghost";
    const res = await post(JSON.stringify({ name: "Nope" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
});

describe("GET /api/parties", () => {
  it("200 with only the caller's parties", async () => {
    identity.userId = "bob";
    const bobs = await (await post(JSON.stringify({ name: "Bob's trip" }))).json();

    identity.userId = "alice";
    const forAlice: { id: string }[] = await (await GET()).json();
    expect(forAlice.map((p) => p.id)).not.toContain(bobs.id);

    identity.userId = "bob";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }[]).map((p) => p.id)).toEqual([bobs.id]);
  });

  it("500 with a generic message when something unexpected fails, never the raw error", async () => {
    const spy = vi.spyOn(prisma.party, "findMany").mockRejectedValueOnce(new Error("connection refused at 10.0.0.5"));

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
    spy.mockRestore();
  });
});
