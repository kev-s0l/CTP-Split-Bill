// Receipt layout: the step bar and the picking-mode chip above every step page
// (docs/specs/receipts/flow.md). The receipt read here is shared with the step
// page through React cache().
import { receiptSteps } from "@project/domain/steps";
import { StepBar } from "./StepBar";
import { loadReceipt } from "./step-guard";

export const dynamic = "force-dynamic";

export default async function ReceiptLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receipt = await loadReceipt(id, `/receipts/${encodeURIComponent(id)}`);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {receipt.status === "DRAFT" && (
          <p className="flex justify-end">
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium">
              {receipt.picksOpenedAt ? "Picking open" : "Editing"}
            </span>
          </p>
        )}
        <StepBar receiptId={receipt.id} steps={receiptSteps(receipt)} />
      </div>
      {children}
    </div>
  );
}
