// GET  /api/parties — parties I'm a member of.
// POST /api/parties — create a party; I become its organizer and first member.
// Specs: docs/specs/parties/list.md, docs/specs/parties/create.md.

import { currentUserId } from "@project/auth";
import { apiError, CreateParty, createParty, invalidInput, listParties, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await currentUserId();
    return Response.json(await listParties(me));
  } catch (e) {
    return toApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await currentUserId();
    const body = await req.json().catch(() => null);
    if (body === null) return apiError("INVALID_INPUT", "Body must be valid JSON", 400);
    const parsed = CreateParty.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error);

    const party = await createParty(me, parsed.data);
    return Response.json(party, { status: 201 });
  } catch (e) {
    return toApiError(e);
  }
}
