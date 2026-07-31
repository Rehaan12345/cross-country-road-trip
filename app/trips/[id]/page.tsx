"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import dynamicImport from "next/dynamic";
import { miles, duration, day, clock } from "@/lib/format";

// MapLibre is large and touches window on import — keep it out of the shared
// bundle and off the server.
const RouteMap = dynamicImport(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type Payload = {
  trip: {
    id: string;
    label: string | null;
    started_at: string;
    ended_at: string | null;
    status: string;
    distance_m: number | null;
    duration_s: number | null;
    moving_s: number | null;
    max_speed_ms: number | null;
    point_count: number | null;
  };
  geojson: never;
  stats: { distance_m: number; moving_s: number; point_count: number } | null;
};

export default function TripDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    fetch(`/api/trips/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  if (!data?.trip) {
    return (
      <main>
        <div className="idle">Loading…</div>
      </main>
    );
  }

  const { trip, stats } = data;
  // An in-progress trip has no persisted stats; the API computes them live.
  const distance = stats?.distance_m ?? trip.distance_m;
  const moving = stats?.moving_s ?? trip.moving_s;
  const points = stats?.point_count ?? trip.point_count;

  return (
    <main>
      <div className="crumb">
        <Link href="/trips">← Trips</Link>
      </div>

      <h1 className="title">{trip.label ?? day(trip.started_at)}</h1>
      <div className="row-sub">
        {clock(trip.started_at)}
        {trip.ended_at ? ` – ${clock(trip.ended_at)}` : " – in progress"}
      </div>

      <RouteMap geojson={data.geojson} />
      {!data.geojson && (
        <div className="note">No route points for this trip yet</div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Distance</div>
          <div className="stat-value">
            {miles(distance)}
            <span className="unit">mi</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Duration</div>
          <div className="stat-value">{duration(trip.duration_s)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Moving</div>
          <div className="stat-value">{duration(moving)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Points</div>
          <div className="stat-value">{points ?? 0}</div>
        </div>
      </div>
    </main>
  );
}
