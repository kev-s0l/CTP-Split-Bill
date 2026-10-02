---
type: feature
---
# Anyone with a party's share link can view its split, read-only

## Why
People at the table often don't have an account. The organizer sends one
link, and each guest can see what they owe and whether it's been paid
without signing up.

## Where it lives
- `packages/db/prisma/schema.prisma` — `Party.shareToken`.
- `packages/domain/` — `getSharedParty(token)` (the only unscoped query) and
  the organizer's `enableShare` / `rotateShare` / `revokeShare` queries.
- `apps/web/app/s/[token]/` — the public page and its GET route.

## Behavior
- The organizer enables sharing; the system generates a 32-byte CSPRNG
  token, base64url-encoded, and stores it in `share_token`. The link is
  `/s/<token>`.
- `/s/<token>` is public: no session required, no identity derived. It is
  the single exception to user scoping (see ADR-0012).
- The lookup is by token only. A party id is never accepted on this route.
- The page and route are read-only. Nothing reachable from them writes.
- The response contains only: party name, member display names, finalized
  receipts (merchant, date, currency, subtotal, tax, tip, total, items),
  each member's bill breakdown (subtotal, tax share, tip share, amount
  owed), and whether each bill is settled.
- It never contains email, phone, user ids, image blob names, the raw AI
  extraction, or unfinalized receipts.
- An unknown token, a revoked token, and a soft-deleted party all return
  404 with the standard error shape. The three cases are indistinguishable.
- Only the organizer can enable, rotate, or revoke. Rotating replaces the
  token, so old links 404. Revoking sets it to null. These organizer routes
  follow the normal scoped server-entry ritual, and a non-organizer gets 404.

## Examples

| State / input | Behavior |
|---|---|
| Valid token, party has one finalized receipt | 200; shows members, items, bill breakdowns, settled flags |
| Valid token, one receipt still `PARSING` | 200; that receipt is absent |
| Random 43-char token | 404 `{ error: { code: "NOT_FOUND", … } }` |
| Token of a revoked or rotated link | 404, same body as above |
| Token of a soft-deleted party | 404, same body as above |
| Party id placed where the token goes | 404 |
| POST/PUT/DELETE to `/s/<token>` | 405, nothing written |
| Non-organizer member calls rotate | 404 |

## Verify
- `pnpm test`: integration tests for every row above, run against PGlite.
  One asserts that the response JSON contains no `email`, `phone`, `userId`
  or `extraction` key.
- Drill: `curl -i /s/<token>` with no cookies → 200; revoke, repeat → 404.

## Constraints & decisions
- The token is the authorization; a leaked link exposes that party until
  it is rotated. Accepted in ADR-0012.
- Links never expire, and there are no per-guest tokens. Rotation is the
  revocation tool.
- Guests cannot mark their own bill paid through the link. Writes need an
  account.

## Out of scope
- Recording payments: no spec yet.
- Guests claiming items via the link: no spec yet.
