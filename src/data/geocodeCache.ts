// Persistent cache of reverse-geocode results, keyed by rounded coordinate so
// nearby points (same building, minor GPS jitter) share one lookup. Survives
// reloads in localStorage — reverse-geocoding is rate-limited (see
// src/config/geocoding.ts), so a coordinate is only ever looked up once.

export interface GeocodeResult {
  subdistrict: string;
  district: string;
  province: string;
}

export interface GeocodeCacheEntry extends GeocodeResult {
  fetchedAt: number;
}

export type GeocodeCache = Record<string, GeocodeCacheEntry>;

const STORAGE_KEY = 'warehouse-ops.geocodeCache.v1';

/** 5 decimal places is ~1.1m of precision — plenty to treat "the same
 * customer's coordinate" as one cache entry without conflating genuinely
 * distinct nearby addresses. */
export function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function loadGeocodeCache(): GeocodeCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as GeocodeCache;
  } catch {
    return {};
  }
}

export function saveGeocodeCache(cache: GeocodeCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable (private mode) — cache stays in memory for this session */
  }
}
