-- The home screen polls stats for the in-progress trip. That must not write.
-- Split the calculation into a read-only function; compute_trip_stats now just
-- persists its result on trip close. One definition of the filter chain, two uses.

create or replace function trip_stats(
  p_trip_id        uuid,
  p_max_accuracy_m double precision default 50,
  p_max_speed_ms   double precision default 55,
  p_min_move_m     double precision default 15
)
returns table (
  distance_m   double precision,
  moving_s     integer,
  max_speed_ms double precision,
  point_count  integer
)
language sql
stable
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
  )
  select
    coalesce((select sum(d_m) from kept), 0),
    coalesce((select sum(dt_s) from kept where speed_ms > 1), 0)::integer,
    (select max(speed_ms) from kept),
    (select count(*) from points where trip_id = p_trip_id)::integer;
$$;


create or replace function compute_trip_stats(
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
      duration_s   = extract(epoch from coalesce(t.ended_at, now()) - t.started_at)::integer,
      moving_s     = s.moving_s,
      max_speed_ms = s.max_speed_ms,
      point_count  = s.point_count
  from trip_stats(p_trip_id, p_max_accuracy_m, p_max_speed_ms, p_min_move_m) s
  where t.id = p_trip_id;
$$;
