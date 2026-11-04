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
  access. The client never supplies ownership identity. The one exception is
  /api/participant-bills, scoped by a verified phone session (ADR-0015).
- Reads and writes exclude deleted receipts. Foreign, unknown and deleted
  resources return 404 without confirming their existence.
- Draft writes require expectedRevision. The receipt lock checks owner, DRAFT,
  non-PARSING state and revision, then advances revision transactionally.
- Errors use { error: { code, message } }. Invalid JSON/input is 400; unknown
  user 401; absent/foreign 404; stale/state conflicts 409; unexpected failures
  generic 500. Prisma P2002 maps to 409 and P2025 to 404.
- Health is the documented public exception and retains its probe response.

## Implemented operations

| Method | Route | Input / result | Spec |
|---|---|---|---|
| GET | /api/health | 200 process/DB health; 503 when DB is unavailable | web.md |
| GET | /api/receipts/[id] | Owned receipt, revision, parsing/review state, participants, ordered items and allocations | receipts/detail.md |
| PATCH | /api/receipts/[id] | UpdateReceipt; corrections, split mode or review confirmation; receipt detail | receipts/edit.md |
| PUT | /api/receipts/[id]/items | ReplaceItems with expectedRevision; full replacement clears assignments/sharing/review | receipts/items.md |
| PUT | /api/receipts/[id]/assignments | ReplaceAssignments with expectedRevision and assignments: [{itemId, participantId}]; receipt detail | bills/allocations.md |
| PUT | /api/receipts/[id]/shared-allocations | ReplaceSharedAllocations with expectedRevision and allocations: [{itemId, participantIds}]; receipt detail | bills/allocations.md |
| POST | /api/receipts/[id]/finalize | ExpectedRevision; calculate from stored reviewed data and return FINALIZED receipt detail | bills/split-allocation.md |
| GET | /api/receipts/[id]/bills | Ordered bill array with settlement and outstanding amounts | bills/list.md |
| GET | /api/bills/[billsId] | One owned bill identified by bill ID | bills/list.md |
| POST | /api/phone-auth/start | { phone }; always 202, texts a code to known phones within limits | bills/phone-lookup.md |
| POST | /api/phone-auth/verify | { phone, code }; 204 and phone_session cookie, or 400 | bills/phone-lookup.md |
| DELETE | /api/phone-auth/session | Revoke the phone session and clear the cookie; 204 | bills/phone-lookup.md |
| GET | /api/participant-bills | Verified phone's bills across organizers with receipt context; 401 without a session | bills/phone-lookup.md |

The bracket names match their route directories. Receipt handlers read params.id;
the individual bill handler reads params.billsId. Missing IDs never widen a query.

## Planned scaffolds

These files carry responsibility comments and export no HTTP handlers yet:
GET /api/me; GET/POST /api/receipts; GET /api/receipts/[id]/image;
POST /api/receipts/[id]/parse; PUT /api/receipts/[id]/participants;
POST /api/receipts/[id]/preview. The individual bill PATCH remains planned.
Scaffold existence is not implemented functionality.

The history query exists in the domain package but is not wired to collection
GET yet. Paid-state writes, upload/OCR and contact editing remain feature work.
Party APIs and public share links are outside this API. Guest access is only
the phone-verified read above.

## Verify

- pnpm test covers every implemented receipt/bill handler, including owner and
  foreign requests, validation, revision/state guards, rollback and concurrency.
- pnpm typecheck and pnpm build pass.
- The seed drill in packages/domain/tests/receipts.test.ts reads, confirms and
  finalizes an owned receipt, checks total 38.66, and rejects other-user.
- Health's stopped-database drill remains in web.md.

## Key ADRs

- ADR-0003: development identity stub.
- ADR-0009: web-only domain queries and validation.
- ADR-0014: receipt ownership and receipt-local participants.
- ADR-0015: phone-verified participant bill reads.
