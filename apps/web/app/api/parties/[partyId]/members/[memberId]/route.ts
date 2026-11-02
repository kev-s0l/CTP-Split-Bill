// DELETE /api/parties/[partyId]/members/[memberId] — organizer removes a member.
// Spec: docs/specs/parties/members.md.

import { currentUserId } from "@project/auth";
import { removeMember, toApiError } from "@project/domain";

// do not cache the response, always fetch new data from the server
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ partyId: string; memberId: string }> }
) {
  try {
    const me = await currentUserId();
    const { partyId, memberId } = await params;
    await removeMember(me, partyId, memberId);
    return new Response(null, { status: 204 });
  } catch (e) {
    return toApiError(e);
  }
}