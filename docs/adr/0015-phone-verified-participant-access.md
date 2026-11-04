# ADR-0015: Phone verification as a second identity for participant bill reads

## Status

Proposed

## Context

Participants are receipt-local contacts with optional phones (ADR-0014), and
only the receipt owner can read bills. A participant who wants to see what they
owe, across every organizer who added them, has no account and no session, so
there is no user to scope by. The ground rule "every query is scoped by the
current user" makes an ad-hoc lookup by phone a defect: phone numbers are
guessable, and a bare-phone lookup would expose names, amounts and merchants to
anyone who types a number.

The proposed share link (ADR-0012) predates the receipt-owned model and covers
one resource per link, not "all of my bills". Organizer sign-in (auth.md target)
is GitHub OAuth, which participants should not need.

The app is moving to Azure Container Apps; whatever sends codes must have a
local stand-in and a production provider whose credentials live in Container
Apps secrets. Twilio is chosen over Azure Communication Services for its
mature US deliverability, Messaging Services and simpler number onboarding.

## Decision

Add a second identity kind: a **verified phone**, proven by a texted one-time
code. The verified phone is the scope for one read: bills whose participant
phone equals it.

- **Phone format.** Stored and entered phones are compared in E.164.
  `normalizePhone` applies North American defaults (10 digits gain +1, a
  leading 00 becomes +); other countries must include their code. Migration
  0003 normalizes existing participant phones; unparseable values stay as-is
  and never match. No phone library is added; the rules are small and tested.
- **Codes.** Six digits from a CSPRNG, valid 10 minutes, at most 5 checks.
  Stored as HMAC-SHA256 keyed by `PHONE_AUTH_SECRET`, so a database leak alone
  cannot brute-force the code space. Issuing a code consumes earlier unused
  codes for that phone. A failed check is counted before comparison and is
  never rolled back.
- **Sending.** Codes are texted only to phones that appear on a non-deleted
  receipt, at most 3 per phone per 15 minutes and 10 per client IP per hour.
  The start endpoint always answers 202, so it reveals neither existence nor
  limits. Delivery failures are logged, not surfaced.
- **Sessions.** 32 random bytes, base64url, in an `HttpOnly; SameSite=Lax;
  Path=/api` cookie (`Secure` in production), 7-day lifetime. The database
  stores only the SHA-256 of the token. Sign-out revokes the row.
- **Scope of access.** Read-only. A phone session reads bills for that phone
  across all organizers, excluding deleted receipts, with the participant's own
  name and phone and receipt title, merchant, date and currency. It never
  exposes other participants, items, owner identity, images or extraction data,
  and it grants no write.
- **SMS seam.** `sendSms` in `packages/services`. Unset `TWILIO_ACCOUNT_SID`
  uses a stand-in that logs the message; set, it posts to Twilio's Messages
  API with `TWILIO_AUTH_TOKEN`, from `TWILIO_FROM` (an E.164 sender number, or
  a Messaging Service SID starting `MG`). The stand-in throws in production
  unless `ALLOW_DEV_SMS` is set, mirroring the identity stub's guard
  (ADR-0003). It calls the REST API with `fetch`; no Twilio SDK dependency.
- **Own codes, not Twilio Verify.** Codes, limits and sessions stay in this
  database so the stand-in exercises the same logic as production and the
  provider is a plain message pipe that can be swapped.
- **Supersedes in part** ADR-0014's "participants grant no access": a
  participant row still grants nothing by itself, but possession of its phone,
  once verified, grants this one read.

## Consequences

- **Easier**: participants see every bill addressed to their phone without an
  account, and organizers do nothing extra. The exception is one read route a
  reviewer can audit against this list.
- **Harder**: whoever controls a phone number controls its bills. A recycled
  number exposes the previous holder's bills; an organizer who types a wrong
  number addresses a bill to a stranger. Both are accepted for read-only
  amounts and merchant names and revisited if bills gain more sensitive data.
- **Harder**: SMS costs money and is an abuse target; the limits above are the
  only control. The per-IP limit trusts the first `X-Forwarded-For` entry,
  which Container Apps ingress sets; outside that ingress it is spoofable.
- **Harder**: the SMS seam needs three production settings, not one.
  `TWILIO_ACCOUNT_SID` remains the single switch; the token and sender are
  required configuration once switched.
- **Harder**: SMS leaves Azure, so it is a second vendor with its own billing,
  console and credentials outside Azure RBAC.
- **Operational**: US sending needs a registered sender before carriers deliver:
  a toll-free number with toll-free verification, or a 10DLC number with A2P
  brand and campaign registration. Either takes days to weeks. The auth token
  and `PHONE_AUTH_SECRET` are Container Apps secrets (Key Vault references
  when Key Vault is adopted). Rotating the secret invalidates outstanding codes
  only; sessions are revoked separately.
- **Deferred**: expired codes and sessions are filtered at read time and not
  yet purged; a worker cleanup job is future work. Authenticating with a
  revocable Twilio API key instead of the account auth token is a later,
  compatible change to the seam.
- Organizer GitHub sign-in (auth.md target) is unaffected and remains the only
  identity for receipt ownership and writes.

## See also

- `docs/specs/bills/phone-lookup.md` — the behavior this ADR permits.
- `docs/specs/auth.md` — identity kinds.
- `docs/specs/seams.md` — the SMS seam row.
- `docs/runbooks/enable-twilio-sms.md`, `docs/runbooks/rotate-phone-auth-secret.md`.
- ADR-0003, ADR-0012, ADR-0014.
