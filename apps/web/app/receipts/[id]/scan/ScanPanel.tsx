// What the Scan step shows for each state (docs/specs/receipts/upload-screen.md,
// "Scan"). Presentational: ScanStatus decides the state.
import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { FAIL_MESSAGES, type ScanView } from "./scan-state";

export function ScanPanel({ view, itemsHref, onTryAgain }: { view: ScanView; itemsHref: string; onTryAgain: () => void }) {
  if (view.kind === "reading" || view.kind === "start") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-8 text-center">
        <Loader2Icon aria-hidden="true" className="size-10 animate-spin text-brand motion-reduce:animate-none" />
        <p className="text-lg font-semibold">Reading your receipt…</p>
        <p className="text-sm text-ink-muted">Finding the items and totals. This can take up to a minute.</p>
      </div>
    );
  }
  if (view.kind === "succeeded") {
    return (
      <div className="space-y-4 rounded-card border border-line bg-surface p-6">
        <p className="text-lg font-semibold">
          Read {view.itemCount} {view.itemCount === 1 ? "item" : "items"}
        </p>
        <Button asChild className="min-h-11">
          <Link href={itemsHref}>Check the items</Link>
        </Button>
      </div>
    );
  }
  return (
    <Alert variant="destructive" className="space-y-3">
      <AlertTitle>We couldn&apos;t read this receipt</AlertTitle>
      <AlertDescription>{FAIL_MESSAGES[view.reason]}</AlertDescription>
      <div className="col-start-2 flex flex-wrap gap-3">
        <Button type="button" className="min-h-11" onClick={onTryAgain}>
          Try again
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={itemsHref}>Enter items by hand</Link>
        </Button>
      </div>
    </Alert>
  );
}
