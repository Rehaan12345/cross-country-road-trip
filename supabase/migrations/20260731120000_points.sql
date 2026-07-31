-- Day 1: the only table that matters before departure.
-- Trips, stats, and views come later; raw points cannot be recreated.

create extension if not exists postgis;

create table points (
  id          bigserial primary key,
  device      text not null,
  recorded_at timestamptz not null,
  lat         double precision not null,
  lon         double precision not null,

  -- Derived by the database, not the app. Deterministic and re-runnable.
  geog        geography(Point, 4326)
              generated always as (st_setsrid(st_makepoint(lon, lat), 4326)::geography) stored,

  accuracy_m  real,
  altitude_m  real,
  vel         real,      -- OwnTracks unit (km/h vs m/s) unconfirmed; resolve from test-drive data
  battery     smallint,

  -- Full payload, always. This is what makes every later decision reversible.
  raw         jsonb not null,

  -- OwnTracks queues and replays pings after signal loss. Without this,
  -- replayed pings become duplicate rows and inflate mileage.
  unique (device, recorded_at)
);

create index on points using gist (geog);
create index on points (recorded_at);
