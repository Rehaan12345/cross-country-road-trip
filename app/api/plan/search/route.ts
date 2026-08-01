import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/routing";

export const dynamic = "force-dynamic";

// Candidates for a typed place name. Several rather than one, because
// "Springfield" is a coin flip and silently routing a 500-mile detour to the
// wrong state is worse than one extra tap.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ places: [] });

  try {
    return NextResponse.json({ places: await searchPlaces(q) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan/search] failed", detail);
    return NextResponse.json(
      { error: "Could not reach the place lookup", detail },
      { status: 502 },
    );
  }
}
