---
type: feature
---
# A participant who verifies their phone reads every bill addressed to it

## Why

People at dinner have no account. They should be able to see what they owe on
every receipt that lists their phone, from any organizer, by proving they hold
that phone with a texted code.

## Where it lives

- packages/domain/src/phone-auth.ts: normalizePhone, PhoneNumber,
  StartPhoneVerification, VerifyPhoneCode, createPhoneVerification,
  verifyPhoneCode, requirePhoneSession, revokePhoneSession.
- packages/domain/src/bills.ts: listVerifiedPhoneBills.
- packages/auth/src/phone-session.ts: session cookie and client IP helpers.
- packages/services/src/sms.ts: sendSms (the SMS seam; Twilio in production).
- packages/db/prisma/migrations/0003_phone_verification.sql: PhoneVerification,
  PhoneSession, participant phone normalization and index.
- apps/web/app/api/phone-auth/start, verify and session routes.
- apps/web/app/api/participant-bills/route.ts.
- apps/web/tests/phone-auth-route.test.ts, packages/domain/tests/phone.test.ts.

## Behavior

- Phones are compared in E.164. Input may use spaces, dots, dashes and
  parentheses. Ten digits gain +1, 11 digits starting with 1 gain +, a leading
  00 becomes +; anything else must start with + and a country code. Invalid
  phones are 400 INVALID_INPUT.
- POST /api/phone-auth/start { phone } answers 202 with no body for every
  valid phone. It texts a code only when the phone belongs to a participant on a
  non-deleted receipt and neither limit is reached: 3 codes per phone per 15
  minutes, 10 per client IP per hour. A new code consumes earlier unused codes
  for that phone. SMS delivery failures are logged and still answer 202.
- Codes are six digits, expire after 10 minutes, and allow 5 checks. Only a
  keyed hash is stored.
- POST /api/phone-auth/verify { phone, code } answers 204 and sets the
  phone_session cookie (HttpOnly, SameSite=Lax, Path=/api, Secure in production,
  7 days). Wrong, expired, consumed, locked or other-phone codes all answer 400
  INVALID_INPUT "Code is invalid or expired". A code verifies at most once,
  including under concurrency.
- GET /api/participant-bills returns bills whose participant phone equals the
  verified phone, across all organizers, excluding deleted receipts, ordered by
  bill createdAt descending then id. Each bill has the bills/list.md projection
  plus receipt { title, merchantName, purchasedAt, currency }. No match is [].
- A missing, forged, expired or revoked session answers 401 UNAUTHENTICATED
  "Phone verification required".
- DELETE /api/phone-auth/session revokes the session, clears the cookie and
  answers 204, with or without a valid session.
- The phone session reads only. It grants no receipt, item, participant or bill
  write, and organizer routes ignore it.
- Unexpected errors are the generic 500.

## Examples

| State / input | Behavior |
|---|---|
| start "(212) 555-0123", phone on a live receipt | 202, code texted to +12125550123 |
| start for a phone on no live receipt | 202, nothing texted or stored |
| start "12345" | 400 INVALID_INPUT |
| Fourth start within 15 minutes | 202, nothing texted |
| verify with the texted code | 204 and phone_session cookie |
| Same code again | 400 |
| Five wrong codes, then the right one | 400 |
| participant-bills, phone on two organizers' receipts and one deleted | Two bills, newest first |
| participant-bills after sign-out | 401 |

## Verify

- pnpm test runs phone-auth-route.test.ts (limits, hashing, expiry, lockout,
  single use, cross-organizer reads, deleted receipts, session expiry and
  revocation), phone.test.ts (normalization), sms.test.ts (stand-in, production
  guard and the Twilio request) and the 0003 migration test.
- Local drill with pnpm dev and pnpm db:seed: POST /api/phone-auth/start with
  {"phone":"+12125550123"}, read the code from the "dev sms (not sent)" log
  line, POST /api/phone-auth/verify, then GET /api/participant-bills with the
  returned cookie.
- pnpm typecheck and pnpm build pass.

## Constraints & decisions

- ADR-0015 governs: why a verified phone is an identity, the limits, hashing
  and the SMS seam.
- Holding a phone is the whole authorization; recycled or mistyped numbers are
  accepted risks for read-only bill data.
- North American default only; no phone-number library.
- Expired codes and sessions are filtered when read, not purged.
- The rate-limit check and code insert are not serialized, so concurrent starts
  can exceed a limit by a few codes.

## Out of scope

- Marking bills paid or any participant write: not built.
- Organizer sign-in: auth.md.
- Normalizing phones on participant writes: the participants route is a
  scaffold; it must call PhoneNumber when it is built (receipts/model.md).
- Purging expired rows: future worker job.
