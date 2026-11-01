# ADR-0015: Per-participant pick links as the one guest write

## Status

Proposed

## Context

ADR-0014 makes Receipt.ownerId the only access boundary and defers public
sharing. The planned flow lets the organizer text each guest a link so the
guest taps the items they had, instead of the organizer assigning everything.
Guests have no accounts, so there is no user to scope by. ADR-0012 proposed a
read-only, party-wide share token. Parties no longer exist, and a read-only
token cannot record picks.

## Decision

Allow one kind of unauthenticated access: a participant found by its pick
token. The token is the scope — it authorizes exactly one participant on
exactly one receipt.

- Each participant may hold one token: 32 bytes from a CSPRNG,
  base64url-encoded, stored only as a SHA-256 hash in
  participants.pick_token_hash (unique). The raw token is returned once, to
  the owner, when it is issued.
- Only the owner issues, rotates or revokes a token, through owner-scoped
  routes. Rotation and revocation invalidate the old token immediately.
- A token can read a fixed projection of its receipt: merchant, purchase date,
  currency, items (line number, name, quantity, line total), every
  participant's display name, and which participants picked each item. It
  never returns phones, owner identity, blob names, extraction or bills.
- A token can write only its own participant's picks and done flag, only while
  the receipt is DRAFT and not PARSING, and only with expectedRevision.
- Unknown, revoked, finalized and deleted all return the same 404.
- Ids are never accepted in place of a token on these routes.

## Consequences

- Easier: guests pick without signing up; the exception is one route family a
  reviewer can audit against this list.
- Harder: a forwarded link lets its holder pick for that participant until it
  is rotated. Picks are not attributable beyond "whoever held the token".
- Owner writes and guest writes share the receipt revision lock, so a guest
  saving over a stale view gets 409 and reloads.
- On acceptance, docs/specs/api.md and docs/specs/web.md gain a pointer to
  this exception, and ADR-0012 is marked superseded.

## See also

- docs/specs/receipts/guest-picks.md — the behavior this ADR permits.
- docs/adr/0014-receipt-owned-domain.md — the boundary this ADR carves out of.
- docs/adr/0012-public-share-link.md — the earlier, party-based proposal.
