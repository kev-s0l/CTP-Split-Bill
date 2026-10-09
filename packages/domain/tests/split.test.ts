import { describe, expect, it } from "vitest";
import { allocateSplit, centsToMoney, toCents, type SplitInput } from "../src/split";

const members = ["a", "b", "c"].map((id, index) => ({ id, joinedAt: new Date(index * 1000) }));
const base: SplitInput = {
  splitMode: "EVEN", subtotal: 1000n, tax: 0n, tip: 0n, members,
  items: [{ totalPrice: 1000n, shares: [] }],
};

describe("allocateSplit", () => {
  it("allocates the extra even-split cent to the earliest joined member", () => {
    const bills = allocateSplit({ ...base, members: [...members].reverse() });
    expect(bills.map((bill) => [bill.memberId, bill.amountOwed])).toEqual([["a", 334n], ["b", 333n], ["c", 333n]]);
  });

  it("breaks equal joinedAt ties by id regardless of input order", () => {
    const bills = allocateSplit({ ...base, members: [...members].reverse().map((member) => ({ ...member, joinedAt: new Date(0) })) });
    expect(bills.map((bill) => [bill.memberId, bill.subtotal])).toEqual([["a", 334n], ["b", 333n], ["c", 333n]]);
  });

  it("allocates steak, shared appetizer, proportional tax and tip", () => {
    expect(allocateSplit({
      ...base, splitMode: "ITEMIZED", members: members.slice(0, 2), subtotal: 3000n, tax: 270n, tip: 600n,
      items: [
        { totalPrice: 2000n, shares: [{ memberId: "a", weight: 1 }] },
        { totalPrice: 1000n, shares: [{ memberId: "a", weight: 1 }, { memberId: "b", weight: 1 }] },
      ],
    })).toEqual([
      { memberId: "a", subtotal: 2500n, taxShare: 225n, tipShare: 500n, amountOwed: 3225n },
      { memberId: "b", subtotal: 500n, taxShare: 45n, tipShare: 100n, amountOwed: 645n },
    ]);
  });

  it("rounds each column separately using exact unrounded subtotals", () => {
    const bills = allocateSplit({
      ...base, splitMode: "ITEMIZED", subtotal: 100n, tax: 10n,
      items: [{ totalPrice: 100n, shares: members.map((member) => ({ memberId: member.id, weight: 1 })) }],
    });
    expect(bills.map((bill) => [bill.subtotal, bill.taxShare, bill.amountOwed])).toEqual([
      [34n, 4n, 38n], [33n, 3n, 36n], [33n, 3n, 36n],
    ]);
    const tiny = allocateSplit({
      ...base, splitMode: "ITEMIZED", subtotal: 1n, tax: 1n, tip: 1n,
      items: [{ totalPrice: 1n, shares: [{ memberId: "a", weight: 1 }, { memberId: "b", weight: 2 }] }],
    });
    expect(tiny.map((bill) => bill.amountOwed)).toEqual([0n, 3n, 0n]);
  });

  it("gives zero food, tax and tip to a member assigned no items", () => {
    const bills = allocateSplit({ ...base, splitMode: "ITEMIZED", tax: 100n, tip: 200n,
      items: [{ totalPrice: 1000n, shares: [{ memberId: "a", weight: 1 }] }],
    });
    expect(bills[1]).toEqual({ memberId: "b", subtotal: 0n, taxShare: 0n, tipShare: 0n, amountOwed: 0n });
  });

  it("supports unequal weights and large intermediate values without floats", () => {
    const bills = allocateSplit({ ...base, splitMode: "ITEMIZED", subtotal: 999999999999n,
      items: [{ totalPrice: 999999999999n, shares: [{ memberId: "a", weight: 2147483647 }, { memberId: "b", weight: 2147483646 }] }],
    });
    expect(bills.map((bill) => bill.subtotal)).toEqual([500000000116n, 499999999883n, 0n]);
  });

  it.each([
    { ...base, subtotal: 0n }, { ...base, tax: -1n }, { ...base, members: [] },
    { ...base, members: [members[0], members[0]] },
    { ...base, items: [{ totalPrice: 999n, shares: [] }] },
    { ...base, splitMode: "ITEMIZED" as const },
    { ...base, splitMode: "ITEMIZED" as const, items: [{ totalPrice: 1000n, shares: [{ memberId: "foreign", weight: 1 }] }] },
    { ...base, splitMode: "ITEMIZED" as const, items: [{ totalPrice: 1000n, shares: [{ memberId: "a", weight: 0 }] }] },
  ])("rejects invalid split inputs %#", (input) => {
    expect(() => allocateSplit(input)).toThrow();
  });

  it.each(["EVEN", "ITEMIZED"] as const)("preserves all columns and stays within one cent for generated %s splits", (splitMode) => {
    let seed = 48721;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    for (let run = 0; run < 250; run++) {
      const count = random(5) + 1;
      const group = Array.from({ length: count }, (_, index) => ({ id: `m${index}`, joinedAt: new Date(random(3) * 1000) }));
      const items = Array.from({ length: random(4) + 1 }, () => ({
        totalPrice: BigInt(random(10000) + 1),
        shares: group.filter(() => random(3) !== 0).map((member) => ({ memberId: member.id, weight: random(5) + 1 })),
      }));
      for (const item of items) if (item.shares.length === 0) item.shares.push({ memberId: group[0].id, weight: 1 });
      const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0n);
      const tax = BigInt(random(2000));
      const tip = BigInt(random(2000));
      const bills = allocateSplit({ splitMode, subtotal, tax, tip, members: group, items });
      expect(bills.reduce((sum, bill) => sum + bill.subtotal, 0n)).toBe(subtotal);
      expect(bills.reduce((sum, bill) => sum + bill.taxShare, 0n)).toBe(tax);
      expect(bills.reduce((sum, bill) => sum + bill.tipShare, 0n)).toBe(tip);
      expect(bills.reduce((sum, bill) => sum + bill.amountOwed, 0n)).toBe(subtotal + tax + tip);
      // Independent oracle: use the product of item denominators instead of
      // the allocator's reduced fractions, then compare in integer units.
      const weights = items.map((item) => BigInt(item.shares.reduce((sum, share) => sum + share.weight, 0)));
      const denominator = splitMode === "EVEN" ? BigInt(count) : weights.reduce((product, value) => product * value, 1n);
      for (const bill of bills) {
        const numerator = splitMode === "EVEN" ? subtotal : items.reduce((sum, item, index) => {
          const weight = item.shares.find((share) => share.memberId === bill.memberId)?.weight ?? 0;
          return sum + item.totalPrice * BigInt(weight) * (denominator / weights[index]);
        }, 0n);
        const near = (actual: bigint, exactNumerator: bigint, exactDenominator: bigint) => {
          const difference = actual * exactDenominator - exactNumerator;
          expect(difference < 0n ? -difference : difference).toBeLessThanOrEqual(exactDenominator);
        };
        near(bill.subtotal, numerator, denominator);
        near(bill.taxShare, numerator * tax, denominator * subtotal);
        near(bill.tipShare, numerator * tip, denominator * subtotal);
        expect(bill.amountOwed).toBe(bill.subtotal + bill.taxShare + bill.tipShare);
      }
      const permuted = allocateSplit({ splitMode, subtotal, tax, tip, members: [...group].reverse(), items: [...items].reverse() });
      expect(permuted).toEqual(bills);
    }
  });
});

describe("money conversion", () => {
  it("converts decimal strings without float parsing", () => {
    expect(toCents("0")).toBe(0n);
    expect(toCents("0001.2")).toBe(120n);
    expect(toCents("9999999999.99")).toBe(999999999999n);
    expect(centsToMoney(1n)).toBe("0.01");
    expect(centsToMoney(999999999999n)).toBe("9999999999.99");
  });
});
