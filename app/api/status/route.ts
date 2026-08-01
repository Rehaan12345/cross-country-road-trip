import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, label, started_at")
    .eq("status", "active")
    .maybeSingle();

  if (tripError) {
    return NextResponse.json(
      { error: "trip lookup failed", detail: tripError.message },
      { status: 502 },
    );
  }

  // Deliberately not scoped to the active trip: the point of this number is to
  // tell you the recorder is alive, which matters most when no trip is open.
  // received_at, not recorded_at: this measures when the server last heard from
  // the recorder, which is immune to phone clock skew and to replayed backlogs.
  const { data: last } = await supabase
    .from("points")
    .select("received_at")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let stats = null;
  let pausedAt: string | null = null;

  if (trip) {
    const { data } = await supabase.rpc("trip_stats", { p_trip_id: trip.id });
    stats = data?.[0] ?? null;

    const { data: open } = await supabase
      .from("trip_pauses")
      .select("paused_at")
      .eq("trip_id", trip.id)
      .is("resumed_at", null)
      .maybeSingle();

    pausedAt = open?.paused_at ?? null;
  }

  return NextResponse.json({
    trip,
    stats,
    pausedAt,
    lastPingAt: last?.received_at ?? null,
    // Lets the client correct for its own clock being wrong, so the health
    // indicator doesn't depend on the viewing device's time being right.
    serverNow: new Date().toISOString(),
  });
}
