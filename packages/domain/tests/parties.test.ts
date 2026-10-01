// Parties domain against an in-memory PGlite database — docs/specs/parties/.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@project/db";
import { ApiError, CreateParty, createParty, listParties } from "../src";

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
    ],
  });
});

describe("CreateParty", () => {
  it("trims the name", () => {
    expect(CreateParty.parse({ name: "  Tacos  " })).toEqual({ name: "Tacos" });
  });

  it.each([
    ["missing", {}],
    ["blank after trim", { name: "   " }],
    ["over 100 characters", { name: "x".repeat(101) }],
    ["not a string", { name: 42 }],
  ])("rejects a name that is %s", (_label, body) => {
    expect(CreateParty.safeParse(body).success).toBe(false);
  });

  it("drops fields the client should not control", () => {
    expect(CreateParty.parse({ name: "Tacos", organizerId: "bob" })).toEqual({ name: "Tacos" });
  });
});

describe("createParty", () => {
  it("makes the caller the organizer and first member, in one write", async () => {
    const party = await createParty("alice", { name: "Alice's dinner" });

    expect(party.organizerId).toBe("alice");
    const members = await prisma.partyMember.findMany({ where: { partyId: party.id } });
    expect(members).toEqual([expect.objectContaining({ userId: "alice", displayName: "Alice" })]);
  });

  it("rejects an identity with no user row as 401 and writes nothing", async () => {
    const before = await prisma.party.count();
    await expect(createParty("ghost", { name: "Nope" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    } satisfies Partial<ApiError>);
    expect(await prisma.party.count()).toBe(before);
  });
});

describe("listParties", () => {
  it("returns only parties the caller is a member of", async () => {
    const bobs = await createParty("bob", { name: "Bob's trip" });

    const forAlice = await listParties("alice");
    expect(forAlice.map((p) => p.id)).not.toContain(bobs.id);
    expect((await listParties("bob")).map((p) => p.id)).toEqual([bobs.id]);
  });

  it("includes parties where the caller is a non-organizer member", async () => {
    const bobs = await createParty("bob", { name: "Bob's game night" });
    await prisma.partyMember.create({ data: { partyId: bobs.id, userId: "alice", displayName: "Alice" } });

    expect((await listParties("alice")).map((p) => p.id)).toContain(bobs.id);
  });

  it("excludes soft-deleted parties", async () => {
    const party = await createParty("alice", { name: "Cancelled" });
    await prisma.party.update({ where: { id: party.id }, data: { deletedAt: new Date() } });

    expect((await listParties("alice")).map((p) => p.id)).not.toContain(party.id);
  });

  it("never exposes the share token", async () => {
    const party = await createParty("alice", { name: "Shared" });
    await prisma.party.update({ where: { id: party.id }, data: { shareToken: "secret-token" } });

    const listed = (await listParties("alice")).find((p) => p.id === party.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty("shareToken");
  });
});
