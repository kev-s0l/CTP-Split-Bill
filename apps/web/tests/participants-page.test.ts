// Participants page access (docs/specs/receipts/participants-screen.md,
// "Loading and access"): a session that ends after the middleware check is
// sent to /login and returned to this page. Auth, domain and navigation are
// mocked; no database.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getReceipt: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("@project/auth", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@project/domain", async (importOriginal) => ({
  ...await importOriginal<typeof import("@project/domain")>(),
  getReceipt: mocks.getReceipt,
}));

const { ApiError } = await import("@project/domain");
const { default: ParticipantsPage } = await import("../app/receipts/[id]/participants/page");

// The page renders <Suspense><Roster receiptId /></Suspense>; run Roster directly.
async function runRoster(id: string) {
  const page = (await ParticipantsPage({ params: Promise.resolve({ id }) })) as ReactElement<{ children: ReactElement[] }>;
  const suspense = page.props.children[1] as ReactElement<{ children: ReactElement<{ receiptId: string }> }>;
  const roster = suspense.props.children;
  return (roster.type as (props: { receiptId: string }) => Promise<unknown>)(roster.props);
}

beforeEach(() => {
  mocks.currentUserId.mockReset();
  mocks.getReceipt.mockReset();
});

describe("participants page access", () => {
  it("sends a missing session to /login with this page as the callback", async () => {
    mocks.currentUserId.mockResolvedValue(null);
    await expect(runRoster("r1")).rejects.toThrow("REDIRECT /login?callbackUrl=%2Freceipts%2Fr1%2Fparticipants");
    expect(mocks.getReceipt).not.toHaveBeenCalled();
  });

  it("sends a 401 from the receipt read to /login with this page as the callback", async () => {
    mocks.currentUserId.mockResolvedValue("u1");
    mocks.getReceipt.mockRejectedValue(new ApiError("UNAUTHENTICATED", "Unknown user", 401));
    await expect(runRoster("r1")).rejects.toThrow("REDIRECT /login?callbackUrl=%2Freceipts%2Fr1%2Fparticipants");
  });

  it("renders not found for a foreign or unknown receipt", async () => {
    mocks.currentUserId.mockResolvedValue("u1");
    mocks.getReceipt.mockRejectedValue(new ApiError("NOT_FOUND", "Receipt not found", 404));
    await expect(runRoster("r1")).rejects.toThrow("NOT_FOUND");
  });
});
