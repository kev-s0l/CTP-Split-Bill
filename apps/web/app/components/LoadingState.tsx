// Loading state for an async section (docs/specs/components.md, "Async
// states"). Used as a Suspense fallback; the label is read by screen readers.
import { Skeleton } from "./ui/skeleton";

export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-card" />
      ))}
    </div>
  );
}
