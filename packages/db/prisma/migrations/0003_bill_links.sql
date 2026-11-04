-- Guest bill links (ADR-0016) and E.164 participant phones.
-- Phones are normalized so prepared texts and organizer lookups address the
-- same number; values that cannot be normalized are left unchanged.
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

CREATE TABLE "bill_links" (
    "id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_links_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE UNIQUE INDEX "bill_links_token_hash_key" ON "bill_links"("token_hash");
CREATE INDEX "bill_links_bill_id_idx" ON "bill_links"("bill_id");
-- Concurrent reissues cannot leave two live links for one bill.
CREATE UNIQUE INDEX "bill_links_one_active_per_bill" ON "bill_links"("bill_id") WHERE "revoked_at" IS NULL;
ALTER TABLE "bill_links" ADD CONSTRAINT "bill_links_bill_id_fkey"
  FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
