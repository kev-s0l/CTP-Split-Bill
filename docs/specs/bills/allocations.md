---
type: feature
---
# The organizer assigns personal items and separately allocates shared items

## Why

Itemized bills give each item one owner. A separate shared-items mode supports
equal appetizers and other shared charges without arbitrary weights.

## Where it lives

- packages/domain/src/bills.ts: ReplaceAssignments, ReplaceSharedAllocations and
  their transaction functions.
- apps/web/app/api/receipts/[id]/assignments/route.ts: PUT.
- apps/web/app/api/receipts/[id]/shared-allocations/route.ts: PUT.
- apps/web/tests/bills-route.test.ts.

## Behavior

- Both bodies require expectedRevision and use the owner/state/revision lock.
- assignments contains [{itemId,participantId}], with at most 500 unique item
  IDs. It replaces all individual assignments on the receipt. Assigning a
  formerly shared item clears that item's sharing in the same transaction.
- Shared allocations contains [{itemId,participantIds}], with at most 500
  unique items and 2-200 distinct participants per item. It replaces all
  shared rows and clears personal assignees on newly shared items.
- IDs are trimmed, nonblank strings bounded to 200 characters. Every reference
  must belong to this receipt; unknown/foreign references return 404.
- EVEN rejects individual assignments with 409. Shared allocation writes
  require SHARED_ITEMS, otherwise 409. ITEMIZED permits one-person assignments.
- Empty arrays clear the corresponding collection; incomplete drafts may be
  saved. Finalization checks that every item has the representation its mode
  requires, never both individual and shared.
- Receipt information review is retained because item contents do not change;
  revision advances so existing previews become stale.
- Invalid input returns 400; unknown user 401; foreign/deleted receipt 404;
  finalized/parsing/stale state 409. Failures roll back all changes.
- Success returns receipt detail and revalidates its path.

## Examples

| Input / state | Result |
|---|---|
| ITEMIZED assignment of steak to Alex | Full item belongs to Alex |
| Same item submitted twice | 400 |
| SHARED_ITEMS appetizer for Alex and Sam | Equal shared rows |
| Shared group contains one person or duplicates | 400 |
| Shared item becomes personal | Old sharing clears atomically |
| Insert fails during replacement | Old allocations and revision restored |

## Verify

- pnpm test runs bills-route.test.ts for references, mode separation, empty
  collections, validation, rollback, stale writes and finalization races.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Composite foreign keys reinforce same-receipt references. Domain validation
  handles counts and mutual exclusion; no weighted input is stored.
- Separate input operations preserve a clear distinction between one-person
  item assignment and shared items. See ADR-0014 and ../receipts/model.md.

## Out of scope

- Participant roster editing, weighted sharing and unit-by-unit ownership of
  one quantity line. Separate corrected lines represent separate owners.
