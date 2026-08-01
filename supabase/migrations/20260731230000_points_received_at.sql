-- `recorded_at` comes from the phone's own clock (OwnTracks `tst`). That is the
-- right timestamp for the route and for distance, but the wrong one for the
-- "last ping" health indicator, which asks when we last HEARD from the recorder.
--
-- Two ways they diverge:
--   * phone clock skew -> a fresh ping can appear to arrive in the future
--   * dead-zone replay -> pings recorded an hour ago arrive all at once now
--
-- received_at is server-assigned, so it answers the health question honestly.

alter table points add column received_at timestamptz not null default now();

-- Existing rows would otherwise all claim to have arrived at migration time,
-- which would show a dead recorder as healthy exactly once.
update points set received_at = recorded_at;

create index on points (received_at);
