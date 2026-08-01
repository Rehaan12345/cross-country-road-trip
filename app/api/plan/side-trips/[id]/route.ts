import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { readPlan } from "@/lib/planStore";

export const dynamic = "force-dynamic";

// No re-routing needed: a side trip hangs off a stop and the chain never knew
// about it, so removing one is just a delete.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { error } = await supabase.from("route_side_trips").delete().eq("id", id);
  if (error) {
    console.error("[api/plan/side-trips] delete failed", error.message);
    return NextResponse.json({ error: "delete failed", detail: error.message }, { status: 502 });
  }

  return NextResponse.json({ plan: await readPlan() });
}
