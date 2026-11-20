// Finalize step: who owes what, whether the receipt adds up, and the
// confirmation that creates the bills. Spec: docs/specs/receipts/finalize-screen.md.
import Link from "next/link";
import { Suspense } from "react";
import { currentUserId } from "@project/auth";
import { ApiError, listReceiptBills, previewReceipt } from "@project/domain";
import { LoadingState } from "../../../components/LoadingState";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { formatDate } from "../../../lib/format";
import { type ReceiptDetail, loadStep, stepPath } from "../step-guard";
import { FinalizePanel } from "./FinalizePanel";
import { SummaryTable } from "./SummaryTable";
import { buildSummary, mismatchMessages } from "./summary";

export const dynamic = "force-dynamic";

export default async function FinalizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gate before streaming starts, so a locked step is a real 307.
  const receipt = await loadStep(id, "finalize");
  const finalized = receipt.status === "FINALIZED";
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{finalized ? "Finalized" : "Review and finalize"}</h1>
        {finalized && receipt.finalizedAt ? (
          <p className="text-ink-muted">Finalized on {formatDate(new Date(receipt.finalizedAt).toISOString())}</p>
        ) : (
          <p className="text-ink-muted">Check what everyone owes, then create the bills.</p>
        )}
      </header>
      <Suspense fallback={<LoadingState label="Loading the split" rows={3} />}>
        <FinalizeSummary receiptId={id} />
      </Suspense>
    </div>
  );
}

async function FinalizeSummary({ receiptId }: { receiptId: string }) {
  // Same cached read as the layout and the page.
  const receipt = await loadStep(receiptId, "finalize");
  const userId = (await currentUserId())!;

  if (receipt.status === "FINALIZED") {
    const bills = await listReceiptBills(userId, receipt.id);
    return <SummaryTable summary={buildSummary(bills, receipt.participants, receipt.currency, null)} />;
  }

  if (!receipt.totals.reconciled) {
    return <Mismatch receipt={receipt} messages={mismatchMessages(receipt.totals, receipt.currency)} />;
  }

  let preview;
  try {
    preview = await previewReceipt(userId, receipt.id, { expectedRevision: receipt.revision });
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      return <Mismatch receipt={receipt} messages={[e.message]} />;
    }
    throw e;
  }

  const summary = buildSummary(preview.allocations, receipt.participants, receipt.currency, {
    splitMode: receipt.splitMode,
    organizerParticipantId: receipt.organizerParticipantId,
  });
  return (
    <div className="space-y-6">
      <SummaryTable summary={summary} />
      <FinalizePanel
        receiptId={receipt.id}
        revision={preview.revision}
        pickingOpen={receipt.picksOpenedAt !== null}
        disabledReason={null}
        billCount={summary.rows.length}
        total={summary.totals.owes}
      />
    </div>
  );
}

function Mismatch({ receipt, messages }: { receipt: ReceiptDetail; messages: string[] }) {
  return (
    <div className="space-y-6">
      <Alert variant="destructive">
        <AlertTitle>This receipt doesn&apos;t add up</AlertTitle>
        <AlertDescription>
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
          <Link
            href={stepPath(receipt.id, "items")}
            className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4"
          >
            Fix the items
          </Link>
        </AlertDescription>
      </Alert>
      <FinalizePanel
        receiptId={receipt.id}
        revision={receipt.revision}
        pickingOpen={receipt.picksOpenedAt !== null}
        disabledReason="Fix the totals first"
        billCount={0}
        total=""
      />
    </div>
  );
}
