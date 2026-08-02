import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parsePlanEdits, type PlanState } from "@/lib/plan";
import { readPlan, writeEdits } from "@/lib/planStore";
import { roleOf } from "@/lib/role";

export const dynamic = "force-dynamic";

/**
 * Notes are the one part of the plan that is private rather than merely
 * uneditable. Blanked here rather than hidden in the component, because a
 * viewer can open /api/plan directly — anything left in this payload is
 * readable no matter what the UI chooses to draw.
 *
 * Blanked, not deleted: the shape stays identical for both roles, so nothing
 * downstream has to cope with a missing field.
 */
function withoutNotes(plan: PlanState): PlanState {
  return {
    ...plan,
    stops: plan.stops.map((s) => ({ ...s, note: "", driveNote: "" })),
  };
}

export async function GET() {
  const readOnly = roleOf((await cookies()).get("auth")?.value) === "view";

  try {
    const plan = await readPlan();
    return NextResponse.json({ plan: readOnly ? withoutNotes(plan) : plan });
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
