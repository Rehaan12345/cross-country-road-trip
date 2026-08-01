import { NextResponse } from "next/server";
import { DEFAULT_PLAN } from "@/lib/plan";
import { readPlan, writePlan } from "@/lib/planStore";

export const dynamic = "force-dynamic";

// Restore the plan the trip shipped with — original departure, one night in
// Chicago, one at the Grand Canyon, no notes. Editing is only cheap if it's
// reversible.
//
// Reads back rather than echoing DEFAULT_PLAN so the response is what is
// actually stored, not what was meant to be.
export async function POST() {
  try {
    await writePlan(DEFAULT_PLAN);
    return NextResponse.json({ plan: await readPlan() });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan/reset] failed", detail);
    return NextResponse.json({ error: "reset failed", detail }, { status: 502 });
  }
}
