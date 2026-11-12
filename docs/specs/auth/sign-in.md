---
type: feature
---
# Organizers sign in with GitHub

## Why
Organizers need a private, persistent identity so receipt and bill data stays available to them across devices and cannot be accessed by another organizer.

## Where it lives
- `apps/web/app/api/auth/[...nextauth]/` — Auth.js request handlers.
- `apps/web/middleware.ts` and `apps/web/app/lib/page-access.ts` — page access rules.
- `apps/web/app/login/` — the sign-in page and its GitHub server action.
- `apps/web/tests/login.test.ts` — page, action and access-rule tests.
- `packages/auth/` — Auth.js configuration and session-derived identity helper.
- `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/` — linked OAuth accounts and database sessions.
- `apps/web/app/api/**` — authenticated API handlers use the shared identity helper.
- `docs/specs/auth.md` — cross-cutting identity contract.

## Behavior
- A signed-out visitor can view the landing page, `/login`, `/api/health`, and `/api/auth/*`.
- `/login` shows one card, centered on the screen, titled "Sign in to Split Bill" with the message "You need to sign in with GitHub to continue." and a "Continue with GitHub" button. GitHub is the only provider offered.
- Auth.js's built-in sign-in and error pages are replaced by `/login`: `/api/auth/signin` redirects there, and a failed sign-in returns there with `?error=<code>`. `AccessDenied` (no verified GitHub email) explains that a verified email is required; any other code shows "Sign-in didn't complete. Please try again." No other error detail is shown.
- `/login?callbackUrl=<path>` returns the visitor to that path after sign-in. Only same-origin paths starting with a single `/` are honored; absolute URLs, protocol-relative URLs and `/login` itself fall back to `/`.
- A signed-in visitor who opens `/login` is redirected to its sanitized `callbackUrl`, or `/`.
- Choosing "Continue with GitHub" starts an OAuth authorization flow. On return, the app validates the provider response and creates or finds the local user through the linked GitHub account.
- The app stores sessions in the database and sends the browser a secure, HTTP-only session cookie. The session identifies the local database `User.id`.
- GitHub's verified primary email supplies `User.email`. If GitHub does not provide a verified email, sign-in fails before creating a user. `User.name` uses the GitHub display name when present, otherwise the GitHub login. The avatar is display metadata and may be absent.
- A successful sign-in returns the organizer to the page they first requested. Signing out, from the header's user menu ([components](../components.md)) or Auth.js's sign-out endpoint, revokes the database session; protected pages then redirect to `/login`.
- Pages outside the public surface redirect signed-out visitors to `/login?callbackUrl=<requested path and query>`.
- Protected API routes derive identity from the session. A signed-out request receives HTTP 401 with `{ error: { code, message } }`.
- Every data query remains scoped to the session's local user ID. Unknown and foreign resources return 404.
- `/api/health` remains usable without a session.
- OAuth account linking and local user/session creation are handled by the Auth.js Prisma adapter. A failed sign-in never establishes an authenticated session.
- The development identity stub is removed. No header, URL parameter, request body, or environment fallback supplies the current user ID.

## Examples

| State / input | Behavior |
|---|---|
| Signed-out organizer opens `/login`, selects "Continue with GitHub" and completes authorization with a verified email | A local account and database session are established; the organizer lands in the app. |
| Signed-out browser opens `/receipts/abc` | Redirect to `/login?callbackUrl=%2Freceipts%2Fabc`; after sign-in, the organizer lands on `/receipts/abc`. |
| Signed-in browser opens `/login` | Redirect to `/` (or the sanitized `callbackUrl`). |
| `/login?callbackUrl=https://evil.example` | After sign-in the organizer lands on `/`. |
| GitHub profile has no verified email | Sign-in is rejected; no local account or session is created. |
| Signed-out browser requests a protected API route | HTTP 401 with the documented error shape. |
| GitHub profile has no verified email, organizer returns to `/login?error=AccessDenied` | The card explains a verified email is required; no session exists. |
| Signed-out browser requests `/api/health` | Health response is returned without redirect or authentication. |
| Organizer requests another user's receipt while signed in | HTTP 404; the other organizer's receipt is not disclosed. |
| Organizer signs out, then reuses the prior session cookie | The session is rejected and protected pages require sign-in again. |

## Verify
- `pnpm test` runs the existing unit and integration suite, including API error mapping and owner-scoped resource behavior.
- `pnpm typecheck` and `pnpm build` pass.
- `apps/web/tests/login.test.ts` covers the card, its error messages, the GitHub action's redirect target, callback sanitizing and the page-access rules.
- With local GitHub OAuth credentials configured, open a protected page signed out, confirm the redirect to `/login`, sign in with the button and land on the requested page; reopen `/login` and confirm the redirect away; sign out through Auth.js's sign-out endpoint and confirm the session is revoked.
- Keyboard-only pass on `/login`: Tab reaches "Continue with GitHub" and Enter starts sign-in.
- Without a session, request a protected API route and confirm HTTP 401 with the documented JSON shape; request `/api/health` and confirm it remains public.
- Search the repository for `x-user-id`, `DEV_USER_ID`, and `ALLOW_DEV_IDENTITY`; none remain in application code after the swap.

## Constraints & decisions
- GitHub is the only provider, as required by the [identity infrastructure spec](../auth.md); adding providers needs a separate decision.
- Database sessions are used so sessions can be revoked server-side and the identity stays tied to the local `User` record.
- Account identity is the linked GitHub provider account, not an email-only match. This avoids silently merging accounts based only on an email claim.
- A verified email is required because the existing `User.email` field is required and unique. A missing display name falls back to the stable GitHub login.
- The browser never chooses its user ID. This preserves the ownership boundary in the [API spec](../api.md).
- `/api/health` stays public so local and deployment health checks do not depend on user sessions.

## Out of scope
- Additional OAuth providers, password sign-in, passkeys, roles, and administrative accounts; the provider limit is defined by [auth.md](../auth.md).
- Account deletion, account export, and profile editing; these are future identity features covered by the privacy work noted in [auth.md](../auth.md).
- Guest or participant authentication; guests use per-participant links instead, see [guest-picks.md](../receipts/guest-picks.md).
