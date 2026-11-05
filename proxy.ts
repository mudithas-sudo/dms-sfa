import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Signed-out visitors to any work area go to the sign-in page first, and come back to where they were going.
// The sign-in itself, the "Start here" page and the field app's PIN sign-in stay open.
export function proxy(request: NextRequest) {
  if (request.cookies.get("dms_role")?.value) return NextResponse.next();
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/branch/:path*", "/supervisor/:path*", "/management/:path*", "/notifications/:path*", "/sfa", "/sfa/((?!login).*)"],
};
