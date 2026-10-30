// Receipt ownership and the executable seed/finalize drill against PGlite.
import { describe, expect, it } from "vitest";
import { prisma } from "@project/db";
import { seedDemo } from "../../db/src/seed";
import { finalizeReceipt, getReceipt, listReceiptBills, listReceipts, updateReceipt } from "../src";

describe("receipt-owned seed drill", () => {
  it("seeds idempotently, scopes history, confirms and finalizes the demo receipt", async () => {
    await seedDemo();
    await seedDemo();
    expect(await prisma.participant.count({ where: { receiptId: "seed-receipt-demo" } })).toBe(2);
    expect((await listReceipts("demo-user")).map((receipt) => receipt.id)).toEqual(["seed-receipt-demo"]);
    await expect(getReceipt("other-user", "seed-receipt-demo")).rejects.toMatchObject({ status: 404 });
    await expect(getReceipt("demo-user", undefined as unknown as string)).rejects.toMatchObject({ status: 404 });
    const receipt = await getReceipt("demo-user", "seed-receipt-demo");
    expect(receipt.ownerId).toBe("demo-user");
    const reviewed = await updateReceipt("demo-user", receipt.id, { expectedRevision: receipt.revision, reviewConfirmed: true });
    expect(reviewed.reviewedAt).not.toBeNull();
    await finalizeReceipt("demo-user", receipt.id, { expectedRevision: reviewed.revision });
    const bills = await listReceiptBills("demo-user", receipt.id);
    const cents = bills.reduce((sum, bill) => sum + Math.round(Number(bill.amountOwed) * 100), 0);
    expect(cents).toBe(3866);
    expect(bills.map((bill) => bill.amountOwed)).toEqual(["19.33", "19.33"]);
    expect(bills.map((bill) => bill.settled)).toEqual([true, false]);
    const finalized = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    await seedDemo();
    expect(await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(finalized);
    expect(await listReceiptBills("demo-user", receipt.id)).toEqual(bills);
    await expect(listReceiptBills("other-user", receipt.id)).rejects.toMatchObject({ status: 404 });
    await expect(finalizeReceipt("demo-user", receipt.id, { expectedRevision: reviewed.revision })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects unknown users for both receipt history and details", async () => {
    await expect(listReceipts("missing-user")).rejects.toMatchObject({ status: 401 });
    await expect(getReceipt("missing-user", "seed-receipt-demo")).rejects.toMatchObject({ status: 401 });
  });
});
