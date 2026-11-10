import { describe, expect, it } from "vitest";
import { extractReceiptText } from "../src/receipt-parsing";

describe("conservative receipt text extraction", () => {
  it("extracts explicit fields without inventing unknown quantities or prices", () => {
    expect(extractReceiptText("Merchant: Corner Cafe\nDate: 2026-11-09\nAddress: 10 Main Street\n2 x Soup @ 5.00 10.00\nTea 3.00\nSubtotal 13.00\nTax 1.00\nTip 2.00\nTotal 16.00")).toEqual({
      merchantName: "Corner Cafe", purchasedAt: "2026-11-09T00:00:00.000Z", address: "10 Main Street",
      subtotal: "13.00", tax: "1.00", tip: "2.00", total: "16.00",
      items: [
        { name: "Soup", quantity: "2", unitPrice: "5.00", totalPrice: "10.00" },
        { name: "Tea", quantity: null, unitPrice: null, totalPrice: "3.00" },
      ],
    });
  });

  it("keeps ambiguous labels and invalid dates unknown and skips summary/negative lines", () => {
    const result = extractReceiptText("Corner Cafe\nDate: 2026-02-30\nSoup 5.00\nTax 0.20\nTax 0.30\nTax 0.40\nCash 20.00\nChange 14.50\nDiscount -1.00\nCoupon - 1.00");
    expect(result).toMatchObject({ merchantName: null, purchasedAt: null, tax: null, subtotal: null, tip: null, total: null });
    expect(result.items).toEqual([{ name: "Soup", quantity: null, unitPrice: null, totalPrice: "5.00" }]);
  });

  it.each([null, {}, "", "No readable amounts", "x".repeat(100_001), "Soup 10000000000.00", "x".repeat(201) + " 1.00", "0 x Soup @ 5.00 0.00", "10000000 x Soup @ 5.00 5.00"])("rejects unusable or out-of-schema extraction %j", (text) => {
    expect(() => extractReceiptText(text)).toThrow(expect.objectContaining({ code: "INVALID_INPUT", status: 400 }));
  });

  it("allows 500 items and rejects 501", () => {
    expect(extractReceiptText(Array(500).fill("Soup 5.00").join("\n")).items).toHaveLength(500);
    expect(() => extractReceiptText(Array(501).fill("Soup 5.00").join("\n"))).toThrow();
  });
});
