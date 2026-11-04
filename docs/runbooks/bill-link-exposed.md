# A guest bill link reached someone it shouldn't have

**Use when:** a guest or organizer reports a bill link forwarded, posted
publicly or sent to the wrong number, or bill-link URLs appear in logs or
tooling that others can read.
**Last drilled:** never

## Before you start

- For one bill: the organizer's session, or the bill id.
- For many bills: `psql` access to the database (`DATABASE_URL` from the
  Container App's secrets).
- Blast radius: revoked links stop working immediately; guests need a new link
  from their organizer. Bill data and payment state are unchanged.

## Steps

1. One bill, organizer available: the organizer calls
   `DELETE /api/bills/<billId>/link`, then `POST /api/bills/<billId>/link` and
   sends the new `message` to the right person.
2. One bill, operator: find the bill id from the organizer's report, then
   `psql "$DATABASE_URL" -c "UPDATE bill_links SET revoked_at = now() WHERE bill_id = '<billId>' AND revoked_at IS NULL;"`
   and ask the organizer to reissue.
3. ⚠ **Revoke every link** (URLs leaked in bulk, for example through logs) —
   every guest link stops working; not undoable:
   `psql "$DATABASE_URL" -c "UPDATE bill_links SET revoked_at = now() WHERE revoked_at IS NULL;"`
4. If the leak came from logs, purge or restrict access to the logs that
   recorded `/b/` or `/api/bill-links/` paths.

## Verify it worked

- The leaked URL shows the not-found page, and
  `curl -i https://<app>/api/bill-links/<token>` returns 404.
- `psql "$DATABASE_URL" -c "SELECT count(*) FROM bill_links WHERE bill_id = '<billId>' AND revoked_at IS NULL;"`
  returns 0 before reissue, 1 after.

## If this didn't work

- The link still works after step 2: confirm the bill id matches the link by
  hashing the token
  (`printf %s '<token>' | sha256sum`) and matching `token_hash`.
- Evidence of a wider database exposure: stop and get help — this runbook
  covers bill links only.

## Related

- docs/specs/bills/public-share.md
- docs/adr/0016-bill-links.md
