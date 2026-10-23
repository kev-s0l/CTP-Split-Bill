// GET /api/guest/bills — what a verified guest owes, across every party they
// were invited to. Read-only: no other method is exported, and nothing here
// reaches a write — ADR-0014.
// Spec: docs/specs/bills/guest-bills.md.

import { currentGuestContact } from "@project/auth";
import { apiError, listBillsForContact, toApiError, verifiedContact } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const claim = await currentGuestContact();
    if (!claim) return apiError("UNAUTHENTICATED", "No verified contact", 401);

    // Normalizes and validates; a malformed address is 400, never a lookup.
    const contact = verifiedContact(claim);

    // Takes a VerifiedContact and never a userId, so this handler cannot be
    // made to serve an account holder.
    return Response.json(await listBillsForContact(contact));
  } catch (e) {
    return toApiError(e);
  }
}
