// Gate app pages with the database-backed Auth.js session. APIs authenticate
// in their route/domain path so signed-out calls keep the standard JSON 401.
import { auth } from "@project/auth";
import { NextResponse } from "next/server";

export default auth((request) => {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/") return NextResponse.next();
  if (!request.auth) return NextResponse.redirect(new URL("/api/auth/signin", request.url));
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};
