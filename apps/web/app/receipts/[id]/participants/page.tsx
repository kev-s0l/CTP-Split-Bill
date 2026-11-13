// Organizer roster screen: who is splitting this receipt, and their pick links.
// Spec: docs/specs/receipts/participants-screen.md.
import { Suspense } from "react";
import { LoadingState } from "../../../components/LoadingState";
import { loadStep } from "../step-guard";
import { ParticipantsEditor } from "./ParticipantsEditor";
import { toEditorReceipt } from "./roster";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gate before streaming starts, so a locked step is a real 307.
  await loadStep(id, "participants");
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Who&apos;s splitting</h1>
        <p className="text-ink-muted">
          Add everyone at the table. A phone or email is only needed to send someone their link.
        </p>
      </header>
      <Suspense fallback={<LoadingState label="Loading people" rows={3} />}>
        <Roster receiptId={id} />
      </Suspense>
    </div>
  );
}

async function Roster({ receiptId }: { receiptId: string }) {
  // Same cached read as the layout and the page; signs in again or renders
  // not found as loadStep describes.
  const receipt = await loadStep(receiptId, "participants");
  return <ParticipantsEditor initial={toEditorReceipt(receipt)} />;
}
