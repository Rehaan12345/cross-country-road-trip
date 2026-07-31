"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import Nav from "@/components/Nav";
import { miles } from "@/lib/format";

const RouteMap = dynamicImport(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type Payload = {
  geojson: never;
  totalMeters: number;
  tripCount: number;
};

export default function Journey() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    fetch("/api/journey", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return (
    <main>
      <Nav />

      {data === null ? (
        <div className="idle">Loading…</div>
      ) : (
        <>
          <RouteMap geojson={data.geojson} />
          {!data.geojson && (
            <div className="note">
              No route drawn yet. The journey map only includes points that
              belong to a trip.
            </div>
          )}
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Total</div>
              <div className="stat-value">
                {miles(data.totalMeters)}
                <span className="unit">mi</span>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Trips</div>
              <div className="stat-value">{data.tripCount}</div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
