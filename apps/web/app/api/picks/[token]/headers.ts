// Token routes carry the token in the path: keep responses out of caches,
// referrers and search indexes (ADR-0015).
export const guestHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

export function withGuestHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(guestHeaders)) response.headers.set(name, value);
  return response;
}
