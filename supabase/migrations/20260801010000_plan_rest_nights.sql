-- Rest days become data, not structure.
--
-- plan_days stored one date per day, which forced the itinerary's *shape* —
-- which days were rest days — to be hardcoded in the app: a stored date cannot
-- say why two drives are three days apart. It could also describe trips that
-- cannot happen, e.g. two 500-mile drives on the same calendar date.
--
-- What actually varies is when you leave and how long you linger. Store exactly
-- that; derive every date and day number from it (see buildItinerary in
-- lib/plan.ts). Adding a rest day is then `rest_nights + 1` and nothing else in
-- the system has to know.

create table plan_trip (
  -- Single row, enforced by the database: there is one trip.
  id             boolean primary key default true check (id),
  departure_date date not null
);

create table plan_stops (
  -- Index into STOPS in lib/plan.ts. Only stops you arrive at and later leave
  -- from can hold nights, so never Boston (that is the departure date) and
  -- never Los Angeles (arriving there ends the trip).
  stop        smallint primary key check (stop between 1 and 7),
  rest_nights smallint not null default 0 check (rest_nights between 0 and 30)
);


-- Carry across whatever was already in plan_days.
--
-- Day 1 is by definition the departure, so it is the only row that survives
-- translation directly. The rest structure does NOT come from that table: under
-- the old model its dates were always consecutive and *which* days were rest
-- days lived in application code, so the equivalent plan is the one-night stays
-- in Chicago (stop 2) and at the Grand Canyon (stop 6) that code described.
--
-- On a fresh database plan_days is empty — it was only ever seeded lazily on
-- first read — so both inserts no-op and the app seeds from DEFAULT_PLAN
-- instead. Either path lands on a valid plan.
insert into plan_trip (id, departure_date)
select true, plan_date from plan_days where day = 1;

insert into plan_stops (stop, rest_nights)
select * from (values (2::smallint, 1::smallint), (6::smallint, 1::smallint)) as v
where exists (select 1 from plan_days);

drop table plan_days;
