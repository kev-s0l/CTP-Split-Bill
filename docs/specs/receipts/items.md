---
type: feature
---
# The organizer replaces corrected receipt items before finalization

## Why

Replacing the corrected collection lets the organizer repair OCR lines while
removing assignments that would otherwise point to changed charges.

## Where it lives

- packages/domain/src/receipt.ts: ReplaceItems and replaceReceiptItems.
- packages/domain/src/receipt-access.ts: owner/revision lock.
- apps/web/app/api/receipts/[id]/items/route.ts: PUT.
- apps/web/tests/receipt-route.test.ts.

## Behavior

- Body is {expectedRevision, items:[{lineNumber,name,quantity,unitPrice,totalPrice}]}.
- At most 500 items; an empty array clears the collection.
- Line numbers are unique positive 32-bit integers. Names are trimmed,
  nonblank and at most 200 characters.
- Quantity is a positive decimal string with at most three fractional and seven
  integer digits. Prices are nonnegative strings with at most two fractional
  and ten integer digits. Leading zeros are allowed; strings are bounded.
- Invalid JSON/fields return 400; unknown users 401; foreign/deleted/missing
  receipts 404; finalized, parsing or stale writes 409.
- One receipt-locked transaction deletes shared allocations and old items,
  inserts verified corrected items with generated IDs, clears reviewedAt and
  returns receipt detail at the new revision.
- Individual assignments disappear with old items. New items have no assignee
  or shared allocations. Summary amounts and mode remain unchanged.
- Insert failures restore old items, allocations and revision. Concurrent
  replacements using one expected revision produce one success and one conflict.
- Success revalidates receipt detail. Unexpected failures return generic 500.

## Examples

| Input / state | Result |
|---|---|
| Corrected lines submitted out of order | 200, ordered by line number |
| Old items are assigned or shared | Their assignments disappear atomically |
| Duplicate line numbers or quantity zero | 400, no writes |
| Insert fails after deletion | 500, original collection restored |
| Another organizer's receipt | 404 |

## Verify

- pnpm test runs receipt-route.test.ts, including numeric boundaries, rollback,
  unrelated-data preservation, state checks and concurrent replacement.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- totalPrice is the authoritative line charge; quantity times unitPrice need
  not equal it. Confirmation/finalization reconcile line totals to subtotal.
- Null OCR fields are permitted in storage but corrected replacement requires
  complete fields. New information needs receipt-level review.
- Physical child replacement is allowed because items/allocations have no
  deletedAt; receipts retain soft deletion. See ADR-0014 and model.md.

## Out of scope

- Summary fields: edit.md; assignments: ../bills/allocations.md.
- Image upload/OCR and preserving old item IDs across full replacement.
