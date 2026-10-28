---
type: feature
---
# The organizer reads a receipt and its receipt-local participants and items

## Why

The organizer needs stored correction and assignment state to resume a draft
and inspect a finalized receipt without exposing internal parser/blob data.

## Where it lives

- packages/domain/src/receipt.ts: getReceipt and receiptDetail.
- packages/domain/src/receipt-access.ts: direct owner scope and missing-ID guard.
- apps/web/app/api/receipts/[id]/route.ts: GET.
- apps/web/tests/receipt-route.test.ts.

## Behavior

- Existing identity is required (401 otherwise). Only Receipt.ownerId authorizes
  access; missing, foreign and deleted receipts return 404.
- GET returns id, ownerId, title, payer participant, business/parse/split state,
  revision, review/finalization timestamps, merchant/address/purchase date,
  currency, nullable amounts, creation/update times, participants and items.
- Participants include id, displayName, phone and joinedAt, ordered by joinedAt
  then id. This contact projection is organizer-only.
- Items include lineNumber, nullable OCR fields, verification, individual
  assignee and shared participant references, ordered by lineNumber. Shared
  rows use participant joinedAt/id ordering.
- Decimals serialize as strings and timestamps as ISO strings; unknown values
  remain null. Receipt decimals are not forced to two display places.
- Internal extraction, parseError, imageBlobName and deletedAt are excluded.
- Unexpected errors use the generic 500 envelope.

## Examples

| State / input | Result |
|---|---|
| Owner requests a draft | 200 with ordered items and participants |
| Item quantity is unknown | quantity remains null |
| Foreign, deleted, unknown or missing ID | 404, no broader receipt lookup |
| Unknown identity | 401 |

## Verify

- pnpm test runs receipt-route.test.ts against migrated PGlite.
- The domain seed drill reads seed-receipt-demo as demo-user and rejects
  other-user for both receipt and bills.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Explicit projection prevents future columns leaking into API responses.
- Owner-only authorization follows ADR-0014. Reads do not recalculate bills.
- Serving an image needs its own authorized endpoint implementation.

## Out of scope

- Collection HTTP listing, upload, parsing and image download remain scaffolds.
- Corrections: edit.md; item replacement: items.md; domain structure: model.md.
