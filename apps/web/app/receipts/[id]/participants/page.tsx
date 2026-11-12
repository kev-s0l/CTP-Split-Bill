// Organizer roster screen: who is splitting this receipt, and their pick links.
// Spec: docs/specs/receipts/participants-screen.md.
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUserId } from "@project/auth";
import { ApiError, getReceipt } from "@project/domain";
import { LoadingState } from "../../../components/LoadingState";
import { ParticipantsEditor } from "./ParticipantsEditor";
import { toEditorReceipt } from "./roster";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const userId = await currentUserId();
  if (!userId) redirect("/api/auth/signin");
  try {
    const receipt = await getReceipt(userId, receiptId);
    return <ParticipantsEditor initial={toEditorReceipt(receipt)} />;
  } catch (e) {
    // Foreign and unknown receipts look the same: not found, never forbidden.
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && e.status === 401) redirect("/api/auth/signin");
    throw e;
  }
}
