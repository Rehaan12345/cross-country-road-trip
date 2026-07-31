import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: geojson } = await supabase.rpc("journey_route");

  const { data: trips } = await supabase
    .from("trips")
    .select("distance_m")
    .eq("status", "closed");

  const totalMeters = (trips ?? []).reduce(
    (sum, t) => sum + (t.distance_m ?? 0),
    0,
  );

  return NextResponse.json({
    geojson,
    totalMeters,
    tripCount: trips?.length ?? 0,
  });
}
