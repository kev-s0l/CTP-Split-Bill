---
type: infrastructure
---
# Web app — shell, health, and server standards

The Next.js app (`apps/web/`) carries four cross-cutting contracts that hold
on every branch, for every feature.

## Health endpoint

- `GET /api/health` returns `{ status: "ok", db: "ok" }` when the process and
  its database connection are healthy; 503 with `db: "error"` when not.
- **Unauthenticated and dependency-light, forever** — probes must never be
  blocked by the thing they're probing. Deploy probes, uptime checks, and the
  "stop the database and watch" demo all point here.

## Async honesty (UI standard)

- Every async region has three states: loading (skeleton), empty (with a
  primary action), error (retry card that refetches). Sections stream in their
  own Suspense boundaries — no full-page spinners.
- Quick actions apply optimistically and roll back with an explanatory toast.
- Errors surface; they are never silently swallowed.
- The shared building blocks (`LoadingState`, `EmptyState`, `ErrorState`,
  the toast host) are in [components](components.md).

## Mobile (UI standard)

- Every page works at a 375px-wide viewport with no horizontal page scroll.
  Layouts are written mobile-first; wider layouts are added with `md:` and up.
- Every tap target — button, link, checkbox row, menu item — is at least
  44×44px. Where a control is drawn smaller (a checkbox), its whole row or
  label is the target.
- Data too wide for a phone (item tables) renders as stacked rows below
  `md:` and as a table at `md:` and up.
- Nothing is reachable only on hover; hover styling is decoration, never the
  only way to find an action.
- Text inputs render at 16px or larger on phones, so iOS does not zoom on
  focus.
- Pages a guest opens from a text message are designed phone-first; organizer
  pages are designed desktop-first and still meet every rule above.

## Server entry standard (the ritual)

Every route handler and Server Action, in order:
1. derive identity (see [auth](auth.md)) →
2. validate with the shared Zod schema (`packages/domain`) →
3. query scoped by the derived user →
4. act →
5. map errors →
6. revalidate.

- One error shape everywhere: `{ error: { code, message } }` with
  400 validation / 401 no session / 403 not permitted / 404 absent-or-foreign
  / 409 conflict. Prisma mapped: P2002→409, P2025→404.
- **Foreign resources return 404, not 403** — existence is not confirmed to
  non-owners.
- One exception to step 1: guest link routes (`/api/picks/[token]`) derive no
  user identity; the token hash is the scope. See
  [ADR-0015](../adr/0015-guest-pick-links.md) and
  [guest picks](receipts/guest-picks.md).
- Raw errors and stack traces never reach a client.

## Dev server and bundler

- `pnpm dev` runs `next dev --turbopack`; `next build` uses webpack. Code in
  any package the web app imports must compile under both.
- Turbopack treats a `fork()` argument it can partly evaluate as a module
  reference and resolves it at build time. The OCR adapter
  (`packages/services/src/ocr.ts`) computes its worker path at runtime, so it
  starts the worker through `forkWorker(file, options)`, where the path is a
  plain parameter. Calling `fork()` directly on a path containing a constant
  suffix fails every route that imports `@project/services` in dev.
  `/* turbopackIgnore: true */` does not prevent this. See
  [the postmortem](../postmortems/2026-11-receipt-dev-compilation.md).
- The parse route's build trace (`outputFileTracingIncludes` in
  `apps/web/next.config.ts`) carries `ocr-worker.cjs`, `pnpm-workspace.yaml`
  and the Tesseract packages, so the forked worker exists at runtime.

## Verify

- The integration suite exercises one happy + one sad path per endpoint.
- `curl` the health endpoint with the db up and down.
- Phone pass on every page a PR adds or changes: open it in browser devtools
  at 375px wide (or on a real phone), confirm no horizontal scroll, every
  action reachable and tappable without zooming, and no hover-only controls.
- Dev-server receipt drill: with `pnpm dev` running, a signed-out
  `GET /api/receipts` returns 401 with the JSON error shape (a 500 means the
  route failed to compile). Signed in, list receipts (200), upload a photo
  (201), fetch its image (200), and `POST` parse with the current revision
  (200), then confirm the extracted items and totals.
- After `pnpm build`,
  `apps/web/.next/server/app/api/receipts/[id]/parse/route.js.nft.json` lists
  `packages/services/src/ocr-worker.cjs`.

## Key decisions

- [ADR-0003](../adr/0003-dev-identity-stub.md) — identity stub + production guard.
- [ADR-0009](../adr/0009-domain-web-only.md) — schemas/queries live in `packages/domain`.
- [ADR-0015](../adr/0015-guest-pick-links.md) — guest links, the one token-scoped exception.
