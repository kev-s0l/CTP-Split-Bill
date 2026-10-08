// GET  /api/parties/[partyID]/reciepts — reciepts belonging to user's party
import { currentUserId } from "@project/auth";
import { listPartiesReceipts, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ partyId: string }> },
) {
  try {
    const me = await currentUserId();
    const { partyId } = await params;
    return Response.json(await listPartiesReceipts(me, partyId));
  } catch (e) {
    return toApiError(e);
  }
}