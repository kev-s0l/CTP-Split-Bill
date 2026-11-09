---
type: infrastructure
---
# Specifications

## Purpose

Specifications describe the current subsystem contracts and feature behavior.
Infrastructure specs are cross-cutting; feature specs live under their domain.
Specs are evergreen and change with behavior. ADRs record decisions separately.
Issues and PRs cite specs, never the reverse.

New documents use _template-feature.md or _template-infrastructure.md.
Every feature template section is required. See ../../CONTRIBUTING.md.

## Infrastructure

| Spec | Contract |
|---|---|
| [monorepo](monorepo.md) | Workspace layout and dependency boundaries |
| [seams](seams.md) | Local stand-ins and production adapters |
| [storage](storage.md) | Blob, queue and notification adapters |
| [web](web.md) | Health, async UI and server-entry standards |
| [api](api.md) | Implemented routes, planned scaffolds, ownership and errors |
| [auth](auth.md) | Existing identity seam and separate authentication work |
| [deploy](deploy.md) | Deployment topology and configuration |
| [observability](observability.md) | Logging and request context |
| [components](components.md) | Presentational web components |

## Identity features

| Spec | Behavior |
|---|---|
| [sign-in](auth/sign-in.md) | GitHub OAuth and database-backed sessions |
| [profile](auth/profile.md) | Current organizer's selected profile fields and private, uncached reads |

## Receipt and bill features

| Spec | Behavior |
|---|---|
| [receipt model](receipts/model.md) | Direct ownership, receipt-local participants and atomic legacy migration |
| [receipt image](receipts/image.md) | Private owner-scoped photo download with missing-blob and outage handling |
| [receipt parsing](receipts/parse.md) | Local OCR, guarded draft replacement and recoverable parsing failures |
| [receipt upload](receipts/upload.md) | Validated photo upload and owned draft creation with failed-write cleanup |
| [receipt detail](receipts/detail.md) | Owner-only receipt, participant and item projection |
| [receipt corrections](receipts/edit.md) | Versioned metadata/money edits and review confirmation |
| [receipt items](receipts/items.md) | Atomic corrected-item replacement and assignment cleanup |
| [assignments](bills/allocations.md) | One-person item assignments and separate equal shared allocations |
| [preview](bills/preview.md) | Read-only allocation breakdown for a stored draft revision |
| [finalization](bills/split-allocation.md) | Exact-cent server calculation and immutable bill snapshots |
| [bill reads](bills/list.md) | Owner-only bill breakdowns and outstanding amounts |
| [public sharing](bills/public-share.md) | Deferred public portals; current access remains organizer-only |

## Draft features (under review)

| Spec | Behavior |
|---|---|
| [participants](receipts/participants.md) | Implemented roster replacement; document still marked draft |
| [guest picks](receipts/guest-picks.md) | Per-participant pick links, guest item picks and done status (needs ADR-0015) |
| [totals check](receipts/totals-check.md) | Detail reports item/amount differences; mismatches still cannot finalize |

Party specifications and APIs are retired. Historical SQL remains append-only.

## Verify

- Links above resolve to checked-in specifications.
- Each behavior change updates its governing spec and API index.
- Implemented operations and planned scaffolds remain explicitly distinct.

## Key ADRs

- ADR-0004: Prisma schema and SQL migrations.
- ADR-0009: web-only domain package.
- ADR-0014: receipt-owned domain.
- ADR-0015 (proposed): per-participant pick links.
