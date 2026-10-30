---
type: feature
---
# A party member can read a receipt and its ordered line items

## Why
A member needs the corrected receipt details and line items before deciding
how the bill should be split. The detail endpoint provides that view without
exposing storage locations, parser diagnostics, or another party's data.

## Where it lives
- `packages/domain/src/receipt.ts`: `getReceipt()` performs the scoped query.
- `packages/domain/src/errors.ts`: shared API errors and unexpected-error
  mapping.
- `apps/web/app/api/receipts/[receiptId]/route.ts`:
  `GET /api/receipts/[receiptId]`.
- `apps/web/tests/receipt-route.test.ts`: route-level integration coverage.

## Behavior
- Identity comes from `currentUserId()`; the client does not supply a user id.
- An identity with no `User` row receives 401 `UNAUTHENTICATED`.
- A receipt is visible when it is not soft-deleted, its party is not
  soft-deleted, and the current user has a `PartyMember` row in that party.
- An unknown, foreign, or soft-deleted receipt receives 404 `NOT_FOUND`.
  A receipt in a soft-deleted party also receives 404.
- Success returns 200 with these receipt fields:
  `id`, `partyId`, `paidByMemberId`, `status`, `splitMode`, `merchantName`,
  `address`, `purchasedAt`, `currency`, `subtotal`, `tax`, `tip`, `total`,
  `createdAt`, and `items`.
- Each item contains `id`, `lineNumber`, `name`, `quantity`, `unitPrice`,
  `totalPrice`, and `isVerified`.
- Items are ordered by `lineNumber` ascending. A receipt with no items returns
  `items: []`.
- Dates are JSON ISO-8601 strings when present. Prisma decimal values are JSON
  strings when present; nullable receipt fields remain `null`.
- The response does not expose `uploadedById`, `imageBlobName`,
  `imageContentType`, `extraction`, `parseError`, or `deletedAt`.
- Unexpected failures return 500 `INTERNAL` with a generic message; the real
  error is logged and never returned to the client.

## Examples

| State / input | Behavior |
|---|---|
| I am a member and request a receipt with line numbers 2 then 1 in storage | 200; receipt details are returned and items appear as line 1, then line 2 |
| I am a member and the receipt has no items | 200; receipt details with `items: []` |
| Another party's member requests the receipt id | 404 `{ error: { code: "NOT_FOUND", message: "Receipt not found" } }` |
| The receipt or its party is soft-deleted | 404 `NOT_FOUND` |
| The identity has no `User` row | 401 `UNAUTHENTICATED` |
| The database query throws unexpectedly | 500 `{ error: { code: "INTERNAL", message: "Something went wrong" } }` |

## Verify
- `pnpm --filter @project/web test -- receipt-route.test.ts` covers the
  successful response, ordered items, excluded internal fields, and a foreign
  user's 404 response.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- With `pnpm dev` running and `pnpm db:seed` applied,
  `curl -i localhost:3000/api/receipts/seed-receipt-demo` returns 200 and
  ordered items; the same request with `-H 'x-user-id: other-user'` returns
  404 in the shared error shape.

## Constraints & decisions
- Any party member may read the receipt; detail access is not restricted to
  the organizer, uploader, or payer because membership is the shared access
  rule in [the API contract](../api.md).
- The query uses an explicit field selection so new database columns do not
  become API fields accidentally.
- Internal blob names and parser diagnostics remain server-only. Serving the
  receipt image requires a separate authorized download contract.
- The endpoint returns stored values without recalculating or validating
  totals. Finalization owns arithmetic validation.
- The endpoint is dynamic and is not statically cached by Next.js.

## Out of scope
- Listing a party's receipts: no implemented route or accepted feature spec.
- Uploading, parsing, editing, or replacing receipt items: no accepted feature
  specs yet.
- Assigning item shares and generating bills: see
  [split-allocation](../bills/split-allocation.md) for finalization behavior.
- Downloading the receipt image: no feature spec yet.
