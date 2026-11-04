# Phone verification codes must be texted through Twilio

**Use when:** the app moves to Azure Container Apps, or a deployed revision
fails phone verification with "SMS stand-in is disabled in production".
**Last drilled:** never

## Before you start

- A Twilio account upgraded from trial (trial accounts only text verified
  numbers and prefix every message).
- Azure CLI logged in (`az account show`) with Contributor on the resource
  group that holds the Container App. Know `$APP` and `$RG`.
- Blast radius: participants cannot receive codes until step 6. Organizer
  routes are unaffected.
- Lead time: carriers block unregistered US traffic. Submit step 2's
  registration days to weeks before cut-over.

## Steps

1. In the Twilio Console, buy a number with SMS capability: Phone Numbers →
   Buy a number. Prefer toll-free. Record it in E.164 (`+18005550100`).
2. Register it for US sending:
   - Toll-free: Phone Numbers → Regulatory Compliance → Toll-Free
     Verifications; use case "one-time verification codes for bill lookup".
   - Local number: Messaging → Regulatory Compliance → A2P 10DLC; register
     the brand and a "2FA / account notification" campaign.
   Wait for Approved.
3. Optional, recommended: Messaging → Services → Create, add the number to the
   sender pool, and record the Messaging Service SID (`MG...`). Use it instead
   of the number in step 6.
4. From Account → API keys & tokens, copy the Account SID (`AC...`) and the
   Auth Token.
5. Generate the code-hashing secret: `openssl rand -base64 32`.
6. Store secrets and point the environment at them; the update creates a new revision:
   `az containerapp secret set -n $APP -g $RG --secrets twilio-auth-token="<step 4 token>" phone-auth-secret="<step 5>"`
   `az containerapp update -n $APP -g $RG --set-env-vars TWILIO_ACCOUNT_SID=<step 4 SID> TWILIO_AUTH_TOKEN=secretref:twilio-auth-token TWILIO_FROM=<step 1 number or step 3 MG SID> PHONE_AUTH_SECRET=secretref:phone-auth-secret`
7. Confirm `ALLOW_DEV_SMS` is not set on the app:
   `az containerapp show -n $APP -g $RG --query "properties.template.containers[0].env[?name=='ALLOW_DEV_SMS']"` returns `[]`.
8. In the Twilio Console, set a usage trigger (Monitor → Usage triggers) on SMS
   spend so abuse is noticed.

## Verify it worked

- Add a test participant with your own phone to a receipt, then
  `curl -i -X POST https://<app>/api/phone-auth/start -H 'content-type: application/json' -d '{"phone":"<your phone>"}'`
  returns 202 and your phone receives a six-digit code.
- `az containerapp logs show -n $APP -g $RG` shows "sms sent" with a
  `messageSid`, and no "phone verification sms failed".
- Twilio Console → Monitor → Messaging logs shows the message as Delivered.
- Verifying the code returns 204 with a `phone_session` cookie, and
  `GET /api/participant-bills` with that cookie returns 200.

## If this didn't work

- "SMS send failed: 401 20003": wrong Account SID or Auth Token; redo step 6.
- "SMS send failed: 400 21608" or 21606: trial account or a number that cannot
  send; check step 1 and the account upgrade.
- Logged "sms sent" but Undelivered (error 30032/30034 in Messaging logs): the
  sender is not yet registered; wait for step 2 approval.
- Do not set `ALLOW_DEV_SMS` in production to work around any of these — that
  logs live codes.
- No code and no log line: the phone is on no live receipt or a send limit was
  hit; see docs/specs/bills/phone-lookup.md.
- Anything else: stop and get help.

## Related

- docs/specs/bills/phone-lookup.md
- docs/specs/seams.md
- docs/adr/0015-phone-verified-participant-access.md
