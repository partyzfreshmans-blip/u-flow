import { authHeaders, loadSession, type Session } from '../session';

export interface CustomerLocationOverride {
  phone: string;
  lat: number;
  lng: number;
}

/** Every customer with a saved lat/lng override, from Postgres — the base
 * customer list (name/address/etc.) still comes straight from the CS Master
 * Google Sheet, unchanged; this supplies just the override on top, since
 * that's the one piece now written to Postgres instead (see
 * updateCsMasterLatLng below) and the Sheet would otherwise never reflect it
 * again. Callers merge this over the CS Master rows by phone. */
export async function fetchCustomerLocationOverrides(session: Session | null): Promise<CustomerLocationOverride[]> {
  let res: Response;
  try {
    res = await fetch('/api/cs-master/location-overrides', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `โหลดพิกัดลูกค้าไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { overrides?: CustomerLocationOverride[] };
  return Array.isArray(body.overrides) ? body.overrides : [];
}

/**
 * Writes a corrected lat/lng to Postgres's `customers` table (lat_override/
 * lng_override) via the backend (server/ locally, api/ on Vercel). Matched
 * by phone (the table's primary key) — creates the customer row on the spot
 * if it's never been seen before, rather than requiring it to already exist.
 */
export async function updateCsMasterLatLng(name: string, phone: string, lat: number, lng: number): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/cs-master/update-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(loadSession()) },
      body: JSON.stringify({ name, phone, lat, lng }),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึกพิกัดไม่สำเร็จ (HTTP ${res.status})`);
  }
}

/**
 * Best-effort background push of the CS Master sheet's current name+phone
 * pairs into Postgres's `customers.name_from_unii`, matched by phone only —
 * keeps that column current as shop names change in Unii without ever
 * touching lat_override/lng_override or creating a duplicate row for a
 * renamed shop. Never awaited by callers that shouldn't block on it, same
 * fire-and-forget shape as persistBatchRoutes.
 */
export async function syncCustomerNames(session: Session | null, customers: { phone: string; name: string }[]): Promise<void> {
  const res = await fetch('/api/cs-master/sync-names', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ customers }),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `ซิงค์ชื่อลูกค้าไม่สำเร็จ (HTTP ${res.status})`);
  }
}
