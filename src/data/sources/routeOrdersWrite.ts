const API_BASE: string = import.meta.env.VITE_CS_MASTER_API_URL || 'http://localhost:8787';

export interface RouteOrderUpdatePayload {
  orderNo: string;
  /** ISO YYYY-MM-DD — converted server-side to the sheet's own M/D/YYYY text. */
  plannedDeliveryDate?: string;
  note?: string;
  wantsTaxInvoice?: boolean;
}

/**
 * Writes delivery date / note / tax-invoice fields back to the real
 * "คำสั่งซื้อ" Google Sheet via the local backend (server/), which holds the
 * Service Account credential. The backend matches the row by order number and
 * updates it in place — it never appends a new row.
 */
export async function updateRouteOrder(payload: RouteOrderUpdatePayload): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/route-orders/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ตรวจสอบว่ารัน npm run server อยู่หรือไม่');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึกไม่สำเร็จ (HTTP ${res.status})`);
  }
}
