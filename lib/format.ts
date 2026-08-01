// All formatting happens client-side, in the device's timezone. That's deliberate:
// you're crossing time zones, and a trip should read in the local time where it
// was driven, not in the server's UTC.

export const miles = (meters: number | null) =>
  ((meters ?? 0) / 1609.34).toFixed(1);

// H:MM:SS for a running trip — seconds matter when you're watching it tick.
export function stopwatch(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function duration(seconds: number | null) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

// A `yyyy-mm-dd` calendar date, not an instant. It must be pinned to UTC: the
// string parses as UTC midnight, so anywhere west of Greenwich the default
// local formatting renders it as the day before.
export const calendarDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
