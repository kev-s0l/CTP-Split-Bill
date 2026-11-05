---
type: infrastructure
---
# Identity — the auth subsystem

Who the current user is, and how every server entry learns it.

## Session-derived identity

- Auth.js v5 uses the Prisma adapter, database sessions, and GitHub OAuth as its
  only provider.
- Public surface: landing, `/api/health`, and `/api/auth/*`. Other pages require
  a session; signed-out API calls receive 401 and signed-out pages redirect to
  Auth.js's sign-in endpoint.
- Identity comes only from the Auth.js session's local database user ID. No
  request header, URL parameter, or development fallback supplies identity.
- First sign-in creates a local user from GitHub's verified primary email,
  display name (or login fallback), and avatar.
- Sign-out removes the database session so it cannot be reused.

## Constraints & decisions

- One provider (GitHub); more is out of scope.
- Historical rationale for the removed development identity is recorded in
  [ADR-0003](../adr/0003-dev-identity-stub.md).
- Roles/admin, account deletion + export: future work with a privacy doc.

## Key decisions

- [ADR-0003](../adr/0003-dev-identity-stub.md) — why the stub exists and how it's guarded.
