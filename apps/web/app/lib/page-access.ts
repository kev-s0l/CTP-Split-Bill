// Page access rules applied by middleware (docs/specs/auth/sign-in.md). Pure so
// the rules are testable without the Next.js runtime.

export const LOGIN_PATH = "/login";
const PUBLIC_PAGES = new Set(["/"]);

// Only same-origin paths survive; anything else (absolute or protocol-relative
// URLs, the login page itself) falls back to the landing page.
export function safeCallbackPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) return "/";
  return value;
}

// The sign-in page, returning to callbackPath afterwards.
export function loginPath(callbackPath: string): string {
  return `${LOGIN_PATH}?${new URLSearchParams({ callbackUrl: callbackPath })}`;
}

// Returns the path to redirect to, or null to let the request through.
export function pageRedirect(pathname: string, search: string, signedIn: boolean): string | null {
  if (pathname === LOGIN_PATH) {
    return signedIn ? safeCallbackPath(new URLSearchParams(search).get("callbackUrl")) : null;
  }
  if (PUBLIC_PAGES.has(pathname) || signedIn) return null;
  return loginPath(`${pathname}${search}`);
}
