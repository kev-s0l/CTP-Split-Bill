// Finalize screen (docs/specs/receipts/finalize-screen.md): the display model
// and static renders of its states. No DOM, no database.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// The panel uses the app router; static renders have none.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { FinalizePanel, type FinalizePanelProps } from "../app/receipts/[id]/finalize/FinalizePanel";
import { SummaryTable } from "../app/receipts/[id]/finalize/SummaryTable";
import {
  type Allocation,
  type SummaryParticipant,
  buildSummary,
  confirmationText,
  mismatchMessages,
  readinessLabel,
} from "../app/receipts/[id]/finalize/summary";

const people: SummaryParticipant[] = [
  { id: "me", displayName: "Alex", hasPickLink: false, picksSubmittedAt: null },
  { id: "maya", displayName: "Maya", hasPickLink: true, picksSubmittedAt: "2026-11-13T00:00:00.000Z" },
  { id: "sam", displayName: "Sam", hasPickLink: true, picksSubmittedAt: null },
  { id: "jo", displayName: "Jo", hasPickLink: false, picksSubmittedAt: null },
];

const allocation = (participantId: string, subtotal: string, taxShare: string, tipShare: string, amountOwed: string): Allocation =>
  ({ participantId, subtotal, taxShare, tipShare, amountOwed });

const even = [
  allocation("me", "3.34", "0.00", "0.00", "3.34"),
  allocation("maya", "3.33", "0.00", "0.00", "3.33"),
  allocation("sam", "3.33", "0.00", "0.00", "3.33"),
];

describe("readiness", () => {
  it("labels each guest from the receipt detail, and the organizer as You", () => {
    const label = (id: string) => readinessLabel(people.find((p) => p.id === id)!, "ITEMIZED", "me");
    expect(["me", "maya", "sam", "jo"].map(label)).toEqual(["You", "Done picking", "Still picking", "No link"]);
  });

  it("shows no readiness under EVEN, only the organizer's You", () => {
    expect(readinessLabel(people[1], "EVEN", "me")).toBeNull();
    expect(readinessLabel(people[0], "EVEN", "me")).toBe("You");
  });
});

describe("buildSummary", () => {
  it("keeps the allocations' order, formats amounts and sums every column exactly", () => {
    const summary = buildSummary(
      [allocation("maya", "20.00", "1.80", "4.00", "25.80"), allocation("sam", "10.00", "0.90", "2.00", "12.90")],
      people, "USD", { splitMode: "ITEMIZED", organizerParticipantId: "me" },
    );
    expect(summary.rows.map((r) => [r.name, r.subtotal, r.tax, r.tip, r.owes, r.readiness])).toEqual([
      ["Maya", "$20.00", "$1.80", "$4.00", "$25.80", "Done picking"],
      ["Sam", "$10.00", "$0.90", "$2.00", "$12.90", "Still picking"],
    ]);
    expect(summary.totals).toEqual({ subtotal: "$30.00", tax: "$2.70", tip: "$6.00", owes: "$38.70" });
  });

  it("sums cents without float drift", () => {
    expect(buildSummary(even, people, "USD", null).totals.owes).toBe("$10.00");
  });

  it("drops readiness for a finalized receipt", () => {
    expect(buildSummary(even, people, "USD", null).rows.every((r) => r.readiness === null)).toBe(true);
  });
});

describe("mismatch sentences", () => {
  const check = (itemsDifference: string | null, amountsDifference: string | null) =>
    mismatchMessages({ itemsDifference, amountsDifference, reconciled: false }, "USD");

  it("says short or over from the signed differences", () => {
    expect(check("2.50", "0.00")).toEqual(["The items are $2.50 short of the subtotal."]);
    expect(check("-2.50", "0.00")).toEqual(["The items are $2.50 over the subtotal."]);
    expect(check("0.00", "1.00")).toEqual(["Subtotal, tax and tip are $1.00 short of the total."]);
    expect(check("0.00", "-1.00")).toEqual(["Subtotal, tax and tip are $1.00 over the total."]);
  });

  it("says amounts are missing when a difference is null", () => {
    expect(check(null, "0.00")).toEqual(["Some item prices or amounts are missing."]);
    expect(check(null, null)).toEqual(["Some item prices or amounts are missing."]);
  });
});

describe("confirmation text", () => {
  it("counts the bills and names the total", () => {
    expect(confirmationText(3, "$10.00")).toBe("This creates 3 bills totaling $10.00. The receipt can't be edited after this.");
    expect(confirmationText(1, "$5.00")).toMatch(/^This creates 1 bill totaling/);
  });
});

describe("static renders", () => {
  it("renders the table with badges and the Total row", () => {
    const html = renderToStaticMarkup(h(SummaryTable, {
      summary: buildSummary(even, people, "USD", { splitMode: "ITEMIZED", organizerParticipantId: "me" }),
    }));
    expect(html).toContain("Who owes what");
    expect(html).toContain("Done picking");
    expect(html).toContain("Still picking");
    expect(html).toContain("Total");
    expect(html).toContain("$10.00");
    expect(html).toContain("Items $3.34 · Tax $0.00 · Tip $0.00");
  });

  const panel = (overrides: Partial<FinalizePanelProps> = {}) => renderToStaticMarkup(h(FinalizePanel, {
    receiptId: "r1", revision: 4, pickingOpen: false, disabledReason: null, billCount: 3, total: "$10.00", ...overrides,
  }));

  it("labels the button by picking mode", () => {
    expect(panel()).toMatch(/<button[^>]*>Finalize<\/button>/);
    expect(panel({ pickingOpen: true })).toContain("Pause picking and finalize");
  });

  it("disables the button and says why when the receipt doesn't add up", () => {
    const html = panel({ disabledReason: "Fix the totals first" });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Finalize<\/button>/);
    expect(html).toContain("Fix the totals first");
    expect(panel()).not.toMatch(/<button[^>]*disabled=""[^>]*>Finalize<\/button>/);
  });
});
