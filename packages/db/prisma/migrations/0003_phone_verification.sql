-- Phone verification for participant bill lookup (ADR-0015).
-- Normalizes stored participant phones to E.164 so lookups match exactly;
-- values that cannot be normalized are left unchanged and simply never match.
BEGIN;

UPDATE participants SET phone = normalized.value
FROM (
  SELECT id, CASE
    WHEN digits ~ '^\+[1-9][0-9]{7,14}$' THEN digits
    WHEN digits ~ '^00[1-9][0-9]{7,14}$' THEN '+' || substr(digits, 3)
    WHEN digits ~ '^[2-9][0-9]{9}$' THEN '+1' || digits
    WHEN digits ~ '^1[2-9][0-9]{9}$' THEN '+' || digits
  END AS value
  FROM (SELECT id, regexp_replace(phone, '[[:space:]().-]', '', 'g') AS digits FROM participants WHERE phone IS NOT NULL) AS stripped
) AS normalized
WHERE participants.id = normalized.id AND normalized.value IS NOT NULL;

CREATE INDEX "participants_phone_idx" ON "participants"("phone");

CREATE TABLE "phone_verifications" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "client_ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "phone_verifications_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "phone_verifications_phone_created_at_idx" ON "phone_verifications"("phone", "created_at");
CREATE INDEX "phone_verifications_client_ip_created_at_idx" ON "phone_verifications"("client_ip", "created_at");

CREATE TABLE "phone_sessions" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "phone_sessions_token_hash_key" ON "phone_sessions"("token_hash");
CREATE INDEX "phone_sessions_phone_idx" ON "phone_sessions"("phone");

COMMIT;
