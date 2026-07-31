"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import { miles, duration, day, clock } from "@/lib/format";

type Trip = {
  id: string;
  label: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  distance_m: number | null;
  duration_s: number | null;
};

export default function Trips() {
  const [trips, setTrips] = useState<Trip[] | null>(null);

  useEffect(() => {
    fetch("/api/trips", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTrips(d.trips ?? []))
      .catch(() => setTrips([]));
  }, []);

  return (
    <main>
      <Nav />

      {trips === null && <div className="idle">Loading…</div>}
      {trips?.length === 0 && <div className="idle">No trips yet</div>}

      {trips?.map((t) => (
        <Link key={t.id} href={`/trips/${t.id}`} className="row">
          <div className="row-main">
            <div className="row-title">{t.label ?? day(t.started_at)}</div>
            <div className="row-sub">
              {clock(t.started_at)}
              {t.ended_at ? ` – ${clock(t.ended_at)}` : ""}
              {t.status === "active" && <span className="badge">recording</span>}
            </div>
          </div>
          <div className="row-stat">
            <span className="row-miles">{miles(t.distance_m)}</span>
            <span className="unit">mi</span>
            <div className="row-sub">{duration(t.duration_s)}</div>
          </div>
        </Link>
      ))}
    </main>
  );
}
