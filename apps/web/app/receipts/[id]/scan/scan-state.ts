// Pure Scan-step logic (docs/specs/receipts/upload-screen.md, "Scan"): what
// the screen shows for a parse status, and what each parse response means.

export const POLL_MS = 3000;
// receipts/parse.md lets a PARSING attempt older than this be retried.
export const ABANDONED_MS = 5 * 60 * 1000;

export type ScanReceipt = {
  id: string;
  revision: number;
  parseStatus: string;
  updatedAt: string;
  itemCount: number;
};

export type FailReason = "unreadable" | "error" | "abandoned";

export type ScanView =
  | { kind: "start" }
  | { kind: "reading" }
  | { kind: "succeeded"; itemCount: number }
  | { kind: "failed"; reason: FailReason };

export const FAIL_MESSAGES: Record<FailReason, string> = {
  unreadable: "We couldn't find any items on this photo.",
  error: "Something went wrong while reading it. Try again in a moment.",
  abandoned: "Reading took too long and stopped.",
};

export function viewFor(receipt: Pick<ScanReceipt, "parseStatus" | "updatedAt" | "itemCount">, now: number): ScanView {
  switch (receipt.parseStatus) {
    case "NOT_STARTED":
      return { kind: "start" };
    case "PARSING":
      return now - Date.parse(receipt.updatedAt) > ABANDONED_MS ? { kind: "failed", reason: "abandoned" } : { kind: "reading" };
    case "SUCCEEDED":
      return { kind: "succeeded", itemCount: receipt.itemCount };
    default:
      return { kind: "failed", reason: "error" };
  }
}

export type ParseOutcome =
  | { kind: "items" }
  | { kind: "failed"; reason: FailReason }
  | { kind: "reload" }
  | { kind: "login" };

// Maps a POST /api/receipts/[id]/parse status (receipts/parse.md). A 409 is
// never retried automatically: the page re-reads the receipt instead.
export function parseOutcome(status: number): ParseOutcome {
  if (status === 200) return { kind: "items" };
  if (status === 400) return { kind: "failed", reason: "unreadable" };
  if (status === 401) return { kind: "login" };
  if (status === 409) return { kind: "reload" };
  return { kind: "failed", reason: "error" };
}

export function toScanReceipt(r: { id: string; revision: number; parseStatus: string; updatedAt: Date | string; items: unknown[] }): ScanReceipt {
  return {
    id: r.id,
    revision: r.revision,
    parseStatus: r.parseStatus,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : r.updatedAt.toISOString(),
    itemCount: r.items.length,
  };
}
