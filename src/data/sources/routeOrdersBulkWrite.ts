// One client function per Order Management bulk-actions toolbar action, all
// POSTing to the single backend endpoint (server/lib.ts's
// handleBulkUpdateRouteOrders) that writes every selected order's cells with
// ONE values.batchUpdate call (plus, only when some selected orders have no
// คำสั่งซื้อ VS row yet, one values.append) — never a per-order loop. See
// routeOrdersWrite.ts's updateRouteOrder for the equivalent single-order
// write this replaces for bulk use (archive included).
import { authHeaders, loadSession } from '../session';

export interface BulkUpdateFailure {
  orderNo: string;
  reason: string;
}

export interface BulkUpdateResult {
  succeeded: string[];
  failed: BulkUpdateFailure[];
}

async function postBulkUpdate<T extends Record<string, unknown> = Record<string, never>>(payload: Record<string, unknown>): Promise<BulkUpdateResult & T> {
  let res: Response;
  try {
    res = await fetch('/api/route-orders/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(loadSession()) },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
  }
  const succeeded = body && typeof body === 'object' && Array.isArray((body as { succeeded?: unknown }).succeeded) ? ((body as { succeeded: string[] }).succeeded) : [];
  const failed = body && typeof body === 'object' && Array.isArray((body as { failed?: unknown }).failed) ? ((body as { failed: BulkUpdateFailure[] }).failed) : [];
  return { ...(body as object), succeeded, failed } as BulkUpdateResult & T;
}

/** "ตั้งวันที่จัดส่ง" bulk action — dates is a per-order map so it covers both
 * modes: "ใช้วันที่แนะนำ" (a different ISO date per order, computed by the
 * caller from each row's own suggested date) and "เลือกวันเดียวกันทั้งหมด"
 * (the same ISO date repeated for every selected order). */
export function bulkSetDeliveryDate(dates: Record<string, string>): Promise<BulkUpdateResult> {
  return postBulkUpdate({ orderNos: Object.keys(dates), action: 'setDeliveryDate', dates });
}

/** "Assign ยกชุด" — courierVehicleId/Name/courierBatchId set together on
 * every selected order, "วันที่ Assign" stamped server-side with the current
 * time (identical for every order in this one call). courierUsername comes
 * back resolved (never sent) since listing Users is admin/manager-only. */
export function bulkAssign(orderNos: string[], courierVehicleId: string, courierVehicleName: string, courierBatchId: string): Promise<BulkUpdateResult & { courierUsername?: string }> {
  return postBulkUpdate<{ courierUsername?: string }>({ orderNos, action: 'assign', courierVehicleId, courierVehicleName, courierBatchId });
}

/** "เปลี่ยนสถานะ" — writes into "ปัญหาการส่ง", same allowlist as the single-order edit form. */
export function bulkSetStatus(orderNos: string[], status: string): Promise<BulkUpdateResult> {
  return postBulkUpdate({ orderNos, action: 'setStatus', status });
}

/** "ใส่หมายเหตุ" — mode defaults to append (ต่อท้ายของเดิม); pass 'overwrite' for เขียนทับ. */
export function bulkSetNote(orderNos: string[], note: string, mode: 'append' | 'overwrite' = 'append'): Promise<BulkUpdateResult> {
  return postBulkUpdate({ orderNos, action: 'setNote', note, mode });
}

/** "ติ๊กใบกำกับภาษี ยกชุด". */
export function bulkSetTaxInvoice(orderNos: string[], wantsTaxInvoice: boolean): Promise<BulkUpdateResult> {
  return postBulkUpdate({ orderNos, action: 'setTaxInvoice', wantsTaxInvoice });
}

/** "ติ๊กโปรโมชั่น ยกชุด". */
export function bulkSetPromotion(orderNos: string[], promotionFlag: boolean): Promise<BulkUpdateResult> {
  return postBulkUpdate({ orderNos, action: 'setPromotion', promotionFlag });
}

/** Archive/unarchive — replaces the old per-order Promise.all loop. */
export function bulkArchive(orderNos: string[], archived: boolean): Promise<BulkUpdateResult> {
  return postBulkUpdate({ orderNos, action: 'archive', archived });
}
