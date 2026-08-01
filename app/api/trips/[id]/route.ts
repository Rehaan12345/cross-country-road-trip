import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { reverseGeocode } from "@/lib/geocode";

export const dynamic = "force-dynamic";

type Geo = {
  type: string;
  coordinates: unknown;
};

// First and last coordinate of the drawn route, whatever its geometry type.
function endpoints(
  g: Geo,
): { start: [number, number]; end: [number, number] } | null {
  let lines: [number, number][][] = [];

  if (g.type === "LineString") {
    lines = [g.coordinates as [number, number][]];
  } else if (g.type === "MultiLineString") {
    lines = g.coordinates as [number, number][][];
  }

  const flat = lines.flat();
  if (flat.length < 2) return null;

  return { start: flat[0], end: flat[flat.length - 1] };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (tripError) {
    return NextResponse.json(
      { error: "trip lookup failed", detail: tripError.message },
      { status: 502 },
    );
  }

  if (!trip) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: geojson, error: routeError } = await supabase.rpc("trip_route", {
    p_trip_id: id,
  });

  if (routeError) {
    return NextResponse.json(
      { error: "trip_route failed", detail: routeError.message },
      { status: 502 },
    );
  }

  // An active trip has no persisted stats yet, so compute them live.
  let stats = null;
  if (trip.status === "active") {
    const { data } = await supabase.rpc("trip_stats", { p_trip_id: id });
    stats = data?.[0] ?? null;
  }

  // Resolve place names lazily, on first view of a closed trip, and persist.
  // Lazy rather than on stop so existing trips heal themselves too, and so a
  // geocoder outage never blocks ending a trip.
  if (trip.status === "closed" && !trip.start_place && geojson) {
    const ends = endpoints(geojson);
    if (ends) {
      const start = await reverseGeocode(ends.start[1], ends.start[0]);
      // Nominatim asks for no more than one request per second.
      await new Promise((r) => setTimeout(r, 1100));
      const end = await reverseGeocode(ends.end[1], ends.end[0]);

      if (start || end) {
        trip.start_place = start;
        trip.end_place = end;
        await supabase
          .from("trips")
          .update({ start_place: start, end_place: end })
          .eq("id", id);
      }
    }
  }

  return NextResponse.json({ trip, geojson, stats });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // points.trip_id is ON DELETE SET NULL, so the GPS data survives and can be
  // rebound later. trip_pauses cascades away with the trip.
  const { error } = await supabase.from("trips").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const raw = typeof body.label === "string" ? body.label.trim() : "";
  // An empty name clears the label, which falls back to the trip's date.
  const label = raw === "" ? null : raw.slice(0, 80);

  const { data, error } = await supabase
    .from("trips")
    .update({ label })
    .eq("id", id)
    .select("id, label")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
