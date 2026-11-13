// Receipt step gating and the step bar (docs/specs/receipts/flow.md, "Gating"
// and "Step bar"): the guard's redirect for each locked step, the
// /receipts/[id] redirect, access, and static renders of the bar. Auth,
// domain reads and navigation are mocked; no database.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getReceipt: vi.fn(),
  pathname: "/receipts/r1/participants",
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("@project/auth", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  usePathname: () => mocks.pathname,
}));
vi.mock("@project/domain", async (importOriginal) => ({
  ...await importOriginal<typeof import("@project/domain")>(),
  getReceipt: mocks.getReceipt,
}));

const { ApiError } = await import("@project/domain");
const { receiptSteps } = await import("@project/domain/steps");
const { loadStep } = await import("../app/receipts/[id]/step-guard");
const { default: ReceiptPage } = await import("../app/receipts/[id]/page");
const { StepBar } = await import("../app/receipts/[id]/StepBar");

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    status: "DRAFT",
    parseStatus: "SUCCEEDED",
    splitMode: "ITEMIZED",
    reviewedAt: new Date(),
    organizerParticipantId: "org",
    participants: [{ id: "org" }, { id: "maya" }],
    items: [{ assignedParticipantId: null, sharedAllocations: [] }],
    ...overrides,
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.currentUserId.mockReset().mockResolvedValue("u1");
  mocks.getReceipt.mockReset();
  mocks.redirect.mockClear();
});

describe("step guard", () => {
  it("redirects each locked step to the furthest available one", async () => {
    // Scan in progress: everything after Scan goes to Scan.
    mocks.getReceipt.mockResolvedValue(detail({ parseStatus: "PARSING", reviewedAt: null }));
    for (const step of ["items", "participants", "picks", "finalize"] as const) {
      await expect(loadStep("r1", step)).rejects.toThrow("REDIRECT /receipts/r1/scan");
    }
    // Not reviewed: People, Picks and Finalize go to Items.
    mocks.getReceipt.mockResolvedValue(detail({ reviewedAt: null }));
    for (const step of ["participants", "picks", "finalize"] as const) {
      await expect(loadStep("r1", step)).rejects.toThrow("REDIRECT /receipts/r1/items");
    }
    // Only the organizer: Picks and Finalize go to People.
    mocks.getReceipt.mockResolvedValue(detail({ participants: [{ id: "org" }] }));
    await expect(loadStep("r1", "picks")).rejects.toThrow("REDIRECT /receipts/r1/participants");
    await expect(loadStep("r1", "finalize")).rejects.toThrow("REDIRECT /receipts/r1/participants");
    // An item unassigned: Finalize goes to Picks.
    mocks.getReceipt.mockResolvedValue(detail());
    await expect(loadStep("r1", "finalize")).rejects.toThrow("REDIRECT /receipts/r1/picks");
  });

  it("lets an available step render, including going back", async () => {
    mocks.getReceipt.mockResolvedValue(detail());
    for (const step of ["scan", "items", "participants", "picks"] as const) {
      await expect(loadStep("r1", step)).resolves.toMatchObject({ id: "r1" });
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a missing session to /login, back to the step", async () => {
    mocks.currentUserId.mockResolvedValue(null);
    await expect(loadStep("r1", "items")).rejects.toThrow("REDIRECT /login?callbackUrl=%2Freceipts%2Fr1%2Fitems");
  });

  it("renders not found for a foreign or unknown receipt", async () => {
    mocks.getReceipt.mockRejectedValue(new ApiError("NOT_FOUND", "Receipt not found", 404));
    await expect(loadStep("r1", "scan")).rejects.toThrow("NOT_FOUND");
  });
});

describe("/receipts/[id]", () => {
  it("redirects to the first step still to do", async () => {
    mocks.getReceipt.mockResolvedValue(detail({ reviewedAt: null }));
    await expect(ReceiptPage(params("r1"))).rejects.toThrow("REDIRECT /receipts/r1/items");
    mocks.getReceipt.mockResolvedValue(detail({ parseStatus: "FAILED", reviewedAt: null }));
    await expect(ReceiptPage(params("r1"))).rejects.toThrow("REDIRECT /receipts/r1/scan");
  });

  it("redirects to Finalize when every step before it is done", async () => {
    mocks.getReceipt.mockResolvedValue(detail({ items: [{ assignedParticipantId: "maya", sharedAllocations: [] }] }));
    await expect(ReceiptPage(params("r1"))).rejects.toThrow("REDIRECT /receipts/r1/finalize");
  });
});

describe("step bar", () => {
  function render(overrides: Record<string, unknown>, pathname: string) {
    mocks.pathname = pathname;
    return renderToStaticMarkup(h(StepBar, { receiptId: "r1", steps: receiptSteps(detail(overrides) as never) }));
  }

  it("names the shown step for phones and marks it current", () => {
    const html = render({ participants: [{ id: "org" }] }, "/receipts/r1/participants");
    expect(html).toContain("Step 3 of 5 · People");
    expect(html).toMatch(/<a aria-current="step"[^>]*href="\/receipts\/r1\/participants"/);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it("disables Next with the reason when the next step is locked", () => {
    const html = render({ participants: [{ id: "org" }] }, "/receipts/r1/participants");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="step-next-reason"[^>]*>Next<\/button>/);
    expect(html).toContain("Add someone besides you");
    expect(html).toMatch(/<a[^>]*href="\/receipts\/r1\/items"[^>]*>Back<\/a>/);
  });

  it("links Next when the next step is available", () => {
    const html = render({}, "/receipts/r1/participants");
    expect(html).toMatch(/<a[^>]*href="\/receipts\/r1\/picks"[^>]*>Next<\/a>/);
    expect(html).not.toContain("step-next-reason");
  });

  it("never links a locked step", () => {
    const html = render({ parseStatus: "PARSING", reviewedAt: null }, "/receipts/r1/scan");
    for (const key of ["items", "participants", "picks", "finalize"]) {
      expect(html).not.toContain(`href="/receipts/r1/${key}"`);
    }
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
    expect(html).toContain("Wait for the scan to finish");
  });
});
