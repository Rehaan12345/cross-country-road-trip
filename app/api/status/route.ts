import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: trip } = await supabase
    .from("trips")
    .select("id, started_at")
    .eq("status", "active")
    .maybeSingle();

  // Deliberately not scoped to the active trip: the point of this number is to
  // tell you the recorder is alive, which matters most when no trip is open.
  const { data: last } = await supabase
    .from("points")
    .select("recorded_at")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let stats = null;
  if (trip) {
    const { data } = await supabase.rpc("trip_stats", { p_trip_id: trip.id });
    stats = data?.[0] ?? null;
  }

  return NextResponse.json({
    trip,
    stats,
    lastPingAt: last?.recorded_at ?? null,
  });
}
