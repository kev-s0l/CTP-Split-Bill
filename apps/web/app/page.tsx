import { Suspense } from "react";
import { currentUserId } from "@project/auth";
import { listReceiptSummaries } from "@project/domain";
import { BillCard } from "@/app/components/BillCard";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { NEW_RECEIPT_HREF } from "@/app/routes";
import { toBillCardProps } from "@/app/lib/format";

async function ReceiptList() {
  const userId = await currentUserId();
  const receipts = await listReceiptSummaries(userId);
  if (!receipts.length) return <Card><CardContent className="space-y-4 pt-6"><h2 className="font-semibold">No bills yet</h2><p className="text-sm text-ink-muted">Scan a receipt to split it.</p><Button asChild><a href={NEW_RECEIPT_HREF}>New receipt</a></Button></CardContent></Card>;

  return <div className="space-y-4">{receipts.map((receipt) => <BillCard key={receipt.id} {...toBillCardProps(receipt)} />)}</div>;
}

export default function Home() {
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Your bills</h1>
        <Button asChild><a href={NEW_RECEIPT_HREF}>New receipt</a></Button>
      </header>
      <Suspense fallback={<div aria-label="Loading bills" className="space-y-4"><div className="h-32 animate-pulse rounded-xl bg-surface" /><div className="h-32 animate-pulse rounded-xl bg-surface" /></div>}>
        <ReceiptList />
      </Suspense>
    </div>
  );
}
