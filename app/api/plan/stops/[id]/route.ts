import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { driveBetween } from "@/lib/routing";
import { readPlan } from "@/lib/planStore";

export const dynamic = "force-dynamic";

/**
 * Remove a city, re-joining the two stops it sat between.
 *
 * Removal exists because adding is only safe if it is reversible — picking the
 * wrong Springfield should cost a tap, not a reset of the whole plan.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const plan = await readPlan().catch(() => null);
  if (!plan) return NextResponse.json({ error: "plan read failed" }, { status: 502 });

  const i = plan.stops.findIndex((s) => s.id === id);
  if (i < 0) return NextResponse.json({ error: "unknown stop" }, { status: 404 });
  if (i === 0 || i === plan.stops.length - 1) {
    return NextResponse.json(
      { error: "The first and last stops anchor the trip" },
      { status: 400 },
    );
  }

  // Routed before the delete, so a router outage leaves the plan untouched.
  let rejoin;
  try {
    rejoin = await driveBetween([plan.stops[i - 1].coord, plan.stops[i + 1].coord]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan/stops] re-route failed", detail);
    return NextResponse.json(
      { error: "Could not re-route around that stop", detail },
      { status: 502 },
    );
  }

  const { error } = await supabase.rpc("route_delete_stop", {
    p_id: id,
    p_miles: rejoin.miles,
    p_minutes: rejoin.minutes,
    p_geom: rejoin.geometry,
  });

  if (error) {
    console.error("[api/plan/stops] delete failed", error.message);
    return NextResponse.json({ error: "delete failed", detail: error.message }, { status: 502 });
  }

  return NextResponse.json({ plan: await readPlan() });
}
