# ADR-0012: Public share link as the one unscoped read

## Status

Proposed

## Context

[web.md](../specs/web.md) requires every server entry to derive identity,
then query scoped by that user; AGENTS.md makes an unscoped query a defect.
The app's core promise includes letting people **without an account** see
what they owe — a guest at dinner opens a link and sees their share. A guest
has no session, so there is no user to scope by. Without a decision, the
feature is either unbuildable or gets built as an ad-hoc unscoped
`findUnique({ where: { id } })`, which lets anyone who guesses an id read
any party.

## Decision

Allow exactly one kind of unauthenticated read: a party looked up by its
`shareToken`. The token **is** the scope — possession of it is the
authorization, the same model as an unlisted document link.

- The token is 32 bytes from a CSPRNG, base64url-encoded (43 chars), stored
  in `parties.share_token` (unique). Ids are never accepted on this route.
- The route is read-only: GET only, no Server Actions, no writes reachable
  from the public page.
- The response is a fixed projection: party name, member display names,
  receipt totals and items, bills, settled status. It never includes email,
  phone, user ids, blob names, or the raw AI extraction.
- Unknown, revoked (`share_token` null), or soft-deleted → 404 with the
  standard error shape, indistinguishable from each other.
- Only the organizer can create, rotate, or revoke the token; those routes
  follow the normal scoped ritual.

## Consequences

- **Easier**: guests see their share with zero sign-up; the exception is one
  named route a reviewer can audit against a written list.
- **Harder**: a leaked link exposes the party's display names and amounts to
  whoever has it until the organizer rotates it. There is no per-viewer
  audit trail.
- **Accepted tradeoff**: no expiry and no per-guest tokens — rotation is the
  revocation tool. Revisit if parties start holding more sensitive data.
- On acceptance, [web.md](../specs/web.md)'s server entry standard gains a
  one-line pointer to this exception.

## See also

- `docs/specs/bills/public-share.md` — the behavior this ADR permits.
- `docs/specs/web.md` — the scoping contract this ADR carves out of.
