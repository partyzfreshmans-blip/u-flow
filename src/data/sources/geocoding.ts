import type { GeocodeResult } from '../geocodeCache';

/**
 * Reverse-geocodes one coordinate via the backend proxy (server/ locally,
 * api/ on Vercel) — never straight to Nominatim, since the browser can't set
 * the User-Agent header its usage policy requires and the backend is where
 * every caller shares one rate-limited queue. Never throws: any failure
 * (network, rate limit, no result) resolves to null so callers can fall back
 * to the text-matching zone lookup instead of breaking the page.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  try {
    const res = await fetch('/api/geocode/reverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<GeocodeResult>;
    if (!data.subdistrict && !data.district && !data.province) return null;
    return { subdistrict: data.subdistrict ?? '', district: data.district ?? '', province: data.province ?? '' };
  } catch {
    return null;
  }
}
