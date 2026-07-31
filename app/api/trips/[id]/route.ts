import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!trip) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: geojson } = await supabase.rpc("trip_route", { p_trip_id: id });

  // An active trip has no persisted stats yet, so compute them live.
  let stats = null;
  if (trip.status === "active") {
    const { data } = await supabase.rpc("trip_stats", { p_trip_id: id });
    stats = data?.[0] ?? null;
  }

  return NextResponse.json({ trip, geojson, stats });
}
