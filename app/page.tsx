"use client";

import { useCallback, useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import Nav from "@/components/Nav";
import { fetchJson } from "@/lib/api";
import { miles, stopwatch } from "@/lib/format";

// MapLibre is large and touches window on import — keep it off the server and
// out of the shared bundle.
const RouteMap = dynamicImport(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => <div className="map map-compact map-loading">Loading map…</div>,
});

type Status = {
  trip: { id: string; label: string | null; started_at: string } | null;
  stats: { distance_m: number; moving_s: number; paused_s: number } | null;
  pausedAt: string | null;
  lastPingAt: string | null;
  lastPosition: { lat: number; lon: number } | null;
  serverNow: string | null;
};

type Journey = {
  geojson: never;
  // Days marked driven that the recorder missed. Already counted in the totals
  // below — carried separately only so the map can draw them differently.
  plannedGeojson: never | null;
  totalMeters: number;
  tripCount: number;
};

const POLL_MS = 10_000;

// The recorder-health line. This is the most important element on the screen:
// it's how a dead recorder gets noticed while there's still road left to redrive.
function health(lastPingAt: string | null, now: number) {
  if (!lastPingAt) return { cls: "bad", text: "no pings yet" };

  // Clamp: a ping can never legitimately be in the future, and showing a
  // negative age just looks broken.
  const ageS = Math.max(0, (now - new Date(lastPingAt).getTime()) / 1000);
  if (ageS < 10) return { cls: "good", text: "just now" };
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
  // How far this device's clock is ahead of the server's. Measured each poll so
  // the health indicator stays honest even if the phone or laptop clock is off.
  const [skewMs, setSkewMs] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([
        fetchJson<Status>("/api/status"),
        fetchJson<Journey>("/api/journey"),
      ]);
      setStatus(s);
      setJourney(j);
      if (s.serverNow) setSkewMs(Date.now() - new Date(s.serverNow).getTime());
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

  async function post(path: string) {
    setBusy(true);
    setError("");

    const res = await fetch(path, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Request failed (${res.status})`);
    }

    await refresh();
    setBusy(false);
  }

  const active = status?.trip ?? null;
  const paused = Boolean(status?.pausedAt);
  const h = health(status?.lastPingAt ?? null, now - skewMs);

  // Elapsed excludes time spent paused. While paused the clock is frozen at the
  // moment the pause began, so the number on screen matches what gets stored.
  const pausedS = status?.stats?.paused_s ?? 0;
  const until = paused ? new Date(status!.pausedAt!).getTime() : now;
  const elapsedS = active
    ? (until - new Date(active.started_at).getTime()) / 1000 - pausedS
    : 0;

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
            <div className="stat-label">{paused ? "Paused" : "Elapsed"}</div>
            <div className={`stat-value${paused ? " dim" : ""}`}>
              {stopwatch(elapsedS)}
            </div>
          </div>
        </div>
      ) : (
        <div className="idle">No trip running</div>
      )}

      <RouteMap
        geojson={journey?.geojson ?? null}
        planned={journey?.plannedGeojson ?? null}
        current={
          status?.lastPosition
            ? [status.lastPosition.lon, status.lastPosition.lat]
            : null
        }
        // Same threshold the health line uses to stop calling a ping recent, so
        // the marker and the label above it never contradict each other.
        currentStale={h.cls === "bad"}
        className="map map-compact"
      />

      <div className="journey-total">
        <span className="stat-label">Journey</span>
        <span>
          <strong>{miles(journey?.totalMeters ?? 0)}</strong> mi ·{" "}
          {journey?.tripCount ?? 0} trips
        </span>
      </div>

      <div className="spacer" />

      <div className="error">{error}</div>

      <div className="controls">
        {active && (
          <button
            className="action secondary"
            onClick={() => post("/api/trips/pause")}
            disabled={busy}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        <button
          className={`action ${active ? "stop" : ""}`}
          onClick={() => post(active ? "/api/trips/stop" : "/api/trips/start")}
          disabled={busy || status === null}
        >
          {busy ? "…" : active ? "Stop" : "Start"}
        </button>
      </div>
    </main>
  );
}
