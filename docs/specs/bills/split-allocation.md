---
type: feature
---
# Finalization allocates every receipt cent into immutable participant bills

## Why

The organizer needs a reconciled, deterministic final breakdown whose food,
tax, tip and total columns match the corrected restaurant receipt.

## Where it lives

- packages/domain/src/split.ts: unchanged pure BigInt/fraction allocator.
- packages/domain/src/bills.ts: owner-locked finalization and input translation.
- apps/web/app/api/receipts/[id]/finalize/route.ts: POST.
- packages/domain/tests/split.test.ts and apps/web/tests/bills-route.test.ts.

## Behavior

- Body requires {expectedRevision}. Client-provided bill amounts are ignored.
- Unknown user is 401; foreign/deleted/missing receipt 404; finalized, parsing
  or stale state 409. A receipt is locked and revision advanced transactionally.
- Receipt information must be reviewed, items verified and complete, subtotal
  positive, amounts nonnegative, items summed to subtotal, and subtotal + tax +
  tip equal total. Null tip means zero. At least one participant is required.
- EVEN permits no assignments and divides subtotal equally among participants.
- ITEMIZED requires one personal assignee per item and no shared rows.
- SHARED_ITEMS permits either one assignee or at least two equal shared rows
  per item, never both. All references belong to this receipt.
- Personal items translate into one weight-1 input. Shared items translate into
  weight-1 inputs per participant. Both reuse the existing ITEMIZED arithmetic.
- Tax and tip are proportional to exact, unrounded item subtotals.
- Each of subtotal, tax and tip is rounded independently by largest remainder:
  floor exact fractions, distribute leftover cents by largest fractional part,
  then break ties by participant joinedAt and id.
- amountOwed is subtotal + taxShare + tipShare. Every column and the final total
  reconcile exactly. Zero-subtotal participants receive zero tax and tip.
- One transaction creates one Bill per participant, marks FINALIZED and records
  finalizedAt. Any insertion/status failure restores the draft and revision.
- Repeated or competing finalization produces one success and a 409, with no
  duplicate bills. Competing edits use the same revision lock.
- Success returns receipt detail and revalidates receipt and bill-list paths.
- The payer also receives a bill for reconciliation and counts as settled.

## Examples

| Input | Result |
|---|---|
| EVEN: 10.00, three participants | 3.34 / 3.33 / 3.33 |
| ITEMIZED: Alex 20.00, Sam 10.00; tax 2.70, tip 6.00 | 25.80 / 12.90 |
| SHARED_ITEMS: Alex steak 20.00; Alex+Sam appetizer 10.00; tax 2.70, tip 6.00 | 32.25 / 6.45 |
| Missing assignment, unreviewed or inconsistent amounts | 400; no bills |
| Two finalizers use one revision | One 200 and one 409 |
| Final status write fails after inserts | Full rollback |

## Verify

- pnpm test runs 500 deterministic generated arithmetic cases with independent
  fraction checks, plus integration coverage for all modes, ownership,
  review/state guards, insert/status rollback and concurrent writes.
- The isolated seed drill confirms/finalizes the seeded receipt and checks its
  bill sum is 38.66. It rejects other-user and repeated finalization.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Integer cents and reduced fractions preserve the existing calculation engine.
- Bill amounts are snapshots and no arbitrary bill creation API exists.
- totalPrice is authoritative; item quantity/unit-price equality is not imposed.
- Discounts, service fees, percentage-tip intent and multiple tax lines are not
  modeled. Corrected totals must obey the current reconciliation rule.
- See ADR-0014 and ../receipts/model.md.

## Out of scope

- Preview HTTP implementation, reopening finalized receipts, recording payments,
  weighted splitting and automatic SMS delivery.
