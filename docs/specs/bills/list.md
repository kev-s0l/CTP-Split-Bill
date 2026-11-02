---
type: feature
---
# The organizer reads stored bills and tracks whether participants have paid

## Why

An organizer needs each participant's final breakdown and whether an amount
remains unpaid, including their own share if they fronted the restaurant bill.

## Where it lives

- packages/domain/src/bills.ts: listReceiptBills, getBill, SetBillPaid, setBillPaid and common projection.
- apps/web/app/api/receipts/[id]/bills/route.ts: collection GET.
- apps/web/app/api/bills/[billsId]/route.ts: individual GET and paid/unpaid PATCH.
- apps/web/tests/bills-route.test.ts.
- apps/web/tests/bills-paid-route.test.ts.

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
- Individual PATCH accepts paid: boolean and returns the updated bill projection.
  It uses the same user, ownership and deletion guards as individual GET.
- paid: true sets a server timestamp only when paidAt is null; repeated paid
  requests preserve the original timestamp. paid: false clears paidAt.
- PATCH never changes calculated amounts or another participant's bill.
  Additional input fields are ignored. Invalid JSON or a missing/non-boolean paid
  returns 400 with the shared error shape. Successful writes call revalidation.

## Examples

| State | Result |
|---|---|
| Finalized receipt has three participants | Three ordered bills |
| Payer has null paidAt | settled true, outstanding 0.00 |
| Another participant has null paidAt | Outstanding is their full amount |
| That participant is marked paid | Outstanding 0.00, amountOwed unchanged |
| A paid bill is marked paid again | Original paidAt is preserved |
| A non-payer's nonzero bill is marked unpaid | paidAt null; full amount outstanding |
| PATCH has paid: "yes" | 400; bill unchanged |
| Foreign organizer requests a bill ID | 404 |

## Verify

- pnpm test covers collection/individual scoping, deletion, empty results,
  fixed monetary projection, payer/zero/manual-paid settlement and generic errors.
- apps/web/tests/bills-paid-route.test.ts covers successful paid/unpaid requests,
  retries, ignored amount fields, invalid input, unknown users and foreign/deleted bills.
- The domain seed drill checks bill amounts total 38.66 and foreign reads fail.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- paidAt is binary manual tracking, not a payment ledger. No partial sums remain.
- See ADR-0014 and split-allocation.md for immutable calculated snapshots.

## Out of scope

- Personalized message formatting, public links and payment processing remain
  separate features.
