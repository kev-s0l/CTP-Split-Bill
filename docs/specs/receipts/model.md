---
type: feature
---
# An organizer owns each receipt and its receipt-specific participants

## Why

An organizer reviews a restaurant receipt, assigns its costs and tracks what
each person owes without administering a reusable party or guest accounts.

## Where it lives

- packages/db/prisma/schema.prisma: six receipt-owned domain models.
- packages/db/prisma/migrations/0002_receipt_remodel.sql: atomic legacy upgrade.
- packages/domain/src/receipt-access.ts, receipt.ts and bills.ts: ownership,
  editable state, reference validation and finalization.
- packages/domain/src/split.ts: unchanged exact-cent allocation engine.
- packages/db/src/seed.ts: receipt-owned demo data.
- Migration, domain and web route tests verify the transition.

## Behavior

- Receipt IDs identify resources. Title, merchant, address and purchase date
  are optional display metadata. Owner identity comes from the auth seam.
- Only the owner accesses a receipt or its children. Foreign, unknown and
  soft-deleted receipts return 404. Missing users return 401.
- Participants belong to one receipt, have required display names and optional
  non-unique phones, and carry no user/account relation.
- Items store nullable OCR fields until correction. Decimal precisions are
  unchanged. Corrected replacement requires complete valid fields and clears
  individual assignments and shared allocations in one transaction.
- DRAFT/FINALIZED is independent of NOT_STARTED/PARSING/SUCCEEDED/FAILED OCR
  state. Failed parsing can be corrected manually. Parsing blocks draft edits.
- Draft mutations advance revision under the receipt lock. Content/item/money
  corrections clear reviewedAt. Review confirmation validates receipt data.
  Finalization requires confirmation and the expected revision.
- EVEN has no assignments. ITEMIZED requires exactly one individual assignee
  per item and no shared rows. SHARED_ITEMS allows one assignee or at least two
  distinct equal shared allocations per item, never both.
- Payers, assignees, allocations and bills reference participants of the same
  receipt through composite foreign keys. Mode/count/exclusivity checks are
  transactional domain rules.
- A quantity line has one owner in ITEMIZED mode. Different individual owners
  require separate corrected lines preserving the receipt subtotal.
- Finalization reuses the calculator, creates one Bill per participant, and
  writes FINALIZED/finalizedAt in the same transaction. All four sums reconcile.
- Bill amounts are immutable. paidAt records manual payment tracking. The payer
  and zero-owed bills also count as settled; outstanding is zero when settled,
  otherwise amountOwed. There is no active Payment ledger.
- Migration preserves receipt/item/bill IDs and bill amounts, uses the old party
  organizer as owner, copies party name to title, and propagates party deletion
  to receipts. Member IDs are reused for their first receipt and deterministic
  copies are created for additional receipts. Known account phones are copied.
- Active single shares become assignees. Multiple equal shares become shared
  allocations and SHARED_ITEMS mode. Dormant EVEN shares are discarded.
- Exact fully paid balances become paidAt markers. Active unequal weights,
  partial/overpayments, foreign references or invalid amounts abort the upgrade
  without dropping old data. Legacy finalization time comes from its bills when
  available; historical review time remains unknown.

## Examples

| State / input | Behavior |
|---|---|
| Sam belongs to a party with two receipts | Two receipt-local participants; each bill references its matching person |
| Itemized item assigned to Sam | Its entire line total belongs to Sam |
| Appetizer shared by Sam and Alex | Equal portions in SHARED_ITEMS mode |
| Assignee belongs to another receipt | Foreign reference is rejected |
| Reviewed draft item is changed | Review cleared, revision advanced |
| Stale finalization or finalized edit | 409, no partial writes |
| Legacy payment covers part of a bill | Migration fails for explicit reconciliation |

## Verify

- pnpm prisma:generate, pnpm test, pnpm typecheck and pnpm build pass.
- Migration tests upgrade seeded legacy multi-receipt data and check IDs,
  ownership, phones, assignments, settlement, enum conversion, soft deletion,
  foreign keys and absence of obsolete tables.
- Failure fixtures verify incompatible shares/payments/references roll back.
- Domain/route tests check ownership, missing IDs, finalized state, references,
  all split modes, stale revisions, review invalidation, rollback and concurrency.
- An isolated PGlite seed drill confirms and finalizes the demo receipt, checks
  bills total 38.66, and checks other-user gets 404 for receipt and bill reads.

## Constraints & decisions

- See ADR-0014. SQL migrations are append-only and use the existing flat loader.
- Keep the original User fields and auth stub; add no Account/Session tables.
- Preserve BigInt arithmetic and deterministic participant joinedAt/id ordering.
- Finalized data has no reopen operation. Draft children with no deletedAt may
  be physically replaced; receipt deletion remains soft.

## Out of scope

- Upload/OCR implementation, auth replacement, public portals, automated SMS,
  weighted splits, partial payments and UI screens.
- Planned route scaffolds remain feature work except where an existing operation
  needs adaptation to keep the remodeled schema usable.
