"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import dynamicImport from "next/dynamic";
import TripTitle from "@/components/TripTitle";
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
    paused_s: number | null;
    start_place: string | null;
    end_place: string | null;
  };
  geojson: never;
  stats: {
    distance_m: number;
    moving_s: number;
    point_count: number;
    paused_s: number;
  } | null;
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
  const stopped = stats?.paused_s ?? trip.paused_s ?? 0;

  // Travel time is wall-clock minus everything spent paused. A closed trip has
  // it stored; an open one is computed from now, since nothing has written yet.
  const travel =
    trip.status === "active"
      ? Math.max(
          0,
          (Date.now() - new Date(trip.started_at).getTime()) / 1000 - stopped,
        )
      : trip.duration_s;

  // Average over moving time, not elapsed — an hour parked shouldn't drag it down.
  const avgMph = moving && distance ? (distance / moving) * 2.237 : null;

  return (
    <main>
      <div className="crumb">
        <Link href="/trips">← Trips</Link>
      </div>

      <TripTitle
        id={trip.id}
        label={trip.label}
        fallback={day(trip.started_at)}
      />
      <div className="row-sub">
        {day(trip.started_at)} · {clock(trip.started_at)}
        {trip.ended_at ? ` – ${clock(trip.ended_at)}` : " – in progress"}
      </div>

      <div className="journey">
        <div className="leg">
          <span className="pip start" />
          <span className="place">{trip.start_place ?? "Locating…"}</span>
        </div>
        <div className="leg-line" />
        <div className="leg">
          <span className="pip end" />
          <span className="place">
            {trip.status === "active"
              ? "In progress"
              : trip.end_place ?? "Locating…"}
          </span>
        </div>
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
          <div className="stat-label">Travel time</div>
          <div className="stat-value">{duration(travel)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Stopped</div>
          <div className="stat-value">{duration(stopped)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Avg moving</div>
          <div className="stat-value">
            {avgMph ? avgMph.toFixed(0) : "–"}
            <span className="unit">mph</span>
          </div>
        </div>
      </div>
    </main>
  );
}
