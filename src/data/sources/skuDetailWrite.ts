import { authHeaders, loadSession } from '../session';

export interface LineItemPromoLinkPayload {
  orderNo: string;
  sku: string;
  /** The line's own "No." from the sheet, when known — the most precise
   * match target for one specific row. */
  no?: string;
  /** '' clears the link (unconfirms), any other value confirms that promo. */
  promoSku: string;
}

/**
 * Confirms (or clears) that one order line used a given promotion, writing
 * back to the real "SKU Detail" Google Sheet via the backend. Mirrors
 * updateRouteOrder's error-handling shape.
 */
export async function linkLineItemPromo(payload: LineItemPromoLinkPayload): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/sku-detail/link-promo', {
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
