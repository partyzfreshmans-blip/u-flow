// Order data straight from the Unii API, via this app's own backend proxy
// (server/ locally, api/ on Vercel — see server/unii.ts and server/lib.ts's
// handleFetchApiImportOrders). Replaces the old public "API Import" Google
// Sheets CSV export entirely — Unii has no public/anonymous read path, so
// this now requires a session, same as every other Postgres-backed read in
// this app. Shaped identically to the old ApiImportOrder the frontend
// already knows how to join against StaffOrderInfo (see routeOrders.ts's
// joinRouteOrders), so nothing downstream of this fetch needed to change.
import type { ApiImportOrder } from '../types';
import { authHeaders, type Session } from '../session';

/**
 * On a Unii outage/expired token the backend still returns 200 with
 * whatever cached data it has (`stale: true`) rather than an error — this
 * only throws when the backend itself reports it has nothing to show
 * (non-2xx), which the caller's existing error-banner handling covers.
 */
export async function fetchApiImportOrders(session: Session | null): Promise<ApiImportOrder[]> {
  let res: Response;
  try {
    res = await fetch('/api/route-orders/api-import', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `โหลดออเดอร์จาก Unii API ไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { orders?: ApiImportOrder[]; stale?: boolean; error?: string | null };
  if (body.stale) {
    console.warn('[api-import] showing last known Unii order data — live fetch failed:', body.error);
  }
  return Array.isArray(body.orders) ? body.orders : [];
}
