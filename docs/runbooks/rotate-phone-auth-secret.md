# The phone-auth secret or phone sessions may be compromised

**Use when:** `PHONE_AUTH_SECRET` or the Twilio auth token leaked, the
`phone_sessions` table was exposed, or participants report bills seen by
someone else.
**Last drilled:** never

## Before you start

- Azure CLI logged in with Contributor on the Container App's resource group
  (`$APP`, `$RG`), and Twilio Console access as account owner or admin.
- `psql` access to the production database (`DATABASE_URL` from the Container
  App's secrets).
- Blast radius: steps 1–2 invalidate codes in flight (participants request a
  new one). Step 3 signs every participant out. Organizers are unaffected.

## Steps

1. Generate and store a new code-hashing secret, then restart the active revision so it reads it:
   `az containerapp secret set -n $APP -g $RG --secrets phone-auth-secret="$(openssl rand -base64 32)"`
   `az containerapp revision restart -n $APP -g $RG --revision $(az containerapp revision list -n $APP -g $RG --query "[?properties.active].name | [0]" -o tsv)`
2. If the Twilio auth token leaked: Twilio Console → Account → API keys &
   tokens → Auth tokens → Request a secondary token. Store it with
   `az containerapp secret set -n $APP -g $RG --secrets twilio-auth-token="<secondary token>"`
   and restart as in step 1. Once "sms sent" appears in the logs, ⚠ **Promote
   to primary** in the Console — the leaked token stops working and cannot be
   restored.
3. ⚠ **Revoke every phone session** — signs out all participants; not undoable:
   `psql "$DATABASE_URL" -c "UPDATE phone_sessions SET revoked_at = now() WHERE revoked_at IS NULL;"`
   To revoke one phone only, add `AND phone = '+1XXXXXXXXXX'`.
4. Consume outstanding codes:
   `psql "$DATABASE_URL" -c "UPDATE phone_verifications SET consumed_at = now() WHERE consumed_at IS NULL;"`

## Verify it worked

- `psql "$DATABASE_URL" -c "SELECT count(*) FROM phone_sessions WHERE revoked_at IS NULL AND expires_at > now();"` returns 0 after step 3.
- An old `phone_session` cookie on `GET /api/participant-bills` returns 401.
- A fresh start → verify → participant-bills cycle succeeds (see
  enable-twilio-sms.md Verify).

## If this didn't work

- New revision unhealthy: follow the deploy spec's rollback; do not restore
  the leaked secret.
- Evidence of wider database exposure: stop and get help — this runbook covers
  phone-auth material only.

## Related

- docs/specs/bills/phone-lookup.md
- docs/adr/0015-phone-verified-participant-access.md
- docs/runbooks/enable-twilio-sms.md
