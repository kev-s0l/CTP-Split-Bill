// POST /api/receipts/:id/participants/:participantId/pick-link - Issue or rotate a guest pick link; returns { url } once.
// DELETE /api/receipts/:id/participants/:participantId/pick-link - Revoke it. See docs/specs/receipts/guest-picks.md.
import { currentUserId } from "@project/auth";
import { revalidatePath } from "next/cache";
import { issuePickLink, revokePickLink, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; participantId: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const me = await currentUserId();
    const { id: receiptId, participantId } = await params;
    const token = await issuePickLink(me, receiptId, participantId);
    revalidatePath(`/api/receipts/${receiptId}`);
    // The app has no configured public origin, so the link uses the request's.
    const url = new URL(`/p/${token}`, req.url).toString();
    // The raw token is in this body and nowhere else; never cache it.
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return toApiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const me = await currentUserId();
    const { id: receiptId, participantId } = await params;
    await revokePickLink(me, receiptId, participantId);
    revalidatePath(`/api/receipts/${receiptId}`);
    return new Response(null, { status: 204 });
  } catch (e) {
    return toApiError(e);
  }
}
