---
type: feature
---
# The organizer saves who is splitting a receipt, with optional phone or email

## Why

Before anyone can be assigned an item, the organizer says how many people are
at the table and who they are. Names can wait — everyone starts as "Guest N" —
and a phone number or email is optional, needed only to send that person a
pick link.

## Where it lives

- packages/domain/src/participants.ts: ReplaceParticipants, normalizePhone,
  normalizeEmail and the roster transaction.
- packages/db/prisma/schema.prisma: Participant.email (nullable), added by an
  append-only migration.
- apps/web/app/api/receipts/[id]/participants/route.ts: PUT.
- apps/web/tests/participants-put-route.test.ts.

## Behavior

- Body is `{ expectedRevision, participants: [{ id?, displayName?, phone?, email? }] }`,
  1–50 entries, in display order. Uses the owner/DRAFT/revision lock.
- An entry with an id must be a participant of this receipt (404 otherwise)
  and keeps that id. An entry without an id is created. Existing participants
  missing from the list are removed.The same id twice is 400.
- The saved order is the order sent (joinedAt is rewritten to match).
- displayName is trimmed, 1–50 characters. Blank or missing becomes
  "Guest N", where N is the entry's 1-based position.
- phone is optional. When present it is normalized to E.164 (US numbers may be
  entered without +1); anything that does not normalize returns 400 with
  message `phone: Enter a valid phone number`. An empty string clears it; an ommitted phone keeps the stored one.
  Phones dont need not to be unique.
- email is optional. When present it is trimmed and lowercased, at most 254
  characters, and must be a single address of the form local@domain;
  anything else returns 400 with message `email: Enter a valid email address`.
  An empty string clears it; an omitted email keeps the stored one. Emails
  need not be unique.
- Removing a participant that is the receipt's payer, or that has an
  assignment or shared allocation, returns 409 `CONFLICT`; the organizer
  unassigns first. Removing one with a pick link revokes it, once pick links exist (receipts/guest-picks.md); today there are none to revoke.
- Changing names, phones or emails keeps reviewedAt; the revision advances.
- Success returns receipt detail. Phones and emails appear only in owner
  responses (receipts/detail.md) and never in pick-link responses
  (receipts/guest-picks.md).
- Invalid input 400; unknown user 401; foreign receipt 404; finalized, parsing
  or stale 409. Failures roll back.

## Examples

| Input | Result |
|---|---|
| Four entries, no names | Guest 1 … Guest 4 |
| `{ displayName: "  Maya ", phone: "(555) 201-3344" }` | "Maya", +15552013344 |
| phone "12" | 400 |
| `{ email: " Maya@Example.com " }` | maya@example.com |
| email "maya@" | 400 |
| Remove Sam, who is assigned the rice | 409; roster unchanged |
| Entry id from another receipt | 404 |
| Stale expectedRevision | 409 |

## Verify

- pnpm test (participants-put-route.test.ts) covers default naming, trimming, phone and email normalization and
  rejection, id retention, removal guards, rollback and stale revisions.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Participants stay receipt-local with no account link (ADR-0014).
- The cap of 50 matches the people a single receipt plausibly splits between.
- E.164 storage makes later SMS delivery a formatting-free step.

## Out of scope

- The app sending SMS or email itself (receipts/guest-picks.md issues links;
  the organizer sends them from their own device).
- Reusing contacts across receipts or importing from a phone's contacts.
