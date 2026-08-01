import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { uncoveredDrives } from "@/lib/plan";
import { readPlan } from "@/lib/planStore";

export const dynamic = "force-dynamic";

const MILE_M = 1609.34;

export async function GET() {
  const { data, error } = await supabase
    .from("trips")
    .select("id, label, started_at, ended_at, status, distance_m, duration_s, moving_s, point_count")
    .order("started_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Days ticked off on the Route tab, standing in for recordings that never
  // happened. A day with a recorded trip is left out entirely — the recording
  // is already in the list above it, and two rows for one drive would read as
  // two drives.
  //
  // Derived on every read, never written into `trips`: that table holds what
  // the recorder measured. Untick the day and this stops returning it, with
  // nothing to clean up.
  //
  // A failure here must not take the recorded list down with it — the plan is
  // the addition, the trips are the point of the screen.
  let planned: unknown[] = [];
  try {
    const recordedDates = new Set(
      (data ?? []).map((t) => String(t.started_at).slice(0, 10)),
    );
    planned = uncoveredDrives(await readPlan(), recordedDates).map((d) => ({
      id: d.from.id,
      day: d.day,
      date: d.date,
      label: `${d.from.name} → ${d.to.name}`,
      distance_m: Math.round(d.drive.miles * MILE_M),
      duration_s: d.drive.minutes * 60,
    }));
  } catch (e) {
    console.error("[api/trips] plan read failed", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ trips: data, planned });
}
