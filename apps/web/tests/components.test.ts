// Rendering checks for the presentational components (docs/specs/components.md).
// Pure props in, markup out — no database, no session, no DOM.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card, CardContent, CardFooter, CardHeader } from "../app/components/ui/card";
import { BillCard } from "../app/components/BillCard";
import { Badge } from "../app/components/ui/badge";
import { toBillCardProps } from "../app/lib/format";

describe("Card", () => {
  it("renders its slots' children in the order given", () => {
    const html = renderToStaticMarkup(
      h(Card, null, h(CardHeader, null, "head"), h(CardContent, null, "body"), h(CardFooter, null, "foot")),
    );
    expect(html.indexOf("head")).toBeGreaterThan(-1);
    expect(html.indexOf("head")).toBeLessThan(html.indexOf("body"));
    expect(html.indexOf("body")).toBeLessThan(html.indexOf("foot"));
  });

  it("styles only through the design tokens", () => {
    const html = renderToStaticMarkup(h(Card, null, h(CardContent, null, "x")));
    expect(html).toContain("bg-card");
    expect(html).toContain("text-card-foreground");
    expect(html).not.toMatch(/class=""/);
  });
});

describe("BillCard", () => {
  it("renders the display strings it is given, untouched", () => {
    const html = renderToStaticMarkup(
      h(BillCard, { restaurant: "Noodle Bar", paidTo: "Sam", partyCount: 3, total: "$12.50", date: "Nov 2, 2026", status: h(Badge, { variant: "destructive", children: "Unpaid" }) }),
    );
    for (const text of ["Noodle Bar", "Sam", ">3<", "$12.50", "Date Created: Nov 2, 2026", "Unpaid"]) {
      expect(html).toContain(text);
    }
  });

  it("maps raw summary values to formatted BillCard props", () => {
    const props = toBillCardProps({
      id: "receipt-1", status: "FINALIZED", merchantName: "Noodle Bar", title: null,
      total: "12.50", createdAt: "2026-11-02T23:30:00.000Z", payerName: "Sam",
      participantCount: 3, settled: false,
    });
    const html = renderToStaticMarkup(h(BillCard, props));
    expect(props.total).toBe("$12.50");
    expect(props.date).toBe("Nov 2, 2026");
    expect(html).toContain("$12.50");
    expect(html).toContain("Date Created: Nov 2, 2026");
    expect(html).toContain("Unpaid");
  });

  it.each([
    { status: "FINALIZED", settled: true, badge: "Paid" },
    { status: "DRAFT", settled: null, badge: "Draft" },
  ])("maps $status / $settled to the $badge badge", ({ status, settled, badge }) => {
    const props = toBillCardProps({
      id: "receipt-status", status, merchantName: null, title: "Dinner",
      total: "10.00", createdAt: "2026-11-02T00:00:00.000Z", payerName: null,
      participantCount: 2, settled,
    });
    expect(renderToStaticMarkup(h(BillCard, props))).toContain(badge);
  });

  it("does not mislabel finalized receipts with null settlement as unpaid", () => {
    const props = toBillCardProps({
      id: "receipt-no-settlement", status: "FINALIZED", merchantName: null,
      title: "No bills", total: "1.00", createdAt: "2026-11-02T00:00:00.000Z",
      payerName: null, participantCount: 0, settled: null,
    });
    const html = renderToStaticMarkup(h(BillCard, props));
    expect(props.status).toBeUndefined();
    expect(html).not.toContain('data-slot="badge"');
  });
});
