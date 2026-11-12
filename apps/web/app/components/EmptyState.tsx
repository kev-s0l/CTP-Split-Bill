// Empty state for an async section (docs/specs/components.md, "Async
// states"). Always offers one primary action.
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

export function EmptyState({
  title,
  message,
  actionLabel,
  actionHref,
}: {
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 text-center">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-ink-muted">{message}</p>
        </div>
        <Button asChild className="min-h-11">
          <a href={actionHref}>{actionLabel}</a>
        </Button>
      </CardContent>
    </Card>
  );
}
