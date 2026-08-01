// The planned route: Boston -> Los Angeles, and whatever you turn it into.
//
// THE MODEL
//
// A route is an ordered list of stops. Each stop carries the drive to the NEXT
// one, so a leg has no identity of its own to keep in sync — insert a city and
// only its two neighbours' drives change. The final stop carries no drive.
//
// Everything a day is made of is derived by buildItinerary(): the calendar
// dates, the day numbers, the length of the trip, and which days are behind
// you. The only stored things are the departure date, the stops, how many
// nights you spend at each, and how far along you are.
//
// WHY IDS AND NOT INDEXES
//
// Earlier versions keyed notes to a stop index and counted progress in legs,
// which was safe only while the route was a hardcoded constant. The moment a
// city can be inserted, every index after it shifts and all of those keys
// silently point at a different place. So stops carry uuids that never move,
// and notes, rest nights, side trips and progress all hang off those.
//
// The same reasoning that keeps day numbers derived rather than stored, applied
// one level down.

export type Drive = {
  miles: number;
  minutes: number;
  via: string | null;
  /** Drive time is a guess rather than a routed figure. */
  estimated: boolean;
  /** [lng, lat] road geometry, fetched once when the stop was added. */
  geometry: [number, number][];
};

/**
 * An out-and-back excursion from a stop.
 *
 * It adds mileage and time but not a day, and it never touches the chain —
 * that is the whole difference between a side trip and inserting a city.
 */
export type SideTrip = {
  id: string;
  name: string;
  coord: [number, number];
  miles: number;
  minutes: number;
  geometry: [number, number][];
};

export type RouteStop = {
  id: string;
  name: string;
  coord: [number, number]; // [lng, lat]
  restNights: number;
  /** About the place. */
  note: string;
  /** About the drive out of here. Meaningless on the last stop. */
  driveNote: string;
  /** The drive to the next stop. Null on the last stop only. */
  drive: Drive | null;
  sideTrips: SideTrip[];
};

export type PlanState = {
  /** `yyyy-mm-dd`: the day you pull out of the first stop. */
  departure: string;
  stops: RouteStop[];
  /**
   * The stop you have reached, or null if you haven't left yet, plus the nights
   * completed there. A position rather than a set of ticked days, because
   * progress on a road trip is monotonic: leg 5 starts where leg 4 ended.
   */
  doneStopId: string | null;
  doneNights: number;
};

/** Guards against a typo turning into a thousand-night trip. */
export const MAX_NIGHTS = 30;

/** Long enough for a confirmation number and what to do when you get there. */
export const MAX_NOTE = 500;

/**
 * Where a rest night can be spent: anywhere you arrive and later leave from.
 *
 * Not the first stop — "leave later" is the departure date, not a night off.
 * Not the last — arriving there is the end of the trip.
 */
export const canRestAt = (stops: RouteStop[], i: number) =>
  i >= 1 && i <= stops.length - 2;

/** The endpoints anchor the trip; everything between them can be removed. */
export const canRemoveStop = (stops: RouteStop[], i: number) =>
  i >= 1 && i <= stops.length - 2;

export const indexOfStop = (stops: RouteStop[], id: string | null) =>
  id === null ? -1 : stops.findIndex((s) => s.id === id);

export const driveMiles = (stops: RouteStop[]) =>
  stops.reduce((sum, s) => sum + (s.drive?.miles ?? 0), 0);

export const sideTripMiles = (stops: RouteStop[]) =>
  stops.reduce((sum, s) => sum + s.sideTrips.reduce((n, t) => n + t.miles, 0), 0);

export const totalMinutes = (stops: RouteStop[]) =>
  stops.reduce(
    (sum, s) =>
      sum + (s.drive?.minutes ?? 0) + s.sideTrips.reduce((n, t) => n + t.minutes, 0),
    0,
  );

/** "6h58m", the format the original plan was written in. */
export function driveTime(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

// ---------------------------------------------------------------------------
// Date arithmetic
//
// These are calendar dates, not instants. `new Date("2026-08-09")` parses as
// UTC midnight, so anywhere west of Greenwich it formats as August 8th. Every
// function here works in UTC for exactly that reason, and the display helper
// pins the timezone too.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromEpochDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * `yyyy-mm-dd`, a real calendar date, and somewhere a road trip could plausibly
 * happen. The round trip through epoch days is what rejects 2026-02-31, which
 * the regex alone waves through.
 */
export function isValidPlanDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  if (fromEpochDay(toEpochDay(value)) !== value) return false;

  const year = Number(value.slice(0, 4));
  return year >= 2020 && year <= 2100;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export type ItineraryDay =
  | {
      day: number;
      date: string;
      note: string;
      done: boolean;
      /** Excursions from the stop this day first puts you at. */
      sideTrips: SideTrip[];
      kind: "drive";
      from: RouteStop;
      to: RouteStop;
      drive: Drive;
    }
  | {
      day: number;
      date: string;
      note: string;
      done: boolean;
      sideTrips: SideTrip[];
      kind: "rest";
      stop: RouteStop;
      /** "night 2 of 3" — so consecutive nights at one place read as a stay. */
      nth: number;
      of: number;
    };

const nightsAtIndex = (stops: RouteStop[], i: number) =>
  canRestAt(stops, i)
    ? Math.min(MAX_NIGHTS, Math.max(0, Math.trunc(stops[i].restNights)))
    : 0;

/**
 * Expand the plan into the day-by-day itinerary.
 *
 * One drive, then however many nights are booked where it landed, then the next
 * drive. Because dates only ever advance by one, the result is always ordered
 * and never double-books a day — an out-of-order itinerary is not a state this
 * function can produce, which is why nothing downstream validates one.
 */
export function buildItinerary(state: PlanState): ItineraryDay[] {
  const { stops } = state;
  const days: ItineraryDay[] = [];
  if (stops.length < 2) return days;

  const donePos = indexOfStop(stops, state.doneStopId);
  let epoch = toEpochDay(state.departure);
  let day = 1;

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    if (!from.drive) continue;

    days.push({
      day: day++,
      date: fromEpochDay(epoch++),
      note: from.driveNote,
      done: i + 1 <= donePos,
      // A stop's excursions are listed on the first day you are there. The very
      // first drive also carries the origin's, which has no arrival day.
      sideTrips: i === 0 ? [...from.sideTrips, ...to.sideTrips] : to.sideTrips,
      kind: "drive",
      from,
      to,
      drive: from.drive,
    });

    const of = nightsAtIndex(stops, i + 1);
    for (let nth = 1; nth <= of; nth++) {
      days.push({
        day: day++,
        date: fromEpochDay(epoch++),
        note: to.note,
        // Nights at a stop you have already driven out of are behind you by
        // definition; nights where you're sitting depend on the count.
        done: i + 1 < donePos || (i + 1 === donePos && nth <= state.doneNights),
        sideTrips: [],
        kind: "rest",
        stop: to,
        nth,
        of,
      });
    }
  }

  return days;
}

// ---------------------------------------------------------------------------
// Edits. All pure: they take a plan and return a new one.
// ---------------------------------------------------------------------------

function patchStop(state: PlanState, id: string, patch: Partial<RouteStop>): PlanState {
  return { ...state, stops: state.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/**
 * Pull the progress position back into range.
 *
 * Deleting rest nights — or the stop you were standing in — can strand
 * `doneNights` past the end of a stay that no longer exists, so every edit that
 * touches the nights or the chain runs through here.
 */
function clampProgress(state: PlanState): PlanState {
  const pos = indexOfStop(state.stops, state.doneStopId);
  if (pos < 0) {
    return state.doneStopId === null && state.doneNights === 0
      ? state
      : { ...state, doneStopId: null, doneNights: 0 };
  }

  const ceiling = nightsAtIndex(state.stops, pos);
  const doneNights = Math.min(ceiling, Math.max(0, Math.trunc(state.doneNights)));
  return doneNights === state.doneNights ? state : { ...state, doneNights };
}

export const setDeparture = (state: PlanState, date: string): PlanState => ({
  ...state,
  departure: date,
});

export function setNights(state: PlanState, id: string, nights: number): PlanState {
  const i = indexOfStop(state.stops, id);
  if (i < 0 || !canRestAt(state.stops, i)) return state;

  const restNights = Math.min(MAX_NIGHTS, Math.max(0, Math.trunc(nights)));
  return clampProgress(patchStop(state, id, { restNights }));
}

// Removing a night deliberately leaves the stop's note behind: a mis-tap must
// not cost you a hotel confirmation, and re-adding a night brings it back.
export const addRest = (state: PlanState, id: string) => {
  const s = state.stops.find((x) => x.id === id);
  return s ? setNights(state, id, s.restNights + 1) : state;
};

export const removeRest = (state: PlanState, id: string) => {
  const s = state.stops.find((x) => x.id === id);
  return s ? setNights(state, id, s.restNights - 1) : state;
};

const trimNote = (text: string) => text.trim().slice(0, MAX_NOTE);

export const setStopNote = (state: PlanState, id: string, text: string) =>
  patchStop(state, id, { note: trimNote(text) });

export const setDriveNote = (state: PlanState, id: string, text: string) =>
  patchStop(state, id, { driveNote: trimNote(text) });

/**
 * Mark a day finished, or unfinish it.
 *
 * Because progress is a position rather than a set, ticking a day implies every
 * day before it and unticking implies every day after — which is what actually
 * happens on a drive. Both directions move exactly one day at the frontier:
 * unfinishing a drive puts you back at the end of the previous stop's nights,
 * not at the start of them.
 */
export function toggleDone(state: PlanState, entry: ItineraryDay): PlanState {
  const { stops } = state;

  if (entry.kind === "drive") {
    const j = indexOfStop(stops, entry.to.id);
    if (j < 0) return state;

    if (!entry.done) {
      return clampProgress({ ...state, doneStopId: entry.to.id, doneNights: 0 });
    }
    // Stepping back off the first drive is "not started", not "arrived at the
    // stop you began in" — those render identically but only one is true.
    return clampProgress(
      j - 1 <= 0
        ? { ...state, doneStopId: null, doneNights: 0 }
        : {
            ...state,
            doneStopId: stops[j - 1].id,
            doneNights: nightsAtIndex(stops, j - 1),
          },
    );
  }

  return clampProgress({
    ...state,
    doneStopId: entry.stop.id,
    doneNights: entry.done ? entry.nth - 1 : entry.nth,
  });
}

/**
 * Move a driving day to a new date.
 *
 * The first drive is the departure itself. Any later one is reached by changing
 * how long you linger at the stop immediately before it — which is the only
 * thing that could actually delay it. Pulling a drive earlier than the day
 * after the previous one would mean two long drives on one date, so it is
 * refused rather than silently clamped.
 */
export function setDriveDate(
  state: PlanState,
  fromStopId: string,
  date: string,
): { ok: true; state: PlanState } | { ok: false; error: string } {
  if (!isValidPlanDate(date)) return { ok: false, error: "Not a real date" };

  const i = indexOfStop(state.stops, fromStopId);
  if (i < 0) return { ok: false, error: "Unknown stop" };
  if (i === 0) return { ok: true, state: setDeparture(state, date) };

  const current = buildItinerary(state).find(
    (d) => d.kind === "drive" && d.from.id === fromStopId,
  );
  if (!current) return { ok: false, error: "Unknown stop" };

  const delta = toEpochDay(date) - toEpochDay(current.date);
  if (delta === 0) return { ok: true, state };

  const waiting = state.stops[i]; // where you'd be waiting
  const next = waiting.restNights + delta;

  if (next < 0) {
    return { ok: false, error: `That would leave ${waiting.name} before arriving` };
  }
  if (next > MAX_NIGHTS) {
    return { ok: false, error: `Over ${MAX_NIGHTS} nights in one place` };
  }

  return { ok: true, state: setNights(state, waiting.id, next) };
}

// ---------------------------------------------------------------------------
// The write payload
//
// Only the fields you can change by typing. Names, coordinates and geometry are
// set by the server when a stop is added and are never sent back up, so a
// client cannot corrupt them — and the PUT stays a few hundred bytes rather
// than carrying every vertex of the road.
// ---------------------------------------------------------------------------

export type PlanEdits = {
  departure: string;
  doneStopId: string | null;
  doneNights: number;
  stops: { id: string; restNights: number; note: string; driveNote: string }[];
};

export const toEdits = (state: PlanState): PlanEdits => ({
  departure: state.departure,
  doneStopId: state.doneStopId,
  doneNights: state.doneNights,
  stops: state.stops.map((s) => ({
    id: s.id,
    restNights: s.restNights,
    note: s.note,
    driveNote: s.driveNote,
  })),
});

/** Narrow unknown JSON into an edit payload, or reject it. Used by the API. */
export function parsePlanEdits(value: unknown): PlanEdits | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;

  if (!isValidPlanDate(v.departure)) return null;
  if (!Array.isArray(v.stops)) return null;
  if (v.doneStopId !== null && typeof v.doneStopId !== "string") return null;
  if (!Number.isInteger(v.doneNights)) return null;

  const doneNights = v.doneNights as number;
  if (doneNights < 0 || doneNights > MAX_NIGHTS) return null;

  const stops: PlanEdits["stops"] = [];
  for (const raw of v.stops) {
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Record<string, unknown>;

    if (typeof s.id !== "string" || !s.id) return null;
    if (!Number.isInteger(s.restNights)) return null;
    if ((s.restNights as number) < 0 || (s.restNights as number) > MAX_NIGHTS) return null;
    if (typeof s.note !== "string" || typeof s.driveNote !== "string") return null;

    stops.push({
      id: s.id,
      restNights: s.restNights as number,
      // Trimmed and truncated rather than rejected: a long paste should lose
      // its tail, not the whole edit.
      note: trimNote(s.note),
      driveNote: trimNote(s.driveNote),
    });
  }

  return {
    departure: v.departure,
    doneStopId: (v.doneStopId as string | null) ?? null,
    doneNights,
    stops,
  };
}
