-- Notes, hung off the parts of the plan that don't move.
--
-- Not keyed by day number. A day number is derived from the departure date and
-- the rest nights before it, so inserting one night early on renumbers
-- everything after — a note filed under "day 8" would silently reattach itself
-- to a different place. Legs and stops are stable, so notes live on those and
-- survive every date and rest-day edit.
--
-- A stop's note covers the whole stay, however many nights it runs to, and it
-- outlives the nights themselves: deleting the last rest night in Chicago hides
-- the note rather than dropping it, so a mis-tap can't cost a confirmation
-- number.

create table plan_legs (
  -- Index into LEGS in lib/plan.ts. The route is fixed at eight drives.
  leg  smallint primary key check (leg between 1 and 8),
  note text not null default ''
);

alter table plan_stops add column note text not null default '';
