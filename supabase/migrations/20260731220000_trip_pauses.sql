-- Pausing a trip.
--
-- The recorder keeps sending pings regardless — we don't control OwnTracks — so
-- a pause that only froze the on-screen timer would be cosmetic. A pause here
-- excludes the span from the trip: its duration is subtracted, and any points
-- recorded inside it are dropped from distance and from the drawn route.

create table trip_pauses (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  paused_at  timestamptz not null default now(),
  resumed_at timestamptz
);

-- At most one open pause per trip, enforced by the database rather than by the UI.
create unique index one_open_pause on trip_pauses (trip_id) where resumed_at is null;

create index on trip_pauses (trip_id);

alter table trips add column paused_s integer;


-- Return type changes, so both functions are dropped and recreated.
-- compute_trip_stats is dropped first because it depends on trip_stats.
drop function if exists compute_trip_stats(uuid, double precision, double precision, double precision);
drop function if exists trip_stats(uuid, double precision, double precision, double precision);


create function trip_stats(
  p_trip_id        uuid,
  p_max_accuracy_m double precision default 50,
  p_max_speed_ms   double precision default 55,
  p_min_move_m     double precision default 15
)
returns table (
  distance_m   double precision,
  moving_s     integer,
  max_speed_ms double precision,
  point_count  integer,
  paused_s     integer
)
language sql
stable
as $$
  with clean as (
    select p.recorded_at, p.geog
    from points p
    where p.trip_id = p_trip_id
      and (p.accuracy_m is null or p.accuracy_m <= p_max_accuracy_m)
      -- Drop anything recorded while the trip was paused.
      and not exists (
        select 1
        from trip_pauses tp
        where tp.trip_id = p_trip_id
          and p.recorded_at >= tp.paused_at
          and p.recorded_at <= coalesce(tp.resumed_at, now())
      )
  ),
  seg as (
    select
      extract(epoch from recorded_at - lag(recorded_at) over w) as dt_s,
      st_distance(geog, lag(geog) over w)                       as d_m
    from clean
    window w as (order by recorded_at)
  ),
  kept as (
    select dt_s, d_m, d_m / dt_s as speed_ms
    from seg
    where dt_s > 0
      and d_m is not null
      and d_m / dt_s <= p_max_speed_ms
      and d_m >= p_min_move_m
  )
  select
    coalesce((select sum(d_m) from kept), 0),
    coalesce((select sum(dt_s) from kept where speed_ms > 1), 0)::integer,
    (select max(speed_ms) from kept),
    (select count(*) from clean)::integer,
    coalesce((
      select sum(extract(epoch from coalesce(tp.resumed_at, now()) - tp.paused_at))
      from trip_pauses tp
      where tp.trip_id = p_trip_id
    ), 0)::integer;
$$;


create function compute_trip_stats(
  p_trip_id        uuid,
  p_max_accuracy_m double precision default 50,
  p_max_speed_ms   double precision default 55,
  p_min_move_m     double precision default 15
)
returns void
language sql
as $$
  update trips t
  set distance_m   = s.distance_m,
      -- Wall-clock span minus everything spent paused.
      duration_s   = greatest(
                       0,
                       extract(epoch from coalesce(t.ended_at, now()) - t.started_at)::integer - s.paused_s
                     ),
      moving_s     = s.moving_s,
      max_speed_ms = s.max_speed_ms,
      point_count  = s.point_count,
      paused_s     = s.paused_s
  from trip_stats(p_trip_id, p_max_accuracy_m, p_max_speed_ms, p_min_move_m) s
  where t.id = p_trip_id;
$$;


-- The drawn route must match the stats: skip points recorded during a pause,
-- so a lunch stop doesn't leave a stray hook on the map.
create or replace function trip_route(
  p_trip_id   uuid,
  p_tolerance double precision default 0.00005
)
returns jsonb
language sql
stable
as $$
  select st_asgeojson(
           st_simplify(st_makeline(p.geog::geometry order by p.recorded_at), p_tolerance)
         )::jsonb
  from points p
  where p.trip_id = p_trip_id
    and (p.accuracy_m is null or p.accuracy_m <= 50)
    and not exists (
      select 1
      from trip_pauses tp
      where tp.trip_id = p_trip_id
        and p.recorded_at >= tp.paused_at
        and p.recorded_at <= coalesce(tp.resumed_at, now())
    );
$$;


create or replace function journey_route(
  p_tolerance double precision default 0.00005
)
returns jsonb
language sql
stable
as $$
  select st_asgeojson(st_collect(line))::jsonb
  from (
    select st_simplify(st_makeline(p.geog::geometry order by p.recorded_at), p_tolerance) as line
    from points p
    where p.trip_id is not null
      and (p.accuracy_m is null or p.accuracy_m <= 50)
      and not exists (
        select 1
        from trip_pauses tp
        where tp.trip_id = p.trip_id
          and p.recorded_at >= tp.paused_at
          and p.recorded_at <= coalesce(tp.resumed_at, now())
      )
    group by p.trip_id
    having count(*) >= 2
  ) per_trip
  where line is not null
    and geometrytype(line) = 'LINESTRING';
$$;
