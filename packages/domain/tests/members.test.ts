// tests that check blocked actions check the database afterwards to confirm no changes

// check members domain against a PGlite database locally — docs/specs/parties/members.md.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@project/db";
import { AddMember, addMember, createParty, removeMember } from "../src";

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: "alice", name: "Alice", email: "alice@example.com" },
      { id: "bob", name: "Bob", email: "bob@example.com" },
      { id: "carol", name: "Carol", email: "carol@example.com" },
    ],
  });
});

// Alice organizes; Bob is a member.
async function alicesParty() {
  const party = await createParty("alice", { name: "Alice's dinner" });
  await prisma.partyMember.create({ data: { partyId: party.id, userId: "bob", displayName: "Bob" } });
  return party;
}

async function receiptFor(partyId: string, paidByMemberId?: string) {
  return prisma.receipt.create({
    data: {
      partyId,
      uploadedById: "alice",
      paidByMemberId,
      imageBlobName: "test/receipt.jpg",
      imageContentType: "image/jpeg",
      items: { create: [{ lineNumber: 1, name: "Ramen", unitPrice: "12.00", totalPrice: "12.00" }] },
    },
    include: { items: true },
  });
}

describe("AddMember", () => {
  it("trims the display name and allows no userId (guest)", () => {
    expect(AddMember.parse({ displayName: "  Sam  " })).toEqual({ displayName: "Sam" });
  });

  it.each([
    ["missing", {}],
    ["blank after trim", { displayName: "   " }],
    ["over 50 characters", { displayName: "x".repeat(51) }],
    ["not a string", { displayName: 7 }],
  ])("rejects a display name that is %s", (_label, body) => {
    expect(AddMember.safeParse(body).success).toBe(false);
  });

  it("drops fields the client should not control", () => {
    expect(AddMember.parse({ displayName: "Sam", partyId: "x", joinedAt: "2020-01-01" })).toEqual({
      displayName: "Sam",
    });
  });
});

describe("addMember", () => {
  it("adds a guest with no user", async () => {
    const party = await createParty("alice", { name: "Guests" });
    const member = await addMember("alice", party.id, { displayName: "Sam" });

    expect(member).toMatchObject({ partyId: party.id, userId: null, displayName: "Sam" });
  });

  it("allows two guests with the same name", async () => {
    const party = await createParty("alice", { name: "Twins" });
    await addMember("alice", party.id, { displayName: "Sam" });
    await addMember("alice", party.id, { displayName: "Sam" });

    expect(await prisma.partyMember.count({ where: { partyId: party.id, userId: null } })).toBe(2);
  });

  it("adds an existing user, who then sees the party", async () => {
    const party = await createParty("alice", { name: "With Carol" });
    const member = await addMember("alice", party.id, { displayName: "Carol", userId: "carol" });

    expect(member.userId).toBe("carol");
  });

  it("409 when the same user is added twice", async () => {
    const party = await alicesParty();
    await expect(addMember("alice", party.id, { displayName: "Bob again", userId: "bob" })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });

  it("400 for an unknown userId, writing nothing", async () => {
    const party = await createParty("alice", { name: "Ghosts" });
    await expect(addMember("alice", party.id, { displayName: "X", userId: "nobody" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
      message: "userId: Unknown user",
    });
    expect(await prisma.partyMember.count({ where: { partyId: party.id } })).toBe(1);
  });

  it("404 for a non-member, writing nothing", async () => {
    const party = await createParty("alice", { name: "Private" });
    await expect(addMember("carol", party.id, { displayName: "Sneak" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(await prisma.partyMember.count({ where: { partyId: party.id } })).toBe(1);
  });

  it("403 for a member who is not the organizer", async () => {
    const party = await alicesParty();
    await expect(addMember("bob", party.id, { displayName: "Bob's friend" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("404 for a soft-deleted party", async () => {
    const party = await createParty("alice", { name: "Gone" });
    await prisma.party.update({ where: { id: party.id }, data: { deletedAt: new Date() } });

    await expect(addMember("alice", party.id, { displayName: "Sam" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("removeMember", () => {
  it("deletes the member and their item shares together", async () => {
    const party = await createParty("alice", { name: "Shares" });
    const guest = await addMember("alice", party.id, { displayName: "Sam" });
    const receipt = await receiptFor(party.id);
    await prisma.itemShare.create({ data: { itemId: receipt.items[0]!.id, memberId: guest.id } });

    await removeMember("alice", party.id, guest.id);

    expect(await prisma.partyMember.findUnique({ where: { id: guest.id } })).toBeNull();
    expect(await prisma.itemShare.count({ where: { memberId: guest.id } })).toBe(0);
  });

  it("409 when removing the organizer", async () => {
    const party = await createParty("alice", { name: "Mine" });
    const me = await prisma.partyMember.findFirstOrThrow({ where: { partyId: party.id, userId: "alice" } });

    await expect(removeMember("alice", party.id, me.id)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("409 when the member has a bill, and the member stays", async () => {
    const party = await createParty("alice", { name: "Billed" });
    const guest = await addMember("alice", party.id, { displayName: "Sam" });
    const receipt = await receiptFor(party.id);
    await prisma.bill.create({
      data: { receiptId: receipt.id, memberId: guest.id, subtotal: "12.00", taxShare: "0", tipShare: "0", amountOwed: "12.00" },
    });

    await expect(removeMember("alice", party.id, guest.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.partyMember.findUnique({ where: { id: guest.id } })).not.toBeNull();
  });

  it("409 when the member paid a receipt", async () => {
    const party = await createParty("alice", { name: "Payer" });
    const guest = await addMember("alice", party.id, { displayName: "Sam" });
    await receiptFor(party.id, guest.id);

    await expect(removeMember("alice", party.id, guest.id)).rejects.toMatchObject({ status: 409 });
  });

  it("404 for a member id from another party", async () => {
    const mine = await createParty("alice", { name: "Mine too" });
    const other = await createParty("alice", { name: "Other" });
    const guest = await addMember("alice", other.id, { displayName: "Sam" });

    await expect(removeMember("alice", mine.id, guest.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.partyMember.findUnique({ where: { id: guest.id } })).not.toBeNull();
  });

  it("404 for a non-member and 403 for a non-organizer member", async () => {
    const party = await alicesParty();
    const guest = await addMember("alice", party.id, { displayName: "Sam" });

    await expect(removeMember("carol", party.id, guest.id)).rejects.toMatchObject({ status: 404 });
    await expect(removeMember("bob", party.id, guest.id)).rejects.toMatchObject({ status: 403 });
    expect(await prisma.partyMember.findUnique({ where: { id: guest.id } })).not.toBeNull();
  });
});