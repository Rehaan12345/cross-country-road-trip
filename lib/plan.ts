// The planned route: Boston -> Los Angeles.
//
// THE MODEL
//
// The route is a fixed sequence of nine stops joined by eight driving legs.
// That is the part that doesn't move: changing it would mean a different trip
// and different road geometry. What moves is *when you leave* and *how many
// nights you spend at each stop*.
//
// So the entire editable plan is two things:
//
//     departure date  +  nights[stop]
//
// and every calendar date, every day number, and the length of the trip are
// derived from them by buildItinerary(). Nothing about a rest day is stored
// except the count of nights at a place — there is no rest-day record to add,
// delete, or keep in sync.
//
// WHY NOT STORE A DATE PER DAY
//
// The earlier version did, and it had to hardcode which days were rest days,
// because a stored date can't say *why* two driving days are three days apart.
// That model could also represent itineraries that cannot happen: pulling day 5
// back onto day 4's date put two 500-mile drives on one calendar day, and no
// validation rule catches that without re-deriving the very structure this
// model makes explicit. Here, a gap between drives simply IS a night somewhere,
// dates are always ordered by construction, and "add a rest day" is `nights + 1`.

export type Stop = {
  name: string;
  coord: [number, number]; // [lng, lat], geocoded once — never looked up at runtime
};

export const STOPS: Stop[] = [
  { name: "Boston, MA", coord: [-71.0589, 42.3601] },
  { name: "Niagara Falls, NY", coord: [-79.0377, 43.0962] },
  { name: "Chicago, IL", coord: [-87.6298, 41.8781] },
  { name: "Kansas City, MO", coord: [-94.5786, 39.0997] },
  { name: "Aurora, CO", coord: [-104.8319, 39.7294] },
  { name: "Torrey, UT", coord: [-111.4194, 38.3] },
  { name: "Grand Canyon, AZ", coord: [-112.1401, 36.0544] },
  { name: "Las Vegas, NV", coord: [-115.1398, 36.1699] },
  { name: "Los Angeles, CA", coord: [-118.2437, 34.0522] },
];

export type Leg = {
  /** 1-based, and the key into LEG_GEOMETRY. */
  leg: number;
  from: number; // index into STOPS
  to: number;
  distance_miles: number;
  drive_time: string;
  via?: string | null;
  /** Drive time is a guess rather than a routed figure. */
  estimated?: boolean;
};

export const LEGS: Leg[] = [
  { leg: 1, from: 0, to: 1, distance_miles: 474, drive_time: "6h58m", via: "Buffalo, NY (US-only routing)" },
  { leg: 2, from: 1, to: 2, distance_miles: 558, drive_time: "8h13m", via: "Cleveland, OH (US-only routing)" },
  { leg: 3, from: 2, to: 3, distance_miles: 511, drive_time: "7h15m", via: null },
  { leg: 4, from: 3, to: 4, distance_miles: 596, drive_time: "7h59m", via: null },
  { leg: 5, from: 4, to: 5, distance_miles: 460, drive_time: "7h55m", via: "I-70 W through Glenwood Canyon and Eisenhower Tunnel", estimated: true },
  { leg: 6, from: 5, to: 6, distance_miles: 410, drive_time: "8h15m", via: "Bryce Canyon National Park (Scenic Byway 12)", estimated: true },
  { leg: 7, from: 6, to: 7, distance_miles: 279, drive_time: "4h11m", via: null },
  { leg: 8, from: 7, to: 8, distance_miles: 270, drive_time: "4h05m", via: null },
];

/**
 * Where a rest night can be spent: anywhere you arrive and later leave from.
 *
 * Not Boston — "leave later" is the departure date, not a night off. Not Los
 * Angeles — arriving there is the end of the trip, and a night after the end is
 * not part of it.
 */
export const canRestAt = (stop: number) => stop >= 1 && stop <= STOPS.length - 2;

export const REST_STOPS = STOPS.map((_, i) => i).filter(canRestAt);

/** Guards against a typo turning into a thousand-night trip. */
export const MAX_NIGHTS = 30;

/** Long enough for a confirmation number and what to do when you get there. */
export const MAX_NOTE = 500;

export type PlanState = {
  /** `yyyy-mm-dd`: the day you pull out of Boston. */
  departure: string;
  /** Nights spent at each stop, keyed by index into STOPS. Absent means zero. */
  rests: Record<number, number>;
  /**
   * Notes, keyed by leg number and by stop index — never by day number.
   *
   * A day number is derived: insert a rest night early on and day 8 becomes a
   * different place entirely, so a note filed under "day 8" would silently
   * reattach itself to the wrong row. Legs and stops are the things that don't
   * move, so notes hang off those and survive every date and rest-day edit.
   *
   * A stop's note covers the whole stay, however many nights it runs to.
   */
  legNotes: Record<number, string>;
  stopNotes: Record<number, string>;

  /**
   * How much of the trip is behind you: legs completed, then nights completed
   * at the stop those legs left you standing in.
   *
   * Progress is stored as a position, not as a set of ticked days, because
   * progress on a road trip is monotonic — you cannot finish leg 5 before leg 3
   * when leg 5 starts where leg 4 ended. A set of booleans could hold
   * "5 done, 3 not", which is not a thing that can happen; a position cannot.
   *
   * Counted in legs and nights rather than days for the usual reason: day
   * numbers are derived, so "6 days done" would quietly mean something else the
   * moment a rest night is added ahead of you.
   */
  doneLegs: number;
  doneNights: number;
};

// The plan as it arrived: one night in Chicago, one at the Grand Canyon,
// nothing driven yet. These are only defaults — the whole point of this file is
// that they aren't special.
export const DEFAULT_PLAN: PlanState = {
  departure: "2026-08-09",
  rests: { 2: 1, 6: 1 },
  legNotes: {},
  stopNotes: {},
  doneLegs: 0,
  doneNights: 0,
};

export const TOTAL_MILES = LEGS.reduce((s, l) => s + l.distance_miles, 0);

export const TOTAL_DRIVE_MINUTES = LEGS.reduce((s, l) => {
  const m = /^(\d+)h(\d+)m$/.exec(l.drive_time);
  return s + (m ? Number(m[1]) * 60 + Number(m[2]) : 0);
}, 0);

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

export const nightsAt = (state: PlanState, stop: number) =>
  Math.min(MAX_NIGHTS, Math.max(0, Math.trunc(state.rests[stop] ?? 0)));

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export type ItineraryDay =
  | { day: number; date: string; note: string; done: boolean; kind: "drive"; leg: Leg }
  | {
      day: number;
      date: string;
      /** The stay's note, repeated on each of its nights. */
      note: string;
      done: boolean;
      kind: "rest";
      stop: number;
      /** "night 2 of 3" — so consecutive nights at one place read as a stay. */
      nth: number;
      of: number;
    };

/** The stop you are standing in after completing `legs` drives. */
export const stopAfter = (legs: number) =>
  legs <= 0 ? 0 : LEGS[Math.min(legs, LEGS.length) - 1].to;

/**
 * Pull the progress position back into range.
 *
 * Deleting rest nights can strand `doneNights` past the end of a stay that no
 * longer exists, so every edit that touches the nights runs through here.
 */
function clampProgress(state: PlanState): PlanState {
  const doneLegs = Math.min(LEGS.length, Math.max(0, Math.trunc(state.doneLegs)));
  const stop = stopAfter(doneLegs);
  const ceiling = canRestAt(stop) ? nightsAt(state, stop) : 0;
  const doneNights = Math.min(ceiling, Math.max(0, Math.trunc(state.doneNights)));

  return doneLegs === state.doneLegs && doneNights === state.doneNights
    ? state
    : { ...state, doneLegs, doneNights };
}

/**
 * Expand the plan into the day-by-day itinerary.
 *
 * One drive, then however many nights are booked where it landed, then the next
 * drive. Because dates only ever advance by one, the result is always ordered
 * and never double-books a day — an out-of-order itinerary is not a state this
 * function can produce, which is why nothing downstream validates one.
 */
export function buildItinerary(state: PlanState): ItineraryDay[] {
  const days: ItineraryDay[] = [];
  let epoch = toEpochDay(state.departure);
  let day = 1;

  for (const leg of LEGS) {
    days.push({
      day: day++,
      date: fromEpochDay(epoch++),
      note: state.legNotes[leg.leg] ?? "",
      done: leg.leg <= state.doneLegs,
      kind: "drive",
      leg,
    });

    if (!canRestAt(leg.to)) continue;
    const of = nightsAt(state, leg.to);
    for (let nth = 1; nth <= of; nth++) {
      days.push({
        day: day++,
        date: fromEpochDay(epoch++),
        note: state.stopNotes[leg.to] ?? "",
        // Nights at a stop you have already driven out of are behind you by
        // definition; nights at the stop you're sitting in depend on the count.
        done:
          leg.leg < state.doneLegs ||
          (leg.leg === state.doneLegs && nth <= state.doneNights),
        kind: "rest",
        stop: leg.to,
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

export function setDeparture(state: PlanState, date: string): PlanState {
  return { ...state, departure: date };
}

export function setNights(state: PlanState, stop: number, nights: number): PlanState {
  if (!canRestAt(stop)) return state;

  const n = Math.min(MAX_NIGHTS, Math.max(0, Math.trunc(nights)));
  const rests = { ...state.rests };

  // Drop the key rather than storing a zero, so a plan with no rest days is
  // literally `{}` and two equal plans compare equal.
  if (n === 0) delete rests[stop];
  else rests[stop] = n;

  return clampProgress({ ...state, rests });
}

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
  if (entry.kind === "drive") {
    const leg = entry.leg.leg;
    return clampProgress(
      entry.done
        ? { ...state, doneLegs: leg - 1, doneNights: nightsAt(state, stopAfter(leg - 1)) }
        : { ...state, doneLegs: leg, doneNights: 0 },
    );
  }

  const arriving = LEGS.find((l) => l.to === entry.stop);
  if (!arriving) return state;

  return clampProgress({
    ...state,
    doneLegs: arriving.leg,
    doneNights: entry.done ? entry.nth - 1 : entry.nth,
  });
}

export const addRest = (state: PlanState, stop: number) =>
  setNights(state, stop, nightsAt(state, stop) + 1);

// Deliberately leaves the stop's note behind. Removing the last night in
// Chicago hides the note, it does not shred it — a mis-tap must not cost you a
// hotel confirmation, and re-adding a night brings it straight back.
export const removeRest = (state: PlanState, stop: number) =>
  setNights(state, stop, nightsAt(state, stop) - 1);

function withNote(
  notes: Record<number, string>,
  key: number,
  text: string,
): Record<number, string> {
  const next = { ...notes };
  const trimmed = text.trim().slice(0, MAX_NOTE);

  // An empty note is the absence of a note, not a note of length zero.
  if (trimmed) next[key] = trimmed;
  else delete next[key];

  return next;
}

export const setLegNote = (state: PlanState, leg: number, text: string): PlanState =>
  LEGS.some((l) => l.leg === leg)
    ? { ...state, legNotes: withNote(state.legNotes, leg, text) }
    : state;

export const setStopNote = (state: PlanState, stop: number, text: string): PlanState =>
  canRestAt(stop)
    ? { ...state, stopNotes: withNote(state.stopNotes, stop, text) }
    : state;

/**
 * Move a driving day to a new date.
 *
 * Leg 1 is the departure itself. Any later leg is reached by changing how long
 * you linger at the stop immediately before it — which is the only thing that
 * could actually delay it. Pulling a drive earlier than the day after the
 * previous one would mean two long drives on one date, so it is refused rather
 * than silently clamped: the itinerary you're shown is always one you could
 * physically do.
 */
export function setDriveDate(
  state: PlanState,
  leg: number,
  date: string,
): { ok: true; state: PlanState } | { ok: false; error: string } {
  if (!isValidPlanDate(date)) return { ok: false, error: "Not a real date" };

  const target = LEGS.find((l) => l.leg === leg);
  if (!target) return { ok: false, error: "Unknown leg" };

  if (leg === LEGS[0].leg) return { ok: true, state: setDeparture(state, date) };

  const current = buildItinerary(state).find(
    (d) => d.kind === "drive" && d.leg.leg === leg,
  );
  if (!current) return { ok: false, error: "Unknown leg" };

  const delta = toEpochDay(date) - toEpochDay(current.date);
  if (delta === 0) return { ok: true, state };

  const stop = target.from; // where you'd be waiting
  const next = nightsAt(state, stop) + delta;

  if (next < 0) {
    return {
      ok: false,
      error: `That would leave ${STOPS[stop].name} before arriving`,
    };
  }
  if (next > MAX_NIGHTS) {
    return { ok: false, error: `Over ${MAX_NIGHTS} nights in one place` };
  }

  return { ok: true, state: setNights(state, stop, next) };
}

// Notes are free text, so they are trimmed and truncated rather than rejected —
// a long paste should lose its tail, not the whole edit. The key still has to
// name something real.
function parseNotes(
  value: unknown,
  valid: (key: number) => boolean,
): Record<number, string> | null {
  if (typeof value !== "object" || value === null) return null;

  const notes: Record<number, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const k = Number(key);
    if (!Number.isInteger(k) || !valid(k)) return null;
    if (typeof raw !== "string") return null;

    const trimmed = raw.trim().slice(0, MAX_NOTE);
    if (trimmed) notes[k] = trimmed;
  }
  return notes;
}

/** Narrow unknown JSON into a plan, or reject it. Used by the API on write. */
export function parsePlanState(value: unknown): PlanState | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as {
    departure?: unknown;
    rests?: unknown;
    legNotes?: unknown;
    stopNotes?: unknown;
    doneLegs?: number;
    doneNights?: number;
  };

  if (!isValidPlanDate(v.departure)) return null;
  if (typeof v.rests !== "object" || v.rests === null) return null;

  const rests: Record<number, number> = {};
  for (const [key, raw] of Object.entries(v.rests as Record<string, unknown>)) {
    const stop = Number(key);
    if (!Number.isInteger(stop) || !canRestAt(stop)) return null;
    if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
    if (raw < 0 || raw > MAX_NIGHTS) return null;
    if (raw > 0) rests[stop] = raw;
  }

  const legNotes = parseNotes(v.legNotes ?? {}, (k) => LEGS.some((l) => l.leg === k));
  const stopNotes = parseNotes(v.stopNotes ?? {}, canRestAt);
  if (!legNotes || !stopNotes) return null;

  const doneLegs = v.doneLegs ?? 0;
  const doneNights = v.doneNights ?? 0;
  if (!Number.isInteger(doneLegs) || !Number.isInteger(doneNights)) return null;
  if (doneLegs < 0 || doneLegs > LEGS.length) return null;
  if (doneNights < 0 || doneNights > MAX_NIGHTS) return null;

  // Clamped rather than rejected: a position past the end of a stay is stale,
  // not malicious — it is what a client holds after deleting a rest night.
  return clampProgress({
    departure: v.departure,
    rests,
    legNotes,
    stopNotes,
    doneLegs: doneLegs as number,
    doneNights: doneNights as number,
  });
}
