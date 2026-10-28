---
type: feature
---
# The organizer reads stored individual bills and their outstanding amounts

## Why

An organizer needs each participant's final breakdown and whether an amount
remains unpaid, including their own share if they fronted the restaurant bill.

## Where it lives

- packages/domain/src/bills.ts: listReceiptBills, getBill and common projection.
- apps/web/app/api/receipts/[id]/bills/route.ts: collection GET.
- apps/web/app/api/bills/[billsId]/route.ts: individual GET.
- apps/web/tests/bills-route.test.ts.

## Behavior

- Identity must exist (401). Both reads authorize through Receipt.ownerId and
  exclude deleted receipts. Foreign, unknown or missing resources return 404.
- Receipt bill GET returns an array ordered by participant joinedAt then id.
  Before finalization it returns [].
- Individual GET takes a bill ID, not a receipt ID, and returns one object.
- Bills include id, receiptId, participantId, displayName, phone, subtotal,
  taxShare, tipShare, amountOwed, paidAt, createdAt, settled and outstandingAmount.
- Money uses decimal strings with two places. Dates use ISO strings or null.
- settled is true for paidAt, the receipt's original payer or zero amountOwed.
  Outstanding is zero when settled and amountOwed otherwise.
- Reads never change amounts or recalculate the stored snapshot. Phone is
  available only to the owning organizer for preparing a message.
- Unexpected errors use generic 500. Raw extraction/blob data are excluded.

## Examples

| State | Result |
|---|---|
| Finalized receipt has three participants | Three ordered bills |
| Payer has null paidAt | settled true, outstanding 0.00 |
| Another participant has null paidAt | Outstanding is their full amount |
| That participant is marked paid | Outstanding 0.00, amountOwed unchanged |
| Foreign organizer requests a bill ID | 404 |

## Verify

- pnpm test covers collection/individual scoping, deletion, empty results,
  fixed monetary projection, payer/zero/manual-paid settlement and generic errors.
- The domain seed drill checks bill amounts total 38.66 and foreign reads fail.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- paidAt is binary manual tracking, not a payment ledger. No partial sums remain.
- See ADR-0014 and split-allocation.md for immutable calculated snapshots.

## Out of scope

- HTTP paid/unpaid PATCH, personalized message formatting, public links and
  payment processing remain separate features.
