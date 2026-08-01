"use client";

import { useState } from "react";

// Tap the title to rename. No modal, no separate edit mode toggle — one tap in,
// blur or Enter to save, Escape to abandon.
export default function TripTitle({
  id,
  label,
  fallback,
}: {
  id: string;
  label: string | null;
  fallback: string;
}) {
  const [value, setValue] = useState(label ?? "");
  const [saved, setSaved] = useState(label ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setEditing(false);
    const next = value.trim();
    if (next === saved) return;

    const res = await fetch(`/api/trips/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: next }),
    });

    if (res.ok) {
      const body = await res.json();
      setSaved(body.label ?? "");
      setValue(body.label ?? "");
      setError("");
    } else {
      setValue(saved); // roll back to what the server still holds
      setError("Could not rename");
    }
  }

  if (editing) {
    return (
      <input
        className="title-input"
        value={value}
        autoFocus
        placeholder={fallback}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(saved);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <>
      <h1 className="title editable" onClick={() => setEditing(true)}>
        {saved || fallback}
        <span className="pencil">✎</span>
      </h1>
      {error && <div className="error">{error}</div>}
    </>
  );
}
