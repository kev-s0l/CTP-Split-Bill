---
type: feature
---
# A member sees a party they belong to, with everyone in it

## Why
Every party screen starts from the party itself: its name, who organizes
it, and who is in it. The members list is what receipts get split across,
so a member needs to see all of them, including guests without an account.

## Where it lives
- `packages/domain/src/parties.ts`: `getParty()`.
- `apps/web/app/api/parties/[partyId]/route.ts`: `GET /api/parties/[partyId]`.

## Behavior
- Returns the party only when a `PartyMember` row has `userId` = the current
  user, from `currentUserId()`.
- An unknown party, a party I am not a member of, and a soft-deleted party
  all return 404 `NOT_FOUND` with the same message, so a caller cannot tell
  them apart.
- The party is `{ id, name, organizerId, createdAt, members }`. The share
  token is never returned.
- Each member is `{ id, userId, displayName, joinedAt }`. `userId` is `null`
  for a guest.
- Members are ordered by `joinedAt`, ties broken by `id`, so the organizer
  comes first and the order is stable.
- The party and its members are read in one query.
- Any unexpected failure returns 500 `INTERNAL` with a generic message; the
  real error is logged, never sent.

## Examples

| State / input | Behavior |
|---|---|
| I organize party A with guest Sam | 200 A with members `[me, Sam]`, Sam's `userId` is `null` |
| Bob organizes party B and added me | 200 B with members `[Bob, me]` |
| Party B exists; I am not a member | 404 `{ error: { code: "NOT_FOUND", message: "Party not found" } }` |
| Party id does not exist | 404, same body |
| Party A is soft-deleted | 404, same body |
| Party A has a share token | 200, without `shareToken` |
| Database query throws | 500 `{ error: { code: "INTERNAL", message: "Something went wrong" } }` |

## Verify
- `pnpm test`: `packages/domain/tests/parties.test.ts` and
  `apps/web/tests/party-detail-route.test.ts`. Removing the membership
  filter from `getParty()` fails them.
- Drill, with `pnpm dev` running and `pnpm db:seed` applied:
  `curl localhost:3000/api/parties/seed-party-demo` returns "Sushi night"
  with Demo User and Sam (guest);
  `curl -i -H 'x-user-id: other-user' localhost:3000/api/parties/seed-party-demo`
  returns 404.

## Constraints & decisions
- Members are returned whole, without pagination. A party is a handful of
  people.
- Receipts and balances are not included. Receipts have their own list
  endpoint (`receipts/list.md`), and totals come from bills
  (`bills/list.md`).
- Members' emails and phone numbers are not returned. Other members only
  need the display name to split a bill.

## Out of scope
- Adding and removing members: `parties/members.md`.
- Renaming or deleting a party: not specified yet.
- The party's receipts: `receipts/list.md`.
