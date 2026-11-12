-- The picking/editing switch (ADR-0017) and the organizer's own roster row
-- (ADR-0018). Existing receipts start in Editing and have no organizer row.
BEGIN;

ALTER TABLE receipts
  ADD COLUMN picks_opened_at TIMESTAMP(3),
  ADD COLUMN organizer_participant_id TEXT;

ALTER TABLE receipts ADD CONSTRAINT receipts_id_organizer_participant_id_fkey
  FOREIGN KEY (id, organizer_participant_id) REFERENCES participants(receipt_id, id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
