# @project/auth — identity / auth

The "who is the current user?" logic. Currently a deliberately naive dev stub.
In Week 8 it's replaced with real authentication shared across the web app
and the worker.

## Public API

All exports come from `src/index.ts`:

| Export | What it does |
|---|---|
| `currentUserId()` | Returns the current user's ID. Reads from `x-user-id` request header, then `DEV_USER_ID` env var, then falls back to `demo-user`. |
| `phoneSessionToken(req)` | Reads the raw `phone_session` cookie token, or `null`. The domain resolves it to a verified phone (ADR-0015). |
| `phoneSessionCookie(token, expiresAt)` / `clearedPhoneSessionCookie()` | `Set-Cookie` values for issuing and clearing the phone session. |
| `clientIp(req)` | First `X-Forwarded-For` entry, for rate limiting only. |

## Dependencies

- `next` — for `next/headers` (the dev stub reads the HTTP request's headers)

## Consumers

- `apps/web` — via `@project/auth`

## The dev stub

```ts
currentUserId()
  1. x-user-id request header (if present)
  2. DEV_USER_ID env var (if set)
  3. "demo-user" (created by the seed script)
```

In development, this trusts the client to say who they are. That's intentional.
Week 8 replaces it with real auth (OAuth, JWTs, middleware) that works for both
the web app and the worker.

## Disabled in production

The dev stub throws if `NODE_ENV === "production"` unless `ALLOW_DEV_IDENTITY` is
set. Real auth in Week 8 removes this guard.