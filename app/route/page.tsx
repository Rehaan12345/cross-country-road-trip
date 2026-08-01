"use client";

import { useEffect, useMemo, useState } from "react";
import dynamicImport from "next/dynamic";
import Nav from "@/components/Nav";
import PlanDayRow from "@/components/PlanDay";
import { fetchJson } from "@/lib/api";
import { calendarDay } from "@/lib/format";
import {
  DEFAULT_PLAN,
  LEGS,
  TOTAL_MILES,
  TOTAL_DRIVE_MINUTES,
  buildItinerary,
  addRest,
  removeRest,
  setDriveDate,
  setLegNote,
  setStopNote,
  toggleDone,
  type PlanState,
} from "@/lib/plan";

// MapLibre is large and touches window on import — keep it off the server and
// out of the shared bundle, exactly as the other two map screens do.
const PlanMap = dynamicImport(() => import("@/components/PlanMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

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
  const itinerary = useMemo(
    () => buildItinerary(plan ?? DEFAULT_PLAN),
    [plan],
  );

  const current = selected === null
    ? null
    : itinerary.find((d) => d.day === selected) ?? null;

  async function save(next: PlanState) {
    if (!plan) return;

    // Apply locally first so the list moves under your thumb, then let the
    // server's copy win. Every edit is a pure function in lib/plan.ts, so both
    // sides agree by construction.
    const previous = plan;
    setPlan(next);
    setError("");

    try {
      const res = await fetch("/api/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setPlan((await res.json()).plan);
    } catch {
      setPlan(previous); // roll back to what the server still holds
      setError("Could not save that change");
    }
  }

  function changeDate(leg: number, date: string) {
    if (!plan) return;
    const result = setDriveDate(plan, leg, date);
    if (!result.ok) {
      setError(result.error);
      // Force the input back to the stored value; the plan never changed.
      setPlan({ ...plan });
      return;
    }
    save(result.state);
  }

  async function reset() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/plan/reset", { method: "POST" });
      if (!res.ok) throw new Error();
      setPlan((await res.json()).plan);
      setSelected(null);
    } catch {
      setError("Could not reset the plan");
    }
    setBusy(false);
  }

  const depart = itinerary[0]?.date;
  const arrive = itinerary[itinerary.length - 1]?.date;
  const restNights = itinerary.filter((d) => d.kind === "rest").length;
  const driveHours = Math.round(TOTAL_DRIVE_MINUTES / 60);
  const doneDays = itinerary.filter((d) => d.done).length;
  // Miles behind you, counted from completed legs rather than elapsed days —
  // a rest day adds a day but no distance.
  const doneMiles = LEGS.filter((l) => l.leg <= (plan?.doneLegs ?? 0)).reduce(
    (s, l) => s + l.distance_miles,
    0,
  );

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
            {doneMiles.toLocaleString()}
            <span className="unit">/ {TOTAL_MILES.toLocaleString()}</span>
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
        rests={plan?.rests ?? {}}
        doneLegs={plan?.doneLegs ?? 0}
        selectedLeg={current?.kind === "drive" ? current.leg.leg : null}
        selectedStop={
          current?.kind === "rest" ? current.stop
          : current?.kind === "drive" ? null
          : null
        }
        onSelectStop={(stop) => {
          // Prefer the rest day at that stop; otherwise the drive that touches
          // it, so tapping a pin always lands on a real row in the list. The
          // `from` case only fires for Boston, which nothing arrives at.
          const hit =
            itinerary.find((d) => d.kind === "rest" && d.stop === stop) ??
            itinerary.find(
              (d) => d.kind === "drive" && (d.leg.to === stop || d.leg.from === stop),
            );
          setSelected((cur) => (hit && cur === hit.day ? null : hit?.day ?? null));
        }}
        className="map"
      />

      <div className="error">{error}</div>

      {/* Until the stored plan arrives, showing the built-in default would put
          somebody else's dates on screen as if they were yours. */}
      {!plan && !error && <div className="idle">Loading the plan…</div>}

      <ol className="plan-list">
        {plan && itinerary.map((entry) => (
          <PlanDayRow
            key={entry.day}
            entry={entry}
            selected={selected === entry.day}
            onSelect={() =>
              setSelected((cur) => (cur === entry.day ? null : entry.day))
            }
            onDateChange={(date) =>
              entry.kind === "drive" && changeDate(entry.leg.leg, date)
            }
            onNoteChange={(text) =>
              plan &&
              save(
                entry.kind === "drive"
                  ? setLegNote(plan, entry.leg.leg, text)
                  : setStopNote(plan, entry.stop, text),
              )
            }
            onToggleDone={() => plan && save(toggleDone(plan, entry))}
            onAddRest={(stop) => plan && save(addRest(plan, stop))}
            onRemoveRest={(stop) => plan && save(removeRest(plan, stop))}
          />
        ))}
      </ol>

      <button className="action secondary wide" onClick={reset} disabled={busy || !plan}>
        {busy ? "…" : "Reset plan"}
      </button>
    </main>
  );
}
