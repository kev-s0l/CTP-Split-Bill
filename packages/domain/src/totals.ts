// Whether a receipt's items and amounts add up (docs/specs/receipts/totals-check.md).
// Pure and derived on read, in integer cents; nothing is stored.
import { centsToMoney, toCents } from "./split";

type StoredMoney = { toString(): string } | null;

export type ReceiptTotals = {
  itemsTotal: string | null;
  itemsDifference: string | null;
  amountsDifference: string | null;
  reconciled: boolean;
};

const cents = (value: StoredMoney) => (value === null ? null : toCents(value.toString()));

function signedMoney(value: bigint): string {
  return value < 0n ? `-${centsToMoney(-value)}` : centsToMoney(value);
}

export function receiptTotals(receipt: {
  subtotal: StoredMoney;
  tax: StoredMoney;
  tip: StoredMoney;
  total: StoredMoney;
  items: { totalPrice: StoredMoney }[];
}): ReceiptTotals {
  const itemCents = receipt.items.map((item) => cents(item.totalPrice));
  const itemsTotal = itemCents.some((value) => value === null)
    ? null
    : itemCents.reduce<bigint>((sum, value) => sum + value!, 0n);
  const subtotal = cents(receipt.subtotal);
  const tax = cents(receipt.tax);
  const total = cents(receipt.total);
  const tip = cents(receipt.tip) ?? 0n;

  const itemsDifference = subtotal === null || itemsTotal === null ? null : subtotal - itemsTotal;
  const amountsDifference = subtotal === null || tax === null || total === null
    ? null
    : total - (subtotal + tax + tip);

  return {
    itemsTotal: itemsTotal === null ? null : signedMoney(itemsTotal),
    itemsDifference: itemsDifference === null ? null : signedMoney(itemsDifference),
    amountsDifference: amountsDifference === null ? null : signedMoney(amountsDifference),
    reconciled: itemsDifference === 0n && amountsDifference === 0n,
  };
}
