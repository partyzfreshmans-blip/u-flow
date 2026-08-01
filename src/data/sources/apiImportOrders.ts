// Order data from the "API Import" tab — read through this app's own
// backend (server/lib.ts's handleFetchApiImportOrders), which uses the
// Service Account (GOOGLE_SERVICE_ACCOUNT_KEY) to call the Sheets API
// directly, not the old public-CSV-export URL. Two reasons: the tab may not
// stay publicly link-shared forever, and this keeps read and write on the
// exact same authenticated path instead of two different ones. The backend
// caches its own read for ~60s and, on a failed live read, falls back to
// whatever it last read successfully (see server/lib.ts's SheetReadCache) —
// `stale: true` here means the data being shown is that fallback, not a
// hard error, so the caller can show a small warning banner instead of
// blanking the page.
import type { ApiImportOrder } from '../types';
import { authHeaders, type Session } from '../session';

export interface ApiImportOrdersResult {
  orders: ApiImportOrder[];
  stale: boolean;
  error: string | null;
}

export async function fetchApiImportOrders(session: Session | null): Promise<ApiImportOrdersResult> {
  let res: Response;
  try {
    res = await fetch('/api/route-orders/api-import', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    if (message) throw new Error(message);
    if (res.status === 404) {
      throw new Error('ไม่พบ backend endpoint /api/route-orders/api-import — ตรวจสอบว่า deploy ล่าสุดสร้าง serverless function นี้จริง');
    }
    throw new Error(`โหลดออเดอร์จาก API Import ไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { orders?: ApiImportOrder[]; stale?: boolean; error?: string | null };
  return { orders: Array.isArray(body.orders) ? body.orders : [], stale: !!body.stale, error: body.error ?? null };
}
