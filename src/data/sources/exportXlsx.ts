// "Export เป็น Excel" buttons across the app — each hits a backend endpoint
// that returns a real .xlsx file body (not JSON), built server-side from the
// API Import + คำสั่งซื้อ VS + Batch Routes + SKU Detail sheets (see
// server/lib.ts's handleExport* functions). This just fetches the blob and
// triggers a normal browser download; there's no state to keep afterward, so
// it isn't wired through the store/reducer like every other data source here.
import { authHeaders, type Session } from '../session';

/** One download path for every export. Passing `body` switches the request
 * to POST with that object as JSON — which is how the scoped exports narrow
 * their output (a selection of orders, or a single order's line items);
 * omitting it does the plain GET full export. */
async function downloadXlsx(url: string, session: Session | null, fallbackFilename: string, body?: Record<string, unknown>): Promise<void> {
  let res: Response;
  try {
    res = body
      ? await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(session) }, body: JSON.stringify(body) })
      : await fetch(url, { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const errBody: unknown = await res.json().catch(() => null);
    const message = errBody && typeof errBody === 'object' && 'error' in errBody ? String((errBody as { error: unknown }).error) : null;
    throw new Error(message || `Export ไม่สำเร็จ (HTTP ${res.status})`);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] ?? fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/** orderNos, when given, scopes the export to exactly the bulk-actions
 * toolbar's "Export เป็น Excel เฉพาะที่เลือก" — omit it (or pass an empty
 * array) for the normal full-table export. */
export function exportRouteOrdersXlsx(session: Session | null, orderNos?: string[]): Promise<void> {
  return downloadXlsx('/api/route-orders/export', session, 'orders.xlsx', orderNos && orderNos.length > 0 ? { orderNos } : undefined);
}

export function exportBatchRouteHistoryXlsx(session: Session | null): Promise<void> {
  return downloadXlsx('/api/batch-routes/export', session, 'batch-route-history.xlsx');
}

/** "Export รายการนี้เป็น Excel" on the order line-items modal — just this
 * one order's SKU Detail rows, plus a totals row. */
export function exportOrderLineItemsXlsx(session: Session | null, orderNo: string): Promise<void> {
  return downloadXlsx('/api/sku-detail/export', session, `order-${orderNo}.xlsx`, { orderNo });
}
