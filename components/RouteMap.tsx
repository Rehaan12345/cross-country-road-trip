"use client";

import { useEffect, useRef } from "react";
// maplibre-gl v6 has no default export.
import { MapLibreMap, LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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

function coordsOf(g: Geometry | null): [number, number][] {
  if (!g) return [];
  if (g.type === "LineString") return g.coordinates;
  if (g.type === "MultiLineString") return g.coordinates.flat();
  if (g.type === "GeometryCollection") return g.geometries.flatMap(coordsOf);
  return [];
}

export default function RouteMap({ geojson }: { geojson: Geometry | null }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;

    const map = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      attributionControl: { compact: true },
      // Open on the US so the map is framed correctly from the first paint,
      // with no flash of world view before the route bounds are applied.
      bounds: US_BOUNDS,
      fitBoundsOptions: { padding: 20 },
    });

    map.on("load", () => {
      const coords = coordsOf(geojson);
      // No route yet — leave the US view in place.
      if (!geojson || coords.length === 0) return;

      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: geojson, properties: {} },
      });

      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#3ddc84", "line-width": 4 },
      });

      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 14 });
    });

    return () => map.remove();
  }, [geojson]);

  return <div className="map" ref={container} />;
}
