import Papa from 'papaparse';

// Shared cache for every Google Sheet CSV export this app reads. Keeps
// repeated page renders from re-fetching the same tab, and — since Sheets
// CSV export has no auth — degrades gracefully to the last-known-good rows
// if a fetch fails instead of taking the whole page down with it.

const DEFAULT_TTL_MS = 45_000;

interface CacheEntry {
  rows: Record<string, string>[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Record<string, string>[]>>();

async function fetchAndParse(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ (HTTP ${res.status})`);
  }
  const csvText = await res.text();
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });
  return parsed.data;
}

/**
 * Fetch a sheet tab's rows keyed by its header row. Cached for `ttlMs`
 * (default 45s); on a fetch failure, serves the last successful result
 * instead of throwing, so a transient network blip never crashes a page
 * that already loaded data once. Only throws if there is no cached data yet.
 */
export async function fetchSheetRows(url: string, ttlMs: number = DEFAULT_TTL_MS): Promise<Record<string, string>[]> {
  const cached = cache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttlMs) {
    return cached.rows;
  }

  const existingRequest = inFlight.get(url);
  if (existingRequest) return existingRequest;

  const request = fetchAndParse(url)
    .then((rows) => {
      cache.set(url, { rows, fetchedAt: Date.now() });
      inFlight.delete(url);
      return rows;
    })
    .catch((err: unknown) => {
      inFlight.delete(url);
      if (cached) return cached.rows;
      throw err instanceof Error ? err : new Error('โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ');
    });

  inFlight.set(url, request);
  return request;
}

/** Force the next fetchSheetRows(url) call to hit the network again. */
export function invalidateSheetCache(url: string): void {
  cache.delete(url);
}
