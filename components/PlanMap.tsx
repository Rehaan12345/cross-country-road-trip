"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// maplibre-gl v6 has no default export.
import {
  MapLibreMap,
  LngLatBounds,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LEG_GEOMETRY } from "@/lib/planGeometry";
import { STOPS } from "@/lib/plan";

// Same worker fix as RouteMap: bundlers rewrite MapLibre's `import.meta.url` to
// a `file://` literal, its own `/^https?:/` guard then fails, and the tile
// worker silently never loads — the style still paints its background, so the
// map looks like a black rectangle rather than throwing. See components/RouteMap.tsx.
setWorkerUrl("/ml/maplibre-gl-worker.mjs");

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// MapLibre paint properties can't read CSS custom properties, so the map keeps
// its own palette. Each entry names the globals.css variable it answers to; the
// route greens are brighter than --good because a basemap-legible line needs
// more punch than body text does.
const C = {
  planLine: "#8b929c",   // --muted
  planDone: "#d5dae1",   // between --muted and --text: behind you, still not the GPS trace
  planGlow: "#e8eaed",   // --text, for the selected leg
  driven: "#3dff9a",     // brighter sibling of --good
  casing: "#00120a",
  origin: "#3ddc84",     // --good
  rest: "#f5a623",       // --warn
  final: "#ff5c5c",      // --bad
  stop: "#e8eaed",       // --text
  label: "#e8eaed",
};

const EMPTY = { type: "FeatureCollection" as const, features: [] };

// One LineString per driving leg. Keeping them separate (rather than one line
// for the whole trip) is what lets a single leg be highlighted.
const PLAN_FEATURES = {
  type: "FeatureCollection" as const,
  features: Object.entries(LEG_GEOMETRY).map(([leg, coordinates]) => ({
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates },
    properties: { leg: Number(leg) },
  })),
};

const PLAN_BOUNDS = PLAN_FEATURES.features
  .flatMap((f) => f.geometry.coordinates)
  .reduce(
    (b, c) => b.extend(c as [number, number]),
    new LngLatBounds(STOPS[0].coord, STOPS[0].coord),
  );

export default function PlanMap({
  journey,
  showPlan,
  showDriven,
  rests,
  doneLegs,
  selectedLeg,
  selectedStop,
  onSelectStop,
  className = "map",
}: {
  journey: object | null;
  showPlan: boolean;
  showDriven: boolean;
  /** Nights per stop. Drives which pins read as a stay — nothing is hardcoded. */
  rests: Record<number, number>;
  /** Legs completed. Everything up to here draws solid instead of dashed. */
  doneLegs: number;
  selectedLeg: number | null;
  selectedStop: number | null;
  onSelectStop: (stop: number) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The map is built once and never rebuilt, so its click handler would
  // otherwise capture the first render's callback forever.
  const selectRef = useRef(onSelectStop);
  selectRef.current = onSelectStop;

  // Which pins are stays is derived from the plan, so the markers change the
  // moment a rest night is added or removed.
  const stopFeatures = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: STOPS.map((s, i) => {
        const nights = rests[i] ?? 0;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: s.coord },
          properties: {
            stop: i,
            nights,
            // "Chicago, IL · 2 nights" — the stay is part of the place's name
            // on the map, so the itinerary isn't the only way to see it.
            label: nights > 0 ? `${s.name} · ${nights}n` : s.name,
            kind:
              i === 0 ? "origin"
              : i === STOPS.length - 1 ? "final"
              : nights > 0 ? "rest"
              : "stop",
          },
        };
      }),
    }),
    [rests],
  );

  // The page polls, so `journey` is a fresh object every few seconds even when
  // the route hasn't changed. Key the data effect on content, not identity.
  const journeyKey = useMemo(
    () => (journey ? JSON.stringify(journey) : null),
    [journey],
  );

  useEffect(() => {
    if (!container.current) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: container.current,
        style: MAP_STYLE,
        bounds: PLAN_BOUNDS,
        fitBoundsOptions: { padding: 44 },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Map failed to initialise");
      return;
    }

    mapRef.current = map;

    map.on("error", (e) => {
      const msg = e.error?.message ?? "Map error";
      console.error("[planmap]", msg, e);
      setError(msg);
    });

    map.on("load", () => {
      map.resize();

      map.addSource("plan", { type: "geojson", data: PLAN_FEATURES });
      map.addSource("journey", { type: "geojson", data: EMPTY });
      map.addSource("stops", { type: "geojson", data: EMPTY });

      // Dashed and grey: this is the intention, not the record. The solid green
      // line laid over it is what actually happened, and the two must never be
      // mistaken for each other at a glance.
      map.addLayer({
        id: "plan-casing",
        type: "line",
        source: "plan",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": C.casing,
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 7, 10, 13],
        },
      });

      // Dashed ahead of you, solid behind. Three line states have to stay
      // distinguishable at a glance — plan ahead, plan completed, and the GPS
      // trace — so completed plan goes solid and pale rather than green, which
      // would read as a second recorded route.
      map.addLayer({
        id: "plan",
        type: "line",
        source: "plan",
        filter: [">", ["get", "leg"], 0],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": C.planLine,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 10, 5],
          "line-dasharray": [2.5, 1.6],
        },
      });

      map.addLayer({
        id: "plan-done",
        type: "line",
        source: "plan",
        filter: ["<=", ["get", "leg"], 0],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.planDone,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 10, 6],
        },
      });

      // The selected leg, drawn brighter on top of the dashed plan. Filtered
      // rather than restyled so selection costs one setFilter call.
      map.addLayer({
        id: "plan-selected",
        type: "line",
        source: "plan",
        layout: { "line-cap": "round", "line-join": "round" },
        filter: ["==", ["get", "leg"], -1],
        paint: {
          "line-color": C.planGlow,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 10, 8],
        },
      });

      map.addLayer({
        id: "journey-casing",
        type: "line",
        source: "journey",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.casing,
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 8, 10, 16],
        },
      });

      map.addLayer({
        id: "journey",
        type: "line",
        source: "journey",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.driven,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 10, 9],
        },
      });

      // A stop with nights booked is the largest pin. On a 4,000-mile line the
      // thing you need to find is where you get a night off. How MANY nights is
      // on the label already — encoding it in the radius too would be a second,
      // less legible copy of the same fact.
      map.addLayer({
        id: "stops",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            3, ["case", [">", ["get", "nights"], 0], 8, 5.5],
            10, ["case", [">", ["get", "nights"], 0], 14, 10],
          ],
          "circle-color": [
            "match", ["get", "kind"],
            "origin", C.origin,
            "rest", C.rest,
            "final", C.final,
            C.stop,
          ],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": C.casing,
        },
      });

      // A ring around the selected stop, so tapping a list row is visible on the
      // map even when the leg itself is off-screen.
      map.addLayer({
        id: "stop-selected",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "stop"], -1],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 12, 10, 22],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2,
          "circle-stroke-color": C.planGlow,
        },
      });

      // Place names as map labels rather than tap-to-open popups: a popup on a
      // third-of-a-screen mobile map covers the thing it describes, and text on
      // the map is readable without any interaction at all. MapLibre hides
      // colliding labels on its own at low zoom.
      map.addLayer({
        id: "stop-labels",
        type: "symbol",
        source: "stops",
        layout: {
          "text-field": ["get", "label"],
          // Present in CARTO's glyph set, which this style already loads.
          "text-font": ["Open Sans Bold"],
          "text-size": 11,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": C.label,
          "text-halo-color": C.casing,
          "text-halo-width": 1.6,
        },
      });

      map.on("click", "stops", (e) => {
        const stop = e.features?.[0]?.properties?.stop;
        if (typeof stop === "number") selectRef.current(stop);
      });
      map.on("mouseenter", "stops", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "stops", () => {
        map.getCanvas().style.cursor = "";
      });

      setReady(true);
    });

    // The container's final height can arrive after construction (dynamic
    // import, dvh units, flex settling).
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Stop pins, rebuilt whenever the rest nights change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("stops") as GeoJSONSource | undefined)?.setData(stopFeatures);
  }, [stopFeatures, ready]);

  // Driven route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("journey") as GeoJSONSource | undefined;
    if (!source) return;

    source.setData(
      journey
        ? { type: "Feature", geometry: journey as never, properties: {} }
        : EMPTY,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyKey, ready]);

  // Layer visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const set = (id: string, on: boolean) =>
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");

    for (const id of ["plan-casing", "plan", "plan-done", "plan-selected", "stops", "stop-labels", "stop-selected"]) {
      set(id, showPlan);
    }
    for (const id of ["journey-casing", "journey"]) {
      set(id, showDriven);
    }
  }, [showPlan, showDriven, ready]);

  // Progress: the frontier between solid and dashed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("plan", [">", ["get", "leg"], doneLegs]);
    map.setFilter("plan-done", ["<=", ["get", "leg"], doneLegs]);
  }, [doneLegs, ready]);

  // Selection: highlight, then move the camera to what was selected. A driving
  // day frames its whole leg; a rest day has no leg, so it frames the place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    map.setFilter("plan-selected", ["==", ["get", "leg"], selectedLeg ?? -1]);
    map.setFilter("stop-selected", ["==", ["get", "stop"], selectedStop ?? -1]);

    if (selectedLeg !== null) {
      const line = LEG_GEOMETRY[selectedLeg];
      if (line?.length) {
        const b = line.reduce(
          (acc, c) => acc.extend(c),
          new LngLatBounds(line[0], line[0]),
        );
        map.fitBounds(b, { padding: 50, maxZoom: 9 });
        return;
      }
    }

    if (selectedStop !== null) {
      map.easeTo({ center: STOPS[selectedStop].coord, zoom: 7 });
      return;
    }

    map.fitBounds(PLAN_BOUNDS, { padding: 44 });
  }, [selectedLeg, selectedStop, ready]);

  return (
    // Announced as an image with a text alternative rather than as an
    // interactive control: everything the pins can do — selecting a day — is
    // also on the itinerary buttons below, which are real text and reachable by
    // keyboard. A canvas that traps focus without offering that would be worse.
    <div
      className={className}
      ref={container}
      role="img"
      aria-label="Map of the planned Boston to Los Angeles route. The itinerary below lists each day in the same order."
    >
      {error && <div className="map-error">Map error: {error}</div>}
    </div>
  );
}
