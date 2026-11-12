-- Guest pick links (ADR-0015): a hashed per-participant token, the guest's
-- "done" time, and an optional email the organizer sends the link to.
BEGIN;

ALTER TABLE participants
  ADD COLUMN email TEXT,
  ADD COLUMN pick_token_hash TEXT,
  ADD COLUMN picks_submitted_at TIMESTAMP(3);

CREATE UNIQUE INDEX participants_pick_token_hash_key
  ON participants(pick_token_hash);

COMMIT;
