"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import TripRow, { type Trip } from "@/components/TripRow";
import { fetchJson } from "@/lib/api";

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson<{ trips: Trip[] }>("/api/trips")
      .then((d) => setTrips(d.trips ?? []))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load trips");
        setTrips([]);
      });
  }, []);

  return (
    <main>
      <Nav />

      {error && <div className="error">{error}</div>}
      {trips === null && <div className="idle">Loading…</div>}
      {trips?.length === 0 && !error && <div className="idle">No trips yet</div>}

      {trips?.map((t) => (
        <TripRow
          key={t.id}
          trip={t}
          onDeleted={(id) => setTrips((cur) => (cur ?? []).filter((x) => x.id !== id))}
          onRenamed={(id, label) =>
            setTrips((cur) =>
              (cur ?? []).map((x) => (x.id === id ? { ...x, label } : x)),
            )
          }
        />
      ))}

      {trips !== null && trips.length > 0 && (
        <div className="note">Swipe a trip right to delete it</div>
      )}
    </main>
  );
}
