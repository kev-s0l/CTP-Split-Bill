// "Who owes what" for the finalize screen: stacked rows below md:, a table from
// md: up (docs/specs/web.md, "Mobile"). Takes display-ready strings only.
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import type { Summary } from "./summary";

function Readiness({ label }: { label: string | null }) {
  if (label === null) return null;
  const variant = label === "Done picking" ? "success" : label === "No link" ? "destructive" : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}

export function SummaryTable({ summary }: { summary: Summary }) {
  const { rows, totals } = summary;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Who owes what</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-line md:hidden">
          {rows.map((row) => (
            <li key={row.participantId} className="space-y-1 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{row.name}</span>
                  <Readiness label={row.readiness} />
                </span>
                <span className="font-semibold tabular-nums">{row.owes}</span>
              </div>
              <p className="text-sm text-ink-muted tabular-nums">
                Items {row.subtotal} · Tax {row.tax} · Tip {row.tip}
              </p>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-3 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{totals.owes}</span>
          </li>
        </ul>

        <table className="hidden w-full text-sm md:table">
          <thead>
            <tr className="border-b border-line text-left text-ink-muted">
              <th scope="col" className="py-2 font-medium">Person</th>
              <th scope="col" className="py-2 text-right font-medium">Items</th>
              <th scope="col" className="py-2 text-right font-medium">Tax</th>
              <th scope="col" className="py-2 text-right font-medium">Tip</th>
              <th scope="col" className="py-2 text-right font-medium">Owes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.participantId} className="border-b border-line">
                <th scope="row" className="py-3 text-left font-medium">
                  <span className="flex items-center gap-2">
                    {row.name}
                    <Readiness label={row.readiness} />
                  </span>
                </th>
                <td className="py-3 text-right tabular-nums">{row.subtotal}</td>
                <td className="py-3 text-right tabular-nums">{row.tax}</td>
                <td className="py-3 text-right tabular-nums">{row.tip}</td>
                <td className="py-3 text-right font-semibold tabular-nums">{row.owes}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="py-3 text-left">Total</th>
              <td className="py-3 text-right tabular-nums">{totals.subtotal}</td>
              <td className="py-3 text-right tabular-nums">{totals.tax}</td>
              <td className="py-3 text-right tabular-nums">{totals.tip}</td>
              <td className="py-3 text-right tabular-nums">{totals.owes}</td>
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}
