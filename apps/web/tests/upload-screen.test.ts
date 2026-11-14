// Upload and Scan screens (docs/specs/receipts/upload-screen.md): the upload
// form's state and checks, shrink sizing, what each API response means, and
// static renders of each state. No DOM, no database.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));

const { MAX_UPLOAD_BYTES, fitWithin, needsShrink, shrinkPhoto } = await import("../app/receipts/new/shrink-photo");
const { MESSAGES, initialUploadState, uploadOutcome, uploadReducer } = await import("../app/receipts/new/upload");
const { UploadForm } = await import("../app/receipts/new/UploadForm");
const { ABANDONED_MS, parseOutcome, toScanReceipt, viewFor } = await import("../app/receipts/[id]/scan/scan-state");
const { ScanPanel } = await import("../app/receipts/[id]/scan/ScanPanel");

const photo = (type = "image/jpeg", name = "r.jpg") => new File([new Uint8Array([1, 2, 3])], name, { type });

describe("upload form state", () => {
  it("choosing a photo shows the preview and sends nothing", () => {
    const file = photo();
    expect(uploadReducer(initialUploadState, { type: "chose", file })).toEqual({ phase: "preview", file, error: null });
  });

  it("rejects anything but JPEG, PNG or WebP with the inline message", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(uploadReducer(initialUploadState, { type: "chose", file: photo(type) }).phase).toBe("preview");
    }
    for (const type of ["application/pdf", "image/heic", ""]) {
      expect(uploadReducer(initialUploadState, { type: "chose", file: photo(type) })).toEqual({
        phase: "choose",
        error: MESSAGES.wrongType,
      });
    }
  });

  it("goes preview → preparing → uploading, and a failure keeps the photo for a retry", () => {
    const file = photo();
    let s = uploadReducer(initialUploadState, { type: "chose", file });
    s = uploadReducer(s, { type: "preparing" });
    expect(s.phase).toBe("preparing");
    s = uploadReducer(s, { type: "uploading" });
    expect(s.phase).toBe("uploading");
    s = uploadReducer(s, { type: "failed", error: MESSAGES.storage });
    expect(s).toEqual({ phase: "preview", file, error: MESSAGES.storage });
  });

  it("Choose a different photo goes back to the two buttons", () => {
    const s = uploadReducer(initialUploadState, { type: "chose", file: photo() });
    expect(uploadReducer(s, { type: "chooseAgain" })).toEqual(initialUploadState);
  });
});

describe("shrinking", () => {
  it("only shrinks photos over 5 MiB", () => {
    expect(needsShrink(MAX_UPLOAD_BYTES)).toBe(false);
    expect(needsShrink(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });

  it("fits the longest side to 2400 px, keeping the aspect ratio, and never enlarges", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2400, height: 1800 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1800, height: 2400 });
    expect(fitWithin(8000, 1000)).toEqual({ width: 2400, height: 300 });
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it("returns a photo that already fits unchanged, without touching a canvas", async () => {
    const file = photo();
    expect(await shrinkPhoto(file)).toBe(file);
  });
});

describe("upload responses", () => {
  it("201 goes to the scan step", () => {
    expect(uploadOutcome(201, { id: "r1" })).toEqual({ kind: "scan", receiptId: "r1" });
  });

  it("400 shows the API's message; 503 the storage message; 401 sign-in; others generic", () => {
    expect(uploadOutcome(400, { error: { code: "INVALID_INPUT", message: "File is empty" } })).toEqual({
      kind: "error",
      message: "File is empty",
    });
    expect(uploadOutcome(503, { error: { message: "Image storage is unavailable; try again later" } })).toEqual({
      kind: "error",
      message: MESSAGES.storage,
    });
    expect(uploadOutcome(401, null)).toEqual({ kind: "login" });
    expect(uploadOutcome(500, null)).toEqual({ kind: "error", message: MESSAGES.generic });
    expect(uploadOutcome(201, null)).toEqual({ kind: "error", message: MESSAGES.generic });
  });
});

describe("scan state", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("maps each parse status to what the screen shows", () => {
    expect(viewFor({ parseStatus: "NOT_STARTED", updatedAt: at(0), itemCount: 0 }, now)).toEqual({ kind: "start" });
    expect(viewFor({ parseStatus: "PARSING", updatedAt: at(1000), itemCount: 0 }, now)).toEqual({ kind: "reading" });
    expect(viewFor({ parseStatus: "SUCCEEDED", updatedAt: at(0), itemCount: 4 }, now)).toEqual({ kind: "succeeded", itemCount: 4 });
    expect(viewFor({ parseStatus: "FAILED", updatedAt: at(0), itemCount: 0 }, now)).toEqual({ kind: "failed", reason: "error" });
  });

  it("treats a parse running for more than five minutes as abandoned", () => {
    expect(viewFor({ parseStatus: "PARSING", updatedAt: at(ABANDONED_MS), itemCount: 0 }, now).kind).toBe("reading");
    expect(viewFor({ parseStatus: "PARSING", updatedAt: at(ABANDONED_MS + 1), itemCount: 0 }, now)).toEqual({
      kind: "failed",
      reason: "abandoned",
    });
  });

  it("maps each parse response, never retrying a 409 on its own", () => {
    expect(parseOutcome(200)).toEqual({ kind: "items" });
    expect(parseOutcome(400)).toEqual({ kind: "failed", reason: "unreadable" });
    expect(parseOutcome(503)).toEqual({ kind: "failed", reason: "error" });
    expect(parseOutcome(404)).toEqual({ kind: "failed", reason: "error" });
    expect(parseOutcome(409)).toEqual({ kind: "reload" });
    expect(parseOutcome(401)).toEqual({ kind: "login" });
  });

  it("reduces receipt detail to what the screen needs", () => {
    expect(
      toScanReceipt({ id: "r1", revision: 3, parseStatus: "SUCCEEDED", updatedAt: new Date(now), items: [{}, {}] }),
    ).toEqual({ id: "r1", revision: 3, parseStatus: "SUCCEEDED", updatedAt: "2026-11-13T12:00:00.000Z", itemCount: 2 });
  });
});

describe("renders", () => {
  it("upload form: Take photo (touch only, camera) and Choose from library (no capture)", () => {
    const html = renderToStaticMarkup(h(UploadForm));
    expect(html).toMatch(/<button[^>]*class="[^"]*hidden[^"]*pointer-coarse:inline-flex[^"]*"[^>]*>Take photo<\/button>/);
    expect(html).toMatch(/<button[^>]*>Choose from library<\/button>/);
    expect(html).toMatch(/<input[^>]*capture="environment"[^>]*data-input="camera"/);
    const library = html.match(/<input[^>]*data-input="library"[^>]*>/)![0];
    expect(library).not.toContain("capture");
    expect(library).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(library).toContain('tabindex="-1"');
    expect(html).not.toContain("Scan this receipt");
  });

  it("reading: a status region with a decorative spinner that respects reduced motion", () => {
    const html = renderToStaticMarkup(h(ScanPanel, { view: { kind: "reading" }, itemsHref: "/receipts/r1/items", onTryAgain() {} }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading your receipt…");
    expect(html).toContain("This can take up to a minute.");
    const svg = html.match(/<svg[^>]*>/)![0];
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toMatch(/class="[^"]*animate-spin[^"]*motion-reduce:animate-none/);
  });

  it("succeeded: the item count and a link to the items", () => {
    const html = renderToStaticMarkup(h(ScanPanel, { view: { kind: "succeeded", itemCount: 4 }, itemsHref: "/receipts/r1/items", onTryAgain() {} }));
    expect(html).toContain("Read 4 items");
    expect(html).toMatch(/<a[^>]*href="\/receipts\/r1\/items"[^>]*>Check the items<\/a>/);
  });

  it("failed: an alert with Try again and Enter items by hand", () => {
    const html = renderToStaticMarkup(h(ScanPanel, { view: { kind: "failed", reason: "unreadable" }, itemsHref: "/receipts/r1/items", onTryAgain() {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("We couldn&#x27;t read this receipt");
    expect(html).toContain("We couldn&#x27;t find any items on this photo.");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/receipts\/r1\/items"[^>]*>Enter items by hand<\/a>/);
  });
});
