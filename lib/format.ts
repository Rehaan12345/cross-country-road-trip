// All formatting happens client-side, in the device's timezone. That's deliberate:
// you're crossing time zones, and a trip should read in the local time where it
// was driven, not in the server's UTC.

export const miles = (meters: number | null) =>
  ((meters ?? 0) / 1609.34).toFixed(1);

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

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
