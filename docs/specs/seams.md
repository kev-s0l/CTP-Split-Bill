---
type: infrastructure
---
# Seams — the unifying pattern

Local infrastructure uses stand-ins; production connects to Azure services.
Identity uses the same GitHub OAuth flow in development and production:

```
local dev:  a stand-in (emulator, stub, env flag)
production: the real thing (Azure, real auth, etc.)
```

This is called the **seam pattern** — a deliberate cut point where local and
production infrastructure behavior diverges, controlled by configuration.

## Instances

| Subsystem | Local stand-in | Production | Env var / switch |
|---|---|---|---|
| Database (tests) | PGlite (in-memory) | — | `PGLITE_DATA_DIR` flag |
| Database (dev) | Local Postgres via `apps/db-server/` | Azure Postgres | `DATABASE_URL` |
| Blob storage | Azurite | Azure Blob Storage | `AZURE_STORAGE_CONNECTION_STRING` |
| Queue | Azurite | Azure Storage Queue | `AZURE_STORAGE_CONNECTION_STRING` |
| Identity | GitHub OAuth with Auth.js database sessions | Same Auth.js flow | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET` |

## Design intent

- **No code branches.** The seam is never an `if (isLocal)`. The stand-in and
  the real thing implement the same interface, and the configuration chooses
  which one the SDK connects to.
- **Default to running.** Local infrastructure works without cloud accounts.
  `pnpm dev` starts Postgres and Azurite; GitHub OAuth needs app credentials.
- **Safe by default.** Identity comes from a validated OAuth flow and a
  server-side database session.
- **Configuration stays explicit.** Azure Blob and Queue share
  `AZURE_STORAGE_CONNECTION_STRING`; the database has its own
  (`DATABASE_URL`); OAuth uses the GitHub client credentials and session
  secret listed above.

## ADRs

- [ADR-0005](../adr/0005-pglite-tests.md) — PGlite as the test-database seam.
- [ADR-0008](../adr/0008-azurite-seam.md) — Azurite as the blob/queue seam.
- [ADR-0003](../adr/0003-dev-identity-stub.md) — the identity stub as the auth
  seam.

## Adding a new seam

1. Write the stand-in (emulator, stub, env guard).
2. Default to the stand-in.
3. Require one env var to swap to production.
4. Add a health check or probe that tells the user if the stand-in is down.
5. Write an ADR capturing the decision.
6. Add a row to this table.
