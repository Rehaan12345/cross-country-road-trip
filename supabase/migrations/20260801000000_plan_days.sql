-- The planned itinerary's dates, and nothing else.
--
-- Every other fact about the plan — the route, the mileage, the drive times,
-- the coordinates — is fixed and lives in lib/plan.ts. Only the dates move, so
-- only the dates are stored. A wider table would let the itinerary in the
-- database drift from the itinerary in the code, with no way to tell which was
-- right.
--
-- Seeding is done by the API on first read, from DEFAULT_DATES in lib/plan.ts,
-- so the defaults have exactly one definition and "Reset dates" restores the
-- same values a fresh install would get.

create table plan_days (
  day       smallint primary key check (day between 1 and 10),
  plan_date date not null
);
