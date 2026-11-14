// Link guard (docs/specs/receipts/edit-screen.md): which link clicks are held
// while a form has unsaved changes. Pure; no DOM.
import { describe, expect, it } from "vitest";
import { linkLeavesPage } from "../app/lib/link-guard";

const here = "http://localhost:3000/receipts/r1/items";
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, extra: Partial<{ target: string | null; download: boolean }> = {}) => ({
  href,
  target: null,
  download: false,
  ...extra,
});

describe("linkLeavesPage", () => {
  it("holds a plain click on a link to another page of the app", () => {
    expect(linkLeavesPage(link("/receipts/r1/participants"), plain, here)).toBe("/receipts/r1/participants");
    expect(linkLeavesPage(link("/receipts/r1/scan"), plain, here)).toBe("/receipts/r1/scan");
    expect(linkLeavesPage(link("/"), plain, here)).toBe("/");
    expect(linkLeavesPage(link("http://localhost:3000/?a=1#x"), plain, here)).toBe("/?a=1#x");
  });

  it("lets through clicks that don't leave the page in this tab", () => {
    expect(linkLeavesPage(link("#totals-heading"), plain, here)).toBeNull();
    expect(linkLeavesPage(link("/receipts/r1/items"), plain, here)).toBeNull();
    expect(linkLeavesPage(link("/receipts/r1/participants", { target: "_blank" }), plain, here)).toBeNull();
    expect(linkLeavesPage(link("/file.csv", { download: true }), plain, here)).toBeNull();
    for (const mod of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(linkLeavesPage(link("/receipts/r1/scan"), { ...plain, [mod]: true }, here)).toBeNull();
    }
    expect(linkLeavesPage(link("/receipts/r1/scan"), { ...plain, button: 1 }, here)).toBeNull();
  });

  it("leaves other sites to the browser's own prompt", () => {
    expect(linkLeavesPage(link("https://example.com/"), plain, here)).toBeNull();
  });

  it("treats target=_self as this tab", () => {
    expect(linkLeavesPage(link("/receipts/r1/scan", { target: "_self" }), plain, here)).toBe("/receipts/r1/scan");
  });
});
