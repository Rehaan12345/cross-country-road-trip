import { NextResponse } from "next/server";
import { parsePlanEdits } from "@/lib/plan";
import { readPlan, writeEdits } from "@/lib/planStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ plan: await readPlan() });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan] read failed", detail);
    return NextResponse.json({ error: "plan read failed", detail }, { status: 502 });
  }
}

// The typed-in fields, replaced. Adding or removing a city goes through
// /api/plan/stops instead, because those need the network and must not be
// something a stale tab can replay.
export async function PUT(req: Request) {
  const edits = parsePlanEdits(await req.json().catch(() => null));
  if (!edits) return NextResponse.json({ error: "invalid plan" }, { status: 400 });

  try {
    await writeEdits(edits);
    return NextResponse.json({ plan: await readPlan() });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan] write failed", detail);
    return NextResponse.json({ error: "plan write failed", detail }, { status: 502 });
  }
}
