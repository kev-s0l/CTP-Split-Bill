// GET /api/picks/:token - Token-scoped projection: picking state on a draft, everyone's amounts once finalized.
// PUT /api/picks/:token - Replace the holder's complete pick set. No user identity: the token is the scope (ADR-0015).
import { apiError, getPicks, invalidInput, ReplacePicks, replacePicks, toApiError } from "@project/domain";
import { withGuestHeaders } from "./headers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { token } = await params;
    return withGuestHeaders(Response.json(await getPicks(token)));
  } catch (e) {
    return withGuestHeaders(toApiError(e));
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { token } = await params;
    const body = await req.json().catch(() => null);
    if (body === null) return withGuestHeaders(apiError("INVALID_INPUT", "Body must be valid JSON", 400));
    const parsed = ReplacePicks.safeParse(body);
    if (!parsed.success) return withGuestHeaders(invalidInput(parsed.error));
    const picks = await replacePicks(token, parsed.data);
    return withGuestHeaders(Response.json(picks));
  } catch (e) {
    return withGuestHeaders(toApiError(e));
  }
}
