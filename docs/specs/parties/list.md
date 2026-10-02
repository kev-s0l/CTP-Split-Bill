---
type: feature
---
# A user sees exactly the parties they are a member of

## Why
The parties list is the home screen of the app: where you pick up a split
you're part of. It must show every party you're in, whether you organized it
or were added, and nothing that belongs to anyone else.

## Where it lives
- `packages/domain/src/parties.ts`: `listParties()`.
- `apps/web/app/api/parties/route.ts`: `GET /api/parties`.

## Behavior
- Returns the parties where a `PartyMember` row has `userId` = the current
  user, from `currentUserId()`.
- Includes parties the user organizes and parties they were added to.
- Excludes soft-deleted parties (`deletedAt` set).
- Each party is `{ id, name, organizerId, createdAt }`. The share token is
  never returned.
- Ordered newest first, ties broken by `id`, so the order is stable.
- Returns 200 with `[]` when the user is in no parties.
- Any unexpected failure returns 500 `INTERNAL` with a generic message; the
  real error is logged, never sent.

## Examples

| State / input | Behavior |
|---|---|
| I organize party A; Bob organizes party B | 200 `[A]` |
| Bob adds me to party B | 200 `[B, A]` (newest first) |
| Party A is soft-deleted | Not in the list |
| Party A has a share token | Listed, but without `shareToken` |
| I'm in no parties | 200 `[]` |
| Database query throws | 500 `{ error: { code: "INTERNAL", message: "Something went wrong" } }` |

## Verify
- `pnpm test`: `packages/domain/tests/parties.test.ts` and
  `apps/web/tests/parties-route.test.ts`. Removing the membership filter
  from `listParties()` fails them.
- Drill, with `pnpm dev` running and `pnpm db:seed` applied:
  `curl localhost:3000/api/parties` lists only "Sushi night";
  `curl -H 'x-user-id: other-user' localhost:3000/api/parties` lists only
  "Other's road trip".

## Constraints & decisions
- No pagination yet. A user is in a handful of parties; add it when that
  stops being true.
- Members, receipts, and totals are not included. The list stays one query;
  detail lives in `parties/detail.md`.

## Out of scope
- A single party with its members: `parties/detail.md`.
