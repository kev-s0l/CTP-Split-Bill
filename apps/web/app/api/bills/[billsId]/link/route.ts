// POST /api/bills/:billsId/link - Issue (or reissue) the bill's guest link and prepared text; the raw link is returned only here.
// DELETE /api/bills/:billsId/link - Revoke the bill's live guest link. Idempotent for owned bills.

import { currentUserId } from "@project/auth";
import { issueBillLink, revokeBillLink, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ billsId: string }> };

export async function POST(req: Request, { params }: Context) {
  try {
    const me = await currentUserId();
    const { billsId } = await params;
    const baseUrl = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
    return Response.json(await issueBillLink(me, billsId, baseUrl), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return toApiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  try {
    const me = await currentUserId();
    const { billsId } = await params;
    await revokeBillLink(me, billsId);
    return new Response(null, { status: 204 });
  } catch (e) {
    return toApiError(e);
  }
}
