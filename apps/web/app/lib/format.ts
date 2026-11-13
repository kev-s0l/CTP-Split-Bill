import { createElement } from "react";
import type { ReceiptSummary } from "@project/domain";
import { Badge } from "@/app/components/ui/badge";
import type { BillCardProps } from "@/app/components/BillCard";

export function formatMoney(value: string | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function toBillCardProps(receipt: ReceiptSummary): BillCardProps {
  const status = receipt.status === "DRAFT"
    ? createElement(Badge, { variant: "secondary", children: "Draft" })
    : receipt.settled === true
      ? createElement(Badge, { variant: "success", children: "Paid" })
      : receipt.settled === false
        ? createElement(Badge, { variant: "destructive", children: "Unpaid" })
        : undefined;

  return {
    restaurant: receipt.merchantName ?? receipt.title ?? "Untitled receipt",
    paidTo: receipt.payerName ?? "Unknown",
    partyCount: receipt.participantCount,
    total: formatMoney(receipt.total),
    date: formatDate(receipt.createdAt),
    status,
  };
}
