// Reverse geocoding via Nominatim (OpenStreetMap). No API key, no account.
//
// Their usage policy asks for an identifying User-Agent and at most 1 req/sec.
// We call this twice per trip, once ever, so we sit far inside that — but the
// caller must still serialise the two calls.
//
// Every failure path returns null. A missing place name is cosmetic; it must
// never break a trip view or lose data.

const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const UA = "cross-country-drive-26/1.0 (personal trip logger)";

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  "ISO3166-2-lvl4"?: string;
};

export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<string | null> {
  const url = `${ENDPOINT}?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { address?: NominatimAddress };
    const a = body.address;
    if (!a) return null;

    // Rural stretches have no city at all; fall back through progressively
    // coarser administrative levels rather than returning nothing.
    const place =
      a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county;

    // "US-MA" -> "MA". Falls back to the full state name outside the US.
    const iso = a["ISO3166-2-lvl4"];
    const region = iso?.startsWith("US-") ? iso.slice(3) : a.state;

    if (place && region) return `${place}, ${region}`;
    return place ?? region ?? null;
  } catch {
    // Offline, timed out, or rate-limited. Try again next view.
    return null;
  }
}
