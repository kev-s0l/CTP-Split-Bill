// The Scan step: reading the receipt photo and parse failures.
// Spec: docs/specs/receipts/upload-screen.md; gating: receipts/flow.md.
import { loadStep } from "../step-guard";
import { ScanStatus } from "./ScanStatus";
import { toScanReceipt } from "./scan-state";

export const dynamic = "force-dynamic";

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await loadStep(id, "scan");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Scan</h1>
      <ScanStatus initial={toScanReceipt(receipt)} />
    </div>
  );
}
