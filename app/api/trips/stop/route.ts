import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST() {
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("status", "active")
    .maybeSingle();

  if (!trip) {
    return NextResponse.json({ error: "no active trip" }, { status: 409 });
  }

  await supabase
    .from("trips")
    .update({ status: "closed", ended_at: new Date().toISOString() })
    .eq("id", trip.id);

  await supabase.rpc("compute_trip_stats", { p_trip_id: trip.id });

  const { data: final } = await supabase
    .from("trips")
    .select("*")
    .eq("id", trip.id)
    .single();

  return NextResponse.json(final);
}
