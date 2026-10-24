---
type: feature
---
# A party member can replace a receipt's item allocations before finalization

## Why
Members need to assign each item to the people sharing it, with weights for
unequal portions, before an itemized receipt can produce accurate bills.

## Where it lives
- `packages/domain/src/bills.ts`: `ReplaceShares` and `replaceReceiptShares()`.
- `packages/domain/src/receipt-access.ts`: scoped receipt locking.
- `apps/web/app/api/receipts/[receiptId]/allocations/route.ts`: PUT handler.
- `apps/web/tests/bills-route.test.ts`: route integration tests with PGlite.

## Behavior
- PUT accepts JSON `{ shares: [{ itemId, memberId, weight }] }`.
- Ids are non-blank strings. Weight is a positive integer no greater than
  2147483647. Each item/member pair occurs at most once. Unknown fields are
  ignored. Invalid JSON or schema violations return 400 `INVALID_INPUT`.
- Identity is server-derived; an unknown user returns 401 `UNAUTHENTICATED`.
- Any party member may replace allocations. An unknown, foreign, or deleted
  receipt, including one in a deleted party, returns 404 `NOT_FOUND`.
- Every referenced item belongs to this receipt and every member belongs to
  its party, including guests. Unknown or foreign references return the same
  404 without changing existing shares.
- A finalized receipt returns 409 `CONFLICT`.
- The receipt is locked before checking references and replacing all its
  shares in one transaction. Failed inserts restore the old shares.
- An empty array clears allocations. Items need not all be assigned here;
  itemized finalization rejects incomplete allocations.
- Success returns 200 `{ shares: [{ itemId, memberId, weight }] }`, ordered
  by item line number, then member joinedAt and id.
- Receipt fields, items, and allocations on other receipts are unchanged.
- Unexpected failures are logged and return generic 500 `INTERNAL`.

## Examples

| State / input | Behavior |
|---|---|
| A member assigns an item to a guest with weight 2 | 200; stored allocations are replaced |
| An item belongs to another receipt or a member to another party | 404; existing allocations remain |
| Weight is zero, fractional, or too large | 400; no changes |
| A pair occurs twice | 400; no changes |
| `shares: []` | 200; this receipt has no shares |
| Receipt is finalized | 409; no changes |

## Verify
- `pnpm --dir apps/web exec vitest run tests/bills-route.test.ts` covers
  success, validation, identity, foreign and unknown references, soft
  deletion, finalized state, rollback, and concurrent replacements.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- Drill: use the seeded receipt's item ids and party member ids in a PUT;
  expect 200. Repeat with `x-user-id: other-user`; expect 404, no changes.

## Constraints & decisions
- Validation and queries are web-only domain responsibilities, per
  [ADR-0009](../../adr/0009-domain-web-only.md).
- The same receipt lock coordinates item replacement, allocation replacement,
  and finalization, so references cannot be checked against replaced items.
- Shares have no soft-delete field; replacement removes them physically.
- Replacing allocations does not switch the receipt's split mode. Summary
  edits own that choice.

## Out of scope
- Receipt summary fields: [receipt edit](../receipts/edit.md).
- Replacing items: [receipt items](../receipts/items.md).
- Bill calculation and finalization: [split-allocation](split-allocation.md).
- Payment recording: no accepted feature spec yet.
