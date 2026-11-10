---
type: feature
---
# The organizer previews allocations for a stored draft revision

## Why

The organizer checks each participant's subtotal, tax, tip and amount owed
before finalization creates the bill snapshots.

## Where it lives

- packages/domain/src/bills.ts: typed shared allocation calculation and previewReceipt.
- apps/web/app/api/receipts/[id]/preview/route.ts: POST.
- apps/web/tests/bills-route.test.ts: preview and finalization regression coverage.

## Behavior

- POST requires a JSON body with a valid expectedRevision. Extra amount fields
  do not affect the calculation; all amounts and assignments come from storage.
- The session user must exist (401). Only the receipt owner can preview it;
  foreign, unknown, deleted and missing receipt IDs return 404.
- Finalized receipts, PARSING receipts and stale revisions return 409.
- Preview uses the same review, item verification, amount reconciliation,
  participant and split-mode checks as finalization. Invalid data returns 400.
- A RepeatableRead transaction reads a consistent snapshot of the receipt and
  its participants, items and shared allocations.
- The response is 200 with receiptId, revision, currency and allocations.
  Each allocation has participantId, subtotal, taxShare, tipShare and amountOwed.
  Amounts are decimal strings with two places, ordered by participant joinedAt
  then id, using the existing exact-cent calculator for all three split modes.
- Preview does not create bills, advance revision, change review/status/times,
  modify assignments or revalidate caches. The returned revision can be used
  for finalization; subsequent edits make that revision stale.
- Unexpected errors retain the standard generic 500 envelope.

## Examples

| State / input | Result |
|---|---|
| EVEN: 10.00 among three participants | 3.34 / 3.33 / 3.33; draft unchanged |
| Personal 20.00 and 10.00; tax 2.70, tip 6.00 | 25.80 / 12.90 |
| One 20.00 personal item and a shared 10.00 item | The existing SHARED_ITEMS calculation is returned |
| Preview then finalize the same revision | Bill amounts match the preview |
| Stale expectedRevision | 409; no changes |
| Unreviewed or incomplete receipt | 400; no changes |

## Verify

- pnpm --dir apps/web exec vitest run tests/bills-route.test.ts checks all split
  modes, preview/finalization amount equality, rounding, unchanged snapshots,
  authentication, ownership, state/revision guards and invalid bodies/data.
- pnpm test, pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Preview and finalization share one typed input projection and calculation
  helper so their validation and allocation amounts stay consistent. The helper
  input is derived from the Prisma projection, including participants, items
  and shared allocations; receipt state and revision are checked before calculation.
- The existing mutation lock increments revision and is used only by writes;
  preview reads a snapshot and checks the requested revision without writing.
- See split-allocation.md and ADR-0014 for ownership and arithmetic contracts.

## Out of scope

- Draft edits, unreviewed estimates, payment tracking, new split methods and
  frontend screens. Finalization remains described in split-allocation.md.
