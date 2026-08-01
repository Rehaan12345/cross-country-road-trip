import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Toggles the pause on the active trip. One endpoint rather than two, because
// the button is one button and the truth lives in the database either way —
// the partial unique index guarantees at most one open pause.
export async function POST() {
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("status", "active")
    .maybeSingle();

  if (!trip) {
    return NextResponse.json({ error: "no active trip" }, { status: 409 });
  }

  const { data: open } = await supabase
    .from("trip_pauses")
    .select("id")
    .eq("trip_id", trip.id)
    .is("resumed_at", null)
    .maybeSingle();

  if (open) {
    const { error } = await supabase
      .from("trip_pauses")
      .update({ resumed_at: new Date().toISOString() })
      .eq("id", open.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ paused: false });
  }

  const { error } = await supabase
    .from("trip_pauses")
    .insert({ trip_id: trip.id });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json({ paused: true });
}
