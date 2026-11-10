// Rendering checks for the presentational components (docs/specs/components.md).
// Pure props in, markup out — no database, no session, no DOM.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card, CardContent, CardFooter, CardHeader } from "../app/components/ui/card";
import { BillCard } from "../app/components/BillCard";

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
      h(BillCard, { restaurant: "Noodle Bar", paidTo: "Sam", partyCount: 3, total: "$12.50", date: "Nov 2, 2026" }),
    );
    for (const text of ["Noodle Bar", "Sam", ">3<", "$12.50", "Date Created: Nov 2, 2026"]) {
      expect(html).toContain(text);
    }
  });
});
