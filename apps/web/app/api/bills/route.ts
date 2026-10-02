import { currentUserId } from "@project/auth";
import { listBills, getBill, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ billId: string }> },
) {
  try {
    const me = await currentUserId();
    const { billId } = await params;
    return Response.json(await getBill(me, billId));
  } catch (e) {
    return toApiError(e);
  }
}
