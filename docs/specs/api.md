---
type: infrastructure
---
# API surface — every HTTP endpoint, its input, errors, and scoping

## Purpose

One table of every route the web app exposes, so naming, validation, error
codes, and scoping are decided once and every endpoint agrees. Each feature
spec owns the detailed behavior of its endpoint; this page is the index and
the shared rules. A PR that adds or changes an endpoint updates its row here.

## Rules every endpoint follows

- **Naming.** Lowercase plural nouns under `/api`, ids in brackets:
  `/api/parties/[partyId]`. A resource with a globally unique id is addressed
  directly (`/api/receipts/[receiptId]`), not nested under its parent.
- **The server entry ritual** from [web](web.md): identity → Zod → scoped
  query → act → map errors → revalidate.
- **Identity** comes from `currentUserId()` in `@project/auth`
  ([auth](auth.md)). The client never supplies a user id in a body or query.
- **Validation and queries** live in `packages/domain/src/<resource>.ts`
  ([ADR-0009](../adr/0009-domain-web-only.md)). Route files only wire them
  together.
- **Errors** use one shape, `{ error: { code, message } }`, built by the
  shared helpers in `packages/domain/src/errors.ts`: domain functions
  throw `ApiError`, routes catch with `toApiError` (Prisma P2002 → 409,
  P2025 → 404, anything else → 500) and reject bad input with
  `invalidInput`. Raw errors never reach the client.
- **Scoping.** "I'm a member" means a `PartyMember` row exists with
  `userId = me` for that party. Creating a party also creates the organizer's
  `PartyMember` row, so membership is the single access check.
- **404, not 403**, for anything foreign or unknown. 403 is used only when I
  am a member but the action is organizer-only.
- **Soft delete.** Reads filter `deletedAt: null` on `Party` and `Receipt`.

## Error codes

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_INPUT` | Zod rejects the body, or a precondition fails |
| 401 | `UNAUTHENTICATED` | No identity |
| 403 | `FORBIDDEN` | Member, but the action is organizer-only |
| 404 | `NOT_FOUND` | Unknown, foreign, or soft-deleted resource |
| 409 | `CONFLICT` | Unique violation, or the resource is in the wrong state |
| 500 | `INTERNAL` | Anything unexpected; the real error is logged, never sent |

## Round 1 — list, read, create

| Route | Method | Input schema | Errors | Scoping | Spec |
|---|---|---|---|---|---|
| `/api/parties` | GET | — | 401 | Parties where I'm a member, not deleted | `parties/list.md` |
| `/api/parties` | POST | `CreateParty { name: string 1–100 }` | 400, 401 | `organizerId = me`; my `PartyMember` row created in the same transaction | `parties/create.md` |
| `/api/parties/[partyId]` | GET | — | 401, 404 | I'm a member; returns the party with its members | `parties/detail.md` |
| `/api/parties/[partyId]/members` | POST | `AddMember { displayName: string 1–50, userId?: string }` (no `userId` = guest) | 400, 401, 403, 404, 409 | I'm a member (else 404); I'm the organizer (else 403); same user twice → 409 | `parties/members.md` |
| `/api/parties/[partyId]/receipts` | GET | — | 401, 404 | I'm a member; receipts not deleted, newest first | `receipts/list.md` |
| `/api/receipts/[receiptId]` | GET | — | 401, 404 | I'm a member of the receipt's party; returns items ordered by `lineNumber` | `receipts/detail.md` |

## Round 2 — editing receipts and splitting

| Route | Method | Input schema | Errors | Scoping | Spec |
|---|---|---|---|---|---|
| `/api/parties/[partyId]/receipts` | POST | multipart image upload | 400, 401, 404 | I'm a member; `uploadedById = me` | `receipts/upload.md` |
| `/api/receipts/[receiptId]` | PATCH | `UpdateReceipt { merchantName?, purchasedAt?, subtotal?, tax?, tip?, total?, paidByMemberId?, splitMode? }` | 400, 401, 404, 409 | I'm a member; 409 once `FINALIZED` | `receipts/edit.md` |
| `/api/receipts/[receiptId]/items` | PUT | `ReplaceItems { items: [{ lineNumber, name, quantity, unitPrice, totalPrice }] }` (decimal strings; empty array clears items) | 400, 401, 404, 409 | I'm a member; replaces all items and clears old shares in one transaction; 409 once `FINALIZED` | `receipts/items.md` |
| `/api/receipts/[receiptId]/allocations` | PUT | `ReplaceShares { shares: [{ itemId, memberId, weight }] }` (positive integer weights; empty array clears shares) | 400, 401, 404, 409 | I'm a member; every `itemId` and `memberId` belongs to this receipt/party, otherwise 404; atomic replacement; 409 once `FINALIZED` | `bills/allocations.md` |
| `/api/receipts/[receiptId]/finalize` | POST | — | 400, 401, 404, 409 | See [split-allocation](bills/split-allocation.md) | `bills/split-allocation.md` |
| `/api/receipts/[receiptId]/bills` | GET | — | 401, 404 | I'm a member of the receipt's party; returns ordered bill breakdowns with payment sums and settled flags | `bills/list.md` |

## Later — payments and notifications

| Route | Method | Input schema | Errors | Scoping | Spec |
|---|---|---|---|---|---|
| `/api/bills/[billId]/payments` | POST | `RecordPayment { amount: decimal > 0 }` | 400, 401, 403, 404 | I'm the receipt's `paidBy` member (the recipient) | `bills/payments.md` |
| `/api/parties/[partyId]/reminders` | POST | — | 401, 403, 404 | Organizer only; notifies members with unpaid bills | — |
| `/api/me/notifications` | GET | — | 401 | My notifications only | — |

Reminders and notifications need a `Notification` model and a migration, and
belong with background work in the worker. They are not designed yet.

The public read-only share page lives at `/s/[token]`, outside `/api`, and is
the one unscoped read. See [public-share](bills/public-share.md).

## Verify

- Every route file under `apps/web/app/api/` has a row here, and every row
  marked for a round that has shipped has a route file.
- Each endpoint's integration test covers one happy path and one sad path,
  including a request as a second seeded user that gets 404.
- `curl -i -H "x-user-id: other-user" /api/parties/<a demo-user party id>`
  returns 404 with the error shape above.

## Key ADRs

- [ADR-0003](../adr/0003-dev-identity-stub.md) — the dev identity stub.
- [ADR-0009](../adr/0009-domain-web-only.md) — schemas and queries in `packages/domain`.
- [ADR-0012](../adr/0012-public-share-link.md) — the public share link.
