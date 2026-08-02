"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useReadOnly } from "@/components/ReadOnly";
import { miles, duration, day, clock } from "@/lib/format";

export type Trip = {
  id: string;
  label: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  distance_m: number | null;
  duration_s: number | null;
};

const OPEN_PX = 104;   // width of the revealed delete action
const SNAP_PX = 60;    // drag distance that counts as a deliberate swipe

export default function TripRow({
  trip,
  onDeleted,
  onRenamed,
}: {
  trip: Trip;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, label: string | null) => void;
}) {
  const readOnly = useReadOnly();
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(trip.label ?? "");
  const [error, setError] = useState("");

  const startX = useRef(0);
  const dragged = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const title = trip.label ?? day(trip.started_at);

  function close() {
    setOpen(false);
    setConfirming(false);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }

  async function save() {
    setEditing(false);
    const next = value.trim();
    if (next === (trip.label ?? "")) return;

    const res = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: next }),
    });

    if (res.ok) {
      const body = await res.json();
      onRenamed(trip.id, body.label ?? null);
      setError("");
    } else {
      setValue(trip.label ?? ""); // roll back to what the server still holds
      setError("Could not rename");
    }
  }

  async function remove() {
    // First tap arms, second confirms. Trip data is not worth losing to a
    // stray thumb, and it disarms itself after a few seconds.
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }

    const res = await fetch(`/api/trips/${trip.id}`, { method: "DELETE" });
    if (res.ok) {
      onDeleted(trip.id);
    } else {
      setError("Could not delete");
      close();
    }
  }

  if (editing) {
    return (
      <input
        className="row-input"
        value={value}
        autoFocus
        placeholder={day(trip.started_at)}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(trip.label ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="swipe">
      {/* Not rendered at all for a viewer: the swipe gesture IS this button's
          affordance, and a row that slides open onto a dead control is worse
          than a row that doesn't slide. */}
      {!readOnly && (
        <button
          className={`swipe-action${confirming ? " confirming" : ""}`}
          onClick={remove}
          aria-label={confirming ? "Confirm delete" : "Delete trip"}
        >
          {confirming ? "Sure?" : "Delete"}
        </button>
      )}

      <div
        className="swipe-content"
        style={{ transform: `translateX(${open ? OPEN_PX : dx}px)` }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          dragged.current = false;
        }}
        onTouchMove={(e) => {
          if (readOnly) return;
          const d = e.touches[0].clientX - startX.current;
          if (Math.abs(d) > 6) dragged.current = true;
          // Left-to-right only; a leftward drag closes an open row.
          if (!open && d > 0) setDx(Math.min(d, OPEN_PX));
          if (open && d < 0) setDx(Math.max(OPEN_PX + d, 0));
        }}
        onTouchEnd={() => {
          if (readOnly) return;
          if (!open) setOpen(dx > SNAP_PX);
          else if (dx < OPEN_PX - SNAP_PX) close();
          setDx(0);
        }}
      >
        <div className="row">
          <Link
            href={`/trips/${trip.id}`}
            className="row-main"
            onClick={(e) => {
              // A swipe must never navigate.
              if (dragged.current || open) {
                e.preventDefault();
                close();
              }
            }}
          >
            <div className="row-title">{title}</div>
            <div className="row-sub">
              {day(trip.started_at)} · {clock(trip.started_at)}
              {trip.ended_at ? ` – ${clock(trip.ended_at)}` : ""}
              {trip.status === "active" && <span className="badge">recording</span>}
            </div>
            {error && <div className="error">{error}</div>}
          </Link>

          <div className="row-stat">
            <span className="row-miles">{miles(trip.distance_m)}</span>
            <span className="unit">mi</span>
            <div className="row-sub">{duration(trip.duration_s)}</div>
          </div>

          {!readOnly && (
            <button
              className="row-edit"
              onClick={() => {
                close();
                setEditing(true);
              }}
              aria-label="Rename trip"
            >
              ✎
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
