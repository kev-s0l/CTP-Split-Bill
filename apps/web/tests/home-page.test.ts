// Home page access (docs/specs/bills/list-screen.md): `/` is public, so a
// signed-out visitor gets the landing, never the error page. Auth and the
// summary read are mocked; no database.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string>>(),
  listReceiptSummaries: vi.fn(),
}));
vi.mock("@project/auth", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("@project/domain", () => ({ listReceiptSummaries: mocks.listReceiptSummaries }));

const { default: Home } = await import("../app/page");

beforeEach(() => {
  mocks.currentUserId.mockReset();
  mocks.listReceiptSummaries.mockReset();
});

describe("home page", () => {
  it("shows a signed-out visitor the landing with a sign-in link, without reading receipts", async () => {
    mocks.currentUserId.mockResolvedValue("");
    const html = renderToStaticMarkup((await Home()) as ReactElement);
    expect(html).toMatch(/<a[^>]*href="\/login"[^>]*>Sign in<\/a>/);
    expect(html).not.toContain("Your bills");
    expect(mocks.listReceiptSummaries).not.toHaveBeenCalled();
  });

  it("shows a signed-in organizer their bills list for their own id", async () => {
    mocks.currentUserId.mockResolvedValue("u1");
    const page = (await Home()) as ReactElement<{ children: ReactElement[] }>;
    const suspense = page.props.children[1] as ReactElement<{ children: ReactElement<{ userId: string }> }>;
    expect(suspense.props.children.props.userId).toBe("u1");
    const header = renderToStaticMarkup(page.props.children[0]);
    expect(header).toContain("Your bills");
    expect(header).toMatch(/<a[^>]*href="\/receipts\/new"[^>]*>New receipt<\/a>/);
  });
});
