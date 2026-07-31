"use client";

import { useCallback, useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import Nav from "@/components/Nav";
import { fetchJson } from "@/lib/api";
import { miles } from "@/lib/format";

// MapLibre is large and touches window on import — keep it off the server and
// out of the shared bundle.
const RouteMap = dynamicImport(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type Status = {
  trip: { id: string; started_at: string } | null;
  stats: { distance_m: number; moving_s: number; point_count: number } | null;
  lastPingAt: string | null;
};

type Journey = {
  geojson: never;
  totalMeters: number;
  tripCount: number;
};

const POLL_MS = 10_000;

function fmtDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`;
}

// The recorder-health line. This is the most important element on the screen:
// it's how a dead recorder gets noticed while there's still road left to redrive.
function health(lastPingAt: string | null, now: number) {
  if (!lastPingAt) return { cls: "bad", text: "no pings yet" };

  const ageS = (now - new Date(lastPingAt).getTime()) / 1000;
  if (ageS < 120) return { cls: "good", text: `${Math.round(ageS)}s ago` };
  if (ageS < 600) return { cls: "warn", text: `${Math.round(ageS / 60)}m ago` };
  if (ageS < 86400) return { cls: "bad", text: `${Math.round(ageS / 60)}m ago` };
  return { cls: "bad", text: `${Math.round(ageS / 3600)}h ago` };
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([
        fetchJson<Status>("/api/status"),
        fetchJson<Journey>("/api/journey"),
      ]);
      setStatus(s);
      setJourney(j);
      setLoadError("");
    } catch (e) {
      // Dead zones are expected; keep the last known state but say so.
      setLoadError(e instanceof Error ? e.message : "Could not reach the server");
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function toggle() {
    setBusy(true);
    setError("");

    const path = status?.trip ? "/api/trips/stop" : "/api/trips/start";
    const res = await fetch(path, { method: "POST" });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Request failed (${res.status})`);
    }

    await refresh();
    setBusy(false);
  }

  const active = status?.trip ?? null;
  const h = health(status?.lastPingAt ?? null, now);
  const elapsedS = active ? (now - new Date(active.started_at).getTime()) / 1000 : 0;
  const tripMiles = status?.stats ? status.stats.distance_m / 1609.34 : 0;

  return (
    <main>
      <Nav />

      <div className="health">
        <span className={`dot ${h.cls}`} />
        <span className="health-label">Last ping</span>
        <span className="health-value">{h.text}</span>
      </div>

      {loadError && <div className="error">{loadError}</div>}

      {active ? (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Distance</div>
            <div className="stat-value">
              {tripMiles.toFixed(1)}
              <span className="unit">mi</span>
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Elapsed</div>
            <div className="stat-value">
              {fmtDuration(elapsedS)}
              <span className="unit">{elapsedS >= 3600 ? "hr" : "min"}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="idle">No trip running</div>
      )}

      <RouteMap geojson={journey?.geojson ?? null} className="map map-compact" />

      <div className="journey-total">
        <span className="stat-label">Journey</span>
        <span>
          <strong>{miles(journey?.totalMeters ?? 0)}</strong> mi ·{" "}
          {journey?.tripCount ?? 0} trips
        </span>
      </div>

      <div className="spacer" />

      <div className="error">{error}</div>

      <button
        className={`action ${active ? "stop" : ""}`}
        onClick={toggle}
        disabled={busy || status === null}
      >
        {busy ? "…" : active ? "Stop" : "Start"}
      </button>
    </main>
  );
}
