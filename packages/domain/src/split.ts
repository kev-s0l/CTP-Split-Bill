import { ApiError } from "./errors";

export interface SplitInput {
  splitMode: "EVEN" | "ITEMIZED";
  subtotal: bigint;
  tax: bigint;
  tip: bigint;
  members: { id: string; joinedAt: Date }[];
  items: { totalPrice: bigint; shares: { memberId: string; weight: number }[] }[];
}

export interface MemberAllocation {
  memberId: string;
  subtotal: bigint;
  taxShare: bigint;
  tipShare: bigint;
  amountOwed: bigint;
}

type Fraction = { numerator: bigint; denominator: bigint };

export function toCents(value: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new ApiError("INVALID_INPUT", "Amounts must be non-negative money values", 400);
  }
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function centsToMoney(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(a: Fraction, b: Fraction): Fraction {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

function roundColumn(total: bigint, exact: Fraction[]): bigint[] {
  const rounded = exact.map((value) => value.numerator / value.denominator);
  const remaining = total - rounded.reduce((sum, value) => sum + value, 0n);
  if (remaining < 0n || remaining >= BigInt(exact.length)) {
    throw new Error("Split column does not balance");
  }
  // Members are already in the joinedAt/id tie-break order.
  const order = exact.map((value, index) => ({
    index, remainder: value.numerator % value.denominator, denominator: value.denominator,
  })).sort((a, b) => {
    const difference = a.remainder * b.denominator - b.remainder * a.denominator;
    return difference > 0n ? -1 : difference < 0n ? 1 : a.index - b.index;
  });
  for (let i = 0; i < Number(remaining); i++) rounded[order[i].index] += 1n;
  return rounded;
}

export function allocateSplit(input: SplitInput): MemberAllocation[] {
  const invalid = (message: string): never => { throw new ApiError("INVALID_INPUT", message, 400); };
  if (input.subtotal <= 0n || input.tax < 0n || input.tip < 0n) invalid("Receipt amounts are invalid");
  if (input.members.length === 0) invalid("Receipt has no party members");
  const members = [...input.members].sort((a, b) =>
    a.joinedAt.getTime() - b.joinedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const memberIndex = new Map(members.map((member, index) => [member.id, index]));
  if (memberIndex.size !== members.length) invalid("Party members must be unique");
  if (input.items.some((item) => item.totalPrice < 0n)
    || input.items.reduce((sum, item) => sum + item.totalPrice, 0n) !== input.subtotal) {
    invalid("Items must sum to the receipt subtotal");
  }

  const exactSubtotals: Fraction[] = members.map(() => ({ numerator: 0n, denominator: 1n }));
  if (input.splitMode === "EVEN") {
    exactSubtotals.fill(fraction(input.subtotal, BigInt(members.length)));
  } else {
    for (const item of input.items) {
      if (item.shares.length === 0) invalid("Every item must have at least one share");
      const assigned = new Set<string>();
      for (const share of item.shares) {
        if (!memberIndex.has(share.memberId) || assigned.has(share.memberId)
          || !Number.isInteger(share.weight) || share.weight <= 0 || share.weight > 2147483647) {
          invalid("Item shares must reference party members with positive integer weights");
        }
        assigned.add(share.memberId);
      }
      const totalWeight = item.shares.reduce((sum, share) => sum + BigInt(share.weight), 0n);
      for (const share of item.shares) {
        const index = memberIndex.get(share.memberId)!;
        exactSubtotals[index] = add(exactSubtotals[index], fraction(item.totalPrice * BigInt(share.weight), totalWeight));
      }
    }
  }

  const subtotal = roundColumn(input.subtotal, exactSubtotals);
  const proportionalColumn = (amount: bigint) => roundColumn(amount, exactSubtotals.map((value) =>
    fraction(amount * value.numerator, input.subtotal * value.denominator),
  ));
  const taxShare = proportionalColumn(input.tax);
  const tipShare = proportionalColumn(input.tip);
  return members.map((member, index) => ({
    memberId: member.id,
    subtotal: subtotal[index],
    taxShare: taxShare[index],
    tipShare: tipShare[index],
    amountOwed: subtotal[index] + taxShare[index] + tipShare[index],
  }));
}
