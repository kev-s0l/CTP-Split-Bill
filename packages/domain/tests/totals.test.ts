// receipts/totals-check.md: the derived totals object, in exact cents.
import { describe, expect, it } from "vitest";
import { receiptTotals } from "../src/totals";

const amounts = { subtotal: "64.00", tax: "5.68", tip: "11.52", total: "81.20" };
const items = (...prices: (string | null)[]) => prices.map((totalPrice) => ({ totalPrice }));

describe("receiptTotals", () => {
  it("reports items short of the subtotal", () => {
    expect(receiptTotals({ ...amounts, items: items("37.50", "24.00") })).toEqual({
      itemsTotal: "61.50", itemsDifference: "2.50", amountsDifference: "0.00", reconciled: false,
    });
  });

  it("reconciles only when both differences are zero", () => {
    expect(receiptTotals({ ...amounts, items: items("40.00", "24.00") })).toEqual({
      itemsTotal: "64.00", itemsDifference: "0.00", amountsDifference: "0.00", reconciled: true,
    });
  });

  it("signs differences negative when items or amounts are over", () => {
    const totals = receiptTotals({ ...amounts, total: "80.00", items: items("65.10") });
    expect(totals).toMatchObject({ itemsDifference: "-1.10", amountsDifference: "-1.20", reconciled: false });
  });

  it("treats a null tip as zero", () => {
    const totals = receiptTotals({ subtotal: "10.00", tax: "1.00", tip: null, total: "11.00", items: items("10.00") });
    expect(totals).toMatchObject({ amountsDifference: "0.00", reconciled: true });
  });

  it("propagates nulls", () => {
    expect(receiptTotals({ ...amounts, items: items("37.50", null) })).toEqual({
      itemsTotal: null, itemsDifference: null, amountsDifference: "0.00", reconciled: false,
    });
    expect(receiptTotals({ ...amounts, subtotal: null, items: items("1.00") })).toMatchObject({
      itemsDifference: null, amountsDifference: null, reconciled: false,
    });
  });
});
