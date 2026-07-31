-- Route geometry as GeoJSON, simplified in the database so the phone downloads
-- a few KB instead of every raw ping.
--
-- p_tolerance is in degrees: 0.00005 ~= 5.5m, below GPS noise at driving speed,
-- so the line looks identical while shedding most of the vertices.

create or replace function trip_route(
  p_trip_id   uuid,
  p_tolerance double precision default 0.00005
)
returns jsonb
language sql
stable
as $$
  select st_asgeojson(
           st_simplify(st_makeline(geog::geometry order by recorded_at), p_tolerance)
         )::jsonb
  from points
  where trip_id = p_trip_id
    and (accuracy_m is null or accuracy_m <= 50);
$$;


-- The cumulative map. One line per trip, collected into a MultiLineString —
-- NOT one continuous line, which would draw a straight seam from where you
-- stopped one evening to where you started the next morning.
create or replace function journey_route(
  p_tolerance double precision default 0.00005
)
returns jsonb
language sql
stable
as $$
  select st_asgeojson(st_collect(line))::jsonb
  from (
    select st_simplify(st_makeline(geog::geometry order by recorded_at), p_tolerance) as line
    from points
    where trip_id is not null
      and (accuracy_m is null or accuracy_m <= 50)
    group by trip_id
    having count(*) >= 2   -- st_makeline needs two points to make a line
  ) per_trip;
$$;
