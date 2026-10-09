---
type: feature
---
# A party member can replace a receipt's line items before finalization

## Why
Receipt extraction can misread or omit line items. A party member can replace
the collection with corrected items before allocating shares and finalizing.

## Where it lives
- `packages/domain/src/receipt.ts`: `ReplaceItems`, its inferred input type,
  and `replaceReceiptItems()` own validation and scoped database operations.
- `packages/domain/src/receipt-access.ts`: shared receipt scoping and locking.
- `apps/web/app/api/receipts/[receiptId]/items/route.ts`:
  `PUT /api/receipts/[receiptId]/items` wires identity, validation, errors,
  and receipt-detail cache revalidation.
- `apps/web/tests/receipt-route.test.ts`: real route handlers against PGlite.

## Behavior
- Identity comes from the auth seam. An identity without a user row receives
  401 `UNAUTHENTICATED`.
- The JSON body contains a required `items` array. Each item requires
  `lineNumber`, `name`, `quantity`, `unitPrice`, and `totalPrice`.
- Line numbers are unique positive integers no greater than 2147483647.
  They need not be consecutive or submitted in order.
- Names are trimmed and must not be blank.
- Quantity is a positive decimal string with at most three fractional digits
  and seven integer digits, matching the database's `Decimal(10,3)`.
- Prices are non-negative decimal strings with at most two fractional digits
  and ten integer digits, matching `Decimal(12,2)`.
- Leading zeros are accepted and do not count toward integer digit limits.
  Numeric JSON values, signed values, and scientific notation are rejected.
- Malformed JSON, invalid fields, and duplicate line numbers receive 400
  `INVALID_INPUT`. Unknown fields are ignored, including submitted item ids
  and verification flags.
- Any member of the receipt's party may replace items. Unknown, foreign, or
  soft-deleted receipts and receipts in soft-deleted parties receive 404
  `NOT_FOUND`. A visible finalized receipt receives 409 `CONFLICT`.
- Replacement deletes the old items' shares, deletes the old items, and
  inserts the complete submitted collection in one transaction. A failure
  restores the old items and shares. Items belonging to other receipts are
  unaffected.
- New items have generated ids and `isVerified: true`, because a member
  explicitly supplied the corrected collection. Existing allocations are
  cleared and must be assigned against the new ids.
- An empty array clears the items and their shares.
- Receipt summary fields, status, and split mode are unchanged. This endpoint
  does not recalculate totals or require quantity times unit price to equal
  total price; finalization owns receipt arithmetic validation.
- Success returns 200 with the same projection as receipt detail GET,
  including items ordered by line number and decimals serialized as strings.
- Concurrent replacements are serialized on the receipt row so each response
  contains its complete replacement and the final collection is one whole
  request. Unexpected errors are logged and return generic 500 `INTERNAL`.

## Examples

| State / input | Behavior |
|---|---|
| Member submits corrected lines 3 and 1 | 200; returns lines 1 and 3, with new ids and verification flags |
| Old items have shares | Shares are removed together with the old items |
| Member submits `items: []` | 200; the collection and its shares are empty |
| Two items have the same line number | 400; old items and shares remain intact |
| Quantity is `0`, or a price is `10000000000.00` | 400; no changes |
| Another party's member requests the receipt | 404; no changes |
| Receipt is finalized | 409; no changes |
| Inserting a replacement fails after deletion | 500; old items and shares are restored |

## Verify
- `pnpm --dir apps/web exec vitest run tests/receipt-route.test.ts` covers the
  examples, malformed JSON, database numeric boundaries, unknown users and
  receipts, soft deletion, non-organizer access, unrelated data preservation,
  revalidation, and concurrent replacements.
- The rollback test installs an insert-failure trigger in its isolated
  in-memory database and confirms old items and shares survive the failure.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- Drill with a seeded local server: PUT a JSON body containing one valid
  item to `/api/receipts/seed-receipt-demo/items`; expect 200 with that item.
  GET `/api/receipts/seed-receipt-demo` returns the same items. Repeat the PUT
  with `x-user-id: other-user`; expect 404 with the shared error shape and
  no change to the collection.

## Constraints & decisions
- Validation and queries stay in the web-only domain package, per
  [ADR-0009](../../adr/0009-domain-web-only.md).
- A scoped update that assigns the receipt its existing id locks the parent
  row without changing receipt data. It also checks non-finalized state in
  the write. A failed guard is followed by a scoped lookup to distinguish
  404 from 409. The row lock is held through deletion, insertion, and reading.
- Allocation replacement and finalization take the same receipt lock before
  reading items or calculating bills. Updating status only after an unlocked
  item read would not coordinate safely with item replacement.
- Child deletions retain the membership and soft-deletion scope.
  `ReceiptItem` and `ItemShare` have no soft-delete columns and are removed
  physically. Receipt and party rows are retained.
- Replacing the whole collection invalidates allocations deliberately;
  retaining shares against changed items could assign incorrect charges.
- The route is dynamic and revalidates the receipt-detail API path after
  success. No dependencies or schema changes are required.

## Out of scope
- Summary edits: [edit](edit.md).
- Image upload and parsing: no accepted feature spec yet.
- Assigning shares: [allocations](../bills/allocations.md).
- Generating bills: [split-allocation](../bills/split-allocation.md).
