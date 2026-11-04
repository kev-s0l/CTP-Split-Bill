// GET /api/bill-links/:token - Public read of the one bill a guest link grants. No identity; the token is the scope (ADR-0016).

import { readBillLink, toApiError } from "@project/domain";

export const dynamic = "force-dynamic";

// Links are bearer credentials: never cache, index or leak them via Referer.
const PRIVATE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    return Response.json(await readBillLink(token), { headers: PRIVATE });
  } catch (e) {
    const res = toApiError(e);
    for (const [name, value] of Object.entries(PRIVATE)) res.headers.set(name, value);
    return res;
  }
}
