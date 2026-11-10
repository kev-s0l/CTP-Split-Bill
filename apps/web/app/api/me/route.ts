// GET /api/me - Return the authenticated organizer's profile.
import { currentUserId } from "@project/auth";
import { getCurrentUser, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await currentUserId();
    const user = await getCurrentUser(userId);
    return Response.json(user, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toApiError(error);
  }
}
