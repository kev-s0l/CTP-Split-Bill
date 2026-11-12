// Empty state for an async section (docs/specs/components.md, "Async
// states"). Always offers one primary action: a link (actionHref) or, from a
// client caller, a button that runs onAction.
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

type EmptyStateAction =
  | { actionHref: string; onAction?: never }
  | { onAction: () => void; actionHref?: never };

export function EmptyState({
  title,
  message,
  actionLabel,
  ...action
}: {
  title: string;
  message: string;
  actionLabel: string;
} & EmptyStateAction) {
  return (
    <Card>
      <CardContent className="space-y-4 text-center">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-ink-muted">{message}</p>
        </div>
        {action.onAction ? (
          <Button type="button" className="min-h-11" onClick={action.onAction}>
            {actionLabel}
          </Button>
        ) : (
          <Button asChild className="min-h-11">
            <a href={action.actionHref}>{actionLabel}</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
