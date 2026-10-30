# ADR-0014: Receipts own participants and authorize their organizer directly

## Status

Accepted

## Context

An organizer manages one restaurant receipt at a time. Reusable parties,
account-linked membership, public links and payment ledgers exceed this workflow.
A party may contain several receipts, so removing it also requires mapping its
members and financial references per receipt.

## Decision

- Receipt.ownerId is the access boundary. Participants are receipt-local names
  and optional phone numbers and grant no access.
- Retain User, Receipt, ReceiptItem and Bill. Rename and reshape PartyMember
  into Participant and ItemShare into SharedItemAllocation. Remove Party and
  Payment after converting their data.
- EVEN divides the receipt among participants. ITEMIZED assigns each item to
  one participant. SHARED_ITEMS permits personal items and equal shared items
  through a separate allocation relation. Reuse the existing arithmetic engine.
- Parsing state is independent of DRAFT/FINALIZED business state. Review and
  revision guards bind finalization to a confirmed draft.
- Bills are immutable calculated snapshots. paidAt records manual binary
  tracking; the original payer and zero-owed bills are settled by rule.
- No Account or Session tables are added. Authentication remains a separate
  change; authorization continues to use the existing identity seam.
- Append an atomic SQL remodel without editing the initial migration. Abort on
  incompatible legacy references, active unequal shares or payment balances
  that cannot be represented by binary paid tracking. Do not reset the database.

## Consequences

- Ownership queries no longer join through membership. Participants need no
  accounts and may appear independently on different receipts.
- Composite foreign keys keep payers, assignees, allocations and bills within
  their receipt. Mode, cardinality and review rules remain domain invariants.
- Migration retains receipt/item/bill IDs and bill amounts, reuses each member
  ID on its first receipt, and clones participants for additional receipts.
- The membership contract in docs/specs/api.md is replaced by direct ownership.
  The accepted ORM and web-only domain decisions remain unchanged.
- Public sharing is deferred; the proposed public-link decision is not used by
  this API.

## See also

- docs/specs/receipts/model.md
- docs/specs/api.md
- docs/adr/0004-prisma-orm.md
- docs/adr/0009-domain-web-only.md
