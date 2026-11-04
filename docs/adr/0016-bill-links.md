# ADR-0016: Bill links as the one guest read

## Status

Proposed. Supersedes ADR-0012 and ADR-0015, neither of which was accepted.

## Context

Guests at dinner have no account and need to see what they owe. ADR-0015
proposed proving phone possession with texted codes, which requires a
messaging provider (Twilio), US carrier registration, per-message cost and
abuse controls. ADR-0012 proposed a share link per party, a model ADR-0014
removed. The project wants guests to get their bill without a third-party API.

Organizers already hold each guest's contact and are present at the dinner, so
their own phone can deliver a link.

## Decision

Allow exactly one kind of unauthenticated read: one bill, looked up by a link
token the organizer issued. Possession of the link is the authorization, like
an unlisted document link.

- **Token.** 32 bytes from a CSPRNG, base64url. Only the SHA-256 is stored in
  `bill_links`; the raw token is shown once, in the issue response. A token of
  this size needs no rate limiting or keyed hash.
- **One live link per bill.** Issuing revokes the previous link in the same
  transaction; a partial unique index enforces it under concurrency.
- **Expiry.** 90 days from issue; the organizer can reissue.
- **Projection.** That bill's amounts, settlement and receipt title, merchant,
  date and currency. Never ids, phones, other participants, items, images or
  extraction data. Read-only.
- **Uniform 404.** Malformed, unknown, revoked, expired and deleted-receipt
  links are indistinguishable.
- **Delivery.** The API returns a prepared message and an `sms:` href; the
  organizer's own device sends it. No messaging provider, seam or secret.
- **Organizer control.** Only the bill's owner issues or revokes, through the
  normal scoped server-entry ritual.
- **Phones in E.164.** Migration 0003 normalizes participant phones alongside
  `bill_links`, so prepared texts and the organizer phone lookup address the
  same number however it was typed.

## Consequences

- **Easier**: no vendor, no per-message cost, no carrier registration, no
  sending abuse surface. A guest taps one link. The exception is one read a
  reviewer can audit against this list.
- **Harder**: a forwarded or leaked link exposes that bill (name, amounts,
  merchant) to whoever has it until revoked or expired. There is no per-viewer
  audit trail.
- **Harder**: a guest sees one bill per link. Returning means keeping the text
  or asking the organizer to reissue.
- **Accepted**: tokens travel in the URL path, so infrastructure request logs
  may record them. Responses forbid caching, indexing and Referer leakage.
- **Deferred**: a guest view of all their bills. It must rest on its own proof
  (a device session that remembers opened links, an account, or verified
  phone possession). A link must never be treated as proof of the phone it was
  sent to, since forwarding one link would expose every bill for that number.
- **Deferred**: purging expired and revoked link rows.

## See also

- `docs/specs/bills/public-share.md` — the behavior this ADR permits.
- `docs/specs/web.md` and `docs/specs/api.md` — the scoping contract this ADR
  carves out of.
- ADR-0012, ADR-0014, ADR-0015.
