---
type: feature
---
# A guest reads their one bill through the link its organizer sent

## Why

People at dinner have no account. The organizer sends each of them a link from
their own phone, and tapping it shows that person's share, with no sign-up
and no messaging service between them.

## Where it lives

- packages/domain/src/bill-links.ts: issueBillLink, revokeBillLink, readBillLink.
- packages/domain/src/bills.ts: the shared bill projection.
- packages/db/prisma/migrations/0003_bill_links.sql: BillLink and E.164 phones.
- apps/web/app/api/bills/[billsId]/link/route.ts: organizer POST and DELETE.
- apps/web/app/api/bill-links/[token]/route.ts: public GET.
- apps/web/app/b/[token]/page.tsx: the guest page the link opens.
- apps/web/tests/bill-links-route.test.ts.

## Behavior

- POST /api/bills/[billsId]/link issues the bill's link and answers 201 with
  { url, expiresAt, message, smsHref }. url is `<base>/b/<token>`, where base
  is PUBLIC_BASE_URL or the request origin. message is "Hi <name>, your share
  of <merchant, else title, else "the bill"> is <amountOwed>. View your bill:
  <url>". smsHref is `sms:<phone>?body=<encoded message>` when the participant
  has a phone, else null. The raw token appears only in this response.
- Issuing again revokes the bill's previous link in the same transaction. At
  most one unrevoked link exists per bill; a concurrent reissue that loses
  answers 409.
- DELETE /api/bills/[billsId]/link revokes the live link and answers 204,
  also when none is live.
- Both organizer operations need a known identity (401) and an owned bill on a
  non-deleted receipt; foreign, unknown and deleted-receipt bills are 404.
- Tokens are 32 random bytes, base64url (43 characters). Only their SHA-256 is
  stored. Links expire 90 days after issue.
- GET /api/bill-links/[token] needs no identity and answers { displayName,
  subtotal, taxShare, tipShare, amountOwed, paidAt, settled, outstandingAmount,
  receipt: { title, merchantName, purchasedAt, currency }, expiresAt }. It
  contains no ids, phones, other participants, items, images or extraction.
- Settlement is read live, so a bill marked paid after sending shows settled.
- Malformed, unknown, revoked, expired and deleted-receipt links all answer the
  same 404 "Bill not found". Malformed tokens are rejected before any query.
- Public responses, including errors, send Cache-Control: no-store,
  Referrer-Policy: no-referrer and X-Robots-Tag: noindex, nofollow.
- /b/[token] renders the same read as a page with noindex and no-referrer
  metadata; links that would 404 render the not-found page.
- Neither the link nor the page changes any data. Unexpected errors are the
  generic 500.

## Examples

| State / input | Behavior |
|---|---|
| Organizer issues a link for Sam ($6.00 at Trattoria, phone on file) | 201, message and sms: href with the link |
| Bill without a phone | 201, smsHref null |
| Organizer issues again | Old link 404s, new link works |
| Another organizer issues or revokes | 404, nothing changes |
| Guest opens the link | Sam's amounts and receipt context only |
| Sam is marked paid after the text | Link shows settled, outstanding 0.00 |
| Link revoked, expired or receipt deleted | 404 "Bill not found" |

## Verify

- pnpm test runs bill-links-route.test.ts (issue, hashing, reissue, revoke,
  scoping, projection, headers, live settlement, uniform 404s, generic 500) and
  the 0003 migration test (one live link per bill, unique hashes).
- Local drill with pnpm dev: finalize a receipt, POST its bill's link with
  curl, open the returned url in a browser, then DELETE and reload for 404.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- ADR-0016 governs: the link is the whole authorization for one bill.
- The organizer's own device sends the text; the app integrates with no
  messaging provider.
- A forwarded link shows that bill to whoever holds it until revoked or
  expired. Revocation is the remedy; there is no per-viewer audit trail.
- Tokens travel in the URL path, so request logs that record paths can capture
  them; the app never logs tokens itself.

## Out of scope

- A guest view of all their bills, by device or by phone: deferred (ADR-0016).
- Marking a bill paid from the guest page or any guest write: not built.
- Organizer UI for sending: the API returns smsHref for it to use.
