---
type: feature
---
# A guest with no account sees what they owe, once they prove the address they were invited at

## Why
Most people at a dinner never sign up. The organizer adds them by name and an
email or phone number, and their bills are written like anyone else's — but
nothing reads them back, because every bill query reaches members through
`userId` and a guest has none. This is the one read path a person without an
account gets: prove you control the address you were invited at, and see what
you owe, across every party that invited it.

## Where it lives
- `packages/domain/src/contact.ts`: `VerifiedContact`, `normalizeEmail`,
  `normalizePhone`, `verifiedContact()`.
- `packages/domain/src/bills.ts`: `listBillsForContact()`.
- `packages/auth/src/current-guest.ts`: `currentGuestContact()` — the guest
  principal seam, today a dev stand-in.
- `apps/web/app/api/guest/bills/route.ts`: `GET /api/guest/bills`.
- `packages/db/prisma/schema.prisma`: `PartyMember.email` / `.phone`
  (columns `guest_email` / `guest_phone`), `Bill`.

## Behavior

### The principal
- Identity is a **verified contact**, not a user. It comes from
  `currentGuestContact()`; a request without one is 401 `UNAUTHENTICATED`.
- A contact is normalized before it is used: email lowercased and trimmed,
  phone reduced to E.164. A malformed address is 400 `INVALID_INPUT` and no
  query runs — the address is never used as a lookup key in a form the
  database could not have stored.
- The guest principal is **type-distinct from a user id**.
  `listBillsForContact` takes a `VerifiedContact` and `listBills` takes a
  `string`, so neither can be called with the other's principal.

### The list — `GET /api/guest/bills`
- Returns the bills whose `memberId` is a `PartyMember` row with
  `userId = null` and the matching normalized contact.
- **Spans every party** that invited that address. A guest invited to three
  dinners at the same phone number sees bills from all three in one list.
- Members **with** a `userId` are never matched, even if an email column were
  somehow set — the query filters `userId: null` explicitly, on top of the
  `party_members_guest_contact_only` database constraint.
- Excludes bills whose receipt or party is soft-deleted (`deletedAt` set).
- Each bill is
  `{ id, receiptId, memberId, subtotal, taxShare, tipShare, amountOwed, createdAt }`
  — the same projection account holders get from
  [my-bills](my-bills.md), so one client renderer serves both.
- The four money fields are `Decimal` columns and serialize as JSON
  **strings** (`"12.34"`), never floats.
- Ordered newest first, ties broken by `id`, so the order is stable.
- Returns 200 with `[]` when the address matches no guest member.
- Costs two queries: the matching member ids, then the bills.
- **Read-only.** `GET` is the only exported method. Nothing in the handler or
  in `listBillsForContact` writes, and no write is reachable from either.
- Any unexpected failure returns 500 `INTERNAL` with a generic message; the
  real error is logged, never sent.

## Examples

| State / input | Behavior |
|---|---|
| Guest invited at `a@b.com` to one party, one bill of 12.34 | 200 `[{ id, amountOwed: "12.34", … }]` |
| Same address invited to two parties, one bill each | 200, both bills, newest `createdAt` first |
| Contact header `email:A@B.com` (different case) | 200, same bills — normalization makes them one address |
| Contact header `phone:(555) 123-4567` | 200, matches the row stored as `+15551234567` |
| Contact header `phone:12345` | 400 `INVALID_INPUT`, no query runs |
| A signed-up member whose `User.email` is `a@b.com` | Their bills are absent — `userId` is not null |
| The receipt was soft-deleted after finalizing | Its bills are absent |
| Address matches nobody | 200 `[]` |
| No guest principal on the request | 401 `UNAUTHENTICATED` |
| `POST /api/guest/bills` | 405 — no `POST` is exported |

## Verify
- `pnpm test`: `packages/domain/tests/bills.test.ts` covers every row above.
  Dropping `userId: null` from `listBillsForContact` must fail the
  signed-up-member row; dropping normalization must fail the different-case
  and formatted-phone rows. Those two are the tests that cannot pass by
  accident.
- `pnpm build`: the route must compile with no `params`, since the path has
  no dynamic segment.
- Grep drill — the read-only guarantee is structural, so it is greppable:
  `grep -nE "prisma\.[a-z]+\.(create|update|delete|upsert)" apps/web/app/api/guest/bills/route.ts packages/domain/src/contact.ts`
  returns nothing, and `grep -n "export async function" apps/web/app/api/guest/bills/route.ts`
  returns `GET` only.
- Drill, with `pnpm dev` running and a guest member seeded:
  `curl -H 'x-guest-contact: email:guest@example.com' localhost:3000/api/guest/bills`
  lists that guest's bills; without the header, 401.

## Constraints & decisions
- **The contact is the principal, and control of it is the whole
  authorization.** Anyone with access to that inbox or handset sees these
  bills. There is no per-person distinction inside a shared family address —
  an accepted tradeoff recorded in
  [ADR-0014](../../adr/0014-two-principals-credentials-and-guest-otp.md).
- **This is a scoped read, not an unscoped one.** The query filters by a
  principal the caller proved; it is not an exception to the scoping rule in
  `AGENTS.md`, unlike the share token in
  [ADR-0012](../../adr/0012-public-share-link.md).
- **A separate route, not a branch in `/api/bills`.** Read-only has to be
  structural: one handler serving both principals is one forgotten check away
  from letting a guest write. The cost is a second route over the same
  resource, which is cheaper than the audit burden of a shared one.
- **`guest` is not a plural resource noun**, which bends the naming rule in
  [api](../api.md). It follows the precedent of `/api/auth/*`: a
  principal-scoped sub-surface, so the read-only boundary is visible in the
  route tree.
- **Normalization is correctness, not hygiene.** Writes and lookups share
  `normalizeEmail` / `normalizePhone`; if they ever diverge, bills silently
  stop being found, and the failure looks like "no bills" rather than an
  error.
- **The same projection as [my-bills](my-bills.md)**, deliberately. A guest
  sees their own amounts and nothing about other members — no display names,
  no contact details. `displayName` stays the only identity a member shows
  to a party.
- **No detail route.** `GET /api/bills/[billId]` is account-scoped; a guest
  equivalent would need its own ownership check, and the list carries enough
  to show what is owed.
- **The principal source is a dev stand-in today.** `currentGuestContact()`
  reads an `x-guest-contact` header and throws in production unless
  `ALLOW_DEV_IDENTITY` is set, the same guard as
  [ADR-0003](../../adr/0003-dev-identity-stub.md). The OTP flow replaces the
  stand-in; the route and the query do not change.

## Out of scope
- **Proving control of the address** — the one-time-code flow that mints a
  real guest principal: not written yet, and the reason the seam above is
  still a stand-in.
- Adding a member with a contact address: `parties/members.md`, not written yet.
- Account holders' bills: [my-bills](my-bills.md).
- The share-token read of a whole party: [public-share](public-share.md).
- Upgrading a guest to an account, which backfills `PartyMember.userId` and
  moves them onto [my-bills](my-bills.md): no spec yet.
