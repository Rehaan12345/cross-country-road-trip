import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET = Deno.env.get("INGEST_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// OwnTracks HTTP mode expects a JSON array back. Empty is a valid "nothing for you".
const ok = () => Response.json([]);

Deno.serve(async (req) => {
  // Header is cleaner, but OwnTracks iOS custom-header support varies by version.
  // The query param is guaranteed to work since the endpoint URL is fully ours.
  const url = new URL(req.url);
  const presented = req.headers.get("x-ingest-secret") ?? url.searchParams.get("secret");
  if (presented !== SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json();

  // OwnTracks also sends _type: transition | waypoint | lwt | beacon. Ignore, don't reject.
  if (body._type !== "location") {
    console.log("skip _type", body._type);
    return ok();
  }

  const recorded_at = new Date(body.tst * 1000).toISOString();

  // One log line per ping. This is the entire reason we chose an endpoint we own
  // over posting straight to PostgREST — when pings stop in Nevada, there's a trace.
  console.log("ping", recorded_at, body.lat, body.lon, "acc", body.acc, "batt", body.batt);

  const { error } = await supabase.from("points").upsert({
    device: body.tid ?? "unknown",
    recorded_at,
    lat: body.lat,
    lon: body.lon,
    accuracy_m: body.acc,
    altitude_m: body.alt,
    vel: body.vel,
    battery: body.batt,
    raw: body,
  }, { onConflict: "device,recorded_at", ignoreDuplicates: true });

  if (error) {
    // 500 makes OwnTracks retry later. Losing the ping is worse than a duplicate attempt.
    console.error("insert failed", error.message, body);
    return new Response("error", { status: 500 });
  }

  return ok();
});
