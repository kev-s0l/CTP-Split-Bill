---
type: feature
---
# An organizer reads their own profile

## Why

The app displays the signed-in organizer's name and contact details using the
current local user record.

## Where it lives

- apps/web/app/api/me/route.ts: GET and standard error mapping.
- packages/domain/src/user.ts: getCurrentUser and the explicit profile query.
- packages/domain/src/index.ts: the public domain export.
- packages/auth/src/current-user.ts: session-derived identity.
- apps/web/tests/me-route.test.ts: real handler and PGlite coverage.

## Behavior

- GET /api/me takes no required query parameters or request body. It derives
  the local user ID only from the Auth.js database session.
- The domain queries User by that ID and returns only id, name, email, image
  and phone. Absent image and phone values remain null.
- Success returns 200 and Cache-Control: private, no-store. The route is
  dynamic and reads the current profile on every request.
- Missing or unknown identities return 401 with
  { error: { code: "UNAUTHENTICATED", message: "Unknown user" } }.
- Unexpected authentication or database failures return 500 with
  { error: { code: "INTERNAL", message: "Something went wrong" } }.
- Missing identity is rejected before a database query. A profile read never
  creates or updates a user, session or receipt.
- Account relations, session tokens, provider tokens, emailVerified and
  createdAt are outside the response projection.

## Examples

| State / input | Result |
|---|---|
| Organizer A has an avatar and phone | 200 with A's five selected profile fields |
| Organizer B has no avatar or phone | 200 with image and phone null |
| Session changes from A to B | B's profile is returned on the next request |
| Organizer's stored name changes | The next request returns the updated name |
| Signed out or local user no longer exists | Standard 401 response |
| Database or session lookup fails | Generic 500 without internal details |

## Verify

- pnpm --dir apps/web exec vitest run tests/me-route.test.ts invokes the real
  GET and domain query against PGlite, mocking only the session identity. It
  checks the exact response, nulls, identity changes, fresh reads, missing and
  unknown users, the private cache header, and generic failure responses.
- pnpm test, pnpm typecheck and pnpm build pass.

## Constraints & decisions

- Session-derived identity follows ../auth.md. The browser cannot select a
  different user's profile through a header, query parameter or request body.
- The explicit projection keeps additional User fields out of the response.
- This inputless read needs no input schema, mutation revalidation, dependency
  or schema migration.

## Out of scope

- Profile editing, account deletion/export, roles and participant identities.
- Sign-in and sign-out are described in sign-in.md.
