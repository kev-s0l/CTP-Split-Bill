# @project/auth — identity and sessions

The shared Auth.js configuration for the web app. GitHub is the only provider,
and Auth.js stores sessions in Postgres through the Prisma adapter.

## Public API

Exports come from `src/index.ts`:

| Export | Purpose |
|---|---|
| `auth()` | Read the current Auth.js session. |
| `currentUserId()` | Return the session's local `User.id`, or an empty string when signed out. Domain operations map the missing user to the standard 401 response. |
| `handlers` | Auth.js route handlers for OAuth, sign-in, and sign-out. |
| `signIn`, `signOut` | Auth.js server actions for app forms. |

## Configuration

The web app requires `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `AUTH_SECRET`.
Register `http://localhost:3000/api/auth/callback/github` as the local GitHub
OAuth callback URL. The Prisma adapter uses `@project/db`; the auth package
does not create a separate database client.

## Identity rules

- User identity comes only from the database session.
- GitHub's verified primary email is required. The display name falls back to
  the GitHub login when no display name is set.
- Every protected data operation is scoped by the local `User.id`.
- No development user fallback or request-supplied user ID is accepted.
