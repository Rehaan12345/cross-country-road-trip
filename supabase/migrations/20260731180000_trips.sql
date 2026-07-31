-- Day 2: trip lifecycle.
-- Points remain the source of truth; everything here is derived and re-runnable.

create table trips (
  id           uuid primary key default gen_random_uuid(),
  label        text,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  status       text not null default 'active' check (status in ('active', 'closed')),

  -- Derived by compute_trip_stats(). Null until the trip closes.
  distance_m   double precision,
  duration_s   integer,
  moving_s     integer,
  max_speed_ms double precision,
  point_count  integer
);

-- Exactly one trip may be active. Enforced by the database so a double-tap on
-- Start can't silently create a second open trip.
create unique index one_active_trip on trips (status) where status = 'active';

alter table points add column trip_id uuid references trips(id) on delete set null;
create index on points (trip_id, recorded_at);


-- Bind each incoming point to a trip by WHEN IT WAS RECORDED, not by which trip
-- is open at insert time. OwnTracks replays queued pings after signal loss, so a
-- point arriving now may belong to a trip that closed twenty minutes ago.
create or replace function bind_point_to_trip()
returns trigger
language plpgsql
as $$
begin
  select id into new.trip_id
  from trips
  where started_at <= new.recorded_at
    and (ended_at is null or new.recorded_at <= ended_at)
  order by started_at desc
  limit 1;
  return new;
end;
$$;

create trigger points_bind_trip
  before insert on points
  for each row execute function bind_point_to_trip();


-- Distance and timing for a trip. Pure function of stored points, so it can be
-- re-run with different constants after the fact — which is exactly how the
-- filter thresholds get tuned once real driving data exists.
--
-- p_max_accuracy_m : discard points the device itself flags as imprecise
-- p_max_speed_ms   : 55 m/s ~= 123 mph. Above this is a GPS glitch, not a car.
-- p_min_move_m     : below this, treat a segment as stationary jitter.
--
-- NOTE on p_min_move_m: this skips short segments rather than dropping points
-- and re-measuring from the last kept one. The sequential version is more
-- correct in principle but needs a recursive CTE; the practical cost here is
-- undercounting genuine crawling movement (below ~1 m/s), i.e. stop-and-go
-- traffic. Revisit only if a real trip shows the error.
create or replace function compute_trip_stats(
  p_trip_id          uuid,
  p_max_accuracy_m   double precision default 50,
  p_max_speed_ms     double precision default 55,
  p_min_move_m       double precision default 15
)
returns void
language sql
as $$
  with clean as (
    select recorded_at, geog
    from points
    where trip_id = p_trip_id
      and (accuracy_m is null or accuracy_m <= p_max_accuracy_m)
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
  ),
  agg as (
    select
      coalesce((select sum(d_m) from kept), 0)                              as distance_m,
      coalesce((select sum(dt_s) from kept where speed_ms > 1), 0)::integer as moving_s,
      (select max(speed_ms) from kept)                                      as max_speed_ms,
      (select count(*) from points where trip_id = p_trip_id)::integer      as point_count
  )
  update trips t
  set distance_m   = agg.distance_m,
      duration_s   = extract(epoch from coalesce(t.ended_at, now()) - t.started_at)::integer,
      moving_s     = agg.moving_s,
      max_speed_ms = agg.max_speed_ms,
      point_count  = agg.point_count
  from agg
  where t.id = p_trip_id;
$$;
