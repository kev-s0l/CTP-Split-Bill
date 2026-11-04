---
type: infrastructure
---
# Identity — the auth subsystem

Who the current user is, and how every server entry learns it.

## Today: the dev identity stub

`packages/auth/` resolves the current user from the `x-user-id` header, then
`DEV_USER_ID`, then a fallback — **deliberately naive**, and guarded: it throws
in production unless `ALLOW_DEV_IDENTITY` is set. This is the auth seam's
local stand-in (see [seams](seams.md)) and a planted lesson.

## Target: session-derived identity, only

- Auth.js v5 + Prisma adapter, database sessions, GitHub OAuth (one provider).
- Public surface: landing, /login, /api/health, /api/auth/*, /api/phone-auth/*,
  and /api/participant-bills (phone session, not user session). Everything else
  gated; signed-out API calls get 401, pages redirect to /login.
- Identity comes from the session **only**. The client never supplies a user
  id — no header, no param, no dev-only bypass: dev signs in like prod.
- First sign-in creates the user (name/avatar from GitHub).

The swap from stub to sessions is epic work — a `sign-in` ticket in the
app's feature epic executes it against this contract.

## Second identity: verified phone (participants)

Participants have no account. A participant proves possession of a phone with
a texted one-time code and receives a `phone_session` cookie (HttpOnly,
`Path=/api`, 7 days; only the token's hash is stored). The verified phone is
the scope for exactly one read, `GET /api/participant-bills`; it grants no
writes and organizer routes never read it. Its public surface is
`/api/phone-auth/*`. Behavior: [bills/phone-lookup](bills/phone-lookup.md);
decision: [ADR-0015](../adr/0015-phone-verified-participant-access.md).
This identity is independent of the stub-to-OAuth swap and survives it.

## Constraints & decisions

- One OAuth provider (GitHub) for organizers; more is out of scope. Phone
  verification is a separate, participant-only identity (ADR-0015).
- After the swap, the string `x-user-id` appears nowhere in the codebase.
- Roles/admin, account deletion + export: future work with a privacy doc.

## Key decisions

- [ADR-0003](../adr/0003-dev-identity-stub.md) — why the stub exists and how it's guarded.
- [ADR-0015](../adr/0015-phone-verified-participant-access.md) — verified phone as a participant identity.
