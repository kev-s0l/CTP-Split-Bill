// Real profile handler and domain query against PGlite; session identity is mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@project/db";

const identity = vi.hoisted(() => ({ userId: "profile-owner", failure: null as Error | null }));
vi.mock("@project/auth", () => ({
  currentUserId: async () => {
    if (identity.failure) throw identity.failure;
    return identity.userId;
  },
}));

const { GET } = await import("../app/api/me/route");

const owner = {
  id: "profile-owner", name: "Organizer", email: "profile-owner@example.com",
  image: "https://example.com/avatar.png", phone: "+12125550123",
};
const other = {
  id: "profile-other", name: "Other organizer", email: "profile-other@example.com",
  image: null, phone: null,
};

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { ...owner, emailVerified: new Date("2026-01-01T00:00:00Z") },
    other,
  ] });
});

beforeEach(() => {
  vi.restoreAllMocks();
  identity.userId = owner.id;
  identity.failure = null;
});

describe("current organizer profile", () => {
  it("returns exactly the selected profile fields with a private cache policy", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(owner);
  });

  it("follows session identity changes and preserves nullable profile fields", async () => {
    identity.userId = other.id;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(other);

    identity.userId = owner.id;
    const nextResponse = await GET();
    expect(nextResponse.status).toBe(200);
    expect(await nextResponse.json()).toEqual(owner);
  });

  it("reads updated profile data on subsequent requests", async () => {
    const before = await GET();
    expect(await before.json()).toEqual(owner);
    try {
      await prisma.user.update({ where: { id: owner.id }, data: { name: "Updated organizer" } });
      const after = await GET();
      expect(after.status).toBe(200);
      expect(await after.json()).toEqual({ ...owner, name: "Updated organizer" });
    } finally {
      await prisma.user.update({ where: { id: owner.id }, data: { name: owner.name } });
    }
  });

  it("rejects a missing session before querying the database", async () => {
    identity.userId = "";
    const query = vi.spyOn(prisma.user, "findUnique");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Unknown user" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an identity without a local user", async () => {
    identity.userId = "profile-missing";
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Unknown user" },
    });
  });

  it("maps database failures to the generic error envelope", async () => {
    vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("private database connection details"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong" },
    });
  });

  it("maps authentication failures to the generic error envelope", async () => {
    identity.failure = new Error("private session token details");
    const query = vi.spyOn(prisma.user, "findUnique");
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong" },
    });
    expect(query).not.toHaveBeenCalled();
  });
});
