// Guest bill page for a bill link. Server-rendered from the same public read as
// GET /api/bill-links/:token; unknown, revoked or expired links render the 404 page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError, readBillLink } from "@project/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your bill",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function money(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export default async function BillLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bill = await readBillLink(token).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const { currency } = bill.receipt;
  const place = bill.receipt.merchantName ?? bill.receipt.title ?? "Your bill";
  const rows: [string, string][] = [
    ["Items", bill.subtotal], ["Tax", bill.taxShare], ["Tip", bill.tipShare],
  ];

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-neutral-500">Bill for {bill.displayName}</p>
        <h1 className="text-2xl font-bold">{place}</h1>
        {bill.receipt.purchasedAt && (
          <p className="text-sm text-neutral-500">{new Date(bill.receipt.purchasedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
        )}
      </header>

      <section className="rounded-lg border border-neutral-200 p-6">
        <dl className="space-y-2">
          {rows.map(([label, amount]) => (
            <div key={label} className="flex justify-between text-neutral-600">
              <dt>{label}</dt>
              <dd>{money(amount, currency)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-neutral-200 pt-2 text-lg font-semibold">
            <dt>Your share</dt>
            <dd>{money(bill.amountOwed, currency)}</dd>
          </div>
        </dl>
      </section>

      <p className={bill.settled ? "font-medium text-green-700" : "font-medium text-amber-700"}>
        {bill.settled ? "Settled — nothing left to pay." : `Outstanding: ${money(bill.outstandingAmount, currency)}`}
      </p>
    </main>
  );
}
