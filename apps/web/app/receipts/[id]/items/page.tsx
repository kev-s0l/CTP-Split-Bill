// The Items step: correct the restaurant, items and totals, then confirm.
// Spec: docs/specs/receipts/edit-screen.md; gating: receipts/flow.md.
import { loadStep } from "../step-guard";
import { ItemsEditor } from "./ItemsEditor";
import { subtitleFor, toEditorReceipt } from "./receipt-form";

export const dynamic = "force-dynamic";

export default async function ItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await loadStep(id, "items");
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Check the items</h1>
        <p className="text-ink-muted">{subtitleFor(receipt.parseStatus)}</p>
      </header>
      <ItemsEditor initial={toEditorReceipt(receipt)} />
    </div>
  );
}
