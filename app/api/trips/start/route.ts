import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST() {
  const { data, error } = await supabase
    .from("trips")
    .insert({})
    .select("id, started_at")
    .single();

  // The partial unique index on status='active' rejects a second open trip,
  // so a double-tap on Start fails here rather than corrupting the data.
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json(data);
}
