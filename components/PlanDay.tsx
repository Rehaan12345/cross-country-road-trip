"use client";

import { useState } from "react";
import { canRestAt, MAX_NOTE, STOPS, type ItineraryDay } from "@/lib/plan";
import { calendarDay } from "@/lib/format";

export default function PlanDayRow({
  entry,
  selected,
  onSelect,
  onDateChange,
  onNoteChange,
  onToggleDone,
  onAddRest,
  onRemoveRest,
}: {
  entry: ItineraryDay;
  selected: boolean;
  onSelect: () => void;
  /** Driving days only — a rest day's date is wherever the stay puts it. */
  onDateChange: (date: string) => void;
  onNoteChange: (text: string) => void;
  onToggleDone: () => void;
  onAddRest: (stop: number) => void;
  onRemoveRest: (stop: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.note);

  const rest = entry.kind === "rest";
  // Where this day leaves you standing, and therefore where a night can be added.
  const stop = rest ? entry.stop : entry.leg.to;

  // A stay's note belongs to the place, so it is written once on the first
  // night rather than repeated on every night of the same stay.
  const ownsNote = !rest || entry.nth === 1;
  const noteFor = rest ? STOPS[entry.stop].name : `day ${entry.day}`;

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
          {rest ? STOPS[entry.stop].name : `${STOPS[entry.leg.from].name} → ${STOPS[entry.leg.to].name}`}
        </span>

        <span className="plan-day-meta">
          {rest ? (
            "No driving"
          ) : (
            <>
              {entry.leg.distance_miles} mi · {entry.leg.drive_time}
              {entry.leg.estimated && <span className="plan-est"> est.</span>}
            </>
          )}
        </span>

        {!rest && entry.leg.via && (
          <span className="plan-day-via">via {entry.leg.via}</span>
        )}
      </button>

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
            from which lingering there makes sense. Boston and Los Angeles never
            get one: leaving later is the departure date, and arriving ends the
            trip. */}
        {!rest && canRestAt(stop) && (
          <button className="plan-rest-btn add" onClick={() => onAddRest(stop)}>
            + rest day in {STOPS[stop].name.split(",")[0]}
          </button>
        )}

        {/* Moved down from the header, which the Done toggle now occupies.
            Being one row away from the date and the tick also makes it that
            much harder to delete a night by mis-tapping. */}
        {rest && (
          <button
            className="plan-rest-btn add remove"
            onClick={() => onRemoveRest(entry.stop)}
          >
            − rest day in {STOPS[entry.stop].name.split(",")[0]}
          </button>
        )}
      </div>
    </li>
  );
}
