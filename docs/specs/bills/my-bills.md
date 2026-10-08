---
type: feature
---
# A user sees every bill they owe, across all their parties

## Why
Bills are produced per receipt, but people owe money across several parties
at once. A diner needs one place that answers "what do I owe, in total,
right now?" without opening each party and each receipt in turn — and a way
to open a single bill to see how that number was reached.

## Where it lives
- `packages/domain/src/bills.ts`: `listBills()` and `getBill()`.
- `packages/domain/src/index.ts`: re-exported through the package barrel;
  `apps/web` reaches them only as `@project/domain` ([ADR-0009](../../adr/0009-domain-web-only.md)).
- `apps/web/app/api/bills/route.ts`: `GET /api/bills`.
- `apps/web/app/api/bills/[billId]/route.ts`: `GET /api/bills/[billId]`.
- `packages/db/prisma/schema.prisma`: `Bill`, `PartyMember`, `Receipt`.

## Behavior

### The list — `GET /api/bills`
- Returns the bills whose `memberId` is one of the current user's
  `PartyMember` rows (`userId` = `currentUserId()`). A bill reaches a user
  through membership only; no party or receipt id is accepted from the
  client.
- Spans every party the user belongs to. A user who is a member of three
  parties sees bills from all three in one list.
- Excludes bills whose receipt or party is soft-deleted
  (`deletedAt` set) — see the soft-delete rule in [api](../api.md).
- Each bill is
  `{ id, receiptId, memberId, subtotal, taxShare, tipShare, amountOwed, createdAt }`.
  `id` is required: the list is what the detail route is reached from.
- The four money fields are `Decimal` columns and serialize as JSON
  **strings** (`"12.34"`), never floats.
- Ordered newest first, ties broken by `id`, so the order is stable across
  requests.
- Returns 200 with `[]` when the user is in no parties, or is in parties
  with no finalized receipts.
- Costs two queries: the user's membership ids, then the bills.

### The detail — `GET /api/bills/[billId]`
- Returns one bill by id, only if that bill belongs to one of the caller's
  memberships.
- The shape is the list shape plus the owning receipt's party:
  `{ …summary, receipt: { partyId } }`.
- A bill id that does not exist, belongs to another user, or hangs off a
  soft-deleted receipt or party returns 404 `NOT_FOUND` — never 403, and
  never a different message between the three cases, so existence is not
  confirmed to a non-owner ([web](../web.md)).

### Both routes
- Identity comes from `currentUserId()`; an identity with no `User` row
  returns 401 `UNAUTHENTICATED`.
- Any unexpected failure returns 500 `INTERNAL` with a generic message; the
  real error is logged, never sent.
- Both are reads. Neither writes anything, and neither creates a bill —
  bills exist only as the output of finalizing a receipt
  ([split-allocation](split-allocation.md)).

## Examples

| State / input | Behavior |
|---|---|
| I'm a member of party A (1 finalized receipt, bill of 12.34) | 200 `[{ id, amountOwed: "12.34", … }]` |
| I'm a member of A and B, each with one bill for me | 200, both bills, newest `createdAt` first |
| Party A's receipt also billed Bob | Bob's bill is absent from my list |
| I'm a guest member (`PartyMember.userId` is null) | Those bills are not in any user's list |
| The receipt was soft-deleted after finalizing | Its bills are absent from the list and 404 on detail |
| I'm in no parties | 200 `[]` |
| `GET /api/bills/<my bill id>` | 200, one bill plus `receipt.partyId` |
| `GET /api/bills/<Bob's bill id>` | 404 `{ error: { code: "NOT_FOUND", message: "Bill not found" } }` |
| `GET /api/bills/nonexistent` | 404, byte-identical to the foreign-bill response |
| `x-user-id` for a user with no `User` row | 401 `UNAUTHENTICATED` |
| Database query throws | 500 `{ error: { code: "INTERNAL", message: "Something went wrong" } }` |

## Verify
- `pnpm test`: `packages/domain/tests/bills.test.ts` and
  `apps/web/tests/bills-route.test.ts` cover every row above. Dropping the
  membership filter from `listBills()`, or the ownership check from
  `getBill()`, must fail them — the foreign-bill row is the test that
  cannot pass by accident.
- Drill, with `pnpm dev` running and `pnpm db:seed` applied:
  `curl localhost:3000/api/bills` lists only the demo user's bills;
  `curl -i -H 'x-user-id: other-user' localhost:3000/api/bills/<demo bill id>`
  returns 404 in the error shape.

## Constraints & decisions
- **Membership is the access check, not party or receipt ownership.** It is
  the same seam every party-scoped endpoint uses ([api](../api.md)), so a
  bill needs no rule of its own.
- **`getBill` takes `userId` as its first argument for a reason**: the
  ownership filter belongs in the query, not in the route. A bill fetched by
  id alone and filtered afterwards is one refactor away from leaking.
- **Money stays `Decimal` end to end.** The API hands the client strings and
  lets it choose a representation; converting to `number` in the query layer
  would reintroduce the float arithmetic that
  [split-allocation](split-allocation.md) exists to avoid.
- **Read-only, and no bill creation here.** Bills are a snapshot written
  atomically when a receipt is finalized. A route that creates a single bill
  from client-supplied amounts would bypass the largest-remainder guarantee
  that makes bills sum to the receipt, so the domain exposes no such
  function.
- No pagination, and no total. A user has a handful of open bills; a
  `sum(amountOwed)` is the client's to compute until that stops being true.
- No payment state. `amountOwed` is what was billed, not what is still
  outstanding.

## Out of scope
- The per-receipt breakdown of who owes what, `GET /api/receipts/[receiptId]/bills`:
  `bills/list.md`, not written yet.
- How bills come to exist: [split-allocation](split-allocation.md).
- Recording and subtracting payments: `bills/payments.md`, not written yet.
- Bills seen through a share link, which is the one unscoped read:
  [public-share](public-share.md).
