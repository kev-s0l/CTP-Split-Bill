// POST /api/parties/[partyId]/members — organizer adds a user or a guest.
// Spec: docs/specs/parties/members.md.

import { currentUserId } from "@project/auth";
import { AddMember, addMember, apiError, invalidInput, toApiError } from "@project/domain";

// do not cache the response, always fetch new data from the server
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ partyId: string }> }) {
  try {
    const me = await currentUserId();
    const { partyId } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = AddMember.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);

    const member = await addMember(me, partyId, parsed.data);
    return Response.json(member, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}