-- Guest contact addresses on party members: the invite address the organizer
-- typed, and the key a verified guest retrieves their bills by — ADR-0014.
-- Nullable: a member linked to a user is reached through users.email instead.
ALTER TABLE "party_members" ADD COLUMN "guest_email" TEXT;
ALTER TABLE "party_members" ADD COLUMN "guest_phone" TEXT;

-- Guest lookup is by normalized contact across every party, so both columns
-- are queried directly rather than through party_id.
CREATE INDEX "party_members_guest_email_idx" ON "party_members"("guest_email");
CREATE INDEX "party_members_guest_phone_idx" ON "party_members"("guest_phone");

-- Contact columns are meaningful only for guests. A member with a user_id is
-- reached through the users table; a second copy here could disagree with it.
-- Not expressible in schema.prisma, so it lives only here.
ALTER TABLE "party_members"
  ADD CONSTRAINT "party_members_guest_contact_only"
  CHECK ("user_id" IS NULL OR ("guest_email" IS NULL AND "guest_phone" IS NULL));
