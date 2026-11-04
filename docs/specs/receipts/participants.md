---
type: feature
status: draft
---
# The organizer saves who is splitting a receipt, with optional phone numbers

## Why

Before anyone can be assigned an item, the organizer says how many people are
at the table and who they are. Names can wait — everyone starts as "Guest N" —
and a phone number is optional, needed only to text that person a pick link.

## Where it lives

- packages/domain/src/participants.ts: ReplaceParticipants and the roster
  transaction.
- apps/web/app/api/receipts/[id]/participants/route.ts: PUT (today a scaffold).
- packages/db/prisma/schema.prisma: Participant.displayName and phone, which
  already exist; no migration.

## Behavior

- Body is `{ expectedRevision, participants: [{ id?, displayName?, phone? }] }`,
  1–50 entries, in display order. Uses the owner/DRAFT/revision lock.
- An entry with an id must be a participant of this receipt (404 otherwise)
  and keeps that id. An entry without an id is created. Existing participants
  missing from the list are removed.
- displayName is trimmed, 1–50 characters. Blank or missing becomes
  "Guest N", where N is the entry's 1-based position.
- phone is optional. When present it is normalized to E.164 (US numbers may be
  entered without +1); anything that does not normalize returns 400 with
  message `phone: Enter a valid phone number`. An empty string clears it.
  Phones need not be unique.
- Removing a participant that is the receipt's payer, or that has an
  assignment or shared allocation, returns 409 `CONFLICT`; the organizer
  unassigns first. Removing one with a pick link revokes it.
- Changing names or phones keeps reviewedAt; the revision advances.
- Success returns receipt detail. Phones appear only in owner responses
  (receipts/detail.md) and never in pick-link responses
  (receipts/guest-picks.md).
- Invalid input 400; unknown user 401; foreign receipt 404; finalized, parsing
  or stale 409. Failures roll back.

## Examples

| Input | Result |
|---|---|
| Four entries, no names | Guest 1 … Guest 4 |
| `{ displayName: "  Maya ", phone: "(555) 201-3344" }` | "Maya", +15552013344 |
| phone "12" | 400 |
| Remove Sam, who is assigned the rice | 409; roster unchanged |
| Entry id from another receipt | 404 |
| Stale expectedRevision | 409 |

## Verify

- pnpm test covers default naming, trimming, phone normalization and
  rejection, id retention, removal guards, rollback and stale revisions.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Participants stay receipt-local with no account link (ADR-0014).
- The cap of 50 matches the people a single receipt plausibly splits between.
- E.164 storage makes later SMS delivery a formatting-free step.

## Out of scope

- Sending SMS or links (receipts/guest-picks.md issues links; delivery is
  unspecified worker work).
- Reusing contacts across receipts or importing from a phone's contacts.
