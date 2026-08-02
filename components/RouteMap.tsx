"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// maplibre-gl v6 has no default export.
import { MapLibreMap, LngLatBounds, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre parses vector tiles in a Web Worker. It locates that worker from
// `import.meta.url`, which every bundler rewrites to a `file://` literal — so
// its own `/^https?:/` guard fails, it falls back to `new Worker("")`, and the
// worker silently never loads. The style still paints its background layer, so
// the map looks like a black rectangle instead of throwing. Point it at the
// copy served from public/ml/ (which keeps maplibre-gl-shared.mjs beside it,
// as the worker imports that sibling at runtime).
setWorkerUrl("/ml/maplibre-gl-worker.mjs");

// Kept in one place so switching tile providers is a one-line change.
// CARTO's dark basemap needs no API key, which is one less thing to configure.
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Continental US. The default view before any route exists, and the fallback
// whenever a trip has too few points to draw.
const US_BOUNDS: [[number, number], [number, number]] = [
  [-125, 24],
  [-66.9, 49.5],
];

type Geometry =
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

function rawCoords(g: Geometry | null): [number, number][] {
  if (!g) return [];
  if (g.type === "LineString") return g.coordinates;
  if (g.type === "MultiLineString") return g.coordinates.flat();
  if (g.type === "GeometryCollection") return g.geometries.flatMap(rawCoords);
  return [];
}

// A single junk coordinate — a null-island (0,0) ping, or anything out of range
// — would stretch fitBounds across the planet and shrink the route to nothing.
function isValid([lng, lat]: [number, number]) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90 &&
    !(lng === 0 && lat === 0)
  );
}

function coordsOf(g: Geometry | null): [number, number][] {
  return rawCoords(g).filter(isValid);
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };

// Every separate line in the geometry gets a start and an end marker. Derived
// from the drawn geometry rather than queried separately, so the dots can never
// disagree with the line they sit on.
function endpointFeatures(g: Geometry | null) {
  const lines: [number, number][][] =
    !g ? []
      : g.type === "LineString" ? [g.coordinates]
      : g.type === "MultiLineString" ? g.coordinates
      : g.type === "GeometryCollection" ? g.geometries.flatMap((x) =>
          x.type === "LineString" ? [x.coordinates]
          : x.type === "MultiLineString" ? x.coordinates
          : [])
      : [];

  return {
    type: "FeatureCollection" as const,
    features: lines.flatMap((line) => {
      const valid = line.filter(
        ([lng, lat]) =>
          Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0),
      );
      if (valid.length < 2) return [];
      return [
        { role: "start", at: valid[0] },
        { role: "end", at: valid[valid.length - 1] },
      ].map(({ role, at }) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: at },
        properties: { role },
      }));
    }),
  };
}

export default function RouteMap({
  geojson,
  planned = null,
  current = null,
  currentStale = false,
  className = "map",
}: {
  geojson: Geometry | null;
  /**
   * Planned legs marked driven on the Route tab. Drawn in the recorded green
   * but dashed, UNDER the recorded line: one journey, with the dash saying
   * which parts the phone traced and which parts you asserted. Matches the
   * completed-plan treatment on the Route tab.
   */
  planned?: Geometry | null;
  /** Last received ping, as [lng, lat]. Drawn above everything else. */
  current?: [number, number] | null;
  /**
   * The last ping is old enough that calling it a current position would be a
   * lie. Drawn grey instead of blue rather than hidden — a stale marker still
   * answers "where did the recorder die?".
   */
  currentStale?: boolean;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The parent refetches on a timer, so `geojson` arrives as a new object every
  // poll even when the route is unchanged. Key the data effect on content, not
  // identity, or the map refits its bounds every ten seconds.
  const key = useMemo(() => (geojson ? JSON.stringify(geojson) : null), [geojson]);
  const plannedKey = useMemo(() => (planned ? JSON.stringify(planned) : null), [planned]);

  // Create the map exactly once. Rebuilding it per data change is what kept it
  // from ever painting.
  useEffect(() => {
    if (!container.current) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: container.current,
        style: MAP_STYLE,
        center: [-98.5, 39.8],
        zoom: 3,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Map failed to initialise");
      return;
    }

    mapRef.current = map;

    map.on("error", (e) => {
      const msg = e.error?.message ?? "Map error";
      console.error("[map]", msg, e);
      setError(msg);
    });

    map.on("load", () => {
      map.resize();

      // Added first so it sits beneath the recorded route: where the GPS
      // actually went should win wherever the two overlap.
      map.addSource("planned", { type: "geojson", data: EMPTY });

      map.addLayer({
        id: "planned-casing",
        type: "line",
        source: "planned",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#00120a",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 7, 10, 13],
        },
      });

      // Same green as the GPS trace, because this is the same journey — a day
      // you drove is a day you drove, and a pale line read as "not really
      // covered". The dashes carry the provenance instead: solid means the
      // recorder traced it, dashed means you vouched for it. That distinction
      // has to survive, or there's no way to tell when the recorder died.
      map.addLayer({
        id: "planned",
        type: "line",
        source: "planned",
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#3dff9a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 10, 7],
          "line-dasharray": [2, 1.4],
        },
      });

      map.addSource("route", { type: "geojson", data: EMPTY });

      // Dark casing under a bright core. On a near-black basemap a single thin
      // line disappears into the land fill; the casing gives it an edge so the
      // route reads at any zoom.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#00120a",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 8, 10, 16],
        },
      });

      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#3dff9a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 10, 9],
        },
      });

      // Start and end markers, above the line.
      map.addSource("endpoints", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "endpoints",
        type: "circle",
        source: "endpoints",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 6, 10, 11],
          "circle-color": [
            "match",
            ["get", "role"],
            "start", "#3dff9a",
            "#ff5c5c",
          ],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#00120a",
        },
      });

      // Current position, last so it sits above the endpoint dots it will often
      // overlap: a soft halo under a hard core, so it reads as "here, now"
      // rather than as another route marker.
      map.addSource("current", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "current-halo",
        type: "circle",
        source: "current",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 12, 10, 22],
          "circle-color": ["case", ["get", "stale"], "#8a94a0", "#4da3ff"],
          "circle-opacity": 0.2,
        },
      });
      map.addLayer({
        id: "current",
        type: "circle",
        source: "current",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 10, 8],
          "circle-color": "#ffffff",
          "circle-stroke-width": 3.5,
          "circle-stroke-color": ["case", ["get", "stale"], "#8a94a0", "#4da3ff"],
        },
      });

      setReady(true);
    });

    // The container can gain its final height after construction (dynamic
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

  // Feed data into the existing map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource("route") as GeoJSONSource | undefined;
    const marks = map.getSource("endpoints") as GeoJSONSource | undefined;
    if (!source || !marks) return;

    const plannedSource = map.getSource("planned") as GeoJSONSource | undefined;
    plannedSource?.setData(
      planned ? { type: "Feature", geometry: planned, properties: {} } : EMPTY,
    );

    const coords = coordsOf(geojson);
    // Planned legs frame the map too — otherwise ticking days off before the
    // recorder has ever run would draw a line the view is nowhere near.
    const plannedCoords = coordsOf(planned);
    const all = [...coords, ...plannedCoords];

    if (!geojson || coords.length === 0) {
      source.setData(EMPTY);
      marks.setData(EMPTY);
    } else {
      source.setData({ type: "Feature", geometry: geojson, properties: {} });
      marks.setData(endpointFeatures(geojson));
    }

    if (all.length === 0) {
      map.fitBounds(US_BOUNDS, { padding: 20, duration: 0 });
      return;
    }

    const bounds = all.reduce(
      (b, c) => b.extend(c),
      new LngLatBounds(all[0], all[0]),
    );
    map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, plannedKey, ready]);

  // The current position moves on every poll, so it gets its own effect: the
  // marker must be able to move without the view refitting itself under the
  // user's fingers every ten seconds.
  const framedOnCurrent = useRef(false);
  // The parent re-renders once a second to run its clock; keyed on content so
  // the journey geometry isn't rewalked on every tick.
  const hasRoute = useMemo(
    () => coordsOf(geojson).length > 0 || coordsOf(planned).length > 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, plannedKey],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource("current") as GeoJSONSource | undefined;
    if (!source) return;

    if (!current || !isValid(current)) {
      source.setData(EMPTY);
      return;
    }

    source.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: current },
      properties: { stale: currentStale },
    });

    // With no route drawn there is nothing else framing the map, so the first
    // fix decides the view. Only the first — after that, panning stays the
    // user's business.
    if (!hasRoute && !framedOnCurrent.current) {
      framedOnCurrent.current = true;
      map.easeTo({ center: current, zoom: 9, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.[0], current?.[1], currentStale, hasRoute, ready]);

  return (
    <div className={className} ref={container}>
      {error && <div className="map-error">Map error: {error}</div>}
    </div>
  );
}
