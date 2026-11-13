// Stand-in for a step whose screen isn't built yet (docs/specs/receipts/flow.md,
// "Where it lives"). The page still runs the step guard; each screen's PR
// replaces its placeholder.
import { Card, CardContent } from "../../components/ui/card";

export function StepPlaceholder({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card>
        <CardContent>
          <p className="text-ink-muted">This screen is coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
