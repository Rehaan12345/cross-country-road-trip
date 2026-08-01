import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// journey_route() is declared `returns jsonb`, and PostgREST serialises a scalar
// jsonb return as the bare JSON value (Content-Type: application/json). The
// supabase-js response pipeline runs JSON.parse() on that body, so `data` is an
// already-parsed object — never a JSON string needing a second parse.
//
// The one way a string could appear is a schema change that drops the `::jsonb`
// cast: st_asgeojson() returns TEXT, which PostgREST would emit as a quoted JSON
// string and JSON.parse would hand back as a string. That regression is cheap to
// absorb here and otherwise fails silently in the map layer, so normalise it.
function normaliseGeoJson(value: unknown): object | null {
  if (value == null) return null;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      console.error("[api/journey] geometry arrived as unparseable string");
      return null;
    }
  }

  return typeof value === "object" ? (value as object) : null;
}

export async function GET() {
  const { data: rawGeojson, error: geojsonError } =
    await supabase.rpc("journey_route");

  // A failed RPC previously destructured to `undefined` and was returned as a
  // successful response with a missing geometry, which is indistinguishable at
  // the client from "no trips recorded yet". Surface it instead.
  if (geojsonError) {
    console.error("[api/journey] journey_route failed", geojsonError);
    return NextResponse.json(
      { error: "journey_route failed", detail: geojsonError.message },
      { status: 502 },
    );
  }

  const geojson = normaliseGeoJson(rawGeojson);

  const { data: trips, error: tripsError } = await supabase
    .from("trips")
    .select("distance_m")
    .eq("status", "closed");

  if (tripsError) {
    console.error("[api/journey] trips query failed", tripsError);
    return NextResponse.json(
      { error: "trips query failed", detail: tripsError.message },
      { status: 502 },
    );
  }

  // A null geometry alongside recorded trips is not an empty journey — it means
  // journey_route() saw no rows in `points`. That is the signature of the RPC
  // role being unable to read `points` (RLS with no policy for the key in use),
  // since the function is SECURITY INVOKER. Legitimately empty only before the
  // first trip closes.
  if (geojson === null && (trips?.length ?? 0) > 0) {
    console.warn(
      `[api/journey] journey_route returned null geometry despite ${trips!.length} closed trip(s) — ` +
        "check that the Supabase key can read `points` (RLS / service-role key)",
    );
  }

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
