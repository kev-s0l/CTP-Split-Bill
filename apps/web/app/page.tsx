// Home: the signed-in organizer's receipts as BillCards, or the public landing
// for a signed-out visitor. Spec: docs/specs/bills/list-screen.md.
import Link from "next/link";
import { Suspense } from "react";
import { currentUserId } from "@project/auth";
import { listReceiptSummaries } from "@project/domain";
import { BillCard } from "@/app/components/BillCard";
import { EmptyState } from "@/app/components/EmptyState";
import { LoadingState } from "@/app/components/LoadingState";
import { Button } from "@/app/components/ui/button";
import { toBillCardProps } from "@/app/lib/format";
import { LOGIN_PATH } from "@/app/lib/page-access";

export const dynamic = "force-dynamic";

const NEW_RECEIPT_HREF = "/receipts/new";

// Errors propagate to the root error boundary (app/error.tsx).
async function ReceiptList({ userId }: { userId: string }) {
  const receipts = await listReceiptSummaries(userId);
  if (!receipts.length) {
    return (
      <EmptyState
        title="No bills yet"
        message="Scan a receipt to split it."
        actionLabel="New receipt"
        actionHref={NEW_RECEIPT_HREF}
      />
    );
  }
  return (
    <ul className="space-y-4">
      {receipts.map((receipt) => (
        <li key={receipt.id}>
          {/* /receipts/[id] lands on the receipt's next step (receipts/flow.md). */}
          <Link
            href={`/receipts/${encodeURIComponent(receipt.id)}`}
            className="block rounded-card focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>*]:transition-colors hover:[&>*]:border-brand"
          >
            <BillCard {...toBillCardProps(receipt)} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function Home() {
  // `/` is public (auth/sign-in.md); a signed-out visitor gets the landing.
  const userId = await currentUserId();
  if (!userId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Split Bill</h1>
        <p className="text-ink-muted">Scan a receipt, send everyone a link, and see who owes what.</p>
        <Button asChild className="min-h-11">
          <a href={LOGIN_PATH}>Sign in</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Your bills</h1>
        <Button asChild className="min-h-11">
          <a href={NEW_RECEIPT_HREF}>New receipt</a>
        </Button>
      </header>
      <Suspense fallback={<LoadingState label="Loading bills" rows={2} />}>
        <ReceiptList userId={userId} />
      </Suspense>
    </div>
  );
}
