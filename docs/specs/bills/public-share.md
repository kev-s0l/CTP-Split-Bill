---
type: feature
---
# Public bill portals are deferred from the receipt-owned MVP

## Why

Personalized SMS/share text lets participants receive their amounts without
requiring a public portal or guest accounts.

## Where it lives

- docs/adr/0014-receipt-owned-domain.md defines organizer-only access.
- The public-link ADR remains a historical proposal.
- No public page, token model or unscoped bill-query implementation is present.

## Behavior

- Receipt and bill reads require organizer ownership.
- The database contains no public share token.
- Preparing client share text does not create public access or mark a bill paid.

## Examples

| Action | Result |
|---|---|
| Organizer reads a bill | Owned bill response |
| Different identity requests that bill | 404 |
| Organizer opens SMS with prepared text | Client action; no public bill portal |

## Verify

- Bills route tests verify foreign IDs return 404.
- Schema validation and migration tests verify the target models omit Party
  and share tokens.

## Constraints & decisions

- Public portals require a separately reviewed access contract and feature.
- ADR-0014 governs the current domain; the proposed public-link ADR is unchanged.

## Out of scope

- Token issuance, unauthenticated reads, guest login and automated SMS.
