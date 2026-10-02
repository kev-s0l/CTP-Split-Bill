---
type: feature
---
# Finalizing a receipt allocates every cent to exactly one member

## Why
A split only earns trust if it adds up. When a receipt is finalized, each
member gets a bill for their food plus a fair part of the tax and tip. The
bills always sum to the receipt total, with no missing or extra cent.

## Where it lives
- `packages/db/prisma/schema.prisma`: `Receipt`, `ReceiptItem`,
  `ItemShare`, `Bill`.
- `packages/domain/`: `allocateSplit()` (a pure function: receipt and
  shares in, per-member cents out) and `finalizeReceipt()` (validates,
  calls `allocateSplit`, and writes the bills and status in one
  transaction).

## Behavior
- All arithmetic is in integer cents, never floats.
- **Member subtotals.**
  - `EVEN` mode: every party member's exact subtotal is
    `receipt.subtotal ÷ member count`.
  - `ITEMIZED` mode: each item's `totalPrice` is divided among its
    `ItemShare` rows in proportion to `weight`. A member's exact subtotal
    is the sum of their portions.
- **Tax and tip.** Each is allocated in proportion to the member's exact
  subtotal: `tax × memberSubtotal ÷ receipt.subtotal`, and the same for
  tip. A member with a zero subtotal pays zero tax and tip.
- **Rounding (largest remainder).** Subtotal, tax, and tip are rounded as
  three separate columns. For each column:
  1. Floor every member's exact amount to the cent.
  2. Leftover cents = the column's receipt amount minus the sum of the
     floors. This is always fewer than the member count.
  3. Give one extra cent to each of the members with the largest dropped
     fractions, largest first, until none are left.
  4. Break ties by earliest `joinedAt`, then by `id`. This makes the
     result deterministic: the same input always gives the same bills.
- `amountOwed = subtotal + taxShare + tipShare`. Because each column sums
  exactly, the bills sum to `receipt.subtotal + tax + tip`.
- **Preconditions.** Finalizing is rejected with 400 unless all of these
  hold:
  - status is `PARSED`
  - subtotal, tax, and total are present (tip may be null, meaning 0)
  - the item `totalPrice`s sum to `subtotal`
  - `subtotal + tax + tip = total`
  - `subtotal > 0`
  - in `ITEMIZED` mode, every item has at least one share
- The bills and the `FINALIZED` status are written in one transaction.
  Finalizing an already-finalized receipt returns 409.
- The `paidBy` member also gets a bill, so the breakdown is complete. That
  bill counts as settled without any payment.
- A foreign or unknown receipt id returns 404.

## Examples

| State / input | Behavior |
|---|---|
| EVEN, $10.00 subtotal, 3 members, no tax/tip | 3.34 / 3.33 / 3.33; the earliest-joined member gets the extra cent |
| ITEMIZED: A $20 steak; A+B share a $10 app (weight 1 each); tax $2.70, tip $6.00 | A: 25.00 + 2.25 + 5.00 = 32.25; B: 5.00 + 0.45 + 1.00 = 6.45; sum 38.70 = total |
| ITEMIZED: $1.00 item split 3 ways, tax $0.10 | Subtotal column 0.34/0.33/0.33; tax column 0.04/0.03/0.03; bills sum to $1.10 |
| Member assigned no items (ITEMIZED) | Bill of 0.00 / 0.00 / 0.00 |
| Item with no shares (ITEMIZED) | 400, nothing written |
| Items sum $41.00, subtotal $42.00 | 400, nothing written |
| Finalize twice | Second call 409 |

## Verify
- `pnpm test`: unit tests for `allocateSplit` covering each row above.
- A property test: for random receipts and share sets, the bills always sum
  to the total, and each member's share stays within one cent of their
  exact share in each column.
- An integration test: when a bill insert fails partway through
  finalizing, no bills are left behind and the status stays `PARSED`.

## Constraints & decisions
- Largest remainder, not "round each share". Rounding every share on its
  own can leave the total off by several cents.
- Tax and tip are rounded as separate columns. Each one then matches its
  receipt line exactly, so a member can check their share against the
  receipt.
- Tax and tip are proportional to subtotal, never split evenly. Someone who
  ordered a side salad doesn't pay the same tip as someone who ordered a
  steak.
- Bills are a snapshot. Editing items after finalizing is not supported;
  un-finalizing would be a separate spec.
- Discounts, service fees, and multiple tax lines are not modeled. A
  receipt with them fails the `subtotal + tax + tip = total` check until
  it is corrected by hand.

## Out of scope
- AI parsing that fills the receipt fields: no spec yet.
- Recording payments against bills: no spec yet.
- Viewing bills via a share link: see [public-share](public-share.md).
