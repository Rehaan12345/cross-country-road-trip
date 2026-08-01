import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { driveBetween } from "@/lib/routing";
import { readPlan } from "@/lib/planStore";

export const dynamic = "force-dynamic";

/**
 * Add an out-and-back excursion from a stop.
 *
 * Routed as stop -> place -> stop in one call, so the stored geometry is the
 * actual loop you'd drive and the mileage is the round trip. The chain is not
 * touched: a side trip adds distance and time to a day you're already having,
 * not a day to the itinerary.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { stopId, name, lng, lat } = body ?? {};

  if (typeof stopId !== "string" || !stopId) {
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

  const base = plan.stops.find((s) => s.id === stopId);
  if (!base) return NextResponse.json({ error: "unknown stop" }, { status: 404 });

  let loop;
  try {
    loop = await driveBetween([base.coord, [lng, lat], base.coord]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api/plan/side-trips] routing failed", detail);
    return NextResponse.json(
      { error: "Could not find a road route to there", detail },
      { status: 502 },
    );
  }

  const { error } = await supabase.from("route_side_trips").insert({
    stop_id: stopId,
    name: name.trim().slice(0, 120),
    lng,
    lat,
    miles: loop.miles,
    minutes: loop.minutes,
    geometry: loop.geometry,
  });

  if (error) {
    console.error("[api/plan/side-trips] insert failed", error.message);
    return NextResponse.json({ error: "insert failed", detail: error.message }, { status: 502 });
  }

  return NextResponse.json({ plan: await readPlan() });
}
