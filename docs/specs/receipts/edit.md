---
type: feature
---
# A party member can correct receipt summary fields

## Why
Receipt extraction can misread merchant names, dates, payers, split mode, and
money fields. A party member needs a small edit endpoint so the receipt can be
made accurate before items are replaced or the bill is finalized.

## Where it lives
- `packages/domain/src/receipt.ts`: `UpdateReceipt` validates the request and
  `updateReceipt()` performs the scoped update.
- `packages/domain/src/errors.ts`: shared API errors and unexpected-error
  mapping.
- `apps/web/app/api/receipts/[receiptId]/route.ts`:
  `PATCH /api/receipts/[receiptId]`.
- `apps/web/tests/receipt-route.test.ts`: route-level integration coverage.

## Behavior
- Identity comes from `currentUserId()`; the client does not supply a user id.
- The request body is JSON and must contain at least one editable field.
- Editable fields are `merchantName`, `purchasedAt`, `subtotal`, `tax`, `tip`,
  `total`, `paidByMemberId`, and `splitMode`.
- `merchantName` is trimmed when present. A blank merchant name is rejected.
- `purchasedAt` is an ISO-8601 datetime string with `Z` or an explicit timezone
  offset when present; the response serializes it in UTC.
- `subtotal`, `tax`, `tip`, and `total` are decimal money strings with at most
  two fractional digits, greater than or equal to zero.
- `paidByMemberId` must be a member of the receipt's party when present.
- `splitMode` must be `EVEN` or `ITEMIZED`.
- Unknown fields are ignored.
- An identity with no `User` row receives 401 `UNAUTHENTICATED`.
- An unknown, foreign, or soft-deleted receipt receives 404 `NOT_FOUND`.
  A receipt in a soft-deleted party also receives 404.
- A finalized receipt receives 409 `CONFLICT` and is not changed.
- Success updates only the provided editable fields and returns 200 with the
  same response shape as `GET /api/receipts/[receiptId]`, including ordered
  line items.
- The update is a single database write after scoped access and state checks.
  The write also filters by membership, soft deletion, and non-finalized status.
- Unexpected failures return 500 `INTERNAL` with a generic message; the real
  error is logged and never returned to the client.

## Examples

| State / input | Behavior |
|---|---|
| I am a member and PATCH `{ "merchantName": "Sushi Place", "tax": "2.66", "total": "38.66" }` | 200; only those fields are changed and the receipt detail response is returned |
| I am a member and PATCH `{ "paidByMemberId": "<member in this party>" }` | 200; the receipt payer is changed |
| I am a member and PATCH `{ "paidByMemberId": "<member in another party>" }` | 400 `INVALID_INPUT`; the receipt is not changed |
| I am a member and PATCH `{ "splitMode": "ITEMIZED" }` | 200; the split mode changes to itemized |
| I send malformed JSON | 400 `{ error: { code: "INVALID_INPUT", message: "Body must be valid JSON" } }` |
| I PATCH an empty object | 400 `INVALID_INPUT` |
| Another party's member requests the receipt id | 404 `{ error: { code: "NOT_FOUND", message: "Receipt not found" } }` |
| The receipt is finalized | 409 `{ error: { code: "CONFLICT", message: "Receipt is finalized" } }` |

## Verify
- `pnpm --filter @project/web test -- receipt-route.test.ts` covers a
  successful partial update, malformed JSON, validation failure, foreign
  receipt 404, foreign payer rejection, and finalized receipt 409, plus unknown
  users, soft deletion, guest payers, and edits by non-organizer party members.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.
- With `pnpm dev` running and `pnpm db:seed` applied,
  `curl -i -X PATCH localhost:3000/api/receipts/seed-receipt-demo -H "content-type: application/json" -d "{\"merchantName\":\"Corrected Sushi Place\",\"tax\":\"2.66\"}"`
  returns 200 with the corrected fields; the same request with
  `-H 'x-user-id: other-user'` returns 404 in the shared error shape.

## Constraints & decisions
- Any party member may correct summary fields because membership is the shared
  receipt access rule in [the API contract](../api.md).
- Finalized receipts are immutable here because bills and payments are
  snapshots of the finalized receipt.
- The endpoint does not recalculate totals or verify that subtotal, tax, tip,
  and total balance. Finalization owns arithmetic validation in
  [split-allocation](../bills/split-allocation.md).
- Replacing line items is separate from editing summary fields so item
  replacement can be transactional with share cleanup.
- The endpoint returns the receipt detail projection so the client has one
  canonical receipt shape after reads and edits.
- The endpoint is dynamic and is not statically cached by Next.js.

## Out of scope
- Uploading or parsing receipt images: see `receipts/upload.md` when that spec
  exists.
- Replacing receipt items: [items](items.md).
- Assigning item shares and generating bills: see
  [split-allocation](../bills/split-allocation.md) for finalization behavior.
- Editing bills or payments after finalization: no feature spec yet.
