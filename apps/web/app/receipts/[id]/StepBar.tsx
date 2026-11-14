"use client";
// Step bar for a receipt (docs/specs/receipts/flow.md, "Step bar"). States
// come from the server; the shown step comes from the URL.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import type { Step, StepKey } from "@project/domain/steps";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/button";

function href(receiptId: string, key: StepKey) {
  return `/receipts/${encodeURIComponent(receiptId)}/${key}`;
}

// Next.js keeps a layout across navigations between its pages, so this bar
// would keep the step states it was first rendered with. When the step in the
// URL changes, re-render the layout on the server so the states are current
// (for example, Items done after Confirm items).
export function stepChanged(shownPath: string, pathname: string): boolean {
  return shownPath !== pathname;
}

function useFreshStepsOnNavigation(pathname: string, refresh: () => void) {
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (!stepChanged(shownPath.current, pathname)) return;
    shownPath.current = pathname;
    refresh();
  }, [pathname, refresh]);
}

export function StepBar({ receiptId, steps }: { receiptId: string; steps: Step[] }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useFreshStepsOnNavigation(pathname, refresh);
  const segment = pathname.split("/")[3];
  const index = Math.max(0, steps.findIndex((s) => s.key === segment));
  const shown = steps[index];
  const prev = steps[index - 1];
  const next = steps[index + 1];
  const nextReasonId = "step-next-reason";

  return (
    <nav aria-label="Receipt steps" className="space-y-2">
      {/* Phone: one step at a time, with Back and Next. */}
      <div className="space-y-1 md:hidden">
        <div className="flex items-center justify-between gap-2">
          {prev && prev.state !== "locked" ? (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={href(receiptId, prev.key)}>Back</Link>
            </Button>
          ) : (
            <span className="min-w-16" />
          )}
          <p className="text-sm font-medium" aria-live="polite">
            Step {index + 1} of {steps.length} · {shown.label}
          </p>
          {next ? (
            next.state === "locked" ? (
              <Button type="button" variant="outline" className="min-h-11" disabled aria-describedby={nextReasonId}>
                Next
              </Button>
            ) : (
              <Button asChild className="min-h-11">
                <Link href={href(receiptId, next.key)}>Next</Link>
              </Button>
            )
          ) : (
            <span className="min-w-16" />
          )}
        </div>
        {next?.state === "locked" && (
          <p id={nextReasonId} className="text-right text-sm text-ink-muted">
            {next.lockedReason}
          </p>
        )}
      </div>

      {/* md and up: every step with its state. */}
      <ol className="hidden md:flex md:items-center md:gap-1">
        {steps.map((step, i) => {
          const isShown = i === index;
          const marker = step.state === "done" ? "✓" : String(i + 1);
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-full border text-xs",
                  step.state === "done" && "border-brand bg-brand text-brand-ink",
                  step.state === "current" && "border-brand text-brand",
                  step.state === "locked" && "border-line text-ink-muted",
                )}
              >
                {marker}
              </span>
              <span>{step.label}</span>
              {step.state === "done" && <span className="sr-only"> (done)</span>}
              {step.state === "locked" && <span className="sr-only"> (locked)</span>}
            </>
          );
          const base = "inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm";
          return (
            <li key={step.key} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-line" />}
              {step.state === "locked" ? (
                <span aria-disabled="true" className={cn(base, "text-ink-muted")}>
                  {body}
                </span>
              ) : (
                <Link
                  href={href(receiptId, step.key)}
                  aria-current={isShown ? "step" : undefined}
                  className={cn(base, "hover:bg-canvas", isShown && "font-semibold underline underline-offset-4")}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
