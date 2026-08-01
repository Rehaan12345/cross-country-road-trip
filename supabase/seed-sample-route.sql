-- Sample trip: Boston -> Chicago along the I-90 / I-80 corridor.
--
-- Deliberately NOT a migration. This is demo data, not schema, and it should
-- never end up in the migration history that runs against a fresh database.
--
-- Two properties that keep it from contaminating real data:
--   * device = 'sample'    -> one predicate deletes every trace of it
--   * dated 2026-07-24     -> in the past, so max(recorded_at) still comes from
--                             your real pings and the "Last ping" health
--                             indicator on the Now screen stays honest
--
-- Remove it completely with:
--   delete from trips  where label = 'Sample — Boston to Chicago';
--   delete from points where device = 'sample';

begin;

-- Interpolate along the highway corridor rather than a straight line, so the
-- route bends through the cities you'd actually drive through.
with waypoints as (
  select st_setsrid(st_makeline(array[
    st_makepoint(-71.0589, 42.3601),  -- Boston, MA
    st_makepoint(-71.4162, 42.2793),  -- Framingham, MA
    st_makepoint(-71.8023, 42.2626),  -- Worcester, MA
    st_makepoint(-72.5898, 42.1015),  -- Springfield, MA
    st_makepoint(-73.2493, 42.3043),  -- Lee, MA
    st_makepoint(-73.7562, 42.6526),  -- Albany, NY
    st_makepoint(-74.1885, 42.9384),  -- Amsterdam, NY
    st_makepoint(-75.2327, 43.1009),  -- Utica, NY
    st_makepoint(-76.1474, 43.0481),  -- Syracuse, NY
    st_makepoint(-77.6088, 43.1566),  -- Rochester, NY
    st_makepoint(-78.1875, 43.0000),  -- Batavia, NY
    st_makepoint(-78.8784, 42.8864),  -- Buffalo, NY
    st_makepoint(-79.3339, 42.4795),  -- Dunkirk, NY
    st_makepoint(-80.0851, 42.1292),  -- Erie, PA
    st_makepoint(-80.7898, 41.8651),  -- Ashtabula, OH
    st_makepoint(-81.6944, 41.4993),  -- Cleveland, OH
    st_makepoint(-82.7079, 41.4489),  -- Sandusky, OH
    st_makepoint(-83.5379, 41.6528),  -- Toledo, OH
    st_makepoint(-85.9767, 41.6819),  -- Elkhart, IN
    st_makepoint(-86.2520, 41.6764),  -- South Bend, IN
    st_makepoint(-87.3464, 41.5934),  -- Gary, IN
    st_makepoint(-87.6298, 41.8781)   -- Chicago, IL
  ]), 4326) as line
),
meta as (
  -- One point roughly every 800m ~= a 30s ping interval at 60mph, which matches
  -- the cadence OwnTracks actually produces.
  select line,
         greatest(1, ceil(st_length(line::geography) / 800.0))::int as n
  from waypoints
)
insert into points (device, recorded_at, lat, lon, accuracy_m, vel, battery, raw)
select
  'sample',
  timestamptz '2026-07-24 06:00:00-04' + (g.i * interval '30 seconds'),
  st_y(q.p),
  st_x(q.p),
  8,
  26.8,
  (100 - (g.i::double precision * 45 / m.n))::smallint,
  jsonb_build_object('_type', 'location', 'sample', true)
from meta m
cross join generate_series(0, m.n) as g(i)
cross join lateral (
  select st_lineinterpolatepoint(m.line, g.i::double precision / m.n) as p
) q;

-- Build the trip from the points, so started_at/ended_at match exactly and the
-- reported duration is real rather than guessed.
insert into trips (label, started_at, ended_at, status)
select 'Sample — Boston to Chicago', min(recorded_at), max(recorded_at), 'closed'
from points
where device = 'sample';

-- The binding trigger only fires on insert, and the trip didn't exist yet.
update points p
set trip_id = t.id
from trips t
where t.label = 'Sample — Boston to Chicago'
  and p.device = 'sample';

select compute_trip_stats(id)
from trips
where label = 'Sample — Boston to Chicago';

commit;

-- Expect roughly 1,000 miles and ~16-17 hours.
select label,
       point_count,
       round((distance_m / 1609.34)::numeric, 1) as miles,
       round((duration_s / 3600.0)::numeric, 1)  as hours,
       round((max_speed_ms * 2.237)::numeric, 1) as max_mph
from trips
where label = 'Sample — Boston to Chicago';
