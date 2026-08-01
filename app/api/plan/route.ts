import { NextResponse } from "next/server";
import { parsePlanState } from "@/lib/plan";
import { readPlan, writePlan } from "@/lib/planStore";

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

// The whole plan, replaced.
//
// It is two small values, and every edit — shifting departure, adding a night,
// deleting one — is a function from a plan to a plan. Sending the result rather
// than the intent means one endpoint, one write, and one definition of each
// edit (in lib/plan.ts, shared by both sides) instead of a second copy here.
// The server still refuses anything that isn't a well-formed plan.
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const plan = parsePlanState(body);

  if (!plan) {
    return NextResponse.json({ error: "invalid plan" }, { status: 400 });
  }

  try {
    await writePlan(plan);
    return NextResponse.json({ plan });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan] write failed", detail);
    return NextResponse.json({ error: "plan write failed", detail }, { status: 502 });
  }
}
