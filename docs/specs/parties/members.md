---
type: feature
---

# party organizer add/remove people splitting party's bills

## Why
Before we can split a bill, organizers need to add each member, whether they are a user with an account or a guest who is just a name, and remove
anyone who may not belong in the bill split.

## Where it lives
- `packages/domain/src/members.ts`: `AddMember` (Zod), `addMember()`,
  `removeMember()`, and `requireOrganizer()`.
- `apps/web/app/api/parties/[partyId]/members/route.ts`:
  `POST /api/parties/[partyId]/members`.
- `apps/web/app/api/parties/[partyId]/members/[memberId]/route.ts`:
  `DELETE /api/parties/[partyId]/members/[memberId]`.

## Behavior 
- **Access.** Both endpoints first check the party: it must exist, not be soft-deleted, and have a `PartyMember` row for the current user. If not,
  throw 404 `NOT_FOUND` for security reasons. A member who is not the organizer gets 403 `FORBIDDEN` for security reasons (mentioned in lecture).
- **Adding.** The body is `{ displayName, userId? }`.
  - `displayName` is trimmed, then must be 1–50 characters.
  - No `userId` adds a guest (`userId` null). Any number of guests may
    share a party, even with the same display name.
  - A `userId` must belong to an existing user, else 400 `INVALID_INPUT`
    with message `userId: Unknown user`.
  - The same user twice in one party returns 409 `CONFLICT`.
  - Any other field is dropped, so a client cannot set `partyId` or
    `joinedAt`.
  - Success returns 201 with `{ id, partyId, userId, displayName, joinedAt }`.
  - A body that fails validation, or is not valid JSON, returns 400
    `INVALID_INPUT` and writes nothing.
- **Removing.**
  - The member must belong to the party in the URL, else 404. A member id
    from another party is treated as unknown.
  - The organizer's own membership cannot be removed: 409 `CONFLICT`.
  - A member who has a bill, or who is recorded as having paid a receipt,
    cannot be removed: 409 `CONFLICT`. Nothing is written.
  - Otherwise the member's item shares and the member row are deleted
    together in one transaction, and the response is 204 with no body.
- Any unexpected failure returns 500 `INTERNAL` with a generic message; the
  real error is logged, never sent.

## Examples

| State / input | Behavior |
|---|---|
| Organizer adds `{ "displayName": "Eric" }` | 201; guest member with `userId: null` |
| Organizer adds `{ "displayName": " Bob ", "userId": "bob" }` | 201; member linked to Bob, name stored as `Bob` |
| Organizer adds Bob a second time | 409 `CONFLICT` |
| `{ "displayName": "" }` or a 51-character name | 400 `INVALID_INPUT` |
| `{ "displayName": "X", "userId": "nobody" }` | 400 `INVALID_INPUT`, message `userId: Unknown user` |
| A non-member adds or removes in my party | 404 `NOT_FOUND` |
| A non-organizer member adds or removes | 403 `FORBIDDEN` |
| Party is soft-deleted | 404 `NOT_FOUND` |
| Organizer removes a guest with item shares, no bill | 204; member and shares gone |
| Organizer removes themself | 409 `CONFLICT` |
| Organizer removes a member who has a bill | 409 `CONFLICT`; member still present |
| Organizer removes a member using another party's URL | 404 `NOT_FOUND` |

## Verify
- `pnpm test`: `packages/domain/tests/members.test.ts` and
  `apps/web/tests/members-route.test.ts` cover every row above. Removing the
  organizer check from `requireOrganizer()` fails them.
- Drill, with `pnpm dev` running and `pnpm db:seed` applied:
  - `curl -i -X POST localhost:3000/api/parties/seed-party-demo/members -H 'content-type: application/json' -d '{"displayName":"Kai"}'`
    returns 201.
  - The same request with `-H 'x-user-id: other-user'` returns 404.
  - `curl -i -X DELETE localhost:3000/api/parties/seed-party-demo/members/<id from the 201>`
    returns 204.

## Constraints & decisions
- Only the organizer manages membership. Members leaving on their own is
  not supported yet.
- Removal is a hard delete, not a soft delete: `PartyMember` has no
  `deletedAt`, and a member with no bills has no history worth keeping.
- Members with bills or a paid receipt stay. Finalized bills are a snapshot
  that must sum to the receipt ([split-allocation](../bills/split-allocation.md)),
  and payments hang off them.
- Adding by `userId` assumes the organizer already knows the id. Invites by
  email or link replace this once real auth exists.

## Out of scope
- Seeing a party's members: `parties/detail.md`.
- Inviting by email or phone, and members leaving a party: we have not made a spec yet.
- Renaming a member: no spec yet.