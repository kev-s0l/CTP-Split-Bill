// Gate app pages with the database-backed Auth.js session. APIs authenticate
// in their route/domain path so signed-out calls keep the standard JSON 401.
// Signed-out visitors go to /login; signed-in visitors never see /login.
import { auth } from "@project/auth";
import { NextResponse } from "next/server";
import { pageRedirect } from "./app/lib/page-access";

export default auth((request) => {
  const target = pageRedirect(request.nextUrl.pathname, request.nextUrl.search, Boolean(request.auth));
  return target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};
