-- How far along the trip you are.
--
-- Stored as a position, not as a set of ticked days. Progress on a road trip is
-- monotonic — leg 5 starts where leg 4 ended, so finishing 5 before 3 is not a
-- thing that can happen. A boolean per day could record it anyway; two counters
-- cannot.
--
-- Counted in legs and nights rather than days, for the same reason notes are
-- keyed to legs and stops: a day number is derived, so "6 days done" would
-- quietly mean something else the moment a rest night is added ahead of you.

alter table plan_trip
  add column done_legs   smallint not null default 0 check (done_legs between 0 and 8),
  -- Nights completed at the stop those legs left you standing in.
  add column done_nights smallint not null default 0 check (done_nights between 0 and 30);
