---
type: infrastructure
---
# API surface and receipt ownership

## Purpose

Routes agree on identity, ownership, validation and errors. Feature specs own
detailed behavior; this page distinguishes implemented operations from scaffolds.

## Contract

- Lowercase plural resources live under /api. Globally identified resources are
  directly addressed; receipt-owned collections are nested beneath the receipt.
- Route handlers derive currentUserId, validate Zod inputs, call the web-only
  domain package, map errors and revalidate successful mutations.
- Receipt.ownerId is the authorization boundary. Participant rows confer no
  access. The client never supplies ownership identity.
- Reads and writes exclude deleted receipts. Foreign, unknown and deleted
  resources return 404 without confirming their existence.
- Updates to existing drafts require expectedRevision. Creation starts at revision
  1. The receipt lock checks owner, DRAFT,
  non-PARSING state, picking paused and revision, then advances revision
  transactionally. Opening or pausing picking and the organizer's own picks
  take no expectedRevision (receipts/guest-picks.md).
  Parsing additionally supports guarded recovery of an abandoned attempt after
  five minutes, as described in receipts/parse.md.
- Errors use { error: { code, message } }. Invalid JSON/input is 400; unknown
  user 401; absent/foreign 404; stale/state conflicts 409; unexpected failures
  generic 500. Receipt image storage failures return 503 with code INTERNAL and
  a retry message. Prisma P2002 maps to 409 and P2025 to 404.
- Health is the documented public exception and retains its probe response.
- Guest links are the one token-scoped exception (ADR-0015): /api/picks/[token]
  routes derive no user identity; the token hash is the scope
  (receipts/guest-picks.md).

## Implemented operations

| Method | Route | Input / result | Spec |
|---|---|---|---|
| GET | /api/health | 200 process/DB health; 503 when DB is unavailable | web.md |
| GET | /api/me | Session user's id, name, email, image and phone; private, uncached response | auth/profile.md |
| GET | /api/receipts | Owned, non-deleted receipt history, newest first | receipts/detail.md |
| GET | /api/receipts/summary | Owned receipt summaries for the home list, including drafts and settlement state | bills/list-screen.md |
| POST | /api/receipts | One multipart file; 201 owned draft and Location; JPEG/PNG/WebP up to 5 MiB | receipts/upload.md |
| GET | /api/receipts/[id] | Owned receipt, revision, parsing/review state, participants, ordered items and allocations | receipts/detail.md |
| GET | /api/receipts/[id]/image | Private original photo bytes after owner authorization | receipts/image.md |
| POST | /api/receipts/[id]/parse | ParseReceipt; local OCR into unreviewed draft items and fields | receipts/parse.md |
| PATCH | /api/receipts/[id] | UpdateReceipt; corrections, split mode or review confirmation; receipt detail | receipts/edit.md |
| PUT | /api/receipts/[id]/items | ReplaceItems with expectedRevision; full replacement clears assignments/sharing/review | receipts/items.md |
| PUT | /api/receipts/[id]/participants | ReplaceParticipants with expectedRevision and participants: [{id?, displayName?, phone?, email?}]; receipt detail | receipts/participants.md |
| POST | /api/receipts/[id]/participants/[participantId]/pick-link | Issue or rotate a participant's pick link; `{ url }`, shown once | receipts/guest-picks.md |
| DELETE | /api/receipts/[id]/participants/[participantId]/pick-link | Revoke a participant's pick link; idempotent | receipts/guest-picks.md |
| POST | /api/receipts/[id]/picking | `{ open }`; open or pause picking without changing the revision; receipt detail | receipts/guest-picks.md |
| PUT | /api/receipts/[id]/picks | `{ itemIds }`; the organizer row's complete pick set, in either mode; receipt detail | receipts/guest-picks.md |
| GET | /api/picks/[token] | Token-scoped projection: picking state on a draft, everyone's amounts once finalized | receipts/guest-picks.md |
| PUT | /api/picks/[token] | ReplacePicks with itemIds; the holder's complete pick set; 409 while editing or once finalized | receipts/guest-picks.md |
| POST | /api/picks/[token]/done | Mark the holder's picks submitted; idempotent; 409 while editing or once finalized | receipts/guest-picks.md |
| PUT | /api/receipts/[id]/assignments | ReplaceAssignments with expectedRevision and assignments: [{itemId, participantId}]; receipt detail | bills/allocations.md |
| PUT | /api/receipts/[id]/shared-allocations | ReplaceSharedAllocations with expectedRevision and allocations: [{itemId, participantIds}]; receipt detail | bills/allocations.md |
| POST | /api/receipts/[id]/preview | ExpectedRevision; read-only participant allocations for the stored draft revision | bills/preview.md |
| POST | /api/receipts/[id]/finalize | ExpectedRevision; calculate from stored reviewed data and return FINALIZED receipt detail | bills/split-allocation.md |
| GET | /api/receipts/[id]/bills | Ordered bill array with settlement and outstanding amounts | bills/list.md |
| GET | /api/bills/[billsId] | One owned bill identified by bill ID | bills/list.md |
| PATCH | /api/bills/[billsId] | SetBillPaid with paid: boolean; updated bill with settlement and outstanding amounts | bills/list.md |

The bracket names match their route directories. Receipt handlers read params.id;
the individual bill handler reads params.billsId. Missing IDs never widen a query.

## Planned operations

Upload creates an unparsed draft; parsing is an explicit separate request.
Image download, parsing and participant replacement are implemented.
Party APIs, guest authentication and public share links are outside this API; guests reach a
receipt only through a pick link.

Draft, pending review: totals on GET /api/receipts/[id]
(receipts/totals-check.md). It does not exist yet.

## Verify

- apps/web/tests/me-route.test.ts checks exact own-profile reads, nullable
  fields, identity changes, fresh reads, authentication and generic failures.
- pnpm test covers every implemented receipt/bill handler, including owner and
  foreign requests, validation, revision/state guards, rollback and concurrency.
- apps/web/tests/bills-route.test.ts invokes both assignment handlers,
  preview, finalization, the receipt bill collection and the individual bill handler
  using params.id or params.billsId and revision-bearing mutation bodies.
- apps/web/tests/bills-paid-route.test.ts checks paid/unpaid PATCH, timestamp
  preservation on retries, immutable amounts, invalid input and owner/deletion guards.
- apps/web/tests/receipts-upload-route.test.ts checks multipart input, image
  signatures/size, authentication, ownership/defaults, storage failures and
  cleanup. The opt-in Azurite drill is in receipts/upload.md.
- Image and parse route tests cover ownership, photo bytes/headers, extraction,
  transactional replacement, failure preservation and superseded attempts.
  The opt-in real OCR drill is in ../runbooks/receipt-ocr.md.
- pnpm typecheck and pnpm build pass.
- The seed drill in packages/domain/tests/receipts.test.ts reads, confirms and
  finalizes an owned receipt, checks total 38.66, and rejects other-user.
- Health's stopped-database drill remains in web.md.

## Key ADRs

- ADR-0003: development identity stub.
- ADR-0009: web-only domain queries and validation.
- ADR-0014: receipt ownership and receipt-local participants.
