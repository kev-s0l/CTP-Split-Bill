---
type: feature
---
# Creating a party makes the caller its organizer and first member

## Why
A party is the container for everything else: members, receipts, and bills
all hang off one. Whoever creates it organizes it, and needs to be inside it
from the first moment so they can add people and receipts.

## Where it lives
- `packages/domain/src/parties.ts`: `CreateParty` (Zod) and `createParty()`.
- `packages/domain/src/errors.ts`: the shared error helpers.
- `apps/web/app/api/parties/route.ts`: `POST /api/parties`.

## Behavior
- The body is `{ name }`. `name` is trimmed, then must be 1–100 characters.
  Any other field is dropped, so a client cannot set `organizerId`.
- `organizerId` is the current user from `currentUserId()`.
- The party and the organizer's `PartyMember` row (`displayName` = the user's
  `name`) are written together in one nested create, so a party never exists
  without its organizer as a member.
- Success returns 201 with `{ id, name, organizerId, createdAt }`. The share
  token is never returned.
- A body that fails validation, or is not valid JSON, returns 400
  `INVALID_INPUT` with the first issue as the message, and writes nothing.
- An identity with no `User` row returns 401 `UNAUTHENTICATED` and writes
  nothing.
- Any unexpected failure returns 500 `INTERNAL` with a generic message; the
  real error is logged, never sent.

## Examples

| State / input | Behavior |
|---|---|
| `{ "name": "Sushi night" }` | 201; party with `organizerId` = me; one member row for me |
| `{ "name": "  Tacos  " }` | 201; name stored as `Tacos` |
| `{ "name": "" }` or `{ "name": "   " }` | 400 `{ error: { code: "INVALID_INPUT", message: "name: Name is required" } }` |
| 101-character name | 400 `INVALID_INPUT` |
| `{not json` (or a JSON `null` body) | 400 `INVALID_INPUT`, message `Body must be valid JSON` |
| `{ "name": "x", "organizerId": "bob" }` | 201; `organizerId` is still me |
| `x-user-id` for a user that doesn't exist | 401 `UNAUTHENTICATED`; nothing written |

## Verify
- `pnpm test`: `packages/domain/tests/parties.test.ts` and
  `apps/web/tests/parties-route.test.ts` cover every row above.
- Drill, with `pnpm dev` running and `pnpm db:seed` applied:
  `curl -i -X POST localhost:3000/api/parties -H 'content-type: application/json' -d '{"name":""}'`
  returns 400 in the error shape; with `-d '{"name":"Test"}'` returns 201.

## Constraints & decisions
- The organizer is always a member. Membership is then the single access
  check for every party-scoped endpoint ([api](../api.md)).
- An unknown identity is 401, not 404: the problem is who is asking, not
  what they asked for. With real auth this case becomes "no session".
- Names are not unique: two parties may share a name.

## Out of scope
- Adding other members: `parties/members.md`.
- Editing, deleting, or sharing a party: no spec yet, except the share link
  in [public-share](../bills/public-share.md).
