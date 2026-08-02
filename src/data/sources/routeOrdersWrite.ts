import { authHeaders, loadSession } from '../session';

export interface RouteOrderUpdatePayload {
  /** "เลขคำสั่งซื้อ" (order number) — the only key the backend matches by,
   * never row position. */
  orderNo: string;
  /** ISO YYYY-MM-DD — converted server-side to the sheet's own M/D/YYYY text. */
  plannedDeliveryDate?: string;
  note?: string;
  wantsTaxInvoice?: boolean;
  /** Stamps "ปัญหาการส่ง" (the closest real column — the sheet has no column
   * dedicated purely to this app's status vocabulary) with 'ส่งสำเร็จ'. */
  markDelivered?: boolean;
  /** Sets "ปัญหาการส่ง" to an arbitrary known value (see server/lib.ts's
   * allowlist) — used when closing a batch-picking lot ("กำลังจัดส่ง") or a
   * driver reporting a failed delivery ("ส่งไม่สำเร็จ"). This app's own
   * record of an outcome, kept apart from API Import's own Status column
   * (which this app never writes to). */
  status?: string;
  /** Hides/unhides the order from normal operational views without deleting it. */
  archived?: boolean;
  /** Stamps "Route"/"BATCH ROUTE"/"คนส่ง"/"วันที่ Assign" (four separate
   * columns) after a batch Assign or edit — pass all three below together to
   * set them. The driver's username is resolved server-side from the Users
   * tab (not sent from here), since listing users is admin/manager-only and
   * admin_staff can also run the Planner. */
  courierVehicleId?: string;
  courierVehicleName?: string;
  courierBatchId?: string;
  /** Blanks all four Assign columns back out — an order pulled out of its batch. */
  clearCourierStamp?: boolean;
}

/**
 * Writes staff-entered fields (delivery date, note, tax-invoice override,
 * operational status, courier stamp, archive flag) to the "คำสั่งซื้อ VS"
 * Google Sheet tab via the backend (server/ locally, api/ on Vercel), which
 * holds the Service Account credential. Matched purely by Order UID: an
 * existing row gets updated in place; a brand new order (no row yet) gets
 * one appended. Never touches API Import — this tab holds only what staff
 * enter through this app's own UI.
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
