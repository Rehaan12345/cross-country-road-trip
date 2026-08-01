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
function coordsOf(g: Geometry | null): [number, number][] {
  return rawCoords(g).filter(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 90 &&
      !(lng === 0 && lat === 0),
  );
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };

export default function RouteMap({
  geojson,
  className = "map",
}: {
  geojson: Geometry | null;
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
    if (!source) return;

    const coords = coordsOf(geojson);

    if (!geojson || coords.length === 0) {
      source.setData(EMPTY);
      map.fitBounds(US_BOUNDS, { padding: 20, duration: 0 });
      return;
    }

    source.setData({ type: "Feature", geometry: geojson, properties: {} });

    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new LngLatBounds(coords[0], coords[0]),
    );
    map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  return (
    <div className={className} ref={container}>
      {error && <div className="map-error">Map error: {error}</div>}
    </div>
  );
}
