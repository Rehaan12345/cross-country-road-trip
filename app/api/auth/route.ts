import { NextResponse } from "next/server";

// POST-only; without this Next attempts to prerender it at build time and logs
// a JSON-parse error it then recovers from. Noise, not a failure.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { passphrase } = await req.json();

  if (!process.env.APP_PASSPHRASE || passphrase !== process.env.APP_PASSPHRASE) {
    return NextResponse.json({ error: "incorrect" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("auth", passphrase, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // outlast the trip
  });
  return res;
}
