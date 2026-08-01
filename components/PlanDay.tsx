"use client";

import { useState } from "react";
import PlaceSearch, { type Place } from "@/components/PlaceSearch";
import { driveTime, MAX_NOTE, type ItineraryDay } from "@/lib/plan";
import { calendarDay } from "@/lib/format";

export default function PlanDayRow({
  entry,
  selected,
  canRest,
  canRemoveDestination,
  busy,
  onSelect,
  onDateChange,
  onNoteChange,
  onToggleDone,
  onAddRest,
  onRemoveRest,
  onInsertCity,
  onRemoveCity,
  onAddSideTrip,
  onRemoveSideTrip,
}: {
  entry: ItineraryDay;
  selected: boolean;
  canRest: boolean;
  canRemoveDestination: boolean;
  busy: boolean;
  onSelect: () => void;
  /** Driving days only — a rest day's date is wherever the stay puts it. */
  onDateChange: (date: string) => void;
  onNoteChange: (text: string) => void;
  onToggleDone: () => void;
  onAddRest: () => void;
  onRemoveRest: () => void;
  onInsertCity: (place: Place) => void;
  onRemoveCity: () => void;
  onAddSideTrip: (place: Place) => void;
  onRemoveSideTrip: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note);
  const [adding, setAdding] = useState<null | "city" | "side">(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const rest = entry.kind === "rest";
  // Where the day leaves you standing. Every action on the row is about it.
  const here = rest ? entry.stop : entry.to;

  // A stay's note belongs to the place, so it is written once on the first
  // night rather than repeated on every night of the same stay.
  const ownsNote = !rest || entry.nth === 1;
  const noteFor = rest ? here.name : `day ${entry.day}`;

  function save() {
    setEditing(false);
    if (draft.trim() !== entry.note) onNoteChange(draft);
  }

  return (
    <li
      className={`plan-day${selected ? " selected" : ""}${rest ? " is-rest" : ""}${
        entry.done ? " done" : ""
      }`}
    >
      <div className="plan-day-head">
        <span className="plan-day-n">Day {entry.day}</span>

        {rest ? (
          <>
            <span className="plan-date static">{calendarDay(entry.date)}</span>
            <span className="badge warn">
              {entry.of > 1 ? `night ${entry.nth}/${entry.of}` : "rest"}
            </span>
          </>
        ) : (
          /* Committing on change rather than on blur: a native date picker IS
             the confirmation step, so there is nothing left to confirm. */
          <input
            type="date"
            className="plan-date"
            value={entry.date}
            onChange={(e) => {
              if (e.target.value) onDateChange(e.target.value);
            }}
            aria-label={`Date for day ${entry.day}, currently ${calendarDay(entry.date)}`}
          />
        )}

        <button
          className={`done-toggle${entry.done ? " on" : ""}`}
          onClick={onToggleDone}
          aria-pressed={entry.done}
        >
          {entry.done ? "✓ " : ""}
          {rest ? "Done" : "Driven"}
        </button>
      </div>

      <button className="plan-day-body" onClick={onSelect} aria-pressed={selected}>
        <span className="plan-day-route">
          {rest ? here.name : `${entry.from.name} → ${entry.to.name}`}
        </span>

        <span className="plan-day-meta">
          {rest ? (
            "No driving"
          ) : (
            <>
              {entry.drive.miles} mi · {driveTime(entry.drive.minutes)}
              {entry.drive.estimated && <span className="plan-est"> est.</span>}
            </>
          )}
        </span>

        {!rest && entry.drive.via && (
          <span className="plan-day-via">via {entry.drive.via}</span>
        )}
      </button>

      {entry.sideTrips.length > 0 && (
        <ul className="side-list">
          {entry.sideTrips.map((t) => (
            <li key={t.id} className="side-trip">
              <span className="side-name">↳ {t.name}</span>
              <span className="side-meta">
                {t.miles} mi · {driveTime(t.minutes)} round trip
              </span>
              <button
                className="plan-rest-btn remove side-remove"
                onClick={() => onRemoveSideTrip(t.id)}
                aria-label={`Remove the side trip to ${t.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Tap the text to edit, blur to save, Escape to abandon — the same
          edit-in-place pattern as renaming a trip. Enter inserts a newline
          here, so blur is the only commit. */}
      {ownsNote && editing && (
        <textarea
          className="plan-note-input"
          value={draft}
          autoFocus
          rows={3}
          maxLength={MAX_NOTE}
          placeholder={`Notes for ${noteFor}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(entry.note);
              setEditing(false);
            }
          }}
        />
      )}

      {ownsNote && !editing && entry.note && (
        <button
          className="plan-note"
          onClick={() => {
            setDraft(entry.note);
            setEditing(true);
          }}
        >
          {entry.note}
        </button>
      )}

      {adding === "city" && (
        <PlaceSearch
          placeholder={`City between ${entry.kind === "drive" ? entry.from.name : here.name} and ${here.name}`}
          onPick={(p) => {
            setAdding(null);
            onInsertCity(p);
          }}
          onCancel={() => setAdding(null)}
        />
      )}

      {adding === "side" && (
        <PlaceSearch
          placeholder={`Side trip from ${here.name}`}
          onPick={(p) => {
            setAdding(null);
            onAddSideTrip(p);
          }}
          onCancel={() => setAdding(null)}
        />
      )}

      <div className="plan-actions">
        {ownsNote && !editing && !entry.note && (
          <button
            className="plan-rest-btn add"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            + note
          </button>
        )}

        {/* Offered on the day that arrives somewhere, which is the only day
            from which lingering there makes sense. The first and last stops
            never get one: leaving later is the departure date, and arriving
            ends the trip. */}
        {!rest && canRest && (
          <button
            className="plan-rest-btn add"
            onClick={onAddRest}
            aria-label={`Add a rest day in ${here.name}`}
          >
            + rest day
          </button>
        )}

        {rest && (
          <button
            className="plan-rest-btn add remove"
            onClick={onRemoveRest}
            aria-label={`Remove a rest night in ${here.name}`}
          >
            − rest day
          </button>
        )}

        {!rest && (
          <>
            <button
              className="plan-rest-btn add"
              onClick={() => setAdding("side")}
              disabled={busy}
              aria-label={`Add a side trip from ${here.name}`}
            >
              + side trip
            </button>

            {/* Splits THIS drive in two. Inserting after the origin is the
                useful reading of "add a city here": the leg you're looking at
                is the one that's too long. */}
            <button
              className="plan-rest-btn add"
              onClick={() => setAdding("city")}
              disabled={busy}
              aria-label={`Add a city between ${entry.from.name} and ${entry.to.name}`}
            >
              + city
            </button>

            {canRemoveDestination && (
              <button
                className="plan-rest-btn add remove"
                onClick={() => {
                  if (confirmRemove) onRemoveCity();
                  else setConfirmRemove(true);
                }}
                onBlur={() => setConfirmRemove(false)}
                disabled={busy}
                aria-label={`Remove ${here.name} from the route`}
              >
                {confirmRemove ? `remove ${here.name}?` : "− city"}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
