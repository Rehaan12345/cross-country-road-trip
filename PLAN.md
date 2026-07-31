# Cross-Country Drive Tracker — Build Plan

Single-user, mobile-first web app that records driving trips and accumulates a
cross-country route map. "Strava for driving," minus the social layer.

---

## 0. The core architectural decision

**Recording happens in a background-capable app. The website does everything else.**

A browser cannot record GPS in the background. iOS Safari suspends JS on screen
lock or app switch, killing `watchPosition`. Any PWA-only recorder loses data the
first time you open a navigation app — which, on this trip, is constantly.

### Recommended architecture

```
[OwnTracks app on phone]
        │  HTTPS POST, every ~30s while moving
        ▼
[POST /api/ingest]  ── auth via shared secret header
        │
        ▼
[Postgres + PostGIS]  ── points, trips
        │
        ▼
[Next.js mobile UI]  ── start/stop, live trip, daily map, cumulative map
```

The site's **Start/Stop** button does not start the GPS. It flips a server-side
`active_trip` flag. Pings arriving while a trip is open are bound to that trip;
pings arriving otherwise are stored unassigned (cheap insurance — you can
retroactively build a trip from them if you forget to press Start).

That decoupling is the whole trick: the recorder never has to know about trips,
and the site never has to fight the browser sandbox.

### Rejected alternatives

| Option | Why not |
|---|---|
| PWA + `watchPosition` + Screen Wake Lock | Only works with the app foregrounded and screen on. Breaks the moment you open Maps. Fine as a *supplement*, not the system of record. |
| Capacitor / native wrapper | Solves background tracking, but you asked for a website and this adds App Store provisioning, a build toolchain, and device debugging for one user. |
| Strava / Gaia / Arc as recorder | Strava's API is rate-limited, review-gated, and hostile to driving activities. Arc is iOS-only with no push API. |
| Traccar (self-hosted server) | Good protocol support, but you'd run a Java server and still build the UI. OwnTracks gives the same phone-side capability with a plain HTTP endpoint. |

---

## 1. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (App Router) | One deployable: API routes + mobile UI. Server Components keep client JS small on cellular. |
| Ingest | Supabase Edge Function | Day 1 needs no web framework. One vendor, one deploy, HTTPS included. |
| UI hosting | Vercel (Day 2+) | Free tier covers one user. Not on the Day 1 critical path. |
| Database | Supabase Postgres + **PostGIS** | Geospatial types and distance math in the DB, not in app code. Free tier is far beyond this workload. |
| Map | **MapLibre GL JS** | Open source (your requirement), vector tiles, smooth on mobile. |
| Basemap tiles | MapTiler or Stadia free tier | Free tiers cover single-user volume. Swappable — MapLibre is not tied to a vendor. |
| Recorder | **OwnTracks** (iOS/Android) | Open source, background-capable, HTTP mode posts JSON to any endpoint. |
| Auth | Single shared secret + Supabase RLS | One user. Do not build a login system. |

**No LLM calls anywhere in this system.** Every computation here — distance,
segmentation, filtering, summarization — is deterministic geometry. If a model
call appears in this codebase, something has gone wrong.

---

## 2. Data model

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE trips (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  status       text NOT NULL DEFAULT 'active',  -- active | closed
  -- denormalized stats, computed once on close:
  distance_m   double precision,
  duration_s   integer,
  moving_s     integer,
  max_speed_ms double precision,
  point_count  integer
);

CREATE TABLE points (
  id          bigserial PRIMARY KEY,
  trip_id     uuid REFERENCES trips(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL,
  geog        geography(Point, 4326) NOT NULL,
  accuracy_m  real,
  speed_ms    real,
  altitude_m  real,
  battery     smallint,
  source      text NOT NULL DEFAULT 'owntracks',
  raw         jsonb,
  UNIQUE (recorded_at, source)   -- idempotent ingest; OwnTracks retries on flaky signal
);

CREATE INDEX ON points USING GIST (geog);
CREATE INDEX ON points (trip_id, recorded_at);
```

`UNIQUE (recorded_at, source)` matters more than it looks. OwnTracks queues and
replays pings when it loses signal — which, crossing Nevada, is often. Without
it you get duplicate points and inflated mileage.

---

## 3. Distance calculation — get this right or nothing else matters

Raw GPS traces overstate distance. Stationary jitter alone can invent miles over
a day of gas stops. The pipeline is a deterministic filter chain:

1. **Drop** points with `accuracy_m > 50`.
2. **Drop** points implying speed > 55 m/s (~123 mph) from the previous kept point — GPS glitch, not you.
3. **Drop** consecutive points < 15 m apart — parked-car jitter.
4. **Sum** `ST_Distance` between surviving consecutive points (geography type = true geodesic meters).
5. **Moving time** = sum of inter-point intervals where the segment speed > 1 m/s.

Encode this as one SQL function, `compute_trip_stats(trip_id)`, called on trip
close. Not app code — it belongs next to the data.

**Success threshold, defined now:** on a test drive with a known odometer
reading, computed distance must land within **2%**. If it doesn't, the filter
constants are wrong and get tuned *before* the real trip, not during it.

**Deferred:** map matching (snapping the trace to actual roads via OSRM or
Valhalla). It improves how the line *looks* on tight interchanges more than it
improves distance accuracy. Revisit only if the raw trace looks visibly wrong.

---

## 4. Screens (mobile-first, thumb-reachable)

1. **Home / Now** — one big Start/Stop button. While active: elapsed time, live
   distance, current speed, last-ping timestamp. That last one is the honest
   health indicator — if pings stopped 20 minutes ago, you need to know before
   you've lost a state.
2. **Trip detail** — route polyline on the map, distance, duration, moving vs.
   stopped, speed profile, start/end place names.
3. **The Journey** — cumulative map of every trip, day markers, running total
   miles. This is the artifact you'll actually want at the end.
4. **Trip list** — reverse-chronological, one row per day.

Design constraints: dark map style (night driving), text legible in direct
sunlight, all primary controls in the bottom third of the screen, every view
usable one-handed.

---

## 5. Build schedule — 3 days to departure

**Departure: 3 days out. The only hard deadline is working ingest.**

Everything else is a passenger-seat project. Views, stats, and the Journey map
can all be built from the road *provided raw points are already accumulating in
Postgres with accurate timestamps*. The one thing that cannot be recovered later
is the data itself.

This drives one design rule that buys back the entire schedule:

> **Store raw, compute derived.** Every ping's full JSON payload goes into
> `points.raw` from the first minute. Distance, moving time, and trip stats are
> derived by a re-runnable SQL function. Filter constants can therefore be tuned
> *after* the trip against real recorded data — the 2% accuracy threshold in §3
> is no longer a pre-departure blocker.

Because raw payloads are captured from minute one, the Phase 0 spike and Phase 1
ingest **collapse into a single step**. No throwaway console-logging endpoint;
the real endpoint is the spike.

### Day 1 — Ingest live, validated on a real drive (the only critical path)

Supabase only. No Next.js, no Vercel, no UI today — one vendor and one deploy
keeps the critical path short. The site framework arrives Day 2, when it's
actually needed.

Full runbook with verification steps: **`DAY1.md`**.

- Supabase project, enable PostGIS, run the `points` migration
  (`supabase/migrations/20260731120000_points.sql`, applied via `supabase db push`).
- Deploy the `ingest` Edge Function (`supabase/functions/ingest/index.ts`):
  shared-secret auth, idempotent upsert, full payload into `raw`. Permissive
  validation — store anything that parses, never reject a ping for an
  unexpected field.
- Configure OwnTracks on the **iPhone**, HTTP mode, `Always` location
  permission, **Move** tracking mode, pointed at production.
- **Drive 20–30 minutes today.** Highway stretch, a stop, and critically: run
  Google Maps in the foreground for part of it, lock the screen for another part.
- Inspect the real data and answer, with evidence not assumption:
  - Actual ping interval at highway speed?
  - Did pings survive backgrounding, screen lock, and foregrounded Google Maps?
  - Dead-signal stretch — replay or permanent loss?
  - Battery drain per hour?
  - What fields does the payload actually contain?

**If this fails, escalate the contingency ladder in §6 the same day.** Two days
is not enough to recover from discovering this on Day 3.

### Day 2 — Trip lifecycle + minimum viable screen
- `POST /api/trips/start` and `/stop`; bind incoming pings to the open trip.
- `compute_trip_stats()` SQL function.
- Home screen: Start/Stop button, elapsed time, live distance, and a prominent
  **last-ping age** indicator. That indicator is the single most important
  element in the app before departure — it's how you learn the recorder died
  while there's still road left to re-record.

### Day 3 — Insurance, not features
- `GET /api/export` returning all points as GeoJSON. Hit it every few days from
  the road. This is the real backup; Supabase free-tier backup guarantees are
  not something to stake an unrepeatable dataset on.
- Verify unassigned-ping capture works (pings with no open trip still persist).
- Deploy check, env vars, secret rotation, phone bookmarked to home screen.
- **Buffer.** Do not start new features on Day 3.

### From the road — in whatever order you want them
- Trip detail view with MapLibre route polyline.
- The Journey: cumulative map, day markers, running mileage total.
- Trip list.
- Backfill tool: construct a trip from unassigned points when you forget Start.
- Distance filter tuning against real recorded data (§3).
- Manual outlier deletion.

Explicitly out of scope: offline support, photos, social features, multi-user,
native app, map matching.

### Cut without hesitation if Day 1 slips
Trip lifecycle. A day's driving reconstructed later from timestamped raw points
is nearly as good as one recorded against an explicit trip — the backfill tool
closes that gap. Ingest is not similarly recoverable. If you must choose, ship
ingest and press no buttons at all.

---

## 6. Open risks

| Risk | Mitigation |
|---|---|
| Recorder dies mid-trip and you don't notice | Last-ping-age indicator on the home screen; consider a push alert past 15 min of silence during an active trip. |
| Cell dead zones lose points | OwnTracks queues and replays; the unique constraint makes replay safe. Verify in Phase 0. |
| Forgetting to press Start | Unassigned points are still stored. Phase 5 backfill tool recovers the trip. |
| Free-tier tile limits | Single user won't approach them, but keep the MapLibre style URL in config so switching providers is a one-line change. |
| Battery drain | Measured on the Day 1 drive. Car charger is the answer; confirm the number first. |

### Contingency ladder if OwnTracks fails the Day 1 drive

Escalate in order. Each rung reuses the same schema and the same site — only the
recorder changes, which is exactly why the recorder was decoupled in §0.

1. **Traccar Client** — different open-source app, same architecture. Posts
   plain HTTP to a custom endpoint. Adapt `/api/ingest` to its payload shape;
   roughly an hour of work, no redesign.
2. **Commercial recorder + import** — a proven consumer app (Gaia GPS, Arc)
   records to its own storage; you export GPX periodically and import via a
   `POST /api/import` endpoint. Loses live tracking, preserves the data. This is
   the floor: it guarantees the trip is recorded even if nothing else works.
3. **Capacitor wrapper** — correct long-term fix, **not viable in 3 days**. Do
   not attempt it before departure. Revisit from the road only if rungs 1 and 2
   both prove unacceptable.

With 3 days, rung 2 is a legitimate outcome, not a failure. A recorded trip with
a clunky import step beats an elegant architecture that lost Wyoming.

---

## 7. What would falsify this plan

Phase 0 is designed to break it cheaply. Specifically, this plan is wrong if:
- OwnTracks does not reliably deliver background pings on your phone/OS version.
- Ping frequency at highway speed is too coarse for a usable route line (> ~60s
  gaps produce visibly wrong polylines through interchanges).
- Computed distance can't be tuned within 2% of odometer truth.

Any of those, and the honest answer is a Capacitor wrapper — which is a
materially larger project and worth knowing before, not after, you start driving.
