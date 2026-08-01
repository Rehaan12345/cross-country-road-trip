import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { driveBetween } from "@/lib/routing";
import { readPlan } from "@/lib/planStore";

export const dynamic = "force-dynamic";

/**
 * Insert a city into the route, immediately after `afterStopId`.
 *
 * The two new drives are routed here, once, and stored — so the map keeps
 * drawing real roads with no signal later. Both are fetched BEFORE anything is
 * written: if the router is unreachable the route is left exactly as it was,
 * rather than half-changed with a straight line through it.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { afterStopId, name, lng, lat } = body ?? {};

  if (typeof afterStopId !== "string" || !afterStopId) {
    return NextResponse.json({ error: "missing stop" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "missing name" }, { status: 400 });
  }
  if (
    typeof lng !== "number" || typeof lat !== "number" ||
    !Number.isFinite(lng) || !Number.isFinite(lat) ||
    Math.abs(lng) > 180 || Math.abs(lat) > 90
  ) {
    return NextResponse.json({ error: "bad coordinates" }, { status: 400 });
  }

  const plan = await readPlan().catch(() => null);
  if (!plan) return NextResponse.json({ error: "plan read failed" }, { status: 502 });

  const i = plan.stops.findIndex((s) => s.id === afterStopId);
  if (i < 0) return NextResponse.json({ error: "unknown stop" }, { status: 404 });
  if (i === plan.stops.length - 1) {
    return NextResponse.json(
      { error: "Pick a stop to insert after — nothing follows the last one" },
      { status: 400 },
    );
  }

  const prev = plan.stops[i];
  const next = plan.stops[i + 1];
  const here: [number, number] = [lng, lat];

  let inbound, outbound;
  try {
    inbound = await driveBetween([prev.coord, here]);
    // The public router asks for a gap between calls.
    await new Promise((r) => setTimeout(r, 1100));
    outbound = await driveBetween([here, next.coord]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan/stops] routing failed", detail);
    return NextResponse.json(
      { error: "Could not find a road route to there", detail },
      { status: 502 },
    );
  }

  const { error } = await supabase.rpc("route_insert_stop", {
    p_prev: afterStopId,
    p_name: name.trim().slice(0, 120),
    p_lng: lng,
    p_lat: lat,
    p_prev_miles: inbound.miles,
    p_prev_minutes: inbound.minutes,
    p_prev_geom: inbound.geometry,
    p_new_miles: outbound.miles,
    p_new_minutes: outbound.minutes,
    p_new_geom: outbound.geometry,
  });

  if (error) {
    console.error("[api/plan/stops] insert failed", error.message);
    return NextResponse.json({ error: "insert failed", detail: error.message }, { status: 502 });
  }

  return NextResponse.json({ plan: await readPlan() });
}
