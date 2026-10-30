-- Upgrade the original domain in place. No local database reset is required.
-- Unsupported legacy data aborts the entire transaction for reconciliation.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bills b
    JOIN receipts r ON r.id = b.receipt_id
    JOIN party_members m ON m.id = b.member_id
    WHERE m.party_id <> r.party_id
  ) OR EXISTS (
    SELECT 1 FROM item_shares s
    JOIN receipt_items i ON i.id = s.item_id
    JOIN receipts r ON r.id = i.receipt_id
    JOIN party_members m ON m.id = s.member_id
    WHERE m.party_id <> r.party_id
  ) OR EXISTS (
    SELECT 1 FROM receipts r
    JOIN party_members m ON m.id = r.paid_by_member_id
    WHERE m.party_id <> r.party_id
  ) THEN
    RAISE EXCEPTION 'Receipt remodel: reconcile cross-party bill, item or payer references first';
  END IF;

  IF EXISTS (
    SELECT s.item_id FROM item_shares s
    JOIN receipt_items i ON i.id = s.item_id
    JOIN receipts r ON r.id = i.receipt_id
    WHERE r.split_mode = 'ITEMIZED'
    GROUP BY s.item_id HAVING min(s.weight) <= 0 OR min(s.weight) <> max(s.weight)
  ) THEN
    RAISE EXCEPTION 'Receipt remodel: reconcile unequal active item weights first';
  END IF;

  IF EXISTS (SELECT 1 FROM payments WHERE amount < 0) OR EXISTS (
    SELECT b.id FROM bills b JOIN payments p ON p.bill_id = b.id
    GROUP BY b.id, b.amount_owed
    HAVING sum(p.amount) <> 0 AND sum(p.amount) <> b.amount_owed
  ) THEN
    RAISE EXCEPTION 'Receipt remodel: reconcile partial or overpaid payment balances first';
  END IF;
END $$;

CREATE TEMP TABLE _legacy_members ON COMMIT DROP AS
SELECT m.*, u.phone FROM party_members m LEFT JOIN users u ON u.id = m.user_id;

CREATE TEMP TABLE _receipt_participant_map ON COMMIT DROP AS
SELECT member_id, receipt_id,
  CASE WHEN ordinal = 1 THEN member_id
    ELSE 'rp_' || md5(json_build_array(member_id, receipt_id)::text)
  END AS participant_id
FROM (
  SELECT m.id AS member_id, r.id AS receipt_id,
    row_number() OVER (PARTITION BY m.id ORDER BY r.created_at, r.id) AS ordinal
  FROM party_members m JOIN receipts r ON r.party_id = m.party_id
) mapping;
ALTER TABLE _receipt_participant_map ADD PRIMARY KEY (receipt_id, member_id);
CREATE UNIQUE INDEX ON _receipt_participant_map (participant_id);

CREATE TEMP TABLE _legacy_shares ON COMMIT DROP AS
SELECT s.*, i.receipt_id, count(*) OVER (PARTITION BY s.item_id) AS share_count
FROM item_shares s JOIN receipt_items i ON i.id = s.item_id;

ALTER TABLE receipts DROP CONSTRAINT receipts_paid_by_member_id_fkey;
ALTER TABLE bills DROP CONSTRAINT bills_member_id_fkey;
ALTER TABLE item_shares DROP CONSTRAINT item_shares_member_id_fkey;

-- Reuse the existing membership table and the original IDs where possible.
ALTER TABLE party_members DROP CONSTRAINT party_members_party_id_fkey;
ALTER TABLE party_members DROP CONSTRAINT party_members_user_id_fkey;
DROP INDEX party_members_party_id_user_id_key;
ALTER TABLE party_members RENAME TO participants;
ALTER TABLE participants RENAME CONSTRAINT party_members_pkey TO participants_pkey;
ALTER TABLE participants RENAME COLUMN party_id TO receipt_id;
ALTER TABLE participants DROP COLUMN user_id;
ALTER TABLE participants ADD COLUMN phone TEXT;
DELETE FROM participants;
INSERT INTO participants (id, receipt_id, display_name, joined_at, phone)
SELECT mapping.participant_id, mapping.receipt_id, m.display_name, m.joined_at, m.phone
FROM _receipt_participant_map mapping JOIN _legacy_members m ON m.id = mapping.member_id;
CREATE UNIQUE INDEX participants_receipt_id_id_key ON participants (receipt_id, id);
CREATE INDEX participants_receipt_id_joined_at_id_idx ON participants (receipt_id, joined_at, id);

ALTER TABLE receipts DROP CONSTRAINT receipts_uploaded_by_id_fkey;
ALTER TABLE receipts RENAME COLUMN uploaded_by_id TO owner_id;
ALTER TABLE receipts RENAME COLUMN paid_by_member_id TO paid_by_participant_id;
ALTER TABLE receipts ADD COLUMN title TEXT;
ALTER TABLE receipts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receipts ADD COLUMN reviewed_at TIMESTAMP(3);
ALTER TABLE receipts ADD COLUMN finalized_at TIMESTAMP(3);
ALTER TABLE receipts ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE receipts r SET owner_id = p.organizer_id, title = p.name,
  deleted_at = coalesce(r.deleted_at, p.deleted_at), updated_at = r.created_at
FROM parties p WHERE p.id = r.party_id;
UPDATE receipts r SET paid_by_participant_id = mapping.participant_id
FROM _receipt_participant_map mapping
WHERE mapping.receipt_id = r.id AND mapping.member_id = r.paid_by_participant_id;

-- Replace enums instead of using a new enum value before its transaction commits.
ALTER TYPE "ReceiptStatus" RENAME TO "ReceiptStatus_legacy";
CREATE TYPE "ReceiptStatus" AS ENUM ('DRAFT', 'FINALIZED');
CREATE TYPE "ParseStatus" AS ENUM ('NOT_STARTED', 'PARSING', 'SUCCEEDED', 'FAILED');
ALTER TABLE receipts ADD COLUMN parse_status "ParseStatus" NOT NULL DEFAULT 'NOT_STARTED';
UPDATE receipts SET parse_status = (CASE status::text
  WHEN 'PARSING' THEN 'PARSING'
  WHEN 'PARSED' THEN 'SUCCEEDED'
  WHEN 'FINALIZED' THEN 'SUCCEEDED'
  WHEN 'PARSE_FAILED' THEN 'FAILED'
  ELSE 'NOT_STARTED' END)::"ParseStatus";
ALTER TABLE receipts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE receipts ALTER COLUMN status TYPE "ReceiptStatus" USING
  (CASE WHEN status::text = 'FINALIZED' THEN 'FINALIZED' ELSE 'DRAFT' END)::"ReceiptStatus";
ALTER TABLE receipts ALTER COLUMN status SET DEFAULT 'DRAFT';
DROP TYPE "ReceiptStatus_legacy";

ALTER TYPE "SplitMode" RENAME TO "SplitMode_legacy";
CREATE TYPE "SplitMode" AS ENUM ('EVEN', 'ITEMIZED', 'SHARED_ITEMS');
ALTER TABLE receipts ALTER COLUMN split_mode DROP DEFAULT;
ALTER TABLE receipts ALTER COLUMN split_mode TYPE "SplitMode" USING split_mode::text::"SplitMode";
UPDATE receipts SET split_mode = 'SHARED_ITEMS'
WHERE split_mode = 'ITEMIZED' AND id IN (
  SELECT receipt_id FROM _legacy_shares WHERE share_count > 1
);
ALTER TABLE receipts ALTER COLUMN split_mode SET DEFAULT 'EVEN';
DROP TYPE "SplitMode_legacy";

ALTER TABLE receipt_items ADD COLUMN assigned_participant_id TEXT;
ALTER TABLE receipt_items ALTER COLUMN name DROP NOT NULL;
ALTER TABLE receipt_items ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE receipt_items ALTER COLUMN quantity DROP DEFAULT;
ALTER TABLE receipt_items ALTER COLUMN unit_price DROP NOT NULL;
ALTER TABLE receipt_items ALTER COLUMN total_price DROP NOT NULL;
UPDATE receipt_items i SET assigned_participant_id = mapping.participant_id
FROM _legacy_shares s
JOIN _receipt_participant_map mapping ON mapping.receipt_id = s.receipt_id AND mapping.member_id = s.member_id
JOIN receipts r ON r.id = s.receipt_id
WHERE i.id = s.item_id AND s.share_count = 1 AND r.split_mode <> 'EVEN';
CREATE UNIQUE INDEX receipt_items_receipt_id_id_key ON receipt_items (receipt_id, id);
CREATE INDEX receipt_items_receipt_id_assigned_participant_id_idx ON receipt_items (receipt_id, assigned_participant_id);

ALTER TABLE item_shares DROP CONSTRAINT item_shares_item_id_fkey;
ALTER TABLE item_shares RENAME TO shared_item_allocations;
ALTER TABLE shared_item_allocations RENAME CONSTRAINT item_shares_pkey TO shared_item_allocations_pkey;
ALTER TABLE shared_item_allocations RENAME COLUMN member_id TO participant_id;
ALTER TABLE shared_item_allocations ADD COLUMN receipt_id TEXT;
DELETE FROM shared_item_allocations;
INSERT INTO shared_item_allocations (receipt_id, item_id, participant_id)
SELECT s.receipt_id, s.item_id, mapping.participant_id
FROM _legacy_shares s
JOIN _receipt_participant_map mapping ON mapping.receipt_id = s.receipt_id AND mapping.member_id = s.member_id
JOIN receipts r ON r.id = s.receipt_id
WHERE s.share_count > 1 AND r.split_mode = 'SHARED_ITEMS';
ALTER TABLE shared_item_allocations ALTER COLUMN receipt_id SET NOT NULL;
ALTER TABLE shared_item_allocations DROP COLUMN weight;
ALTER INDEX item_shares_member_id_idx RENAME TO shared_item_allocations_participant_id_idx;
CREATE INDEX shared_item_allocations_receipt_id_idx ON shared_item_allocations (receipt_id);

UPDATE bills b SET member_id = mapping.participant_id
FROM _receipt_participant_map mapping
WHERE mapping.receipt_id = b.receipt_id AND mapping.member_id = b.member_id;
ALTER TABLE bills RENAME COLUMN member_id TO participant_id;
ALTER TABLE bills ADD COLUMN paid_at TIMESTAMP(3);
ALTER TABLE bills ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE bills b SET paid_at = paid.last_payment
FROM (
  SELECT p.bill_id, max(p.paid_at) AS last_payment FROM payments p
  JOIN bills b ON b.id = p.bill_id GROUP BY p.bill_id, b.amount_owed
  HAVING sum(p.amount) = b.amount_owed AND sum(p.amount) > 0
) paid WHERE paid.bill_id = b.id;
UPDATE bills SET updated_at = coalesce(paid_at, created_at);
UPDATE receipts r SET finalized_at = finalized.at
FROM (SELECT receipt_id, min(created_at) AS at FROM bills GROUP BY receipt_id) finalized
WHERE r.id = finalized.receipt_id AND r.status = 'FINALIZED';
ALTER INDEX bills_receipt_id_member_id_key RENAME TO bills_receipt_id_participant_id_key;
ALTER INDEX bills_member_id_idx RENAME TO bills_participant_id_idx;

ALTER TABLE receipts DROP COLUMN party_id;
DROP INDEX receipts_uploaded_by_id_idx;
CREATE INDEX receipts_owner_id_deleted_at_created_at_id_idx ON receipts (owner_id, deleted_at, created_at, id);
ALTER TABLE receipts ADD CONSTRAINT receipts_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE participants ADD CONSTRAINT participants_receipt_id_fkey
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE receipts ADD CONSTRAINT receipts_id_paid_by_participant_id_fkey
  FOREIGN KEY (id, paid_by_participant_id) REFERENCES participants(receipt_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE receipt_items DROP CONSTRAINT receipt_items_receipt_id_fkey;
ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_receipt_id_fkey
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_receipt_id_assigned_participant_id_fkey
  FOREIGN KEY (receipt_id, assigned_participant_id) REFERENCES participants(receipt_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE shared_item_allocations ADD CONSTRAINT shared_item_allocations_receipt_id_item_id_fkey
  FOREIGN KEY (receipt_id, item_id) REFERENCES receipt_items(receipt_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE shared_item_allocations ADD CONSTRAINT shared_item_allocations_receipt_id_participant_id_fkey
  FOREIGN KEY (receipt_id, participant_id) REFERENCES participants(receipt_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE bills DROP CONSTRAINT bills_receipt_id_fkey;
ALTER TABLE bills ADD CONSTRAINT bills_receipt_id_fkey
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE bills ADD CONSTRAINT bills_receipt_id_participant_id_fkey
  FOREIGN KEY (receipt_id, participant_id) REFERENCES participants(receipt_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE receipts ADD CONSTRAINT receipts_revision_check CHECK (revision > 0);
ALTER TABLE receipts ADD CONSTRAINT receipts_money_check
  CHECK (subtotal >= 0 AND tax >= 0 AND tip >= 0 AND total >= 0);
ALTER TABLE receipts ADD CONSTRAINT receipts_finalized_money_check CHECK (
  status <> 'FINALIZED' OR (subtotal IS NOT NULL AND tax IS NOT NULL AND total IS NOT NULL
    AND subtotal > 0 AND total = subtotal + tax + coalesce(tip, 0))
);
ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_values_check
  CHECK (line_number > 0 AND (quantity IS NULL OR quantity > 0)
    AND (unit_price IS NULL OR unit_price >= 0) AND (total_price IS NULL OR total_price >= 0));
ALTER TABLE bills ADD CONSTRAINT bills_money_check
  CHECK (subtotal >= 0 AND tax_share >= 0 AND tip_share >= 0
    AND amount_owed = subtotal + tax_share + tip_share);

DROP TABLE payments;
DROP TABLE parties;
COMMIT;
