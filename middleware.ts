import { NextResponse, type NextRequest } from "next/server";

// One user, one passphrase. The cookie is the whole session model.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/login" || pathname === "/api/auth") {
    return NextResponse.next();
  }

  if (req.cookies.get("auth")?.value === process.env.APP_PASSPHRASE) {
    return NextResponse.next();
  }

  // APIs get a status code; pages get sent to the login form.
  if (pathname.startsWith("/api/")) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
