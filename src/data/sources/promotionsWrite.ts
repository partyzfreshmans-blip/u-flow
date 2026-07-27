import { authHeaders, loadSession } from '../session';

export interface PromotionUpsertPayload {
  sku: string;
  productName: string;
  termText: string;
  /** ISO YYYY-MM-DD — converted server-side to the sheet's own M/D/YYYY text. */
  start?: string;
  end?: string;
  promotionPrice?: number;
  boxPrice?: number;
  singlePrice?: number;
}

/**
 * Creates or updates a row in the real "โปรโมชั่น" Google Sheet via the
 * backend (server/ locally, api/ on Vercel), which holds the Service Account
 * credential. Matched by SKU — an existing SKU updates that row in place,
 * a new one appends. Mirrors updateRouteOrder's error-handling shape.
 */
export async function upsertPromotion(payload: PromotionUpsertPayload): Promise<{ created: boolean }> {
  let res: Response;
  try {
    res = await fetch('/api/promotions/upsert', {
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
  const body: unknown = await res.json().catch(() => null);
  const created = !!(body && typeof body === 'object' && 'created' in body && (body as { created: unknown }).created === true);
  return { created };
}
