---
type: feature
---
# The organizer corrects and confirms a draft receipt at a known revision

## Why

OCR mistakes must be corrected and reviewed before the server creates bills;
a stale editor must not overwrite or finalize someone else's newer draft.

## Where it lives

- packages/domain/src/receipt.ts: UpdateReceipt, updateReceipt and receipt validation.
- packages/domain/src/receipt-access.ts: owner/state/revision lock.
- apps/web/app/api/receipts/[id]/route.ts: PATCH.
- apps/web/tests/receipt-route.test.ts.

## Behavior

- JSON requires expectedRevision plus at least one editable field.
- Editable fields are title, merchantName, address, purchasedAt, subtotal, tax,
  tip, total, paidByParticipantId, splitMode and reviewConfirmed.
- Metadata can be null. Non-null title/name/address are trimmed, nonblank and
  bounded to 100/200/500 characters. Dates require ISO datetime with an offset.
- Money is a nonnegative decimal string, at most two fractional and ten integer
  digits; raw strings are bounded to 64 characters. Amount fields may be null.
- Split mode is EVEN, ITEMIZED or SHARED_ITEMS. Payer is null or a participant
  of this receipt; unknown/foreign participants return 404.
- Unknown fields, including ownerId/status/revision, are ignored.
- Unknown users receive 401. Foreign/deleted/missing receipts receive 404.
  Finalized, parsing or stale requests receive 409.
- One transaction locks and advances revision before updates. Failures roll
  back fields, revision and any allocation cleanup.
- Content/monetary corrections clear reviewedAt. Split/payer changes advance
  revision while retaining confirmation of the receipt information.
- Switching to EVEN clears individual and shared allocations. Switching to
  ITEMIZED clears shared allocations, leaving those items to be assigned.
  Switching to SHARED_ITEMS preserves individual assignments.
- reviewConfirmed: true validates complete items and reconciled receipt amounts,
  marks the items verified and records reviewedAt in the same transaction.
  Corrected FAILED OCR can be confirmed without pretending parsing succeeded.
- Success returns receipt detail and revalidates its path.

## Examples

| Input / state | Result |
|---|---|
| Matching revision and nullable corrected metadata | 200, revision advances, review clears |
| Matching revision and reviewConfirmed: true | 200 with reviewedAt after reconciliation |
| Inconsistent total plus confirmation | 400; corrections and revision roll back |
| Concurrent writes with the same revision | One 200, one 409 |
| Payer from a different receipt | 404, unchanged receipt |

## Verify

- pnpm test covers malformed input, money bounds, nulls, ownership, mode changes,
  review, stale/concurrent writes and state guards in receipt-route.test.ts.
- The isolated seed drill confirms then finalizes a corrected receipt.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- The lock also coordinates item/assignment/finalization transactions.
- Inconsistent draft amounts may be saved for correction; confirmation and
  finalization require reconciliation. No bill totals are accepted here.
- See model.md and ADR-0014.

## Out of scope

- Item collection replacement: items.md.
- Upload/OCR, participant editing and finalized financial edits are separate work.
