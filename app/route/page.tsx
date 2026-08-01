"use client";

import { useEffect, useMemo, useState } from "react";
import dynamicImport from "next/dynamic";
import Nav from "@/components/Nav";
import PlanDayRow from "@/components/PlanDay";
import type { Place } from "@/components/PlaceSearch";
import { fetchJson } from "@/lib/api";
import { calendarDay } from "@/lib/format";
import {
  buildItinerary,
  canRestAt,
  canRemoveStop,
  driveMiles,
  indexOfStop,
  sideTripMiles,
  totalMinutes,
  addRest,
  removeRest,
  setDriveDate,
  setDriveNote,
  setStopNote,
  toEdits,
  toggleDone,
  type PlanState,
} from "@/lib/plan";

// MapLibre is large and touches window on import — keep it off the server and
// out of the shared bundle, exactly as the other two map screens do.
const PlanMap = dynamicImport(() => import("@/components/PlanMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

const EMPTY: PlanState = {
  departure: "2026-08-09",
  stops: [],
  doneStopId: null,
  doneNights: 0,
};

export default function Route() {
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [journey, setJourney] = useState<object | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showPlan, setShowPlan] = useState(true);
  const [showDriven, setShowDriven] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchJson<{ plan: PlanState }>("/api/plan")
      .then((d) => setPlan(d.plan))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load the plan"),
      );

    // Best-effort: the itinerary is the point of this screen, and it should
    // still render if there's no recorded route to overlay yet.
    fetchJson<{ geojson: object | null }>("/api/journey")
      .then((d) => setJourney(d.geojson))
      .catch(() => setJourney(null));
  }, []);

  // Dates, day numbers and trip length are all derived — nothing here is stored.
  const itinerary = useMemo(() => buildItinerary(plan ?? EMPTY), [plan]);
  const current = selected === null
    ? null
    : itinerary.find((d) => d.day === selected) ?? null;

  /** Typed-in edits: applied locally first, then reconciled with the server. */
  async function save(next: PlanState) {
    if (!plan) return;
    const previous = plan;
    setPlan(next);
    setError("");

    try {
      const res = await fetch("/api/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toEdits(next)),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setPlan((await res.json()).plan);
    } catch {
      setPlan(previous); // roll back to what the server still holds
      setError("Could not save that change");
    }
  }

  /**
   * Structural edits. These need the network — the server geocodes and routes —
   * so unlike a typed edit there is nothing to apply optimistically: the shape
   * of the answer isn't known until the router replies.
   */
  async function structural(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(path, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setPlan(body.plan);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the route");
    }
    setBusy(false);
  }

  const insertCity = (afterStopId: string, p: Place) =>
    structural("/api/plan/stops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        afterStopId,
        name: p.name,
        lng: p.coord[0],
        lat: p.coord[1],
      }),
    });

  const removeCity = (id: string) =>
    structural(`/api/plan/stops/${id}`, { method: "DELETE" });

  const addSideTrip = (stopId: string, p: Place) =>
    structural("/api/plan/side-trips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stopId, name: p.name, lng: p.coord[0], lat: p.coord[1] }),
    });

  const removeSideTrip = (id: string) =>
    structural(`/api/plan/side-trips/${id}`, { method: "DELETE" });

  function changeDate(fromStopId: string, date: string) {
    if (!plan) return;
    const result = setDriveDate(plan, fromStopId, date);
    if (!result.ok) {
      setError(result.error);
      setPlan({ ...plan }); // force the input back to the stored value
      return;
    }
    save(result.state);
  }

  const stops = plan?.stops ?? [];
  const depart = itinerary[0]?.date;
  const arrive = itinerary[itinerary.length - 1]?.date;
  const restNights = itinerary.filter((d) => d.kind === "rest").length;
  const doneDays = itinerary.filter((d) => d.done).length;
  const donePos = indexOfStop(stops, plan?.doneStopId ?? null);

  const planned = driveMiles(stops) + sideTripMiles(stops);
  const done =
    stops.slice(0, Math.max(0, donePos)).reduce((s, x) => s + (x.drive?.miles ?? 0), 0) +
    stops.slice(0, Math.max(0, donePos) + 1).reduce((s, x) => s + x.sideTrips.reduce((n, t) => n + t.miles, 0), 0);
  const driveHours = Math.round(totalMinutes(stops) / 60);

  return (
    <main>
      <Nav />

      <div className="journey-total">
        <span className="stat-label">Plan</span>
        <span>
          {plan && depart && arrive ? (
            <>
              <strong>{calendarDay(depart)}</strong> → <strong>{calendarDay(arrive)}</strong>
            </>
          ) : (
            "…"
          )}
        </span>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Miles</div>
          <div className="stat-value">
            {done.toLocaleString()}
            <span className="unit">/ {planned.toLocaleString()}</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Days</div>
          <div className="stat-value">
            {plan ? doneDays : "–"}
            <span className="unit">/ {plan ? itinerary.length : "–"}</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Behind wheel</div>
          <div className="stat-value">
            {driveHours}
            <span className="unit">h</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Rest</div>
          <div className="stat-value">
            {plan ? restNights : "–"}
            <span className="unit">{restNights === 1 ? "night" : "nights"}</span>
          </div>
        </div>
      </div>

      <div className="toggles">
        <button
          className={`toggle${showPlan ? " on" : ""}`}
          onClick={() => setShowPlan((v) => !v)}
          aria-pressed={showPlan}
        >
          <span className="key plan" />
          Plan
        </button>
        <button
          className={`toggle${showDriven ? " on" : ""}`}
          onClick={() => setShowDriven((v) => !v)}
          aria-pressed={showDriven}
        >
          <span className="key driven" />
          Recorded
        </button>
      </div>

      <PlanMap
        journey={journey}
        showPlan={showPlan}
        showDriven={showDriven}
        stops={stops}
        doneStopId={plan?.doneStopId ?? null}
        selectedDriveFromId={current?.kind === "drive" ? current.from.id : null}
        selectedStopId={current?.kind === "rest" ? current.stop.id : null}
        onSelectStop={(id) => {
          // Prefer the rest day at that stop; otherwise the drive that touches
          // it, so tapping a pin always lands on a real row in the list. The
          // `from` case only fires for the origin, which nothing arrives at.
          const hit =
            itinerary.find((d) => d.kind === "rest" && d.stop.id === id) ??
            itinerary.find(
              (d) => d.kind === "drive" && (d.to.id === id || d.from.id === id),
            );
          setSelected((cur) => (hit && cur === hit.day ? null : hit?.day ?? null));
        }}
        className="map"
      />

      <div className="error">{error}</div>

      {!plan && !error && <div className="idle">Loading the plan…</div>}

      <ol className="plan-list">
        {plan && itinerary.map((entry) => {
          const here = entry.kind === "rest" ? entry.stop : entry.to;
          const i = indexOfStop(stops, here.id);
          return (
            <PlanDayRow
              key={entry.day}
              entry={entry}
              selected={selected === entry.day}
              canRest={canRestAt(stops, i)}
              canRemoveDestination={canRemoveStop(stops, i)}
              busy={busy}
              onSelect={() =>
                setSelected((cur) => (cur === entry.day ? null : entry.day))
              }
              onDateChange={(date) =>
                entry.kind === "drive" && changeDate(entry.from.id, date)
              }
              onNoteChange={(text) =>
                plan &&
                save(
                  entry.kind === "drive"
                    ? setDriveNote(plan, entry.from.id, text)
                    : setStopNote(plan, entry.stop.id, text),
                )
              }
              onToggleDone={() => plan && save(toggleDone(plan, entry))}
              onAddRest={() => plan && save(addRest(plan, here.id))}
              onRemoveRest={() => plan && save(removeRest(plan, here.id))}
              onInsertCity={(p) =>
                entry.kind === "drive" && insertCity(entry.from.id, p)
              }
              onRemoveCity={() => removeCity(here.id)}
              onAddSideTrip={(p) => addSideTrip(here.id, p)}
              onRemoveSideTrip={removeSideTrip}
            />
          );
        })}
      </ol>
    </main>
  );
}
