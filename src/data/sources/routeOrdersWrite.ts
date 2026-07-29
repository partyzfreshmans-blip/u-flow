import { authHeaders, loadSession, type Session } from '../session';

export interface RouteOrderUpdatePayload {
  orderNo: string;
  /** ISO YYYY-MM-DD — converted server-side to the sheet's own M/D/YYYY text. */
  plannedDeliveryDate?: string;
  note?: string;
  wantsTaxInvoice?: boolean;
  /** Stamps Status='ส่งสำเร็จ' and the delivery timestamp column with now(). */
  markDelivered?: boolean;
  /** Sets the Status column to an arbitrary known value (see server/lib.ts's
   * allowlist) — used when closing a batch-picking lot. */
  status?: string;
  /** Hides/unhides the order from normal operational views without deleting it. */
  archived?: boolean;
  /** Stamps column N ("คนส่ง") with "{driver}/{vehicle}/{batchId}" after a
   * batch Assign or edit — pass all three together to set it. The driver's
   * name is resolved server-side from the Users tab (not sent from here),
   * since listing users is admin/manager-only and admin_staff can also run
   * the Planner. */
  courierVehicleId?: string;
  courierVehicleName?: string;
  courierBatchId?: string;
  /** Blanks column N back out — an order pulled out of its batch. */
  clearCourierStamp?: boolean;
}

/**
 * Writes delivery date / note / tax-invoice fields back to the real
 * "คำสั่งซื้อ VS" Google Sheet tab via the backend (server/ locally, api/ on
 * Vercel), which holds the Service Account credential. The backend matches
 * the row by order number and updates it in place — it never appends a new row.
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

export interface SyncRouteOrdersResult {
  created: number;
  updated: number;
  skipped: { orderUid: string; reason: string }[];
}

/**
 * Triggers the backend's API Import -> "คำสั่งซื้อ VS" merge, matched
 * strictly by Order UID (never row position) — see handleSyncRouteOrders in
 * server/lib.ts. Called from actions.syncNow, before the CSV re-fetch of
 * routeOrders, so that re-fetch reads the just-synced rows.
 */
export async function syncRouteOrdersVs(session: Session): Promise<SyncRouteOrdersResult> {
  let res: Response;
  try {
    res = await fetch('/api/route-orders/sync', { method: 'POST', headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `ซิงค์คำสั่งซื้อไม่สำเร็จ (HTTP ${res.status})`);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    created: typeof b.created === 'number' ? b.created : 0,
    updated: typeof b.updated === 'number' ? b.updated : 0,
    skipped: Array.isArray(b.skipped) ? (b.skipped as { orderUid: string; reason: string }[]) : [],
  };
}
