-- Human-readable endpoints, resolved once and stored.
--
-- Cached rather than looked up per page view: reverse geocoding is an external
-- network call, and a trip's endpoints never change once it closes. Storing the
-- result also means the trip log still reads correctly with no signal.

alter table trips add column start_place text;
alter table trips add column end_place   text;
