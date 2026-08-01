// Server-only. Reads and writes the editable plan: a departure date, a number
// of nights per stop, and notes per leg and per stop. Everything else about the
// itinerary is derived — see buildItinerary in lib/plan.ts.
//
// Imports lib/supabase, which holds the service-role key — never import this
// from a client component.

import { supabase } from "@/lib/supabase";
import {
  DEFAULT_PLAN,
  LEGS,
  REST_STOPS,
  nightsAt,
  type PlanState,
} from "@/lib/plan";

const clone = (p: PlanState): PlanState => ({
  departure: p.departure,
  rests: { ...p.rests },
  legNotes: { ...p.legNotes },
  stopNotes: { ...p.stopNotes },
  doneLegs: p.doneLegs,
  doneNights: p.doneNights,
});

/**
 * The stored plan, seeding from the code defaults on first ever read.
 *
 * Seeding lazily rather than in the migration keeps DEFAULT_PLAN as the single
 * definition of the original trip — the same values feed a fresh database and
 * the reset action.
 */
export async function readPlan(): Promise<PlanState> {
  const [trip, stops, legs] = await Promise.all([
    supabase
      .from("plan_trip")
      .select("departure_date, done_legs, done_nights")
      .maybeSingle(),
    supabase.from("plan_stops").select("stop, rest_nights, note"),
    supabase.from("plan_legs").select("leg, note"),
  ]);

  if (trip.error) throw new Error(trip.error.message);
  if (stops.error) throw new Error(stops.error.message);
  if (legs.error) throw new Error(legs.error.message);

  if (!trip.data) {
    await writePlan(DEFAULT_PLAN);
    return clone(DEFAULT_PLAN);
  }

  const rests: Record<number, number> = {};
  const stopNotes: Record<number, string> = {};
  for (const row of stops.data ?? []) {
    // Zero nights is the absence of a rest, not a rest of length zero. Keeping
    // it out of the map means two equal plans compare equal. Same for a blank
    // note — which is kept even when the nights are gone, so re-adding a night
    // brings the note back with it.
    if (row.rest_nights > 0) rests[row.stop] = row.rest_nights;
    if (row.note) stopNotes[row.stop] = row.note;
  }

  const legNotes: Record<number, string> = {};
  for (const row of legs.data ?? []) {
    if (row.note) legNotes[row.leg] = row.note;
  }

  return {
    // Postgres `date` arrives as `yyyy-mm-dd`; slice defends against a driver
    // that ever decides to append a time.
    departure: String(trip.data.departure_date).slice(0, 10),
    rests,
    legNotes,
    stopNotes,
    doneLegs: trip.data.done_legs ?? 0,
    doneNights: trip.data.done_nights ?? 0,
  };
}

export async function writePlan(state: PlanState): Promise<void> {
  const trip = await supabase
    .from("plan_trip")
    .upsert(
      {
        id: true,
        departure_date: state.departure,
        done_legs: state.doneLegs,
        done_nights: state.doneNights,
      },
      { onConflict: "id" },
    );
  if (trip.error) throw new Error(trip.error.message);

  // Every restable stop and every leg is written every time, blanks and zeros
  // included. Writing the full set rather than only the non-empty ones is what
  // makes *clearing* a note or removing the last rest day actually stick — a
  // partial upsert would leave the old value behind.
  const stops = await supabase.from("plan_stops").upsert(
    REST_STOPS.map((stop) => ({
      stop,
      rest_nights: nightsAt(state, stop),
      note: state.stopNotes[stop] ?? "",
    })),
    { onConflict: "stop" },
  );
  if (stops.error) throw new Error(stops.error.message);

  const legs = await supabase.from("plan_legs").upsert(
    LEGS.map((l) => ({ leg: l.leg, note: state.legNotes[l.leg] ?? "" })),
    { onConflict: "leg" },
  );
  if (legs.error) throw new Error(legs.error.message);
}
