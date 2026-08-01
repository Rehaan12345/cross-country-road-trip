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
import { indexOfStop, type RouteStop } from "@/lib/plan";

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
  planDone: "#d5dae1",   // between --muted and --text: behind you, not the GPS trace
  planGlow: "#e8eaed",   // --text, for the selected leg
  side: "#f5a623",       // --warn, same family as a rest stop
  driven: "#3dff9a",     // brighter sibling of --good
  casing: "#00120a",
  origin: "#3ddc84",     // --good
  rest: "#f5a623",       // --warn
  final: "#ff5c5c",      // --bad
  stop: "#e8eaed",       // --text
  label: "#e8eaed",
};

const EMPTY = { type: "FeatureCollection" as const, features: [] };

// Continental US: the frame before any geometry has loaded.
const US_BOUNDS: [[number, number], [number, number]] = [
  [-125, 24],
  [-66.9, 49.5],
];

export default function PlanMap({
  journey,
  showPlan,
  showDriven,
  stops,
  doneStopId,
  selectedDriveFromId,
  selectedStopId,
  onSelectStop,
  className = "map",
}: {
  journey: object | null;
  showPlan: boolean;
  showDriven: boolean;
  stops: RouteStop[];
  doneStopId: string | null;
  selectedDriveFromId: string | null;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
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

  // Everything drawn is derived from the route, so adding a city or a side trip
  // redraws without the map knowing anything about either operation.
  const { planFeatures, sideFeatures, stopFeatures, bounds } = useMemo(() => {
    const donePos = indexOfStop(stops, doneStopId);

    const planFeatures = {
      type: "FeatureCollection" as const,
      features: stops.flatMap((s, i) =>
        s.drive && s.drive.geometry.length > 1
          ? [
              {
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: s.drive.geometry },
                properties: { fromId: s.id, done: i + 1 <= donePos },
              },
            ]
          : [],
      ),
    };

    const sideFeatures = {
      type: "FeatureCollection" as const,
      features: stops.flatMap((s) =>
        s.sideTrips
          .filter((t) => t.geometry.length > 1)
          .map((t) => ({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: t.geometry },
            properties: { id: t.id, stopId: s.id },
          })),
      ),
    };

    const stopFeatures = {
      type: "FeatureCollection" as const,
      features: stops.map((s, i) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: s.coord },
        properties: {
          id: s.id,
          nights: s.restNights,
          // "Chicago, IL · 2n" — the stay is part of the place's name on the
          // map, so the itinerary isn't the only way to see it.
          label: s.restNights > 0 ? `${s.name} · ${s.restNights}n` : s.name,
          kind:
            i === 0 ? "origin"
            : i === stops.length - 1 ? "final"
            : s.restNights > 0 ? "rest"
            : "stop",
        },
      })),
    };

    const all = [
      ...planFeatures.features.flatMap((f) => f.geometry.coordinates),
      ...sideFeatures.features.flatMap((f) => f.geometry.coordinates),
      ...stops.map((s) => s.coord),
    ] as [number, number][];

    const bounds = all.length
      ? all.reduce((b, c) => b.extend(c), new LngLatBounds(all[0], all[0]))
      : new LngLatBounds(US_BOUNDS[0], US_BOUNDS[1]);

    return { planFeatures, sideFeatures, stopFeatures, bounds };
  }, [stops, doneStopId]);

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
        bounds: US_BOUNDS,
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

      map.addSource("plan", { type: "geojson", data: EMPTY });
      map.addSource("side", { type: "geojson", data: EMPTY });
      map.addSource("journey", { type: "geojson", data: EMPTY });
      map.addSource("stops", { type: "geojson", data: EMPTY });

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
        filter: ["==", ["get", "done"], false],
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
        filter: ["==", ["get", "done"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.planDone,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3, 10, 6],
        },
      });

      // Side trips get their own dotted amber line: they are a detour off the
      // chain, and drawing them like a leg would imply the route goes that way.
      map.addLayer({
        id: "side",
        type: "line",
        source: "side",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.side,
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2, 10, 4],
          "line-dasharray": [0.6, 1.8],
        },
      });

      map.addLayer({
        id: "plan-selected",
        type: "line",
        source: "plan",
        filter: ["==", ["get", "fromId"], "__none__"],
        layout: { "line-cap": "round", "line-join": "round" },
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
      // on the label already.
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

      map.addLayer({
        id: "stop-selected",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "id"], "__none__"],
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
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") selectRef.current(id);
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

  // Route geometry. Refits only when the shape actually changes, so adding a
  // city reframes the map but ticking a day does not yank it around.
  const shapeKey = useMemo(
    () => stops.map((s) => `${s.id}:${s.drive?.geometry.length ?? 0}:${s.sideTrips.length}`).join("|"),
    [stops],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    (map.getSource("plan") as GeoJSONSource | undefined)?.setData(planFeatures);
    (map.getSource("side") as GeoJSONSource | undefined)?.setData(sideFeatures);
    (map.getSource("stops") as GeoJSONSource | undefined)?.setData(stopFeatures);
  }, [planFeatures, sideFeatures, stopFeatures, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !stops.length) return;
    map.fitBounds(bounds, { padding: 44 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, ready]);

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

    for (const id of ["plan-casing", "plan", "plan-done", "plan-selected", "side", "stops", "stop-labels", "stop-selected"]) {
      set(id, showPlan);
    }
    for (const id of ["journey-casing", "journey"]) {
      set(id, showDriven);
    }
  }, [showPlan, showDriven, ready]);

  // Selection: highlight, then move the camera. A driving day frames its whole
  // leg; a rest day has no leg, so it frames the place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    map.setFilter("plan-selected", ["==", ["get", "fromId"], selectedDriveFromId ?? "__none__"]);
    map.setFilter("stop-selected", ["==", ["get", "id"], selectedStopId ?? "__none__"]);

    if (selectedDriveFromId) {
      const line = stops.find((s) => s.id === selectedDriveFromId)?.drive?.geometry;
      if (line?.length) {
        const b = line.reduce((acc, c) => acc.extend(c), new LngLatBounds(line[0], line[0]));
        map.fitBounds(b, { padding: 50, maxZoom: 9 });
        return;
      }
    }

    if (selectedStopId) {
      const stop = stops.find((s) => s.id === selectedStopId);
      if (stop) map.easeTo({ center: stop.coord, zoom: 7 });
      return;
    }

    if (stops.length) map.fitBounds(bounds, { padding: 44 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDriveFromId, selectedStopId, ready]);

  return (
    // Announced as an image with a text alternative rather than as an
    // interactive control: everything the pins can do — selecting a day — is
    // also on the itinerary buttons below, which are real text and reachable by
    // keyboard. A canvas that traps focus without offering that would be worse.
    <div
      className={className}
      ref={container}
      role="img"
      aria-label="Map of the planned route. The itinerary below lists each day in the same order."
    >
      {error && <div className="map-error">Map error: {error}</div>}
    </div>
  );
}
