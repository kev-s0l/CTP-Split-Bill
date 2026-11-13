// Receipt step model (docs/specs/receipts/flow.md, "Steps"): every row of the
// step table, each split mode's coverage rule, and invalidation after the
// items are replaced. Pure; no database.
import { describe, expect, it } from "vitest";
import {
  type StepReceipt,
  furthestAvailableStep,
  landingStep,
  receiptSteps,
} from "@project/domain/steps";

const ORG = "org";
const item = (assignedParticipantId: string | null = null, shared: string[] = []) => ({
  assignedParticipantId,
  sharedAllocations: shared.map((participantId) => ({ participantId })),
});

function receipt(overrides: Partial<StepReceipt> = {}): StepReceipt {
  return {
    status: "DRAFT",
    parseStatus: "SUCCEEDED",
    splitMode: "EVEN",
    reviewedAt: new Date("2026-11-01T00:00:00Z"),
    organizerParticipantId: ORG,
    participants: [{ id: ORG }, { id: "maya" }],
    items: [item(), item()],
    ...overrides,
  };
}

function states(r: StepReceipt) {
  return Object.fromEntries(receiptSteps(r).map((s) => [s.key, s.state]));
}

describe("step table", () => {
  it("scan in progress: only Scan is available", () => {
    for (const parseStatus of ["NOT_STARTED", "PARSING"]) {
      expect(states(receipt({ parseStatus, reviewedAt: null }))).toEqual({
        scan: "current", items: "locked", participants: "locked", picks: "locked", finalize: "locked",
      });
    }
  });

  it("scan succeeded, not reviewed: Scan done, Items current", () => {
    expect(states(receipt({ reviewedAt: null }))).toEqual({
      scan: "done", items: "current", participants: "locked", picks: "locked", finalize: "locked",
    });
  });

  it("scan failed, not reviewed: Scan stays current and Items opens for entering by hand", () => {
    expect(states(receipt({ parseStatus: "FAILED", reviewedAt: null }))).toEqual({
      scan: "current", items: "current", participants: "locked", picks: "locked", finalize: "locked",
    });
  });

  it("scan failed, items reviewed: Scan and Items done", () => {
    const s = states(receipt({ parseStatus: "FAILED", participants: [{ id: ORG }] }));
    expect(s.scan).toBe("done");
    expect(s.items).toBe("done");
  });

  it("reviewed with only the organizer: People current, Picks locked with a reason", () => {
    const steps = receiptSteps(receipt({ participants: [{ id: ORG }] }));
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "locked", "locked"]);
    expect(steps[3].lockedReason).toBe("Add someone besides you");
  });

  it("a receipt with no organizer row counts every participant", () => {
    expect(states(receipt({ organizerParticipantId: null, participants: [{ id: "maya" }] })).participants).toBe("done");
  });

  it("gives each locked step its reason", () => {
    expect(receiptSteps(receipt({ parseStatus: "PARSING", reviewedAt: null })).map((s) => s.lockedReason)).toEqual([
      null, "Wait for the scan to finish", "Review the items first", "Add someone besides you", "Assign every item",
    ]);
  });

  it("finalized: every step is done", () => {
    expect(Object.values(states(receipt({ status: "FINALIZED", splitMode: "ITEMIZED" })))).toEqual(
      ["done", "done", "done", "done", "done"],
    );
  });
});

describe("picks coverage by split mode", () => {
  it("EVEN needs no assignments", () => {
    const s = states(receipt());
    expect(s.picks).toBe("done");
    expect(s.finalize).toBe("current");
  });

  it("ITEMIZED needs an assignee on every item", () => {
    expect(states(receipt({ splitMode: "ITEMIZED", items: [item("maya"), item()] })).picks).toBe("current");
    expect(states(receipt({ splitMode: "ITEMIZED", items: [item("maya"), item("maya")] })).picks).toBe("done");
  });

  it("SHARED_ITEMS needs an assignee or at least two sharers per item", () => {
    const mode = { splitMode: "SHARED_ITEMS" };
    expect(states(receipt({ ...mode, items: [item("maya"), item(null, ["maya"])] })).picks).toBe("current");
    expect(states(receipt({ ...mode, items: [item("maya"), item(null, ["maya", ORG])] })).picks).toBe("done");
  });

  it("an unknown split mode never counts as covered", () => {
    expect(states(receipt({ splitMode: "OTHER" })).picks).toBe("current");
  });
});

describe("invalidation", () => {
  it("replacing items (reviewedAt cleared) shows Items, Picks and Finalize as not done", () => {
    const before = states(receipt());
    expect([before.items, before.picks]).toEqual(["done", "done"]);
    expect(states(receipt({ reviewedAt: null }))).toEqual({
      scan: "done", items: "current", participants: "locked", picks: "locked", finalize: "locked",
    });
  });
});

describe("redirect targets", () => {
  it("a locked step goes to the furthest available one", () => {
    expect(furthestAvailableStep(receiptSteps(receipt({ parseStatus: "PARSING", reviewedAt: null })))).toBe("scan");
    expect(furthestAvailableStep(receiptSteps(receipt({ reviewedAt: null })))).toBe("items");
    expect(furthestAvailableStep(receiptSteps(receipt({ participants: [{ id: ORG }] })))).toBe("participants");
  });

  it("/receipts/[id] lands on the first step still to do, or Finalize", () => {
    expect(landingStep(receiptSteps(receipt({ parseStatus: "FAILED", reviewedAt: null })))).toBe("scan");
    expect(landingStep(receiptSteps(receipt({ reviewedAt: null })))).toBe("items");
    expect(landingStep(receiptSteps(receipt()))).toBe("finalize");
    expect(landingStep(receiptSteps(receipt({ status: "FINALIZED" })))).toBe("finalize");
  });
});
