import { NextResponse, type NextRequest } from "next/server";
import { roleOf } from "@/lib/role";

// Two passphrases, one cookie. The cookie is the whole session model.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /maptest.html and /ml are a temporary diagnostic; delete both once the map
  // is working, along with public/maptest.html and public/ml.
  if (
    pathname === "/login" ||
    pathname === "/api/auth" ||
    pathname === "/maptest.html" ||
    pathname.startsWith("/ml/")
  ) {
    return NextResponse.next();
  }

  const role = roleOf(req.cookies.get("auth")?.value);

  if (role === "owner") {
    return NextResponse.next();
  }

  if (role === "view") {
    // The actual read-only boundary. Every write in this app is a non-GET call
    // to /api/*, so one method check covers all of them — including endpoints
    // added later, which is the point of gating on the method rather than on a
    // list of paths. The disabled buttons in the UI are only an affordance;
    // this is what makes them true.
    if (req.method === "GET" || req.method === "HEAD") {
      return NextResponse.next();
    }
    return new NextResponse("read-only", { status: 403 });
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
