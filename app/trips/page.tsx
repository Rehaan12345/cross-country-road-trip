"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import TripRow, { type Trip } from "@/components/TripRow";
import PlannedRow, { type Planned } from "@/components/PlannedRow";
import { fetchJson } from "@/lib/api";

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [planned, setPlanned] = useState<Planned[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson<{ trips: Trip[]; planned: Planned[] }>("/api/trips")
      .then((d) => {
        setTrips(d.trips ?? []);
        setPlanned(d.planned ?? []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load trips");
        setTrips([]);
      });
  }, []);

  // Recorded and planned days interleave by date, newest first, so the list
  // reads as one journey — while each row still says which kind it is.
  const rows = useMemo(() => {
    const recorded = (trips ?? []).map((t) => ({
      key: `t-${t.id}`,
      at: t.started_at.slice(0, 10),
      trip: t,
      planned: null as Planned | null,
    }));
    const asserted = planned.map((p) => ({
      key: `p-${p.id}`,
      at: p.date,
      trip: null as Trip | null,
      planned: p,
    }));
    return [...recorded, ...asserted].sort((a, b) => b.at.localeCompare(a.at));
  }, [trips, planned]);

  return (
    <main>
      <Nav />

      {error && <div className="error">{error}</div>}
      {trips === null && <div className="idle">Loading…</div>}
      {trips !== null && rows.length === 0 && !error && (
        <div className="idle">No trips yet</div>
      )}

      {rows.map((r) =>
        r.trip ? (
          <TripRow
            key={r.key}
            trip={r.trip}
            onDeleted={(id) => setTrips((cur) => (cur ?? []).filter((x) => x.id !== id))}
            onRenamed={(id, label) =>
              setTrips((cur) =>
                (cur ?? []).map((x) => (x.id === id ? { ...x, label } : x)),
              )
            }
          />
        ) : (
          <PlannedRow key={r.key} planned={r.planned!} />
        ),
      )}

      {(trips?.length ?? 0) > 0 && (
        <div className="note">Swipe a trip right to delete it</div>
      )}
    </main>
  );
}
