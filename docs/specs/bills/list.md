---
type: feature
---
# A party member can read a receipt's bill breakdown and settlement status

## Why
Members need to see the final per-person charges and whether each bill is
settled, including the member who paid for the original receipt.

## Where it lives
- `packages/domain/src/bills.ts`: `listReceiptBills()` and bill projection.
- `apps/web/app/api/receipts/[receiptId]/bills/route.ts`: GET handler.
- `apps/web/tests/bills-route.test.ts`: route integration tests with PGlite.

## Behavior
- GET requires server-derived identity. An unknown user receives 401.
- Any receipt party member may read all its bills. Unknown, foreign, or
  deleted receipts and receipts in deleted parties receive 404 `NOT_FOUND`.
- Success returns 200 with an array ordered by member joinedAt, then id.
- Each bill contains `id`, `receiptId`, `memberId`, `displayName`, `subtotal`,
  `taxShare`, `tipShare`, `amountOwed`, `amountPaid`, `settled`, and `createdAt`.
- Amounts are decimal strings with two fractional digits. Dates are ISO
  strings. `amountPaid` sums recorded payments without changing them.
- `settled` is true when payments cover amountOwed, or when the member is
  the receipt's paidBy member. Zero-owed bills also count as settled.
- A receipt with no bills returns `[]`, including an unfinalized receipt.
- Email, phone, user ids, raw extraction, image locations, and payment records
  are not exposed. This endpoint performs no writes.
- Unexpected failures are logged and return generic 500 `INTERNAL`.

## Examples

| State / input | Behavior |
|---|---|
| A finalized receipt has three members | 200; three bill breakdowns in member order |
| Payer has no recorded payment | Its bill is settled and amountPaid is 0.00 |
| Payments partially cover another member's bill | amountPaid is their sum; settled is false |
| Payments cover or exceed amountOwed | settled is true |
| Receipt has no bills yet | 200 with `[]` |
| Another party's member requests it | 404 |

## Verify
- `pnpm --dir apps/web exec vitest run tests/bills-route.test.ts` exercises
  happy and foreign-user paths, missing resources, soft deletion, empty
  results, field projection, ordering, payment sums, and settlement rules.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- Drill: finalize the seeded receipt, GET its bills and verify the charges
  sum to the receipt total. Repeat as other-user; expect 404.

## Constraints & decisions
- Bills are stored snapshots, not recalculated by reads; see
  [split-allocation](split-allocation.md).
- The payer's settlement is derived rather than represented by a synthetic
  payment. No dependencies or schema changes are needed.
- The route is dynamic and uses the normal scoped domain/auth seams, per
  [ADR-0009](../../adr/0009-domain-web-only.md).

## Out of scope
- Generating bills: [split-allocation](split-allocation.md).
- Payment recording and changing settled status: no accepted feature spec yet.
- Public sharing: [public-share](public-share.md).
