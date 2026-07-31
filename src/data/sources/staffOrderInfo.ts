// Staff-entered order fields — delivery date, note, tax-invoice override,
// operational status, courier assignment, archived — read from Postgres via
// the backend (server/ locally, api/ on Vercel), replacing the old "คำสั่งซื้อ
// VS" Google Sheet CSV read now that this data lives in Postgres's `orders`
// table (see server/lib.ts's handleListRouteOrders). Postgres has no public
// read path the way a Sheet's CSV export did, so this now requires a session
// — every caller already has one by the time it reads order data (see
// routeOrders.ts's fetchRouteOrders). Shaped identically to the old
// StaffOrderInfo the frontend already knows how to join against
// ApiImportOrder (see routeOrders.ts's joinRouteOrders), so nothing
// downstream of this fetch needed to change.
import type { StaffOrderInfo } from '../types';
import { authHeaders, type Session } from '../session';

interface RouteOrderApiRow {
  orderUid: string;
  plannedDeliveryDate: string;
  note: string;
  taxInvoiceOverride: boolean | null;
  operationalStatus: string;
  operationalStatusAt: string;
  courierStamp: string;
  archived: boolean;
  newCustomer: string;
}

export async function fetchStaffOrderInfo(session: Session | null): Promise<StaffOrderInfo[]> {
  let res: Response;
  try {
    res = await fetch('/api/route-orders/list', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    if (message) throw new Error(message);
    // No parseable JSON `error` body means the request never reached this
    // endpoint's own code (every real response it sends is `{ error: ... }`
    // on failure) — a 404 here is this app's own backend route/deployment,
    // unrelated to Unii or its token entirely.
    if (res.status === 404) {
      throw new Error('ไม่พบ backend endpoint /api/route-orders/list — ตรวจสอบว่า deploy ล่าสุดสร้าง serverless function นี้จริง');
    }
    throw new Error(`โหลดข้อมูลออเดอร์ไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { orders?: RouteOrderApiRow[] };
  return Array.isArray(body.orders) ? body.orders : [];
}
