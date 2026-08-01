-- Inserting or removing a city touches two rows: the new stop, and the drive
-- belonging to the stop before it. Doing that as two round trips could leave a
-- stop pointing at a neighbour it no longer has, drawing a line to nowhere, so
-- both live in one transaction here.
--
-- Positions are fractional: inserting between 3 and 4 takes 3.5 and touches no
-- other row, so there is no renumbering pass that could half-apply.

create or replace function route_insert_stop(
  p_prev         uuid,             -- insert immediately after this stop
  p_name         text,
  p_lng          double precision,
  p_lat          double precision,
  p_prev_miles   integer,          -- re-routed drive: previous stop -> new stop
  p_prev_minutes integer,
  p_prev_geom    jsonb,
  p_new_miles    integer,          -- new stop -> the stop that followed
  p_new_minutes  integer,
  p_new_geom     jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_prev_pos double precision;
  v_next_pos double precision;
  v_id       uuid;
begin
  select position into v_prev_pos from route_stops where id = p_prev;
  if v_prev_pos is null then
    raise exception 'unknown stop';
  end if;

  select min(position) into v_next_pos
    from route_stops where position > v_prev_pos;
  if v_next_pos is null then
    raise exception 'cannot insert after the final stop';
  end if;

  insert into route_stops
    (position, name, lng, lat, drive_miles, drive_minutes, drive_geometry)
  values
    ((v_prev_pos + v_next_pos) / 2, p_name, p_lng, p_lat,
     p_new_miles, p_new_minutes, p_new_geom)
  returning id into v_id;

  -- The previous stop's "via" described the old, longer drive. It does not
  -- describe this one, and a stale landmark is worse than none.
  update route_stops
     set drive_miles     = p_prev_miles,
         drive_minutes   = p_prev_minutes,
         drive_geometry  = p_prev_geom,
         drive_via       = null,
         drive_estimated = false
   where id = p_prev;

  return v_id;
end;
$$;


create or replace function route_delete_stop(
  p_id      uuid,
  p_miles   integer,   -- re-routed drive joining the two stops left behind
  p_minutes integer,
  p_geom    jsonb
)
returns void
language plpgsql
as $$
declare
  v_pos      double precision;
  v_prev_id  uuid;
  v_has_next boolean;
begin
  select position into v_pos from route_stops where id = p_id;
  if v_pos is null then
    raise exception 'unknown stop';
  end if;

  select id into v_prev_id
    from route_stops where position < v_pos
    order by position desc limit 1;

  select exists(select 1 from route_stops where position > v_pos) into v_has_next;

  -- The endpoints anchor the trip. Removing one would silently redefine where
  -- the drive starts or ends rather than shortening it.
  if v_prev_id is null or not v_has_next then
    raise exception 'the first and last stops cannot be removed';
  end if;

  delete from route_stops where id = p_id;

  update route_stops
     set drive_miles     = p_miles,
         drive_minutes   = p_minutes,
         drive_geometry  = p_geom,
         drive_via       = null,
         drive_estimated = false
   where id = v_prev_id;
end;
$$;
