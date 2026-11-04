---
type: feature
status: draft
---
# Receipt detail reports whether items add up, and a mismatched receipt cannot finalize

## Why

OCR misses lines. When the items do not add up to the printed subtotal, the
organizer needs to see by how much while correcting, not discover it as an
error when finalizing. The rule itself already exists; this makes it visible.

## Where it lives

- packages/domain/src/receipt.ts: the receipt detail projection and the
  existing reconciliation check used by review confirmation.
- packages/domain/src/split.ts: the unchanged finalization check.
- apps/web/app/api/receipts/[id]/route.ts: GET (response gains fields).

## Behavior

- Receipt detail adds a `totals` object computed in integer cents from stored
  values:
  - `itemsTotal`: sum of item totalPrice, or null if any item total is null.
  - `itemsDifference`: subtotal − itemsTotal, or null if either is null.
  - `amountsDifference`: total − (subtotal + tax + tip), with null tip as zero,
    or null if subtotal, tax or total is null.
  - `reconciled`: true only when both differences are exactly "0.00".
  Amounts are two-decimal strings, matching bills/list.md.
- The values are derived on read; nothing is stored.
- Review confirmation and finalization keep their existing rule
  (receipts/edit.md, bills/split-allocation.md): a receipt whose items do not
  sum to its subtotal, or whose amounts do not sum to its total, is rejected
  with 400 and writes nothing. There is no override.
- The organizer resolves a mismatch by correcting an item, adding the missing
  item, or correcting the subtotal.

## Examples

| Items / amounts | totals |
|---|---|
| Items 61.50, subtotal 64.00, tax 5.68, tip 11.52, total 81.20 | itemsDifference "2.50", amountsDifference "0.00", reconciled false |
| Items 64.00, same amounts | both "0.00", reconciled true |
| One item with null totalPrice | itemsTotal null, itemsDifference null, reconciled false |
| Finalize while itemsDifference is "2.50" | 400; no bills |

## Verify

- pnpm test covers each totals field, null propagation, negative differences
  (items over subtotal), and that finalization still rejects a mismatch.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- No "finalize anyway". Bills must reconcile to the receipt to the cent
  (bills/split-allocation.md), so an unexplained gap is never silently spread
  across people.
- Differences are signed, so the UI can say "short" or "over".

## Out of scope

- An explicit adjustment line (service fee, discount) as its own item type.
  Today it is entered as an ordinary item.
- OCR confidence or per-line warnings (upload/parse work, unspecified).
