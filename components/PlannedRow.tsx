"use client";

import Link from "next/link";
import { miles, duration, calendarDay } from "@/lib/format";

export type Planned = {
  id: string;
  day: number;
  date: string;
  label: string;
  distance_m: number;
  duration_s: number;
};

/**
 * A day marked driven that the recorder missed.
 *
 * It counts toward the journey exactly like a recorded trip — that is the point
 * of marking one. Kept as its own row rather than a variant of TripRow because
 * there are no points behind it to rename, delete, or open; the badge says
 * where the mileage came from, not that it counts for less.
 */
export default function PlannedRow({ planned }: { planned: Planned }) {
  return (
    <Link href="/route" className="row planned">
      <div className="row-main">
        <div className="row-title">{planned.label}</div>
        <div className="row-sub">
          {calendarDay(planned.date)} · day {planned.day}
          <span className="badge plan">no GPS</span>
        </div>
      </div>

      <div className="row-stat">
        <span className="row-miles">{miles(planned.distance_m)}</span>
        <span className="unit">mi</span>
        <div className="row-sub">{duration(planned.duration_s)}</div>
      </div>
    </Link>
  );
}
