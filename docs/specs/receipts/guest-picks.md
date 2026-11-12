---
type: feature
---
# A guest with a pick link chooses the items they had, then sees the split

## Why

At the table, the organizer should not have to ask who ate what. Each guest
opens their own link, taps the items they had, and says when they are done,
so the organizer only reviews and fixes the gaps before finalizing. After the
receipt is finalized, the same link shows what everyone owes, so guests know
what to pay without an account or a second link.

## Where it lives

- packages/db/prisma/schema.prisma: Participant.pickTokenHash,
  Participant.picksSubmittedAt and Receipt.picksOpenedAt, added by
  append-only migrations.
- packages/domain/src/picks.ts: token issue/rotate/revoke, token lookup,
  ReplacePicks validation, reconcileHolderPicks (shared by guest and
  organizer picks), the pick transactions and the picking switch.
- packages/domain/src/receipt-access.ts: lockReceiptForGuest, the guest
  sibling of lockEditableReceipt. Same DRAFT and not-PARSING guard and the
  same revision increment, but no owner and no expected revision, and it
  requires picking to be open where lockEditableReceipt requires it closed.
- packages/domain/src/receipt.ts and receipt-parsing.ts: item replacement and
  parse completion clear every participant's picksSubmittedAt.
- apps/web/app/api/receipts/[id]/participants/[participantId]/pick-link/route.ts:
  POST issues or rotates, DELETE revokes (owner-scoped).
- apps/web/app/api/picks/[token]/route.ts: GET projection (pick or split),
  PUT picks.
- apps/web/app/api/picks/[token]/done/route.ts: POST done.
- apps/web/app/api/receipts/[id]/picking/route.ts: POST open or pause
  (owner-scoped).
- apps/web/app/api/receipts/[id]/picks/route.ts: PUT the organizer's own
  picks (owner-scoped).
- apps/web/app/p/[token]/: the guest page, picking before finalize and the
  split summary after (see Known gaps).
- apps/web/tests/picks-route.test.ts and picking-route.test.ts.

## Behavior

- Pick links follow ADR-0015. Token routes derive no user identity; the token
  hash lookup is the only scope. Unknown, revoked and rotated tokens, removed
  participants, deleted receipts and parsing receipts return 404 `NOT_FOUND`,
  indistinguishable from each other. Tokens have no expiry.
- Owner routes use the normal ritual: identity, owner check, 404 for foreign or
  unknown receipts and participants. Both work on a receipt in any state, so
  the owner can still rotate or revoke after finalize. POST returns
  `{ url }` once, built from the request's origin as `<origin>/p/<token>`; the
  raw token is never readable again. DELETE clears the hash and picksSubmittedAt, and is idempotent. Neither
  changes the receipt revision, because receipt content is unchanged.
- The organizer's own row (receipts/participants.md) never gets a link: POST
  for it returns 400 `INVALID_INPUT` and writes nothing. DELETE for it is the
  usual idempotent no-op, since it has no hash.
- Removing a participant (receipts/participants.md) deletes their row, and
  their hash with it, so their link 404s with no separate revoke.
- The server sends no messages. The owner's screen turns the returned url into
  `sms:` and `mailto:` links pre-filled with the participant's stored phone or
  email (receipts/participants.md), plus a copy action. Sending again later
  means rotating, which invalidates the earlier link.
- GET returns the receipt revision, merchant, purchase date, currency,
  `pickingOpen`, items ordered by lineNumber, every participant's id and
  display name, the token holder's participant id, each item's pickers, and
  the holder's done state.
  Phones, emails, bills, owner id and image data are never returned while the
  receipt is a draft.
- On a FINALIZED receipt, GET returns the same receipt and item fields plus,
  for every participant, display name, amount owed and settled state, and the
  payer's display name. Amounts come from the receipt's bills (bills/list.md)
  in the same fixed decimal strings. Phones, emails, owner id and image data
  are still never returned.
- PUT picks and POST done on a FINALIZED receipt return 409 `CONFLICT` and
  write nothing.
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
  The revision advances, so the organizer's picks screen sees the change on
  its next read; reviewedAt is kept because receipt content is unchanged
  (same rule as bills/allocations.md).
- POST done sets picksSubmittedAt to now; it is idempotent. It needs picking
  open, like PUT, and does not change the revision. A later PUT by the
  same holder clears it until they press done again.
- The owner replacing items (receipts/items.md) and a successful parse
  (receipts/parse.md) each clear every participant's picksSubmittedAt, in the
  same transaction, since their picks were cleared with the old items.
- Receipt detail adds `hasPickLink` and `picksSubmittedAt` per participant
  for the owner's review screen. Readiness is derived there: a participant is
  ready when submitted, or when they have no link (the owner picks for them).
- Finalization is not gated on readiness. Its existing completeness rules in
  bills/split-allocation.md still apply.
### Picking and editing

- A DRAFT receipt is in one of two modes (ADR-0017), stored as
  Receipt.picksOpenedAt: null is **Editing**, a timestamp is **Picking
  open**. Every receipt starts in Editing, including receipts that existed
  before the column.
- `POST /api/receipts/[id]/picking` takes `{ open: boolean }` with the owner
  ritual and no expectedRevision. Under the receipt row lock it sets
  picksOpenedAt to now or null and returns receipt detail. Opening an open
  receipt keeps its timestamp; pausing a paused one is a no-op. It does not
  change the revision. FINALIZED and PARSING receipts return 409.
- Opening requires reviewedAt to be set (409 `CONFLICT` "Review the receipt
  before opening picking") and at least one participant other than the
  organizer's row (409 `CONFLICT` "Add someone to pick before opening
  picking").
- While picking is open, every owner write that takes expectedRevision
  returns 409 `CONFLICT` "Pause picking to make changes" and writes nothing:
  receipt PATCH (receipts/edit.md), item replacement (receipts/items.md),
  the roster (receipts/participants.md), assignments and shared allocations
  (bills/allocations.md), parse (receipts/parse.md) and finalize
  (bills/split-allocation.md). This check comes before the revision check,
  so a stale request gets this message rather than "reload". Pick links,
  the organizer's own picks and the picking route keep working.
- While editing, guest PUT and POST done return 409 `CONFLICT` "The
  organizer is making changes" and write nothing. GET still works; the token
  is valid, so this is never the 404.
- Switching modes clears no picks and no picksSubmittedAt.

### The organizer's own picks

- `PUT /api/receipts/[id]/picks` takes `{ itemIds }`, validated as the guest
  PUT, with the owner ritual and no expectedRevision. It reconciles the
  receipt's organizer row exactly like a guest's picks, under the same row
  lock, and advances the revision. It works in either mode, since it changes
  only the organizer's own picks (ADR-0018). FINALIZED and PARSING receipts
  return 409; a receipt with no organizer row returns 409 `CONFLICT` "You
  aren't on this receipt". It returns receipt detail.
- The organizer has no done state; their row's picksSubmittedAt stays null.

### Links and previews

- Opening a link changes nothing; only PUT and POST write. Link previews that
  messaging apps generate are therefore harmless.
- The guest page's title and preview metadata are generic ("Split Bill") and
  never include the merchant, names or amounts. It sends
  `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, and request
  logging records token routes without the token, so a link does not leak
  through previews, referrers, search engines or logs.
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
| Receipt finalized, link opened | Split summary: everyone's name, amount owed and settled state, and the payer |
| Receipt finalized, guest PUTs picks | 409, nothing written |
| Sam removed from the roster, his link opened | 404 |
| Maya and Sam save picks at the same moment | Both saved, one after the other |
| Guest saves an item the owner has since removed | 404, guest reloads |
| Sam presses done, then edits picks | picksSubmittedAt cleared until done again |
| Picking paused, Sam PUTs picks | 409 "The organizer is making changes"; GET still works |
| Picking open, owner PATCHes the tip | 409 "Pause picking to make changes" |
| Open picking on an unreviewed receipt | 409, still Editing |
| Open picking with only the organizer's row | 409, still Editing |
| Organizer PUTs their picks while picking is open | Saved; revision advances |
| Pause picking after Maya pressed done | Maya's picks and done state kept |
| Owner requests a pick link for their own row | 400 |

## Verify

- pnpm test covers token issue/rotate/revoke, hash-only storage, the 404
  family, reconciliation of individual and shared rows, mode transitions,
  concurrent guest saves all landing, rollback, the finalized split
  projection, 409 on writes after finalize, and that phones and emails never
  appear in token responses.
- pnpm test (picking-route.test.ts) covers open and pause with their 409
  preconditions, every owner write returning 409 while picking is open and
  writing nothing, guest PUT and done returning 409 while editing with GET
  still 200, `pickingOpen` in the projection, the organizer's picks in both
  modes reconciling like a guest's, and 400 for the organizer's pick link.
- API drill (pnpm dev, signed in): with picking paused, a guest PUT returns
  409; POST picking `{ open: true }`, and the same PUT succeeds while the
  owner's PATCH returns 409; pause again, and the PATCH succeeds.
- pnpm typecheck and pnpm build pass.
- API drill (pnpm dev, signed in): POST the pick-link route for a seeded
  participant; `curl /api/picks/<token>` with no cookie shows the projection
  with no phone or email; PUT two item ids and POST done; the
  owner's GET /api/receipts/[id] shows the assignments, `hasPickLink: true`
  and a picksSubmittedAt. Rotate, and the old token's GET returns 404.
- Drill: issue a link, open /p/<token> in a private window, pick items, then
  confirm the owner's receipt detail shows them and the participant is ready.
- Phone drill: open /p/<token> at 375px wide (devtools or a real phone); pick
  and unpick items by tapping their rows and press done, with no zooming and
  no horizontal scroll.
- Finalize drill: finalize the receipt, reopen the same /p/<token>; the split
  summary shows every participant's amount, PUT returns 409, and the page
  title shows no merchant or names.

## Known gaps against this contract

These statements above are contract, not yet fact. A PR that closes one
deletes its line from this section.

- **The guest page does not exist.** `apps/web/app/p/[token]/` is not built,
  so the page metadata, `Referrer-Policy` and `X-Robots-Tag` headers, the
  phone-first layout, and the private-window, phone and finalize drills are
  not yet true. `apps/web/middleware.ts` also redirects signed-out page
  requests to sign-in, so `/p/` must be exempted when the page lands.

## Constraints & decisions

- Permitted by ADR-0015, which supersedes the earlier public share link.
- Guest writes cannot use lockEditableReceipt, which requires an owner and an
  expected revision; lockReceiptForGuest keeps the same row lock and revision
  advance without either.
- Issuing and revoking links leave the revision alone, so the owner can send
  links mid-edit without their next save returning 409.
- The link is built from the request origin because the app has no configured
  public origin; a proxied deployment would add one.
- One token per participant rather than per receipt, so a guest cannot pick
  for someone else and the owner can revoke one person.
- One token for both phases instead of a separate share link, so there is one
  route family to audit. After finalize every holder sees every amount; ADR-0015
  accepts that because names and amounts are low-sensitivity and revocation
  ends it.
- Only hashes are stored, so a database read does not leak working links.
- Weighted portions are out; shared means equal, as in bills/allocations.md.
- Picking and editing lock each other out (ADR-0017), so a guest save can't
  undo an owner's fix and an owner save is never stale because of a pick.
  The switch is manual; nothing opens or pauses it automatically.
- The organizer picks through their own row with no expectedRevision
  (ADR-0018), so polling guests' picks never makes their save stale.

## Out of scope

- The app sending the link by SMS or email itself; the organizer sends it.
- Guests marking their own bill paid; only the owner records payment.
- Guests adding or editing items or other participants.
