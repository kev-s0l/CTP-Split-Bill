// Phone-session cookie: the second identity kind (ADR-0015). The cookie holds the
// raw session token; the domain package resolves it to a verified phone.

export const PHONE_SESSION_COOKIE = "phone_session";

export function phoneSessionToken(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === PHONE_SESSION_COOKIE) return decodeURIComponent(value.join("=")) || null;
  }
  return null;
}

function cookie(value: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${PHONE_SESSION_COOKIE}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function phoneSessionCookie(token: string, expiresAt: Date, now = new Date()) {
  return cookie(encodeURIComponent(token), Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)));
}

export const clearedPhoneSessionCookie = () => cookie("", 0);

// Container Apps' ingress appends the caller to X-Forwarded-For; the first entry
// is the client. Used only for rate limiting, never for authorization.
export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}
