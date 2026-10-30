// GET /api/parties/[partyId] — a party I'm a member of, with its members.
// Spec: docs/specs/parties/detail.md.

import { currentUserId } from "@project/auth";
import { getParty, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const me = await currentUserId();
    const { partyId } = await params;
    return Response.json(await getParty(me, partyId));
  } catch (e) {
    return toApiError(e);
  }
}
