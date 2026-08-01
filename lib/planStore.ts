// Server-only. Reads and writes the route.
//
// Imports lib/supabase, which holds the service-role key — never import this
// from a client component.

import { supabase } from "@/lib/supabase";
import type { PlanEdits, PlanState, RouteStop, SideTrip } from "@/lib/plan";

const STOP_COLUMNS =
  "id, position, name, lng, lat, rest_nights, note, drive_note, drive_miles, drive_minutes, drive_via, drive_estimated, drive_geometry";

type StopRow = {
  id: string;
  position: number;
  name: string;
  lng: number;
  lat: number;
  rest_nights: number;
  note: string;
  drive_note: string;
  drive_miles: number | null;
  drive_minutes: number | null;
  drive_via: string | null;
  drive_estimated: boolean;
  drive_geometry: [number, number][] | null;
};

type SideTripRow = {
  id: string;
  stop_id: string;
  name: string;
  lng: number;
  lat: number;
  miles: number;
  minutes: number;
  geometry: [number, number][];
};

export async function readPlan(): Promise<PlanState> {
  const [trip, stops, sides] = await Promise.all([
    supabase.from("plan_trip").select("departure_date, done_stop_id, done_nights").maybeSingle(),
    supabase.from("route_stops").select(STOP_COLUMNS).order("position"),
    supabase.from("route_side_trips").select("*"),
  ]);

  if (trip.error) throw new Error(trip.error.message);
  if (stops.error) throw new Error(stops.error.message);
  if (sides.error) throw new Error(sides.error.message);

  const bySide = new Map<string, SideTrip[]>();
  for (const r of (sides.data ?? []) as SideTripRow[]) {
    const list = bySide.get(r.stop_id) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      coord: [r.lng, r.lat],
      miles: r.miles,
      minutes: r.minutes,
      geometry: r.geometry ?? [],
    });
    bySide.set(r.stop_id, list);
  }

  const rows = (stops.data ?? []) as StopRow[];
  const list: RouteStop[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    coord: [r.lng, r.lat],
    restNights: r.rest_nights,
    note: r.note,
    driveNote: r.drive_note,
    drive:
      r.drive_miles === null || r.drive_minutes === null
        ? null
        : {
            miles: r.drive_miles,
            minutes: r.drive_minutes,
            via: r.drive_via,
            estimated: r.drive_estimated,
            geometry: r.drive_geometry ?? [],
          },
    sideTrips: (bySide.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  // The last stop is the end of the road, whatever the database says about it —
  // a stale drive there would draw a line to nowhere.
  if (list.length > 0) list[list.length - 1].drive = null;

  return {
    // Postgres `date` arrives as `yyyy-mm-dd`; slice defends against a driver
    // that ever decides to append a time.
    departure: String(trip.data?.departure_date ?? "2026-08-09").slice(0, 10),
    stops: list,
    doneStopId: trip.data?.done_stop_id ?? null,
    doneNights: trip.data?.done_nights ?? 0,
  };
}

/**
 * Apply the typed-in fields.
 *
 * Only stops that already exist are touched, and only their four editable
 * columns — an id the client invented is ignored rather than inserted, so a
 * stale tab cannot resurrect a city you deleted.
 */
export async function writeEdits(edits: PlanEdits): Promise<void> {
  const trip = await supabase.from("plan_trip").upsert(
    {
      id: true,
      departure_date: edits.departure,
      done_stop_id: edits.doneStopId,
      done_nights: edits.doneNights,
    },
    { onConflict: "id" },
  );
  if (trip.error) throw new Error(trip.error.message);

  const existing = await supabase.from("route_stops").select("id");
  if (existing.error) throw new Error(existing.error.message);
  const known = new Set((existing.data ?? []).map((r) => r.id));

  for (const s of edits.stops) {
    if (!known.has(s.id)) continue;
    const { error } = await supabase
      .from("route_stops")
      .update({ rest_nights: s.restNights, note: s.note, drive_note: s.driveNote })
      .eq("id", s.id);
    if (error) throw new Error(error.message);
  }
}
