import { authHeaders, loadSession } from '../session';

export interface RouteOrderUpdatePayload {
  /** Order UID — the only key the backend matches by. */
  orderNo: string;
  /** ISO YYYY-MM-DD. */
  plannedDeliveryDate?: string;
  note?: string;
  wantsTaxInvoice?: boolean;
  /** Stamps delivery_issue='ส่งสำเร็จ' and delivery_issue_at with now(). */
  markDelivered?: boolean;
  /** Sets delivery_issue to an arbitrary known value (see server/lib.ts's
   * allowlist) — used when closing a batch-picking lot ("กำลังจัดส่ง") or a
   * driver reporting a failed delivery ("ส่งไม่สำเร็จ"). This app's own
   * record of an outcome, kept apart from API Import's own Status column
   * (which this app never writes to). */
  status?: string;
  /** Hides/unhides the order from normal operational views without deleting it. */
  archived?: boolean;
}

/**
 * Writes staff-entered fields (delivery date, note, tax-invoice override,
 * operational status, archive flag) to Postgres's `orders` table via the
 * backend (server/ locally, api/ on Vercel). Matched purely by Order UID: an
 * existing row gets updated in place; a brand new order (no row yet) gets
 * one created. Never touches API Import — this table holds only what staff
 * enter through this app's own UI. Courier/batch assignment moved to
 * batchRoutesApi.ts's upsertBatchRoutes, which now reconciles it
 * transactionally alongside the batch route itself (see server/lib.ts's
 * handleUpsertBatchRoutes) instead of a separate round trip here.
 */
export async function updateRouteOrder(payload: RouteOrderUpdatePayload): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/route-orders/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(loadSession()) },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
  }
}
