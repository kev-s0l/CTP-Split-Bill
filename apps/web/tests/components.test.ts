// Rendering checks for the presentational components (docs/specs/components.md).
// Pure props in, markup out — no database, no session, no DOM.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Card, CardContent, CardFooter, CardHeader } from "../app/components/ui/card";
import { BillCard } from "../app/components/BillCard";
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
      h(BillCard, { restaurant: "Noodle Bar", paidTo: "Sam", partyCount: 3, total: "$12.50", date: "Nov 2, 2026" }),
    );
    for (const text of ["Noodle Bar", "Sam", ">3<", "$12.50", "Date Created: Nov 2, 2026"]) {
      expect(html).toContain(text);
    }
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
