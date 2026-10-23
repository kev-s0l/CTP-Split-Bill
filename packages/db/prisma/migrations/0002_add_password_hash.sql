-- Password hash for local credential auth. Nullable: accounts created before
-- passwords existed (and seed/dev users) have no credential and cannot log in
-- with one — see docs/adr/0003-dev-identity-stub.md.
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
