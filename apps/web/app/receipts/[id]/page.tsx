// /receipts/[id] has no screen of its own: it sends the organizer to the step
// that is next to do (docs/specs/receipts/flow.md, "Gating").
import { redirect } from "next/navigation";
import { landingStep, receiptSteps } from "@project/domain/steps";
import { loadReceipt, stepPath } from "./step-guard";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await loadReceipt(id, `/receipts/${encodeURIComponent(id)}`);
  redirect(stepPath(receipt.id, landingStep(receiptSteps(receipt))));
}
