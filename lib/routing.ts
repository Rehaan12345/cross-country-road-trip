// Server-only. Turning a typed city name into coordinates, and coordinates into
// a real driving line.
//
// Both services are called ONLY when you add something to the route — never
// when the map renders. The result is stored, so the itinerary and the drawn
// route keep working with no signal at all, which is the state you are actually
// in for most of Utah.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const UA = "cross-country-drive-26/1.0 (personal trip logger)";

export type Place = {
  name: string;
  /** [lng, lat] — the order MapLibre and OSRM both use. */
  coord: [number, number];
};

/**
 * Look up a place by name, returning several candidates.
 *
 * Several rather than one because "Springfield" is a coin flip and silently
 * routing a 500-mile detour to the wrong state is worse than one extra tap.
 */
export async function searchPlaces(query: string, limit = 5): Promise<Place[]> {
  const url = `${NOMINATIM}?format=jsonv2&limit=${limit}&q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`geocoder returned ${res.status}`);

  const body = (await res.json()) as Array<{
    display_name?: string;
    name?: string;
    lat?: string;
    lon?: string;
  }>;

  return body
    .map((r) => ({
      // display_name is the full "Denver, Colorado, United States" form, which
      // is what disambiguates one candidate from another in the picker.
      name: (r.display_name ?? r.name ?? "").split(",").slice(0, 3).join(",").trim(),
      coord: [Number(r.lon), Number(r.lat)] as [number, number],
    }))
    .filter(
      (p) =>
        p.name &&
        Number.isFinite(p.coord[0]) &&
        Number.isFinite(p.coord[1]) &&
        Math.abs(p.coord[0]) <= 180 &&
        Math.abs(p.coord[1]) <= 90,
    );
}

export type Drive = {
  miles: number;
  minutes: number;
  geometry: [number, number][];
};

/**
 * A real driving line through the given points, in order.
 *
 * `overview=simplified` is what keeps a 500-mile leg down to a few dozen
 * vertices — invisibly different at road-trip zoom, and small enough to store
 * inline. Coordinates are rounded to 4dp (~11 m) for the same reason.
 */
export async function driveBetween(points: [number, number][]): Promise<Drive> {
  const coords = points.map((p) => p.join(",")).join(";");
  const url = `${OSRM}/${coords}?overview=simplified&geometries=geojson`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`router returned ${res.status}`);

  const body = (await res.json()) as {
    code?: string;
    routes?: Array<{
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
    }>;
  };

  const route = body.routes?.[0];
  if (body.code !== "Ok" || !route) {
    throw new Error(`no road route found (${body.code ?? "unknown"})`);
  }

  return {
    miles: Math.round(route.distance / 1609.34),
    // OSRM's public demo profile is pessimistic on interstates — it put the
    // Boston leg at 9.4h against the plan's 6h58m. Kept anyway because a
    // consistent estimate beats a blank, and the number is editable.
    minutes: Math.round(route.duration / 60),
    geometry: route.geometry.coordinates.map(
      ([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as [number, number],
    ),
  };
}
