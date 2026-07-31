# Day 1 Runbook — ingest live, validated on a real drive

**Goal:** points land in durable storage and survive a real drive.
Nothing else ships today. See `PLAN.md` §5 for why this is the only hard deadline.

Each step has a verification. Don't advance on a step you haven't verified.

---

## Where each command goes

| Block | Run it in |
|---|---|
| Anything in ```sql``` | Supabase dashboard → **SQL Editor** → New query |
| Anything in ```bash``` | **Terminal on your Mac**, from this project directory |

---

## Step 0 — Install and connect the CLI (terminal)

Only needed once. The `supabase` command does not exist until you install it.

```bash
brew install supabase/tap/supabase
supabase login          # opens a browser to authorize
```

Then link this directory to your project. `<project-ref>` is the string in your
dashboard URL (`https://supabase.com/dashboard/project/<project-ref>`), and it
will prompt for your database password:

```bash
cd ~/Development/cross-country-drive-26
supabase link --project-ref <project-ref>
```

**Verify:**

```bash
supabase projects list   # your project should show as linked
```

---

## Step 1 — Database

1. Create a free Supabase project. Note the project ref, URL, and service-role key
   (dashboard → Project Settings → API).
2. Apply the migration from the terminal — the linked directory means the CLI
   pushes `supabase/migrations/` straight to the remote database:

```bash
supabase db push
```

Using migrations rather than pasting into the SQL Editor keeps a versioned
history, which matters once the `trips` table lands on Day 2.

**Verify** — paste into the SQL Editor:

```sql
insert into points (device, recorded_at, lat, lon, raw)
values ('test', now(), 34.0522, -118.2437, '{}'::jsonb);

select device, lat, lon, st_astext(geog) from points where device = 'test';
-- expect: POINT(-118.2437 34.0522)

delete from points where device = 'test';
```

If `geog` is null or the migration errored on the generated column, stop and say so —
the fallback is a `before insert` trigger doing the same derivation.

---

## Step 2 — Ingest endpoint

```bash
supabase functions deploy ingest --no-verify-jwt
supabase secrets set INGEST_SECRET="<generate a long random string>"
```

`--no-verify-jwt` is required: OwnTracks won't send a Supabase JWT. Our own
shared secret is the auth boundary.

**Verify** — three checks, all must pass:

```bash
URL="https://<project-ref>.supabase.co/functions/v1/ingest"
SECRET="<the secret you set>"

# 1. Correct secret → 200, and a row appears
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL?secret=$SECRET" \
  -H 'content-type: application/json' \
  -d '{"_type":"location","tid":"test","tst":1753900000,"lat":34.05,"lon":-118.24,"acc":8,"batt":91}'
# expect 200

# 2. Wrong secret → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL?secret=wrong" \
  -H 'content-type: application/json' -d '{"_type":"location","tst":1,"lat":0,"lon":0}'
# expect 401

# 3. Same payload again → still exactly 1 row (idempotency)
```

```sql
select count(*) from points where device = 'test';  -- expect 1, not 2
delete from points where device = 'test';
```

---

## Step 3 — OwnTracks on the iPhone

Install OwnTracks from the App Store. In settings:

- **Mode:** HTTP
- **URL:** `https://<project-ref>.supabase.co/functions/v1/ingest?secret=<secret>`
- **Location permission:** **Always** (not "While Using"). Background tracking
  is impossible without this — iOS will silently stop delivering updates.
- **Background App Refresh:** on, for OwnTracks.
- **Tracking mode:** **Move**, not "Significant Changes."

On "Significant Changes": iOS only wakes the app on cell-tower transitions,
which on a highway can mean kilometres between points. The route line would be
straight segments cutting across terrain. Move mode is the only viable option
for a usable trace, and its cost is battery — which is what the test drive measures.

> Setting names and defaults shift between OwnTracks versions, and I can't verify
> the current iOS build. If a setting above isn't where I said, trust the app.
> The test drive is the arbiter, not this document.

**Verify:** trigger a one-off **publish / send-now** to force a ping — this is an
action, not the "Manual" tracking mode, which would disable automatic reporting.
Then:

```sql
select recorded_at, lat, lon, accuracy_m, battery
from points order by recorded_at desc limit 5;
```

Expect at least one row, with:

| Column | Healthy value | Red flag |
|---|---|---|
| `recorded_at` | within the last few minutes, year 2026 | a 1970 date → `tst` conversion is wrong |
| `lat` / `lon` | matches where you're sitting | **positive longitude in the US → lat/lon swapped** |
| `accuracy_m` | 5–20 outdoors, 50–100 indoors | consistently null |
| `battery` | integer 0–100 | null is acceptable |

Don't wait passively for pings while stationary — iOS throttles location hard
when you aren't moving, so one ping and then silence is normal here and is not a
failure. Whether that throttling persists at speed is what Step 4 answers.

### If zero rows appear

Check dashboard → Edge Functions → `ingest` → Logs:

| Logs show | Diagnosis |
|---|---|
| `ping ...` lines, no DB rows | insert failing — read the `insert failed` line after it |
| 401 responses | secret in the URL ≠ `INGEST_SECRET` |
| `skip _type ...` | reaching us fine, but it wasn't a location message; publish again |
| no invocations at all | phone never reached us — URL typo, not in HTTP mode, or permission isn't `Always` |

---

## Step 4 — The real test drive (the actual point of Day 1)

~30 minutes. The point is not "drive around and look at the data" — gaps are
meaningless unless you know which condition caused them. **Attribution is the
whole test**, so run it in defined phases and record when each one starts.

### Before pulling out

- Confirm tracking mode is **Move**. It stays there for the whole drive.
- Trigger a one-off **publish / send-now** as a pre-flight check, and confirm the
  row lands. This is the "publish now" *action*, **not** the "Manual" *tracking
  mode* — selecting Manual mode disables automatic reporting and would void the
  entire test.
- Note **odometer** and **battery %**.
- Start a voice memo — the safest way to capture transition times.

**Then don't open OwnTracks again until the drive is over.** Foregrounding the
app grants it a fresh activity window from iOS, which is the exact advantage
phase D is meant to test surviving without. Publishing before each phase would
make the results look better than reality.

### The four phases

Every transition except one happens while parked. The one in-motion action is
pressing the lock button. **Do not set up navigation while driving.**

| Phase | Setup | Duration | What it proves |
|---|---|---|---|
| **A — Baseline** | OwnTracks open on screen, phone mounted | ~5 min | Sanity check; if this fails nothing else matters |
| **B — Backgrounded** | Press lock button, screen off | ~10 min, include highway | Survives suspension; ping interval at 70mph |
| **C — Parked** | Pull over, engine off, don't touch the phone | ~3 min | Stationary jitter — fake mileage from a gas stop |
| **D — Maps navigating** | While still parked, start Google Maps navigation, then drive | ~10 min, include highway | **The decisive test** |

Record five times: **T0** start · **T1** lock screen · **T2** park ·
**T3** depart with Maps · **T4** finish. Odometer and battery % again at T4.

### Verify — attribute every gap to a phase

Paste your five timestamps in, adjusting `-07` to your UTC offset:

```sql
with g as (
  select recorded_at,
         extract(epoch from recorded_at - lag(recorded_at) over (order by recorded_at)) as gap_s
  from points
),
phases(name, t0, t1) as (values
  ('A foreground', timestamptz '2026-07-31 15:00:00-07', timestamptz '2026-07-31 15:05:00-07'),
  ('B locked',     timestamptz '2026-07-31 15:05:00-07', timestamptz '2026-07-31 15:15:00-07'),
  ('C parked',     timestamptz '2026-07-31 15:15:00-07', timestamptz '2026-07-31 15:18:00-07'),
  ('D maps nav',   timestamptz '2026-07-31 15:18:00-07', timestamptz '2026-07-31 15:28:00-07')
)
select ph.name,
       count(g.*)          as pings,
       round(avg(g.gap_s)) as avg_gap_s,
       round(max(g.gap_s)) as max_gap_s
from phases ph
left join g on g.recorded_at >= ph.t0 and g.recorded_at < ph.t1
group by ph.name, ph.t0
order by ph.t0;
```

```sql
-- Raw trace distance, unfiltered. Compare against odometer.
-- The ::numeric cast is required — two-arg round() has no double precision overload.
select round((st_length(st_makeline(geog::geometry order by recorded_at)::geography) / 1609.34)::numeric, 2) as raw_miles
from points;
```

### Reading the result

**The single number that matters is `max_gap_s` for phase D.**

- **Under ~60s in every phase** → architecture holds. Proceed to Day 2.
- **Phase D degrades badly while A and B are fine** → iOS is suspending
  OwnTracks under Maps. This is the most likely failure and the reason the test
  exists. Escalate `PLAN.md` §6 **today**.
- **`pings = 0` in any phase** → hard stop, not a tuning problem.
- **Phase C shows movement, or `raw_miles` exceeds odometer** → expected. That's
  jitter; it's a filter-tuning problem and fixable from the road, because raw
  points are stored.
- **Battery drain per hour** = (start % − end %) ÷ hours elapsed. If it's brutal,
  that's a car-charger problem, not an architecture problem — but know the
  number before you depend on it.

---

## Given iOS, one piece of cheap insurance

For the first day or two of the actual drive, also run a proven consumer
recorder (Gaia GPS, Arc) in parallel. Costs one app install and one button press,
and it means a Day-1 iOS surprise doesn't lose you the first state. Drop it once
OwnTracks has proven itself over real distance.
