---
type: feature
status: draft
---
# A guest with a pick link chooses the items they had and marks themselves done

## Why

At the table, the organizer should not have to ask who ate what. Each guest
opens their own link, taps the items they had, and says when they are done,
so the organizer only reviews and fixes the gaps before finalizing.

## Where it lives

- packages/db/prisma/schema.prisma: Participant.pickTokenHash and
  Participant.picksSubmittedAt, added by an append-only migration.
- packages/domain/src/picks.ts: token issue/rotate/revoke, token lookup,
  ReplacePicks validation and the pick transaction.
- packages/domain/src/receipt-access.ts: the existing revision lock, reused.
- apps/web/app/api/receipts/[id]/participants/[participantId]/pick-link/route.ts:
  POST issues or rotates, DELETE revokes (owner-scoped).
- apps/web/app/api/picks/[token]/route.ts: GET projection, PUT picks.
- apps/web/app/api/picks/[token]/done/route.ts: POST done.
- apps/web/app/p/[token]/: the guest pick page.

## Behavior

- Pick links follow ADR-0015. Token routes derive no user identity; the token
  hash lookup is the only scope. Unknown, revoked, finalized, deleted and
  parsing receipts return 404 `NOT_FOUND`, indistinguishable from each other.
- Owner routes use the normal ritual: identity, owner check, 404 for foreign or
  unknown receipts and participants. POST returns `{ url }` once; the raw token
  is never readable again. DELETE clears the hash and picksSubmittedAt.
- GET returns the receipt revision, merchant, purchase date, currency, items
  ordered by lineNumber, every participant's id and display name, the token
  holder's participant id, each item's pickers, and the holder's done state.
  Phones, bills, owner id and image data are never returned.
- PUT takes `{ itemIds }`: the complete set of items the holder had, at most
  500 unique ids, each belonging to this receipt (404 otherwise). It takes no
  expectedRevision: a guest writes only their own rows, so guests picking at
  the same moment are serialized on the receipt row lock instead of rejecting
  each other. Under that lock it reconciles the holder's rows only:
  - An item picked by the holder alone becomes the holder's individual
    assignment.
  - An item picked by two or more participants becomes equal shared
    allocations among them, and the receipt moves to SHARED_ITEMS if it was
    ITEMIZED. EVEN receipts are moved to ITEMIZED on the first pick.
  - Unpicking removes the holder from the item; a shared item left with one
    picker becomes that picker's individual assignment.
  - Other participants' picks are never removed by a guest write.
  The revision advances, so an owner saving over a view from before the pick
  gets 409 and reloads; reviewedAt is kept because receipt content is
  unchanged (same rule as bills/allocations.md).
- POST done sets picksSubmittedAt to now; it is idempotent. A later PUT by the
  same holder clears it until they press done again.
- The owner replacing items (receipts/items.md) clears every participant's
  picksSubmittedAt, since their picks were cleared with the old items.
- Receipt detail adds `hasPickLink` and `picksSubmittedAt` per participant
  for the owner's review screen. Readiness is derived there: a participant is
  ready when submitted, or when they have no link (the owner picks for them).
- Finalization is not gated on readiness. Its existing completeness rules in
  bills/split-allocation.md still apply.
- The pick page sends `Referrer-Policy: no-referrer`, and request logging
  records token routes without the token, so a link does not leak through
  referrers or logs.
- The pick page is phone-first and meets the mobile standard in web.md: each
  item is a full-width row that toggles when tapped anywhere on it, and the
  done action stays reachable without horizontal scrolling.
- Invalid input 400. Failures roll back all changes.

## Examples

| State / input | Behavior |
|---|---|
| Sam's token, PUT rice + mango | Both become Sam's individual assignments |
| Maya then Sam pick the dumplings | Equal shared allocation; ITEMIZED becomes SHARED_ITEMS |
| Sam unpicks dumplings he shared with Maya | Dumplings become Maya's assignment |
| Item id from another receipt | 404, nothing written |
| Token rotated, old link opened | 404 |
| Receipt finalized, link opened | 404 |
| Maya and Sam save picks at the same moment | Both saved, one after the other |
| Guest saves an item the owner has since removed | 404, guest reloads |
| Sam presses done, then edits picks | picksSubmittedAt cleared until done again |

## Verify

- pnpm test covers token issue/rotate/revoke, hash-only storage, the 404
  family, reconciliation of individual and shared rows, mode transitions,
  concurrent guest saves all landing, rollback, and that phones never appear
  in token responses.
- pnpm typecheck and pnpm build pass.
- Drill: issue a link, open /p/<token> in a private window, pick items, then
  confirm the owner's receipt detail shows them and the participant is ready.
- Phone drill: open /p/<token> at 375px wide (devtools or a real phone); pick
  and unpick items by tapping their rows and press done, with no zooming and
  no horizontal scroll.

## Constraints & decisions

- Proposed in ADR-0015; not buildable until it is accepted.
- One token per participant rather than per receipt, so a guest cannot pick
  for someone else and the owner can revoke one person.
- Only hashes are stored, so a database read does not leak working links.
- Weighted portions are out; shared means equal, as in bills/allocations.md.

## Out of scope

- Sending the link by SMS (receipts/participants.md stores phones; delivery is
  worker work that does not exist yet).
- Guests seeing bills after finalization (bills/public-share.md, deferred).
- Guests adding or editing items or other participants.
