-- st_collect() returns GEOMETRYCOLLECTION if the inputs aren't all the same
-- type, and MapLibre cannot render a GeometryCollection — it silently draws
-- nothing. ST_Simplify can also return null or a degenerate geometry for a
-- very short trip, which is enough to change the collection's type.
--
-- Keep only genuine LINESTRINGs so the result is always a MULTILINESTRING.

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
    having count(*) >= 2
  ) per_trip
  where line is not null
    and geometrytype(line) = 'LINESTRING';
$$;
