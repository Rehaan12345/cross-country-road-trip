"use client";

import { useState } from "react";

export type Place = { name: string; coord: [number, number] };

/**
 * Type a place, pick from what comes back.
 *
 * Deliberately a two-step pick rather than "take the top hit": there are
 * Springfields in thirty-odd states, and silently routing a 500-mile detour to
 * the wrong one is a much worse outcome than one extra tap.
 */
export default function PlaceSearch({
  placeholder,
  onPick,
  onCancel,
}: {
  placeholder: string;
  onPick: (place: Place) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    const q = query.trim();
    if (q.length < 2) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/plan/search?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Lookup failed");
      setPlaces(body.places ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      setPlaces(null);
    }
    setBusy(false);
  }

  return (
    <div className="place-search">
      <div className="place-search-row">
        <input
          className="place-input"
          value={query}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
            if (e.key === "Escape") onCancel();
          }}
        />
        <button className="place-btn" onClick={search} disabled={busy || query.trim().length < 2}>
          {busy ? "…" : "Find"}
        </button>
        <button className="place-btn ghost" onClick={onCancel} aria-label="Cancel">
          ×
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {places?.length === 0 && !busy && <div className="place-empty">Nothing found</div>}

      {places?.map((p) => (
        <button
          key={`${p.name}-${p.coord.join(",")}`}
          className="place-hit"
          onClick={() => onPick(p)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
