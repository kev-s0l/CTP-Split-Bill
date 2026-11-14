// Rendering checks for the presentational components (docs/specs/components.md).
// Pure props in, markup out — no database, no session, no DOM.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Card, CardContent, CardFooter, CardHeader } from "../app/components/ui/card";
import { BillCard } from "../app/components/BillCard";
import { Badge } from "../app/components/ui/badge";
import { toBillCardProps } from "../app/lib/format";
import { EmptyState } from "../app/components/EmptyState";
import { ErrorState } from "../app/components/ErrorState";
import { LoadingState } from "../app/components/LoadingState";
import { UserMenu } from "../app/components/UserMenu";
import RootError from "../app/error";

// The root error boundary reads the app router; there is none in a static render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const count = (html: string, needle: string) => html.split(needle).length - 1;

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

describe("LoadingState", () => {
  it("announces its label and draws exactly the requested skeleton rows", () => {
    const html = renderToStaticMarkup(h(LoadingState, { label: "Loading bills", rows: 4 }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading bills");
    expect(count(html, 'data-slot="skeleton"')).toBe(4);
  });

  it("defaults to three rows", () => {
    const html = renderToStaticMarkup(h(LoadingState, { label: "Loading" }));
    expect(count(html, 'data-slot="skeleton"')).toBe(3);
  });
});

describe("EmptyState", () => {
  it("puts actionId on the action, link or button, so focus can move to it", () => {
    const link = renderToStaticMarkup(h(EmptyState, { title: "t", message: "m", actionLabel: "Go", actionHref: "/x", actionId: "go" }));
    expect(link).toMatch(/<a[^>]*id="go"[^>]*>Go<\/a>/);
    const button = renderToStaticMarkup(h(EmptyState, { title: "t", message: "m", actionLabel: "Add", onAction: () => {}, actionId: "add" }));
    expect(button).toMatch(/<button[^>]*id="add"[^>]*>Add<\/button>/);
  });

  it("renders its copy and one primary action link", () => {
    const html = renderToStaticMarkup(
      h(EmptyState, {
        title: "No bills yet",
        message: "Scan a receipt to split it.",
        actionLabel: "Scan a receipt",
        actionHref: "/receipts/new",
      }),
    );
    expect(html).toContain("No bills yet");
    expect(html).toContain("Scan a receipt to split it.");
    expect(html).toMatch(/<a[^>]*href="\/receipts\/new"[^>]*>Scan a receipt<\/a>/);
    expect(html).not.toContain("<button");
  });

  it("renders a button instead of a link when given onAction", () => {
    const html = renderToStaticMarkup(
      h(EmptyState, {
        title: "No one's on this receipt yet",
        message: "Add the people splitting it.",
        actionLabel: "Add person",
        onAction: () => {},
      }),
    );
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Add person<\/button>/);
    expect(html).not.toContain("<a");
  });
});

describe("ErrorState", () => {
  it("renders an alert with its copy and a retry button", () => {
    const html = renderToStaticMarkup(
      h(ErrorState, { title: "Bills did not load", message: "Check your connection.", onRetry: () => {} }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Bills did not load");
    expect(html).toContain("Check your connection.");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
  });
});

describe("UserMenu", () => {
  it("renders a menu trigger showing the name", () => {
    const html = renderToStaticMarkup(h(UserMenu, { name: "Andrew Jiang", signOutAction: async () => {} }));
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>/);
    expect(html).toContain("Andrew Jiang");
    expect(html).toContain("min-h-11");
  });
});

describe("root error boundary", () => {
  it("shows generic copy and never the error's message", () => {
    const html = renderToStaticMarkup(
      h(RootError, { error: new Error("connect ECONNREFUSED 127.0.0.1:5433"), reset: () => {} }),
    );
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).not.toContain("ECONNREFUSED");
  });
});
