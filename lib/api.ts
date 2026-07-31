// A failed fetch must not look like a slow one. Previously any non-OK response
// (a 401 from an expired cookie, a 500 from a bad env var) threw inside .json()
// and left the page showing "Loading…" forever, which reads as a blank screen.
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }

  return res.json();
}
